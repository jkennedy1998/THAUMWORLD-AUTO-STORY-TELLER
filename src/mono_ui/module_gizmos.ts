import type { Canvas, Rect, Rgb } from "./types.js";
import { debug_log } from "../shared/debug.js";

export type GizmoType = 'close' | 'move' | 'save_position';

export type GizmoState = {
  is_move_mode: boolean;
  move_start_x: number;
  move_start_y: number;
  original_rect: Rect | null;
};

export type ModuleGizmosConfig = {
  enabled: GizmoType[];
  can_close: boolean;
  can_move: boolean;
  can_save_position: boolean;
  on_close?: () => void;
  on_move_start?: () => void;
  on_move?: (new_rect: Rect) => void;
  on_move_end?: (final_rect: Rect) => void;
};

// Default gizmo colors
const GIZMO_COLORS = {
  move: { r: 255, g: 255, b: 0 } as Rgb,      // Yellow
  close: { r: 255, g: 50, b: 50 } as Rgb,     // Red
  save: { r: 50, g: 255, b: 50 } as Rgb,      // Green
  hover: { r: 255, g: 255, b: 255 } as Rgb,   // White
  active: { r: 200, g: 200, b: 200 } as Rgb,  // Gray
};

/**
 * Calculate the rect for a gizmo button
 */
function get_gizmo_rect(rect: Rect, index: number): { x: number; y: number } {
  // Gizmos are placed in top-left corner, spaced 2 characters apart
  return {
    x: rect.x0 + 1 + (index * 2),
    y: rect.y1 - 1,  // Top row (y1 is the top in bottom-left coordinates)
  };
}

/**
 * Draw module gizmos (close X, move #, save $)
 */
export function draw_module_gizmos(
  c: Canvas,
  rect: Rect,
  config: ModuleGizmosConfig,
  gizmo_state: GizmoState
): void {
  if (!config.enabled || config.enabled.length === 0) {
    return;
  }

  let gizmo_index = 0;

  // Draw move gizmo (#) - Yellow
  if (config.enabled.includes('move') && config.can_move) {
    const pos = get_gizmo_rect(rect, gizmo_index++);
    const color = gizmo_state.is_move_mode ? GIZMO_COLORS.active : GIZMO_COLORS.move;
    
    c.set(pos.x, pos.y, {
      char: '#',
      rgb: color,
      style: 'regular',
      weight_index: gizmo_state.is_move_mode ? 5 : 4,
    });
  }

  // Draw close gizmo (X) - Red
  if (config.enabled.includes('close') && config.can_close) {
    const pos = get_gizmo_rect(rect, gizmo_index++);
    
    c.set(pos.x, pos.y, {
      char: 'X',
      rgb: GIZMO_COLORS.close,
      style: 'regular',
      weight_index: 4,
    });
  }

  // Draw save gizmo ($) - Green (future feature)
  if (config.enabled.includes('save_position') && config.can_save_position) {
    const pos = get_gizmo_rect(rect, gizmo_index++);
    
    c.set(pos.x, pos.y, {
      char: '$',
      rgb: GIZMO_COLORS.save,
      style: 'regular',
      weight_index: 4,
    });
  }

  // If in move mode, draw yellow border
  if (gizmo_state.is_move_mode) {
    draw_move_mode_border(c, rect);
  }
}

/**
 * Draw a yellow border to indicate move mode
 */
