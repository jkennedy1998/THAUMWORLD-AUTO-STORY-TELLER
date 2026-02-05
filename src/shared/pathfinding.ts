/**
 * Shared Pathfinding System
 * 
 * Unified BFS pathfinding for all entities (actors and NPCs).
 * Paths around occupied tiles (entities, features, items).
 */

import type { Place, TilePosition } from "../types/place.js";

export type PathfindingOptions = {
  exclude_entity?: string;  // Entity ref to exclude from blocking (the moving entity)
  allow_diagonal?: boolean; // Default: false
  max_iterations?: number;  // Default: 1000
  treat_occupied_as_wall?: boolean; // Default: true - path around occupied tiles
};

export type PathResult = {
  path: TilePosition[];
  blocked: boolean;
  blocked_at?: TilePosition;
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
  
  // Check for obstacle features
  for (const feature of place.contents.features) {
    if (feature.is_obstacle) {
      for (const pos of feature.tile_positions) {
        if (pos.x === tile.x && pos.y === tile.y) {
          return false;
        }
      }
    }
  }
  
  // Check for blocking items
  for (const item of place.contents.items_on_ground) {
    // Items don't currently have is_blocking field, but check position
    if (item.tile_position.x === tile.x && 
        item.tile_position.y === tile.y) {
      // For now, items don't block unless they're large
      // TODO: Add size check when item size is implemented
    }
  }
  
  // Check for NPCs (unless it's the excluded entity)
  if (treat_occupied_as_wall) {
    for (const npc of place.contents.npcs_present) {
      if (npc.npc_ref !== exclude_entity &&
          npc.tile_position.x === tile.x &&
          npc.tile_position.y === tile.y) {
        return false;
      }
    }
    
    // Check for actors
    for (const actor of place.contents.actors_present) {
      if (actor.actor_ref !== exclude_entity &&
          actor.tile_position.x === tile.x &&
          actor.tile_position.y === tile.y) {
        return false;
      }
    }
  }
  
  return true;
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
    treat_occupied_as_wall = true 
  } = options;
  
  // Already there
  if (start.x === goal.x && start.y === goal.y) {
    return { path: [], blocked: false };
  }
  
  // Check if goal is walkable
  const goal_walkable = is_tile_walkable(place, goal, { 
    exclude_entity,
    treat_occupied_as_wall 
  });
  
  if (!goal_walkable) {
    return { path: [], blocked: true, blocked_at: goal };
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
        treat_occupied_as_wall 
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
