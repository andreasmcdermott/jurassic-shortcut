import { allowedPath } from '../shared/shortcut-path.js';

const API = 'https://api.app.shortcut.com/api/v3';
const TTL = 8 * 60 * 60 * 1000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const json = (data, status = 200, headers = {}) => Response.json(data, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
});
const encode = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const decode = text => Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));

async function sessionKey(secret) {
  if (typeof secret !== 'string' || !/^[a-f\d]{64}$/i.test(secret)) throw new Error('SESSION_SECRET must be 32 random bytes encoded as hex.');
  return crypto.subtle.importKey('raw', Uint8Array.from(secret.match(/../g), b => parseInt(b, 16)), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(value, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode('fsn-session-v1') }, await sessionKey(secret), encoder.encode(JSON.stringify(value)));
  return `${encode(iv)}.${encode(new Uint8Array(ciphertext))}`;
}
async function open(value, secret, now) {
  try {
    if (!value || value.length > 3800) return null;
    const parts = value.split('.');
    if (parts.length !== 2) return null;
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(parts[0]), additionalData: encoder.encode('fsn-session-v1') }, await sessionKey(secret), decode(parts[1]));
    const session = JSON.parse(decoder.decode(plaintext));
    return typeof session.token === 'string' && session.expires > now ? session : null;
  } catch { return null; }
}
async function scopeFor(member, token, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return encode(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(JSON.stringify([member.workspace2?.id, member.id, token])))));
}
function cookie(value, secure, maxAge = TTL / 1000) {
  return `fsn_session=${value}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
function upstreamError(status) {
  return {
    401: 'Shortcut rejected this token. Check the token and reconnect.',
    403: 'This token cannot access this Shortcut resource.',
    404: 'This object is no longer available in Shortcut.',
    429: 'Shortcut is rate limiting requests. Wait a moment, then retry.',
  }[status] || `Shortcut returned an error (${status}). Retry loading the directory.`;
}

// Dependency injection keeps tests off real workspaces and credentials.
export function createWorker({ fetchImpl = fetch, now = Date.now } = {}) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
      const secure = url.protocol === 'https:';
      const origin = request.headers.get('Origin');
      if ((origin && origin !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') return json({ error: 'Cross-origin requests are not allowed.' }, 403);
      if (request.headers.get('X-Fsn-Client') !== '1') return json({ error: 'Missing client header.' }, 403);
      if (url.pathname === '/api/health' && request.method === 'GET') return json({ ok: true });
      if (!secure && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return json({ error: 'HTTPS is required.' }, 403);

      try {
        // Fail closed rather than silently using a development signing key.
        await sessionKey(env.SESSION_SECRET);
        const upstream = async (token, path) => {
          let response;
          try {
            response = await fetchImpl(`${API}${path}`, {
              method: 'GET', headers: { 'Shortcut-Token': token, Accept: 'application/json' },
              redirect: 'manual', signal: AbortSignal.timeout(30000),
            });
          } catch { return json({ error: 'Could not reach Shortcut. Check your connection and retry.' }, 502); }
          if (!response.ok) {
            // Workers support manual/follow redirect modes. Never follow a
            // redirect with the token or forward a Location header to visitors.
            if (response.status >= 300 && response.status < 400) {
              await response.body?.cancel();
              return json({ error: 'Shortcut returned an unexpected redirect. Retry later.' }, 502);
            }
            const headers = response.status === 429 ? { 'Retry-After': response.headers.get('Retry-After') || '2' } : {};
            await response.body?.cancel();
            return json({ error: upstreamError(response.status) }, response.status, headers);
          }
          // Stream large story lists; no workspace snapshots or shared server cache.
          return new Response(response.body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
        };
        const identity = async token => {
          const response = await upstream(token, '/member');
          if (!response.ok) return { response };
          const member = await response.json();
          return { member, cacheScope: await scopeFor(member, token, env.SESSION_SECRET) };
        };

        if (url.pathname === '/api/session' && request.method === 'DELETE') return json({ ok: true }, 200, { 'Set-Cookie': cookie('', secure, 0) });
        if (url.pathname === '/api/session' && request.method === 'POST') {
          if (!request.headers.get('Content-Type')?.startsWith('application/json')) return json({ error: 'Expected JSON.' }, 415);
          // Enforce a streaming limit even when Content-Length is absent.
          let size = 0;
          const chunks = [];
          if (request.body) {
            const reader = request.body.getReader();
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              size += value.byteLength;
              if (size > 8192) { await reader.cancel(); return json({ error: 'Request body is too large.' }, 413); }
              chunks.push(value);
            }
          }
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
          let body;
          try { body = JSON.parse(decoder.decode(bytes)); } catch { return json({ error: 'Invalid request body.' }, 400); }
          const token = body?.token;
          // ASCII and bounded so the encrypted cookie fits browser cookie limits.
          if (typeof token !== 'string' || !token.trim() || token.length > 2048 || /[^\x20-\x7e]/.test(token)) return json({ error: 'Enter a valid Shortcut API token.' }, 400);
          const result = await identity(token.trim());
          if (result.response) return result.response;
          const value = await seal({ token: token.trim(), cacheScope: result.cacheScope, expires: now() + TTL }, env.SESSION_SECRET);
          return json(result, 200, { 'Set-Cookie': cookie(value, secure) });
        }
        const value = request.headers.get('Cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith('fsn_session='))?.slice(12);
        const session = await open(value, env.SESSION_SECRET, now());
        if (url.pathname === '/api/session' && request.method === 'GET') {
          if (!session) return json({ member: null });
          const result = await identity(session.token);
          return result.response || json(result);
        }
        if (!session) return json({ error: 'Connect Shortcut to browse your workspace.' }, 401);
        if (url.pathname.startsWith('/api/shortcut/') && request.method === 'GET') {
          if (request.headers.get('X-Fsn-Scope') !== session.cacheScope) return json({ error: 'The connected workspace changed in another tab. Reconnect to continue.' }, 409);
          let path;
          try { path = allowedPath(url.pathname.slice('/api/shortcut/'.length), Object.fromEntries(url.searchParams)); } catch { path = null; }
          if (!path) return json({ error: 'Unsupported Shortcut read path.' }, 400);
          return upstream(session.token, path);
        }
        return json({ error: 'Only supported read operations are available.' }, 405);
      } catch {
        // Never include token-bearing request details or raw upstream errors.
        return json({ error: 'The proxy is unavailable. Check its session secret configuration and retry.' }, 503);
      }
    },
  };
}

export default createWorker();
