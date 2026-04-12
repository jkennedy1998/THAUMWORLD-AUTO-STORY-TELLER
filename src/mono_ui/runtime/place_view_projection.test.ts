import {
  get_transition_tilt_for_command,
  get_view_basis_for_state,
  map_screen_direction_to_ground_delta,
  map_screen_direction_to_world_delta,
  map_screen_move_intent_to_ground_delta,
  make_place_view_state,
  project_world_point_with_roll,
  rotate_place_view_roll,
  swing_place_view,
  type PlacePrincipalView,
  type PlaceViewRollQuarterTurn,
} from './place_view_projection.js';
import { start_roll_transition, start_swing_transition } from './place_camera_pose.js';
import { get_place_view_render_euler, resolve_place_view_transition_frame } from './place_view_camera_runtime.js';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function key(state: { principal_view: PlacePrincipalView; roll_quarter_turn: PlaceViewRollQuarterTurn }): string {
  return `${state.principal_view}:${state.roll_quarter_turn}`;
}

const VIEWS: readonly PlacePrincipalView[] = ['top', 'bottom', 'north', 'east', 'south', 'west'];
const ROLLS: readonly PlaceViewRollQuarterTurn[] = [0, 1, 2, 3];

for (const principal_view of VIEWS) {
  for (const roll_quarter_turn of ROLLS) {
    const state = make_place_view_state(principal_view, roll_quarter_turn);
    const stateKey = key(state);

    let rolled = state;
    for (let i = 0; i < 4; i += 1) rolled = rotate_place_view_roll(rolled, 'right');
    assert(key(rolled) === stateKey, `roll right x4 should return to ${stateKey}, got ${key(rolled)}`);

    let swungUp = state;
    for (let i = 0; i < 4; i += 1) swungUp = swing_place_view(swungUp, 'up');
    assert(key(swungUp) === stateKey, `swing up x4 should return to ${stateKey}, got ${key(swungUp)}`);

    let swungLeft = state;
    for (let i = 0; i < 4; i += 1) swungLeft = swing_place_view(swungLeft, 'left');
    assert(key(swungLeft) === stateKey, `swing left x4 should return to ${stateKey}, got ${key(swungLeft)}`);

    assert(key(swing_place_view(swing_place_view(state, 'up'), 'down')) === stateKey, `up/down should invert for ${stateKey}`);
    assert(key(swing_place_view(swing_place_view(state, 'left'), 'right')) === stateKey, `left/right should invert for ${stateKey}`);

    const swingLeftTilt = get_transition_tilt_for_command(state, 'swing', 'left', 40);
    const swingRightTilt = get_transition_tilt_for_command(state, 'swing', 'right', 40);
    const swingUpTilt = get_transition_tilt_for_command(state, 'swing', 'up', 40);
    const swingDownTilt = get_transition_tilt_for_command(state, 'swing', 'down', 40);
    assert(swingLeftTilt.x === 0 && swingLeftTilt.y === 40 && swingLeftTilt.z === 0, `swing left tilt should be screen-space invariant for ${stateKey}`);
    assert(swingRightTilt.x === 0 && swingRightTilt.y === -40 && swingRightTilt.z === 0, `swing right tilt should be screen-space invariant for ${stateKey}`);
    assert(swingUpTilt.x === -40 && swingUpTilt.y === 0 && swingUpTilt.z === 0, `swing up tilt should be screen-space invariant for ${stateKey}`);
    assert(swingDownTilt.x === 40 && swingDownTilt.y === 0 && swingDownTilt.z === 0, `swing down tilt should be screen-space invariant for ${stateKey}`);

    const origin = project_world_point_with_roll({ x: 0, y: 0, z: 0 }, state);
    const basis = get_view_basis_for_state(state);
    const rightProjected = project_world_point_with_roll(basis.right, state);
    const upProjected = project_world_point_with_roll(basis.up, state);
    assert(rightProjected.plane === origin.plane, `right basis should stay on same plane for ${stateKey}`);
    assert(upProjected.plane === origin.plane, `up basis should stay on same plane for ${stateKey}`);
    assert(rightProjected.u - origin.u === 1 && rightProjected.v - origin.v === 0, `right basis should map to screen +X for ${stateKey}, got du=${rightProjected.u - origin.u} dv=${rightProjected.v - origin.v}`);
    assert(upProjected.u - origin.u === 0 && upProjected.v - origin.v === -1, `up basis should map to screen -Y for ${stateKey}, got du=${upProjected.u - origin.u} dv=${upProjected.v - origin.v}`);
  }
}

console.log('place_view_projection matrix tests passed');

const top = make_place_view_state('top', 0);
assert(JSON.stringify(map_screen_direction_to_ground_delta(top, 'up')) === JSON.stringify({ dx: 0, dy: 1 }), 'top:0 W should move screen-up/world northward');
assert(JSON.stringify(map_screen_direction_to_ground_delta(top, 'right')) === JSON.stringify({ dx: 1, dy: 0 }), 'top:0 D should move east');

