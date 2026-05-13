import assert from 'node:assert/strict';
import { get_flood_fill_voxels, get_line_voxels_3d } from '../shared/geometry/voxel_raster.js';

function test_line_voxels_3d(): void {
  const diagonal = get_line_voxels_3d({ x: 0, y: 0, z: 0 }, { x: 3, y: 2, z: 1 });
  assert.deepEqual(diagonal, [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 1, y: 1, z: 0 },
    { x: 1, y: 1, z: 1 },
    { x: 2, y: 1, z: 1 },
    { x: 2, y: 2, z: 1 },
    { x: 3, y: 2, z: 1 },
  ]);
}

function test_flood_fill_voxels_same_plane(): void {
  const occupied = new Set(['0,0,0', '1,0,0', '2,0,1']);
  const filled = get_flood_fill_voxels({
    start: { x: 0, y: 0, z: 0 },
    sample: (world) => occupied.has(`${world.x},${world.y},${world.z}`) ? 'x' : null,
    matches: (candidate, target) => candidate === target,
    enumerate_domain: () => [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 1 },
    ],
    same_depth_only: true,
    allow_diagonal: false,
    continuous: true,
    plane_axis: 'z',
  });
  assert.deepEqual(filled, [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
  ]);
}

function main(): void {
  test_line_voxels_3d();
  test_flood_fill_voxels_same_plane();
  console.log('geometry_voxel_raster tests passed');
}

main();
