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
  | 'offset_group_in_time'
  | 'set_group_timing'
  | 'set_group_breath_span'
  | 'set_group_raster_segment_length'
  | 'split_group_raster_segment'
  | 'swap_group_raster_segments'
  | 'set_group_content_state'
  | 'set_group_location_key'
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

export interface GroupHistoryStack {
  undo: HistoryAction[];
  redo: HistoryAction[];
}

export interface HistoryManager {
  max_history: number;
  current_index: number;
  actions: HistoryAction[];
  group_histories: Map<string, GroupHistoryStack>;
  
  // Batch tracking for continuous operations
  isBatching: boolean;
  batchAction: HistoryAction | null;
  group_batch_actions: Map<string, HistoryAction>;
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
    group_histories: new Map<string, GroupHistoryStack>(),
    isBatching: false,
    batchAction: null,
    group_batch_actions: new Map<string, HistoryAction>(),
    batchTimeout: null
  };
}

export function getGroupHistory(history: HistoryManager, group_id: string): GroupHistoryStack {
  const key = String(group_id ?? '').trim();
  if (!key) throw new Error('history_group_id_required');
  const existing = history.group_histories.get(key);
  if (existing) return existing;
  const created: GroupHistoryStack = { undo: [], redo: [] };
  history.group_histories.set(key, created);
  return created;
}

function pushGroupUndoAction(history: HistoryManager, group_id: string, action: HistoryAction): void {
  const groupHistory = getGroupHistory(history, group_id);
  groupHistory.undo.push(action);
  groupHistory.redo = [];
  if (groupHistory.undo.length > history.max_history) {
    groupHistory.undo.shift();
  }
}

