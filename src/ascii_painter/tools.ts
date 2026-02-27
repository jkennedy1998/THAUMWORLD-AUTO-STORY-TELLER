/**
 * ASCII Painter Drawing Tools
 * 
 * Implements all drawing tools: pencil, eraser, line, rectangle, bucket, eyedropper
 */

import type { Grid, GridCell, GridPoint, Brush, ToolType } from './types.js';
import { getCell, setCell } from './types.js';

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
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  while (true) {
    drawCell(grid, x0, y0, brush);

    if (x0 === x1 && y0 === y1) break;

    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
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
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);

  // Top and bottom edges
  for (let x = minX; x <= maxX; x++) {
    drawCell(grid, x, minY, brush);
    drawCell(grid, x, maxY, brush);
  }

  // Left and right edges
  for (let y = minY + 1; y < maxY; y++) {
    drawCell(grid, minX, y, brush);
    drawCell(grid, maxX, y, brush);
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
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      drawCell(grid, x, y, brush);
    }
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

  // Determine what we're filling (match char and color)
  const targetChar = startCell.char;
  const targetRgb = startCell.rgb;

  // Don't fill if clicking on same character/color
  if (targetChar === brush.char && 
      targetRgb.r === brush.rgb.r && 
      targetRgb.g === brush.rgb.g && 
      targetRgb.b === brush.rgb.b) {
    return;
  }

  const stack: [number, number][] = [[startX, startY]];
  const visited = new Set<string>();

  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    const key = `${x},${y}`;

    if (visited.has(key)) continue;
    visited.add(key);

    const cell = getCell(grid, x, y);
    if (!cell) continue;

    // Check if this cell matches the target
    if (cell.char === targetChar && 
        cell.rgb.r === targetRgb.r && 
        cell.rgb.g === targetRgb.g && 
        cell.rgb.b === targetRgb.b) {
      
      drawCell(grid, x, y, brush);

      // Add neighbors
      stack.push([x + 1, y]);
      stack.push([x - 1, y]);
      stack.push([x, y + 1]);
      stack.push([x, y - 1]);
    }
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
  const points: GridPoint[] = [];
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;

  while (true) {
    points.push({ x, y });

    if (x === x1 && y === y1) break;

    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }

  return points;
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
  const points: GridPoint[] = [];
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);

  // Top and bottom edges
  for (let x = minX; x <= maxX; x++) {
    points.push({ x, y: minY });
    points.push({ x, y: maxY });
  }

  // Left and right edges
  for (let y = minY + 1; y < maxY; y++) {
    points.push({ x: minX, y });
    points.push({ x: maxX, y });
  }

  return points;
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
  const points: GridPoint[] = [];
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      points.push({ x, y });
    }
  }

  return points;
}
