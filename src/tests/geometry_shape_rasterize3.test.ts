import assert from 'node:assert/strict';
import { create_raster3, raster3_get } from '../shared/geometry/raster3.js';
import { box3_session_to_box3_spec, rasterize_box3_into_raster, rasterize_box3_session_into_raster, rasterize_box3_session_to_voxels, rasterize_box3_to_voxels, rasterize_cone3_session_into_raster, rasterize_cone3_session_to_voxels, rasterize_cylinder3_session_into_raster, rasterize_cylinder3_session_to_voxels, rasterize_line3_into_raster, rasterize_line3_to_voxels, rasterize_sphere3_session_into_raster, rasterize_sphere3_session_to_voxels } from '../shared/geometry/shape_rasterize3.js';

function test_rasterize_line3_to_voxels(): void {
  const voxels = rasterize_line3_to_voxels({ x0: 0, y0: 0, z0: 0, x1: 3, y1: 2, z1: 1 });
  assert.deepEqual(voxels, [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 1, y: 1, z: 0 },
    { x: 1, y: 1, z: 1 },
    { x: 2, y: 1, z: 1 },
    { x: 2, y: 2, z: 1 },
    { x: 3, y: 2, z: 1 },
  ]);
}

function test_rasterize_box3_to_voxels_volume(): void {
  const voxels = rasterize_box3_to_voxels({ x0: 1, y0: 2, z0: 3, x1: 2, y1: 3, z1: 4 }, 'volume');
  assert.deepEqual(voxels, [
    { x: 1, y: 2, z: 3 },
    { x: 2, y: 2, z: 3 },
    { x: 1, y: 3, z: 3 },
    { x: 2, y: 3, z: 3 },
    { x: 1, y: 2, z: 4 },
    { x: 2, y: 2, z: 4 },
    { x: 1, y: 3, z: 4 },
    { x: 2, y: 3, z: 4 },
  ]);
}

function test_rasterize_box3_to_voxels_outline(): void {
  const voxels = rasterize_box3_to_voxels({ x0: 1, y0: 1, z0: 1, x1: 3, y1: 3, z1: 3 }, 'outline');
  assert.equal(voxels.length, 20);
  assert.equal(voxels.some((v) => v.x === 2 && v.y === 2 && v.z === 2), false);
  assert.equal(voxels.some((v) => v.x === 2 && v.y === 2 && v.z === 1), false);
  assert.equal(voxels.some((v) => v.x === 1 && v.y === 1 && v.z === 1), true);
  assert.equal(voxels.some((v) => v.x === 3 && v.y === 3 && v.z === 3), true);
}

function test_rasterize_line3_into_raster(): void {
  const raster = create_raster3({ origin: { x: 5, y: 5, z: 5 }, width: 4, height: 4, depth: 4, fill: '.' });
  rasterize_line3_into_raster(raster, { x0: 5, y0: 5, z0: 5, x1: 7, y1: 6, z1: 6 }, '#');
  assert.equal(raster3_get(raster, 5, 5, 5), '#');
  assert.equal(raster3_get(raster, 6, 5, 5), '#');
  assert.equal(raster3_get(raster, 6, 6, 6), '#');
  assert.equal(raster3_get(raster, 7, 7, 7), '.');
}

function test_rasterize_box3_into_raster(): void {
  const raster = create_raster3({ origin: { x: 5, y: 5, z: 5 }, width: 4, height: 4, depth: 4, fill: '.' });
  rasterize_box3_into_raster(raster, { x0: 6, y0: 6, z0: 6, x1: 7, y1: 7, z1: 7 }, 'volume', '#');
  assert.equal(raster3_get(raster, 6, 6, 6), '#');
  assert.equal(raster3_get(raster, 7, 7, 7), '#');
  assert.equal(raster3_get(raster, 5, 5, 5), '.');
}

function test_rasterize_box3_session_to_voxels_axis_aligned(): void {
  const voxels = rasterize_box3_session_to_voxels({
    anchor: { x: 10, y: 20, z: 30 },
    size: { x: 2, y: 2, z: 2 },
  }, 'volume');
  assert.deepEqual(voxels, [
    { x: 10, y: 20, z: 30 },
    { x: 11, y: 20, z: 30 },
    { x: 10, y: 21, z: 30 },
    { x: 11, y: 21, z: 30 },
    { x: 10, y: 20, z: 31 },
    { x: 11, y: 20, z: 31 },
    { x: 10, y: 21, z: 31 },
    { x: 11, y: 21, z: 31 },
  ]);
}

function test_rasterize_box3_session_to_voxels_oriented(): void {
  const voxels = rasterize_box3_session_to_voxels({
    anchor: { x: 2, y: 3, z: 4 },
    size: { x: 2, y: 3, z: 1 },
    basis: {
      right: { x: 0, y: 1, z: 0 },
      up: { x: 0, y: 0, z: 1 },
      forward: { x: 1, y: 0, z: 0 },
    },
  }, 'volume');
  assert.deepEqual(voxels, [
    { x: 2, y: 3, z: 4 },
    { x: 2, y: 4, z: 4 },
    { x: 2, y: 3, z: 5 },
    { x: 2, y: 4, z: 5 },
    { x: 2, y: 3, z: 6 },
    { x: 2, y: 4, z: 6 },
  ]);
}

