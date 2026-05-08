import type { AutomationClockMode, AutomationClockSource } from './automation_clock_types.js';
import type { AppearanceSlotAssignments, GridCell } from '../../ascii_painter/types.js';
export type { AutomationClockMode, AutomationClockSource };

export type ToolAssistedInputsContext = {
  session_token: string | null;
  actor_ref: string | null;
  place_id: string | null;
};

export type ToolAssistedInputsBootOptions = {
  auto_connect?: boolean;
  auto_claim?: boolean;
  actor_ref?: string | null;
  actor_id?: string | null;
};

export type ToolAssistedInputsJoinSnapshot = {
  selected_connection_id: string | null;
  selected_connection_host: string | null;
  selected_connection_kind: string | null;
  probe_status: string | null;
  supports_join: boolean;
  join_mode: string | null;
  world_label: string | null;
  painter_document_id: string | null;
  api_base_url: string | null;
  bridge_ws_base_url: string | null;
  status_lines: string[];
};

export type ToolAssistedInputsTimingProfile = 'fast' | 'human' | 'slow_debug';

export type ToolAssistedInputsTraceEvent =
  | 'run_header'
  | 'script_loaded'
  | 'boot_started'
  | 'boot_ready'
  | 'waiting_start_delay'
  | 'breath_zero'
  | 'action_fired'
  | 'action_skipped'
  | 'action_failed'
  | 'run_summary'
  | 'completed'
  | 'failed'
  | 'stopped';

export type ToolAssistedInputsTile = {
  x: number;
  y: number;
  z: number;
};

export type ToolAssistedInputsMovementTrace = {
  input_seq: number;
  kind: string | null;
  direction: { dx: number; dy: number } | null;
  actor_ref: string | null;
  place_id: string | null;
  accepted_breath: number;
  next_control_breath: number;
  breaths_per_step: number;
  move_budget_walk: number;
  move_debt_walk: number;
  tap_buffered: number;
  ms_until_next_eligible_move: number;
  gate: string | null;
  stage: string;
  input_to_visible_ms: number;
  accept_to_visible_ms: number;
};

export type ToolAssistedInputsVisibleStep = {
  actor_ref: string | null;
  place_id: string | null;
  breath_index: number;
  seq: number | null;
  position: ToolAssistedInputsTile | null;
};

export type ToolAssistedInputsPainterToolState = {
  current_tool: string | null;
  left_click_tool: string | null;
  right_click_tool: string | null;
};

export type ToolAssistedInputsPainterInteractionAnchor = {
  kind: string | null;
  focus_world_plane: number | null;
  world: ToolAssistedInputsTile | null;
  grid: { x: number; y: number } | null;
  screen: { x: number; y: number } | null;
};

export type ToolAssistedInputsPainterCell = {
  x: number;
  y: number;
  z: number;
  char: string;
  graphic?: GridCell['graphic'];
  appearance_slots?: AppearanceSlotAssignments;
  materials?: GridCell['materials'];
  rgb: { r: number; g: number; b: number };
  weight_index: number;
  render_index?: number;
};

export type ToolAssistedInputsPainterBounds = {
  width: number;
  height: number;
  min_z: number;
  max_z: number;
};

export type ToolAssistedInputsPointerActionName = 'primary' | 'secondary' | 'auxiliary';

export type ToolAssistedInputsPointerBase = {
  at_breath: number;
  space: 'grid';
  x: number;
  y: number;
  pointer_action?: ToolAssistedInputsPointerActionName;
  button?: number;
  pointer_type?: 'mouse' | 'pen' | 'touch';
  pressure?: number;
  shift?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  meta?: boolean;
};

export type ToolAssistedInputsKeyboardAction =
  | { at_breath: number; type: 'key_down'; code: string; key?: string; shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean }
  | { at_breath: number; type: 'key_up'; code: string; key?: string; shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean }
  | { at_breath: number; type: 'key_tap'; code: string; key?: string; hold_ms?: number; shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean }
  | { at_breath: number; type: 'text_input'; text: string };

