/**
 * Vision Debugger - ASCII Particle Visualization
 * 
 * Visualizes vision cones, hearing ranges, and sense broadcasts
 * using the existing particle system in the place module.
 * 
 * Debug overlays are toggled from UI (button) rather than hotkeys.
 * 
 * Visual Guide:
 * - Yellow ▲ = Vision cone tiles (light sense)
 * - Red ▲ = Occluded tiles inside cone (blocked by NPCs)
 * - Cyan ○ = Hearing range ring (pressure sense)  
 * - Orange ○ = Smell range (aroma sense)
 * - Magenta ✦ = Magic detection (thaumic sense)
 * - White arrows = Facing direction (↑↓←→↗↖↘↙)
 * - White ! = Perception event
 */

import type { TilePosition } from "../types/place.js";
import type { SenseType } from "../action_system/perception.js";
import type { Direction } from "../npc_ai/facing_system.js";
import { trace_voxel_ray_3d } from "../shared/math3d.js";
import { sphere_plane_intersection_radius } from "../shared/math3d.js";

/** Particle type matching the place module */
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
import { get_vision_cone } from "../npc_ai/cone_of_vision.js";
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

/** Particle spawn function - set by place module */
let spawn_particle_fn: ((particle: Particle) => void) | null = null;

// Throttle maps (avoid spamming expensive particle fields)
const last_hearing_spawn_by_ref = new Map<string, number>();
const last_vision_spawn_by_ref = new Map<string, number>();
const last_los_raycast_log_by_ref = new Map<string, number>();
const last_broadcast3d_log_by_key = new Map<string, number>();

export type BlocksLosAt = (x: number, y: number, world_z: number) => boolean;

export type WorldPos = { x: number; y: number; z: number };
export type VisiblePlanesZ = readonly number[];

