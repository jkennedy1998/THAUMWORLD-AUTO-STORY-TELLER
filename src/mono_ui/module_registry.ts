import type { Module, Rect } from "./types.js";
import { debug_log } from "../shared/debug.js";

export type ModuleRegistryChangeType =
  | "added"
  | "removed"
  | "position_changed"
  | "visibility_changed"
  | "z_order_changed";

export type ModuleRegistryChange = {
  type: ModuleRegistryChangeType;
  module_id: string;
  module?: Module;
};

export type ModuleRegistryListener = (change: ModuleRegistryChange) => void;

export interface ModuleRegistry {
  // Core operations
  register(module: Module): void;
  unregister(module_id: string): boolean;
  get(module_id: string): Module | undefined;
  get_all(): readonly Module[];
  has(module_id: string): boolean;

  // Position management - returns new module since rect is immutable
  update_position(module_id: string, new_rect: Rect): Module | undefined;
  get_position(module_id: string): Rect | undefined;

  // Z-order
  bring_to_front(module_id: string): boolean;

  // Visibility
  set_visibility(module_id: string, visible: boolean): boolean;
  is_visible(module_id: string): boolean;

  // Event subscription
  subscribe(listener: ModuleRegistryListener): () => void;

  // Batch operations
  clear(): void;
}

export function create_module_registry(): ModuleRegistry {
  const modules = new Map<string, Module>();
  const positions = new Map<string, Rect>();
  const visibility = new Map<string, boolean>();
  const listeners: ModuleRegistryListener[] = [];

  function notify(change: ModuleRegistryChange): void {
    for (const listener of listeners) {
      try {
        listener(change);
      } catch (err) {
        debug_log("[ModuleRegistry] Listener error:", err);
      }
    }
  }

  return {
    register(module: Module): void {
      if (modules.has(module.id)) {
        debug_log(
          `[ModuleRegistry] Warning: Module ${module.id} already exists, replacing`
        );
      }
      modules.set(module.id, module);
      positions.set(module.id, module.rect);
      visibility.set(module.id, true);
      debug_log(`[ModuleRegistry] Registered module: ${module.id}`);
      notify({ type: "added", module_id: module.id, module });
    },

    unregister(module_id: string): boolean {
      const module = modules.get(module_id);
      if (!module) {
        debug_log(`[ModuleRegistry] Warning: Module ${module_id} not found`);
        return false;
      }
      modules.delete(module_id);
      positions.delete(module_id);
      visibility.delete(module_id);
      debug_log(`[ModuleRegistry] Unregistered module: ${module_id}`);
      notify({ type: "removed", module_id });
      return true;
    },

    get(module_id: string): Module | undefined {
      return modules.get(module_id);
    },

    get_all(): readonly Module[] {
      return Array.from(modules.values());
    },

    has(module_id: string): boolean {
      return modules.has(module_id);
    },

    update_position(module_id: string, new_rect: Rect): Module | undefined {
      const old_module = modules.get(module_id);
      if (!old_module) {
        debug_log(
          `[ModuleRegistry] Warning: Cannot update position for ${module_id}, module not found`
        );
        return undefined;
      }

      // Since rect is immutable in the Module type and captured in closure scope,
      // we need to create a new module with the updated rect.
      // This requires the module factory to be stored, which we don't have.
      // For now, we'll update the position tracking but note that the module
      // won't actually move until it's recreated.
      positions.set(module_id, new_rect);
      debug_log(
        `[ModuleRegistry] Updated position for ${module_id}: (${new_rect.x0},${new_rect.y0})-(${new_rect.x1},${new_rect.y1})`
      );
      notify({ type: "position_changed", module_id });

      // Return the old module - caller needs to handle recreation
      return old_module;
    },

    get_position(module_id: string): Rect | undefined {
      return positions.get(module_id);
    },

    bring_to_front(module_id: string): boolean {
      const module = modules.get(module_id);
      if (!module) return false;
      modules.delete(module_id);
      modules.set(module_id, module);
      debug_log(`[ModuleRegistry] Brought module to front: ${module_id}`);
      notify({ type: "z_order_changed", module_id, module });
      return true;
    },

    set_visibility(module_id: string, visible: boolean): boolean {
      if (!modules.has(module_id)) {
        return false;
      }
      const old_visible = visibility.get(module_id) ?? true;
      visibility.set(module_id, visible);
      if (old_visible !== visible) {
        debug_log(
          `[ModuleRegistry] Visibility changed for ${module_id}: ${visible}`
        );
        notify({ type: "visibility_changed", module_id });
      }
      return true;
    },

    is_visible(module_id: string): boolean {
      return visibility.get(module_id) ?? true;
    },

    subscribe(listener: ModuleRegistryListener): () => void {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index !== -1) {
          listeners.splice(index, 1);
        }
      };
    },

    clear(): void {
      const module_ids = Array.from(modules.keys());
      modules.clear();
      positions.clear();
      visibility.clear();
      for (const module_id of module_ids) {
        notify({ type: "removed", module_id });
      }
      debug_log(`[ModuleRegistry] Cleared all modules`);
    },
  };
}

// Factory function for creating module configs with position tracking
export type ModuleFactory<TConfig> = (
  config: TConfig & { rect: Rect }
) => Module;

export interface PositionedModuleConfig {
  id: string;
  rect: Rect;
}

// Helper to check if a point is within a module's rect
export function is_point_in_module(
  module: Module,
  x: number,
  y: number
): boolean {
  return x >= module.rect.x0 && x <= module.rect.x1 && y >= module.rect.y0 && y <= module.rect.y1;
}

// Helper to find module at position (topmost first)
export function find_module_at_position(
  modules: readonly Module[],
  x: number,
  y: number
): Module | undefined {
  // Iterate in reverse to find topmost module first
  for (let i = modules.length - 1; i >= 0; i--) {
    const module = modules[i]!;
    if (module && is_point_in_module(module, x, y)) {
      return module;
    }
  }
  return undefined;
}
