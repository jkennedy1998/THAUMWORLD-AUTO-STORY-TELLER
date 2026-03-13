/**
 * Unified Movement Engine
 * 
 * Shared movement system for all entities (actors and NPCs).
 * Features:
 * - Per-entity speeds based on kind stats
 * - Step-based architecture (for future timed interactions)
 * - Shared pathfinding
 * - Smooth interpolation
 * - Failed path visualization
 */

import type { Place, TilePosition } from "../types/place.js";
import { find_path, type PathResult } from "./pathfinding.js";
import { debug_log, DEBUG_LEVEL } from "./debug.js";
import { get_facing, update_facing_on_move } from "../npc_ai/facing_system.js";
import { can_place_volume, type OwnerRef } from "../place_storage/movement_legality.js";
import { process_witness_movement, calculate_movement_detectability, emit_move_perception_batch } from "../npc_ai/movement_perception.js";
import { init_movement_state as init_npc_movement_state, set_goal as set_npc_goal, type Goal as NPCGoal } from "../npc_ai/movement_state.js";

// Default speed: 300 tiles per minute (5 tiles per second = 200ms per tile)
// Faster for better gameplay feel
const DEFAULT_SPEED_TPM = 300;

// Convert tiles per minute to milliseconds per tile
function tpm_to_mspt(tiles_per_minute: number): number {
  if (tiles_per_minute <= 0) return 15000; // Default 15s per tile
  return (60 * 1000) / tiles_per_minute; // ms per tile
}

/** Types of movement goals */
export type MovementGoalType = 
  | "move_to"      // Go to specific tile
  | "follow"       // Follow target entity
  | "wander"       // Random exploration
  | "patrol"       // Patrol route
  | "flee";        // Run away

/** A movement goal */
export type MovementGoal = {
  type: MovementGoalType;
  target_position?: TilePosition;
  target_entity?: string;
  priority: number;
  reason: string;
};

/** Movement state for any entity */
export type EntityMovementState = {
  entity_ref: string;
  entity_type: "actor" | "npc";
  
  // Current movement
  goal: MovementGoal | null;
  path: Array<TilePosition & { z?: number }>;
  path_index: number;
  is_moving: boolean;
  
  // Timing (step-based)
  speed_tpm: number;           // Tiles per minute
  ms_per_tile: number;         // Calculated from speed
  last_step_time: number;      // Timestamp of last step
  next_step_time: number;      // When next step should occur

  // Breath scheduling (server authoritative cadence)
  breaths_per_step: number;
  next_breath: number;

  // Diagnostics: detect breath-gate stalls.
  last_seen_place_breath?: number;
  breath_gate_stall_count?: number;
  last_breath_gate_log_ms?: number;
  
  // Step counter (for beat/tick system)
  step_count: number;
  total_distance: number;
  
  // Visual
  show_path: boolean;
  path_color: "white" | "red"; // Red for blocked/failed paths
  
  // Status
  blocked_since?: number;
  failed_path?: boolean;

  // Allow stepping into unsupported space (walk-off-ledge) for this movement.
  allow_unsupported?: boolean;

  // Realtime held-input stepping (WASD): persistent 1-step loop.
  // When set, the engine will continuously attempt cardinal steps at cadence.
  realtime_intent?: { dx: number; dy: number } | null;

  // Realtime diagnostics: quantify blocked attempts (helps explain slower-feeling WASD).
  realtime_blocked_attempts?: number;
  realtime_blocked_by_reason?: Record<string, number>;
  realtime_blocked_last_log_ms?: number;

  // Scheduling diagnostics: detect "missed breath" behavior and drift.
  diag_step_fires?: number;
  diag_overshoot_events?: number;
  diag_overshoot_sum?: number;
  diag_overshoot_max?: number;
  diag_last_step_log_ms?: number;
  
  // Callback when complete - receives final position
  on_complete?: (final_position: TilePosition & { z?: number }) => void;
  
  // Callback on each step - receives current position
  on_step?: (position: TilePosition & { z?: number }) => void;
};

// Engine-wide scheduling diagnostics.
const engine_diag = {
  last_tick_ms: 0,
  last_global_log_ms: 0,
  late_ms_max: 0,
};

type StepResult = {
  ok: boolean;
  blocked_check?: any;
};

export type RealtimeMovementParams = {
  dx: number;
  dy: number;
  breaths_per_step: number;
  speed_tpm: number;
  allow_unsupported?: boolean;
  on_step?: (position: TilePosition & { z?: number }) => void;
};

