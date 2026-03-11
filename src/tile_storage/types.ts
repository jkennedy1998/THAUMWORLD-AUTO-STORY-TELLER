// Tile Storage Types
// Type definitions for tile database (mirrors item_storage pattern)

import type { TagInstance } from "../tag_system/registry.js";
import type { BodyModelVoxel } from "../shared/body_model.js";

export type TileCategory = "structures" | "foliage" | "terrain" | "water" | "features" | "special";

export type TileSenseType = "light" | "pressure" | "aroma" | "thaumic";

export type ClarityLevel = "clear" | "vague" | "obscured";

export interface TileFeature {
  id: string;
  name: string;
  keywords: string[];
  description: string;
  requires_sense: TileSenseType;
  min_clarity: ClarityLevel;
  hidden?: boolean;
  discovery_cr?: number;
  relevant_prof?: string;
  relevant_stat?: string;
}

export interface TileInspection {
  short: string;
  full: string;
  features: TileFeature[];
  sensory?: {
    light?: string[];
    pressure?: string[];
    aroma?: string[];
    thaumic?: string[];
    touch?: string[];
  };
}

export interface TileDefinition {
    id: string;                    // Unique identifier
    name: string;                  // Display name
    description: string;           // Flavor text
    
    // Visual properties
    display_char: string;          // Single char for UI
    display_color: string;         // Hex color or named color
    
    // Tags drive all behavior
    tags: TagInstance[];           // System tags (OCCUPIES, CONTAINER, GROW, etc.)
    
    // Optional container capacity (for tiles with CONTAINER tag)
    container_capacity?: {
        max_slots?: number;
        max_weight?: number;
    };
    
    // Optional container glyphs (for tiles with CONTAINER tag)
    container_glyphs?: {
        closed: string;
        open: string;
    };
    
    // Optional inspection data (for rich inspectable tiles)
    inspection?: TileInspection;

    // Optional multi-voxel body model for structure instances.
    // When absent, the definition is treated as a single voxel at the origin.
    body_model?: {
      anchor_part?: string;
      physical: BodyModelVoxel[];
    };
}

export type TileDefLookupResult =
    | { ok: true; tile: TileDefinition; path: string }
    | { ok: false; error: string; todo: string };
