import { load_actor } from "../actor_storage/store.js";
import { load_npc } from "../npc_storage/store.js";
import { get_npc_location } from "../npc_storage/location.js";
import { get_place_entity_entry } from "../place_storage/entity_index.js";
import { list_runtime_place_entity_refs } from "./place_character_presence.js";
import { list_adjacent_place_ids_from_graph } from "../place_storage/region_place_graph.js";
import { get_region_place_index_record } from "../place_storage/region_place_index.js";
import { load_place } from "../place_storage/store.js";
import type { SenseBroadcast } from "../action_system/sense_broadcast.js";
import { get_broadcast_mag } from "../action_system/sense_broadcast.js";
import { get_obscured_detection_range_tiles, get_observer_sense_mag, is_supported_runtime_sense } from "./sense_mag.js";

type SenseEnvelope = {
  max_light_sense: number;
  max_pressure_sense: number;
  source_last_updated: string;
};

export type BroadcastObserverCandidate = {
  ref: string;
  place_id: string;
  distance_tiles: number;
  location: {
    x: number;
    y: number;
    z: number;
    place_id: string;
  };
};

const place_envelope_cache = new Map<string, SenseEnvelope>();

function make_place_key(slot: number, place_id: string): string {
  return `${slot}:${place_id}`;
}

function to_world_position(place_id: string, x: number, y: number, z: number, bounds: { origin: { x: number; y: number; z: number } } | null): { x: number; y: number; z: number; place_id: string } {
  if (!bounds) return { x, y, z, place_id };
  return {
    x: bounds.origin.x + x,
    y: bounds.origin.y + y,
    z: bounds.origin.z + z,
    place_id,
  };
}

function get_entity_world_location(slot: number, ref: string, place_id_hint?: string): BroadcastObserverCandidate["location"] | null {
  if (ref.startsWith("actor.")) {
    const result = load_actor(slot, ref.replace(/^actor\./, ""));
    if (!result.ok || !result.actor) return null;
    const loc = (result.actor as any).location;
    const place_id = String(loc?.place_id ?? place_id_hint ?? "").trim();
    if (!place_id) return null;
    const bounds = get_region_place_index_record(slot, place_id)?.bounds ?? null;
    const x = Math.floor(Number((loc?.tile as any)?.x ?? loc?.x ?? 0));
    const y = Math.floor(Number((loc?.tile as any)?.y ?? loc?.y ?? 0));
    const z = Number.isFinite(Number((loc?.tile as any)?.z)) ? Math.floor(Number((loc?.tile as any)?.z)) : (Number.isFinite(Number(loc?.elevation)) ? Math.floor(Number(loc.elevation)) : 0);
    return to_world_position(place_id, x, y, z, bounds);
  }
  if (ref.startsWith("npc.")) {
    const result = load_npc(slot, ref.replace(/^npc\./, ""));
    if (!result.ok || !result.npc) return null;
    const loc = get_npc_location(result.npc as Record<string, unknown>);
    if (!loc?.place_id) return null;
    const bounds = get_region_place_index_record(slot, loc.place_id)?.bounds ?? null;
    const x = Math.floor(Number(loc.tile?.x ?? 0));
    const y = Math.floor(Number(loc.tile?.y ?? 0));
    const z = Number.isFinite(Number((loc.tile as any)?.z)) ? Math.floor(Number((loc.tile as any)?.z)) : (Number.isFinite(Number(loc.elevation)) ? Math.floor(Number(loc.elevation)) : 0);
    return to_world_position(loc.place_id, x, y, z, bounds);
  }
  return null;
}

function compute_distance(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
}

function min_distance_to_bounds(source: { x: number; y: number; z: number }, bounds: { origin: { x: number; y: number; z: number }; size: { x: number; y: number; z: number } }): number {
  const min_x = bounds.origin.x;
  const max_x = bounds.origin.x + Math.max(0, bounds.size.x - 1);
  const min_y = bounds.origin.y;
  const max_y = bounds.origin.y + Math.max(0, bounds.size.y - 1);
  const min_z = bounds.origin.z;
  const max_z = bounds.origin.z + Math.max(0, bounds.size.z - 1);
  const dx = source.x < min_x ? min_x - source.x : source.x > max_x ? source.x - max_x : 0;
  const dy = source.y < min_y ? min_y - source.y : source.y > max_y ? source.y - max_y : 0;
  const dz = source.z < min_z ? min_z - source.z : source.z > max_z ? source.z - max_z : 0;
  return Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
}

