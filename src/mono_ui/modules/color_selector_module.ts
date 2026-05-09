/**
 * Color Selector Module
 *
 * A floating, movable palette showing materials and indexed colors using the
 * same marker + preview-cell pattern as the character picker.
 */

import type { Canvas, Cell, Module, Rect, PointerEvent, WheelEvent, Rgb } from '../types.js';
import { get_enabled_appearance_slots, type AppearanceSlotTargetMask } from '../../ascii_painter/types.js';
import { get_color_by_name, INDEXED_COLORS } from '../colors.js';
import { list_material_defs, resolve_material_rgb } from '../runtime/material_registry.js';
import { get_ui_semantic_rgb } from '../runtime/ui_customization_store.js';
import type { ModuleGizmosConfig } from '../module_gizmos.js';
import { make_floating_panel_module } from './floating_panel_module.js';

type PreviewBrush = Pick<Cell, 'char' | 'graphic' | 'appearance_slots' | 'materials' | 'rgb' | 'weight_index'>;

type PreviewCell = Partial<Cell> & { char: string };

type PaletteEntry =
  | { kind: 'material'; key: string; material_id: string }
  | { kind: 'color'; key: string; rgb: Rgb };

type PaletteRow =
  | { kind: 'text'; text: string; rgb: Rgb; weight_index: number }
  | { kind: 'entries'; label: string; entries: PaletteEntry[] };

type PaletteHitbox = {
  x0: number;
  x1: number;
  y: number;
  entry: PaletteEntry;
};

export type ColorSelectorOptions = {
  id: string;
  rect: Rect;
  get_brush?: () => PreviewBrush;
  get_left_brush?: () => PreviewBrush;
  get_right_brush?: () => PreviewBrush;
  get_left_rgb?: () => { r: number; g: number; b: number } | undefined;
  get_right_rgb?: () => { r: number; g: number; b: number } | undefined;
  get_left_material_id?: () => string | null;
  get_right_material_id?: () => string | null;
  get_slot_targets?: () => AppearanceSlotTargetMask;
  on_color_select: (rgb: { r: number; g: number; b: number }, button: number) => void;
  on_material_select?: (material_id: string, button: number) => void;
  on_move?: (new_rect: Rect) => void;
  on_close?: () => void;
};

const MATERIAL_DEFS = list_material_defs();
const LABEL_WIDTH = 10;
const ENTRY_WIDTH = 3;
const WHEEL_ROWS = 3;

function rgb_eq(a: Rgb | undefined, b: Rgb | undefined): boolean {
  return !!a && !!b && a.r === b.r && a.g === b.g && a.b === b.b;
}

function get_all_slots(): Array<1 | 2 | 3> {
  return [1, 2, 3];
}

function make_neutral_preview_cell(brush: PreviewBrush, rgb: Rgb): PreviewCell {
  if (brush.graphic) {
    const appearance_slots: NonNullable<PreviewBrush['appearance_slots']> = {};
    for (const slot of get_all_slots()) {
      appearance_slots[slot] = { kind: 'flat_rgb', rgb: { ...rgb } };
    }
    return {
      char: brush.char,
      graphic: { ...brush.graphic },
      appearance_slots,
      materials: undefined,
      rgb,
      style: 'regular',
      weight_index: brush.weight_index,
    };
  }
  return {
    char: brush.char === ' ' ? '█' : brush.char,
    rgb,
    style: 'regular',
    weight_index: brush.weight_index,
  };
}

function make_color_preview_cell(brush: PreviewBrush, rgb: Rgb, slot_targets?: AppearanceSlotTargetMask): PreviewCell {
  if (brush.graphic) {
    const appearance_slots = brush.appearance_slots ? { ...brush.appearance_slots } : {};
    for (const slot of get_enabled_appearance_slots(slot_targets)) {
      appearance_slots[slot] = { kind: 'flat_rgb', rgb: { ...rgb } };
    }
    return {
      char: brush.char,
      graphic: { ...brush.graphic },
      appearance_slots,
      materials: brush.materials ? { ...brush.materials } : undefined,
      rgb,
      style: 'regular',
      weight_index: brush.weight_index,
    };
  }
  return {
    char: brush.char === ' ' ? '█' : brush.char,
    rgb,
    style: 'regular',
    weight_index: brush.weight_index,
  };
}

