import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorker } from '../worker/index.js';

function fixture() {
  const calls = [];
  let clock = Date.now();
  const env = { SESSION_SECRET: 'ab'.repeat(32), ASSETS: { fetch: () => new Response('static') } };
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const token = options.headers['Shortcut-Token'];
    if (token === 'bad') return new Response('private upstream detail', { status: 401 });
    if (url.endsWith('/stories/302')) return new Response(null, { status: 302, headers: { Location: 'https://evil.example' } });
    if (url.endsWith('/stories/429')) return new Response('private upstream detail', { status: 429, headers: { 'Retry-After': '7' } });
    return Response.json(url.endsWith('/member') ? { id: 'member', workspace2: { id: 'workspace', name: 'Park' } } : [{ id: 1 }]);
  };
  let worker = createWorker({ fetchImpl, now: () => clock });
  const request = (path, { headers, ...options } = {}) => worker.fetch(new Request(`https://park.example${path}`, { ...options, headers: { 'X-Fsn-Client': '1', ...headers } }), env);
  const connect = token => request('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
  return { calls, env, request, connect, advance: ms => { clock += ms; }, restart: () => { worker = createWorker({ fetchImpl, now: () => clock }); } };
}
const cookieOf = response => response.headers.get('set-cookie').split(';')[0];

test('Worker uses encrypted expiring sessions that survive a fresh isolate', async () => {
  const f = fixture();
  const response = await f.connect('private-shortcut-token');
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.ok(data.cacheScope);
  assert.equal(JSON.stringify(data).includes('private-shortcut-token'), false);
  const cookie = cookieOf(response);
  assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Max-Age=28800; Secure/);
  assert.equal(cookie.includes('private-shortcut-token'), false);
  f.restart();
  const resumed = await f.request('/api/session', { headers: { Cookie: cookie } });
  assert.deepEqual(await resumed.json(), data);
  assert.equal((await (await f.connect('other-token')).json()).cacheScope === data.cacheScope, false);
  const tampered = cookie.slice(0, -8) + 'aaaaaaaa';
  assert.equal((await f.request('/api/shortcut/objectives', { headers: { Cookie: tampered } })).status, 401);
  f.advance(8 * 60 * 60 * 1000 + 1);
  assert.equal((await f.request('/api/shortcut/objectives', { headers: { Cookie: cookie } })).status, 401);
  assert.deepEqual(await (await f.request('/api/session', { headers: { Cookie: cookie } })).json(), { member: null });
});

test('Worker denies foreign origins, unknown routes and all upstream writes', async () => {
  const f = fixture();
  const connected = await f.connect('good');
  const headers = { Cookie: cookieOf(connected), 'X-Fsn-Scope': (await connected.json()).cacheScope };
  assert.equal((await f.request('/api/shortcut/objectives')).status, 401);
  assert.equal((await f.request('/api/shortcut/objectives', { headers: { ...headers, Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await f.request('/api/shortcut/objectives', { headers: { ...headers, 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await f.request('/api/shortcut/objectives', { headers: { ...headers, 'X-Fsn-Client': '' } })).status, 403);
  assert.equal((await f.request('/api/shortcut/objectives', { headers: { ...headers, 'X-Fsn-Scope': 'other-workspace' } })).status, 409);
  const before = f.calls.length;
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal((await f.request('/api/shortcut/stories/1', { method, headers })).status, 405);
  for (const path of ['stories/1/tasks', 'https://evil.example', 'epics/paginated?page=-1', 'search/stories?next=https://evil.example/api/v3/search/stories?next=x']) {
    assert.equal((await f.request(`/api/shortcut/${path}`, { headers })).status, 400);
  }
  assert.equal(f.calls.length, before);
  const ok = await f.request('/api/shortcut/objectives', { headers });
  assert.deepEqual(await ok.json(), [{ id: 1 }]);
  assert.equal(ok.headers.get('Cache-Control'), 'no-store');
  assert.equal(f.calls.at(-1).options.method, 'GET');
  assert.equal(f.calls.at(-1).options.redirect, 'manual');
  assert.equal(f.calls.at(-1).url, 'https://api.app.shortcut.com/api/v3/objectives');
});

test('Worker keeps auth and rate-limit errors useful without returning upstream bodies', async () => {
  const f = fixture();
  const bad = await f.connect('bad');
  assert.equal(bad.status, 401);
  assert.match((await bad.json()).error, /rejected/);
  const connected = await f.connect('good');
  const headers = { Cookie: cookieOf(connected), 'X-Fsn-Scope': (await connected.json()).cacheScope };
  const redirected = await f.request('/api/shortcut/stories/302', { headers });
  assert.equal(redirected.status, 502);
  assert.equal(redirected.headers.get('Location'), null);
  const limited = await f.request('/api/shortcut/stories/429', { headers });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('Retry-After'), '7');
  assert.equal((await limited.text()).includes('private upstream detail'), false);
  const disconnected = await f.request('/api/session', { method: 'DELETE', headers });
  assert.match(disconnected.headers.get('Set-Cookie'), /fsn_session=;.*Max-Age=0/);
  assert.equal((await f.connect('x'.repeat(2049))).status, 400);
  assert.equal((await f.connect('x'.repeat(9000))).status, 413);
  assert.equal((await f.request('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' })).status, 400);
  delete f.env.SESSION_SECRET;
  assert.equal((await f.connect('good')).status, 503);
  assert.equal(await (await f.request('/')).text(), 'static');
});
