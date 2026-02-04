/**
 * Place Storage Module
 * 
 * Handles loading, saving, and managing place data files.
 * Places are stored as individual JSONC files in the places/ directory.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "jsonc-parser";
import type { Place, PlaceResult, PlaceListResult } from "../types/place.js";
import { get_data_slot_dir } from "../engine/paths.js";

const PLACES_DIR = "places";

/**
 * Get the path to the places directory for a data slot
 */
function get_places_dir(slot: number): string {
  return path.join(get_data_slot_dir(slot), PLACES_DIR);
}

/**
 * Get the full path to a place file
 */
function get_place_path(slot: number, place_id: string): string {
  return path.join(get_places_dir(slot), `${place_id}.jsonc`);
}

/**
 * Ensure the places directory exists
 */
function ensure_places_dir(slot: number): void {
  const dir = get_places_dir(slot);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Load a place from storage
 */
export function load_place(slot: number, place_id: string): PlaceResult {
  try {
    const place_path = get_place_path(slot, place_id);
    
    if (!fs.existsSync(place_path)) {
      return {
        ok: false,
        error: `place_not_found`,
        details: `Place '${place_id}' does not exist at ${place_path}`
      };
    }
    
    const raw = fs.readFileSync(place_path, "utf-8");
    const parsed = parse(raw) as unknown;
    
    // Validate schema version
    const place = parsed as Place;
    if (place.schema_version !== 1) {
      return {
        ok: false,
        error: `invalid_schema_version`,
        details: `Expected schema_version 1, got ${place.schema_version}`
      };
    }
    
    // Validate required fields
    if (!place.id || !place.name || !place.region_id) {
      return {
        ok: false,
        error: `missing_required_fields`,
        details: `Place missing id, name, or region_id`
      };
    }
    
    return {
      ok: true,
      place,
      path: place_path
    };
  } catch (err) {
    return {
      ok: false,
      error: `load_failed`,
      details: err instanceof Error ? err.message : String(err)
    };
  }
}

/**
 * Save a place to storage
 */
export function save_place(slot: number, place: Place): string {
  ensure_places_dir(slot);
  const place_path = get_place_path(slot, place.id);
  
  fs.writeFileSync(
    place_path,
    JSON.stringify(place, null, 2),
    "utf-8"
  );
  
  return place_path;
}

/**
 * Check if a place exists
 */
export function place_exists(slot: number, place_id: string): boolean {
  const place_path = get_place_path(slot, place_id);
  return fs.existsSync(place_path);
}

/**
 * List all places in a data slot
 */
export function list_all_places(slot: number): PlaceListResult {
  try {
    const places_dir = get_places_dir(slot);
    
    if (!fs.existsSync(places_dir)) {
      return { ok: true, places: [] };
    }
    
    const files = fs.readdirSync(places_dir);
    const places = files
      .filter(f => f.endsWith('.jsonc'))
      .map(f => f.replace('.jsonc', ''));
    
    return { ok: true, places };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

/**
 * List places in a specific region
 */
export function list_places_in_region(slot: number, region_id: string): PlaceListResult {
  const all_result = list_all_places(slot);
  
  if (!all_result.ok) {
    return all_result;
  }
  
  // Filter places by region_id
  const region_places: string[] = [];
  
  for (const place_id of all_result.places) {
    const place_result = load_place(slot, place_id);
    if (place_result.ok && place_result.place.region_id === region_id) {
      region_places.push(place_id);
    }
  }
  
  return { ok: true, places: region_places };
}

/**
 * Delete a place (use with caution)
 */
export function delete_place(slot: number, place_id: string): boolean {
  try {
    const place_path = get_place_path(slot, place_id);
    if (fs.existsSync(place_path)) {
      fs.unlinkSync(place_path);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Get the default place for a region
 */
export function get_default_place_for_region(
  slot: number,
  region_id: string
): PlaceResult {
  const places_result = list_places_in_region(slot, region_id);
  
  if (!places_result.ok) {
    return {
      ok: false,
      error: places_result.error,
      details: `Failed to list places for region ${region_id}`
    };
  }
  
  if (places_result.places.length === 0) {
    return {
      ok: false,
      error: `no_places_in_region`,
      details: `Region ${region_id} has no places`
    };
  }
  
  // Find the default place
  for (const place_id of places_result.places) {
    const place_result = load_place(slot, place_id);
    if (place_result.ok && place_result.place.is_default) {
      return place_result;
    }
  }
  
  // No default marked, return first place
  return load_place(slot, places_result.places[0]!);
}

/**
 * Create a basic place (helper for migration/testing)
 */
export function create_basic_place(
  slot: number,
  region_id: string,
  place_id: string,
  name: string,
  options?: {
    is_default?: boolean;
    width?: number;
    height?: number;
  }
): PlaceResult {
  const width = options?.width ?? 20;
  const height = options?.height ?? 20;
  
  const place: Place = {
    schema_version: 1,
    id: place_id,
    name: name,
    region_id: region_id,
    coordinates: {
      world_tile: { x: 0, y: 0 }, // Will be updated from region
      region_tile: { x: 0, y: 0 },
      elevation: 0
    },
    tile_grid: {
      width: width,
      height: height,
      default_entry: {
        x: Math.floor(width / 2),
        y: Math.floor(height / 2)
      }
    },
    connections: [],
    environment: {
      lighting: "bright",
      terrain: "dirt",
      cover_available: [],
      temperature_offset: 0
    },
    contents: {
      npcs_present: [],
      actors_present: [],
      items_on_ground: [],
      features: []
    },
    is_public: true,
    is_default: options?.is_default ?? false,
    description: {
      short: name,
      full: `A place within ${region_id}`,
      sensory: {
        sight: [],
        sound: [],
        smell: [],
        touch: []
      }
    }
  };
  
  const path = save_place(slot, place);
  
  return {
    ok: true,
    place,
    path
  };
}
