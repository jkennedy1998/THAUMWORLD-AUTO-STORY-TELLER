import type { Place, PlaceTile, PlaceTiles, TilePosition, PlaceConnection } from "../types/place.js";
import type { TagInstance } from "../tag_system/registry.js";

function clamp_int(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

function interior_bounds(place: Place): { min_x: number; max_x: number; min_y: number; max_y: number } {
  // Interior excludes the perimeter wall ring.
  // If the room is too small to have an interior, collapse to 0..w-1.
  const w = place.tile_grid.width;
  const h = place.tile_grid.height;
  if (w <= 2 || h <= 2) {
    return { min_x: 0, max_x: Math.max(0, w - 1), min_y: 0, max_y: Math.max(0, h - 1) };
  }
  return { min_x: 1, max_x: w - 2, min_y: 1, max_y: h - 2 };
}

function calculate_door_position(place: Place, direction: string): TilePosition {
  const dir = String(direction || '').toLowerCase();
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

function default_tile_for(kind: PlaceTile["kind"]): PlaceTile {
  const tags: TagInstance[] = [{ name: 'STRUCTURE', mag: 1, meta: [], scope: ['TILE'] }];
  if (kind === 'wall') return { kind, collidable: true, tags };
  if (kind === 'door') return { kind, collidable: false, tags: [{ name: 'DOOR', mag: 1, meta: [], scope: ['TILE'] }] };
  return { kind, collidable: false, tags };
}

function make_tiles(w: number, h: number): PlaceTiles {
  const cells: PlaceTile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: PlaceTile[] = [];
    for (let x = 0; x < w; x++) row.push(default_tile_for('floor'));
    cells.push(row);
  }
  return { width: w, height: h, cells };
}

function set_tile(tiles: PlaceTiles, x: number, y: number, t: PlaceTile): void {
  const row = tiles.cells[y];
  if (!row) return;
  if (x < 0 || x >= tiles.width) return;
  row[x] = t;
}

function get_tile(tiles: PlaceTiles, x: number, y: number): PlaceTile | null {
  const row = tiles.cells[y];
  if (!row) return null;
  const t = row[x];
  return t ?? null;
}

export function ensure_place_tiles(place: Place): { changed: boolean } {
  const w = Math.max(1, Math.floor(place.tile_grid.width));
  const h = Math.max(1, Math.floor(place.tile_grid.height));

  let changed = false;

  // Create or resize tiles.
  const needs_new =
    !place.tiles ||
    place.tiles.width !== w ||
    place.tiles.height !== h ||
    !Array.isArray(place.tiles.cells) ||
    place.tiles.cells.length !== h;
  if (needs_new) {
    place.tiles = make_tiles(w, h);
    changed = true;
  }

  const tiles = place.tiles!;

  // Ensure every row is correct length (preserve existing tiles).
  for (let y = 0; y < h; y++) {
    const row = tiles.cells[y];
    if (!row || row.length !== w) {
      const next: PlaceTile[] = [];
      for (let x = 0; x < w; x++) {
        const cur = row && Array.isArray(row) ? row[x] : null;
        next.push(cur ? cur : default_tile_for('floor'));
      }
      tiles.cells[y] = next;
      changed = true;
    }
  }

  // Fill missing/null cells with floor, but do not overwrite existing tiles.
  for (let y = 0; y < h; y++) {
    const row = tiles.cells[y]!;
    for (let x = 0; x < w; x++) {
      const cur = row[x];
      if (!cur) {
        row[x] = default_tile_for('floor');
        changed = true;
      }
    }
  }

  // Perimeter wall ring (do not overwrite explicit door tiles).
  for (let x = 0; x < w; x++) {
    for (const y of [0, h - 1]) {
      const cur = get_tile(tiles, x, y);
      if (!cur || cur.kind !== 'door') {
        set_tile(tiles, x, y, default_tile_for('wall'));
        if (!cur || cur.kind !== 'wall') changed = true;
      }
    }
  }
  for (let y = 0; y < h; y++) {
    for (const x of [0, w - 1]) {
      const cur = get_tile(tiles, x, y);
      if (!cur || cur.kind !== 'door') {
        set_tile(tiles, x, y, default_tile_for('wall'));
        if (!cur || cur.kind !== 'wall') changed = true;
      }
    }
  }

  // Doors for connections override walls.
  const conns: PlaceConnection[] = Array.isArray(place.connections) ? place.connections : [];
  for (const conn of conns) {
    const pos = calculate_door_position(place, conn.direction);
    const x = clamp_int(pos.x, 0, w - 1);
    const y = clamp_int(pos.y, 0, h - 1);

    const cur = get_tile(tiles, x, y);
    const want: PlaceTile = {
      kind: 'door',
      collidable: false,
      door: { target_place_id: conn.target_place_id, direction: conn.direction },
    };
    if (!cur || cur.kind !== 'door' || cur.door?.target_place_id !== want.door!.target_place_id || cur.door?.direction !== want.door!.direction) {
      set_tile(tiles, x, y, want);
      changed = true;
    }
  }

  // Temporary dev fixture: ensure at least one interior tile has a container-like contents array.
  // This provides a stable UI target for tile-container interactions during foundations work.
  try {
    const b = interior_bounds(place);
    const fx = clamp_int(b.min_x + 1, b.min_x, b.max_x);
    const fy = clamp_int(b.min_y + 1, b.min_y, b.max_y);
    const cur = get_tile(tiles, fx, fy);
    if (cur && cur.kind === 'floor') {
      const tags = Array.isArray(cur.tags) ? cur.tags : [];
      const has_container = tags.some(t => String((t as any)?.name ?? '').toUpperCase() === 'CONTAINER');
      if (!has_container || !Array.isArray((cur as any).contents)) {
        const next: PlaceTile = {
          ...cur,
          collidable: true,
          tags: [...tags, { name: 'CONTAINER', mag: 1, meta: [], scope: ['TILE'] }],
          contents: Array.isArray((cur as any).contents) ? (cur as any).contents : [],
          container_capacity: { max_slots: 12 },
        };
        set_tile(tiles, fx, fy, next);
        changed = true;
      }
    }
  } catch {
    // ignore
  }

  // If a tile is tagged as a container but has no explicit collision, treat it as an obstacle for now.
  for (let y = 0; y < h; y++) {
    const row = tiles.cells[y]!;
    for (let x = 0; x < w; x++) {
      const t = row[x];
      if (!t) continue;
      if (typeof t.collidable === 'boolean') continue;
      const tags = Array.isArray((t as any).tags) ? (t as any).tags : [];
      const is_container = tags.some((tg: any) => String(tg?.name ?? '').toUpperCase() === 'CONTAINER');
      if (is_container) {
        (t as any).collidable = true;
        changed = true;
      }
    }
  }

  // Ensure default entry is not on a wall tile.
  const b = interior_bounds(place);
  const ex = clamp_int(place.tile_grid.default_entry.x, b.min_x, b.max_x);
  const ey = clamp_int(place.tile_grid.default_entry.y, b.min_y, b.max_y);
  if (ex !== place.tile_grid.default_entry.x || ey !== place.tile_grid.default_entry.y) {
    place.tile_grid.default_entry = { x: ex, y: ey };
    changed = true;
  }

  return { changed };
}

export function ensure_place_entities_not_on_walls(place: Place): { changed: boolean } {
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
