/**
 * Tool Properties Module
 * 
 * A floating module showing properties for the currently selected tool.
 * For brush tools, shows brush tip size slider (1x1 to 5x5).
 */

import type { Canvas, Module, Rect, PointerEvent, DragEvent } from '../types.js';
import { get_color_by_name } from '../colors.js';
import type { ModuleGizmosConfig, GizmoState } from '../module_gizmos.js';
import { draw_module_gizmos, handle_gizmo_click, create_gizmo_state, is_in_gizmo_area, get_resize_edge, handle_resize_drag } from '../module_gizmos.js';
import type { ToolType } from '../../ascii_painter/types.js';

export type ToolPropertiesOptions = {
  id: string;
  rect: Rect;
  get_current_tool: () => ToolType;
  get_brush_size: () => number; // 1-5
  on_brush_size_change: (size: number) => void;
  get_space_replace: () => boolean;
  on_space_replace_change: (replace: boolean) => void;
  on_move?: (new_rect: Rect) => void;
  on_resize?: (new_rect: Rect) => void;
  on_close?: () => void;
};

const MIN_BRUSH_SIZE = 1;
const MAX_BRUSH_SIZE = 5;
const SIZE_LABELS = ['1x1', '2x2', '3x3', '4x4', '5x5'];

// Size constraints
const MIN_WIDTH = 16;
const MAX_WIDTH = 25;
const MIN_HEIGHT = 8;
const MAX_HEIGHT = 14;

