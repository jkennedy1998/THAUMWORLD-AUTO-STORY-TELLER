import type { Canvas, DragEvent, Module, PointerEvent, Rect, Rgb, WheelEvent } from '../types.js';
import type { ModuleGizmosConfig } from '../module_gizmos.js';
import { make_floating_panel_module } from './floating_panel_module.js';
import { axes_from_indexed_rgb, HSV_SV_HUE_PICKER_ADAPTER, normalize_picker_axes, sample_indexed_picker_color, type ColorPickerAxes, type ColorPickerAxisAdapter } from '../runtime/color_picker_models.js';
import { find_indexed_color_by_rgb, nearest_indexed_color } from '../colors.js';
import { get_ui_semantic_rgb } from '../runtime/ui_customization_store.js';

export type ColorPickerOptions = {
  id: string;
  rect: Rect;
  title?: string | (() => string);
  get_committed_rgb: (button?: number) => Rgb;
  get_left_selected_rgb?: () => Rgb | null;
  get_right_selected_rgb?: () => Rgb | null;
  on_preview_change?: (rgb: Rgb, button?: number) => void;
  on_commit: (rgb: Rgb, button?: number) => void;
  adapter?: ColorPickerAxisAdapter;
  commit_on_wheel?: boolean;
  show_field_marker?: boolean;
  show_slider_marker?: boolean;
  on_move?: (new_rect: Rect) => void;
  on_close?: () => void;
};

type PickerLayout = {
  field: Rect;
  slider: Rect;
  info_y: number;
  status_y: number;
};

type DragTarget = 'field' | 'slider' | null;

const MIN_WIDTH = 18;
const MAX_WIDTH = 60;
const MIN_HEIGHT = 10;
const MAX_HEIGHT = 36;
const WHEEL_HUE_STEP = 1 / 36;

function rgb_eq(a: Rgb, b: Rgb): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function get_layout(rect: Rect): PickerLayout {
  const inner_left = rect.x0 + 1;
  const inner_right = rect.x1 - 1;
  const inner_bottom = rect.y0 + 1;
  const inner_top = rect.y1 - 2;
  const slider_gap = 1;
  const slider_width = 1;
  const info_rows = 2;
  const field_x0 = inner_left;
  const field_x1 = Math.max(field_x0 + 3, inner_right - slider_width - slider_gap - 1);
  const slider_x0 = clamp(field_x1 + slider_gap + 1, inner_left, inner_right);
  const slider_x1 = clamp(slider_x0 + slider_width - 1, inner_left, inner_right);
  const field_y0 = inner_bottom + info_rows;
  const field_y1 = Math.max(field_y0 + 3, inner_top);
  return {
    field: { x0: field_x0, y0: field_y0, x1: field_x1, y1: field_y1 },
    slider: { x0: slider_x0, y0: field_y0, x1: slider_x1, y1: field_y1 },
    info_y: inner_bottom + 1,
    status_y: inner_bottom,
  };
}

function get_ratio(position: number, start: number, end: number): number {
  if (end <= start) return 0;
  return clamp((position - start) / (end - start), 0, 1);
}

function trim_text(value: string, max_len: number): string {
  if (value.length <= max_len) return value;
  if (max_len <= 3) return value.slice(0, Math.max(0, max_len));
  return `${value.slice(0, max_len - 3)}...`;
}

function resolve_selected_cell_style(color_rgb: Rgb, left_rgb: Rgb | null | undefined, right_rgb: Rgb | null | undefined): { char: string; weight_index: number } {
  const is_left = Boolean(left_rgb) && rgb_eq(color_rgb, left_rgb!);
  const is_right = Boolean(right_rgb) && rgb_eq(color_rgb, right_rgb!);
  if (is_left && is_right) return { char: '▩', weight_index: 1 };
  if (is_left) return { char: '▧', weight_index: 1 };
  if (is_right) return { char: '▨', weight_index: 1 };
  return { char: '█', weight_index: 3 };
}

