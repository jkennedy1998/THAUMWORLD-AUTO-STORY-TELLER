/**
 * Shared Pathfinding System
 * 
 * Unified BFS pathfinding for all entities (actors and NPCs).
 * Paths around occupied tiles (entities, features, items).
 */

import type { Place, TilePosition } from "../types/place.js";
import { can_place_volume, get_place_world_z_bounds, type OwnerRef, type MovementMode, type MoveCheck } from "../place_storage/movement_legality.js";

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

type StanceNode = { x: number; y: number; z: number };

function get_owner_for_pathfinding(exclude_entity: string | undefined): OwnerRef {
  const owner_kind: OwnerRef["kind"] = (() => {
    const ref = String(exclude_entity ?? "");
    if (ref.startsWith("npc.")) return "npc";
    if (ref.startsWith("actor.")) return "actor";
    return "actor";
  })();
  const owner_id = String(exclude_entity ?? "actor.unknown");
  return { kind: owner_kind, id: owner_id };
}

function get_owner_start_z(place: Place, owner: OwnerRef): number {
  const bz = Math.floor(Number((place as any)?.coordinates?.elevation ?? 0)) || 0;
  if (owner.kind === "npc") {
    const n = place.contents.npcs_present.find((n0) => n0.npc_ref === owner.id) as any;
    if (n && typeof n.elevation === "number" && Number.isFinite(n.elevation)) return Math.floor(n.elevation);
  }
  if (owner.kind === "actor") {
    const a = place.contents.actors_present.find((a0) => a0.actor_ref === owner.id) as any;
    if (a && typeof a.elevation === "number" && Number.isFinite(a.elevation)) return Math.floor(a.elevation);
  }
  return bz;
}

function is_stance_walkable(
  place: Place,
  owner: OwnerRef,
  stance: StanceNode,
  options: PathfindingOptions = {}
): MoveCheck {
  const mode: MovementMode = options.movement_mode ?? "WALK";
  return can_place_volume(
    place,
    owner,
    { x: stance.x, y: stance.y, z: stance.z },
    mode,
    {
      exclude_owner: owner,
      support_policy: "any_footprint",
      ignore_occupants: !options.treat_occupied_as_wall,
      reserved_stance_origins: options.reserved_stance_origins,
    }
  );
}

function get_adjacent_reachable_stances(
  place: Place,
  current: StanceNode,
  dir: { x: number; y: number },
  owner: OwnerRef,
  options: PathfindingOptions = {}
): StanceNode[] {
  const nx = current.x + dir.x;
  const ny = current.y + dir.y;
  const w = Math.max(1, Math.floor(Number(place.tile_grid.width) || 1));
  const h = Math.max(1, Math.floor(Number(place.tile_grid.height) || 1));
  if (nx < 0 || ny < 0 || nx >= w || ny >= h) return [];

  const zb = get_place_world_z_bounds(place);
  const candidates = [current.z, current.z + 1, current.z - 1];
  const out: StanceNode[] = [];
  const seen = new Set<string>();
  for (const z of candidates) {
    if (z < zb.min_z || z > zb.max_z) continue;
    const key = `${nx},${ny},${z}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ok = is_stance_walkable(place, owner, { x: nx, y: ny, z }, options);
    if (ok.ok) out.push({ x: nx, y: ny, z });
  }
  return out;
}

/**
 * Check if a tile is walkable
 */
export function is_tile_walkable(
  place: Place,
  tile: TilePosition,
  options: PathfindingOptions = {}
): boolean {
  const { exclude_entity } = options;
  
  // Check bounds
  if (tile.x < 0 || tile.x >= place.tile_grid.width ||
      tile.y < 0 || tile.y >= place.tile_grid.height) {
    return false;
  }

  const owner = get_owner_for_pathfinding(exclude_entity);
  const z0 = (typeof tile.z === 'number' && Number.isFinite(tile.z)) ? Math.floor(tile.z) : get_owner_start_z(place, owner);
  const ok = is_stance_walkable(place, owner, { x: tile.x, y: tile.y, z: z0 }, options);

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
  
  const owner = get_owner_for_pathfinding(exclude_entity);
  const start_z = (typeof start.z === 'number' && Number.isFinite(start.z)) ? Math.floor(start.z) : get_owner_start_z(place, owner);

  // Already there in XY terms.
  if (start.x === goal.x && start.y === goal.y) {
    return { path: [], blocked: false };
  }
  
  // BFS
  const queue: Array<{ pos: StanceNode; path: TilePosition[] }> = [
    { pos: { x: start.x, y: start.y, z: start_z }, path: [] }
  ];
  const visited = new Set<string>();
  visited.add(`${start.x},${start.y},${start_z}`);
  
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
        const next_stances = get_adjacent_reachable_stances(place, current.pos, dir, owner, options);
        for (const next of next_stances) {
          const key = `${next.x},${next.y},${next.z}`;
          if (visited.has(key)) continue;
          visited.add(key);

          const next_tile: TilePosition = { x: next.x, y: next.y, z: next.z };

          // Reaching target XY at any reachable z counts as success.
          if (next.x === goal.x && next.y === goal.y) {
            return { path: [...current.path, next_tile], blocked: false };
          }

          queue.push({
            pos: next,
            path: [...current.path, next_tile],
          });
        }
     }
  }
  
  // No path found
  return { path: [], blocked: true, blocked_at: goal };
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
