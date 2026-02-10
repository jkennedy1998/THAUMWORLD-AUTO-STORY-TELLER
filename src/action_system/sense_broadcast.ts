/**
 * Action Sense Broadcasting System
 * 
 * Attaches sensory information to actions that determines how detectable they are.
 * Uses THAUMWORLD's 4 canonical senses:
 * - light: visual perception (sight)
 * - pressure: sound vibrations (hearing) + touch
 * - aroma: scent/smell
 * - thaumic: magic/essence detection
 * 
 * This integrates with the perception system to determine if observers can detect actions.
 */

import type { SenseType } from "./perception.js";
import { debug_log } from "../shared/debug.js";

/** Sense broadcast for a single sense */
export interface SenseBroadcast {
  sense: SenseType;           // One of: light, pressure, aroma, thaumic
  intensity: number;          // 1-10 scale (loudness/visibility)
  range_tiles: number;        // How far this sense travels
  directional: boolean;       // True only for light (requires facing)
  penetrates_walls: boolean;  // True for pressure, aroma, thaumic
}

/** Complete sense profile for an action */
export interface ActionSenseProfile {
  verb: string;
  subtype?: string;
  broadcasts: SenseBroadcast[];
  description: string;
}

/**
 * Action sense profiles
 * Defines how detectable each action is through different senses
 * 
 * KEY PRINCIPLES:
 * - light: Visual perception, directional, blocked by obstacles
 * - pressure: Sound (hearing) + vibrations (touch), omnidirectional
 * - aroma: Scent, omnidirectional, very short range
 * - thaumic: Magic detection, omnidirectional, penetrates walls
 */