export function make_color_picker_module(opts: ColorPickerOptions): Module {
  const adapter = opts.adapter ?? HSV_SV_HUE_PICKER_ADAPTER;
  const gizmo_config: ModuleGizmosConfig = {
    enabled: ['move', 'resize', 'close', 'seamless'],
    can_close: true,
    can_move: true,
    can_save_position: false,
    on_close: opts.on_close,
    on_move: opts.on_move,
  };

  let preview_axes = axes_from_indexed_rgb(adapter, nearest_indexed_color(opts.get_committed_rgb()).rgb);
  let committed_axes = { ...preview_axes };
  let preview_rgb = sample_indexed_picker_color(adapter, preview_axes).rgb;
  let committed_rgb = { ...preview_rgb };
  let drag_target: DragTarget = null;
  let active_button = 0;

  function sync_from_rgb(next_rgb: Rgb): void {
    committed_rgb = { ...next_rgb };
    preview_rgb = { ...next_rgb };
    committed_axes = axes_from_indexed_rgb(adapter, next_rgb);
    preview_axes = { ...committed_axes };
  }

  function sync_from_external(): void {
    if (drag_target) return;
    const next_rgb = nearest_indexed_color(opts.get_committed_rgb(active_button)).rgb;
    if (rgb_eq(next_rgb, committed_rgb)) return;
    sync_from_rgb(next_rgb);
  }

  function sync_from_button(button: number): void {
    active_button = button;
  }

  function update_preview_axes(next_axes: ColorPickerAxes): void {
    preview_axes = normalize_picker_axes(adapter, next_axes);
    preview_rgb = { ...sample_indexed_picker_color(adapter, preview_axes).rgb };
    opts.on_preview_change?.({ ...preview_rgb }, active_button);
  }

  function commit_preview(): void {
    committed_axes = { ...preview_axes };
    committed_rgb = { ...preview_rgb };
    opts.on_commit({ ...committed_rgb }, active_button);
  }

  function field_axes_from_point(rect: Rect, x: number, y: number): ColorPickerAxes {
    return normalize_picker_axes(adapter, {
      x: get_ratio(x, rect.x0, rect.x1),
      y: get_ratio(y, rect.y0, rect.y1),
      scroll: preview_axes.scroll,
    });
  }

  function slider_axes_from_point(rect: Rect, y: number): ColorPickerAxes {
    return normalize_picker_axes(adapter, {
      x: preview_axes.x,
      y: preview_axes.y,
      scroll: get_ratio(y, rect.y0, rect.y1),
    });
  }

  function draw_text(c: Canvas, x: number, y: number, text: string, rgb: Rgb, weight_index: number = 1): void {
    for (let i = 0; i < text.length; i += 1) {
      c.set(x + i, y, { char: text[i]!, rgb, style: 'regular', weight_index, render_index: 6 });
    }
  }

  return make_floating_panel_module({
    id: opts.id,
    rect: opts.rect,
    title: opts.title ?? 'PICK COLOR',
    gizmos: gizmo_config,
    background: { rgb: get_ui_semantic_rgb('background') },
    border: {
      border_rgb: get_ui_semantic_rgb('dimmest'),
      text_rgb: get_ui_semantic_rgb('medium'),
    },
    resize: {
      min_width: MIN_WIDTH,
      min_height: MIN_HEIGHT,
      max_width: MAX_WIDTH,
      max_height: MAX_HEIGHT,
    },
    draw_content(c: Canvas, rect: Rect): void {
      sync_from_external();
      const bg_color = get_ui_semantic_rgb('background');
      const medium = get_ui_semantic_rgb('medium');
      const bright = get_ui_semantic_rgb('bright');
      const vivid = get_ui_semantic_rgb('vivid');
      const layout = get_layout(rect);
      const left_selected_rgb = opts.get_left_selected_rgb?.() ?? null;
      const right_selected_rgb = opts.get_right_selected_rgb?.() ?? null;
      c.fill_rect(rect, { char: ' ', rgb: bg_color, style: 'regular', weight_index: 1, render_index: 0 });

      for (let y = layout.field.y0; y <= layout.field.y1; y += 1) {
        for (let x = layout.field.x0; x <= layout.field.x1; x += 1) {
          const axes = field_axes_from_point(layout.field, x, y);
          const color = sample_indexed_picker_color(adapter, axes);
          const cell = resolve_selected_cell_style(color.rgb, left_selected_rgb, right_selected_rgb);
          c.set(x, y, { char: cell.char, rgb: color.rgb, style: 'regular', weight_index: cell.weight_index, render_index: 6 });
        }
      }

      for (let y = layout.slider.y0; y <= layout.slider.y1; y += 1) {
        const color = sample_indexed_picker_color(adapter, slider_axes_from_point(layout.slider, y));
        const cell = resolve_selected_cell_style(color.rgb, left_selected_rgb, right_selected_rgb);
        c.set(layout.slider.x0, y, { char: cell.char, rgb: color.rgb, style: 'regular', weight_index: cell.weight_index, render_index: 6 });
      }

      const preview_x = Math.round(layout.field.x0 + preview_axes.x * Math.max(0, layout.field.x1 - layout.field.x0));
      const preview_y = Math.round(layout.field.y0 + preview_axes.y * Math.max(0, layout.field.y1 - layout.field.y0));
      const slider_y = Math.round(layout.slider.y0 + preview_axes.scroll * Math.max(0, layout.slider.y1 - layout.slider.y0));

      if ((opts.show_field_marker ?? false) && preview_x >= layout.field.x0 && preview_x <= layout.field.x1 && preview_y >= layout.field.y0 && preview_y <= layout.field.y1) {
        c.set(preview_x, preview_y, { char: '◎', rgb: vivid, style: 'regular', weight_index: 3, render_index: 7 });
      }
      if ((opts.show_slider_marker ?? true) && layout.slider.x0 - 1 >= rect.x0 + 1) {
        c.set(layout.slider.x0 - 1, slider_y, { char: '▶', rgb: bright, style: 'regular', weight_index: 2, render_index: 7 });
      }

      const indexed = find_indexed_color_by_rgb(preview_rgb) ?? nearest_indexed_color(preview_rgb);
      const status = trim_text(`${indexed.name.toUpperCase()} ${indexed.hex}`, Math.max(0, rect.x1 - rect.x0 - 2));
      const axes_text = trim_text(`${adapter.axis_x_label}/${adapter.axis_y_label} ${adapter.axis_scroll_label}`, Math.max(0, rect.x1 - rect.x0 - 2));
      draw_text(c, rect.x0 + 1, layout.info_y, status, medium, 1);
      draw_text(c, rect.x0 + 1, layout.status_y, axes_text, bright, 1);
    },
    on_pointer_down_content(e: PointerEvent, rect: Rect): void {
      const layout = get_layout(rect);
      sync_from_button(e.button);
      if (e.x >= layout.field.x0 && e.x <= layout.field.x1 && e.y >= layout.field.y0 && e.y <= layout.field.y1) {
        drag_target = 'field';
        update_preview_axes(field_axes_from_point(layout.field, e.x, e.y));
        return;
      }
      if (e.x >= layout.slider.x0 - 1 && e.x <= layout.slider.x1 && e.y >= layout.slider.y0 && e.y <= layout.slider.y1) {
        drag_target = 'slider';
        update_preview_axes(slider_axes_from_point(layout.slider, e.y));
      }
    },
    on_drag_move_content(e: DragEvent, rect: Rect): void {
      const layout = get_layout(rect);
      if (drag_target === 'field') {
        update_preview_axes(field_axes_from_point(layout.field, e.x, e.y));
      } else if (drag_target === 'slider') {
        update_preview_axes(slider_axes_from_point(layout.slider, e.y));
      }
    },
    on_pointer_up_content(): void {
      if (!drag_target) return;
      commit_preview();
      drag_target = null;
    },
    on_wheel_content(e: WheelEvent): void {
      sync_from_external();
      update_preview_axes({ ...preview_axes, scroll: preview_axes.scroll + (e.delta_y > 0 ? -WHEEL_HUE_STEP : WHEEL_HUE_STEP) });
      if (opts.commit_on_wheel) commit_preview();
    },
    on_pointer_leave_content(): void {
      if (!drag_target) return;
    },
  });
}
