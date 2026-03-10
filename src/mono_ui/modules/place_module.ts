import type { Canvas, Module, Rect, Rgb, PointerEvent, WheelEvent, DragEvent, Cell } from "../types.js";
import { rect_width, rect_height } from "../types.js";
import { draw_module_border, BORDER_STYLES } from "../module_borders.js";
import { get_color_by_name } from "../colors.js";
import type { Place, PlaceNPC, PlaceActor, PlaceConnection, TilePosition, PlaceTile } from "../../types/place.js";
import { get_entity_path, start_entity_movement, register_place, unregister_place } from "../../shared/movement_engine.js";
import { type TagChangeEvent } from "../../shared/event_emitter.js";
import { initWebSocketClient, type WebSocketClient } from "../websocket_client.js";
import type { TagInstance } from "../../tag_system/registry.js";
import {
  DEBUG_VISION,
  register_particle_spawner,
  update_npc_debug_visuals,
  spawn_sense_broadcast_particles,
} from "../vision_debugger.js";
import { get_sense_profile } from "../../action_system/sense_broadcast.js";
import { get_facing } from "../../npc_ai/facing_system.js";
import { update_actor_position_in_place, set_npc_tracked_position, get_npc_visual_status } from "./movement_command_handler.js";
import { play_sfx } from "../sfx/sfx_player.js";
import { make_entity_payload, make_ground_items_tile_payload, make_item_like_payload, make_pile_payload, make_simple_tile_payload } from "../../render_shaders/payload_builders.js";
import { draw_render_queue, type RenderRequest } from "../../render_shaders/render_queue.js";
import { ctx_place_tile } from "../../render_shaders/context_builders.js";
import { PlaceDomLayers } from "../place_dom_layers.js";
import type { GridCell } from "../../ascii_painter/types.js";
import { create_canvas } from "../canvas.js";
import { touch_world_layers_owner } from "../world_layers_owner.js";
import { compute_dom_viewport_for_rect } from "../runtime/dom_viewport.js";
import { create_place_camera_controller } from "../runtime/place_camera_controller.js";

/**
 * Convert hex color string to RGB object
 * Supports #RRGGBB format
 */
function hex_to_rgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.trim().replace(/^#/, "");
  if (clean.length !== 6) {
    return { r: 128, g: 128, b: 128 }; // Fallback gray
  }
  
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
    return { r: 128, g: 128, b: 128 }; // Fallback gray
  }
  
  return { r, g, b };
}

function footstep_cooldown_ms(speed_tpm: number): number {
  const tpm = Number.isFinite(speed_tpm) && speed_tpm > 0 ? speed_tpm : 300;
  const ms_per_tile = (60 * 1000) / tpm;
  return Math.max(55, Math.min(260, Math.round(ms_per_tile * 0.75)));
}
// Debug logging helper - re-enabled with balanced output
function debug_log_place(...args: any[]) {
  // eslint-disable-next-line no-console
  console.log("[PlaceModule]", ...args.map((a: any) => typeof a === 'object' ? JSON.stringify(a) : a));
}

// Simple entity tag cache - populated from place data, updated via events
const entityTagCache = new Map<string, TagInstance[]>();
let last_cached_place_id: string | null = null;

/**
 * Populate tag cache from place data
 * Called when place loads or changes
 */
function populateTagCacheFromPlace(place: Place): void {
  // Clear old cache when place changes
  entityTagCache.clear();
  debug_log_place('=== CACHE CLEARED for place:', place.id, '===');

  // Populate cache with NPC tags
  for (const npc of place.contents?.npcs_present || []) {
    if (npc.npc_ref) {
      if (npc.tags && npc.tags.length > 0) {
        entityTagCache.set(npc.npc_ref, npc.tags);
        debug_log_place('Cached NPC tags:', npc.npc_ref, 'tags:', npc.tags.map(t => `${t.name}:${t.mag}`).join(', '));
      } else {
        debug_log_place('Cached NPC (no tags):', npc.npc_ref);
      }
    }
  }

  // Populate cache with actor tags
  for (const actor of place.contents?.actors_present || []) {
    if (actor.actor_ref) {
      if (actor.tags && actor.tags.length > 0) {
        entityTagCache.set(actor.actor_ref, actor.tags);
        debug_log_place('Cached Actor tags:', actor.actor_ref, 'tags:', actor.tags.map(t => `${t.name}:${t.mag}`).join(', '));
      } else {
        debug_log_place('Cached Actor (no tags):', actor.actor_ref);
      }
    }
  }

  debug_log_place('=== CACHE POPULATED:', entityTagCache.size, 'entities with tags ===');
  // Log all cached entities
  for (const [ref, tags] of entityTagCache.entries()) {
    debug_log_place('  Cached:', ref, '->', tags.map(t => `${t.name}:${t.mag}`).join(', '));
  }
}

// NOTE: Tag-driven color is handled by the shader resolver.

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

  // Inspection callback - called when user right-clicks to inspect
  // Right-click cycles: Characters -> Items -> Tile
  // Shift+Right-click forces tile inspection
  on_inspect?: (target: {
    type: "npc" | "actor" | "item" | "tile";
    ref?: string;
    place_id?: string;
    tile_position: TilePosition;
  }) => void;

  // Place transition callback - called when user clicks on a door/connection
  // Returns true if transition was successful, false otherwise
  on_place_transition?: (target_place_id: string, direction: string) => Promise<boolean> | boolean;

  // Styling
  border_rgb?: Rgb;
  bg_rgb?: Rgb;
  npc_rgb?: Rgb;
  actor_rgb?: Rgb;
  wall_rgb?: Rgb;
  grid_rgb?: Rgb;

  // Initial view state
  initial_scale?: number; // tiles per character (1 = 1:1, 2 = 2 tiles per char)

  // Runtime metrics needed for DOM world layer viewport mapping.
  grid_height: number;
  font_family: string;
  base_font_size_px: number;

  // World focus layer (0/1/2) selection.
  get_focus_z?: () => 0 | 1 | 2;
  set_focus_z?: (z: 0 | 1 | 2) => void;

  // World-Z center (absolute elevation) for the 3-layer viewport window.
  // Layers represent [center-1, center, center+1].
  get_world_z_center?: () => number;

  // Mouse parallax normalized (-1..+1), centered on place viewport.
  get_mouse_parallax?: () => { x: number; y: number };

  // Player movement mode (affects speed + movement sound debug broadcast)
  get_move_mode?: () => "WALK" | "SNEAK" | "SPRINT";
  set_move_mode?: (mode: "WALK" | "SNEAK" | "SPRINT") => void;

  // Phase 2: Double-click callbacks for opening containers
  on_double_click_npc?: (npc_ref: string) => void;  // Open NPC character module
  on_double_click_ground?: (tile_x: number, tile_y: number) => void;  // Open scattered container
  on_open_tile_container?: (tile_x: number, tile_y: number) => void;  // Open a tile container (harvestable, planter, etc.)
  get_actor_position?: () => { x: number; y: number } | null;  // For distance checking

  // Ground item UX (tabletop): direct drag only when exactly one item exists on the tile.
  on_drag_start_ground_item?: (tile_x: number, tile_y: number) => void;
  // Hover signal for compatible-slot highlighting (item_id is PlaceItem.item_ref)
  on_hover_ground_item?: (tile_x: number, tile_y: number, item_id: string | null) => void;

  // Optional ground item metadata (instance ids, tags, display_char). If provided, prefer this over place.contents.items_on_ground.
  // When present, ground item rendering and interaction should use this cache as the single source of truth.
  get_ground_item_position_keys?: () => string[];
  get_ground_item_ids_at?: (tile_x: number, tile_y: number) => string[];
  get_ground_item_meta?: (item_instance_id: string) => any | null;

  // Optional open container ids, used to show "open" state on ground container-items.
  get_open_containers?: () => Set<string>;

  // Drag and drop callbacks
  on_drop?: (tile_x: number, tile_y: number) => Promise<boolean>;  // Drop item onto ground tile (adjacent)
  on_throw?: (tile_x: number, tile_y: number) => Promise<boolean>;  // Throw item to distant tile (within range)
  is_dragging?: () => boolean;  // Check if an item is being dragged
  get_drag_source?: () => { item_instance_id: string; source_container_id: string } | null;  // Get drag source info
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
  // Absolute world-z of the focused plane at hover time.
  world_z?: number;
  entity?: PlaceNPC | PlaceActor;
} | null;

// Target tracking for communication - stores entity ref to follow movement
type TargetedEntity = {
  ref: string;  // e.g., "npc.grenda" or "actor.henry_actor"
  type: "npc" | "actor" | "item";
  entity?: PlaceNPC | PlaceActor;
} | null;

