/**
 * ASCII Painter History Management - Action-Based Undo System
 * 
 * Delta-based undo/redo that tracks actions instead of full snapshots.
 * Inspired by Blender's undo system.
 */

import type { GridCell, HistorySnapshot } from './types.js';
import { getOrCreateLayer, type VoxelSpace } from './voxel_space.js';
import type { SelectionBitmap } from './selection.js';
import type { PainterGroup } from './painter_document.js';

// Action types
export type ActionType = 
  | 'draw_cells'      // Pencil, line, brush strokes
  | 'erase_cells'     // Eraser tool
  | 'fill'           // Bucket fill
  | 'paste'          // Paste operation
  | 'clear_canvas'   // Clear entire layer
  | 'create_group'
  | 'delete_group'
  | 'duplicate_group'
  | 'rename_group'
  | 'set_group_visibility'
  | 'set_group_locked'
  | 'reorder_groups'
  | 'selection_change'; // Rect, lasso, clear, invert, select-all

// Cell change tracking
export interface CellChange {
  x: number;
  y: number;
  worldX: number;
  worldY: number;
  worldZ: number;
  group_id: string;
  oldCell: GridCell;
  newCell: GridCell;
}

// Selection change tracking
export interface SelectionChange {
  oldBitmap: SelectionBitmap;
  newBitmap: SelectionBitmap;
}

// History action entry
export interface HistoryAction {
  id: string;
  type: ActionType;
  description: string;
  z?: number;
  group_id?: string;
  timestamp: number;
  
  // For cell-based actions
  cellChanges?: CellChange[];
  
  // For selection actions
  selectionChange?: SelectionChange;
  
  // For group operations
  groupId?: string;
  sourceGroupId?: string;
  targetGroupId?: string;
  oldGroupData?: PainterGroup;
  newGroupData?: PainterGroup;
  oldGroupOrder?: string[];
  newGroupOrder?: string[];
}

export interface HistoryManager {
  max_history: number;
  current_index: number;
  actions: HistoryAction[];
  
  // Batch tracking for continuous operations
  isBatching: boolean;
  batchAction: HistoryAction | null;
  batchTimeout: ReturnType<typeof setTimeout> | null;
}

/**
 * Create a new history manager
 */
export function createHistoryManager(max_history: number = 50): HistoryManager {
  return {
    max_history,
    current_index: 0,
    actions: [],
    isBatching: false,
    batchAction: null,
    batchTimeout: null
  };
}

/**
 * Generate unique action ID
 */
