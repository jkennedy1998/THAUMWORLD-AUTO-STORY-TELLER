/**
 * Weight Selector Module
 * 
 * A floating, movable module showing an 8-weight draggable slider.
 * Drag the slider handle to change the brush weight in real-time.
 * Weights 0-7 correspond to font weights 100-800.
 */

import type { Canvas, Module, Rect, PointerEvent, DragEvent } from '../types.js';
import { get_color_by_name } from '../colors.js';
import type { ModuleGizmosConfig, GizmoState } from '../module_gizmos.js';
import { draw_module_gizmos, handle_gizmo_click, create_gizmo_state, is_in_gizmo_area } from '../module_gizmos.js';

export type WeightSelectorOptions = {
  id: string;
  rect: Rect;
  get_weight_index: () => number;
  on_weight_change: (weight_index: number) => void;
  on_move?: (new_rect: Rect) => void;
  on_close?: () => void;
};

const NUM_WEIGHTS = 8;
const WEIGHT_LABELS = ['Thin', 'XLight', 'Light', 'Regular', 'Medium', 'SBold', 'Bold', 'Black'];
const WEIGHT_CHARS = ['░', '▒', '▓', '█', '▓', '▒', '░', '█']; // Visual indicators

export function make_weight_selector_module(opts: WeightSelectorOptions): Module {
  // Mutable rect for moving
  let rect = opts.rect;
  
  // Gizmo configuration
  const gizmo_config: ModuleGizmosConfig = {
    enabled: ['move', 'close'],
    can_close: true,
    can_move: true,
    can_save_position: false,
    on_close: opts.on_close,
    on_move: opts.on_move,
  };
  
  const gizmo_state: GizmoState = create_gizmo_state();
  
  // Drag state for slider
  let is_dragging_slider = false;

  // Calculate weight from x position
  function get_weight_from_x(x: number): number {
    const slider_start_x = rect.x0 + 2;
    const slider_width = rect.x1 - rect.x0 - 3; // -3 for borders and padding
    const segment_width = slider_width / (NUM_WEIGHTS - 1);
    
    const relative_x = x - slider_start_x;
    let weight = Math.round(relative_x / segment_width);
    weight = Math.max(0, Math.min(NUM_WEIGHTS - 1, weight));
    
    return weight;
  }

  return {
    id: opts.id,
    get rect() { return rect; },
    set rect(newRect) { rect = newRect; },
    Focusable: true,

    Draw(c: Canvas): void {
      const bg_color = get_color_by_name('off_black').rgb;
      const border_color = get_color_by_name('medium_gray').rgb;
      const text_color = get_color_by_name('off_white').rgb;
      const slider_bg = get_color_by_name('dark_gray').rgb;
      const slider_fg = get_color_by_name('vivid_blue').rgb;
      const handle_color = get_color_by_name('vivid_yellow').rgb;
      
      // Fill background
      c.fill_rect(rect, { char: ' ', rgb: bg_color, style: 'regular' });
      
      // Draw border
      for (let x = rect.x0; x <= rect.x1; x++) {
        c.set(x, rect.y1, { char: '─', rgb: border_color, style: 'regular', weight_index: 3 });
        c.set(x, rect.y0, { char: '─', rgb: border_color, style: 'regular', weight_index: 3 });
      }
      for (let y = rect.y0; y <= rect.y1; y++) {
        c.set(rect.x0, y, { char: '│', rgb: border_color, style: 'regular', weight_index: 3 });
        c.set(rect.x1, y, { char: '│', rgb: border_color, style: 'regular', weight_index: 3 });
      }
      c.set(rect.x0, rect.y1, { char: '┌', rgb: border_color, style: 'regular', weight_index: 3 });
      c.set(rect.x1, rect.y1, { char: '┐', rgb: border_color, style: 'regular', weight_index: 3 });
      c.set(rect.x0, rect.y0, { char: '└', rgb: border_color, style: 'regular', weight_index: 3 });
      c.set(rect.x1, rect.y0, { char: '┘', rgb: border_color, style: 'regular', weight_index: 3 });
      
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
      
      // Draw weight markers (0-7)
      const segment_width = (slider_end_x - slider_start_x) / (NUM_WEIGHTS - 1);
      for (let i = 0; i < NUM_WEIGHTS; i++) {
        const marker_x = Math.round(slider_start_x + (i * segment_width));
        const is_selected = i === opts.get_weight_index();
        
        // Draw tick mark
        c.set(marker_x, slider_y, {
          char: is_selected ? '●' : '○',
          rgb: is_selected ? slider_fg : slider_bg,
          style: 'regular',
          weight_index: is_selected ? 6 : 3
        });
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
          weight_index: 4
        });
      }
      
      // Draw gizmos
      draw_module_gizmos(c, rect, gizmo_config, gizmo_state, 'WEIGHTS');
    },

    OnPointerDown(e: PointerEvent): void {
      // Check gizmo area first
      if (is_in_gizmo_area(e.x, e.y, rect)) {
        const gizmo = handle_gizmo_click(e.x, e.y, rect, gizmo_config, gizmo_state);
        if (gizmo === 'move') {
          gizmo_state.move_start_x = e.x;
          gizmo_state.move_start_y = e.y;
        }
        return;
      }
      
      // Handle move mode
      if (gizmo_state.is_move_mode) {
        gizmo_state.move_start_x = e.x;
        gizmo_state.move_start_y = e.y;
        return;
      }
      
      // Check if clicking on slider area
      const slider_y = rect.y1 - 3;
      if (e.y === slider_y || e.y === slider_y - 1 || e.y === slider_y + 1) {
        is_dragging_slider = true;
        const new_weight = get_weight_from_x(e.x);
        if (new_weight !== opts.get_weight_index()) {
          opts.on_weight_change(new_weight);
        }
      }
    },

    OnDragMove(e: DragEvent): void {
      if (gizmo_state.is_move_mode && gizmo_state.original_rect) {
        const dx = e.x - gizmo_state.move_start_x;
        const dy = e.y - gizmo_state.move_start_y;
        
        const new_rect: Rect = {
          x0: gizmo_state.original_rect.x0 + dx,
          y0: gizmo_state.original_rect.y0 + dy,
          x1: gizmo_state.original_rect.x1 + dx,
          y1: gizmo_state.original_rect.y1 + dy,
        };
        
        rect = new_rect;
        
        if (opts.on_move) {
          opts.on_move(rect);
        }
        return;
      }
      
      // Handle slider dragging
      if (is_dragging_slider) {
        const new_weight = get_weight_from_x(e.x);
        if (new_weight !== opts.get_weight_index()) {
          opts.on_weight_change(new_weight);
        }
      }
    },

    OnPointerUp(): void {
      is_dragging_slider = false;
      
      if (gizmo_state.is_move_mode) {
        gizmo_state.is_move_mode = false;
        if (opts.on_move) {
          opts.on_move(rect);
        }
      }
    },
  };
}
