/**
 * ASCII Painter Canvas Module - Fixed Version
 * 
 * Uses runtime grid coordinates directly without extra view offset.
 * Canvas size: 80x40, but renders within the runtime's 200x50 grid.
 */

import type { Canvas, Module, Rect, Rgb, PointerEvent, DragEvent, WheelEvent, Cell } from '../types.js';
import type { Grid, Brush, ToolType } from '../../ascii_painter/types.js';
import { createGrid, getCell, setCell } from '../../ascii_painter/types.js';
import { drawCell, drawLine, eraseCell, applyTool, sampleCell, previewLine, previewRectStroke, previewRectFill } from '../../ascii_painter/tools.js';
import { pushSnapshot } from '../../ascii_painter/history.js';
import { get_color_by_name } from '../colors.js';

export type PainterCanvasOptions = {
  id: string;
  rect: Rect;
  grid: Grid;
  current_tool: ToolType;
  brush: Brush;
  preview_points: { x: number; y: number }[];
  on_push_snapshot: () => void;
  on_sample_cell: (cell: { char: string; rgb: Rgb; weight_index: number }) => void;
};

export function make_painter_canvas_module(opts: PainterCanvasOptions): Module {
  const rect = opts.rect;

  // Canvas dimensions
  const CANVAS_WIDTH = 80;
  const CANVAS_HEIGHT = 40;

  // View offset for panning (in grid coordinates)
  let offset_x = 0;
  let offset_y = 0;
  let scale = 1;

  // Drag state
  let is_panning = false;
  let is_drawing = false;
  let is_erasing = false;  // Track if we're in eraser mode
  let drag_start: { x: number; y: number } | null = null;
  let last_draw_pos: { x: number; y: number } | null = null;
  let pan_start: { x: number; y: number } | null = null;
  let view_start: { x: number; y: number } | null = null;
  let drag_start_buttons = 0; // Track which button started the drag
  let space_held = false; // Track space key state for panning

  function clamp(n: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, n));
  }

  return {
    id: opts.id,
    rect,
    Focusable: true,

    Draw(c: Canvas): void {
      // Fill background
      const bg_color = get_color_by_name('off_black').rgb;
      c.fill_rect(rect, { char: ' ', rgb: bg_color, style: 'regular' });

      // Calculate visible range based on offset
      const start_x = clamp(Math.floor(offset_x), 0, opts.grid.width - 1);
      const end_x = clamp(Math.floor(offset_x + CANVAS_WIDTH), 0, opts.grid.width);
      const start_y = clamp(Math.floor(offset_y), 0, opts.grid.height - 1);
      const end_y = clamp(Math.floor(offset_y + CANVAS_HEIGHT), 0, opts.grid.height);

      // Draw grid content - map grid coordinates to canvas rect
      for (let gy = start_y; gy < end_y; gy++) {
        for (let gx = start_x; gx < end_x; gx++) {
          const cell = getCell(opts.grid, gx, gy);
          if (!cell || cell.char === ' ') continue;

          // Map grid position to canvas rect position
          const canvas_x = rect.x0 + (gx - start_x);
          const canvas_y = rect.y0 + (gy - start_y);

          // Skip if outside rect
          if (canvas_x < rect.x0 || canvas_x > rect.x1 ||
              canvas_y < rect.y0 || canvas_y > rect.y1) {
            continue;
          }

          c.set(canvas_x, canvas_y, {
            char: cell.char,
            rgb: cell.rgb,
            style: 'regular',
            weight_index: cell.weight_index,
            render_index: 0
          });
        }
      }

      // Draw preview points for line/rect tools
      if (opts.preview_points.length > 0) {
        const preview_color = get_color_by_name('off_white').rgb;

        for (const point of opts.preview_points) {
          // Map grid position to canvas
          const canvas_x = rect.x0 + (point.x - start_x);
          const canvas_y = rect.y0 + (point.y - start_y);

          if (canvas_x >= rect.x0 && canvas_x <= rect.x1 &&
              canvas_y >= rect.y0 && canvas_y <= rect.y1) {
            c.set(canvas_x, canvas_y, {
              char: opts.brush.char,
              rgb: preview_color,
              style: 'regular',
              weight_index: opts.brush.weight_index,
              render_index: 1
            });
          }
        }
      }

      // Draw canvas border
      const border_color = get_color_by_name('medium_gray').rgb;
      for (let x = rect.x0; x <= rect.x1; x++) {
        c.set(x, rect.y0, { char: '─', rgb: border_color, style: 'regular', weight_index: 3 });
        c.set(x, rect.y1, { char: '─', rgb: border_color, style: 'regular', weight_index: 3 });
      }
      for (let y = rect.y0; y <= rect.y1; y++) {
        c.set(rect.x0, y, { char: '│', rgb: border_color, style: 'regular', weight_index: 3 });
        c.set(rect.x1, y, { char: '│', rgb: border_color, style: 'regular', weight_index: 3 });
      }
      c.set(rect.x0, rect.y0, { char: '┌', rgb: border_color, style: 'regular', weight_index: 3 });
      c.set(rect.x1, rect.y0, { char: '┐', rgb: border_color, style: 'regular', weight_index: 3 });
      c.set(rect.x0, rect.y1, { char: '└', rgb: border_color, style: 'regular', weight_index: 3 });
      c.set(rect.x1, rect.y1, { char: '┘', rgb: border_color, style: 'regular', weight_index: 3 });
    },

    OnPointerDown(e: PointerEvent): void {
      // Just track which button was pressed - drag events will handle the actual work
      drag_start_buttons = e.buttons;
      
      // Convert click position to grid coordinates
      const local_x = e.x - rect.x0;
      const local_y = e.y - rect.y0;
      const grid_x = Math.floor(offset_x + local_x);
      const grid_y = Math.floor(offset_y + local_y);

      // Space + Left click = pan mode
      if (space_held && e.button === 0) {
        is_panning = true;
        pan_start = { x: local_x, y: local_y };
        view_start = { x: offset_x, y: offset_y };
        return;
      }

      // Right click = prepare eraser mode (actual erase happens in OnDragMove)
      if (e.button === 2) {
        is_erasing = true;
        return;
      }

      // Left click = drawing mode (eyedropper, bucket, pencil, line, rect)
      if (e.button === 0) {
        // Check bounds for non-panning operations
        if (grid_x < 0 || grid_x >= opts.grid.width ||
            grid_y < 0 || grid_y >= opts.grid.height) {
          return;
        }

        // Eyedropper - immediate action
        if (opts.current_tool === 'eyedropper') {
          const cell = sampleCell(opts.grid, grid_x, grid_y);
          if (cell) {
            opts.brush.char = cell.char;
            opts.brush.rgb = { ...cell.rgb };
            opts.brush.weight_index = cell.weight_index;
            opts.on_sample_cell(cell);
          }
          return;
        }

        // Bucket fill - immediate action
        if (opts.current_tool === 'bucket') {
          opts.on_push_snapshot();
          applyTool(opts.grid, 'bucket', grid_x, grid_y, opts.brush);
          return;
        }

        // Pencil - will draw in OnDragMove
        if (opts.current_tool === 'pencil') {
          is_drawing = true;
          last_draw_pos = { x: grid_x, y: grid_y };
          opts.on_push_snapshot();
          drawCell(opts.grid, grid_x, grid_y, opts.brush);
          return;
        }

        // Line/Rect - will show preview in OnDragMove
        if (opts.current_tool === 'line' || opts.current_tool.startsWith('rect_')) {
          is_drawing = true;
          drag_start = { x: grid_x, y: grid_y };
        }
      }
    },

    OnDragStart(e: DragEvent): void {
      // Drag started - nothing special needed here, work happens in OnDragMove
    },

    OnDragMove(e: DragEvent): void {
      // Convert to local coordinates
      const local_x = e.x - rect.x0;
      const local_y = e.y - rect.y0;

      // Space+click panning (dragging the view)
      if (is_panning && pan_start && view_start) {
        // e.step_dx and e.step_dy are the delta since last drag move
        // We invert them because dragging right should move the view right (showing more content to the left)
        offset_x = clamp(
          view_start.x - (local_x - pan_start.x),
          0,
          Math.max(0, opts.grid.width - CANVAS_WIDTH)
        );
        offset_y = clamp(
          view_start.y - (local_y - pan_start.y),
          0,
          Math.max(0, opts.grid.height - CANVAS_HEIGHT)
        );
        return;
      }

      // Right-click eraser (continuous)
      if (is_erasing && (drag_start_buttons & 2)) {
        const grid_x = Math.floor(offset_x + local_x);
        const grid_y = Math.floor(offset_y + local_y);

        // Check bounds
        if (grid_x < 0 || grid_x >= opts.grid.width ||
            grid_y < 0 || grid_y >= opts.grid.height) {
          return;
        }

        eraseCell(opts.grid, grid_x, grid_y);
        return;
      }

      // Left-click pencil (continuous drawing)
      if (is_drawing && opts.current_tool === 'pencil' && last_draw_pos) {
        const grid_x = Math.floor(offset_x + local_x);
        const grid_y = Math.floor(offset_y + local_y);

        // Check bounds
        if (grid_x < 0 || grid_x >= opts.grid.width ||
            grid_y < 0 || grid_y >= opts.grid.height) {
          return;
        }

        // Only draw if moved to a new cell
        if (grid_x !== last_draw_pos.x || grid_y !== last_draw_pos.y) {
          drawLine(opts.grid, last_draw_pos.x, last_draw_pos.y, grid_x, grid_y, opts.brush);
          last_draw_pos = { x: grid_x, y: grid_y };
        }
        return;
      }

      // Line/Rect preview
      if (is_drawing && drag_start && (opts.current_tool === 'line' || opts.current_tool.startsWith('rect_'))) {
        const current_x = Math.floor(offset_x + local_x);
        const current_y = Math.floor(offset_y + local_y);

        if (opts.current_tool === 'line') {
          opts.preview_points = previewLine(drag_start.x, drag_start.y, current_x, current_y);
        } else if (opts.current_tool === 'rect_stroke') {
          opts.preview_points = previewRectStroke(drag_start.x, drag_start.y, current_x, current_y);
        } else if (opts.current_tool === 'rect_fill') {
          opts.preview_points = previewRectFill(drag_start.x, drag_start.y, current_x, current_y);
        }
      }
    },

    OnDragEnd(): void {
      if (is_panning) {
        is_panning = false;
        pan_start = null;
        view_start = null;
        drag_start_buttons = 0;
        return;
      }

      if (!is_drawing && !is_erasing) {
        drag_start_buttons = 0;
        return;
      }

      // Apply line/rect tool on drag end
      if ((opts.current_tool === 'line' || opts.current_tool.startsWith('rect_')) && drag_start) {
        const last_preview = opts.preview_points[opts.preview_points.length - 1];
        if (last_preview) {
          opts.on_push_snapshot();
          applyTool(
            opts.grid,
            opts.current_tool as ToolType,
            last_preview.x,
            last_preview.y,
            opts.brush,
            drag_start
          );
        }
      }

      is_drawing = false;
      is_erasing = false;
      drag_start = null;
      last_draw_pos = null;
      opts.preview_points = [];
      drag_start_buttons = 0;
    },

    OnPointerUp(): void {
      // Cleanup for cases where drag doesn't trigger (e.g., single click)
      if (is_panning) {
        is_panning = false;
        pan_start = null;
        view_start = null;
      }
      is_drawing = false;
      is_erasing = false;
      drag_start = null;
      last_draw_pos = null;
      opts.preview_points = [];
      drag_start_buttons = 0;
    },

    OnWheel(e: WheelEvent): void {
      // Zoom with ctrl
      if (e.ctrl) {
        const zoom_step = 0.1;
        scale = clamp(
          scale + (e.delta_y > 0 ? zoom_step : -zoom_step),
          0.5,
          3.0
        );
        return;
      }

      // Pan with wheel
      const scroll_step = Math.max(1, Math.floor(3 * scale));
      if (e.shift) {
        // Horizontal scroll using delta_x
        offset_x = clamp(
          offset_x + (e.delta_x > 0 ? scroll_step : -scroll_step),
          0,
          Math.max(0, opts.grid.width - CANVAS_WIDTH)
        );
      } else {
        // Vertical scroll using delta_y
        offset_y = clamp(
          offset_y + (e.delta_y > 0 ? scroll_step : -scroll_step),
          0,
          Math.max(0, opts.grid.height - CANVAS_HEIGHT)
        );
      }
    },

    OnKeyDown(e: KeyboardEvent): void {
      // Track space key for panning
      if (e.code === 'Space') {
        space_held = true;
        e.preventDefault(); // Prevent scrolling
        return;
      }

      // Arrow keys for panning
      const pan_step = 5;

      switch (e.key) {
        case 'ArrowUp':
          offset_y = clamp(offset_y - pan_step, 0, opts.grid.height - CANVAS_HEIGHT);
          break;
        case 'ArrowDown':
          offset_y = clamp(offset_y + pan_step, 0, opts.grid.height - CANVAS_HEIGHT);
          break;
        case 'ArrowLeft':
          offset_x = clamp(offset_x - pan_step, 0, opts.grid.width - CANVAS_WIDTH);
          break;
        case 'ArrowRight':
          offset_x = clamp(offset_x + pan_step, 0, opts.grid.width - CANVAS_WIDTH);
          break;
      }
    },

    OnKeyUp(e: KeyboardEvent): void {
      // Release space key
      if (e.code === 'Space') {
        space_held = false;
      }
    },

    OnBlur(): void {
      // Reset state when module loses focus
      space_held = false;
      is_panning = false;
      is_drawing = false;
      is_erasing = false;
      pan_start = null;
      view_start = null;
      drag_start = null;
      last_draw_pos = null;
      opts.preview_points = [];
    }
  };
}
