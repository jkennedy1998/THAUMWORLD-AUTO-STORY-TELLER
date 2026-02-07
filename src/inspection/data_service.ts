// Inspection Data Service
// Main service for performing inspections on targets

import { calculate_clarity, calculate_distance, get_best_inspection_sense, type SenseType, type ClarityLevel, type Location } from "./clarity_system.js";
import { get_tile_definition } from "../tile_storage/store.js";
import type { TileFeature } from "../tile_storage/types.js";
import { debug_log } from "../shared/debug.js";

export interface InspectionTarget {
  type: "character" | "npc" | "tile" | "item";
  ref: string;
  body_slot?: string;
  place_id?: string;
  tile_position?: { x: number; y: number };
}

export interface InspectionFeature {
  id: string;
  name: string;
  description: string;
  discovered: boolean;
  hidden: boolean;
  clarity: ClarityLevel;
}

export interface InspectionResult {
  target: InspectionTarget;
  success: boolean;
  clarity: ClarityLevel;
  sense_used: SenseType;
  distance: number;
  requested_features: string[];
  random_features: string[];
  content: {
    short_description: string;
    full_description: string;
    features: InspectionFeature[];
    sensory_details: Record<string, string[]>;
  };
  cr_roll?: {
    roll: number;
    total: number;
    cr: number;
    success: boolean;
  };
}

export interface InspectorData {
  ref: string;
  location: Location;
  senses: {
    light: number;
    pressure: number;
    aroma: number;
    thaumic: number;
  };
  stats: Record<string, number>;
  profs: Record<string, number>;
}

// Default CR values from tabletop
const DEFAULT_CR = {
  TAKES_CONCENTRATION: 10,
  NOT_EASY: 15,
  VERY_HARD: 20,
};

/**
 * Perform an inspection on a target
 */
export async function inspect_target(
  inspector: InspectorData,
  target: InspectionTarget,
  options: {
    requested_keywords?: string[];
    max_features?: number;
    target_location?: Location;
    target_size_mag?: number;
  } = {}
): Promise<InspectionResult> {
  const max_features = options.max_features ?? 3;
  
  // Calculate distance if target location provided
  let distance = 0;
  if (options.target_location) {
    distance = calculate_distance(inspector.location, options.target_location);
  }

  // Get best sense and clarity
  const sense_result = get_best_inspection_sense(
    distance,
    inspector.senses,
    options.target_size_mag ?? 0
  );

  if (!sense_result || sense_result.clarity === "none") {
    return {
      target,
      success: false,
      clarity: "none",
      sense_used: "light",
      distance,
      requested_features: options.requested_keywords ?? [],
      random_features: [],
      content: {
        short_description: "You cannot perceive the target from here.",
        full_description: "",
        features: [],
        sensory_details: {}
      }
    };
  }

  debug_log("Inspection", `Proceeding with ${target.type} inspection using ${sense_result.sense} (${sense_result.clarity})`);

  // Perform inspection based on target type
  switch (target.type) {
    case "tile":
      return inspect_tile(inspector, target, sense_result.sense, sense_result.clarity, distance, options);
    case "character":
    case "npc":
      return inspect_character(inspector, target, sense_result.sense, sense_result.clarity, distance, options);
    case "item":
      return inspect_item(inspector, target, sense_result.sense, sense_result.clarity, distance, options);
    default:
      return {
        target,
        success: false,
        clarity: "none",
        sense_used: sense_result.sense,
        distance,
        requested_features: [],
        random_features: [],
        content: {
          short_description: "Unknown target type.",
          full_description: "",
          features: [],
          sensory_details: {}
        }
      };
  }
}

/**
 * Inspect a tile
 */
