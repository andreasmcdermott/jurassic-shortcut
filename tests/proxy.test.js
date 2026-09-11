import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createShortcutRouter, allowedPath } from '../server/shortcut.js';
import { ResponseCache } from '../server/cache.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('proxy permits only known read paths and keeps pagination on Shortcut', () => {
  assert.equal(allowedPath('stories/123'), '/stories/123');
  assert.equal(allowedPath('epics/10/stories'), '/epics/10/stories');
  assert.equal(allowedPath('epics/paginated', { page: -1 }), null);
  assert.equal(allowedPath('stories/123/tasks'), null);
  assert.equal(allowedPath('https://example.com'), null);
  assert.equal(allowedPath('search/stories', { next: 'https://example.com/api/v3/search/stories?next=secret' }), null);
  const path = allowedPath('search/stories', { next: '/api/v3/search/stories?query=changed&next=abc%2Bdef' });
  const parsed = new URL(path, 'https://api.app.shortcut.com');
  assert.equal(parsed.searchParams.get('query'), '!has:epic');
  assert.equal(parsed.searchParams.get('next'), 'abc+def');
});

test('sessions keep tokens server-side, reject writes and foreign origins, and disconnect', async t => {
  const calls = [];
  const app = express();
  app.use('/api', createShortcutRouter({ requestInterval: 0, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (options.headers['Shortcut-Token'] === 'bad') return new Response('{}', { status: 401 });
    return Response.json(url.endsWith('/member') ? { workspace2: { name: 'Test park' } } : [{ id: 1 }]);
  } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = token => fetch(`${base}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Fsn-Client': '1' }, body: JSON.stringify({ token }) });
  assert.equal((await fetch(`${base}/api/shortcut/objectives`)).status, 401);
  assert.equal((await post('bad')).status, 401);
  const session = await post('test-token-never-returned');
  const cookie = session.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
  assert.equal(JSON.stringify(await session.json()).includes('test-token'), false);
  const headers = { Cookie: cookie.split(';')[0] };
  assert.equal((await fetch(`${base}/api/shortcut/objectives`, { headers })).status, 200);
  assert.equal(calls.at(-1).options.headers['Shortcut-Token'], 'test-token-never-returned');
  assert.equal((await fetch(`${base}/api/shortcut/objectives`, { method: 'POST', headers })).status, 405);
  assert.equal((await fetch(`${base}/api/shortcut/objectives`, { headers: { ...headers, Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(`${base}/api/session`, { method: 'DELETE', headers: { ...headers, 'X-Fsn-Client': '1' } })).status, 200);
  assert.equal((await fetch(`${base}/api/shortcut/objectives`, { headers })).status, 401);
});

test('authenticated cache restores after server restart without refetching data, and refresh fetches fresh data', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'fsn-proxy-cache-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const calls = [];
  const start = async () => {
    const app = express();
    app.use('/api', createShortcutRouter({ requestInterval: 0, cache: new ResponseCache(directory), fetchImpl: async url => {
      calls.push(url);
      return Response.json(url.endsWith('/member') ? { id: 'ray', workspace2: { id: 'park', name: 'Park' } } : [{ id: calls.length }]);
    } }));
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    t.after(() => server.close());
    return { server, base: `http://127.0.0.1:${server.address().port}` };
  };
  const connect = async base => {
    const response = await fetch(`${base}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Fsn-Client': '1' }, body: JSON.stringify({ token: 'local-test-token' }) });
    assert.equal(response.status, 200);
    return { Cookie: response.headers.get('set-cookie').split(';')[0] };
  };
  const first = await start(); const firstHeaders = await connect(first.base);
  const firstData = await (await fetch(`${first.base}/api/shortcut/objectives`, { headers: firstHeaders })).json();
  await new Promise(resolve => first.server.close(resolve));
  const second = await start();
  assert.equal((await fetch(`${second.base}/api/cache`, { headers: firstHeaders })).status, 401);
  const headers = await connect(second.base);
  const callCount = calls.length;
  const snapshot = await (await fetch(`${second.base}/api/cache`, { headers })).json();
  assert.equal(snapshot.entries.length, 1);
  const cachedResponse = await fetch(`${second.base}/api/shortcut/objectives`, { headers });
  assert.equal(cachedResponse.headers.get('X-Fsn-Cache'), 'hit');
  assert.deepEqual(await cachedResponse.json(), firstData);
  assert.equal(calls.length, callCount);
  assert.equal((await fetch(`${second.base}/api/cache`, { method: 'DELETE', headers })).status, 403);
  assert.equal((await fetch(`${second.base}/api/cache`, { method: 'DELETE', headers: { ...headers, 'X-Fsn-Client': '1', Origin: 'https://elsewhere.example' } })).status, 403);
  assert.equal((await fetch(`${second.base}/api/cache`, { method: 'DELETE', headers: { ...headers, 'X-Fsn-Client': '1' } })).status, 200);
  const fresh = await (await fetch(`${second.base}/api/shortcut/objectives`, { headers })).json();
  assert.notDeepEqual(fresh, firstData);
  assert.equal(calls.length, callCount + 1);
});
