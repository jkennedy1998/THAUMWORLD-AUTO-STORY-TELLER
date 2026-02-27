/**
 * Module Position Storage
 * 
 * Handles saving and loading module positions to localStorage.
 */

import type { Rect } from '../mono_ui/types.js';

const STORAGE_KEY = 'painter_module_positions';

export type ModulePositionData = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type ModulePositions = {
  [moduleId: string]: ModulePositionData;
};

/**
 * Save module positions to localStorage
 */
export function saveModulePositions(positions: ModulePositions): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
  } catch (e) {
    console.warn('Failed to save module positions:', e);
  }
}

/**
 * Load module positions from localStorage
 */
export function loadModulePositions(): ModulePositions {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (data) {
      return JSON.parse(data) as ModulePositions;
    }
  } catch (e) {
    console.warn('Failed to load module positions:', e);
  }
  return {};
}

/**
 * Save a single module position
 */
export function saveModulePosition(moduleId: string, rect: Rect): void {
  const positions = loadModulePositions();
  positions[moduleId] = {
    x0: rect.x0,
    y0: rect.y0,
    x1: rect.x1,
    y1: rect.y1,
  };
  saveModulePositions(positions);
}

/**
 * Get a single module position
 */
export function getModulePosition(moduleId: string): Rect | null {
  const positions = loadModulePositions();
  const pos = positions[moduleId];
  if (pos) {
    return {
      x0: pos.x0,
      y0: pos.y0,
      x1: pos.x1,
      y1: pos.y1,
    };
  }
  return null;
}

/**
 * Clear all module positions
 */
export function clearModulePositions(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('Failed to clear module positions:', e);
  }
}
