/**
 * Vision Debugger - ASCII Particle Visualization
 * 
 * Visualizes vision cones, hearing ranges, and sense broadcasts
 * using the existing particle system in the place module.
 * 
 * Press \ (backslash) to toggle debug mode
 * 
 * Visual Guide:
 * - Yellow ▲ = Vision cone tiles (light sense)
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
import { direction_to_arrow } from "../npc_ai/facing_system.js";
import { get_cone_tiles, get_hearing_tiles } from "../npc_ai/cone_of_vision.js";
import { get_vision_cone } from "../npc_ai/cone_of_vision.js";
import { debug_log } from "../shared/debug.js";

/** Debug visualization state */
export const DEBUG_VISION = {
  enabled: false,
  show_vision_cones: true,
  show_hearing_ranges: false,
  show_sense_broadcasts: true,
  show_facing: true,
  show_conversation_state: true,
  
  toggle(): void {
    this.enabled = !this.enabled;
    debug_log("VisionDebug", `Debug mode: ${this.enabled ? "ON" : "OFF"}`);
  }
};

/** Particle spawn function - set by place module */
let spawn_particle_fn: ((particle: Particle) => void) | null = null;

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
  entity_ref: string
): void {
  if (!DEBUG_VISION.enabled || !DEBUG_VISION.show_vision_cones) return;
  
  const cone = get_vision_cone(entity_ref);
  const tiles = get_cone_tiles(origin, direction, cone);
  
  for (const tile of tiles) {
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
      created_at: Date.now(),
      lifespan_ms: 2000
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
  
  const tiles = get_hearing_tiles(origin, entity_ref);
  
  for (const tile of tiles) {
    spawn_debug_particle({
      x: tile.x,
      y: tile.y,
      char: "○",
      rgb: { r: 0, g: 255, b: 255 }, // Cyan
      created_at: Date.now(),
      lifespan_ms: 2000
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
  
  // Spawn burst particles
  const particle_count = 8;
  for (let i = 0; i < particle_count; i++) {
    const angle = (i / particle_count) * 2 * Math.PI;
    const distance = range * 0.7;
    const x = Math.round(origin.x + Math.cos(angle) * distance);
    const y = Math.round(origin.y + Math.sin(angle) * distance);
    
    spawn_debug_particle({
      x,
      y,
      char: "✦",
      rgb: color,
      created_at: Date.now(),
      lifespan_ms: 1500
    });
  }
  
  // Spawn center indicator
  spawn_debug_particle({
    x: origin.x,
    y: origin.y,
    char: "◆",
    rgb: color,
    created_at: Date.now(),
    lifespan_ms: 1500
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
  in_conversation: boolean
): void {
  if (!DEBUG_VISION.enabled) return;
  
  if (DEBUG_VISION.show_facing) {
    spawn_facing_indicator(position, direction);
  }
  
  if (DEBUG_VISION.show_vision_cones) {
    spawn_vision_cone_particles(position, direction, npc_ref);
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
