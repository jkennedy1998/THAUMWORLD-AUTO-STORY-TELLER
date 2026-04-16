import type {
  ActionName,
  ActionStateSnapshot,
  InputBindingsConfig,
  InputContext,
  InputRuntimeSnapshot,
  MoveIntent,
  MoveIntentChangeMeta,
} from './shared_input_runtime.js';
import { default_input_context } from './shared_input_runtime.js';
import type { InputWorkerRequest, InputWorkerResponse } from './input_worker_protocol.js';
import {
  record_input_transition,
  record_intent_post_result,
  record_intent_post_started,
  record_intent_server_accept,
} from '../../shared/movement_debug_state.js';

export type {
  ActionName,
  ActionState,
  ActionStateSnapshot,
  InputBindingsConfig,
  InputContext,
  MoveIntent,
  MoveIntentChangeMeta,
  PlayerId,
  ChannelId,
  DeviceId,
  InputRuntimeSnapshot,
} from './shared_input_runtime.js';

const DEFAULT_BINDINGS: InputBindingsConfig = {
  keyboard: {
    KeyW: 'move_up',
    KeyS: 'move_down',
    KeyA: 'move_left',
    KeyD: 'move_right',
    Space: 'jump',
    Escape: 'cancel',
  },
};

const EMPTY_ACTIONS: ActionStateSnapshot = {
  move_up: { down: false, down_seq: 0 },
  move_down: { down: false, down_seq: 0 },
  move_left: { down: false, down_seq: 0 },
  move_right: { down: false, down_seq: 0 },
  jump: { down: false, down_seq: 0 },
  cancel: { down: false, down_seq: 0 },
};

let current_bindings: InputBindingsConfig = { keyboard: { ...DEFAULT_BINDINGS.keyboard } };
let input_worker: Worker | null = null;
let worker_ready = false;
let bridge_ready = false;
let bridge_unsubscribe: (() => void) | null = null;
const cached_snapshots = new Map<string, InputRuntimeSnapshot>();
const consumed_press_seq = new Map<string, Record<string, number>>();
const move_intent_listeners = new Set<(intent: MoveIntent, meta: MoveIntentChangeMeta) => void>();

type ExternalBridgeMessage = InputWorkerResponse
  | {
      type: 'movement_post_started';
      actor_ref: string;
      place_id: string;
      mode: string;
      kind: 'press' | 'release' | 'replace';
      reason: 'change' | 'release';
      input_seq: number;
      dx: number;
      dy: number;
    }
  | {
      type: 'movement_post_result';
      ok: boolean;
      status: number | null;
      error?: string | null;
      actor_ref: string;
      place_id: string;
      input_seq: number;
      kind: string | null;
      dx: number;
      dy: number;
      accepted_breath?: number;
      next_control_breath?: number;
      breaths_per_step?: number;
      move_budget_walk?: number;
      move_debt_walk?: number;
      tap_buffered?: number;
      ms_until_next_eligible_move?: number;
      gate?: string | null;
    };

function ensure_snapshot(player_id = 'player_1'): InputRuntimeSnapshot {
  let snapshot = cached_snapshots.get(player_id);
  if (snapshot) return snapshot;
  snapshot = { player_id, actions: { ...EMPTY_ACTIONS }, move_intent: null, revision: 0 };
  cached_snapshots.set(player_id, snapshot);
  return snapshot;
}

function get_consumed_map(player_id = 'player_1'): Record<string, number> {
  let state = consumed_press_seq.get(player_id);
  if (state) return state;
  state = {};
  consumed_press_seq.set(player_id, state);
  return state;
}

function apply_worker_message(message: ExternalBridgeMessage): void {
  switch (message.type) {
    case 'ready':
    case 'snapshot':
      cached_snapshots.set(message.snapshot.player_id, message.snapshot);
      break;
    case 'move_intent_changed':
      cached_snapshots.set(message.player_id, {
        ...ensure_snapshot(message.player_id),
        move_intent: message.intent,
      });
      if (message.meta.action && message.meta.code) {
        const down = message.meta.source === 'keydown';
        record_input_transition(message.meta.action, message.meta.code, down, false);
      }
      for (const listener of move_intent_listeners) {
        try {
          listener(message.intent, message.meta);
        } catch {
          // ignore
        }
      }
      break;
    case 'movement_post_started':
      record_intent_post_started({
        reason: message.reason,
        kind: message.kind,
        input_seq: message.input_seq,
        actor_ref: message.actor_ref,
        place_id: message.place_id,
        mode: message.mode,
        dx: message.dx,
        dy: message.dy,
      });
      break;
    case 'movement_post_result':
      record_intent_post_result(message.ok, { status: message.status, error: message.error ?? null });
      if (message.ok) {
        record_intent_server_accept({
          input_seq: Math.max(0, Math.floor(Number(message.input_seq) || 0)),
          kind: String(message.kind ?? ''),
          actor_ref: message.actor_ref,
          place_id: message.place_id,
          direction: (Number(message.dx ?? 0) === 0 && Number(message.dy ?? 0) === 0)
            ? null
            : { dx: Number(message.dx ?? 0) || 0, dy: Number(message.dy ?? 0) || 0 },
          accepted_breath: Number(message.accepted_breath ?? 0) || 0,
          next_control_breath: Number(message.next_control_breath ?? 0) || 0,
          breaths_per_step: Number(message.breaths_per_step ?? 0) || 0,
          move_budget_walk: Number(message.move_budget_walk ?? 0) || 0,
          move_debt_walk: Number(message.move_debt_walk ?? 0) || 0,
          tap_buffered: Number(message.tap_buffered ?? 0) || 0,
          ms_until_next_eligible_move: Number(message.ms_until_next_eligible_move ?? 0) || 0,
          gate: typeof message.gate === 'string' ? message.gate : null,
        });
      }
      break;
  }
}