// Particle system for path visualization and effects
type Particle = {
  x: number;           // Tile x position
  y: number;           // Tile y position  
  // World Z layer for DOM world rendering (0..2). Defaults to z=1.
  world_z?: 0 | 1 | 2;
  char: string;        // Visual character
  rgb: Rgb;           // Color
  created_at: number;  // Timestamp (Date.now())
  lifespan_ms: number; // How long to live
  weight?: number;     // Optional weight for rendering priority (higher = on top)
  render_index?: number; // Render layer (higher = on top), defaults to 3 for particles
  op?: 'set' | 'tint_fg';
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
  const npc_rgb = config.npc_rgb ?? get_color_by_name("pale_yellow").rgb;
  const actor_rgb = config.actor_rgb ?? get_color_by_name("vivid_green").rgb;
  const grid_rgb = config.grid_rgb ?? get_color_by_name("medium_gray").rgb;

  // View state
  const camera = create_place_camera_controller({ initial_scale: config.initial_scale ?? 1, padding_tiles: PADDING_TILES });
  const view: ViewState = camera.view;

  let hovered: HoveredTile = null;
  let targeted: TargetedEntity = null; // Track selected target for communication (follows entity)
  let last_pointer_x = 0;
  let last_pointer_y = 0;

  // Tile cycling state for multiple entities
  type EntityCycleState = {
    last_update: number;  // timestamp of last cycle
    current_index: number;  // which entity to show
  };
  const tile_cycle_state = new Map<string, EntityCycleState>();  // "x,y" -> state
  const CYCLE_INTERVAL_MS = 500;  // 0.5 seconds

  // Inspection cycling state - tracks right-click inspect cycles per tile
  const inspect_cycle_state = new Map<string, number>();  // "x,y" -> current index

  function get_door_at_tile(place: Place, tile_x: number, tile_y: number): { conn: PlaceConnection; door_x: number; door_y: number } | null {
    // Preferred: explicit door tile metadata.
    try {
      const t: PlaceTile | undefined = (place as any)?.tiles?.cells?.[tile_y]?.[tile_x];
      if (t && t.kind === 'door' && (t as any).door?.target_place_id) {
        const target_place_id = String((t as any).door.target_place_id);
        const conn = place.connections.find(c => c.target_place_id === target_place_id);
        if (conn) return { conn, door_x: tile_x, door_y: tile_y };
      }
    } catch {
      // ignore
    }

    // Fallback: heuristic edge doors.
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

      if (Math.abs(tile_x - door_tile_x) <= 1 && Math.abs(tile_y - door_tile_y) <= 1) {
        return { conn, door_x: door_tile_x, door_y: door_tile_y };
      }
    }
    return null;
  }

  function get_door_from_screen(place: Place, sx: number, sy: number): { conn: PlaceConnection; door_x: number; door_y: number } | null {
    const inner = inner_rect();
    const rel_x = sx - inner.x0;
    const rel_y = sy - inner.y0;
    const tile_x = Math.floor(view.offset_x + rel_x * view.scale);
    const tile_y = Math.floor(view.offset_y + rel_y * view.scale);
    return get_door_at_tile(place, tile_x, tile_y);
  }

  function get_place_tile(place: Place, tile_x: number, tile_y: number): PlaceTile | null {
    try {
      const t: PlaceTile | undefined = (place as any)?.tiles?.cells?.[tile_y]?.[tile_x];
      return t ?? null;
    } catch {
      return null;
    }
  }

  function get_place_tile_z0(place: Place, tile_x: number, tile_y: number): PlaceTile | null {
    try {
      const t: PlaceTile | undefined = (place as any)?.tiles_z0?.cells?.[tile_y]?.[tile_x];
      return t ?? null;
    } catch {
      return null;
    }
  }

  function tile_is_collidable(t: PlaceTile | null): boolean {
    if (!t) return false;
    // Check for OCCUPIES tag (derived at response-time from defs+deltas).
    const tags: any[] = (t as any)?.tags ?? [];
    return Array.isArray(tags) && tags.some(tag => String(tag?.name ?? '').toUpperCase() === 'OCCUPIES');
  }

  function is_edge_kind(t: PlaceTile | null): boolean {
    if (!t) return false;
    // Check for OCCUPIES tag or DOOR tag (visual edge tiles)
    const tags: any[] = (t as any)?.tags ?? [];
    if (!Array.isArray(tags)) return false;
    return tags.some(tag => {
      const n = String(tag?.name ?? '').toUpperCase();
      return n === 'OCCUPIES' || n === 'DOOR';
    });
  }

  const warned_missing_tile_display = new Set<string>();

  /**
   * Get display character and color for a tile.
   * Uses display properties embedded by server, falls back to defaults.
   */
  function get_tile_display(t: PlaceTile, tile_x: number, tile_y: number): { char: string; color: string } {
    // Server embeds display_char and display_color in each tile
    const display_char = (t as any).display_char;
    const display_color = (t as any).display_color;
    
    if (typeof display_char === 'string' && typeof display_color === 'string') {
      return { char: display_char, color: display_color };
    }
    
    // Debug: log missing display properties once per kind (avoid log floods)
    const k = String(t.kind ?? '');
    if (!warned_missing_tile_display.has(k)) {
      warned_missing_tile_display.add(k);
      console.warn(`[TILE_RENDER] Missing display properties for kind='${k}' (example at ${tile_x},${tile_y})`);
    }
    
    // Fallback defaults
    return { char: '?', color: '#888888' };
  }

  /**
   * Check if tile has a specific tag
   */
  function tile_has_tag(t: PlaceTile, tag_name: string): boolean {
    const want = String(tag_name ?? '').toUpperCase();
    const tags = (t as any)?.tags ?? [];
    return Array.isArray(tags) && tags.some((tag: any) => String(tag?.name ?? '').toUpperCase() === want);
  }

  function wall_glyph(place: Place, x: number, y: number): string {
    const up = is_edge_kind(get_place_tile(place, x, y + 1));
    const down = is_edge_kind(get_place_tile(place, x, y - 1));
    const left = is_edge_kind(get_place_tile(place, x - 1, y));
    const right = is_edge_kind(get_place_tile(place, x + 1, y));

    if (up && down && left && right) return '┼';
    if (up && down && left) return '┤';
    if (up && down && right) return '├';
    if (left && right && up) return '┴';
    if (left && right && down) return '┬';
    if (down && right) return '┌';
    if (down && left) return '┐';
    if (up && right) return '└';
    if (up && left) return '┘';
    if (up || down) return '│';
    if (left || right) return '─';
    return '█';
  }

  // Particle system
  let particles: Particle[] = [];
  const PARTICLE_LIFESPAN_MS = 500;  // Particles live for 500ms per plan
  
  // Register particle spawner with vision debugger
  register_particle_spawner((particle) => {
    particles.push(particle as Particle);
  });
  
  // Track current place for unified movement engine
  let current_place_id: string | null = null;
  
  // Track previous entity positions to detect movement and spawn footsteps
  const previous_positions = new Map<string, TilePosition>();
  // Track previous movement state to detect when movement starts
  const previous_moving_state = new Map<string, boolean>();
  // Throttle movement sound/broadcasts per entity
  const movement_sound_step = new Map<string, number>();

  // DOM world layers (z=0/1/2) renderer
  const dom_layers = new PlaceDomLayers({
    font_family: config.font_family,
    base_font_size_px: config.base_font_size_px,
  });
  let dom_pan_px = { x: 0, y: 0, tileW: 0, tileH: 0, scale: 1 };
  let dom_last_place_id: string | null = null;

  // Reuse offscreen canvases to avoid allocating every frame.
  let dom_off_w = 0;
  let dom_off_h = 0;
  let dom_off0: Canvas | null = null;
  let dom_off1: Canvas | null = null;
  let dom_off2: Canvas | null = null;

  // Reuse DOM-export buffers to reduce GC.
  let dom_cells_w = 0;
  let dom_cells_h = 0;
  let dom_cells0: GridCell[][] | null = null;
  let dom_cells1: GridCell[][] | null = null;
  let dom_cells2: GridCell[][] | null = null;
  let dom_cells_ver0 = 1;
  let dom_cells_ver1 = 1;
  let dom_cells_ver2 = 1;

  try {
    window.addEventListener('thaumworld_ui_pan', (ev: any) => {
      dom_pan_px.x = Number(ev?.detail?.pan_x_px) || dom_pan_px.x;
      dom_pan_px.y = Number(ev?.detail?.pan_y_px) || dom_pan_px.y;
      dom_pan_px.tileW = Number(ev?.detail?.tile_w_px) || dom_pan_px.tileW;
      dom_pan_px.tileH = Number(ev?.detail?.tile_h_px) || dom_pan_px.tileH;
      dom_pan_px.scale = Number(ev?.detail?.scale) || dom_pan_px.scale;
    });
  } catch {
    // ignore
  }

  // Renderer-only debug sense broadcast events (origin includes world-z).
  // This decouples broadcast visuals from focus plane; mapping to visible layers happens here.
  try {
    window.addEventListener('thaumworld_ui_sense_broadcast', (ev: any) => {
      const d = ev?.detail;
      if (!d) return;
      const origin = d.origin;
      if (!origin) return;
      const x = Number(origin.x);
      const y = Number(origin.y);
      const z_raw = Number(origin.z);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;

      const place = config.get_place();
      const center_world_z = get_world_z_center_for_place(place);
      const visible_planes_z = get_visible_planes_z(center_world_z);
      const origin_z = Number.isFinite(z_raw) ? Math.floor(z_raw) : center_world_z;

      const sense = d.sense;
      const range = Number(d.range);
      if (typeof sense !== 'string' || !Number.isFinite(range)) return;

      spawn_sense_broadcast_particles({
        origin: { x: Math.floor(x), y: Math.floor(y), z: origin_z },
        sense: sense as any,
        range,
        visible_planes_z,
        source_ref: typeof d.source_ref === 'string' ? d.source_ref : undefined,
      });
    });
  } catch {
    // ignore
  }

  function maybe_mount_dom(place_id: string): void {
    const container = document.getElementById('voxel_layers_container');
    if (!container) return;
    dom_layers.mount(container, place_id);
  }

  function clamp_int(n: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, Math.trunc(n)));
  }

  function compute_mouse_parallax_for_place(opts: {
    inner: Rect;
    anchor_screen_x: number;
    anchor_screen_y: number;
    pointer_x: number;
    pointer_y: number;
  }): { x: number; y: number } {
    const inner = opts.inner;
    const max_dx = (inner.x1 - inner.x0) / 2;
    const max_dy = (inner.y1 - inner.y0) / 2;

    const px = clamp(opts.pointer_x, inner.x0, inner.x1);
    const py = clamp(opts.pointer_y, inner.y0, inner.y1);

    // Neutral point is the anchor (Henry / later: highlighted target).
    // Clamp to -1..+1 so camera tuning stays stable.
    const ox = max_dx > 0 ? (px - opts.anchor_screen_x) / max_dx : 0;
    const oy = max_dy > 0 ? (py - opts.anchor_screen_y) / max_dy : 0;
    return {
      x: Math.max(-1, Math.min(1, ox)),
      y: Math.max(-1, Math.min(1, oy)),
    };
  }

  function export_grid_cells_from_canvas(local: any): GridCell[][] {
    const rows: GridCell[][] = [];
    for (let y = 0; y < local.height; y++) {
      const row: GridCell[] = [];
      for (let x = 0; x < local.width; x++) {
        const c = local.get(x, y);
        // VoxelDOMRenderer skips spaces, so this keeps the DOM layers transparent where needed.
        row.push({
          char: c?.char ?? ' ',
          rgb: c?.rgb ?? { r: 0, g: 0, b: 0 },
          weight_index: (c as any)?.weight_index ?? 3,
          render_index: (c as any)?.render_index,
        });
      }
      rows.push(row);
    }
    return rows;
  }

  function ensure_grid_cell_buffer(w: number, h: number): GridCell[][] {
    const rows: GridCell[][] = [];
    for (let y = 0; y < h; y++) {
      const row: GridCell[] = [];
      for (let x = 0; x < w; x++) {
        row.push({ char: ' ', rgb: { r: 0, g: 0, b: 0 }, weight_index: 3, render_index: undefined });
      }
      rows.push(row);
    }
    return rows;
  }

  function sync_grid_cells_from_canvas(local: any, out: GridCell[][]): boolean {
    const h = local.height;
    const w = local.width;
    let changed = false;
    for (let y = 0; y < h; y++) {
      const row = out[y];
      if (!row) continue;
      for (let x = 0; x < w; x++) {
        const c = local.get(x, y);
        const dst = row[x];
        if (!dst) continue;

        const next_char = c?.char ?? ' ';
        const next_rgb = c?.rgb ?? { r: 0, g: 0, b: 0 };
        const next_weight = (c as any)?.weight_index ?? 3;
        const next_render = (c as any)?.render_index;

        if (
          dst.char !== next_char ||
          dst.weight_index !== next_weight ||
          (dst as any).render_index !== next_render ||
          dst.rgb.r !== next_rgb.r ||
          dst.rgb.g !== next_rgb.g ||
          dst.rgb.b !== next_rgb.b
        ) {
          changed = true;
          dst.char = next_char;
          dst.rgb = next_rgb;
          dst.weight_index = next_weight;
          (dst as any).render_index = next_render;
        }
      }
    }
    return changed;
  }

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

  // Target management for communication system
  function set_target(entity_info: HoveredTile): void {
    const focus_z = config.get_focus_z ? config.get_focus_z() : 1;
    if (entity_info?.entity) {
      // No implicit pick-topmost: entities are only targetable when they are on the focused layer.
      // (get_entity_at already respects focus, but keep this as a defensive fallback.)
      const is_npc = 'npc_ref' in entity_info.entity;
      const ref = is_npc ? (entity_info.entity as PlaceNPC).npc_ref : (entity_info.entity as PlaceActor).actor_ref;
      const type = is_npc ? "npc" : "actor";
      targeted = { ref, type, entity: entity_info.entity };
      console.log(`[PlaceModule] Target SET: ${ref} (${type}) at (${entity_info.x}, ${entity_info.y})`);
      
      // Call the callback to notify app_state
      if (config.on_select_target) {
        config.on_select_target(ref);
      }
    } else if (entity_info) {
      // Tile or item clicked - store position-based target
      targeted = { ref: `tile.${entity_info.x}.${entity_info.y}`, type: "item" };
      console.log(`[PlaceModule] Target set: tile at (${entity_info.x}, ${entity_info.y})`);
    } else {
      targeted = null;
      console.log("[PlaceModule] Target cleared");
    }
  }

  function clear_target(): void {
    targeted = null;
    console.log("[PlaceModule] Target cleared");
  }

  function get_target(): TargetedEntity | null {
    return targeted;
  }

  // Player movement mode (affects speed + movement sound debug broadcast).
  type MoveMode = "WALK" | "SNEAK" | "SPRINT";
  let move_mode_local: MoveMode = "WALK";

  function get_move_mode(): MoveMode {
    return (config.get_move_mode?.() as MoveMode | undefined) ?? move_mode_local;
  }

  function set_move_mode(mode: MoveMode): void {
    move_mode_local = mode;
    config.set_move_mode?.(mode);
    console.log(`[PlaceModule] Move mode: ${mode}`);
  }

  function cycle_move_mode(): void {
    const cur = get_move_mode();
    const next: MoveMode = cur === "WALK" ? "SNEAK" : cur === "SNEAK" ? "SPRINT" : "WALK";
    set_move_mode(next);
  }

  // Get current position of targeted entity (follows movement)
  function get_target_current_position(place: Place): { x: number; y: number } | null {
    if (!targeted) return null;
    
    // Find entity in current place data (using correct property paths)
    if (targeted.type === "npc" && place.contents?.npcs_present) {
      const npc = place.contents.npcs_present.find(n => n.npc_ref === targeted!.ref);
      if (npc) {
        return npc.tile_position;
      }
    } else if (targeted.type === "actor" && place.contents?.actors_present) {
      const actor = place.contents.actors_present.find(a => a.actor_ref === targeted!.ref);
      if (actor) {
        return actor.tile_position;
      }
    }
    
    // Entity not found in current place - target is invalid
    console.log(`[PlaceModule] Target ${targeted.ref} not found in place contents`);
    return null;
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

  function center_on_tile(tile_x: number, tile_y: number, place: Place): void {
    const { width, height } = inner_size();
    camera.center_on_tile(place, width, height, tile_x, tile_y);
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

  function get_all_entities_at_world_z(
    tile_x: number,
    tile_y: number,
    place: Place,
    world_z: number,
  ): (PlaceNPC | PlaceActor)[] {
    const base_z = get_place_base_z(place);
    const wz = Math.floor(Number(world_z));
    if (!Number.isFinite(wz)) return [];

    const entities = get_all_entities_at(tile_x, tile_y, place);
    return entities.filter((e: any) => get_entity_world_z(e, base_z) === wz);
  }

  function get_focus_world_z_for_place(place: Place): number {
    const center_world_z = get_world_z_center_for_place(place);
    const visible_planes_z = get_visible_planes_z(center_world_z);
    const focus_slot = config.get_focus_z ? config.get_focus_z() : 1;
    return Math.floor(Number(visible_planes_z[focus_slot]));
  }

  function get_player_actor_world_pos(place: Place): { x: number; y: number; z: number } | null {
    try {
      const base_z = get_place_base_z(place);
      const a: any = (place.contents?.actors_present ?? [])[0] ?? null;
      const tp = a?.tile_position;
      if (!tp || typeof tp.x !== 'number' || typeof tp.y !== 'number') return null;
      const z = get_entity_world_z(a, base_z);
      return { x: tp.x, y: tp.y, z };
    } catch {
      return null;
    }
  }

  function is_cardinal_adjacent_xy(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
    const dx = Math.abs(Math.floor(a.x) - Math.floor(b.x));
    const dy = Math.abs(Math.floor(a.y) - Math.floor(b.y));
    return dx + dy === 1;
  }

  function is_axial_touch_3d(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): boolean {
    const dx = Math.abs(Math.floor(a.x) - Math.floor(b.x));
    const dy = Math.abs(Math.floor(a.y) - Math.floor(b.y));
    const dz = Math.abs(Math.floor(a.z) - Math.floor(b.z));
    // Allow same voxel (0) or a single axial step (1). No diagonals.
    return dx + dy + dz <= 1;
  }

  function is_within_range_xy_z(
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number },
    max_range_xy: number,
    max_range_z: number,
  ): boolean {
    const dx = Math.floor(b.x) - Math.floor(a.x);
    const dy = Math.floor(b.y) - Math.floor(a.y);
    const dist_xy = Math.sqrt(dx * dx + dy * dy);
    const dz = Math.abs(Math.floor(b.z) - Math.floor(a.z));
    return dist_xy <= max_range_xy && dz <= max_range_z;
  }

  function get_items_on_ground_at_world_z(place: Place, tile_x: number, tile_y: number, world_z: number): string[] {
    const wz = Math.floor(Number(world_z));
    if (!Number.isFinite(wz)) return [];
    const base_z = get_place_base_z(place);

    // Preferred: use the ground item cache (ids + meta) when available so render/interaction stay consistent.
    if (config.get_ground_item_ids_at && config.get_ground_item_meta) {
      const ids = config.get_ground_item_ids_at(tile_x, tile_y) ?? [];
      const out: string[] = [];
      for (const id of ids) {
        const meta: any = config.get_ground_item_meta(id);
        const iz = (typeof meta?.elevation === 'number' && Number.isFinite(meta.elevation))
          ? Math.floor(meta.elevation)
          : base_z;
        if (iz === wz) out.push(id);
      }
      return out;
    }

    // Fallback: place snapshot contents.
    const items = place.contents.items_on_ground ?? [];
    const out: string[] = [];
    for (const it of items as any[]) {
      const pos = (it as any)?.tile_position;
      if (!pos) continue;
      if (pos.x !== tile_x || pos.y !== tile_y) continue;
      const iz = (typeof (it as any)?.elevation === 'number' && Number.isFinite((it as any).elevation))
        ? Math.floor((it as any).elevation)
        : base_z;
      if (iz !== wz) continue;
      const id = String((it as any).item_ref ?? '');
      if (id) out.push(id);
    }
    return out;
  }

  // Get entity at tile position with cycling
  function get_entity_at_world_z(
    tile_x: number,
    tile_y: number,
    place: Place,
    world_z: number,
  ): PlaceNPC | PlaceActor | null {
    const wz = Math.floor(Number(world_z));
    if (!Number.isFinite(wz)) return null;
    const entities = get_all_entities_at_world_z(tile_x, tile_y, place, wz);
    
    if (entities.length === 0) {
      return null;
    }
    
    if (entities.length === 1) {
      return entities[0] ?? null;
    }
    
    // Multiple entities - use cycling
    const key = `${tile_x},${tile_y},wz:${wz}`;
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

  // Check if a tile is walkable (not occupied, in bounds)
  function is_tile_walkable(tile_x: number, tile_y: number, place: Place): boolean {
    // Check bounds
    if (tile_x < 0 || tile_x >= place.tile_grid.width ||
        tile_y < 0 || tile_y >= place.tile_grid.height) {
      return false;
    }

    // Check for collidable tiles (walls)
    if (tile_is_collidable(get_place_tile(place, tile_x, tile_y))) {
      return false;
    }
    
    // Check for entities
    const entities = get_all_entities_at(tile_x, tile_y, place);
    if (entities.length > 0) {
      return false;
    }
    
    // Phase 2 (partial): walking semantics match server movement rules:
    // - z=1 blocks movement when OCCUPIES.
    // - z=0 must provide support (OCCUPIES) when tiles_z0 exists.
    if (tile_is_collidable(get_place_tile(place, tile_x, tile_y))) {
      return false;
    }

    const t0 = get_place_tile_z0(place, tile_x, tile_y);
    if ((place as any)?.tiles_z0) {
      const supports = tile_is_collidable(t0);
      if (!supports) return false;
    }

    // Phase 2 (partial): entity occupancy on z=1 blocks movement.
    // (Items do not block movement by default.)
    const has_actor = place.contents.actors_present?.some(a => a.tile_position.x === tile_x && a.tile_position.y === tile_y) ?? false;
    if (has_actor) return false;
    const has_npc = place.contents.npcs_present?.some(n => n.tile_position.x === tile_x && n.tile_position.y === tile_y) ?? false;
    if (has_npc) return false;

    return true;
  }

  // Get actor walk speed from their data
  // Uses the unified movement engine's default if actor data unavailable
  function get_actor_walk_speed(actor_ref: string): number {
    // NOTE: Actor movement speed is not available in renderer context
    // This would need to be included in place data from API
    // For now, return default speed
    
    // Default: 300 tiles per minute (5 tiles per second)
    return 300;
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

  // Spawn particles along a path (pale yellow)
  function spawn_path_particles(path: TilePosition[]) {
    const now = Date.now();
    const path_rgb = get_color_by_name("pale_yellow").rgb;
    
    for (const pos of path) {
      particles.push({
        x: pos.x,
        y: pos.y,
        world_z: 0,
        char: "·",
        rgb: path_rgb,
        created_at: now,
        lifespan_ms: PARTICLE_LIFESPAN_MS
      });
    }
  }
  
  // Spawn movement particle at position (vivid cyan)
  function spawn_movement_particle(pos: TilePosition) {
    const now = Date.now();
    const move_rgb = get_color_by_name("vivid_cyan").rgb;
    
    // Movement particles at layer 3 (below entities at layer 4)
    particles.push({
      x: pos.x,
      y: pos.y,
      world_z: 0,
      char: "·",
      rgb: move_rgb,
      created_at: now,
      lifespan_ms: PARTICLE_LIFESPAN_MS,
      weight: 4,  // Medium weight
      render_index: 3,  // Below entities (layer 4)
    });
  }

  function get_world_z_center_for_place(place: Place | null): number {
    const z0 = config.get_world_z_center ? Number(config.get_world_z_center()) : NaN;
    if (Number.isFinite(z0)) return Math.floor(z0);
    // Fallback: derive from the first actor in the place snapshot.
    try {
      const a0: any = place?.contents?.actors_present?.[0];
      const z1 = Number(a0?.elevation);
      if (Number.isFinite(z1)) return Math.floor(z1);
    } catch {
      // ignore
    }
    return 0;
  }

  function get_place_base_z(place: Place | null): number {
    try {
      const z = Number((place as any)?.coordinates?.elevation);
      return Number.isFinite(z) ? Math.floor(z) : 0;
    } catch {
      return 0;
    }
  }

  function get_visible_planes_z(center_world_z: number): readonly [number, number, number] {
    const c = Number.isFinite(center_world_z) ? Math.floor(center_world_z) : 0;
    return [c - 1, c, c + 1] as const;
  }

  function slot_for_world_z(world_z: number, visible_planes_z: readonly [number, number, number]): 0 | 1 | 2 | null {
    const wz = Math.floor(Number(world_z));
    if (!Number.isFinite(wz)) return null;
    if (wz === Math.floor(visible_planes_z[0])) return 0;
    if (wz === Math.floor(visible_planes_z[1])) return 1;
    if (wz === Math.floor(visible_planes_z[2])) return 2;
    return null;
  }

  function get_entity_world_z(entity: any, fallback_world_z: number): number {
    const z = Number(entity?.elevation);
    if (Number.isFinite(z)) return Math.floor(z);
    return fallback_world_z;
  }
  
  // Check for entity movement and spawn footsteps
  function check_entity_movement(place: Place) {
    const center_world_z = get_world_z_center_for_place(place);
    const visible_planes_z = get_visible_planes_z(center_world_z);

    // Check actors
    for (const actor of place.contents.actors_present) {
      const prev = previous_positions.get(actor.actor_ref);
      const was_moving = previous_moving_state.get(actor.actor_ref) || false;
      const path_info = get_entity_path(actor.actor_ref);
      const is_moving = !!path_info;
      
      // Check if just started moving (transition from not moving to moving)
      if (!was_moving && is_moving && path_info) {
        // Started moving, spawn path particles
        spawn_path_particles(path_info.path);
      }
      
      // Check if moved to new tile
      if (prev && (prev.x !== actor.tile_position.x || prev.y !== actor.tile_position.y)) {
        // Actor moved, spawn movement particle
        spawn_movement_particle(actor.tile_position);

        // Movement should create pressure broadcasts (footsteps)
        const n = (movement_sound_step.get(actor.actor_ref) ?? 0) + 1;
        movement_sound_step.set(actor.actor_ref, n);
        if (n % 3 === 1) {
          const profile = get_sense_profile("MOVE", get_move_mode());
          const pressure = profile?.broadcasts.find(b => b.sense === "pressure");
          const range = pressure?.range_tiles ?? 5;
          spawn_sense_broadcast_particles({
            origin: {
              x: actor.tile_position.x,
              y: actor.tile_position.y,
              z: get_entity_world_z(actor as any, center_world_z),
            },
            sense: "pressure",
            range,
            visible_planes_z,
            source_ref: actor.actor_ref,
          });
        }
      }
      
      // Update stored state
      previous_positions.set(actor.actor_ref, { ...actor.tile_position });
      previous_moving_state.set(actor.actor_ref, is_moving);

      if (!is_moving) {
        movement_sound_step.delete(actor.actor_ref);
      }
    }
    
    // Check NPCs
    for (const npc of place.contents.npcs_present) {
      const prev = previous_positions.get(npc.npc_ref);
      const was_moving = previous_moving_state.get(npc.npc_ref) || false;
      const path_info = get_entity_path(npc.npc_ref);
      const is_moving = !!path_info;
      
      // Check if just started moving (transition from not moving to moving)
      if (!was_moving && is_moving && path_info) {
        // Started moving, spawn path particles
        spawn_path_particles(path_info.path);
      }
      
      // Check if moved to new tile
      if (prev && (prev.x !== npc.tile_position.x || prev.y !== npc.tile_position.y)) {
        // NPC moved, spawn movement particle
        spawn_movement_particle(npc.tile_position);

        // Movement sound for NPCs (assume WALK for now)
        const n = (movement_sound_step.get(npc.npc_ref) ?? 0) + 1;
        movement_sound_step.set(npc.npc_ref, n);
        if (n % 3 === 1) {
          const profile = get_sense_profile("MOVE", "WALK");
          const pressure = profile?.broadcasts.find(b => b.sense === "pressure");
          const range = pressure?.range_tiles ?? 5;
          spawn_sense_broadcast_particles({
            origin: {
              x: npc.tile_position.x,
              y: npc.tile_position.y,
              z: get_entity_world_z(npc as any, center_world_z),
            },
            sense: "pressure",
            range,
            visible_planes_z,
            source_ref: npc.npc_ref,
          });
        }
      }
      
      // Update stored state
      previous_positions.set(npc.npc_ref, { ...npc.tile_position });
      previous_moving_state.set(npc.npc_ref, is_moving);

      if (!is_moving) {
        movement_sound_step.delete(npc.npc_ref);
      }
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

       // 3-layer window of absolute world-z values.
       const center_world_z = get_world_z_center_for_place(place);
       const visible_planes_z = get_visible_planes_z(center_world_z);
       const base_z = get_place_base_z(place);

      const open_containers = config.get_open_containers ? config.get_open_containers() : null;
      const is_tile_container_open = (tile_x: number, tile_y: number): boolean => {
        const id = `place.tile.${place.id}.${tile_x}_${tile_y}`;
        return Boolean(open_containers && open_containers.has(id));
      };

      // Render requests split by world-z target.
      const rq_ui: RenderRequest[] = [];
      const rq_z0: RenderRequest[] = [];
      const rq_z1: RenderRequest[] = [];
      const rq_z2: RenderRequest[] = [];

       const q_for_slot = (slot: 0 | 1 | 2): RenderRequest[] => (slot === 0 ? rq_z0 : (slot === 2 ? rq_z2 : rq_z1));

      // Calculate visible tile range
      const visible_tile_start_x = view.offset_x;
      const visible_tile_start_y = view.offset_y;
      const visible_tile_end_x = view.offset_x + width * view.scale;
      const visible_tile_end_y = view.offset_y + height * view.scale;

      // Clear background
      canvas.fill_rect(inner, { char: " ", rgb: bg_rgb });

      // Spawn/update particles based on movement (used by later particle render pass).
      check_entity_movement(place);

      // Render z=0 support blocks.
      {
        const slot_support = slot_for_world_z(base_z - 1, visible_planes_z);
        if (slot_support !== null) {
          const rq = q_for_slot(slot_support);
        for (let sy = inner.y0; sy <= inner.y1; sy++) {
          for (let sx = inner.x0; sx <= inner.x1; sx++) {
            const tile_x = Math.floor(view.offset_x + (sx - inner.x0) * view.scale);
            const tile_y = Math.floor(view.offset_y + (sy - inner.y0) * view.scale);
            if (tile_x < 0 || tile_x >= place.tile_grid.width || tile_y < 0 || tile_y >= place.tile_grid.height) continue;
            const t0 = get_place_tile_z0(place, tile_x, tile_y);
            if (!t0) continue;
            const display0 = get_tile_display(t0, tile_x, tile_y);
            rq.push({
              pass: 'tile',
              x: sx,
              y: sy,
              order: 0,
              key: `tile_z0:${tile_x},${tile_y}`,
              payload: make_simple_tile_payload({
                id: `tile_z0:${place.id}:${tile_x},${tile_y}`,
                char: display0.char,
                tags: (t0 as any).tags ?? [],
                base_fg: hex_to_rgb(display0.color),
                weight_index: 1,
              }) as any,
              ctx: ctx_place_tile(),
            });
          }
        }
        }
      }

      // Render z=1 tiles (walls/doors/features).
      {
        const slot_struct = slot_for_world_z(base_z, visible_planes_z);
        if (slot_struct !== null) {
          const rq = q_for_slot(slot_struct);
        for (let sy = inner.y0; sy <= inner.y1; sy++) {
          for (let sx = inner.x0; sx <= inner.x1; sx++) {
            const tile_x = Math.floor(view.offset_x + (sx - inner.x0) * view.scale);
            const tile_y = Math.floor(view.offset_y + (sy - inner.y0) * view.scale);
            if (tile_x < 0 || tile_x >= place.tile_grid.width || tile_y < 0 || tile_y >= place.tile_grid.height) continue;
            const t1 = get_place_tile(place, tile_x, tile_y);
            if (!t1) continue;

            const open = is_tile_container_open(tile_x, tile_y);
            const display1 = get_tile_display(t1, tile_x, tile_y);
            const has_door_tag = tile_has_tag(t1, 'DOOR');
            const has_container_tag = tile_has_tag(t1, 'CONTAINER');

            if (has_door_tag) {
              rq.push({
                pass: 'tile',
                x: sx,
                y: sy,
                order: 10,
                key: `door:${(t1 as any).door?.target_place_id ?? 'unknown'}:${(t1 as any).door?.direction ?? ''}:${tile_x},${tile_y}`,
                payload: make_simple_tile_payload({
                  id: `door:${place.id}:${tile_x},${tile_y}`,
                  char: display1.char,
                  tags: (t1 as any).tags ?? [],
                  base_fg: hex_to_rgb(display1.color),
                  weight_index: 5,
                }) as any,
                ctx: ctx_place_tile({ selected: open }),
              });
              continue;
            }

            rq.push({
              pass: 'tile',
              x: sx,
              y: sy,
              order: 0,
              key: `tile:${tile_x},${tile_y}`,
              payload: make_simple_tile_payload({
                id: `tile:${place.id}:${tile_x},${tile_y}`,
                char: display1.char,
                tags: (t1 as any).tags ?? [],
                base_fg: hex_to_rgb(display1.color),
                weight_index: 2,
              }) as any,
              ctx: ctx_place_tile({ selected: open }),
            });

            if (has_container_tag) {
              const container_glyphs = (t1 as any).container_glyphs;
              let container_char = display1.char;
              if (container_glyphs && typeof container_glyphs === 'object') {
                container_char = open ? container_glyphs.open : container_glyphs.closed;
              }
              rq.push({
                pass: 'tile',
                x: sx,
                y: sy,
                order: 5,
                key: `tile_container:${tile_x},${tile_y}`,
                payload: make_simple_tile_payload({
                  id: `tile_container:${place.id}:${tile_x},${tile_y}`,
                  char: container_char,
                  tags: (t1 as any).tags ?? [],
                  base_fg: hex_to_rgb(display1.color),
                  weight_index: 4,
                }) as any,
                ctx: ctx_place_tile({ selected: open }),
              });
            }
          }
        }
        }
      }

    // Track occupied voxels by world layer slot (for correct item/entity overlap behavior).
    const entity_occupied = new Set<string>(); // `${slot}:${tile_x}_${tile_y}`

    // Walls/doors come from place.tiles; no extra border drawing here.

    // (Movement already checked above; avoid double-spawning.)
    
    // Update debug visuals for all NPCs (vision cones, facing, etc.)
    // Phase 5: LOS raycast queries tile COVER at point-samples (no precomputed blocker set).
    const blocks_los_at = (x: number, y: number, world_z: number): boolean => {
      const w = Math.max(0, Math.floor(place.tile_grid.width));
      const h = Math.max(0, Math.floor(place.tile_grid.height));
      if (x < 0 || y < 0 || x >= w || y >= h) return true;
      const base_z = Math.floor(Number((place as any)?.coordinates?.elevation ?? 0)) || 0;
      const wz = Math.floor(Number(world_z));
      try {
        // Map absolute world-z to the authored tile layers.
        // - tiles (structures / walking plane) lives at base_z
        // - tiles_z0 (support) lives at base_z - 1
        // Everything else is air.
        if (wz === base_z - 1) {
          const t0: any = (place as any)?.tiles_z0?.cells?.[y]?.[x] ?? null;
          return !!(t0 && tile_has_tag(t0 as any, 'COVER'));
        }
        if (wz === base_z) {
          const t1: any = (place as any)?.tiles?.cells?.[y]?.[x] ?? null;
          return !!(t1 && tile_has_tag(t1 as any, 'COVER'));
        }
        return false;
      } catch {
        return false;
      }
    };
    for (const npc of place.contents.npcs_present) {
      const npc_position = { x: npc.tile_position.x, y: npc.tile_position.y, z: get_entity_world_z(npc as any, base_z) };
      const npc_facing = get_facing(npc.npc_ref);
      // Conversation visual state is synced to renderer via NPC_STATUS commands.
      // We intentionally do NOT read backend in-memory conversation_state here.
      const npc_visual_status = get_npc_visual_status(npc.npc_ref) ?? npc.status;
      const npc_conversation_visual = npc_visual_status === "busy";
      
      update_npc_debug_visuals(npc.npc_ref, npc_position, npc_facing, npc_conversation_visual, visible_planes_z, blocks_los_at, (npc as any).tags);
      
    }

    // Also render debug visuals for player actors (LOS testing often happens solo).
    for (const actor of place.contents.actors_present) {
      const actor_position = { x: actor.tile_position.x, y: actor.tile_position.y, z: get_entity_world_z(actor as any, base_z) };
      const actor_facing = get_facing(actor.actor_ref);
      update_npc_debug_visuals(actor.actor_ref, actor_position, actor_facing, false, visible_planes_z, blocks_los_at, (actor as any).tags);
    }
    
    // Update particles (path visualization and effects), but enqueue them to draw later.
    update_particles();
    for (const p of particles) {
      const screen_x = inner.x0 + Math.floor((p.x - view.offset_x) / view.scale);
      const screen_y = inner.y0 + Math.floor((p.y - view.offset_y) / view.scale);

      if (screen_x >= inner.x0 && screen_x <= inner.x1 &&
          screen_y >= inner.y0 && screen_y <= inner.y1) {
        const weight = p.weight ?? 4;
        const render_index = p.render_index ?? 3;
        const wz = (p.world_z ?? 1) as 0 | 1 | 2;
        const target_q = wz === 0 ? rq_z0 : (wz === 2 ? rq_z2 : rq_z1);
        target_q.push({
          pass: 'particle',
          x: screen_x,
          y: screen_y,
          order: 0,
          key: `particle:${p.char}:${p.x},${p.y}`,
          op: (p as any).op ?? 'set',
          cell: {
            char: p.char,
            rgb: p.rgb,
            weight_index: weight,
            style: 'regular',
            render_index,
          },
        });
      }
    }

    // Enqueue characters into the correct visible world layer.
    {
      const enqueue_entity = (entity: any, is_npc: boolean) => {
        const entityRef = is_npc ? String(entity.npc_ref ?? '') : String(entity.actor_ref ?? '');
        if (!entityRef) return;

        const wz = get_entity_world_z(entity, base_z);
        const slot = slot_for_world_z(wz, visible_planes_z);
        if (slot === null) return;

        const tile_x = entity.tile_position?.x;
        const tile_y = entity.tile_position?.y;
        if (typeof tile_x !== 'number' || typeof tile_y !== 'number') return;

        const screen_x = inner.x0 + Math.floor((tile_x - view.offset_x) / view.scale);
        const screen_y = inner.y0 + Math.floor((tile_y - view.offset_y) / view.scale);
        if (!(screen_x >= inner.x0 && screen_x <= inner.x1 && screen_y >= inner.y0 && screen_y <= inner.y1)) return;

        entity_occupied.add(`${slot}:${tile_x}_${tile_y}`);

        const name = entityRef.split(".").pop() ?? (is_npc ? "N" : "A");
        const defaultRgb = is_npc ? npc_rgb : actor_rgb;
        const cachedTags = entityTagCache.get(entityRef) ?? [];

        q_for_slot(slot).push({
          pass: 'character',
          x: screen_x,
          y: screen_y,
          order: is_npc ? 1 : 0,
          key: entityRef,
          payload: make_entity_payload(is_npc ? 'npc' : 'actor', entityRef, name, cachedTags, { base_fg: defaultRgb }) as any,
          ctx: ctx_place_tile(),
        });
      };

      for (const npc of place.contents.npcs_present) enqueue_entity(npc as any, true);
      for (const actor of place.contents.actors_present) enqueue_entity(actor as any, false);
    }

      // Draw items on ground (tabletop UX)
      // - Exactly 1 item on a tile: draw the item (qty-based glyph)
      // - 2+ items on a tile: draw a pile glyph (single interaction target)
      let keys: string[] = [];
      let fallback_qty_by_key: Map<string, number> | null = null;

      // Preferred: render from the ground item cache (same source used for interactions).
      // Important: do NOT fall back to place.contents.items_on_ground when cache providers exist,
      // otherwise stale place snapshots can render "ghost" items that cannot be interacted with.
      if (config.get_ground_item_position_keys && config.get_ground_item_ids_at) {
        try {
          keys = config.get_ground_item_position_keys() ?? [];
        } catch {
          keys = [];
        }
      } else {
        // Legacy fallback: derive keys from place.contents.items_on_ground.
        const ground_by_tile = new Map<string, typeof place.contents.items_on_ground>();
        fallback_qty_by_key = new Map();
        for (const it of place.contents.items_on_ground) {
          const iz = (typeof (it as any)?.elevation === 'number' && Number.isFinite((it as any).elevation))
            ? Math.floor((it as any).elevation)
            : base_z;
          const key = `${it.tile_position.x}_${it.tile_position.y}_${iz}`;
          const arr = ground_by_tile.get(key);
          if (arr) arr.push(it);
          else ground_by_tile.set(key, [it]);
        }
        keys = Array.from(ground_by_tile.keys());
        for (const [key, items] of ground_by_tile.entries()) {
          if (items.length === 1) fallback_qty_by_key.set(key, items[0]?.quantity ?? 1);
        }
      }

      debug_log_place(`[GroundItems] Rendering ${keys.length} ground tile(s)`);
      for (const key of keys) {
        const [txs, tys, tzs] = key.split('_');
        const tile_x = parseInt(txs || '0', 10);
        const tile_y = parseInt(tys || '0', 10);
        const tile_z = parseInt(tzs || '', 10);
        const voxel_z = Number.isFinite(tile_z) ? Math.floor(tile_z) : base_z;

      const screen_x = inner.x0 + Math.floor((tile_x - view.offset_x) / view.scale);
      const screen_y = inner.y0 + Math.floor((tile_y - view.offset_y) / view.scale);

      if (!(screen_x >= inner.x0 && screen_x <= inner.x1 && screen_y >= inner.y0 && screen_y <= inner.y1)) {
        continue;
      }

      const item_slot = slot_for_world_z(voxel_z, visible_planes_z);
      if (item_slot === null) continue;

      const ids_raw = config.get_ground_item_ids_at?.(tile_x, tile_y) ?? [];
      if (ids_raw.length < 1) continue;

      // Voxel-keyed render: only render ids whose meta elevation matches this key.
      const item_ids: string[] = [];
      for (const id of ids_raw) {
        const meta: any = config.get_ground_item_meta?.(id) ?? null;
        const iz = (typeof meta?.elevation === 'number' && Number.isFinite(meta.elevation))
          ? Math.floor(meta.elevation)
          : base_z;
        if (iz === voxel_z) item_ids.push(id);
      }
      if (item_ids.length < 1) continue;

      if (entity_occupied.has(`${item_slot}:${tile_x}_${tile_y}`)) continue;

      const open_containers = config.get_open_containers?.();
      const tile_hovered = Boolean(hovered && hovered.x === tile_x && hovered.y === tile_y && Math.floor(Number(hovered.world_z ?? NaN)) === voxel_z);

      const pile_container_id = `place.pile.${place.id}.${key}`;
      const pile_open = Boolean(open_containers && open_containers.has(pile_container_id));

        // Prefer rich metadata path when available and exactly one item exists.
        if (item_ids.length === 1) {
          const meta: any = config.get_ground_item_meta?.(item_ids[0]!) ?? null;
          if (meta) {
            const item_container_id = `place.item.${place.id}.${String(meta.id ?? item_ids[0])}`;
            const item_open = Boolean(open_containers && open_containers.has(item_container_id));
            q_for_slot(item_slot).push({
              pass: 'item',
              x: screen_x,
              y: screen_y,
              order: 0,
              key: item_container_id,
              payload: make_item_like_payload({
                id: String(meta.id ?? item_ids[0]),
                def_id: meta.def_id ? String(meta.def_id) : undefined,
                name: meta.name ? String(meta.name) : undefined,
                qty: typeof meta.qty === 'number' ? meta.qty : undefined,
                display_char: typeof meta.display_char === 'string' ? meta.display_char : undefined,
                tags: Array.isArray(meta.tags) ? meta.tags : [],
                base_fg: typeof meta.display_color === 'string' ? hex_to_rgb(meta.display_color) : undefined,
              }) as any,
              ctx: ctx_place_tile({ hovered: tile_hovered, selected: item_open }),
            });
            continue;
          }
        }

        // Prefer rich metadata path for piles too (styling via representative item).
        if (item_ids.length >= 2) {
          const meta0: any = config.get_ground_item_meta?.(item_ids[0]!) ?? null;
          if (meta0) {
            q_for_slot(item_slot).push({
              pass: 'item',
              x: screen_x,
              y: screen_y,
              order: 0,
              key: pile_container_id,
              payload: make_pile_payload({
                id: `pile:${place.id}:${key}`,
                pile_count: item_ids.length,
                rep: {
                  def_id: meta0.def_id ? String(meta0.def_id) : undefined,
                  name: meta0.name ? String(meta0.name) : undefined,
                  qty: typeof meta0.qty === 'number' ? meta0.qty : undefined,
                  display_char: typeof meta0.display_char === 'string' ? meta0.display_char : undefined,
                  tags: Array.isArray(meta0.tags) ? meta0.tags : [],
                },
                base_fg: typeof meta0.display_color === 'string' ? hex_to_rgb(meta0.display_color) : undefined,
              }) as any,
              ctx: ctx_place_tile({ hovered: tile_hovered, selected: pile_open }),
            });
            continue;
          }
        }

        const single_qty = item_ids.length === 1
          ? (typeof (config.get_ground_item_meta?.(item_ids[0]!) as any)?.qty === 'number'
            ? Number((config.get_ground_item_meta?.(item_ids[0]!) as any).qty)
            : (fallback_qty_by_key?.get(key) ?? undefined))
          : undefined;
        q_for_slot(item_slot).push({
          pass: 'item',
          x: screen_x,
          y: screen_y,
          order: 0,
          key: pile_container_id,
          payload: make_ground_items_tile_payload(
            `ground:${place.id}:${key}`,
            item_ids.length,
            single_qty,
            undefined,
          ) as any,
          ctx: ctx_place_tile({ hovered: tile_hovered, selected: pile_open }),
        });
      }

    // System/UI overlays are queued as the final pass.

    // Target highlight (follows entity movement).
    const target_pos = get_target_current_position(place);
    if (target_pos && targeted) {
      const screen_x = inner.x0 + Math.floor((target_pos.x - view.offset_x) / view.scale);
      const screen_y = inner.y0 + Math.floor((target_pos.y - view.offset_y) / view.scale);
      if (screen_x >= inner.x0 && screen_x <= inner.x1 && screen_y >= inner.y0 && screen_y <= inner.y1) {
        rq_ui.push({
          pass: 'ui',
          x: screen_x,
          y: screen_y,
          order: 0,
          key: `ui:target:${targeted.ref}`,
          op: 'tint_fg',
          cell: { char: ' ', rgb: get_color_by_name('vivid_cyan').rgb, style: 'bold', weight_index: 7, render_index: 5 },
        });
      }
    } else if (targeted) {
      // Target no longer valid (entity left place or doesn't exist)
      clear_target();
    }

    // Hover highlight (on top of target if different).
    const target_current_pos = get_target_current_position(place);
    if (hovered && (!target_current_pos || hovered.x !== target_current_pos.x || hovered.y !== target_current_pos.y)) {
      const screen_x = inner.x0 + Math.floor((hovered.x - view.offset_x) / view.scale);
      const screen_y = inner.y0 + Math.floor((hovered.y - view.offset_y) / view.scale);
      if (screen_x >= inner.x0 && screen_x <= inner.x1 && screen_y >= inner.y0 && screen_y <= inner.y1) {
        rq_ui.push({
          pass: 'ui',
          x: screen_x,
          y: screen_y,
          order: 1,
          key: `ui:hover:${hovered.x},${hovered.y}`,
          op: 'tint_fg',
          cell: { char: ' ', rgb: get_color_by_name('pale_orange').rgb, style: 'regular', weight_index: 6, render_index: 5 },
        });
      }
    }

    // Info overlay at top.
    {
      const fz = config.get_focus_z ? config.get_focus_z() : 1;
      const info_text = `[${place.name}] ${place.tile_grid.width}x${place.tile_grid.height} | z:${fz} | View: ${Math.floor(view.offset_x)},${Math.floor(view.offset_y)} | Scale: 1:${view.scale}`;
      const info_y = inner.y1;
      let info_x = inner.x0;
      for (const ch of info_text) {
        if (info_x > inner.x1) break;
        rq_ui.push({
          pass: 'ui',
          x: info_x,
          y: info_y,
          order: 2,
          key: `ui:info:${info_x}`,
          cell: { char: ch, rgb: get_color_by_name('off_white').rgb, style: 'regular', weight_index: 3, render_index: 6 },
        });
        info_x++;
      }
    }

    // Target/hover info at bottom.
    if (targeted) {
      const display_name = targeted.ref.split('.').pop() || targeted.ref;
      const target_text = `Talking to: ${display_name}`;
      const y = inner.y0;
      let x = inner.x0;
      for (const ch of target_text) {
        if (x > inner.x1) break;
        rq_ui.push({
          pass: 'ui',
          x,
          y,
          order: 2,
          key: `ui:talk:${x}`,
          cell: { char: ch, rgb: get_color_by_name('pale_yellow').rgb, style: 'bold', weight_index: 4, render_index: 6 },
        });
        x++;
      }
    } else if (hovered && hovered.entity) {
      const is_npc = 'npc_ref' in hovered.entity;
      const ref = is_npc ? (hovered.entity as PlaceNPC).npc_ref : (hovered.entity as PlaceActor).actor_ref;
      const status = is_npc ? (hovered.entity as PlaceNPC).status : (hovered.entity as PlaceActor).status;
      const hover_text = `[${ref}] ${status}`;
      const y = inner.y0;
      let x = inner.x0;
      for (const ch of hover_text) {
        if (x > inner.x1) break;
        rq_ui.push({
          pass: 'ui',
          x,
          y,
          order: 2,
          key: `ui:hoverinfo:${x}`,
          cell: { char: ch, rgb: get_color_by_name('pale_yellow').rgb, style: 'regular', weight_index: 3, render_index: 6 },
        });
        x++;
      }
    }


    // UI overlays remain in mono-canvas.
    draw_render_queue(canvas, rq_ui, { now_ms: Date.now(), pass_order: ['ui'], character_flash_period_ms: 240 });

    // World layers render into DOM canvases (z=0/1/2) clipped to the place inner rect.
    const focus_z = config.get_focus_z ? config.get_focus_z() : 1;

     // Phase 0.5: explicit ownership heartbeat (prevents stale layers when place isn't drawn).
     touch_world_layers_owner('place');

    maybe_mount_dom(place.id);
    dom_layers.ensure_space(width, height);

    // Apply shared camera tuning from painter, but keep focus/pan per Place.
    dom_layers.apply_shared_camera_tuning(camera.get_shared_dom_tuning());
    dom_layers.set_focus_z(focus_z);

    // Parallax neutral point is Henry (or later: highlighted target).
    // This makes the perspective effect much easier to read around the player.
    {
      const inner = inner_rect();

      // Anchor: targeted entity (if it's on-screen), else Henry, else fallback to viewport center.
      let anchor_tile = get_target_current_position(place);
      if (!anchor_tile) anchor_tile = config.get_actor_position?.() ?? null;
      if (!anchor_tile) {
        const a0 = place.contents.actors_present?.[0];
        anchor_tile = a0?.tile_position ?? null;
      }

      const cx = (inner.x0 + inner.x1) / 2;
      const cy = (inner.y0 + inner.y1) / 2;

      let anchor_screen_x = cx;
      let anchor_screen_y = cy;

      if (anchor_tile) {
        const sx = inner.x0 + Math.floor((anchor_tile.x - view.offset_x) / view.scale);
        const sy = inner.y0 + Math.floor((anchor_tile.y - view.offset_y) / view.scale);
        if (sx >= inner.x0 && sx <= inner.x1 && sy >= inner.y0 && sy <= inner.y1) {
          anchor_screen_x = sx;
          anchor_screen_y = sy;
        }
      }

      // Use last pointer position captured by OnPointerMove.
      // If pointer hasn't moved yet (or is outside Place), default to neutral at the anchor.
      const pointer_in_inner =
        last_pointer_x >= inner.x0 && last_pointer_x <= inner.x1 &&
        last_pointer_y >= inner.y0 && last_pointer_y <= inner.y1;
      const px = pointer_in_inner ? last_pointer_x : anchor_screen_x;
      const py = pointer_in_inner ? last_pointer_y : anchor_screen_y;
      const mp = compute_mouse_parallax_for_place({
        inner,
        anchor_screen_x,
        anchor_screen_y,
        pointer_x: px,
        pointer_y: py,
      });
      dom_layers.set_mouse_parallax(mp.x, mp.y);
    }

    if (dom_pan_px.tileW > 0 && dom_pan_px.tileH > 0) {
      const vp = compute_dom_viewport_for_rect({
        pan_x_px: dom_pan_px.x,
        pan_y_px: dom_pan_px.y,
        tile_w_px: dom_pan_px.tileW,
        tile_h_px: dom_pan_px.tileH,
        grid_height: config.grid_height,
        rect: inner,
        base_font_size_px: config.base_font_size_px,
        ui_scale: dom_pan_px.scale,
      });

      if (!vp) return;
      dom_layers.set_viewport(vp);

      // z=0: floor is now emitted via rq_z0 (inside bounds only).
      // Reuse offscreen canvases across frames.
      if (!dom_off0 || !dom_off1 || !dom_off2 || dom_off_w !== width || dom_off_h !== height) {
        dom_off_w = width;
        dom_off_h = height;
        dom_off0 = create_canvas(width, height, { char: ' ', rgb: { r: 0, g: 0, b: 0 } });
        dom_off1 = create_canvas(width, height, { char: ' ', rgb: { r: 0, g: 0, b: 0 } });
        dom_off2 = create_canvas(width, height, { char: ' ', rgb: { r: 0, g: 0, b: 0 } });
      } else {
        const full = { x0: 0, y0: 0, x1: width - 1, y1: height - 1 };
        dom_off0.fill_rect(full, { char: ' ', rgb: { r: 0, g: 0, b: 0 } });
        dom_off1.fill_rect(full, { char: ' ', rgb: { r: 0, g: 0, b: 0 } });
        dom_off2.fill_rect(full, { char: ' ', rgb: { r: 0, g: 0, b: 0 } });
      }

      const off0 = dom_off0;
      const off1 = dom_off1;
      const off2 = dom_off2;

      let buffers_rebuilt = false;
      if (!dom_cells0 || !dom_cells1 || !dom_cells2 || dom_cells_w !== width || dom_cells_h !== height) {
        buffers_rebuilt = true;
        dom_cells_w = width;
        dom_cells_h = height;
        dom_cells0 = ensure_grid_cell_buffer(width, height);
        dom_cells1 = ensure_grid_cell_buffer(width, height);
        dom_cells2 = ensure_grid_cell_buffer(width, height);
      }

      const wrap = (local: any) => ({
        set: (x: number, y: number, cell: Cell) => local.set(x - inner.x0, y - inner.y0, cell),
        get: (x: number, y: number) => local.get(x - inner.x0, y - inner.y0),
      });

      // Partition particles by world_z.
      // (Other passes are already split at enqueue time.)
      draw_render_queue(wrap(off0) as any, rq_z0, { now_ms: Date.now(), pass_order: ['tile', 'item', 'character', 'particle'], character_flash_period_ms: 240 });
      draw_render_queue(wrap(off1) as any, rq_z1, { now_ms: Date.now(), pass_order: ['tile', 'item', 'character', 'particle'], character_flash_period_ms: 240 });
      draw_render_queue(wrap(off2) as any, rq_z2, { now_ms: Date.now(), pass_order: ['tile', 'item', 'character', 'particle'], character_flash_period_ms: 240 });

      const changed0 = sync_grid_cells_from_canvas(off0, dom_cells0!);
      const changed1 = sync_grid_cells_from_canvas(off1, dom_cells1!);
      const changed2 = sync_grid_cells_from_canvas(off2, dom_cells2!);
      if (changed0) dom_cells_ver0++;
      if (changed1) dom_cells_ver1++;
      if (changed2) dom_cells_ver2++;

      // Only notify DOM layers when content changes (renderer still updates transforms every frame).
      // When buffers are (re)allocated, bind them to layers at least once.
      if (buffers_rebuilt || changed0) dom_layers.set_layer_cells(0, dom_cells0!, dom_cells_ver0);
      if (buffers_rebuilt || changed1) dom_layers.set_layer_cells(1, dom_cells1!, dom_cells_ver1);
      if (buffers_rebuilt || changed2) dom_layers.set_layer_cells(2, dom_cells2!, dom_cells_ver2);
      dom_layers.render();

      dom_last_place_id = place.id;
    }
  }

  // Subscribe to tag change events via WebSocket (replaces broken EventEmitter)
  // WebSocket works across Electron process boundaries, EventEmitter doesn't
  const wsClient = initWebSocketClient();
  
  wsClient.on('TAG_CHANGED', (event: TagChangeEvent) => {
    debug_log_place('WebSocket TAG_CHANGED:', event.entityRef, event.tagName, 'mag:', event.oldMag, '->', event.newMag);
    updateCacheFromEvent(event);
  });
  
  wsClient.on('TAG_ADDED', (event: TagChangeEvent) => {
    debug_log_place('WebSocket TAG_ADDED:', event.entityRef, event.tagName, 'mag:', event.newMag);
    updateCacheFromEvent(event);
  });
  
  wsClient.on('TAG_REMOVED', (event: TagChangeEvent) => {
    debug_log_place('WebSocket TAG_REMOVED:', event.entityRef, event.tagName);
    updateCacheFromEvent(event);
  });
  
  wsClient.on('TAG_DISPERSING', (event: TagChangeEvent) => {
    debug_log_place('WebSocket TAG_DISPERSING:', event.entityRef, event.tagName, 'mag:', event.oldMag, '->', event.newMag);
    updateCacheFromEvent(event);
  });

  // Helper function to update cache from WebSocket events
  function updateCacheFromEvent(event: TagChangeEvent): void {
    const currentTags = entityTagCache.get(event.entityRef) || [];
    const tagIndex = currentTags.findIndex(t => t.name === event.tagName);
    
    if (event.type === 'TAG_REMOVED' || event.newMag === 0) {
      // Remove ALL instances of this tag (in case of duplicates)
      for (let i = currentTags.length - 1; i >= 0; i--) {
        const tag = currentTags[i];
        if (tag && tag.name === event.tagName) {
          currentTags.splice(i, 1);
        }
      }
    } else if ((event.type === 'TAG_UPDATED' || event.type === 'TAG_DISPERSING') && tagIndex >= 0 && currentTags[tagIndex]) {
      currentTags[tagIndex].mag = event.newMag;
      currentTags[tagIndex].meta = event.meta;
    } else if (event.type === 'TAG_ADDED' || tagIndex < 0) {
      // Add new tag (or update existing to prevent duplicates from double events)
      if (tagIndex >= 0 && currentTags[tagIndex]) {
        // Tag already exists - update it instead of creating duplicate
        currentTags[tagIndex].mag = event.newMag;
        currentTags[tagIndex].meta = event.meta;
      } else {
        // Tag doesn't exist - add it
        currentTags.push({
          name: event.tagName,
          mag: event.newMag,
          meta: event.meta
        });
      }
    } else if (tagIndex >= 0 && currentTags[tagIndex]) {
      currentTags[tagIndex].mag = event.newMag;
    }
    
    entityTagCache.set(event.entityRef, currentTags);
  }

  const mod: Module = {
    id: config.id,
    rect: config.rect,
    Focusable: true,

// Draw callback for PlaceModule - renders the place with all entities and effects
    Draw(canvas: Canvas): void {
      const place = config.get_place();

      // Draw border
      draw_module_border(canvas, {
        rect: config.rect,
        style: BORDER_STYLES.double,
        border_rgb,
        weight_index: 3,
      });

      if (!place) {
        // Ensure DOM world layers are not left mounted on an empty session.
        dom_layers.destroy();
        dom_last_place_id = null;

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

      // Phase 0.6: per-place view persistence (camera controller).
      const { width: inner_w, height: inner_h } = inner_size();
      const view_loaded = camera.ensure_loaded_for_place(place, inner_w, inner_h);

      // First render: center on the actor when available; otherwise default entry.
      // Only do this if we did not load a persisted view state for this place.
      if (!view_loaded && view.offset_x === 0 && view.offset_y === 0) {
        const actor_pos = config.get_actor_position?.() ?? null;
        const target = actor_pos ?? place.tile_grid.default_entry;
        debug_log_place("First render, centering on", {
          target,
          using_actor: !!actor_pos,
          default_entry: place.tile_grid.default_entry,
          place_size: { w: place.tile_grid.width, h: place.tile_grid.height }
        });
        center_on_tile(target.x, target.y, place);
        camera.schedule_save(place);
      }

      // Register place with unified movement engine if changed
      if (place.id !== current_place_id) {
        if (current_place_id) {
          unregister_place(current_place_id);
        }
        register_place(place.id, place);
        current_place_id = place.id;
      }

      // Populate tag cache from place data ONLY when place changes
      // WebSocket now provides real-time updates, so we don't need to sync every frame
      if (place.id !== last_cached_place_id) {
        populateTagCacheFromPlace(place);
        last_cached_place_id = place.id;
      }

      // Unified movement engine handles all position updates
      // Just need to render the current state
      draw_place(canvas, place);
    },

    OnPointerMove(e: PointerEvent): void {
      const place = config.get_place();
      if (!place) return;

      // Update hover
      const tile = screen_to_tile(e.x, e.y);
      if (tile) {
        const focus_world_z = get_focus_world_z_for_place(place);
        const entity = get_entity_at_world_z(tile.x, tile.y, place, focus_world_z);
        hovered = { x: tile.x, y: tile.y, world_z: focus_world_z, entity: entity ?? undefined };

      // Ground hover callback for highlighting (single item only)
      if (config.on_hover_ground_item) {
        const ids = config.get_ground_item_ids_at
          ? config.get_ground_item_ids_at(tile.x, tile.y)
          : get_items_on_ground_at_world_z(place, tile.x, tile.y, focus_world_z);

        if (ids.length === 1) {
          config.on_hover_ground_item(tile.x, tile.y, ids[0]!);
        } else {
          config.on_hover_ground_item(tile.x, tile.y, null);
        }
      }
      } else {
        hovered = null;
        config.on_hover_ground_item?.(-1, -1, null);
      }

      last_pointer_x = e.x;
      last_pointer_y = e.y;
    },

    OnDragStart(e: DragEvent): void {
      const place = config.get_place();
      if (!place) return;

      // Phase 0.6: Space+Drag is reserved for camera/view panning.
      // Do not start item drags while panning gesture is active.
      if (e.space) return;

      // Don't start a ground drag if a UI drag is active.
      if (config.is_dragging?.()) return;

      const tile = screen_to_tile(e.start_x, e.start_y);
      if (!tile) return;

      const focus_world_z = get_focus_world_z_for_place(place);

      // Range check (touch): 3D touch range (within 1 tile XY and 1 level Z).
      const actor_wp = get_player_actor_world_pos(place);
      if (actor_wp) {
        const tgt = { x: tile.x, y: tile.y, z: focus_world_z };
        if (!is_within_range_xy_z(actor_wp, tgt, 1.5, 1)) return;
      }

      const items_on_ground = get_items_on_ground_at_world_z(place, tile.x, tile.y, focus_world_z);

      // Allow direct dragging when at least one item exists.
      // Single item = drag that item; 2+ items = drag the whole pile (sweep).
      if ((items_on_ground as any[]).length < 1) return;

      config.on_drag_start_ground_item?.(tile.x, tile.y);
    },

    OnDragMove(e): void {
      const place = config.get_place();
      if (!place) return;
      if (!(e.buttons & 1)) return;

      // When dragging an item (inventory/ground), do not pan the view.
      if (config.is_dragging?.()) return;

      // Note: Space+Drag routing is handled by CanvasRuntime to avoid triggering global pan.

      const dx = e.step_dx;
      const dy = e.step_dy;
      const { width: inner_w, height: inner_h } = inner_size();
      const bounds = camera.get_bounds(place, inner_w, inner_h);

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

      camera.schedule_save(place);
    },

    OnDragEnd(e: DragEvent): void {
      debug_log_place(`[OnDragEnd] ========== DRAG END ==========`);
      debug_log_place(`[OnDragEnd] Called at screen position (${e.x}, ${e.y})`);
      debug_log_place(`[OnDragEnd] config.is_dragging exists: ${!!config.is_dragging}`);
      debug_log_place(`[OnDragEnd] config.on_drop exists: ${!!config.on_drop}`);
      debug_log_place(`[OnDragEnd] config.get_drag_source exists: ${!!config.get_drag_source}`);
      
      // Only handle drops if we're dragging an item
      if (!config.is_dragging) {
        debug_log_place(`[OnDragEnd] is_dragging callback not configured!`);
        return;
      }
      
      const is_dragging = config.is_dragging();
      debug_log_place(`[OnDragEnd] is_dragging() returned: ${is_dragging}`);
      
      if (!is_dragging) {
        debug_log_place(`[OnDragEnd] Not dragging - ignoring`);
        return;
      }

      const place = config.get_place();
      if (!place) {
        debug_log_place(`[OnDragEnd] No place loaded - ignoring`);
        return;
      }
      debug_log_place(`[OnDragEnd] Place: ${place.id}`);

      // Use screen_to_tile like OnClick does for consistent coordinate calculation
      const tile = screen_to_tile(e.x, e.y);
      debug_log_place(`[OnDragEnd] screen_to_tile(${e.x}, ${e.y}) returned: ${tile ? `(${tile.x}, ${tile.y})` : 'null'}`);
      
      if (!tile) {
        debug_log_place(`[OnDragEnd] Drop outside visible area - ignoring`);
        return;
      }

      const tile_x = tile.x;
      const tile_y = tile.y;

      // Check if tile is within place bounds
      if (tile_x < 0 || tile_x >= place.tile_grid.width || tile_y < 0 || tile_y >= place.tile_grid.height) {
        debug_log_place(`[OnDragEnd] Drop outside place bounds: (${tile_x}, ${tile_y}) vs grid (${place.tile_grid.width}x${place.tile_grid.height})`);
        return;
      }

      // Range gating (drop vs throw) - 3D.
      const actor_wp = get_player_actor_world_pos(place);
      debug_log_place(`[OnDragEnd] Actor position: ${actor_wp ? `(${actor_wp.x}, ${actor_wp.y}, ${actor_wp.z})` : 'null'}`);

      const focus_world_z = get_focus_world_z_for_place(place);
      if (actor_wp) {
        const tgt = { x: tile_x, y: tile_y, z: focus_world_z };
        const dx = Math.floor(tgt.x) - Math.floor(actor_wp.x);
        const dy = Math.floor(tgt.y) - Math.floor(actor_wp.y);
        const dist_xy = Math.sqrt(dx * dx + dy * dy);
        const dz = Math.abs(Math.floor(tgt.z) - Math.floor(actor_wp.z));
        debug_log_place(`[OnDragEnd] Distance from actor: xy=${dist_xy.toFixed(2)} dz=${dz}`);

        // Throw range is 5 tiles in XY; Z is limited to 1 level for now.
        const throw_range_xy = 5;
        const throw_range_z = 1;

        if (dist_xy > throw_range_xy || dz > throw_range_z) {
          debug_log_place(`[OnDragEnd] Target too far: xy=${dist_xy.toFixed(2)}/${throw_range_xy} dz=${dz}/${throw_range_z}`);
          return;
        }

        // Touch drop range: within 1 tile (incl diagonal) and within 1 z level.
        if (dist_xy > 1.5 || dz > 1) {
          // THROW
          debug_log_place(`[OnDragEnd] ========== CALLING on_throw ==========`);
          debug_log_place(`[OnDragEnd] Tile: (${tile_x}, ${tile_y}, wz=${focus_world_z}), xy=${dist_xy.toFixed(2)} dz=${dz}`);

          if (config.on_throw) {
            debug_log_place(`[OnDragEnd] Calling config.on_throw callback...`);
            void config.on_throw(tile_x, tile_y).then((success: boolean) => {
              debug_log_place(`[OnDragEnd] Throw ${success ? 'successful' : 'failed'} at (${tile_x}, ${tile_y})`);
            }).catch((err: any) => {
              debug_log_place(`[OnDragEnd] Throw error: ${err}`);
            });
          } else {
            debug_log_place(`[OnDragEnd] WARNING: config.on_throw callback not configured!`);
          }
          return;
        }
      }

      debug_log_place(`[OnDragEnd] ========== CALLING on_drop ==========`);
      debug_log_place(`[OnDragEnd] Tile: (${tile_x}, ${tile_y})`);

      // Call the on_drop callback
      if (config.on_drop) {
        debug_log_place(`[OnDragEnd] Calling config.on_drop callback...`);
        void config.on_drop(tile_x, tile_y).then((success: boolean) => {
          debug_log_place(`[OnDragEnd] Drop ${success ? 'successful' : 'failed'} at (${tile_x}, ${tile_y})`);
        }).catch((err: any) => {
          debug_log_place(`[OnDragEnd] Drop error: ${err}`);
        });
      } else {
        debug_log_place(`[OnDragEnd] ERROR: config.on_drop callback not configured!`);
      }
    },

    OnClick(e: PointerEvent): void {
      // Only left click should move/select. Right click is reserved for INSPECT.
      if (e.button !== 0) return;

      const place = config.get_place();
      if (!place) return;

      const focus_z = config.get_focus_z ? config.get_focus_z() : 1;
      const center_world_z = get_world_z_center_for_place(place);
      const visible_planes_z = get_visible_planes_z(center_world_z);
      const base_z = get_place_base_z(place);
      const focus_world_z = Math.floor(visible_planes_z[focus_z]);

      // Convert screen to tile coordinates
      const tile = screen_to_tile(e.x, e.y);
      if (!tile) return;

      // Focus gating: clicks/targets resolve only within the focused world layer.

      // PRIORITY 1: Handle double-click on ground items (structure plane)
      if (e.click_count === 2 && config.on_double_click_ground) {
        const item_ids = get_items_on_ground_at_world_z(place, tile.x, tile.y, focus_world_z);
        
        if (item_ids.length > 0) {
           // Grab/open range: 3D touch range (within 1 tile XY and 1 level Z).
           const actor_wp = get_player_actor_world_pos(place);
           if (actor_wp) {
             const tgt = { x: tile.x, y: tile.y, z: focus_world_z };
            if (!is_within_range_xy_z(actor_wp, tgt, 1.5, 1)) {
              debug_log_place(`Double-click on ground items rejected: out of touch range (actor=(${actor_wp.x},${actor_wp.y},${actor_wp.z}) tile=(${tile.x},${tile.y},${focus_world_z}))`);
              return;
            }
            debug_log_place(`Double-click on ground items at (${tile.x},${tile.y}), count: ${item_ids.length} (wz=${focus_world_z})`);
            config.on_double_click_ground(tile.x, tile.y);
          }
          return;
        }
      }

      // PRIORITY 1.5: Double-click tile container (structure plane)
      // defs+deltas migration: do not rely on legacy stored tile.tags to decide container-ness.
      // Use structural markers (contents/capacity/glyph hints) and let the backend validate.
      if (focus_world_z === base_z && e.click_count === 2 && config.on_open_tile_container) {
        const t = get_place_tile(place, tile.x, tile.y) as any;
        const is_container =
          Array.isArray(t?.contents) ||
          !!t?.container_capacity ||
          !!t?.container_glyphs;
        if (is_container) {
          config.on_open_tile_container(tile.x, tile.y);
          return;
        }
      }

      // PRIORITY 2: Door/travel
      // Doors live on the structure plane.
      const door_hit = (focus_world_z === base_z) ? get_door_at_tile(place, tile.x, tile.y) : null;
      if (door_hit) {
        const player = place.contents.actors_present[0];
        if (!player) return;

        const dist_to_door = Math.sqrt(
          Math.pow(player.tile_position.x - door_hit.door_x, 2) +
          Math.pow(player.tile_position.y - door_hit.door_y, 2)
        );

        // Must be within 2 tiles of door to travel
        if (dist_to_door > 2) {
          debug_log_place("DOOR: Player too far, pathing to door", {
            player_pos: player.tile_position,
            door_pos: { x: door_hit.door_x, y: door_hit.door_y },
            distance: dist_to_door,
          });

          const started = start_entity_movement(
            player.actor_ref,
            "actor",
            place,
            {
              type: "move_to",
              target_position: { x: door_hit.door_x, y: door_hit.door_y },
              priority: 10,
              reason: "Travel to door",
            },
            300,
            undefined,
            undefined,
            (_pos) => {
              play_sfx('footstep_blip', { emitter_ref: player.actor_ref, channel: 'sfx', cooldown_ms: footstep_cooldown_ms(300) });
            }
          );

          if (!started) {
            debug_log_place("DOOR: Path to door blocked");
          }
          return;
        }

        // Player is close enough - trigger place transition
        if (config.on_place_transition) {
          const result = config.on_place_transition(door_hit.conn.target_place_id, door_hit.conn.direction);
          if (result) return;
        }
        return;
      }

      // Entity selection (focus world-z only)
      const entity = get_entity_at_world_z(tile.x, tile.y, place, focus_world_z);
      if (entity) {
        const is_npc = "npc_ref" in entity;
        const ref = is_npc
          ? (entity as PlaceNPC).npc_ref
          : (entity as PlaceActor).actor_ref;

        // Phase 2: Handle double-click on NPC (e.click_count is set by runtime)
        if (e.click_count === 2 && is_npc && config.on_double_click_npc) {
          // Check distance (touch range) - 3D.
          const actor_wp = get_player_actor_world_pos(place);
          if (actor_wp) {
            const npc_wz = get_entity_world_z(entity as any, base_z);
            const tgt = { x: tile.x, y: tile.y, z: npc_wz };
            if (is_within_range_xy_z(actor_wp, tgt, 1.5, 1)) {
              debug_log_place(`Double-click on NPC: ${ref}`);
              config.on_double_click_npc(ref);
            } else {
              debug_log_place(`Double-click on NPC too far: ${ref} actor=(${actor_wp.x},${actor_wp.y},${actor_wp.z}) npc=(${tile.x},${tile.y},${npc_wz})`);
            }
          }
          return;
        }
        
        // Single click: Set internal target
        set_target({ x: tile.x, y: tile.y, entity });
        
        // Call external target selection callback if provided
        if (config.on_select_target) {
          config.on_select_target(ref);
        }
        
        console.log(`[PlaceModule] Target selected: ${ref}`);
        return;
      }

      // Tile targeting (not on walking/structure plane) - no movement.
      if (focus_world_z !== base_z) {
        set_target({ x: tile.x, y: tile.y });
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

      // Use unified movement engine
      // Get actor walk speed from their data
      const tiles_per_minute = get_actor_walk_speed(actor.actor_ref);

      const mode = get_move_mode();
      const speed_mult = mode === "SPRINT" ? 1.8 : mode === "SNEAK" ? 0.6 : 1.0;
      const speed_tpm = Math.max(60, Math.round(tiles_per_minute * speed_mult));
      const move_subtype = mode === "SPRINT" ? "SPRINT" : mode === "SNEAK" ? "SNEAK" : "WALK";

      
      const started = start_entity_movement(
        actor.actor_ref,
        "actor",
        place,
        {
          type: "move_to",
          target_position: { x: tile.x, y: tile.y },
          priority: 10,
          reason: "Player commanded movement"
        },
        speed_tpm,
        (_final_position) => {
          // On complete callback - receives final position from movement engine
          debug_log_place("Movement complete", { actor_ref: actor.actor_ref, final_position: _final_position });
          
          // Track actor position for facing calculations
          // Store in npc_actual_positions map (works for both NPCs and actors)
          set_npc_tracked_position(actor.actor_ref, _final_position);
          
          if (config.on_actor_move) {
            Promise.resolve(config.on_actor_move(actor.actor_ref, _final_position)).catch(err => {
              debug_log_place("Error saving position:", err);
            });
          }
        },
        (path) => {
          // On start callback - spawn path particles
          spawn_path_particles(path);
          
          debug_log_place("Click-to-move: Path found, starting movement", {
            from: { x: start_x, y: start_y },
            to: { x: tile.x, y: tile.y },
            path_length: path.length,
            speed: speed_tpm,
            move_mode: mode,
          });
        },
        (current_position) => {
          // On step callback - track position for facing calculations during movement
          set_npc_tracked_position(actor.actor_ref, current_position);
          play_sfx('footstep_blip', { emitter_ref: actor.actor_ref, channel: 'sfx', cooldown_ms: footstep_cooldown_ms(speed_tpm) });
        }
      );
      
      if (!started) {
        debug_log_place("Click-to-move: Path blocked", { x: tile.x, y: tile.y });
      }
    },

    OnPointerLeave(): void {
      hovered = null;
    },

    OnContextMenu(e: PointerEvent): void {
      const place = config.get_place();
      if (!place) return;

      const focus_z = config.get_focus_z ? config.get_focus_z() : 1;
      const center_world_z = get_world_z_center_for_place(place);
      const visible_planes_z = get_visible_planes_z(center_world_z);
      const base_z = get_place_base_z(place);
      const focus_world_z = Math.floor(visible_planes_z[focus_z]);

      // Convert screen to tile coordinates
      const tile = screen_to_tile(e.x, e.y);
      if (!tile) {
        // Right click is INSPECT only. If user clicks near a door (outside bounds), inspect that tile.
        const door_hit = get_door_from_screen(place, e.x, e.y);
        if (door_hit && config.on_inspect) {
          config.on_inspect({
            type: "tile",
            place_id: place.id,
            tile_position: { x: door_hit.door_x, y: door_hit.door_y },
          });
        }
        return;
      }

      // Handle inspection if callback configured
      if (config.on_inspect) {
        const tile_key = `${tile.x},${tile.y}`;
        
        // Shift+Right-click forces tile inspection
        if (e.shift) {
          config.on_inspect({
            type: "tile",
            place_id: place.id,
            tile_position: { x: tile.x, y: tile.y }
          });
          return;
        }
        
        // Normal right-click: cycle through inspectable targets
        // Order: Characters -> Items -> Tile
        const inspectable_targets: Array<{ type: "npc" | "actor" | "item" | "tile"; ref?: string }> = [];

        // No pick-topmost: inspection targets come only from the focused world layer.
        // Entities/items live on the structure plane (base_z).
        if (focus_world_z === base_z) {
          // 1. Add characters (NPCs/Actors)
          const all_entities = get_all_entities_at_world_z(tile.x, tile.y, place, focus_world_z);
          for (const ent of all_entities) {
            const is_npc = "npc_ref" in ent;
            inspectable_targets.push({
              type: is_npc ? "npc" : "actor",
              ref: is_npc
                ? (ent as PlaceNPC).npc_ref
                : (ent as PlaceActor).actor_ref
            });
          }

          // 2. Add items on ground
          const items_on_ground = place.contents.items_on_ground.filter(
            item => item.tile_position.x === tile.x && item.tile_position.y === tile.y
          );
          for (const item of items_on_ground) {
            inspectable_targets.push({
              type: "item",
              ref: item.item_ref
            });
          }
        }

        // 3. Add tile itself
        inspectable_targets.push({
          type: "tile"
        });
        
        if (inspectable_targets.length > 0) {
          // Get current cycle index
          let cycle_index = inspect_cycle_state.get(tile_key) || 0;
          
          // Get target at current index
          const target = inspectable_targets[cycle_index % inspectable_targets.length];
          
          if (target) {
            // Trigger inspection
            config.on_inspect({
              type: target.type,
              ref: target.ref,
              place_id: place.id,
              tile_position: { x: tile.x, y: tile.y }
            });
            
            // Advance cycle for next click
            const next_index = (cycle_index + 1) % inspectable_targets.length;
            inspect_cycle_state.set(tile_key, next_index);
            return;
          }
        }
      }
      
      // Right click is INSPECT only (no target selection, no movement).
    },

    OnWheel(e: WheelEvent): void {
      // Mouse wheel is reserved for world layer selection (focus_z).
      // No wrap/cycle: clamp to 0..2.
      if (!config.set_focus_z) return;
      const cur = config.get_focus_z ? config.get_focus_z() : 1;
      const dir = e.delta_y < 0 ? 1 : (e.delta_y > 0 ? -1 : 0);
      const next = clamp_int(cur + dir, 0, 2) as 0 | 1 | 2;
      if (next !== cur) {
        config.set_focus_z(next);
      }
    },

    OnKeyDown(e: KeyboardEvent): void {
      const place = config.get_place();
      if (!place) return;

      const scroll_step = Math.max(1, view.scale);
      const { width: inner_w, height: inner_h } = inner_size();
      const bounds = camera.get_bounds(place, inner_w, inner_h);

      switch (e.key) {
        case "ArrowUp":
        case "w":
        case "W":
          view.offset_y = clamp(
            view.offset_y + scroll_step,
            bounds.min_y,
            bounds.max_y
          );
          camera.schedule_save(place);
          break;
        case "ArrowDown":
        case "s":
        case "S":
          view.offset_y = clamp(
            view.offset_y - scroll_step,
            bounds.min_y,
            bounds.max_y
          );
          camera.schedule_save(place);
          break;
        case "ArrowLeft":
        case "a":
        case "A":
          view.offset_x = clamp(
            view.offset_x - scroll_step,
            bounds.min_x,
            bounds.max_x
          );
          camera.schedule_save(place);
          break;
        case "ArrowRight":
        case "d":
        case "D":
          view.offset_x = clamp(
            view.offset_x + scroll_step,
            bounds.min_x,
            bounds.max_x
          );
          camera.schedule_save(place);
          break;
        case "Home":
          // Center on actor when available; otherwise default entry.
          {
            const actor_pos = config.get_actor_position?.() ?? null;
            const target = actor_pos ?? place.tile_grid.default_entry;
            center_on_tile(target.x, target.y, place);
            camera.schedule_save(place);
          }
          break;
        case "m":
        case "M":
          // Cycle movement mode (WALK -> SNEAK -> SPRINT)
          cycle_move_mode();
          break;
      }
    },
  };

  // Debug helper: recenters the place view on the player actor.
  // Exposed so top-right debug buttons can recover from a bad view offset.
  (mod as any).debug_center_on_actor = (): void => {
    const place = config.get_place();
    if (!place) return;
    const pos = config.get_actor_position?.() ?? null;
    if (!pos) return;
    center_on_tile(pos.x, pos.y, place);
    camera.schedule_save(place);
  };

  return mod as any;
}