function generateActionId(): string {
  return `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Clone a GridCell
 */
function cloneCell(cell: GridCell): GridCell {
  return {
    char: cell.char,
    rgb: { ...cell.rgb },
    weight_index: cell.weight_index
  };
}

function clonePainterGroup(group: PainterGroup): PainterGroup {
  return {
    ...group,
    voxels: group.voxels.map((voxel) => ({
      ...voxel,
      rgb: { ...voxel.rgb },
    })),
    frames: Array.isArray(group.frames)
      ? group.frames.map((frame) => ({
          ...frame,
          deltas: frame.deltas.map((delta) => ({
            ...delta,
            next: delta.next ? {
              ...delta.next,
              rgb: { ...delta.next.rgb },
            } : null,
          })),
        }))
      : [],
    metadata: group.metadata ? {
      ...group.metadata,
      origin: group.metadata.origin ? { ...group.metadata.origin } : undefined,
    } : undefined,
  };
}

/**
 * Clone a SelectionBitmap
 */
function cloneSelectionBitmap(bitmap: SelectionBitmap): SelectionBitmap {
  return {
    width: bitmap.width,
    height: bitmap.height,
    cells: bitmap.cells.map(row => [...row])
  };
}

/**
 * Log a cell-based action (draw, erase, fill, paste, clear)
 */
export function logCellAction(
  history: HistoryManager,
  type: 'draw_cells' | 'erase_cells' | 'fill' | 'paste' | 'clear_canvas',
  description: string,
  options: { z?: number; group_id: string },
  changes: CellChange[]
): void {
  if (changes.length === 0) return;
  
  // Clear redo history
  if (history.current_index < history.actions.length) {
    history.actions = history.actions.slice(0, history.current_index);
  }
  
  const action: HistoryAction = {
    id: generateActionId(),
    type,
    description: `${description} (${changes.length} cell${changes.length !== 1 ? 's' : ''})`,
    z: options.z,
    group_id: options.group_id,
    timestamp: Date.now(),
    cellChanges: changes.map(c => ({
      x: c.x,
      y: c.y,
      worldX: c.worldX,
      worldY: c.worldY,
      worldZ: c.worldZ,
      group_id: c.group_id,
      oldCell: cloneCell(c.oldCell),
      newCell: cloneCell(c.newCell)
    }))
  };
  
  history.actions.push(action);
  history.current_index++;
  
  // Remove oldest if exceeding max
  if (history.actions.length > history.max_history) {
    history.actions.shift();
    history.current_index--;
  }
}

/**
 * Log a selection change action
 */
export function logSelectionAction(
  history: HistoryManager,
  description: string,
  oldBitmap: SelectionBitmap,
  newBitmap: SelectionBitmap
): void {
  // Don't log if selection didn't actually change
  const changed = !selectionBitmapsEqual(oldBitmap, newBitmap);
  if (!changed) return;
  
  // Clear redo history
  if (history.current_index < history.actions.length) {
    history.actions = history.actions.slice(0, history.current_index);
  }
  
  const action: HistoryAction = {
    id: generateActionId(),
    type: 'selection_change',
    description,
    z: 0, // Selection is global
    timestamp: Date.now(),
    selectionChange: {
      oldBitmap: cloneSelectionBitmap(oldBitmap),
      newBitmap: cloneSelectionBitmap(newBitmap)
    }
  };
  
  history.actions.push(action);
  history.current_index++;
  
  if (history.actions.length > history.max_history) {
    history.actions.shift();
    history.current_index--;
  }
}

export function logGroupAction(
  history: HistoryManager,
  type: 'create_group' | 'delete_group' | 'duplicate_group' | 'rename_group' | 'set_group_visibility' | 'set_group_locked' | 'reorder_groups',
  description: string,
  options: {
    groupId?: string;
    sourceGroupId?: string;
    targetGroupId?: string;
    oldGroupData?: PainterGroup;
    newGroupData?: PainterGroup;
    oldGroupOrder?: string[];
    newGroupOrder?: string[];
  }
): void {
  if (history.current_index < history.actions.length) {
    history.actions = history.actions.slice(0, history.current_index);
  }

  const action: HistoryAction = {
    id: generateActionId(),
    type,
    description,
    z: 0,
    timestamp: Date.now(),
    groupId: options.groupId,
    sourceGroupId: options.sourceGroupId,
    targetGroupId: options.targetGroupId,
    oldGroupData: options.oldGroupData ? clonePainterGroup(options.oldGroupData) : undefined,
    newGroupData: options.newGroupData ? clonePainterGroup(options.newGroupData) : undefined,
    oldGroupOrder: options.oldGroupOrder ? [...options.oldGroupOrder] : undefined,
    newGroupOrder: options.newGroupOrder ? [...options.newGroupOrder] : undefined,
  };

  history.actions.push(action);
  history.current_index++;

  if (history.actions.length > history.max_history) {
    history.actions.shift();
    history.current_index--;
  }
}

/**
 * Check if two selection bitmaps are equal
 */
function selectionBitmapsEqual(a: SelectionBitmap, b: SelectionBitmap): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      if (a.cells[y]?.[x] !== b.cells[y]?.[x]) return false;
    }
  }
  return true;
}

/**
 * Start batching cell changes (for continuous drawing)
 */
export function startBatch(history: HistoryManager, type: ActionType, description: string, options: { z?: number; group_id: string }): void {
  if (history.isBatching && history.batchAction) {
    // Already batching, commit current batch first
    endBatch(history);
  }
  
  history.isBatching = true;
  history.batchAction = {
    id: generateActionId(),
    type,
    description,
    z: options.z,
    group_id: options.group_id,
    timestamp: Date.now(),
    cellChanges: []
  };
}

/**
 * Add a cell change to current batch
 */
export function addToBatch(history: HistoryManager, change: CellChange): void {
  if (!history.isBatching || !history.batchAction) return;
  
  // Check if this cell already has a change in the batch
  const existingIndex = history.batchAction.cellChanges!.findIndex(
    c => c.x === change.x && c.y === change.y
  );
  
  if (existingIndex >= 0) {
    // Update the existing change's newCell, keep oldCell
    history.batchAction.cellChanges![existingIndex]!.newCell = cloneCell(change.newCell);
  } else {
    // Add new change
    history.batchAction.cellChanges!.push({
      x: change.x,
      y: change.y,
      worldX: change.worldX,
      worldY: change.worldY,
      worldZ: change.worldZ,
      group_id: change.group_id,
      oldCell: cloneCell(change.oldCell),
      newCell: cloneCell(change.newCell)
    });
  }
}

/**
 * End batching and commit the action
 */
export function endBatch(history: HistoryManager): void {
  if (!history.isBatching || !history.batchAction) return;
  
  if (history.batchAction.cellChanges && history.batchAction.cellChanges.length > 0) {
    // Clear redo history
    if (history.current_index < history.actions.length) {
      history.actions = history.actions.slice(0, history.current_index);
    }
    
    // Update description with cell count
    const count = history.batchAction.cellChanges.length;
    history.batchAction.description = `${history.batchAction.description} (${count} cell${count !== 1 ? 's' : ''})`;
    
    history.actions.push(history.batchAction);
    history.current_index++;
    
    if (history.actions.length > history.max_history) {
      history.actions.shift();
      history.current_index--;
    }
  }
  
  history.isBatching = false;
  history.batchAction = null;
}

/**
 * Cancel current batch without committing
 */
export function cancelBatch(history: HistoryManager): void {
  history.isBatching = false;
  history.batchAction = null;
}

/**
 * Legacy undo: revert last action against a voxel-space replay target.
 * Returns the action description if successful, null otherwise
 */
export function undoLegacyHistory(history: HistoryManager, space: VoxelSpace): string | null {
  if (!canUndo(history)) {
    return null;
  }
  
  history.current_index--;
  const action = history.actions[history.current_index];
  
  if (!action) {
    history.current_index++;
    return null;
  }
  
  // Apply inverse of the action
  switch (action.type) {
    case 'draw_cells':
    case 'erase_cells':
    case 'fill':
    case 'paste':
    case 'clear_canvas':
      undoCellAction(space, action);
      break;
      
    case 'selection_change':
      // Selection undo handled by caller (they have the selection bitmap)
      break;
  }
  
  return action.description;
}

/**
 * Legacy redo: re-apply undone action against a voxel-space replay target.
 * Returns the action description if successful, null otherwise
 */
export function redoLegacyHistory(history: HistoryManager, space: VoxelSpace): string | null {
  if (!canRedo(history)) {
    return null;
  }
  
  const action = history.actions[history.current_index];
  
  if (!action) {
    return null;
  }
  
  // Apply the action
  switch (action.type) {
    case 'draw_cells':
    case 'erase_cells':
    case 'fill':
    case 'paste':
    case 'clear_canvas':
      redoCellAction(space, action);
      break;
      
    case 'selection_change':
      // Selection redo handled by caller
      break;
  }
  
  history.current_index++;
  return action.description;
}

// Undo helper functions
function undoCellAction(space: VoxelSpace, action: HistoryAction): void {
  if (!action.cellChanges) return;
  for (const change of action.cellChanges) {
    const layer = getOrCreateLayer(space, change.worldZ);
    const row = layer.cells[change.worldY];
    if (row && row[change.worldX]) row[change.worldX] = cloneCell(change.oldCell);
  }
}

function redoCellAction(space: VoxelSpace, action: HistoryAction): void {
  if (!action.cellChanges) return;
  for (const change of action.cellChanges) {
    const layer = getOrCreateLayer(space, change.worldZ);
    const row = layer.cells[change.worldY];
    if (row && row[change.worldX]) row[change.worldX] = cloneCell(change.newCell);
  }
}

/**
 * Check if undo is available
 */
export function canUndo(history: HistoryManager): boolean {
  return history.current_index > 0;
}

/**
 * Check if redo is available
 */
export function canRedo(history: HistoryManager): boolean {
  return history.current_index < history.actions.length;
}

/**
 * Get current history state for display
 */
export function getHistoryState(history: HistoryManager): {
  can_undo: boolean;
  can_redo: boolean;
  total_actions: number;
  current_position: number;
  last_action: string | null;
} {
  const lastAction = history.current_index > 0 && history.current_index <= history.actions.length
    ? history.actions[history.current_index - 1]?.description || null
    : null;
    
  return {
    can_undo: canUndo(history),
    can_redo: canRedo(history),
    total_actions: history.actions.length,
    current_position: history.current_index,
    last_action: lastAction
  };
}

/**
 * Clear all history
 */
export function clearHistory(history: HistoryManager): void {
  history.actions = [];
  history.current_index = 0;
  history.isBatching = false;
  history.batchAction = null;
  if (history.batchTimeout) {
    clearTimeout(history.batchTimeout);
    history.batchTimeout = null;
  }
}
