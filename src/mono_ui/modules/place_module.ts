import type { Canvas, Module, Rect, Rgb, PointerEvent, WheelEvent } from "../types.js";
import { rect_width, rect_height } from "../types.js";
import { draw_border } from "../padding.js";
import { get_color_by_name } from "../colors.js";
import type { Place, PlaceNPC, PlaceActor, TilePosition } from "../../types/place.js";

// Debug logging helper - re-enabled with balanced output
function debug_log_place(...args: any[]) {
  // eslint-disable-next-line no-console
  console.log("[PlaceModule]", ...args.map((a: any) => typeof a === 'object' ? JSON.stringify(a) : a));
}

export type PlaceModuleConfig = {
  id: string;
  rect: Rect;

  // External state provider
  get_place: () => Place | null;

  // Target selection callback - called when user right-clicks an entity
  // Returns true if target was valid and selected, false otherwise
  on_select_target?: (target_ref: string) => boolean;

  // Actor movement callback - called when actor completes movement to a new tile
  // Allows persisting position change to storage
  on_actor_move?: (actor_ref: string, new_position: TilePosition) => Promise<void> | void;

  // Styling
  border_rgb?: Rgb;
  bg_rgb?: Rgb;
  floor_char?: string;
  floor_rgb?: Rgb;
  npc_rgb?: Rgb;
  actor_rgb?: Rgb;
  wall_rgb?: Rgb;
  grid_rgb?: Rgb;

  // Initial view state
  initial_scale?: number; // tiles per character (1 = 1:1, 2 = 2 tiles per char)
};

type ViewState = {
  // Viewport offset in tile coordinates (bottom-left of view)
  offset_x: number;
  offset_y: number;
  // Scale: how many tiles per character (1, 2, 4, etc. - must be power of 2 for clean rendering)
  scale: number;
};

type HoveredTile = {
  x: number;
  y: number;
  entity?: PlaceNPC | PlaceActor;
} | null;

// Particle system for path visualization and effects
type Particle = {
  x: number;           // Tile x position
  y: number;           // Tile y position  
  char: string;        // Visual character
  rgb: Rgb;           // Color
  created_at: number;  // Timestamp (Date.now())
  lifespan_ms: number; // How long to live
};