export function set_entity_realtime_movement(
  entity_ref: string,
  entity_type: "actor" | "npc",
  place: Place,
  params: RealtimeMovementParams | null
): void {
  if (!params) {
    const st = movement_states.get(entity_ref);
    if (st && st.realtime_intent) {
      try {
        const payload = {
          entity_ref,
          entity_type: st.entity_type,
          place_id: (place as any)?.id,
          reason: 'api_stop',
        };
        debug_log('MOVE_UNIFY_TEST', `realtime stop ${JSON.stringify(payload)}`);
      } catch {
        // ignore
      }
      movement_states.delete(entity_ref);
    }
    return;
  }

  const dx = Math.floor(Number(params.dx) || 0);
  const dy = Math.floor(Number(params.dy) || 0);
  const breaths_per_step = Math.max(1, Math.floor(Number(params.breaths_per_step) || 1));
  const speed_tpm = Number(params.speed_tpm) || DEFAULT_SPEED_TPM;

  const place_breath = Math.floor(Number((place as any)?.breath_index ?? 0)) || 0;
  const now = Date.now();

  const cur = get_entity_position(place, entity_ref, entity_type);
  if (!cur) return;

  const next: TilePosition = { x: Math.floor(cur.x) + dx, y: Math.floor(cur.y) + dy };

  const existing = movement_states.get(entity_ref);
  if (existing && existing.realtime_intent) {
    existing.realtime_intent = { dx, dy };
    existing.allow_unsupported = !!params.allow_unsupported;
    if (typeof params.on_step === 'function') {
      existing.on_step = params.on_step as any;
    }
    existing.breaths_per_step = breaths_per_step;
    existing.speed_tpm = speed_tpm;
    existing.ms_per_tile = breaths_per_step * BREATH_MS;
    existing.next_step_time = now + existing.ms_per_tile;

    // If idle (or completing), ensure we have a valid next target.
    if (existing.path_index >= existing.path.length) {
      existing.path = [next];
      existing.path_index = 0;
      existing.is_moving = true;
      existing.next_breath = place_breath + breaths_per_step;
    }
    return;
  }

  try {
    const payload = {
      entity_ref,
      entity_type,
      place_id: (place as any)?.id,
      intent: { dx, dy },
      breaths_per_step,
      next_breath: place_breath + breaths_per_step,
    };
    debug_log('MOVE_UNIFY_TEST', `realtime start ${JSON.stringify(payload)}`);
  } catch {
    // ignore
  }

  const state: EntityMovementState = {
    entity_ref,
    entity_type,
    goal: { type: "move_to", target_position: next, priority: 100, reason: "Realtime intent" },
    path: [next],
    path_index: 0,
    is_moving: true,
    speed_tpm,
    ms_per_tile: breaths_per_step * BREATH_MS,
    last_step_time: now,
    next_step_time: now + (breaths_per_step * BREATH_MS),
    breaths_per_step,
    next_breath: place_breath + breaths_per_step,
    step_count: 0,
    total_distance: 1,
    show_path: false,
    path_color: "white",
    failed_path: false,
    allow_unsupported: !!params.allow_unsupported,
    realtime_intent: { dx, dy },
    on_step: typeof params.on_step === 'function' ? (params.on_step as any) : undefined,
  };

  movement_states.set(entity_ref, state);
}

/**
 * Update realtime movement direction WITHOUT resetting interpolation timing.
 * Use this when polling input every frame - it only changes the direction
 * that will be used on the next eligible step, without perturbing cadence.
 */
export function update_realtime_intent(
  entity_ref: string,
  dx: number,
  dy: number,
  on_step?: (position: TilePosition & { z?: number }) => void
): void {
  const existing = movement_states.get(entity_ref);
  if (!existing || !existing.realtime_intent) return;

  const prev = existing.realtime_intent;
  const changed = (prev.dx !== dx) || (prev.dy !== dy);

  // Just update direction - don't touch timing
  existing.realtime_intent = { dx, dy };
  if (typeof on_step === 'function') {
    existing.on_step = on_step;
  }

  if (changed) {
    try {
      const payload = {
        entity_ref,
        entity_type: existing.entity_type,
        intent: { dx, dy },
      };
      debug_log('MOVE_UNIFY_TEST', `realtime intent ${JSON.stringify(payload)}`);
    } catch {
      // ignore
    }
  }

  // If idle (path complete), seed a new 1-step path in the new direction
  if (existing.path_index >= existing.path.length) {
    const place = find_entity_place(entity_ref);
    if (place) {
      const cur = get_entity_position(place, entity_ref, existing.entity_type);
      if (cur) {
        existing.path = [{ x: Math.floor(cur.x) + dx, y: Math.floor(cur.y) + dy }];
        existing.path_index = 0;
        existing.is_moving = true;
        // Don't reset next_breath here - let it ride
      }
    }
  }
}


