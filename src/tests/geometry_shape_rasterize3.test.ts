import assert from 'node:assert/strict';
import { create_raster3, raster3_get } from '../shared/geometry/raster3.js';
import { box3_session_to_box3_spec, evaluate_box3_session_cell_sets, evaluate_cone3_session_cell_sets, evaluate_cylinder3_session_cell_sets, evaluate_sphere3_session_cell_sets, evaluated_shape_mode_to_world_voxels, rasterize_box3_into_raster, rasterize_box3_session_into_raster, rasterize_box3_session_to_voxels, rasterize_box3_to_voxels, rasterize_cone3_session_into_raster, rasterize_cone3_session_to_voxels, rasterize_cylinder3_session_into_raster, rasterize_cylinder3_session_to_voxels, rasterize_line3_into_raster, rasterize_line3_to_voxels, rasterize_sphere3_session_into_raster, rasterize_sphere3_session_to_voxels, select_evaluated_shape_mode_cell_keys } from '../shared/geometry/shape_rasterize3.js';

function bounds_of(voxels: Array<{ x: number; y: number; z: number }>): { min_x: number; max_x: number; min_y: number; max_y: number; min_z: number; max_z: number } {
  assert.equal(voxels.length > 0, true);
  return {
    min_x: Math.min(...voxels.map((v) => v.x)),
    max_x: Math.max(...voxels.map((v) => v.x)),
    min_y: Math.min(...voxels.map((v) => v.y)),
    max_y: Math.max(...voxels.map((v) => v.y)),
    min_z: Math.min(...voxels.map((v) => v.z)),
    max_z: Math.max(...voxels.map((v) => v.z)),
  };
}

function assert_same_bounds(a: Array<{ x: number; y: number; z: number }>, b: Array<{ x: number; y: number; z: number }>): void {
  assert.deepEqual(bounds_of(a), bounds_of(b));
}

function assert_subset(subset: Array<{ x: number; y: number; z: number }>, superset: Array<{ x: number; y: number; z: number }>): void {
  const keys = new Set(superset.map((voxel) => `${voxel.x},${voxel.y},${voxel.z}`));
  for (const voxel of subset) {
    assert.equal(keys.has(`${voxel.x},${voxel.y},${voxel.z}`), true);
  }
}

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

function test_rasterize_box3_to_voxels_filled(): void {
  const voxels = rasterize_box3_to_voxels({ x0: 1, y0: 2, z0: 3, x1: 2, y1: 3, z1: 4 }, 'filled');
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

function test_rasterize_box3_to_voxels_surfaces(): void {
  const voxels = rasterize_box3_to_voxels({ x0: 1, y0: 1, z0: 1, x1: 3, y1: 3, z1: 3 }, 'surfaces');
  assert.equal(voxels.length, 26);
  assert.equal(voxels.some((v) => v.x === 2 && v.y === 2 && v.z === 2), false);
  assert.equal(voxels.some((v) => v.x === 2 && v.y === 2 && v.z === 1), true);
}

function test_rasterize_box3_to_voxels_wireframe(): void {
  const voxels = rasterize_box3_to_voxels({ x0: 1, y0: 1, z0: 1, x1: 3, y1: 3, z1: 3 }, 'wireframe');
  assert.equal(voxels.length, 20);
  assert.equal(voxels.some((v) => v.x === 2 && v.y === 2 && v.z === 2), false);
  assert.equal(voxels.some((v) => v.x === 2 && v.y === 2 && v.z === 1), false);
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
  rasterize_box3_into_raster(raster, { x0: 6, y0: 6, z0: 6, x1: 7, y1: 7, z1: 7 }, 'filled', '#');
  assert.equal(raster3_get(raster, 6, 6, 6), '#');
  assert.equal(raster3_get(raster, 7, 7, 7), '#');
  assert.equal(raster3_get(raster, 5, 5, 5), '.');
}

function test_rasterize_box3_session_to_voxels_axis_aligned(): void {
  const voxels = rasterize_box3_session_to_voxels({
    anchor: { x: 10, y: 20, z: 30 },
    size: { x: 2, y: 2, z: 2 },
  }, 'filled');
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
  }, 'filled');
  assert.deepEqual(voxels, [
    { x: 2, y: 3, z: 4 },
    { x: 2, y: 4, z: 4 },
    { x: 2, y: 3, z: 5 },
    { x: 2, y: 4, z: 5 },
    { x: 2, y: 3, z: 6 },
    { x: 2, y: 4, z: 6 },
  ]);
}

