import type { Canvas, Rgb } from '../types.js';

export type NumericSliderLayout = {
  left_arrow_x: number;
  slider_start_x: number;
  slider_end_x: number;
  right_arrow_x: number;
};

export type NumericSliderNudge = 'decrement' | 'increment' | null;

export function get_numeric_slider_layout(content_start_x: number, content_end_x: number): NumericSliderLayout {
  return {
    left_arrow_x: content_start_x - 2,
    slider_start_x: content_start_x,
    slider_end_x: content_end_x,
    right_arrow_x: content_end_x + 2,
  };
}

export function clamp_numeric_slider_value(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function get_numeric_slider_marker_x(layout: NumericSliderLayout, min: number, max: number, value: number): number {
  const denom = Math.max(1, max - min);
  const ratio = (value - min) / denom;
  return Math.round(layout.slider_start_x + ratio * (layout.slider_end_x - layout.slider_start_x));
}

export function get_numeric_slider_value_from_x(layout: NumericSliderLayout, min: number, max: number, x: number): number {
  const track_width = Math.max(1, layout.slider_end_x - layout.slider_start_x);
  const relative_x = Math.max(0, Math.min(track_width, x - layout.slider_start_x));
  const ratio = relative_x / track_width;
  const value = min + ratio * (max - min);
  return clamp_numeric_slider_value(Math.round(value), min, max);
}

export function get_numeric_slider_value_from_x_float(layout: NumericSliderLayout, min: number, max: number, x: number): number {
  const track_width = Math.max(1, layout.slider_end_x - layout.slider_start_x);
  const relative_x = Math.max(0, Math.min(track_width, x - layout.slider_start_x));
  const ratio = relative_x / track_width;
  return clamp_numeric_slider_value(min + ratio * (max - min), min, max);
}

export function get_numeric_slider_nudge_hit(layout: NumericSliderLayout, x: number): NumericSliderNudge {
  if (x === layout.left_arrow_x) return 'decrement';
  if (x === layout.right_arrow_x) return 'increment';
  return null;
}

export function draw_numeric_slider_track(c: Canvas, layout: NumericSliderLayout, y: number, opts: {
  track_rgb: Rgb;
  track_char?: string;
  track_weight?: number;
  nudge_rgb: Rgb;
  nudge_weight?: number;
  left_nudge_char?: string;
  right_nudge_char?: string;
}): void {
  const track_char = opts.track_char ?? '─';
  const track_weight = opts.track_weight ?? 1;
  const nudge_weight = opts.nudge_weight ?? 2;
  const left_nudge_char = opts.left_nudge_char ?? '<';
  const right_nudge_char = opts.right_nudge_char ?? '>';
  for (let sx = layout.slider_start_x; sx <= layout.slider_end_x; sx += 1) {
    c.set(sx, y, { char: track_char, rgb: opts.track_rgb, style: 'regular', weight_index: track_weight });
  }
  c.set(layout.left_arrow_x, y, { char: left_nudge_char, rgb: opts.nudge_rgb, style: 'regular', weight_index: nudge_weight });
  c.set(layout.right_arrow_x, y, { char: right_nudge_char, rgb: opts.nudge_rgb, style: 'regular', weight_index: nudge_weight });
}

export function draw_numeric_single_slider_markers(c: Canvas, layout: NumericSliderLayout, y: number, opts: {
  min: number;
  max: number;
  value: number;
  tick_count?: number;
  active_char?: string;
  inactive_char?: string;
  active_rgb: Rgb;
  inactive_rgb: Rgb;
  active_weight?: number;
  inactive_weight?: number;
}): void {
  const active_char = opts.active_char ?? '▥';
  const inactive_char = opts.inactive_char ?? 'o';
  const active_weight = opts.active_weight ?? 2;
  const inactive_weight = opts.inactive_weight ?? 1;
  const tick_count = Math.max(2, opts.tick_count ?? 5);
  for (let i = 0; i < tick_count; i += 1) {
    const ratio = tick_count === 1 ? 0 : i / (tick_count - 1);
    const tick_value = opts.min + ratio * (opts.max - opts.min);
    const marker_x = get_numeric_slider_marker_x(layout, opts.min, opts.max, tick_value);
    c.set(marker_x, y, {
      char: inactive_char,
      rgb: opts.inactive_rgb,
      style: 'regular',
      weight_index: inactive_weight,
    });
  }
  const active_x = get_numeric_slider_marker_x(layout, opts.min, opts.max, opts.value);
  c.set(active_x, y, {
    char: active_char,
    rgb: opts.active_rgb,
    style: 'regular',
    weight_index: active_weight,
  });
}

export function draw_numeric_dual_slider_markers(c: Canvas, layout: NumericSliderLayout, y: number, opts: {
  min: number;
  max: number;
  left_value: number;
  right_value: number;
  left_rgb: Rgb;
  right_rgb: Rgb;
  both_rgb: Rgb;
  inactive_rgb: Rgb;
  left_char?: string;
  right_char?: string;
  both_char?: string;
  inactive_char?: string;
  active_weight?: number;
  inactive_weight?: number;
}): void {
  const left_char = opts.left_char ?? 'L';
  const right_char = opts.right_char ?? 'R';
  const both_char = opts.both_char ?? 'B';
  const inactive_char = opts.inactive_char ?? 'o';
  const active_weight = opts.active_weight ?? 2;
  const inactive_weight = opts.inactive_weight ?? 1;
  for (let value = opts.min; value <= opts.max; value += 1) {
    const marker_x = get_numeric_slider_marker_x(layout, opts.min, opts.max, value);
    const is_left = value === opts.left_value;
    const is_right = value === opts.right_value;
    c.set(marker_x, y, {
      char: is_left && is_right ? both_char : is_left ? left_char : is_right ? right_char : inactive_char,
      rgb: is_left && is_right ? opts.both_rgb : is_left ? opts.left_rgb : is_right ? opts.right_rgb : opts.inactive_rgb,
      style: 'regular',
      weight_index: is_left || is_right ? active_weight : inactive_weight,
    });
  }
}
