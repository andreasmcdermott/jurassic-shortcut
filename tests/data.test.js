import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace, createDemo, ageColor, AGE_COLORS } from '../src/data.js';

test('demo is a complete traversable objective → epic → story → task hierarchy', () => {
  const ws = createDemo();
  assert.deepEqual(ws.counts(), { objective: 4, epic: 16, story: 144, task: 432 });
  const objective = ws.children('root')[0];
  const epic = ws.children(objective.key)[0];
  const story = ws.children(epic.key)[0];
  const task = ws.children(story.key)[0];
  assert.deepEqual(ws.path(task.key).map(n => n.kind), ['workspace', 'objective', 'epic', 'story', 'task']);
});

test('multiple objectives, legacy milestone relationships, and orphans survive incremental loading', () => {
  const ws = new Workspace();
  ws.upsert('story', { id: 3, epic_id: 2, name: 'Arrives first' }); ws.rebuild();
  assert.equal(ws.children('loose-stories').length, 1);
  ws.upsert('objective', { id: 10, name: 'A' }); ws.upsert('objective', { id: 11, name: 'B' });
  ws.upsert('epic', { id: 2, objective_ids: [10, 11] }); ws.rebuild(); ws.rebuild();
  assert.equal(ws.get('loose-stories'), undefined);
  assert.deepEqual(ws.get('epic:2').parents, ['objective:10', 'objective:11']);
  assert.deepEqual(ws.get('story:3').parents, ['epic:2']);
  assert.equal(ws.children('objective:10').length, 1);
  ws.upsert('epic', { id: 4, milestone_id: 10 }); ws.rebuild();
  assert.equal(ws.children('objective:10').length, 2);
  ws.upsert('story', { id: 3, description: 'Full story', loaded: true }); ws.rebuild();
  assert.equal(ws.get('story:3').epic_id, 2);
});

test('age colors follow the legend thresholds', () => {
  assert.equal(ageColor(new Date(Date.now() - 86400000)), AGE_COLORS[0]);
  assert.equal(ageColor(new Date(Date.now() - 60 * 86400000)), AGE_COLORS[3]);
  assert.equal(ageColor(new Date(Date.now() - 500 * 86400000)), AGE_COLORS[6]);
});

test('antennas count all direct active children and use workflow types for custom status names', () => {
  const ws = new Workspace();
  ws.upsert('objective', { id: 1 });
  ws.upsert('epic', { id: 2, objective_ids: [1], state: 'in progress', loaded: true });
  ws.upsert('epic', { id: 3, objective_ids: [1], state: 'to do' });
  ws.upsert('epic', { id: 4, objective_ids: [1], state: 'done' });
  ws.states.set(8, { type: 'started', name: 'With the raptor wranglers' });
  ws.states.set(9, { type: 'done', name: 'Released into the wild' });
  for (let id = 0; id < 70; id++) ws.upsert('story', { id, epic_id: 2, started: false, completed: false });
  ws.upsert('story', { id: 100, epic_id: 2, workflow_state_id: 8, started: false });
  ws.upsert('story', { id: 101, epic_id: 2, workflow_state_id: 9 });
  ws.upsert('story', { id: 102, epic_id: 2, completed: true, started: true });
  ws.upsert('story', { id: 103, epic_id: 2, completed: true, archived: true });
  ws.upsert('story', { id: 104, epic_id: 2 });
  ws.rebuild();
  assert.deepEqual(ws.antennaSummary('objective:1').counts, { unstarted: 1, started: 1, completed: 1, unknown: 0 });
  assert.deepEqual(ws.antennaSummary('epic:2'), {
    counts: { unstarted: 70, started: 1, completed: 2, unknown: 1 }, total: 74, partial: false, unit: 'stories',
  });
});

test('unloaded directories stay partial and task completion appears after hydration', () => {
  const ws = new Workspace();
  ws.upsert('story', { id: 1 }); ws.rebuild();
  assert.equal(ws.antennaSummary('story:1').partial, true);
  assert.equal(ws.antennaSummary('story:1').total, 0);
  ws.upsert('task', { id: 2, story_id: 1, complete: false });
  ws.upsert('task', { id: 3, story_id: 1, complete: true });
  ws.upsert('story', { id: 1, loaded: true }); ws.rebuild();
  assert.deepEqual(ws.antennaSummary('story:1'), {
    counts: { unstarted: 1, started: 0, completed: 1, unknown: 0 }, total: 2, partial: false, unit: 'tasks',
  });
});
