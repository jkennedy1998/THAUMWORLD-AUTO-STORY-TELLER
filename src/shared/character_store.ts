import { load_actor, save_actor, type ActorLookupResult } from "../actor_storage/store.js";
import { load_npc, save_npc, type NpcLookupResult } from "../npc_storage/store.js";
import { get_character_id_from_ref, get_character_role_from_ref, type CharacterRole, type CharacterRef } from "./character_storage.js";
import { find_kind } from "../kind_storage/store.js";
import { apply_level1_derived } from "../character_rules/derived.js";
import { resolve_character_body_model_id } from "./body_model.js";
import { DEFAULT_CHARACTER_BODY_SLOT_REPRESENTATION } from "./body_slot_representation.js";

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
    const reloaded = load_actor(slot, id);
    if (!reloaded.ok) return { ok: false, error: reloaded.error, todo: reloaded.todo };
    return { ok: true, role, ref: `actor.${id}`, id, character: reloaded.actor, path };
  }

  const path = save_npc(slot, id, next_character);
  const reloaded = load_npc(slot, id);
  if (!reloaded.ok) return { ok: false, error: reloaded.error, todo: reloaded.todo };
  return { ok: true, role, ref: `npc.${id}`, id, character: reloaded.npc, path };
}

export function apply_character_patch(current: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const next = JSON.parse(JSON.stringify(current ?? {})) as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (key === "id" || key === "role" || key === "ref") continue;
    next[key] = value;
  }

  const patched_kind_id = String((patch as any)?.kind ?? "").trim();
  if (patched_kind_id) {
    const next_kind = find_kind(patched_kind_id);
    if (next_kind) {
      next.kind = next_kind.id;
      (next as any).body_model_id = typeof (next_kind as any)?.body_model_id === "string"
        ? String((next_kind as any).body_model_id)
        : resolve_character_body_model_id(next_kind.id);
      (next as any).body_slot_representation = ((next_kind as any)?.body_slot_representation && typeof (next_kind as any).body_slot_representation === "object")
        ? (next_kind as any).body_slot_representation
        : DEFAULT_CHARACTER_BODY_SLOT_REPRESENTATION;
      if (typeof next_kind.size_mag === "number") next.size_mag = next_kind.size_mag;
      if (typeof next_kind.weight === "number") next.weight = next_kind.weight;
      if (typeof next_kind.sleep_type === "string") next.sleep_type = next_kind.sleep_type;
      if (typeof next_kind.sleep_required_per_day === "number") next.sleep_required_per_day = next_kind.sleep_required_per_day;
      if (next_kind.senses) next.senses = { ...next_kind.senses };
      if (next_kind.movement) {
        next.movement = {
          ...((next.movement as Record<string, unknown>) ?? {}),
          walk: next_kind.movement.walk ?? 0,
          climb: next_kind.movement.climb ?? 0,
          swim: next_kind.movement.swim ?? 0,
          fly: next_kind.movement.fly ?? 0,
        };
      }
      if (next_kind.temperature_range) next.temperature_range = { ...next_kind.temperature_range };

      const previous_kind = find_kind(String((current as any)?.kind ?? "").trim());
      const current_stats = ((current as any)?.stats ?? {}) as Record<string, unknown>;
      const stored_base_stats = (((current as any)?.stat_source as any)?.base_stats ?? null) as Record<string, unknown> | null;
      const base_stats: Record<string, number> = {
        con: Number(stored_base_stats?.con ?? current_stats.con ?? 0) || 0,
        str: Number(stored_base_stats?.str ?? current_stats.str ?? 0) || 0,
        dex: Number(stored_base_stats?.dex ?? current_stats.dex ?? 0) || 0,
        wis: Number(stored_base_stats?.wis ?? current_stats.wis ?? 0) || 0,
        int: Number(stored_base_stats?.int ?? current_stats.int ?? 0) || 0,
        cha: Number(stored_base_stats?.cha ?? current_stats.cha ?? 0) || 0,
      };
      if (!stored_base_stats && previous_kind?.stat_changes) {
        for (const [key, delta] of Object.entries(previous_kind.stat_changes as Record<string, number>)) {
          base_stats[key] = (Number(base_stats[key] ?? 0) || 0) - Number(delta ?? 0);
        }
      }
      const effective_stats: Record<string, number> = { ...base_stats };
      for (const [key, delta] of Object.entries((next_kind.stat_changes as Record<string, number> | undefined) ?? {})) {
        effective_stats[key] = (Number(effective_stats[key] ?? 0) || 0) + Number(delta ?? 0);
      }
      next.stats = effective_stats;
      (next as any).stat_source = {
        base_stats,
        kind_id: next_kind.id,
        kind_stat_changes: { ...((next_kind.stat_changes as Record<string, number> | undefined) ?? {}) },
      };
      apply_level1_derived(next, { set_current_to_max: false });
    }
  }
  return next;
}
