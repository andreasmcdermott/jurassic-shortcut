import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { directionalNeighbor, workspaceShortcut } from '../src/navigation.js';
import { World } from '../src/world.js';

const points = [
  { key: 'center', x: 0, y: 0 },
  { key: 'left', x: -1, y: 0 }, { key: 'right', x: 1, y: 0 },
  { key: 'up', x: 0, y: 1 }, { key: 'down', x: 0, y: -1 },
  { key: 'diagonal', x: .4, y: .5 },
];

test('arrow selection follows rows and columns, starts at center, and stops at edges', () => {
  for (const direction of ['Left', 'Right', 'Up', 'Down']) {
    assert.equal(directionalNeighbor(points, 'center', `Arrow${direction}`), direction.toLowerCase());
  }
  assert.equal(directionalNeighbor(points, null, 'ArrowRight'), 'center');
  assert.equal(directionalNeighbor(points, 'not-rendered', 'ArrowLeft'), 'center');
  assert.equal(directionalNeighbor(points, 'right', 'ArrowRight'), null);
  assert.equal(directionalNeighbor([], null, 'ArrowUp'), null);
});

test('selection uses camera orientation, filters behind-camera objects, and stays among candidates', () => {
  const world = Object.create(World.prototype);
  world.camera = new THREE.PerspectiveCamera(60, 2, .1, 100);
  world.camera.position.set(0, 0, 10); world.camera.lookAt(0, 0, 0);
  world.positions = new Map([
    ['center', new THREE.Vector3(0, 0, 0)],
    ['east', new THREE.Vector3(2, 0, 0)],
    ['north', new THREE.Vector3(0, 2, 0)],
    ['behind', new THREE.Vector3(-.01, 0, 11)],
    ['other-directory', new THREE.Vector3(.1, 0, 0)],
  ]);
  const keys = ['center', 'east', 'north', 'behind'];
  assert.equal(world.neighbor('center', 'ArrowRight', keys), 'east');
  world.camera.rotation.z = Math.PI / 2;
  assert.equal(world.neighbor('center', 'ArrowRight', keys), 'north');
  assert.equal(world.neighbor('center', 'ArrowLeft', keys), null);
});

test('object shortcuts leave typing, dialogs, sliders, and modified shortcuts alone', () => {
  const event = { key: 'ArrowRight', target: { closest: () => null } };
  assert.equal(workspaceShortcut(event), 'select');
  assert.equal(workspaceShortcut({ ...event, key: 'f' }), 'fly');
  assert.equal(workspaceShortcut({ ...event, key: 'F' }), 'fly');
  assert.equal(workspaceShortcut({ ...event, key: 'w' }), null);
  for (const flag of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey', 'defaultPrevented']) {
    assert.equal(workspaceShortcut({ ...event, [flag]: true }), null);
  }
  assert.equal(workspaceShortcut(event, true), null);
  assert.equal(workspaceShortcut({ ...event, target: { closest: () => ({ tagName: 'INPUT' }) } }), null);
});