function test_rasterize_box3_session_into_raster_wireframe(): void {
  const raster = create_raster3({ origin: { x: 0, y: 0, z: 0 }, width: 4, height: 4, depth: 4, fill: '.' });
  rasterize_box3_session_into_raster(raster, {
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 3, y: 3, z: 3 },
  }, 'wireframe', '#');
  assert.equal(raster3_get(raster, 0, 0, 0), '#');
  assert.equal(raster3_get(raster, 1, 1, 1), '.');
  assert.equal(raster3_get(raster, 1, 1, 0), '.');
  assert.equal(raster3_get(raster, 2, 2, 2), '#');
}

function test_rasterize_box3_session_into_raster_surfaces(): void {
  const raster = create_raster3({ origin: { x: 0, y: 0, z: 0 }, width: 4, height: 4, depth: 4, fill: '.' });
  rasterize_box3_session_into_raster(raster, {
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 3, y: 3, z: 3 },
  }, 'surfaces', '#');
  assert.equal(raster3_get(raster, 0, 0, 0), '#');
  assert.equal(raster3_get(raster, 1, 1, 1), '.');
  assert.equal(raster3_get(raster, 1, 1, 0), '#');
  assert.equal(raster3_get(raster, 2, 2, 2), '#');
}

function test_rasterize_sphere3_session_to_voxels_filled(): void {
  const voxels = rasterize_sphere3_session_to_voxels({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 3, y: 3, z: 3 },
  }, 'filled');
  assert.equal(voxels.length, 12);
  assert.equal(voxels.some((v) => v.x === 1 && v.y === 1 && v.z === 1), true);
  assert.equal(voxels.some((v) => v.x === 0 && v.y === 0 && v.z === 0), false);
}

function test_rasterize_sphere3_session_into_raster_surfaces(): void {
  const raster = create_raster3({ origin: { x: 0, y: 0, z: 0 }, width: 5, height: 5, depth: 5, fill: '.' });
  rasterize_sphere3_session_into_raster(raster, {
    anchor: { x: 1, y: 1, z: 1 },
    size: { x: 3, y: 3, z: 3 },
    u_segments: 5,
    v_segments: 5,
  }, 'surfaces', '#');
  assert.equal(raster3_get(raster, 2, 2, 1), '#');
  assert.equal(raster3_get(raster, 2, 2, 2), '.');
  assert.equal(raster3_get(raster, 1, 1, 1), '.');
}

function test_rasterize_sphere3_session_surfaces_segments(): void {
  const coarse = rasterize_sphere3_session_to_voxels({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 9, y: 9, z: 9 },
    u_segments: 5,
    v_segments: 5,
  }, 'surfaces');
  const dense = rasterize_sphere3_session_to_voxels({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 9, y: 9, z: 9 },
    u_segments: 9,
    v_segments: 9,
  }, 'surfaces');
  assert.equal(coarse.some((v) => v.x === 4 && v.y === 4 && v.z === 4), false);
  assert.equal(dense.some((v) => v.x === 4 && v.y === 4 && v.z === 4), false);
  assert.equal(dense.length !== coarse.length, true);
}

function test_rasterize_sphere3_session_filled_segments(): void {
  const coarse = rasterize_sphere3_session_to_voxels({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 9, y: 9, z: 9 },
    u_segments: 5,
    v_segments: 5,
  }, 'filled');
  const dense = rasterize_sphere3_session_to_voxels({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 9, y: 9, z: 9 },
    u_segments: 9,
    v_segments: 9,
  }, 'filled');
  assert.equal(coarse.some((v) => v.x === 4 && v.y === 4 && v.z === 4), true);
  assert.equal(dense.some((v) => v.x === 4 && v.y === 4 && v.z === 4), true);
  assert.equal(dense.length !== coarse.length, true);
}

function test_rasterize_sphere3_session_2d_outline_collapse(): void {
  const voxels = rasterize_sphere3_session_to_voxels({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 5, y: 5, z: 1 },
  }, 'surfaces');
  assert.equal(voxels.some((v) => v.x === 2 && v.y === 2 && v.z === 0), false);
  assert.equal(voxels.some((v) => v.x === 2 && v.y === 0 && v.z === 0), true);
}

