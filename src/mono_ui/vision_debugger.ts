/**
 * Vision Debugger - ASCII Particle Visualization
 * 
 * Visualizes vision cones, hearing ranges, and sense broadcasts
 * using the existing particle system in the place module.
 * 
 * Press \ (backslash) to toggle global renderer debug mode
 * - H toggles hearing radius visualization
 * - B toggles sense broadcast visualization
 * - V toggles line-of-sight occlusion (shadow behind blockers)
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

/** Particle type matching the place module */
export type Particle = {
  x: number;
  y: number;
  char: string;
  rgb: { r: number; g: number; b: number };
  created_at: number;
  lifespan_ms: number;
  weight?: number; // Optional weight for rendering priority (higher = on top)
};
import { direction_to_angle, direction_to_arrow } from "../npc_ai/facing_system.js";
import { get_vision_cone } from "../npc_ai/cone_of_vision.js";
import { debug_log } from "../shared/debug.js";

/** Debug visualization state */
export const DEBUG_VISION = {
  enabled: false,
  show_vision_cones: true,
  show_blocked_vision: false,
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

export function toggle_hearing_ranges(): void {
  DEBUG_VISION.show_hearing_ranges = !DEBUG_VISION.show_hearing_ranges;
  debug_log("VisionDebug", `Hearing ranges: ${DEBUG_VISION.show_hearing_ranges ? "ON" : "OFF"}`);
}

export function toggle_sense_broadcasts(): void {
  DEBUG_VISION.show_sense_broadcasts = !DEBUG_VISION.show_sense_broadcasts;
  debug_log("VisionDebug", `Sense broadcasts: ${DEBUG_VISION.show_sense_broadcasts ? "ON" : "OFF"}`);
}

export function toggle_blocked_vision(): void {
  DEBUG_VISION.show_blocked_vision = !DEBUG_VISION.show_blocked_vision;
  debug_log("VisionDebug", `LOS occlusion: ${DEBUG_VISION.show_blocked_vision ? "ON" : "OFF"}`);
}

/** Particle spawn function - set by place module */
let spawn_particle_fn: ((particle: Particle) => void) | null = null;

// Throttle maps (avoid spamming expensive particle fields)
const last_hearing_spawn_by_ref = new Map<string, number>();
const last_vision_spawn_by_ref = new Map<string, number>();

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
  origin: TilePosition,
  direction: Direction,
  entity_ref: string,
  blockers?: Set<string>
): void {
  if (!DEBUG_VISION.enabled || !DEBUG_VISION.show_vision_cones) return;

  // Throttle: cone outlines are stable and expensive to respawn every frame.
  const now = Date.now();
  const last = last_vision_spawn_by_ref.get(entity_ref) ?? 0;
  if (now - last < 400) return;
  last_vision_spawn_by_ref.set(entity_ref, now);
  
  const cone = get_vision_cone(entity_ref);

  // Stroke-only: compute a stable wedge outline.
  const center_angle = direction_to_angle(direction);
  const half_angle_rad = (cone.angle_degrees * Math.PI) / 180 / 2;
  const left_angle = center_angle - half_angle_rad;
  const right_angle = center_angle + half_angle_rad;

  const normalize_angle = (a: number): number => {
    let out = a;
    while (out > Math.PI) out -= Math.PI * 2;
    while (out < -Math.PI) out += Math.PI * 2;
    return out;
  };

  const keys = new Set<string>();
  const outline: TilePosition[] = [];

  const push_unique = (x: number, y: number) => {
    const key = `${x},${y}`;
    if (keys.has(key)) return;
    keys.add(key);
    outline.push({ x, y });
  };

  // Two edge rays
  for (let r = 1; r <= cone.range_tiles; r++) {
    push_unique(Math.round(origin.x + Math.cos(left_angle) * r), Math.round(origin.y + Math.sin(left_angle) * r));
    push_unique(Math.round(origin.x + Math.cos(right_angle) * r), Math.round(origin.y + Math.sin(right_angle) * r));
  }

  // Outer arc
  const arc_steps = Math.max(10, cone.range_tiles);
  for (let i = 0; i <= arc_steps; i++) {
    const t = i / arc_steps;
    const a = left_angle + (right_angle - left_angle) * t;
    push_unique(Math.round(origin.x + Math.cos(a) * cone.range_tiles), Math.round(origin.y + Math.sin(a) * cone.range_tiles));
  }

  // Optional: show LOS occlusion (shadow) inside the cone.
  // For now, treat *NPC tiles* as opaque blockers.
  if (DEBUG_VISION.show_blocked_vision && blockers && cone.angle_degrees > 0 && cone.range_tiles > 0) {
    const ox = Number(origin.x);
    const oy = Number(origin.y);
    const range = cone.range_tiles;
    const occluded = new Set<string>();

    // Ray-cast within the cone. Once a ray hits a blocker tile, everything further out
    // on that ray is marked occluded.
    const ray_steps = Math.max(24, cone.range_tiles * 4);
    for (let i = 0; i <= ray_steps; i++) {
      const t = i / ray_steps;
      const a = left_angle + (right_angle - left_angle) * t;
      let hit = false;
      for (let r = 1; r <= range; r++) {
        const x = Math.round(ox + Math.cos(a) * r);
        const y = Math.round(oy + Math.sin(a) * r);
        const key = `${x},${y}`;
        if (!hit && blockers.has(key)) {
          // Blocker tile itself remains visible; start shadow behind it.
          hit = true;
          continue;
        }
        if (hit) occluded.add(key);
      }
    }

    // Draw only the boundary of the occluded region (keeps it readable + avoids heavy fill).
    const boundary = new Set<string>();
    for (const key of occluded) {
      const [xs, ys] = key.split(",");
      const x = Number(xs);
      const y = Number(ys);
      const neighbors = [
        `${x + 1},${y}`,
        `${x - 1},${y}`,
        `${x},${y + 1}`,
        `${x},${y - 1}`,
      ];
      if (neighbors.some(n => !occluded.has(n))) boundary.add(key);
    }

    for (const key of boundary) {
      const [xs, ys] = key.split(",");
      const x = Number(xs);
      const y = Number(ys);
      const distance = Math.sqrt(
        Math.pow(x - origin.x, 2) + Math.pow(y - origin.y, 2)
      );
      const opacity = 0.45 + (1 - Math.min(1, distance / cone.range_tiles)) * 0.35;
      spawn_debug_particle({
        x,
        y,
        char: "▲",
        rgb: {
          r: Math.floor(255 * opacity),
          g: 0,
          b: 0,
        },
        created_at: now,
        lifespan_ms: 900,
        weight: 4,
      });
    }
  }
  
  for (const tile of outline) {
    const distance = Math.sqrt(
      Math.pow(tile.x - origin.x, 2) + Math.pow(tile.y - origin.y, 2)
    );
    
    // Fade with distance
    const opacity = 1 - (distance / cone.range_tiles) * 0.5;
    
    spawn_debug_particle({
      x: tile.x,
      y: tile.y,
      char: "▲",
      rgb: { 
        r: Math.floor(255 * opacity), 
        g: Math.floor(255 * opacity), 
        b: 0 
      },
      created_at: now,
      lifespan_ms: 900,
      weight: 2,
    });
  }
}