export function start_entity_step(
  entity_ref: string,
  entity_type: "actor" | "npc",
  place: Place,
  delta: { dx: number; dy: number },
  speed_tpm: number = DEFAULT_SPEED_TPM,
  opts?: { allow_unsupported?: boolean },
  on_complete?: (final_position: TilePosition) => void,
  on_step?: (position: TilePosition) => void,
): boolean {
  const current_pos = get_entity_position(place, entity_ref, entity_type);
  if (!current_pos) {
    debug_log("MovementEngine", `${entity_ref} not found in place`);
    return false;
  }

  const next: TilePosition & { z?: number } = {
    x: Math.floor(current_pos.x) + Math.floor(Number(delta?.dx ?? 0)),
    y: Math.floor(current_pos.y) + Math.floor(Number(delta?.dy ?? 0)),
  };

  // Pre-check legality for the direct step.
  try {
    const bz = Math.floor(Number((place as any)?.coordinates?.elevation ?? 0)) || 0;
    const owner: OwnerRef = { kind: entity_type, id: entity_ref } as any;
    const z0 = (() => {
      if (entity_type === "actor") {
        const a0: any = place.contents.actors_present.find(a => a.actor_ref === entity_ref);
        if (a0 && typeof a0.elevation === "number" && Number.isFinite(a0.elevation)) return Math.floor(a0.elevation);
      } else {
        const n0: any = place.contents.npcs_present.find(n => n.npc_ref === entity_ref);
        if (n0 && typeof n0.elevation === "number" && Number.isFinite(n0.elevation)) return Math.floor(n0.elevation);
      }
      return bz;
    })();

    const check = can_place_volume(place, owner, { x: next.x, y: next.y, z: z0 }, "WALK", {
      exclude_owner: owner,
      support_policy: "any_footprint",
      allow_unsupported: !!opts?.allow_unsupported,
    });
    if (!check.ok) {
      debug_log("MOVE_UNIFY_TEST", `manual step blocked entity=${entity_ref} reason=${check.reason}`, {
        entity_ref,
        entity_type,
        target: { x: next.x, y: next.y, z: z0 },
        ...check,
      });

      try {
        const part = String((check as any)?.detail?.blocked_part ?? '');
        if (part === 'head') {
          debug_log('MOVE_UNIFY_TEST', 'PASS head voxel blocks movement', { entity_ref, target: { x: next.x, y: next.y, z: z0 }, check });
        }
      } catch {
        // ignore
      }
      return false;
    }
  } catch (err) {
    debug_log("MOVE_UNIFY_TEST", `FAIL manual step legality threw ${entity_ref}`, { err: String(err) });
    return false;
  }

  const place_breath = Math.floor(Number((place as any)?.breath_index ?? 0)) || 0;
  const ms_per_tile = tpm_to_mspt(speed_tpm);
  const breaths_per_step = Math.max(1, Math.round(ms_per_tile / BREATH_MS));
  const now = Date.now();

  const state: EntityMovementState = {
    entity_ref,
    entity_type,
    goal: { type: "move_to", target_position: next, priority: 10, reason: "Manual step" },
    path: [next],
    path_index: 0,
    is_moving: true,
    speed_tpm,
    ms_per_tile,
    last_step_time: now,
    next_step_time: now + ms_per_tile,
    breaths_per_step,
    next_breath: place_breath + breaths_per_step,
    step_count: 0,
    total_distance: 1,
    show_path: false,
    path_color: "white",
    failed_path: false,
    on_complete,
    on_step,
    allow_unsupported: !!opts?.allow_unsupported,
  };

  movement_states.set(entity_ref, state);

  // Reflect derived schedule into place snapshot for persistence.
  try {
    const a: any = place.contents.actors_present.find(a0 => a0.actor_ref === entity_ref);
    const n: any = place.contents.npcs_present.find(n0 => n0.npc_ref === entity_ref);
    const snap: any = entity_type === 'actor' ? a : n;
    if (snap) {
      if (!snap.movement_schedule) snap.movement_schedule = {};
      if (!snap.movement_schedule.walk) snap.movement_schedule.walk = {};
      snap.movement_schedule.walk.breaths_per_step = breaths_per_step;
      snap.movement_schedule.walk.next_breath = state.next_breath;
    }
  } catch {
    // ignore
  }
  return true;
}

export function debug_peek_next_step(entity_ref: string): TilePosition | null {
  const st = movement_states.get(entity_ref);
  if (!st || !st.is_moving) return null;
  return st.path[st.path_index] ?? null;
}

// Store all entity movement states
const movement_states = new Map<string, EntityMovementState>();

// Callback when place needs visual update
let on_place_update: ((place: Place) => void) | null = null;

// Track active places
const active_places = new Map<string, Place>();
let is_running = false;
let interval_id: ReturnType<typeof setInterval> | null = null;

// Configuration
const TICK_RATE_MS = 50; // 20Hz for smooth interpolation
const PATH_VISUAL_DURATION_MS = 2000; // How long to show red failed paths

// Must match server authoritative breath loop cadence.
const BREATH_MS = 33;

/**
 * Initialize movement engine
 */
export function init_movement_engine(
  place_update_callback: (place: Place) => void
): void {
  on_place_update = place_update_callback;
  
  if (!is_running) {
    start_engine();
  }
}

/**
 * Start the movement engine loop
 */
function start_engine(): void {
  if (is_running || interval_id) return;
  
  is_running = true;
  interval_id = setInterval(() => {
    void engine_tick();
  }, TICK_RATE_MS);
  
  debug_log("MovementEngine", "Started", { tick_rate_ms: TICK_RATE_MS });
}

/**
 * Stop the movement engine
 */
export function stop_engine(): void {
  if (interval_id) {
    clearInterval(interval_id);
    interval_id = null;
  }
  is_running = false;
  movement_states.clear();
  active_places.clear();
  debug_log("MovementEngine", "Stopped");
}

/**
 * Register a place for movement processing
 */
export function register_place(place_id: string, place: Place): void {
  active_places.set(place_id, place);
  
  // Initialize NPC movement states for all NPCs in the place
  // This ensures witness system can access movement state even when NPCs aren't moving
  for (const npc of place.contents.npcs_present) {
    const npc_ref = npc.npc_ref;
    const position = npc.tile_position;
    
    // Only initialize if not already exists
    if (!movement_states.has(npc_ref)) {
      init_npc_movement_state(npc_ref, position);
      debug_log("MovementEngine", `Initialized NPC movement state for ${npc_ref} at place registration`);
    }
  }
}

/**
 * Unregister a place
 */
export function unregister_place(place_id: string): void {
  const place = active_places.get(place_id);
  active_places.delete(place_id);
  
  // Clean up any movement states for entities in this place
  if (place) {
    // Remove all actor movement states
    for (const actor of place.contents.actors_present) {
      movement_states.delete(actor.actor_ref);
    }
    // Remove all NPC movement states
    for (const npc of place.contents.npcs_present) {
      movement_states.delete(npc.npc_ref);
    }
  }
}

