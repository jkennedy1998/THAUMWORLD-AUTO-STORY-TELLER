/**
 * ASCII Painter History Management - Action-Based Undo System
 * 
 * Delta-based undo/redo that tracks actions instead of full snapshots.
 * Inspired by Blender's undo system.
 */

import type { Grid, GridCell, HistorySnapshot } from './types.js';
import type { VoxelSpace, VoxelLayer } from './voxel_space.js';
import type { SelectionBitmap } from './selection.js';

// Action types
export type ActionType = 
  | 'draw_cells'      // Pencil, line, brush strokes
  | 'erase_cells'     // Eraser tool
  | 'fill'           // Bucket fill
  | 'paste'          // Paste operation
  | 'clear_canvas'   // Clear entire layer
  | 'add_layer'      // Create new layer
  | 'delete_layer'   // Remove layer
  | 'duplicate_layer' // Copy layer
  | 'selection_change'; // Rect, lasso, clear, invert, select-all

// Cell change tracking
export interface CellChange {
  x: number;
  y: number;
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
  z: number;
  timestamp: number;
  
  // For cell-based actions
  cellChanges?: CellChange[];
  
  // For selection actions
  selectionChange?: SelectionChange;
  
  // For layer operations
  layerData?: VoxelLayer;
  sourceZ?: number;
  targetZ?: number;
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

/**
 * Clone a VoxelLayer
 */
function cloneLayer(layer: VoxelLayer): VoxelLayer {
  return {
    z: layer.z,
    name: layer.name,
    visible: layer.visible,
    opacity: layer.opacity,
    locked: layer.locked,
    cells: layer.cells.map(row => 
      row.map(cell => cloneCell(cell))
    )
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
  z: number,
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
    z,
    timestamp: Date.now(),
    cellChanges: changes.map(c => ({
      x: c.x,
      y: c.y,
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

/**
 * Log a layer operation action
 */
export function logLayerAction(
  history: HistoryManager,
  type: 'add_layer' | 'delete_layer' | 'duplicate_layer',
  description: string,
  z: number,
  layerData?: VoxelLayer,
  sourceZ?: number,
  targetZ?: number
): void {
  // Clear redo history
  if (history.current_index < history.actions.length) {
    history.actions = history.actions.slice(0, history.current_index);
  }
  
  const action: HistoryAction = {
    id: generateActionId(),
    type,
    description,
    z,
    timestamp: Date.now(),
    layerData: layerData ? cloneLayer(layerData) : undefined,
    sourceZ,
    targetZ
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
export function startBatch(history: HistoryManager, type: ActionType, description: string, z: number): void {
  if (history.isBatching && history.batchAction) {
    // Already batching, commit current batch first
    endBatch(history);
  }
  
  history.isBatching = true;
  history.batchAction = {
    id: generateActionId(),
    type,
    description,
    z,
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
 * Undo: revert last action
 * Returns the action description if successful, null otherwise
 */
export function undo(history: HistoryManager, space: VoxelSpace): string | null {
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
      
    case 'add_layer':
      undoAddLayer(space, action);
      break;
      
    case 'delete_layer':
      undoDeleteLayer(space, action);
      break;
      
    case 'duplicate_layer':
      undoDuplicateLayer(space, action);
      break;
  }
  
  return action.description;
}

/**
 * Redo: re-apply undone action
 * Returns the action description if successful, null otherwise
 */
export function redo(history: HistoryManager, space: VoxelSpace): string | null {
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
      
    case 'add_layer':
      redoAddLayer(space, action);
      break;
      
    case 'delete_layer':
      redoDeleteLayer(space, action);
      break;
      
    case 'duplicate_layer':
      redoDuplicateLayer(space, action);
      break;
  }
  
  history.current_index++;
  return action.description;
}

// Undo helper functions
function undoCellAction(space: VoxelSpace, action: HistoryAction): void {
  const layer = space.layers.get(action.z);
  if (!layer || !action.cellChanges) return;
  
  for (const change of action.cellChanges) {
    const row = layer.cells[change.y];
    if (row && row[change.x]) {
      row[change.x] = cloneCell(change.oldCell);
    }
  }
}

function redoCellAction(space: VoxelSpace, action: HistoryAction): void {
  const layer = space.layers.get(action.z);
  if (!layer || !action.cellChanges) return;
  
  for (const change of action.cellChanges) {
    const row = layer.cells[change.y];
    if (row && row[change.x]) {
      row[change.x] = cloneCell(change.newCell);
    }
  }
}

function undoAddLayer(space: VoxelSpace, action: HistoryAction): void {
  space.layers.delete(action.z);
  // Update bounds
  const zs = Array.from(space.layers.keys());
  if (zs.length > 0) {
    space.bounds.minZ = Math.min(...zs);
    space.bounds.maxZ = Math.max(...zs);
    space.bounds.depth = zs.length;
  }
}

function redoAddLayer(space: VoxelSpace, action: HistoryAction): void {
  if (action.layerData) {
    space.layers.set(action.z, cloneLayer(action.layerData));
    // Update bounds
    space.bounds.minZ = Math.min(space.bounds.minZ, action.z);
    space.bounds.maxZ = Math.max(space.bounds.maxZ, action.z);
    space.bounds.depth = space.layers.size;
  }
}

function undoDeleteLayer(space: VoxelSpace, action: HistoryAction): void {
  if (action.layerData) {
    space.layers.set(action.z, cloneLayer(action.layerData));
    // Update bounds
    space.bounds.minZ = Math.min(space.bounds.minZ, action.z);
    space.bounds.maxZ = Math.max(space.bounds.maxZ, action.z);
    space.bounds.depth = space.layers.size;
  }
}

function redoDeleteLayer(space: VoxelSpace, action: HistoryAction): void {
  space.layers.delete(action.z);
  // Update bounds
  const zs = Array.from(space.layers.keys());
  if (zs.length > 0) {
    space.bounds.minZ = Math.min(...zs);
    space.bounds.maxZ = Math.max(...zs);
    space.bounds.depth = zs.length;
  }
}

function undoDuplicateLayer(space: VoxelSpace, action: HistoryAction): void {
  if (action.targetZ !== undefined) {
    space.layers.delete(action.targetZ);
    // Update bounds
    const zs = Array.from(space.layers.keys());
    if (zs.length > 0) {
      space.bounds.minZ = Math.min(...zs);
      space.bounds.maxZ = Math.max(...zs);
      space.bounds.depth = zs.length;
    }
  }
}

function redoDuplicateLayer(space: VoxelSpace, action: HistoryAction): void {
  if (action.layerData && action.targetZ !== undefined) {
    space.layers.set(action.targetZ, cloneLayer(action.layerData));
    // Update bounds
    space.bounds.minZ = Math.min(space.bounds.minZ, action.targetZ);
    space.bounds.maxZ = Math.max(space.bounds.maxZ, action.targetZ);
    space.bounds.depth = space.layers.size;
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

// Legacy functions for backward compatibility (will be removed)
/**
 * @deprecated Use logCellAction instead
 */
export function pushSnapshot(history: HistoryManager, grid: Grid): void {
  console.warn('pushSnapshot is deprecated. Use logCellAction instead.');
  // Legacy behavior - create a clear_canvas action
  // This is a placeholder to prevent breaking existing code
}
