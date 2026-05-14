/**
 * Tool Properties Module
 * 
 * A floating module showing properties for the currently selected tool.
 * For brush tools, shows brush tip size slider (1x1 to 5x5).
 */

import type { Canvas, Module, Rect, PointerEvent, DragEvent, WheelEvent } from '../types.js';
import { get_color_by_name } from '../colors.js';
import { PANEL_BORDER_PRESETS } from '../module_borders.js';
import type { ModuleGizmosConfig } from '../module_gizmos.js';
import { make_floating_panel_module } from './floating_panel_module.js';
import { get_ui_semantic_rgb } from '../runtime/ui_customization_store.js';
import { clamp_numeric_slider_value, draw_numeric_dual_slider_markers, draw_numeric_single_slider_markers, draw_numeric_slider_track, get_numeric_slider_layout, get_numeric_slider_marker_x, get_numeric_slider_nudge_hit, get_numeric_slider_value_from_x } from '../runtime/slider_primitives.js';
import type { ToolEditTarget, ToolType } from '../../ascii_painter/types.js';
import type { SelectionMode } from '../../ascii_painter/selection.js';

type ToolPropertiesCustomPanel = {
  should_render: () => boolean;
  draw: (c: Canvas, rect: Rect) => void;
  on_pointer_down?: (e: PointerEvent, rect: Rect) => boolean | void;
  on_drag_move?: (e: DragEvent, rect: Rect) => boolean | void;
  on_pointer_up?: () => void;
};

export type ToolPropertyRow =
  | {
      type: 'single_slider';
      id: string;
      label: string;
      min: number;
      max: number;
      value: number;
      show_value_label?: boolean;
      format_value?: (value: number) => string;
      on_change: (value: number) => void;
    }
  | {
      type: 'dual_slider';
      id: string;
      label: string;
      min: number;
      max: number;
      left_value: number;
      right_value: number;
      format_value?: (value: number) => string;
      show_value_label?: boolean;
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
      row_label?: string;
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
    }
  | {
      type: 'separator';
      id: string;
    };

