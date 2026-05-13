import assert from 'node:assert/strict';
import { get_sphere_outline_plane_slices, project_vision_cone_to_planes } from '../shared/geometry/shape3d.js';

function test_sphere_slices(): void {
  const slices = get_sphere_outline_plane_slices({
    origin: { x: 10, y: 10, z: 0 },
    radius: 5,
    visible_planes_z: [-6, -3, 0, 3, 6],
  });

  assert.equal(slices.length, 5);
  assert.equal(slices[0]?.keys.size ?? 0, 0);
  assert.equal(slices[4]?.keys.size ?? 0, 0);
  assert.equal(slices[2]?.quantized_radius, 5);
  assert.ok((slices[1]?.quantized_radius ?? 0) < (slices[2]?.quantized_radius ?? 0));
  assert.ok((slices[3]?.quantized_radius ?? 0) < (slices[2]?.quantized_radius ?? 0));
}

function test_cone_projection_blocks_los(): void {
  const projection = project_vision_cone_to_planes({
    origin: { x: 0, y: 0, z: 0 },
    center_yaw_rad: 0,
    yaw_fov_deg: 30,
    pitch_fov_deg: 20,
    range: 6,
    visible_planes_z: [0],
    blocks_los_at: (x, y, z) => x === 2 && y === 0 && z === 0,
  });

  const plane = projection.visible_by_plane[0] ?? new Set<string>();
  assert.ok(plane.has('0,0'));
  assert.ok(plane.has('1,0'));
  assert.ok(plane.has('2,0'));
  assert.ok(!plane.has('3,0'));
  assert.ok(projection.stats.rays_blocked > 0);
}

function main(): void {
  test_sphere_slices();
  test_cone_projection_blocks_los();
  console.log('shape3d tests passed');
}

main();