function draw_move_mode_border(c: Canvas, rect: Rect): void {
  const border_color: Rgb = { r: 255, g: 255, b: 0 };
  
  // Draw border corners and edges
  for (let x = rect.x0; x <= rect.x1; x++) {
    // Top and bottom edges
    c.set(x, rect.y1, { char: '-', rgb: border_color, style: 'regular', weight_index: 5 });
    c.set(x, rect.y0, { char: '-', rgb: border_color, style: 'regular', weight_index: 5 });
  }
  
  for (let y = rect.y0; y <= rect.y1; y++) {
    // Left and right edges
    c.set(rect.x0, y, { char: '|', rgb: border_color, style: 'regular', weight_index: 5 });
    c.set(rect.x1, y, { char: '|', rgb: border_color, style: 'regular', weight_index: 5 });
  }
  
  // Corners
  c.set(rect.x0, rect.y1, { char: '+', rgb: border_color, style: 'regular', weight_index: 5 });
  c.set(rect.x1, rect.y1, { char: '+', rgb: border_color, style: 'regular', weight_index: 5 });
  c.set(rect.x0, rect.y0, { char: '+', rgb: border_color, style: 'regular', weight_index: 5 });
  c.set(rect.x1, rect.y0, { char: '+', rgb: border_color, style: 'regular', weight_index: 5 });
}

/**
 * Check if a click is on a gizmo button
 * Returns the gizmo type that was clicked, or null if none
 */
export function handle_gizmo_click(
  x: number,
  y: number,
  rect: Rect,
  config: ModuleGizmosConfig,
  gizmo_state: GizmoState
): GizmoType | null {
  if (!config.enabled || config.enabled.length === 0) {
    return null;
  }

  let gizmo_index = 0;

  // Check move gizmo (#)
  if (config.enabled.includes('move') && config.can_move) {
    const pos = get_gizmo_rect(rect, gizmo_index++);
    if (x === pos.x && y === pos.y) {
      debug_log('[Gizmos] Move gizmo clicked');
      
      // Toggle move mode
      if (gizmo_state.is_move_mode) {
        // End move mode
        gizmo_state.is_move_mode = false;
        if (gizmo_state.original_rect && config.on_move_end) {
          config.on_move_end(rect);
        }
      } else {
        // Start move mode
        gizmo_state.is_move_mode = true;
        gizmo_state.original_rect = { ...rect };
        if (config.on_move_start) {
          config.on_move_start();
        }
      }
      
      return 'move';
    }
  }

  // Check close gizmo (X)
  if (config.enabled.includes('close') && config.can_close) {
    const pos = get_gizmo_rect(rect, gizmo_index++);
    if (x === pos.x && y === pos.y) {
      debug_log('[Gizmos] Close gizmo clicked');
      if (config.on_close) {
        config.on_close();
      }
      return 'close';
    }
  }

  // Check save gizmo ($)
  if (config.enabled.includes('save_position') && config.can_save_position) {
    const pos = get_gizmo_rect(rect, gizmo_index++);
    if (x === pos.x && y === pos.y) {
      debug_log('[Gizmos] Save gizmo clicked');
      return 'save_position';
    }
  }

  return null;
}

/**
 * Handle drag during move mode
 * Returns the new rect if moved, null otherwise
 */
export function handle_move_drag(
  current_x: number,
  current_y: number,
  gizmo_state: GizmoState,
  original_rect: Rect,
  on_move?: (new_rect: Rect) => void
): Rect | null {
  if (!gizmo_state.is_move_mode || !gizmo_state.original_rect) {
    return null;
  }

  // Calculate delta from move start
  const dx = current_x - gizmo_state.move_start_x;
  const dy = current_y - gizmo_state.move_start_y;

  // Apply delta to original rect
  const new_rect: Rect = {
    x0: gizmo_state.original_rect.x0 + dx,
    y0: gizmo_state.original_rect.y0 + dy,
    x1: gizmo_state.original_rect.x1 + dx,
    y1: gizmo_state.original_rect.y1 + dy,
  };

  // Call move callback
  if (on_move) {
    on_move(new_rect);
  }

  return new_rect;
}

/**
 * Create initial gizmo state
 */
export function create_gizmo_state(): GizmoState {
  return {
    is_move_mode: false,
    move_start_x: 0,
    move_start_y: 0,
    original_rect: null,
  };
}

/**
 * Check if point is in the gizmo area (top row of module)
 */
export function is_in_gizmo_area(x: number, y: number, rect: Rect): boolean {
  return y === rect.y1 - 1 && x >= rect.x0 + 1 && x <= rect.x0 + 6;  // Up to 3 gizmos
}
