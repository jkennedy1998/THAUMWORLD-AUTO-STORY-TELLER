import type { KindDefinition } from "../kind_storage/store.js";
import { find_kind } from "../kind_storage/store.js";
import type { TagInstance } from "../tag_system/registry.js";
import { get_tag_stacking_mode } from "../tag_system/definitions.js";
import { resolve_tag_states, type ResolvedTagState } from "../tag_system/resolved.js";
import { build_entity_value_mag_breakdown, type EntityValueMagBreakdown } from "../tag_system/value.js";
import { tag_key } from "../tag_system/tag_key.js";
import { migrate_awareness_tags_to_state } from "./awareness.js";

export type CharacterTagHydrationResult = {
  changed: boolean;
  base_tags: TagInstance[];
  effective_tags: TagInstance[];
  resolved_tag_states: ResolvedTagState[];
  value_mag: EntityValueMagBreakdown;
};

type CharacterTagSelector = {
  key?: string | null;
  name?: string | null;
};

type TagRemoveOp = { key: string; mag: number };

function clone_tag(tag: TagInstance): TagInstance {
  return JSON.parse(JSON.stringify(tag ?? {})) as TagInstance;
}

function normalize_mag(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function normalize_tags(tags: unknown): TagInstance[] {
  if (!Array.isArray(tags)) return [];
  return tags
    .filter((tag) => !!tag && typeof tag === "object" && String((tag as any).name ?? "").trim().length > 0)
    .map((tag) => {
      const next = clone_tag(tag as TagInstance);
      if (typeof next.mag !== "number" || !Number.isFinite(next.mag)) next.mag = 1;
      if (!Array.isArray(next.meta)) next.meta = [];
      return next;
    });
}

function normalize_remove_ops(value: unknown): TagRemoveOp[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((op) => ({ key: String((op as any)?.key ?? ""), mag: normalize_mag((op as any)?.mag, 0) }))
    .filter((op) => op.key.length > 0 && op.mag > 0);
}

export function get_character_kind_definition(character: Record<string, unknown>): KindDefinition | null {
  const kind_id = String((character as any)?.kind ?? (character as any)?.kind_id ?? "").trim();
  return kind_id ? find_kind(kind_id) : null;
}

export function get_character_base_tags(character: Record<string, unknown>): TagInstance[] {
  const kind = get_character_kind_definition(character);
  return normalize_tags((kind as any)?.tags);
}

function build_delta_from_base_and_desired(base_tags: TagInstance[], desired_tags: TagInstance[]): { tag_add: TagInstance[]; tag_remove: TagRemoveOp[] } {
  const tag_add: TagInstance[] = [];
  const tag_remove: TagRemoveOp[] = [];
  const desired_by_key = new Map<string, TagInstance[]>();
  const base_by_key = new Map<string, TagInstance[]>();

  for (const tag of desired_tags) {
    const key = tag_key(tag);
    const list = desired_by_key.get(key) ?? [];
    list.push(tag);
    desired_by_key.set(key, list);
  }
  for (const tag of base_tags) {
    const key = tag_key(tag);
    const list = base_by_key.get(key) ?? [];
    list.push(tag);
    base_by_key.set(key, list);
  }

  const all_keys = new Set<string>([...base_by_key.keys(), ...desired_by_key.keys()]);
  for (const key of all_keys) {
    const base_list = base_by_key.get(key) ?? [];
    const desired_list = desired_by_key.get(key) ?? [];
    const name = String((desired_list[0] ?? base_list[0])?.name ?? "");
    const stacking = get_tag_stacking_mode(name);

    if (stacking === "sum") {
      const base_mag = base_list.reduce((sum, tag) => sum + normalize_mag(tag.mag, 1), 0);
      const desired_mag = desired_list.reduce((sum, tag) => sum + normalize_mag(tag.mag, 1), 0);
      if (desired_mag > base_mag) {
        const seed = desired_list[0] ?? base_list[0];
        if (seed) {
          const add_tag = clone_tag(seed);
          add_tag.mag = desired_mag - base_mag;
          tag_add.push(add_tag);
        }
      } else if (desired_mag < base_mag) {
        tag_remove.push({ key, mag: base_mag - desired_mag });
      }
      continue;
    }

    const base_tag = base_list[0] ?? null;
    const desired_tag = desired_list[0] ?? null;
    const base_raw = base_tag ? JSON.stringify(base_tag) : null;
    const desired_raw = desired_tag ? JSON.stringify(desired_tag) : null;

    if (base_tag && !desired_tag) {
      tag_remove.push({ key, mag: Math.max(1, normalize_mag(base_tag.mag, 1)) });
      continue;
    }
    if (!base_tag && desired_tag) {
      tag_add.push(clone_tag(desired_tag));
      continue;
    }
    if (base_tag && desired_tag && base_raw !== desired_raw) {
      tag_remove.push({ key, mag: Math.max(1, normalize_mag(base_tag.mag, 1)) });
      tag_add.push(clone_tag(desired_tag));
    }
  }

  return { tag_add, tag_remove };
}

function matches_selector(tag: TagInstance, selector: CharacterTagSelector): boolean {
  const want_key = String(selector?.key ?? "").trim();
  if (want_key) return tag_key(tag) === want_key;
  const want_name = String(selector?.name ?? "").trim().toUpperCase();
  if (!want_name) return false;
  return String(tag?.name ?? "").trim().toUpperCase() === want_name;
}

function apply_character_desired_tags(character: Record<string, unknown>, desired: TagInstance[]): CharacterTagHydrationResult {
  const base_tags = get_character_base_tags(character);
  const delta = build_delta_from_base_and_desired(base_tags, desired);
  (character as any).tag_add = delta.tag_add;
  (character as any).tag_remove = delta.tag_remove;
  return hydrate_character_tags(character);
}

export function hydrate_character_tags(character: Record<string, unknown>): CharacterTagHydrationResult {
  const base_tags = get_character_base_tags(character);
  let changed = false;

  if (migrate_awareness_tags_to_state(character)) changed = true;

  const legacy_tags = normalize_tags((character as any).tags);
  let tag_add = normalize_tags((character as any).tag_add);
  let tag_remove = normalize_remove_ops((character as any).tag_remove);

  if ((tag_add.length <= 0 && tag_remove.length <= 0) && legacy_tags.length > 0) {
    const migrated = build_delta_from_base_and_desired(base_tags, legacy_tags);
    tag_add = migrated.tag_add;
    tag_remove = migrated.tag_remove;
    (character as any).tag_add = tag_add;
    (character as any).tag_remove = tag_remove;
    changed = true;
  }

  const resolved_tag_states = resolve_tag_states({ base: base_tags, add: tag_add, remove: tag_remove });
  const effective_tags = resolved_tag_states.map((state) => clone_tag({
    name: state.name,
    mag: state.stored_mag,
    dim_mag: state.dim_mag,
    meta: state.meta,
    info: state.info,
    source: state.source ?? undefined,
    expiry: state.expiry ?? undefined,
    scope: state.scope as any,
  }));
  const value_mag = build_entity_value_mag_breakdown({ base_value_mag: Number((character as any)?.character_mag ?? 0) }, resolved_tag_states);

  const prior_tags = JSON.stringify(Array.isArray((character as any).tags) ? (character as any).tags : []);
  const next_tags = JSON.stringify(effective_tags);
  if (prior_tags !== next_tags) changed = true;
  (character as any).tags = effective_tags;
  (character as any).resolved_tag_states = resolved_tag_states;
  (character as any).tag_value_mag = value_mag.tag_value_mag;
  (character as any).total_value_mag = value_mag.total_value_mag;

  return { changed, base_tags, effective_tags, resolved_tag_states, value_mag };
}

export function upsert_character_tag(character: Record<string, unknown>, next_tag: TagInstance): CharacterTagHydrationResult {
  const current_effective = normalize_tags((character as any).tags);
  const tag_name = String(next_tag?.name ?? "").trim().toUpperCase();
  const desired = current_effective.filter((tag) => String(tag?.name ?? "").trim().toUpperCase() !== tag_name);
  const incoming = clone_tag(next_tag);
  incoming.name = tag_name;
  if (typeof incoming.mag !== "number" || !Number.isFinite(incoming.mag)) incoming.mag = 1;
  if (!Array.isArray(incoming.meta)) incoming.meta = [];
  desired.push(incoming);
  return apply_character_desired_tags(character, desired);
}

export function upsert_character_tag_by_selector(character: Record<string, unknown>, selector: CharacterTagSelector, next_tag: TagInstance): CharacterTagHydrationResult {
  const current_effective = normalize_tags((character as any).tags);
  const incoming = clone_tag(next_tag);
  incoming.name = String(incoming?.name ?? "").trim().toUpperCase();
  if (typeof incoming.mag !== "number" || !Number.isFinite(incoming.mag)) incoming.mag = 1;
  if (!Array.isArray(incoming.meta)) incoming.meta = [];
  const desired = current_effective.filter((tag) => !matches_selector(tag, selector));
  desired.push(incoming);
  return apply_character_desired_tags(character, desired);
}

export function remove_character_tag(character: Record<string, unknown>, tag_name: string): { removed: boolean; result: CharacterTagHydrationResult } {
  const want = String(tag_name ?? "").trim().toUpperCase();
  const current_effective = normalize_tags((character as any).tags);
  const desired = current_effective.filter((tag) => String(tag?.name ?? "").trim().toUpperCase() !== want);
  const removed = desired.length !== current_effective.length;
  const result = apply_character_desired_tags(character, desired);
  return { removed, result };
}

export function remove_character_tag_by_selector(character: Record<string, unknown>, selector: CharacterTagSelector): { removed: boolean; result: CharacterTagHydrationResult } {
  const current_effective = normalize_tags((character as any).tags);
  const desired = current_effective.filter((tag) => !matches_selector(tag, selector));
  const removed = desired.length !== current_effective.length;
  const result = apply_character_desired_tags(character, desired);
  return { removed, result };
}