function clamp_int(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

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

function add_circle_points(keys: Set<string>, cx: number, cy: number, x: number, y: number): void {
  keys.add(`${cx + x},${cy + y}`);
  keys.add(`${cx - x},${cy + y}`);
  keys.add(`${cx + x},${cy - y}`);
  keys.add(`${cx - x},${cy - y}`);
  keys.add(`${cx + y},${cy + x}`);
  keys.add(`${cx - y},${cy + x}`);
  keys.add(`${cx + y},${cy - x}`);
  keys.add(`${cx - y},${cy - x}`);
}

function circle_outline_keys(cx: number, cy: number, r: number): Set<string> {
  const rr = Math.max(0, Math.floor(r));
  const keys = new Set<string>();
  if (rr <= 0) {
    keys.add(`${cx},${cy}`);
    return keys;
  }
  let x = rr;
  let y = 0;
  let err = 0;
  while (x >= y) {
    add_circle_points(keys, cx, cy, x, y);
    y++;
    if (err <= 0) {
      err += 2 * y + 1;
    }
    if (err > 0) {
      x--;
      err -= 2 * x + 1;
    }
  }
  return keys;
}

function spawn_ring_tint(opts: {
  origin: { x: number; y: number };
  radius: number;
  rgb: { r: number; g: number; b: number };
  now: number;
  lifespan_ms: number;
  weight: number;
  world_z: 0 | 1 | 2;
}): number {
  const range = Number(opts.radius);
  if (!Number.isFinite(range) || range <= 0) return 0;

  // 1-cell shell: ring is the last-heard boundary.
  // Quantize to integer radius so adjacent z-slices differ when they should.
  const r0 = Math.max(0, Math.floor(range + 1e-6));
  const ring_keys = circle_outline_keys(Math.round(opts.origin.x), Math.round(opts.origin.y), r0);
  for (const key of ring_keys) {
    const [xs, ys] = key.split(",");
    spawn_debug_particle({
      x: Number(xs),
      y: Number(ys),
      world_z: opts.world_z,
      char: "•",
      rgb: opts.rgb,
      created_at: opts.now,
      lifespan_ms: opts.lifespan_ms,
      weight: opts.weight,
      op: 'tint_fg',
    });
  }
  return ring_keys.size;
}

/**
 * Register the particle spawn function from place module
 */
export function register_particle_spawner(spawn_fn: (particle: Particle) => void): void {
  spawn_particle_fn = spawn_fn;
}

/**
 * Spawn a debug particle
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

/**
 * Spawn vision cone particles
 */
export function spawn_vision_cone_particles(
  origin: WorldPos,
  direction: Direction,
  entity_ref: string,
  visible_planes_z: VisiblePlanesZ,
  blocks_los_at?: BlocksLosAt,
  observer_tags?: any[]
): void {
  if (!DEBUG_VISION.enabled) return;
  if (!DEBUG_VISION.show_vision_cones && !DEBUG_VISION.show_visible_vision) return;

  // Throttle: cone outlines are stable and expensive to respawn every frame.
  const now = Date.now();
  const last = last_vision_spawn_by_ref.get(entity_ref) ?? 0;
  if (now - last < 400) return;
  last_vision_spawn_by_ref.set(entity_ref, now);
  
  const cone = get_vision_cone(entity_ref);
  const vision_mag = get_vision_mag_from_tags(observer_tags);
  const vertical_fov_deg = vision_vertical_fov_deg_for_mag(vision_mag);
  if (cone.range_tiles <= 0 || cone.angle_degrees <= 0 || vertical_fov_deg <= 0) return;

  const origin2: TilePosition = { x: origin.x, y: origin.y };

  // 3Dification: draw vision as true 3D voxel raycasting within a yaw/pitch cone.
  const center_angle = direction_to_angle(direction);
  const half_yaw = (cone.angle_degrees * Math.PI) / 180 / 2;
  const half_pitch = (vertical_fov_deg * Math.PI) / 180 / 2;

  const slot_by_world_z = new Map<number, number>();
  for (let i = 0; i < visible_planes_z.length; i += 1) {
    const wz = visible_planes_z[i];
    if (typeof wz === 'number' && Number.isFinite(wz)) slot_by_world_z.set(Math.floor(wz), i);
  }

  const vis_sets = visible_planes_z.map(() => new Set<string>());
  const out_sets = visible_planes_z.map(() => new Set<string>());
  const fallback_slot = Math.floor(visible_planes_z.length / 2);
  const sets_for_slot = (slot: number): Set<string> => vis_sets[slot] ?? vis_sets[fallback_slot]!;
  const outline_for_slot = (slot: number): Set<string> => out_sets[slot] ?? out_sets[fallback_slot]!;

  const origin_cont = { x: origin2.x + 0.5, y: origin2.y + 0.5, z: origin.z + 0.5 };

  const range = cone.range_tiles;
  const yaw_steps = Math.max(30, Math.min(90, Math.floor(range * 6)));
  let pitch_steps = Math.max(5, Math.min(13, Math.floor(vertical_fov_deg / 8)));
  if (pitch_steps % 2 === 0) pitch_steps += 1;

  let rays_cast = 0;
  let rays_blocked = 0;
  let vox_steps = 0;

  const cast_ray = (yaw: number, pitch: number, boundary: boolean) => {
    const cp = Math.cos(pitch);
    const dir = { x: cp * Math.cos(yaw), y: cp * Math.sin(yaw), z: Math.sin(pitch) };
    let blocked = false;
    const oxv = Math.floor(origin_cont.x);
    const oyv = Math.floor(origin_cont.y);
    const ozv = Math.floor(origin_cont.z);

    trace_voxel_ray_3d(origin_cont, dir, range, (vx, vy, vz, _t) => {
      vox_steps++;
      const slot = slot_by_world_z.get(vz);
      if (slot !== undefined) {
        const key = `${vx},${vy}`;
        sets_for_slot(slot).add(key);
        if (boundary) outline_for_slot(slot).add(key);
      }

      // Never let the observer voxel block its own rays.
      if (vx === oxv && vy === oyv && vz === ozv) {
        return;
      }

      if (blocks_los_at && blocks_los_at(vx, vy, vz)) {
        blocked = true;
        return false;
      }
    });
    if (blocked) rays_blocked++;
  };

  // Core ray grid.
  for (let iy = 0; iy <= yaw_steps; iy++) {
    const ty = yaw_steps > 0 ? (iy / yaw_steps) : 0;
    const yaw = center_angle + (-half_yaw + (2 * half_yaw) * ty);
    for (let ip = 0; ip <= pitch_steps; ip++) {
      const tp = pitch_steps > 0 ? (ip / pitch_steps) : 0;
      const pitch = -half_pitch + (2 * half_pitch) * tp;
      const boundary = DEBUG_VISION.show_vision_cones && (iy === 0 || iy === yaw_steps || ip === 0 || ip === pitch_steps);
      rays_cast++;
      cast_ray(yaw, pitch, boundary);
    }
  }


  if (DEBUG_VISION.show_visible_vision) {
    const spawn_set = (slot: number, set: Set<string>) => {
      for (const key of set) {
        const [xs, ys] = key.split(',');
        spawn_debug_particle({
          x: Number(xs),
          y: Number(ys),
          world_z: slot,
          char: '•',
          rgb: { r: 255, g: 230, b: 80 },
          created_at: now,
          lifespan_ms: 600,
          weight: 7,
          op: 'tint_fg',
        });
      }
    };
    vis_sets.forEach((set, slot) => spawn_set(slot, set));
  }

  if (DEBUG_VISION.show_vision_cones) {
    const spawn_outline = (slot: number, set: Set<string>) => {
      for (const key of set) {
        const [xs, ys] = key.split(',');
        spawn_debug_particle({
          x: Number(xs),
          y: Number(ys),
          world_z: slot,
          char: '▲',
          rgb: { r: 200, g: 200, b: 0 },
          created_at: now,
          lifespan_ms: 900,
          weight: 2,
        });
      }
    };
    out_sets.forEach((set, slot) => spawn_outline(slot, set));
  }

  if (blocks_los_at) {
    const last_log = last_los_raycast_log_by_ref.get(entity_ref) ?? 0;
    if (now - last_log > 1200) {
      last_los_raycast_log_by_ref.set(entity_ref, now);
      debug_log(
        'VisionDebug',
        `LOS3D ${entity_ref} mag=${vision_mag} vFov=${vertical_fov_deg} origin_z=${origin.z} planes=[${visible_planes_z.join(',')}] rays=${rays_cast} blocked=${rays_blocked} steps=${vox_steps} vis=[${vis_sets.map((s) => s.size).join(',')}]`
      );
    }
  }
}

/**
 * Spawn hearing range particles (pressure sense)
 */
export function spawn_hearing_range_particles(
  origin: WorldPos,
  entity_ref: string,
  visible_planes_z: VisiblePlanesZ,
  observer_tags?: any[]
): void {
  if (!DEBUG_VISION.enabled || !DEBUG_VISION.show_hearing_ranges) return;

  // Throttle: a filled ring is expensive to spawn every frame.
  const now = Date.now();
  const last = last_hearing_spawn_by_ref.get(entity_ref) ?? 0;
  if (now - last < 800) return;
  last_hearing_spawn_by_ref.set(entity_ref, now);

  const pressure_mag = get_pressure_mag_from_tags(observer_tags);
  const hearing_range = hearing_range_tiles_for_mag(pressure_mag);
  if (hearing_range <= 0) return;

  // 3D hearing sphere projected onto the currently visible planes.
  for (let plane_idx = 0 as 0 | 1 | 2; plane_idx <= 2; plane_idx = ((plane_idx + 1) as any)) {
    const plane_z = Number(visible_planes_z[plane_idx]);
    const r_plane = sphere_plane_intersection_radius(hearing_range, plane_z - origin.z);
    if (r_plane === null || r_plane <= 0) continue;
    spawn_ring_tint({
      origin: { x: origin.x, y: origin.y },
      radius: r_plane,
      rgb: { r: 0, g: 255, b: 255 },
      now,
      lifespan_ms: 900,
      weight: 7,
      world_z: plane_idx,
    });
  }

  // Debug: show slice radii/quantization.
  const dbg_key = `hearing:${entity_ref}`;
  const last_dbg = last_broadcast3d_log_by_key.get(dbg_key) ?? 0;
  if (now - last_dbg > 1200) {
    last_broadcast3d_log_by_key.set(dbg_key, now);
    const radii = visible_planes_z.map((pz) => sphere_plane_intersection_radius(hearing_range, Number(pz) - origin.z));
    const quant = radii.map((r) => (r === null ? 0 : Math.max(0, Math.floor(r + 1e-6))));
    debug_log(
      'VisionDebug',
      `Hearing3D ${entity_ref} mag=${pressure_mag} range=${hearing_range} origin_z=${origin.z} planes=[${visible_planes_z.join(',')}] radii=[${radii.map(r => (r === null ? 'x' : r.toFixed(2))).join(',')}] quant=[${quant.join(',')}]`
    );
  }
}

/**
 * Spawn sense broadcast particles
 */
export function spawn_sense_broadcast_particles(opts: {
  origin: WorldPos;
  sense: SenseType;
  range: number;
  visible_planes_z: VisiblePlanesZ;
  source_ref?: string;
}): void {
  if (!DEBUG_VISION.enabled || !DEBUG_VISION.show_sense_broadcasts) return;

  const origin = opts.origin;
  const range = Number(opts.range);
  if (!Number.isFinite(range) || range <= 0) return;
  const color = get_sense_color(opts.sense);
  const now = Date.now();

  const counts: number[] = [0, 0, 0];
  const radii: Array<number | null> = [null, null, null];
  const quant: number[] = [0, 0, 0];
  for (let plane_idx = 0 as 0 | 1 | 2; plane_idx <= 2; plane_idx = ((plane_idx + 1) as any)) {
    const plane_z = Number(opts.visible_planes_z[plane_idx]);
    const r_plane = sphere_plane_intersection_radius(range, plane_z - origin.z);
    radii[plane_idx] = r_plane;
    quant[plane_idx] = (r_plane === null) ? 0 : Math.max(0, Math.floor(r_plane + 1e-6));
    if (r_plane === null || r_plane <= 0) continue;
    counts[plane_idx] = spawn_ring_tint({
      origin: { x: origin.x, y: origin.y },
      radius: r_plane,
      rgb: color,
      now,
      lifespan_ms: 900,
      weight: 7,
      world_z: plane_idx,
    });
  }

  const src = typeof opts.source_ref === 'string' && opts.source_ref.length > 0 ? opts.source_ref : 'broadcast';
  const log_key = `${src}:${opts.sense}`;
  const last = last_broadcast3d_log_by_key.get(log_key) ?? 0;
  if (now - last > 900) {
    last_broadcast3d_log_by_key.set(log_key, now);
    debug_log(
      'VisionDebug',
      `Broadcast3D ${src} sense=${opts.sense} origin_z=${origin.z} planes=[${opts.visible_planes_z.join(',')}] radii=[${radii.map(r => (r === null ? 'x' : r.toFixed(2))).join(',')}] quant=[${quant.join(',')}] counts=[${counts.join(',')}]`
    );
  }
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
 * Update all debug visualizations for an NPC
 * Call this periodically (e.g., every frame)
 */
export function update_npc_debug_visuals(
  npc_ref: string,
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
  
  if (DEBUG_VISION.show_vision_cones || DEBUG_VISION.show_visible_vision) {
    spawn_vision_cone_particles(position, direction, npc_ref, visible_planes_z, blocks_los_at, observer_tags);
  }
  
  if (DEBUG_VISION.show_hearing_ranges) {
    spawn_hearing_range_particles(position, npc_ref, visible_planes_z, observer_tags);
  }
  
  if (DEBUG_VISION.show_conversation_state) {
    spawn_conversation_indicator(position, in_conversation, npc_ref, visible_planes_z);
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
