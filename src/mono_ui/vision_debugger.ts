/**
 * Vision Debugger
 *
 * Sense geometry overlays now render through selection-style tint highlights
 * in the place module. Small transient indicators like facing/conversation/
 * perception flashes still use the lightweight particle path.
 *
 * Debug overlays are toggled from UI (button) rather than hotkeys.
 */

import type { TilePosition } from "../types/place.js";
import type { SenseType } from "../action_system/perception.js";
import type { Direction } from "../npc_ai/facing_system.js";
import {
  get_sphere_outline_plane_slices,
  project_vision_cone_to_planes,
} from "../shared/geometry/shape3d.js";

/** Transient indicator payload matching the place module particle path */
export type Particle = {
  x: number;
  y: number;
  // Optional world-Z hint for the place module's DOM world layers.
  world_z?: number;
  char: string;
  rgb: { r: number; g: number; b: number };
  created_at: number;
  lifespan_ms: number;
  weight?: number; // Optional weight for rendering priority (higher = on top)
  op?: 'set' | 'tint_fg';
};
import { direction_to_angle, direction_to_arrow } from "../npc_ai/facing_system.js";
import { get_vision_preset } from "../npc_ai/vision_presets.js";
import { debug_log } from "../shared/debug.js";

/** Debug visualization state */
export const DEBUG_VISION = {
  enabled: false,
  show_vision_cones: true,
  // Highlight tiles that are visible within the vision cone.
  show_visible_vision: false,
  show_hearing_ranges: false,
  show_sense_broadcasts: true,
  show_facing: true,
  show_conversation_state: true,
  
  toggle(): void {
    this.enabled = !this.enabled;
    debug_log("VisionDebug", `Debug mode: ${this.enabled ? "ON" : "OFF"}`);
  }
};

export function set_debug_enabled(enabled: boolean): void {
  DEBUG_VISION.enabled = enabled;
  debug_log("VisionDebug", `Debug mode: ${DEBUG_VISION.enabled ? "ON" : "OFF"}`);
}

// Single button preset: the overlays we use most during development.
export function set_debug_bundle_enabled(enabled: boolean): void {
  set_debug_enabled(enabled);
  DEBUG_VISION.show_facing = enabled;
  DEBUG_VISION.show_sense_broadcasts = enabled;
  DEBUG_VISION.show_hearing_ranges = enabled;
  DEBUG_VISION.show_visible_vision = enabled;

  // Keep heavier overlays off by default to reduce clutter.
  DEBUG_VISION.show_vision_cones = false;
  DEBUG_VISION.show_conversation_state = false;
}

export function toggle_hearing_ranges(): void {
  DEBUG_VISION.show_hearing_ranges = !DEBUG_VISION.show_hearing_ranges;
  debug_log("VisionDebug", `Hearing ranges: ${DEBUG_VISION.show_hearing_ranges ? "ON" : "OFF"}`);
}

export function toggle_sense_broadcasts(): void {
  DEBUG_VISION.show_sense_broadcasts = !DEBUG_VISION.show_sense_broadcasts;
  debug_log("VisionDebug", `Sense broadcasts: ${DEBUG_VISION.show_sense_broadcasts ? "ON" : "OFF"}`);
}

export function toggle_blocked_vision(): void {
  // Legacy hotkey path (kept for compatibility): now toggles visible-vision highlight.
  DEBUG_VISION.show_visible_vision = !DEBUG_VISION.show_visible_vision;
  debug_log("VisionDebug", `Visible vision: ${DEBUG_VISION.show_visible_vision ? "ON" : "OFF"}`);
}

/** Transient indicator emitter provided by place module */
let spawn_particle_fn: ((particle: Particle) => void) | null = null;

const last_broadcast3d_log_by_key = new Map<string, number>();
const active_sense_broadcast_overlays: Array<{
  origin: WorldPos;
  sense: SenseType;
  range: number;
  source_ref?: string;
  created_at: number;
  expires_at: number;
}> = [];

export type BlocksLosAt = (x: number, y: number, world_z: number) => boolean;

