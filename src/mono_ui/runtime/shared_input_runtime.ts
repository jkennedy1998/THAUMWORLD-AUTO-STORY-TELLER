import { debug_log, DEBUG_LEVEL } from '../../shared/debug.js';
import { record_input_reset, record_input_transition } from '../../shared/movement_debug_state.js';

export type PlayerId = string;
export type ChannelId = string;
export type DeviceId = string;

export type ActionName =
  | 'move_up'
  | 'move_down'
  | 'move_left'
  | 'move_right'
  | 'jump'
  | 'cancel';

export type ActionState = {
  down: boolean;
  down_seq: number;
};

export type ActionStateSnapshot = Record<ActionName, ActionState>;
export type InputRuntimeSnapshot = {
  player_id: PlayerId;
  actions: ActionStateSnapshot;
  move_intent: MoveIntent;
  revision: number;
};

export type InputContext = {
  typing: boolean;
  player_id?: PlayerId;
  channel_id?: ChannelId;
  device_id?: DeviceId;
  window_focused?: boolean;
  active_element_id?: string | null;
  focused_owner_id?: string | null;
};

export type MoveIntent = { dx: number; dy: number } | null;

export type MoveIntentChangeMeta = {
  source: 'keydown' | 'keyup' | 'reset';
  kind: 'press' | 'release' | 'replace';
  action: ActionName | null;
  code: string | null;
  input_seq: number;
  player_id: PlayerId;
};

export type InputBindingsConfig = {
  keyboard: Record<string, ActionName>;
};

export type RawKeyboardInputEvent = {
  code: string;
  key: string;
  repeat: boolean;
  is_trusted: boolean;
  player_id: PlayerId;
  channel_id: ChannelId;
  device_id: DeviceId;
  typing: boolean;
  window_focused: boolean;
  active_element_id: string | null;
  focused_owner_id: string | null;
};

type InternalKeyState = {
  down: boolean;
};

type PlayerInputState = {
  action_states: Record<ActionName, ActionState>;
  key_states: Map<string, InternalKeyState>;
  global_seq: number;
  global_input_seq: number;
  current_move_action: ActionName | null;
  last_emitted_intent_key: string;
  last_transition_log_ms: number;
  revision: number;
};

const DEFAULT_PLAYER_ID = 'player_1';
const DEFAULT_CHANNEL_ID = 'local_keyboard_mouse';
const DEFAULT_DEVICE_ID = 'electron_keyboard';
const DEFAULT_INPUT_BINDINGS: InputBindingsConfig = {
  keyboard: {
    KeyW: 'move_up',
    KeyS: 'move_down',
    KeyA: 'move_left',
    KeyD: 'move_right',
    Space: 'jump',
    Escape: 'cancel',
  },
};

function create_action_states(): Record<ActionName, ActionState> {
  return {
    move_up: { down: false, down_seq: 0 },
    move_down: { down: false, down_seq: 0 },
    move_left: { down: false, down_seq: 0 },
    move_right: { down: false, down_seq: 0 },
    jump: { down: false, down_seq: 0 },
    cancel: { down: false, down_seq: 0 },
  };
}

function clone_action_states(states: Record<ActionName, ActionState>): ActionStateSnapshot {
  return {
    move_up: { ...states.move_up },
    move_down: { ...states.move_down },
    move_left: { ...states.move_left },
    move_right: { ...states.move_right },
    jump: { ...states.jump },
    cancel: { ...states.cancel },
  };
}

function move_intent_key(intent: MoveIntent): string {
  if (!intent) return 'none';
  return `${intent.dx},${intent.dy}`;
}

function is_directional_action(action: ActionName | null): action is 'move_up' | 'move_down' | 'move_left' | 'move_right' {
  return action === 'move_up' || action === 'move_down' || action === 'move_left' || action === 'move_right';
}

export class SharedInputRuntime {
  private bindings: InputBindingsConfig;
  private readonly move_intent_listeners = new Set<(intent: MoveIntent, meta: MoveIntentChangeMeta) => void>();
  private readonly players = new Map<PlayerId, PlayerInputState>();

  constructor(bindings?: InputBindingsConfig) {
    this.bindings = bindings ? { keyboard: { ...bindings.keyboard } } : { keyboard: { ...DEFAULT_INPUT_BINDINGS.keyboard } };
  }

  configure_bindings(bindings: InputBindingsConfig): void {
    this.bindings = { keyboard: { ...bindings.keyboard } };
  }