function compute_place_envelope(slot: number, place_id: string): SenseEnvelope {
  const entry = get_place_entity_entry(slot, place_id);
  if (!entry) {
    return { max_light_sense: 0, max_pressure_sense: 0, source_last_updated: "" };
  }
  const cache_key = make_place_key(slot, place_id);
  const cached = place_envelope_cache.get(cache_key);
  if (cached && cached.source_last_updated === entry.last_updated) return cached;

  const runtime_refs = list_runtime_place_entity_refs(slot, place_id);
  let max_light_sense = 0;
  let max_pressure_sense = 0;
  for (const ref of [...runtime_refs.npcs, ...runtime_refs.actors]) {
    max_light_sense = Math.max(max_light_sense, get_observer_sense_mag(slot, ref, "light"));
    max_pressure_sense = Math.max(max_pressure_sense, get_observer_sense_mag(slot, ref, "pressure"));
  }
  const envelope = { max_light_sense, max_pressure_sense, source_last_updated: entry.last_updated };
  place_envelope_cache.set(cache_key, envelope);
  return envelope;
}

function get_max_place_radius(slot: number, place_id: string, broadcasts: SenseBroadcast[]): number {
  const envelope = compute_place_envelope(slot, place_id);
  let max_radius = 0;
  for (const broadcast of broadcasts) {
    if (!is_supported_runtime_sense(broadcast.sense)) continue;
    const observer_sense_mag = broadcast.sense === "light" ? envelope.max_light_sense : envelope.max_pressure_sense;
    if (observer_sense_mag <= 0 && broadcast.sense === "light") continue;
    const sense_radius = get_obscured_detection_range_tiles(broadcast.sense, observer_sense_mag, get_broadcast_mag(broadcast));
    max_radius = Math.max(max_radius, sense_radius);
  }
  return max_radius;
}

export function get_broadcast_observer_candidates(options: {
  slot: number;
  source_place_id: string;
  source_position: { x: number; y: number; z?: number };
  broadcasts: SenseBroadcast[];
  exclude_refs?: string[];
}): BroadcastObserverCandidate[] {
  const source_place = load_place(options.slot, options.source_place_id);
  if (!source_place.ok || !source_place.place) return [];
  const region_id = String(source_place.place.region_id ?? "").trim();
  if (!region_id) return [];
  const source_bounds = get_region_place_index_record(options.slot, options.source_place_id)?.bounds ?? source_place.place.region_bounds ?? null;
  const source_world = to_world_position(
    options.source_place_id,
    Math.floor(Number(options.source_position.x) || 0),
    Math.floor(Number(options.source_position.y) || 0),
    Number.isFinite(Number(options.source_position.z)) ? Math.floor(Number(options.source_position.z)) : 0,
    source_bounds,
  );

  const exclude = new Set((options.exclude_refs ?? []).map((ref) => String(ref ?? "").trim()).filter(Boolean));
  const visited = new Set<string>();
  const queue: string[] = [options.source_place_id];
  const candidate_places = new Set<string>();

  while (queue.length > 0) {
    const place_id = queue.shift()!;
    if (visited.has(place_id)) continue;
    visited.add(place_id);
    const record = get_region_place_index_record(options.slot, place_id);
    if (!record) continue;
    const place_radius = get_max_place_radius(options.slot, place_id, options.broadcasts);
    const place_distance = min_distance_to_bounds(source_world, record.bounds);
    if (place_distance > place_radius) continue;
    candidate_places.add(place_id);
    for (const neighbor of list_adjacent_place_ids_from_graph(options.slot, region_id, place_id)) {
      if (!visited.has(neighbor)) queue.push(neighbor);
    }
  }

  console.info("[BroadcastObservers] get_broadcast_observer_candidates.places", {
    source_place_id: options.source_place_id,
    candidate_place_count: candidate_places.size,
    candidate_places: Array.from(candidate_places.values()),
  });

  const out: BroadcastObserverCandidate[] = [];
  for (const place_id of candidate_places) {
    const entry = list_runtime_place_entity_refs(options.slot, place_id);
    for (const ref of [...entry.npcs, ...entry.actors]) {
      if (!ref || exclude.has(ref)) continue;
      const location = get_entity_world_location(options.slot, ref, place_id);
      if (!location) continue;
      out.push({
        ref,
        place_id,
        distance_tiles: compute_distance(source_world, location),
        location,
      });
    }
  }

  const sorted = out.sort((a, b) => a.distance_tiles - b.distance_tiles || a.ref.localeCompare(b.ref));
  console.info("[BroadcastObservers] get_broadcast_observer_candidates.complete", {
    source_place_id: options.source_place_id,
    observer_count: sorted.length,
    observers: sorted.slice(0, 10).map((candidate) => ({
      ref: candidate.ref,
      place_id: candidate.place_id,
      distance_tiles: candidate.distance_tiles,
    })),
  });
  return sorted;
}
