/**
 * Module Position Storage
 * 
 * Handles saving and loading module positions using slot-backed storage with a local cache.
 */

import type { Rect } from '../mono_ui/types.js';
import { get_module_layout_state, load_module_layouts, rect_to_layout_data, reset_module_layouts, save_module_layouts, type ModulePositions, type ModuleVisibility } from '../mono_ui/runtime/module_layout_store.js';
import type { CameraSettingsAppId } from '../mono_ui/runtime/camera_limits.js';

const STORAGE_KEY = 'painter_module_positions_cache';
const VISIBILITY_STORAGE_KEY = 'painter_module_visibility_cache';

let current_slot = 1;
let current_app: CameraSettingsAppId = 'thaum_painter';
let positions_cache: ModulePositions = {};
let visibility_cache: ModuleVisibility = {};

function sync_cache_from_local_storage(): void {
  try {
    const pos_data = localStorage.getItem(STORAGE_KEY);
    positions_cache = pos_data ? JSON.parse(pos_data) as ModulePositions : {};
  } catch {
    positions_cache = {};
  }
  try {
    const vis_data = localStorage.getItem(VISIBILITY_STORAGE_KEY);
    visibility_cache = vis_data ? JSON.parse(vis_data) as ModuleVisibility : {};
  } catch {
    visibility_cache = {};
  }
}

function sync_local_storage_from_cache(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(positions_cache));
    localStorage.setItem(VISIBILITY_STORAGE_KEY, JSON.stringify(visibility_cache));
  } catch {
    // ignore cache write failures
  }
}

export function initModuleLayoutPersistence(slot: number, app: CameraSettingsAppId): void {
  current_slot = slot;
  current_app = app;
  sync_cache_from_local_storage();
  void load_module_layouts(slot, app).then((state) => {
    positions_cache = state.positions;
    visibility_cache = state.visibility;
    sync_local_storage_from_cache();
  }).catch(() => null);
}

function persist_layout_state(): void {
  sync_local_storage_from_cache();
  void save_module_layouts(current_slot, current_app, {
    positions: positions_cache,
    visibility: visibility_cache,
  }).catch(() => null);
}

/**
 * Save module positions to localStorage
 */
export function saveModulePositions(positions: ModulePositions): void {
  positions_cache = positions;
  persist_layout_state();
}

/**
 * Load module positions from localStorage
 */
export function loadModulePositions(): ModulePositions {
  return { ...positions_cache };
}

/**
 * Save a single module position
 */
export function saveModulePosition(moduleId: string, rect: Rect): void {
  positions_cache[moduleId] = rect_to_layout_data(rect);
  persist_layout_state();
}

/**
 * Get a single module position
 */
export function getModulePosition(moduleId: string): Rect | null {
  const pos = positions_cache[moduleId];
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
  positions_cache = {};
  visibility_cache = {};
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(VISIBILITY_STORAGE_KEY);
  } catch {
    // ignore cache clear failures
  }
  void reset_module_layouts(current_slot, current_app).catch(() => null);
}

export function saveModuleVisibilityState(visibility: ModuleVisibility): void {
  visibility_cache = visibility;
  persist_layout_state();
}

export function loadModuleVisibilityState(): ModuleVisibility {
  return { ...visibility_cache };
}

export function saveModuleVisibility(moduleId: string, visible: boolean): void {
  visibility_cache[moduleId] = visible;
  persist_layout_state();
}

export function getModuleVisibility(moduleId: string): boolean | null {
  if (moduleId in visibility_cache) {
    return visibility_cache[moduleId] ?? false;
  }
  return null;
}

export function clearModuleVisibilityState(): void {
  visibility_cache = {};
  persist_layout_state();
}
