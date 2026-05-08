/**
 * ASCII Painter Core Types
 * 
 * Engine-agnostic types for the ASCII painter system.
 * Used by both the standalone painter and any game integration.
 */

import type { Rgb } from '../mono_ui/types.js';
import type { AppearanceSlotAssignments, AppearanceSlotValue, InlineMaterialAssignments, RenderGraphicRef } from '../render_shaders/graphics_contract.js';
import type { PlaneId, Point2 } from '../shared/coords.js';

export type { AppearanceSlotAssignments, AppearanceSlotValue } from '../render_shaders/graphics_contract.js';

export type AppearanceSlotTargetMask = {
  slot_1: boolean;
  slot_2: boolean;
  slot_3: boolean;
};

export const DEFAULT_APPEARANCE_SLOT_TARGET_MASK: AppearanceSlotTargetMask = {
  slot_1: true,
  slot_2: false,
  slot_3: false,
};

export function get_enabled_appearance_slots(mask: AppearanceSlotTargetMask | null | undefined): Array<1 | 2 | 3> {
  const normalized = mask ?? DEFAULT_APPEARANCE_SLOT_TARGET_MASK;
  const enabled: Array<1 | 2 | 3> = [];
  if (normalized.slot_1) enabled.push(1);
  if (normalized.slot_2) enabled.push(2);
  if (normalized.slot_3) enabled.push(3);
  return enabled.length > 0 ? enabled : [1];
}

function clone_appearance_slot_value(value: AppearanceSlotValue): AppearanceSlotValue {
  if (value.kind === 'material') return { kind: 'material', material_id: String(value.material_id ?? '') };
  return { kind: 'flat_rgb', rgb: { ...value.rgb } };
}

export function clone_appearance_slot_assignments(assignments: AppearanceSlotAssignments | null | undefined): AppearanceSlotAssignments | undefined {
  if (!assignments) return undefined;
  const cloned: AppearanceSlotAssignments = {};
  for (const slot of [1, 2, 3] as const) {
    const value = assignments[slot];
    if (!value) continue;
    cloned[slot] = clone_appearance_slot_value(value);
  }
  return Object.keys(cloned).length > 0 ? cloned : undefined;
}

/**
 * A single cell in the ASCII grid
 */
export interface GridCell {
  char: string;
  graphic?: RenderGraphicRef;
  appearance_slots?: AppearanceSlotAssignments;
  materials?: InlineMaterialAssignments;
  rgb: Rgb;
  weight_index: number; // 0-3
  render_index?: number; // Optional layer index
}

/**
 * The main grid data structure
 */
export interface Grid {
  width: number;
  height: number;
  cells: GridCell[][];
}

/**
 * Tool types supported by the painter
 */
export type ToolType = 
  | 'pencil' 
  | 'eraser' 
  | 'line' 
  | 'rect_stroke' 
  | 'rect_fill' 
  | 'bucket' 
  | 'eyedropper'
  | 'text'
  | 'selectangle'
  | 'lassoselect'
  | 'copy'
  | 'paste'
  | 'move';

export type ToolEditTarget = 'content' | 'selection';

/**
 * Brush configuration
 */
export interface Brush {
  char: string;
  graphic?: RenderGraphicRef;
  appearance_slots?: AppearanceSlotAssignments;
  materials?: InlineMaterialAssignments;
  rgb: Rgb;
  weight_index: number;
}

/**
 * Tool state
 */
export interface ToolState {
  type: ToolType;
  brush: Brush;
}

/**
 * Point in grid coordinates
 */
export type GridPoint = Point2;

export type EditPlaneId = PlaneId;

/**
 * History snapshot for undo/redo
 */
export interface HistorySnapshot {
  cells: GridCell[][];
  timestamp: number;
}

/**
 * Export format for saving/sharing
 */
export interface GridExport {
  version: 1;
  width: number;
  height: number;
  cells: GridCell[][];
  created_at: string;
  metadata?: {
    title?: string;
    description?: string;
    tags?: string[];
  };
}

/**
 * Character ramp for image conversion
 */
export interface CharacterRamp {
  name: string;
  chars: string[];
  description: string;
}

/**
 * Predefined character ramps
 */
