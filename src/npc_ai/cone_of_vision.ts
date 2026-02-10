/**
 * Cone of Vision System
 * 
 * Implements directional vision for NPCs and entities.
 * NPCs can only see within a cone in front of them, creating realistic blind spots.
 * Hearing (pressure sense) works in 360 degrees but at reduced range.
 * 
 * Integrates with the 4 canonical senses:
 * - light (vision): Directional, blocked by obstacles
 * - pressure (sound): Omnidirectional, 360 degrees
 * - aroma (smell): Omnidirectional, very short range
 * - thaumic (magic): Omnidirectional, penetrates walls
 */

import type { TilePosition } from "../types/place.js";
import type { Direction } from "./facing_system.js";
import { get_facing, direction_to_angle } from "./facing_system.js";
import { debug_log } from "../shared/debug.js";
import type { SenseType } from "../action_system/perception.js";

/** Vision cone parameters */
export interface VisionCone {
  angle_degrees: number;  // Width of vision cone (e.g., 120°)
  range_tiles: number;    // How far they can see
}

/** Vision presets by entity type */
export const VISION_PRESETS: Record<string, VisionCone> = {
  humanoid: { angle_degrees: 120, range_tiles: 12 },
  guard: { angle_degrees: 140, range_tiles: 15 },    // Alert, wider vision
  animal: { angle_degrees: 180, range_tiles: 10 },   // Wider but shorter
  blind: { angle_degrees: 0, range_tiles: 0 },       // No vision
  // Add more as needed
};

/** Hearing modifier (pressure sense range is typically 60% of vision) */
const HEARING_RANGE_MODIFIER = 0.6;

/**
 * Get vision cone for an entity
 * Returns humanoid preset by default
 */
export function get_vision_cone(entity_ref: string): VisionCone {
  // TODO: Check entity type from storage
  // For now, default to humanoid
  return VISION_PRESETS.humanoid ?? { angle_degrees: 120, range_tiles: 12 };
}

/**
 * Check if target is within vision cone
 * 
 * @param observer_pos - Observer's position
 * @param observer_direction - Direction observer is facing
 * @param target_pos - Target's position
 * @param cone - Vision cone parameters
 * @returns true if target is in vision cone
 */
export function is_in_vision_cone(
  observer_pos: TilePosition,
  observer_direction: Direction,
  target_pos: TilePosition,
  cone: VisionCone
): boolean {
  // Calculate distance
  const distance = calculate_distance(observer_pos, target_pos);
  if (distance > cone.range_tiles) {
    return false;
  }
  
  // Calculate angle to target
  const angle_to_target = calculate_angle(observer_pos, target_pos);
  const observer_angle = direction_to_angle(observer_direction);
  
  // Calculate angle difference
  let angle_diff = normalize_angle(angle_to_target - observer_angle);
  
  // Check if within cone
  const half_cone = (cone.angle_degrees * Math.PI) / 180 / 2;
  return Math.abs(angle_diff) <= half_cone;
}

/**
 * Check if target can be perceived with vision (light sense)
 */
export function can_see(
  observer_ref: string,
  observer_pos: TilePosition,
  target_pos: TilePosition
): boolean {
  const facing = get_facing(observer_ref);
  const cone = get_vision_cone(observer_ref);
  
  // Blind entities can't see
  if (cone.range_tiles === 0) return false;
  
  return is_in_vision_cone(observer_pos, facing, target_pos, cone);
}

/**
 * Check if target can be perceived with hearing (pressure sense)
 * Hearing works 360 degrees but at reduced range
 */
export function can_hear(
  observer_ref: string,
  observer_pos: TilePosition,
  target_pos: TilePosition
): boolean {
  const cone = get_vision_cone(observer_ref);
  const hearing_range = cone.range_tiles * HEARING_RANGE_MODIFIER;
  
  const distance = calculate_distance(observer_pos, target_pos);
  return distance <= hearing_range;
}

/**
 * Check perception with all applicable senses
 * Returns which senses can perceive the target
 */