/**
 * Start movement for an entity
 */
export function start_entity_movement(
  entity_ref: string,
  entity_type: "actor" | "npc",
  place: Place,
  goal: MovementGoal,
  speed_tpm: number = DEFAULT_SPEED_TPM,
  on_complete?: (final_position: TilePosition & { z?: number }) => void,
  on_start?: (path: TilePosition[]) => void,
  on_step?: (position: TilePosition & { z?: number }) => void
): boolean {
  const current_pos = get_entity_position(place, entity_ref, entity_type);
  if (!current_pos) {
    debug_log("MovementEngine", `${entity_ref} not found in place`);
    return false;
  }
  
  // Calculate path
  const path_result = calculate_path(place, current_pos, goal, entity_ref);
  
  // Create movement state
  const place_breath = Math.floor(Number((place as any)?.breath_index ?? 0)) || 0;

  // Step cadence is derived from speed_tpm (do not treat persisted movement_schedule as authoritative).
  const ms_per_tile = tpm_to_mspt(speed_tpm);
  const breaths_per_step = Math.max(1, Math.round(ms_per_tile / BREATH_MS));
  const now = Date.now();
  
  const state: EntityMovementState = {
    entity_ref,
    entity_type,
    goal,
    path: path_result.path as Array<TilePosition & { z?: number }>,
    path_index: 0,
    is_moving: path_result.path.length > 0 && !path_result.blocked,
    speed_tpm,
    ms_per_tile,
    last_step_time: now,
    next_step_time: now + ms_per_tile,
    breaths_per_step,
    next_breath: place_breath + breaths_per_step,
    step_count: 0,
    total_distance: path_result.path.length,
    show_path: true,
    path_color: path_result.blocked ? "red" : "white",
    failed_path: path_result.blocked,
    on_complete,
    on_step,
  };
  
  movement_states.set(entity_ref, state);
  
  // Bridge to NPC movement state system for witness/reaction integration
  if (entity_type === "npc") {
    // Initialize NPC movement state if not exists
    init_npc_movement_state(entity_ref, current_pos);
    
    // Convert movement engine goal to NPC AI goal format
    const npc_goal: NPCGoal = {
      type: goal.type === "wander" ? "wander" : 
           goal.type === "patrol" ? "patrol" : 
           goal.type === "follow" ? "follow" : 
           goal.type === "flee" ? "flee" : "wander",
      target_position: goal.target_position,
      target_entity: goal.target_entity,
      priority: goal.priority,
      created_at: Date.now(),
      reason: goal.reason,
    };
    
    set_npc_goal(entity_ref, npc_goal, path_result.path);
    debug_log("MovementEngine", `${entity_ref} bridged to NPC movement state`, { goal_type: npc_goal.type });
  }
  
  if (path_result.blocked) {
    debug_log("MovementEngine", `${entity_ref} path blocked`, { 
      blocked_at: path_result.blocked_at 
    });
    // Schedule cleanup of failed path visualization
    setTimeout(() => {
      const s = movement_states.get(entity_ref);
      if (s && s.failed_path) {
        movement_states.delete(entity_ref);
      }
    }, PATH_VISUAL_DURATION_MS);
    return false;
  }
  
  debug_log("MovementEngine", `${entity_ref} started moving`, {
    path_length: path_result.path.length,
    speed_tpm,
    ms_per_tile,
  });
  
  // Call on_start callback with the path for particle spawning
  if (on_start) {
    on_start(path_result.path);
  }
  
  return true;
}

/**
 * Stop entity movement
 */
export function stop_entity_movement(entity_ref: string): void {
  const state = movement_states.get(entity_ref);
  if (state) {
    state.is_moving = false;
    state.show_path = false;
    movement_states.delete(entity_ref);
    debug_log("MovementEngine", `${entity_ref} stopped`);
  }
}

/**
 * Get entity position from place data
 */
function get_entity_position(
  place: Place,
  entity_ref: string,
  entity_type: "actor" | "npc"
): TilePosition | null {
  if (entity_type === "actor") {
    const actor = place.contents.actors_present.find(a => a.actor_ref === entity_ref);
    return actor?.tile_position ?? null;
  } else {
    const npc = place.contents.npcs_present.find(n => n.npc_ref === entity_ref);
    return npc?.tile_position ?? null;
  }
}

/**
 * Calculate path for a goal
 */
function calculate_path(
  place: Place,
  start: TilePosition,
  goal: MovementGoal,
  entity_ref: string
): PathResult {
  if (!goal.target_position) {
    return { path: [], blocked: true };
  }
  
  return find_path(place, start, goal.target_position, {
    exclude_entity: entity_ref,
    allow_diagonal: false,
    treat_occupied_as_wall: true,
  });
}

/**
 * Main engine tick - processes all active movements
 */
