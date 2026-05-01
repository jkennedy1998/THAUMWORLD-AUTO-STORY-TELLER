import { nearest_indexed_color, type IndexedColor } from '../colors.js';
import type { Rgb } from '../types.js';

export type ColorPickerAxes = {
  x: number;
  y: number;
  scroll: number;
};

export type ColorPickerAxisAdapter = {
  id: string;
  axis_x_label: string;
  axis_y_label: string;
  axis_scroll_label: string;
  to_rgb: (axes: ColorPickerAxes) => Rgb;
  from_rgb: (rgb: Rgb) => ColorPickerAxes;
  normalize_axes: (axes: ColorPickerAxes) => ColorPickerAxes;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function wrap01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  let wrapped = value % 1;
  if (wrapped < 0) wrapped += 1;
  return wrapped;
}

function hsv_to_rgb(h: number, s: number, v: number): Rgb {
  const hue = wrap01(h) * 6;
  const sat = clamp01(s);
  const val = clamp01(v);
  const chroma = val * sat;
  const x = chroma * (1 - Math.abs((hue % 2) - 1));
  const m = val - chroma;
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hue < 1) {
    r1 = chroma;
    g1 = x;
  } else if (hue < 2) {
    r1 = x;
    g1 = chroma;
  } else if (hue < 3) {
    g1 = chroma;
    b1 = x;
  } else if (hue < 4) {
    g1 = x;
    b1 = chroma;
  } else if (hue < 5) {
    r1 = x;
    b1 = chroma;
  } else {
    r1 = chroma;
    b1 = x;
  }
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

function rgb_to_hsv(rgb: Rgb): ColorPickerAxes {
  const r = clamp01(rgb.r / 255);
  const g = clamp01(rgb.g / 255);
  const b = clamp01(rgb.b / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta > 0) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = ((b - r) / delta) + 2;
    else hue = ((r - g) / delta) + 4;
    hue /= 6;
  }
  const saturation = max === 0 ? 0 : delta / max;
  return {
    x: saturation,
    y: max,
    scroll: wrap01(hue),
  };
}

export const HSV_SV_HUE_PICKER_ADAPTER: ColorPickerAxisAdapter = {
  id: 'hsv_sv_hue',
  axis_x_label: 'SAT',
  axis_y_label: 'VAL',
  axis_scroll_label: 'HUE',
  to_rgb: (axes) => hsv_to_rgb(axes.scroll, axes.x, axes.y),
  from_rgb: (rgb) => rgb_to_hsv(rgb),
  normalize_axes: (axes) => ({
    x: clamp01(axes.x),
    y: clamp01(axes.y),
    scroll: wrap01(axes.scroll),
  }),
};

export function normalize_picker_axes(adapter: ColorPickerAxisAdapter, axes: ColorPickerAxes): ColorPickerAxes {
  return adapter.normalize_axes(axes);
}

export function sample_indexed_picker_color(adapter: ColorPickerAxisAdapter, axes: ColorPickerAxes): IndexedColor {
  return nearest_indexed_color(adapter.to_rgb(normalize_picker_axes(adapter, axes)));
}

export function axes_from_indexed_rgb(adapter: ColorPickerAxisAdapter, rgb: Rgb): ColorPickerAxes {
  return normalize_picker_axes(adapter, adapter.from_rgb(rgb));
}
