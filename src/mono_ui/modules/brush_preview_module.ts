/**
 * Brush Preview Module
 * 
 * A floating, movable module showing the currently selected brush character.
 * Displays as a simple box with the character in the center.
 * Acts like a "swatch" showing what you're about to draw with.
 */

import type { Canvas, Cell, Module, Rect } from '../types.js';
import { get_color_by_name } from '../colors.js';
import type { ModuleGizmosConfig } from '../module_gizmos.js';
import { make_floating_panel_module } from './floating_panel_module.js';

type PreviewBrush = Pick<Cell, 'char' | 'graphic' | 'appearance_slots' | 'materials' | 'rgb' | 'weight_index'>;

export type BrushPreviewOptions = {
  id: string;
  rect: Rect;
  get_left_brush: () => PreviewBrush;
  get_right_brush: () => PreviewBrush;
  get_left_brush_size?: () => number;
  get_right_brush_size?: () => number;
  get_active_side?: () => 'left' | 'right';
  on_move?: (new_rect: Rect) => void;
  on_close?: () => void;
};

export function make_brush_preview_module(opts: BrushPreviewOptions): Module {
  const gizmo_config: ModuleGizmosConfig = {
    enabled: ['move', 'close', 'seamless'],
    can_close: true,
    can_move: true,
    can_save_position: false,
    on_close: opts.on_close,
    on_move: opts.on_move,
  };

  return make_floating_panel_module({
    id: opts.id,
    rect: opts.rect,
    title: 'PREVIEW',
    gizmos: gizmo_config,
    background: { rgb: get_color_by_name('off_black').rgb },
    draw_content(c: Canvas, rect: Rect): void {
      const left = opts.get_left_brush();
      const right = opts.get_right_brush();
      const active = opts.get_active_side?.() ?? 'left';
      const center_x = Math.floor((rect.x0 + rect.x1) / 2);
      const center_y = Math.floor((rect.y0 + rect.y1) / 2);
      const left_x = Math.max(rect.x0 + 2, center_x - 2);
      const right_x = Math.min(rect.x1 - 1, center_x + 2);
      const label_y = Math.min(rect.y1 - 1, center_y + 2);
      const left_label = `L${opts.get_left_brush_size ? opts.get_left_brush_size() : ''}`;
      const right_label = `R${opts.get_right_brush_size ? opts.get_right_brush_size() : ''}`;

      c.set(left_x, center_y, {
        char: left.char,
        graphic: left.graphic ? { ...left.graphic } : undefined,
        appearance_slots: left.appearance_slots,
        materials: left.materials,
        rgb: left.rgb,
        style: 'regular',
        weight_index: left.weight_index
      });
      c.set(right_x, center_y, {
        char: right.char,
        graphic: right.graphic ? { ...right.graphic } : undefined,
        appearance_slots: right.appearance_slots,
        materials: right.materials,
        rgb: right.rgb,
        style: 'regular',
        weight_index: right.weight_index
      });

      for (let i = 0; i < left_label.length && left_x - 1 + i < center_x; i++) {
        c.set(left_x - 1 + i, label_y, {
          char: left_label[i]!,
          rgb: active === 'left' ? get_color_by_name('vivid_blue').rgb : get_color_by_name('medium_gray').rgb,
          style: 'regular',
          weight_index: 2
        });
      }
      for (let i = 0; i < right_label.length && right_x - 1 + i <= rect.x1 - 1; i++) {
        c.set(right_x - 1 + i, label_y, {
          char: right_label[i]!,
          rgb: active === 'right' ? get_color_by_name('vivid_red').rgb : get_color_by_name('medium_gray').rgb,
          style: 'regular',
          weight_index: 2
        });
      }
    },
  });
}
