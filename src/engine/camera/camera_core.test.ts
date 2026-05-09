import { create_module_3d_camera } from './camera_core.js';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const camera = create_module_3d_camera<{ kind: 'point'; x: number; y: number; z: number }, 'top'>({
  resolver: {
    resolveSubject(subject) {
      if (!subject) return null;
      return { world: { x: subject.x, y: subject.y, z: subject.z }, preferred_focus_plane: subject.z };
    },
  },
  initial_orientation: 'top',
  initial_follow_policy: { kind: 'track_until_any_manual_camera_input' },
  initial_motion_style: { kind: 'snap' },
});

camera.setSubject({ kind: 'point', x: 4, y: 5, z: 6 });
camera.tick(1000);
let view = camera.getProjectionView();
assert(view.frame_anchor_world.x === 4 && view.frame_anchor_world.y === 5 && view.frame_anchor_world.z === 6, 'track policy should move anchor to subject');
assert(view.focus_plane === 6, 'resolver focus plane should sync');

camera.notifyManualCameraInput();
camera.setSubject({ kind: 'point', x: 8, y: 9, z: 10 });
camera.tick(1016);
view = camera.getProjectionView();
assert(view.follow_active === false, 'manual input should detach follow');
assert(view.frame_anchor_world.x === 4 && view.frame_anchor_world.y === 5, 'detached camera should preserve anchor');
assert(view.focus_target_world?.x === 8 && view.focus_target_world?.z === 10, 'detached camera should preserve subject');

camera.setFollowPolicy({ kind: 'snap_once' });
camera.setMotionStyle({ kind: 'snap' });
camera.recenterOnSubject(1032);
view = camera.getProjectionView();
assert(view.frame_anchor_world.x === 8 && view.frame_anchor_world.y === 9 && view.frame_anchor_world.z === 10, 'snap_once recenter should jump to subject');
assert(view.follow_active === false, 'snap_once should disable active follow after recenter');

camera.setFrameAnchor({ x: 1, y: 2, z: 3 });
camera.panFrameBy({ x: 2, y: -1 });
camera.setFocusPlane(11);
view = camera.getProjectionView();
assert(view.frame_anchor_world.x === 3 && view.frame_anchor_world.y === 1 && view.frame_anchor_world.z === 3, 'manual pan should update frame anchor');
assert(view.focus_plane === 11, 'manual focus plane changes should persist');

console.log('camera_core.test.ts passed');