const topRolled180 = make_place_view_state('top', 2);
assert(JSON.stringify(map_screen_direction_to_ground_delta(topRolled180, 'up')) === JSON.stringify({ dx: 0, dy: -1 }), 'top:2 W should invert vertically');
assert(JSON.stringify(map_screen_direction_to_ground_delta(topRolled180, 'right')) === JSON.stringify({ dx: -1, dy: 0 }), 'top:2 D should invert horizontally');

const bottom = make_place_view_state('bottom', 0);
assert(JSON.stringify(map_screen_direction_to_ground_delta(bottom, 'up')) === JSON.stringify({ dx: 0, dy: -1 }), 'bottom:0 W should move visually up');

const north = make_place_view_state('north', 0);
assert(JSON.stringify(map_screen_direction_to_ground_delta(north, 'up')) === JSON.stringify({ dx: 0, dy: -1 }), 'north:0 W should move forward into depth');
assert(JSON.stringify(map_screen_direction_to_ground_delta(north, 'right')) === JSON.stringify({ dx: 1, dy: 0 }), 'north:0 D should move screen-right');

const topRolledLeft = make_place_view_state('top', 3);
assert(JSON.stringify(map_screen_direction_to_ground_delta(topRolledLeft, 'left')) === JSON.stringify({ dx: 0, dy: 1 }), 'top:3 A should move screen-left after a left roll');
assert(JSON.stringify(map_screen_direction_to_ground_delta(topRolledLeft, 'right')) === JSON.stringify({ dx: 0, dy: -1 }), 'top:3 D should move screen-right after a left roll');
assert(JSON.stringify(map_screen_direction_to_ground_delta(topRolledLeft, 'up')) === JSON.stringify({ dx: 1, dy: 0 }), 'top:3 W should move screen-up after a left roll');
assert(JSON.stringify(map_screen_direction_to_ground_delta(topRolledLeft, 'down')) === JSON.stringify({ dx: -1, dy: 0 }), 'top:3 S should move screen-down after a left roll');

assert(JSON.stringify(map_screen_move_intent_to_ground_delta(top, { dx: 1, dy: 0 })) === JSON.stringify({ dx: 1, dy: 0 }), 'raw screen-right intent should map correctly');
assert(JSON.stringify(map_screen_direction_to_world_delta(topRolledLeft, 'up')) === JSON.stringify({ x: 1, y: 0, z: 0 }), 'top:3 screen-up should map to +X world');
assert(JSON.stringify(map_screen_direction_to_world_delta(topRolledLeft, 'left')) === JSON.stringify({ x: 0, y: 1, z: 0 }), 'top:3 screen-left should map to +Y world');

assert(JSON.stringify(get_place_view_render_euler(make_place_view_state('top', 1))) === JSON.stringify({ x: 0, y: 0, z: 90 }), 'top:1 render euler should be pure roll');
assert(JSON.stringify(get_place_view_render_euler(make_place_view_state('east', 3))) === JSON.stringify({ x: 0, y: -90, z: 270 }), 'east:3 render euler should match hard view basis');

const swingTransition = start_swing_transition('left', 1000, get_transition_tilt_for_command(top, 'swing', 'left', 40));
const swingCommit = resolve_place_view_transition_frame({
  target_view: top,
  hard_view: top,
  transition: swingTransition,
  now_ms: 1280,
});
assert(swingCommit.frame.committed_this_frame === true, 'swing transition should commit at breakpoint');
assert(key(swingCommit.target_view) === key(swing_place_view(top, 'left')), 'swing commit should advance target view');
assert(swingCommit.frame.phase === 'post_snap', 'swing transition should hand off to post_snap');
assert(swingCommit.transition?.phase === 'post_snap', 'resolved transition should continue in post_snap');

const rollBase = make_place_view_state('north', 2);
const rollTransition = start_roll_transition('right', 1000, rollBase.roll_quarter_turn, get_transition_tilt_for_command(rollBase, 'roll', 'right', 40));
const rollCommit = resolve_place_view_transition_frame({
  target_view: rollBase,
  hard_view: rollBase,
  transition: rollTransition,
  now_ms: 1280,
});
assert(key(rollCommit.hard_view) === key(rotate_place_view_roll(rollBase, 'right')), 'roll commit should rotate hard view atomically');
assert(rollCommit.frame.euler.z === -40, 'post-snap roll sample should hand off with inverted roll tilt');

const finished = resolve_place_view_transition_frame({
  target_view: rollCommit.target_view,
  hard_view: rollCommit.hard_view,
  transition: rollCommit.transition,
  now_ms: 1560,
});
assert(finished.transition === null, 'transition should clear after post_snap duration');
assert(finished.frame.active === false, 'finished transition frame should be inactive');
assert(JSON.stringify(finished.frame.euler) === JSON.stringify({ x: 0, y: 0, z: 0 }), 'finished transition euler should reset');