function ensure_worker(): Worker | null {
  if (is_external_bridge_active()) return null;
  if (input_worker) return input_worker;
  if (typeof Worker === 'undefined') return null;
  input_worker = new Worker(new URL('./input_worker.ts', import.meta.url), { type: 'module' });
  input_worker.onmessage = (event: MessageEvent<InputWorkerResponse>) => {
    if (event.data?.type === 'ready') worker_ready = true;
    apply_worker_message(event.data);
  };
  const init: InputWorkerRequest = { type: 'init', bindings: current_bindings };
  input_worker.postMessage(init);
  return input_worker;
}

function is_external_bridge_active(): boolean {
  return (window as Window).electronAPI?.inputHostKind === 'electron_bridge'
    && typeof (window as Window).electronAPI?.gameplayInputSubscribe === 'function';
}

function ensure_external_bridge(): void {
  if (!is_external_bridge_active() || bridge_ready) return;
  bridge_ready = true;
  bridge_unsubscribe = (window as Window).electronAPI?.gameplayInputSubscribe?.((message: ExternalBridgeMessage) => {
    apply_worker_message(message);
  }) ?? null;
  (window as Window).electronAPI?.gameplayInputRequestSnapshot?.('player_1');
}

function post_to_worker(message: InputWorkerRequest): void {
  ensure_external_bridge();
  if (is_external_bridge_active()) return;
  const worker = ensure_worker();
  if (!worker) return;
  worker.postMessage(message);
}

export function configure_input_bindings(bindings: InputBindingsConfig): void {
  current_bindings = { keyboard: { ...bindings.keyboard } };
  ensure_external_bridge();
  post_to_worker({ type: 'configure_bindings', bindings: current_bindings });
}

export function get_input_bindings(): InputBindingsConfig {
  return { keyboard: { ...current_bindings.keyboard } };
}

export function get_action_for_code(code: string): ActionName | null {
  return current_bindings.keyboard[String(code ?? '')] ?? null;
}

export function subscribe_move_intent_changes(listener: (intent: MoveIntent, meta: MoveIntentChangeMeta) => void): () => void {
  move_intent_listeners.add(listener);
  return () => {
    move_intent_listeners.delete(listener);
  };
}

export function handle_keydown(ev: globalThis.KeyboardEvent, ctx: InputContext): void {
  const resolved = default_input_context(ctx);
  post_to_worker({
    type: 'keydown',
    ev: { code: ev.code, key: ev.key, repeat: ev.repeat, is_trusted: ev.isTrusted },
    ctx: resolved,
  });
}

export function handle_keyup(ev: globalThis.KeyboardEvent, ctx: InputContext): void {
  const resolved = default_input_context(ctx);
  post_to_worker({
    type: 'keyup',
    ev: { code: ev.code, key: ev.key, repeat: ev.repeat, is_trusted: ev.isTrusted },
    ctx: resolved,
  });
}

export function reset_all(player_id = 'player_1'): void {
  cached_snapshots.set(player_id, { player_id, actions: { ...EMPTY_ACTIONS }, move_intent: null, revision: 0 });
  consumed_press_seq.delete(player_id);
  ensure_external_bridge();
  if (is_external_bridge_active()) {
    (window as Window).electronAPI?.gameplayInputReset?.(player_id);
    return;
  }
  post_to_worker({ type: 'reset', player_id });
}

export function get_actions(player_id = 'player_1'): ActionStateSnapshot {
  return ensure_snapshot(player_id).actions;
}

export function is_down(action: ActionName, player_id = 'player_1'): boolean {
  return ensure_snapshot(player_id).actions[action]?.down ?? false;
}

export function get_move_intent(player_id = 'player_1'): MoveIntent {
  return ensure_snapshot(player_id).move_intent;
}

export function is_jump_down(player_id = 'player_1'): boolean {
  return is_down('jump', player_id);
}

export function was_pressed(action: ActionName, player_id = 'player_1'): boolean {
  const snapshot = ensure_snapshot(player_id);
  const consumed = get_consumed_map(player_id)[action] ?? 0;
  return (snapshot.actions[action]?.down_seq ?? 0) > consumed;
}

export function consume_press(action: ActionName, player_id = 'player_1'): boolean {
  if (!was_pressed(action, player_id)) return false;
  const snapshot = ensure_snapshot(player_id);
  get_consumed_map(player_id)[action] = snapshot.actions[action]?.down_seq ?? 0;
  return true;
}

if (is_external_bridge_active()) {
  ensure_external_bridge();
} else {
  ensure_worker();
}
