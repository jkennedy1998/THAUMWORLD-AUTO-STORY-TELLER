import type {
  AutomationInputDriver,
  AutomationPointerDriver,
  AutomationRuntimeProbe,
  ToolAssistedInputsContext,
  ToolAssistedInputsScriptAction,
} from './automation_interfaces.js';

type ActionExecutorOptions = {
  action: ToolAssistedInputsScriptAction;
  action_index: number;
  current_tick: number;
  target_breath: number;
  context: ToolAssistedInputsContext;
  runtime_probe: AutomationRuntimeProbe;
  keyboard_driver: AutomationInputDriver;
  pointer_driver: AutomationPointerDriver;
  capture_store: ReturnType<typeof import('./automation_capture_store.js').create_tool_assisted_inputs_capture_store>;
  diagnostic_report: ReturnType<typeof import('./automation_diagnostic_report.js').create_tool_assisted_inputs_diagnostic_report>;
  emit: (event: 'action_fired' | 'action_failed', payload: Record<string, unknown>) => void;
  mark_action_completed: () => void;
};

export async function execute_tool_assisted_inputs_action(options: ActionExecutorOptions): Promise<boolean> {
  const { action, action_index, current_tick, target_breath, context, runtime_probe, keyboard_driver, pointer_driver, capture_store, diagnostic_report, emit, mark_action_completed } = options;
  try {
    if (action.type === 'assert_context_ready') {
      const ready = Boolean(context.session_token && context.actor_ref && context.place_id);
      if (!ready) throw new Error('tool_assisted_inputs_context_not_ready');
    } else if (action.type === 'invoke_helper') {
      await Promise.resolve(runtime_probe.invoke_helper?.(action.helper, action.payload));
    } else if (action.type === 'marker') {
      // trace only
    } else if (action.type === 'capture_actor_tile') {
      const tile = runtime_probe.get_current_actor_tile();
      if (!tile) {
        diagnostic_report.record_failure({ action_index, action_type: action.type, slot: action.slot, error: 'tool_assisted_inputs_actor_tile_unavailable' });
        emit('action_failed', { action_index, action_type: action.type, target_breath, current_breath: current_tick, slot: action.slot, error: 'tool_assisted_inputs_actor_tile_unavailable', nonfatal: true });
        return true;
      }
      capture_store.set_tile(action.slot, tile);
      emit('action_fired', { action_index, action_type: action.type, target_breath, current_breath: current_tick, late_by: Math.max(0, current_tick - target_breath), actor_ref: context.actor_ref, place_id: context.place_id, slot: action.slot, tile });
      mark_action_completed();
      return true;
    } else if (action.type === 'capture_movement_trace') {
      const trace = runtime_probe.get_movement_trace();
      if (!trace) {
        diagnostic_report.record_failure({ action_index, action_type: action.type, slot: action.slot, error: 'tool_assisted_inputs_movement_trace_unavailable' });
        emit('action_failed', { action_index, action_type: action.type, target_breath, current_breath: current_tick, slot: action.slot, error: 'tool_assisted_inputs_movement_trace_unavailable', nonfatal: true });
        return true;
      }
      capture_store.set_movement_trace(action.slot, trace);
      emit('action_fired', { action_index, action_type: action.type, target_breath, current_breath: current_tick, late_by: Math.max(0, current_tick - target_breath), actor_ref: context.actor_ref, place_id: context.place_id, slot: action.slot, movement_trace: trace });
      mark_action_completed();
      return true;
    } else if (action.type === 'capture_visible_step') {
      const visible_step = runtime_probe.get_visible_step();
      if (!visible_step) {
        diagnostic_report.record_failure({ action_index, action_type: action.type, slot: action.slot, error: 'tool_assisted_inputs_visible_step_unavailable' });
        emit('action_failed', { action_index, action_type: action.type, target_breath, current_breath: current_tick, slot: action.slot, error: 'tool_assisted_inputs_visible_step_unavailable', nonfatal: true });
        return true;
      }
      capture_store.set_visible_step(action.slot, visible_step);
      emit('action_fired', { action_index, action_type: action.type, target_breath, current_breath: current_tick, late_by: Math.max(0, current_tick - target_breath), actor_ref: context.actor_ref, place_id: context.place_id, slot: action.slot, visible_step });
      mark_action_completed();
      return true;
    } else if (action.type === 'capture_text_value') {
      const value = runtime_probe.get_text_value?.(action.source, action.field ?? null) ?? null;
      capture_store.set_text_value(action.slot, value);
      emit('action_fired', { action_index, action_type: action.type, target_breath, current_breath: current_tick, late_by: Math.max(0, current_tick - target_breath), slot: action.slot, source: action.source, field: action.field ?? null, text_value: value });
      mark_action_completed();
      return true;
    } else if (action.type === 'capture_painter_tool_state') {
      const tool_state = runtime_probe.get_painter_tool_state?.() ?? null;
      if (!tool_state) {
        diagnostic_report.record_failure({ action_index, action_type: action.type, slot: action.slot, error: 'tool_assisted_inputs_painter_tool_state_unavailable' });
        emit('action_failed', { action_index, action_type: action.type, target_breath, current_breath: current_tick, slot: action.slot, error: 'tool_assisted_inputs_painter_tool_state_unavailable', nonfatal: true });
        return true;
      }
      capture_store.set_painter_tool_state(action.slot, tool_state);
      emit('action_fired', { action_index, action_type: action.type, target_breath, current_breath: current_tick, late_by: Math.max(0, current_tick - target_breath), slot: action.slot, painter_tool_state: tool_state });
      mark_action_completed();
      return true;
    } else if (action.type === 'capture_painter_focus_plane') {
      const z = runtime_probe.get_painter_focus_plane?.() ?? null;
      if (typeof z !== 'number') {
        diagnostic_report.record_failure({ action_index, action_type: action.type, slot: action.slot, error: 'tool_assisted_inputs_painter_focus_plane_unavailable' });
        emit('action_failed', { action_index, action_type: action.type, target_breath, current_breath: current_tick, slot: action.slot, error: 'tool_assisted_inputs_painter_focus_plane_unavailable', nonfatal: true });
        return true;
      }
      capture_store.set_tile(action.slot, { x: 0, y: 0, z });
      emit('action_fired', { action_index, action_type: action.type, target_breath, current_breath: current_tick, late_by: Math.max(0, current_tick - target_breath), slot: action.slot, focus_plane: z });
      mark_action_completed();
      return true;
    } else if (action.type === 'capture_painter_camera_target') {
      const world = runtime_probe.get_painter_camera_target?.() ?? null;
      if (!world) {
        diagnostic_report.record_failure({ action_index, action_type: action.type, slot: action.slot, error: 'tool_assisted_inputs_painter_camera_target_unavailable' });
        emit('action_failed', { action_index, action_type: action.type, target_breath, current_breath: current_tick, slot: action.slot, error: 'tool_assisted_inputs_painter_camera_target_unavailable', nonfatal: true });
        return true;
      }
      capture_store.set_tile(action.slot, world);
      emit('action_fired', { action_index, action_type: action.type, target_breath, current_breath: current_tick, late_by: Math.max(0, current_tick - target_breath), slot: action.slot, painter_camera_target: world });
      mark_action_completed();
      return true;
    } else if (action.type === 'capture_painter_bounds') {
      const bounds = runtime_probe.get_painter_bounds?.() ?? null;
      if (!bounds) {
        diagnostic_report.record_failure({ action_index, action_type: action.type, slot: action.slot, error: 'tool_assisted_inputs_painter_bounds_unavailable' });
        emit('action_failed', { action_index, action_type: action.type, target_breath, current_breath: current_tick, slot: action.slot, error: 'tool_assisted_inputs_painter_bounds_unavailable', nonfatal: true });
        return true;
      }
      emit('action_fired', { action_index, action_type: action.type, target_breath, current_breath: current_tick, late_by: Math.max(0, current_tick - target_breath), slot: action.slot, painter_bounds: bounds });
      mark_action_completed();
      return true;
    } else if (action.type === 'capture_painter_interaction_anchor') {
      const anchor = runtime_probe.get_painter_interaction_anchor?.() ?? null;
      if (!anchor) {
        diagnostic_report.record_failure({ action_index, action_type: action.type, slot: action.slot, error: 'tool_assisted_inputs_painter_anchor_unavailable' });
        emit('action_failed', { action_index, action_type: action.type, target_breath, current_breath: current_tick, slot: action.slot, error: 'tool_assisted_inputs_painter_anchor_unavailable', nonfatal: true });
        return true;
      }
      capture_store.set_painter_anchor(action.slot, anchor);
      emit('action_fired', { action_index, action_type: action.type, target_breath, current_breath: current_tick, late_by: Math.max(0, current_tick - target_breath), slot: action.slot, painter_anchor: anchor });
      mark_action_completed();
      return true;
    } else if (action.type === 'capture_painter_anchor_cell') {
      const anchor = action.anchor_slot ? capture_store.get_painter_anchor(action.anchor_slot) : (runtime_probe.get_painter_interaction_anchor?.() ?? null);
      const world = anchor?.world ?? null;
      if (!world) {
        diagnostic_report.record_failure({ action_index, action_type: action.type, slot: action.slot, anchor_slot: action.anchor_slot ?? null, error: 'tool_assisted_inputs_painter_anchor_world_unavailable' });
        emit('action_failed', { action_index, action_type: action.type, target_breath, current_breath: current_tick, slot: action.slot, anchor_slot: action.anchor_slot ?? null, error: 'tool_assisted_inputs_painter_anchor_world_unavailable', painter_anchor: anchor, nonfatal: true });
        return true;
      }
      const cell = runtime_probe.get_painter_cell?.(world.x, world.y, world.z) ?? null;
      capture_store.set_painter_cell(action.slot, cell);
      emit('action_fired', { action_index, action_type: action.type, target_breath, current_breath: current_tick, late_by: Math.max(0, current_tick - target_breath), slot: action.slot, anchor_slot: action.anchor_slot ?? null, painter_anchor: anchor, painter_cell: cell });
      mark_action_completed();
      return true;
    } else if (action.type === 'capture_painter_cell') {
      const cell = runtime_probe.get_painter_cell?.(action.x, action.y, action.z ?? null) ?? null;
      capture_store.set_painter_cell(action.slot, cell);
      emit('action_fired', { action_index, action_type: action.type, target_breath, current_breath: current_tick, late_by: Math.max(0, current_tick - target_breath), slot: action.slot, x: action.x, y: action.y, z: action.z ?? null, painter_cell: cell });
      mark_action_completed();
      return true;
    } else if (action.type === 'assert_actor_tile_equals' || action.type === 'assert_actor_tile_changed') {
      const expected = capture_store.get_tile(action.slot);
      const actual = runtime_probe.get_current_actor_tile();
      if (!expected || !actual) {
        diagnostic_report.record_failure({ action_index, action_type: action.type, slot: action.slot, error: 'tool_assisted_inputs_assert_tile_unavailable' });
        emit('action_failed', { action_index, action_type: action.type, target_breath, current_breath: current_tick, slot: action.slot, error: 'tool_assisted_inputs_assert_tile_unavailable', expected_tile: expected, actual_tile: actual, nonfatal: true });
        return true;
      }
      const same_tile = expected.x === actual.x && expected.y === actual.y && expected.z === actual.z;
      const passed = action.type === 'assert_actor_tile_equals' ? same_tile : !same_tile;
      if (!passed) {
        diagnostic_report.record_failure({ action_index, action_type: action.type, slot: action.slot, expected_tile: expected, actual_tile: actual });
        emit('action_failed', { action_index, action_type: action.type, target_breath, current_breath: current_tick, slot: action.slot, error: action.type === 'assert_actor_tile_equals' ? 'tool_assisted_inputs_assert_actor_tile_equals_failed' : 'tool_assisted_inputs_assert_actor_tile_changed_failed', expected_tile: expected, actual_tile: actual, delta_x: actual.x - expected.x, delta_y: actual.y - expected.y, delta_z: actual.z - expected.z, nonfatal: true });
        return true;
      }
      emit('action_fired', { action_index, action_type: action.type, target_breath, current_breath: current_tick, late_by: Math.max(0, current_tick - target_breath), actor_ref: context.actor_ref, place_id: context.place_id, slot: action.slot, expected_tile: expected, actual_tile: actual });
      mark_action_completed();
      return true;
    } else if (action.type === 'assert_text_value_equals' || action.type === 'assert_text_value_changed') {
      const expected = capture_store.get_text_value(action.slot);
      const actual = runtime_probe.get_text_value?.(action.source, action.field ?? null) ?? null;
      const same = expected === actual;
      const passed = action.type === 'assert_text_value_equals' ? same : !same;
      if (!passed) {
        diagnostic_report.record_failure({ action_index, action_type: action.type, slot: action.slot, source: action.source, field: action.field ?? null, expected_text: expected, actual_text: actual });
        emit('action_failed', { action_index, action_type: action.type, target_breath, current_breath: current_tick, error: action.type === 'assert_text_value_equals' ? 'tool_assisted_inputs_assert_text_value_equals_failed' : 'tool_assisted_inputs_assert_text_value_changed_failed', slot: action.slot, source: action.source, field: action.field ?? null, expected_text: expected, actual_text: actual, nonfatal: true });
        return true;
      }
      emit('action_fired', { action_index, action_type: action.type, target_breath, current_breath: current_tick, late_by: Math.max(0, current_tick - target_breath), slot: action.slot, source: action.source, field: action.field ?? null, expected_text: expected, actual_text: actual });
      mark_action_completed();
      return true;
    } else if (action.type === 'assert_text_value_literal') {
      const actual = runtime_probe.get_text_value?.(action.source, action.field ?? null) ?? null;
      const passed = actual === action.value;
      if (!passed) {
        diagnostic_report.record_failure({ action_index, action_type: action.type, source: action.source, field: action.field ?? null, expected_text: action.value, actual_text: actual });
        emit('action_failed', { action_index, action_type: action.type, target_breath, current_breath: current_tick, error: 'tool_assisted_inputs_assert_text_value_literal_failed', source: action.source, field: action.field ?? null, expected_text: action.value, actual_text: actual, nonfatal: true });
        return true;
      }
      emit('action_fired', { action_index, action_type: action.type, target_breath, current_breath: current_tick, late_by: Math.max(0, current_tick - target_breath), source: action.source, field: action.field ?? null, actual_text: actual });
      mark_action_completed();
      return true;
    } else if (action.type === 'assert_movement_trace_ready') {
      const trace = runtime_probe.get_movement_trace();
      if (!trace) {
        diagnostic_report.record_failure({ action_index, action_type: action.type, error: 'tool_assisted_inputs_movement_trace_unavailable' });
        emit('action_failed', { action_index, action_type: action.type, target_breath, current_breath: current_tick, error: 'tool_assisted_inputs_movement_trace_unavailable', nonfatal: true });
        return true;
      }
      const failures: string[] = [];
      if (typeof action.min_input_seq === 'number' && trace.input_seq < action.min_input_seq) failures.push('input_seq_below_min');
      if (action.require_stage && trace.stage !== action.require_stage) failures.push('stage_mismatch');
      if (action.require_direction && !trace.direction) failures.push('direction_missing');
      if (typeof action.require_gate === 'string' && trace.gate !== action.require_gate) failures.push('gate_mismatch');
      if (typeof action.max_input_to_visible_ms === 'number' && trace.input_to_visible_ms > action.max_input_to_visible_ms) failures.push('input_to_visible_too_slow');
      if (typeof action.max_accept_to_visible_ms === 'number' && trace.accept_to_visible_ms > action.max_accept_to_visible_ms) failures.push('accept_to_visible_too_slow');
      if (failures.length > 0) {
        diagnostic_report.record_failure({ action_index, action_type: action.type, failures, trace });
        emit('action_failed', { action_index, action_type: action.type, target_breath, current_breath: current_tick, error: 'tool_assisted_inputs_assert_movement_trace_ready_failed', failures, movement_trace: trace, nonfatal: true });
        return true;
      }
      emit('action_fired', { action_index, action_type: action.type, target_breath, current_breath: current_tick, late_by: Math.max(0, current_tick - target_breath), actor_ref: context.actor_ref, place_id: context.place_id, movement_trace: trace });
      mark_action_completed();
      return true;
    } else if (action.type === 'assert_painter_primary_tool' || action.type === 'assert_painter_secondary_tool') {
      const tool_state = runtime_probe.get_painter_tool_state?.() ?? null;
      const actual = action.type === 'assert_painter_primary_tool' ? tool_state?.left_click_tool : tool_state?.right_click_tool;
      if (!tool_state || actual !== action.tool) {
        diagnostic_report.record_failure({ action_index, action_type: action.type, expected_tool: action.tool, actual_tool: actual ?? null });
        emit('action_failed', { action_index, action_type: action.type, target_breath, current_breath: current_tick, error: 'tool_assisted_inputs_assert_painter_tool_failed', expected_tool: action.tool, actual_tool: actual ?? null, painter_tool_state: tool_state, nonfatal: true });
        return true;
      }
      emit('action_fired', { action_index, action_type: action.type, target_breath, current_breath: current_tick, late_by: Math.max(0, current_tick - target_breath), expected_tool: action.tool, painter_tool_state: tool_state });
      mark_action_completed();
      return true;
    } else if (action.type === 'assert_painter_focus_plane') {
      const z = runtime_probe.get_painter_focus_plane?.() ?? null;
      if (z !== action.z) {
        diagnostic_report.record_failure({ action_index, action_type: action.type, expected_z: action.z, actual_z: z });
        emit('action_failed', { action_index, action_type: action.type, target_breath, current_breath: current_tick, error: 'tool_assisted_inputs_assert_painter_focus_plane_failed', expected_z: action.z, actual_z: z, nonfatal: true });
        return true;
      }
      emit('action_fired', { action_index, action_type: action.type, target_breath, current_breath: current_tick, late_by: Math.max(0, current_tick - target_breath), focus_plane: z });
      mark_action_completed();
      return true;
    } else if (action.type === 'assert_painter_anchor_in_bounds') {
      const anchor = action.anchor_slot ? capture_store.get_painter_anchor(action.anchor_slot) : (runtime_probe.get_painter_interaction_anchor?.() ?? null);
      const world = anchor?.world ?? null;
      const bounds = runtime_probe.get_painter_bounds?.() ?? null;
      const in_bounds = Boolean(world && bounds
        && world.x >= 0 && world.y >= 0
        && world.x < bounds.width && world.y < bounds.height
        && world.z >= bounds.min_z && world.z <= bounds.max_z);
      if (!in_bounds) {
        diagnostic_report.record_failure({ action_index, action_type: action.type, anchor_slot: action.anchor_slot ?? null, painter_anchor: anchor, painter_bounds: bounds });
        emit('action_failed', { action_index, action_type: action.type, target_breath, current_breath: current_tick, error: 'tool_assisted_inputs_assert_painter_anchor_in_bounds_failed', anchor_slot: action.anchor_slot ?? null, painter_anchor: anchor, painter_bounds: bounds, nonfatal: true });
        return true;
      }
      emit('action_fired', { action_index, action_type: action.type, target_breath, current_breath: current_tick, late_by: Math.max(0, current_tick - target_breath), anchor_slot: action.anchor_slot ?? null, painter_anchor: anchor, painter_bounds: bounds });
      mark_action_completed();
      return true;
    } else if (action.type === 'assert_painter_anchor_cell_changed' || action.type === 'assert_painter_anchor_cell_equals') {
      const anchor = action.anchor_slot ? capture_store.get_painter_anchor(action.anchor_slot) : (runtime_probe.get_painter_interaction_anchor?.() ?? null);
      const world = anchor?.world ?? null;
      const expected = capture_store.get_painter_cell(action.slot);
      const actual = world ? (runtime_probe.get_painter_cell?.(world.x, world.y, world.z) ?? null) : null;
      const same = JSON.stringify(expected) === JSON.stringify(actual);
      const passed = action.type === 'assert_painter_anchor_cell_equals' ? same : !same;
      if (!world || !passed) {
        diagnostic_report.record_failure({ action_index, action_type: action.type, slot: action.slot, anchor_slot: action.anchor_slot ?? null, painter_anchor: anchor, expected_cell: expected, actual_cell: actual });
        emit('action_failed', { action_index, action_type: action.type, target_breath, current_breath: current_tick, error: action.type === 'assert_painter_anchor_cell_equals' ? 'tool_assisted_inputs_assert_painter_anchor_cell_equals_failed' : 'tool_assisted_inputs_assert_painter_anchor_cell_changed_failed', slot: action.slot, anchor_slot: action.anchor_slot ?? null, painter_anchor: anchor, expected_cell: expected, actual_cell: actual, nonfatal: true });
        return true;
      }
      emit('action_fired', { action_index, action_type: action.type, target_breath, current_breath: current_tick, late_by: Math.max(0, current_tick - target_breath), slot: action.slot, anchor_slot: action.anchor_slot ?? null, painter_anchor: anchor, expected_cell: expected, actual_cell: actual });
      mark_action_completed();
      return true;
    } else if (action.type === 'assert_painter_cell_changed' || action.type === 'assert_painter_cell_equals') {
      const expected = capture_store.get_painter_cell(action.slot);
      const actual = runtime_probe.get_painter_cell?.(action.x, action.y, action.z ?? null) ?? null;
      const same = JSON.stringify(expected) === JSON.stringify(actual);
      const passed = action.type === 'assert_painter_cell_equals' ? same : !same;
      if (!passed) {
        diagnostic_report.record_failure({ action_index, action_type: action.type, slot: action.slot, expected_cell: expected, actual_cell: actual, x: action.x, y: action.y, z: action.z ?? null });
        emit('action_failed', { action_index, action_type: action.type, target_breath, current_breath: current_tick, error: action.type === 'assert_painter_cell_equals' ? 'tool_assisted_inputs_assert_painter_cell_equals_failed' : 'tool_assisted_inputs_assert_painter_cell_changed_failed', slot: action.slot, expected_cell: expected, actual_cell: actual, x: action.x, y: action.y, z: action.z ?? null, nonfatal: true });
        return true;
      }
      emit('action_fired', { action_index, action_type: action.type, target_breath, current_breath: current_tick, late_by: Math.max(0, current_tick - target_breath), slot: action.slot, expected_cell: expected, actual_cell: actual, x: action.x, y: action.y, z: action.z ?? null });
      mark_action_completed();
      return true;
    } else if (action.type === 'key_down') {
      await Promise.resolve(keyboard_driver.send_keydown(action));
    } else if (action.type === 'key_up') {
      await Promise.resolve(keyboard_driver.send_keyup(action));
    } else if (action.type === 'key_tap') {
      await Promise.resolve(keyboard_driver.send_keydown(action));
      if ((action.hold_ms ?? 0) > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, action.hold_ms ?? 0));
      }
      await Promise.resolve(keyboard_driver.send_keyup(action));
    } else if (action.type === 'text_input') {
      await Promise.resolve(keyboard_driver.send_text(action));
    } else if (action.type === 'pointer_move') {
      await Promise.resolve(pointer_driver.move(action));
    } else if (action.type === 'pointer_down') {
      await Promise.resolve(pointer_driver.down(action));
    } else if (action.type === 'pointer_up') {
      await Promise.resolve(pointer_driver.up(action));
    } else if (action.type === 'pointer_click') {
      await Promise.resolve(pointer_driver.click(action, 1));
    } else if (action.type === 'pointer_double_click') {
      await Promise.resolve(pointer_driver.click(action, 2));
    } else if (action.type === 'pointer_context_menu') {
      await Promise.resolve(pointer_driver.context_menu(action));
    } else if (action.type === 'pointer_drag') {
      await Promise.resolve(pointer_driver.drag(action));
    } else if (action.type === 'wheel') {
      await Promise.resolve(pointer_driver.wheel(action));
    }
    emit('action_fired', { action_index, action_type: action.type, target_breath, current_breath: current_tick, late_by: Math.max(0, current_tick - target_breath), actor_ref: context.actor_ref, place_id: context.place_id });
    mark_action_completed();
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit('action_failed', { action_index, action_type: action.type, target_breath, current_breath: current_tick, error: message });
    return false;
  }
}
