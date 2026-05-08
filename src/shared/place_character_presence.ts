import { load_actor } from "../actor_storage/store.js";
import { get_npc_location } from "../npc_storage/location.js";
import { load_npc } from "../npc_storage/store.js";
import { get_place_entity_entry } from "../place_storage/entity_index.js";
import { resolve_multiplayer_session_by_client_session_id } from "./multiplayer_session.js";
import { list_controlled_actor_claims } from "./session_control.js";
import type { Place, PlaceActor, PlaceNPC, TilePosition } from "../types/place.js";

function normalize_tile_position(tile: any): TilePosition {
  return {
    x: Math.floor(Number(tile?.x ?? 0)) || 0,
    y: Math.floor(Number(tile?.y ?? 0)) || 0,
    ...(typeof tile?.z === "number" && Number.isFinite(tile.z) ? { z: Math.floor(tile.z) } : {}),
  };
}

function normalize_tags(tags: any): Array<{ name: string; mag: number; meta: string[] }> | undefined {
  if (!Array.isArray(tags)) return undefined;
  return tags
    .map((tag: any) => ({
      name: String(tag?.name ?? "").trim(),
      mag: Number.isFinite(Number(tag?.mag)) ? Number(tag.mag) : 0,
      meta: Array.isArray(tag?.meta) ? tag.meta.map((v: any) => String(v)) : [],
    }))
    .filter((tag) => tag.name.length > 0);
}


export function normalize_place_npc_presence(raw: any): PlaceNPC {
  return {
    npc_ref: String(raw?.npc_ref ?? "npc.unknown"),
    tile_position: normalize_tile_position(raw?.tile_position),
    ...(typeof raw?.name === "string" && raw.name.length > 0 ? { name: String(raw.name) } : {}),
    ...(typeof raw?.elevation === "number" && Number.isFinite(raw.elevation) ? { elevation: Math.floor(raw.elevation) } : {}),
    ...(typeof raw?.facing === "string" && raw.facing.length > 0 ? { facing: String(raw.facing).toLowerCase() } : {}),
    ...(typeof raw?.kind_id === "string" && raw.kind_id.length > 0 ? { kind_id: String(raw.kind_id) } : {}),
    ...(raw?.movement && typeof raw.movement === "object" ? { movement: raw.movement } : {}),
    ...(typeof raw?.body_model_id === "string" && raw.body_model_id.length > 0 ? { body_model_id: String(raw.body_model_id) } : {}),
    ...(raw?.body_slot_representation && typeof raw.body_slot_representation === "object" ? { body_slot_representation: raw.body_slot_representation } : {}),
    ...(typeof raw?.breath_index === "number" && Number.isFinite(raw.breath_index) ? { breath_index: Math.floor(raw.breath_index) } : {}),
    ...(typeof raw?.breath_last_processed === "number" && Number.isFinite(raw.breath_last_processed) ? { breath_last_processed: Math.floor(raw.breath_last_processed) } : {}),
    ...(typeof raw?.breath_last_processed_ms === "number" && Number.isFinite(raw.breath_last_processed_ms) ? { breath_last_processed_ms: Math.floor(raw.breath_last_processed_ms) } : {}),
    ...(raw?.movement_schedule && typeof raw.movement_schedule === "object" ? { movement_schedule: raw.movement_schedule } : {}),
    ...(typeof raw?.weight === "number" && Number.isFinite(raw.weight) ? { weight: Number(raw.weight) } : {}),
    ...(normalize_tags(raw?.tags)?.length ? { tags: normalize_tags(raw?.tags) } : {}),
    ...(Array.isArray(raw?.resolved_tag_states) ? { resolved_tag_states: raw.resolved_tag_states } : {}),
    ...(raw?.value_mag && typeof raw.value_mag === "object" ? { value_mag: raw.value_mag } : {}),
    ...(raw?.entity_render && typeof raw.entity_render === "object" ? { entity_render: raw.entity_render } : {}),
    status: raw?.status === "moving" || raw?.status === "busy" || raw?.status === "sleeping" ? raw.status : "present",
    activity: typeof raw?.activity === "string" && raw.activity.length > 0 ? raw.activity : "standing here",
  };
}

