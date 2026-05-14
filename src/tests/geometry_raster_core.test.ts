import assert from 'node:assert/strict';
import {
  create_raster2,
  raster2_get,
  raster2_in_bounds,
  raster2_index,
  raster2_set,
} from '../shared/geometry/raster2.js';
import {
  create_raster3,
  raster3_get,
  raster3_in_bounds,
  raster3_index,
  raster3_set,
} from '../shared/geometry/raster3.js';

function test_raster2_core(): void {
  const raster = create_raster2({
    origin: { x: 10.8, y: -2.2 },
    width: 3.9,
    height: 2.4,
    fill: '.',
  });

  assert.deepEqual(raster.origin, { x: 10, y: -2 });
  assert.equal(raster.width, 3);
  assert.equal(raster.height, 2);
  assert.equal(raster.data.length, 6);

  assert.equal(raster2_index(raster, 10, -2), 0);
  assert.equal(raster2_index(raster, 12, -1), 5);
  assert.equal(raster2_index(raster, 13, -1), null);
  assert.equal(raster2_in_bounds(raster, 12.9, -1.1), true);
  assert.equal(raster2_in_bounds(raster, 13, -1), false);

  assert.equal(raster2_get(raster, 11, -2), '.');
  assert.equal(raster2_set(raster, 11, -2, '#'), true);
  assert.equal(raster2_get(raster, 11, -2), '#');
  assert.equal(raster2_set(raster, 20, 20, '#'), false);
}

function test_raster3_core(): void {
  const raster = create_raster3({
    origin: { x: -1.9, y: 5.1, z: 3.7 },
    width: 2.8,
    height: 3.2,
    depth: 2.9,
    fill: 0,
  });

  assert.deepEqual(raster.origin, { x: -1, y: 5, z: 3 });
  assert.equal(raster.width, 2);
  assert.equal(raster.height, 3);
  assert.equal(raster.depth, 2);
  assert.equal(raster.data.length, 12);

  assert.equal(raster3_index(raster, -1, 5, 3), 0);
  assert.equal(raster3_index(raster, 0, 7, 4), 11);
  assert.equal(raster3_index(raster, 1, 7, 4), null);
  assert.equal(raster3_in_bounds(raster, 0.9, 7.9, 4.9), true);
  assert.equal(raster3_in_bounds(raster, 1, 7, 4), false);

  assert.equal(raster3_get(raster, 0, 6, 4), 0);
  assert.equal(raster3_set(raster, 0, 6, 4, 9), true);
  assert.equal(raster3_get(raster, 0, 6, 4), 9);
  assert.equal(raster3_set(raster, 9, 9, 9, 9), false);
}

function main(): void {
  test_raster2_core();
  test_raster3_core();
  console.log('geometry_raster_core tests passed');
}

main();