  get_bindings(): InputBindingsConfig {
    return { keyboard: { ...this.bindings.keyboard } };
  }

  get_action_for_code(code: string): ActionName | null {
    return this.bindings.keyboard[String(code ?? '')] ?? null;
  }

  subscribe_move_intent_changes(listener: (intent: MoveIntent, meta: MoveIntentChangeMeta) => void): () => void {
    this.move_intent_listeners.add(listener);
    return () => {
      this.move_intent_listeners.delete(listener);
    };
  }

  ingest_keydown(ev: RawKeyboardInputEvent): void {
    const action = this.get_action_for_code(ev.code);
    if (!action) return;
    const player = this.get_or_create_player(ev.player_id);

    if (ev.typing && action !== 'cancel') {
      try {
        debug_log('INPUT_DEBUG', `shared runtime suppressed keydown by typing gate ${JSON.stringify({
          player_id: ev.player_id,
          code: ev.code,
          key: ev.key,
          action,
          repeat: ev.repeat,
          is_trusted: ev.is_trusted,
        })}`);
      } catch {
        // ignore
      }
      return;
    }

    const keyState = this.get_or_create_key_state(player, ev.code);
    keyState.down = true;

    const state = player.action_states[action];
    const was_down = state.down;
    if (was_down) {
      if (is_directional_action(action)) {
        player.current_move_action = action;
      }
      return;
    }
    if (!was_down) {
      player.global_seq += 1;
      player.global_input_seq += 1;
      state.down_seq = player.global_seq;
      player.revision += 1;
    }
    state.down = true;
    if (is_directional_action(action)) {
      player.current_move_action = action;
    }

    if (!was_down) {
      record_input_transition(action, ev.code, true, ev.typing);
      this.emit_move_intent_if_changed(player, {
        source: 'keydown',
        kind: 'press',
        action,
        code: ev.code,
        input_seq: player.global_input_seq,
        player_id: ev.player_id,
      });
    }

    if (!was_down && DEBUG_LEVEL >= 3) {
      const now = Date.now();
      if (now - player.last_transition_log_ms > 25) {
        player.last_transition_log_ms = now;
        try {
          debug_log('MOVE_UNIFY_TEST', `input action down ${JSON.stringify({ code: ev.code, key: ev.key, action, seq: state.down_seq, typing: ev.typing, actions: clone_action_states(player.action_states) })}`);
        } catch {
          // ignore
        }
      }
    }
  }

  ingest_keyup(ev: RawKeyboardInputEvent): void {
    const action = this.get_action_for_code(ev.code);
    if (!action) return;
    const player = this.get_or_create_player(ev.player_id);
    const keyState = this.get_or_create_key_state(player, ev.code);
    keyState.down = false;
    if (player.current_move_action === action) {
      player.current_move_action = this.pick_fallback_move_action(player, action);
    }
    this.apply_release(player, ev, action, 'keyup');
  }

  reset_all(player_id: PlayerId = DEFAULT_PLAYER_ID): void {
    const player = this.get_or_create_player(player_id);
    record_input_reset();
    for (const action of Object.keys(player.action_states) as ActionName[]) {
      player.action_states[action].down = false;
      player.action_states[action].down_seq = 0;
    }
    player.key_states.clear();
    player.global_input_seq += 1;
    player.current_move_action = null;
    player.last_emitted_intent_key = 'none';
    player.revision += 1;
    this.emit_move_intent_if_changed(player, {
      source: 'reset',
      kind: 'release',
      action: null,
      code: null,
      input_seq: player.global_input_seq,
      player_id,
    }, true);
  }

  get_actions(player_id: PlayerId = DEFAULT_PLAYER_ID): ActionStateSnapshot {
    return clone_action_states(this.get_or_create_player(player_id).action_states);
  }

  get_snapshot(player_id: PlayerId = DEFAULT_PLAYER_ID): InputRuntimeSnapshot {
    const player = this.get_or_create_player(player_id);
    return {
      player_id,
      actions: clone_action_states(player.action_states),
      move_intent: this.get_move_intent(player_id),
      revision: player.revision,
    };
  }

  is_down(action: ActionName, player_id: PlayerId = DEFAULT_PLAYER_ID): boolean {
    return this.get_or_create_player(player_id).action_states[action]?.down ?? false;
  }

