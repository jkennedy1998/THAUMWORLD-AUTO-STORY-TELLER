import type { PlaceTile } from "../types/place.js";
import type { TagInstance } from "../tag_system/registry.js";
import { apply_tag_deltas, type TagRemoveOp } from "../tag_system/tag_deltas.js";
import { load_master_tile } from "./store.js";
import type { TileDefinition } from "./types.js";
import { debug_warn } from "../shared/debug.js";

const warned_legacy_tile_kinds = new Set<string>();

export type ResolvedTile = {
  def: TileDefinition;
  effective_tags: TagInstance[];
  weight: number;
  display_char: string;
  display_color: string;
  container_glyphs: TileDefinition["container_glyphs"] | null;
};

function normalize_remove_ops(rm: PlaceTile["tag_remove"]): TagRemoveOp[] {
  if (!Array.isArray(rm)) return [];
  return rm
    .map((op) => ({ key: String((op as any)?.key ?? ""), mag: Number((op as any)?.mag ?? 0) }))
    .filter((op) => op.key && Number.isFinite(op.mag) && op.mag > 0)
    .map((op) => ({ key: op.key, mag: Math.floor(op.mag) }));
}

function enforce_tile_tag_prerequisites(tags: TagInstance[], kind: string): TagInstance[] {
  if (!Array.isArray(tags) || tags.length === 0) return [];
  const hasTag = (name: string): boolean => tags.some((t) => String(t?.name ?? "").toUpperCase() === String(name).toUpperCase());
  return tags.filter((tag) => {
    const tag_name = String(tag?.name ?? "").toUpperCase();
    if (tag_name !== "PUSHABLE") return true;
    const ok = hasTag("GRAVITY");
    if (!ok) {
      debug_warn("PLACE_TILE_TAGS", `Dropping PUSHABLE without GRAVITY prerequisite (kind=${kind})`);
    }
    return ok;
  });
}

export function resolve_place_tile(kind: string, tile: PlaceTile): ResolvedTile | null {
  try {
    const any_tile: any = tile as any;
    if (any_tile?.tags !== undefined && any_tile?.__derived_runtime !== true) {
      const k = String(kind ?? '');
      if (k && !warned_legacy_tile_kinds.has(k)) {
        warned_legacy_tile_kinds.add(k);
        debug_warn('PLACE_TILE_LEGACY', `Place tile has legacy stored tags; prefer tag_add/tag_remove only (kind=${k})`);
      }
    }
  } catch {
    // ignore
  }
  const def_res = load_master_tile(kind);
  if (!def_res.ok) return null;
  const def = def_res.tile;

  const add = Array.isArray(tile.tag_add) ? (tile.tag_add as TagInstance[]) : [];
  const remove = normalize_remove_ops(tile.tag_remove);
  const effective_tags = enforce_tile_tag_prerequisites(apply_tag_deltas({ base: def.tags ?? [], add, remove }), kind);

  return {
    def,
    effective_tags,
    weight: Number(def.weight),
    display_char: String(def.display_char ?? "?").charAt(0) || "?",
    display_color: String(def.display_color ?? "#888888"),
    container_glyphs: def.container_glyphs ?? null,
  };
}

export function has_effective_tile_tag(tags: TagInstance[], name: string): boolean {
  const up = String(name ?? "").toUpperCase();
  return Array.isArray(tags) && tags.some((t) => String(t?.name ?? "").toUpperCase() === up);
}
