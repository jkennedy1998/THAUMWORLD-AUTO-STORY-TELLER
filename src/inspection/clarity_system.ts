// Inspection Clarity System
// MAG-based distance calculations using THAUMWORLD tabletop rules

// Distance MAG Table (tiles)
// From https://www.thaumworld.xyz/magnitude/
export const DISTANCE_MAG_TABLE: Record<number, number> = {
  [-2]: 0,    // Pinpoint
  [-1]: 1,    // A few inches
  0: 1,       // Within 1 tile
  1: 1,       // Adjacent tile
  2: 3,       // 3 tiles away
  3: 5,       // 5 tiles away
  4: 10,      // 10 tiles away
  5: 30,      // 30 tiles away
  6: 100,     // 100 tiles away
  7: 300,     // Within 1 region tile
};

export type SenseType = "light" | "pressure" | "aroma" | "thaumic";
export type ClarityLevel = "clear" | "vague" | "obscured" | "none";

export interface Location {
  world_x: number;
  world_y: number;
  region_x: number;
  region_y: number;
  x?: number;
  y?: number;
}

/**
 * Calculate max clear distance MAG for a sense
 * 
 * LIGHT (sight): DISTANCE MAG = LIGHT MAG + 2
 * PRESSURE (hearing): DISTANCE MAG = PRESSURE MAG + 1
 * AROMA (smell): DISTANCE MAG = AROMA MAG + 1
 * THAUMIC (magic sense): DISTANCE MAG = THAUMIC MAG
 */
export function get_clear_range_magnitude(
  sense_type: SenseType,
  sense_mag: number
): number {
  switch (sense_type) {
    case "light":
      return sense_mag + 2;
    case "pressure":
    case "aroma":
      return sense_mag + 1;
    case "thaumic":
      return sense_mag;
  }
}

/**
 * Calculate distance in tiles between two locations
 */
export function calculate_distance(loc1: Location, loc2: Location): number {
  // If same region, use tile distance
  if (
    loc1.world_x === loc2.world_x &&
    loc1.world_y === loc2.world_y &&
    loc1.region_x === loc2.region_x &&
    loc1.region_y === loc2.region_y
  ) {
    if (
      loc1.x !== undefined &&
      loc1.y !== undefined &&
      loc2.x !== undefined &&
      loc2.y !== undefined
    ) {
      return Math.sqrt(
        Math.pow(loc1.x - loc2.x, 2) +
        Math.pow(loc1.y - loc2.y, 2)
      );
    }
  }

  // Different region - use approximate world distance
  // This is simplified - assumes 1000 tiles per world tile
  const world_dx = (loc1.world_x - loc2.world_x) * 1000;
  const world_dy = (loc1.world_y - loc2.world_y) * 1000;
  return Math.sqrt(world_dx * world_dx + world_dy * world_dy);
}

/**
 * Calculate inspection clarity based on distance and sense
 * 
 * Uses falloff rule: if you can sense clearly at DISTANCE MAG N,
 * you can sense at DISTANCE MAG N+1 with obscurity
 * 
 * @param distance_tiles - Distance in tiles
 * @param sense_type - Type of sense being used
 * @param sense_mag - Magnitude of the sense (e.g., 3 for human sight)
 * @param target_size_mag - Size magnitude of target (larger = easier to see)
 * @param wall_penalties - For thaumic sense (thin wall = -1, thick wall = -2)
 * @returns Clarity level
 */
export function calculate_clarity(
  distance_tiles: number,
  sense_type: SenseType,
  sense_mag: number,
  target_size_mag: number = 0,
  wall_penalties: number = 0
): ClarityLevel {
  // Get the max clear distance MAG
  let max_clear_mag = get_clear_range_magnitude(sense_type, sense_mag);

  // Apply wall penalties (for thaumic)
  if (sense_type === "thaumic") {
    max_clear_mag -= wall_penalties;
  }

  // Size modifier: larger targets easier to see
  // Each size MAG above 0 extends clear range by 1 MAG
  max_clear_mag += Math.max(0, target_size_mag);

  // Convert MAG to tiles
  const clear_range_tiles = DISTANCE_MAG_TABLE[max_clear_mag] ?? 1;
  const vague_range_tiles = DISTANCE_MAG_TABLE[max_clear_mag + 1] ?? 5;
  const obscured_range_tiles = DISTANCE_MAG_TABLE[max_clear_mag + 2] ?? 10;

  // Determine clarity
  if (distance_tiles <= clear_range_tiles) {
    return "clear";
  } else if (distance_tiles <= vague_range_tiles) {
    return "vague";
  } else if (distance_tiles <= obscured_range_tiles) {
    return "obscured";
  } else {
    return "none";
  }
}

/**
 * Get the best available sense for inspection
 * Returns the sense with the highest clarity at the given distance
 */
export function get_best_inspection_sense(
  distance_tiles: number,
  inspector_senses: Record<SenseType, number>,
  target_size_mag: number = 0
): { sense: SenseType; clarity: ClarityLevel } | null {
  const senses: SenseType[] = ["light", "pressure", "aroma", "thaumic"];
  let best_sense: SenseType | null = null;
  let best_clarity: ClarityLevel = "none";

  const clarity_priority: Record<ClarityLevel, number> = {
    clear: 3,
    vague: 2,
    obscured: 1,
    none: 0,
  };

  for (const sense of senses) {
    const sense_mag = inspector_senses[sense] ?? 0;
    const clarity = calculate_clarity(
      distance_tiles,
      sense,
      sense_mag,
      target_size_mag
    );

    if (clarity_priority[clarity] > clarity_priority[best_clarity]) {
      best_clarity = clarity;
      best_sense = sense;
    }
  }

  if (best_sense && best_clarity !== "none") {
    return { sense: best_sense, clarity: best_clarity };
  }

  return null;
}

// Example calculations:
// Human (MAG 3 sight) looking at normal chest (MAG 2 size) 8 tiles away:
// - Clear range MAG = 3 + 2 = 5 (30 tiles) + size bonus 2 = 7 (300 tiles)
// - Clear range tiles = 300, Vague = 1000, Obscured = 3000
// - At 8 tiles: CLEAR

// Human (MAG 3 hearing) listening at door 2 tiles away:
// - Clear range MAG = 3 + 1 = 4 (10 tiles)
// - At 2 tiles: CLEAR

// Human (MAG 0 thaumic) sensing through 1 thin wall (-1 penalty):
// - Clear range MAG = 0 - 1 = -1 (1 tile)
// - At 3 tiles: NONE (beyond 1 tile)