// Movement state
type MovementState = {
  path: TilePosition[];     // Array of tile positions to move through
  current_index: number;    // Current position in path
  start_time: number;       // When movement started
  last_move_time: number;   // Last time we moved a tile
  is_moving: boolean;       // Whether actively moving
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function get_initial(name: string): string {
  if (!name || name.length === 0) return "?";
  return name.charAt(0).toUpperCase();
}

function is_power_of_2(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

// Padding beyond place edges to allow comfortable panning
const PADDING_TILES = 25;

export function make_place_module(config: PlaceModuleConfig): Module {
  const border_rgb = config.border_rgb ?? get_color_by_name("light_gray").rgb;
  const bg_rgb = config.bg_rgb ?? get_color_by_name("off_black").rgb;
  const floor_char = config.floor_char ?? ".";
  const floor_rgb = config.floor_rgb ?? get_color_by_name("dark_gray").rgb;
  const npc_rgb = config.npc_rgb ?? get_color_by_name("pale_yellow").rgb;
  const actor_rgb = config.actor_rgb ?? get_color_by_name("vivid_green").rgb;
  const grid_rgb = config.grid_rgb ?? get_color_by_name("medium_gray").rgb;

  // View state
  const view: ViewState = {
    offset_x: 0,
    offset_y: 0,
    scale: config.initial_scale ?? 1,
  };

  let hovered: HoveredTile = null;
  let is_panning = false;
  let last_pointer_x = 0;
  let last_pointer_y = 0;

  // Tile cycling state for multiple entities
  type EntityCycleState = {
    last_update: number;  // timestamp of last cycle
    current_index: number;  // which entity to show
  };
  const tile_cycle_state = new Map<string, EntityCycleState>();  // "x,y" -> state
  const CYCLE_INTERVAL_MS = 500;  // 0.5 seconds

  // Particle system
  let particles: Particle[] = [];
  const PARTICLE_LIFESPAN_MS = 300;  // Particles live for 300ms (shorter to prevent buildup)
  
  // Movement state for actor
  let movement_state: MovementState = {
    path: [],
    current_index: 0,
    start_time: 0,
    last_move_time: 0,
    is_moving: false
  };
  
  // Local actor position cache - prevents race condition with API refreshes
  // This stores the "source of truth" position during movement
  let local_actor_position: TilePosition | null = null;
  
  // Movement speed: 10 tiles per second (100ms per tile) - faster!
  const MOVEMENT_SPEED_MS = 100;

  // Derived dimensions (excluding border)
  function inner_rect(): Rect {
    const r = config.rect;
    return {
      x0: r.x0 + 1,
      y0: r.y0 + 1,
      x1: r.x1 - 1,
      y1: r.y1 - 1,
    };
  }

  function inner_size(): { width: number; height: number } {
    const inner = inner_rect();
    return {
      width: rect_width(inner),
      height: rect_height(inner),
    };
  }

  // Convert screen coord to tile coord
  function screen_to_tile(
    screen_x: number,
    screen_y: number
  ): TilePosition | null {
    const inner = inner_rect();
    if (
      screen_x < inner.x0 ||
      screen_x > inner.x1 ||
      screen_y < inner.y0 ||
      screen_y > inner.y1
    ) {
      return null;
    }

    const rel_x = screen_x - inner.x0;
    const rel_y = screen_y - inner.y0;

    const tile_x = view.offset_x + rel_x * view.scale;
    const tile_y = view.offset_y + rel_y * view.scale;

    return { x: Math.floor(tile_x), y: Math.floor(tile_y) };
  }

  // Get view bounds with padding
  function get_view_bounds(place: Place): { min_x: number; max_x: number; min_y: number; max_y: number } {
    const { width, height } = inner_size();
    const tiles_visible_x = width * view.scale;
    const tiles_visible_y = height * view.scale;
    
    return {
      min_x: -PADDING_TILES,
      max_x: Math.max(0, place.tile_grid.width + PADDING_TILES - tiles_visible_x),
      min_y: -PADDING_TILES,
      max_y: Math.max(0, place.tile_grid.height + PADDING_TILES - tiles_visible_y),
    };
  }

  // Center view on a specific tile
  function center_on_tile(tile_x: number, tile_y: number, place: Place): void {
    const { width, height } = inner_size();
    const tiles_visible_x = width * view.scale;
    const tiles_visible_y = height * view.scale;
    const bounds = get_view_bounds(place);

    // Calculate offset to center the tile with some margin so it's not at the edge
    // Add a small margin (2 tiles) to ensure the entity is clearly visible
    const MARGIN = 2;
    const target_offset_x = Math.floor(tile_x - tiles_visible_x / 2 + MARGIN);
    const target_offset_y = Math.floor(tile_y - tiles_visible_y / 2 + MARGIN);

    view.offset_x = clamp(target_offset_x, bounds.min_x, bounds.max_x);
    view.offset_y = clamp(target_offset_y, bounds.min_y, bounds.max_y);

    debug_log_place("Centered view on tile", JSON.stringify({
      target_tile: { x: tile_x, y: tile_y },
      view_size: { w: width, h: height },
      tiles_visible: { x: tiles_visible_x, y: tiles_visible_y },
      calculated_offset: { x: target_offset_x, y: target_offset_y },
      clamped_offset: { x: view.offset_x, y: view.offset_y },
      bounds
    }));
  }

  // Get all entities at tile position (for cycling)
  function get_all_entities_at(
    tile_x: number,
    tile_y: number,
    place: Place
  ): (PlaceNPC | PlaceActor)[] {
    const entities: (PlaceNPC | PlaceActor)[] = [];
    
    // Priority order: NPCs first, then actors
    const npcs = place.contents.npcs_present.filter(
      (n) => n.tile_position.x === tile_x && n.tile_position.y === tile_y
    );
    entities.push(...npcs);
    
    const actors = place.contents.actors_present.filter(
      (a) => a.tile_position.x === tile_x && a.tile_position.y === tile_y
    );
    entities.push(...actors);
    
    return entities;
  }

  // Get entity at tile position with cycling
  function get_entity_at(
    tile_x: number,
    tile_y: number,
    place: Place
  ): PlaceNPC | PlaceActor | null {
    const entities = get_all_entities_at(tile_x, tile_y, place);
    
    if (entities.length === 0) {
      return null;
    }
    
    if (entities.length === 1) {
      return entities[0] ?? null;
    }
    
    // Multiple entities - use cycling
    const key = `${tile_x},${tile_y}`;
    const now = Date.now();
    let cycle = tile_cycle_state.get(key);
    
    if (!cycle) {
      cycle = { last_update: now, current_index: 0 };
      tile_cycle_state.set(key, cycle);
    }
    
    // Check if we should advance to next entity
    if (now - cycle.last_update >= CYCLE_INTERVAL_MS) {
      cycle.current_index = (cycle.current_index + 1) % entities.length;
      cycle.last_update = now;
      debug_log_place(`Cycling tile (${tile_x},${tile_y}): now showing index ${cycle.current_index} of ${entities.length}`);
    }
    
    return entities[cycle.current_index] ?? null;
  }

  // Get display character for a tile
  function get_tile_char(
    tile_x: number,
    tile_y: number,
    place: Place
  ): { char: string; rgb: Rgb } {
    // Check for entities (NPCs take precedence over actors if both on same tile)
    const npc = place.contents.npcs_present.find(
      (n) =>
        n.tile_position.x === tile_x && n.tile_position.y === tile_y
    );
    if (npc) {
      return { char: get_initial(npc.npc_ref.split(".").pop() ?? "N"), rgb: npc_rgb };
    }

    const actor = place.contents.actors_present.find(
      (a) =>
        a.tile_position.x === tile_x && a.tile_position.y === tile_y
    );
    if (actor) {
      return { char: get_initial(actor.actor_ref.split(".").pop() ?? "A"), rgb: actor_rgb };
    }

    // Default floor
    return { char: floor_char, rgb: floor_rgb };
  }

  // Check if a tile is walkable (not occupied, in bounds)
  function is_tile_walkable(tile_x: number, tile_y: number, place: Place): boolean {
    // Check bounds
    if (tile_x < 0 || tile_x >= place.tile_grid.width ||
        tile_y < 0 || tile_y >= place.tile_grid.height) {
      return false;
    }
    
    // Check for entities
    const entities = get_all_entities_at(tile_x, tile_y, place);
    if (entities.length > 0) {
      return false;
    }
    
    // TODO: Check for solid features (walls, furniture)
    // For now, all empty tiles are walkable
    
    return true;
  }

  // Simple BFS pathfinding
  function find_path(
    start_x: number,
    start_y: number,
    end_x: number,
    end_y: number,
    place: Place
  ): TilePosition[] {
    // If start == end, no path needed
    if (start_x === end_x && start_y === end_y) {
      return [];
    }
    
    // If target not walkable, can't move there
    if (!is_tile_walkable(end_x, end_y, place)) {
      return [];
    }
    
    // BFS
    const queue: Array<{x: number; y: number; path: TilePosition[]}> = [
      { x: start_x, y: start_y, path: [{ x: start_x, y: start_y }] }
    ];
    const visited = new Set<string>([`${start_x},${start_y}`]);
    
    const directions = [
      { dx: 0, dy: 1 },   // North
      { dx: 0, dy: -1 },  // South
      { dx: 1, dy: 0 },   // East
      { dx: -1, dy: 0 }   // West
    ];
    
    while (queue.length > 0) {
      const current = queue.shift()!;
      
      if (current.x === end_x && current.y === end_y) {
        // Return path excluding start position
        return current.path.slice(1);
      }
      
      for (const dir of directions) {
        const next_x = current.x + dir.dx;
        const next_y = current.y + dir.dy;
        const key = `${next_x},${next_y}`;
        
        if (visited.has(key)) continue;
        
        // Check if walkable OR if it's the target (target might have entity)
        const is_target = (next_x === end_x && next_y === end_y);
        const is_walkable = is_tile_walkable(next_x, next_y, place);
        
        if (!is_walkable && !is_target) continue;
        
        visited.add(key);
        queue.push({
          x: next_x,
          y: next_y,
          path: [...current.path, { x: next_x, y: next_y }]
        });
      }
    }
    
    // No path found
    return [];
  }

  // Spawn particles along a path
  function spawn_path_particles(path: TilePosition[]) {
    const now = Date.now();
    const path_rgb = get_color_by_name("pale_yellow").rgb;
    
    for (const pos of path) {
      particles.push({
        x: pos.x,
        y: pos.y,
        char: "·",
        rgb: path_rgb,
        created_at: now,
        lifespan_ms: PARTICLE_LIFESPAN_MS
      });
    }
  }

  // Update particles (remove expired ones)
  function update_particles() {
    const now = Date.now();
    particles = particles.filter(p => (now - p.created_at) < p.lifespan_ms);
  }

  // Render the place
  function draw_place(canvas: Canvas, place: Place): void {
    const inner = inner_rect();
    const { width, height } = inner_size();

    // Calculate visible tile range
    const visible_tile_start_x = view.offset_x;
    const visible_tile_start_y = view.offset_y;
    const visible_tile_end_x = view.offset_x + width * view.scale;
    const visible_tile_end_y = view.offset_y + height * view.scale;

    // Clear background
    canvas.fill_rect(inner, { char: " ", rgb: bg_rgb });

    // Draw floor grid and entities
    for (let screen_y = inner.y0; screen_y <= inner.y1; screen_y++) {
      for (let screen_x = inner.x0; screen_x <= inner.x1; screen_x++) {
        const rel_x = screen_x - inner.x0;
        const rel_y = screen_y - inner.y0;

        // Calculate which tile(s) this screen cell represents
        const tile_start_x = view.offset_x + rel_x * view.scale;
        const tile_start_y = view.offset_y + rel_y * view.scale;
        const tile_end_x = tile_start_x + view.scale;
        const tile_end_y = tile_start_y + view.scale;

        // Check if this screen cell is within place bounds
        // Use <= to include tiles at the boundary (e.g., x=19 in a 20-wide place)
        const in_bounds =
          tile_start_x < place.tile_grid.width &&
          tile_start_y < place.tile_grid.height &&
          tile_end_x > 0 &&
          tile_end_y > 0;

        if (!in_bounds) {
          // Outside place bounds - render as void
          canvas.set(screen_x, screen_y, { char: " ", rgb: bg_rgb });
          continue;
        }

        // For scale > 1, show the "most important" entity or floor
        // Priority: NPC > Actor > Floor
        let found_entity = false;

        // Check for entities in this tile block
        let checked_tiles = 0;
        for (let tx = Math.floor(tile_start_x); tx < tile_end_x && !found_entity; tx++) {
          for (let ty = Math.floor(tile_start_y); ty < tile_end_y && !found_entity; ty++) {
            if (tx < 0 || ty < 0 || tx >= place.tile_grid.width || ty >= place.tile_grid.height) {
              continue;
            }
            checked_tiles++;

            const entity = get_entity_at(tx, ty, place);
            if (entity) {
              const is_npc = "npc_ref" in entity;
              const name = is_npc
                ? (entity as PlaceNPC).npc_ref.split(".").pop() ?? "N"
                : (entity as PlaceActor).actor_ref.split(".").pop() ?? "A";
              const rgb = is_npc ? npc_rgb : actor_rgb;
              canvas.set(screen_x, screen_y, {
                char: get_initial(name),
                rgb,
                weight_index: 6,  // Bold for visibility
              });
              found_entity = true;
              break;
            }
          }
        }

        if (!found_entity) {
          // Draw floor
          const tile_char = view.scale > 2 ? "·" : floor_char;
          canvas.set(screen_x, screen_y, { char: tile_char, rgb: floor_rgb });
        }
      }
    }

    // Draw place boundary indicators on INVALID tiles (outside place bounds)
    // This places walls at x=-1, x=width, y=-1, y=height so entities at 0..width-1 render clearly inside
    
    // Left edge: at x = -1 (one tile left of 0)
    const left_screen_x = Math.floor((-1 - view.offset_x) / view.scale) + inner.x0;
    if (left_screen_x >= inner.x0 && left_screen_x <= inner.x1) {
      for (let y = inner.y0; y <= inner.y1; y++) {
        const tile_y = view.offset_y + (y - inner.y0) * view.scale;
        // Draw on the left edge if the row has any place tiles visible
        if (tile_y >= -1 && tile_y <= place.tile_grid.height) {
          canvas.set(left_screen_x, y, { char: "│", rgb: grid_rgb });
        }
      }
    }

    // Bottom edge: at y = -1 (one tile below 0)
    const bottom_screen_y = Math.floor((-1 - view.offset_y) / view.scale) + inner.y0;
    if (bottom_screen_y >= inner.y0 && bottom_screen_y <= inner.y1) {
      for (let x = inner.x0; x <= inner.x1; x++) {
        const tile_x = view.offset_x + (x - inner.x0) * view.scale;
        // Draw on the bottom edge if the column has any place tiles visible
        if (tile_x >= -1 && tile_x <= place.tile_grid.width) {
          canvas.set(x, bottom_screen_y, { char: "─", rgb: grid_rgb });
        }
      }
    }

    // Right edge: at x = width (one tile right of width-1)
    const right_screen_x = Math.floor((place.tile_grid.width - view.offset_x) / view.scale) + inner.x0;
    if (right_screen_x >= inner.x0 && right_screen_x <= inner.x1) {
      for (let y = inner.y0; y <= inner.y1; y++) {
        const tile_y = view.offset_y + (y - inner.y0) * view.scale;
        // Draw on the right edge if the row has any place tiles visible
        if (tile_y >= -1 && tile_y <= place.tile_grid.height) {
          canvas.set(right_screen_x, y, { char: "│", rgb: grid_rgb });
        }
      }
    }

    // Top edge: at y = height (one tile above height-1)
    const top_screen_y = Math.floor((place.tile_grid.height - view.offset_y) / view.scale) + inner.y0;
    if (top_screen_y >= inner.y0 && top_screen_y <= inner.y1) {
      for (let x = inner.x0; x <= inner.x1; x++) {
        const tile_x = view.offset_x + (x - inner.x0) * view.scale;
        // Draw on the top edge if the column has any place tiles visible
        if (tile_x >= -1 && tile_x <= place.tile_grid.width) {
          canvas.set(x, top_screen_y, { char: "─", rgb: grid_rgb });
        }
      }
    }

    // Draw doors at connection points
    const door_rgb = get_color_by_name("vivid_cyan").rgb;
    const door_char = "=";
    
    for (const conn of place.connections) {
      // Determine door position based on direction
      let door_tile_x: number;
      let door_tile_y: number;
      let door_screen_x: number;
      let door_screen_y: number;
      
      const dir = conn.direction.toLowerCase();
      
      if (dir.includes("north") || dir.includes("up") || dir.includes("forward")) {
        // Door on top edge
        door_tile_x = Math.floor(place.tile_grid.width / 2);
        door_tile_y = place.tile_grid.height;
        door_screen_x = inner.x0 + Math.floor((door_tile_x - view.offset_x) / view.scale);
        door_screen_y = top_screen_y;
      } else if (dir.includes("south") || dir.includes("down") || dir.includes("backward")) {
        // Door on bottom edge
        door_tile_x = Math.floor(place.tile_grid.width / 2);
        door_tile_y = -1;
        door_screen_x = inner.x0 + Math.floor((door_tile_x - view.offset_x) / view.scale);
        door_screen_y = bottom_screen_y;
      } else if (dir.includes("east") || dir.includes("right")) {
        // Door on right edge
        door_tile_x = place.tile_grid.width;
        door_tile_y = Math.floor(place.tile_grid.height / 2);
        door_screen_x = right_screen_x;
        door_screen_y = inner.y0 + Math.floor((door_tile_y - view.offset_y) / view.scale);
      } else if (dir.includes("west") || dir.includes("left")) {
        // Door on left edge
        door_tile_x = -1;
        door_tile_y = Math.floor(place.tile_grid.height / 2);
        door_screen_x = left_screen_x;
        door_screen_y = inner.y0 + Math.floor((door_tile_y - view.offset_y) / view.scale);
      } else {
        // Default: place at entry point
        door_tile_x = place.tile_grid.default_entry.x;
        door_tile_y = place.tile_grid.default_entry.y;
        door_screen_x = inner.x0 + Math.floor((door_tile_x - view.offset_x) / view.scale);
        door_screen_y = inner.y0 + Math.floor((door_tile_y - view.offset_y) / view.scale);
      }
      
      // Draw door if visible
      if (door_screen_x >= inner.x0 && door_screen_x <= inner.x1 &&
          door_screen_y >= inner.y0 && door_screen_y <= inner.y1) {
        canvas.set(door_screen_x, door_screen_y, { 
          char: door_char, 
          rgb: door_rgb,
          weight_index: 5 
        });
      }
    }

    // Draw particles (path visualization and effects)
    update_particles();
    for (const p of particles) {
      const screen_x = inner.x0 + Math.floor((p.x - view.offset_x) / view.scale);
      const screen_y = inner.y0 + Math.floor((p.y - view.offset_y) / view.scale);
      
      if (screen_x >= inner.x0 && screen_x <= inner.x1 &&
          screen_y >= inner.y0 && screen_y <= inner.y1) {
        // Only draw particle if tile doesn't have an entity
        const existing = canvas.get(screen_x, screen_y);
        if (existing && (existing.char === ' ' || existing.char === '.' || existing.char === '·')) {
          canvas.set(screen_x, screen_y, {
            char: p.char,
            rgb: p.rgb,
            weight_index: 4
          });
        }
      }
    }

    // Draw hover highlight
    if (hovered) {
      const tile_x = hovered.x;
      const tile_y = hovered.y;
      const screen_x =
        inner.x0 + Math.floor((tile_x - view.offset_x) / view.scale);
      const screen_y =
        inner.y0 + Math.floor((tile_y - view.offset_y) / view.scale);

      if (
        screen_x >= inner.x0 &&
        screen_x <= inner.x1 &&
        screen_y >= inner.y0 &&
        screen_y <= inner.y1
      ) {
        // Invert colors or use highlight
        const cell = canvas.get(screen_x, screen_y);
        if (cell) {
          canvas.set(screen_x, screen_y, {
            char: cell.char,
            rgb: get_color_by_name("pale_orange").rgb,
            weight_index: 6,
          });
        }
      }
    }

    // Draw info overlay at top
    const info_text = `[${place.name}] ${place.tile_grid.width}x${place.tile_grid.height} | View: ${Math.floor(view.offset_x)},${Math.floor(view.offset_y)} | Scale: 1:${view.scale}`;
    const info_y = inner.y1;
    let info_x = inner.x0;
    for (const char of info_text) {
      if (info_x > inner.x1) break;
      canvas.set(info_x, info_y, { char, rgb: get_color_by_name("off_white").rgb });
      info_x++;
    }

    // Draw hover info at bottom
    if (hovered && hovered.entity) {
      const is_npc = "npc_ref" in hovered.entity;
      const ref = is_npc
        ? (hovered.entity as PlaceNPC).npc_ref
        : (hovered.entity as PlaceActor).actor_ref;
      const status = is_npc
        ? (hovered.entity as PlaceNPC).status
        : (hovered.entity as PlaceActor).status;
      const hover_text = `[${ref}] ${status}`;
      let hover_x = inner.x0;
      const hover_y = inner.y0;
      for (const char of hover_text) {
        if (hover_x > inner.x1) break;
        canvas.set(hover_x, hover_y, { char, rgb: get_color_by_name("pale_yellow").rgb });
        hover_x++;
      }
    }
  }

  return {
    id: config.id,
    rect: config.rect,
    Focusable: true,

    Draw(canvas: Canvas): void {
      const place = config.get_place();

      // Draw border
      draw_border(canvas, config.rect, border_rgb);

      if (!place) {
        // No place loaded - show placeholder
        const inner = inner_rect();
        canvas.fill_rect(inner, { char: " ", rgb: bg_rgb });
        const msg = "No place loaded";
        const msg_x =
          inner.x0 + Math.floor((rect_width(inner) - msg.length) / 2);
        const msg_y = inner.y0 + Math.floor(rect_height(inner) / 2);
        for (let i = 0; i < msg.length; i++) {
          canvas.set(msg_x + i, msg_y, {
            char: msg.charAt(i),
            rgb: get_color_by_name("medium_gray").rgb,
          });
        }
        return;
      }

      // Center on default entry if this is first render and we're at origin
      if (view.offset_x === 0 && view.offset_y === 0) {
        debug_log_place("First render, centering on default entry", {
          entry: place.tile_grid.default_entry,
          place_size: { w: place.tile_grid.width, h: place.tile_grid.height }
        });
        center_on_tile(
          place.tile_grid.default_entry.x,
          place.tile_grid.default_entry.y,
          place
        );
      }

      // Update movement if active
      if (movement_state.is_moving && movement_state.path.length > 0) {
        const now = Date.now();
        const time_since_last_move = now - movement_state.last_move_time;
        
        if (time_since_last_move >= MOVEMENT_SPEED_MS) {
          // Time to move to next tile
          const next_pos = movement_state.path[movement_state.current_index];
          
          if (!next_pos) {
            // Safety check - end movement if no next position
            movement_state.is_moving = false;
            movement_state.path = [];
          } else {
            // Update local position (source of truth during movement)
            local_actor_position = { x: next_pos.x, y: next_pos.y };
            
            // Spawn particle at new position
            particles.push({
              x: next_pos.x,
              y: next_pos.y,
              char: "·",
              rgb: get_color_by_name("vivid_cyan").rgb,
              created_at: now,
              lifespan_ms: PARTICLE_LIFESPAN_MS
            });
            
            debug_log_place("Actor moved to", { x: next_pos.x, y: next_pos.y });
            
            movement_state.current_index++;
            movement_state.last_move_time = now;
            
            // Check if movement complete
            if (movement_state.current_index >= movement_state.path.length) {
              movement_state.is_moving = false;
              movement_state.path = [];
              
              // Get actor reference for saving
              const actor = place.contents.actors_present[0];
              const actor_ref = actor?.actor_ref;
              
              debug_log_place("Movement complete - saving position", { actor_ref, final_position: local_actor_position });
              
              // Persist final position to storage
              if (actor_ref && local_actor_position && config.on_actor_move) {
                Promise.resolve(config.on_actor_move(actor_ref, local_actor_position)).catch(err => {
                  debug_log_place("Error saving position:", err);
                });
              }
            }
          }
        }
      }

      // Apply local position to actor for rendering (prevents API refresh glitch)
      if (local_actor_position && place.contents.actors_present.length > 0) {
        const actor = place.contents.actors_present[0];
        if (actor) {
          actor.tile_position.x = local_actor_position.x;
          actor.tile_position.y = local_actor_position.y;
        }
      }

      draw_place(canvas, place);
    },

    OnPointerMove(e: PointerEvent): void {
      const place = config.get_place();
      if (!place) return;

      // Handle panning
      if (is_panning && e.buttons & 1) {
        const dx = e.x - last_pointer_x;
        const dy = e.y - last_pointer_y;

        const bounds = get_view_bounds(place);

        // Convert screen delta to tile delta (inverted - dragging moves view opposite)
        view.offset_x = clamp(
          view.offset_x - dx * view.scale,
          bounds.min_x,
          bounds.max_x
        );
        view.offset_y = clamp(
          view.offset_y - dy * view.scale,
          bounds.min_y,
          bounds.max_y
        );

        last_pointer_x = e.x;
        last_pointer_y = e.y;
        return;
      }

      // Update hover
      const tile = screen_to_tile(e.x, e.y);
      if (tile) {
        const entity = get_entity_at(tile.x, tile.y, place);
        hovered = { x: tile.x, y: tile.y, entity: entity ?? undefined };
      } else {
        hovered = null;
      }

      last_pointer_x = e.x;
      last_pointer_y = e.y;
    },

    OnPointerDown(e: PointerEvent): void {
      if (e.button === 0) {
        is_panning = true;
        last_pointer_x = e.x;
        last_pointer_y = e.y;
      }
    },

    OnPointerUp(e: PointerEvent): void {
      if (e.button === 0) {
        is_panning = false;
      }
    },

    OnClick(e: PointerEvent): void {
      const place = config.get_place();
      if (!place) return;

      // Convert screen to tile coordinates
      const tile = screen_to_tile(e.x, e.y);
      if (!tile) return;

      // Check if clicked on an entity (NPC or actor)
      const entity = get_entity_at(tile.x, tile.y, place);
      if (entity) {
        // Entity clicked - let the targeting system handle it
        return;
      }

      // Check if tile is walkable
      if (!is_tile_walkable(tile.x, tile.y, place)) {
        debug_log_place("Click-to-move: Tile not walkable", { x: tile.x, y: tile.y });
        return;
      }

      // Find the actor (player) to move
      // For now, move the first actor found
      const actor = place.contents.actors_present[0];
      if (!actor) {
        debug_log_place("Click-to-move: No actor to move");
        return;
      }

      const start_x = actor.tile_position.x;
      const start_y = actor.tile_position.y;

      // Don't move if already there
      if (start_x === tile.x && start_y === tile.y) {
        return;
      }

      // Find path
      const path = find_path(start_x, start_y, tile.x, tile.y, place);
      
      if (path.length === 0) {
        debug_log_place("Click-to-move: No path found", { 
          from: { x: start_x, y: start_y }, 
          to: { x: tile.x, y: tile.y } 
        });
        return;
      }

      // Set up movement
      movement_state = {
        path: path,
        current_index: 0,
        start_time: Date.now(),
        last_move_time: Date.now(),
        is_moving: true
      };

      // Initialize local position from actor's current position
      // This prevents race conditions with API refreshes during movement
      local_actor_position = { x: start_x, y: start_y };

      // Show path particles
      spawn_path_particles(path);

      debug_log_place("Click-to-move: Path found, starting movement", {
        from: { x: start_x, y: start_y },
        to: { x: tile.x, y: tile.y },
        path_length: path.length,
        estimated_time_ms: path.length * MOVEMENT_SPEED_MS
      });
    },

    OnPointerLeave(): void {
      is_panning = false;
      hovered = null;
    },

    OnContextMenu(e: PointerEvent): void {
      const place = config.get_place();
      if (!place) return;

      // Convert screen to tile coordinates
      const tile = screen_to_tile(e.x, e.y);
      if (!tile) {
        // Check if clicked on a door (outside normal place bounds)
        const inner = inner_rect();
        const rel_x = e.x - inner.x0;
        const rel_y = e.y - inner.y0;
        const tile_x = Math.floor(view.offset_x + rel_x * view.scale);
        const tile_y = Math.floor(view.offset_y + rel_y * view.scale);
        
        // Check if this is near a door position
        for (const conn of place.connections) {
          const dir = conn.direction.toLowerCase();
          let door_tile_x: number;
          let door_tile_y: number;
          
          if (dir.includes("north") || dir.includes("up") || dir.includes("forward")) {
            door_tile_x = Math.floor(place.tile_grid.width / 2);
            door_tile_y = place.tile_grid.height;
          } else if (dir.includes("south") || dir.includes("down") || dir.includes("backward")) {
            door_tile_x = Math.floor(place.tile_grid.width / 2);
            door_tile_y = -1;
          } else if (dir.includes("east") || dir.includes("right")) {
            door_tile_x = place.tile_grid.width;
            door_tile_y = Math.floor(place.tile_grid.height / 2);
          } else if (dir.includes("west") || dir.includes("left")) {
            door_tile_x = -1;
            door_tile_y = Math.floor(place.tile_grid.height / 2);
          } else {
            door_tile_x = place.tile_grid.default_entry.x;
            door_tile_y = place.tile_grid.default_entry.y;
          }
          
          // Check if clicked near this door (within 1 tile)
          if (Math.abs(tile_x - door_tile_x) <= 1 && Math.abs(tile_y - door_tile_y) <= 1) {
            debug_log_place("DOOR CLICKED:", {
              target_place_id: conn.target_place_id,
              direction: conn.direction,
              description: conn.description,
              travel_time: conn.travel_time_seconds
            });
            return;
          }
        }
        
        debug_log_place("ContextMenu: Clicked outside place bounds", { x: e.x, y: e.y, tile_x, tile_y });
        return;
      }

      // Check if clicked on a door within place bounds
      for (const conn of place.connections) {
        const dir = conn.direction.toLowerCase();
        let door_tile_x: number;
        let door_tile_y: number;
        
        if (dir.includes("north") || dir.includes("up") || dir.includes("forward")) {
          door_tile_x = Math.floor(place.tile_grid.width / 2);
          door_tile_y = place.tile_grid.height - 1;
        } else if (dir.includes("south") || dir.includes("down") || dir.includes("backward")) {
          door_tile_x = Math.floor(place.tile_grid.width / 2);
          door_tile_y = 0;
        } else if (dir.includes("east") || dir.includes("right")) {
          door_tile_x = place.tile_grid.width - 1;
          door_tile_y = Math.floor(place.tile_grid.height / 2);
        } else if (dir.includes("west") || dir.includes("left")) {
          door_tile_x = 0;
          door_tile_y = Math.floor(place.tile_grid.height / 2);
        } else {
          door_tile_x = place.tile_grid.default_entry.x;
          door_tile_y = place.tile_grid.default_entry.y;
        }
        
        // Check if clicked on or very near this door
        if (Math.abs(tile.x - door_tile_x) <= 1 && Math.abs(tile.y - door_tile_y) <= 1) {
          debug_log_place("DOOR CLICKED:", {
            target_place_id: conn.target_place_id,
            direction: conn.direction,
            description: conn.description,
            travel_time: conn.travel_time_seconds
          });
          return;
        }
      }

      // Get what's at this tile (use get_all to show cycling indicator)
      const all_entities = get_all_entities_at(tile.x, tile.y, place);
      const entity = get_entity_at(tile.x, tile.y, place);
      
      if (entity && config.on_select_target) {
        const is_npc = "npc_ref" in entity;
        const ref = is_npc 
          ? (entity as PlaceNPC).npc_ref 
          : (entity as PlaceActor).actor_ref;
        
        // Attempt to select this target
        const success = config.on_select_target(ref);
        
        if (success) {
          debug_log_place("ContextMenu: Selected target", { 
            tile: { x: tile.x, y: tile.y }, 
            type: is_npc ? "NPC" : "Actor", 
            ref,
            total_entities_on_tile: all_entities.length
          });
        } else {
          debug_log_place("ContextMenu: Target not in available targets list", { 
            tile: { x: tile.x, y: tile.y }, 
            type: is_npc ? "NPC" : "Actor", 
            ref 
          });
        }
      } else if (entity) {
        // No callback configured, just log
        const is_npc = "npc_ref" in entity;
        const ref = is_npc 
          ? (entity as PlaceNPC).npc_ref 
          : (entity as PlaceActor).actor_ref;
        debug_log_place("ContextMenu: Targeted entity (no selection callback)", { 
          tile: { x: tile.x, y: tile.y }, 
          type: is_npc ? "NPC" : "Actor", 
          ref 
        });
      } else {
        debug_log_place("ContextMenu: Targeted empty tile", { x: tile.x, y: tile.y });
      }
    },

    OnWheel(e: WheelEvent): void {
      const place = config.get_place();
      if (!place) return;

      const bounds = get_view_bounds(place);

      // Zoom with ctrl, pan with shift, else scroll vertically
      if (e.ctrl) {
        // Zoom
        const old_scale = view.scale;
        if (e.delta_y > 0) {
          // Zoom out (increase scale)
          view.scale = Math.min(view.scale * 2, 8);
        } else {
          // Zoom in (decrease scale)
          view.scale = Math.max(view.scale / 2, 1);
        }

        // Adjust offset to zoom toward center
        if (view.scale !== old_scale) {
          const { width, height } = inner_size();
          const new_bounds = get_view_bounds(place);
          const center_tile_x = view.offset_x + (width * old_scale) / 2;
          const center_tile_y = view.offset_y + (height * old_scale) / 2;

          view.offset_x = clamp(
            center_tile_x - (width * view.scale) / 2,
            new_bounds.min_x,
            new_bounds.max_x
          );
          view.offset_y = clamp(
            center_tile_y - (height * view.scale) / 2,
            new_bounds.min_y,
            new_bounds.max_y
          );
        }
      } else if (e.shift) {
        // Horizontal scroll
        const scroll_amount = e.delta_y > 0 ? 1 : -1;
        view.offset_x = clamp(
          view.offset_x + scroll_amount * view.scale * 2,
          bounds.min_x,
          bounds.max_x
        );
      } else {
        // Vertical scroll
        const scroll_amount = e.delta_y > 0 ? -1 : 1;
        view.offset_y = clamp(
          view.offset_y + scroll_amount * view.scale * 2,
          bounds.min_y,
          bounds.max_y
        );
      }
    },

    OnKeyDown(e: KeyboardEvent): void {
      const place = config.get_place();
      if (!place) return;

      const scroll_step = Math.max(1, view.scale);
      const bounds = get_view_bounds(place);

      switch (e.key) {
        case "ArrowUp":
        case "w":
        case "W":
          view.offset_y = clamp(
            view.offset_y + scroll_step,
            bounds.min_y,
            bounds.max_y
          );
          break;
        case "ArrowDown":
        case "s":
        case "S":
          view.offset_y = clamp(
            view.offset_y - scroll_step,
            bounds.min_y,
            bounds.max_y
          );
          break;
        case "ArrowLeft":
        case "a":
        case "A":
          view.offset_x = clamp(
            view.offset_x - scroll_step,
            bounds.min_x,
            bounds.max_x
          );
          break;
        case "ArrowRight":
        case "d":
        case "D":
          view.offset_x = clamp(
            view.offset_x + scroll_step,
            bounds.min_x,
            bounds.max_x
          );
          break;
        case "Home":
          // Center on default entry
          center_on_tile(
            place.tile_grid.default_entry.x,
            place.tile_grid.default_entry.y,
            place
          );
          break;
        case "+":
        case "=":
          // Zoom in
          if (view.scale > 1) {
            const old_scale = view.scale;
            view.scale = Math.max(view.scale / 2, 1);
            // Recenter
            const { width, height } = inner_size();
            const new_bounds = get_view_bounds(place);
            const center_tile_x = view.offset_x + (width * old_scale) / 2;
            const center_tile_y = view.offset_y + (height * old_scale) / 2;
            view.offset_x = clamp(
              center_tile_x - (width * view.scale) / 2,
              new_bounds.min_x,
              new_bounds.max_x
            );
            view.offset_y = clamp(
              center_tile_y - (height * view.scale) / 2,
              new_bounds.min_y,
              new_bounds.max_y
            );
          }
          break;
        case "-":
        case "_":
          // Zoom out
          const old_scale = view.scale;
          view.scale = Math.min(view.scale * 2, 8);
          // Recenter
          const { width, height } = inner_size();
          const new_bounds = get_view_bounds(place);
          const center_tile_x = view.offset_x + (width * old_scale) / 2;
          const center_tile_y = view.offset_y + (height * old_scale) / 2;
          view.offset_x = clamp(
            center_tile_x - (width * view.scale) / 2,
            new_bounds.min_x,
            new_bounds.max_x
          );
          view.offset_y = clamp(
            center_tile_y - (height * view.scale) / 2,
            new_bounds.min_y,
            new_bounds.max_y
          );
          break;
        case "0":
          // Reset zoom to 1:1 and center on entry
          view.scale = 1;
          center_on_tile(
            place.tile_grid.default_entry.x,
            place.tile_grid.default_entry.y,
            place
          );
          break;
      }
    },
  };
}
