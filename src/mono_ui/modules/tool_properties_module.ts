/**
 * Tool Properties Module
 * 
 * A floating module showing properties for the currently selected tool.
 * For brush tools, shows brush tip size slider (1x1 to 5x5).
 */

import type { Canvas, Module, Rect, PointerEvent, DragEvent } from '../types.js';
import { get_color_by_name } from '../colors.js';
import { PANEL_BORDER_PRESETS } from '../module_borders.js';
import type { ModuleGizmosConfig } from '../module_gizmos.js';
import { make_floating_panel_module } from './floating_panel_module.js';
import type { ToolType } from '../../ascii_painter/types.js';
import type { SelectionMode } from '../../ascii_painter/selection.js';
import type { GradiatorState, GradiatorSlot } from '../../ascii_painter/gradiator.js';
import { getSafeGradiatorSlot } from '../../ascii_painter/gradiator.js';

type ToolPropertiesCustomPanel = {
  should_render: () => boolean;
  draw: (c: Canvas, rect: Rect) => void;
  on_pointer_down?: (e: PointerEvent, rect: Rect) => boolean | void;
  on_drag_move?: (e: DragEvent, rect: Rect) => boolean | void;
  on_pointer_up?: () => void;
};

export type ToolPropertyRow =
  | {
      type: 'dual_slider';
      id: string;
      label: string;
      min: number;
      max: number;
      left_value: number;
      right_value: number;
      format_value?: (value: number) => string;
      on_change: (value: number, side: 'left' | 'right') => void;
    }
  | {
      type: 'dual_toggle';
      id: string;
      label: string;
      left_value: boolean;
      right_value: boolean;
      left_enabled?: boolean;
      right_enabled?: boolean;
      note?: string;
      on_toggle: (side: 'left' | 'right') => void;
    }
  | {
      type: 'single_cycle';
      id: string;
      label: string;
      value: string;
      options?: string[];
      enabled?: boolean;
      on_cycle: () => void;
    }
  | {
      type: 'single_toggle';
      id: string;
      label: string;
      value: boolean;
      enabled?: boolean;
      on_toggle: () => void;
    }
  | {
      type: 'single_stepper';
      id: string;
      label: string;
      value: string;
      enabled?: boolean;
      on_decrement: () => void;
      on_increment: () => void;
    }
  | {
      type: 'edit_channel_matrix';
      id: string;
      columns: Array<{
        id: string;
        label: string;
        shortcut: string;
        left_value: boolean;
        right_value: boolean;
        left_enabled?: boolean;
        right_enabled?: boolean;
      }>;
      on_toggle: (side: 'left' | 'right' | 'both', column_id: string) => void;
    }
  | {
      type: 'info';
      id: string;
      text: string;
      rgb?: { r: number; g: number; b: number };
    };

export type ToolPropertiesOptions = {
  id: string;
  rect: Rect;
  get_current_tool: () => ToolType | string;
  get_brush_size: () => number; // 1-5
  get_left_brush_size?: () => number;
  get_right_brush_size?: () => number;
  get_active_side?: () => 'left' | 'right';
  on_brush_size_change: (size: number, side: 'left' | 'right') => void;
  get_space_replace: () => boolean;
  on_space_replace_change: (replace: boolean) => void;
  // Text tool options
  get_text_spacing: () => number;
  on_text_spacing_change: (spacing: number) => void;
  get_text_charlead: () => number;
  on_text_charlead_change: (charlead: number) => void;
  get_text_enterlead: () => number;
  on_text_enterlead_change: (enterlead: number) => void;
  get_text_enterspace: () => number;
  on_text_enterspace_change: (enterspace: number) => void;
  // Selection mode
  get_selection_mode: () => SelectionMode;
  on_selection_mode_change: (mode: SelectionMode) => void;
  // Paste options
  get_paste_space_replace: () => boolean;
  on_paste_space_replace_change: (replace: boolean) => void;
  get_paste_scale: () => number; // 0.1 to 3.0
  on_paste_scale_change: (scale: number) => void;
  // Paste ignore options
  get_paste_ignore_space: () => boolean;
  on_paste_ignore_space_change: (ignore: boolean) => void;
  get_paste_ignore_black: () => boolean;
  on_paste_ignore_black_change: (ignore: boolean) => void;
  get_paste_ignore_white: () => boolean;
  on_paste_ignore_white_change: (ignore: boolean) => void;
  get_paste_ignore_color: () => boolean;
  on_paste_ignore_color_change: (ignore: boolean) => void;
  get_paste_ignore_color_rgb: () => { r: number; g: number; b: number };
  on_paste_ignore_color_select: () => void;
  // Gradiator options
  get_gradiator_state: () => GradiatorState;
  on_gradiator_slot_select: (slot: GradiatorSlot) => void;
  on_gradiator_char_select: (slot: GradiatorSlot, x: number) => void;
  on_gradiator_add_char: (slot: GradiatorSlot) => void;
  on_gradiator_remove_char: (slot: GradiatorSlot) => void;
  on_gradiator_char_set: (slot: GradiatorSlot, x: number, char: string) => void;
  // Selection controls
  on_selection_clear?: () => void;
  on_selection_invert?: () => void;
  on_selection_all?: () => void;
  title?: string;
  property_rows?: () => ToolPropertyRow[];
  custom_panel?: ToolPropertiesCustomPanel;
  on_move?: (new_rect: Rect) => void;
  on_resize?: (new_rect: Rect) => void;
  on_close?: () => void;
};

const MIN_BRUSH_SIZE = 1;
const MAX_BRUSH_SIZE = 5;
const SIZE_LABELS = ['1x1', '2x2', '3x3', '4x4', '5x5'];

// Size constraints
const MIN_WIDTH = 16;
const MAX_WIDTH = 25;
const MIN_HEIGHT = 8;
const MAX_HEIGHT = 24;