export function normalize_place_actor_presence(raw: any): PlaceActor {
  return {
    actor_ref: String(raw?.actor_ref ?? "actor.unknown"),
    tile_position: normalize_tile_position(raw?.tile_position),
    ...(typeof raw?.name === "string" && raw.name.length > 0 ? { name: String(raw.name) } : {}),
    ...(typeof raw?.elevation === "number" && Number.isFinite(raw.elevation) ? { elevation: Math.floor(raw.elevation) } : {}),
    ...(typeof raw?.facing === "string" && raw.facing.length > 0 ? { facing: String(raw.facing).toLowerCase() } : {}),
    ...(typeof raw?.kind_id === "string" && raw.kind_id.length > 0 ? { kind_id: String(raw.kind_id) } : {}),
    ...(raw?.movement && typeof raw.movement === "object" ? { movement: raw.movement } : {}),
    ...(typeof raw?.body_model_id === "string" && raw.body_model_id.length > 0 ? { body_model_id: String(raw.body_model_id) } : {}),
    ...(raw?.body_slot_representation && typeof raw.body_slot_representation === "object" ? { body_slot_representation: raw.body_slot_representation } : {}),
    ...(typeof raw?.breath_index === "number" && Number.isFinite(raw.breath_index) ? { breath_index: Math.floor(raw.breath_index) } : {}),
    ...(typeof raw?.breath_last_processed === "number" && Number.isFinite(raw.breath_last_processed) ? { breath_last_processed: Math.floor(raw.breath_last_processed) } : {}),
    ...(typeof raw?.breath_last_processed_ms === "number" && Number.isFinite(raw.breath_last_processed_ms) ? { breath_last_processed_ms: Math.floor(raw.breath_last_processed_ms) } : {}),
    ...(raw?.movement_schedule && typeof raw.movement_schedule === "object" ? { movement_schedule: raw.movement_schedule } : {}),
    ...(typeof raw?.weight === "number" && Number.isFinite(raw.weight) ? { weight: Number(raw.weight) } : {}),
    ...(normalize_tags(raw?.tags)?.length ? { tags: normalize_tags(raw?.tags) } : {}),
    ...(Array.isArray(raw?.resolved_tag_states) ? { resolved_tag_states: raw.resolved_tag_states } : {}),
    ...(raw?.value_mag && typeof raw.value_mag === "object" ? { value_mag: raw.value_mag } : {}),
    ...(raw?.entity_render && typeof raw.entity_render === "object" ? { entity_render: raw.entity_render } : {}),
    status: raw?.status === "moving" || raw?.status === "busy" ? raw.status : "present",
  };
}

export function project_public_place_npc_presence(raw: any): PlaceNPC {
  const normalized = normalize_place_npc_presence(raw) as any;
  delete normalized.breath_index;
  delete normalized.breath_last_processed;
  delete normalized.breath_last_processed_ms;
  delete normalized.movement_schedule;
  delete normalized.weight;
  delete normalized.resolved_tag_states;
  delete normalized.value_mag;
  return normalized;
}

export function project_public_place_actor_presence(raw: any): PlaceActor {
  const normalized = normalize_place_actor_presence(raw) as any;
  delete normalized.breath_index;
  delete normalized.breath_last_processed;
  delete normalized.breath_last_processed_ms;
  delete normalized.movement_schedule;
  delete normalized.weight;
  delete normalized.resolved_tag_states;
  delete normalized.value_mag;
  return normalized;
}

export function normalize_place_character_presence_records(place_any: any): boolean {
  if (!place_any || typeof place_any !== "object") return false;
  if (!place_any.contents || typeof place_any.contents !== "object") return false;

  let changed = false;
  const npcs = Array.isArray(place_any.contents.npcs_present) ? place_any.contents.npcs_present : [];
  const actors = Array.isArray(place_any.contents.actors_present) ? place_any.contents.actors_present : [];

  const normalized_npcs = npcs.map((entry: any) => normalize_place_npc_presence(entry));
  const normalized_actors = actors.map((entry: any) => normalize_place_actor_presence(entry));

  if (JSON.stringify(npcs) !== JSON.stringify(normalized_npcs)) {
    place_any.contents.npcs_present = normalized_npcs;
    changed = true;
  }
  if (JSON.stringify(actors) !== JSON.stringify(normalized_actors)) {
    place_any.contents.actors_present = normalized_actors;
    changed = true;
  }

  return changed;
}

