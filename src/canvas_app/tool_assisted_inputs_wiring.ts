import type { Place } from '../types/place.js';
import type { ActorClaimEntry } from '../mono_ui/modules/actor_claim_module.js';
import { get_movement_debug_snapshot } from '../shared/movement_debug_state.js';
import type { ToolAssistedInputsJoinSnapshot } from '../mono_ui/runtime/automation_interfaces.js';
import { create_thaumworld_bootstrap_adapter } from './automation_boot_thaumworld.js';
import { create_place_breath_clock_source } from '../mono_ui/runtime/automation_clock_place_breath.js';
import { create_tool_assisted_inputs_keyboard_driver_electron } from '../mono_ui/runtime/automation_keyboard_driver_electron.js';
import { create_tool_assisted_inputs_keyboard_driver_shared_runtime } from '../mono_ui/runtime/automation_keyboard_driver_shared_runtime.js';
import { create_tool_assisted_inputs_pointer_driver_runtime } from '../mono_ui/runtime/automation_pointer_driver_runtime.js';
import { create_tool_assisted_inputs_runtime } from '../mono_ui/runtime/automation_runtime.js';
import { create_tool_assisted_inputs_script_repository_local } from '../mono_ui/runtime/automation_script_repository_local.js';
import { create_tool_assisted_inputs_trace_sink } from '../mono_ui/runtime/automation_trace.js';

type ToolAssistedInputsWiringOptions = {
  data_slot: number;
  ensure_multiplayer_session_bootstrap: (force?: boolean) => Promise<void>;
  resolve_controlled_actor_binding: (force?: boolean) => Promise<{ kind: 'bound' | 'unbound' | 'binding_required'; error?: string | null }>;
  refresh_actor_claim_state: (status_lines?: string[]) => Promise<void>;
  claim_actor: (actor_ref: string) => Promise<void>;
  claim_actor_by_id: (actor_id: string) => Promise<{ ok: boolean; reason?: string }>;
  get_actor_claim_entries: () => ActorClaimEntry[];
  get_session_token: () => string | null;
  get_current_actor_ref: () => string | null;
  get_current_place: () => Place | null;
  get_current_actor_tile: () => { x: number; y: number; z: number } | null;
  get_join_snapshot: () => ToolAssistedInputsJoinSnapshot | null;
  get_text_value: (source: string, field?: string | null) => string | null;
  invoke_helper: (helper: string, payload?: Record<string, unknown>) => Promise<unknown> | unknown;
};

export function create_tool_assisted_inputs_wiring(options: ToolAssistedInputsWiringOptions): {
  runtime: ReturnType<typeof create_tool_assisted_inputs_runtime>;
  clock: ReturnType<typeof create_place_breath_clock_source>;
} {
  const clock = create_place_breath_clock_source();
  const runtime = create_tool_assisted_inputs_runtime({
    script_repository: create_tool_assisted_inputs_script_repository_local(options.data_slot),
    bootstrap: create_thaumworld_bootstrap_adapter({
      ensure_multiplayer_session_bootstrap: options.ensure_multiplayer_session_bootstrap,
      resolve_controlled_actor_binding: options.resolve_controlled_actor_binding,
      refresh_actor_claim_state: options.refresh_actor_claim_state,
      claim_actor: options.claim_actor,
      claim_actor_by_id: options.claim_actor_by_id,
      get_actor_claim_entries: options.get_actor_claim_entries,
      get_current_context: () => ({
        session_token: options.get_session_token() || null,
        actor_ref: options.get_current_actor_ref(),
        place_id: options.get_current_place()?.id ?? null,
      }),
    }),
    clock_source: clock,
    keyboard_driver: (window as Window).electronAPI?.toolAssistedInputsSendKeyboardEvent
      ? create_tool_assisted_inputs_keyboard_driver_electron()
      : create_tool_assisted_inputs_keyboard_driver_shared_runtime(),
    pointer_driver: create_tool_assisted_inputs_pointer_driver_runtime(),
    runtime_probe: {
      get_current_actor_tile: () => options.get_current_actor_tile(),
      get_join_snapshot: () => options.get_join_snapshot(),
      get_movement_trace: () => {
        const snapshot = get_movement_debug_snapshot();
        const trace = snapshot.responsiveness_trace;
        return {
          input_seq: trace.input_seq,
          kind: trace.kind,
          direction: trace.direction ? { dx: trace.direction.dx, dy: trace.direction.dy } : null,
          actor_ref: trace.actor_ref,
          place_id: trace.place_id,
          accepted_breath: trace.accepted_breath,
          next_control_breath: trace.next_control_breath,
          breaths_per_step: trace.breaths_per_step,
          move_budget_walk: trace.move_budget_walk,
          move_debt_walk: trace.move_debt_walk,
          tap_buffered: trace.tap_buffered,
          ms_until_next_eligible_move: trace.ms_until_next_eligible_move,
          gate: trace.gate,
          stage: trace.stage,
          input_to_visible_ms: trace.input_to_visible_ms,
          accept_to_visible_ms: trace.accept_to_visible_ms,
        };
      },
      get_visible_step: () => {
        const snapshot = get_movement_debug_snapshot();
        return {
          actor_ref: snapshot.last_visible_step_actor_ref,
          place_id: snapshot.last_visible_step_place_id,
          breath_index: snapshot.last_visible_step_breath_index,
          seq: snapshot.last_visible_step_seq,
          position: snapshot.last_visible_step_position
            ? {
              x: snapshot.last_visible_step_position.x,
              y: snapshot.last_visible_step_position.y,
              z: snapshot.last_visible_step_position.z ?? 0,
            }
          : null,
        };
      },
      get_text_value: (source, field) => options.get_text_value(source, field),
      invoke_helper: (helper, payload) => options.invoke_helper(helper, payload),
    },
    trace_sink: create_tool_assisted_inputs_trace_sink(),
  });
  return { runtime, clock };
}
