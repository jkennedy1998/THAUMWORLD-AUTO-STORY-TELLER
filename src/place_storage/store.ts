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
import { ensure_place_tiles, ensure_place_entities_not_on_walls } from "./tiles.js";
import { resolve_place_tile } from "../tile_storage/resolve.js";
import { rotate_offset_xy } from "../shared/body_model.js";
import { sanitize_place_for_save } from "../shared/defs_deltas_sanitize.js";
import { normalize_ground_scattered } from "./ground_store.js";

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
    
    // defs+deltas migration: scrub any persisted derived/legacy inline fields on load.
    // This keeps places authoritative and stable even if older files had embedded display/tags.
    let dirty = false;

    // Ensure ground storage is initialized (Phase 5)
    if (!place.ground) {
      place.ground = {
        main: [],
        scattered: {}
      };
      dirty = true;
    }

    // Breath timekeeping defaults (movement + aging).
    // These fields are server-authoritative and are safe to persist.
    try {
      if (typeof (place as any).breath_index !== 'number' || !Number.isFinite((place as any).breath_index)) {
        (place as any).breath_index = 0;
        dirty = true;
      }
      if (typeof (place as any).breath_last_processed !== 'number' || !Number.isFinite((place as any).breath_last_processed)) {
        (place as any).breath_last_processed = Number((place as any).breath_index ?? 0) || 0;
        dirty = true;
      }
      if (typeof (place as any).breath_last_processed_ms !== 'number' || !Number.isFinite((place as any).breath_last_processed_ms)) {
        (place as any).breath_last_processed_ms = Date.now();
        dirty = true;
      }
    } catch {
      // ignore
    }
    try {
      const scrubbed = sanitize_place_for_save(place as any);
      if (scrubbed) dirty = true;
    } catch {
      // ignore
    }

    // 3dification: migrate ground scattered keys to voxel keys (x_y_z).
    try {
      const migrated = normalize_ground_scattered(place as any);
      if (migrated) dirty = true;
    } catch {
      // ignore
    }

    // Ensure tiles exist and are consistent with connections (Phase 0.7+).
    // Also keep default_entry/entities off the wall ring.
    const t = ensure_place_tiles(place);
    if (t.changed) dirty = true;
    const e = ensure_place_entities_not_on_walls(place);
    if (e.changed) dirty = true;

    // Augment tiles + structure instances with derived/runtime fields so downstream
    // systems (movement/occupancy) can consult effective tags without loading defs.
    try {
      const augment_tiles = (tiles_obj: any) => {
        if (!tiles_obj || !Array.isArray(tiles_obj.cells)) return;
        for (const row of tiles_obj.cells) {
          if (!Array.isArray(row)) continue;
          for (const tile of row) {
            if (!tile || !tile.kind) continue;
            const r = resolve_place_tile(String(tile.kind), tile as any);
            if (!r) continue;
            (tile as any).tags = r.effective_tags;
            (tile as any).__derived_runtime = true;
          }
        }
      };
      augment_tiles((place as any).tiles_z0);
      augment_tiles((place as any).tiles);

      const structs = (place as any).structures;
      if (Array.isArray(structs)) {
        for (const s of structs) {
          if (!s || typeof s !== 'object') continue;
          const def_id = String((s as any).def_id ?? '');
          if (!def_id) continue;

          // Reuse tile resolver (tags + display) with tag deltas.
          const r = resolve_place_tile(def_id, {
            kind: def_id,
            tag_add: (s as any).tag_add,
            tag_remove: (s as any).tag_remove,
          } as any);
          if (!r) continue;

          (s as any).display_char = r.display_char;
          (s as any).display_color = r.display_color;
          (s as any).tags = r.effective_tags;
          (s as any).container_glyphs = r.container_glyphs ?? null;

          const bm = (r.def as any)?.body_model;
          const phys_raw = Array.isArray(bm?.physical) ? bm.physical : null;
          const phys = (phys_raw && phys_raw.length > 0)
            ? phys_raw
            : [{ part: 'body', dx: 0, dy: 0, dz: 0 }];

          const facing = (() => {
            const f = String((s as any)?.facing ?? '').toLowerCase();
            if (f === 'north' || f === 'east' || f === 'south' || f === 'west') return f;
            return null;
          })();

          const effective_tags = Array.isArray(r.effective_tags) ? r.effective_tags : [];
          (s as any).body_model = {
            anchor_part: typeof bm?.anchor_part === 'string' ? String(bm.anchor_part) : undefined,
            physical: phys.map((v: any) => ({
              part: String(v?.part ?? 'body'),
              ...(() => {
                const o = rotate_offset_xy(Number(v?.dx ?? 0), Number(v?.dy ?? 0), facing as any);
                return { dx: o.dx, dy: o.dy };
              })(),
              dz: Number(v?.dz ?? 0),
              tags: [...effective_tags, ...(Array.isArray(v?.tags) ? v.tags : [])],
            })),
          };
          (s as any).__derived_runtime = true;
        }
      }
    } catch {
      // ignore
    }
    if (dirty) {
      // Persist once so subsequent loads are stable.
      save_place(slot, place);
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

  // defs+deltas migration: strip derived/legacy inline fields before persisting.
  // (Important because some API paths augment tiles/items for UI and may later save.)
  sanitize_place_for_save(place as any);
  
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
    breath_index: 0,
    breath_last_processed: 0,
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
    structures: [],
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
