import type { CameraFollowPolicy } from './camera_types.js';

export function is_camera_follow_policy_active(policy: CameraFollowPolicy): boolean {
  return policy.kind !== 'detached';
}

export function should_detach_camera_follow_for_manual_pan(policy: CameraFollowPolicy): boolean {
  return policy.kind === 'track_until_manual_pan' || policy.kind === 'track_until_any_manual_camera_input';
}

export function should_detach_camera_follow_for_manual_depth(policy: CameraFollowPolicy): boolean {
  return policy.kind === 'track_until_manual_depth' || policy.kind === 'track_until_any_manual_camera_input';
}

export function should_detach_camera_follow_for_manual_input(policy: CameraFollowPolicy): boolean {
  return policy.kind === 'track_until_any_manual_camera_input';
}

export function is_camera_snap_once_policy(policy: CameraFollowPolicy): boolean {
  return policy.kind === 'snap_once';
}
