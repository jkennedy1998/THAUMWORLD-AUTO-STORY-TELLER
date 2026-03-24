/**
 * ASCII Painter Drawing Tools
 * 
 * Implements all drawing tools: pencil, eraser, line, rectangle, bucket, eyedropper
 */

import type { Grid, GridCell, GridPoint, Brush, ToolType } from './types.js';
import { getCell, setCell } from './types.js';
import {
  get_flood_fill_points,
  get_line_points,
  get_rect_fill_points,
  get_rect_stroke_points,
} from '../shared/painter_tools.js';

/**
 * Draw a single cell with the brush
 */
export function drawCell(grid: Grid, x: number, y: number, brush: Brush): boolean {
  return setCell(grid, x, y, {
    char: brush.char,
    rgb: { ...brush.rgb },
    weight_index: brush.weight_index
  });
}

/**
 * Erase a cell (set to empty)
 */
export function eraseCell(grid: Grid, x: number, y: number): boolean {
  return setCell(grid, x, y, {
    char: ' ',
    rgb: { r: 0, g: 0, b: 0 },
    weight_index: 0
  });
}

/**
 * Sample a cell (for eyedropper)
 */
export function sampleCell(grid: Grid, x: number, y: number): GridCell | null {
  return getCell(grid, x, y);
}

/**
 * Draw a line using Bresenham's algorithm
 */
export function drawLine(
  grid: Grid, 
  x0: number, 
  y0: number, 
  x1: number, 
  y1: number, 
  brush: Brush
): void {
  for (const point of get_line_points(x0, y0, x1, y1)) {
    drawCell(grid, point.x, point.y, brush);
  }
}

/**
 * Draw a rectangle outline
 */
export function drawRectStroke(
  grid: Grid,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  brush: Brush
): void {
  for (const point of get_rect_stroke_points(x0, y0, x1, y1)) {
    drawCell(grid, point.x, point.y, brush);
  }
}

/**
 * Draw a filled rectangle
 */
export function drawRectFill(
  grid: Grid,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  brush: Brush
): void {
  for (const point of get_rect_fill_points(x0, y0, x1, y1)) {
    drawCell(grid, point.x, point.y, brush);
  }
}

/**
 * Flood fill (bucket tool)
 */
export function floodFill(
  grid: Grid,
  startX: number,
  startY: number,
  brush: Brush
): void {
  const startCell = getCell(grid, startX, startY);
  if (!startCell) return;

  // Don't fill if clicking on same character/color
  if (startCell.char === brush.char && 
      startCell.rgb.r === brush.rgb.r && 
      startCell.rgb.g === brush.rgb.g && 
      startCell.rgb.b === brush.rgb.b) {
    return;
  }

  const points = get_flood_fill_points(
    startX,
    startY,
    (x, y) => getCell(grid, x, y),
    (candidate, target) => (
      candidate.char === target.char &&
      candidate.rgb.r === target.rgb.r &&
      candidate.rgb.g === target.rgb.g &&
      candidate.rgb.b === target.rgb.b
    ),
  );
  for (const point of points) {
    drawCell(grid, point.x, point.y, brush);
  }
}

/**
 * Apply a tool at a specific position
 */
export function applyTool(
  grid: Grid,
  tool: ToolType,
  x: number,
  y: number,
  brush: Brush,
  startPos?: GridPoint // For line/rect tools
): void {
  switch (tool) {
    case 'pencil':
      drawCell(grid, x, y, brush);
      break;
    case 'eraser':
      eraseCell(grid, x, y);
      break;
    case 'bucket':
      floodFill(grid, x, y, brush);
      break;
    case 'line':
      if (startPos) {
        drawLine(grid, startPos.x, startPos.y, x, y, brush);
      }
      break;
    case 'rect_stroke':
      if (startPos) {
        drawRectStroke(grid, startPos.x, startPos.y, x, y, brush);
      }
      break;
    case 'rect_fill':
      if (startPos) {
        drawRectFill(grid, startPos.x, startPos.y, x, y, brush);
      }
      break;
    case 'eyedropper':
      // Eyedropper doesn't modify grid, it samples
      break;
  }
}

/**
 * Preview line (for showing line while dragging)
 * Returns array of points
 */
export function previewLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number
): GridPoint[] {
  return get_line_points(x0, y0, x1, y1);
}

/**
 * Preview rectangle stroke
 * Returns array of points for the outline
 */
export function previewRectStroke(
  x0: number,
  y0: number,
  x1: number,
  y1: number
): GridPoint[] {
  return get_rect_stroke_points(x0, y0, x1, y1);
}

/**
 * Preview rectangle fill
 * Returns array of all points in the rectangle
 */
export function previewRectFill(
  x0: number,
  y0: number,
  x1: number,
  y1: number
): GridPoint[] {
  return get_rect_fill_points(x0, y0, x1, y1);
}
