// Shared ownership / cleanup for #voxel_layers_container.
//
// PlaceModule is a core module and may continue running even when not visible.
// The ASCII painter can also mount world layers into the same DOM container.
//
// This helper makes "who owns the world layers right now" explicit and prevents
// stale canvases from hanging around when a mode stops drawing.

import { diag_log } from '../shared/diagnostics.js';

type OwnerState = {
  last_touch_ms_by_owner: Record<string, number>;
  active_owner: string | null;
  interval_started: boolean;
  last_hidden_skip_key: string | null;
  last_cleanup_key: string | null;
  last_touch_log_key: string | null;
};

const GLOBAL_KEY = '__thaumworld_world_layers_owner_state__';

function now_ms(): number {
  return Date.now();
}

function get_state(): OwnerState {
  const g: any = globalThis as any;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
        last_touch_ms_by_owner: {},
        active_owner: null,
        interval_started: false,
        last_hidden_skip_key: null,
        last_cleanup_key: null,
        last_touch_log_key: null,
      } as OwnerState;
  }
  return g[GLOBAL_KEY] as OwnerState;
}

function get_container(): HTMLElement | null {
  try {
    return document.getElementById('voxel_layers_container');
  } catch {
    return null;
  }
}

function choose_active_owner(state: OwnerState, ttl_ms: number): string | null {
  const t = now_ms();
  let best_owner: string | null = null;
  let best_ts = -1;
  for (const [owner, ts] of Object.entries(state.last_touch_ms_by_owner)) {
    if (!Number.isFinite(ts)) continue;
    if (t - ts > ttl_ms) continue;
    if (ts > best_ts) {
      best_ts = ts;
      best_owner = owner;
    }
  }
  return best_owner;
}

function cleanup_dom_layers(container: HTMLElement, active_owner: string | null): void {
  const nodes = Array.from(container.querySelectorAll('[data-world-layers-owner]')) as HTMLElement[];
  for (const el of nodes) {
    const owner = el.getAttribute('data-world-layers-owner');
    if (!owner) continue;
    if (!active_owner || owner !== active_owner) {
      try {
        el.remove();
      } catch {
        // ignore
      }
    }
  }
}

function log_world_layers_event(message: string, payload?: Record<string, unknown>): void {
  diag_log('renderer', 'important', 'WORLD_LAYERS_OWNER', message, payload);
}

function is_document_hidden(): boolean {
  try {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden';
  } catch {
    return false;
  }
}

function ensure_service_started(): void {
  const state = get_state();
  if (state.interval_started) return;
  state.interval_started = true;

  // Periodic cleanup is necessary because modules don't have OnHide.
  // If a mode stops drawing, it will stop calling touch_world_layers_owner().
  // We then release its DOM layers so another owner can mount cleanly.
  try {
    setInterval(() => {
      const s = get_state();
      const container = get_container();
      if (!container) return;

      if (is_document_hidden()) {
        const hidden_skip_key = JSON.stringify({
          active_owner: s.active_owner,
          owners: Object.keys(s.last_touch_ms_by_owner).sort(),
        });
        if (hidden_skip_key !== s.last_hidden_skip_key) {
          s.last_hidden_skip_key = hidden_skip_key;
          log_world_layers_event('skipping stale cleanup while document is hidden', {
            active_owner: s.active_owner,
            known_owners: Object.keys(s.last_touch_ms_by_owner).sort(),
            visibility_state: typeof document !== 'undefined' ? document.visibilityState : 'unknown',
          });
        }
        return;
      }
      s.last_hidden_skip_key = null;

      const active = choose_active_owner(s, 900);
      if (active !== s.active_owner) {
        log_world_layers_event('active world-layers owner changed', {
          previous_owner: s.active_owner,
          next_owner: active,
        });
        s.active_owner = active;
      }
      const cleanup_key = JSON.stringify({
        active_owner: s.active_owner,
        owner_count: Object.keys(s.last_touch_ms_by_owner).length,
        node_count: container.querySelectorAll('[data-world-layers-owner]').length,
      });
      if (cleanup_key !== s.last_cleanup_key) {
        s.last_cleanup_key = cleanup_key;
        log_world_layers_event('running world-layers cleanup', {
          active_owner: s.active_owner,
          owner_count: Object.keys(s.last_touch_ms_by_owner).length,
          node_count: container.querySelectorAll('[data-world-layers-owner]').length,
        });
      }
      cleanup_dom_layers(container, s.active_owner);
    }, 250);
  } catch {
    // ignore
  }
}

export function touch_world_layers_owner(owner: string): void {
  if (!owner) return;
  ensure_service_started();
  const state = get_state();
  const normalized_owner = String(owner);
  state.last_touch_ms_by_owner[normalized_owner] = now_ms();
  const touch_log_key = `${normalized_owner}:${state.active_owner ?? 'none'}`;
  if (touch_log_key !== state.last_touch_log_key) {
    state.last_touch_log_key = touch_log_key;
    log_world_layers_event('world-layers owner touched', {
      owner: normalized_owner,
      active_owner: state.active_owner,
    });
  }
}

export function get_active_world_layers_owner(): string | null {
  return get_state().active_owner;
}