export type ToolAssistedInputsScriptAction =
  | { at_breath: number; type: 'assert_context_ready' }
  | { at_breath: number; type: 'marker'; label: string }
  | { at_breath: number; type: 'invoke_helper'; helper: string; payload?: Record<string, unknown> }
  | { at_breath: number; type: 'capture_actor_tile'; slot: string }
  | { at_breath: number; type: 'capture_movement_trace'; slot: string }
  | { at_breath: number; type: 'capture_visible_step'; slot: string }
  | { at_breath: number; type: 'capture_text_value'; slot: string; source: string; field?: string }
  | { at_breath: number; type: 'capture_join_snapshot'; slot: string }
  | { at_breath: number; type: 'capture_painter_tool_state'; slot: string }
  | { at_breath: number; type: 'capture_painter_focus_plane'; slot: string }
  | { at_breath: number; type: 'capture_painter_camera_target'; slot: string }
  | { at_breath: number; type: 'capture_painter_bounds'; slot: string }
  | { at_breath: number; type: 'capture_painter_interaction_anchor'; slot: string }
  | { at_breath: number; type: 'capture_painter_cell'; slot: string; x: number; y: number; z?: number }
  | { at_breath: number; type: 'capture_painter_anchor_cell'; slot: string; anchor_slot?: string }
  | { at_breath: number; type: 'assert_movement_trace_ready'; min_input_seq?: number; require_stage?: 'posted' | 'eligible_now' | 'waiting_for_cadence' | 'moved'; require_direction?: boolean; require_gate?: string; max_input_to_visible_ms?: number; max_accept_to_visible_ms?: number }
  | { at_breath: number; type: 'assert_actor_tile_equals'; slot: string }
  | { at_breath: number; type: 'assert_actor_tile_changed'; slot: string }
  | { at_breath: number; type: 'assert_text_value_equals'; slot: string; source: string; field?: string }
  | { at_breath: number; type: 'assert_text_value_changed'; slot: string; source: string; field?: string }
  | { at_breath: number; type: 'assert_text_value_literal'; source: string; field?: string; value: string }
  | { at_breath: number; type: 'wait_for_text_value_literal'; source: string; field?: string; value: string; timeout_ms?: number; poll_ms?: number }
  | { at_breath: number; type: 'assert_painter_primary_tool'; tool: string }
  | { at_breath: number; type: 'assert_painter_secondary_tool'; tool: string }
  | { at_breath: number; type: 'assert_painter_focus_plane'; z: number }
  | { at_breath: number; type: 'assert_painter_anchor_in_bounds'; anchor_slot?: string }
  | { at_breath: number; type: 'assert_painter_cell_changed'; slot: string; x: number; y: number; z?: number }
  | { at_breath: number; type: 'assert_painter_cell_equals'; slot: string; x: number; y: number; z?: number }
  | { at_breath: number; type: 'assert_painter_anchor_cell_changed'; slot: string; anchor_slot?: string }
  | { at_breath: number; type: 'assert_painter_anchor_cell_equals'; slot: string; anchor_slot?: string }
  | ({ type: 'pointer_move' } & ToolAssistedInputsPointerBase)
  | ({ type: 'pointer_down' } & ToolAssistedInputsPointerBase)
  | ({ type: 'pointer_up' } & ToolAssistedInputsPointerBase)
  | ({ type: 'pointer_click' } & ToolAssistedInputsPointerBase)
  | ({ type: 'pointer_double_click' } & ToolAssistedInputsPointerBase)
  | ({ type: 'pointer_context_menu' } & ToolAssistedInputsPointerBase)
  | ({ type: 'wheel'; at_breath: number; space: 'grid'; x: number; y: number; delta_x: number; delta_y: number; shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean })
  | ({ type: 'pointer_drag'; at_breath: number; space: 'grid'; from_x: number; from_y: number; to_x: number; to_y: number; steps?: number; pointer_action?: ToolAssistedInputsPointerActionName; button?: number; pointer_type?: 'mouse' | 'pen' | 'touch'; pressure?: number; shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean })
  | ToolAssistedInputsKeyboardAction;