function test_rasterize_sphere3_session_wireframe_segments(): void {
  const coarse = rasterize_sphere3_session_to_voxels({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 7, y: 7, z: 7 },
    u_segments: 5,
    v_segments: 5,
  }, 'wireframe');
  const dense = rasterize_sphere3_session_to_voxels({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 7, y: 7, z: 7 },
    u_segments: 9,
    v_segments: 9,
  }, 'wireframe');
  assert.equal(coarse.some((v) => v.x === 3 && v.y === 3 && v.z === 3), false);
  assert.equal(dense.length > coarse.length, true);
}

function test_rasterize_cylinder3_session_to_voxels_filled(): void {
  const voxels = rasterize_cylinder3_session_to_voxels({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 5, y: 5, z: 4 },
  }, 'filled');
  assert.equal(voxels.length, 84);
  assert.equal(voxels.some((v) => v.x === 2 && v.y === 2 && v.z === 2), true);
  assert.equal(voxels.some((v) => v.x === 0 && v.y === 0 && v.z === 1), true);
}

function test_rasterize_cylinder3_session_into_raster_surfaces(): void {
  const raster = create_raster3({ origin: { x: 0, y: 0, z: 0 }, width: 7, height: 7, depth: 6, fill: '.' });
  rasterize_cylinder3_session_into_raster(raster, {
    anchor: { x: 1, y: 1, z: 1 },
    size: { x: 5, y: 5, z: 4 },
    radial_segments: 5,
  }, 'surfaces', '#');
  assert.equal(raster3_get(raster, 3, 3, 2), '.');
  assert.equal(raster3_get(raster, 3, 3, 1), '#');
  assert.equal(raster3_get(raster, 2, 2, 2), '.');
  assert.equal(raster3_get(raster, 3, 1, 2), '#');
}

function test_rasterize_cylinder3_session_surfaces_segments(): void {
  const tri = rasterize_cylinder3_session_to_voxels({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 9, y: 9, z: 6 },
    radial_segments: 3,
  }, 'surfaces');
  const oct = rasterize_cylinder3_session_to_voxels({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 9, y: 9, z: 6 },
    radial_segments: 8,
  }, 'surfaces');
  assert.equal(oct.length > tri.length, true);
}

function test_rasterize_cylinder3_session_2d_outline_collapse(): void {
  const voxels = rasterize_cylinder3_session_to_voxels({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 5, y: 5, z: 1 },
  }, 'wireframe');
  assert.equal(voxels.some((v) => v.x === 2 && v.y === 2 && v.z === 0), false);
  assert.equal(voxels.some((v) => v.x === 2 && v.y === 0 && v.z === 0), true);
}

function test_rasterize_cylinder3_session_wireframe_segments(): void {
  const tri = rasterize_cylinder3_session_to_voxels({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 7, y: 7, z: 5 },
    radial_segments: 3,
  }, 'wireframe');
  const oct = rasterize_cylinder3_session_to_voxels({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 7, y: 7, z: 5 },
    radial_segments: 8,
  }, 'wireframe');
  assert.equal(oct.length > tri.length, true);
}

function test_rasterize_cone3_session_to_voxels_filled(): void {
  const voxels = rasterize_cone3_session_to_voxels({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 5, y: 5, z: 4 },
  }, 'filled');
  assert.equal(voxels.length, 42);
  assert.equal(voxels.some((v) => v.x === 2 && v.y === 2 && v.z === 0), true);
  assert.equal(voxels.some((v) => v.x === 2 && v.y === 2 && v.z === 3), true);
  assert.equal(voxels.some((v) => v.x === 0 && v.y === 0 && v.z === 0), true);
}

function test_rasterize_cone3_session_into_raster_surfaces(): void {
  const raster = create_raster3({ origin: { x: 0, y: 0, z: 0 }, width: 7, height: 7, depth: 6, fill: '.' });
  rasterize_cone3_session_into_raster(raster, {
    anchor: { x: 1, y: 1, z: 1 },
    size: { x: 5, y: 5, z: 4 },
    radial_segments: 5,
  }, 'surfaces', '#');
  assert.equal(raster3_get(raster, 3, 3, 2), '.');
  assert.equal(raster3_get(raster, 3, 3, 1), '#');
  assert.equal(raster3_get(raster, 3, 3, 4), '#');
  assert.equal(raster3_get(raster, 2, 2, 2), '.');
}

function test_rasterize_cone3_session_surfaces_segments(): void {
  const tri = rasterize_cone3_session_to_voxels({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 9, y: 9, z: 6 },
    radial_segments: 3,
  }, 'surfaces');
  const oct = rasterize_cone3_session_to_voxels({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 9, y: 9, z: 6 },
    radial_segments: 8,
  }, 'surfaces');
  assert.equal(oct.length > tri.length, true);
}

