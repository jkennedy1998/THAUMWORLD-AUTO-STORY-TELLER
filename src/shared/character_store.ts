import { load_actor, save_actor, type ActorLookupResult } from "../actor_storage/store.js";
import { load_npc, save_npc, type NpcLookupResult } from "../npc_storage/store.js";
import { get_character_id_from_ref, get_character_role_from_ref, type CharacterRole, type CharacterRef } from "./character_storage.js";

export type CharacterLookupResult =
  | { ok: true; role: CharacterRole; ref: CharacterRef; id: string; character: Record<string, unknown>; path: string }
  | { ok: false; error: string; todo?: string };

export function load_character_by_ref(slot: number, ref: string): CharacterLookupResult {
  const role = get_character_role_from_ref(ref);
  const id = get_character_id_from_ref(ref);
  if (!role || !id) return { ok: false, error: "invalid_character_ref" };

  if (role === "actor") {
    const result: ActorLookupResult = load_actor(slot, id);
    if (!result.ok) return { ok: false, error: result.error, todo: result.todo };
    return { ok: true, role, ref: `actor.${id}`, id, character: result.actor, path: result.path };
  }

  const result: NpcLookupResult = load_npc(slot, id);
  if (!result.ok) return { ok: false, error: result.error, todo: result.todo };
  return { ok: true, role, ref: `npc.${id}`, id, character: result.npc, path: result.path };
}

export function save_character_by_ref(slot: number, ref: string, character: Record<string, unknown>): CharacterLookupResult {
  const role = get_character_role_from_ref(ref);
  const id = get_character_id_from_ref(ref);
  if (!role || !id) return { ok: false, error: "invalid_character_ref" };

  const next_character = JSON.parse(JSON.stringify(character ?? {})) as Record<string, unknown>;
  next_character.id = id;
  delete (next_character as any).ref;
  delete (next_character as any).role;

  if (role === "actor") {
    const path = save_actor(slot, id, next_character);
    return { ok: true, role, ref: `actor.${id}`, id, character: next_character, path };
  }

  const path = save_npc(slot, id, next_character);
  return { ok: true, role, ref: `npc.${id}`, id, character: next_character, path };
}

export function apply_character_patch(current: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const next = JSON.parse(JSON.stringify(current ?? {})) as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (key === "id" || key === "role" || key === "ref") continue;
    next[key] = value;
  }
  return next;
}
