import { load_master_item } from "../item_storage/store.js";
import { resolve_inline_item } from "../item_storage/resolve.js";
import { debug_event } from "../shared/debug_event.js";
import { emitTagChange } from "../shared/event_emitter.js";
import {
  remove_character_tag_by_selector,
  upsert_character_tag_by_selector,
} from "../shared/character_tags.js";
import { load_master_tile } from "../tile_storage/store.js";
import { resolve_place_tile } from "../tile_storage/resolve.js";
import { build_tag_delta_from_base_and_desired, normalize_tag_instances } from "./effective_tags.js";
import { apply_resolved_tag_dispersal_step } from "./lifecycle.js";
import type { TagInstance } from "./registry.js";
import type { ResolvedTagState } from "./resolved.js";
import { tag_key } from "./tag_key.js";

type TagLifecycleRuntimeEntry = {
  last_processed_breath?: number;
};

type LifecycleChange = {
  key: string;
  tagName: string;
  oldMag: number;
  newMag: number;
  removed: boolean;
  reason: "dispersal" | "expiry";
  meta: string[];
  next_tag: TagInstance | null;
  advanced_breaths: number;
};

function is_expired(tag: ResolvedTagState, now: number): boolean {
  return typeof tag.expiry === "number" && Number.isFinite(tag.expiry) && tag.expiry > 0 && tag.expiry <= now;
}

function clone_runtime_map(host: Record<string, unknown>): Record<string, TagLifecycleRuntimeEntry> {
  const raw = (host as any)?.tag_lifecycle;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, TagLifecycleRuntimeEntry> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key || !value || typeof value !== "object" || Array.isArray(value)) continue;
    const last_processed_breath = Number((value as any).last_processed_breath);
    out[key] = Number.isFinite(last_processed_breath)
      ? { last_processed_breath: Math.floor(last_processed_breath) }
      : {};
  }
  return out;
}

function apply_runtime_map(host: Record<string, unknown>, runtime: Record<string, TagLifecycleRuntimeEntry>): boolean {
  const current = JSON.stringify((host as any)?.tag_lifecycle ?? {});
  const next = JSON.stringify(runtime);
  if (current === next) return false;
  (host as any).tag_lifecycle = runtime;
  return true;
}

function build_lifecycle_changes(
  entity_ref: string,
  resolved_tag_states: ResolvedTagState[],
  current_breath: number,
  runtime: Record<string, TagLifecycleRuntimeEntry>,
): LifecycleChange[] {
  const changes: LifecycleChange[] = [];
  const now = Date.now();

  for (const tag of Array.isArray(resolved_tag_states) ? resolved_tag_states : []) {
    const selector_key = String(tag.key ?? "").trim();
    if (!selector_key) continue;

    if (is_expired(tag, now)) {
      delete runtime[selector_key];
      changes.push({
        key: selector_key,
        tagName: tag.name,
        oldMag: Math.max(0, Math.floor(Number(tag.stored_mag ?? 0) || 0)),
        newMag: 0,
        removed: true,
        reason: "expiry",
        meta: Array.isArray(tag.meta) ? tag.meta : [],
        next_tag: null,
        advanced_breaths: 0,
      });
      debug_event("META.TAGS", "tag.expired.removed", {
        entity: entity_ref,
        tag: tag.name,
        mag: tag.stored_mag,
        expiry: tag.expiry,
      });
      continue;
    }

    const existing_runtime = runtime[selector_key] ?? {};
    const last_raw = Number(existing_runtime.last_processed_breath);
    if (!Number.isFinite(last_raw)) {
      runtime[selector_key] = { last_processed_breath: current_breath };
      continue;
    }

    const elapsed_breaths = current_breath - Math.floor(last_raw);
    if (elapsed_breaths <= 0) continue;

    const stepped = apply_resolved_tag_dispersal_step(tag, elapsed_breaths);
    if (!stepped) continue;

    const next_last_processed = Math.floor(last_raw) + stepped.advanced_breaths;
    const next_key = stepped.next_tag ? tag_key(stepped.next_tag) : null;
    delete runtime[selector_key];
    if (next_key) runtime[next_key] = { last_processed_breath: next_last_processed };

    changes.push({
      key: selector_key,
      tagName: tag.name,
      oldMag: stepped.old_value,
      newMag: stepped.new_value,
      removed: stepped.next_tag === null,
      reason: "dispersal",
      meta: Array.isArray(tag.meta) ? tag.meta : [],
      next_tag: stepped.next_tag,
      advanced_breaths: stepped.advanced_breaths,
    });

    debug_event("META.TAGS", stepped.next_tag === null ? "tag.dispersal.removed" : "tag.dispersal.progressed", {
      entity: entity_ref,
      tag: tag.name,
      oldMag: stepped.old_value,
      newMag: stepped.new_value,
      advanced_breaths: stepped.advanced_breaths,
      breath_index: current_breath,
    });
  }

  return changes;
}

function refresh_inline_item_runtime(item: Record<string, unknown>): void {
  const resolved = resolve_inline_item(String((item as any)?.def_id ?? ""), item as any);
  if (!resolved) return;
  (item as any).tags = resolved.effective_tags;
  (item as any).resolved_tag_states = resolved.resolved_tag_states;
  (item as any).value_mag = resolved.value_mag;
}