function test_rasterize_box3_session_into_raster_outline(): void {
  const raster = create_raster3({ origin: { x: 0, y: 0, z: 0 }, width: 4, height: 4, depth: 4, fill: '.' });
  rasterize_box3_session_into_raster(raster, {
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 3, y: 3, z: 3 },
  }, 'outline', '#');
  assert.equal(raster3_get(raster, 0, 0, 0), '#');
  assert.equal(raster3_get(raster, 1, 1, 1), '.');
  assert.equal(raster3_get(raster, 1, 1, 0), '.');
  assert.equal(raster3_get(raster, 2, 2, 2), '#');
}

function test_rasterize_sphere3_session_to_voxels_volume(): void {
  const voxels = rasterize_sphere3_session_to_voxels({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 3, y: 3, z: 3 },
  }, 'volume');
  assert.equal(voxels.length, 19);
  assert.equal(voxels.some((v) => v.x === 1 && v.y === 1 && v.z === 1), true);
  assert.equal(voxels.some((v) => v.x === 0 && v.y === 0 && v.z === 0), false);
}

function test_rasterize_sphere3_session_into_raster_outline(): void {
  const raster = create_raster3({ origin: { x: 0, y: 0, z: 0 }, width: 5, height: 5, depth: 5, fill: '.' });
  rasterize_sphere3_session_into_raster(raster, {
    anchor: { x: 1, y: 1, z: 1 },
    size: { x: 3, y: 3, z: 3 },
  }, 'outline', '#');
  assert.equal(raster3_get(raster, 2, 2, 2), '.');
  assert.equal(raster3_get(raster, 2, 2, 1), '#');
  assert.equal(raster3_get(raster, 1, 1, 1), '.');
}

function test_rasterize_cylinder3_session_to_voxels_volume(): void {
  const voxels = rasterize_cylinder3_session_to_voxels({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 5, y: 5, z: 4 },
  }, 'volume');
  assert.equal(voxels.length, 84);
  assert.equal(voxels.some((v) => v.x === 2 && v.y === 2 && v.z === 2), true);
  assert.equal(voxels.some((v) => v.x === 0 && v.y === 0 && v.z === 1), false);
}

function test_rasterize_cylinder3_session_into_raster_outline(): void {
  const raster = create_raster3({ origin: { x: 0, y: 0, z: 0 }, width: 7, height: 7, depth: 6, fill: '.' });
  rasterize_cylinder3_session_into_raster(raster, {
    anchor: { x: 1, y: 1, z: 1 },
    size: { x: 5, y: 5, z: 4 },
  }, 'outline', '#');
  assert.equal(raster3_get(raster, 3, 3, 2), '.');
  assert.equal(raster3_get(raster, 3, 3, 1), '#');
  assert.equal(raster3_get(raster, 2, 2, 2), '.');
  assert.equal(raster3_get(raster, 3, 1, 2), '#');
}

function test_rasterize_cone3_session_to_voxels_volume(): void {
  const voxels = rasterize_cone3_session_to_voxels({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 5, y: 5, z: 4 },
  }, 'volume');
  assert.equal(voxels.length, 32);
  assert.equal(voxels.some((v) => v.x === 2 && v.y === 2 && v.z === 0), true);
  assert.equal(voxels.some((v) => v.x === 2 && v.y === 2 && v.z === 3), true);
  assert.equal(voxels.some((v) => v.x === 0 && v.y === 0 && v.z === 0), false);
}

function test_rasterize_cone3_session_into_raster_outline(): void {
  const raster = create_raster3({ origin: { x: 0, y: 0, z: 0 }, width: 7, height: 7, depth: 6, fill: '.' });
  rasterize_cone3_session_into_raster(raster, {
    anchor: { x: 1, y: 1, z: 1 },
    size: { x: 5, y: 5, z: 4 },
  }, 'outline', '#');
  assert.equal(raster3_get(raster, 3, 3, 2), '.');
  assert.equal(raster3_get(raster, 3, 3, 1), '#');
  assert.equal(raster3_get(raster, 3, 3, 4), '#');
  assert.equal(raster3_get(raster, 2, 2, 2), '#');
}

function test_box3_session_to_box3_spec(): void {
  assert.deepEqual(box3_session_to_box3_spec({
    anchor: { x: 4, y: 5, z: 6 },
    size: { x: 2, y: 3, z: 4 },
  }), {
    x0: 4,
    y0: 5,
    z0: 6,
    x1: 5,
    y1: 7,
    z1: 9,
  });
  assert.equal(box3_session_to_box3_spec({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 2, y: 2, z: 2 },
    basis: {
      right: { x: 0, y: 1, z: 0 },
      up: { x: 1, y: 0, z: 0 },
      forward: { x: 0, y: 0, z: 1 },
    },
  }), null);
}

function main(): void {
  test_rasterize_line3_to_voxels();
  test_rasterize_box3_to_voxels_volume();
  test_rasterize_box3_to_voxels_outline();
  test_rasterize_line3_into_raster();
  test_rasterize_box3_into_raster();
  test_rasterize_box3_session_to_voxels_axis_aligned();
  test_rasterize_box3_session_to_voxels_oriented();
  test_rasterize_box3_session_into_raster_outline();
  test_rasterize_sphere3_session_to_voxels_volume();
  test_rasterize_sphere3_session_into_raster_outline();
  test_rasterize_cylinder3_session_to_voxels_volume();
  test_rasterize_cylinder3_session_into_raster_outline();
  test_rasterize_cone3_session_to_voxels_volume();
  test_rasterize_cone3_session_into_raster_outline();
  test_box3_session_to_box3_spec();
  console.log('geometry_shape_rasterize3 tests passed');
}

main();
