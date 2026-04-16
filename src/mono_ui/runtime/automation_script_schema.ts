import type { ToolAssistedInputsScript } from './automation_interfaces.js';
import type { AutomationClockMode } from './automation_clock_types.js';

export function parse_tool_assisted_inputs_script(raw: string): ToolAssistedInputsScript {
  const data = JSON.parse(raw) as ToolAssistedInputsScript;
  if (!data || typeof data !== 'object') throw new Error('tool_assisted_inputs_invalid_script');
  if (!Array.isArray(data.actions)) throw new Error('tool_assisted_inputs_actions_missing');
  const clock_mode: AutomationClockMode = String((data as any).clock_mode ?? '').trim() === 'realtime_ms' ? 'realtime_ms' : 'breath';
  const start_delay_ms = Math.max(0, Math.floor(Number(data.start_delay_ms) || 0));
  const end_delay_ms = Math.max(0, Math.floor(Number((data as any).end_delay_ms) || 0));
  if (typeof (data as any).end_delay_ms !== 'number') throw new Error('tool_assisted_inputs_missing_end_delay_ms');
  const open_ms = Math.max(0, Math.floor(Number((data as any).open_ms) || 0));
  if (!open_ms) throw new Error('tool_assisted_inputs_missing_open_ms');
  const actions = data.actions.map((action: any, index) => {
    const at_breath = clock_mode === 'realtime_ms'
      ? Math.max(0, Math.floor(Number(action?.at_ms) || 0))
      : Math.max(0, Math.floor(Number(action?.at_breath) || 0));
    const type = String(action?.type ?? '').trim();
    if (clock_mode === 'realtime_ms' && typeof action?.at_ms !== 'number') throw new Error(`tool_assisted_inputs_missing_at_ms:${index}`);
    if (clock_mode === 'breath' && typeof action?.at_breath !== 'number') throw new Error(`tool_assisted_inputs_missing_at_breath:${index}`);
    if (type === 'assert_context_ready') return { at_breath, type } as const;
    if (type === 'marker') return { at_breath, type, label: String(action?.label ?? '').trim() || `marker_${index}` } as const;
    if (type === 'capture_actor_tile' || type === 'capture_movement_trace' || type === 'capture_visible_step' || type === 'capture_painter_tool_state' || type === 'capture_painter_focus_plane' || type === 'capture_painter_camera_target' || type === 'capture_painter_bounds' || type === 'capture_painter_interaction_anchor' || type === 'capture_painter_anchor_cell' || type === 'assert_actor_tile_equals' || type === 'assert_actor_tile_changed' || type === 'assert_painter_anchor_cell_changed' || type === 'assert_painter_anchor_cell_equals') {
      const slot = String(action?.slot ?? '').trim();
      if (!slot) throw new Error(`tool_assisted_inputs_missing_slot:${index}`);
      const anchor_slot = typeof action?.anchor_slot === 'string' && action.anchor_slot.trim().length > 0 ? action.anchor_slot.trim() : undefined;
      return { at_breath, type, slot, anchor_slot } as const;
    }
    if (type === 'assert_painter_anchor_in_bounds') {
      const anchor_slot = typeof action?.anchor_slot === 'string' && action.anchor_slot.trim().length > 0 ? action.anchor_slot.trim() : undefined;
      return { at_breath, type, anchor_slot } as const;
    }
    if (type === 'capture_painter_cell' || type === 'assert_painter_cell_changed' || type === 'assert_painter_cell_equals') {
      const slot = String(action?.slot ?? '').trim();
      const x = Math.floor(Number(action?.x));
      const y = Math.floor(Number(action?.y));
      const z = Number.isFinite(Number(action?.z)) ? Math.floor(Number(action?.z)) : undefined;
      if (!slot) throw new Error(`tool_assisted_inputs_missing_slot:${index}`);
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`tool_assisted_inputs_missing_painter_cell_xy:${index}`);
      return { at_breath, type, slot, x, y, z } as const;
    }
    if (type === 'pointer_move' || type === 'pointer_down' || type === 'pointer_up' || type === 'pointer_click' || type === 'pointer_double_click' || type === 'pointer_context_menu') {
      const space = String(action?.space ?? 'grid').trim();
      if (space !== 'grid') throw new Error(`tool_assisted_inputs_invalid_pointer_space:${index}`);
      const x = Math.floor(Number(action?.x));
      const y = Math.floor(Number(action?.y));
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`tool_assisted_inputs_missing_pointer_xy:${index}`);
      const pointer_action = String(action?.pointer_action ?? '').trim();
      return {
        at_breath,
        type,
        space: 'grid' as const,
        x,
        y,
        pointer_action: pointer_action === 'primary' || pointer_action === 'secondary' || pointer_action === 'auxiliary' ? pointer_action : undefined,
        button: Number.isFinite(Number(action?.button)) ? Math.max(0, Math.floor(Number(action.button))) : undefined,
        pointer_type: action?.pointer_type === 'pen' || action?.pointer_type === 'touch' ? action.pointer_type : (action?.pointer_type === 'mouse' ? 'mouse' : undefined),
        pressure: Number.isFinite(Number(action?.pressure)) ? Math.max(0, Math.min(1, Number(action.pressure))) : undefined,
        shift: Boolean(action?.shift),
        ctrl: Boolean(action?.ctrl),
        alt: Boolean(action?.alt),
        meta: Boolean(action?.meta),
      } as const;
    }
    if (type === 'wheel') {
      const space = String(action?.space ?? 'grid').trim();
      if (space !== 'grid') throw new Error(`tool_assisted_inputs_invalid_wheel_space:${index}`);
      const x = Math.floor(Number(action?.x));
      const y = Math.floor(Number(action?.y));
      const delta_x = Number(action?.delta_x);
      const delta_y = Number(action?.delta_y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`tool_assisted_inputs_missing_wheel_xy:${index}`);
      if (!Number.isFinite(delta_x) || !Number.isFinite(delta_y)) throw new Error(`tool_assisted_inputs_missing_wheel_delta:${index}`);
      return { at_breath, type, space: 'grid' as const, x, y, delta_x, delta_y, shift: Boolean(action?.shift), ctrl: Boolean(action?.ctrl), alt: Boolean(action?.alt), meta: Boolean(action?.meta) } as const;
    }
    if (type === 'pointer_drag') {
      const space = String(action?.space ?? 'grid').trim();
      if (space !== 'grid') throw new Error(`tool_assisted_inputs_invalid_drag_space:${index}`);
      const from_x = Math.floor(Number(action?.from_x));
      const from_y = Math.floor(Number(action?.from_y));
      const to_x = Math.floor(Number(action?.to_x));
      const to_y = Math.floor(Number(action?.to_y));
      if (![from_x, from_y, to_x, to_y].every(Number.isFinite)) throw new Error(`tool_assisted_inputs_missing_drag_xy:${index}`);
      const pointer_action = String(action?.pointer_action ?? '').trim();
      return {
        at_breath,
        type,
        space: 'grid' as const,
        from_x,
        from_y,
        to_x,
        to_y,
        steps: Number.isFinite(Number(action?.steps)) ? Math.max(1, Math.floor(Number(action.steps))) : undefined,
        pointer_action: pointer_action === 'primary' || pointer_action === 'secondary' || pointer_action === 'auxiliary' ? pointer_action : undefined,
        button: Number.isFinite(Number(action?.button)) ? Math.max(0, Math.floor(Number(action.button))) : undefined,
        pointer_type: action?.pointer_type === 'pen' || action?.pointer_type === 'touch' ? action.pointer_type : (action?.pointer_type === 'mouse' ? 'mouse' : undefined),
        pressure: Number.isFinite(Number(action?.pressure)) ? Math.max(0, Math.min(1, Number(action.pressure))) : undefined,
        shift: Boolean(action?.shift),
        ctrl: Boolean(action?.ctrl),
        alt: Boolean(action?.alt),
        meta: Boolean(action?.meta),
      } as const;
    }
    if (type === 'assert_movement_trace_ready') {
      const require_stage_raw = String(action?.require_stage ?? '').trim();
      const require_stage = require_stage_raw === 'posted' || require_stage_raw === 'eligible_now' || require_stage_raw === 'waiting_for_cadence' || require_stage_raw === 'moved'
        ? require_stage_raw
        : undefined;
      const require_gate = typeof action?.require_gate === 'string' && action.require_gate.trim().length > 0
        ? action.require_gate.trim()
        : undefined;
      const min_input_seq = Number.isFinite(Number(action?.min_input_seq)) ? Math.max(0, Math.floor(Number(action.min_input_seq))) : undefined;
      const max_input_to_visible_ms = Number.isFinite(Number(action?.max_input_to_visible_ms)) ? Math.max(0, Math.floor(Number(action.max_input_to_visible_ms))) : undefined;
      const max_accept_to_visible_ms = Number.isFinite(Number(action?.max_accept_to_visible_ms)) ? Math.max(0, Math.floor(Number(action.max_accept_to_visible_ms))) : undefined;
      return {
        at_breath,
        type,
        min_input_seq,
        require_stage,
        require_direction: Boolean(action?.require_direction),
        require_gate,
        max_input_to_visible_ms,
        max_accept_to_visible_ms,
      } as const;
    }
    if (type === 'assert_painter_primary_tool' || type === 'assert_painter_secondary_tool') {
      const tool = String(action?.tool ?? '').trim();
      if (!tool) throw new Error(`tool_assisted_inputs_missing_painter_tool:${index}`);
      return { at_breath, type, tool } as const;
    }
    if (type === 'assert_painter_focus_plane') {
      const z = Math.floor(Number(action?.z));
      if (!Number.isFinite(z)) throw new Error(`tool_assisted_inputs_missing_painter_focus_plane:${index}`);
      return { at_breath, type, z } as const;
    }
    if (type === 'key_down' || type === 'key_up' || type === 'key_tap') {
      const code = String(action?.code ?? '').trim();
      if (!code) throw new Error(`tool_assisted_inputs_missing_code:${index}`);
      const key = String(action?.key ?? '').trim() || undefined;
      const hold_ms = type === 'key_tap' && Number.isFinite(Number(action?.hold_ms)) ? Math.max(0, Math.floor(Number(action.hold_ms))) : undefined;
      return { at_breath, type, code, key, hold_ms } as const;
    }
    throw new Error(`tool_assisted_inputs_unknown_action:${type || index}`);
  }).sort((a, b) => a.at_breath - b.at_breath);
  return {
    id: typeof data.id === 'string' ? data.id.trim() || undefined : undefined,
    test_name: typeof data.test_name === 'string' && data.test_name.trim().length > 0
      ? data.test_name.trim()
      : (() => { throw new Error('tool_assisted_inputs_missing_test_name'); })(),
    clock_mode,
    open_ms,
    description: typeof data.description === 'string' ? data.description.trim() || undefined : undefined,
    start_delay_ms,
    end_delay_ms,
    stop_on_error: data.stop_on_error !== false,
    boot: data.boot && typeof data.boot === 'object' ? {
      auto_connect: data.boot.auto_connect !== false,
      auto_claim: Boolean(data.boot.auto_claim),
      actor_ref: typeof data.boot.actor_ref === 'string' ? data.boot.actor_ref.trim() || null : null,
    } : undefined,
    actions,
  };
}