/**
 * Spawn hearing range particles (pressure sense)
 */
export function spawn_hearing_range_particles(
  origin: TilePosition,
  entity_ref: string
): void {
  if (!DEBUG_VISION.enabled || !DEBUG_VISION.show_hearing_ranges) return;

  // Throttle: a filled ring is expensive to spawn every frame.
  const now = Date.now();
  const last = last_hearing_spawn_by_ref.get(entity_ref) ?? 0;
  if (now - last < 800) return;
  last_hearing_spawn_by_ref.set(entity_ref, now);

  const cone = get_vision_cone(entity_ref);
  const hearing_range = cone.range_tiles * 0.6;
  const r = Math.ceil(hearing_range);

  const fill_keys = new Set<string>();
  const fill_tiles: TilePosition[] = [];
  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -r; dy <= r; dy++) {
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= hearing_range + 1e-6) {
        const x = origin.x + dx;
        const y = origin.y + dy;
        const key = `${x},${y}`;
        fill_keys.add(key);
        fill_tiles.push({ x, y });
      }
    }
  }

  const outline_keys = new Set<string>();
  for (const t of fill_tiles) {
    const n = [
      `${t.x + 1},${t.y}`,
      `${t.x - 1},${t.y}`,
      `${t.x},${t.y + 1}`,
      `${t.x},${t.y - 1}`,
    ];
    if (n.some(k => !fill_keys.has(k))) {
      outline_keys.add(`${t.x},${t.y}`);
    }
  }

  // Outline ring
  for (const key of outline_keys) {
    const [xs, ys] = key.split(",");
    const x = Number(xs);
    const y = Number(ys);
    spawn_debug_particle({
      x,
      y,
      char: "○",
      rgb: { r: 0, g: 255, b: 255 },
      created_at: now,
      lifespan_ms: 1200,
      weight: 2,
    });
  }
}

