import { get_configured_data_slot } from "./boot_env.js";
import type { TilePosition, Place, PlaceActor, PlaceItem, PlaceNPC } from "../types/place.js";
import { load_place } from "../place_storage/store.js";
import { get_all_ground_items } from "../place_storage/ground_store.js";

export type PerceivableEntityKind = "character" | "item" | "tile";

export type PerceivableEntityPosition = {
  x: number;
  y: number;
  z: number;
  place_id: string;
};

export type PerceivableEntityCandidate = {
  ref: string;
  kind: PerceivableEntityKind;
  distance: number;
  position: PerceivableEntityPosition;
  name?: string;
  character_role?: "actor" | "npc";
  item_def_id?: string;
};

type QueryOptions = {
  slot?: number;
  place_id: string;
  origin: { x: number; y: number; z?: number };
  radius: number;
  include_kinds?: PerceivableEntityKind[];
  exclude_refs?: string[];
};

type QueryFromPlaceOptions = Omit<QueryOptions, "slot" | "place_id"> & {
  place: Place;
};

function get_place_base_z(place: Place): number {
  return Math.floor(Number(place.coordinates?.elevation ?? place.region_bounds?.origin?.z ?? 0)) || 0;
}

function get_distance(origin: QueryOptions["origin"], position: PerceivableEntityPosition): number {
  const dx = position.x - Math.floor(Number(origin.x) || 0);
  const dy = position.y - Math.floor(Number(origin.y) || 0);
  const oz = Number.isFinite(Number(origin.z)) ? Math.floor(Number(origin.z)) : position.z;
  const dz = position.z - oz;
  return Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
}

function includes_kind(include_kinds: PerceivableEntityKind[] | undefined, kind: PerceivableEntityKind): boolean {
  if (!include_kinds || include_kinds.length === 0) return true;
  return include_kinds.includes(kind);
}

function normalize_position(place_id: string, tile: TilePosition | null | undefined, elevation: unknown, fallback_z: number): PerceivableEntityPosition | null {
  if (!tile) return null;
  const x = Math.floor(Number(tile.x));
  const y = Math.floor(Number(tile.y));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const z = Number.isFinite(Number(elevation))
    ? Math.floor(Number(elevation))
    : Number.isFinite(Number(tile.z))
      ? Math.floor(Number(tile.z))
      : fallback_z;
  return { x, y, z, place_id };
}

function push_character_candidate(
  out: PerceivableEntityCandidate[],
  place_id: string,
  origin: QueryOptions["origin"],
  radius: number,
  exclude_refs: Set<string>,
  role: "actor" | "npc",
  entry: PlaceActor | PlaceNPC,
  base_z: number,
): void {
  const ref = role === "actor" ? String((entry as PlaceActor).actor_ref ?? "") : String((entry as PlaceNPC).npc_ref ?? "");
  if (!ref || exclude_refs.has(ref)) return;
  const position = normalize_position(place_id, entry.tile_position, entry.elevation, base_z);
  if (!position) return;
  const distance = get_distance(origin, position);
  if (distance > radius) return;
  out.push({
    ref,
    kind: "character",
    distance,
    position,
    name: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : undefined,
    character_role: role,
  });
}

function push_place_item_candidates(
  out: PerceivableEntityCandidate[],
  place: Place,
  origin: QueryOptions["origin"],
  radius: number,
  exclude_refs: Set<string>,
  base_z: number,
): void {
  for (const entry of place.contents.items_on_ground ?? []) {
    const ref = String((entry as PlaceItem).item_ref ?? "");
    if (!ref || exclude_refs.has(ref)) continue;
    const position = normalize_position(place.id, entry.tile_position, entry.elevation, base_z);
    if (!position) continue;
    const distance = get_distance(origin, position);
    if (distance > radius) continue;
    out.push({
      ref,
      kind: "item",
      distance,
      position,
    });
  }

  for (const { item, position } of get_all_ground_items(place as Record<string, unknown>)) {
    const ref = `item.${String(item?.id ?? "").trim()}`;
    if (!String(item?.id ?? "").trim() || exclude_refs.has(ref)) continue;
    if (out.some((candidate) => candidate.ref === ref)) continue;
    const normalized = normalize_position(place.id, position, item?.elevation, base_z);
    if (!normalized) continue;
    const distance = get_distance(origin, normalized);
    if (distance > radius) continue;
    out.push({
      ref,
      kind: "item",
      distance,
      position: normalized,
      item_def_id: typeof item?.def_id === "string" ? item.def_id : undefined,
    });
  }
}