async function engine_tick(): Promise<void> {
  const now = Date.now();

  // Engine timing drift diagnostics (helps explain "missed breath" feel).
  try {
    const last = engine_diag.last_tick_ms;
    if (last > 0) {
      const dt = now - last;
      const late_ms = dt - TICK_RATE_MS;
      if (late_ms > engine_diag.late_ms_max) engine_diag.late_ms_max = late_ms;
      if (late_ms > 25 && (now - engine_diag.last_global_log_ms) > 2000) {
        engine_diag.last_global_log_ms = now;
        const payload = {
          tick_rate_ms: TICK_RATE_MS,
          dt_ms: dt,
          late_ms,
          late_ms_max: engine_diag.late_ms_max,
          active_states: movement_states.size,
        };
        debug_log('MOVE_UNIFY_TEST', `engine tick drift ${JSON.stringify(payload)}`);
      }
    }
    engine_diag.last_tick_ms = now;
  } catch {
    // ignore
  }
  
  for (const [entity_ref, state] of movement_states) {
    if (!state.is_moving) continue;
    
    // Find which place this entity is in
    const place = find_entity_place(entity_ref);
    if (!place) continue;

    const place_breath = Math.floor(Number((place as any)?.breath_index ?? 0)) || 0;
    if (place_breath < state.next_breath) {
      // Breath gate stall diagnostics (helps detect stale place snapshots).
      const last = state.last_seen_place_breath;
      if (typeof last === 'number' && last === place_breath) {
        state.breath_gate_stall_count = (state.breath_gate_stall_count ?? 0) + 1;
      } else {
        state.breath_gate_stall_count = 0;
        state.last_seen_place_breath = place_breath;
      }

      const stall = state.breath_gate_stall_count ?? 0;
      if (stall >= 40) {
        const last_log = state.last_breath_gate_log_ms ?? 0;
        if (now - last_log > 2000) {
          state.last_breath_gate_log_ms = now;
          debug_log(
            "MOVE_UNIFY_TEST",
            "breath gate stall (place breath not advancing in engine)",
            {
              entity_ref,
              place_id: (place as any)?.id,
              place_breath,
              next_breath: state.next_breath,
              breaths_per_step: state.breaths_per_step,
              hint: "likely stale place snapshot; ensure register_place updates on each /api/place refresh",
            }
          );
        }
      }
      continue;
    }

    // Per-entity scheduling diagnostics.
    try {
      const overshoot = place_breath - state.next_breath;
      state.diag_step_fires = (state.diag_step_fires ?? 0) + 1;
      if (overshoot > 0) {
        state.diag_overshoot_events = (state.diag_overshoot_events ?? 0) + 1;
        state.diag_overshoot_sum = (state.diag_overshoot_sum ?? 0) + overshoot;
        state.diag_overshoot_max = Math.max(state.diag_overshoot_max ?? 0, overshoot);
      }

      const last_log = state.diag_last_step_log_ms ?? 0;
      if ((now - last_log) > 1000) {
        state.diag_last_step_log_ms = now;
        const cur = get_entity_current_tile(place, entity_ref, state.entity_type);
        const payload = {
          entity_ref,
          entity_type: state.entity_type,
          kind: state.realtime_intent ? 'realtime' : 'path',
          place_id: (place as any)?.id,
          cur: cur ? { x: cur.x, y: cur.y, z: (cur as any)?.z } : null,
          place_breath,
          next_breath_before: state.next_breath,
          overshoot,
          breaths_per_step: state.breaths_per_step,
          diag: {
            step_fires: state.diag_step_fires,
            overshoot_events: state.diag_overshoot_events ?? 0,
            overshoot_avg: (state.diag_overshoot_events ? (state.diag_overshoot_sum ?? 0) / state.diag_overshoot_events : 0),
            overshoot_max: state.diag_overshoot_max ?? 0,
          },
          intent: state.realtime_intent ?? null,
        };
        debug_log('MOVE_UNIFY_TEST', `step fire ${JSON.stringify(payload)}`);
      }
    } catch {
      // ignore
    }
    
    // Breath gates stepping; time is only for interpolation.
    if (DEBUG_LEVEL >= 4) {
      debug_log("MovementEngine", `${entity_ref} executing step ${state.step_count}/${state.total_distance}`, { place_breath });
    }
    await execute_step(entity_ref, state, place);

    // Schedule next breath after attempting a step.
    state.next_breath = place_breath + state.breaths_per_step;

    // Reflect scheduling into the place snapshot so persistence can carry it.
    try {
      if (state.entity_type === 'actor') {
        const a: any = place.contents.actors_present.find(a0 => a0.actor_ref === entity_ref);
        if (a) {
          if (!a.movement_schedule) a.movement_schedule = {};
          if (!a.movement_schedule.walk) a.movement_schedule.walk = {};
          a.movement_schedule.walk.breaths_per_step = state.breaths_per_step;
          a.movement_schedule.walk.next_breath = state.next_breath;
        }
      } else {
        const n: any = place.contents.npcs_present.find(n0 => n0.npc_ref === entity_ref);
        if (n) {
          if (!n.movement_schedule) n.movement_schedule = {};
          if (!n.movement_schedule.walk) n.movement_schedule.walk = {};
          n.movement_schedule.walk.breaths_per_step = state.breaths_per_step;
          n.movement_schedule.walk.next_breath = state.next_breath;
        }
      }
    } catch {
      // ignore
    }
  }
}

