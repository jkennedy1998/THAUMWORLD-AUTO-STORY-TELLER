// Shared ownership diagnostics for #voxel_layers_container.
//
// PlaceModule and the ASCII painter both mount world layers into the same DOM
// container. Ownership handoff is now handled explicitly at mount time by each
// module, so this helper only tracks/logs the most recent owner touch.

import { diag_log } from '../shared/diagnostics.js';

type OwnerState = {
  last_touch_ms_by_owner: Record<string, number>;
  active_owner: string | null;
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
          last_touch_log_key: null,
        } as OwnerState;
  }
  return g[GLOBAL_KEY] as OwnerState;
}

function log_world_layers_event(message: string, payload?: Record<string, unknown>): void {
  diag_log('renderer', 'important', 'WORLD_LAYERS_OWNER', message, payload);
}

export function touch_world_layers_owner(owner: string): void {
  if (!owner) return;
  const state = get_state();
  const normalized_owner = String(owner);
  state.last_touch_ms_by_owner[normalized_owner] = now_ms();
  if (state.active_owner !== normalized_owner) {
    log_world_layers_event('active world-layers owner changed', {
      previous_owner: state.active_owner,
      next_owner: normalized_owner,
    });
    state.active_owner = normalized_owner;
  }
  const touch_log_key = `${normalized_owner}:${state.active_owner}`;
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