export type ToolAssistedInputsScript = {
  id?: string;
  test_name: string;
  clock_mode: AutomationClockMode;
  open_ms: number;
  description?: string;
  start_delay_ms: number;
  end_delay_ms: number;
  timing_profile?: ToolAssistedInputsTimingProfile;
  stop_on_error?: boolean;
  boot?: ToolAssistedInputsBootOptions;
  actions: ToolAssistedInputsScriptAction[];
};

export interface AutomationScriptRepository {
  get_autostart_script_ref(): Promise<string | null>;
  set_last_script_ref(script_ref: string): Promise<void> | void;
  load_script(script_ref: string): Promise<{ script: ToolAssistedInputsScript; resolved_ref: string }>;
}

export interface WorldSessionBootstrap {
  ensure_ready(opts?: ToolAssistedInputsBootOptions): Promise<ToolAssistedInputsContext>;
  get_current_context(): ToolAssistedInputsContext;
}

export interface AutomationInputDriver {
  readonly backend_kind: string;
  send_keydown(action: { code: string; key?: string; shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean }): Promise<void> | void;
  send_keyup(action: { code: string; key?: string; shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean }): Promise<void> | void;
  send_text(action: { text: string }): Promise<void> | void;
  reset(): Promise<void> | void;
}

export interface AutomationPointerDriver {
  move(action: ToolAssistedInputsPointerBase): Promise<void> | void;
  down(action: ToolAssistedInputsPointerBase): Promise<void> | void;
  up(action: ToolAssistedInputsPointerBase): Promise<void> | void;
  click(action: ToolAssistedInputsPointerBase, click_count: 1 | 2): Promise<void> | void;
  context_menu(action: ToolAssistedInputsPointerBase): Promise<void> | void;
  drag(action: Extract<ToolAssistedInputsScriptAction, { type: 'pointer_drag' }>): Promise<void> | void;
  wheel(action: Extract<ToolAssistedInputsScriptAction, { type: 'wheel' }>): Promise<void> | void;
}

export interface AutomationRuntimeProbe {
  get_current_actor_tile(): ToolAssistedInputsTile | null;
  get_movement_trace(): ToolAssistedInputsMovementTrace | null;
  get_visible_step(): ToolAssistedInputsVisibleStep | null;
  get_join_snapshot?: () => ToolAssistedInputsJoinSnapshot | null;
  get_text_value?: (source: string, field?: string | null) => string | null;
  invoke_helper?: (helper: string, payload?: Record<string, unknown>) => Promise<unknown> | unknown;
  get_painter_tool_state?: () => ToolAssistedInputsPainterToolState | null;
  get_painter_focus_plane?: () => number | null;
  get_painter_camera_target?: () => ToolAssistedInputsTile | null;
  get_painter_bounds?: () => ToolAssistedInputsPainterBounds | null;
  get_painter_interaction_anchor?: () => ToolAssistedInputsPainterInteractionAnchor | null;
  get_painter_cell?: (x: number, y: number, z?: number | null) => ToolAssistedInputsPainterCell | null;
}

export interface AutomationTraceSink {
  emit(event: ToolAssistedInputsTraceEvent, payload?: Record<string, unknown>): void;
}

export type ToolAssistedInputsStatus = {
  active: boolean;
  state: 'idle' | 'booting' | 'waiting_start_delay' | 'waiting_for_breath_zero' | 'running' | 'completed' | 'failed' | 'stopped';
  script_ref: string | null;
  script_id: string | null;
  backend_kind: string | null;
  breath_zero: number | null;
  last_tick_index: number | null;
  next_action_index: number;
  error: string | null;
};