function test_rasterize_cone3_session_2d_outline_collapse(): void {
  const voxels = rasterize_cone3_session_to_voxels({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 5, y: 5, z: 1 },
  }, 'surfaces');
  assert.equal(voxels.some((v) => v.x === 2 && v.y === 2 && v.z === 0), false);
  assert.equal(voxels.some((v) => v.x === 2 && v.y === 0 && v.z === 0), true);
}

function test_rasterize_cone3_session_wireframe_segments(): void {
  const tri = rasterize_cone3_session_to_voxels({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 7, y: 7, z: 5 },
    radial_segments: 3,
  }, 'wireframe');
  const oct = rasterize_cone3_session_to_voxels({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 7, y: 7, z: 5 },
    radial_segments: 8,
  }, 'wireframe');
  assert.equal(oct.length > tri.length, true);
}

function test_curved_shape_modes_share_bounds(): void {
  const sphereWire = rasterize_sphere3_session_to_voxels({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 9, y: 9, z: 9 },
    u_segments: 7,
    v_segments: 7,
  }, 'wireframe');
  const sphereSurface = rasterize_sphere3_session_to_voxels({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 9, y: 9, z: 9 },
    u_segments: 7,
    v_segments: 7,
  }, 'surfaces');
  const sphereFilled = rasterize_sphere3_session_to_voxels({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 9, y: 9, z: 9 },
    u_segments: 7,
    v_segments: 7,
  }, 'filled');
  assert_same_bounds(sphereWire, sphereSurface);
  assert_same_bounds(sphereWire, sphereFilled);

  const cylinderWire = rasterize_cylinder3_session_to_voxels({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 9, y: 9, z: 6 },
    radial_segments: 7,
  }, 'wireframe');
  const cylinderSurface = rasterize_cylinder3_session_to_voxels({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 9, y: 9, z: 6 },
    radial_segments: 7,
  }, 'surfaces');
  const cylinderFilled = rasterize_cylinder3_session_to_voxels({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 9, y: 9, z: 6 },
    radial_segments: 7,
  }, 'filled');
  assert_same_bounds(cylinderWire, cylinderSurface);
  assert_same_bounds(cylinderWire, cylinderFilled);

  const coneWire = rasterize_cone3_session_to_voxels({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 9, y: 9, z: 6 },
    radial_segments: 7,
  }, 'wireframe');
  const coneSurface = rasterize_cone3_session_to_voxels({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 9, y: 9, z: 6 },
    radial_segments: 7,
  }, 'surfaces');
  const coneFilled = rasterize_cone3_session_to_voxels({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 9, y: 9, z: 6 },
    radial_segments: 7,
  }, 'filled');
  assert_same_bounds(coneWire, coneSurface);
  assert_same_bounds(coneWire, coneFilled);
}

function test_curved_shape_mode_containment(): void {
  const sphereWire = rasterize_sphere3_session_to_voxels({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 9, y: 9, z: 9 },
    u_segments: 7,
    v_segments: 7,
  }, 'wireframe');
  const sphereSurface = rasterize_sphere3_session_to_voxels({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 9, y: 9, z: 9 },
    u_segments: 7,
    v_segments: 7,
  }, 'surfaces');
  const sphereFilled = rasterize_sphere3_session_to_voxels({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 9, y: 9, z: 9 },
    u_segments: 7,
    v_segments: 7,
  }, 'filled');
  assert_subset(sphereWire, sphereSurface);
  assert_subset(sphereSurface, sphereFilled);

  const cylinderWire = rasterize_cylinder3_session_to_voxels({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 9, y: 9, z: 6 },
    radial_segments: 7,
  }, 'wireframe');
  const cylinderSurface = rasterize_cylinder3_session_to_voxels({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 9, y: 9, z: 6 },
    radial_segments: 7,
  }, 'surfaces');
  const cylinderFilled = rasterize_cylinder3_session_to_voxels({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 9, y: 9, z: 6 },
    radial_segments: 7,
  }, 'filled');
  assert_subset(cylinderWire, cylinderSurface);
  assert_subset(cylinderSurface, cylinderFilled);

  const coneWire = rasterize_cone3_session_to_voxels({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 9, y: 9, z: 6 },
    radial_segments: 7,
  }, 'wireframe');
  const coneSurface = rasterize_cone3_session_to_voxels({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 9, y: 9, z: 6 },
    radial_segments: 7,
  }, 'surfaces');
  const coneFilled = rasterize_cone3_session_to_voxels({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: 9, y: 9, z: 6 },
    radial_segments: 7,
  }, 'filled');
  assert_subset(coneWire, coneSurface);
  assert_subset(coneSurface, coneFilled);
}

