/**
 * Place Storage Module
 * 
 * Handles loading, saving, and managing place data files.
 * Places are stored as individual JSONC files in the places/ directory.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "jsonc-parser";
import type { Place, PlaceResult, PlaceListResult, PlaceConnector, PlaceConnectorDirection, PlaceRegionBounds } from "../types/place.js";
import { get_data_slot_dir } from "../engine/paths.js";
import { ensure_place_tiles, ensure_place_entities_not_on_walls } from "./tiles.js";
import { resolve_place_tile } from "../tile_storage/resolve.js";
import { rotate_offset_xy } from "../shared/body_model.js";
import { compute_adjacent_place_bounds, region_bounds_overlap as shared_region_bounds_overlap } from "../shared/place_adjacency.js";
import { sanitize_place_for_save } from "../shared/defs_deltas_sanitize.js";
import { normalize_ground_scattered } from "./ground_normalize.js";

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

function get_tile_layer_offset_from_key(key: string): number | null {
  if (key === "tiles") return 0;
  if (key === "tiles_z0") return -1;
  const m = /^tiles_z(-?\d+)$/.exec(String(key ?? ""));
  if (!m) return null;
  const offset = Math.floor(Number(m[1]));
  return Number.isFinite(offset) ? offset : null;
}

function normalize_place_region_bounds_to_content(place: Place): { changed: boolean; used_min_z: number; used_max_z: number } {
  const base_z = Math.floor(Number(place.region_bounds?.origin?.z ?? place.coordinates?.elevation ?? 0)) || 0;
  let used_min_z = base_z;
  let used_max_z = base_z + Math.max(1, Math.floor(Number(place.region_bounds?.size?.z ?? 1)) || 1) - 1;

  for (const key of Object.keys(place as any)) {
    const offset = get_tile_layer_offset_from_key(key);
    if (offset === null) continue;
    const layer = (place as any)[key];
    if (!layer || !Array.isArray(layer.cells)) continue;
    const has_any = layer.cells.some((row: any) => Array.isArray(row) && row.some((cell: any) => !!cell && String(cell?.kind ?? "").trim().length > 0));
    if (!has_any) continue;
    const wz = base_z + offset;
    used_min_z = Math.min(used_min_z, wz);
    used_max_z = Math.max(used_max_z, wz);
  }

  for (const actor of place.contents?.actors_present ?? []) {
    const wz = Math.floor(Number((actor as any)?.elevation ?? (actor as any)?.tile_position?.z ?? base_z));
    if (!Number.isFinite(wz)) continue;
    used_min_z = Math.min(used_min_z, wz);
    used_max_z = Math.max(used_max_z, wz);
  }
  for (const npc of place.contents?.npcs_present ?? []) {
    const wz = Math.floor(Number((npc as any)?.elevation ?? (npc as any)?.tile_position?.z ?? base_z));
    if (!Number.isFinite(wz)) continue;
    used_min_z = Math.min(used_min_z, wz);
    used_max_z = Math.max(used_max_z, wz);
  }
  for (const structure of (place as any)?.structures ?? []) {
    const oz = Math.floor(Number((structure as any)?.origin?.z ?? base_z));
    if (!Number.isFinite(oz)) continue;
    used_min_z = Math.min(used_min_z, oz);
    used_max_z = Math.max(used_max_z, oz);
    const phys = Array.isArray((structure as any)?.body_model?.physical) ? (structure as any).body_model.physical : [{ dz: 0 }];
    for (const voxel of phys) {
      const vz = oz + (Math.floor(Number((voxel as any)?.dz ?? 0)) || 0);
      used_min_z = Math.min(used_min_z, vz);
      used_max_z = Math.max(used_max_z, vz);
    }
  }
  const scattered = (place as any)?.ground?.scattered ?? {};
  for (const key of Object.keys(scattered)) {
    const m = /^-?\d+_-?\d+_(-?\d+)$/.exec(String(key));
    if (!m) continue;
    const items = (scattered as any)[key];
    if (!Array.isArray(items) || items.length < 1) continue;
    const wz = Math.floor(Number(m[1]));
    if (!Number.isFinite(wz)) continue;
    used_min_z = Math.min(used_min_z, wz);
    used_max_z = Math.max(used_max_z, wz);
  }

  const next_origin_z = used_min_z;
  const next_size_z = Math.max(1, used_max_z - used_min_z + 1);
  const changed = next_origin_z !== place.region_bounds!.origin.z || next_size_z !== place.region_bounds!.size.z || Math.floor(Number(place.coordinates?.elevation ?? next_origin_z)) !== next_origin_z;
  if (changed) {
    place.region_bounds!.origin.z = next_origin_z;
    place.region_bounds!.size.z = next_size_z;
    if (!place.coordinates) {
      (place as any).coordinates = { world_tile: { x: 0, y: 0 }, region_tile: { x: 0, y: 0 }, elevation: next_origin_z };
    }
    place.coordinates.elevation = next_origin_z;
  }
  return { changed, used_min_z, used_max_z };
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
    if (place.schema_version !== 1 && place.schema_version !== 2) {
      return {
        ok: false,
        error: `invalid_schema_version`,
        details: `Expected schema_version 1 or 2, got ${place.schema_version}`
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

    if (!place.region_bounds) {
      place.region_bounds = {
        origin: { x: 0, y: 0, z: Math.floor(Number(place.coordinates?.elevation ?? 0)) || 0 },
        size: {
          x: Math.max(1, Math.floor(Number(place.tile_grid?.width ?? 1)) || 1),
          y: Math.max(1, Math.floor(Number(place.tile_grid?.height ?? 1)) || 1),
          z: 1,
        },
      };
      dirty = true;
    }
    const normalized_bounds = normalize_place_region_bounds_to_content(place);
    if (normalized_bounds.changed) dirty = true;
    if (!Array.isArray(place.place_connectors)) {
      place.place_connectors = [];
      dirty = true;
    }
    if (!Array.isArray(place.region_connectors)) {
      place.region_connectors = [];
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
            (tile as any).display_char = r.display_char;
            (tile as any).display_color = r.display_color;
            (tile as any).container_glyphs = r.container_glyphs ?? null;
            (tile as any).render_shader = r.render_shader ?? undefined;
            (tile as any).__derived_runtime = true;
          }
        }
      };
      for (const key of Object.keys(place as any)) {
        if (key === 'tiles' || /^tiles_z-?\d+$/.test(key)) {
          augment_tiles((place as any)[key]);
        }
      }

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
          (s as any).render_shader = r.render_shader ?? undefined;

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
  const persisted = JSON.parse(JSON.stringify(place)) as Place;
  normalize_place_region_bounds_to_content(persisted);

  // defs+deltas migration: strip derived/legacy inline fields before persisting.
  // (Important because some API paths augment tiles/items for UI and may later save.)
  sanitize_place_for_save(persisted as any);
  
  fs.writeFileSync(
    place_path,
    JSON.stringify(persisted, null, 2),
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
    schema_version: 2,
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
    region_bounds: {
      origin: { x: 0, y: 0, z: 0 },
      size: { x: width, y: height, z: 1 },
    },
    place_connectors: [],
    region_connectors: [],
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

export type RegionPlaceRecord = {
  place_id: string;
  bounds: PlaceRegionBounds;
};

export function list_region_place_records(slot: number, region_id: string): { ok: true; places: RegionPlaceRecord[] } | { ok: false; error: string } {
  const places_res = list_places_in_region(slot, region_id);
  if (!places_res.ok) return { ok: false, error: places_res.error };
  const places: RegionPlaceRecord[] = [];
  for (const place_id of places_res.places) {
    const place_res = load_place(slot, place_id);
    if (!place_res.ok) continue;
    if (!place_res.place.region_bounds) continue;
    places.push({ place_id, bounds: place_res.place.region_bounds });
  }
  return { ok: true, places };
}

export function region_bounds_overlap(a: PlaceRegionBounds, b: PlaceRegionBounds): boolean {
  return shared_region_bounds_overlap(a, b);
}

export function region_bounds_conflict(slot: number, region_id: string, proposed: PlaceRegionBounds, exclude_place_id?: string): { conflict: false } | { conflict: true; place_id: string; existing_bounds?: PlaceRegionBounds } {
  const records_res = list_region_place_records(slot, region_id);
  if (!records_res.ok) return { conflict: false };
  for (const rec of records_res.places) {
    if (exclude_place_id && rec.place_id === exclude_place_id) continue;
    if (region_bounds_overlap(rec.bounds, proposed)) return { conflict: true, place_id: rec.place_id, existing_bounds: rec.bounds };
  }
  return { conflict: false };
}

function direction_delta(direction: PlaceConnectorDirection): { x: number; y: number; z: number } {
  if (direction === "x+") return { x: 1, y: 0, z: 0 };
  if (direction === "x-") return { x: -1, y: 0, z: 0 };
  if (direction === "y+") return { x: 0, y: 1, z: 0 };
  if (direction === "y-") return { x: 0, y: -1, z: 0 };
  if (direction === "z+") return { x: 0, y: 0, z: 1 };
  return { x: 0, y: 0, z: -1 };
}

export function compute_connected_place_bounds(origin_place: Place, border_tile: { x: number; y: number; z: number }, direction: PlaceConnectorDirection, new_size: { x: number; y: number; z: number }): PlaceRegionBounds {
  return compute_adjacent_place_bounds(origin_place, border_tile, direction, new_size);
}

export function create_place_connector_record(source_place: Place, target_place_id: string, border_tile: { x: number; y: number; z: number }, direction: PlaceConnectorDirection, target_size: { x: number; y: number; z: number }, aperture_size?: { x?: number; z?: number }, target_base_z_world?: number): PlaceConnector {
  const source_width = Math.max(1, Math.floor(Number(source_place.tile_grid?.width ?? 1)) || 1);
  const source_height = Math.max(1, Math.floor(Number(source_place.tile_grid?.height ?? 1)) || 1);
  const target_width = Math.max(1, Math.floor(Number(target_size.x ?? 1)) || 1);
  const target_height = Math.max(1, Math.floor(Number(target_size.y ?? 1)) || 1);
  const target_depth = Math.max(1, Math.floor(Number(target_size.z ?? 1)) || 1);
  const aperture_w = Math.max(1, Math.floor(Number(aperture_size?.x ?? 1)) || 1);
  const aperture_h = Math.max(1, Math.floor(Number(aperture_size?.z ?? 4)) || 4);
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const source_x0 = clamp(Math.floor(border_tile.x - Math.floor(aperture_w / 2)), 0, Math.max(0, source_width - aperture_w));
  const source_y0 = clamp(Math.floor(border_tile.y - Math.floor(aperture_w / 2)), 0, Math.max(0, source_height - aperture_w));
  const source_z0 = Math.floor(border_tile.z);
  const target_x0_center = clamp(Math.floor(Math.floor(target_width / 2) - Math.floor(aperture_w / 2)), 0, Math.max(0, target_width - aperture_w));
  const target_y0_center = clamp(Math.floor(Math.floor(target_height / 2) - Math.floor(aperture_w / 2)), 0, Math.max(0, target_height - aperture_w));
  const source_base_z = Math.floor(Number((source_place as any)?.coordinates?.elevation ?? 0)) || 0;
  const target_base_z = Number.isFinite(Number(target_base_z_world)) ? (Math.floor(Number(target_base_z_world)) || 0) : source_base_z;
  const source_world_z = source_base_z + source_z0;
  const target_z0_aligned = clamp(source_world_z - target_base_z, 0, Math.max(0, target_depth - aperture_h));

  const border_volume = {
    origin: { x: Math.floor(border_tile.x), y: Math.floor(border_tile.y), z: Math.floor(border_tile.z) },
    size: {
      x: direction === 'y+' || direction === 'y-' || direction === 'z+' || direction === 'z-' ? aperture_w : 1,
      y: direction === 'x+' || direction === 'x-' || direction === 'z+' || direction === 'z-' ? aperture_w : 1,
      z: direction === 'x+' || direction === 'x-' || direction === 'y+' || direction === 'y-' ? aperture_h : 1,
    },
  };

  let place_a_entry_volume = {
    origin: { x: source_x0, y: source_y0, z: source_z0 },
    size: { x: aperture_w, y: aperture_w, z: aperture_h },
  };
  let place_b_entry_volume = {
    origin: { x: target_x0_center, y: target_y0_center, z: target_z0_aligned },
    size: { x: aperture_w, y: aperture_w, z: aperture_h },
  };

  if (direction === 'x+') {
    place_a_entry_volume = { origin: { x: Math.max(0, source_width - 1), y: source_y0, z: source_z0 }, size: { x: 1, y: aperture_w, z: aperture_h } };
    place_b_entry_volume = { origin: { x: 0, y: target_y0_center, z: target_z0_aligned }, size: { x: 1, y: aperture_w, z: aperture_h } };
  } else if (direction === 'x-') {
    place_a_entry_volume = { origin: { x: 0, y: source_y0, z: source_z0 }, size: { x: 1, y: aperture_w, z: aperture_h } };
    place_b_entry_volume = { origin: { x: Math.max(0, target_width - 1), y: target_y0_center, z: target_z0_aligned }, size: { x: 1, y: aperture_w, z: aperture_h } };
  } else if (direction === 'y+') {
    place_a_entry_volume = { origin: { x: source_x0, y: Math.max(0, source_height - 1), z: source_z0 }, size: { x: aperture_w, y: 1, z: aperture_h } };
    place_b_entry_volume = { origin: { x: target_x0_center, y: 0, z: target_z0_aligned }, size: { x: aperture_w, y: 1, z: aperture_h } };
  } else if (direction === 'y-') {
    place_a_entry_volume = { origin: { x: source_x0, y: 0, z: source_z0 }, size: { x: aperture_w, y: 1, z: aperture_h } };
    place_b_entry_volume = { origin: { x: target_x0_center, y: Math.max(0, target_height - 1), z: target_z0_aligned }, size: { x: aperture_w, y: 1, z: aperture_h } };
  } else if (direction === 'z+') {
    place_a_entry_volume = { origin: { x: source_x0, y: source_y0, z: Math.max(0, source_z0) }, size: { x: aperture_w, y: aperture_w, z: 1 } };
    place_b_entry_volume = { origin: { x: target_x0_center, y: target_y0_center, z: 0 }, size: { x: aperture_w, y: aperture_w, z: 1 } };
  } else if (direction === 'z-') {
    place_a_entry_volume = { origin: { x: source_x0, y: source_y0, z: Math.max(0, source_z0) }, size: { x: aperture_w, y: aperture_w, z: 1 } };
    place_b_entry_volume = { origin: { x: target_x0_center, y: target_y0_center, z: Math.max(0, target_depth - 1) }, size: { x: aperture_w, y: aperture_w, z: 1 } };
  }
  return {
    id: `place_connector_${source_place.id}_${target_place_id}_${Date.now()}`,
    kind: "place_connector",
    place_a_id: source_place.id,
    place_b_id: target_place_id,
    direction_from_a: direction,
    border_volume,
    place_a_entry_volume,
    place_b_entry_volume,
  };
}
