import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "jsonc-parser";
import type { PlaceRegionBounds } from "../types/place.js";
import { get_data_slot_dir } from "../engine/paths.js";

const PLACES_DIR = "places";
const INDEX_FILE = "region_place_index.jsonc";
const SCHEMA_VERSION = 1;

export type RegionPlaceIndexRecord = {
  place_id: string;
  region_id: string;
  bounds: PlaceRegionBounds;
  updated_at: string;
  bounds_revision: number;
};

export type RegionPlaceIndexRegion = {
  place_ids: string[];
  places: Record<string, RegionPlaceIndexRecord>;
};

export type RegionPlaceIndex = {
  schema_version: number;
  generated_at: string;
  regions: Record<string, RegionPlaceIndexRegion>;
};

const index_cache = new Map<number, RegionPlaceIndex>();

function get_places_dir(slot: number): string {
  return path.join(get_data_slot_dir(slot), PLACES_DIR);
}

function get_index_path(slot: number): string {
  return path.join(get_data_slot_dir(slot), INDEX_FILE);
}

function ensure_slot_dir(slot: number): void {
  const dir = get_data_slot_dir(slot);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function empty_index(): RegionPlaceIndex {
  return {
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    regions: {},
  };
}

function clone_bounds(bounds: PlaceRegionBounds): PlaceRegionBounds {
  return JSON.parse(JSON.stringify(bounds)) as PlaceRegionBounds;
}

function normalize_bounds(bounds: any): PlaceRegionBounds | null {
  if (!bounds || typeof bounds !== "object") return null;
  const ox = Math.floor(Number(bounds?.origin?.x ?? 0));
  const oy = Math.floor(Number(bounds?.origin?.y ?? 0));
  const oz = Math.floor(Number(bounds?.origin?.z ?? 0));
  const sx = Math.max(1, Math.floor(Number(bounds?.size?.x ?? 1)) || 1);
  const sy = Math.max(1, Math.floor(Number(bounds?.size?.y ?? 1)) || 1);
  const sz = Math.max(1, Math.floor(Number(bounds?.size?.z ?? 1)) || 1);
  return {
    origin: { x: ox, y: oy, z: oz },
    size: { x: sx, y: sy, z: sz },
  };
}

function get_region_bucket(index: RegionPlaceIndex, region_id: string): RegionPlaceIndexRegion {
  if (!index.regions[region_id]) {
    index.regions[region_id] = { place_ids: [], places: {} };
  }
  return index.regions[region_id]!;
}

function save_index(slot: number, index: RegionPlaceIndex): void {
  ensure_slot_dir(slot);
  index.generated_at = new Date().toISOString();
  fs.writeFileSync(get_index_path(slot), JSON.stringify(index, null, 2), "utf-8");
  index_cache.set(slot, index);
}

function read_place_record(slot: number, place_id: string): RegionPlaceIndexRecord | null {
  const place_path = path.join(get_places_dir(slot), `${place_id}.jsonc`);
  if (!fs.existsSync(place_path)) return null;
  try {
    const raw = fs.readFileSync(place_path, "utf-8");
    const parsed = parse(raw) as any;
    const parsed_place_id = String(parsed?.id ?? place_id).trim();
    const region_id = String(parsed?.region_id ?? "").trim();
    const bounds = normalize_bounds(parsed?.region_bounds);
    if (!parsed_place_id || !region_id || !bounds) return null;
    const bounds_revision = Math.floor(Number(parsed?.bounds_revision ?? 0)) || 0;
    return {
      place_id: parsed_place_id,
      region_id,
      bounds,
      updated_at: new Date().toISOString(),
      bounds_revision,
    };
  } catch {
    return null;
  }
}

function ensure_index(slot: number): RegionPlaceIndex {
  const cached = index_cache.get(slot);
  if (cached) return cached;

  const file_path = get_index_path(slot);
  if (!fs.existsSync(file_path)) {
    const rebuilt = rebuild_region_place_index(slot);
    index_cache.set(slot, rebuilt);
    return rebuilt;
  }

  try {
    const raw = fs.readFileSync(file_path, "utf-8");
    const parsed = JSON.parse(raw) as RegionPlaceIndex;
    if (parsed?.schema_version !== SCHEMA_VERSION || !parsed?.regions || typeof parsed.regions !== "object") {
      throw new Error("invalid_index_structure");
    }
    index_cache.set(slot, parsed);
    return parsed;
  } catch {
    const rebuilt = rebuild_region_place_index(slot);
    index_cache.set(slot, rebuilt);
    return rebuilt;
  }
}

export function invalidate_region_place_index_cache(slot: number): void {
  index_cache.delete(slot);
}

export function rebuild_region_place_index(slot: number): RegionPlaceIndex {
  const index = empty_index();
  const places_dir = get_places_dir(slot);
  if (!fs.existsSync(places_dir)) {
    save_index(slot, index);
    return index;
  }

  const files = fs.readdirSync(places_dir).filter((name) => name.endsWith(".jsonc"));
  for (const file of files) {
    const place_id = file.slice(0, -6);
    const rec = read_place_record(slot, place_id);
    if (!rec) continue;
    const bucket = get_region_bucket(index, rec.region_id);
    bucket.places[rec.place_id] = rec;
    if (!bucket.place_ids.includes(rec.place_id)) bucket.place_ids.push(rec.place_id);
  }

  for (const bucket of Object.values(index.regions)) {
    bucket.place_ids.sort();
  }

  save_index(slot, index);
  return index;
}

export function get_region_place_index_record(slot: number, place_id: string): RegionPlaceIndexRecord | null {
  const index = ensure_index(slot);
  for (const bucket of Object.values(index.regions)) {
    const rec = bucket.places[place_id];
    if (rec) {
      return {
        ...rec,
        bounds: clone_bounds(rec.bounds),
      };
    }
  }
  return null;
}

export function list_region_place_index_records(slot: number, region_id: string): RegionPlaceIndexRecord[] {
  const index = ensure_index(slot);
  const bucket = index.regions[region_id];
  if (!bucket) return [];
  return bucket.place_ids
    .map((place_id) => bucket.places[place_id])
    .filter((rec): rec is RegionPlaceIndexRecord => !!rec)
    .map((rec) => ({
      ...rec,
      bounds: clone_bounds(rec.bounds),
    }));
}

export function list_place_ids_in_region_index(slot: number, region_id: string): string[] {
  const index = ensure_index(slot);
  const bucket = index.regions[region_id];
  return bucket ? [...bucket.place_ids] : [];
}

export function list_region_ids_in_region_place_index(slot: number): string[] {
  const index = ensure_index(slot);
  return Object.keys(index.regions).sort();
}

export function upsert_region_place_index_record(slot: number, record: RegionPlaceIndexRecord): void {
  const index = ensure_index(slot);

  for (const [rid, bucket] of Object.entries(index.regions)) {
    if (!bucket.places[record.place_id]) continue;
    delete bucket.places[record.place_id];
    bucket.place_ids = bucket.place_ids.filter((id) => id !== record.place_id);
    if (bucket.place_ids.length === 0) delete index.regions[rid];
  }

  const bucket = get_region_bucket(index, record.region_id);
  bucket.places[record.place_id] = {
    ...record,
    bounds: clone_bounds(record.bounds),
    updated_at: new Date().toISOString(),
  };
  if (!bucket.place_ids.includes(record.place_id)) bucket.place_ids.push(record.place_id);
  bucket.place_ids.sort();
  save_index(slot, index);
}

export function sync_place_to_region_place_index(slot: number, place_id: string): void {
  const record = read_place_record(slot, place_id);
  if (!record) {
    remove_place_from_region_place_index(slot, place_id);
    return;
  }
  upsert_region_place_index_record(slot, record);
}

export function remove_place_from_region_place_index(slot: number, place_id: string): void {
  const index = ensure_index(slot);
  let changed = false;
  for (const [rid, bucket] of Object.entries(index.regions)) {
    if (!bucket.places[place_id]) continue;
    delete bucket.places[place_id];
    bucket.place_ids = bucket.place_ids.filter((id) => id !== place_id);
    if (bucket.place_ids.length === 0) delete index.regions[rid];
    changed = true;
  }
  if (changed) save_index(slot, index);
}
