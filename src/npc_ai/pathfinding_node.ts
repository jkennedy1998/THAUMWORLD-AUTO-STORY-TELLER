/**
 * Node-only pathfinding for NPC movement.
 * Uses defs+deltas-safe tile semantics via the occupancy index.
 */

import type { Place, TilePosition } from "../types/place.js";
import { place_tile_blocks_movement } from "../place_storage/occupancy_index.js";

export type PathfindingOptions = {
  exclude_entity?: string;
  allow_diagonal?: boolean;
  max_iterations?: number;
  treat_occupied_as_wall?: boolean;
};

export type PathResult = {
  path: TilePosition[];
  blocked: boolean;
  blocked_at?: TilePosition;
};

export function is_tile_walkable(place: Place, tile: TilePosition, options: PathfindingOptions = {}): boolean {
  const { exclude_entity, treat_occupied_as_wall = true } = options;

  if (tile.x < 0 || tile.x >= place.tile_grid.width || tile.y < 0 || tile.y >= place.tile_grid.height) {
    return false;
  }

  if (place_tile_blocks_movement(place, tile.x, tile.y)) {
    return false;
  }

  // Obstacle features
  for (const feature of place.contents.features) {
    if (feature.is_obstacle) {
      for (const pos of feature.tile_positions) {
        if (pos.x === tile.x && pos.y === tile.y) return false;
      }
    }
  }

  // Entity occupancy
  if (treat_occupied_as_wall) {
    for (const npc of place.contents.npcs_present) {
      if (npc.npc_ref !== exclude_entity && npc.tile_position.x === tile.x && npc.tile_position.y === tile.y) {
        return false;
      }
    }
    for (const actor of place.contents.actors_present) {
      if (actor.actor_ref !== exclude_entity && actor.tile_position.x === tile.x && actor.tile_position.y === tile.y) {
        return false;
      }
    }
  }

  return true;
}

export function find_path(
  place: Place,
  start: TilePosition,
  goal: TilePosition,
  options: PathfindingOptions = {},
): PathResult {
  const {
    exclude_entity,
    allow_diagonal = false,
    max_iterations = 1000,
  } = options;

  if (start.x === goal.x && start.y === goal.y) {
    return { path: [], blocked: false };
  }

  if (!is_tile_walkable(place, goal, options)) {
    return { path: [], blocked: true, blocked_at: goal };
  }

  const dirs = allow_diagonal
    ? [
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 },
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 },
        { dx: 1, dy: 1 },
        { dx: 1, dy: -1 },
        { dx: -1, dy: 1 },
        { dx: -1, dy: -1 },
      ]
    : [
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 },
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 },
      ];

  const key = (x: number, y: number) => `${x},${y}`;
  const queue: TilePosition[] = [{ x: start.x, y: start.y }];
  const came_from = new Map<string, string | null>();
  came_from.set(key(start.x, start.y), null);

  let iters = 0;
  while (queue.length > 0 && iters < max_iterations) {
    iters++;
    const cur = queue.shift()!;
    if (cur.x === goal.x && cur.y === goal.y) break;

    for (const d of dirs) {
      const nx = cur.x + d.dx;
      const ny = cur.y + d.dy;
      const nk = key(nx, ny);
      if (came_from.has(nk)) continue;
      const next = { x: nx, y: ny };
      if (!is_tile_walkable(place, next, { ...options, exclude_entity })) continue;
      came_from.set(nk, key(cur.x, cur.y));
      queue.push(next);
    }
  }

  const goal_key = key(goal.x, goal.y);
  if (!came_from.has(goal_key)) {
    return { path: [], blocked: true, blocked_at: goal };
  }

  const path: TilePosition[] = [];
  let cur_key: string | null = goal_key;
  while (cur_key) {
    const [xs, ys] = cur_key.split(',');
    const x = parseInt(xs || '0', 10);
    const y = parseInt(ys || '0', 10);
    if (!(x === start.x && y === start.y)) path.push({ x, y });
    cur_key = came_from.get(cur_key) ?? null;
  }
  path.reverse();

  return { path, blocked: false };
}
