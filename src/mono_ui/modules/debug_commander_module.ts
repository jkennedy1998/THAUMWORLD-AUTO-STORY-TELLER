import type { Canvas, Module, PointerEvent, Rect, WheelEvent, Rgb } from "../types.js";
import { make_floating_panel_module } from "./floating_panel_module.js";
import { get_ui_semantic_rgb } from "../runtime/ui_customization_store.js";
import {
  begin_plain_text_control_frame,
  clear_plain_text_control_interaction,
  create_plain_text_control_state,
  press_plain_text_control,
  release_hovered_plain_text_control,
  update_plain_text_hover,
} from "../ux/plain_text_controls.js";
import { draw_text_stateful_row } from "../ux/plain_text_interactables.js";

export type DebugCommanderAction = {
  id: string;
  label: string;
  description?: string;
  rgb: Rgb;
  disabled?: boolean;
  on_trigger: () => void | Promise<void>;
};

export type DebugCommanderModuleConfig = {
  id: string;
  rect: Rect;
  get_is_visible: () => boolean;
  get_actions: () => DebugCommanderAction[];
  get_selected_action_id: () => string | null;
  get_status_lines?: () => string[];
  on_select_action: (action_id: string) => void;
  on_trigger_action: (action_id: string) => void;
  on_close: () => void;
  on_move?: (rect: Rect) => void;
  on_resize?: (rect: Rect) => void;
};

const MIN_WIDTH = 28;
const MAX_WIDTH = 46;
const MIN_HEIGHT = 12;
const MAX_HEIGHT = 34;

