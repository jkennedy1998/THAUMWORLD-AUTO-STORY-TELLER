/**
 * Color Selector Module
 * 
 * A floating, movable module showing a grid of all indexed colors.
 * Each color slot displays the selected character alternating with a solid block,
 * using the selected weight and color.
 */

import type { Canvas, Module, Rect, PointerEvent, DragEvent, WheelEvent } from '../types.js';
import { get_color_by_name, INDEXED_COLORS } from '../colors.js';
import type { ModuleGizmosConfig } from '../module_gizmos.js';
import { make_floating_panel_module } from './floating_panel_module.js';

export type ColorSelectorOptions = {
  id: string;
  rect: Rect;
  get_brush: () => { char: string; rgb: { r: number; g: number; b: number }; weight_index: number };
  get_left_rgb?: () => { r: number; g: number; b: number };
  get_right_rgb?: () => { r: number; g: number; b: number };
  on_color_select: (rgb: { r: number; g: number; b: number }, button: number) => void;
  on_move?: (new_rect: Rect) => void;
  on_close?: () => void;
};

function rgb_eq(a: { r: number; g: number; b: number } | undefined, b: { r: number; g: number; b: number } | undefined): boolean {
  return !!a && !!b && a.r === b.r && a.g === b.g && a.b === b.b;
}

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
  // Size constraints for resizing
  const MIN_WIDTH = 10;  // Minimum width
  const MAX_WIDTH = 40;  // Maximum width
  const MIN_HEIGHT = 8;  // Minimum height
  const MAX_HEIGHT = 40; // Maximum height

  // Gizmo configuration
  const gizmo_config: ModuleGizmosConfig = {
    enabled: ['move', 'resize', 'close', 'seamless'],
    can_close: true,
    can_move: true,
    can_save_position: false,
    on_close: opts.on_close,
    on_move: opts.on_move,
  };
  
  // Scroll state
  let scroll_offset = 0;
  
  // Calculate visible rows based on height
  function get_visible_rows(rect: Rect): number {
    const inner_height = rect.y1 - rect.y0 - 2; // -2 for gizmo/title rows
    return Math.max(1, Math.floor(inner_height / COLOR_SPACING_Y));
  }
  
  function clamp_scroll(rect: Rect): void {
    const colors_per_row = get_colors_per_row(rect.x1 - rect.x0);
    const total_rows = Math.ceil(INDEXED_COLORS.length / colors_per_row);
    const max_scroll = Math.max(0, total_rows - get_visible_rows(rect));
    scroll_offset = Math.max(0, Math.min(max_scroll, scroll_offset));
  }
  
  // Get color at grid position (row, col)
  function get_color_at(rect: Rect, row: number, col: number): typeof INDEXED_COLORS[0] | null {
    const colors_per_row = get_colors_per_row(rect.x1 - rect.x0);
    const color_index = (scroll_offset + row) * colors_per_row + col;
    
    if (color_index >= 0 && color_index < INDEXED_COLORS.length) {
      return INDEXED_COLORS[color_index]!;
    }
    return null;
  }
  
  // Get grid position from screen coordinates
  function get_grid_pos_from_screen(rect: Rect, x: number, y: number): { row: number; col: number } | null {
    const colors_per_row = get_colors_per_row(rect.x1 - rect.x0);
    const start_x = rect.x0 + 2;
    const start_y = rect.y1 - 3;
    
    const col = Math.floor((x - start_x) / COLOR_SPACING_X);
    const row = Math.floor((start_y - y) / COLOR_SPACING_Y);
    
    if (col >= 0 && col < colors_per_row && row >= 0 && row < get_visible_rows(rect)) {
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

  return make_floating_panel_module({
    id: opts.id,
    rect: opts.rect,
    title: 'COLORS',
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
      
      // Update flashing animation
      update_flash();
      
      // Fill background
      c.fill_rect(rect, { char: ' ', rgb: bg_color, style: 'regular' });

      // Draw colors in a grid
      const visible_rows = get_visible_rows(rect);
      const colors_per_row = get_colors_per_row(rect.x1 - rect.x0);
      const start_x = rect.x0 + 2;
      const start_y = rect.y1 - 3;
      const brush = opts.get_brush();
      const left_rgb = opts.get_left_rgb?.();
      const right_rgb = opts.get_right_rgb?.();
      
      for (let row = 0; row < visible_rows; row++) {
        for (let col = 0; col < colors_per_row; col++) {
          const color = get_color_at(rect, row, col);
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

          const left_selected = rgb_eq(color.rgb, left_rgb);
          const right_selected = rgb_eq(color.rgb, right_rgb);
          if (left_selected || right_selected) {
            const marker_char = left_selected && right_selected ? 'B' : left_selected ? 'L' : 'R';
            const marker_rgb = left_selected && right_selected
              ? get_color_by_name('vivid_yellow').rgb
              : left_selected
                ? get_color_by_name('vivid_blue').rgb
                : get_color_by_name('vivid_red').rgb;
            if (color_y - 1 > rect.y0) {
              c.set(color_x, color_y - 1, {
                char: marker_char,
                rgb: marker_rgb,
                style: 'regular',
                weight_index: 5,
              });
            }
          }
        }
      }
      
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
    on_pointer_down_content(e: PointerEvent, rect: Rect): void {
      // Color selection
      const grid_pos = get_grid_pos_from_screen(rect, e.x, e.y);
      if (grid_pos) {
        const color = get_color_at(rect, grid_pos.row, grid_pos.col);
        if (color) {
          opts.on_color_select(color.rgb, e.button);
        }
      }
    },
    on_wheel_content(e: WheelEvent, rect: Rect): void {
      const scroll_amount = e.delta_y > 0 ? 1 : -1;
      scroll_offset += scroll_amount;
      clamp_scroll(rect);
    },
  });
}