export type WorldPos = { x: number; y: number; z: number };
export type VisiblePlanesZ = readonly number[];
export type SenseHighlightPlaneSet = {
  plane_index: number;
  keys: Set<string>;
  rgb: { r: number; g: number; b: number };
  kind: 'vision' | 'hearing' | 'broadcast';
  sense?: SenseType;
  source_ref?: string;
};

function plane_index_for_world_z(world_z: number, planes: VisiblePlanesZ): number {
  const z = Number(world_z);
  if (!Number.isFinite(z)) return Math.floor(planes.length / 2);
  let best = Math.floor(planes.length / 2);
  let best_d = Number.POSITIVE_INFINITY;
  for (let i = 0; i < planes.length; i += 1) {
    const dz = Math.abs(Number(planes[i]) - z);
    if (dz < best_d) {
      best_d = dz;
      best = i;
    }
  }
  return best;
}

function get_vision_mag_from_tags(tags: any[] | null | undefined): number {
  if (!Array.isArray(tags)) return 2;
  for (const t of tags) {
    const name = String(t?.name ?? '').trim().toUpperCase();
    if (!name) continue;
    if (name === 'LIGHT' || name === 'SENSE_LIGHT' || name === 'LIGHT_SENSE' || name === 'VISION' || name === 'SIGHT') {
      const mag = Number(t?.mag);
      if (Number.isFinite(mag)) return Math.floor(mag);
    }
  }
  return 2;
}

function get_pressure_mag_from_tags(tags: any[] | null | undefined): number {
  if (!Array.isArray(tags)) return 2;
  for (const t of tags) {
    const name = String(t?.name ?? '').trim().toUpperCase();
    if (!name) continue;
    if (name === 'PRESSURE' || name === 'SENSE_PRESSURE' || name === 'PRESSURE_SENSE' || name === 'HEARING') {
      const mag = Number(t?.mag);
      if (Number.isFinite(mag)) return Math.floor(mag);
    }
  }
  return 2;
}

function hearing_range_tiles_for_mag(mag: number): number {
  const m = Number.isFinite(mag) ? Math.floor(mag) : 2;
  if (m <= 0) return 0;
  // 0 = deaf, 1 = impaired, 2 = default.
  const base = 5;
  const out = base + (m - 2) * 2;
  return Math.max(1, Math.min(24, out));
}

function vision_vertical_fov_deg_for_mag(mag: number): number {
  const m = Number.isFinite(mag) ? Math.floor(mag) : 2;
  if (m <= 0) return 0;
  // Bounds:
  // 0 = blind
  // 1 = impaired
  // 2 = default
  const base = 50;
  const out = base + (m - 2) * 10;
  return Math.max(5, Math.min(120, out));
}

/*
Legacy particle-overlay helper retired in favor of selection-style tint overlays.
Keep this commented reference temporarily during migration cleanup.

function spawn_ring_tint(...) {
  ...old particle implementation...
}
*/

/**
 * Register the transient indicator emitter from place module
 */
export function register_particle_spawner(spawn_fn: (particle: Particle) => void): void {
  spawn_particle_fn = spawn_fn;
}

/**
 * Emit a transient debug indicator
 */
function spawn_debug_particle(particle: Particle): void {
  if (spawn_particle_fn) {
    spawn_particle_fn(particle);
  }
}

/**
 * Get color for a sense type
 */
function get_sense_color(sense: SenseType): { r: number; g: number; b: number } {
  switch (sense) {
    case "light": return { r: 255, g: 255, b: 0 };      // Yellow
    case "pressure": return { r: 0, g: 255, b: 255 };  // Cyan
    case "aroma": return { r: 255, g: 128, b: 0 };     // Orange
    case "thaumic": return { r: 255, g: 0, b: 255 };   // Magenta
    default: return { r: 255, g: 255, b: 255 };        // White
  }
}

/*
Legacy particle sense helpers retired in favor of selection-style tint overlays.
Keep this commented reference temporarily during migration cleanup.

export function spawn_vision_cone_particles(...) {
  ...old particle implementation...
}

export function spawn_hearing_range_particles(...) {
  ...old particle implementation...
}
*/