export function make_debug_commander_module(opts: DebugCommanderModuleConfig): Module {
  let scroll_offset = 0;
  const text_controls = create_plain_text_control_state();

  function trim_to_width(text: string, width: number): string {
    if (width <= 0) return "";
    if (text.length <= width) return text;
    if (width === 1) return text.charAt(0);
    return `${text.slice(0, width - 1)}~`;
  }

  function draw_line(c: Canvas, x: number, y: number, text: string, rgb: Rgb, weight_index: 0 | 1 | 2 | 3 = 2): void {
    for (let i = 0; i < text.length; i += 1) {
      c.set(x + i, y, { char: text[i]!, rgb, weight_index, render_index: 6, style: "regular" });
    }
  }

  function get_actions(): DebugCommanderAction[] {
    return opts.get_actions();
  }


  function get_selected_index(actions: DebugCommanderAction[]): number {
    const selected_action_id = opts.get_selected_action_id();
    const selected_index = selected_action_id ? actions.findIndex((action) => action.id === selected_action_id) : -1;
    return selected_index >= 0 ? selected_index : 0;
  }

  function clamp_scroll(rect: Rect, actions: DebugCommanderAction[]): void {
    const visible_count = Math.max(1, rect.y1 - rect.y0 - 7);
    const max_scroll = Math.max(0, actions.length - visible_count);
    scroll_offset = Math.max(0, Math.min(max_scroll, scroll_offset));
  }

  function ensure_selected_visible(rect: Rect, actions: DebugCommanderAction[]): void {
    const selected_index = get_selected_index(actions);
    const visible_count = Math.max(1, rect.y1 - rect.y0 - 7);
    if (selected_index < scroll_offset) scroll_offset = selected_index;
    if (selected_index >= scroll_offset + visible_count) scroll_offset = selected_index - visible_count + 1;
    clamp_scroll(rect, actions);
  }

  function move_selection(rect: Rect, delta: number): void {
    const actions = get_actions();
    if (actions.length < 1) return;
    const selected_index = get_selected_index(actions);
    const next_index = Math.max(0, Math.min(actions.length - 1, selected_index + delta));
    const next = actions[next_index];
    if (!next) return;
    opts.on_select_action(next.id);
    ensure_selected_visible(rect, actions);
  }

  return make_floating_panel_module({
    id: opts.id,
    rect: opts.rect,
    title: "DEBUG CMDR",
    is_visible: opts.get_is_visible,
    background: { rgb: get_ui_semantic_rgb('background') },
    resize: {
      min_width: MIN_WIDTH,
      min_height: MIN_HEIGHT,
      max_width: MAX_WIDTH,
      max_height: MAX_HEIGHT,
    },
    gizmos: {
      enabled: ["move", "resize", "close", "seamless"],
      can_close: true,
      can_move: true,
      can_save_position: false,
      on_close: opts.on_close,
      on_move: opts.on_move,
      on_move_end: opts.on_move,
      on_resize: opts.on_resize,
      on_resize_end: opts.on_resize,
    },
    draw_content(c: Canvas, rect: Rect): void {
      begin_plain_text_control_frame(text_controls);
      const actions = get_actions();
      clamp_scroll(rect, actions);
      ensure_selected_visible(rect, actions);
      const selected_action_id = opts.get_selected_action_id();
      const inner_width = Math.max(1, rect.x1 - rect.x0 - 2);
      const status_lines = opts.get_status_lines?.() ?? [];
      const top_y = rect.y1 - 2;
      const visible_count = Math.max(1, rect.y1 - rect.y0 - 7);
      const footer_y = rect.y0 + 2;

      for (let i = 0; i < visible_count; i += 1) {
        const action = actions[scroll_offset + i];
        if (!action) break;
        const y = top_y - i;
        if (y <= rect.y0 + 3) break;
        const selected = action.id === selected_action_id;
        const line = trim_to_width(action.label, inner_width);
        draw_text_stateful_row(c, {
          id: action.id,
          label: line,
          x: rect.x0 + 1,
          y,
          row_x0: rect.x0 + 1,
          row_x1: rect.x1 - 1,
          state: text_controls,
          active: selected,
          disabled: action.disabled,
          inactive_role: 'medium',
          active_role: 'custom',
          hover_role: 'custom',
          pressed_role: 'custom',
          custom_active_rgb: action.rgb,
          base_weight_index: 1,
          active_weight_index: 2,
          pressed_weight_index: 3,
          render_index: 6,
          style: 'regular',
        });
      }

      const selected = actions.find((action) => action.id === selected_action_id) ?? null;
      const summary = selected
        ? trim_to_width(selected.description ?? selected.label, inner_width)
        : trim_to_width('select a debug command', inner_width);
      draw_line(c, rect.x0 + 1, footer_y, summary, get_ui_semantic_rgb('medium'), 1);

      const hint_y = footer_y - 1;
      if (hint_y > rect.y0) {
        draw_line(c, rect.x0 + 1, hint_y, trim_to_width('↑↓ select  enter run  esc close', inner_width), get_ui_semantic_rgb('medium'), 1);
      }

      for (let i = 0; i < status_lines.length && footer_y - 2 - i > rect.y0; i += 1) {
        draw_line(c, rect.x0 + 1, footer_y - 2 - i, trim_to_width(status_lines[i] ?? '', inner_width), get_ui_semantic_rgb('medium'), 1);
      }
    },
    on_pointer_down_content(e: PointerEvent): void {
      const pressed_id = press_plain_text_control(text_controls, e.x, e.y);
      if (pressed_id) opts.on_select_action(pressed_id);
    },
    on_pointer_move_content(e: PointerEvent): void {
      update_plain_text_hover(text_controls, e.x, e.y);
    },
    on_pointer_up_content(): void {
      const triggered_action_id = release_hovered_plain_text_control(text_controls);
      if (triggered_action_id) opts.on_trigger_action(triggered_action_id);
    },
    on_pointer_leave_content(): void {
      clear_plain_text_control_interaction(text_controls);
    },
    on_wheel_content(e: WheelEvent, rect: Rect): void {
      const actions = get_actions();
      scroll_offset += e.delta_y > 0 ? 1 : -1;
      clamp_scroll(rect, actions);
    },
    on_key_down(e: KeyboardEvent): void {
      const rect = opts.rect;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        move_selection(rect, 1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        move_selection(rect, -1);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const action_id = opts.get_selected_action_id();
        if (action_id) opts.on_trigger_action(action_id);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        opts.on_close();
      }
    },
  });
}