export function check_perception_with_senses(
  observer_ref: string,
  observer_pos: TilePosition,
  target_pos: TilePosition,
  check_senses: SenseType[]
): { 
  can_perceive: boolean; 
  senses: SenseType[];
  distance: number;
} {
  const senses: SenseType[] = [];
  const distance = calculate_distance(observer_pos, target_pos);
  
  for (const sense of check_senses) {
    switch (sense) {
      case "light":
        if (can_see(observer_ref, observer_pos, target_pos)) {
          senses.push("light");
        }
        break;
      case "pressure":
        if (can_hear(observer_ref, observer_pos, target_pos)) {
          senses.push("pressure");
        }
        break;
      case "aroma":
        // Very short range - 3 tiles
        if (distance <= 3) {
          senses.push("aroma");
        }
        break;
      case "thaumic":
        // Magic sense - can penetrate walls, longer range
        if (distance <= 20) {
          senses.push("thaumic");
        }
        break;
    }
  }
  
  return {
    can_perceive: senses.length > 0,
    senses,
    distance
  };
}

/**
 * Get all tiles within vision cone
 * Useful for debugging and LOS checks
 */
export function get_cone_tiles(
  origin: TilePosition,
  direction: Direction,
  cone: VisionCone
): TilePosition[] {
  const tiles: TilePosition[] = [];
  const center_angle = direction_to_angle(direction);
  const half_angle_rad = (cone.angle_degrees * Math.PI) / 180 / 2;
  
  // Sample points in the cone using ray casting
  const steps_per_ring = 12; // Number of rays to cast
  
  for (let r = 1; r <= cone.range_tiles; r++) {
    const steps = Math.max(steps_per_ring, r * 2);
    
    for (let i = 0; i < steps; i++) {
      const angle_offset = (i / (steps - 1)) * half_angle_rad * 2 - half_angle_rad;
      const final_angle = center_angle + angle_offset;
      
      const x = Math.round(origin.x + Math.cos(final_angle) * r);
      const y = Math.round(origin.y + Math.sin(final_angle) * r);
      
      // Avoid duplicates
      if (!tiles.some(t => t.x === x && t.y === y)) {
        tiles.push({ x, y });
      }
    }
  }
  
  return tiles;
}

/**
 * Get hearing range tiles (circle around observer)
 */
export function get_hearing_tiles(
  origin: TilePosition,
  observer_ref: string
): TilePosition[] {
  const cone = get_vision_cone(observer_ref);
  const hearing_range = cone.range_tiles * HEARING_RANGE_MODIFIER;
  const tiles: TilePosition[] = [];
  
  // Generate circle around observer
  const circumference = Math.floor(2 * Math.PI * hearing_range);
  for (let i = 0; i < circumference; i++) {
    const angle = (i / circumference) * 2 * Math.PI;
    const x = Math.round(origin.x + Math.cos(angle) * hearing_range);
    const y = Math.round(origin.y + Math.sin(angle) * hearing_range);
    
    if (!tiles.some(t => t.x === x && t.y === y)) {
      tiles.push({ x, y });
    }
  }
  
  return tiles;
}

/**
 * Calculate distance between two positions
 */
function calculate_distance(from: TilePosition, to: TilePosition): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate angle from one position to another
 * Returns angle in radians
 */
function calculate_angle(from: TilePosition, to: TilePosition): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return Math.atan2(dy, dx);
}

/**
 * Normalize angle to range [-π, π]
 */
function normalize_angle(angle: number): number {
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;
  return angle;
}

/**
 * Check if target is in "blind spot" (directly behind observer)
 */
export function is_in_blind_spot(
  observer_pos: TilePosition,
  observer_direction: Direction,
  target_pos: TilePosition
): boolean {
  const angle_to_target = calculate_angle(observer_pos, target_pos);
  const observer_angle = direction_to_angle(observer_direction);
  
  // Calculate angle difference
  let angle_diff = Math.abs(normalize_angle(angle_to_target - observer_angle));
  
  // Behind is roughly 180 degrees (π radians)
  // Consider "behind" to be within 45 degrees of directly behind
  const behind_threshold = Math.PI * 0.75; // 135 degrees from facing
  
  return angle_diff > behind_threshold;
}

/**
 * Get perception info for debugging
 */
export function get_perception_debug_info(
  observer_ref: string,
  observer_pos: TilePosition,
  target_pos: TilePosition
): {
  can_see: boolean;
  can_hear: boolean;
  distance: number;
  in_blind_spot: boolean;
  vision_cone: VisionCone;
} {
  const vision = get_vision_cone(observer_ref);
  const facing = get_facing(observer_ref);
  const distance = calculate_distance(observer_pos, target_pos);
  
  return {
    can_see: can_see(observer_ref, observer_pos, target_pos),
    can_hear: can_hear(observer_ref, observer_pos, target_pos),
    distance,
    in_blind_spot: is_in_blind_spot(observer_pos, facing, target_pos),
    vision_cone: vision
  };
}
