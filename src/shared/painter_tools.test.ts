import { get_line_voxels_3d } from './painter_tools.js';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const single = get_line_voxels_3d({ x: 2, y: 3, z: 4 }, { x: 2, y: 3, z: 4 });
assert(single.length === 1, 'single-voxel line should contain exactly one voxel');
assert(JSON.stringify(single[0]) === JSON.stringify({ x: 2, y: 3, z: 4 }), 'single-voxel line should preserve the endpoint voxel');

const axisAligned = get_line_voxels_3d({ x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 4 });
assert(JSON.stringify(axisAligned) === JSON.stringify([
  { x: 1, y: 1, z: 1 },
  { x: 1, y: 1, z: 2 },
  { x: 1, y: 1, z: 3 },
  { x: 1, y: 1, z: 4 },
]), 'axis-aligned 3D line should visit each voxel between inclusive endpoints');

const diagonal = get_line_voxels_3d({ x: 0, y: 0, z: 0 }, { x: 3, y: 2, z: 1 });
assert(JSON.stringify(diagonal) === JSON.stringify([
  { x: 0, y: 0, z: 0 },
  { x: 1, y: 0, z: 0 },
  { x: 1, y: 1, z: 0 },
  { x: 1, y: 1, z: 1 },
  { x: 2, y: 1, z: 1 },
  { x: 2, y: 2, z: 1 },
  { x: 3, y: 2, z: 1 },
]), 'diagonal 3D line should traverse a deterministic voxel path between inclusive endpoints');

console.log('painter_tools tests passed');
