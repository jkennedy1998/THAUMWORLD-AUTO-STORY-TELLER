/**
 * Color Selector Module
 * 
 * A floating, movable module showing a grid of all indexed colors.
 * Each color slot displays the selected character alternating with a solid block,
 * using the selected weight and color.
 */

import type { Canvas, Module, Rect, PointerEvent, DragEvent, WheelEvent } from '../types.js';
import { get_color_by_name, INDEXED_COLORS } from '../colors.js';
import type { ModuleGizmosConfig, GizmoState } from '../module_gizmos.js';
import { draw_module_gizmos, handle_gizmo_click, create_gizmo_state, is_in_gizmo_area } from '../module_gizmos.js';

export type ColorSelectorOptions = {
  id: string;
  rect: Rect;
  get_brush: () => { char: string; rgb: { r: number; g: number; b: number }; weight_index: number };
  on_color_select: (rgb: { r: number; g: number; b: number }) => void;
  on_move?: (new_rect: Rect) => void;
  on_close?: () => void;
};

// Grid layout - responsive to module size
const COLOR_SPACING_X = 3;  // Space between colors horizontally
const COLOR_SPACING_Y = 2;  // Space between colors vertically

// Calculate how many colors fit per row based on width
function get_colors_per_row(width: number): number {
  const inner_width = width - 3; // -3 for borders and padding
  return Math.max(2, Math.floor(inner_width / COLOR_SPACING_X));
}

// Animation state for flashing effect
let flash_state = 0;
let last_flash_time = 0;
const FLASH_INTERVAL = 500; // ms

export function make_color_selector_module(opts: ColorSelectorOptions): Module {
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
  
  // Scroll state
  let scroll_offset = 0;
  
  // Calculate visible rows based on height
  function get_visible_rows(): number {
    const inner_height = rect.y1 - rect.y0 - 2; // -2 for gizmo/title rows
    return Math.max(1, Math.floor(inner_height / COLOR_SPACING_Y));
  }
  
  function clamp_scroll(): void {
    const colors_per_row = get_colors_per_row(rect.x1 - rect.x0);
    const total_rows = Math.ceil(INDEXED_COLORS.length / colors_per_row);
    const max_scroll = Math.max(0, total_rows - get_visible_rows());
    scroll_offset = Math.max(0, Math.min(max_scroll, scroll_offset));
  }
  
  // Get color at grid position (row, col)
  function get_color_at(row: number, col: number): typeof INDEXED_COLORS[0] | null {
    const colors_per_row = get_colors_per_row(rect.x1 - rect.x0);
    const color_index = (scroll_offset + row) * colors_per_row + col;
    
    if (color_index >= 0 && color_index < INDEXED_COLORS.length) {
      return INDEXED_COLORS[color_index]!;
    }
    return null;
  }
  
  // Get grid position from screen coordinates
  function get_grid_pos_from_screen(x: number, y: number): { row: number; col: number } | null {
    const colors_per_row = get_colors_per_row(rect.x1 - rect.x0);
    const start_x = rect.x0 + 2;
    const start_y = rect.y1 - 3;
    
    const col = Math.floor((x - start_x) / COLOR_SPACING_X);
    const row = Math.floor((start_y - y) / COLOR_SPACING_Y);
    
    if (col >= 0 && col < colors_per_row && row >= 0 && row < get_visible_rows()) {
      return { row, col };
    }
    return null;
  }
  
  // Update flash state
  function update_flash(): void {
    const now = Date.now();
    if (now - last_flash_time > FLASH_INTERVAL) {
      flash_state = (flash_state + 1) % 2;
      last_flash_time = now;
    }
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
      
      // Update flashing animation
      update_flash();
      
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
      const title = 'COLORS';
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
      
      // Draw colors in a grid
      const visible_rows = get_visible_rows();
      const colors_per_row = get_colors_per_row(rect.x1 - rect.x0);
      const start_x = rect.x0 + 2;
      const start_y = rect.y1 - 3;
      const brush = opts.get_brush();
      
      for (let row = 0; row < visible_rows; row++) {
        for (let col = 0; col < colors_per_row; col++) {
          const color = get_color_at(row, col);
          if (!color) continue;
          
          const color_x = start_x + (col * COLOR_SPACING_X);
          const color_y = start_y - (row * COLOR_SPACING_Y);
          
          if (color_y <= rect.y0) continue;
          
          // Flash between selected character and solid block
          const display_char = flash_state === 0 ? brush.char : '█';
          
          // Draw color swatch
          c.set(color_x, color_y, {
            char: display_char,
            rgb: color.rgb,
            style: 'regular',
            weight_index: brush.weight_index
          });
        }
      }
      
      // Draw gizmos
      draw_module_gizmos(c, rect, gizmo_config, gizmo_state);
      
      // Draw scroll indicator if needed
      const total_rows = Math.ceil(INDEXED_COLORS.length / colors_per_row);
      if (total_rows > visible_rows) {
        const scroll_percent = scroll_offset / (total_rows - visible_rows);
        const indicator_y = rect.y1 - 3 - Math.floor(scroll_percent * (visible_rows - 1)) * COLOR_SPACING_Y;
        if (indicator_y > rect.y0) {
          c.set(rect.x1 - 1, indicator_y, {
            char: '│',
            rgb: get_color_by_name('pale_yellow').rgb,
            style: 'regular',
            weight_index: 5
          });
        }
      }
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
      
      // Color selection
      const grid_pos = get_grid_pos_from_screen(e.x, e.y);
      if (grid_pos) {
        const color = get_color_at(grid_pos.row, grid_pos.col);
        if (color) {
          opts.on_color_select(color.rgb);
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

    OnWheel(e: WheelEvent): void {
      const scroll_amount = e.delta_y > 0 ? 1 : -1;
      scroll_offset += scroll_amount;
      clamp_scroll();
    },
  };
}