export function enqueue_sense_broadcast_highlight(opts: {
  origin: WorldPos;
  sense: SenseType;
  range: number;
  source_ref?: string;
  lifespan_ms?: number;
}): void {
  const range = Number(opts.range);
  if (!Number.isFinite(range) || range <= 0) return;
  const now = Date.now();
  active_sense_broadcast_overlays.push({
    origin: { x: Math.floor(opts.origin.x), y: Math.floor(opts.origin.y), z: Math.floor(opts.origin.z) },
    sense: opts.sense,
    range,
    source_ref: typeof opts.source_ref === 'string' && opts.source_ref.length > 0 ? opts.source_ref : undefined,
    created_at: now,
    expires_at: now + Math.max(1, Math.floor(opts.lifespan_ms ?? 900)),
  });
}

export function get_active_sense_broadcast_highlights(visible_planes_z: VisiblePlanesZ, now: number = Date.now()): SenseHighlightPlaneSet[] {
  for (let i = active_sense_broadcast_overlays.length - 1; i >= 0; i -= 1) {
    if (active_sense_broadcast_overlays[i]!.expires_at <= now) active_sense_broadcast_overlays.splice(i, 1);
  }
  if (!DEBUG_VISION.enabled || !DEBUG_VISION.show_sense_broadcasts) return [];

  const overlays: SenseHighlightPlaneSet[] = [];
  for (const entry of active_sense_broadcast_overlays) {
    const slices = get_sphere_outline_plane_slices({ origin: entry.origin, radius: entry.range, visible_planes_z });
    const radii = slices.map((slice) => slice.radius);
    const quant = slices.map((slice) => slice.quantized_radius);
    const counts = slices.map((slice) => slice.keys.size);
    const src = entry.source_ref ?? 'broadcast';
    const log_key = `${src}:${entry.sense}`;
    const last = last_broadcast3d_log_by_key.get(log_key) ?? 0;
    if (now - last > 900) {
      last_broadcast3d_log_by_key.set(log_key, now);
      debug_log(
        'VisionDebug',
        `Broadcast3D ${src} sense=${entry.sense} origin_z=${entry.origin.z} planes=[${visible_planes_z.join(',')}] radii=[${radii.map(r => (r === null ? 'x' : r.toFixed(2))).join(',')}] quant=[${quant.join(',')}] counts=[${counts.join(',')}]`
      );
    }
    const rgb = get_sense_color(entry.sense);
    for (const slice of slices) {
      if (slice.keys.size > 0) {
        overlays.push({ plane_index: slice.plane_index, keys: slice.keys, rgb, kind: 'broadcast', sense: entry.sense, source_ref: entry.source_ref });
      }
    }
  }
  return overlays;
}

/**
 * Spawn facing direction indicator
 */
export function spawn_facing_indicator(
  position: WorldPos,
  direction: Direction,
  visible_planes_z: VisiblePlanesZ
): void {
  if (!DEBUG_VISION.enabled || !DEBUG_VISION.show_facing) return;

  const plane_idx = plane_index_for_world_z(position.z, visible_planes_z);
  
  spawn_debug_particle({
    x: position.x,
    y: position.y,
    world_z: plane_idx,
    char: direction_to_arrow(direction),
    rgb: { r: 255, g: 255, b: 255 }, // White
    created_at: Date.now(),
    lifespan_ms: 1000
  });
}

/**
 * Spawn perception event flash
 */
export function spawn_perception_flash(
  position: TilePosition,
  detected: boolean
): void {
  if (!DEBUG_VISION.enabled) return;
  
  spawn_debug_particle({
    x: position.x,
    y: position.y,
    char: detected ? "!" : "?",
    rgb: detected 
      ? { r: 255, g: 255, b: 255 }  // White for detected
      : { r: 128, g: 128, b: 128 }, // Gray for not detected
    created_at: Date.now(),
    lifespan_ms: 800
  });
}

/**
 * Spawn conversation state indicator
 */
