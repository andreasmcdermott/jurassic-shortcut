import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { ResponseCache, cacheScope } from '../server/cache.js';

test('cache survives process instances, isolates access, and stores no credentials', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'fsn-cache-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const member = { id: 'member-a', workspace2: { id: 'park-a' } };
  const token = 'secret-test-token-do-not-store';
  const scope = cacheScope(member, token);
  const cache = new ResponseCache(directory);
  await cache.set(scope, '/objectives', [{ id: 1, name: 'Containment' }], cache.generation(scope));
  const restarted = new ResponseCache(directory);
  assert.deepEqual((await restarted.get(scope, '/objectives')).data, [{ id: 1, name: 'Containment' }]);
  for (const other of [cacheScope(member, 'different-token'), cacheScope({ ...member, id: 'member-b' }, token), cacheScope({ ...member, workspace2: { id: 'park-b' } }, token)]) {
    assert.deepEqual(await restarted.snapshot(other), []);
  }
  assert.equal(cacheScope({}, token), null);
  const file = path.join(directory, scope, (await readdir(path.join(directory, scope)))[0]);
  assert.equal(gunzipSync(await readFile(file)).toString().includes(token), false);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await stat(path.join(directory, scope))).mode & 0o777, 0o700);
});

test('corrupt cache entries become misses and refresh blocks stale in-flight writes', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'fsn-cache-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cache = new ResponseCache(directory), scope = 'a'.repeat(64);
  const generation = cache.generation(scope);
  await cache.set(scope, '/objectives', [], generation);
  const filename = path.join(directory, scope, (await readdir(path.join(directory, scope)))[0]);
  await writeFile(filename, 'interrupted or corrupt file');
  assert.equal(await cache.get(scope, '/objectives'), null);
  assert.deepEqual(await cache.snapshot(scope), []);
  await cache.set(scope, '/objectives', [{ id: 1 }], generation);
  const oldWrite = cache.set(scope, '/stories/1', { id: 1 }, generation);
  await cache.clear(scope); await oldWrite;
  assert.equal(await cache.set(scope, '/objectives', [{ id: 'stale' }], generation), null);
  assert.deepEqual(await cache.snapshot(scope), []);
  await cache.set(scope, '/objectives', [{ id: 'fresh' }], cache.generation(scope));
  assert.deepEqual((await cache.get(scope, '/objectives')).data, [{ id: 'fresh' }]);
});
