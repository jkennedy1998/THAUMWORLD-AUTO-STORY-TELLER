/**
 * Vision Presets
 * 
 * Defines standard vision cones for different entity types.
 * These can be overridden per-entity or extended with custom types.
 */

import type { VisionCone } from "./cone_of_vision.js";

/** Standard vision presets */
export const VISION_PRESETS: Record<string, VisionCone> = {
  /** Default humanoid vision - 120° cone, 12 tile range */
  humanoid: { angle_degrees: 120, range_tiles: 12 },
  
  /** Guard vision - wider cone (140°), longer range (15 tiles) */
  guard: { angle_degrees: 140, range_tiles: 15 },
  
  /** Animal vision - very wide (180°), shorter range (10 tiles) */
  animal: { angle_degrees: 180, range_tiles: 10 },
  
  /** Blind - no vision */
  blind: { angle_degrees: 0, range_tiles: 0 },
  
  /** Night creature - wide but short range */
  night_creature: { angle_degrees: 160, range_tiles: 8 },
  
  /** Scout/ranger - narrow but very long range */
  scout: { angle_degrees: 90, range_tiles: 20 },
};

/** 
 * Get vision preset by name
 * Returns humanoid as fallback
 */
export function get_vision_preset(name: string): VisionCone {
  return VISION_PRESETS[name] ?? { angle_degrees: 120, range_tiles: 12 };
}

/**
 * Check if a preset exists
 */
export function has_vision_preset(name: string): boolean {
  return name in VISION_PRESETS;
}

/**
 * Add or override a vision preset
 */
export function register_vision_preset(name: string, cone: VisionCone): void {
  VISION_PRESETS[name] = cone;
}

/**
 * Get all preset names
 */
export function get_vision_preset_names(): string[] {
  return Object.keys(VISION_PRESETS);
}