export function spawn_conversation_indicator(
  position: WorldPos,
  in_conversation: boolean,
  npc_ref: string,
  visible_planes_z: VisiblePlanesZ
): void {
  if (!DEBUG_VISION.enabled || !DEBUG_VISION.show_conversation_state) return;

  const plane_idx = plane_index_for_world_z(position.z, visible_planes_z);
  
  spawn_debug_particle({
    x: position.x,
    y: position.y + 1, // Below entity
    world_z: plane_idx,
    char: in_conversation ? "O" : "o",
    rgb: in_conversation 
      ? { r: 255, g: 255, b: 255 }    // White for in conversation (uppercase O)
      : { r: 128, g: 128, b: 128 }, // Gray for not in conversation (lowercase o)
    created_at: Date.now(),
    lifespan_ms: 1000,
    weight: 10 // Highest weight to render on top of debug vision
  });
}

/**
 * Update all debug visualizations for an entity
 * Call this periodically (e.g., every frame)
 */
export function get_entity_debug_sense_highlights(
  entity_ref: string,
  position: WorldPos,
  direction: Direction,
  visible_planes_z: VisiblePlanesZ,
  blocks_los_at?: BlocksLosAt,
  observer_tags?: any[]
): SenseHighlightPlaneSet[] {
  if (!DEBUG_VISION.enabled) return [];

  const overlays: SenseHighlightPlaneSet[] = [];

  if (DEBUG_VISION.show_vision_cones || DEBUG_VISION.show_visible_vision) {
    const cone = get_vision_preset('humanoid');
    const vision_mag = get_vision_mag_from_tags(observer_tags);
    const vertical_fov_deg = vision_vertical_fov_deg_for_mag(vision_mag);
    if (cone.range_tiles > 0 && cone.angle_degrees > 0 && vertical_fov_deg > 0) {
      const projection = project_vision_cone_to_planes({
        origin: position,
        center_yaw_rad: direction_to_angle(direction),
        yaw_fov_deg: cone.angle_degrees,
        pitch_fov_deg: vertical_fov_deg,
        range: cone.range_tiles,
        visible_planes_z,
        include_boundary: DEBUG_VISION.show_vision_cones,
        blocks_los_at,
      });
      const plane_sets = DEBUG_VISION.show_visible_vision ? projection.visible_by_plane : projection.outline_by_plane;
      const rgb = { r: 255, g: 230, b: 80 };
      plane_sets.forEach((keys, plane_index) => {
        if (keys.size > 0) overlays.push({ plane_index, keys, rgb, kind: 'vision' });
      });
    }
  }

  if (DEBUG_VISION.show_hearing_ranges) {
    const pressure_mag = get_pressure_mag_from_tags(observer_tags);
    const hearing_range = hearing_range_tiles_for_mag(pressure_mag);
    if (hearing_range > 0) {
      const hearing_slices = get_sphere_outline_plane_slices({ origin: position, radius: hearing_range, visible_planes_z });
      const rgb = { r: 0, g: 255, b: 255 };
      for (const slice of hearing_slices) {
        if (slice.keys.size > 0) overlays.push({ plane_index: slice.plane_index, keys: slice.keys, rgb, kind: 'hearing' });
      }
    }
  }

  return overlays;
}

export function update_entity_debug_visuals(
  entity_ref: string,
  position: WorldPos,
  direction: Direction,
  in_conversation: boolean,
  visible_planes_z: VisiblePlanesZ,
  blocks_los_at?: BlocksLosAt,
  observer_tags?: any[]
): void {
  if (!DEBUG_VISION.enabled) return;
  
  if (DEBUG_VISION.show_facing) {
    spawn_facing_indicator(position, direction, visible_planes_z);
  }
  
  if (DEBUG_VISION.show_conversation_state) {
    spawn_conversation_indicator(position, in_conversation, entity_ref, visible_planes_z);
  }
}

/**
 * Get debug status string
 */
export function get_debug_status(): string {
  return DEBUG_VISION.enabled ? "ON" : "OFF";
}

/**
 * Check if debug is enabled
 */
export function is_debug_enabled(): boolean {
  return DEBUG_VISION.enabled;
}
