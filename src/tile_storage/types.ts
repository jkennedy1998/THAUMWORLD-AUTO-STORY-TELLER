// Tile Storage Types
// Type definitions for tile database (mirrors item_storage pattern)

import type { TagInstance } from "../tag_system/registry.js";
import type { BodyModelVoxel } from "../shared/body_model.js";
import type { RenderShaderBindings } from "../render_shaders/definitions.js";
import type { InspectFeatureDef, InspectProfile } from "../inspection/types.js";

export type TileCategory = "structures" | "foliage" | "terrain" | "water" | "features" | "special";

export type TileSenseType = "light" | "pressure" | "aroma" | "thaumic";

export type ClarityLevel = "clear" | "vague" | "obscured";

export type TileFeature = InspectFeatureDef & {
  name?: string;
  description?: string;
  requires_sense?: TileSenseType;
};

export type TileInspection = InspectProfile;

export interface TileDefinition {
    id: string;                    // Unique identifier
    name: string;                  // Display name
    description: string;           // Flavor text
    weight: number;                // Base physical weight for tile physics
    
    // Visual properties
    display_char: string;          // Single char for UI
    display_color: string;         // Hex color or named color
    render_shader?: RenderShaderBindings;
    
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