export function get_online_controlled_actor_ref_set(slot: number): Set<string> {
  const online_actor_refs = new Set<string>();
  for (const claim of list_controlled_actor_claims(slot)) {
    const actor_ref = String(claim?.actor_ref ?? "").trim();
    const client_session_id = String(claim?.client_session_id ?? "").trim();
    if (!actor_ref || !client_session_id) continue;
    const session = resolve_multiplayer_session_by_client_session_id(slot, client_session_id);
    if (!session) continue;
    online_actor_refs.add(actor_ref);
  }
  return online_actor_refs;
}

export function filter_online_controlled_actor_refs(slot: number, actor_refs: string[]): string[] {
  const online_actor_refs = get_online_controlled_actor_ref_set(slot);
  return actor_refs.filter((actor_ref) => online_actor_refs.has(String(actor_ref ?? "").trim()));
}

export function list_runtime_place_entity_refs(slot: number, place_id: string): { npcs: string[]; actors: string[] } {
  const entry = get_place_entity_entry(slot, String(place_id ?? "").trim());
  if (!entry) return { npcs: [], actors: [] };
  return {
    npcs: Array.from(new Set((entry.npcs ?? []).map((ref) => String(ref ?? "").trim()).filter(Boolean))),
    actors: filter_online_controlled_actor_refs(slot, Array.from(new Set((entry.actors ?? []).map((ref) => String(ref ?? "").trim()).filter(Boolean)))),
  };
}

export function build_runtime_place_character_presence(slot: number, place: Pick<Place, "id"> & Partial<Place>): { npcs_present: PlaceNPC[]; actors_present: PlaceActor[] } {
  const place_id = String(place?.id ?? "").trim();
  if (!place_id) return { npcs_present: [], actors_present: [] };

  const entity_refs = list_runtime_place_entity_refs(slot, place_id);
  const base_elevation = Math.floor(Number((place as any)?.coordinates?.elevation ?? 0)) || 0;
  const npcs_present: PlaceNPC[] = [];
  const actors_present: PlaceActor[] = [];

  for (const npc_ref of entity_refs.npcs) {
    const npc_id = npc_ref.startsWith("npc.") ? npc_ref.slice("npc.".length) : npc_ref;
    const npc_res = load_npc(slot, npc_id);
    if (!npc_res.ok || !npc_res.npc) continue;
    const npc_any: any = npc_res.npc;
    const loc = get_npc_location(npc_any as Record<string, unknown>);
    if (!loc?.place_id || String(loc.place_id) !== place_id) continue;
    if (!loc.tile || typeof loc.tile.x !== "number" || typeof loc.tile.y !== "number") continue;
    npcs_present.push(normalize_place_npc_presence({
      npc_ref: npc_ref.startsWith("npc.") ? npc_ref : `npc.${npc_id}`,
      name: typeof npc_any?.name === "string" ? String(npc_any.name) : npc_id,
      tile_position: { x: Math.floor(Number(loc.tile.x) || 0), y: Math.floor(Number(loc.tile.y) || 0) },
      elevation: (typeof loc.elevation === "number" && Number.isFinite(loc.elevation)) ? Math.floor(loc.elevation) : base_elevation,
      facing: typeof npc_any?.facing === "string" ? String(npc_any.facing).toLowerCase() : undefined,
      body_model_id: typeof npc_any?.body_model_id === "string" ? String(npc_any.body_model_id) : undefined,
      kind_id: typeof npc_any?.kind === "string" ? String(npc_any.kind) : (typeof npc_any?.kind_id === "string" ? String(npc_any.kind_id) : undefined),
      movement: npc_any?.movement,
      status: "present",
      activity: typeof npc_any?.activity === "string" && npc_any.activity.length > 0 ? npc_any.activity : "standing here",
      tags: Array.isArray(npc_any?.tags) ? npc_any.tags : [],
      resolved_tag_states: Array.isArray(npc_any?.resolved_tag_states) ? npc_any.resolved_tag_states : [],
      value_mag: npc_any?.value_mag ?? null,
      breath_index: npc_any?.breath_index,
      breath_last_processed: npc_any?.breath_last_processed,
      breath_last_processed_ms: npc_any?.breath_last_processed_ms,
      movement_schedule: npc_any?.movement_schedule,
      entity_render: npc_any?.entity_render,
      weight: typeof npc_any?.weight === "number" && Number.isFinite(npc_any.weight) ? Number(npc_any.weight) : undefined,
    }));
  }

  for (const actor_ref of entity_refs.actors) {
    const actor_id = actor_ref.startsWith("actor.") ? actor_ref.slice("actor.".length) : actor_ref;
    const actor_res = load_actor(slot, actor_id);
    if (!actor_res.ok || !actor_res.actor) continue;
    const actor_any: any = actor_res.actor;
    const loc = actor_any?.location;
    if (!loc?.place_id || String(loc.place_id) !== place_id) continue;
    if (!loc.tile || typeof loc.tile.x !== "number" || typeof loc.tile.y !== "number") continue;
    actors_present.push(normalize_place_actor_presence({
      actor_ref: actor_ref.startsWith("actor.") ? actor_ref : `actor.${actor_id}`,
      name: typeof actor_any?.name === "string" ? String(actor_any.name) : actor_id,
      tile_position: { x: Math.floor(Number(loc.tile.x) || 0), y: Math.floor(Number(loc.tile.y) || 0) },
      elevation: (typeof loc.elevation === "number" && Number.isFinite(loc.elevation)) ? Math.floor(loc.elevation) : base_elevation,
      facing: typeof actor_any?.facing === "string" ? String(actor_any.facing).toLowerCase() : undefined,
      body_model_id: typeof actor_any?.body_model_id === "string" ? String(actor_any.body_model_id) : undefined,
      kind_id: typeof actor_any?.kind === "string" ? String(actor_any.kind) : (typeof actor_any?.kind_id === "string" ? String(actor_any.kind_id) : undefined),
      movement: actor_any?.movement,
      status: "present",
      tags: Array.isArray(actor_any?.tags) ? actor_any.tags : [],
      resolved_tag_states: Array.isArray(actor_any?.resolved_tag_states) ? actor_any.resolved_tag_states : [],
      value_mag: actor_any?.value_mag ?? null,
      breath_index: actor_any?.breath_index,
      breath_last_processed: actor_any?.breath_last_processed,
      breath_last_processed_ms: actor_any?.breath_last_processed_ms,
      movement_schedule: actor_any?.movement_schedule,
      entity_render: actor_any?.entity_render,
      weight: typeof actor_any?.weight === "number" && Number.isFinite(actor_any.weight) ? Number(actor_any.weight) : undefined,
    }));
  }

  return { npcs_present, actors_present };
}

