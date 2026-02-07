// Tile Storage Types
// Type definitions for tile databank system

export type TileCategory = "floor" | "wall" | "obstacle" | "terrain" | "water" | "decoration";

export type TileSenseType = "light" | "pressure" | "aroma" | "thaumic";

export type ClarityLevel = "clear" | "vague" | "obscured";

export interface TileDisplay {
  char: string;
  color: string;
  variant_chars?: string[];
  animation?: string | null;
}

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
  sensory: {
    light?: string[];
    pressure?: string[];
    aroma?: string[];
    thaumic?: string[];
    touch?: string[];
  };
}

export interface TileInteraction {
  verb: string;
  description: string;
  yields?: string[];
  time_seconds?: number;
  requires_tool?: string;
}

export interface TileDefinition {
  id: string;
  name: string;
  category: TileCategory;
  display: TileDisplay;
  walkable: boolean;
  blocks_sight: boolean;
  blocks_sound: boolean;
  inspection: TileInspection;
  interactions?: TileInteraction[];
  tags: string[];
}

export interface TileDatabank {
  schema_version: number;
  tiles: TileDefinition[];
}
