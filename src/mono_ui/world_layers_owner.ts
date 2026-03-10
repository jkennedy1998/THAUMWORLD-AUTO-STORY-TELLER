// Shared ownership / cleanup for #voxel_layers_container.
//
// PlaceModule is a core module and may continue running even when not visible.
// The ASCII painter can also mount world layers into the same DOM container.
//
// This helper makes "who owns the world layers right now" explicit and prevents
// stale canvases from hanging around when a mode stops drawing.

type OwnerState = {
  last_touch_ms_by_owner: Record<string, number>;
  active_owner: string | null;
  interval_started: boolean;
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

      const active = choose_active_owner(s, 900);
      if (active !== s.active_owner) {
        s.active_owner = active;
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
  state.last_touch_ms_by_owner[String(owner)] = now_ms();
}

export function get_active_world_layers_owner(): string | null {
  return get_state().active_owner;
}
