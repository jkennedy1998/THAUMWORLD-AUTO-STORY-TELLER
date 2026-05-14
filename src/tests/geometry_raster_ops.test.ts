import assert from 'node:assert/strict';
import { create_raster2, raster2_get } from '../shared/geometry/raster2.js';
import { create_raster3, raster3_set } from '../shared/geometry/raster3.js';
import { draw_line_2d, draw_rect_fill_2d, raster2_active_points } from '../shared/geometry/raster_ops2.js';
import { raster3_active_voxels } from '../shared/geometry/raster_ops3.js';

function test_draw_rect_fill_2d(): void {
  const raster = create_raster2({ origin: { x: 5, y: 7 }, width: 4, height: 3, fill: '.' });
  draw_rect_fill_2d(raster, '#', 6, 8, 7, 9);

  assert.equal(raster2_get(raster, 6, 8), '#');
  assert.equal(raster2_get(raster, 7, 9), '#');
  assert.equal(raster2_get(raster, 5, 7), '.');

  assert.deepEqual(raster2_active_points(raster, (value) => value === '#'), [
    { x: 6, y: 8 },
    { x: 7, y: 8 },
    { x: 6, y: 9 },
    { x: 7, y: 9 },
  ]);
}

function test_draw_line_2d(): void {
  const raster = create_raster2({ origin: { x: 0, y: 0 }, width: 4, height: 4, fill: false });
  draw_line_2d(raster, true, 0, 0, 3, 0);
  assert.deepEqual(raster2_active_points(raster, Boolean), [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 3, y: 0 },
  ]);
}

function test_raster3_active_voxels(): void {
  const raster = create_raster3({ origin: { x: -1, y: 2, z: 4 }, width: 2, height: 2, depth: 2, fill: 0 });
  assert.equal(raster3_set(raster, -1, 2, 4, 1), true);
  assert.equal(raster3_set(raster, 0, 3, 5, 2), true);

  assert.deepEqual(raster3_active_voxels(raster, (value) => value > 0), [
    { x: -1, y: 2, z: 4 },
    { x: 0, y: 3, z: 5 },
  ]);
}

function main(): void {
  test_draw_rect_fill_2d();
  test_draw_line_2d();
  test_raster3_active_voxels();
  console.log('geometry_raster_ops tests passed');
}

main();
