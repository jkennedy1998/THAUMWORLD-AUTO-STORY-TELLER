import type { Module, Rect, Rgb } from '../types.js';
import { make_color_picker_module } from './color_picker_module.js';

export type BrushColorBlockOptions = {
  id: string;
  rect: Rect;
  get_left_rgb: () => Rgb;
  get_right_rgb: () => Rgb;
  on_color_commit: (side: 'left' | 'right', rgb: Rgb) => void;
  on_move?: (new_rect: Rect) => void;
  on_close?: () => void;
};

export function make_brush_color_block_module(opts: BrushColorBlockOptions): Module {
  return make_color_picker_module({
    id: opts.id,
    rect: opts.rect,
    title: 'COLOR BLOCK',
    get_committed_rgb: (button) => button === 2 ? opts.get_right_rgb() : opts.get_left_rgb(),
    get_left_selected_rgb: () => opts.get_left_rgb(),
    get_right_selected_rgb: () => opts.get_right_rgb(),
    on_commit: (rgb, button) => {
      opts.on_color_commit(button === 2 ? 'right' : 'left', rgb);
    },
    commit_on_wheel: false,
    show_field_marker: false,
    show_slider_marker: true,
    on_move: opts.on_move,
    on_close: opts.on_close,
  });
}
