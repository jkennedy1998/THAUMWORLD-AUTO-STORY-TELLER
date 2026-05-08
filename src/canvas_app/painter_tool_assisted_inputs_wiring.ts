import { create_realtime_clock_source } from '../mono_ui/runtime/automation_clock_realtime.js';
import { create_tool_assisted_inputs_keyboard_driver_electron } from '../mono_ui/runtime/automation_keyboard_driver_electron.js';
import { create_tool_assisted_inputs_keyboard_driver_shared_runtime } from '../mono_ui/runtime/automation_keyboard_driver_shared_runtime.js';
import { create_tool_assisted_inputs_pointer_driver_runtime } from '../mono_ui/runtime/automation_pointer_driver_runtime.js';
import { create_tool_assisted_inputs_runtime } from '../mono_ui/runtime/automation_runtime.js';
import { create_tool_assisted_inputs_script_repository_local } from '../mono_ui/runtime/automation_script_repository_local.js';
import { create_tool_assisted_inputs_trace_sink } from '../mono_ui/runtime/automation_trace.js';
import type { ToolAssistedInputsJoinSnapshot } from '../mono_ui/runtime/automation_interfaces.js';
import { clone_appearance_slot_assignments, type GridCell, type ToolType } from '../ascii_painter/types.js';

type PainterToolAssistedInputsWiringOptions = {
  data_slot: number;
  get_tool_state: () => { current_tool: ToolType; left_click_tool: ToolType; right_click_tool: ToolType };
  get_focus_plane: () => number | null;
  get_camera_target: () => { x: number; y: number; z: number } | null;
  get_bounds: () => { width: number; height: number; minZ: number; maxZ: number };
  get_interaction_anchor: () => any;
  get_cell: (x: number, y: number, z?: number | null) => GridCell | null;
  get_join_snapshot?: () => ToolAssistedInputsJoinSnapshot | null;
  get_text_value?: (source: string, field?: string | null) => string | null;
  invoke_helper?: (helper: string, payload?: Record<string, unknown>) => Promise<unknown> | unknown;
};

export function create_painter_tool_assisted_inputs_wiring(options: PainterToolAssistedInputsWiringOptions): {
  runtime: ReturnType<typeof create_tool_assisted_inputs_runtime>;
  clock: ReturnType<typeof create_realtime_clock_source>;
} {
  const clock = create_realtime_clock_source();
  clock.start();
  const runtime = create_tool_assisted_inputs_runtime({
    script_repository: create_tool_assisted_inputs_script_repository_local(options.data_slot),
    bootstrap: {
      async ensure_ready() {
        return { session_token: 'painter_ready', actor_ref: null, place_id: 'ascii_painter' };
      },
      get_current_context() {
        return { session_token: 'painter_ready', actor_ref: null, place_id: 'ascii_painter' };
      },
    },
    clock_source: clock,
    keyboard_driver: (window as Window).electronAPI?.toolAssistedInputsSendKeyboardEvent
      ? create_tool_assisted_inputs_keyboard_driver_electron()
      : create_tool_assisted_inputs_keyboard_driver_shared_runtime(),
    pointer_driver: create_tool_assisted_inputs_pointer_driver_runtime(),
    runtime_probe: {
      get_current_actor_tile: () => null,
      get_movement_trace: () => null,
      get_visible_step: () => null,
      get_join_snapshot: () => options.get_join_snapshot?.() ?? null,
      get_painter_tool_state: () => {
        const state = options.get_tool_state();
        return {
          current_tool: state.current_tool,
          left_click_tool: state.left_click_tool,
          right_click_tool: state.right_click_tool,
        };
      },
      get_painter_focus_plane: () => options.get_focus_plane(),
      get_painter_camera_target: () => options.get_camera_target(),
      get_painter_bounds: () => {
        const bounds = options.get_bounds();
        return {
          width: bounds.width,
          height: bounds.height,
          min_z: bounds.minZ,
          max_z: bounds.maxZ,
        };
      },
      get_painter_interaction_anchor: () => {
        const anchor = options.get_interaction_anchor();
        return {
          kind: typeof anchor?.kind === 'string' ? anchor.kind : null,
          focus_world_plane: typeof anchor?.focus_world_plane === 'number' ? anchor.focus_world_plane : null,
          world: anchor?.world ? { x: anchor.world.x, y: anchor.world.y, z: anchor.world.z } : null,
          grid: anchor?.grid ? { x: anchor.grid.x, y: anchor.grid.y } : null,
          screen: anchor?.screen ? { x: anchor.screen.x, y: anchor.screen.y } : null,
        };
      },
      get_painter_cell: (x, y, z) => {
        const cell = options.get_cell(x, y, z);
        if (!cell) return null;
        return {
          x,
          y,
          z: typeof z === 'number' ? z : (options.get_focus_plane() ?? 0),
          char: cell.char,
          graphic: cell.graphic ? { ...cell.graphic } : undefined,
          appearance_slots: clone_appearance_slot_assignments(cell.appearance_slots),
          materials: cell.materials ? { ...cell.materials } : undefined,
          rgb: { ...cell.rgb },
          weight_index: cell.weight_index,
          render_index: cell.render_index,
        };
      },
      get_text_value: (source, field) => options.get_text_value?.(source, field) ?? null,
      invoke_helper: (helper, payload) => options.invoke_helper?.(helper, payload),
    },
    trace_sink: create_tool_assisted_inputs_trace_sink(),
  });
  return { runtime, clock };
}
