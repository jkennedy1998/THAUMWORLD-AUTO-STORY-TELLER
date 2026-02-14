export type Tile = { x: number; y: number };

export type PlaceBounds = { width: number; height: number };

export function choose_follow_tile(options: {
  npc_tile: Tile;
  actor_tile: Tile;
  bounds?: PlaceBounds;
  occupied?: Set<string>; // keys: "x,y"
}): Tile | null {
  const npc_tile = options.npc_tile;
  const actor_tile = options.actor_tile;
  const occupied = options.occupied ?? new Set<string>();
  const w = options.bounds?.width;
  const h = options.bounds?.height;

  const in_bounds = (x: number, y: number) => {
    if (w !== undefined && Number.isFinite(w) && w >= 0) {
      if (x < 0 || x >= w) return false;
    } else {
      if (x < 0) return false;
    }
    if (h !== undefined && Number.isFinite(h) && h >= 0) {
      if (y < 0 || y >= h) return false;
    } else {
      if (y < 0) return false;
    }
    return true;
  };

  const ax = Number(actor_tile.x);
  const ay = Number(actor_tile.y);
  const nx = Number(npc_tile.x);
  const ny = Number(npc_tile.y);

  if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(nx) || !Number.isFinite(ny)) return null;

  // Prefer orthogonal adjacency, then diagonals.
  const candidates: Tile[] = [
    { x: ax + 1, y: ay },
    { x: ax - 1, y: ay },
    { x: ax, y: ay + 1 },
    { x: ax, y: ay - 1 },
    { x: ax + 1, y: ay + 1 },
    { x: ax + 1, y: ay - 1 },
    { x: ax - 1, y: ay + 1 },
    { x: ax - 1, y: ay - 1 },
  ];

  let best: Tile | null = null;
  let best_d = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    if (!in_bounds(c.x, c.y)) continue;
    // Never attempt to path to the actor tile.
    if (c.x === ax && c.y === ay) continue;
    if (occupied.has(`${c.x},${c.y}`)) continue;

    const ddx = c.x - nx;
    const ddy = c.y - ny;
    const d = ddx * ddx + ddy * ddy;
    if (d < best_d) {
      best_d = d;
      best = c;
    }
  }

  return best;
}
