/**
 * Brush Preview Module
 * 
 * A floating, movable module showing the currently selected brush character.
 * Displays as a simple box with the character in the center.
 * Acts like a "swatch" showing what you're about to draw with.
 */

import type { Canvas, Module, Rect, PointerEvent, DragEvent } from '../types.js';
import { get_color_by_name } from '../colors.js';
import type { ModuleGizmosConfig, GizmoState } from '../module_gizmos.js';
import { draw_module_gizmos, handle_gizmo_click, create_gizmo_state, is_in_gizmo_area } from '../module_gizmos.js';

export type BrushPreviewOptions = {
  id: string;
  rect: Rect;
  get_brush: () => { char: string; rgb: { r: number; g: number; b: number }; weight_index: number };
  on_move?: (new_rect: Rect) => void;
  on_close?: () => void;
};

export function make_brush_preview_module(opts: BrushPreviewOptions): Module {
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

  return {
    id: opts.id,
    get rect() { return rect; },
    set rect(newRect) { rect = newRect; },
    Focusable: true,

    Draw(c: Canvas): void {
      const bg_color = get_color_by_name('off_black').rgb;
      const border_color = get_color_by_name('medium_gray').rgb;
      const brush = opts.get_brush();
      const text_color = brush.rgb;
      
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
      
      // Draw title
      const title = 'BRUSH';
      const title_y = rect.y1 - 1;
      for (let i = 0; i < title.length && i < rect.x1 - rect.x0 - 2; i++) {
        const char = title[i]!;
        c.set(rect.x0 + 2 + i, title_y, { 
          char: char, 
          rgb: border_color, 
          style: 'regular',
          weight_index: 4 
        });
      }
      
      // Draw the brush character in the center
      const center_x = Math.floor((rect.x0 + rect.x1) / 2);
      const center_y = Math.floor((rect.y0 + rect.y1) / 2);
      
      c.set(center_x, center_y, {
        char: brush.char,
        rgb: text_color,
        style: 'regular',
        weight_index: brush.weight_index
      });
      
      // Draw gizmos
      draw_module_gizmos(c, rect, gizmo_config, gizmo_state);
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
      }
    },

    OnPointerUp(): void {
      if (gizmo_state.is_move_mode) {
        gizmo_state.is_move_mode = false;
        if (opts.on_move) {
          opts.on_move(rect);
        }
      }
    },
  };
}