async function inspect_tile(
  inspector: InspectorData,
  target: InspectionTarget,
  sense_used: SenseType,
  clarity: ClarityLevel,
  distance: number,
  options: {
    requested_keywords?: string[];
    max_features?: number;
  }
): Promise<InspectionResult> {
  // Get tile definition
  const tile_id = target.ref;
  const tile_def = get_tile_definition(tile_id);

  if (!tile_def) {
    return {
      target,
      success: false,
      clarity,
      sense_used,
      distance,
      requested_features: options.requested_keywords ?? [],
      random_features: [],
      content: {
        short_description: "Unknown terrain.",
        full_description: "",
        features: [],
        sensory_details: {}
      }
    };
  }

  debug_log("Inspection", `Found tile definition: ${tile_def.name} (${tile_def.inspection.features.length} features)`);

  // Filter features based on clarity and sense
  const visible_features = tile_def.inspection.features.filter(f => {
    if (f.requires_sense !== sense_used) return false;
    if (clarity === "vague" && f.min_clarity === "clear") return false;
    if (clarity === "obscured" && f.min_clarity !== "obscured") return false;
    return true;
  });

  // Process features - check for hidden ones
  const processed_features: InspectionFeature[] = [];
  let cr_roll_result: { roll: number; total: number; cr: number; success: boolean } | undefined;

  for (const feature of visible_features) {
    let discovered = !feature.hidden;
    
    // Check if hidden feature is discovered
    if (feature.hidden && feature.discovery_cr && clarity !== "obscured") {
      const relevant_prof = feature.relevant_prof ?? "instinct";
      const relevant_stat = feature.relevant_stat ?? "wis";
      
      const prof_bonus = inspector.profs[relevant_prof] ?? 0;
      const stat_bonus = Math.floor(((inspector.stats[relevant_stat] ?? 50) - 50) / 10);
      const roll = Math.floor(Math.random() * 20) + 1;
      const total = roll + prof_bonus + stat_bonus;
      
      discovered = total >= feature.discovery_cr;
      
      if (!cr_roll_result) {
        cr_roll_result = {
          roll,
          total,
          cr: feature.discovery_cr,
          success: discovered
        };
      }
    }

    processed_features.push({
      id: feature.id,
      name: feature.name,
      description: feature.description,
      discovered,
      hidden: feature.hidden ?? false,
      clarity
    });
  }

  // Select features to show
  const requested: InspectionFeature[] = [];
  const random: InspectionFeature[] = [];

  if (options.requested_keywords && options.requested_keywords.length > 0) {
    // Prioritize requested features
    for (const feature of processed_features) {
      const matches_request = tile_def.inspection.features.find(
        f => f.id === feature.id && f.keywords.some(kw => 
          options.requested_keywords?.some(rk => rk.includes(kw) || kw.includes(rk))
        )
      );
      
      if (matches_request && feature.discovered) {
        requested.push(feature);
      } else if (feature.discovered) {
        random.push(feature);
      }
    }
  } else {
    // No specific request - show all discovered
    random.push(...processed_features.filter(f => f.discovered));
  }

  // Limit features
  const limited_random = random.slice(0, Math.max(0, (options.max_features ?? 3) - requested.length));

  // Build sensory details based on clarity
  const sensory_details: Record<string, string[]> = {};
  if (clarity === "clear") {
    sensory_details.light = tile_def.inspection.sensory.light ?? [];
    sensory_details.pressure = tile_def.inspection.sensory.pressure ?? [];
    sensory_details.aroma = tile_def.inspection.sensory.aroma ?? [];
    sensory_details.touch = tile_def.inspection.sensory.touch ?? [];
  } else if (clarity === "vague") {
    // Only primary sense details
    const sense_key = sense_used === "light" ? "light" : 
                     sense_used === "pressure" ? "pressure" :
                     sense_used === "aroma" ? "aroma" : undefined;
    if (sense_key && tile_def.inspection.sensory[sense_key]) {
      sensory_details[sense_key] = tile_def.inspection.sensory[sense_key] ?? [];
    }
  }

  return {
    target,
    success: true,
    clarity,
    sense_used,
    distance,
    requested_features: options.requested_keywords ?? [],
    random_features: limited_random.map(f => f.id),
    content: {
      short_description: tile_def.inspection.short,
      full_description: clarity === "clear" ? tile_def.inspection.full : "",
      features: [...requested, ...limited_random],
      sensory_details
    },
    cr_roll: cr_roll_result
  };
}

/**
 * Inspect a character/NPC
 */
async function inspect_character(
  inspector: InspectorData,
  target: InspectionTarget,
  sense_used: SenseType,
  clarity: ClarityLevel,
  distance: number,
  options: {
    requested_keywords?: string[];
    max_features?: number;
  }
): Promise<InspectionResult> {
  // TODO: Load character/NPC data and inspect
  // For now, return placeholder
  return {
    target,
    success: true,
    clarity,
    sense_used,
    distance,
    requested_features: options.requested_keywords ?? [],
    random_features: [],
    content: {
      short_description: `A figure at ${distance.toFixed(1)} tiles distance.`,
      full_description: clarity === "clear" ? "You can see them clearly now." : "",
      features: [],
      sensory_details: {}
    }
  };
}

/**
 * Inspect an item
 */
async function inspect_item(
  inspector: InspectorData,
  target: InspectionTarget,
  sense_used: SenseType,
  clarity: ClarityLevel,
  distance: number,
  options: {
    requested_keywords?: string[];
    max_features?: number;
  }
): Promise<InspectionResult> {
  // TODO: Load item data and inspect
  // For now, return placeholder
  return {
    target,
    success: true,
    clarity,
    sense_used,
    distance,
    requested_features: options.requested_keywords ?? [],
    random_features: [],
    content: {
      short_description: `An item at ${distance.toFixed(1)} tiles distance.`,
      full_description: clarity === "clear" ? "You can see it clearly now." : "",
      features: [],
      sensory_details: {}
    }
  };
}

/**
 * Format inspection result for display
 */
export function format_inspection_result(result: InspectionResult): string {
  let output = `INSPECTION RESULT:\n`;
  output += `Target: ${result.target.ref}\n`;
  output += `Clarity: ${result.clarity} (${result.distance.toFixed(1)} tiles away)\n`;
  output += `Sense: ${result.sense_used}\n\n`;
  
  output += `${result.content.short_description}\n\n`;
  
  if (result.content.full_description) {
    output += `${result.content.full_description}\n\n`;
  }
  
  if (result.content.features.length > 0) {
    output += `NOTABLE FEATURES:\n`;
    for (const feature of result.content.features) {
      if (!feature.discovered) continue;
      
      const quality_prefix = feature.clarity === "vague" 
        ? "You vaguely make out: " 
        : "";
      output += `- ${quality_prefix}${feature.description}\n`;
    }
    output += `\n`;
  }
  
  if (Object.keys(result.content.sensory_details).length > 0) {
    output += `SENSORY DETAILS:\n`;
    for (const [sense, details] of Object.entries(result.content.sensory_details)) {
      if (details.length > 0) {
        output += `${sense}: ${details.join(", ")}\n`;
      }
    }
  }
  
  if (result.cr_roll) {
    output += `\n[Discovery Roll: ${result.cr_roll.roll} + bonuses = ${result.cr_roll.total} vs CR ${result.cr_roll.cr} - ${result.cr_roll.success ? "SUCCESS" : "FAILED"}]\n`;
  }
  
  return output;
}
