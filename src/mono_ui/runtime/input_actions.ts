/**
 * Input Actions Layer
 * 
 * Maintains a single authoritative "desired actions" state.
 * Keyboard events mutate this state via a mapping table.
 * Game systems read action states, not raw key events.
 * 
 * This removes reliance on event timing and makes input consistent
 * regardless of breath alignment, focus changes, or key repeat.
 */

import { debug_log, DEBUG_LEVEL } from '../../shared/debug.js';
import { record_input_reset, record_input_transition } from '../../shared/movement_debug_state.js';

export type ActionName = 
  | 'move_up' 
  | 'move_down' 
  | 'move_left' 
  | 'move_right'
  | 'jump';

export type ActionState = {
  down: boolean;
  down_seq: number; // monotonic counter for "last press wins"
};

export type ActionStateSnapshot = Record<ActionName, ActionState>;

export type InputContext = {
  typing: boolean;
};

export type MoveIntent = { dx: number; dy: number } | null;
export type MoveIntentChangeMeta = {
  source: 'keydown' | 'keyup' | 'reset';
  action: ActionName | null;
  code: string | null;
};

type KeyMapping = Record<string, ActionName>;

// Default mapping: KeyboardEvent.code -> action
// Users can rebind these later.
const DEFAULT_MAPPING: KeyMapping = {
  'KeyW': 'move_up',
  'KeyS': 'move_down',
  'KeyA': 'move_left',
  'KeyD': 'move_right',
  'Space': 'jump',
};

// Internal state
const action_states: Record<ActionName, ActionState> = {
  move_up:    { down: false, down_seq: 0 },
  move_down:  { down: false, down_seq: 0 },
  move_left:  { down: false, down_seq: 0 },
  move_right: { down: false, down_seq: 0 },
  jump:       { down: false, down_seq: 0 },
};

let global_seq = 0;
let last_emitted_intent_key = 'none';
const move_intent_listeners = new Set<(intent: MoveIntent, meta: MoveIntentChangeMeta) => void>();

let last_transition_log_ms = 0;

function snapshot_move_actions(): any {
  // Keep payload small and stable.
  return {
    move_up: { down: action_states.move_up.down, down_seq: action_states.move_up.down_seq },
    move_down: { down: action_states.move_down.down, down_seq: action_states.move_down.down_seq },
    move_left: { down: action_states.move_left.down, down_seq: action_states.move_left.down_seq },
    move_right: { down: action_states.move_right.down, down_seq: action_states.move_right.down_seq },
    jump: { down: action_states.jump.down, down_seq: action_states.jump.down_seq },
  };
}

function intent_key(intent: MoveIntent): string {
  if (!intent) return 'none';
  return `${intent.dx},${intent.dy}`;
}

function emit_move_intent_if_changed(meta: MoveIntentChangeMeta): void {
  const intent = get_move_intent();
  const next_key = intent_key(intent);
  if (next_key === last_emitted_intent_key) return;
  last_emitted_intent_key = next_key;
  for (const listener of move_intent_listeners) {
    try {
      listener(intent, meta);
    } catch {
      // ignore listener failures
    }
  }
}

export function subscribe_move_intent_changes(listener: (intent: MoveIntent, meta: MoveIntentChangeMeta) => void): () => void {
  move_intent_listeners.add(listener);
  return () => {
    move_intent_listeners.delete(listener);
  };
}

/**
 * Handle keydown event - update action state via mapping
 */
export function handle_keydown(ev: KeyboardEvent, ctx: InputContext): void {
  const action = DEFAULT_MAPPING[ev.code];
  if (!action) return;

  // Don't activate movement while typing into an input
  if (ctx.typing && action !== 'jump') return;

  const state = action_states[action];

  // Only update sequence on fresh press (false -> true)
  const was_down = state.down;
  if (!was_down) {
    global_seq++;
    state.down_seq = global_seq;
  }
  
  state.down = true;

  if (!was_down) {
    record_input_transition(action, ev.code, true, ctx.typing);
    emit_move_intent_if_changed({ source: 'keydown', action, code: ev.code });
  }

  if (!was_down && DEBUG_LEVEL >= 3) {
    const now = Date.now();
    // Throttle transition logs a bit to avoid accidental spam.
    if (now - last_transition_log_ms > 25) {
      last_transition_log_ms = now;
      try {
        debug_log('MOVE_UNIFY_TEST', `input action down ${JSON.stringify({ code: ev.code, key: ev.key, action, seq: state.down_seq, typing: ctx.typing, actions: snapshot_move_actions() })}`);
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Handle keyup event - clear action state
 */
export function handle_keyup(ev: KeyboardEvent, ctx: InputContext): void {
  const action = DEFAULT_MAPPING[ev.code];
  if (!action) return;

  // Always clear on keyup, even while typing (prevents stuck state)
  const state = action_states[action];
  const was_down = state.down;
  state.down = false;

  if (was_down) {
    record_input_transition(action, ev.code, false, ctx.typing);
    emit_move_intent_if_changed({ source: 'keyup', action, code: ev.code });
  }

  if (was_down && DEBUG_LEVEL >= 3) {
    const now = Date.now();
    if (now - last_transition_log_ms > 25) {
      last_transition_log_ms = now;
      try {
        debug_log('MOVE_UNIFY_TEST', `input action up ${JSON.stringify({ code: ev.code, key: ev.key, action, typing: ctx.typing, actions: snapshot_move_actions() })}`);
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Reset all action states (call on window blur/visibilitychange)
 */
export function reset_all(): void {
  record_input_reset();
  if (DEBUG_LEVEL >= 3) {
    try {
      debug_log('MOVE_UNIFY_TEST', `input reset_all ${JSON.stringify({ actions: snapshot_move_actions() })}`);
    } catch {
      // ignore
    }
  }
  for (const action of Object.keys(action_states) as ActionName[]) {
    action_states[action].down = false;
    action_states[action].down_seq = 0;
  }
  emit_move_intent_if_changed({ source: 'reset', action: null, code: null });
}

/**
 * Get current state of all actions
 */
export function get_actions(): ActionStateSnapshot {
  return { ...action_states };
}

/**
 * Check if a specific action is down
 */
export function is_down(action: ActionName): boolean {
  return action_states[action]?.down ?? false;
}

/**
 * Get movement intent as a blended directional input.
 * Opposed inputs cancel per axis; orthogonal inputs blend 50/50 for diagonals.
 * Returns: { dx, dy } where dx/dy are -1/0/1, or null if no movement.
 */
export function get_move_intent(): { dx: number; dy: number } | null {
  const up = action_states.move_up;
  const down = action_states.move_down;
  const left = action_states.move_left;
  const right = action_states.move_right;

  // No movement if nothing held
  if (!up.down && !down.down && !left.down && !right.down) {
    return null;
  }

  let dx = 0;
  let dy = 0;

  if (left.down !== right.down) {
    dx = left.down ? -1 : 1;
  }
  if (up.down !== down.down) {
    dy = up.down ? 1 : -1;
  }

  if (dx === 0 && dy === 0) return null;
  return { dx, dy };
}

/**
 * Check if jump is being held down
 */
export function is_jump_down(): boolean {
  return action_states.jump.down;
}