function key_voxels(keys: Set<string>): Array<{ x: number; y: number; z: number }> {
  return Array.from(keys, (key) => {
    const [x = 0, y = 0, z = 0] = key.split(',').map(Number);
    return { x, y, z };
  });
}

function test_evaluated_shape_cell_sets_and_mode_parity(): void {
  const boxSpec = {
    anchor: { x: 4, y: 5, z: 6 },
    size: { x: 3, y: 3, z: 3 },
  };
  const box = evaluate_box3_session_cell_sets(boxSpec);
  assert_subset(key_voxels(box.wireframeCellKeys), key_voxels(box.shellCellKeys));
  assert_subset(key_voxels(box.shellCellKeys), key_voxels(box.bodyCellKeys));
  assert.deepEqual(evaluated_shape_mode_to_world_voxels(box, 'wireframe'), rasterize_box3_session_to_voxels(boxSpec, 'wireframe'));

  const sphereSpec = { anchor: { x: 0, y: 0, z: 0 }, size: { x: 5, y: 5, z: 5 }, u_segments: 5, v_segments: 5 };
  const sphere = evaluate_sphere3_session_cell_sets(sphereSpec);
  assert.deepEqual(evaluated_shape_mode_to_world_voxels(sphere, 'surfaces'), rasterize_sphere3_session_to_voxels(sphereSpec, 'surfaces'));
  assert.equal(select_evaluated_shape_mode_cell_keys(sphere, 'filled').size, sphere.bodyCellKeys.size);

  const cylinderSpec = { anchor: { x: 1, y: 2, z: 3 }, size: { x: 5, y: 5, z: 4 }, radial_segments: 5 };
  const cylinder = evaluate_cylinder3_session_cell_sets(cylinderSpec);
  assert.deepEqual(evaluated_shape_mode_to_world_voxels(cylinder, 'wireframe'), rasterize_cylinder3_session_to_voxels(cylinderSpec, 'wireframe'));

  const coneSpec = { anchor: { x: 2, y: 3, z: 4 }, size: { x: 5, y: 5, z: 4 }, radial_segments: 5 };
  const cone = evaluate_cone3_session_cell_sets(coneSpec);
  assert.deepEqual(evaluated_shape_mode_to_world_voxels(cone, 'filled'), rasterize_cone3_session_to_voxels(coneSpec, 'filled'));
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
  test_rasterize_box3_to_voxels_filled();
  test_rasterize_box3_to_voxels_surfaces();
  test_rasterize_box3_to_voxels_wireframe();
  test_rasterize_line3_into_raster();
  test_rasterize_box3_into_raster();
  test_rasterize_box3_session_to_voxels_axis_aligned();
  test_rasterize_box3_session_to_voxels_oriented();
  test_rasterize_box3_session_into_raster_wireframe();
  test_rasterize_box3_session_into_raster_surfaces();
  test_rasterize_sphere3_session_to_voxels_filled();
  test_rasterize_sphere3_session_into_raster_surfaces();
  test_rasterize_sphere3_session_surfaces_segments();
  test_rasterize_sphere3_session_filled_segments();
  test_rasterize_sphere3_session_2d_outline_collapse();
  test_rasterize_sphere3_session_wireframe_segments();
  test_rasterize_cylinder3_session_to_voxels_filled();
  test_rasterize_cylinder3_session_into_raster_surfaces();
  test_rasterize_cylinder3_session_surfaces_segments();
  test_rasterize_cylinder3_session_2d_outline_collapse();
  test_rasterize_cylinder3_session_wireframe_segments();
  test_rasterize_cone3_session_to_voxels_filled();
  test_rasterize_cone3_session_into_raster_surfaces();
  test_rasterize_cone3_session_surfaces_segments();
  test_rasterize_cone3_session_2d_outline_collapse();
  test_rasterize_cone3_session_wireframe_segments();
  test_curved_shape_modes_share_bounds();
  test_curved_shape_mode_containment();
  test_evaluated_shape_cell_sets_and_mode_parity();
  test_box3_session_to_box3_spec();
  console.log('geometry_shape_rasterize3 tests passed');
}

main();