export function make_tool_properties_module(opts: ToolPropertiesOptions): Module {
  let rect = opts.rect;
  
  const gizmo_config: ModuleGizmosConfig = {
    enabled: ['move', 'resize', 'close'],
    can_close: true,
    can_move: true,
    can_save_position: false,
    on_close: opts.on_close,
    on_move: opts.on_move,
  };
  
  const gizmo_state: GizmoState = create_gizmo_state();
  let is_dragging_slider = false;

  // Calculate brush size from x position
  function get_size_from_x(x: number): number {
    const slider_start_x = rect.x0 + 3;
    const slider_width = rect.x1 - rect.x0 - 5;
    const segment_width = slider_width / (MAX_BRUSH_SIZE - MIN_BRUSH_SIZE);
    
    const relative_x = x - slider_start_x;
    let size = Math.round(relative_x / segment_width) + MIN_BRUSH_SIZE;
    size = Math.max(MIN_BRUSH_SIZE, Math.min(MAX_BRUSH_SIZE, size));
    
    return size;
  }

  // Check if position is on slider
  function is_on_slider(x: number, y: number): boolean {
    const slider_y = rect.y1 - 3;
    return y >= slider_y - 1 && y <= slider_y + 1 && x >= rect.x0 + 2 && x <= rect.x1 - 2;
  }

  // Check if position is on space_replace checkbox
  function is_on_space_checkbox(x: number, y: number): boolean {
    const checkbox_y = rect.y1 - 5;
    return y === checkbox_y && x >= rect.x0 + 2 && x <= rect.x0 + 4;
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
      
      // Draw title
      const title = 'PROPERTIES';
      const title_y = rect.y1 - 1;
      for (let i = 0; i < title.length && i < rect.x1 - rect.x0 - 2; i++) {
        const char = title[i]!;
        c.set(rect.x0 + 2 + i, title_y, { 
          char: char, 
          rgb: text_color, 
          style: 'regular',
          weight_index: 4 
        });
      }
      
      // Show brush size slider only for brush tools
      if (opts.get_current_tool() === 'pencil' || opts.get_current_tool() === 'eraser') {
        // Draw size label
        const size_label = `Size: ${SIZE_LABELS[opts.get_brush_size() - 1]!}`;
        const label_y = rect.y1 - 5;
        const label_start_x = Math.floor((rect.x0 + rect.x1 - size_label.length) / 2);
        
        for (let i = 0; i < size_label.length; i++) {
          c.set(label_start_x + i, label_y, {
            char: size_label[i]!,
            rgb: text_color,
            style: 'regular',
            weight_index: 4
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
            weight_index: 3
          });
        }
        
        // Draw size markers
        const segment_width = (slider_end_x - slider_start_x) / (MAX_BRUSH_SIZE - MIN_BRUSH_SIZE);
        for (let i = 0; i < MAX_BRUSH_SIZE; i++) {
          const marker_x = Math.round(slider_start_x + (i * segment_width));
          const is_selected = i + 1 === opts.get_brush_size();
          
          c.set(marker_x, slider_y, {
            char: is_selected ? '●' : '○',
            rgb: is_selected ? slider_fg : slider_bg,
            style: 'regular',
            weight_index: is_selected ? 6 : 3
          });
        }
      } else if (opts.get_current_tool() === 'text') {
        // Show space_replace checkbox for text tool
        const checkbox_y = rect.y1 - 5;
        const checkbox_x = rect.x0 + 2;
        const space_replace = opts.get_space_replace();
        
        // Draw checkbox
        c.set(checkbox_x, checkbox_y, {
          char: space_replace ? '☑' : '☐',
          rgb: text_color,
          style: 'regular',
          weight_index: 4
        });
        
        // Draw label
        const label = 'space→" "';
        for (let i = 0; i < label.length && i < rect.x1 - checkbox_x - 3; i++) {
          c.set(checkbox_x + 2 + i, checkbox_y, {
            char: label[i]!,
            rgb: text_color,
            style: 'regular',
            weight_index: 4
          });
        }
        
        // Draw description
        const desc = space_replace ? '(replaces)' : '(preserves)';
        const desc_y = rect.y1 - 6;
        for (let i = 0; i < desc.length && i < rect.x1 - rect.x0 - 2; i++) {
          c.set(rect.x0 + 2 + i, desc_y, {
            char: desc[i]!,
            rgb: get_color_by_name('medium_gray').rgb,
            style: 'regular',
            weight_index: 3
          });
        }
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
            weight_index: 3
          });
        }
      }
      
      // Draw gizmos
      draw_module_gizmos(c, rect, gizmo_config, gizmo_state);
    },

    OnPointerDown(e: PointerEvent): void {
      if (is_in_gizmo_area(e.x, e.y, rect)) {
        const gizmo = handle_gizmo_click(e.x, e.y, rect, gizmo_config, gizmo_state);
        if (gizmo === 'move') {
          gizmo_state.move_start_x = e.x;
          gizmo_state.move_start_y = e.y;
        }
        return;
      }
      
      if (gizmo_state.is_resize_mode) {
        const edge = get_resize_edge(e.x, e.y, rect);
        if (edge) {
          gizmo_state.resize_edge = edge;
          gizmo_state.is_dragging_resize = true;
          gizmo_state.move_start_x = e.x;
          gizmo_state.move_start_y = e.y;
          gizmo_state.original_rect = { ...rect };
          return;
        }
      }
      
      if (gizmo_state.is_move_mode) {
        gizmo_state.move_start_x = e.x;
        gizmo_state.move_start_y = e.y;
        return;
      }
      
      // Handle brush size slider
      if ((opts.get_current_tool() === 'pencil' || opts.get_current_tool() === 'eraser') && is_on_slider(e.x, e.y)) {
        is_dragging_slider = true;
        const new_size = get_size_from_x(e.x);
        if (new_size !== opts.get_brush_size()) {
          opts.on_brush_size_change(new_size);
        }
      }
      
      // Handle space_replace checkbox for text tool
      if (opts.get_current_tool() === 'text' && is_on_space_checkbox(e.x, e.y)) {
        opts.on_space_replace_change(!opts.get_space_replace());
      }
    },

    OnPointerMove(e: PointerEvent): void {
      if (gizmo_state.is_resize_mode && !gizmo_state.is_dragging_resize) {
        gizmo_state.resize_edge = get_resize_edge(e.x, e.y, rect);
      }
    },

    OnDragMove(e: DragEvent): void {
      if (gizmo_state.is_move_mode && gizmo_state.original_rect) {
        const dx = e.x - gizmo_state.move_start_x;
        const dy = e.y - gizmo_state.move_start_y;
        
        rect = {
          x0: gizmo_state.original_rect.x0 + dx,
          y0: gizmo_state.original_rect.y0 + dy,
          x1: gizmo_state.original_rect.x1 + dx,
          y1: gizmo_state.original_rect.y1 + dy,
        };
        
        if (opts.on_move) opts.on_move(rect);
        return;
      }
      
      if (gizmo_state.is_resize_mode && gizmo_state.is_dragging_resize && gizmo_state.original_rect) {
        const new_rect = handle_resize_drag(
          e.x, e.y, gizmo_state, gizmo_state.original_rect,
          MIN_WIDTH, MIN_HEIGHT, MAX_WIDTH, MAX_HEIGHT,
          opts.on_resize || opts.on_move
        );
        if (new_rect) rect = new_rect;
        return;
      }
      
      // Handle slider dragging
      if (is_dragging_slider && (opts.get_current_tool() === 'pencil' || opts.get_current_tool() === 'eraser')) {
        const new_size = get_size_from_x(e.x);
        if (new_size !== opts.get_brush_size()) {
          opts.on_brush_size_change(new_size);
        }
      }
    },

    OnPointerUp(): void {
      is_dragging_slider = false;
      
      if (gizmo_state.is_move_mode) {
        gizmo_state.is_move_mode = false;
        if (opts.on_move) opts.on_move(rect);
      }
      if (gizmo_state.is_dragging_resize) {
        gizmo_state.is_dragging_resize = false;
        gizmo_state.resize_edge = null;
        if (opts.on_move) opts.on_move(rect);
      }
    },
  };
}
