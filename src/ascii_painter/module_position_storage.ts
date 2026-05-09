/**
 * Module Position Storage
 * 
 * Transitional painter adapter over the shared module layout store.
 */

import type { Rect } from '../mono_ui/types.js';
import {
  get_module_layout_state,
  load_active_module_layout,
  rect_to_layout_data,
  reset_active_module_layout,
  save_active_module_layout,
  type ModulePositions,
  type ModuleVisibility,
} from '../mono_ui/runtime/module_layout_store.js';
import type { CameraSettingsAppId } from '../mono_ui/runtime/camera_limits.js';
import type { ProfileScope } from '../user_profiles/profile_scope.js';

const STORAGE_KEY = 'painter_module_positions_cache';
const VISIBILITY_STORAGE_KEY = 'painter_module_visibility_cache';

let current_slot = 1;
let current_app: CameraSettingsAppId = 'thaum_painter';
let current_profile_scope: ProfileScope | null = null;
let positions_cache: ModulePositions = {};
let visibility_cache: ModuleVisibility = {};

function clear_legacy_local_storage_cache(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(VISIBILITY_STORAGE_KEY);
  } catch {
    // ignore cache clear failures
  }
}

export function initModuleLayoutPersistence(
  slot: number,
  app: CameraSettingsAppId,
  opts?: {
    get_profile_scope?: () => ProfileScope | null;
    profile_scope_ready?: Promise<ProfileScope> | null;
    on_layout_loaded?: (state: { positions: ModulePositions; visibility: ModuleVisibility }) => void;
  },
): void {
  current_slot = slot;
  current_app = app;
  current_profile_scope = opts?.get_profile_scope?.() ?? null;
  clear_legacy_local_storage_cache();
  const sync_from_store = (profile_scope?: ProfileScope | null): void => {
    if (profile_scope) current_profile_scope = profile_scope;
    void load_active_module_layout(slot, app, profile_scope ?? current_profile_scope).then((state) => {
      positions_cache = state.positions;
      visibility_cache = state.visibility;
      opts?.on_layout_loaded?.(state);
    }).catch(() => null);
  };
  sync_from_store(current_profile_scope);
  void opts?.profile_scope_ready?.then((profile_scope) => {
    sync_from_store(profile_scope);
  }).catch(() => null);
}

function persist_layout_state(): void {
  void save_active_module_layout(current_slot, current_app, {
    positions: positions_cache,
    visibility: visibility_cache,
  }, current_profile_scope).catch(() => null);
}

export function getCachedModuleLayoutState(): { positions: ModulePositions; visibility: ModuleVisibility } {
  return get_module_layout_state(current_app);
}

export function saveModulePositions(positions: ModulePositions): void {
  positions_cache = positions;
  persist_layout_state();
}

export function loadModulePositions(): ModulePositions {
  return { ...positions_cache };
}

export function saveModulePosition(moduleId: string, rect: Rect): void {
  positions_cache[moduleId] = rect_to_layout_data(rect);
  persist_layout_state();
}

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

export function clearModulePositions(): void {
  positions_cache = {};
  visibility_cache = {};
  clear_legacy_local_storage_cache();
  void reset_active_module_layout(current_slot, current_app, current_profile_scope).catch(() => null);
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