export function start_entity_vertical_steps(
  entity_ref: string,
  entity_type: "actor" | "npc",
  place: Place,
  dz: 1 | -1,
  steps: number,
  speed_tpm: number = DEFAULT_SPEED_TPM,
  on_complete?: (final_position: TilePosition & { z?: number }) => void,
  on_step?: (position: TilePosition & { z?: number }) => void,
): boolean {
  const current_pos = get_entity_position(place, entity_ref, entity_type);
  if (!current_pos) {
    debug_log("MovementEngine", `${entity_ref} not found in place`);
    return false;
  }

  const bz = Math.floor(Number((place as any)?.coordinates?.elevation ?? 0)) || 0;
  const z0 = (() => {
    if (entity_type === "actor") {
      const a0: any = place.contents.actors_present.find(a => a.actor_ref === entity_ref);
      if (a0 && typeof a0.elevation === "number" && Number.isFinite(a0.elevation)) return Math.floor(a0.elevation);
    } else {
      const n0: any = place.contents.npcs_present.find(n => n.npc_ref === entity_ref);
      if (n0 && typeof n0.elevation === "number" && Number.isFinite(n0.elevation)) return Math.floor(n0.elevation);
    }
    return bz;
  })();

  const count = Math.max(1, Math.min(10, Math.floor(steps)));
  const path: Array<TilePosition & { z?: number }> = [];
  let z = z0;
  for (let i = 0; i < count; i++) {
    z += dz;
    path.push({ x: Math.floor(current_pos.x), y: Math.floor(current_pos.y), z });
  }

  const place_breath = Math.floor(Number((place as any)?.breath_index ?? 0)) || 0;
  const ms_per_tile = tpm_to_mspt(speed_tpm);
  const breaths_per_step = Math.max(1, Math.round(ms_per_tile / BREATH_MS));
  const now = Date.now();

  const last = path[path.length - 1];
  if (!last) return false;

  const state: EntityMovementState = {
    entity_ref,
    entity_type,
    goal: { type: "move_to", target_position: { x: last.x, y: last.y }, priority: 20, reason: dz > 0 ? "Jump" : "Fall" },
    path,
    path_index: 0,
    is_moving: true,
    speed_tpm,
    ms_per_tile,
    last_step_time: now,
    next_step_time: now + ms_per_tile,
    breaths_per_step,
    next_breath: place_breath + breaths_per_step,
    step_count: 0,
    total_distance: path.length,
    show_path: false,
    path_color: "white",
    failed_path: false,
    allow_unsupported: true,
    on_complete,
    on_step,
  };

  movement_states.set(entity_ref, state);

  // Reflect derived schedule into place snapshot for persistence.
  try {
    const a: any = place.contents.actors_present.find(a0 => a0.actor_ref === entity_ref);
    const n: any = place.contents.npcs_present.find(n0 => n0.npc_ref === entity_ref);
    const snap: any = entity_type === 'actor' ? a : n;
    if (snap) {
      if (!snap.movement_schedule) snap.movement_schedule = {};
      if (!snap.movement_schedule.walk) snap.movement_schedule.walk = {};
      snap.movement_schedule.walk.breaths_per_step = breaths_per_step;
      snap.movement_schedule.walk.next_breath = state.next_breath;
    }
  } catch {
    // ignore
  }
  return true;
}

/**
 * Get entity's current tile position
 */
function get_entity_current_tile(
  place: Place,
  entity_ref: string,
  entity_type: "actor" | "npc"
): TilePosition | null {
  if (entity_type === "actor") {
    const actor = place.contents.actors_present.find(a => a.actor_ref === entity_ref);
    return actor?.tile_position ?? null;
  } else {
    const npc = place.contents.npcs_present.find(n => n.npc_ref === entity_ref);
    return npc?.tile_position ?? null;
  }
}

/**
 * Execute one movement step
 */