  get_move_intent(player_id: PlayerId = DEFAULT_PLAYER_ID): MoveIntent {
    const actions = this.get_or_create_player(player_id).action_states;
    const player = this.get_or_create_player(player_id);
    let winner: ActionName | null = player.current_move_action;
    if (!is_directional_action(winner) || !actions[winner].down) {
      winner = this.pick_fallback_move_action(player, winner);
      player.current_move_action = winner;
    }
    switch (winner) {
      case 'move_up': return { dx: 0, dy: 1 };
      case 'move_down': return { dx: 0, dy: -1 };
      case 'move_left': return { dx: -1, dy: 0 };
      case 'move_right': return { dx: 1, dy: 0 };
      default: return null;
    }
  }

  private apply_release(player: PlayerInputState, ev: RawKeyboardInputEvent, action: ActionName, source: 'keyup'): void {
    const state = player.action_states[action];
    const was_down = state.down;
    if (!was_down) {
      try {
        debug_log('INPUT_DEBUG', `shared runtime saw keyup for action already up ${JSON.stringify({
          player_id: ev.player_id,
          code: ev.code,
          key: ev.key,
          action,
          typing: ev.typing,
          source,
        })}`);
      } catch {
        // ignore
      }
      return;
    }
    player.global_input_seq += 1;
    state.down = false;
    player.revision += 1;
    record_input_transition(action, ev.code, false, ev.typing);
    this.emit_move_intent_if_changed(player, {
      source,
      kind: this.get_move_intent(ev.player_id) ? 'replace' : 'release',
      action,
      code: ev.code,
      input_seq: player.global_input_seq,
      player_id: ev.player_id,
    });

    if (DEBUG_LEVEL >= 3) {
      const now = Date.now();
      if (now - player.last_transition_log_ms > 25) {
        player.last_transition_log_ms = now;
        try {
          debug_log('MOVE_UNIFY_TEST', `input action up ${JSON.stringify({ code: ev.code, key: ev.key, action, typing: ev.typing, actions: clone_action_states(player.action_states) })}`);
        } catch {
          // ignore
        }
      }
    }
  }

  private emit_move_intent_if_changed(player: PlayerInputState, meta: MoveIntentChangeMeta, force = false): void {
    const intent = this.get_move_intent(meta.player_id);
    const next_key = move_intent_key(intent);
    if (!force && next_key === player.last_emitted_intent_key) return;
    player.last_emitted_intent_key = next_key;
    for (const listener of this.move_intent_listeners) {
      try {
        listener(intent, meta);
      } catch {
        // ignore listener failures
      }
    }
  }

  private get_or_create_player(player_id: PlayerId): PlayerInputState {
    let player = this.players.get(player_id);
    if (player) return player;
    player = {
      action_states: create_action_states(),
      key_states: new Map(),
      global_seq: 0,
      global_input_seq: 0,
      current_move_action: null,
      last_emitted_intent_key: 'none',
      last_transition_log_ms: 0,
      revision: 0,
    };
    this.players.set(player_id, player);
    return player;
  }

  private get_or_create_key_state(player: PlayerInputState, code: string): InternalKeyState {
    let state = player.key_states.get(code);
    if (state) return state;
    state = { down: false };
    player.key_states.set(code, state);
    return state as InternalKeyState;
  }

  private pick_fallback_move_action(player: PlayerInputState, excluding: ActionName | null): ActionName | null {
    let winner: ActionName | null = null;
    let winner_seq = -1;
    for (const action of ['move_up', 'move_down', 'move_left', 'move_right'] as const) {
      if (action === excluding) continue;
      const state = player.action_states[action];
      if (!state.down) continue;
      if (state.down_seq > winner_seq) {
        winner = action;
        winner_seq = state.down_seq;
      }
    }
    return winner;
  }

}

export const shared_input_runtime = new SharedInputRuntime(DEFAULT_INPUT_BINDINGS);

export function default_input_context(partial?: Partial<InputContext>): Required<InputContext> {
  return {
    typing: partial?.typing ?? false,
    player_id: partial?.player_id ?? DEFAULT_PLAYER_ID,
    channel_id: partial?.channel_id ?? DEFAULT_CHANNEL_ID,
    device_id: partial?.device_id ?? DEFAULT_DEVICE_ID,
    window_focused: partial?.window_focused ?? true,
    active_element_id: partial?.active_element_id ?? null,
    focused_owner_id: partial?.focused_owner_id ?? null,
  };
}
