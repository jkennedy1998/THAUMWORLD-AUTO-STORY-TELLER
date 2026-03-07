import type { Canvas, PointerEvent, Rect, Rgb } from "./types.js";
import { rect_contains } from "./types.js";
import { debug_log } from "../shared/debug.js";
import { resolve_cell } from "../render_shaders/resolver.js";
import { make_widget_payload } from "../render_shaders/payload_builders.js";

// NOTE: Date.now() used here to match other UI draw paths.

export type GizmoType = 'close' | 'move' | 'save_position' | 'resize';

export type ResizeEdge = 'left' | 'right' | 'top' | 'bottom' | null;

export type GizmoState = {
  is_move_mode: boolean;
  is_resize_mode: boolean;
  resize_edge: ResizeEdge;
  is_dragging_resize: boolean;
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

  // Resize callbacks (preferred).
  // If omitted, modules may fall back to on_move/on_move_end.
  on_resize_start?: () => void;
  on_resize?: (new_rect: Rect) => void;
  on_resize_end?: (final_rect: Rect) => void;
};

function call_resize(new_rect: Rect, config: ModuleGizmosConfig | undefined): void {
  if (!config) return;
  if (config.on_resize) config.on_resize(new_rect);
  else if (config.on_move) config.on_move(new_rect);
}

function call_resize_end(final_rect: Rect, config: ModuleGizmosConfig | undefined): void {
  if (!config) return;
  if (config.on_resize_end) config.on_resize_end(final_rect);
  else if (config.on_move_end) config.on_move_end(final_rect);
}

function call_move_end(final_rect: Rect, config: ModuleGizmosConfig | undefined): void {
  if (!config) return;
  config.on_move_end?.(final_rect);
}

export function cancel_gizmo_modes(rect: Rect, config: ModuleGizmosConfig | undefined, gizmo_state: GizmoState): void {
  const was_move = gizmo_state.is_move_mode;
  const was_resize = gizmo_state.is_resize_mode;
  const was_drag_resize = gizmo_state.is_dragging_resize;

  gizmo_state.is_move_mode = false;
  gizmo_state.is_resize_mode = false;
  gizmo_state.is_dragging_resize = false;
  gizmo_state.resize_edge = null;
  gizmo_state.original_rect = null;

  if (was_drag_resize) {
    call_resize_end(rect, config);
  } else if (was_move) {
    call_move_end(rect, config);
  } else if (was_resize) {
    // Resize mode toggled off without dragging: no-op.
  }
}

export function handle_global_pointer_down_for_gizmos(e: PointerEvent, rect: Rect, config: ModuleGizmosConfig | undefined, gizmo_state: GizmoState): void {
  // Clicking anywhere outside the module cancels move/resize modes.
  if (!gizmo_state.is_move_mode && !gizmo_state.is_resize_mode) return;
  if (rect_contains(rect, e.x, e.y)) return;
  cancel_gizmo_modes(rect, config, gizmo_state);
}

// Default gizmo colors
const GIZMO_COLORS = {
  move: { r: 255, g: 255, b: 0 } as Rgb,      // Yellow
  close: { r: 255, g: 50, b: 50 } as Rgb,     // Red
  save: { r: 50, g: 255, b: 50 } as Rgb,      // Green
  resize: { r: 255, g: 150, b: 0 } as Rgb,    // Orange
  hover: { r: 255, g: 255, b: 255 } as Rgb,   // White
  active: { r: 200, g: 200, b: 200 } as Rgb,  // Gray
};