function push_tile_candidates(
  out: PerceivableEntityCandidate[],
  place: Place,
  origin: QueryOptions["origin"],
  radius: number,
  exclude_refs: Set<string>,
  base_z: number,
): void {
  const min_x = Math.max(0, Math.floor(Number(origin.x) || 0) - Math.ceil(radius));
  const max_x = Math.min(place.tile_grid.width - 1, Math.floor(Number(origin.x) || 0) + Math.ceil(radius));
  const min_y = Math.max(0, Math.floor(Number(origin.y) || 0) - Math.ceil(radius));
  const max_y = Math.min(place.tile_grid.height - 1, Math.floor(Number(origin.y) || 0) + Math.ceil(radius));
  const world_z = Number.isFinite(Number(origin.z)) ? Math.floor(Number(origin.z)) : base_z;

  for (let y = min_y; y <= max_y; y += 1) {
    for (let x = min_x; x <= max_x; x += 1) {
      const ref = `place_tile.${place.id}.${x}.${y}`;
      if (exclude_refs.has(ref)) continue;
      const position = { x, y, z: world_z, place_id: place.id };
      const distance = get_distance(origin, position);
      if (distance > radius) continue;
      out.push({
        ref,
        kind: "tile",
        distance,
        position,
      });
    }
  }
}

export function get_perceivable_entities_from_place(options: QueryFromPlaceOptions): PerceivableEntityCandidate[] {
  const place = options.place;
  const include_kinds = options.include_kinds;
  const exclude_refs = new Set((options.exclude_refs ?? []).map((ref) => String(ref ?? "").trim()).filter(Boolean));
  const base_z = get_place_base_z(place);
  const out: PerceivableEntityCandidate[] = [];

  if (includes_kind(include_kinds, "character")) {
    for (const entry of place.contents.npcs_present ?? []) {
      push_character_candidate(out, place.id, options.origin, options.radius, exclude_refs, "npc", entry, base_z);
    }
    for (const entry of place.contents.actors_present ?? []) {
      push_character_candidate(out, place.id, options.origin, options.radius, exclude_refs, "actor", entry, base_z);
    }
  }

  if (includes_kind(include_kinds, "item")) {
    push_place_item_candidates(out, place, options.origin, options.radius, exclude_refs, base_z);
  }

  if (includes_kind(include_kinds, "tile")) {
    push_tile_candidates(out, place, options.origin, options.radius, exclude_refs, base_z);
  }

  return out.sort((a, b) => a.distance - b.distance || a.ref.localeCompare(b.ref));
}

export function get_perceivable_entities_in_place(options: QueryOptions): PerceivableEntityCandidate[] {
  const slot = Number.isFinite(Number(options.slot)) ? Math.max(0, Math.floor(Number(options.slot))) : get_configured_data_slot();
  const place_id = String(options.place_id ?? "").trim();
  if (!place_id) return [];
  const place_result = load_place(slot, place_id);
  if (!place_result.ok || !place_result.place) return [];

  return get_perceivable_entities_from_place({
    place: place_result.place as Place,
    origin: options.origin,
    radius: options.radius,
    include_kinds: options.include_kinds,
    exclude_refs: options.exclude_refs,
  });
}
