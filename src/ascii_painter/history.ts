/**
 * ASCII Painter History Management
 * 
 * Undo/redo functionality for the painter.
 */

import type { Grid, HistorySnapshot } from './types.js';
import { cloneGrid } from './types.js';

export interface HistoryManager {
  /** Maximum number of snapshots to keep */
  max_history: number;
  
  /** Current position in history */
  current_index: number;
  
  /** All snapshots */
  snapshots: HistorySnapshot[];
}

/**
 * Create a new history manager
 */
export function createHistoryManager(max_history: number = 50): HistoryManager {
  return {
    max_history,
    current_index: -1,
    snapshots: []
  };
}

/**
 * Push a new snapshot to history
 * Clears any redo history after current position
 */
export function pushSnapshot(history: HistoryManager, grid: Grid): void {
  // Remove any snapshots after current index (redo history)
  if (history.current_index < history.snapshots.length - 1) {
    history.snapshots = history.snapshots.slice(0, history.current_index + 1);
  }
  
  // Add new snapshot
  const snapshot: HistorySnapshot = {
    cells: cloneGrid(grid).cells,
    timestamp: Date.now()
  };
  
  history.snapshots.push(snapshot);
  history.current_index++;
  
  // Remove oldest if exceeding max
  if (history.snapshots.length > history.max_history) {
    history.snapshots.shift();
    history.current_index--;
  }
}

/**
 * Undo: go back one step in history
 * Returns true if successful
 */
export function undo(history: HistoryManager, grid: Grid): boolean {
  if (!canUndo(history)) {
    return false;
  }
  
  history.current_index--;
  const snapshot = history.snapshots[history.current_index];
  
  if (!snapshot) {
    return false;
  }
  
  // Restore grid from snapshot
  grid.cells = snapshot.cells.map(row => 
    row.map(cell => ({ ...cell }))
  );
  
  return true;
}

/**
 * Redo: go forward one step in history
 * Returns true if successful
 */
export function redo(history: HistoryManager, grid: Grid): boolean {
  if (!canRedo(history)) {
    return false;
  }
  
  history.current_index++;
  const snapshot = history.snapshots[history.current_index];
  
  if (!snapshot) {
    return false;
  }
  
  // Restore grid from snapshot
  grid.cells = snapshot.cells.map(row => 
    row.map(cell => ({ ...cell }))
  );
  
  return true;
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
  return history.current_index < history.snapshots.length - 1;
}

/**
 * Get current history state for display
 */
export function getHistoryState(history: HistoryManager): {
  can_undo: boolean;
  can_redo: boolean;
  total_snapshots: number;
  current_position: number;
} {
  return {
    can_undo: canUndo(history),
    can_redo: canRedo(history),
    total_snapshots: history.snapshots.length,
    current_position: history.current_index + 1
  };
}

/**
 * Clear all history
 */
export function clearHistory(history: HistoryManager): void {
  history.snapshots = [];
  history.current_index = -1;
}
