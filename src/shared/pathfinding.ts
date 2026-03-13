/**
 * Shared Pathfinding System
 * 
 * Unified BFS pathfinding for all entities (actors and NPCs).
 * Paths around occupied tiles (entities, features, items).
 */

import type { Place, TilePosition } from "../types/place.js";
import { can_place_volume, type OwnerRef, type MovementMode, type MoveCheck } from "../place_storage/movement_legality.js";

export type PathfindingOptions = {
  exclude_entity?: string; // Entity ref used as the moving owner
  allow_diagonal?: boolean; // Default: false
  max_iterations?: number; // Default: 1000
  treat_occupied_as_wall?: boolean; // Default: true
  movement_mode?: MovementMode; // Default: WALK
  reserved_stance_origins?: Set<string>; // Optional stance-origin reservations (keys: x_y_z)
};

export type PathResult = {
  path: TilePosition[];
  blocked: boolean;
  blocked_at?: TilePosition;
  blocked_check?: MoveCheck;
};

/**
 * Check if a tile is walkable
 */
export function is_tile_walkable(
  place: Place,
  tile: TilePosition,
  options: PathfindingOptions = {}
): boolean {
  const { exclude_entity, treat_occupied_as_wall = true } = options;
  
  // Check bounds
  if (tile.x < 0 || tile.x >= place.tile_grid.width ||
      tile.y < 0 || tile.y >= place.tile_grid.height) {
    return false;
  }

  const mode: MovementMode = options.movement_mode ?? "WALK";
  const owner_kind: OwnerRef["kind"] = (() => {
    const ref = String(exclude_entity ?? "");
    if (ref.startsWith("npc.")) return "npc";
    if (ref.startsWith("actor.")) return "actor";
    // Default to actor for legacy callsites.
    return "actor";
  })();
  const owner_id = String(exclude_entity ?? "actor.unknown");
  const owner: OwnerRef = { kind: owner_kind, id: owner_id };

  const bz = Math.floor(Number((place as any)?.coordinates?.elevation ?? 0)) || 0;
  const z0 = (() => {
    // Prefer entity elevation if present in place snapshot.
    if (owner_kind === "npc") {
      const n = place.contents.npcs_present.find((n0) => n0.npc_ref === owner_id) as any;
      if (n && typeof n.elevation === "number" && Number.isFinite(n.elevation)) return Math.floor(n.elevation);
    }
    if (owner_kind === "actor") {
      const a = place.contents.actors_present.find((a0) => a0.actor_ref === owner_id) as any;
      if (a && typeof a.elevation === "number" && Number.isFinite(a.elevation)) return Math.floor(a.elevation);
    }
    return bz;
  })();

  const ok = can_place_volume(
    place,
    owner,
    { x: tile.x, y: tile.y, z: z0 },
    mode,
    {
      exclude_owner: owner,
      support_policy: "any_footprint",
      ignore_occupants: !treat_occupied_as_wall,
      reserved_stance_origins: options.reserved_stance_origins,
    }
  );

  return ok.ok;
}

/**
 * BFS pathfinding - finds path around obstacles
 */