function make_material_preview_cell(brush: PreviewBrush, material_id: string, slot_targets?: AppearanceSlotTargetMask): PreviewCell {
  const preview_rgb = resolve_material_rgb(material_id, '2nd_lightest') ?? brush.rgb;
  if (brush.graphic) {
    const appearance_slots = brush.appearance_slots ? { ...brush.appearance_slots } : {};
    const materials = brush.materials ? { ...brush.materials } : {};
    for (const slot of get_enabled_appearance_slots(slot_targets)) {
      appearance_slots[slot] = { kind: 'material', material_id };
      materials[slot] = material_id;
    }
    return {
      char: brush.char,
      graphic: { ...brush.graphic },
      appearance_slots,
      materials,
      rgb: preview_rgb,
      style: 'regular',
      weight_index: brush.weight_index,
    };
  }
  return {
    char: brush.char === ' ' ? '█' : brush.char,
    rgb: preview_rgb,
    style: 'regular',
    weight_index: brush.weight_index,
  };
}

function get_content_bounds(rect: Rect): { top: number; bottom: number; visible_rows: number } {
  const top = rect.y1 - 2;
  const bottom = rect.y0 + 1;
  return {
    top,
    bottom,
    visible_rows: Math.max(1, top - bottom + 1),
  };
}

function get_entry_columns(rect: Rect, include_label: boolean): number {
  const inner_width = Math.max(1, rect.x1 - rect.x0 - 2);
  const reserved = include_label ? LABEL_WIDTH : 0;
  const glyph_width = Math.max(1, inner_width - reserved - 1);
  return Math.max(1, Math.floor(glyph_width / ENTRY_WIDTH));
}

function build_rows(rect: Rect): PaletteRow[] {
  const rows: PaletteRow[] = [];
  const bg = get_ui_semantic_rgb('background');
  const medium = get_ui_semantic_rgb('medium');
  const bright = get_ui_semantic_rgb('bright');
  const material_entries: PaletteEntry[] = MATERIAL_DEFS.map((material) => ({ kind: 'material', key: `material:${material.id}`, material_id: material.id }));
  const color_entries: PaletteEntry[] = INDEXED_COLORS.map((color) => ({ kind: 'color', key: `color:${color.index}`, rgb: color.rgb }));

  rows.push({ kind: 'text', text: '[MATERIALS]', rgb: bright, weight_index: 5 });
  const material_columns = get_entry_columns(rect, false);
  for (let i = 0; i < material_entries.length; i += material_columns) {
    rows.push({ kind: 'entries', label: '', entries: material_entries.slice(i, i + material_columns) });
  }
  rows.push({ kind: 'text', text: '', rgb: bg, weight_index: 1 });
  rows.push({ kind: 'text', text: '[INDEXED]', rgb: bright, weight_index: 5 });
  const color_columns = get_entry_columns(rect, false);
  for (let i = 0; i < color_entries.length; i += color_columns) {
    rows.push({ kind: 'entries', label: '', entries: color_entries.slice(i, i + color_columns) });
  }
  rows.push({ kind: 'text', text: '', rgb: medium, weight_index: 1 });
  return rows;
}

function get_marker(selected_left: boolean, selected_right: boolean): string {
  if (selected_left && selected_right) return 'B';
  if (selected_left) return 'L';
  if (selected_right) return 'R';
  return ' ';
}

function make_entry_preview_cells(
  entry: PaletteEntry,
  left_brush: PreviewBrush,
  right_brush: PreviewBrush,
  slot_targets: AppearanceSlotTargetMask | undefined,
  left_selected: boolean,
  right_selected: boolean,
): { left: PreviewCell; right: PreviewCell } {
  const makePreview = (brush: PreviewBrush): PreviewCell => entry.kind === 'material'
    ? make_material_preview_cell(brush, entry.material_id, slot_targets)
    : make_color_preview_cell(brush, entry.rgb, slot_targets);
  const left = makePreview(left_brush);
  const right = makePreview(right_brush);
  return {
    left: {
      ...left,
      style: left_selected ? 'reverse' : 'regular',
      weight_index: left_selected ? Math.max(3, left.weight_index ?? 0) : Math.max(1, left.weight_index ?? 0),
    },
    right: {
      ...right,
      style: right_selected ? 'reverse' : 'regular',
      weight_index: right_selected ? Math.max(3, right.weight_index ?? 0) : Math.max(1, right.weight_index ?? 0),
    },
  };
}

