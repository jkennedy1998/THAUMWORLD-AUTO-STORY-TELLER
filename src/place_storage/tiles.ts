import type { Place, PlaceTile, PlaceTiles, TilePosition, PlaceConnection } from "../types/place.js";
import { load_master_tile } from "../tile_storage/store.js";
import { resolve_place_tile, has_effective_tile_tag } from "../tile_storage/resolve.js";

function clamp_int(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

function interior_bounds(place: Place): { min_x: number; max_x: number; min_y: number; max_y: number } {
  // Interior excludes the perimeter ring.
  const w = place.tile_grid.width;
  const h = place.tile_grid.height;
  if (w <= 2 || h <= 2) {
    return { min_x: 0, max_x: Math.max(0, w - 1), min_y: 0, max_y: Math.max(0, h - 1) };
  }
  return { min_x: 1, max_x: w - 2, min_y: 1, max_y: h - 2 };
}

function calculate_door_position(place: Place, direction: string): TilePosition {
  const dir = String(direction || "").toLowerCase();
  const width = place.tile_grid.width;
  const height = place.tile_grid.height;

  // Door is on the perimeter ring.
  if (dir.includes("north") || dir.includes("up") || dir.includes("forward")) {
    return { x: Math.floor(width / 2), y: height - 1 };
  } else if (dir.includes("south") || dir.includes("down") || dir.includes("backward")) {
    return { x: Math.floor(width / 2), y: 0 };
  } else if (dir.includes("east") || dir.includes("right")) {
    return { x: width - 1, y: Math.floor(height / 2) };
  } else if (dir.includes("west") || dir.includes("left")) {
    return { x: 0, y: Math.floor(height / 2) };
  }

  // Fallback: clamp default entry onto perimeter if possible.
  const b = interior_bounds(place);
  const x = clamp_int(place.tile_grid.default_entry.x, 0, Math.max(0, width - 1));
  const y = clamp_int(place.tile_grid.default_entry.y, 0, Math.max(0, height - 1));
  if (x <= b.min_x) return { x: 0, y };
  if (x >= b.max_x) return { x: width - 1, y };
  if (y <= b.min_y) return { x, y: 0 };
  return { x, y: height - 1 };
}

/**
 * Create a PlaceTile instance from a tile definition.
 * Copies base tags and container capacity from the definition.
 */
function create_tile_from_definition(def_id: string, overrides?: Partial<PlaceTile>): PlaceTile {
  const tile: PlaceTile = {
    kind: def_id,
  };

  const result = load_master_tile(def_id);

  if (result.ok && result.tile.container_capacity) {
    tile.container_capacity = { ...result.tile.container_capacity };
  }

  if (overrides) Object.assign(tile, overrides);
  return tile;
}

function make_tiles(w: number, h: number): PlaceTiles {
  const cells: (PlaceTile | null)[][] = [];
  for (let y = 0; y < h; y++) {
    const row: (PlaceTile | null)[] = [];
    for (let x = 0; x < w; x++) row.push(null);
    cells.push(row);
  }
  return { width: w, height: h, cells: cells as any };
}

function make_filled_tiles(w: number, h: number, def_id: string): PlaceTiles {
  const cells: (PlaceTile | null)[][] = [];
  for (let y = 0; y < h; y++) {
    const row: (PlaceTile | null)[] = [];
    for (let x = 0; x < w; x++) row.push(create_tile_from_definition(def_id));
    cells.push(row);
  }
  return { width: w, height: h, cells: cells as any };
}

function set_tile(tiles: PlaceTiles, x: number, y: number, t: PlaceTile | null): void {
  const row = (tiles.cells as any)?.[y];
  if (!row) return;
  if (x < 0 || x >= tiles.width) return;
  row[x] = t;
}

function get_tile(tiles: PlaceTiles, x: number, y: number): PlaceTile | null {
  const row = (tiles.cells as any)?.[y];
  if (!row) return null;
  const t = row[x];
  return t ?? null;
}

export function tile_blocks_movement(tile: PlaceTile | null): boolean {
  if (!tile) return false;
  const resolved = resolve_place_tile(tile.kind, tile);
  const tags = resolved ? resolved.effective_tags : (tile.tags ?? []);
  return has_effective_tile_tag(tags, "OCCUPIES");
}

export function tile_blocks_los(tile: PlaceTile | null): boolean {
  if (!tile) return false;
  const resolved = resolve_place_tile(tile.kind, tile);
  const tags = resolved ? resolved.effective_tags : (tile.tags ?? []);
  return has_effective_tile_tag(tags, "COVER");
}

export function tile_is_door(tile: PlaceTile | null): boolean {
  if (!tile) return false;
  const resolved = resolve_place_tile(tile.kind, tile);
  const tags = resolved ? resolved.effective_tags : (tile.tags ?? []);
  return has_effective_tile_tag(tags, "DOOR");
}

export function tile_is_container(tile: PlaceTile | null): boolean {
  if (!tile) return false;
  const resolved = resolve_place_tile(tile.kind, tile);
  const tags = resolved ? resolved.effective_tags : (tile.tags ?? []);
  return has_effective_tile_tag(tags, "CONTAINER");
}

export function ensure_place_tiles(place: Place): { changed: boolean } {
  const w = Math.max(1, Math.floor(place.tile_grid.width));
  const h = Math.max(1, Math.floor(place.tile_grid.height));
  let changed = false;

  // Dev fixture is only for the 3dification test room.
  const is_test_room = place.id === "eden_crossroads_tavern";

  // Ensure z=0 support layer exists and is fully filled with base blocks.
  // Only enabled for the test room.
  if (is_test_room) {
    const z0 = (place as any).tiles_z0 as PlaceTiles | undefined;
    const needs_new_z0 =
      !z0 ||
      z0.width !== w ||
      z0.height !== h ||
      !Array.isArray((z0 as any).cells) ||
      (z0 as any).cells.length !== h;
    if (needs_new_z0) {
      (place as any).tiles_z0 = make_filled_tiles(w, h, "tile_stone_brick");
      changed = true;
    } else {
      // Fill any missing rows/cells.
      for (let y = 0; y < h; y++) {
        const row = (z0.cells as any)?.[y];
        if (!row || row.length !== w) {
          const next: (PlaceTile | null)[] = [];
          for (let x = 0; x < w; x++) next.push(create_tile_from_definition("tile_stone_brick"));
          (z0.cells as any)[y] = next;
          changed = true;
          continue;
        }
        for (let x = 0; x < w; x++) {
          if (!row[x]) {
            row[x] = create_tile_from_definition("tile_stone_brick");
            changed = true;
          }
        }
      }
    }
  }

  const needs_new =
    !place.tiles ||
    place.tiles.width !== w ||
    place.tiles.height !== h ||
    !Array.isArray((place.tiles as any).cells) ||
    (place.tiles as any).cells.length !== h;

  if (needs_new) {
    place.tiles = make_tiles(w, h);
    changed = true;
  }

  const tiles = place.tiles!;

  // Ensure every row is correct length; preserve existing cells.
  for (let y = 0; y < h; y++) {
    const row = (tiles.cells as any)?.[y];
    if (!row || row.length !== w) {
      const next: (PlaceTile | null)[] = [];
      for (let x = 0; x < w; x++) {
        const cur = row && Array.isArray(row) ? row[x] : null;
        next.push(cur ?? null);
      }
      (tiles.cells as any)[y] = next;
      changed = true;
    }
  }

  // Perimeter wall ring uses the base block tile (test room only).
  if (is_test_room) {
    for (let x = 0; x < w; x++) {
      for (const y of [0, h - 1]) {
        const cur = get_tile(tiles, x, y);
        if (!cur || !tile_is_door(cur) || cur.kind !== "door") {
          const want = create_tile_from_definition("tile_stone_brick");
          if (!cur || cur.kind !== want.kind) changed = true;
          set_tile(tiles, x, y, want);
        }
      }
    }
    for (let y = 0; y < h; y++) {
      for (const x of [0, w - 1]) {
        const cur = get_tile(tiles, x, y);
        if (!cur || !tile_is_door(cur) || cur.kind !== "door") {
          const want = create_tile_from_definition("tile_stone_brick");
          if (!cur || cur.kind !== want.kind) changed = true;
          set_tile(tiles, x, y, want);
        }
      }
    }
  }

  // Doors for connections override wall ring.
  const conns: PlaceConnection[] = Array.isArray(place.connections) ? place.connections : [];
  for (const conn of conns) {
    const pos = calculate_door_position(place, conn.direction);
    const x = clamp_int(pos.x, 0, w - 1);
    const y = clamp_int(pos.y, 0, h - 1);
    const cur = get_tile(tiles, x, y);
    const want = create_tile_from_definition("door", {
      door: { target_place_id: conn.target_place_id, direction: conn.direction },
    });
    if (!cur || cur.kind !== "door" || cur.door?.target_place_id !== want.door!.target_place_id || cur.door?.direction !== want.door!.direction) {
      set_tile(tiles, x, y, want);
      changed = true;
    }
  }

  // Dev fixture: place a chest + bush + small interior stone segment for LOS testing.
  // Test room only.
  if (is_test_room) {
    try {
      const b = interior_bounds(place);
      const chest_x = clamp_int(b.min_x + 1, b.min_x, b.max_x);
      const chest_y = clamp_int(b.min_y + 1, b.min_y, b.max_y);
      if (!get_tile(tiles, chest_x, chest_y)) {
        set_tile(tiles, chest_x, chest_y, create_tile_from_definition("chest", { contents: [] }));
        changed = true;
      }

      const bush_x = clamp_int(b.min_x + 2, b.min_x, b.max_x);
      const bush_y = clamp_int(b.min_y + 1, b.min_y, b.max_y);
      if (!get_tile(tiles, bush_x, bush_y)) {
        set_tile(tiles, bush_x, bush_y, create_tile_from_definition("foliage_snowberry_bush", { last_tick_processed: 0 }));
        changed = true;
      }

      const wall_x = clamp_int(b.min_x + 6, b.min_x, b.max_x);
      const wall_y0 = clamp_int(b.min_y + 3, b.min_y, b.max_y);
      const wall_y1 = clamp_int(b.min_y + 6, b.min_y, b.max_y);
      for (let y = wall_y0; y <= wall_y1; y++) {
        if (!get_tile(tiles, wall_x, y)) {
          set_tile(tiles, wall_x, y, create_tile_from_definition("tile_stone_brick"));
          changed = true;
        }
      }
    } catch {
      // ignore
    }
  }

  // Keep default entry in-bounds; for test room, keep it inside the interior.
  const b = is_test_room ? interior_bounds(place) : { min_x: 0, max_x: Math.max(0, w - 1), min_y: 0, max_y: Math.max(0, h - 1) };
  const ex = clamp_int(place.tile_grid.default_entry.x, b.min_x, b.max_x);
  const ey = clamp_int(place.tile_grid.default_entry.y, b.min_y, b.max_y);
  if (ex !== place.tile_grid.default_entry.x || ey !== place.tile_grid.default_entry.y) {
    place.tile_grid.default_entry = { x: ex, y: ey };
    changed = true;
  }

  return { changed };
}

export function ensure_place_entities_not_on_walls(place: Place): { changed: boolean } {
  // Only relevant for the test room which has a perimeter wall ring.
  if (place.id !== "eden_crossroads_tavern") return { changed: false };
  const b = interior_bounds(place);
  let changed = false;
  if (place.tile_grid.width <= 2 || place.tile_grid.height <= 2) return { changed: false };

  for (const a of place.contents?.actors_present ?? []) {
    const x = clamp_int(a.tile_position.x, b.min_x, b.max_x);
    const y = clamp_int(a.tile_position.y, b.min_y, b.max_y);
    if (x !== a.tile_position.x || y !== a.tile_position.y) {
      a.tile_position = { x, y };
      changed = true;
    }
  }
  for (const n of place.contents?.npcs_present ?? []) {
    const x = clamp_int(n.tile_position.x, b.min_x, b.max_x);
    const y = clamp_int(n.tile_position.y, b.min_y, b.max_y);
    if (x !== n.tile_position.x || y !== n.tile_position.y) {
      n.tile_position = { x, y };
      changed = true;
    }
  }

  return { changed };
}
