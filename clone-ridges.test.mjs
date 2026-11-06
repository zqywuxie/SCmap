import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneDistributions, ridgeDensity } from './src/clone-ridges.js';

test('clone-size distributions keep sample-local reference sizes across subtypes and weight choices', () => {
  const attributes = new Uint16Array([0, 0, 1, 1, 0]);
  const units = new Uint32Array([1, 1, 1, 2, 0]);
  const sizes = new Uint32Array([3, 3, 3, 1, 0]);
  const subtypes = [{ code: 0 }, { code: 1 }];
  const cells = cloneDistributions(attributes, [0, 1, 2, 3, 4], 1, 0, units, sizes, subtypes, 'cells');
  const clones = cloneDistributions(attributes, [0, 1, 2, 3, 4], 1, 0, units, sizes, subtypes, 'units');
  assert.equal(cells.excluded, 1);
  assert.equal(cells.groups[0].histogram.get(3), 2);
  assert.equal(clones.groups[0].histogram.get(3), 1);
  assert.equal(clones.groups[1].histogram.get(3), 1);
  assert.equal(clones.groups[1].histogram.get(1), 1);
  assert.equal(cells.groups[1].expanded, 1);
  const subset = cloneDistributions(attributes, [0], 1, 0, units, sizes, subtypes, 'cells');
  assert.equal(subset.groups[0].histogram.get(3), 1);
});

test('log-space ridge handles singleton-only and empty distributions without invalid coordinates', () => {
  const singleton = ridgeDensity(new Map([[1, 20]]), 3, 0.18);
  assert.equal(singleton[0].y, 1);
  assert(singleton.every(point => Number.isFinite(point.y) && point.y >= 0 && point.y <= 1));
  assert(ridgeDensity(new Map(), 3, 0.18).every(point => point.y === 0));
});