export function make_color_selector_module(opts: ColorSelectorOptions): Module {
  const MIN_WIDTH = 12;
  const MAX_WIDTH = 48;
  const MIN_HEIGHT = 8;
  const MAX_HEIGHT = 40;

  const gizmo_config: ModuleGizmosConfig = {
    enabled: ['move', 'resize', 'close', 'seamless'],
    can_close: true,
    can_move: true,
    can_save_position: false,
    on_close: opts.on_close,
    on_move: opts.on_move,
  };

  let scroll_offset = 0;
  let last_hitboxes: PaletteHitbox[] = [];

  function clamp_scroll(rect: Rect): PaletteRow[] {
    const rows = build_rows(rect);
    const { visible_rows } = get_content_bounds(rect);
    const max_scroll = Math.max(0, rows.length - visible_rows);
    scroll_offset = Math.max(0, Math.min(max_scroll, scroll_offset));
    return rows;
  }

  return make_floating_panel_module({
    id: opts.id,
    rect: opts.rect,
    title: 'PALETTE',
    gizmos: gizmo_config,
    background: { rgb: get_color_by_name('off_black').rgb },
    resize: {
      min_width: MIN_WIDTH,
      min_height: MIN_HEIGHT,
      max_width: MAX_WIDTH,
      max_height: MAX_HEIGHT,
    },
    draw_content(c: Canvas, rect: Rect): void {
      const bg_color = get_color_by_name('off_black').rgb;
      const label_rgb = get_ui_semantic_rgb('medium');
      const rows = clamp_scroll(rect);
      const { top, visible_rows } = get_content_bounds(rect);
      const fallback_brush = opts.get_brush?.();
      const left_brush: PreviewBrush = opts.get_left_brush?.() ?? fallback_brush ?? { char: '█', rgb: get_ui_semantic_rgb('left_hand'), weight_index: 2 };
      const right_brush: PreviewBrush = opts.get_right_brush?.() ?? fallback_brush ?? { char: '█', rgb: get_ui_semantic_rgb('right_hand'), weight_index: 2 };
      const left_rgb = opts.get_left_rgb?.();
      const right_rgb = opts.get_right_rgb?.();
      const left_material_id = opts.get_left_material_id?.() ?? null;
      const right_material_id = opts.get_right_material_id?.() ?? null;

      last_hitboxes = [];
      c.fill_rect(rect, { char: ' ', rgb: bg_color, style: 'regular' });

      for (let visible_index = 0; visible_index < visible_rows; visible_index += 1) {
        const row = rows[scroll_offset + visible_index];
        const y = top - visible_index;
        if (!row) continue;

        if (row.kind === 'text') {
          for (let i = 0; i < row.text.length && rect.x0 + 2 + i < rect.x1; i += 1) {
            c.set(rect.x0 + 2 + i, y, {
              char: row.text[i]!,
              rgb: row.rgb,
              style: 'regular',
              weight_index: row.weight_index,
            });
          }
          continue;
        }

        const glyph_start_x = rect.x0 + 2 + (row.label.length > 0 ? LABEL_WIDTH : 0);
        for (let i = 0; i < row.entries.length; i += 1) {
          const entry = row.entries[i]!;
          const x = glyph_start_x + (i * ENTRY_WIDTH);
          if (x + 1 >= rect.x1) break;

          const left_selected = entry.kind === 'material'
            ? left_material_id === entry.material_id
            : rgb_eq(left_rgb, entry.rgb);
          const right_selected = entry.kind === 'material'
            ? right_material_id === entry.material_id
            : rgb_eq(right_rgb, entry.rgb);
          const preview = make_entry_preview_cells(entry, left_brush, right_brush, opts.get_slot_targets?.(), left_selected, right_selected);
          c.set(x, y, preview.left);
          c.set(x + 1, y, preview.right);

          last_hitboxes.push({ x0: x, x1: x + 1, y, entry });
        }
      }

      if (rows.length > visible_rows) {
        const max_scroll = Math.max(1, rows.length - visible_rows);
        const scroll_percent = scroll_offset / max_scroll;
        const indicator_y = top - Math.floor(scroll_percent * Math.max(0, visible_rows - 1));
        c.set(rect.x1 - 1, indicator_y, {
          char: '│',
          rgb: get_ui_semantic_rgb('bright'),
          style: 'regular',
          weight_index: 2,
        });
      }
    },
    on_pointer_down_content(e: PointerEvent): void {
      const hit = last_hitboxes.find((entry) => entry.y === e.y && e.x >= entry.x0 && e.x <= entry.x1);
      if (!hit) return;
      if (hit.entry.kind === 'material') {
        opts.on_material_select?.(hit.entry.material_id, e.button);
        return;
      }
      opts.on_color_select(hit.entry.rgb, e.button);
    },
    on_wheel_content(e: WheelEvent, rect: Rect): void {
      scroll_offset += e.delta_y > 0 ? WHEEL_ROWS : e.delta_y < 0 ? -WHEEL_ROWS : 0;
      clamp_scroll(rect);
    },
  });
}
