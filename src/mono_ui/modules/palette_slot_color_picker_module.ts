import type { Module, Rect, Rgb } from '../types.js';
import { axes_from_rgb, HSV_SV_HUE_PICKER_ADAPTER, sample_picker_rgb } from '../runtime/color_picker_models.js';
import type { IndexedPaletteEntry } from '../runtime/indexed_palette_store.js';
import { make_color_picker_module } from './color_picker_module.js';

export type PaletteSlotColorPickerOptions = {
  id: string;
  rect: Rect;
  title?: string | (() => string);
  get_active_entry: () => IndexedPaletteEntry | null;
  on_preview_change?: (rgb: Rgb) => void;
  on_commit: (rgb: Rgb) => void;
  on_move?: (new_rect: Rect) => void;
  on_close?: () => void;
};

function rgb_to_hex(rgb: Rgb): string {
  return `#${rgb.r.toString(16).padStart(2, '0')}${rgb.g.toString(16).padStart(2, '0')}${rgb.b.toString(16).padStart(2, '0')}`.toUpperCase();
}

export function make_palette_slot_color_picker_module(opts: PaletteSlotColorPickerOptions): Module {
  return make_color_picker_module({
    id: opts.id,
    rect: opts.rect,
    title: opts.title ?? (() => {
      const entry = opts.get_active_entry();
      return entry ? `SET ${String(entry.label ?? 'COLOR').toUpperCase()}` : 'SET PALETTE COLOR';
    }),
    adapter: HSV_SV_HUE_PICKER_ADAPTER,
    get_committed_rgb: () => opts.get_active_entry()?.rgb ?? { r: 255, g: 255, b: 255 },
    get_preview_rgb: (adapter, axes) => sample_picker_rgb(adapter, axes),
    get_axes_from_rgb: (adapter, rgb) => axes_from_rgb(adapter, rgb),
    get_status_text: (rgb) => rgb_to_hex(rgb),
    on_preview_change: (rgb) => opts.on_preview_change?.(rgb),
    on_commit: (rgb) => opts.on_commit(rgb),
    commit_on_wheel: false,
    show_field_marker: true,
    show_slider_marker: true,
    on_move: opts.on_move,
    on_close: opts.on_close,
  });
}