export const CHARACTER_RAMPS: CharacterRamp[] = [
  {
    name: 'simple',
    chars: [' ', '.', ':', '-', '=', '+', '*', '#', '%', '@'],
    description: 'Basic ASCII ramp'
  },
  {
    name: 'blocks',
    chars: [' ', '░', '▒', '▓', '█'],
    description: 'Block characters'
  },
  {
    name: 'detailed',
    chars: [' ', '.', '\'', '`', '^', '"', ',', ':', ';', 'I', 'l', '!', 'i', '>', '<', '~', '+', '_', '-', '?', ']', '[', '}', '{', '1', ')', '(', '|', '\\', '/', 't', 'f', 'j', 'r', 'x', 'n', 'u', 'v', 'c', 'z', 'X', 'Y', 'U', 'J', 'C', 'L', 'Q', '0', 'O', 'Z', 'm', 'w', 'q', 'p', 'd', 'b', 'k', 'h', 'a', 'o', 'Q', '#', 'M', 'W', '&', '8', '%', 'B', '@', '$'],
    description: 'Detailed 70-character ramp'
  }
];

/**
 * Create an empty grid
 */
export function createGrid(width: number, height: number): Grid {
  const cells: GridCell[][] = [];
  
  for (let y = 0; y < height; y++) {
    const row: GridCell[] = [];
    for (let x = 0; x < width; x++) {
      row.push({
        char: ' ',
        appearance_slots: undefined,
        rgb: { r: 0, g: 0, b: 0 },
        weight_index: 0
      });
    }
    cells.push(row);
  }
  
  return { width, height, cells };
}

/**
 * Clone a grid
 */
export function cloneGrid(grid: Grid): Grid {
  return {
    width: grid.width,
    height: grid.height,
    cells: grid.cells.map(row => 
      row.map(cell => ({
        char: cell.char,
        graphic: cell.graphic ? { ...cell.graphic } : undefined,
        appearance_slots: clone_appearance_slot_assignments(cell.appearance_slots),
        materials: cell.materials ? { ...cell.materials } : undefined,
        rgb: { ...cell.rgb },
        weight_index: cell.weight_index,
        render_index: cell.render_index
      }))
    )
  };
}

/**
 * Get cell at position (with bounds checking)
 */
export function getCell(grid: Grid, x: number, y: number): GridCell | null {
  if (x < 0 || x >= grid.width || y < 0 || y >= grid.height) {
    return null;
  }
  const cell = grid.cells[y]?.[x];
  return cell ?? null;
}

/**
 * Set cell at position (with bounds checking)
 */
export function setCell(grid: Grid, x: number, y: number, cell: GridCell): boolean {
  if (x < 0 || x >= grid.width || y < 0 || y >= grid.height) {
    return false;
  }
  const row = grid.cells[y];
  if (!row) return false;
  row[x] = {
    char: cell.char,
    graphic: cell.graphic ? { ...cell.graphic } : undefined,
    appearance_slots: clone_appearance_slot_assignments(cell.appearance_slots),
    materials: cell.materials ? { ...cell.materials } : undefined,
    rgb: { ...cell.rgb },
    weight_index: cell.weight_index,
    render_index: cell.render_index,
  };
  return true;
}

/**
 * Export grid to serializable format
 */
export function exportGrid(grid: Grid, metadata?: GridExport['metadata']): GridExport {
  return {
    version: 1,
    width: grid.width,
    height: grid.height,
    cells: grid.cells.map(row => 
      row.map(cell => ({
        char: cell.char,
        graphic: cell.graphic ? { ...cell.graphic } : undefined,
        appearance_slots: clone_appearance_slot_assignments(cell.appearance_slots),
        materials: cell.materials ? { ...cell.materials } : undefined,
        rgb: { ...cell.rgb },
        weight_index: cell.weight_index,
        render_index: cell.render_index
      }))
    ),
    created_at: new Date().toISOString(),
    metadata
  };
}

/**
 * Import grid from export format
 */
export function importGrid(export_data: GridExport): Grid {
  return {
    width: export_data.width,
    height: export_data.height,
    cells: export_data.cells.map(row =>
      row.map(cell => ({
        char: cell.char,
        graphic: cell.graphic ? { ...cell.graphic } : undefined,
        appearance_slots: clone_appearance_slot_assignments(cell.appearance_slots),
        materials: cell.materials ? { ...cell.materials } : undefined,
        rgb: { ...cell.rgb },
        weight_index: cell.weight_index,
        render_index: cell.render_index
      }))
    )
  };
}

/**
 * Clear the grid (set all cells to empty)
 */
export function clearGrid(grid: Grid): void {
  for (let y = 0; y < grid.height; y++) {
    const row = grid.cells[y];
    if (!row) continue;
    for (let x = 0; x < grid.width; x++) {
      row[x] = {
        char: ' ',
        appearance_slots: undefined,
        rgb: { r: 0, g: 0, b: 0 },
        weight_index: 0
      };
    }
  }
}
