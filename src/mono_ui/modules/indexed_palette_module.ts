import type { Canvas, DragEvent, Module, PointerEvent, Rect, WheelEvent } from '../types.js';
import type { ModuleGizmosConfig } from '../module_gizmos.js';
import { get_ui_semantic_rgb } from '../runtime/ui_customization_store.js';
import type { IndexedPaletteEntry, IndexedPaletteState } from '../runtime/indexed_palette_store.js';
import {
  begin_plain_text_control_frame,
  clear_plain_text_control_interaction,
  create_plain_text_control_state,
  draw_plain_text_control,
  press_plain_text_control,
  release_hovered_plain_text_control,
  update_plain_text_hover,
} from '../ux/plain_text_controls.js';
import { make_floating_panel_module } from './floating_panel_module.js';

export type IndexedPaletteModuleOptions = {
  id: string;
  rect: Rect;
  get_palette_state: () => IndexedPaletteState;
  get_active_entry_id: () => string | null;
  on_select_entry: (id: string) => void;
  on_reorder_entries: (next_ids: string[]) => void;
  on_duplicate_entry: (id: string) => void;
  on_delete_entry: (id: string) => void;
  on_move?: (new_rect: Rect) => void;
  on_close?: () => void;
};

type RowHitbox = {
  id: string;
  x0: number;
  x1: number;
  y: number;
  index: number;
};

type DragState = {
  active: boolean;
  source_id: string | null;
  source_index: number;
  drop_index: number | null;
};

const MIN_WIDTH = 24;
const MAX_WIDTH = 52;
const MIN_HEIGHT = 8;
const MAX_HEIGHT = 32;
const WHEEL_ROWS = 4;

function trim_text(value: string, max_len: number): string {
  if (value.length <= max_len) return value;
  if (max_len <= 3) return value.slice(0, Math.max(0, max_len));
  return `${value.slice(0, max_len - 3)}...`;
}

function rgb_to_hex(entry: IndexedPaletteEntry): string {
  return `#${entry.rgb.r.toString(16).padStart(2, '0')}${entry.rgb.g.toString(16).padStart(2, '0')}${entry.rgb.b.toString(16).padStart(2, '0')}`.toUpperCase();
}

function reorder_ids(ids: string[], source_id: string, target_index: number): string[] {
  const existing_index = ids.indexOf(source_id);
  if (existing_index < 0) return [...ids];
  const next = [...ids];
  next.splice(existing_index, 1);
  const bounded_index = Math.max(0, Math.min(next.length, target_index));
  next.splice(bounded_index, 0, source_id);
  return next;
}

