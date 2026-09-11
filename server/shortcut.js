import express from 'express';
import { randomBytes } from 'node:crypto';
import { cacheScope } from './cache.js';

const API = 'https://api.app.shortcut.com/api/v3';
const SESSION_TTL = 8 * 60 * 60 * 1000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export { allowedPath } from '../shared/shortcut-path.js';
import { allowedPath } from '../shared/shortcut-path.js';

export function createShortcutRouter({ fetchImpl = fetch, requestInterval = 350, cache = null } = {}) {
  const router = express.Router();
  const sessions = new Map();
  let gate = Promise.resolve();
  const upstream = async (token, path) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const wait = gate;
      gate = gate.then(() => sleep(requestInterval));
      await wait;
      let response;
      try { response = await fetchImpl(`${API}${path}`, { headers: { 'Shortcut-Token': token, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000), redirect: 'error' }); }
      catch { const error = new Error('Could not reach Shortcut. Check your connection and retry.'); error.status = 502; throw error; }
      if (response.status === 429 && attempt < 2) { await sleep(Math.min(15000, Math.max(1000, Number(response.headers.get('retry-after') || 2) * 1000))); continue; }
      if (!response.ok) {
        const messages = { 401: 'Shortcut rejected this token. Check the token and reconnect.', 403: 'This token does not have access to this Shortcut resource.', 404: 'This object is no longer available in Shortcut.', 429: 'Shortcut is rate limiting requests. Wait a moment, then retry.' };
        const error = new Error(messages[response.status] || `Shortcut returned an error (${response.status}). Retry loading this directory.`); error.status = response.status; throw error;
      }
      return response.json();
    }
  };
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const host = req.headers.host || '';
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) return res.status(403).json({ error: 'Use the local loopback address to access this server.' });
    if (req.headers.origin && req.headers.origin !== `http://${host}`) return res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
    if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Cross-site requests are not allowed.' });
    for (const [id, session] of sessions) if (session.expires < Date.now()) sessions.delete(id);
    const sid = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('fsn_session='))?.slice(12);
    req.shortcutSession = sessions.get(sid); req.shortcutSessionId = sid;
    next();
  });
  router.use(express.json({ limit: '8kb' }));
  router.post('/session', async (req, res, next) => {
    try {
      if (req.headers['x-fsn-client'] !== '1') return res.status(403).json({ error: 'Missing local client header.' });
      const token = req.body?.token;
      if (typeof token !== 'string' || !token.trim() || token.length > 4096 || /[\r\n]/.test(token)) return res.status(400).json({ error: 'Enter a valid Shortcut API token.' });
      const member = await upstream(token.trim(), '/member');
      if (req.shortcutSessionId) sessions.delete(req.shortcutSessionId);
      if (sessions.size >= 8) sessions.delete(sessions.keys().next().value);
      const id = randomBytes(32).toString('hex');
      sessions.set(id, { token: token.trim(), member, cacheScope: cacheScope(member, token.trim()), expires: Date.now() + SESSION_TTL });
      res.cookie('fsn_session', id, { httpOnly: true, sameSite: 'strict', path: '/api', maxAge: SESSION_TTL });
      res.json({ member });
    } catch (error) { next(error); }
  });
  router.get('/session', (req, res) => res.json({ member: req.shortcutSession?.member || null }));
  router.delete('/session', (req, res) => {
    if (req.headers['x-fsn-client'] !== '1') return res.status(403).json({ error: 'Missing local client header.' });
    sessions.delete(req.shortcutSessionId); res.clearCookie('fsn_session', { path: '/api' }); res.json({ ok: true });
  });
  router.get('/cache', async (req, res, next) => {
    try {
      if (!req.shortcutSession) return res.status(401).json({ error: 'Connect to Shortcut to restore cached data.' });
      const scope = req.shortcutSession.cacheScope;
      const entries = cache && scope ? await cache.snapshot(scope) : [];
      res.json({ entries, enabled: !!(cache && scope), lastSavedAt: entries.reduce((latest, entry) => Math.max(latest, entry.savedAt), 0) || null });
    } catch { res.status(503).json({ error: 'Could not read the local cache. Live loading is still available.' }); }
  });
  router.delete('/cache', async (req, res, next) => {
    try {
      if (!req.shortcutSession) return res.status(401).json({ error: 'Connect to Shortcut to refresh cached data.' });
      if (req.headers['x-fsn-client'] !== '1') return res.status(403).json({ error: 'Missing local client header.' });
      if (cache && req.shortcutSession.cacheScope) await cache.clear(req.shortcutSession.cacheScope);
      res.json({ ok: true });
    } catch { res.status(503).json({ error: 'Could not clear the local cache. Check folder permissions and retry.' }); }
  });
  router.get('/shortcut/*path', async (req, res, next) => {
    try {
      if (!req.shortcutSession) return res.status(401).json({ error: 'Connect to Shortcut to start a session.' });
      const target = allowedPath(req.params.path.join('/'), req.query);
      if (!target) return res.status(400).json({ error: 'This read-only API route is not supported.' });
      const scope = req.shortcutSession.cacheScope;
      const useCache = cache && scope && target !== '/member';
      const generation = useCache ? cache.generation(scope) : null;
      if (useCache) {
        const cached = await cache.get(scope, target);
        if (cached) {
          res.set('X-Fsn-Cache', 'hit'); res.set('X-Fsn-Cache-Saved-At', String(cached.savedAt));
          return res.json(cached.data);
        }
      }
      const data = await upstream(req.shortcutSession.token, target);
      if (useCache) {
        try {
          const saved = await cache.set(scope, target, data, generation);
          if (saved) { res.set('X-Fsn-Cache', 'saved'); res.set('X-Fsn-Cache-Saved-At', String(saved.savedAt)); }
        } catch { res.set('X-Fsn-Cache', 'unavailable'); }
      }
      res.json(data);
    } catch (error) { next(error); }
  });
  router.use((_req, res) => res.status(405).json({ error: 'Only supported read operations are available.' }));
  router.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.type === 'entity.parse.failed' ? 'Invalid request body.' : error.message || 'Local proxy error.' }));
  return router;
}