/**
 * Spawn sense broadcast particles
 */
export function spawn_sense_broadcast_particles(
  origin: TilePosition,
  sense: SenseType,
  range: number
): void {
  if (!DEBUG_VISION.enabled || !DEBUG_VISION.show_sense_broadcasts) return;
  
  const color = get_sense_color(sense);
  
  // Outline ring at broadcast range.
  const r = Math.max(1, Math.round(range));
  const now = Date.now();
  const circumference = Math.max(8, Math.floor(2 * Math.PI * r * 1.5));
  const ring_keys = new Set<string>();
  for (let i = 0; i < circumference; i++) {
    const angle = (i / circumference) * 2 * Math.PI;
    const x = Math.round(origin.x + Math.cos(angle) * range);
    const y = Math.round(origin.y + Math.sin(angle) * range);
    ring_keys.add(`${x},${y}`);
  }
  for (const key of ring_keys) {
    const [xs, ys] = key.split(",");
    spawn_debug_particle({
      x: Number(xs),
      y: Number(ys),
      char: "✦",
      rgb: color,
      created_at: now,
      lifespan_ms: 1400,
      weight: 9,
    });
  }
  
  // Spawn center indicator
  spawn_debug_particle({
    x: origin.x,
    y: origin.y,
    char: "◆",
    rgb: color,
    created_at: now,
    lifespan_ms: 1400,
    weight: 10,
  });
}

/**
 * Spawn facing direction indicator
 */
export function spawn_facing_indicator(
  position: TilePosition,
  direction: Direction
): void {
  if (!DEBUG_VISION.enabled || !DEBUG_VISION.show_facing) return;
  
  spawn_debug_particle({
    x: position.x,
    y: position.y,
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
  position: TilePosition,
  in_conversation: boolean,
  npc_ref: string
): void {
  if (!DEBUG_VISION.enabled || !DEBUG_VISION.show_conversation_state) return;
  
  spawn_debug_particle({
    x: position.x,
    y: position.y + 1, // Below entity
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
  position: TilePosition,
  direction: Direction,
  in_conversation: boolean,
  blockers?: Set<string>
): void {
  if (!DEBUG_VISION.enabled) return;
  
  if (DEBUG_VISION.show_facing) {
    spawn_facing_indicator(position, direction);
  }
  
  if (DEBUG_VISION.show_vision_cones) {
    spawn_vision_cone_particles(position, direction, npc_ref, blockers);
  }
  
  if (DEBUG_VISION.show_hearing_ranges) {
    spawn_hearing_range_particles(position, npc_ref);
  }
  
  if (DEBUG_VISION.show_conversation_state) {
    spawn_conversation_indicator(position, in_conversation, npc_ref);
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
