/**
 * ASCII Painter Drawing Tools
 * 
 * Implements all drawing tools: pencil, eraser, line, rectangle, bucket, eyedropper
 */

import type { Grid, GridCell, GridPoint, Brush, ToolType, AppearanceSlotTargetMask } from './types.js';
import { clone_appearance_slot_assignments, DEFAULT_APPEARANCE_SLOT_TARGET_MASK, get_enabled_appearance_slots, getCell, setCell } from './types.js';
import type { EditChannels } from './edit_mask.js';
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
    graphic: brush.graphic ? { ...brush.graphic } : undefined,
    appearance_slots: clone_appearance_slot_assignments(brush.appearance_slots),
    materials: brush.materials ? { ...brush.materials } : undefined,
    rgb: { ...brush.rgb },
    weight_index: brush.weight_index
  });
}

function has_meaningful_existing_text_appearance(cell: GridCell | null | undefined): boolean {
  if (!cell) return false;
  return cell.char !== ' '
    || !!cell.graphic
    || !!cell.appearance_slots
    || !!cell.materials
    || cell.weight_index !== 0
    || cell.rgb.r !== 0
    || cell.rgb.g !== 0
    || cell.rgb.b !== 0;
}

export function buildTextEntryCell(
  existing: GridCell | null | undefined,
  brush: Brush,
  char: string,
  channels: EditChannels = { char: true, color: true, weight: true },
  slot_targets: AppearanceSlotTargetMask = DEFAULT_APPEARANCE_SLOT_TARGET_MASK,
): GridCell {
  const next: GridCell = has_meaningful_existing_text_appearance(existing)
    ? {
        char,
        graphic: undefined,
        appearance_slots: clone_appearance_slot_assignments(existing?.appearance_slots),
        materials: existing?.materials ? { ...existing.materials } : undefined,
        rgb: existing ? { ...existing.rgb } : { ...brush.rgb },
        weight_index: existing?.weight_index ?? brush.weight_index,
        render_index: existing?.render_index,
      }
    : {
        char,
        graphic: undefined,
        appearance_slots: clone_appearance_slot_assignments(brush.appearance_slots),
        materials: brush.materials ? { ...brush.materials } : undefined,
        rgb: { ...brush.rgb },
        weight_index: brush.weight_index,
      };

  if (channels.color) {
    next.rgb = { ...brush.rgb };
    const targeted_slots = get_enabled_appearance_slots(slot_targets);
    const next_slots = clone_appearance_slot_assignments(next.appearance_slots) ?? {};
    const next_materials = next.materials ? { ...next.materials } : {};
    for (const slot of targeted_slots) {
      const brush_slot = brush.appearance_slots?.[slot];
      if (brush_slot) next_slots[slot] = brush_slot.kind === 'material'
        ? { kind: 'material', material_id: brush_slot.material_id }
        : { kind: 'flat_rgb', rgb: { ...brush_slot.rgb } };
      else delete next_slots[slot];

      const brush_material = brush.materials?.[slot];
      if (brush_material) next_materials[slot] = brush_material;
      else delete next_materials[slot];
    }
    next.appearance_slots = Object.keys(next_slots).length > 0 ? next_slots : undefined;
    next.materials = Object.keys(next_materials).length > 0 ? next_materials : undefined;
  }

  if (channels.weight) {
    next.weight_index = brush.weight_index;
  }

  return next;
}

/**
 * Erase a cell (set to empty)
 */
export function eraseCell(grid: Grid, x: number, y: number): boolean {
  return setCell(grid, x, y, {
    char: ' ',
    graphic: undefined,
    appearance_slots: undefined,
    materials: undefined,
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
