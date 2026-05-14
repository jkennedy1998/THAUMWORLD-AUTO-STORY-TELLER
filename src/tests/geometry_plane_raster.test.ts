import assert from 'node:assert/strict';
import {
  get_line_plane_points,
  get_line_points,
  get_rect_fill_points,
  get_rect_stroke_plane_points,
  get_rect_stroke_points,
  map_plane_points_to_voxels,
  normalize_rect_2d,
} from '../shared/geometry/plane_raster.js';

function test_normalize_rect_2d(): void {
  assert.deepEqual(normalize_rect_2d(4.9, 8.1, 2.2, 3.7), {
    min_x: 2,
    max_x: 4,
    min_y: 3,
    max_y: 8,
  });
}

function test_line_points(): void {
  const points = get_line_points(1, 1, 3, 2);
  assert.deepEqual(points, [
    { x: 1, y: 1 },
    { x: 2, y: 2 },
    { x: 3, y: 2 },
  ]);
}

function test_rect_fill_points(): void {
  const points = get_rect_fill_points(1, 1, 2, 3);
  assert.equal(points.length, 6);
  assert.deepEqual(points[0], { x: 1, y: 1 });
  assert.deepEqual(points[5], { x: 2, y: 3 });

  const reversed = get_rect_fill_points(2, 3, 1, 1);
  assert.deepEqual(reversed, points);
}

function test_rect_stroke_points(): void {
  const points = get_rect_stroke_points(1, 1, 3, 3);
  assert.deepEqual(points, [
    { x: 1, y: 1 },
    { x: 2, y: 1 },
    { x: 3, y: 1 },
    { x: 1, y: 2 },
    { x: 3, y: 2 },
    { x: 1, y: 3 },
    { x: 2, y: 3 },
    { x: 3, y: 3 },
  ]);
}

function test_plane_projection_helpers(): void {
  const stroke = get_rect_stroke_plane_points({ u: 5, v: 5 }, { u: 6, v: 6 });
  assert.ok(stroke.some((p) => p.u === 5 && p.v === 5));
  assert.ok(stroke.some((p) => p.u === 6 && p.v === 6));

  const line = get_line_plane_points({ u: 0, v: 0 }, { u: 2, v: 0 });
  assert.deepEqual(line, [{ u: 0, v: 0 }, { u: 1, v: 0 }, { u: 2, v: 0 }]);

  const voxels = map_plane_points_to_voxels([{ u: 7, v: 8 }], 'xz', 4);
  assert.deepEqual(voxels, [{ x: 7, y: 4, z: 8 }]);
}

function main(): void {
  test_normalize_rect_2d();
  test_line_points();
  test_rect_fill_points();
  test_rect_stroke_points();
  test_plane_projection_helpers();
  console.log('geometry_plane_raster tests passed');
}

main();