export function make_tool_properties_module(opts: ToolPropertiesOptions): Module {
  let rect = opts.rect;
  
  const gizmo_config: ModuleGizmosConfig = {
    enabled: ['move', 'resize', 'close', 'seamless'],
    can_close: true,
    can_move: true,
    can_save_position: false,
    on_close: opts.on_close,
    on_move: opts.on_move,
  };
  let is_dragging_slider = false;
  let dragging_brush_side: 'left' | 'right' = 'left';
  let is_dragging_scale = false;

  // Calculate brush size from x position
  function get_size_from_x(x: number): number {
    const slider_start_x = rect.x0 + 3;
    const slider_width = rect.x1 - rect.x0 - 5;
    const segment_width = slider_width / (MAX_BRUSH_SIZE - MIN_BRUSH_SIZE);
    
    const relative_x = x - slider_start_x;
    let size = Math.round(relative_x / segment_width) + MIN_BRUSH_SIZE;
    size = Math.max(MIN_BRUSH_SIZE, Math.min(MAX_BRUSH_SIZE, size));
    
    return size;
  }

  // Check if position is on slider
  function is_on_slider(x: number, y: number): boolean {
    const slider_y = rect.y1 - 3;
    return y >= slider_y - 1 && y <= slider_y + 1 && x >= rect.x0 + 2 && x <= rect.x1 - 2;
  }

  // Check if position is on space_replace checkbox
  function is_on_space_checkbox(x: number, y: number): boolean {
    const checkbox_y = rect.y1 - 5;
    return y === checkbox_y && x >= rect.x0 + 2 && x <= rect.x0 + 4;
  }

  // Check if position is on paste ignore_space checkbox
  function is_on_paste_ignore_space(x: number, y: number): boolean {
    const checkbox_y = rect.y1 - 11;
    return y === checkbox_y && x >= rect.x0 + 2 && x <= rect.x0 + 4;
  }

  // Check if position is on paste ignore_black checkbox
  function is_on_paste_ignore_black(x: number, y: number): boolean {
    const checkbox_y = rect.y1 - 12;
    return y === checkbox_y && x >= rect.x0 + 2 && x <= rect.x0 + 4;
  }

  // Check if position is on paste ignore_white checkbox
  function is_on_paste_ignore_white(x: number, y: number): boolean {
    const checkbox_y = rect.y1 - 13;
    return y === checkbox_y && x >= rect.x0 + 2 && x <= rect.x0 + 4;
  }

  // Check if position is on paste ignore_color checkbox
  function is_on_paste_ignore_color(x: number, y: number): boolean {
    const checkbox_y = rect.y1 - 14;
    return y === checkbox_y && x >= rect.x0 + 2 && x <= rect.x0 + 4;
  }

  // Check if position is on paste ignore color selector
  function is_on_paste_ignore_color_selector(x: number, y: number): boolean {
    const selector_y = rect.y1 - 14;
    return y === selector_y && x >= rect.x0 + 14 && x <= rect.x0 + 16;
  }

  // Check if position is on gradiator slot selector
  function is_on_gradiator_slot(x: number, y: number): number | null {
    const gradiator_start_y = rect.y1 - 3;
    for (let slot = 0; slot < 3; slot++) {
      const y_pos = gradiator_start_y - (slot * 2);
      if (y === y_pos && x >= rect.x0 + 2 && x <= rect.x0 + 4) {
        return slot;
      }
    }
    return null;
  }

  // Check if position is on gradiator character area (for editing)
  function is_on_gradiator_char(x: number, y: number): { slot: number; charX: number } | null {
    const gradiator_start_y = rect.y1 - 3;
    const gradiatorState = opts.get_gradiator_state();
    for (let slot = 0; slot < 3; slot++) {
      const y_pos = gradiator_start_y - (slot * 2);
      const gradiator = getSafeGradiatorSlot(gradiatorState, slot);
      // Clickable area is within the brackets based on actual gradiator length
      const endX = rect.x0 + 6 + Math.min(gradiator.length, 12);
      if (y === y_pos && x >= rect.x0 + 6 && x < endX) {
        return { slot, charX: x - (rect.x0 + 6) };
      }
    }
    return null;
  }

  // Check if position is on gradiator add (+) button
  function is_on_gradiator_add(x: number, y: number): number | null {
    const gradiator_start_y = rect.y1 - 3;
    const gradiatorState = opts.get_gradiator_state();
    for (let slot = 0; slot < 3; slot++) {
      const y_pos = gradiator_start_y - (slot * 2);
      const gradiator = getSafeGradiatorSlot(gradiatorState, slot);
      // + button appears after the closing bracket
      const buttonX = rect.x0 + 6 + Math.min(gradiator.length, 12) + 1;
      if (y === y_pos && x === buttonX) {
        return slot;
      }
    }
    return null;
  }

  // Check if position is on gradiator remove (-) button
  function is_on_gradiator_remove(x: number, y: number): number | null {
    const gradiator_start_y = rect.y1 - 3;
    const gradiatorState = opts.get_gradiator_state();
    for (let slot = 0; slot < 3; slot++) {
      const y_pos = gradiator_start_y - (slot * 2);
      const gradiator = getSafeGradiatorSlot(gradiatorState, slot);
      // - button appears after the + button
      const buttonX = rect.x0 + 6 + Math.min(gradiator.length, 12) + 2;
      if (y === y_pos && x === buttonX) {
        return slot;
      }
    }
    return null;
  }

  // Check if position is on scale slider (between the buttons)
  function is_on_scale_slider(x: number, y: number): boolean {
    const scale_y = rect.y1 - 9;
    const slider_start = rect.x0 + 10;
    const slider_end = rect.x1 - 5;
    return y === scale_y && x >= slider_start && x <= slider_end;
  }

  // Check if position is on scale minus button
  function is_on_scale_minus(x: number, y: number): boolean {
    const scale_y = rect.y1 - 9;
    return y === scale_y && x === rect.x0 + 8;
  }

  // Check if position is on scale plus button
  function is_on_scale_plus(x: number, y: number): boolean {
    const scale_y = rect.y1 - 9;
    return y === scale_y && x === rect.x1 - 3;
  }

  // Get scale value from x position
  function get_scale_from_x(x: number): number {
    const slider_start = rect.x0 + 10;
    const slider_width = rect.x1 - slider_start - 9;
    const relative_x = x - slider_start;
    const percent = 10 + (relative_x / slider_width) * 290;
    return Math.max(10, Math.min(300, Math.round(percent))) / 100;
  }

  // Check if position is on selection mode option
  function is_on_selection_mode(x: number, y: number): SelectionMode | null {
    const modes: SelectionMode[] = ['replace', 'additive', 'subtract', 'intersect'];
    let y_pos = rect.y1 - 4;
    
    for (const mode of modes) {
      if (y === y_pos && x >= rect.x0 + 2 && x <= rect.x1 - 2) {
        return mode;
      }
      y_pos--;
    }
    return null;
  }

  // Check if position is on selection button
  function is_on_selection_button(x: number, y: number): 'clear' | 'invert' | 'all' | null {
    const btn_y = rect.y1 - 8;
    if (y !== btn_y) return null;
    
    // [Clear] [Invert] [All]
    let btn_x = rect.x0 + 2;
    
    if (x >= btn_x && x < btn_x + 7) return 'clear';
    btn_x += 8;
    if (x >= btn_x && x < btn_x + 8) return 'invert';
    btn_x += 9;
    if (x >= btn_x && x < btn_x + 5) return 'all';
    
    return null;
  }

  // Check if position is on text spacing +/- buttons
  function is_on_text_spacing_button(x: number, y: number): 'minus' | 'plus' | null {
    const spacing_y = rect.y1 - 4; // Below the checkbox
    if (y !== spacing_y) return null;
    
    if (x === rect.x1 - 3) return 'minus';
    if (x === rect.x1 - 1) return 'plus';
    return null;
  }

  // Check if position is on text charlead +/- buttons
  function is_on_text_charlead_button(x: number, y: number): 'minus' | 'plus' | null {
    const charlead_y = rect.y1 - 5; // Below spacing
    if (y !== charlead_y) return null;
    
    if (x === rect.x1 - 3) return 'minus';
    if (x === rect.x1 - 1) return 'plus';
    return null;
  }

  // Check if position is on text enterlead +/- buttons
  function is_on_text_enterlead_button(x: number, y: number): 'minus' | 'plus' | null {
    const enterlead_y = rect.y1 - 6; // Below charlead
    if (y !== enterlead_y) return null;
    
    if (x === rect.x1 - 3) return 'minus';
    if (x === rect.x1 - 1) return 'plus';
    return null;
  }

  // Check if position is on text enterspace +/- buttons
  function is_on_text_enterspace_button(x: number, y: number): 'minus' | 'plus' | null {
    const enterspace_y = rect.y1 - 7; // Below enterlead
    if (y !== enterspace_y) return null;
    
    if (x === rect.x1 - 3) return 'minus';
    if (x === rect.x1 - 1) return 'plus';
    return null;
  }

  function get_property_rows(): ToolPropertyRow[] {
    return opts.property_rows?.() ?? [];
  }

  function get_property_row_height(row: ToolPropertyRow): number {
    if (row.type === 'dual_slider' || row.type === 'edit_channel_matrix') return 3;
    return 1;
  }

  function is_on_property_stepper_minus(x: number): boolean {
    return x === rect.x1 - 3;
  }

  function is_on_property_stepper_plus(x: number): boolean {
    return x === rect.x1 - 1;
  }

  function should_render_property_rows(): boolean {
    return get_property_rows().length > 0;
  }

  function get_property_row_index_at(y: number): number | null {
    const rows = get_property_rows();
    let cursor_y = rect.y1 - 3;
    for (let i = 0; i < rows.length; i++) {
      const height = get_property_row_height(rows[i]!);
      if (y <= cursor_y && y > cursor_y - height) return i;
      cursor_y -= height;
    }
    return null;
  }

  function get_property_side_from_x(x: number): 'left' | 'right' | null {
    if (x >= rect.x0 + 15 && x <= rect.x0 + 17) return 'left';
    if (x >= rect.x0 + 19 && x <= rect.x0 + 21) return 'right';
    return null;
  }

  function get_edit_channel_matrix_hit(row: Extract<ToolPropertyRow, { type: 'edit_channel_matrix' }>, x: number, y: number, top_y: number): { side: 'left' | 'right' | 'both'; column_id: string } | null {
    const toggle_y = top_y - 1;
    if (y !== toggle_y) return null;
    const inner_width = Math.max(1, rect.x1 - rect.x0 - 3);
    const col_width = Math.max(5, Math.floor(inner_width / Math.max(1, row.columns.length)));
    const start_x = rect.x0 + 2;
    for (let i = 0; i < row.columns.length; i += 1) {
      const column = row.columns[i]!;
      const col_x = start_x + (i * col_width);
      const toggle_x = col_x + Math.max(0, Math.floor((col_width - 5) / 2));
      if (x === toggle_x) return { side: 'left', column_id: column.id };
      if (x === toggle_x + 2) return { side: 'right', column_id: column.id };
      if (x === toggle_x + 4) return { side: 'both', column_id: column.id };
    }
    return null;
  }

  function get_dual_slider_value_from_x(row: Extract<ToolPropertyRow, { type: 'dual_slider' }>, x: number): number {
    const slider_start_x = rect.x0 + 3;
    const slider_end_x = rect.x1 - 3;
    const track_width = Math.max(1, slider_end_x - slider_start_x);
    const relative_x = Math.max(0, Math.min(track_width, x - slider_start_x));
    const ratio = relative_x / track_width;
    const value = row.min + ratio * (row.max - row.min);
    return Math.round(value);
  }

  return make_floating_panel_module({
    id: opts.id,
    rect: opts.rect,
    title: opts.title ?? 'PROPS',
    gizmos: gizmo_config,
    background: { rgb: get_color_by_name('off_black').rgb },
    border: {
      style: PANEL_BORDER_PRESETS.default_double.style,
      border_rgb: get_color_by_name('medium_gray').rgb,
      weight_index: PANEL_BORDER_PRESETS.default_double.weight_index,
    },
    resize: {
      min_width: MIN_WIDTH,
      min_height: MIN_HEIGHT,
      max_width: MAX_WIDTH,
      max_height: MAX_HEIGHT,
    },
    draw_content(c: Canvas, next_rect: Rect): void {
      rect = next_rect;
      const bg_color = get_color_by_name('off_black').rgb;
      const text_color = get_color_by_name('off_white').rgb;
      const slider_bg = get_color_by_name('dark_gray').rgb;
      const slider_fg = get_color_by_name('vivid_blue').rgb;
      const handle_color = get_color_by_name('vivid_yellow').rgb;
      
      // Fill background
      c.fill_rect(rect, { char: ' ', rgb: bg_color, style: 'regular' });

      if (should_render_property_rows()) {
        const rows = get_property_rows();
        const active_side = opts.get_active_side?.() ?? 'left';
        const header = '            L   R';
        for (let i = 0; i < header.length; i++) {
          c.set(rect.x0 + 1 + i, rect.y1 - 2, {
            char: header[i]!,
            rgb: text_color,
            style: 'regular',
            weight_index: 2,
          });
        }
        let cursor_y = rect.y1 - 3;
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i]!;
          const y = cursor_y;
          if (y <= rect.y0) break;
          if (row.type === 'dual_toggle') {
            const label = row.note ? `${row.label} ${row.note}` : row.label;
            const label_rgb = row.note ? get_color_by_name('medium_gray').rgb : text_color;
            for (let j = 0; j < label.length && rect.x0 + 2 + j < rect.x0 + 14 && rect.x0 + 2 + j < rect.x1; j++) {
              c.set(rect.x0 + 2 + j, y, {
                char: label[j]!,
                rgb: label_rgb,
                style: 'regular',
                weight_index: 2,
              });
            }
            const left_text = row.left_enabled === false ? ' - ' : (row.left_value ? '[x]' : '[ ]');
            const right_text = row.right_enabled === false ? ' - ' : (row.right_value ? '[x]' : '[ ]');
            const left_rgb = active_side === 'left' ? get_color_by_name('vivid_blue').rgb : text_color;
            const right_rgb = active_side === 'right' ? get_color_by_name('vivid_red').rgb : text_color;
            for (let j = 0; j < left_text.length; j++) {
              c.set(rect.x0 + 15 + j, y, { char: left_text[j]!, rgb: left_rgb, style: 'regular', weight_index: 2 });
            }
            for (let j = 0; j < right_text.length; j++) {
              c.set(rect.x0 + 19 + j, y, { char: right_text[j]!, rgb: right_rgb, style: 'regular', weight_index: 2 });
            }
          } else if (row.type === 'dual_slider') {
            const value_label = row.format_value
              ? `L:${row.format_value(row.left_value)} R:${row.format_value(row.right_value)}`
              : `L:${row.left_value} R:${row.right_value}`;
            const label_x = Math.floor((rect.x0 + rect.x1 - value_label.length) / 2);
            for (let j = 0; j < value_label.length && label_x + j < rect.x1; j++) {
              c.set(label_x + j, y, {
                char: value_label[j]!,
                rgb: text_color,
                style: 'regular',
                weight_index: 2,
              });
            }
            const slider_y = y - 1;
            if (slider_y <= rect.y0) continue;
            const slider_start_x = rect.x0 + 3;
            const slider_end_x = rect.x1 - 3;
            for (let sx = slider_start_x; sx <= slider_end_x; sx++) {
              c.set(sx, slider_y, { char: '─', rgb: slider_bg, style: 'regular', weight_index: 1 });
            }
            const denom = Math.max(1, row.max - row.min);
            for (let value = row.min; value <= row.max; value++) {
              const ratio = (value - row.min) / denom;
              const marker_x = Math.round(slider_start_x + ratio * (slider_end_x - slider_start_x));
              const is_left = value === row.left_value;
              const is_right = value === row.right_value;
              c.set(marker_x, slider_y, {
                char: is_left && is_right ? '◆' : (is_left || is_right) ? '●' : '○',
                rgb: is_left || is_right ? slider_fg : slider_bg,
                style: 'regular',
                weight_index: is_left || is_right ? 2 : 1,
              });
              if (is_left || is_right) {
                c.set(marker_x, slider_y - 1, {
                  char: is_left && is_right ? 'B' : is_left ? 'L' : 'R',
                  rgb: is_left && is_right
                    ? get_color_by_name('vivid_yellow').rgb
                    : is_left
                      ? get_color_by_name('vivid_blue').rgb
                      : get_color_by_name('vivid_red').rgb,
                  style: 'regular',
                  weight_index: 2,
                });
              }
            }
          } else if (row.type === 'single_cycle') {
            const label = `${row.label}:`;
            const value = row.options && row.options.length > 0
              ? `[${row.value}]`
              : row.value;
            const label_rgb = row.enabled === false ? get_color_by_name('medium_gray').rgb : text_color;
            const value_rgb = row.enabled === false ? get_color_by_name('dark_gray').rgb : get_color_by_name('vivid_yellow').rgb;
            for (let j = 0; j < label.length && rect.x0 + 2 + j < rect.x1; j++) {
              c.set(rect.x0 + 2 + j, y, {
                char: label[j]!,
                rgb: label_rgb,
                style: 'regular',
                weight_index: 2,
              });
            }
            const value_x = Math.min(rect.x1 - value.length - 1, rect.x0 + 2 + label.length + 1);
            for (let j = 0; j < value.length && value_x + j < rect.x1; j++) {
              c.set(value_x + j, y, {
                char: value[j]!,
                rgb: value_rgb,
                style: 'regular',
                weight_index: 2,
              });
            }
          } else if (row.type === 'single_toggle') {
            const label_rgb = row.enabled === false ? get_color_by_name('medium_gray').rgb : text_color;
            const value_rgb = row.enabled === false ? get_color_by_name('dark_gray').rgb : get_color_by_name('vivid_yellow').rgb;
            const label = row.label;
            const value = row.value ? '[x]' : '[ ]';
            for (let j = 0; j < label.length && rect.x0 + 2 + j < rect.x1; j++) {
              c.set(rect.x0 + 2 + j, y, { char: label[j]!, rgb: label_rgb, style: 'regular', weight_index: 2 });
            }
            const value_x = Math.min(rect.x1 - value.length - 1, rect.x0 + 14);
            for (let j = 0; j < value.length && value_x + j < rect.x1; j++) {
              c.set(value_x + j, y, { char: value[j]!, rgb: value_rgb, style: 'regular', weight_index: 2 });
            }
          } else if (row.type === 'single_stepper') {
            const label_rgb = row.enabled === false ? get_color_by_name('medium_gray').rgb : text_color;
            const value_rgb = row.enabled === false ? get_color_by_name('dark_gray').rgb : get_color_by_name('vivid_yellow').rgb;
            const label = `${row.label}:`;
            for (let j = 0; j < label.length && rect.x0 + 2 + j < rect.x1; j++) {
              c.set(rect.x0 + 2 + j, y, { char: label[j]!, rgb: label_rgb, style: 'regular', weight_index: 2 });
            }
            const value_x = Math.min(rect.x1 - row.value.length - 5, rect.x0 + 2 + label.length + 1);
            for (let j = 0; j < row.value.length && value_x + j < rect.x1; j++) {
              c.set(value_x + j, y, { char: row.value[j]!, rgb: value_rgb, style: 'regular', weight_index: 2 });
            }
            c.set(rect.x1 - 3, y, { char: '-', rgb: row.enabled === false ? get_color_by_name('dark_gray').rgb : slider_fg, style: 'regular', weight_index: 2 });
            c.set(rect.x1 - 1, y, { char: '+', rgb: row.enabled === false ? get_color_by_name('dark_gray').rgb : get_color_by_name('vivid_green').rgb, style: 'regular', weight_index: 2 });
          } else if (row.type === 'edit_channel_matrix') {
            const title_y = y;
            const checks_y = y - 1;
            const shortcut_y = y - 2;
            if (shortcut_y <= rect.y0) continue;
            const inner_width = Math.max(1, rect.x1 - rect.x0 - 3);
            const col_width = Math.max(5, Math.floor(inner_width / Math.max(1, row.columns.length)));
            const start_x = rect.x0 + 2;
            for (let i = 0; i < row.columns.length; i += 1) {
              const column = row.columns[i]!;
              const col_x = start_x + (i * col_width);
              const title = column.label.slice(0, 3);
              const shortcut = column.shortcut.slice(0, 3).toLowerCase();
              const title_x = col_x + Math.max(0, Math.floor((col_width - title.length) / 2));
              const shortcut_x = col_x + Math.max(0, Math.floor((col_width - shortcut.length) / 2));
              const toggle_x = col_x + Math.max(0, Math.floor((col_width - 5) / 2));
              const both_on = column.left_value && column.right_value;
              const title_rgb = both_on ? get_color_by_name('vivid_yellow').rgb : text_color;
              for (let j = 0; j < title.length && title_x + j < rect.x1; j++) {
                c.set(title_x + j, title_y, { char: title[j]!, rgb: title_rgb, style: 'regular', weight_index: 4 });
              }
              c.set(toggle_x, checks_y, {
                char: 'L',
                rgb: column.left_enabled === false ? get_color_by_name('dark_gray').rgb : (column.left_value ? get_color_by_name('vivid_blue').rgb : get_color_by_name('medium_gray').rgb),
                style: column.left_value ? 'reverse' : 'regular',
                weight_index: column.left_value ? 3 : 1,
              });
              c.set(toggle_x + 2, checks_y, {
                char: 'R',
                rgb: column.right_enabled === false ? get_color_by_name('dark_gray').rgb : (column.right_value ? get_color_by_name('vivid_red').rgb : get_color_by_name('medium_gray').rgb),
                style: column.right_value ? 'reverse' : 'regular',
                weight_index: column.right_value ? 3 : 1,
              });
              c.set(toggle_x + 4, checks_y, {
                char: 'B',
                rgb: both_on ? get_color_by_name('vivid_yellow').rgb : get_color_by_name('medium_gray').rgb,
                style: both_on ? 'reverse' : 'regular',
                weight_index: both_on ? 3 : 1,
              });
              for (let j = 0; j < shortcut.length && shortcut_x + j < rect.x1; j++) {
                c.set(shortcut_x + j, shortcut_y, { char: shortcut[j]!, rgb: get_color_by_name('medium_gray').rgb, style: 'regular', weight_index: 1 });
              }
            }
          } else if (row.type === 'info') {
            for (let j = 0; j < row.text.length && rect.x0 + 2 + j < rect.x1; j++) {
              c.set(rect.x0 + 2 + j, y, {
                char: row.text[j]!,
                rgb: row.rgb ?? get_color_by_name('medium_gray').rgb,
                style: 'regular',
                weight_index: 1,
              });
            }
          }
          cursor_y -= get_property_row_height(row);
        }
      }
      // Show brush size slider only for brush tools
      else if (opts.get_current_tool() === 'pencil' || opts.get_current_tool() === 'eraser') {
        const left_size = opts.get_left_brush_size?.() ?? opts.get_brush_size();
        const right_size = opts.get_right_brush_size?.() ?? opts.get_brush_size();
        const active_side = opts.get_active_side?.() ?? 'left';
        const left_indicator_rgb = active_side === 'left'
          ? get_color_by_name('vivid_blue').rgb
          : get_color_by_name('medium_gray').rgb;
        const right_indicator_rgb = active_side === 'right'
          ? get_color_by_name('vivid_red').rgb
          : get_color_by_name('medium_gray').rgb;
        // Draw size label
        const size_label = `L:${SIZE_LABELS[left_size - 1]!} R:${SIZE_LABELS[right_size - 1]!}`;
        const label_y = rect.y1 - 5;
        const label_start_x = Math.floor((rect.x0 + rect.x1 - size_label.length) / 2);
        
        for (let i = 0; i < size_label.length; i++) {
          c.set(label_start_x + i, label_y, {
            char: size_label[i]!,
            rgb: text_color,
            style: 'regular',
            weight_index: 2
          });
        }
        
        // Draw slider track
        const slider_y = rect.y1 - 3;
        const slider_start_x = rect.x0 + 3;
        const slider_end_x = rect.x1 - 3;
        
        for (let x = slider_start_x; x <= slider_end_x; x++) {
          c.set(x, slider_y, {
            char: '─',
            rgb: slider_bg,
            style: 'regular',
            weight_index: 1
          });
        }
        
        // Draw size markers
        const segment_width = (slider_end_x - slider_start_x) / (MAX_BRUSH_SIZE - MIN_BRUSH_SIZE);
        for (let i = 0; i < MAX_BRUSH_SIZE; i++) {
          const marker_x = Math.round(slider_start_x + (i * segment_width));
          const is_left = i + 1 === left_size;
          const is_right = i + 1 === right_size;
          const is_selected = i + 1 === opts.get_brush_size();
          
          c.set(marker_x, slider_y, {
            char: is_left && is_right ? '◆' : is_selected ? '●' : '○',
            rgb: is_selected ? slider_fg : slider_bg,
            style: 'regular',
            weight_index: is_selected ? 3 : 1
          });
          if (is_left || is_right) {
            c.set(marker_x, slider_y - 1, {
              char: is_left && is_right ? 'B' : is_left ? 'L' : 'R',
              rgb: is_left && is_right
                ? get_color_by_name('vivid_yellow').rgb
                : is_left
                  ? left_indicator_rgb
                  : right_indicator_rgb,
              style: 'regular',
              weight_index: 2
            });
          }
        }
      } else if (opts.get_current_tool() === 'text') {
        let y_pos = rect.y1 - 3;
        
        // Show space_replace checkbox
        const space_replace = opts.get_space_replace();
        c.set(rect.x0 + 2, y_pos, {
          char: space_replace ? '☑' : '☐',
          rgb: text_color,
          style: 'regular',
          weight_index: 2
        });
        
        const space_label = 'space→" "';
        for (let i = 0; i < space_label.length && i < rect.x1 - rect.x0 - 5; i++) {
          c.set(rect.x0 + 4 + i, y_pos, {
            char: space_label[i]!,
            rgb: text_color,
            style: 'regular',
            weight_index: 2
          });
        }
        y_pos--;
        
        // Spacing control (X per char)
        const spacing = opts.get_text_spacing();
        const spacing_label = `SpaceX: ${spacing > 0 ? '+' : ''}${spacing}`;
        for (let i = 0; i < spacing_label.length && i < rect.x1 - rect.x0 - 2; i++) {
          c.set(rect.x0 + 2 + i, y_pos, {
            char: spacing_label[i]!,
            rgb: text_color,
            style: 'regular',
            weight_index: 2
          });
        }
        c.set(rect.x1 - 3, y_pos, { char: '-', rgb: slider_fg, style: 'regular', weight_index: 2 });
        c.set(rect.x1 - 1, y_pos, { char: '+', rgb: slider_fg, style: 'regular', weight_index: 2 });
        y_pos--;
        
        // Charlead control (Y per char)
        const charlead = opts.get_text_charlead();
        const charlead_label = `CharY: ${charlead > 0 ? '+' : ''}${charlead}`;
        for (let i = 0; i < charlead_label.length && i < rect.x1 - rect.x0 - 2; i++) {
          c.set(rect.x0 + 2 + i, y_pos, {
            char: charlead_label[i]!,
            rgb: text_color,
            style: 'regular',
            weight_index: 2
          });
        }
        c.set(rect.x1 - 3, y_pos, { char: '-', rgb: slider_fg, style: 'regular', weight_index: 2 });
        c.set(rect.x1 - 1, y_pos, { char: '+', rgb: slider_fg, style: 'regular', weight_index: 2 });
        y_pos--;
        
        // Enterlead control (Y on Enter)
        const enterlead = opts.get_text_enterlead();
        const enterlead_label = `EntY: ${enterlead > 0 ? '+' : ''}${enterlead}`;
        for (let i = 0; i < enterlead_label.length && i < rect.x1 - rect.x0 - 2; i++) {
          c.set(rect.x0 + 2 + i, y_pos, {
            char: enterlead_label[i]!,
            rgb: text_color,
            style: 'regular',
            weight_index: 2
          });
        }
        c.set(rect.x1 - 3, y_pos, { char: '-', rgb: slider_fg, style: 'regular', weight_index: 2 });
        c.set(rect.x1 - 1, y_pos, { char: '+', rgb: slider_fg, style: 'regular', weight_index: 2 });
        y_pos--;
        
        // Enterspace control (X on Enter)
        const enterspace = opts.get_text_enterspace();
        const enterspace_label = `EntX: ${enterspace > 0 ? '+' : ''}${enterspace}`;
        for (let i = 0; i < enterspace_label.length && i < rect.x1 - rect.x0 - 2; i++) {
          c.set(rect.x0 + 2 + i, y_pos, {
            char: enterspace_label[i]!,
            rgb: text_color,
            style: 'regular',
            weight_index: 2
          });
        }
        c.set(rect.x1 - 3, y_pos, { char: '-', rgb: slider_fg, style: 'regular', weight_index: 2 });
        c.set(rect.x1 - 1, y_pos, { char: '+', rgb: slider_fg, style: 'regular', weight_index: 2 });
      } else if (opts.get_current_tool() === 'selectangle' || opts.get_current_tool() === 'lassoselect') {
        // Show selection mode options
        const modes: SelectionMode[] = ['replace', 'additive', 'subtract', 'intersect'];
        const current_mode = opts.get_selection_mode();
        let y_pos = rect.y1 - 4;
        
        for (const mode of modes) {
          const is_selected = current_mode === mode;
          c.set(rect.x0 + 2, y_pos, {
            char: is_selected ? '●' : '○',
            rgb: is_selected ? slider_fg : text_color,
            style: 'regular',
            weight_index: is_selected ? 3 : 1
          });
          
          const label = mode.charAt(0).toUpperCase() + mode.slice(1);
          for (let i = 0; i < label.length && i < rect.x1 - rect.x0 - 5; i++) {
            c.set(rect.x0 + 4 + i, y_pos, {
              char: label[i]!,
              rgb: is_selected ? slider_fg : text_color,
              style: 'regular',
              weight_index: is_selected ? 2 : 1
            });
          }
          y_pos--;
        }
        
        // Draw buttons
        const btn_y = rect.y1 - 8;
        const btns = ['[Clear]', '[Invert]', '[All]'];
        let btn_x = rect.x0 + 2;
        
        for (const btn of btns) {
          for (let i = 0; i < btn.length && btn_x + i < rect.x1; i++) {
            c.set(btn_x + i, btn_y, {
              char: btn[i]!,
              rgb: text_color,
              style: 'regular',
              weight_index: 2
            });
          }
          btn_x += btn.length + 1;
        }
      } else if (opts.get_current_tool() === 'paste') {
        const gradiatorState = opts.get_gradiator_state();
        const pasteScale = opts.get_paste_scale();
        const paste_replace = opts.get_paste_space_replace();
        
        // Draw gradiators
        const gradiator_start_y = rect.y1 - 3;
        const activeColor = get_color_by_name('vivid_yellow').rgb;
        const inactiveColor = get_color_by_name('medium_gray').rgb;
        
        for (let slot = 0; slot < 3; slot++) {
          const isActive = slot === gradiatorState.activeSlot;
          const gradiator = getSafeGradiatorSlot(gradiatorState, slot);
          const y_pos = gradiator_start_y - (slot * 2);
          
          // Draw slot label
          const label = `G${slot + 1}`;
          for (let i = 0; i < label.length; i++) {
            c.set(rect.x0 + 2 + i, y_pos, {
              char: label[i]!,
              rgb: isActive ? activeColor : inactiveColor,
              style: 'regular',
              weight_index: isActive ? 2 : 1
            });
          }
          
          // Draw gradiator characters in brackets
          c.set(rect.x0 + 5, y_pos, { char: '[', rgb: text_color, style: 'regular', weight_index: 1 });
          
          for (let x = 0; x < gradiator.length && x < 12; x++) {
            const char = gradiator[x]!;
            // Highlight selected character position if this is the active slot and has a selection
            const isSelected = isActive && gradiatorState.isEditing && gradiatorState.editSlot === slot && x === gradiatorState.editCursorX;
            
            c.set(rect.x0 + 6 + x, y_pos, {
              char: char,
              rgb: isSelected ? activeColor : text_color,
              style: isSelected ? 'reverse' : 'regular',
              weight_index: isSelected ? 2 : 2
            });
          }
          
          c.set(rect.x0 + 6 + Math.min(gradiator.length, 12), y_pos, { 
            char: ']', 
            rgb: text_color, 
            style: 'regular', 
            weight_index: 1 
          });
          
          // Draw + and - buttons
          const buttonX = rect.x0 + 6 + Math.min(gradiator.length, 12) + 1;
          c.set(buttonX, y_pos, {
            char: '+',
            rgb: get_color_by_name('vivid_yellow').rgb,
            style: 'regular',
            weight_index: 2
          });
          
          // Only show - if gradiator has more than minimum characters
          if (gradiator.length > 2) {
            c.set(buttonX + 1, y_pos, {
              char: '-',
              rgb: get_color_by_name('vivid_red').rgb,
              style: 'regular',
              weight_index: 2
            });
          }
        }
        
        // Draw scale slider
        const scale_y = rect.y1 - 9;
        const scale_label = 'Scale:';
        for (let i = 0; i < scale_label.length; i++) {
          c.set(rect.x0 + 2 + i, scale_y, {
            char: scale_label[i]!,
            rgb: text_color,
            style: 'regular',
            weight_index: 2
          });
        }
        
        // Draw minus button for scale
        c.set(rect.x0 + 8, scale_y, {
          char: '-',
          rgb: get_color_by_name('vivid_red').rgb,
          style: 'regular',
          weight_index: 2
        });
        
        // Scale slider track
        const slider_start = rect.x0 + 10;
        const slider_width = rect.x1 - slider_start - 4;
        const scale_percent = Math.round(pasteScale * 100);
        const slider_pos = Math.floor(((scale_percent - 10) / 290) * slider_width);
        
        for (let x = 0; x < slider_width; x++) {
          c.set(slider_start + x, scale_y, {
            char: x === slider_pos ? '◆' : '─',
            rgb: x === slider_pos ? get_color_by_name('vivid_yellow').rgb : get_color_by_name('medium_gray').rgb,
            style: 'regular',
            weight_index: x === slider_pos ? 2 : 1
          });
        }
        
        // Draw plus button for scale
        c.set(rect.x1 - 3, scale_y, {
          char: '+',
          rgb: get_color_by_name('vivid_green').rgb,
          style: 'regular',
          weight_index: 2
        });
        
        // Scale percentage display
        const percent_str = `${scale_percent}%`;
        const percent_x = rect.x1 - percent_str.length - 5;
        for (let i = 0; i < percent_str.length; i++) {
          c.set(percent_x + i, scale_y, {
            char: percent_str[i]!,
            rgb: get_color_by_name('vivid_yellow').rgb,
            style: 'regular',
            weight_index: 2
          });
        }
        
        // Get ignore options
        const ignore_space = opts.get_paste_ignore_space();
        const ignore_black = opts.get_paste_ignore_black();
        const ignore_white = opts.get_paste_ignore_white();
        const ignore_color = opts.get_paste_ignore_color();
        const ignore_color_rgb = opts.get_paste_ignore_color_rgb();
        
        // Show ignore space checkbox and label
        const ignore_space_y = rect.y1 - 11;
        c.set(rect.x0 + 2, ignore_space_y, {
          char: ignore_space ? '☑' : '☐',
          rgb: text_color,
          style: 'regular',
          weight_index: 2
        });
        
        const ignore_space_label = 'ignore space';
        for (let i = 0; i < ignore_space_label.length && i < rect.x1 - rect.x0 - 6; i++) {
          c.set(rect.x0 + 4 + i, ignore_space_y, {
            char: ignore_space_label[i]!,
            rgb: text_color,
            style: 'regular',
            weight_index: 2
          });
        }
        
        // Show ignore black checkbox and label
        const ignore_black_y = rect.y1 - 12;
        c.set(rect.x0 + 2, ignore_black_y, {
          char: ignore_black ? '☑' : '☐',
          rgb: text_color,
          style: 'regular',
          weight_index: 2
        });
        
        const ignore_black_label = 'ignore black';
        for (let i = 0; i < ignore_black_label.length && i < rect.x1 - rect.x0 - 15; i++) {
          c.set(rect.x0 + 4 + i, ignore_black_y, {
            char: ignore_black_label[i]!,
            rgb: text_color,
            style: 'regular',
            weight_index: 2
          });
        }
        
        // Show black color indicator
        c.set(rect.x0 + 15, ignore_black_y, {
          char: '█',
          rgb: { r: 0, g: 0, b: 0 },
          style: 'regular',
          weight_index: 2
        });
        
        // Show ignore white checkbox and label
        const ignore_white_y = rect.y1 - 13;
        c.set(rect.x0 + 2, ignore_white_y, {
          char: ignore_white ? '☑' : '☐',
          rgb: text_color,
          style: 'regular',
          weight_index: 2
        });
        
        const ignore_white_label = 'ignore white';
        for (let i = 0; i < ignore_white_label.length && i < rect.x1 - rect.x0 - 15; i++) {
          c.set(rect.x0 + 4 + i, ignore_white_y, {
            char: ignore_white_label[i]!,
            rgb: text_color,
            style: 'regular',
            weight_index: 2
          });
        }
        
        // Show white color indicator
        c.set(rect.x0 + 15, ignore_white_y, {
          char: '█',
          rgb: { r: 255, g: 255, b: 255 },
          style: 'regular',
          weight_index: 2
        });
        
        // Show ignore color checkbox and label
        const ignore_color_y = rect.y1 - 14;
        c.set(rect.x0 + 2, ignore_color_y, {
          char: ignore_color ? '☑' : '☐',
          rgb: text_color,
          style: 'regular',
          weight_index: 2
        });
        
        const ignore_color_label = 'ignore color';
        for (let i = 0; i < ignore_color_label.length && i < rect.x1 - rect.x0 - 17; i++) {
          c.set(rect.x0 + 4 + i, ignore_color_y, {
            char: ignore_color_label[i]!,
            rgb: text_color,
            style: 'regular',
            weight_index: 2
          });
        }
        
        // Show color selector box (clickable)
        c.set(rect.x0 + 14, ignore_color_y, {
          char: '[',
          rgb: text_color,
          style: 'regular',
          weight_index: 1
        });
        c.set(rect.x0 + 15, ignore_color_y, {
          char: '█',
          rgb: ignore_color_rgb,
          style: 'regular',
          weight_index: 2
        });
        c.set(rect.x0 + 16, ignore_color_y, {
          char: ']',
          rgb: text_color,
          style: 'regular',
          weight_index: 1
        });
      } else if (opts.custom_panel?.should_render()) {
        opts.custom_panel.draw(c, rect);
      } else {
        // Show message for non-brush tools
        const msg = 'No options';
        const msg_y = rect.y1 - 4;
        const msg_start_x = Math.floor((rect.x0 + rect.x1 - msg.length) / 2);
        
        for (let i = 0; i < msg.length; i++) {
          c.set(msg_start_x + i, msg_y, {
            char: msg[i]!,
            rgb: get_color_by_name('medium_gray').rgb,
            style: 'regular',
            weight_index: 1
          });
        }
      }

    },
    on_pointer_down_content(e: PointerEvent): void {
      if (should_render_property_rows()) {
        const rows = get_property_rows();
        const row_index = get_property_row_index_at(e.y);
        if (row_index !== null) {
          const row = rows[row_index];
          let row_top_y = rect.y1 - 3;
          for (let i = 0; i < row_index; i += 1) {
            row_top_y -= get_property_row_height(rows[i]!);
          }
          if (row?.type === 'dual_slider') {
            const side = get_property_side_from_x(e.x) ?? (e.button === 2 ? 'right' : 'left');
            const value = get_dual_slider_value_from_x(row, e.x);
            row.on_change(value, side);
            return;
          }
          if (row?.type === 'dual_toggle') {
            const side = get_property_side_from_x(e.x) ?? (e.button === 2 ? 'right' : 'left');
            if ((side === 'left' && row.left_enabled === false) || (side === 'right' && row.right_enabled === false)) {
              return;
            }
            row.on_toggle(side);
            return;
          }
          if (row?.type === 'single_cycle') {
            if (row.enabled === false) return;
            row.on_cycle();
            return;
          }
          if (row?.type === 'single_toggle') {
            if (row.enabled === false) return;
            row.on_toggle();
            return;
          }
          if (row?.type === 'single_stepper') {
            if (row.enabled === false) return;
            if (is_on_property_stepper_minus(e.x)) {
              row.on_decrement();
              return;
            }
            if (is_on_property_stepper_plus(e.x)) {
              row.on_increment();
              return;
            }
          }
          if (row?.type === 'edit_channel_matrix') {
            const hit = get_edit_channel_matrix_hit(row, e.x, e.y, row_top_y);
            if (!hit) return;
            const column = row.columns.find((entry) => entry.id === hit.column_id);
            if (!column) return;
            if ((hit.side === 'left' && column.left_enabled === false) || (hit.side === 'right' && column.right_enabled === false)) return;
            if (hit.side === 'both' && column.left_enabled === false && column.right_enabled === false) return;
            row.on_toggle(hit.side, hit.column_id);
            return;
          }
        }
      }
      if (opts.custom_panel?.should_render() && opts.custom_panel.on_pointer_down?.(e, rect)) {
        return;
      }
      // Handle brush size slider
      if ((opts.get_current_tool() === 'pencil' || opts.get_current_tool() === 'eraser') && is_on_slider(e.x, e.y)) {
        is_dragging_slider = true;
        dragging_brush_side = e.button === 2 ? 'right' : 'left';
        const new_size = get_size_from_x(e.x);
        const current_size = dragging_brush_side === 'right'
          ? (opts.get_right_brush_size?.() ?? opts.get_brush_size())
          : (opts.get_left_brush_size?.() ?? opts.get_brush_size());
        if (new_size !== current_size) {
          opts.on_brush_size_change(new_size, dragging_brush_side);
        }
      }
      
      // Handle space_replace checkbox for text tool
      if (opts.get_current_tool() === 'text' && is_on_space_checkbox(e.x, e.y)) {
        opts.on_space_replace_change(!opts.get_space_replace());
      }
      
      // Handle text spacing and leading controls
      if (opts.get_current_tool() === 'text') {
        const spacing_btn = is_on_text_spacing_button(e.x, e.y);
        if (spacing_btn === 'minus') {
          const new_val = Math.max(-16, opts.get_text_spacing() - 1);
          opts.on_text_spacing_change(new_val);
        } else if (spacing_btn === 'plus') {
          const new_val = Math.min(16, opts.get_text_spacing() + 1);
          opts.on_text_spacing_change(new_val);
        }
        
        
        const charlead_btn = is_on_text_charlead_button(e.x, e.y);
        if (charlead_btn === 'minus') {
          const new_val = Math.max(-16, opts.get_text_charlead() - 1);
          opts.on_text_charlead_change(new_val);
        } else if (charlead_btn === 'plus') {
          const new_val = Math.min(16, opts.get_text_charlead() + 1);
          opts.on_text_charlead_change(new_val);
        }
        
        const enterlead_btn = is_on_text_enterlead_button(e.x, e.y);
        if (enterlead_btn === 'minus') {
          const new_val = Math.max(-16, opts.get_text_enterlead() - 1);
          opts.on_text_enterlead_change(new_val);
        } else if (enterlead_btn === 'plus') {
          const new_val = Math.min(16, opts.get_text_enterlead() + 1);
          opts.on_text_enterlead_change(new_val);
        }
        
        const enterspace_btn = is_on_text_enterspace_button(e.x, e.y);
        if (enterspace_btn === 'minus') {
          const new_val = Math.max(-16, opts.get_text_enterspace() - 1);
          opts.on_text_enterspace_change(new_val);
        } else if (enterspace_btn === 'plus') {
          const new_val = Math.min(16, opts.get_text_enterspace() + 1);
          opts.on_text_enterspace_change(new_val);
        }
      }
      
      // Handle selection mode change
      if (opts.get_current_tool() === 'selectangle' || opts.get_current_tool() === 'lassoselect') {
        const mode = is_on_selection_mode(e.x, e.y);
        if (mode) {
          opts.on_selection_mode_change(mode);
        }
        
        const btn = is_on_selection_button(e.x, e.y);
        if (btn === 'clear') opts.on_selection_clear?.();
        if (btn === 'invert') opts.on_selection_invert?.();
        if (btn === 'all') opts.on_selection_all?.();
      }
      
      // Handle paste tool interactions
      if (opts.get_current_tool() === 'paste') {
        // Handle paste ignore_space checkbox
        if (is_on_paste_ignore_space(e.x, e.y)) {
          opts.on_paste_ignore_space_change(!opts.get_paste_ignore_space());
          return;
        }
        
        // Handle paste ignore_black checkbox
        if (is_on_paste_ignore_black(e.x, e.y)) {
          opts.on_paste_ignore_black_change(!opts.get_paste_ignore_black());
          return;
        }
        
        // Handle paste ignore_white checkbox
        if (is_on_paste_ignore_white(e.x, e.y)) {
          opts.on_paste_ignore_white_change(!opts.get_paste_ignore_white());
          return;
        }
        
        // Handle paste ignore_color checkbox
        if (is_on_paste_ignore_color(e.x, e.y)) {
          opts.on_paste_ignore_color_change(!opts.get_paste_ignore_color());
          return;
        }
        
        // Handle paste ignore color selector
        if (is_on_paste_ignore_color_selector(e.x, e.y)) {
          opts.on_paste_ignore_color_select();
          return;
        }
        
        // Handle gradiator slot selection
        const gradiatorSlot = is_on_gradiator_slot(e.x, e.y);
        if (gradiatorSlot !== null) {
          opts.on_gradiator_slot_select(gradiatorSlot as GradiatorSlot);
          return;
        }
        
        // Handle gradiator character selection
        const gradiatorChar = is_on_gradiator_char(e.x, e.y);
        if (gradiatorChar !== null) {
          opts.on_gradiator_char_select(gradiatorChar.slot as GradiatorSlot, gradiatorChar.charX);
          return;
        }
        
        // Handle gradiator add/remove buttons
        const gradiatorAdd = is_on_gradiator_add(e.x, e.y);
        if (gradiatorAdd !== null) {
          opts.on_gradiator_add_char(gradiatorAdd as GradiatorSlot);
          return;
        }
        
        const gradiatorRemove = is_on_gradiator_remove(e.x, e.y);
        if (gradiatorRemove !== null) {
          opts.on_gradiator_remove_char(gradiatorRemove as GradiatorSlot);
          return;
        }
        
        // Handle scale minus button
        if (is_on_scale_minus(e.x, e.y)) {
          const currentScale = opts.get_paste_scale();
          const newScale = Math.max(0.1, currentScale - 0.01);
          opts.on_paste_scale_change(newScale);
          console.log('Scale decreased to', Math.round(newScale * 100) + '%');
          return;
        }
        
        // Handle scale plus button
        if (is_on_scale_plus(e.x, e.y)) {
          const currentScale = opts.get_paste_scale();
          const newScale = Math.min(3.0, currentScale + 0.01);
          opts.on_paste_scale_change(newScale);
          console.log('Scale increased to', Math.round(newScale * 100) + '%');
          return;
        }
        
        // Handle scale slider
        if (is_on_scale_slider(e.x, e.y)) {
          is_dragging_scale = true;
          const newScale = get_scale_from_x(e.x);
          opts.on_paste_scale_change(newScale);
          return;
        }
      }
    },
    on_drag_move_content(e: DragEvent): void {
      if (opts.custom_panel?.should_render() && opts.custom_panel.on_drag_move?.(e, rect)) {
        return;
      }
      // Handle slider dragging
      if (is_dragging_slider && (opts.get_current_tool() === 'pencil' || opts.get_current_tool() === 'eraser')) {
        const new_size = get_size_from_x(e.x);
        const current_size = dragging_brush_side === 'right'
          ? (opts.get_right_brush_size?.() ?? opts.get_brush_size())
          : (opts.get_left_brush_size?.() ?? opts.get_brush_size());
        if (new_size !== current_size) {
          opts.on_brush_size_change(new_size, dragging_brush_side);
        }
      }
      
      // Handle scale slider dragging for paste tool
      if (is_dragging_scale && opts.get_current_tool() === 'paste') {
        const new_scale = get_scale_from_x(e.x);
        if (Math.abs(new_scale - opts.get_paste_scale()) > 0.01) {
          opts.on_paste_scale_change(new_scale);
        }
      }
    },
    on_pointer_up_content(): void {
      is_dragging_slider = false;
      dragging_brush_side = 'left';
      is_dragging_scale = false;
      opts.custom_panel?.on_pointer_up?.();
    },
  });
}
