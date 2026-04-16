import type {
  ActionName,
  InputBindingsConfig,
  InputContext,
  InputRuntimeSnapshot,
  MoveIntent,
  MoveIntentChangeMeta,
} from './shared_input_runtime.js';

export type InputWorkerRequest =
  | { type: 'init'; bindings: InputBindingsConfig }
  | { type: 'keydown'; ev: { code: string; key: string; repeat: boolean; is_trusted: boolean }; ctx: InputContext }
  | { type: 'keyup'; ev: { code: string; key: string; repeat: boolean; is_trusted: boolean }; ctx: InputContext }
  | { type: 'reset'; player_id?: string }
  | { type: 'configure_bindings'; bindings: InputBindingsConfig }
  | { type: 'request_snapshot'; player_id?: string };

export type InputWorkerResponse =
  | { type: 'snapshot'; snapshot: InputRuntimeSnapshot }
  | { type: 'move_intent_changed'; player_id: string; intent: MoveIntent; meta: MoveIntentChangeMeta }
  | { type: 'ready'; snapshot: InputRuntimeSnapshot };

export type ConsumablePressState = Record<ActionName, number>;
