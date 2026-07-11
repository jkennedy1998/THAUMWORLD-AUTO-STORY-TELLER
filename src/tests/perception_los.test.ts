import assert from 'node:assert/strict';
import { evaluate_visual_los, has_voxel_line_of_sight, is_within_yaw_fov } from '../shared/perception_los.js';

function test_is_within_yaw_fov(): void {
  const visible = is_within_yaw_fov({
    observer: { x: 0, y: 0, z: 0 },
    target: { x: 4, y: 0, z: 0 },
    center_yaw_rad: 0,
    yaw_fov_deg: 60,
    range_tiles: 6,
  });
  assert.equal(visible.visible, true);

  const blocked_by_angle = is_within_yaw_fov({
    observer: { x: 0, y: 0, z: 0 },
    target: { x: 0, y: 4, z: 0 },
    center_yaw_rad: 0,
    yaw_fov_deg: 60,
    range_tiles: 6,
  });
  assert.equal(blocked_by_angle.visible, false);
  assert.equal(blocked_by_angle.reason, 'outside_fov');
}

function test_has_voxel_line_of_sight(): void {
  const blocked = has_voxel_line_of_sight({
    observer: { x: 0, y: 0, z: 0 },
    target: { x: 4, y: 0, z: 0 },
    blocks_los_at: (x, y, z) => x === 2 && y === 0 && z === 0,
  });
  assert.equal(blocked.visible, false);
  assert.equal(blocked.reason, 'blocked');
  assert.ok(blocked.vox_steps > 0);

  const clear = has_voxel_line_of_sight({
    observer: { x: 0, y: 0, z: 0 },
    target: { x: 4, y: 0, z: 0 },
    blocks_los_at: () => false,
  });
  assert.equal(clear.visible, true);
  assert.ok(clear.vox_steps > 0);
}

function test_evaluate_visual_los(): void {
  const clear = evaluate_visual_los({
    observer: { x: 0, y: 0, z: 0 },
    target: { x: 4, y: 0, z: 0 },
    center_yaw_rad: 0,
    yaw_fov_deg: 45,
    range_tiles: 6,
    blocks_los_at: () => false,
  });
  assert.equal(clear.visible, true);

  const blocked = evaluate_visual_los({
    observer: { x: 0, y: 0, z: 0 },
    target: { x: 4, y: 0, z: 0 },
    center_yaw_rad: 0,
    yaw_fov_deg: 45,
    range_tiles: 6,
    blocks_los_at: (x, y, z) => x === 2 && y === 0 && z === 0,
  });
  assert.equal(blocked.visible, false);
  assert.equal(blocked.reason, 'blocked');
}

function main(): void {
  test_is_within_yaw_fov();
  test_has_voxel_line_of_sight();
  test_evaluate_visual_los();
  console.log('perception_los tests passed');
}

main();