function refresh_tile_like_runtime(kind: string, host: Record<string, unknown>): void {
  const resolved = resolve_place_tile(kind, { kind, tag_add: (host as any).tag_add, tag_remove: (host as any).tag_remove } as any);
  if (!resolved) return;
  (host as any).tags = resolved.effective_tags;
  (host as any).resolved_tag_states = resolved.resolved_tag_states;
  (host as any).value_mag = resolved.value_mag;
}

function apply_generic_host_changes(opts: {
  entity_ref: string;
  host: Record<string, unknown>;
  base_tags: TagInstance[];
  current_effective_tags: TagInstance[];
  resolved_tag_states: ResolvedTagState[];
  current_breath: number;
  refresh: () => void;
}): boolean {
  const runtime = clone_runtime_map(opts.host);
  const changes = build_lifecycle_changes(opts.entity_ref, opts.resolved_tag_states, opts.current_breath, runtime);
  let changed = apply_runtime_map(opts.host, runtime);
  if (changes.length <= 0) return changed;

  let desired = normalize_tag_instances(opts.current_effective_tags);
  for (const change of changes) {
    desired = desired.filter((tag) => tag_key(tag) !== change.key);
    if (change.next_tag) desired.push(change.next_tag);
  }

  const delta = build_tag_delta_from_base_and_desired(opts.base_tags, desired);
  (opts.host as any).tag_add = delta.tag_add;
  (opts.host as any).tag_remove = delta.tag_remove;
  opts.refresh();
  return true;
}

export class MetaTagProcessor {
  static processCharacterLifecycle(entity_ref: string, character: Record<string, unknown>, current_breath: number): boolean {
    const resolved = Array.isArray((character as any)?.resolved_tag_states)
      ? ((character as any).resolved_tag_states as ResolvedTagState[])
      : [];
    const runtime = clone_runtime_map(character);
    const changes = build_lifecycle_changes(entity_ref, resolved, current_breath, runtime);
    let changed = apply_runtime_map(character, runtime);
    if (changes.length <= 0) return changed;

    for (const change of changes) {
      if (change.next_tag === null) {
        const result = remove_character_tag_by_selector(character, { key: change.key, name: change.tagName });
        if (!result.removed) continue;
        emitTagChange({
          type: change.reason === "expiry" ? "TAG_REMOVED" : "TAG_DISPERSING",
          entityRef: entity_ref,
          tagName: change.tagName,
          oldMag: change.oldMag,
          newMag: 0,
          meta: change.meta,
          timestamp: Date.now(),
          source: change.reason,
        });
        changed = true;
        continue;
      }

      upsert_character_tag_by_selector(character, { key: change.key, name: change.tagName }, change.next_tag);
      emitTagChange({
        type: "TAG_DISPERSING",
        entityRef: entity_ref,
        tagName: change.tagName,
        oldMag: change.oldMag,
        newMag: change.newMag,
        meta: change.meta,
        timestamp: Date.now(),
        source: change.reason,
      });
      changed = true;
    }

    return changed;
  }

  static processInlineItemLifecycle(item: Record<string, unknown>, current_breath: number): boolean {
    const def_id = String((item as any)?.def_id ?? "").trim();
    if (!def_id) return false;
    const def_res = load_master_item(def_id);
    if (!def_res.ok) return false;
    const resolved = resolve_inline_item(def_id, item as any);
    if (!resolved) return false;
    return apply_generic_host_changes({
      entity_ref: `item.${String((item as any)?.id ?? def_id)}`,
      host: item,
      base_tags: normalize_tag_instances(def_res.item.tags),
      current_effective_tags: resolved.effective_tags,
      resolved_tag_states: resolved.resolved_tag_states,
      current_breath,
      refresh: () => { refresh_inline_item_runtime(item); },
    });
  }

  static processTileLifecycle(tile: Record<string, unknown>, current_breath: number): boolean {
    const kind = String((tile as any)?.kind ?? "").trim();
    if (!kind) return false;
    const def_res = load_master_tile(kind);
    if (!def_res.ok) return false;
    const resolved = resolve_place_tile(kind, tile as any);
    if (!resolved) return false;
    return apply_generic_host_changes({
      entity_ref: `tile.${kind}`,
      host: tile,
      base_tags: normalize_tag_instances(def_res.tile.tags),
      current_effective_tags: resolved.effective_tags,
      resolved_tag_states: resolved.resolved_tag_states,
      current_breath,
      refresh: () => { refresh_tile_like_runtime(kind, tile); },
    });
  }

  static processStructureLifecycle(structure: Record<string, unknown>, current_breath: number): boolean {
    const def_id = String((structure as any)?.def_id ?? "").trim();
    if (!def_id) return false;
    const def_res = load_master_tile(def_id);
    if (!def_res.ok) return false;
    const resolved = resolve_place_tile(def_id, { kind: def_id, tag_add: (structure as any).tag_add, tag_remove: (structure as any).tag_remove } as any);
    if (!resolved) return false;
    return apply_generic_host_changes({
      entity_ref: `structure.${String((structure as any)?.id ?? def_id)}`,
      host: structure,
      base_tags: normalize_tag_instances(def_res.tile.tags),
      current_effective_tags: resolved.effective_tags,
      resolved_tag_states: resolved.resolved_tag_states,
      current_breath,
      refresh: () => { refresh_tile_like_runtime(def_id, structure); },
    });
  }
}

export default MetaTagProcessor;