export const ACTION_SENSE_PROFILES: Record<string, ActionSenseProfile> = {
  // COMMUNICATION - Uses light (mouth movement) and pressure (sound)
  // Default COMMUNICATE profile (used when no subtype specified)
  "COMMUNICATE": {
    verb: "COMMUNICATE",
    broadcasts: [
      {
        sense: "light",
        intensity: 3,
        range_tiles: 10,
        directional: true,
        penetrates_walls: false
      },
      {
        sense: "pressure",
        intensity: 5,
        range_tiles: 10,
        directional: false,
        penetrates_walls: true
      }
    ],
    description: "Normal conversation, visible and audible within 10 tiles"
  },
  
  "COMMUNICATE.WHISPER": {
    verb: "COMMUNICATE",
    subtype: "WHISPER",
    broadcasts: [
      {
        sense: "pressure",
        intensity: 2,
        range_tiles: 1,
        directional: false,
        penetrates_walls: true
      }
    ],
    description: "Very quiet, only audible to adjacent targets"
  },
  
  "COMMUNICATE.NORMAL": {
    verb: "COMMUNICATE",
    subtype: "NORMAL",
    broadcasts: [
      {
        sense: "light",
        intensity: 3,
        range_tiles: 3,
        directional: true,
        penetrates_walls: false
      },
      {
        sense: "pressure",
        intensity: 5,
        range_tiles: 3,
        directional: false,
        penetrates_walls: true
      }
    ],
    description: "Normal conversation, visible and audible within 3 tiles"
  },
  
  "COMMUNICATE.SHOUT": {
    verb: "COMMUNICATE",
    subtype: "SHOUT",
    broadcasts: [
      {
        sense: "light",
        intensity: 5,
        range_tiles: 10,
        directional: true,
        penetrates_walls: false
      },
      {
        sense: "pressure",
        intensity: 8,
        range_tiles: 10,
        directional: false,
        penetrates_walls: true
      }
    ],
    description: "Loud shouting, attracts attention from far away"
  },
  
  // MOVEMENT - Uses light (body visible) and pressure (footsteps)
  "MOVE.WALK": {
    verb: "MOVE",
    subtype: "WALK",
    broadcasts: [
      {
        sense: "light",
        intensity: 5,
        range_tiles: 12,
        directional: true,
        penetrates_walls: false
      },
      {
        sense: "pressure",
        intensity: 3,
        range_tiles: 5,
        directional: false,
        penetrates_walls: true
      }
    ],
    description: "Walking, visible at normal range, footsteps audible nearby"
  },
  
  "MOVE.SPRINT": {
    verb: "MOVE",
    subtype: "SPRINT",
    broadcasts: [
      {
        sense: "light",
        intensity: 7,
        range_tiles: 15,
        directional: true,
        penetrates_walls: false
      },
      {
        sense: "pressure",
        intensity: 6,
        range_tiles: 8,
        directional: false,
        penetrates_walls: true
      }
    ],
    description: "Running, highly visible, loud footsteps"
  },
  
  // COMBAT ACTIONS
  "USE.IMPACT_SINGLE": {
    verb: "USE",
    subtype: "IMPACT_SINGLE",
    broadcasts: [
      {
        sense: "light",
        intensity: 7,
        range_tiles: 8,
        directional: true,
        penetrates_walls: false
      },
      {
        sense: "pressure",
        intensity: 7,
        range_tiles: 6,
        directional: false,
        penetrates_walls: true
      }
    ],
    description: "Melee attack, visible weapon swing, combat sounds"
  },
  
  "USE.PROJECTILE_SINGLE": {
    verb: "USE",
    subtype: "PROJECTILE_SINGLE",
    broadcasts: [
      {
        sense: "light",
        intensity: 6,
        range_tiles: 10,
        directional: true,
        penetrates_walls: false
      },
      {
        sense: "pressure",
        intensity: 6,
        range_tiles: 8,
        directional: false,
        penetrates_walls: true
      }
    ],
    description: "Bow shot or thrown weapon, visible projectile, release sound"
  },
  
  // DAMAGE - Very loud/detectable
  "DAMAGE": {
    verb: "DAMAGE",
    broadcasts: [
      {
        sense: "light",
        intensity: 9,
        range_tiles: 15,
        directional: true,
        penetrates_walls: false
      },
      {
        sense: "pressure",
        intensity: 9,
        range_tiles: 15,
        directional: false,
        penetrates_walls: true
      },
      {
        sense: "aroma",
        intensity: 4,
        range_tiles: 3,
        directional: false,
        penetrates_walls: true
      }
    ],
    description: "Damage received, very visible, loud, may include blood scent"
  },
  
  // INSPECTION
  "INSPECT": {
    verb: "INSPECT",
    broadcasts: [
      {
        sense: "light",
        intensity: 4,
        range_tiles: 5,
        directional: true,
        penetrates_walls: false
      },
      {
        sense: "pressure",
        intensity: 2,
        range_tiles: 2,
        directional: false,
        penetrates_walls: true
      }
    ],
    description: "Inspecting something, subtle body language and sounds"
  },
  
  // ITEM INTERACTION
  "ITEM.DROP": {
    verb: "ITEM",
    subtype: "DROP",
    broadcasts: [
      {
        sense: "light",
        intensity: 4,
        range_tiles: 4,
        directional: true,
        penetrates_walls: false
      },
      {
        sense: "pressure",
        intensity: 4,
        range_tiles: 4,
        directional: false,
        penetrates_walls: true
      }
    ],
    description: "Dropping an item, visible, audible clatter"
  },
  
  "ITEM.PICKUP": {
    verb: "ITEM",
    subtype: "PICKUP",
    broadcasts: [
      {
        sense: "light",
        intensity: 3,
        range_tiles: 3,
        directional: true,
        penetrates_walls: false
      },
      {
        sense: "pressure",
        intensity: 2,
        range_tiles: 2,
        directional: false,
        penetrates_walls: true
      }
    ],
    description: "Picking up an item, subtle movement"
  },
  
  // MAGIC/ACTIONS WITH THAUMIC COMPONENT
  "CAST.SPELL": {
    verb: "CAST",
    subtype: "SPELL",
    broadcasts: [
      {
        sense: "light",
        intensity: 8,
        range_tiles: 20,
        directional: true,
        penetrates_walls: false
      },
      {
        sense: "pressure",
        intensity: 5,
        range_tiles: 10,
        directional: false,
        penetrates_walls: true
      },
      {
        sense: "thaumic",
        intensity: 10,
        range_tiles: 50,
        directional: false,
        penetrates_walls: true
      }
    ],
    description: "Casting a spell, highly visible, audible, detectable through walls via magic sense"
  }
};

/**
 * Get sense profile for an action
 * Returns null if no profile exists
 */
