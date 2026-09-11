import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/world.js';
import { createDemo, Workspace, ANTENNA_STATUSES } from '../src/data.js';

test('3D directory blocks can be ray-picked back to the correct Shortcut object', () => {
  const oldDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ fillText() {} }) }) };
  try {
    const world = Object.create(World.prototype);
    Object.assign(world, { content: new THREE.Group(), picks: [], positions: new Map(), beam: new THREE.Group(), miniCamera: new THREE.OrthographicCamera(), home() {} });
    const ws = createDemo(); const epic = ws.get('epic:100');
    world.setDirectory(ws, epic, ws.children(epic.key)); world.content.updateMatrixWorld(true);
    const node = ws.children(epic.key)[0]; const pos = world.positions.get(node.key);
    const ray = new THREE.Raycaster(new THREE.Vector3(pos.x, 100, pos.z), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObjects(world.picks)[0];
    assert.equal(hit.object.userData.keys[hit.instanceId], node.key);
    assert.equal(world.positions.size, 9);
    assert.ok(world.picks.length <= 7, 'colored blocks are instanced by age instead of one draw call per block');
    world.select(node.key);
    const next = ws.children(epic.key)[1]; world.select(next.key);
    const transition = world.beamTransition;
    world.updateSpotlight(transition.start + 160);
    const midpoint = world.beam.position.clone();
    world.setDirectory(ws, epic, ws.children(epic.key), false);
    world.select(next.key);
    assert.equal(world.beamTransition, transition, 'background loading must not restart or snap the selection');
    assert.ok(world.beam.position.equals(midpoint));
    world.clear(); assert.equal(world.content.children.length, 0);
    assert.equal(world.beamTransition, null);
    assert.equal(world.beam.visible, false);
  } finally { globalThis.document = oldDocument; }
});

test('spotlight glides, retargets from its current position, and respects reduced motion', () => {
  const world = Object.create(World.prototype);
  Object.assign(world, {
    beam: new THREE.Group(), reducedMotion: { matches: false },
    positions: new Map([['a', new THREE.Vector3(10, 2.5, 0)], ['b', new THREE.Vector3(30, 2.5, 0)], ['c', new THREE.Vector3(20, 1.4, 10)]]),
  });
  world.beam.visible = false;
  world.select('a');
  assert.ok(world.beam.position.equals(world.positions.get('a')));
  assert.equal(world.beamTransition, null);
  world.select('b');
  assert.equal(world.beam.position.x, 10, 'new selection must not jump to its destination');
  world.updateSpotlight(world.beamTransition.start + 160);
  assert.ok(Math.abs(world.beam.position.x - 20) < 1e-9);
  const midway = world.beam.position.clone();
  world.select('c');
  assert.ok(world.beamTransition.from.equals(midway));
  world.updateSpotlight(world.beamTransition.start + 321);
  assert.ok(world.beam.position.equals(world.positions.get('c')));
  assert.equal(world.beamTransition, null);
  world.reducedMotion.matches = true;
  world.select('b');
  assert.ok(world.beam.position.equals(world.positions.get('b')));
  assert.equal(world.beamTransition, null);
  world.select('not-rendered');
  assert.equal(world.beam.visible, false);
});

test('antenna geometry reflects status ratios and zero counts leave no colored pole', () => {
  const oldDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => ({ fillText() {} }) }) };
  try {
    const world = Object.create(World.prototype);
    Object.assign(world, { content: new THREE.Group(), picks: [], positions: new Map(), beam: { visible: false }, miniCamera: new THREE.OrthographicCamera(), home() {} });
    const ws = new Workspace();
    ws.upsert('objective', { id: 1 });
    ['to do', 'in progress', 'in progress', 'done'].forEach((state, id) => ws.upsert('epic', { id, objective_ids: [1], state }));
    ws.rebuild();
    world.setDirectory(ws, ws.root, ws.children('root'));
    const heights = ANTENNA_STATUSES.map(({ color }) => {
      const pole = world.picks.find(mesh => mesh.material.color.getHexString() === color.slice(1));
      const matrix = new THREE.Matrix4(); pole.getMatrixAt(0, matrix);
      return new THREE.Vector3().setFromMatrixScale(matrix).y;
    });
    assert.deepEqual(heights, [11.5, 23, 11.5]);
    ws.upsert('epic', { id: 0, state: 'done' }); ws.rebuild();
    world.setDirectory(ws, ws.root, ws.children('root'));
    assert.equal(world.picks.some(mesh => mesh.material.color.getHexString() === ANTENNA_STATUSES[0].color.slice(1)), false);
    world.clear();
  } finally { globalThis.document = oldDocument; }
});

test('clicking a shared epic selects that visible copy through animation, fly-to, and background relayout', () => {
  const oldDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => ({ fillText() {} }) }) };
  try {
    const world = Object.create(World.prototype);
    Object.assign(world, {
      content: new THREE.Group(), picks: [], positions: new Map(), beam: new THREE.Group(),
      miniCamera: new THREE.OrthographicCamera(), camera: new THREE.PerspectiveCamera(60, 2, .1, 1000),
      ray: new THREE.Raycaster(), pointer: new THREE.Vector2(),
      renderer: { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 500 }) } },
      home() {}, fly(_position, target) { this.flownTo = target.clone(); },
    });
    world.camera.position.set(0, 150, 100); world.camera.lookAt(0, 0, 0); world.camera.updateMatrixWorld();
    const ws = new Workspace();
    ws.upsert('objective', { id: 1 }); ws.upsert('objective', { id: 2 });
    ws.upsert('epic', { id: 10, objective_ids: [1, 2] });
    ws.upsert('epic', { id: 11, objective_ids: [1, 2] }); ws.rebuild();
    world.setDirectory(ws, ws.root, ws.children('root')); world.content.updateMatrixWorld(true);
    const clickCopy = (key, occurrenceId) => {
      const position = world.occurrences.get(occurrenceId).position;
      const projected = position.clone().project(world.camera);
      const hit = world.pick({ clientX: (projected.x + 1) * 500, clientY: (1 - projected.y) * 250 });
      assert.deepEqual(hit, { key, occurrenceId });
      world.select(hit.key, false, hit.occurrenceId);
      if (world.beamTransition) world.updateSpotlight(world.beamTransition.start + 321);
      assert.ok(world.beam.position.distanceTo(position) < 1e-9);
    };
    clickCopy('epic:10', 'objective:1/epic:10');
    clickCopy('epic:10', 'objective:2/epic:10');
    world.select('epic:10'); world.select('epic:10', true);
    assert.ok(world.flownTo.equals(world.occurrences.get('objective:2/epic:10').position));
    // Keyboard/programmatic sibling selection keeps the same objective context.
    world.select('epic:11');
    assert.equal(world.selectedOccurrence.id, 'objective:2/epic:11');
    // A new objective changes the grid coordinates without changing the clicked copy.
    ws.upsert('objective', { id: 3 }); ws.rebuild();
    world.setDirectory(ws, ws.root, ws.children('root'), false); world.select('epic:11');
    if (world.beamTransition) world.updateSpotlight(world.beamTransition.start + 321);
    assert.equal(world.selectedOccurrence.id, 'objective:2/epic:11');
    assert.ok(world.beam.position.distanceTo(world.occurrences.get('objective:2/epic:11').position) < 1e-9);
    world.clear();
  } finally { globalThis.document = oldDocument; }
});
