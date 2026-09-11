import test from 'node:test';
import assert from 'node:assert/strict';
import { Loader } from '../src/loader.js';

test('background epic loading deduplicates on-demand requests and lazily expands story tasks', async () => {
  const loader = new Loader({ workspace2: { name: 'Park' } }, () => {}, () => {});
  loader.ws.upsert('epic', { id: 1, name: 'Security' }); loader.ws.rebuild();
  const calls = [];
  loader.get = async path => {
    calls.push(path); await new Promise(resolve => setTimeout(resolve, 5));
    return path.startsWith('epics/') ? [{ id: 2, epic_id: 1, name: 'Fence' }] : { id: 2, epic_id: 1, name: 'Fence', tasks: [{ id: 3, description: 'Power test', complete: true }] };
  };
  await Promise.all([loader.hydrate('epic:1'), loader.hydrate('epic:1')]);
  assert.equal(calls.length, 1); assert.equal(loader.ws.children('epic:1').length, 1);
  assert.equal(loader.ws.get('story:2').loaded, undefined);
  await loader.hydrate('story:2');
  assert.equal(loader.ws.children('story:2')[0].name, 'Power test');
  assert.equal(loader.ws.get('task:3').complete, true);
});

test('failed directories can be retried and stopped loaders ignore late responses', async () => {
  const loader = new Loader({}, () => {}, () => {});
  loader.ws.upsert('epic', { id: 1 });
  loader.get = async () => { throw new Error('offline'); };
  await loader.hydrate('epic:1'); assert.equal(loader.ws.get('epic:1').loadError, 'offline');
  loader.get = async () => [];
  await loader.hydrate('epic:1'); assert.equal(loader.ws.get('epic:1').loaded, true);
  loader.ws.upsert('epic', { id: 2 });
  let resolve;
  loader.get = () => new Promise(r => { resolve = r; });
  const pending = loader.hydrate('epic:2'); loader.stop(); resolve([{ id: 10, epic_id: 2 }]); await pending;
  assert.equal(loader.ws.get('story:10'), undefined);
});

test('epic pagination and unassigned search cursor are followed without exceeding 1,000 results', async () => {
  const loader = new Loader({}, () => {}, () => {}); const calls = [];
  loader.get = async path => {
    calls.push(path);
    if (path.includes('epics/')) return path.endsWith('page=1') ? { data: [{ id: 1 }], next: 2 } : { data: [{ id: 2 }], next: null };
    const page = calls.filter(p => p.startsWith('search')).length;
    return { data: Array.from({ length: 250 }, (_, i) => ({ id: page * 250 + i })), next: `/api/v3/search/stories?next=page${page + 1}`, total: 1200 };
  };
  await loader.loadEpics(); assert.equal(loader.ws.counts().epic, 2);
  await loader.loadOrphans(); assert.equal(loader.ws.counts().story, 1000); assert.equal(loader.orphanLimit, true);
  assert.equal(calls.filter(p => p.startsWith('search')).length, 4);
});

test('cached hierarchy and full story tasks restore before loading only missing directories', async () => {
  const loader = new Loader({}, () => {}, () => {});
  const entry = (path, data) => ({ path, data, savedAt: 100 });
  // Deliberately unordered: summaries must not overwrite cached full story details.
  loader.restore([
    entry('/stories/10', { id: 10, epic_id: 2, name: 'Full story', description: 'Already read', tasks: [{ id: 100, description: 'Inspect', complete: true }] }),
    entry('/epics/2/stories', [{ id: 10, epic_id: 2, name: 'Slim story', task_ids: [100] }]),
    entry('/objectives', [{ id: 1, name: 'Park operations' }]),
    entry('/epics/paginated?page=1', { data: [{ id: 2, objective_ids: [1] }, { id: 3, objective_ids: [1] }], next: null }),
    entry('/workflows', [{ states: [{ id: 5, name: 'Testing', type: 'started' }] }]),
    entry('/members', [{ id: 'ray', profile: { name: 'Ray Arnold' } }]),
  ]);
  assert.deepEqual(loader.ws.path('task:100').map(node => node.kind), ['workspace', 'objective', 'epic', 'story', 'task']);
  assert.equal(loader.ws.get('story:10').name, 'Full story');
  assert.equal(loader.ws.get('epic:2').loaded, true);
  assert.equal(loader.ws.states.get(5).type, 'started');
  assert.equal(loader.ws.members.get('ray'), 'Ray Arnold');
  const requests = [];
  loader.get = async path => { requests.push(path); return []; };
  await loader.hydrate('epic:2'); await loader.hydrate('story:10'); await loader.hydrate('epic:3');
  assert.deepEqual(requests, ['epics/3/stories']);
  // Replaying cached metadata must keep restored epic directories loaded.
  loader.get = async () => ({ data: [{ id: 2, objective_ids: [1] }], next: null });
  await loader.loadEpics();
  assert.equal(loader.ws.get('epic:2').loaded, true);
});
