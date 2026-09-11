import test from 'node:test';
import assert from 'node:assert/strict';
import { fitTerminal, changeTerminal } from '../src/terminal-window.js';

const viewport = { width: 1200, height: 800 };
const rect = { x: 200, y: 100, width: 700, height: 520 };

test('moving preserves size and keeps the entire terminal within the viewport', () => {
  assert.deepEqual(changeTerminal(rect, 'move', 40, 60, viewport), { ...rect, x: 240, y: 160 });
  assert.deepEqual(changeTerminal(rect, 'move', -1000, -1000, viewport), { ...rect, x: 8, y: 8 });
  assert.deepEqual(changeTerminal(rect, 'move', 1000, 1000, viewport), { ...rect, x: 492, y: 272 });
});

test('resizing keeps the corner anchored and enforces minimum and available sizes', () => {
  assert.deepEqual(changeTerminal(rect, 'resize', 100, 80, viewport), { ...rect, width: 800, height: 600 });
  assert.deepEqual(changeTerminal(rect, 'resize', -1000, -1000, viewport), { ...rect, width: 320, height: 300 });
  assert.deepEqual(changeTerminal(rect, 'resize', 2000, 2000, viewport), { ...rect, width: 992, height: 692 });
});

test('a smaller viewport brings a moved or oversized terminal back within reach', () => {
  const fitted = fitTerminal({ x: 950, y: 600, width: 900, height: 700 }, { width: 360, height: 640 });
  assert.deepEqual(fitted, { x: 8, y: 8, width: 344, height: 624 });
  assert.deepEqual(fitTerminal(rect, { width: 280, height: 240 }), { x: 8, y: 8, width: 264, height: 224 });
});
