import type { TagInstance } from "../tag_system/registry.js";
import type { ResolvedTagState } from "../tag_system/resolved.js";
import { resolve_inline_item } from "../item_storage/resolve.js";
import { resolve_place_tile } from "../tile_storage/resolve.js";

export type PhysicsTagFlags = {
  effective_tags: TagInstance[];
  resolved_tag_states: ResolvedTagState[];
  occupies: boolean;
  container: boolean;
  gravity: boolean;
  pushable: boolean;
};

export function has_tag_name(tags: any, name: string): boolean {
  const up = String(name ?? "").toUpperCase();
  if (!Array.isArray(tags)) return false;
  return tags.some((t: any) => String(t?.name ?? "").toUpperCase() === up);
}

export function build_physics_tag_flags(tags: any, resolved_tag_states?: ResolvedTagState[] | null): PhysicsTagFlags {
  const effective_tags = Array.isArray(tags) ? (tags as TagInstance[]) : [];
  const resolved = Array.isArray(resolved_tag_states) ? resolved_tag_states : [];
  return {
    effective_tags,
    resolved_tag_states: resolved,
    occupies: has_tag_name(effective_tags, "OCCUPIES"),
    container: has_tag_name(effective_tags, "CONTAINER"),
    gravity: has_tag_name(effective_tags, "GRAVITY"),
    pushable: has_tag_name(effective_tags, "PUSHABLE"),
  };
}

export function resolve_tile_physics_tags(tile: any): PhysicsTagFlags {
  const resolved = tile ? resolve_place_tile(String(tile.kind ?? ""), tile) : null;
  return build_physics_tag_flags(
    resolved?.effective_tags ?? (Array.isArray(tile?.tags) ? tile.tags : []),
    resolved?.resolved_tag_states ?? [],
  );
}

export function resolve_structure_physics_tags(structure: any): PhysicsTagFlags {
  const inline_tags = Array.isArray(structure?.tags) ? structure.tags : null;
  if (inline_tags) return build_physics_tag_flags(inline_tags, []);
  const def_id = String(structure?.def_id ?? "");
  const resolved = def_id
    ? resolve_place_tile(def_id, { kind: def_id, tag_add: structure?.tag_add, tag_remove: structure?.tag_remove } as any)
    : null;
  return build_physics_tag_flags(resolved?.effective_tags ?? [], resolved?.resolved_tag_states ?? []);
}

export function resolve_inline_item_physics_tags(item_any: any): PhysicsTagFlags {
  const def_id = String(item_any?.def_id ?? "");
  const resolved = def_id ? resolve_inline_item(def_id, item_any as any) : null;
  return build_physics_tag_flags(
    resolved?.effective_tags ?? (Array.isArray(item_any?.tags) ? item_any.tags : []),
    resolved?.resolved_tag_states ?? [],
  );
}
