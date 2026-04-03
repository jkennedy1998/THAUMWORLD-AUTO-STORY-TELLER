import type { PlaceActor, PlaceNPC, TilePosition } from "../types/place.js";

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
