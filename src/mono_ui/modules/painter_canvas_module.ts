/**
 * ASCII Painter Canvas Module - Selection, Copy/Paste Edition
 * 
 * Features:
 * - Text tool with Enter for new lines
 * - Selection system with rectangle select
 * - Copy/Paste with special format preservation
 * - Selection operations: replace, additive, subtract, intersect
 * - Flashing selection borders
 */

import type { Canvas, Module, Rect, Rgb, PointerEvent, DragEvent, WheelEvent, Cell } from '../types.js';
import type { Grid, Brush, ToolType } from '../../ascii_painter/types.js';
import { createGrid, getCell, setCell } from '../../ascii_painter/types.js';
import { drawCell, drawLine, eraseCell, applyTool, sampleCell, previewLine, previewRectStroke, previewRectFill } from '../../ascii_painter/tools.js';
import { pushSnapshot } from '../../ascii_painter/history.js';
import { get_color_by_name } from '../colors.js';
import type { SelectionBitmap, SelectionMode } from '../../ascii_painter/selection.js';
import { createSelectionBitmap, selectRect, deselectRect, isSelected, hasSelection, getSelectionBounds, isSelectionBorder, clearSelection, selectAll, invertSelection, applySelectionMode } from '../../ascii_painter/selection.js';
import type { CopyData } from '../../ascii_painter/copy_paste.js';
import { encodeToSpecialFormat, decodeFromSpecialFormat, copyFromGrid, pasteToGrid, textToCopyData } from '../../ascii_painter/copy_paste.js';

export type PainterCanvasOptions = {
  id: string;
  rect: Rect;
  grid: Grid;
  get_current_tool: () => ToolType;
  brush: Brush;
  get_brush_size: () => number;
  get_space_replace: () => boolean;
  get_paste_space_replace: () => boolean;
  get_selection_mode: () => SelectionMode;
  preview_points: { x: number; y: number }[];
  on_push_snapshot: () => void;
  on_sample_cell: (cell: { char: string; rgb: Rgb; weight_index: number }) => void;
  get_left_click_tool: () => ToolType;
  get_right_click_tool: () => ToolType;
  // Selection callbacks
  on_selection_change?: () => void;
  on_copy_data?: (data: string) => void;
  get_clipboard_data?: () => string | null;
};

