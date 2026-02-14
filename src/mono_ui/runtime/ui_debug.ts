// Global UI debug state for the renderer.
//
// Intent:
// - One toggle enables/disables debug affordances across modules.
// - Modules can read UI_DEBUG.enabled and conditionally expose debug UI.

type Listener = (enabled: boolean) => void;

export const UI_DEBUG = {
  enabled: false,
} as const;

const listeners = new Set<Listener>();

export function set_ui_debug_enabled(enabled: boolean): void {
  (UI_DEBUG as any).enabled = enabled;
  for (const fn of listeners) {
    try {
      fn(enabled);
    } catch {
      // ignore listener errors
    }
  }
}

export function toggle_ui_debug(): boolean {
  const next = !(UI_DEBUG as any).enabled;
  set_ui_debug_enabled(next);
  return next;
}

export function on_ui_debug_change(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
