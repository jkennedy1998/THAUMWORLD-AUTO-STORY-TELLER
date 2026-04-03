import type { InlineItem } from "../types/inline_item.js";
import type { TagInstance } from "../tag_system/registry.js";
import { apply_tag_deltas, type TagRemoveOp } from "../tag_system/tag_deltas.js";
import { resolve_tag_states_from_instances, type ResolvedTagState } from "../tag_system/resolved.js";
import { build_entity_value_mag_breakdown, type EntityValueMagBreakdown } from "../tag_system/value.js";
import { tag_key } from "../tag_system/tag_key.js";
import { load_master_item, type ItemDefinition } from "./store.js";
import { debug_warn } from "../shared/debug.js";

const warned_legacy_item_ids = new Set<string>();

export type ResolvedItem = {
  def: ItemDefinition;
  effective_tags: TagInstance[];
  resolved_tag_states: ResolvedTagState[];
  value_mag: EntityValueMagBreakdown;
  name: string;
  unit_weight: number;
  display_char: string;
  display_color: string | null;
  max_stack_size: number;
};

function pick_display_char(def: ItemDefinition): string {
  const base = String((def as any)?.display_char ?? "").charAt(0);
  if (base && base !== "·" && base !== " ") return base;
  const name = String(def.name ?? "");
  return name.length > 0 ? name.charAt(0).toLowerCase() : "?";
}

function normalize_remove_ops(rm: InlineItem["tag_remove"]): TagRemoveOp[] {
  if (!Array.isArray(rm)) return [];
  return rm
    .map((op) => ({ key: String((op as any)?.key ?? ""), mag: Number((op as any)?.mag ?? 0) }))
    .filter((op) => op.key && Number.isFinite(op.mag) && op.mag > 0)
    .map((op) => ({ key: op.key, mag: Math.floor(op.mag) }));
}

export function resolve_inline_item(def_id: string, item: InlineItem): ResolvedItem | null {
  try {
    const any_item: any = item as any;
    if ((any_item?.name !== undefined || any_item?.weight !== undefined || any_item?.tags !== undefined) && any_item?.__derived_runtime !== true) {
      const id = typeof any_item?.id === 'string' ? any_item.id : '';
      if (id && !warned_legacy_item_ids.has(id)) {
        warned_legacy_item_ids.add(id);
        debug_warn('INLINE_ITEM_LEGACY', `Inline item still has legacy fields; ignoring derived props (id=${id} def_id=${def_id})`);
      }
    }
  } catch {
    // ignore
  }
  const def_res = load_master_item(def_id);
  if (!def_res.ok) return null;
  const def = def_res.item;

  const add = Array.isArray(item.tag_add) ? (item.tag_add as TagInstance[]) : [];
  const remove = normalize_remove_ops(item.tag_remove);
  const effective_tags = apply_tag_deltas({ base: def.tags ?? [], add, remove });
  const resolved_tag_states = resolve_tag_states_from_instances(effective_tags);
  const value_mag = build_entity_value_mag_breakdown(def, resolved_tag_states);

  const display_color_override = typeof item.display_color === "string" ? item.display_color : null;
  const def_color = typeof (def as any).display_color === "string" ? String((def as any).display_color) : null;

  return {
    def,
    effective_tags,
    resolved_tag_states,
    value_mag,
    name: String(def.name ?? def.id ?? def_id),
    unit_weight: Number(def.weight ?? 0),
    display_char: pick_display_char(def),
    display_color: display_color_override ?? def_color,
    max_stack_size: Number((def as any).max_stack_size ?? 1),
  };
}

export function has_effective_tag(tags: TagInstance[], name: string): boolean {
  const up = String(name ?? "").toUpperCase();
  return Array.isArray(tags) && tags.some((t) => String(t?.name ?? "").toUpperCase() === up);
}

export function tag_key_for(tag: TagInstance): string {
  return tag_key(tag);
}