export function make_painter_canvas_module(opts: PainterCanvasOptions): Module {
  const rect = opts.rect;

  const CANVAS_WIDTH = 80;
  const CANVAS_HEIGHT = 40;

  let offset_x = 0;
  let offset_y = 0;
  let scale = 1;

  let is_panning = false;
  let is_drawing = false;
  let is_erasing = false;
  let drag_start: { x: number; y: number } | null = null;
  let last_draw_pos: { x: number; y: number } | null = null;
  let pan_start: { x: number; y: number } | null = null;
  let view_start: { x: number; y: number } | null = null;
  let drag_start_buttons = 0;
  let space_held = false;

  // Text input state
  let text_mode_active = false;
  let text_cursor_x = 0;
  let text_cursor_y = 0;
  let text_start_x = 0;
  let text_current_line = 0;

  // Selection state
  let selection_bitmap = createSelectionBitmap(opts.grid.width, opts.grid.height);
  let is_selecting = false;
  let selection_drag_start: { x: number; y: number } | null = null;
  let flash_state = 0;
  let last_flash_time = 0;

  // Paste preview state
  let paste_preview_data: CopyData | null = null;
  let paste_preview_pos: { x: number; y: number } | null = null;

  function clamp(n: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, n));
  }

  function drawWithBrushSize(x: number, y: number, is_eraser: boolean): void {
    const size = opts.get_brush_size();
    const offset = Math.floor(size / 2);
    
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        const draw_x = x - offset + dx;
        const draw_y = y - offset + dy;
        
        if (draw_x >= 0 && draw_x < opts.grid.width &&
            draw_y >= 0 && draw_y < opts.grid.height) {
          if (is_eraser) {
            eraseCell(opts.grid, draw_x, draw_y);
          } else {
            drawCell(opts.grid, draw_x, draw_y, opts.brush);
          }
        }
      }
    }
  }

  function drawLineWithBrushSize(x0: number, y0: number, x1: number, y1: number, is_eraser: boolean): void {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let curr_x = x0;
    let curr_y = y0;

    while (true) {
      drawWithBrushSize(curr_x, curr_y, is_eraser);
      if (curr_x === x1 && curr_y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; curr_x += sx; }
      if (e2 < dx) { err += dx; curr_y += sy; }
    }
  }

  // Update flash animation
  function updateFlash(): void {
    const now = Date.now();
    if (now - last_flash_time > 500) {
      flash_state = (flash_state + 1) % 2;
      last_flash_time = now;
    }
  }

  return {
    id: opts.id,
    rect,
    Focusable: true,

    Draw(c: Canvas): void {
      updateFlash();
      
      const bg_color = get_color_by_name('off_black').rgb;
      c.fill_rect(rect, { char: ' ', rgb: bg_color, style: 'regular' });

      const start_x = clamp(Math.floor(offset_x), 0, opts.grid.width - 1);
      const end_x = clamp(Math.floor(offset_x + CANVAS_WIDTH), 0, opts.grid.width);
      const start_y = clamp(Math.floor(offset_y), 0, opts.grid.height - 1);
      const end_y = clamp(Math.floor(offset_y + CANVAS_HEIGHT), 0, opts.grid.height);

      // Draw grid content
      for (let gy = start_y; gy < end_y; gy++) {
        for (let gx = start_x; gx < end_x; gx++) {
          const cell = getCell(opts.grid, gx, gy);
          if (!cell || cell.char === ' ') continue;

          const canvas_x = rect.x0 + (gx - start_x);
          const canvas_y = rect.y0 + (gy - start_y);

          if (canvas_x < rect.x0 || canvas_x > rect.x1 ||
              canvas_y < rect.y0 || canvas_y > rect.y1) continue;

          c.set(canvas_x, canvas_y, {
            char: cell.char,
            rgb: cell.rgb,
            style: 'regular',
            weight_index: cell.weight_index,
            render_index: 0
          });
        }
      }

      // Draw selection
      if (hasSelection(selection_bitmap)) {
        const border_color = get_color_by_name('vivid_yellow').rgb;
        const flash_color = get_color_by_name('pale_yellow').rgb;
        
        for (let gy = start_y; gy < end_y; gy++) {
          for (let gx = start_x; gx < end_x; gx++) {
            if (!isSelected(selection_bitmap, gx, gy)) continue;

            const canvas_x = rect.x0 + (gx - start_x);
            const canvas_y = rect.y0 + (gy - start_y);

            if (canvas_x < rect.x0 || canvas_x > rect.x1 ||
                canvas_y < rect.y0 || canvas_y > rect.y1) continue;

            const is_border = isSelectionBorder(selection_bitmap, gx, gy);
            const cell = getCell(opts.grid, gx, gy);
            const is_empty = !cell || cell.char === ' ';

            if (is_border) {
              // Border cell - draw solid indicator
              c.set(canvas_x, canvas_y, {
                char: '█',
                rgb: border_color,
                style: 'regular',
                weight_index: 4,
                render_index: 2
              });
            } else if (is_empty && flash_state === 1) {
              // Flash empty interior cells to show selection
              c.set(canvas_x, canvas_y, {
                char: '•',
                rgb: flash_color,
                style: 'regular',
                weight_index: 3,
                render_index: 2
              });
            }
          }
        }
      }

      // Draw paste preview
      if (paste_preview_data && paste_preview_pos) {
        const preview_color = get_color_by_name('vivid_blue').rgb;
        for (let y = 0; y < paste_preview_data.height; y++) {
          for (let x = 0; x < paste_preview_data.width; x++) {
            const cell = paste_preview_data.cells[y]?.[x];
            if (!cell) continue;
            
            const grid_x = paste_preview_pos.x + x;
            const grid_y = paste_preview_pos.y + y;
            
            if (grid_x < start_x || grid_x >= end_x || grid_y < start_y || grid_y >= end_y) continue;
            
            const canvas_x = rect.x0 + (grid_x - start_x);
            const canvas_y = rect.y0 + (grid_y - start_y);
            
            c.set(canvas_x, canvas_y, {
              char: cell.char,
              rgb: preview_color,
              style: 'regular',
              weight_index: cell.weight_index,
              render_index: 2
            });
          }
        }
      }

      // Draw preview points for line/rect tools
      if (opts.preview_points.length > 0) {
        const preview_color = opts.brush.rgb;
        for (const point of opts.preview_points) {
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

      // Draw text cursor
      if (text_mode_active) {
        const cursor_canvas_x = rect.x0 + (text_cursor_x - offset_x);
        const cursor_canvas_y = rect.y0 + (text_cursor_y - offset_y);
        if (cursor_canvas_x >= rect.x0 && cursor_canvas_x <= rect.x1 &&
            cursor_canvas_y >= rect.y0 && cursor_canvas_y <= rect.y1) {
          const cursor_color = get_color_by_name('vivid_yellow').rgb;
          c.set(cursor_canvas_x, cursor_canvas_y, {
            char: '_',
            rgb: cursor_color,
            style: 'regular',
            weight_index: 6,
            render_index: 2
          });
        }
      }
    },

    OnPointerDown(e: PointerEvent): void {
      drag_start_buttons = e.buttons;
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

      const tool_for_button = e.button === 2 ? opts.get_right_click_tool() : opts.get_left_click_tool();

      // Handle paste tool
      if (tool_for_button === 'paste') {
        const clipboard = opts.get_clipboard_data?.();
        if (clipboard) {
          const data = decodeFromSpecialFormat(clipboard) || textToCopyData(clipboard);
          paste_preview_data = data;
          paste_preview_pos = { x: grid_x, y: grid_y };
        }
        return;
      }

      if (e.button === 0 || e.button === 2) {
        if (grid_x < 0 || grid_x >= opts.grid.width || grid_y < 0 || grid_y >= opts.grid.height) return;

        if (tool_for_button === 'eyedropper') {
          const cell = sampleCell(opts.grid, grid_x, grid_y);
          if (cell) {
            opts.brush.char = cell.char;
            opts.brush.rgb = { ...cell.rgb };
            opts.brush.weight_index = cell.weight_index;
            opts.on_sample_cell(cell);
          }
          return;
        }

        if (tool_for_button === 'bucket') {
          opts.on_push_snapshot();
          applyTool(opts.grid, 'bucket', grid_x, grid_y, opts.brush);
          return;
        }

        if (tool_for_button === 'text') {
          text_mode_active = true;
          text_cursor_x = grid_x;
          text_cursor_y = grid_y;
          text_start_x = grid_x;
          text_current_line = 0;
          return;
        }

        if (tool_for_button === 'pencil') {
          is_drawing = true;
          last_draw_pos = { x: grid_x, y: grid_y };
          opts.on_push_snapshot();
          drawWithBrushSize(grid_x, grid_y, false);
          return;
        }

        if (tool_for_button === 'eraser') {
          is_erasing = true;
          last_draw_pos = { x: grid_x, y: grid_y };
          opts.on_push_snapshot();
          drawWithBrushSize(grid_x, grid_y, true);
          return;
        }

        // Selection tool
        if (tool_for_button === 'select_rect') {
          is_selecting = true;
          selection_drag_start = { x: grid_x, y: grid_y };
          return;
        }

        if (tool_for_button === 'line' || tool_for_button.startsWith('rect_')) {
          is_drawing = true;
          drag_start = { x: grid_x, y: grid_y };
        }
      }
    },

    OnDragMove(e: DragEvent): void {
      const local_x = e.x - rect.x0;
      const local_y = e.y - rect.y0;

      if (is_panning && pan_start && view_start) {
        offset_x = clamp(view_start.x - (local_x - pan_start.x), 0, Math.max(0, opts.grid.width - CANVAS_WIDTH));
        offset_y = clamp(view_start.y - (local_y - pan_start.y), 0, Math.max(0, opts.grid.height - CANVAS_HEIGHT));
        return;
      }

      if (is_erasing && last_draw_pos) {
        const grid_x = Math.floor(offset_x + local_x);
        const grid_y = Math.floor(offset_y + local_y);
        if (grid_x < 0 || grid_x >= opts.grid.width || grid_y < 0 || grid_y >= opts.grid.height) return;
        if (grid_x !== last_draw_pos.x || grid_y !== last_draw_pos.y) {
          drawLineWithBrushSize(last_draw_pos.x, last_draw_pos.y, grid_x, grid_y, true);
          last_draw_pos = { x: grid_x, y: grid_y };
        }
        return;
      }

      if (is_drawing && last_draw_pos) {
        const grid_x = Math.floor(offset_x + local_x);
        const grid_y = Math.floor(offset_y + local_y);
        if (grid_x < 0 || grid_x >= opts.grid.width || grid_y < 0 || grid_y >= opts.grid.height) return;
        if (grid_x !== last_draw_pos.x || grid_y !== last_draw_pos.y) {
          drawLineWithBrushSize(last_draw_pos.x, last_draw_pos.y, grid_x, grid_y, false);
          last_draw_pos = { x: grid_x, y: grid_y };
        }
        return;
      }

      // Selection preview
      if (is_selecting && selection_drag_start) {
        const grid_x = Math.floor(offset_x + local_x);
        const grid_y = Math.floor(offset_y + local_y);
        // Show preview rect
        opts.preview_points = previewRectStroke(selection_drag_start.x, selection_drag_start.y, grid_x, grid_y);
        return;
      }

      if (is_drawing && drag_start) {
        const current_x = Math.floor(offset_x + local_x);
        const current_y = Math.floor(offset_y + local_y);
        const tool_for_drag = (drag_start_buttons & 2) ? opts.get_right_click_tool() : opts.get_left_click_tool();
        if (tool_for_drag === 'line') {
          opts.preview_points = previewLine(drag_start.x, drag_start.y, current_x, current_y);
        } else if (tool_for_drag === 'rect_stroke') {
          opts.preview_points = previewRectStroke(drag_start.x, drag_start.y, current_x, current_y);
        } else if (tool_for_drag === 'rect_fill') {
          opts.preview_points = previewRectFill(drag_start.x, drag_start.y, current_x, current_y);
        }
      }

      // Paste preview follows mouse
      if (opts.get_current_tool() === 'paste' && paste_preview_data) {
        const grid_x = Math.floor(offset_x + local_x);
        const grid_y = Math.floor(offset_y + local_y);
        paste_preview_pos = { x: grid_x, y: grid_y };
      }
    },

    OnDragEnd(e: DragEvent): void {
      if (is_panning) {
        is_panning = false;
        pan_start = null;
        view_start = null;
        drag_start_buttons = 0;
        return;
      }

      if (is_selecting && selection_drag_start) {
        const local_x = e.x - rect.x0;
        const local_y = e.y - rect.y0;
        const end_x = Math.floor(offset_x + local_x);
        const end_y = Math.floor(offset_y + local_y);
        
        // Create temporary selection bitmap for the new rect
        const temp_bitmap = createSelectionBitmap(opts.grid.width, opts.grid.height);
        selectRect(temp_bitmap, selection_drag_start.x, selection_drag_start.y, end_x, end_y);
        
        // Apply selection mode
        applySelectionMode(selection_bitmap, temp_bitmap, opts.get_selection_mode());
        
        is_selecting = false;
        selection_drag_start = null;
        opts.preview_points = [];
        opts.on_selection_change?.();
        drag_start_buttons = 0;
        return;
      }

      if (!is_drawing && !is_erasing) {
        drag_start_buttons = 0;
        return;
      }

      const tool_for_end = (drag_start_buttons & 2) ? opts.get_right_click_tool() : opts.get_left_click_tool();
      if ((tool_for_end === 'line' || tool_for_end.startsWith('rect_')) && drag_start) {
        const local_x = e.x - rect.x0;
        const local_y = e.y - rect.y0;
        const end_x = Math.floor(offset_x + local_x);
        const end_y = Math.floor(offset_y + local_y);
        opts.on_push_snapshot();
        applyTool(opts.grid, tool_for_end, end_x, end_y, opts.brush, drag_start);
      }

      is_drawing = false;
      is_erasing = false;
      drag_start = null;
      last_draw_pos = null;
      opts.preview_points = [];
      drag_start_buttons = 0;
    },

    OnPointerUp(e: PointerEvent): void {
      // Handle paste placement
      if (opts.get_current_tool() === 'paste' && paste_preview_data && paste_preview_pos) {
        opts.on_push_snapshot();
        pasteToGrid(opts.grid, paste_preview_data, paste_preview_pos.x, paste_preview_pos.y, opts.get_paste_space_replace());
        paste_preview_data = null;
        paste_preview_pos = null;
        return;
      }

      const tool_for_up = (drag_start_buttons & 2) ? opts.get_right_click_tool() : opts.get_left_click_tool();
      if (is_drawing && drag_start && (tool_for_up === 'line' || tool_for_up.startsWith('rect_'))) {
        const local_x = e.x - rect.x0;
        const local_y = e.y - rect.y0;
        const end_x = Math.floor(offset_x + local_x);
        const end_y = Math.floor(offset_y + local_y);
        opts.on_push_snapshot();
        applyTool(opts.grid, tool_for_up, end_x, end_y, opts.brush, drag_start);
      }
      
      if (is_panning) {
        is_panning = false;
        pan_start = null;
        view_start = null;
      }
      is_drawing = false;
      is_erasing = false;
      is_selecting = false;
      drag_start = null;
      selection_drag_start = null;
      last_draw_pos = null;
      opts.preview_points = [];
      drag_start_buttons = 0;
    },

    OnWheel(e: WheelEvent): void {
      if (e.ctrl) {
        const zoom_step = 0.1;
        scale = clamp(scale + (e.delta_y > 0 ? zoom_step : -zoom_step), 0.5, 3.0);
        return;
      }

      const scroll_step = Math.max(1, Math.floor(3 * scale));
      if (e.shift) {
        offset_x = clamp(offset_x + (e.delta_x > 0 ? scroll_step : -scroll_step), 0, Math.max(0, opts.grid.width - CANVAS_WIDTH));
      } else {
        offset_y = clamp(offset_y + (e.delta_y > 0 ? scroll_step : -scroll_step), 0, Math.max(0, opts.grid.height - CANVAS_HEIGHT));
      }
    },

    OnKeyDown(e: KeyboardEvent): void {
      // Copy - Ctrl+C
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        if (hasSelection(selection_bitmap)) {
          const data = copyFromGrid(opts.grid, selection_bitmap);
          if (data) {
            const encoded = encodeToSpecialFormat(data);
            opts.on_copy_data?.(encoded);
            navigator.clipboard?.writeText(encoded);
          }
        }
        e.preventDefault();
        return;
      }

      // Text mode handling
      if (text_mode_active) {
        if (e.key === 'Enter') {
          // Enter: New line (fixed!)
          text_current_line++;
          text_cursor_x = text_start_x;
          text_cursor_y = text_cursor_y - 1;  // Decrease Y to go DOWN visually
          e.preventDefault();
          return;
        }
        
        if (e.key === 'Escape') {
          text_mode_active = false;
          e.preventDefault();
          return;
        }
        
        if (e.key === 'Backspace') {
          if (text_cursor_x > text_start_x || text_current_line > 0) {
            text_cursor_x--;
            if (text_cursor_x < text_start_x && text_current_line > 0) {
              text_current_line--;
              text_cursor_y++;
              text_cursor_x = opts.grid.width - 1;
            }
            if (text_cursor_x >= 0 && text_cursor_x < opts.grid.width &&
                text_cursor_y >= 0 && text_cursor_y < opts.grid.height) {
              opts.grid.cells[text_cursor_y]![text_cursor_x] = {
                char: ' ',
                rgb: { r: 0, g: 0, b: 0 },
                weight_index: 0
              };
            }
          }
          e.preventDefault();
          return;
        }
        
        if (e.key === 'Delete') {
          if (text_cursor_x >= 0 && text_cursor_x < opts.grid.width &&
              text_cursor_y >= 0 && text_cursor_y < opts.grid.height) {
            opts.grid.cells[text_cursor_y]![text_cursor_x] = {
              char: ' ',
              rgb: { r: 0, g: 0, b: 0 },
              weight_index: 0
            };
          }
          e.preventDefault();
          return;
        }
        
        if (e.key === 'ArrowLeft') {
          if (text_cursor_x > 0) text_cursor_x--;
          e.preventDefault();
          return;
        }
        if (e.key === 'ArrowRight') {
          if (text_cursor_x < opts.grid.width - 1) text_cursor_x++;
          e.preventDefault();
          return;
        }
        if (e.key === 'ArrowUp') {
          if (text_cursor_y < opts.grid.height - 1) text_cursor_y++;
          e.preventDefault();
          return;
        }
        if (e.key === 'ArrowDown') {
          if (text_cursor_y > 0) text_cursor_y--;
          e.preventDefault();
          return;
        }
        
        if (e.key === ' ' || e.code === 'Space') return;
        return;
      }

      if (e.code === 'Space') {
        space_held = true;
        e.preventDefault();
        return;
      }

      const pan_step = 5;
      switch (e.key) {
        case 'ArrowUp': offset_y = clamp(offset_y - pan_step, 0, opts.grid.height - CANVAS_HEIGHT); break;
        case 'ArrowDown': offset_y = clamp(offset_y + pan_step, 0, opts.grid.height - CANVAS_HEIGHT); break;
        case 'ArrowLeft': offset_x = clamp(offset_x - pan_step, 0, opts.grid.width - CANVAS_WIDTH); break;
        case 'ArrowRight': offset_x = clamp(offset_x + pan_step, 0, opts.grid.width - CANVAS_WIDTH); break;
      }
    },

    OnKeyUp(e: KeyboardEvent): void {
      if (e.code === 'Space') space_held = false;
    },

    OnBlur(): void {
      space_held = false;
      is_panning = false;
      is_drawing = false;
      is_erasing = false;
      is_selecting = false;
      pan_start = null;
      view_start = null;
      drag_start = null;
      selection_drag_start = null;
      last_draw_pos = null;
      opts.preview_points = [];
    },

    OnTextInput(text: string): void {
      if (!text_mode_active || !text) return;
      
      for (const char of text) {
        if (text_cursor_x >= 0 && text_cursor_x < opts.grid.width &&
            text_cursor_y >= 0 && text_cursor_y < opts.grid.height) {
          
          if (char === ' ') {
            if (opts.get_space_replace()) {
              opts.grid.cells[text_cursor_y]![text_cursor_x] = {
                char: ' ',
                rgb: { ...opts.brush.rgb },
                weight_index: opts.brush.weight_index
              };
            }
          } else {
            opts.grid.cells[text_cursor_y]![text_cursor_x] = {
              char: char,
              rgb: { ...opts.brush.rgb },
              weight_index: opts.brush.weight_index
            };
          }
          
          text_cursor_x++;
          
          if (text_cursor_x >= opts.grid.width) {
            text_current_line++;
            text_cursor_x = text_start_x;
            text_cursor_y++;
            
            if (text_cursor_y >= opts.grid.height) {
              text_mode_active = false;
              break;
            }
          }
        }
      }
    }
  };
}

// Export selection operations for external UI controls
export { clearSelection, selectAll, invertSelection, hasSelection };
export type { SelectionBitmap };
