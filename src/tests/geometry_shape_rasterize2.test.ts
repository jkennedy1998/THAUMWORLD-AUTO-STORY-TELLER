import assert from 'node:assert/strict';
import { create_raster2, raster2_get } from '../shared/geometry/raster2.js';
import { rasterize_line2_into_raster, rasterize_line2_to_points, rasterize_polygon2_into_raster, rasterize_polygon2_to_points, rasterize_rect2_into_raster, rasterize_rect2_to_points } from '../shared/geometry/shape_rasterize2.js';

function test_rasterize_line2_to_points(): void {
  const points = rasterize_line2_to_points({ x0: 1, y0: 1, x1: 3, y1: 2 });
  assert.deepEqual(points, [
    { x: 1, y: 1 },
    { x: 2, y: 2 },
    { x: 3, y: 2 },
  ]);
}

function test_rasterize_rect2_to_points_fill(): void {
  const points = rasterize_rect2_to_points({ x0: 1, y0: 1, x1: 2, y1: 3 }, 'fill');
  assert.deepEqual(points, [
    { x: 1, y: 1 },
    { x: 2, y: 1 },
    { x: 1, y: 2 },
    { x: 2, y: 2 },
    { x: 1, y: 3 },
    { x: 2, y: 3 },
  ]);
}

function test_rasterize_rect2_to_points_edge(): void {
  const points = rasterize_rect2_to_points({ x0: 1, y0: 1, x1: 3, y1: 2 }, 'edge');
  assert.deepEqual(points, [
    { x: 1, y: 1 },
    { x: 2, y: 1 },
    { x: 3, y: 1 },
    { x: 1, y: 2 },
    { x: 2, y: 2 },
    { x: 3, y: 2 },
  ]);
}

function test_rasterize_polygon2_to_points_fill(): void {
  const points = rasterize_polygon2_to_points({
    points: [
      { x: 1, y: 1 },
      { x: 3, y: 1 },
      { x: 2, y: 3 },
    ],
  }, 'fill');
  assert.deepEqual(points, [
    { x: 1, y: 1 },
    { x: 2, y: 1 },
    { x: 3, y: 1 },
    { x: 1, y: 2 },
    { x: 2, y: 2 },
    { x: 3, y: 2 },
    { x: 2, y: 3 },
  ]);
}

function test_rasterize_line2_into_raster(): void {
  const raster = create_raster2({ origin: { x: 5, y: 5 }, width: 4, height: 4, fill: '.' });
  rasterize_line2_into_raster(raster, { x0: 5, y0: 5, x1: 7, y1: 6 }, '#');
  assert.equal(raster2_get(raster, 5, 5), '#');
  assert.equal(raster2_get(raster, 6, 6), '#');
  assert.equal(raster2_get(raster, 7, 6), '#');
  assert.equal(raster2_get(raster, 5, 6), '.');
}

function test_rasterize_polygon2_into_raster(): void {
  const raster = create_raster2({ origin: { x: 0, y: 0 }, width: 5, height: 5, fill: '.' });
  rasterize_polygon2_into_raster(raster, {
    points: [
      { x: 1, y: 1 },
      { x: 3, y: 1 },
      { x: 2, y: 3 },
    ],
  }, 'fill', '#');
  assert.equal(raster2_get(raster, 2, 2), '#');
  assert.equal(raster2_get(raster, 2, 3), '#');
  assert.equal(raster2_get(raster, 0, 0), '.');
}

function test_rasterize_rect2_into_raster(): void {
  const raster = create_raster2({ origin: { x: 5, y: 5 }, width: 4, height: 4, fill: '.' });
  rasterize_rect2_into_raster(raster, { x0: 6, y0: 6, x1: 7, y1: 7 }, 'fill', '#');
  assert.equal(raster2_get(raster, 6, 6), '#');
  assert.equal(raster2_get(raster, 7, 7), '#');
  assert.equal(raster2_get(raster, 5, 5), '.');
}

function main(): void {
  test_rasterize_line2_to_points();
  test_rasterize_rect2_to_points_fill();
  test_rasterize_rect2_to_points_edge();
  test_rasterize_polygon2_to_points_fill();
  test_rasterize_line2_into_raster();
  test_rasterize_polygon2_into_raster();
  test_rasterize_rect2_into_raster();
  console.log('geometry_shape_rasterize2 tests passed');
}

main();
