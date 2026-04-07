/**
 * Weight Selector Module
 * 
 * A floating, movable module showing a 4-weight draggable slider.
 * Drag the slider handle to change the brush weight in real-time.
 * Weights 0-3 map directly to the four physical theme weights.
 */

import type { Canvas, Module, Rect, PointerEvent, DragEvent } from '../types.js';
import { get_color_by_name } from '../colors.js';
import type { ModuleGizmosConfig } from '../module_gizmos.js';
import { make_floating_panel_module } from './floating_panel_module.js';

export type WeightSelectorOptions = {
  id: string;
  rect: Rect;
  get_weight_index: () => number;
  get_left_weight_index?: () => number;
  get_right_weight_index?: () => number;
  on_weight_change: (weight_index: number, button: number) => void;
  on_move?: (new_rect: Rect) => void;
  on_close?: () => void;
};

const NUM_WEIGHTS = 4;
const WEIGHT_LABELS = ['Thin', 'Regular', 'Bold', 'Black'];
export function make_weight_selector_module(opts: WeightSelectorOptions): Module {
  const MIN_WIDTH = 12;
  const MAX_WIDTH = 32;
  const MIN_HEIGHT = 7;
  const MAX_HEIGHT = 16;

  const gizmo_config: ModuleGizmosConfig = {
    enabled: ['move', 'resize', 'close', 'seamless'],
    can_close: true,
    can_move: true,
    can_save_position: false,
    on_close: opts.on_close,
    on_move: opts.on_move,
  };

  // Drag state for slider
  let is_dragging_slider = false;
  let drag_button = 0;

  // Calculate weight from x position
  function get_weight_from_x(rect: Rect, x: number): number {
    const slider_start_x = rect.x0 + 2;
    const slider_width = rect.x1 - rect.x0 - 3; // -3 for borders and padding
    const segment_width = slider_width / (NUM_WEIGHTS - 1);
    
    const relative_x = x - slider_start_x;
    let weight = Math.round(relative_x / segment_width);
    weight = Math.max(0, Math.min(NUM_WEIGHTS - 1, weight));
    
    return weight;
  }

  function get_weight_for_button(button: number): number {
    return button === 2
      ? (opts.get_right_weight_index?.() ?? opts.get_weight_index())
      : (opts.get_left_weight_index?.() ?? opts.get_weight_index());
  }

  return make_floating_panel_module({
    id: opts.id,
    rect: opts.rect,
    title: 'WEIGHTS',
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
      const text_color = get_color_by_name('off_white').rgb;
      const slider_bg = get_color_by_name('dark_gray').rgb;
      const slider_fg = get_color_by_name('vivid_blue').rgb;
      const left_weight = opts.get_left_weight_index?.() ?? opts.get_weight_index();
      const right_weight = opts.get_right_weight_index?.() ?? opts.get_weight_index();
      c.fill_rect(rect, { char: ' ', rgb: bg_color, style: 'regular' });
      
      // Draw slider track
      const slider_y = rect.y1 - 3;
      const slider_start_x = rect.x0 + 2;
      const slider_end_x = rect.x1 - 2;
      
      // Draw track background
      for (let x = slider_start_x; x <= slider_end_x; x++) {
        c.set(x, slider_y, {
          char: '─',
          rgb: slider_bg,
          style: 'regular',
          weight_index: 3
        });
      }
      
      // Draw weight markers (0-3)
      const segment_width = (slider_end_x - slider_start_x) / (NUM_WEIGHTS - 1);
      for (let i = 0; i < NUM_WEIGHTS; i++) {
        const marker_x = Math.round(slider_start_x + (i * segment_width));
        const is_selected = i === opts.get_weight_index();
        
        // Draw tick mark
        c.set(marker_x, slider_y, {
          char: is_selected ? '●' : '○',
          rgb: is_selected ? slider_fg : slider_bg,
          style: 'regular',
          weight_index: is_selected ? 3 : 1
        });

        const has_left = i === left_weight;
        const has_right = i === right_weight;
        if (has_left || has_right) {
          c.set(marker_x, slider_y - 1, {
            char: has_left && has_right ? 'B' : has_left ? 'L' : 'R',
            rgb: has_left && has_right
              ? get_color_by_name('vivid_yellow').rgb
              : has_left
                ? get_color_by_name('vivid_blue').rgb
                : get_color_by_name('vivid_red').rgb,
            style: 'regular',
            weight_index: 2
          });
        }
      }
      
      // Draw current weight label
      const label_y = rect.y1 - 5;
      const weight_label = WEIGHT_LABELS[opts.get_weight_index()]!;
      const label_start_x = Math.floor((rect.x0 + rect.x1 - weight_label.length) / 2);
      
      for (let i = 0; i < weight_label.length; i++) {
        c.set(label_start_x + i, label_y, {
          char: weight_label[i]!,
          rgb: text_color,
          style: 'regular',
          weight_index: 2
        });
      }
    },
    on_pointer_down_content(e: PointerEvent, rect: Rect): void {
      // Check if clicking on slider area
      const slider_y = rect.y1 - 3;
      if (e.y === slider_y || e.y === slider_y - 1 || e.y === slider_y + 1) {
        is_dragging_slider = true;
        drag_button = e.button;
        const new_weight = get_weight_from_x(rect, e.x);
        if (new_weight !== get_weight_for_button(e.button)) {
          opts.on_weight_change(new_weight, e.button);
        }
      }
    },
    on_drag_move_content(e: DragEvent, rect: Rect): void {
      // Handle slider dragging
      if (is_dragging_slider) {
        const new_weight = get_weight_from_x(rect, e.x);
        if (new_weight !== get_weight_for_button(drag_button)) {
          opts.on_weight_change(new_weight, drag_button);
        }
      }
    },
    on_pointer_up_content(): void {
      is_dragging_slider = false;
      drag_button = 0;
    },
  });
}