export type ToolPropertiesOptions = {
  id: string;
  rect: Rect;
  get_current_tool: () => ToolType | string;
  get_current_tool_target?: () => ToolEditTarget;
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
const MAX_WIDTH = 40;
const MIN_HEIGHT = 8;
const MAX_HEIGHT = 40;
const PROPERTY_WHEEL_STEP = 3;

export function make_tool_properties_module(opts: ToolPropertiesOptions): Module {
  function is_current_rect_selection_tool(): boolean {
    const tool = opts.get_current_tool();
    return (tool === 'rect_stroke' || tool === 'rect_fill') && opts.get_current_tool_target?.() === 'selection';
  }

  let rect = opts.rect;
  let property_scroll_offset = 0;
  
  const gizmo_config: ModuleGizmosConfig = {
    enabled: ['move', 'resize', 'close', 'seamless'],
    can_close: true,
    can_move: true,
    can_save_position: false,
    on_close: opts.on_close,
    on_move: opts.on_move,
  };
  let is_dragging_scale = false;

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

  function get_selection_controls_layout(): {
    modes: Array<{ mode: SelectionMode; x0: number; x1: number; y: number; label: string }>;
    buttons: Array<{ id: 'clear' | 'invert' | 'all'; x0: number; x1: number; y: number; label: string }>;
  } {
    const modes: SelectionMode[] = ['replace', 'additive', 'subtract', 'intersect'];
    const modeRows = modes.map((mode, index) => {
      const y = rect.y1 - 4 - index;
      const label = mode.charAt(0).toUpperCase() + mode.slice(1);
      return { mode, x0: rect.x0 + 2, x1: Math.min(rect.x1 - 2, rect.x0 + 4 + label.length - 1), y, label };
    });
    const buttonIds: Array<'clear' | 'invert' | 'all'> = ['clear', 'invert', 'all'];
    let btn_x = rect.x0 + 2;
    const buttons = buttonIds.map((id) => {
      const label = id === 'clear' ? '[Clear]' : id === 'invert' ? '[Invert]' : '[All]';
      const x0 = btn_x;
      const x1 = Math.min(rect.x1 - 1, btn_x + label.length - 1);
      const button = { id, x0, x1, y: rect.y1 - 8, label };
      btn_x += label.length + 1;
      return button;
    });
    return { modes: modeRows, buttons };
  }

  // Check if position is on selection mode option
  function is_on_selection_mode(x: number, y: number): SelectionMode | null {
    const hit = get_selection_controls_layout().modes.find((entry) => entry.y === y && x >= entry.x0 && x <= entry.x1);
    return hit?.mode ?? null;
  }

  // Check if position is on selection button
  function is_on_selection_button(x: number, y: number): 'clear' | 'invert' | 'all' | null {
    const hit = get_selection_controls_layout().buttons.find((entry) => entry.y === y && x >= entry.x0 && x <= entry.x1);
    return hit?.id ?? null;
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
    if (row.type === 'single_slider' || row.type === 'dual_slider') return 2;
    if (row.type === 'edit_channel_matrix') return 2;
    if (row.type === 'separator') return 2;
    return 1;
  }

  function get_property_label_x(): number {
    return rect.x0 + 3;
  }

  function get_property_content_x(): number {
    return rect.x0 + 11;
  }

  function get_matrix_token_text(row: Extract<ToolPropertyRow, { type: 'edit_channel_matrix' }>, column: Extract<ToolPropertyRow, { type: 'edit_channel_matrix' }>['columns'][number]): string {
    return (row.row_label ?? '') === 'target' ? column.label.toLowerCase() : column.label.slice(0, 3).toLowerCase();
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

  function get_property_rows_total_height(): number {
    return get_property_rows().reduce((sum, row) => sum + get_property_row_height(row), 0);
  }

  function get_property_rows_visible_height(): number {
    return Math.max(0, rect.y1 - rect.y0 - 2);
  }

  function get_property_rows_max_scroll(): number {
    return Math.max(0, get_property_rows_total_height() - get_property_rows_visible_height());
  }

  function clamp_property_scroll(): void {
    property_scroll_offset = Math.max(0, Math.min(get_property_rows_max_scroll(), property_scroll_offset));
  }

  function get_property_row_index_at(y: number): number | null {
    const rows = get_property_rows();
    clamp_property_scroll();
    let cursor_y = rect.y1 - 3 + property_scroll_offset;
    for (let i = 0; i < rows.length; i++) {
      const height = get_property_row_height(rows[i]!);
      if (y <= cursor_y && y > cursor_y - height) return i;
      cursor_y -= height;
    }
    return null;
  }

  function get_slider_layout() {
    return get_numeric_slider_layout(get_property_content_x(), rect.x1 - 3);
  }

  function get_slider_marker_x(min: number, max: number, value: number): number {
    return get_numeric_slider_marker_x(get_slider_layout(), min, max, value);
  }

  function get_slider_nudge_hit(x: number): 'decrement' | 'increment' | null {
    return get_numeric_slider_nudge_hit(get_slider_layout(), x);
  }

  function get_edit_channel_matrix_hit(row: Extract<ToolPropertyRow, { type: 'edit_channel_matrix' }>, x: number, y: number, top_y: number, button: number): { side: 'left' | 'right'; column_id: string } | null {
    if (y !== top_y) return null;
    const start_x = get_property_content_x();
    const inner_width = Math.max(1, rect.x1 - start_x - 1);
    const col_width = Math.max((row.row_label ?? '') === 'target' ? 7 : 4, Math.floor(inner_width / Math.max(1, row.columns.length)));
    for (let i = 0; i < row.columns.length; i += 1) {
      const column = row.columns[i]!;
      const col_x = start_x + (i * col_width);
      const token = get_matrix_token_text(row, column);
      const token_x = col_x + Math.max(0, Math.floor((col_width - token.length) / 2));
      if (x >= token_x && x < token_x + token.length) {
        return { side: button === 2 ? 'right' : 'left', column_id: column.id };
      }
    }
    return null;
  }

  function get_dual_slider_value_from_x(row: Extract<ToolPropertyRow, { type: 'dual_slider' }>, x: number): number {
    return get_numeric_slider_value_from_x(get_slider_layout(), row.min, row.max, x);
  }

  function get_single_slider_value_from_x(row: Extract<ToolPropertyRow, { type: 'single_slider' }>, x: number): number {
    return get_numeric_slider_value_from_x(get_slider_layout(), row.min, row.max, x);
  }

  return make_floating_panel_module({
    id: opts.id,
    rect: opts.rect,
    title: opts.title ?? 'PROPS',
    gizmos: gizmo_config,
    background: { rgb: get_ui_semantic_rgb('background') },
    border: {
      style: PANEL_BORDER_PRESETS.default_double.style,
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
      const bg_color = get_ui_semantic_rgb('background');
      const text_color = get_ui_semantic_rgb('bright');
      const medium_color = get_ui_semantic_rgb('medium');
      const bright_color = get_ui_semantic_rgb('bright');
      const vivid_color = get_ui_semantic_rgb('vivid');
      const left_color = get_ui_semantic_rgb('left_hand');
      const right_color = get_ui_semantic_rgb('right_hand');
      const slider_bg = get_ui_semantic_rgb('dimmest');
      const slider_fg = bright_color;
      const handle_color = vivid_color;
      
      // Fill background
      c.fill_rect(rect, { char: ' ', rgb: bg_color, style: 'regular' });

      if (should_render_property_rows()) {
        const rows = get_property_rows();
        const active_side = opts.get_active_side?.() ?? 'left';
        clamp_property_scroll();
        let cursor_y = rect.y1 - 3 + property_scroll_offset;
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i]!;
          const y = cursor_y;
          if (y <= rect.y0) break;
          if (row.type === 'dual_toggle') {
            const label = row.note ? `${row.label} ${row.note}` : row.label;
            const label_rgb = row.note ? medium_color : text_color;
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
            const left_rgb = active_side === 'left' ? left_color : text_color;
            const right_rgb = active_side === 'right' ? right_color : text_color;
            for (let j = 0; j < left_text.length; j++) {
              c.set(rect.x0 + 15 + j, y, { char: left_text[j]!, rgb: left_rgb, style: 'regular', weight_index: 2 });
            }
            for (let j = 0; j < right_text.length; j++) {
              c.set(rect.x0 + 19 + j, y, { char: right_text[j]!, rgb: right_rgb, style: 'regular', weight_index: 2 });
            }
          } else if (row.type === 'dual_slider') {
            const label = row.label.charAt(0) + row.label.slice(1).toLowerCase();
            const label_x = get_property_label_x();
            for (let j = 0; j < label.length && label_x + j < rect.x1; j++) {
              c.set(label_x + j, y, { char: label[j]!, rgb: medium_color, style: 'regular', weight_index: 1 });
            }
            if (row.show_value_label !== false) {
              const value_label = row.format_value
                ? `L:${row.format_value(row.left_value)} R:${row.format_value(row.right_value)}`
                : `L:${row.left_value} R:${row.right_value}`;
              const value_x = Math.min(rect.x1 - value_label.length - 1, get_property_content_x());
              for (let j = 0; j < value_label.length && value_x + j < rect.x1; j++) {
                c.set(value_x + j, y, {
                  char: value_label[j]!,
                  rgb: text_color,
                  style: 'regular',
                  weight_index: 2,
                });
              }
            }
            const slider_y = y - 1;
            if (slider_y <= rect.y0) continue;
            const layout = get_slider_layout();
            draw_numeric_slider_track(c, layout, slider_y, { track_rgb: slider_bg, nudge_rgb: bright_color });
            draw_numeric_dual_slider_markers(c, layout, slider_y, {
              min: row.min,
              max: row.max,
              left_value: row.left_value,
              right_value: row.right_value,
              left_rgb: left_color,
              right_rgb: right_color,
              both_rgb: vivid_color,
              inactive_rgb: slider_bg,
            });
          } else if (row.type === 'single_slider') {
            const label = row.label.charAt(0) + row.label.slice(1).toLowerCase();
            const label_x = get_property_label_x();
            for (let j = 0; j < label.length && label_x + j < rect.x1; j++) {
              c.set(label_x + j, y, { char: label[j]!, rgb: medium_color, style: 'regular', weight_index: 1 });
            }
            if (row.show_value_label !== false) {
              const value_label = row.format_value ? row.format_value(row.value) : `${row.value}`;
              const value_x = Math.min(rect.x1 - value_label.length - 1, get_property_content_x());
              for (let j = 0; j < value_label.length && value_x + j < rect.x1; j++) {
                c.set(value_x + j, y, {
                  char: value_label[j]!,
                  rgb: text_color,
                  style: 'regular',
                  weight_index: 2,
                });
              }
            }
            const slider_y = y - 1;
            if (slider_y <= rect.y0) continue;
            const layout = get_slider_layout();
            draw_numeric_slider_track(c, layout, slider_y, { track_rgb: slider_bg, nudge_rgb: bright_color });
            draw_numeric_single_slider_markers(c, layout, slider_y, {
              min: row.min,
              max: row.max,
              value: row.value,
              active_rgb: bright_color,
              inactive_rgb: slider_bg,
            });
          } else if (row.type === 'single_cycle') {
            const label = `${row.label}:`;
            const value = row.options && row.options.length > 0
              ? `[${row.value}]`
              : row.value;
            const label_rgb = row.enabled === false ? get_ui_semantic_rgb('dimmest') : medium_color;
            const value_rgb = row.enabled === false ? get_ui_semantic_rgb('dimmest') : bright_color;
            const label_x = get_property_label_x();
            for (let j = 0; j < label.length && label_x + j < rect.x1; j++) {
              c.set(label_x + j, y, {
                char: label[j]!,
                rgb: label_rgb,
                style: 'regular',
                weight_index: 2,
              });
            }
            const value_x = Math.min(rect.x1 - value.length - 1, get_property_content_x());
            for (let j = 0; j < value.length && value_x + j < rect.x1; j++) {
              c.set(value_x + j, y, {
                char: value[j]!,
                rgb: value_rgb,
                style: 'regular',
                weight_index: 2,
              });
            }
          } else if (row.type === 'single_toggle') {
            const label_rgb = row.enabled === false ? get_ui_semantic_rgb('dimmest') : medium_color;
            const value_rgb = row.enabled === false ? get_ui_semantic_rgb('dimmest') : bright_color;
            const label = row.label;
            const value = row.value ? '[x]' : '[ ]';
            const label_x = get_property_label_x();
            for (let j = 0; j < label.length && label_x + j < rect.x1; j++) {
              c.set(label_x + j, y, { char: label[j]!, rgb: label_rgb, style: 'regular', weight_index: 2 });
            }
            const value_x = Math.min(rect.x1 - value.length - 1, get_property_content_x());
            for (let j = 0; j < value.length && value_x + j < rect.x1; j++) {
              c.set(value_x + j, y, { char: value[j]!, rgb: value_rgb, style: 'regular', weight_index: 2 });
            }
          } else if (row.type === 'single_stepper') {
            const label_rgb = row.enabled === false ? get_ui_semantic_rgb('dimmest') : medium_color;
            const value_rgb = row.enabled === false ? get_ui_semantic_rgb('dimmest') : bright_color;
            const label = `${row.label}:`;
            const label_x = get_property_label_x();
            for (let j = 0; j < label.length && label_x + j < rect.x1; j++) {
              c.set(label_x + j, y, { char: label[j]!, rgb: label_rgb, style: 'regular', weight_index: 2 });
            }
            const value_x = Math.min(rect.x1 - row.value.length - 5, get_property_content_x());
            for (let j = 0; j < row.value.length && value_x + j < rect.x1; j++) {
              c.set(value_x + j, y, { char: row.value[j]!, rgb: value_rgb, style: 'regular', weight_index: 2 });
            }
            c.set(rect.x1 - 3, y, { char: '-', rgb: row.enabled === false ? get_ui_semantic_rgb('dimmest') : slider_fg, style: 'regular', weight_index: 2 });
            c.set(rect.x1 - 1, y, { char: '+', rgb: row.enabled === false ? get_ui_semantic_rgb('dimmest') : bright_color, style: 'regular', weight_index: 2 });
          } else if (row.type === 'edit_channel_matrix') {
            const label = row.row_label ?? '';
            const label_x = get_property_label_x();
            const start_x = get_property_content_x();
            const inner_width = Math.max(1, rect.x1 - start_x - 1);
            const col_width = Math.max((label === 'target') ? 7 : 4, Math.floor(inner_width / Math.max(1, row.columns.length)));
            for (let j = 0; j < label.length && label_x + j < rect.x1; j++) {
              c.set(label_x + j, y, { char: label[j]!, rgb: medium_color, style: 'regular', weight_index: 1 });
            }
            for (let i = 0; i < row.columns.length; i += 1) {
              const column = row.columns[i]!;
              const col_x = start_x + (i * col_width);
              const title = get_matrix_token_text(row, column);
              const title_x = col_x + Math.max(0, Math.floor((col_width - title.length) / 2));
              const both_on = column.left_value && column.right_value;
              const left_on = column.left_value && !column.right_value;
              const right_on = column.right_value && !column.left_value;
              const title_rgb = column.left_enabled === false && column.right_enabled === false
                ? get_ui_semantic_rgb('dimmest')
                : both_on
                  ? vivid_color
                  : left_on
                    ? left_color
                    : right_on
                      ? right_color
                      : bright_color;
              for (let j = 0; j < title.length && title_x + j < rect.x1; j++) {
                c.set(title_x + j, y, { char: title[j]!, rgb: title_rgb, style: 'regular', weight_index: both_on || left_on || right_on ? 2 : 0 });
              }
            }
          } else if (row.type === 'separator') {
            for (let sx = get_property_label_x(); sx < rect.x1 - 1; sx += 1) {
              c.set(sx, y, { char: '─', rgb: get_ui_semantic_rgb('dimmest'), style: 'regular', weight_index: 1 });
            }
          } else if (row.type === 'info') {
            const label_x = get_property_label_x();
            for (let j = 0; j < row.text.length && label_x + j < rect.x1; j++) {
              c.set(label_x + j, y, {
                char: row.text[j]!,
                rgb: row.rgb ?? medium_color,
                style: 'regular',
                weight_index: 1,
              });
            }
          }
          cursor_y -= get_property_row_height(row);
        }
        const max_scroll = get_property_rows_max_scroll();
        if (max_scroll > 0) {
          if (property_scroll_offset > 0) {
            c.set(rect.x1 - 2, rect.y0 + 1, { char: '^', rgb: vivid_color, style: 'regular', weight_index: 2 });
          }
          if (property_scroll_offset < max_scroll) {
            c.set(rect.x1 - 2, rect.y1 - 1, { char: 'v', rgb: vivid_color, style: 'regular', weight_index: 2 });
          }
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
      } else if (is_current_rect_selection_tool() || opts.get_current_tool() === 'lassoselect') {
        const current_mode = opts.get_selection_mode();
        const selectionLayout = get_selection_controls_layout();

        for (const row of selectionLayout.modes) {
          const is_selected = current_mode === row.mode;
          c.set(rect.x0 + 2, row.y, {
            char: is_selected ? '●' : '○',
            rgb: is_selected ? vivid_color : medium_color,
            style: 'regular',
            weight_index: is_selected ? 2 : 1
          });

          for (let i = 0; i < row.label.length && rect.x0 + 4 + i < rect.x1; i++) {
            c.set(rect.x0 + 4 + i, row.y, {
              char: row.label[i]!,
              rgb: is_selected ? bright_color : medium_color,
              style: 'regular',
              weight_index: 1
            });
          }
        }

        for (const button of selectionLayout.buttons) {
          for (let i = 0; i < button.label.length && button.x0 + i < rect.x1; i++) {
            c.set(button.x0 + i, button.y, {
              char: button.label[i]!,
              rgb: medium_color,
              style: 'regular',
              weight_index: 1
            });
          }
        }
      } else if (opts.get_current_tool() === 'paste') {
        const pasteScale = opts.get_paste_scale();
        const paste_replace = opts.get_paste_space_replace();

        const visuals_hint_y = rect.y1 - 3;
        const visuals_hint = 'Gradiator: VISUALS';
        for (let i = 0; i < visuals_hint.length && rect.x0 + 2 + i < rect.x1; i++) {
          c.set(rect.x0 + 2 + i, visuals_hint_y, {
            char: visuals_hint[i]!,
            rgb: i < 10 ? get_ui_semantic_rgb('medium') : get_ui_semantic_rgb('vivid'),
            style: 'regular',
            weight_index: i < 10 ? 2 : 3,
          });
        }

        const visuals_hint_2_y = rect.y1 - 4;
        const visuals_hint_2 = 'edit ramps in picker';
        for (let i = 0; i < visuals_hint_2.length && rect.x0 + 2 + i < rect.x1; i++) {
          c.set(rect.x0 + 2 + i, visuals_hint_2_y, {
            char: visuals_hint_2[i]!,
            rgb: get_ui_semantic_rgb('medium'),
            style: 'regular',
            weight_index: 2,
          });
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
          let row_top_y = rect.y1 - 3 + property_scroll_offset;
          for (let i = 0; i < row_index; i += 1) {
            row_top_y -= get_property_row_height(rows[i]!);
          }
          if (row?.type === 'dual_slider') {
            const side: 'left' | 'right' = e.button === 2 ? 'right' : 'left';
            const nudge = get_slider_nudge_hit(e.x);
            const current_value = side === 'right' ? row.right_value : row.left_value;
            const value = nudge === 'decrement'
              ? clamp_numeric_slider_value(current_value - 1, row.min, row.max)
              : nudge === 'increment'
                ? clamp_numeric_slider_value(current_value + 1, row.min, row.max)
                : get_dual_slider_value_from_x(row, e.x);
            row.on_change(value, side);
            return;
          }
          if (row?.type === 'single_slider') {
            const nudge = get_slider_nudge_hit(e.x);
            const value = nudge === 'decrement'
              ? clamp_numeric_slider_value(row.value - 1, row.min, row.max)
              : nudge === 'increment'
                ? clamp_numeric_slider_value(row.value + 1, row.min, row.max)
                : get_single_slider_value_from_x(row, e.x);
            row.on_change(value);
            return;
          }
          if (row?.type === 'dual_toggle') {
            const side: 'left' | 'right' = e.button === 2 ? 'right' : 'left';
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
            const hit = get_edit_channel_matrix_hit(row, e.x, e.y, row_top_y, e.button);
            if (!hit) return;
            const column = row.columns.find((entry) => entry.id === hit.column_id);
            if (!column) return;
            if ((hit.side === 'left' && column.left_enabled === false) || (hit.side === 'right' && column.right_enabled === false)) return;
            row.on_toggle(hit.side, hit.column_id);
            return;
          }
        }
      }
      if (opts.custom_panel?.should_render() && opts.custom_panel.on_pointer_down?.(e, rect)) {
        return;
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
      if (is_current_rect_selection_tool() || opts.get_current_tool() === 'lassoselect') {
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
      // Handle scale slider dragging for paste tool
      if (is_dragging_scale && opts.get_current_tool() === 'paste') {
        const new_scale = get_scale_from_x(e.x);
        if (Math.abs(new_scale - opts.get_paste_scale()) > 0.01) {
          opts.on_paste_scale_change(new_scale);
        }
      }
    },
    on_pointer_up_content(): void {
      is_dragging_scale = false;
      opts.custom_panel?.on_pointer_up?.();
    },
    on_wheel_content(e: WheelEvent): void {
      if (should_render_property_rows()) {
        property_scroll_offset += e.delta_y > 0 ? PROPERTY_WHEEL_STEP : e.delta_y < 0 ? -PROPERTY_WHEEL_STEP : 0;
        clamp_property_scroll();
        return;
      }
    },
  });
}