// Resize border colors
export const RESIZE_COLORS = {
  idle: { r: 150, g: 200, b: 255 } as Rgb,    // Light blue
  hover: { r: 50, g: 255, b: 50 } as Rgb,     // Green
  dragging: { r: 39, g: 73, b: 208 } as Rgb,  // Vivid blue
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
 * Optionally draws module name to the right of gizmos
 */
export function draw_module_gizmos(
  c: Canvas,
  rect: Rect,
  config: ModuleGizmosConfig,
  gizmo_state: GizmoState,
  module_name?: string
): void {
  if (!config.enabled || config.enabled.length === 0) {
    return;
  }

  let gizmo_index = 0;

  // Draw move gizmo (#) - Yellow
  if (config.enabled.includes('move') && config.can_move) {
    const pos = get_gizmo_rect(rect, gizmo_index++);
    const color = gizmo_state.is_move_mode ? GIZMO_COLORS.active : GIZMO_COLORS.move;

    const shaded = resolve_cell(
      make_widget_payload({
        id: `gizmo:move:${rect.x0}:${rect.y1}`,
        widget: 'move',
        widget_state: gizmo_state.is_move_mode ? 'active' : 'idle',
        base_fg: color,
      }),
      {
        where: 'debug',
        space: 'ui',
        x: pos.x,
        y: pos.y,
        time_ms: Date.now(),
      },
    );

    c.set(pos.x, pos.y, shaded);
  }

  // Draw close gizmo (X) - Red
  if (config.enabled.includes('close') && config.can_close) {
    const pos = get_gizmo_rect(rect, gizmo_index++);

    const shaded = resolve_cell(
      make_widget_payload({
        id: `gizmo:close:${rect.x0}:${rect.y1}`,
        widget: 'close',
        widget_state: 'idle',
        base_fg: GIZMO_COLORS.close,
      }),
      {
        where: 'debug',
        space: 'ui',
        x: pos.x,
        y: pos.y,
        time_ms: Date.now(),
      },
    );
    c.set(pos.x, pos.y, shaded);
  }

  // Draw save gizmo ($) - Green (future feature)
  if (config.enabled.includes('save_position') && config.can_save_position) {
    const pos = get_gizmo_rect(rect, gizmo_index++);

    const shaded = resolve_cell(
      make_widget_payload({
        id: `gizmo:save:${rect.x0}:${rect.y1}`,
        widget: 'save_position',
        widget_state: 'idle',
        base_fg: GIZMO_COLORS.save,
      }),
      {
        where: 'debug',
        space: 'ui',
        x: pos.x,
        y: pos.y,
        time_ms: Date.now(),
      },
    );
    c.set(pos.x, pos.y, shaded);
  }

  // Draw resize gizmo (╋) - Orange
  if (config.enabled.includes('resize')) {
    const pos = get_gizmo_rect(rect, gizmo_index++);
    const color = gizmo_state.is_resize_mode ? GIZMO_COLORS.active : GIZMO_COLORS.resize;

    const shaded = resolve_cell(
      make_widget_payload({
        id: `gizmo:resize:${rect.x0}:${rect.y1}`,
        widget: 'resize',
        widget_state: gizmo_state.is_resize_mode ? 'active' : 'idle',
        base_fg: color,
      }),
      {
        where: 'debug',
        space: 'ui',
        x: pos.x,
        y: pos.y,
        time_ms: Date.now(),
      },
    );
    c.set(pos.x, pos.y, shaded);
  }

  // Draw module name to the right of gizmos
  if (module_name && module_name.length > 0) {
    const name_x = rect.x0 + 1 + (gizmo_index * 2);
    const name_y = rect.y1 - 1;
    const name_color: Rgb = { r: 200, g: 200, b: 200 }; // Light gray
    
    for (let i = 0; i < module_name.length && name_x + i < rect.x1; i++) {
      c.set(name_x + i, name_y, {
        char: module_name[i]!,
        rgb: name_color,
        style: 'regular',
        weight_index: 4,
      });
    }
  }

  // If in move/resize mode, tint the existing border (do not redraw border glyphs).
  if (gizmo_state.is_move_mode) {
    tint_border_all(c, rect, GIZMO_COLORS.move, 5);
  }

  if (gizmo_state.is_resize_mode) {
    // Base color for resize mode.
    const base_color = gizmo_state.is_dragging_resize
      ? RESIZE_COLORS.dragging
      : RESIZE_COLORS.idle;

    tint_border_all(c, rect, base_color, 5);

    // Hovered edge gets hover color when not actively dragging.
    if (!gizmo_state.is_dragging_resize && gizmo_state.resize_edge) {
      tint_border_edge(c, rect, gizmo_state.resize_edge, RESIZE_COLORS.hover, 6);
    }
  }
}

function tint_border_cell(c: Canvas, x: number, y: number, rgb: Rgb, weight_index: number): void {
  const prev = c.get(x, y);
  if (!prev) return;
  c.set(x, y, {
    char: prev.char,
    rgb,
    style: prev.style,
    weight_index: Math.max(prev.weight_index ?? 0, weight_index),
    render_index: prev.render_index,
  });
}

function tint_border_all(c: Canvas, rect: Rect, rgb: Rgb, weight_index: number): void {
  for (let x = rect.x0; x <= rect.x1; x++) {
    tint_border_cell(c, x, rect.y1, rgb, weight_index);
    tint_border_cell(c, x, rect.y0, rgb, weight_index);
  }
  for (let y = rect.y0; y <= rect.y1; y++) {
    tint_border_cell(c, rect.x0, y, rgb, weight_index);
    tint_border_cell(c, rect.x1, y, rgb, weight_index);
  }
}

function tint_border_edge(c: Canvas, rect: Rect, edge: ResizeEdge, rgb: Rgb, weight_index: number): void {
  if (edge === 'top') {
    for (let x = rect.x0; x <= rect.x1; x++) tint_border_cell(c, x, rect.y1, rgb, weight_index);
  } else if (edge === 'bottom') {
    for (let x = rect.x0; x <= rect.x1; x++) tint_border_cell(c, x, rect.y0, rgb, weight_index);
  } else if (edge === 'left') {
    for (let y = rect.y0; y <= rect.y1; y++) tint_border_cell(c, rect.x0, y, rgb, weight_index);
  } else if (edge === 'right') {
    for (let y = rect.y0; y <= rect.y1; y++) tint_border_cell(c, rect.x1, y, rgb, weight_index);
  }
}

/**
 * Check which resize edge is being hovered/clicked
 */
export function get_resize_edge(x: number, y: number, rect: Rect): ResizeEdge {
  // Check if on borders
  const on_left = x === rect.x0;
  const on_right = x === rect.x1;
  const on_top = y === rect.y1;
  const on_bottom = y === rect.y0;
  
  if (on_left && !on_top && !on_bottom) return 'left';
  if (on_right && !on_top && !on_bottom) return 'right';
  if (on_top && !on_left && !on_right) return 'top';
  if (on_bottom && !on_left && !on_right) return 'bottom';
  
  return null;
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
        cancel_gizmo_modes(rect, config, gizmo_state);
      } else {
        // Start move mode
        // Cancel resize mode if active.
        gizmo_state.is_resize_mode = false;
        gizmo_state.is_dragging_resize = false;
        gizmo_state.resize_edge = null;
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

  // Check resize gizmo (╋)
  if (config.enabled.includes('resize')) {
    const pos = get_gizmo_rect(rect, gizmo_index++);
    if (x === pos.x && y === pos.y) {
      debug_log('[Gizmos] Resize gizmo clicked');
      
      // Toggle resize mode
      if (gizmo_state.is_resize_mode) {
        // Clicking resize again cancels resize mode (and cancels any active drag).
        cancel_gizmo_modes(rect, config, gizmo_state);
      } else {
        // Start resize mode (arm edge dragging).
        gizmo_state.is_move_mode = false;
        gizmo_state.is_resize_mode = true;
        gizmo_state.is_dragging_resize = false;
        gizmo_state.resize_edge = null;
        gizmo_state.original_rect = { ...rect };
        config.on_resize_start?.();
      }
      
      return 'resize';
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
    is_resize_mode: false,
    resize_edge: null,
    is_dragging_resize: false,
    move_start_x: 0,
    move_start_y: 0,
    original_rect: null,
  };
}

/**
 * Check if point is in the gizmo area (top row of module)
 */
export function is_in_gizmo_area(x: number, y: number, rect: Rect): boolean {
  return y === rect.y1 - 1 && x >= rect.x0 + 1 && x <= rect.x0 + 8;  // Up to 4 gizmos
}

/**
 * Handle resize drag operation
 * Returns the new rect if resized, null otherwise
 */
export function handle_resize_drag(
  current_x: number,
  current_y: number,
  gizmo_state: GizmoState,
  original_rect: Rect,
  min_width: number,
  min_height: number,
  max_width: number,
  max_height: number,
  on_resize?: (new_rect: Rect) => void
): Rect | null {
  if (!gizmo_state.is_resize_mode || !gizmo_state.is_dragging_resize || !gizmo_state.resize_edge) {
    return null;
  }

  const edge = gizmo_state.resize_edge;
  let new_rect: Rect = { ...original_rect };

  // Calculate deltas
  const dx = current_x - gizmo_state.move_start_x;
  const dy = current_y - gizmo_state.move_start_y;

  // Apply resize based on which edge is being dragged
  if (edge === 'left') {
    new_rect.x0 = Math.min(original_rect.x0 + dx, original_rect.x1 - min_width + 1);
    new_rect.x0 = Math.max(new_rect.x0, original_rect.x1 - max_width + 1);
  } else if (edge === 'right') {
    new_rect.x1 = Math.max(original_rect.x1 + dx, original_rect.x0 + min_width - 1);
    new_rect.x1 = Math.min(new_rect.x1, original_rect.x0 + max_width - 1);
  } else if (edge === 'top') {
    new_rect.y1 = Math.min(original_rect.y1 + dy, original_rect.y0 + max_height - 1);
    new_rect.y1 = Math.max(new_rect.y1, original_rect.y0 + min_height - 1);
  } else if (edge === 'bottom') {
    new_rect.y0 = Math.max(original_rect.y0 + dy, original_rect.y1 - max_height + 1);
    new_rect.y0 = Math.min(new_rect.y0, original_rect.y1 - min_height + 1);
  }

  // Call resize callback
  if (on_resize) on_resize(new_rect);

  return new_rect;
}
