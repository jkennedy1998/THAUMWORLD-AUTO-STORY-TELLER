import type { Canvas, Module, PointerEvent, Rect, WheelEvent } from '../types.js';
import { make_floating_panel_module } from './floating_panel_module.js';
import { get_color_by_name } from '../colors.js';
import type { ControlActionDefinition, ControlBinding } from '../runtime/controls_registry.js';
import { make_keyboard_binding_from_event, make_pointer_button_binding, make_wheel_binding } from '../runtime/controls_binding_matcher.js';

type ControlsModuleConfig = {
  id: string;
  rect: Rect;
  get_is_visible: () => boolean;
  get_title?: () => string;
  get_definitions: () => ControlActionDefinition[];
  get_binding_label: (action_id: string) => string;
  get_conflicts: (action_id: string) => string[];
  set_binding: (action_id: string, binding: ControlBinding | null) => void;
  on_close: () => void;
  on_move?: (rect: Rect) => void;
};

export function make_controls_module(opts: ControlsModuleConfig): Module {
  let cursor = 0;
  let visible_start = 0;
  let waiting_action_id: string | null = null;

  function get_rows() {
    const rows: Array<{ type: 'category'; label: string } | { type: 'action'; id: string; label: string; binding: string; conflicts: string[] }> = [];
    let last_category = '';
    for (const definition of opts.get_definitions()) {
      if (definition.category !== last_category) {
        last_category = definition.category;
        rows.push({ type: 'category', label: definition.category });
      }
      rows.push({
        type: 'action',
        id: definition.id,
        label: definition.label,
        binding: opts.get_binding_label(definition.id),
        conflicts: opts.get_conflicts(definition.id),
      });
    }
    return rows;
  }

  function sync_cursor(): void {
    const rows = get_rows();
    cursor = Math.max(0, Math.min(rows.length - 1, cursor));
  }

  function current_action_row() {
    const row = get_rows()[cursor];
    return row?.type === 'action' ? row : null;
  }

  function arm_rebind(action_id: string): void {
    waiting_action_id = action_id;
  }

  function apply_binding(binding: ControlBinding | null): void {
    if (!waiting_action_id) return;
    opts.set_binding(waiting_action_id, binding);
    waiting_action_id = null;
  }

  return make_floating_panel_module({
    id: opts.id,
    rect: opts.rect,
    title: opts.get_title ?? (() => 'CONTROLS'),
    is_visible: opts.get_is_visible,
    background: { rgb: get_color_by_name('off_black').rgb },
    border: {
      border_rgb: get_color_by_name('vivid_blue').rgb,
      text_rgb: get_color_by_name('vivid_blue').rgb,
    },
    resize: { min_width: 36, min_height: 12, max_width: 72, max_height: 40 },
    gizmos: {
      enabled: ['close', 'move', 'seamless'],
      can_close: true,
      can_move: true,
      can_save_position: false,
      on_close: opts.on_close,
      on_move: opts.on_move,
      on_move_end: opts.on_move,
    },
    draw_content(c: Canvas, rect: Rect): void {
      sync_cursor();
      const rows = get_rows();
      const inner_width = Math.max(1, rect.x1 - rect.x0 - 2);
      const list_height = Math.max(1, rect.y1 - rect.y0 - 5);
      if (cursor < visible_start) visible_start = cursor;
      if (cursor >= visible_start + list_height) visible_start = cursor - list_height + 1;
      visible_start = Math.max(0, Math.min(visible_start, Math.max(0, rows.length - list_height)));
      for (let row_index = 0; row_index < list_height; row_index += 1) {
        const row = rows[visible_start + row_index];
        const y = rect.y1 - 2 - row_index;
        if (!row || y <= rect.y0 + 1) break;
        if (row.type === 'category') {
          const text = `[${row.label}]`;
          for (let i = 0; i < text.length && rect.x0 + 1 + i < rect.x1; i += 1) {
            c.set(rect.x0 + 1 + i, y, { char: text[i]!, rgb: get_color_by_name('vivid_blue').rgb, weight_index: 5, style: 'regular' });
          }
          continue;
        }
        const is_cursor = visible_start + row_index === cursor;
        const waiting = waiting_action_id === row.id;
        const left = `${is_cursor ? '>' : ' '} ${row.label}`.slice(0, Math.max(0, inner_width - 18));
        const right = waiting ? 'PRESS INPUT...' : row.binding;
        const color = waiting ? get_color_by_name('vivid_yellow').rgb : row.conflicts.length > 0 ? get_color_by_name('vivid_red').rgb : is_cursor ? get_color_by_name('off_white').rgb : get_color_by_name('medium_gray').rgb;
        for (let i = 0; i < left.length && rect.x0 + 1 + i < rect.x1; i += 1) {
          c.set(rect.x0 + 1 + i, y, { char: left[i]!, rgb: color, weight_index: is_cursor ? 5 : 3, style: 'regular' });
        }
        const right_x = Math.max(rect.x0 + 1, rect.x1 - right.length - 1);
        for (let i = 0; i < right.length && right_x + i < rect.x1; i += 1) {
          c.set(right_x + i, y, { char: right[i]!, rgb: color, weight_index: waiting ? 6 : 4, style: 'regular' });
        }
      }
      const footer = waiting_action_id ? 'Enter new key/click/wheel. Backspace clears. Esc cancels.' : 'Click a binding to remap.';
      for (let i = 0; i < footer.length && rect.x0 + 1 + i < rect.x1; i += 1) {
        c.set(rect.x0 + 1 + i, rect.y0 + 1, { char: footer[i]!, rgb: get_color_by_name('medium_gray').rgb, weight_index: 3, style: 'regular' });
      }
    },
    on_pointer_down_content(e: PointerEvent, rect: Rect): void {
      const list_height = Math.max(1, rect.y1 - rect.y0 - 5);
      const row = rect.y1 - 2 - e.y;
      if (row < 0 || row >= list_height) return;
      const target = get_rows()[visible_start + row];
      if (!target || target.type !== 'action') return;
      cursor = visible_start + row;
      arm_rebind(target.id);
    },
    on_global_pointer_down_content(e: PointerEvent): void {
      if (!waiting_action_id) return;
      const binding = make_pointer_button_binding(e.button);
      if (!binding) return;
      apply_binding(binding);
    },
    on_wheel_content(e: WheelEvent): void {
      if (waiting_action_id) {
        if (Math.abs(e.delta_y) >= Math.abs(e.delta_x)) {
          apply_binding(make_wheel_binding(e.delta_y < 0 ? 'up' : 'down', { ctrl: e.ctrl, shift: e.shift, alt: e.alt, meta: e.meta }));
        } else {
          apply_binding(make_wheel_binding(e.delta_x < 0 ? 'left' : 'right', { ctrl: e.ctrl, shift: e.shift, alt: e.alt, meta: e.meta }));
        }
        return;
      }
      visible_start += e.delta_y > 0 ? 1 : -1;
      visible_start = Math.max(0, visible_start);
    },
    on_key_down(e: KeyboardEvent): void {
      sync_cursor();
      if (waiting_action_id) {
        if (e.key === 'Escape') {
          waiting_action_id = null;
          return;
        }
        if (e.key === 'Backspace' || e.key === 'Delete') {
          apply_binding(null);
          return;
        }
        const binding = make_keyboard_binding_from_event(e);
        if (binding) {
          e.preventDefault();
          apply_binding(binding);
        }
        return;
      }
      const rows = get_rows();
      if (e.key === 'Escape') {
        opts.on_close();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        cursor = Math.min(rows.length - 1, cursor + 1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        cursor = Math.max(0, cursor - 1);
        return;
      }
      if (e.key === 'Enter') {
        const row = current_action_row();
        if (row) arm_rebind(row.id);
      }
    },
    wants_text_capture: () => waiting_action_id !== null,
  });
}