export function apply_runtime_place_character_presence(slot: number, place_any: any): void {
  if (!place_any || typeof place_any !== "object") return;
  if (!place_any.contents || typeof place_any.contents !== "object") {
    place_any.contents = { npcs_present: [], actors_present: [], items_on_ground: [], features: [] };
  }
  const runtime = build_runtime_place_character_presence(slot, place_any as Place);
  place_any.contents.npcs_present = runtime.npcs_present;
  place_any.contents.actors_present = runtime.actors_present;
}

export function get_runtime_place_character_presence_at_coordinate(
  slot: number,
  place_any: any,
  tile_x: number,
  tile_y: number,
  world_z?: number,
): { npcs_present: PlaceNPC[]; actors_present: PlaceActor[] } {
  const runtime = build_runtime_place_character_presence(slot, place_any as Place);
  const normalized_x = Math.floor(Number(tile_x) || 0);
  const normalized_y = Math.floor(Number(tile_y) || 0);
  const has_world_z = Number.isFinite(Number(world_z));
  const normalized_z = has_world_z ? Math.floor(Number(world_z)) : null;
  const npcs_present = runtime.npcs_present.filter((entry) => {
    const ex = Math.floor(Number(entry?.tile_position?.x) || 0);
    const ey = Math.floor(Number(entry?.tile_position?.y) || 0);
    const ez = Number.isFinite(Number((entry as any)?.elevation)) ? Math.floor(Number((entry as any).elevation)) : 0;
    return ex === normalized_x && ey === normalized_y && (!has_world_z || ez === normalized_z);
  });
  const actors_present = runtime.actors_present.filter((entry) => {
    const ex = Math.floor(Number(entry?.tile_position?.x) || 0);
    const ey = Math.floor(Number(entry?.tile_position?.y) || 0);
    const ez = Number.isFinite(Number((entry as any)?.elevation)) ? Math.floor(Number((entry as any).elevation)) : 0;
    return ex === normalized_x && ey === normalized_y && (!has_world_z || ez === normalized_z);
  });
  return { npcs_present, actors_present };
}