async function execute_step(
  entity_ref: string,
  state: EntityMovementState,
  place: Place
): Promise<void> {
  // Get next tile
  const next_tile = state.path[state.path_index];
  if (!next_tile) {
    // Path complete
    complete_movement(entity_ref, state, place);
    return;
  }
  
  // Get current position before moving (for facing calculation)
  const current_tile = get_entity_current_tile(place, entity_ref, state.entity_type);
  
  // Move entity
  const step_res = move_entity_to_tile(place, entity_ref, state.entity_type, next_tile, {
    allow_unsupported: !!state.allow_unsupported,
  });
  
  if (step_res.ok) {
    // Update facing direction based on movement
    if (current_tile) {
      update_facing_on_move(entity_ref, current_tile, next_tile);

      // Persist facing into the place snapshot so other systems can consult it.
      try {
        const dir = get_facing(entity_ref);
        if (state.entity_type === "actor") {
          const a: any = place.contents.actors_present.find(a0 => a0.actor_ref === entity_ref);
          if (a) a.facing = dir;
        } else {
          const n: any = place.contents.npcs_present.find(n0 => n0.npc_ref === entity_ref);
          if (n) n.facing = dir;
        }
      } catch {
        // ignore
      }
    }

    // Scheduling reflection occurs in engine_tick after next_breath is advanced.
    
    // ===== WITNESS SYSTEM: Movement Detection =====
    // Movement should generate perception events regardless of mover type.
    // Observers are NPCs; the player doesn't need NPC-perception events.
    const other_npcs = place.contents.npcs_present.filter(n => n.npc_ref !== entity_ref);

    // Calculate detectability based on step count and speed
    const detectability = calculate_movement_detectability(
      state.total_distance,
      state.speed_tpm
    );

    // Notify nearby observers every few steps
    const should_notify = state.step_count % 3 === 0 ||
                         state.step_count === 0 ||
                         state.step_count >= state.total_distance - 1;

    if (should_notify) {
      // Renderer-side trace logging (no-op at normal debug levels)
      other_npcs.forEach(npc => {
        process_witness_movement(
          npc.npc_ref,
          entity_ref,
          next_tile,
          state.step_count,
          state.total_distance
        );
      });

      // Emit movement perception batch to backend witness system.
      // This is renderer->backend bridging so movement uses the same sensing pipeline.
      try {
        void emit_move_perception_batch({
          place,
          mover_ref: entity_ref,
          mover_position: next_tile,
          step_number: state.step_count,
          total_steps: state.total_distance,
          speed_tpm: state.speed_tpm,
        });
      } catch {
        // Ignore; renderer should not crash on perception emission failures.
      }

      // Log movement detection level
      if (DEBUG_LEVEL >= 4) {
        debug_log(
          "MovementEngine",
          `${entity_ref} movement step ${state.step_count}/${state.total_distance}: ${detectability.description} (intensity: ${detectability.intensity}, range: ${detectability.range})`
        );
      }
    }
    
    state.path_index++;
    state.step_count++;
    state.last_step_time = Date.now();
    state.next_step_time = state.last_step_time + state.ms_per_tile;
    
    // Call step callback if provided
    if (state.on_step) {
      state.on_step(next_tile);
    }
    
    // Check if complete
    if (state.path_index >= state.path.length) {
      if (state.realtime_intent) {
        const intent = state.realtime_intent;
        const dx = Math.floor(Number(intent.dx) || 0);
        const dy = Math.floor(Number(intent.dy) || 0);
        if (dx === 0 && dy === 0) {
          movement_states.delete(entity_ref);
          return;
        }

        // Compute next step target from the new current tile.
        const cur = get_entity_current_tile(place, entity_ref, state.entity_type);
        if (!cur) {
          movement_states.delete(entity_ref);
          return;
        }
        state.path = [{ x: cur.x + dx, y: cur.y + dy }];
        state.path_index = 0;
        state.total_distance = 1;

        // UI update after step.
        if (on_place_update) on_place_update(place);
        return;
      }

      complete_movement(entity_ref, state, place);
    } else {
      // Notify UI of position change
      if (on_place_update) {
        on_place_update(place);
      }
    }
  } else {
    // Move failed (tile became blocked)
    if (state.realtime_intent) {
      // Realtime intent: keep the state and try again on the next scheduled breath.
      // Do not mark as failed-path; blockers should not paint red.

      // Diagnostics: log blocked attempts at a low rate.
      try {
        state.realtime_blocked_attempts = (state.realtime_blocked_attempts ?? 0) + 1;
        const r = String(step_res.blocked_check?.reason ?? 'blocked');
        const by = (state.realtime_blocked_by_reason ??= {});
        by[r] = (by[r] ?? 0) + 1;

        const now = Date.now();
        const last = state.realtime_blocked_last_log_ms ?? 0;
        if (now - last > 1000) {
          state.realtime_blocked_last_log_ms = now;
          // IMPORTANT: stringify so Electron renderer log capture doesn't reduce objects to "[object Object]".
          const cur = get_entity_current_tile(place, entity_ref, state.entity_type);
          const payload = {
            entity_ref,
            entity_type: state.entity_type,
            place_id: (place as any)?.id,
            cur: cur ? { x: cur.x, y: cur.y, z: (cur as any)?.z } : null,
            target: { x: next_tile.x, y: next_tile.y, z: (next_tile as any)?.z },
            attempts: state.realtime_blocked_attempts,
            reason: r,
            reason_counts: by,
            blocked_check: step_res.blocked_check ?? null,
            cadence: {
              breaths_per_step: state.breaths_per_step,
              next_breath: state.next_breath,
              place_breath: Math.floor(Number((place as any)?.breath_index ?? 0)) || 0,
            },
            intent: state.realtime_intent ?? null,
          };
          debug_log('MOVE_UNIFY_TEST', `realtime step blocked (WASD) ${JSON.stringify(payload)}`);
        }
      } catch {
        // ignore
      }

      state.path_index = 0;
      state.total_distance = 1;
      if (on_place_update) on_place_update(place);
      return;
    }

    debug_log("MovementEngine", `${entity_ref} step blocked`);
    state.is_moving = false;
    state.failed_path = true;
    state.path_color = "red";
    
    // Schedule cleanup
    setTimeout(() => {
      movement_states.delete(entity_ref);
      if (on_place_update) {
        on_place_update(place);
      }
    }, PATH_VISUAL_DURATION_MS);
  }
}

/**
 * Move entity to a tile
 */
