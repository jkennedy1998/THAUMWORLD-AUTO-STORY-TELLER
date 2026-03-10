// Sanitizers for defs+deltas migration.
//
// Goal: keep persisted inline instances lean (def_id + deltas) by stripping
// legacy/derived fields that should be computed from definitions at runtime.

type AnyObj = Record<string, any>;

function is_obj(v: any): v is AnyObj {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function sanitize_inline_item_tree(root: any): void {
  const visit = (it: any) => {
    if (!is_obj(it)) return;

    // Derived/legacy fields (do not persist).
    // Keep: id, def_id, qty, tag_add/tag_remove, contents, container_capacity, display_color, grid_x/grid_y.
    delete (it as any).name;
    delete (it as any).weight;
    delete (it as any).unit_weight;
    delete (it as any).tags;
    delete (it as any).display_char;
    delete (it as any).__derived_runtime;

    if (Array.isArray((it as any).contents)) {
      for (const child of (it as any).contents) visit(child);
    }
  };

  if (Array.isArray(root)) {
    for (const it of root) visit(it);
    return;
  }
  visit(root);
}

export function sanitize_place_tile_instance(tile: any): void {
  if (!is_obj(tile)) return;

  // Derived/runtime-only.
  delete (tile as any).tags;
  delete (tile as any).display_char;
  delete (tile as any).display_color;
  delete (tile as any).container_glyphs;
  delete (tile as any).walkable;
  delete (tile as any).blocks_sight;
  delete (tile as any).blocks_sound;
  delete (tile as any).__derived_runtime;

  // Tile contents are inline items.
  if (Array.isArray((tile as any).contents)) {
    sanitize_inline_item_tree((tile as any).contents);
  }
}

export function sanitize_place_for_save(place_any: any): void {
  if (!is_obj(place_any)) return;

  // Ground inline items.
  try {
    const g = (place_any as any).ground;
    if (g) {
      if (Array.isArray(g.main)) sanitize_inline_item_tree(g.main);
      if (g.scattered && typeof g.scattered === 'object') {
        for (const items of Object.values(g.scattered)) {
          if (Array.isArray(items)) sanitize_inline_item_tree(items);
        }
      }
    }
  } catch {
    // ignore
  }

  // Tiles (both layers).
  const scrub_tiles = (tiles_obj: any) => {
    if (!tiles_obj || !Array.isArray(tiles_obj.cells)) return;
    for (const row of tiles_obj.cells) {
      if (!Array.isArray(row)) continue;
      for (const tile of row) {
        if (!tile) continue;
        sanitize_place_tile_instance(tile);
      }
    }
  };
  scrub_tiles((place_any as any).tiles_z0);
  scrub_tiles((place_any as any).tiles);
}

export function sanitize_actor_for_save(actor_any: any): void {
  if (!is_obj(actor_any)) return;
  const body_slots = (actor_any as any).body_slots;
  if (!body_slots || typeof body_slots !== 'object') return;

  for (const slot of Object.values(body_slots)) {
    if (!is_obj(slot)) continue;
    sanitize_inline_item_tree((slot as any).armor);
    sanitize_inline_item_tree((slot as any).tool);
    if (Array.isArray((slot as any).garb)) sanitize_inline_item_tree((slot as any).garb);
  }
}
