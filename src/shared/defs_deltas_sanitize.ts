// Sanitizers for defs+deltas migration.
//
// Goal: keep persisted inline instances lean (def_id + deltas) by stripping
// legacy/derived fields that should be computed from definitions at runtime.

type AnyObj = Record<string, any>;

function is_obj(v: any): v is AnyObj {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function del(obj: AnyObj, key: string): boolean {
  if (!(key in obj)) return false;
  delete (obj as any)[key];
  return true;
}

export function sanitize_inline_item_tree(root: any): boolean {
  let changed = false;
  const visit = (it: any) => {
    if (!is_obj(it)) return;

    // Derived/legacy fields (do not persist).
    // Keep: id, def_id, qty, tag_add/tag_remove, contents, container_capacity, display_color, grid_x/grid_y.
    changed = del(it, 'name') || changed;
    changed = del(it, 'weight') || changed;
    changed = del(it, 'unit_weight') || changed;
    changed = del(it, 'tags') || changed;
    changed = del(it, 'resolved_tag_states') || changed;
    changed = del(it, 'value_mag') || changed;
    changed = del(it, 'display_char') || changed;
    changed = del(it, '__derived_runtime') || changed;

    if (Array.isArray((it as any).contents)) {
      for (const child of (it as any).contents) visit(child);
    }
  };

  if (Array.isArray(root)) {
    for (const it of root) visit(it);
    return changed;
  }
  visit(root);
  return changed;
}

export function sanitize_place_tile_instance(tile: any): boolean {
  if (!is_obj(tile)) return false;

  let changed = false;

  // Derived/runtime-only.
  changed = del(tile, 'tags') || changed;
  changed = del(tile, 'resolved_tag_states') || changed;
  changed = del(tile, 'value_mag') || changed;
  changed = del(tile, 'display_char') || changed;
  changed = del(tile, 'display_color') || changed;
  changed = del(tile, 'container_glyphs') || changed;
  changed = del(tile, 'render_shader') || changed;
  changed = del(tile, 'walkable') || changed;
  changed = del(tile, 'blocks_sight') || changed;
  changed = del(tile, 'blocks_sound') || changed;
  changed = del(tile, '__derived_runtime') || changed;
  changed = del(tile, '__physics') || changed;

  // Tile contents are inline items.
  if (Array.isArray((tile as any).contents)) {
    changed = sanitize_inline_item_tree((tile as any).contents) || changed;
  }
  if (Array.isArray((tile as any).grow_surfaces)) {
    for (const surface of (tile as any).grow_surfaces) {
      if (Array.isArray((surface as any)?.contents)) changed = sanitize_inline_item_tree((surface as any).contents) || changed;
    }
  }

  return changed;
}

export function sanitize_place_for_save(place_any: any): boolean {
  if (!is_obj(place_any)) return false;

  let changed = false;

  changed = del(place_any, '__api_runtime_augmented') || changed;

  // Ground inline items.
  try {
    const g = (place_any as any).ground;
    if (g) {
      if (Array.isArray(g.main)) changed = sanitize_inline_item_tree(g.main) || changed;
      if (g.scattered && typeof g.scattered === 'object') {
        for (const items of Object.values(g.scattered)) {
          if (Array.isArray(items)) changed = sanitize_inline_item_tree(items) || changed;
        }
      }
    }
  } catch {
    // ignore
  }

  // Tiles (all layers).
  const scrub_tiles = (tiles_obj: any) => {
    if (!tiles_obj || !Array.isArray(tiles_obj.cells)) return;
    for (const row of tiles_obj.cells) {
      if (!Array.isArray(row)) continue;
      for (const tile of row) {
        if (!tile) continue;
        changed = sanitize_place_tile_instance(tile) || changed;
      }
    }
  };
  for (const key of Object.keys(place_any as any)) {
    if (key === 'tiles' || /^tiles_z-?\d+$/.test(key)) {
      scrub_tiles((place_any as any)[key]);
    }
  }

  // Structures (instances): strip derived/runtime-only fields.
  try {
    const structs = (place_any as any).structures;
    if (Array.isArray(structs)) {
      for (const s of structs) {
        if (!is_obj(s)) continue;
        changed = del(s, 'tags') || changed;
        changed = del(s, 'resolved_tag_states') || changed;
        changed = del(s, 'value_mag') || changed;
        changed = del(s, 'display_char') || changed;
        changed = del(s, 'display_color') || changed;
        changed = del(s, 'container_glyphs') || changed;
        changed = del(s, 'render_shader') || changed;
        changed = del(s, 'body_model') || changed;
        changed = del(s, '__derived_runtime') || changed;
        if (Array.isArray((s as any).contents)) changed = sanitize_inline_item_tree((s as any).contents) || changed;
      }
    }
  } catch {
    // ignore
  }

  return changed;
}

export function sanitize_actor_for_save(actor_any: any): void {
  sanitize_character_for_save(actor_any);
}

export function sanitize_npc_for_save(npc_any: any): void {
  sanitize_character_for_save(npc_any);
}

function sanitize_character_for_save(character_any: any): void {
  if (!is_obj(character_any)) return;
  del(character_any, 'tags');
  del(character_any, 'resolved_tag_states');
  del(character_any, 'tag_value_mag');
  del(character_any, 'total_value_mag');
  const body_slots = (character_any as any).body_slots;
  if (!body_slots || typeof body_slots !== 'object') return;

  for (const slot of Object.values(body_slots)) {
    if (!is_obj(slot)) continue;
    sanitize_inline_item_tree((slot as any).armor);
    sanitize_inline_item_tree((slot as any).tool);
    if (Array.isArray((slot as any).garb)) sanitize_inline_item_tree((slot as any).garb);
  }

  const equipped_items = (character_any as any).equipped_items;
  if (equipped_items && typeof equipped_items === 'object') {
    sanitize_inline_item_tree(Object.values(equipped_items));
  }
}
