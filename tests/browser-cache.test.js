import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { BrowserCache } from '../src/browser-cache.js';
import { Loader } from '../src/loader.js';

const createCaches = () => {
  const indexedDB = new IDBFactory();
  return scope => new BrowserCache(scope, { indexedDB });
};

test('IndexedDB persists responses across instances and isolates credential scopes', async () => {
  const make = createCaches();
  const first = make('credential-a');
  await first.initialize();
  await first.write('/objectives', [{ id: 1 }], first.generation);
  const second = make('credential-a');
  assert.deepEqual((await second.read('/objectives')).data, [{ id: 1 }]);
  assert.equal((await second.snapshot()).entries.length, 1);
  const other = make('credential-b');
  assert.equal(await other.read('/objectives'), null);
  await other.write('/objectives', [{ id: 2 }], other.generation);
  await first.clear();
  assert.equal(await make('credential-a').read('/objectives'), null);
  assert.deepEqual((await other.read('/objectives')).data, [{ id: 2 }]);
});

test('refresh prevents late responses in the same tab and another tab from restoring old data', async () => {
  const make = createCaches();
  const first = make('a'), otherTab = make('a');
  await first.initialize(); await otherTab.initialize();
  const beforeRefresh = first.generation;
  await first.clear();
  assert.equal(await first.write('/objectives', [{ id: 1 }], beforeRefresh), null);
  assert.equal(await otherTab.write('/objectives', [{ id: 1 }], otherTab.generation), null);
  assert.equal((await first.snapshot()).entries.length, 0);
  await first.write('/objectives', [{ id: 2 }], first.generation);
  assert.deepEqual((await make('a').read('/objectives')).data, [{ id: 2 }]);
});

test('blocked storage degrades to network loading', async t => {
  const cache = new BrowserCache('a', { indexedDB: null });
  assert.equal((await cache.snapshot()).enabled, false);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json([{ id: 1 }]); });
  const states = [];
  const loader = new Loader({}, () => {}, () => {}, info => states.push(info.state), cache);
  assert.deepEqual(await loader.get('objectives'), [{ id: 1 }]);
  assert.deepEqual(await loader.get('objectives'), [{ id: 1 }]);
  assert.equal(calls, 2);
  assert.ok(states.includes('unavailable'));
});

test('browser loader restores tasks and unassigned stories and only fetches missing data', async t => {
  const make = createCaches();
  const cache = make('a');
  await cache.initialize();
  const saved = [
    ['/epics/paginated?page=1', { data: [{ id: 2 }], next: null }],
    ['/epics/2/stories', [{ id: 10, epic_id: 2 }]],
    ['/stories/10', { id: 10, epic_id: 2, tasks: [{ id: 100, description: 'Inspect' }] }],
    ['/search/stories', { data: [{ id: 20, name: 'Unassigned' }], next: null }],
  ];
  for (const [path, data] of saved) await cache.write(path, data, cache.generation);
  const calls = [];
  t.mock.method(globalThis, 'fetch', async path => { calls.push(path); return Response.json([]); });
  const loader = new Loader({}, () => {}, () => {}, () => {}, make('a'));
  await loader.restoreCache();
  assert.equal(loader.ws.get('task:100').name, 'Inspect');
  assert.equal(loader.ws.get('story:20').name, 'Unassigned');
  await loader.hydrate('epic:2'); await loader.hydrate('story:10');
  await loader.loadEpics(); await loader.loadOrphans();
  assert.equal(calls.length, 0);
  await loader.get('objectives');
  assert.deepEqual(calls, ['/api/shortcut/objectives']);
  await loader.get('objectives');
  assert.equal(calls.length, 1);
});

test('stopped browser loader does not save a late upstream response', async t => {
  const cache = createCaches()('a');
  let resolve, started;
  const ready = new Promise(r => { started = r; });
  t.mock.method(globalThis, 'fetch', () => new Promise(r => { resolve = r; started(); }));
  const loader = new Loader({}, () => {}, () => {}, () => {}, cache);
  const pending = loader.get('objectives');
  await ready;
  loader.stop(); resolve(Response.json([{ id: 1 }]));
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal((await cache.snapshot()).entries.length, 0);
});
