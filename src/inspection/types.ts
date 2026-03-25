import type { ClarityLevel, SenseType, Location } from "./clarity_system.js";

export type InspectTargetKind =
  | "character"
  | "npc"
  | "item"
  | "item_pile"
  | "structure"
  | "tile"
  | "place"
  | "adjacent_place";

export type InspectIncludeFlag =
  | "identity"
  | "material"
  | "condition"
  | "function"
  | "relations"
  | "surrounding_tiles"
  | "nearby_entities"
  | "place_context"
  | "region_context"
  | "temperature"
  | "light"
  | "weather"
  | "supporting_surface"
  | "multitile_owner"
  | "contents"
  | "equipment"
  | "activity"
  | "hidden";

export type InspectSeed = {
  id: string;
  text: string;
  include_if?: InspectIncludeFlag[];
  senses?: Array<SenseType | "touch">;
  min_clarity?: ClarityLevel;
  priority?: number;
};

export type InspectFeatureDef = {
  id: string;
  text: string;
  keywords?: string[];
  include_if?: InspectIncludeFlag[];
  senses?: Array<SenseType | "touch">;
  min_clarity?: ClarityLevel;
  hidden?: boolean;
  discovery_cr?: number;
  relevant_prof?: string;
  relevant_stat?: string;
};

export type InspectProfile = {
  short?: string;
  full?: string;
  include_defaults?: InspectIncludeFlag[];
  sensory?: Partial<Record<SenseType | "touch", string[]>>;
  helper_seeds?: InspectSeed[];
  features?: InspectFeatureDef[];
};

export type InspectProfileDiff = {
  short_override?: string;
  short_append?: string[];
  full_append?: string[];
  include_add?: InspectIncludeFlag[];
  include_remove?: InspectIncludeFlag[];
  sensory_add?: Partial<Record<SenseType | "touch", string[]>>;
  helper_seeds_add?: InspectSeed[];
  helper_seeds_remove?: string[];
  feature_add?: InspectFeatureDef[];
  feature_remove?: string[];
  feature_patch?: Array<Partial<InspectFeatureDef> & { id: string }>;
};

export interface InspectionTarget {
  type: InspectTargetKind;
  ref: string;
  body_slot?: string;
  place_id?: string;
  tile_position?: { x: number; y: number; z?: number };
}

export interface InspectionFeature {
  id: string;
  name: string;
  description: string;
  discovered: boolean;
  hidden: boolean;
  clarity: ClarityLevel;
}

export interface InspectionNarrationContext {
  actor_pov: string;
  primary_subject: string;
  target_kind: InspectTargetKind;
  scene_focus?: string;
  selected_facts: string[];
  nearby_facts: string[];
  guidance: string[];
  seed: number;
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
  narration_context?: InspectionNarrationContext;
}

export interface InspectorData {
  ref: string;
  data_slot?: number;
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