export function get_sense_profile(
  verb: string,
  subtype?: string
): ActionSenseProfile | null {
  // Try specific subtype first
  if (subtype) {
    const key = `${verb}.${subtype}`;
    if (ACTION_SENSE_PROFILES[key]) {
      return ACTION_SENSE_PROFILES[key];
    }
  }
  
  // Fall back to generic verb profile
  if (ACTION_SENSE_PROFILES[verb]) {
    return ACTION_SENSE_PROFILES[verb];
  }
  
  return null;
}

/**
 * Get sense broadcasts for an action
 * Returns empty array if no profile exists
 */
export function get_senses_for_action(
  verb: string,
  subtype?: string
): SenseBroadcast[] {
  const profile = get_sense_profile(verb, subtype);
  return profile?.broadcasts ?? [];
}

/**
 * Get the most prominent sense for an action
 * Used for quick perception checks
 */
export function get_primary_sense(
  verb: string,
  subtype?: string
): SenseBroadcast | null {
  const broadcasts = get_senses_for_action(verb, subtype);
  if (broadcasts.length === 0) return null;
  
  // Return the one with highest intensity
  return broadcasts.reduce((max, current) => 
    current.intensity > max.intensity ? current : max
  );
}

/**
 * Check if an action is detectable at a given distance
 * Uses the best available sense
 */
export function is_action_detectable(
  verb: string,
  subtype: string | undefined,
  distance_tiles: number
): { detectable: boolean; best_sense: SenseType | null } {
  const broadcasts = get_senses_for_action(verb, subtype);
  
  for (const broadcast of broadcasts) {
    if (distance_tiles <= broadcast.range_tiles) {
      return { detectable: true, best_sense: broadcast.sense };
    }
  }
  
  return { detectable: false, best_sense: null };
}

/**
 * Get intensity at a specific distance
 * Intensity falls off linearly with distance
 */
export function get_intensity_at_distance(
  broadcast: SenseBroadcast,
  distance_tiles: number
): number {
  if (distance_tiles > broadcast.range_tiles) return 0;
  
  // Linear falloff: intensity at distance = intensity * (1 - distance/range)
  const falloff = 1 - (distance_tiles / broadcast.range_tiles);
  return Math.max(1, Math.round(broadcast.intensity * falloff));
}

/**
 * Check if an action can be perceived through a specific sense
 */
export function can_perceive_with_sense(
  verb: string,
  subtype: string | undefined,
  sense: SenseType,
  distance_tiles: number
): { can_perceive: boolean; intensity: number } {
  const broadcasts = get_senses_for_action(verb, subtype);
  
  const match = broadcasts.find(b => b.sense === sense);
  if (!match) {
    return { can_perceive: false, intensity: 0 };
  }
  
  if (distance_tiles > match.range_tiles) {
    return { can_perceive: false, intensity: 0 };
  }
  
  const intensity = get_intensity_at_distance(match, distance_tiles);
  return { can_perceive: intensity > 0, intensity };
}

/**
 * Log sense broadcast for debugging
 */
export function log_sense_broadcast(
  entity_ref: string,
  verb: string,
  subtype: string | undefined,
  location: { x: number; y: number }
): void {
  const profile = get_sense_profile(verb, subtype);
  if (!profile) return;
  
  const sense_names = profile.broadcasts.map(b => 
    `${b.sense}(int:${b.intensity},rng:${b.range_tiles})`
  ).join(", ");
  
  debug_log("SenseBroadcast", `${entity_ref} ${verb}${subtype ? "." + subtype : ""} at (${location.x},${location.y}): ${sense_names}`);
}

/**
 * Get all sense types that can detect at a given range
 * Useful for perception checks
 */
export function get_senses_at_range(
  verb: string,
  subtype: string | undefined,
  distance_tiles: number
): SenseBroadcast[] {
  const broadcasts = get_senses_for_action(verb, subtype);
  return broadcasts.filter(b => distance_tiles <= b.range_tiles);
}

/**
 * Add or update a sense profile dynamically
 * Useful for modding or special actions
 */
export function register_sense_profile(
  key: string,
  profile: ActionSenseProfile
): void {
  ACTION_SENSE_PROFILES[key] = profile;
  debug_log("SenseBroadcast", `Registered sense profile: ${key}`);
}