function cloneHistoryAction(action: HistoryAction): HistoryAction {
  return {
    ...action,
    cellChanges: action.cellChanges?.map((c) => ({
      x: c.x,
      y: c.y,
      worldX: c.worldX,
      worldY: c.worldY,
      worldZ: c.worldZ,
      group_id: c.group_id,
      oldCell: cloneCell(c.oldCell),
      newCell: cloneCell(c.newCell),
    })),
    selectionChange: action.selectionChange ? {
      oldBitmap: cloneSelectionBitmap(action.selectionChange.oldBitmap),
      newBitmap: cloneSelectionBitmap(action.selectionChange.newBitmap),
    } : undefined,
    oldGroupData: action.oldGroupData ? clonePainterGroup(action.oldGroupData) : undefined,
    newGroupData: action.newGroupData ? clonePainterGroup(action.newGroupData) : undefined,
    oldGroupOrder: action.oldGroupOrder ? [...action.oldGroupOrder] : undefined,
    newGroupOrder: action.newGroupOrder ? [...action.newGroupOrder] : undefined,
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
    content_states: group.content_states.map((state) => ({
      ...state,
      content: state.content.map((voxel) => ({
        ...voxel,
        rgb: { ...voxel.rgb },
      })),
    })),
    location_base: { ...group.location_base },
    location_keys: group.location_keys.map((key) => ({
      breath: key.breath,
      offset: { ...key.offset },
    })),
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
  const normalized_group_id = String(options.group_id ?? '').trim();
  if (!normalized_group_id) return;
  const action: HistoryAction = {
    id: generateActionId(),
    type,
    description: `${description} (${changes.length} cell${changes.length !== 1 ? 's' : ''})`,
    z: options.z,
    group_id: normalized_group_id,
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
  pushGroupUndoAction(history, normalized_group_id, action);
}

export function logGroupCellAction(
  history: HistoryManager,
  type: 'draw_cells' | 'erase_cells' | 'fill' | 'paste' | 'clear_canvas',
  description: string,
  options: { z?: number; group_id: string },
  changes: CellChange[]
): void {
  logCellAction(history, type, description, options, changes);
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
  type: 'create_group' | 'delete_group' | 'duplicate_group' | 'rename_group' | 'set_group_visibility' | 'set_group_locked' | 'offset_group_in_time' | 'set_group_timing' | 'set_group_breath_span' | 'set_group_raster_segment_length' | 'split_group_raster_segment' | 'swap_group_raster_segments' | 'set_group_content_state' | 'set_group_location_key' | 'reorder_groups',
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

  const historyGroupId = String(options.groupId ?? options.targetGroupId ?? options.sourceGroupId ?? '').trim();
  if (historyGroupId) {
    pushGroupUndoAction(history, historyGroupId, cloneHistoryAction(action));
  }

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
  const normalized_group_id = String(options.group_id ?? '').trim();
  if (!normalized_group_id) return;
  const existing = history.group_batch_actions.get(normalized_group_id);
  if (existing) {
    endBatch(history, normalized_group_id);
  }
  const action: HistoryAction = {
    id: generateActionId(),
    type,
    description,
    z: options.z,
    group_id: normalized_group_id,
    timestamp: Date.now(),
    cellChanges: []
  };
  history.group_batch_actions.set(normalized_group_id, action);
  history.isBatching = history.group_batch_actions.size > 0;
  history.batchAction = action;
}

export function startGroupBatch(history: HistoryManager, type: ActionType, description: string, options: { z?: number; group_id: string }): void {
  startBatch(history, type, description, options);
}

/**
 * Add a cell change to current batch
 */
export function addToBatch(history: HistoryManager, change: CellChange): void {
  const normalized_group_id = String(change.group_id ?? '').trim();
  if (!normalized_group_id) return;
  const batchAction = history.group_batch_actions.get(normalized_group_id);
  if (!batchAction) return;
  
  // Check if this cell already has a change in the batch
  const existingIndex = batchAction.cellChanges!.findIndex(
    c => c.worldX === change.worldX && c.worldY === change.worldY && c.worldZ === change.worldZ
  );
  
  if (existingIndex >= 0) {
    // Update the existing change's newCell, keep oldCell
    batchAction.cellChanges![existingIndex]!.newCell = cloneCell(change.newCell);
  } else {
    // Add new change
    batchAction.cellChanges!.push({
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

export function addToGroupBatch(history: HistoryManager, change: CellChange): void {
  addToBatch(history, change);
}

/**
 * End batching and commit the action
 */
export function endBatch(history: HistoryManager, group_id?: string): void {
  const normalized_group_id = String(group_id ?? '').trim();
  if (normalized_group_id) {
    const batchAction = history.group_batch_actions.get(normalized_group_id);
    if (!batchAction) return;
    if (batchAction.cellChanges && batchAction.cellChanges.length > 0) {
      const count = batchAction.cellChanges.length;
      batchAction.description = `${batchAction.description} (${count} cell${count !== 1 ? 's' : ''})`;
      pushGroupUndoAction(history, normalized_group_id, cloneHistoryAction(batchAction));
    }
    history.group_batch_actions.delete(normalized_group_id);
    history.isBatching = history.group_batch_actions.size > 0;
    history.batchAction = history.group_batch_actions.values().next().value ?? null;
    return;
  }
  for (const next_group_id of Array.from(history.group_batch_actions.keys())) {
    endBatch(history, next_group_id);
  }
}

export function endGroupBatch(history: HistoryManager, group_id?: string): void {
  endBatch(history, group_id);
}

/**
 * Cancel current batch without committing
 */
export function cancelBatch(history: HistoryManager, group_id?: string): void {
  const normalized_group_id = String(group_id ?? '').trim();
  if (normalized_group_id) {
    history.group_batch_actions.delete(normalized_group_id);
  } else {
    history.group_batch_actions.clear();
  }
  history.isBatching = history.group_batch_actions.size > 0;
  history.batchAction = history.group_batch_actions.values().next().value ?? null;
}

export function cancelGroupBatch(history: HistoryManager, group_id?: string): void {
  cancelBatch(history, group_id);
}

export function canUndoGroup(history: HistoryManager, group_id: string): boolean {
  return getGroupHistory(history, group_id).undo.length > 0;
}

export function canRedoGroup(history: HistoryManager, group_id: string): boolean {
  return getGroupHistory(history, group_id).redo.length > 0;
}

export function popUndoGroupAction(history: HistoryManager, group_id: string): HistoryAction | null {
  const groupHistory = getGroupHistory(history, group_id);
  const action = groupHistory.undo.pop() ?? null;
  if (!action) return null;
  groupHistory.redo.push(cloneHistoryAction(action));
  return cloneHistoryAction(action);
}

export function popRedoGroupAction(history: HistoryManager, group_id: string): HistoryAction | null {
  const groupHistory = getGroupHistory(history, group_id);
  const action = groupHistory.redo.pop() ?? null;
  if (!action) return null;
  groupHistory.undo.push(cloneHistoryAction(action));
  return cloneHistoryAction(action);
}

export function getGroupHistoryState(history: HistoryManager, group_id: string): {
  can_undo: boolean;
  can_redo: boolean;
  total_actions: number;
  current_position: number;
  last_action: string | null;
} {
  const groupHistory = getGroupHistory(history, group_id);
  const lastAction = groupHistory.undo[groupHistory.undo.length - 1]?.description ?? null;
  return {
    can_undo: groupHistory.undo.length > 0,
    can_redo: groupHistory.redo.length > 0,
    total_actions: groupHistory.undo.length + groupHistory.redo.length,
    current_position: groupHistory.undo.length,
    last_action: lastAction,
  };
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
  history.group_histories.clear();
  history.isBatching = false;
  history.batchAction = null;
  history.group_batch_actions.clear();
  if (history.batchTimeout) {
    clearTimeout(history.batchTimeout);
    history.batchTimeout = null;
  }
}