export function find_path(
  place: Place,
  start: TilePosition,
  goal: TilePosition,
  options: PathfindingOptions = {}
): PathResult {
  const {
    exclude_entity,
    allow_diagonal = false,
    max_iterations = 1000,
    treat_occupied_as_wall = true,
    movement_mode,
  } = options;
  
  // Already there
  if (start.x === goal.x && start.y === goal.y) {
    return { path: [], blocked: false };
  }
  
  // Check if goal is walkable
  const goal_check = (() => {
    const mode: MovementMode = movement_mode ?? "WALK";
    const owner_kind: OwnerRef["kind"] = (() => {
      const ref = String(exclude_entity ?? "");
      if (ref.startsWith("npc.")) return "npc";
      if (ref.startsWith("actor.")) return "actor";
      return "actor";
    })();
    const owner_id = String(exclude_entity ?? "actor.unknown");
    const owner: OwnerRef = { kind: owner_kind, id: owner_id };

    const bz = Math.floor(Number((place as any)?.coordinates?.elevation ?? 0)) || 0;
    const z0 = (() => {
      if (owner_kind === "npc") {
        const n = place.contents.npcs_present.find((n0) => n0.npc_ref === owner_id) as any;
        if (n && typeof n.elevation === "number" && Number.isFinite(n.elevation)) return Math.floor(n.elevation);
      }
      if (owner_kind === "actor") {
        const a = place.contents.actors_present.find((a0) => a0.actor_ref === owner_id) as any;
        if (a && typeof a.elevation === "number" && Number.isFinite(a.elevation)) return Math.floor(a.elevation);
      }
      return bz;
    })();

    return can_place_volume(place, owner, { x: goal.x, y: goal.y, z: z0 }, mode, {
      exclude_owner: owner,
      support_policy: "any_footprint",
      ignore_occupants: !treat_occupied_as_wall,
      reserved_stance_origins: options.reserved_stance_origins,
    });
  })();

  if (!goal_check.ok) {
    return { path: [], blocked: true, blocked_at: goal, blocked_check: goal_check };
  }
  
  // BFS
  const queue: Array<{ pos: TilePosition; path: TilePosition[] }> = [
    { pos: start, path: [] }
  ];
  const visited = new Set<string>();
  visited.add(`${start.x},${start.y}`);
  
  // 4-directional movement
  const directions = [
    { x: 0, y: 1 },   // North
    { x: 0, y: -1 },  // South
    { x: 1, y: 0 },   // East
    { x: -1, y: 0 },  // West
  ];
  
  // Add diagonals if allowed
  if (allow_diagonal) {
    directions.push(
      { x: 1, y: 1 },
      { x: 1, y: -1 },
      { x: -1, y: -1 },
      { x: -1, y: 1 }
    );
  }
  
  let iterations = 0;
  
  while (queue.length > 0 && iterations < max_iterations) {
    iterations++;
    const current = queue.shift()!;
    
    for (const dir of directions) {
      const next: TilePosition = {
        x: current.pos.x + dir.x,
        y: current.pos.y + dir.y,
      };
      
      const key = `${next.x},${next.y}`;
      
      if (visited.has(key)) continue;
      visited.add(key);
      
      // Check if this is the goal
      if (next.x === goal.x && next.y === goal.y) {
        return { path: [...current.path, next], blocked: false };
      }
      
      // Check if walkable
      const walkable = is_tile_walkable(place, next, {
        exclude_entity,
        treat_occupied_as_wall,
        movement_mode,
      });
      
      if (!walkable) continue;
      
      // Add to queue
      queue.push({
        pos: next,
        path: [...current.path, next],
      });
    }
  }
  
  // No path found
  return { path: [], blocked: true };
}

/**
 * Find path to nearest walkable tile near the goal
 * Used when goal is blocked but we want to get close
 */
export function find_path_to_nearby(
  place: Place,
  start: TilePosition,
  goal: TilePosition,
  max_distance: number = 3,
  options: PathfindingOptions = {}
): PathResult {
  // Try direct path first
  const direct = find_path(place, start, goal, options);
  if (!direct.blocked) {
    return direct;
  }
  
  // Try nearby tiles in spiral pattern
  const directions = [
    { x: 0, y: 1 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: -1, y: 0 },
    { x: 1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: -1 }, { x: -1, y: 1 },
  ];
  
  for (let distance = 1; distance <= max_distance; distance++) {
    for (const dir of directions) {
      const nearby: TilePosition = {
        x: goal.x + dir.x * distance,
        y: goal.y + dir.y * distance,
      };
      
      const result = find_path(place, start, nearby, options);
      if (!result.blocked) {
        return result;
      }
    }
  }
  
  return { path: [], blocked: true };
}