function move_entity_to_tile(
  place: Place,
  entity_ref: string,
  entity_type: "actor" | "npc",
  tile: TilePosition & { z?: number },
  opts?: { allow_unsupported?: boolean }
): StepResult {
  // Step-time legality enforcement (pathfinding is advisory).
  try {
    const bz = Math.floor(Number((place as any)?.coordinates?.elevation ?? 0)) || 0;
    const owner: OwnerRef = { kind: entity_type, id: entity_ref } as any;
    const z0 = (() => {
      if (entity_type === "actor") {
        const a0: any = place.contents.actors_present.find(a => a.actor_ref === entity_ref);
        if (a0 && typeof a0.elevation === "number" && Number.isFinite(a0.elevation)) return Math.floor(a0.elevation);
      } else {
        const n0: any = place.contents.npcs_present.find(n => n.npc_ref === entity_ref);
        if (n0 && typeof n0.elevation === "number" && Number.isFinite(n0.elevation)) return Math.floor(n0.elevation);
      }
      return bz;
    })();

    const z_target = (typeof (tile as any).z === 'number' && Number.isFinite((tile as any).z)) ? Math.floor((tile as any).z) : z0;
    const check = can_place_volume(place, owner, { x: tile.x, y: tile.y, z: z_target }, "WALK", {
      exclude_owner: owner,
      support_policy: "any_footprint",
      allow_unsupported: !!opts?.allow_unsupported,
    });

    if (!check.ok) {
      return { ok: false, blocked_check: check };
    }
  } catch (err) {
    debug_log("MOVE_UNIFY_TEST", `FAIL step-time legality threw ${entity_ref}`, { err: String(err) });
    return { ok: false, blocked_check: { reason: 'legality_throw', err: String(err) } };
  }

  if (entity_type === "actor") {
    const actor = place.contents.actors_present.find(a => a.actor_ref === entity_ref);
    if (!actor) return { ok: false, blocked_check: { reason: 'actor_not_in_place' } };
    actor.tile_position = tile;
    if (typeof (tile as any).z === 'number' && Number.isFinite((tile as any).z)) {
      (actor as any).elevation = Math.floor((tile as any).z);
    }
    actor.status = "moving";
    return { ok: true };
  } else {
    const npc = place.contents.npcs_present.find(n => n.npc_ref === entity_ref);
    if (!npc) return { ok: false, blocked_check: { reason: 'npc_not_in_place' } };
    npc.tile_position = tile;
    if (typeof (tile as any).z === 'number' && Number.isFinite((tile as any).z)) {
      (npc as any).elevation = Math.floor((tile as any).z);
    }
    npc.status = "moving";
    return { ok: true };
  }
}

/**
 * Complete movement
 */
function complete_movement(
  entity_ref: string,
  state: EntityMovementState,
  place: Place
): void {
  state.is_moving = false;
  state.show_path = false;
  
  // Get final position before calling callback
  const final_position = state.path[state.path.length - 1];
  
  // Update status to present
  if (state.entity_type === "actor") {
    const actor = place.contents.actors_present.find(a => a.actor_ref === entity_ref);
    if (actor) actor.status = "present";
  } else {
    const npc = place.contents.npcs_present.find(n => n.npc_ref === entity_ref);
    if (npc) npc.status = "present";
  }
  
  // Call completion callback with final position
  if (state.on_complete && final_position) {
    state.on_complete(final_position);
  }
  
  movement_states.delete(entity_ref);
  
  debug_log("MovementEngine", `${entity_ref} completed movement`, {
    steps: state.step_count,
    distance: state.total_distance,
    final_position,
  });
  
  // Note: Position saving is handled by the caller via on_complete callback
  // We don't save here because this code runs in browser context (no Node.js APIs)
  
  if (on_place_update) {
    on_place_update(place);
  }
}

// Note: Position saving to storage is handled by the caller via on_complete callback
// The movement engine should not directly access storage since it runs in browser context

/**
 * Find which place contains an entity
 */
function find_entity_place(entity_ref: string): Place | undefined {
  for (const place of active_places.values()) {
    const is_actor = place.contents.actors_present.some(a => a.actor_ref === entity_ref);
    const is_npc = place.contents.npcs_present.some(n => n.npc_ref === entity_ref);
    if (is_actor || is_npc) {
      return place;
    }
  }
  // Only log at trace level to avoid spam - entity may have moved to inactive place
  if (DEBUG_LEVEL >= 4) {
    debug_log("MovementEngine", `${entity_ref} not found in any active place`);
  }
  return undefined;
}

/**
 * Get movement state for an entity
 */
export function get_movement_state(entity_ref: string): EntityMovementState | undefined {
  return movement_states.get(entity_ref);
}

/**
 * Get all active movement states
 */
export function get_all_movement_states(): EntityMovementState[] {
  return Array.from(movement_states.values());
}

/**
 * Get interpolated position for smooth rendering
 * Returns position between tiles based on timing
 */
export function get_interpolated_position(
  entity_ref: string
): TilePosition | null {
  const state = movement_states.get(entity_ref);
  if (!state || !state.is_moving) return null;
  
  const now = Date.now();
  const time_since_last = now - state.last_step_time;
  const progress = Math.min(time_since_last / state.ms_per_tile, 1);
  
  // Get current and next tile
  const current_idx = Math.max(0, state.path_index - 1);
  const next_idx = state.path_index;
  
  if (current_idx >= state.path.length || next_idx >= state.path.length) {
    return null;
  }
  
  const current = state.path[current_idx];
  const next = state.path[next_idx];
  
  if (!current || !next) return null;
  
  // Interpolate
  return {
    x: current.x + (next.x - current.x) * progress,
    y: current.y + (next.y - current.y) * progress,
  };
}

/**
 * Check if entity is currently moving
 */
export function is_entity_moving(entity_ref: string): boolean {
  const state = movement_states.get(entity_ref);
  return state?.is_moving ?? false;
}

/**
 * Get entity's current path for visualization
 */
export function get_entity_path(entity_ref: string): { 
  path: TilePosition[]; 
  color: "white" | "red";
  show: boolean;
} | null {
  const state = movement_states.get(entity_ref);
  if (!state || !state.show_path) return null;
  
  return {
    path: state.path,
    color: state.path_color,
    show: state.show_path,
  };
}