export function make_indexed_palette_module(opts: IndexedPaletteModuleOptions): Module {
  const gizmo_config: ModuleGizmosConfig = {
    enabled: ['move', 'resize', 'close', 'seamless'],
    can_close: true,
    can_move: true,
    can_save_position: false,
    on_close: opts.on_close,
    on_move: opts.on_move,
  };

  const text_controls = create_plain_text_control_state();
  let scroll_offset = 0;
  let row_hitboxes: RowHitbox[] = [];
  let drag_state: DragState = { active: false, source_id: null, source_index: -1, drop_index: null };

  function get_bounds(rect: Rect): { top: number; bottom: number; visible_rows: number } {
    const top = rect.y1 - 2;
    const bottom = rect.y0 + 2;
    return { top, bottom, visible_rows: Math.max(1, top - bottom + 1) };
  }

  function clamp_scroll(rect: Rect, entry_count: number): void {
    const { visible_rows } = get_bounds(rect);
    scroll_offset = Math.max(0, Math.min(Math.max(0, entry_count - visible_rows), scroll_offset));
  }

  function get_row_index_at(rect: Rect, y: number): number | null {
    const { top, bottom } = get_bounds(rect);
    if (y < bottom || y > top) return null;
    return scroll_offset + (top - y);
  }

  function commit_drag(entries: IndexedPaletteEntry[]): void {
    if (!drag_state.active || !drag_state.source_id || drag_state.drop_index === null) {
      drag_state = { active: false, source_id: null, source_index: -1, drop_index: null };
      return;
    }
    const current_ids = entries.map((entry) => entry.id);
    const next_ids = reorder_ids(current_ids, drag_state.source_id, drag_state.drop_index);
    drag_state = { active: false, source_id: null, source_index: -1, drop_index: null };
    if (next_ids.every((id, index) => id === current_ids[index])) return;
    opts.on_reorder_entries(next_ids);
  }

  return make_floating_panel_module({
    id: opts.id,
    rect: opts.rect,
    title: 'INDEXED PALETTE',
    gizmos: gizmo_config,
    resize: {
      min_width: MIN_WIDTH,
      min_height: MIN_HEIGHT,
      max_width: MAX_WIDTH,
      max_height: MAX_HEIGHT,
    },
    draw_content(c: Canvas, rect: Rect): void {
      const bg = get_ui_semantic_rgb('background');
      const medium = get_ui_semantic_rgb('medium');
      const bright = get_ui_semantic_rgb('bright');
      const vivid = get_ui_semantic_rgb('vivid');
      const entries = opts.get_palette_state().entries;
      clamp_scroll(rect, entries.length);
      begin_plain_text_control_frame(text_controls);
      row_hitboxes = [];
      c.fill_rect(rect, { char: ' ', rgb: bg, style: 'regular', weight_index: 1, render_index: 0 });

      const helper = trim_text('DRAG ROWS  + DUP  - DEL', Math.max(0, rect.x1 - rect.x0 - 1));
      for (let i = 0; i < helper.length; i += 1) {
        c.set(rect.x0 + 1 + i, rect.y0 + 1, { char: helper[i]!, rgb: bright, style: 'regular', weight_index: 1, render_index: 6 });
      }

      const { top, visible_rows } = get_bounds(rect);
      const active_entry_id = opts.get_active_entry_id();
      for (let visible_index = 0; visible_index < visible_rows; visible_index += 1) {
        const entry_index = scroll_offset + visible_index;
        const entry = entries[entry_index];
        const y = top - visible_index;
        if (!entry) continue;
        const is_active = entry.id === active_entry_id;
        const row_rgb = is_active ? bright : medium;
        const weight = is_active ? 2 : 1;
        const plus_id = `plus:${entry.id}`;
        const minus_id = `minus:${entry.id}`;
        const marker_x = rect.x0 + 1;
        const handle_x = rect.x0 + 3;
        const swatch_x = rect.x0 + 5;
        const text_x = rect.x0 + 7;
        const plus_x = rect.x1 - 3;
        const minus_x = rect.x1 - 1;
        const label = trim_text(`${String(entry_index + 1).padStart(2, '0')} ${entry.label ?? 'COLOR'} ${rgb_to_hex(entry)}`, Math.max(1, plus_x - text_x - 1));

        c.set(marker_x, y, { char: is_active ? '▶' : ' ', rgb: is_active ? vivid : medium, style: 'regular', weight_index: is_active ? 2 : 1, render_index: 6 });
        c.set(handle_x, y, { char: '≡', rgb: row_rgb, style: 'regular', weight_index: weight, render_index: 6 });
        c.set(swatch_x, y, { char: '█', rgb: entry.rgb, style: 'regular', weight_index: 3, render_index: 6 });
        for (let i = 0; i < label.length; i += 1) {
          c.set(text_x + i, y, { char: label[i]!, rgb: row_rgb, style: 'regular', weight_index: weight, render_index: 6 });
        }
        draw_plain_text_control(c, { id: plus_id, text: '+', x: plus_x, y, state: text_controls, hitbox: 'text_only', custom_idle_rgb: vivid, idle_role: 'custom', pressed_role: 'bright' });
        draw_plain_text_control(c, { id: minus_id, text: '-', x: minus_x, y, state: text_controls, hitbox: 'text_only', custom_idle_rgb: vivid, idle_role: 'custom', pressed_role: 'bright' });
        row_hitboxes.push({ id: entry.id, x0: marker_x, x1: plus_x - 2, y, index: entry_index });
      }

      if (drag_state.active && drag_state.drop_index !== null) {
        const indicator_index = drag_state.drop_index - scroll_offset;
        const indicator_y = top - Math.max(0, Math.min(visible_rows - 1, indicator_index));
        for (let x = rect.x0 + 1; x < rect.x1 - 1; x += 1) {
          c.set(x, indicator_y, { char: '─', rgb: vivid, style: 'regular', weight_index: 2, render_index: 7 });
        }
      }
    },
    on_pointer_down_content(e: PointerEvent, rect: Rect): void {
      const pressed = press_plain_text_control(text_controls, e.x, e.y);
      if (pressed) return;
      const hit = row_hitboxes.find((row) => row.y === e.y && e.x >= row.x0 && e.x <= row.x1);
      if (!hit) return;
      opts.on_select_entry(hit.id);
      drag_state = { active: true, source_id: hit.id, source_index: hit.index, drop_index: hit.index };
      clamp_scroll(rect, opts.get_palette_state().entries.length);
    },
    on_pointer_move_content(e: PointerEvent): void {
      update_plain_text_hover(text_controls, e.x, e.y);
    },
    on_drag_move_content(e: DragEvent, rect: Rect): void {
      if (!drag_state.active) return;
      const entries = opts.get_palette_state().entries;
      clamp_scroll(rect, entries.length);
      const row_index = get_row_index_at(rect, e.y);
      if (row_index === null) return;
      drag_state.drop_index = Math.max(0, Math.min(entries.length - 1, row_index));
    },
    on_pointer_up_content(): void {
      const hit_id = release_hovered_plain_text_control(text_controls);
      if (hit_id?.startsWith('plus:')) {
        opts.on_duplicate_entry(hit_id.slice('plus:'.length));
        drag_state = { active: false, source_id: null, source_index: -1, drop_index: null };
        return;
      }
      if (hit_id?.startsWith('minus:')) {
        opts.on_delete_entry(hit_id.slice('minus:'.length));
        drag_state = { active: false, source_id: null, source_index: -1, drop_index: null };
        return;
      }
      commit_drag(opts.get_palette_state().entries);
    },
    on_pointer_leave_content(): void {
      clear_plain_text_control_interaction(text_controls);
    },
    on_wheel_content(e: WheelEvent, rect: Rect): void {
      scroll_offset += e.delta_y > 0 ? WHEEL_ROWS : e.delta_y < 0 ? -WHEEL_ROWS : 0;
      clamp_scroll(rect, opts.get_palette_state().entries.length);
    },
  });
}
