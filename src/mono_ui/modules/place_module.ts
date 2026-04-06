import type { Canvas, Module, Rect, Rgb, PointerEvent, WheelEvent, DragEvent, Cell } from "../types.js";
import { rect_width, rect_height } from "../types.js";
import { draw_module_border, PANEL_BORDER_PRESETS } from "../module_borders.js";
import { get_color_by_name } from "../colors.js";
import type { Place, PlaceNPC, PlaceActor, PlaceConnector, TilePosition, PlaceTile } from "../../types/place.js";
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
import { compute_anchor_world_voxel, eval_body_model_voxels, get_body_model_def } from "../../shared/body_model.js";
import { get_body_slots_for_character_hit } from "../../shared/body_slot_representation.js";
import { place_voxel_blocks_los } from "../../place_storage/occupancy_index.js";
import { can_place_volume } from "../../place_storage/movement_legality.js";
import { find_path as shared_find_path } from "../../shared/pathfinding.js";
import { set_npc_tracked_position, get_npc_visual_status } from "./movement_command_handler.js";
import { play_sfx } from "../sfx/sfx_player.js";
import { make_entity_payload, make_ground_items_tile_payload, make_item_like_payload, make_item_payload, make_pile_payload, make_simple_tile_payload } from "../../render_shaders/payload_builders.js";
import { draw_render_queue, select_flash_index, type RenderRequest } from "../../render_shaders/render_queue.js";
import { ctx_place_tile } from "../../render_shaders/context_builders.js";
import { PlaceDomLayers } from "../place_dom_layers.js";
import type { GridCell } from "../../ascii_painter/types.js";
import { create_canvas } from "../canvas.js";
import { touch_world_layers_owner } from "../world_layers_owner.js";
import { compute_dom_viewport_for_rect } from "../runtime/dom_viewport.js";
import { create_place_camera_controller } from "../runtime/place_camera_controller.js";
import { get_move_intent, is_jump_down, subscribe_move_intent_changes, type MoveIntent, type MoveIntentChangeMeta } from "../runtime/input_actions.js";
import type { GizmoState, ModuleGizmosConfig } from "../module_gizmos.js";
import {
  clear_gizmo_hover_state,
  create_gizmo_state,
  draw_module_gizmos,
  get_resize_edge,
  handle_global_pointer_down_for_gizmos,
  handle_gizmo_click,
  handle_move_drag,
  handle_resize_drag,
  is_in_gizmo_area,
  should_draw_module_chrome,
  update_gizmo_hover_state,
} from "../module_gizmos.js";
import { get_character_camera_focus_tile } from "../../shared/character_camera_focus.js";
import type { ItemInstance } from "../../item_instances/store.js";
import type { ItemDefinition } from "../../item_storage/store.js";
import { get_defined_place_world_zs as get_authored_place_world_zs, get_place_base_z, get_place_tile_at_world_z as get_shared_place_tile_at_world_z, tile_offset_to_layer_key } from "../../shared/place_layers.js";
import { compute_adjacent_place_bounds, find_place_containing_region_voxel, get_local_volume_boundary_info, get_place_region_bounds, get_places_face_adjacency, region_bounds_overlap, select_place_resize_face } from "../../shared/place_adjacency.js";
import {
  record_intent_observed,
  record_intent_post_result,
  record_intent_post_started,
  record_local_actor_step_applied,
  record_move_batch_received,
  record_place_breath_tick,
} from "../../shared/movement_debug_state.js";

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

function opposite_connector_direction(direction: string): string {
  switch (String(direction)) {
    case 'x+': return 'x-';
    case 'x-': return 'x+';
    case 'y+': return 'y-';
    case 'y-': return 'y+';
    case 'z+': return 'z-';
    case 'z-': return 'z+';
    default: return String(direction);
  }
}

function connector_direction_to_step(direction: string): { dx: number; dy: number } | null {
  switch (String(direction)) {
    case 'x+': return { dx: 1, dy: 0 };
    case 'x-': return { dx: -1, dy: 0 };
    case 'y+': return { dx: 0, dy: 1 };
    case 'y-': return { dx: 0, dy: -1 };
    default: return null;
  }
}
// Debug logging helper - re-enabled with balanced output
const place_debug_sample_counts = new Map<string, number>();
const PLACE_MODULE_TIMING_VERSION = '2026-03-14-visible-pulse-v1';
const DEFAULT_FOCUS_Z = 0;
function should_sample_place_debug(prefix: string, sampleEvery: number): boolean {
  const next = (place_debug_sample_counts.get(prefix) ?? 0) + 1;
  place_debug_sample_counts.set(prefix, next);
  return next % sampleEvery === 0;
}

function debug_log_place(...args: any[]) {
  const msg = args.map((a: any) => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  if (msg.includes('scene visible subset')) return;
  const always =
    msg.includes('MOVE_VEL_TEST') ||
    msg.includes('MOVE_UNIFY_TEST') ||
    msg.includes('Click-to-move accepted') ||
    msg.includes('Click-to-move rejected') ||
    msg.includes('DOOR:') ||
    msg.includes('MULTITILE_TEST');
  if (!always) {
    if (msg.includes('[GroundItems] Rendering') && !should_sample_place_debug('grounditems', 60)) return;
    if (msg.includes('CACHE CLEARED') && !should_sample_place_debug('cache-cleared', 10)) return;
    if (msg.includes('CACHE POPULATED') && !should_sample_place_debug('cache-populated', 10)) return;
    if (msg.includes('Cached NPC') && !should_sample_place_debug('cached-npc', 120)) return;
    if (msg.includes('Cached Actor') && !should_sample_place_debug('cached-actor', 120)) return;
    if (msg.includes('WebSocket TAG_') && !should_sample_place_debug('tag-events', 120)) return;
  }
  // eslint-disable-next-line no-console
  console.log("[PlaceModule]", ...args.map((a: any) => typeof a === 'object' ? JSON.stringify(a) : a));
}

type ScenePlaceCacheEntry = {
  place: Place;
  offset: { x: number; y: number; z: number };
  bounds: {
    min_x: number;
    max_x: number;
    min_y: number;
    max_y: number;
    min_z: number;
    max_z: number;
  };
};

type ScenePlaceCache = {
  selected_place_ref: Place | null;
  raw_scene_places_ref: Place[] | null;
  actor_current_place_id: string | null;
  hops_visible: number;
  places: Place[];
  entries: ScenePlaceCacheEntry[];
  scene_world_zs: number[];
  connector_lookup: Map<string, { place_id: string; connector: PlaceConnector }>;
};

type SceneViewBounds = {
  min_x: number;
  max_x: number;
  min_y: number;
  max_y: number;
};

let scene_place_cache: ScenePlaceCache | null = null;

// Simple entity tag cache - populated from place data, updated via events
  const entityTagCache = new Map<string, TagInstance[]>();

  // Last resolved entity hit context (owner + part + voxel).
  // Used for debugging now; later used for part-targeted actions + body slot mapping.
  let last_entity_hit: { ref: string; part: string; voxel: { x: number; y: number; z: number } } | null = null;

  const multitile_devlog_once = new Set<string>();
  let last_cached_place_id: string | null = null;
  let last_painter_drag_key: string | null = null;
  let painter_move_drag_active = false;
  let painter_shape_drag_active = false;
  let painter_pan_drag_active = false;
  let painter_pan_start = { x: 0, y: 0 };
  let painter_pan_view_start = { x: 0, y: 0 };
  let last_painter_key_pan_ms = 0;

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
  get_scene_places?: () => Place[];
  get_scene_selected_place_id?: () => string | null;
  get_actor_current_place_id?: () => string | null;
  get_scene_connector_hops_visible?: () => number;
  on_move?: (new_rect: Rect) => void;
  on_resize?: (new_rect: Rect) => void;
  on_move_end?: (final_rect: Rect) => void;
  on_resize_end?: (final_rect: Rect) => void;

  // Target selection callback - called when user right-clicks an entity
  // Returns true if target was valid and selected, false otherwise
  on_select_target?: (target_ref: string) => boolean;
  get_display_name_for_ref?: (entity_ref: string) => string;

  // Actor movement callback - called when actor completes movement to a new tile
  // Allows persisting position change to storage
  on_actor_move?: (actor_ref: string, new_position: TilePosition & { z?: number }) => Promise<void> | void;

  // Inspection callback - called when user right-clicks to inspect
  // Right-click cycles: Characters -> Items -> Tile
  // Shift+Right-click forces tile inspection
  on_inspect?: (target: {
    type: "npc" | "actor" | "structure" | "item" | "item_pile" | "tile" | "place" | "adjacent_place";
    ref?: string;
    place_id?: string;
    tile_position: TilePosition;
  }) => void;

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
  get_grid_height?: () => number;
  font_family: string;
  base_font_size_px: number;

  // World focus layer selection within the visible z window.
  get_focus_z?: () => number;
  set_focus_z?: (z: number) => void;

  // World-Z center (absolute elevation) for the visible viewport window.
  get_world_z_center?: () => number;

  // Mouse parallax normalized (-1..+1), centered on place viewport.
  get_mouse_parallax?: () => { x: number; y: number };

  // Player movement mode (affects speed + movement sound debug broadcast)
  get_move_mode?: () => "WALK" | "SNEAK" | "SPRINT";
  set_move_mode?: (mode: "WALK" | "SNEAK" | "SPRINT") => void;

  // Phase 2: Double-click callbacks for opening containers
  on_double_click_npc?: (npc_ref: string) => void;  // Open NPC character module
  on_double_click_ground?: (tile_x: number, tile_y: number) => void;  // Open scattered container
  on_open_tile_container?: (tile_x: number, tile_y: number, world_z: number) => void;  // Open a tile container (harvestable, planter, etc.)
  get_controlled_actor_ref?: () => string | null;
  get_session_token?: () => string | null;
  request_scene_place_refresh?: (place_id: string) => void;
  get_actor_position?: () => { x: number; y: number } | null;  // For distance checking
  get_camera_target_position?: () => { x: number; y: number } | null;
  get_camera_target_mode?: () => 'follow_actor' | 'free';
  set_camera_target_position?: (tile: { x: number; y: number }, mode?: 'follow_actor' | 'free') => void;

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

  get_place_painter_preview?: () => null | {
    kind: 'tile' | 'item';
    id: string;
    display_char: string;
    display_color: string;
    body_model?: { physical?: Array<{ dx: number; dy: number; dz: number }> } | null;
  };
  get_place_painter_tool?: () => PlacePainterTool;
  get_place_painter_tool_for_button?: (button: number) => PlacePainterTool;
  get_place_painter_shape_preview?: () => Array<{ x: number; y: number }>;
  get_place_painter_resize_preview?: () => null | {
    place_id: string;
    face: 'x+' | 'x-' | 'y+' | 'y-' | 'z+' | 'z-';
    interaction?: 'targeting';
    proposed_bounds: { origin: { x: number; y: number; z: number }; size: { x: number; y: number; z: number } };
    valid: boolean;
    conflict_place_id?: string | null;
  };
  get_place_painter_move_preview?: () => null | {
    place_id: string;
    entity_ref: string;
    entity_type: 'npc' | 'actor' | 'item' | 'pile' | 'structure';
    display_char: string;
    display_color: string;
    body_model?: { physical?: Array<{ dx: number; dy: number; dz: number }> } | null;
    body_model_id?: string;
    facing?: string | null;
    name?: string;
    tags?: any[];
    kind_id?: string;
    entity_render?: any;
    source: { x: number; y: number; z: number };
    target: { x: number; y: number; z: number };
    valid: boolean;
  };

  // Drag and drop callbacks
  on_drop?: (tile_x: number, tile_y: number) => Promise<boolean>;  // Drop item onto ground tile (adjacent)
  on_throw?: (tile_x: number, tile_y: number) => Promise<boolean>;  // Throw item to distant tile (within range)
  is_dragging?: () => boolean;  // Check if an item is being dragged
  get_drag_source?: () => { item_instance_id: string; source_container_id: string } | null;  // Get drag source info

  // In-game place painter mode hooks.
  is_place_painter_active?: () => boolean;
  on_place_painter_primary_action?: (target: {
    place_id: string;
    tile_position: TilePosition;
    world_z: number;
    region_position?: { x: number; y: number; z: number };
    button?: number;
    entity_ref?: string;
    entity_type?: 'npc' | 'actor' | 'item' | 'pile' | 'structure';
  }) => Promise<void> | void;
  on_place_painter_shape_start?: (target: {
    place_id: string;
    tile_position: TilePosition;
    world_z: number;
    button?: number;
  }) => void;
  on_place_painter_shape_update?: (target: {
    place_id: string;
    tile_position: TilePosition;
    world_z: number;
  }) => void;
  on_place_painter_shape_end?: () => Promise<void> | void;
  on_place_painter_resize_start?: (target: {
    place_id: string;
    tile_position: TilePosition;
    world_z: number;
    region_position?: { x: number; y: number; z: number };
  }) => void;
  on_place_painter_resize_update?: (target: {
    place_id: string;
    tile_position: TilePosition;
    world_z: number;
    region_position?: { x: number; y: number; z: number };
  }) => void;
  on_place_painter_resize_end?: () => void;
  on_place_painter_resize_adjust_z?: (delta: number) => void;
  on_place_painter_move_start?: (target: {
    place_id: string;
    tile_position: TilePosition;
    world_z: number;
    entity_ref?: string;
    entity_type?: 'npc' | 'actor' | 'item' | 'pile' | 'structure';
  }) => void;
  on_place_painter_move_update?: (target: {
    place_id: string;
    tile_position: TilePosition;
    world_z: number;
  }) => void;
  on_place_painter_move_end?: () => void;
};

type ViewState = {
  // Viewport offset in tile coordinates (bottom-left of view)
  offset_x: number;
  offset_y: number;
  // Scale: how many tiles per character (1, 2, 4, etc. - must be power of 2 for clean rendering)
  scale: number;
};

type HoveredTile = {
  place_id?: string;
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
  // World Z layer for DOM world rendering relative slot.
  world_z?: number;
  char: string;        // Visual character
  rgb: Rgb;           // Color
  created_at: number;  // Timestamp (Date.now())
  lifespan_ms: number; // How long to live
  weight?: number;     // Optional weight for rendering priority (higher = on top)
  render_index?: number; // Render layer (higher = on top), defaults to 3 for particles
  op?: 'set' | 'tint_fg';
};

type PlacePainterTool = 'paint' | 'erase' | 'eyedropper' | 'line' | 'rect_stroke' | 'rect_fill' | 'bucket' | 'character' | 'move' | 'place_create' | 'place_delete' | 'place_resize' | 'region_tool';

function is_shape_painter_tool(tool: string | null | undefined): tool is 'line' | 'rect_stroke' | 'rect_fill' {
  return tool === 'line' || tool === 'rect_stroke' || tool === 'rect_fill';
}

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
  // eslint-disable-next-line no-console
  console.log('[MOVE_VEL_TEST] renderer place module version ' + JSON.stringify({ version: PLACE_MODULE_TIMING_VERSION }));
  let rect = config.rect;
  const border_rgb = config.border_rgb ?? get_color_by_name("light_gray").rgb;
  const bg_rgb = config.bg_rgb ?? get_color_by_name("off_black").rgb;
  const npc_rgb = config.npc_rgb ?? get_color_by_name("pale_yellow").rgb;
  const actor_rgb = config.actor_rgb ?? get_color_by_name("vivid_green").rgb;
  const grid_rgb = config.grid_rgb ?? get_color_by_name("medium_gray").rgb;

  // View state
  const camera = create_place_camera_controller({ initial_scale: config.initial_scale ?? 1, padding_tiles: PADDING_TILES });
  const view: ViewState = camera.view;
  const gizmo_config: ModuleGizmosConfig = {
    enabled: ['move', 'resize', 'seamless'],
    can_close: false,
    can_move: true,
    can_save_position: false,
  };
  const gizmo_state: GizmoState = create_gizmo_state();

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

  function get_connector_at_tile(selected_place: Place, place: Place, tile_x: number, tile_y: number, world_z?: number): {
    connector: PlaceConnector;
    target_place_id: string;
    border_x: number;
    border_y: number;
    approach_x: number;
    approach_y: number;
    label: string;
  } | null {
    const offset = get_scene_offset_tiles(selected_place, place);
    const scene_x = tile_x + offset.x;
    const scene_y = tile_y + offset.y;
    const scene_z = Math.floor(Number(world_z ?? get_place_base_z(place))) + offset.z;
    const hit = get_scene_connector_at(selected_place, scene_x, scene_y, scene_z);
    if (!hit) return null;
    const connector = hit.connector;
    const target_place_id = connector.place_a_id === place.id
      ? connector.place_b_id
      : connector.place_b_id === place.id
        ? connector.place_a_id
        : null;
    if (!target_place_id) return null;
    const approach_volume = connector.place_a_id === place.id
      ? (connector as any).place_a_entry_volume
      : (connector as any).place_b_entry_volume;
    const approach = {
      x: Math.floor(Number(approach_volume?.origin?.x ?? tile_x)) + Math.floor((Math.max(1, Math.floor(Number(approach_volume?.size?.x ?? 1)) || 1) - 1) / 2),
      y: Math.floor(Number(approach_volume?.origin?.y ?? tile_y)) + Math.floor((Math.max(1, Math.floor(Number(approach_volume?.size?.y ?? 1)) || 1) - 1) / 2),
    };
    return {
      connector,
      target_place_id,
      border_x: tile_x,
      border_y: tile_y,
      approach_x: Math.floor(Number(approach?.x ?? tile_x)),
      approach_y: Math.floor(Number(approach?.y ?? tile_y)),
      label: String(connector.direction_from_a ?? 'connector'),
    };
  }

  function get_connector_from_screen(selected_place: Place, place: Place, sx: number, sy: number, world_z?: number): {
    connector: PlaceConnector;
    target_place_id: string;
    border_x: number;
    border_y: number;
    approach_x: number;
    approach_y: number;
    label: string;
  } | null {
    const inner = inner_rect();
    const rel_x = sx - inner.x0;
    const rel_y = sy - inner.y0;
    const tile_x = Math.floor(view.offset_x + rel_x * view.scale);
    const tile_y = Math.floor(view.offset_y + rel_y * view.scale);
    const resolved = resolve_scene_tile(selected_place, tile_x, tile_y);
    if (!resolved) return null;
    return get_connector_at_tile(selected_place, place, resolved.tile_x, resolved.tile_y, world_z);
  }

  function get_place_tile(place: Place, tile_x: number, tile_y: number): PlaceTile | null {
    try {
      const t: PlaceTile | undefined = (place as any)?.tiles?.cells?.[tile_y]?.[tile_x];
      return t ?? null;
    } catch {
      return null;
    }
  }

  function get_place_tile_at_world_z(place: Place, tile_x: number, tile_y: number, world_z: number): PlaceTile | null {
    return get_shared_place_tile_at_world_z(place, tile_x, tile_y, world_z);
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
        return n === 'OCCUPIES' || n === 'CONNECTOR' || n === 'DOOR';
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
  
  // Track previous entity positions to detect movement and spawn footsteps
  const previous_positions = new Map<string, TilePosition & { z?: number }>();
  // Track recent motion locally from authoritative position updates.
  const recent_movement_seen_at = new Map<string, number>();
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
  let dom_off_layers: Array<Canvas | null> = [];

  // Reuse DOM-export buffers to reduce GC.
  let dom_cells_w = 0;
  let dom_cells_h = 0;
  let dom_cells_layers: Array<GridCell[][] | null> = [];
  let dom_cells_versions: number[] = [];

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
      const visible_planes_z = get_defined_scene_world_zs(place);
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
    const r = rect;
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
    const focus_z = config.get_focus_z ? config.get_focus_z() : DEFAULT_FOCUS_Z;
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
        try {
          const base_z = get_place_base_z(place);
          const z0 = get_entity_world_z(npc as any, base_z);
          const anchor = compute_anchor_world_voxel({
            origin: { x: npc.tile_position.x, y: npc.tile_position.y, z: z0 },
            body_model_id: (npc as any)?.body_model_id,
            facing: get_facing(String((npc as any)?.npc_ref ?? targeted!.ref)),
            mode: 'physical',
          });
          return { x: anchor.x, y: anchor.y };
        } catch {
          return npc.tile_position;
        }
      }
    } else if (targeted.type === "actor" && place.contents?.actors_present) {
      const actor = place.contents.actors_present.find(a => a.actor_ref === targeted!.ref);
      if (actor) {
        try {
          const base_z = get_place_base_z(place);
          const z0 = get_entity_world_z(actor as any, base_z);
          const anchor = compute_anchor_world_voxel({
            origin: { x: actor.tile_position.x, y: actor.tile_position.y, z: z0 },
            body_model_id: (actor as any)?.body_model_id,
            facing: get_facing(String((actor as any)?.actor_ref ?? targeted!.ref)),
            mode: 'physical',
          });
          return { x: anchor.x, y: anchor.y };
        } catch {
          return actor.tile_position;
        }
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

  function get_scene_view_bounds(selected_place: Place, inner_w: number, inner_h: number): SceneViewBounds {
    const tiles_visible_x = Math.max(1, Math.floor(inner_w)) * view.scale;
    const tiles_visible_y = Math.max(1, Math.floor(inner_h)) * view.scale;
    const scene_entries = build_scene_place_cache(selected_place).entries;
    if (scene_entries.length < 1) {
      return camera.get_bounds(selected_place, inner_w, inner_h);
    }
    let min_x = Number.POSITIVE_INFINITY;
    let min_y = Number.POSITIVE_INFINITY;
    let max_x = Number.NEGATIVE_INFINITY;
    let max_y = Number.NEGATIVE_INFINITY;
    for (const entry of scene_entries) {
      const w = Math.max(1, Math.floor(Number(entry.place?.tile_grid?.width ?? 1)) || 1);
      const h = Math.max(1, Math.floor(Number(entry.place?.tile_grid?.height ?? 1)) || 1);
      min_x = Math.min(min_x, entry.offset.x - PADDING_TILES);
      min_y = Math.min(min_y, entry.offset.y - PADDING_TILES);
      max_x = Math.max(max_x, entry.offset.x + w + PADDING_TILES - tiles_visible_x);
      max_y = Math.max(max_y, entry.offset.y + h + PADDING_TILES - tiles_visible_y);
    }
    if (!Number.isFinite(min_x) || !Number.isFinite(min_y) || !Number.isFinite(max_x) || !Number.isFinite(max_y)) {
      return camera.get_bounds(selected_place, inner_w, inner_h);
    }
    return {
      min_x,
      min_y,
      max_x: Math.max(min_x, max_x),
      max_y: Math.max(min_y, max_y),
    };
  }

  function center_on_scene_tile(tile_x: number, tile_y: number, selected_place: Place): void {
    const { width, height } = inner_size();
    const tiles_visible_x = Math.max(1, Math.floor(width)) * view.scale;
    const tiles_visible_y = Math.max(1, Math.floor(height)) * view.scale;
    const bounds = get_scene_view_bounds(selected_place, width, height);
    const margin = 2;
    const target_offset_x = Math.floor(tile_x - tiles_visible_x / 2 + margin);
    const target_offset_y = Math.floor(tile_y - tiles_visible_y / 2 + margin);
    const clamped_x = clamp(target_offset_x, bounds.min_x, bounds.max_x);
    const clamped_y = clamp(target_offset_y, bounds.min_y, bounds.max_y);
    if ((clamped_x !== target_offset_x || clamped_y !== target_offset_y) && should_sample_place_debug('camera-follow-clamp', 20)) {
      debug_log_place('PLACE_CAMERA follow clamp', {
        selected_place_id: selected_place.id,
        target: { x: tile_x, y: tile_y },
        requested_offset: { x: target_offset_x, y: target_offset_y },
        clamped_offset: { x: clamped_x, y: clamped_y },
        bounds,
      });
    }
    view.offset_x = clamped_x;
    view.offset_y = clamped_y;
  }

  function get_place_region_origin(place: Place): { x: number; y: number; z: number } {
    return {
      x: Math.floor(Number((place as any)?.region_bounds?.origin?.x ?? 0)) || 0,
      y: Math.floor(Number((place as any)?.region_bounds?.origin?.y ?? 0)) || 0,
      z: Math.floor(Number((place as any)?.region_bounds?.origin?.z ?? (place as any)?.coordinates?.elevation ?? 0)) || 0,
    };
  }

  function get_place_render_region_bounds(place: Place): { origin: { x: number; y: number; z: number }; size: { x: number; y: number; z: number } } {
    const base = get_place_region_bounds(place);
    const visible_zs = get_defined_place_world_zs(place);
    const min_z = visible_zs.length > 0 ? Math.min(base.origin.z, ...visible_zs) : base.origin.z;
    const max_z = visible_zs.length > 0 ? Math.max(base.origin.z + Math.max(1, base.size.z) - 1, ...visible_zs) : (base.origin.z + Math.max(1, base.size.z) - 1);
    return {
      origin: { x: base.origin.x, y: base.origin.y, z: min_z },
      size: { x: Math.max(1, base.size.x), y: Math.max(1, base.size.y), z: Math.max(1, max_z - min_z + 1) },
    };
  }

  function get_place_render_boundary_info(place: Place, region_voxel: { x: number; y: number; z: number }): { is_corner: boolean; is_edge: boolean } | null {
    const bounds = get_place_render_region_bounds(place);
    const local = {
      x: Math.floor(Number(region_voxel.x ?? 0)) - Math.floor(Number(bounds.origin.x ?? 0)),
      y: Math.floor(Number(region_voxel.y ?? 0)) - Math.floor(Number(bounds.origin.y ?? 0)),
      z: Math.floor(Number(region_voxel.z ?? 0)) - Math.floor(Number(bounds.origin.z ?? 0)),
    };
    const info = get_local_volume_boundary_info(bounds.size, local);
    if (!info) return null;
    return { is_corner: info.is_corner, is_edge: info.is_edge };
  }

  function build_scene_place_cache(selected_place: Place): ScenePlaceCache {
    const raw_scene_places = config.get_scene_places?.() ?? [];
    const hops_visible = Math.max(0, Math.floor(Number(config.get_scene_connector_hops_visible?.() ?? 1)) || 0);
    const actor_current_place_id = config.get_actor_current_place_id?.() ?? null;
    if (
      scene_place_cache &&
      scene_place_cache.selected_place_ref === selected_place &&
      scene_place_cache.raw_scene_places_ref === raw_scene_places &&
      scene_place_cache.actor_current_place_id === actor_current_place_id &&
      scene_place_cache.hops_visible === hops_visible
    ) {
      return scene_place_cache;
    }

    const raw = Array.isArray(raw_scene_places) ? raw_scene_places : [];
    const deduped: Place[] = [];
    const by_id = new Map<string, Place>();
    for (const place of raw) {
      if (!place || typeof place.id !== 'string' || by_id.has(place.id)) continue;
      by_id.set(place.id, place);
      deduped.push(place);
    }
    if (!by_id.has(selected_place.id)) {
      by_id.set(selected_place.id, selected_place);
      deduped.unshift(selected_place);
    }

    const visible_places = deduped.length > 0 ? deduped : [selected_place];
    const selected_origin = get_place_region_origin(selected_place);
    const entries: ScenePlaceCacheEntry[] = visible_places.map((place) => {
      const origin = get_place_region_origin(place);
      const size_x = Math.max(1, Math.floor(Number((place as any)?.region_bounds?.size?.x ?? place.tile_grid.width ?? 1)) || 1);
      const size_y = Math.max(1, Math.floor(Number((place as any)?.region_bounds?.size?.y ?? place.tile_grid.height ?? 1)) || 1);
      const size_z = Math.max(1, Math.floor(Number((place as any)?.region_bounds?.size?.z ?? 1)) || 1);
      return {
        place,
        offset: { x: origin.x - selected_origin.x, y: origin.y - selected_origin.y, z: origin.z - selected_origin.z },
        bounds: {
          min_x: origin.x - 1,
          max_x: origin.x + size_x,
          min_y: origin.y - 1,
          max_y: origin.y + size_y,
          min_z: origin.z - 1,
          max_z: origin.z + size_z,
        },
      };
    });

    const scene_world_zs_set = new Set<number>();
    const connector_lookup = new Map<string, { place_id: string; connector: PlaceConnector }>();
    for (const entry of entries) {
      for (const z of get_defined_place_world_zs(entry.place)) scene_world_zs_set.add(z);
      const bounds = get_place_render_region_bounds(entry.place);
      const z0 = Math.floor(Number(bounds.origin.z ?? 0)) || 0;
      const sz = Math.max(1, Math.floor(Number(bounds.size.z ?? 1)) || 1);
      for (let dz = 0; dz < sz; dz += 1) scene_world_zs_set.add(z0 + dz);
    }

    scene_place_cache = {
      selected_place_ref: selected_place,
      raw_scene_places_ref: raw_scene_places,
      actor_current_place_id,
      hops_visible,
      places: visible_places,
      entries,
      scene_world_zs: scene_world_zs_set.size > 0 ? Array.from(scene_world_zs_set).sort((a, b) => a - b) : [get_place_base_z(selected_place)],
      connector_lookup,
    };
    debug_log_place(`SEAM_SCENE visible ${JSON.stringify({ selected_place_id: selected_place.id, actor_current_place_id, hops_visible, visible_place_ids: visible_places.map((p) => p.id) })}`);
    return scene_place_cache;
  }

  function get_scene_places(selected_place: Place): Place[] {
    return build_scene_place_cache(selected_place).places;
  }

  function get_scene_offset_tiles(selected_place: Place, other_place: Place): { x: number; y: number; z: number } {
    const a = get_place_region_origin(selected_place);
    const b = get_place_region_origin(other_place);
    return { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  }

  function get_scene_border_cell(selected_place: Place, scene_place: Place, scene_x: number, scene_y: number, world_z: number): {
    is_corner: boolean;
    is_edge: boolean;
  } | null {
    const selected_origin = get_place_region_origin(selected_place);
    const region_voxel = {
      x: selected_origin.x + scene_x,
      y: selected_origin.y + scene_y,
      z: Math.floor(Number(world_z) || 0),
    };
    const boundary = get_place_render_boundary_info(scene_place, region_voxel);
    if (!boundary || !boundary.is_edge) return null;
    return { is_corner: boundary.is_corner, is_edge: boundary.is_edge };
  }

  function voxel_has_render_content(place: Place, tile_x: number, tile_y: number, world_z: number): boolean {
    if (tile_x < 0 || tile_x >= place.tile_grid.width || tile_y < 0 || tile_y >= place.tile_grid.height) return false;
    if (get_place_tile_at_world_z(place, tile_x, tile_y, world_z)) return true;
    if (get_structures_at_world_z(tile_x, tile_y, place, world_z).length > 0) return true;
    if (get_entity_hit_at_world_z(tile_x, tile_y, place, world_z)) return true;
    if (get_items_on_ground_at_world_z(place, tile_x, tile_y, world_z).length > 0) return true;
    return false;
  }

  function resolve_scene_tile(selected_place: Place, scene_x: number, scene_y: number, opts?: { prefer_selected_border?: boolean }): {
    place: Place;
    tile_x: number;
    tile_y: number;
    scene_x: number;
    scene_y: number;
    offset: { x: number; y: number; z: number };
    is_interior: boolean;
    is_border: boolean;
  } | null {
    const scene_entries = build_scene_place_cache(selected_place).entries;
    let best: {
      place: Place;
      tile_x: number;
      tile_y: number;
      scene_x: number;
      scene_y: number;
      offset: { x: number; y: number; z: number };
      is_interior: boolean;
      is_border: boolean;
      score: number;
    } | null = null;
    for (const entry of scene_entries) {
      const scene_place = entry.place;
      const offset = entry.offset;
      const tile_x = scene_x - offset.x;
      const tile_y = scene_y - offset.y;
      const is_interior = tile_x >= 0 && tile_x < scene_place.tile_grid.width && tile_y >= 0 && tile_y < scene_place.tile_grid.height;
      const is_border = tile_x >= -1 && tile_x <= scene_place.tile_grid.width && tile_y >= -1 && tile_y <= scene_place.tile_grid.height
        && (tile_x === -1 || tile_y === -1 || tile_x === scene_place.tile_grid.width || tile_y === scene_place.tile_grid.height);
      if (is_interior || is_border) {
        const is_selected = scene_place.id === selected_place.id;
        const prefer_selected_border = !!opts?.prefer_selected_border;
        const score = (is_interior ? 100 : 0)
          + (is_selected ? 10 : 0)
          + (prefer_selected_border && is_selected && is_border ? 200 : 0);
        if (!best || score > best.score) {
          best = { place: scene_place, tile_x, tile_y, scene_x, scene_y, offset, is_interior, is_border, score };
        }
      }
    }
    return best
      ? {
          place: best.place,
          tile_x: best.tile_x,
          tile_y: best.tile_y,
          scene_x: best.scene_x,
          scene_y: best.scene_y,
          offset: best.offset,
          is_interior: best.is_interior,
          is_border: best.is_border,
        }
      : null;
  }

  function detect_topology_face(place: Place, x: number, y: number, world_z: number): 'x+' | 'x-' | 'y+' | 'y-' | 'z+' | 'z-' | null {
    const bounds = get_place_region_bounds(place);
    const local_z = Math.floor(Number(world_z ?? bounds.origin.z ?? 0)) - (Math.floor(Number(bounds.origin.z ?? 0)) || 0);
    return select_place_resize_face(place, { x, y, z: local_z });
  }

  function get_entity_focus_tile(entity: any, place: Place, ref: string): { x: number; y: number; z: number } | null {
    try {
      const base_z = get_place_base_z(place);
      const focus = get_character_camera_focus_tile({ entity, entity_ref: ref, fallback_world_z: base_z });
      return { x: focus.x, y: focus.y, z: focus.z };
    } catch {
      return null;
    }
  }

  function get_primary_actor_focus_position(place: Place): { x: number; y: number } | null {
    const actor: any = get_controlled_place_actor(place);
    if (!actor) return null;
    const ref = String(actor?.actor_ref ?? '');
    const focus = get_entity_focus_tile(actor, place, ref);
    if (focus) return { x: focus.x, y: focus.y };
    const tp = actor?.tile_position;
    if (tp && typeof tp.x === 'number' && typeof tp.y === 'number') return { x: tp.x, y: tp.y };
    return null;
  }

  function is_topology_painter_tool(tool: string | null | undefined): boolean {
    return tool === 'place_create' || tool === 'place_delete' || tool === 'place_resize' || tool === 'region_tool';
  }

  function get_scene_connector_at(selected_place: Place, scene_x: number, scene_y: number, world_z: number): { place_id: string; connector: PlaceConnector } | null {
    return build_scene_place_cache(selected_place).connector_lookup.get(`${scene_x},${scene_y},${world_z}`) ?? null;
  }

  function update_painter_camera_target_from_view(place: Place): void {
    if (!config.set_camera_target_position) return;
    const { width, height } = inner_size();
    const center_x = Math.floor(view.offset_x + (width * view.scale) / 2);
    const center_y = Math.floor(view.offset_y + (height * view.scale) / 2);
    config.set_camera_target_position({ x: center_x, y: center_y }, 'free');
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

    // Multi-voxel aware: include any entity whose body model occupies this voxel.
    const out: (PlaceNPC | PlaceActor)[] = [];
    const all = [...(place.contents?.npcs_present ?? []), ...(place.contents?.actors_present ?? [])] as any[];
    for (const e of all) {
      const tp = e?.tile_position;
      if (!tp || typeof tp.x !== 'number' || typeof tp.y !== 'number') continue;
      const ez0 = get_entity_world_z(e, base_z);
      const def = get_body_model_def((e as any)?.body_model_id);
      const facing = get_facing(String((e as any)?.npc_ref ?? (e as any)?.actor_ref ?? ''));
      const voxels = eval_body_model_voxels(def, { mode: 'physical', facing });
      let occupies = false;
      for (const v of voxels) {
        const x = Math.floor(tp.x) + Math.floor(Number(v.dx ?? 0));
        const y = Math.floor(tp.y) + Math.floor(Number(v.dy ?? 0));
        const z = ez0 + Math.floor(Number(v.dz ?? 0));
        if (x === tile_x && y === tile_y && z === wz) {
          occupies = true;
          break;
        }
      }
      if (occupies) out.push(e);
    }
    return out;
  }

  function get_structures_at_world_z(
    tile_x: number,
    tile_y: number,
    place: Place,
    world_z: number,
  ): any[] {
    const base_z = get_place_base_z(place);
    const wz = Math.floor(Number(world_z));
    if (!Number.isFinite(wz)) return [];

    const out: any[] = [];
    for (const s of (place as any)?.structures ?? []) {
      const origin = (s as any)?.origin;
      const ox = Number(origin?.x);
      const oy = Number(origin?.y);
      const oz0 = Number(origin?.z);
      if (!Number.isFinite(ox) || !Number.isFinite(oy)) continue;
      const oz = Number.isFinite(oz0) ? Math.floor(oz0) : base_z;

      const phys = Array.isArray((s as any)?.body_model?.physical)
        ? (s as any).body_model.physical
        : [{ part: 'body', dx: 0, dy: 0, dz: 0 }];

      let occupies = false;
      for (const v of phys) {
        const x = Math.floor(ox) + Math.floor(Number((v as any)?.dx ?? 0));
        const y = Math.floor(oy) + Math.floor(Number((v as any)?.dy ?? 0));
        const z = oz + Math.floor(Number((v as any)?.dz ?? 0));
        if (x === tile_x && y === tile_y && z === wz) {
          occupies = true;
          break;
        }
      }
      if (occupies) out.push(s);
    }
    return out;
  }

  function get_entity_hit_at_world_z(
    tile_x: number,
    tile_y: number,
    place: Place,
    world_z: number,
  ): { entity: PlaceNPC | PlaceActor; part: string; voxel: { x: number; y: number; z: number } } | null {
    const base_z = get_place_base_z(place);
    const wz = Math.floor(Number(world_z));
    if (!Number.isFinite(wz)) return null;

    const entities = get_all_entities_at_world_z(tile_x, tile_y, place, wz);
    if (entities.length < 1) return null;

    const entity = entities[0]!;
    const tp = (entity as any)?.tile_position;
    if (!tp) return null;
    const ez0 = get_entity_world_z(entity as any, base_z);
    const def = get_body_model_def((entity as any)?.body_model_id);
    const ref = String((entity as any)?.npc_ref ?? (entity as any)?.actor_ref ?? '');
    const facing = get_facing(ref);
    const voxels = eval_body_model_voxels(def, { mode: 'physical', facing });
    let part = 'body';
    for (const v of voxels) {
      const x = Math.floor(tp.x) + Math.floor(Number(v.dx ?? 0));
      const y = Math.floor(tp.y) + Math.floor(Number(v.dy ?? 0));
      const z = ez0 + Math.floor(Number(v.dz ?? 0));
      if (x === tile_x && y === tile_y && z === wz) {
        part = String((v as any)?.part ?? 'body');
        break;
      }
    }
    return { entity, part, voxel: { x: tile_x, y: tile_y, z: wz } };
  }

  function get_focus_world_z_for_place(place: Place): number {
    const center_world_z = get_world_z_center_for_place(place);
    const visible_planes_z = get_defined_scene_world_zs(place);
    const focus_slot = config.get_focus_z ? config.get_focus_z() : DEFAULT_FOCUS_Z;
    return Math.floor(Number(visible_planes_z[focus_slot]));
  }

  function get_controlled_place_actor(place: Place | null | undefined): PlaceActor | null {
    if (!place) return null;
    const actor_ref = String(config.get_controlled_actor_ref?.() ?? '').trim();
    if (!actor_ref) return null;
    return Array.isArray(place.contents?.actors_present)
      ? (place.contents.actors_present.find((actor: any) => String(actor?.actor_ref ?? '') === actor_ref) ?? null)
      : null;
  }

  function get_player_actor_world_pos(place: Place): { x: number; y: number; z: number } | null {
    try {
      const base_z = get_place_base_z(place);
      const a: any = get_controlled_place_actor(place);
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

  function get_place_painter_entity_target(
    place: Place,
    tile_x: number,
    tile_y: number,
    world_z: number,
  ): { entity_ref: string; entity_type: 'npc' | 'actor' | 'item' | 'pile' | 'structure' } | null {
    const hit = get_entity_hit_at_world_z(tile_x, tile_y, place, world_z);
    const entity = hit?.entity ?? null;
    if (entity) {
      return {
        entity_ref: 'npc_ref' in entity ? (entity as PlaceNPC).npc_ref : (entity as PlaceActor).actor_ref,
        entity_type: 'npc_ref' in entity ? 'npc' : 'actor',
      };
    }

    const structs = get_structures_at_world_z(tile_x, tile_y, place, world_z);
    if (structs.length > 0) {
      const sid = String((structs[0] as any)?.id ?? '').trim();
      if (sid) {
        return {
          entity_ref: `structure.${sid}`,
          entity_type: 'structure',
        };
      }
    }

    const item_ids = get_items_on_ground_at_world_z(place, tile_x, tile_y, world_z);
    if (item_ids.length > 1) {
      return {
        entity_ref: `pile:${place.id}:${tile_x}_${tile_y}_${Math.floor(world_z)}`,
        entity_type: 'pile',
      };
    }
    if (item_ids.length === 1) {
      return {
        entity_ref: `item.${item_ids[0]}`,
        entity_type: 'item',
      };
    }

    return null;
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

  // Get actor walk speed from their data
  // Uses the unified movement engine's default if actor data unavailable
  function get_actor_walk_speed(actor_ref: string): number {
    try {
      const place = config.get_place();
      const actor: any = place?.contents?.actors_present?.find((a: any) => a.actor_ref === actor_ref) ?? null;
      const v = Number(actor?.movement?.walk);
      if (Number.isFinite(v)) return Math.floor(v);
    } catch {
      // ignore
    }
    return 0;
  }

  const input_state = {
    held_keys: new Set<string>(),
    held_order: [] as string[],
    wasd_next_breath: 0,
    space_down_ms: null as number | null,
    self_exclusion_logged: false,
    // Track last polled intent to detect changes
    last_polled_intent: null as { dx: number; dy: number } | null,
    // Timestamp of the last successful intent POST (for periodic resend while held)
    last_intent_sent_ms: 0,
  };

  async function post_intent_update(meta: {
    actor_ref: string;
    place_id: string;
    dx: number;
    dy: number;
    mode: MoveMode;
    reason: 'change' | 'resend' | 'release';
  }): Promise<void> {
    record_intent_post_started(meta);
    try {
      const response = await fetch('http://localhost:8787/api/movement/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_token: config.get_session_token?.() ?? undefined,
          entity_ref: meta.actor_ref,
          place_id: meta.place_id,
          dx: meta.dx,
          dy: meta.dy,
          mode: meta.mode,
          reason: meta.reason,
        }),
      });
      if (!response.ok) {
        record_intent_post_result(false, { status: response.status, error: `HTTP ${response.status}` });
        console.warn('[PlaceModule] intent POST non-2xx', response.status, meta.actor_ref);
        return;
      }
      record_intent_post_result(true, { status: response.status });
    } catch (err: any) {
      record_intent_post_result(false, { error: err?.message ?? String(err) });
      console.warn('[PlaceModule] intent POST failed', err?.message ?? String(err));
    }
  }

  async function trigger_actor_ascend(): Promise<void> {
    const place = config.get_place();
    if (!place) return;
    const actor = get_controlled_place_actor(place);
    if (!actor) return;
    try {
      const actor_id = String(actor.actor_ref).replace(/^actor\./, '');
      const response = await fetch('http://localhost:8787/api/actor/debug/ascend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actor_id,
          vz_delta: 3,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        debug_log_place('MOVE_UNIFY_TEST jump/ascend request failed', {
          actor_ref: actor.actor_ref,
          status: response.status,
          body: data,
        });
        return;
      }
      debug_log_place('MOVE_UNIFY_TEST jump/ascend request ok', {
        actor_ref: actor.actor_ref,
        vz_delta: data?.vz_delta ?? 3,
        velocity: data?.velocity ?? null,
      });
    } catch (err: any) {
      debug_log_place('MOVE_UNIFY_TEST jump/ascend request error', {
        actor_ref: actor.actor_ref,
        error: err?.message ?? String(err),
      });
    }
  }

  function dispatch_transition_intent(intent: MoveIntent, meta: MoveIntentChangeMeta): void {
    const place = config.get_place();
    if (!place) return;
    const actor = get_controlled_place_actor(place);
    if (!actor) return;
    const mode = get_move_mode();
    const now_ms = Date.now();
    const is_release = intent === null;
    const reason = is_release ? 'release' : 'change';
    const dx = intent?.dx ?? 0;
    const dy = intent?.dy ?? 0;

    record_intent_observed(intent, { mode, place_id: place.id, actor_ref: actor.actor_ref });
    input_state.last_polled_intent = intent ? { dx: intent.dx, dy: intent.dy } : null;
    if (!is_release) {
      input_state.last_intent_sent_ms = now_ms;
    } else {
      input_state.last_intent_sent_ms = 0;
    }

    debug_log_place('MOVE_VEL_TEST immediate input intent dispatch', {
      version: PLACE_MODULE_TIMING_VERSION,
      source: meta.source,
      action: meta.action,
      code: meta.code,
      actor_ref: actor.actor_ref,
      place_id: place.id,
      dx,
      dy,
      mode,
      reason,
    });

    void post_intent_update({
      actor_ref: actor.actor_ref,
      place_id: place.id,
      dx,
      dy,
      mode,
      reason,
    });
  }

  subscribe_move_intent_changes((intent, meta) => {
    dispatch_transition_intent(intent, meta);
  });

  function stat_to_bps(speed: number): number | null {
    const s = Math.floor(Number(speed));
    if (!Number.isFinite(s) || s <= 0) return null;
    if (s >= 8) return 1;
    return 9 - s;
  }

  function bps_to_tpm(bps: number): number {
    const breaths = Math.max(1, Math.floor(Number(bps) || 1));
    const mspt = breaths * 33;
    return 60000 / mspt;
  }

  function get_actor_walk_bps(actor_ref: string, mode: string): number | null {
    const base_stat = get_actor_walk_speed(actor_ref);
    const bps0 = stat_to_bps(base_stat);
    if (!bps0) return null;
    const mult = mode === 'SPRINT' ? 1.8 : mode === 'SNEAK' ? 0.6 : 1.0;
    return Math.max(1, Math.round(bps0 / mult));
  }

  function get_actor_walk_speed_tpm(actor_ref: string, mode: string): number {
    const bps = get_actor_walk_bps(actor_ref, mode);
    if (!bps) return 0;
    return bps_to_tpm(bps);
  }

  // Held input stepping now lives in MovementEngine as a realtime controller.

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
      const tp = a0?.tile_position;
      const z1 = Number(a0?.elevation);
      if (tp && typeof tp.x === 'number' && typeof tp.y === 'number' && Number.isFinite(z1)) {
        const anchor = compute_anchor_world_voxel({
          origin: { x: tp.x, y: tp.y, z: Math.floor(z1) },
          body_model_id: a0?.body_model_id,
          facing: get_facing(String(a0?.actor_ref ?? '')),
          mode: 'physical',
        });
        return Math.floor(anchor.z);
      }
      if (Number.isFinite(z1)) return Math.floor(z1);
    } catch {
      // ignore
    }
    return 0;
  }

  function get_world_animation_xy(place: Place, tile_x: number, tile_y: number): { x: number; y: number } {
    const region_origin = (place as any)?.region_bounds?.origin;
    const rx = Number(region_origin?.x);
    const ry = Number(region_origin?.y);
    if (Number.isFinite(rx) && Number.isFinite(ry)) {
      return {
        x: Math.floor(rx) + Math.floor(tile_x),
        y: Math.floor(ry) + Math.floor(tile_y),
      };
    }

    const world_tile = (place as any)?.coordinates?.world_tile;
    const wx = Number(world_tile?.x);
    const wy = Number(world_tile?.y);
    const width = Math.max(1, Math.floor(Number(place?.tile_grid?.width ?? 1)));
    const height = Math.max(1, Math.floor(Number(place?.tile_grid?.height ?? 1)));
    return {
      x: (Number.isFinite(wx) ? Math.floor(wx) * width : 0) + Math.floor(tile_x),
      y: (Number.isFinite(wy) ? Math.floor(wy) * height : 0) + Math.floor(tile_y),
    };
  }

  function get_defined_place_world_zs(place: Place | null): number[] {
    const base_z = get_place_base_z(place);
    const out = new Set<number>(get_authored_place_world_zs(place));

    for (const actor of place?.contents?.actors_present ?? []) {
      const wz0 = get_entity_world_z(actor as any, base_z);
      const def = get_body_model_def((actor as any)?.body_model_id);
      const voxels = eval_body_model_voxels(def, { mode: 'render', facing: get_facing((actor as any)?.actor_ref) });
      for (const v of voxels) out.add(wz0 + Math.floor(Number(v?.dz ?? 0)));
    }

    for (const npc of place?.contents?.npcs_present ?? []) {
      const wz0 = get_entity_world_z(npc as any, base_z);
      const def = get_body_model_def((npc as any)?.body_model_id);
      const voxels = eval_body_model_voxels(def, { mode: 'render', facing: get_facing((npc as any)?.npc_ref) });
      for (const v of voxels) out.add(wz0 + Math.floor(Number(v?.dz ?? 0)));
    }

    for (const s of (place as any)?.structures ?? []) {
      const oz = Math.floor(Number((s as any)?.origin?.z ?? base_z));
      const phys = Array.isArray((s as any)?.body_model?.physical)
        ? (s as any).body_model.physical
        : [{ dz: 0 }];
      for (const v of phys) out.add(oz + Math.floor(Number((v as any)?.dz ?? 0)));
    }

    if (out.size === 0) out.add(base_z);
    return Array.from(out).sort((a, b) => a - b);
  }

  function get_defined_scene_world_zs(selected_place: Place | null): number[] {
    if (!selected_place) return [get_place_base_z(selected_place)];
    return build_scene_place_cache(selected_place).scene_world_zs;
  }

  function slot_for_world_z(world_z: number, visible_planes_z: readonly number[]): number | null {
    const wz = Math.floor(Number(world_z));
    if (!Number.isFinite(wz)) return null;
    const index = visible_planes_z.findIndex((z) => Math.floor(z) === wz);
    return index >= 0 ? index : null;
  }

  function get_entity_world_z(entity: any, fallback_world_z: number): number {
    const z = Number(entity?.elevation);
    if (Number.isFinite(z)) return Math.floor(z);
    return fallback_world_z;
  }
  
  // Check for entity movement and spawn footsteps
  function check_entity_movement(place: Place) {
    const center_world_z = get_world_z_center_for_place(place);
    const visible_planes_z = get_defined_scene_world_zs(place);
    const now_ms = Date.now();
    const MOVEMENT_RECENT_WINDOW_MS = 280;

    // Check actors
    for (const actor of place.contents.actors_present) {
      const prev = previous_positions.get(actor.actor_ref);
      const az = get_entity_world_z(actor as any, center_world_z);
      const moved_this_frame = !!prev && (prev.x !== actor.tile_position.x || prev.y !== actor.tile_position.y || (prev.z ?? 0) !== az);
      if (moved_this_frame) {
        // Actor moved, spawn movement particle
        spawn_movement_particle(actor.tile_position);
        recent_movement_seen_at.set(actor.actor_ref, now_ms);

        // Server-authoritative movement: do not persist actor position from renderer.

        // Movement should create pressure broadcasts (footsteps)
        const n = (movement_sound_step.get(actor.actor_ref) ?? 0) + 1;
        movement_sound_step.set(actor.actor_ref, n);
        if (n % 3 === 1) {
          play_sfx('footstep_blip', { emitter_ref: actor.actor_ref, channel: 'sfx', cooldown_ms: footstep_cooldown_ms(300) });
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
      const last_move_seen_ms = recent_movement_seen_at.get(actor.actor_ref) ?? 0;
      const is_moving = moved_this_frame || ((now_ms - last_move_seen_ms) <= MOVEMENT_RECENT_WINDOW_MS);
      
      // Update stored state
      previous_positions.set(actor.actor_ref, { ...actor.tile_position, z: az });

      if (!is_moving) {
        movement_sound_step.delete(actor.actor_ref);
        recent_movement_seen_at.delete(actor.actor_ref);
      }
    }
    
    // Check NPCs
    for (const npc of place.contents.npcs_present) {
      const prev = previous_positions.get(npc.npc_ref);
      const nz = get_entity_world_z(npc as any, center_world_z);
      const moved_this_frame = !!prev && (prev.x !== npc.tile_position.x || prev.y !== npc.tile_position.y || (prev.z ?? 0) !== nz);
      if (moved_this_frame) {
        // NPC moved, spawn movement particle
        spawn_movement_particle(npc.tile_position);
        recent_movement_seen_at.set(npc.npc_ref, now_ms);

        // Movement sound for NPCs (assume WALK for now)
        const n = (movement_sound_step.get(npc.npc_ref) ?? 0) + 1;
        movement_sound_step.set(npc.npc_ref, n);
        if (n % 3 === 1) {
          play_sfx('footstep_blip', { emitter_ref: npc.npc_ref, channel: 'sfx', cooldown_ms: footstep_cooldown_ms(300) });
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
      const last_move_seen_ms = recent_movement_seen_at.get(npc.npc_ref) ?? 0;
      const is_moving = moved_this_frame || ((now_ms - last_move_seen_ms) <= MOVEMENT_RECENT_WINDOW_MS);
      
      // Update stored state
      previous_positions.set(npc.npc_ref, { ...npc.tile_position, z: nz });

      if (!is_moving) {
        movement_sound_step.delete(npc.npc_ref);
        recent_movement_seen_at.delete(npc.npc_ref);
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
      const place_breath_index = Math.floor(Number((place as any)?.breath_index ?? 0)) || 0;
      const timed_event_active = !!((place as any)?.timed_event_active);
      const timed_event_world_breath_index = Math.floor(Number((place as any)?.timed_event_world_breath_index ?? place_breath_index)) || 0;
      const breath_index = timed_event_active ? timed_event_world_breath_index : place_breath_index;
      const scene_places = get_scene_places(place);

       // 3-layer window of absolute world-z values.
       const center_world_z = get_world_z_center_for_place(place);
       const visible_planes_z = get_defined_scene_world_zs(place);
       const base_z = get_place_base_z(place);

      const open_containers = config.get_open_containers ? config.get_open_containers() : null;
      const is_tile_container_open = (tile_x: number, tile_y: number, world_z: number): boolean => {
        const id = `place.tile.${place.id}.${tile_x}_${tile_y}_${world_z}`;
        return Boolean(open_containers && open_containers.has(id));
      };

      // Render requests split by world-z target.
      const rq_ui: RenderRequest[] = [];
      const plane_count = Math.max(1, visible_planes_z.length);
      const rq_layers: RenderRequest[][] = Array.from({ length: plane_count }, () => []);

      const q_for_slot = (slot: number): RenderRequest[] => rq_layers[slot] ?? rq_layers[0]!;

      // Calculate visible tile range
      const visible_tile_start_x = view.offset_x;
      const visible_tile_start_y = view.offset_y;
      const visible_tile_end_x = view.offset_x + width * view.scale;
      const visible_tile_end_y = view.offset_y + height * view.scale;

      // Clear background
      canvas.fill_rect(inner, { char: " ", rgb: bg_rgb });

      // Spawn/update particles based on movement (used by later particle render pass).
      check_entity_movement(place);

      for (const scene_place of scene_places) {
        const scene_offset = get_scene_offset_tiles(place, scene_place);
        const scene_base_z = get_place_base_z(scene_place);

        for (const world_z of visible_planes_z) {
          const local_world_z = world_z - scene_offset.z;
          const slot = slot_for_world_z(world_z, visible_planes_z);
          if (slot === null) continue;
          const rq = q_for_slot(slot);

          for (let sy = inner.y0; sy <= inner.y1; sy++) {
            for (let sx = inner.x0; sx <= inner.x1; sx++) {
              const scene_tile_x = Math.floor(view.offset_x + (sx - inner.x0) * view.scale);
              const scene_tile_y = Math.floor(view.offset_y + (sy - inner.y0) * view.scale);
              const tile_x = scene_tile_x - scene_offset.x;
              const tile_y = scene_tile_y - scene_offset.y;

              const border_hit = get_scene_border_cell(place, scene_place, scene_tile_x, scene_tile_y, world_z);
              const connector_hit = get_scene_connector_at(place, scene_tile_x, scene_tile_y, world_z);
              const is_interior_voxel = tile_x >= 0 && tile_x < scene_place.tile_grid.width && tile_y >= 0 && tile_y < scene_place.tile_grid.height;
              const has_voxel_content = is_interior_voxel && voxel_has_render_content(scene_place, tile_x, tile_y, local_world_z);
              if ((connector_hit || border_hit) && !has_voxel_content) {
                rq.push({
                  pass: 'tile',
                  x: sx,
                  y: sy,
                  order: connector_hit ? 8 : -5,
                  key: `border:${scene_tile_x},${scene_tile_y},${world_z}`,
                  payload: make_simple_tile_payload({
                    id: `border:${scene_tile_x},${scene_tile_y},${world_z}`,
                    def_id: connector_hit ? 'place_connector' : 'place_border',
                    char: connector_hit ? '=' : '_',
                    tags: connector_hit ? [{ name: 'CONNECTOR', mag: 1 }] : [],
                    base_fg: connector_hit
                      ? get_color_by_name('off_white').rgb
                      : ((border_hit?.is_corner ?? false) ? get_color_by_name('light_orange').rgb : (border_hit?.is_edge ?? false) ? get_color_by_name('medium_gray').rgb : get_color_by_name('dark_gray').rgb),
                    weight_index: connector_hit ? 5 : 1,
                    render_shader: undefined,
                  }) as any,
                  ctx: ctx_place_tile({
                    screen_x: sx,
                    screen_y: sy,
                    place_x: tile_x,
                    place_y: tile_y,
                    world_x: scene_tile_x,
                    world_y: scene_tile_y,
                    world_z,
                    focus_world_z: center_world_z,
                    place_base_z: scene_base_z,
                    breath_index,
                  }),
                });
              }

              if (!is_interior_voxel) continue;
              const tile = get_place_tile_at_world_z(scene_place, tile_x, tile_y, local_world_z);
              if (!tile) continue;
              const open = scene_place.id === place.id ? is_tile_container_open(tile_x, tile_y, local_world_z) : false;
              const display = get_tile_display(tile, tile_x, tile_y);
              const has_connector_tag = tile_has_tag(tile, 'CONNECTOR');
              const has_container_tag = tile_has_tag(tile, 'CONTAINER');
              const world_xy = { x: scene_tile_x, y: scene_tile_y };
              const weight_index = local_world_z < scene_base_z ? 1 : 2;
              const key_prefix = has_connector_tag ? 'connector' : (local_world_z < scene_base_z ? 'tile_lower' : 'tile');
              rq.push({
                pass: 'tile',
                x: sx,
                y: sy,
                order: has_connector_tag ? 10 : 0,
                key: `${key_prefix}:${scene_place.id}:${world_z}:${tile_x},${tile_y}`,
                payload: make_simple_tile_payload({
                  id: `${key_prefix}:${scene_place.id}:${world_z}:${tile_x},${tile_y}`,
                  def_id: String(tile.kind ?? ''),
                  char: display.char,
                  tags: (tile as any).tags ?? [],
                  base_fg: hex_to_rgb(display.color),
                  weight_index: has_connector_tag ? 5 : weight_index,
                  render_shader: (tile as any).render_shader,
                }) as any,
                ctx: ctx_place_tile({
                  ui: { selected: open },
                  screen_x: sx,
                  screen_y: sy,
                  place_x: tile_x,
                  place_y: tile_y,
                  world_x: world_xy.x,
                  world_y: world_xy.y,
                  world_z,
                  focus_world_z: center_world_z,
                  place_base_z: scene_base_z,
                  breath_index,
                }),
              });

              if (has_container_tag && scene_place.id === place.id) {
                const container_glyphs = (tile as any).container_glyphs;
                let container_char = display.char;
                if (container_glyphs && typeof container_glyphs === 'object') {
                  container_char = open ? container_glyphs.open : container_glyphs.closed;
                }
                rq.push({
                  pass: 'tile',
                  x: sx,
                  y: sy,
                  order: 5,
                  key: `tile_container:${scene_place.id}:${world_z}:${tile_x},${tile_y}`,
                  payload: make_simple_tile_payload({
                    id: `tile_container:${scene_place.id}:${world_z}:${tile_x},${tile_y}`,
                    def_id: String(tile.kind ?? ''),
                    char: container_char,
                    tags: (tile as any).tags ?? [],
                    base_fg: hex_to_rgb(display.color),
                    weight_index: 4,
                    render_shader: (tile as any).render_shader,
                  }) as any,
                  ctx: ctx_place_tile({
                    ui: { selected: open },
                    screen_x: sx,
                    screen_y: sy,
                    place_x: tile_x,
                    place_y: tile_y,
                    world_x: world_xy.x,
                    world_y: world_xy.y,
                    world_z,
                    focus_world_z: center_world_z,
                    place_base_z: scene_base_z,
                    breath_index,
                  }),
                });
              }
            }
          }
        }
      }

    // Track occupied voxels by world layer slot (for correct item/entity overlap behavior).
    const character_occupied = new Set<string>(); // `${slot}:${tile_x}_${tile_y}`

    // Render explicit multi-voxel structures.
    {
      const structs: any[] = (place as any)?.structures ?? [];
      for (const s of structs) {
        const id = String((s as any)?.id ?? '');
        const def_id = String((s as any)?.def_id ?? '');
        if (!id || !def_id) continue;

        const origin = (s as any)?.origin;
        const ox = Number(origin?.x);
        const oy = Number(origin?.y);
        const oz0 = Number(origin?.z);
        if (!Number.isFinite(ox) || !Number.isFinite(oy)) continue;
        const oz = Number.isFinite(oz0) ? Math.floor(oz0) : base_z;

        const closed_char = (typeof (s as any)?.display_char === 'string' && (s as any).display_char.length > 0)
          ? String((s as any).display_char).charAt(0)
          : (def_id ? def_id.charAt(0) : '#');
        const display_color = (typeof (s as any)?.display_color === 'string' && (s as any).display_color.length > 0)
          ? String((s as any).display_color)
          : '#888888';

        const glyphs = (s as any)?.container_glyphs;
        const open_containers = config.get_open_containers ? config.get_open_containers() : null;

        const phys = Array.isArray((s as any)?.body_model?.physical)
          ? (s as any).body_model.physical
          : [{ part: 'body', dx: 0, dy: 0, dz: 0, tags: Array.isArray((s as any)?.tags) ? (s as any).tags : [] }];

        // Open state: if any occupied voxel's container id is open, highlight all voxels.
        let is_open = false;
        if (open_containers && open_containers.size > 0) {
          for (const v of phys) {
            const tile_x = Math.floor(ox) + Math.floor(Number((v as any)?.dx ?? 0));
            const tile_y = Math.floor(oy) + Math.floor(Number((v as any)?.dy ?? 0));
            const cid = `place.tile.${place.id}.${tile_x}_${tile_y}_${oz + Math.floor(Number((v as any)?.dz ?? 0))}`;
            if (open_containers.has(cid)) { is_open = true; break; }
          }
        }

        const display_char = (glyphs && typeof glyphs === 'object' && typeof glyphs.open === 'string' && typeof glyphs.closed === 'string')
          ? String(is_open ? glyphs.open : glyphs.closed).charAt(0)
          : closed_char;

        for (const v of phys) {
          const tile_x = Math.floor(ox) + Math.floor(Number((v as any)?.dx ?? 0));
          const tile_y = Math.floor(oy) + Math.floor(Number((v as any)?.dy ?? 0));
          const wz = oz + Math.floor(Number((v as any)?.dz ?? 0));

          const slot = slot_for_world_z(wz, visible_planes_z);
          if (slot === null) continue;

          const screen_x = inner.x0 + Math.floor((tile_x - view.offset_x) / view.scale);
          const screen_y = inner.y0 + Math.floor((tile_y - view.offset_y) / view.scale);
          if (!(screen_x >= inner.x0 && screen_x <= inner.x1 && screen_y >= inner.y0 && screen_y <= inner.y1)) continue;

          const tags = Array.isArray((v as any)?.tags)
            ? (v as any).tags
            : (Array.isArray((s as any)?.tags) ? (s as any).tags : []);
          const world_xy = get_world_animation_xy(place, tile_x, tile_y);
          q_for_slot(slot).push({
            pass: 'tile',
            x: screen_x,
            y: screen_y,
            order: 2,
            key: `structure:${id}:${tile_x},${tile_y},${wz}`,
            payload: make_simple_tile_payload({
              id: `structure:${place.id}:${id}:${String((v as any)?.part ?? 'body')}`,
              def_id: String(def_id),
              char: display_char,
              tags,
              base_fg: hex_to_rgb(display_color),
              weight_index: 3,
              render_shader: (s as any).render_shader,
            }) as any,
            ctx: {
              ...ctx_place_tile({
                ui: { selected: is_open },
                screen_x,
                screen_y,
                place_x: tile_x,
                place_y: tile_y,
                world_x: world_xy.x,
                world_y: world_xy.y,
                world_z: wz,
                focus_world_z: center_world_z,
                place_base_z: base_z,
                breath_index,
              }),
              body_part: String((v as any)?.part ?? 'body'),
              facing: (s as any)?.facing,
              world_z: wz,
            } as any,
          });

          if (Math.floor(Number((v as any)?.dz ?? 0)) === 1) {
            const k = `struct_top:${id}`;
            if (!multitile_devlog_once.has(k)) {
              multitile_devlog_once.add(k);
              debug_log_place(`MULTITILE_TEST PASS structure voxel at z+1 renders (id=${id} def=${def_id} wz=${wz})`);
            }
          }
        }
      }
    }

    // Walls/doors come from place.tiles; no extra border drawing here.

    // (Movement already checked above; avoid double-spawning.)
    
    // Update debug visuals for all visible scene characters.
    const blocks_los_at = (x: number, y: number, world_z: number): boolean => {
      return place_voxel_blocks_los(place as any, x, y, world_z);
    };
    for (const scene_place of scene_places) {
      const scene_offset = get_scene_offset_tiles(place, scene_place);
      const scene_base_z = get_place_base_z(scene_place);
      for (const npc of scene_place.contents.npcs_present) {
        const npc_position = {
          x: npc.tile_position.x + scene_offset.x,
          y: npc.tile_position.y + scene_offset.y,
          z: get_entity_world_z(npc as any, scene_base_z),
        };
        const npc_facing = get_facing(npc.npc_ref);
        const npc_visual_status = get_npc_visual_status(npc.npc_ref) ?? npc.status;
        const npc_conversation_visual = npc_visual_status === "busy";
        update_npc_debug_visuals(npc.npc_ref, npc_position, npc_facing, npc_conversation_visual, visible_planes_z, blocks_los_at, (npc as any).tags);
      }
      for (const actor of scene_place.contents.actors_present) {
        const actor_position = {
          x: actor.tile_position.x + scene_offset.x,
          y: actor.tile_position.y + scene_offset.y,
          z: get_entity_world_z(actor as any, scene_base_z),
        };
        const actor_facing = get_facing(actor.actor_ref);
        update_npc_debug_visuals(actor.actor_ref, actor_position, actor_facing, false, visible_planes_z, blocks_los_at, (actor as any).tags);
      }
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
        const wz = Number.isFinite(Number(p.world_z)) ? Math.floor(Number(p.world_z)) : DEFAULT_FOCUS_Z;
        const target_q = q_for_slot(wz);
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
      type EntityEntry = {
        scene_place: Place;
        scene_offset: { x: number; y: number; z: number };
        scene_base_z: number;
        entity: any;
        is_npc: boolean;
        ref: string;
        tile_x0: number;
        tile_y0: number;
        wz0: number;
        kind_id?: string;
        entity_render?: any;
      };
      const entries: EntityEntry[] = [];
      for (const scene_place of scene_places) {
        const scene_offset = get_scene_offset_tiles(place, scene_place);
        const scene_base_z = get_place_base_z(scene_place);
        for (const npc of scene_place.contents.npcs_present) {
          const ref = String((npc as any)?.npc_ref ?? '');
          if (!ref) continue;
          const tp = (npc as any)?.tile_position;
          if (!tp || typeof tp.x !== 'number' || typeof tp.y !== 'number') continue;
          entries.push({
            scene_place,
            scene_offset,
            scene_base_z,
            entity: npc as any,
            is_npc: true,
            ref,
            tile_x0: tp.x,
            tile_y0: tp.y,
            wz0: get_entity_world_z(npc as any, scene_base_z),
            kind_id: typeof (npc as any)?.kind_id === 'string' ? String((npc as any).kind_id) : undefined,
            entity_render: (npc as any)?.entity_render,
          });
        }
        for (const actor of scene_place.contents.actors_present) {
          const ref = String((actor as any)?.actor_ref ?? '');
          if (!ref) continue;
          const tp = (actor as any)?.tile_position;
          if (!tp || typeof tp.x !== 'number' || typeof tp.y !== 'number') continue;
          entries.push({
            scene_place,
            scene_offset,
            scene_base_z,
            entity: actor as any,
            is_npc: false,
            ref,
            tile_x0: tp.x,
            tile_y0: tp.y,
            wz0: get_entity_world_z(actor as any, scene_base_z),
            kind_id: typeof (actor as any)?.kind_id === 'string' ? String((actor as any).kind_id) : undefined,
            entity_render: (actor as any)?.entity_render,
          });
        }
      }

      // Coherent collision flashing for multi-voxel bodies:
      // choose one owner per anchor tile, then draw all its voxels.
      const by_anchor = new Map<string, EntityEntry[]>();
      for (const e of entries) {
        const k = `${Math.floor(e.tile_x0)},${Math.floor(e.tile_y0)},${Math.floor(e.wz0)}`;
        const arr = by_anchor.get(k);
        if (arr) arr.push(e);
        else by_anchor.set(k, [e]);
      }

      const chosen: EntityEntry[] = [];
      const now_ms = Date.now();
      for (const arr of by_anchor.values()) {
        if (!arr || arr.length === 0) continue;
        if (arr.length === 1) {
          chosen.push(arr[0]!);
          continue;
        }

        // Stable deterministic ordering.
        arr.sort((a, b) => {
          const pa = a.is_npc ? 1 : 0;
          const pb = b.is_npc ? 1 : 0;
          if (pa !== pb) return pa - pb;
          return a.ref.localeCompare(b.ref);
        });
        const idx = select_flash_index(now_ms, arr.length, 240);
        chosen.push(arr[idx]!);
      }

      const enqueue_entity = (ent: EntityEntry) => {
        const entity = ent.entity;
        const is_npc = ent.is_npc;
        const entityRef = ent.ref;
        const facing = get_facing(entityRef);
        const wz0 = ent.wz0;
        const tile_x0 = ent.tile_x0;
        const tile_y0 = ent.tile_y0;
        const scene_place = ent.scene_place;
        const scene_offset = ent.scene_offset;
        const scene_base_z = ent.scene_base_z;

        const name = typeof (entity as any)?.name === 'string' && String((entity as any).name).trim().length > 0
          ? String((entity as any).name).trim()
          : (is_npc ? "Unknown NPC" : "Unknown Actor");
        const defaultRgb = is_npc ? npc_rgb : actor_rgb;
        const cachedTags = entityTagCache.get(entityRef) ?? [];

        const def = get_body_model_def((entity as any)?.body_model_id);
        const voxels = eval_body_model_voxels(def, { mode: 'render', facing });

        for (const v of voxels) {
          const wz = wz0 + Math.floor(Number(v.dz ?? 0));
          const slot = slot_for_world_z(wz, visible_planes_z);
          if (slot === null) continue;

          const tile_x = tile_x0 + Math.floor(Number(v.dx ?? 0));
          const tile_y = tile_y0 + Math.floor(Number(v.dy ?? 0));
          const scene_tile_x = tile_x + scene_offset.x;
          const scene_tile_y = tile_y + scene_offset.y;

          const screen_x = inner.x0 + Math.floor((scene_tile_x - view.offset_x) / view.scale);
          const screen_y = inner.y0 + Math.floor((scene_tile_y - view.offset_y) / view.scale);
          if (!(screen_x >= inner.x0 && screen_x <= inner.x1 && screen_y >= inner.y0 && screen_y <= inner.y1)) continue;

          character_occupied.add(`${slot}:${scene_tile_x}_${scene_tile_y}`);

          q_for_slot(slot).push({
            pass: 'character',
            x: screen_x,
            y: screen_y,
            order: is_npc ? 1 : 0,
            key: entityRef,
            payload: make_entity_payload(is_npc ? 'npc' : 'actor', entityRef, name, cachedTags, {
              base_fg: defaultRgb,
              kind_id: ent.kind_id,
              entity_render: ent.entity_render,
              render_shader: ent.entity_render?.render_shader,
            }) as any,
            ctx: {
              ...ctx_place_tile({
                screen_x,
                screen_y,
                place_x: tile_x,
                place_y: tile_y,
                world_x: scene_tile_x,
                world_y: scene_tile_y,
                world_z: wz,
                focus_world_z: center_world_z,
                place_base_z: scene_base_z,
                breath_index,
              }),
              body_part: String(v.part ?? ''),
              facing,
              world_z: wz,
            } as any,
          });

          if (String(v.part ?? '') === 'head') {
            const k = `head_render:${entityRef}`;
            if (!multitile_devlog_once.has(k)) {
              multitile_devlog_once.add(k);
              debug_log_place(`MULTITILE_TEST PASS head voxel render present (entity=${entityRef} wz=${wz})`);
            }
          }
        }
      };

      for (const e of chosen) enqueue_entity(e);
    }

      // Draw items on ground (tabletop UX)
      // - Exactly 1 item on a tile: draw the item (qty-based glyph)
      // - 2+ items on a tile: draw a pile glyph (single interaction target)
      for (const scene_place of scene_places) {
        const scene_offset = get_scene_offset_tiles(place, scene_place);
        const scene_base_z = get_place_base_z(scene_place);
        let keys: string[] = [];
        let fallback_qty_by_key: Map<string, number> | null = null;
        const use_cache = scene_place.id === place.id && !!config.get_ground_item_position_keys && !!config.get_ground_item_ids_at;

        if (use_cache) {
          try {
            keys = config.get_ground_item_position_keys?.() ?? [];
          } catch {
            keys = [];
          }
        } else {
          const ground_by_tile = new Map<string, typeof scene_place.contents.items_on_ground>();
          fallback_qty_by_key = new Map();
          for (const it of scene_place.contents.items_on_ground) {
            const iz = (typeof (it as any)?.elevation === 'number' && Number.isFinite((it as any).elevation))
              ? Math.floor((it as any).elevation)
              : scene_base_z;
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

        if (keys.length > 0 && should_sample_place_debug(`grounditems:${scene_place.id}`, 60)) {
          debug_log_place(`[GroundItems] Rendering ${keys.length} ground tile(s) from ${scene_place.id}`);
        }
        for (const key of keys) {
          const [txs, tys, tzs] = key.split('_');
          const tile_x = parseInt(txs || '0', 10);
          const tile_y = parseInt(tys || '0', 10);
          const tile_z = parseInt(tzs || '', 10);
          const voxel_z = Number.isFinite(tile_z) ? Math.floor(tile_z) : scene_base_z;
          const scene_tile_x = tile_x + scene_offset.x;
          const scene_tile_y = tile_y + scene_offset.y;

          const screen_x = inner.x0 + Math.floor((scene_tile_x - view.offset_x) / view.scale);
          const screen_y = inner.y0 + Math.floor((scene_tile_y - view.offset_y) / view.scale);

          if (!(screen_x >= inner.x0 && screen_x <= inner.x1 && screen_y >= inner.y0 && screen_y <= inner.y1)) {
            continue;
          }

          const item_slot = slot_for_world_z(voxel_z, visible_planes_z);
          if (item_slot === null) continue;

          const ids_raw = use_cache
            ? (config.get_ground_item_ids_at?.(tile_x, tile_y) ?? [])
            : (scene_place.contents.items_on_ground ?? [])
                .filter((it: any) => {
                  const iz = (typeof it?.elevation === 'number' && Number.isFinite(it.elevation)) ? Math.floor(it.elevation) : scene_base_z;
                  return Math.floor(Number(it?.tile_position?.x ?? NaN)) === tile_x
                    && Math.floor(Number(it?.tile_position?.y ?? NaN)) === tile_y
                    && iz === voxel_z;
                })
                .map((it: any) => String(it?.id ?? ''))
                .filter((id: string) => id.length > 0);
          if (ids_raw.length < 1) continue;

          const item_ids: string[] = [];
          for (const id of ids_raw) {
            const meta: any = use_cache ? (config.get_ground_item_meta?.(id) ?? null) : null;
            const iz = (typeof meta?.elevation === 'number' && Number.isFinite(meta.elevation))
              ? Math.floor(meta.elevation)
              : voxel_z;
            if (iz === voxel_z) item_ids.push(id);
          }
          if (item_ids.length < 1) continue;

          if (character_occupied.has(`${item_slot}:${scene_tile_x}_${scene_tile_y}`)) continue;

          const open_containers = config.get_open_containers?.();
          const tile_hovered = Boolean(hovered && hovered.place_id === scene_place.id && hovered.x === tile_x && hovered.y === tile_y && Math.floor(Number(hovered.world_z ?? NaN)) === voxel_z);

          const pile_container_id = `place.pile.${scene_place.id}.${key}`;
          const pile_open = Boolean(open_containers && open_containers.has(pile_container_id));

          if (use_cache && item_ids.length === 1) {
            const meta: any = config.get_ground_item_meta?.(item_ids[0]!) ?? null;
            if (meta) {
              const item_container_id = `place.item.${scene_place.id}.${String(meta.id ?? item_ids[0])}`;
              const item_open = Boolean(open_containers && open_containers.has(item_container_id));
              q_for_slot(item_slot).push({
                pass: 'item',
                x: screen_x,
                y: screen_y,
                order: 0,
                key: item_container_id,
                payload: make_item_payload({
                  id: String(meta.id ?? item_ids[0]),
                  def_id: meta.def_id ? String(meta.def_id) : undefined,
                  qty: typeof meta.qty === 'number' ? meta.qty : 1,
                  display_char: typeof meta.display_char === 'string' ? meta.display_char : undefined,
                  tags: Array.isArray(meta.tags) ? meta.tags : [],
                } as unknown as ItemInstance, {
                  id: meta.def_id ? String(meta.def_id) : String(meta.id ?? item_ids[0]),
                  name: meta.name ? String(meta.name) : undefined,
                  display_char: typeof meta.display_char === 'string' ? meta.display_char : undefined,
                  tags: Array.isArray(meta.tags) ? meta.tags : [],
                } as ItemDefinition, {
                  base_fg: typeof meta.display_color === 'string' ? hex_to_rgb(meta.display_color) : undefined,
                }) as any,
                ctx: ctx_place_tile({
                  ui: { hovered: tile_hovered, selected: item_open },
                  screen_x,
                  screen_y,
                  place_x: tile_x,
                  place_y: tile_y,
                  world_x: scene_tile_x,
                  world_y: scene_tile_y,
                  world_z: voxel_z,
                  focus_world_z: center_world_z,
                  place_base_z: scene_base_z,
                  breath_index,
                }),
              });
              continue;
            }
          }

          if (use_cache && item_ids.length >= 2) {
            const meta0: any = config.get_ground_item_meta?.(item_ids[0]!) ?? null;
            if (meta0) {
              q_for_slot(item_slot).push({
                pass: 'item',
                x: screen_x,
                y: screen_y,
                order: 0,
                key: pile_container_id,
                payload: make_pile_payload({
                  id: `pile:${scene_place.id}:${key}`,
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
                ctx: ctx_place_tile({
                  ui: { hovered: tile_hovered, selected: pile_open },
                  screen_x,
                  screen_y,
                  place_x: tile_x,
                  place_y: tile_y,
                  world_x: scene_tile_x,
                  world_y: scene_tile_y,
                  world_z: voxel_z,
                  focus_world_z: center_world_z,
                  place_base_z: scene_base_z,
                  breath_index,
                }),
              });
              continue;
            }
          }

          const single_qty = item_ids.length === 1
            ? (use_cache && typeof (config.get_ground_item_meta?.(item_ids[0]!) as any)?.qty === 'number'
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
              `ground:${scene_place.id}:${key}`,
              item_ids.length,
              single_qty,
              undefined,
            ) as any,
            ctx: ctx_place_tile({
              ui: { hovered: tile_hovered, selected: pile_open },
              screen_x,
              screen_y,
              place_x: tile_x,
              place_y: tile_y,
              world_x: scene_tile_x,
              world_y: scene_tile_y,
              world_z: voxel_z,
              focus_world_z: center_world_z,
              place_base_z: scene_base_z,
              breath_index,
            }),
          });
        }
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
      const fz = config.get_focus_z ? config.get_focus_z() : DEFAULT_FOCUS_Z;
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
      const display_name = config.get_display_name_for_ref?.(targeted.ref) ?? 'Unknown Target';
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
      const display_name = config.get_display_name_for_ref?.(ref) ?? 'Unknown Target';
      const hover_text = `${display_name} - ${status}`;
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
      if (config.is_place_painter_active?.() && hovered) {
        const hovered_tile = hovered;
        const painter_tool = config.get_place_painter_tool?.() ?? 'paint';
        const hovered_place = get_scene_places(place).find((p) => p.id === hovered_tile.place_id) ?? place;
        const hover_world_z = Number.isFinite(Number((hovered_tile as any).world_z)) ? Math.floor(Number((hovered_tile as any).world_z)) : get_focus_world_z_for_place(place);
        const hovered_border_dir = detect_topology_face(hovered_place, hovered_tile.x, hovered_tile.y, hover_world_z);
        const topology_tool = painter_tool === 'place_create' || painter_tool === 'place_delete' || painter_tool === 'place_resize';

        if (topology_tool) {
          const is_selected_place = hovered_place.id === place.id;
          const hovered_bounds = get_place_region_bounds(hovered_place);
          const preview_size = { x: 3, y: 3, z: Math.max(1, Math.floor(Number(hovered_bounds.size?.z ?? 1)) || 1) };
          const preview_bounds = (painter_tool === 'place_create' && is_selected_place && hovered_border_dir)
            ? compute_adjacent_place_bounds(hovered_place, {
                x: Math.floor(hovered_tile.x),
                y: Math.floor(hovered_tile.y),
                z: hover_world_z - (Math.floor(Number(hovered_bounds.origin.z ?? 0)) || 0),
              }, hovered_border_dir, preview_size)
            : null;
          const create_conflict = preview_bounds
            ? scene_places.some((p) => p.id !== hovered_place.id && region_bounds_overlap(get_place_region_bounds(p), preview_bounds))
            : false;
          const selected_place_for_delete = scene_places.find((p) => p.id === place.id) ?? place;
          const delete_hit = painter_tool === 'place_delete'
            ? (() => {
                if (hovered_place.id === selected_place_for_delete.id) return null;
                return get_places_face_adjacency(selected_place_for_delete, hovered_place) ? hovered_place : null;
              })()
            : null;
          const resize_face = painter_tool === 'place_resize' && is_selected_place
            ? select_place_resize_face(hovered_place, {
                x: Math.floor(hovered_tile.x),
                y: Math.floor(hovered_tile.y),
                z: hover_world_z - (Math.floor(Number(hovered_bounds.origin.z ?? 0)) || 0),
              })
            : null;
          const resize_preview = config.get_place_painter_resize_preview?.() ?? null;
          const valid_create = painter_tool === 'place_create' && is_selected_place && !!hovered_border_dir && !create_conflict;
          const valid_delete = painter_tool === 'place_delete' && !!delete_hit;
          const valid_resize = painter_tool === 'place_resize' && is_selected_place && (!!resize_face || !!resize_preview) && !!(resize_preview?.valid ?? true);
          const is_valid = valid_create || valid_delete || valid_resize;
          const tint = is_valid ? get_color_by_name('vivid_green').rgb : get_color_by_name('vivid_red').rgb;
          const overlay_cells: Array<{ x: number; y: number; char: string }> = [];
          const selected_origin = get_place_region_origin(place);

          if (painter_tool === 'place_create' && preview_bounds) {
            for (let py = 0; py < preview_bounds.size.y; py += 1) {
              for (let px = 0; px < preview_bounds.size.x; px += 1) {
                const world_x = preview_bounds.origin.x + px;
                const world_y = preview_bounds.origin.y + py;
                const scene_x = world_x - selected_origin.x;
                const scene_y = world_y - selected_origin.y;
                const on_edge = px === 0 || py === 0 || px === (preview_bounds.size.x - 1) || py === (preview_bounds.size.y - 1);
                overlay_cells.push({ x: scene_x, y: scene_y, char: on_edge ? '_' : '.' });
              }
            }
          }

          if (painter_tool === 'place_resize') {
            const face = resize_preview?.face ?? resize_face;
            const bounds = resize_preview?.proposed_bounds ?? hovered_bounds;
            if (is_selected_place && face && bounds) {
              const min_x = bounds.origin.x;
              const min_y = bounds.origin.y;
              const max_x = bounds.origin.x + bounds.size.x - 1;
              const max_y = bounds.origin.y + bounds.size.y - 1;
              if (face === 'x-' || face === 'x+') {
                const world_x = face === 'x-' ? min_x : max_x;
                for (let world_y = min_y; world_y <= max_y; world_y += 1) overlay_cells.push({ x: world_x - selected_origin.x, y: world_y - selected_origin.y, char: '|' });
              } else if (face === 'y-' || face === 'y+') {
                const world_y = face === 'y-' ? min_y : max_y;
                for (let world_x = min_x; world_x <= max_x; world_x += 1) overlay_cells.push({ x: world_x - selected_origin.x, y: world_y - selected_origin.y, char: '_' });
              } else {
                for (let world_y = min_y; world_y <= max_y; world_y += 1) {
                  for (let world_x = min_x; world_x <= max_x; world_x += 1) {
                    overlay_cells.push({ x: world_x - selected_origin.x, y: world_y - selected_origin.y, char: '#' });
                  }
                }
              }
            }
          }

          if (painter_tool === 'place_delete' && delete_hit) {
            const delete_bounds = get_place_render_region_bounds(delete_hit);
            const focus_world_z = get_focus_world_z_for_place(place);
            const min_x = delete_bounds.origin.x;
            const min_y = delete_bounds.origin.y;
            const max_x = delete_bounds.origin.x + delete_bounds.size.x - 1;
            const max_y = delete_bounds.origin.y + delete_bounds.size.y - 1;
            const local_z = focus_world_z - delete_bounds.origin.z;
            const boundary_on_plane = local_z >= 0 && local_z < delete_bounds.size.z;
            if (boundary_on_plane) {
              for (let world_y = min_y; world_y <= max_y; world_y += 1) {
                for (let world_x = min_x; world_x <= max_x; world_x += 1) {
                  const info = get_local_volume_boundary_info(delete_bounds.size, {
                    x: world_x - delete_bounds.origin.x,
                    y: world_y - delete_bounds.origin.y,
                    z: local_z,
                  });
                  if (!info || !info.is_edge) continue;
                  overlay_cells.push({ x: world_x - selected_origin.x, y: world_y - selected_origin.y, char: info.is_corner ? '+' : '_' });
                }
              }
            }
          }

          if (overlay_cells.length < 1) {
            overlay_cells.push({ x: hovered_tile.x, y: hovered_tile.y, char: painter_tool === 'place_delete' ? 'x' : '_' });
          }

          for (const cell of overlay_cells) {
            const sx = inner.x0 + Math.floor((cell.x - view.offset_x) / view.scale);
            const sy = inner.y0 + Math.floor((cell.y - view.offset_y) / view.scale);
            if (sx < inner.x0 || sx > inner.x1 || sy < inner.y0 || sy > inner.y1) continue;
            rq_ui.push({
              pass: 'ui',
              x: sx,
              y: sy,
              order: 3,
              key: `painter_topology_preview:${painter_tool}:${hovered_tile.place_id ?? place.id}:${cell.x},${cell.y}`,
              cell: { char: cell.char, rgb: tint, style: 'regular', weight_index: is_valid ? 6 : 7, render_index: 6 },
            });
          }
        }

        if (scene_places.length > 1) {
      const selected_scene_place_id = config.get_scene_selected_place_id?.() ?? place.id;
      const actor_current_place_id = config.get_actor_current_place_id?.() ?? place.id;
      const selected_scene_place = scene_places.find((p) => p.id === selected_scene_place_id) ?? place;
      const actor_scene_place = scene_places.find((p) => p.id === actor_current_place_id) ?? selected_scene_place;
      const hint = `EDITING: ${selected_scene_place.name}`;
      let hint_x = inner.x0;
      const hint_y = Math.max(inner.y0, inner.y1 - 1);
      for (const ch of hint) {
        if (hint_x > inner.x1) break;
        rq_ui.push({
          pass: 'ui',
          x: hint_x,
          y: hint_y,
          order: 2,
          key: `ui:selected_place_hint:${hint_x}`,
          cell: { char: ch, rgb: get_color_by_name('vivid_cyan').rgb, style: 'regular', weight_index: 4, render_index: 6 },
        });
        hint_x += 1;
      }

      const actor_hint = `ACTOR: ${actor_scene_place.name}`;
      let actor_hint_x = inner.x0;
      const actor_hint_y = Math.max(inner.y0, inner.y1 - 2);
      for (const ch of actor_hint) {
        if (actor_hint_x > inner.x1) break;
        rq_ui.push({
          pass: 'ui',
          x: actor_hint_x,
          y: actor_hint_y,
          order: 2,
          key: `ui:actor_place_hint:${actor_hint_x}`,
          cell: { char: ch, rgb: get_color_by_name('vivid_green').rgb, style: 'regular', weight_index: 4, render_index: 6 },
        });
        actor_hint_x += 1;
      }
    }

        const move_preview = config.get_place_painter_move_preview?.() ?? null;
        if (move_preview && painter_tool === 'move' && move_preview.place_id === place.id) {
          const rgb = move_preview.valid ? get_color_by_name('vivid_green').rgb : get_color_by_name('vivid_red').rgb;
          if (move_preview.entity_type === 'npc' || move_preview.entity_type === 'actor') {
            const def = get_body_model_def(move_preview.body_model_id);
            const voxels = eval_body_model_voxels(def, { mode: 'render', facing: (move_preview.facing ?? null) as any });
            for (const v of voxels) {
              const wz = move_preview.target.z + Math.floor(Number((v as any)?.dz ?? 0));
              const slot = slot_for_world_z(wz, visible_planes_z);
              if (slot === null) continue;
              const sx = inner.x0 + Math.floor((move_preview.target.x + Math.floor(Number((v as any)?.dx ?? 0)) - view.offset_x) / view.scale);
              const sy = inner.y0 + Math.floor((move_preview.target.y + Math.floor(Number((v as any)?.dy ?? 0)) - view.offset_y) / view.scale);
              if (sx < inner.x0 || sx > inner.x1 || sy < inner.y0 || sy > inner.y1) continue;
              q_for_slot(slot).push({
                pass: 'character',
                x: sx,
                y: sy,
                order: move_preview.entity_type === 'npc' ? 1 : 0,
                key: `painter_move_preview:${move_preview.entity_ref}`,
                payload: make_entity_payload(move_preview.entity_type, move_preview.entity_ref, move_preview.name ?? move_preview.entity_ref, Array.isArray(move_preview.tags) ? move_preview.tags : [], {
                  base_fg: rgb,
                  kind_id: move_preview.kind_id,
                  entity_render: move_preview.entity_render,
                  render_shader: move_preview.entity_render?.render_shader,
                }) as any,
                ctx: ctx_place_tile({ selected: true }),
              });
            }
          } else {
            const slot = slot_for_world_z(move_preview.target.z, visible_planes_z);
            if (slot !== null) {
              const rq = q_for_slot(slot);
              const voxels = Array.isArray(move_preview.body_model?.physical) && move_preview.body_model!.physical!.length > 1
                ? move_preview.body_model!.physical!
                : [{ dx: 0, dy: 0, dz: 0 }];
              for (const v of voxels) {
                const sx = inner.x0 + Math.floor((move_preview.target.x + Math.floor(Number((v as any)?.dx ?? 0)) - view.offset_x) / view.scale);
                const sy = inner.y0 + Math.floor((move_preview.target.y + Math.floor(Number((v as any)?.dy ?? 0)) - view.offset_y) / view.scale);
                if (sx < inner.x0 || sx > inner.x1 || sy < inner.y0 || sy > inner.y1) continue;
                const payload = move_preview.entity_type === 'pile'
                  ? make_pile_payload({ id: `painter_move_preview:${move_preview.entity_ref}`, pile_count: 2, rep: { display_char: move_preview.display_char, name: move_preview.name }, base_fg: rgb }) as any
                  : move_preview.entity_type === 'item'
                    ? make_item_like_payload({ id: `painter_move_preview:${move_preview.entity_ref}`, name: move_preview.name, display_char: move_preview.display_char, tags: Array.isArray(move_preview.tags) ? move_preview.tags : [], base_fg: rgb }) as any
                    : make_simple_tile_payload({ id: `painter_move_preview:${move_preview.entity_ref}`, char: move_preview.display_char, tags: [], base_fg: rgb, weight_index: 6 }) as any;
                rq.push({
                  pass: 'tile',
                  x: sx,
                  y: sy,
                  order: 60,
                  key: `painter_move_preview:${move_preview.entity_ref}:${move_preview.target.x},${move_preview.target.y},${move_preview.target.z}:${(v as any)?.dx ?? 0},${(v as any)?.dy ?? 0},${(v as any)?.dz ?? 0}`,
                  payload,
                  ctx: ctx_place_tile({ selected: true }),
                });
              }
            }
          }
        }

        const shape_preview = config.get_place_painter_shape_preview?.() ?? [];
        if (shape_preview.length > 0) {
          const tint = get_color_by_name('vivid_yellow').rgb;
          for (const point of shape_preview) {
            const sx = inner.x0 + Math.floor((point.x - view.offset_x) / view.scale);
            const sy = inner.y0 + Math.floor((point.y - view.offset_y) / view.scale);
            if (sx < inner.x0 || sx > inner.x1 || sy < inner.y0 || sy > inner.y1) continue;
            rq_ui.push({
              pass: 'ui',
              x: sx,
              y: sy,
              order: 3,
              key: `painter_shape_preview:${point.x},${point.y}`,
              cell: { char: '#', rgb: tint, style: 'regular', weight_index: 6, render_index: 6 },
            });
          }
        }

        const preview = config.get_place_painter_preview?.() ?? null;
        if (preview && !topology_tool && painter_tool !== 'move') {
          const hover_world_z = Number.isFinite(Number(hovered_tile.world_z)) ? Math.floor(Number(hovered_tile.world_z)) : get_focus_world_z_for_place(place);
          const slot = slot_for_world_z(hover_world_z, visible_planes_z);
          if (slot !== null) {
            const rq = q_for_slot(slot);
            const voxels = Array.isArray(preview.body_model?.physical) && preview.body_model!.physical!.length > 1
              ? preview.body_model!.physical!
              : [{ dx: 0, dy: 0, dz: 0 }];
            for (const v of voxels) {
              const sx = inner.x0 + Math.floor((hovered_tile.x + Math.floor(Number((v as any)?.dx ?? 0)) - view.offset_x) / view.scale);
              const sy = inner.y0 + Math.floor((hovered_tile.y + Math.floor(Number((v as any)?.dy ?? 0)) - view.offset_y) / view.scale);
              if (sx < inner.x0 || sx > inner.x1 || sy < inner.y0 || sy > inner.y1) continue;
              rq.push({
                pass: 'tile',
                x: sx,
                y: sy,
                order: 50,
                key: `painter_preview:${preview.kind}:${preview.id}:${hovered_tile.x},${hovered_tile.y},${hover_world_z}:${(v as any)?.dx ?? 0},${(v as any)?.dy ?? 0}`,
                payload: make_simple_tile_payload({
                  id: `painter_preview:${preview.id}`,
                  char: preview.display_char,
                  tags: [],
                  base_fg: hex_to_rgb(preview.display_color),
                  weight_index: 5,
                }) as any,
                ctx: ctx_place_tile({ selected: true }),
              });
            }
          }
        }
      }
      draw_render_queue(canvas, rq_ui, { now_ms: Date.now(), pass_order: ['ui'], character_flash_period_ms: 240 });

    // World layers render into DOM canvases clipped to the place inner rect.
    const focus_z = config.get_focus_z ? config.get_focus_z() : DEFAULT_FOCUS_Z;

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
      if (!anchor_tile) anchor_tile = get_primary_actor_focus_position(place);
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
        grid_height: config.get_grid_height ? config.get_grid_height() : config.grid_height,
        rect: inner,
        base_font_size_px: config.base_font_size_px,
        ui_scale: dom_pan_px.scale,
      });

      if (!vp) return;
      dom_layers.set_viewport(vp);

      // z=0: floor is now emitted via rq_z0 (inside bounds only).
      // Reuse offscreen canvases across frames.
      if (dom_off_layers.length !== plane_count || dom_off_layers.some((layer) => !layer) || dom_off_w !== width || dom_off_h !== height) {
        dom_off_w = width;
        dom_off_h = height;
        dom_off_layers = Array.from({ length: plane_count }, () => create_canvas(width, height, { char: ' ', rgb: { r: 0, g: 0, b: 0 } }));
      } else {
        const full = { x0: 0, y0: 0, x1: width - 1, y1: height - 1 };
        for (const layer of dom_off_layers) layer?.fill_rect(full, { char: ' ', rgb: { r: 0, g: 0, b: 0 } });
      }

      let buffers_rebuilt = false;
      if (dom_cells_layers.length !== plane_count || dom_cells_layers.some((layer) => !layer) || dom_cells_w !== width || dom_cells_h !== height) {
        buffers_rebuilt = true;
        dom_cells_w = width;
        dom_cells_h = height;
        dom_cells_layers = Array.from({ length: plane_count }, () => ensure_grid_cell_buffer(width, height));
        dom_cells_versions = Array.from({ length: plane_count }, (_, idx) => dom_cells_versions[idx] ?? 1);
      }

      const wrap = (local: any) => ({
        set: (x: number, y: number, cell: Cell) => local.set(x - inner.x0, y - inner.y0, cell),
        get: (x: number, y: number) => local.get(x - inner.x0, y - inner.y0),
      });

      // Partition particles by world_z.
      // (Other passes are already split at enqueue time.)
      const changed_layers: boolean[] = [];
      for (let slot = 0; slot < plane_count; slot += 1) {
        const off = dom_off_layers[slot]!;
        draw_render_queue(wrap(off) as any, rq_layers[slot]!, { now_ms: Date.now(), pass_order: ['tile', 'item', 'character', 'particle'], character_flash_period_ms: 240 });
        const changed = sync_grid_cells_from_canvas(off, dom_cells_layers[slot]!);
        changed_layers.push(changed);
        if (changed) dom_cells_versions[slot] = (dom_cells_versions[slot] ?? 0) + 1;
      }

      // Only notify DOM layers when content changes (renderer still updates transforms every frame).
      // When buffers are (re)allocated, bind them to layers at least once.
      for (let slot = 0; slot < plane_count; slot += 1) {
        if (buffers_rebuilt || changed_layers[slot]) {
          dom_layers.set_layer_cells(slot, dom_cells_layers[slot]!, dom_cells_versions[slot]);
        }
      }
      dom_layers.render();

      dom_last_place_id = place.id;
    }
  }

  // Subscribe to tag change events via WebSocket (replaces broken EventEmitter)
  // WebSocket works across Electron process boundaries, EventEmitter doesn't
  const wsClient = initWebSocketClient();

  let place_breath_tick_applied_count = 0;
  let last_place_breath_tick_applied_ms = 0;
  let timed_event_breath_state_applied_count = 0;
  let last_timed_event_breath_state_ms = 0;
  let last_local_move_batch_applied_ms = 0;
  
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

  wsClient.on('TIMED_EVENT_BREATH_STATE', (msg: any) => {
    try {
      const place = config.get_place();
      if (!place) return;
      (place as any).timed_event_active = !!msg?.timed_event_active;
      (place as any).timed_event_phase = typeof msg?.timed_event_phase === 'string' ? msg.timed_event_phase : null;
      (place as any).timed_event_world_breath_index = (typeof msg?.timed_event_world_breath_index === 'number' && Number.isFinite(msg.timed_event_world_breath_index))
        ? Math.floor(msg.timed_event_world_breath_index)
        : undefined;
      (place as any).timed_event_turn_breaths_remaining = (typeof msg?.turn_breaths_remaining === 'number' && Number.isFinite(msg.turn_breaths_remaining))
        ? Math.floor(msg.turn_breaths_remaining)
        : null;
      timed_event_breath_state_applied_count++;
      const nowMs = Date.now();
      if (timed_event_breath_state_applied_count % 30 === 0) {
        console.log(
          '[TIMED_EVENT_BREATH] renderer applied state ' +
            JSON.stringify({
              timed_event_active: !!(place as any).timed_event_active,
              timed_event_phase: (place as any).timed_event_phase ?? null,
              timed_event_world_breath_index: (place as any).timed_event_world_breath_index ?? null,
              turn_breaths_remaining: (place as any).timed_event_turn_breaths_remaining ?? null,
              applied_count: timed_event_breath_state_applied_count,
              delta_ms: last_timed_event_breath_state_ms > 0 ? Math.max(0, nowMs - last_timed_event_breath_state_ms) : 0,
            })
        );
      }
      last_timed_event_breath_state_ms = nowMs;
    } catch {
      // ignore
    }
  });

  wsClient.on('PLACE_BREATH_TICK', (msg: any) => {
    try {
      const place = config.get_place();
      if (!place) return;
      const ticks: any[] = Array.isArray(msg?.ticks) ? msg.ticks : [];
      const hit = ticks.reduce((best: any, tick: any) => {
        if (String(tick?.place_id ?? '') !== String(place.id)) return best;
        if (!best) return tick;
        const bestIndex = Number(best?.breath_index);
        const tickIndex = Number(tick?.breath_index);
        if (!Number.isFinite(tickIndex)) return best;
        if (!Number.isFinite(bestIndex) || tickIndex >= bestIndex) return tick;
        return best;
      }, null as any);
      if (!hit) return;

      const bi = Number(hit?.breath_index);
      if (!Number.isFinite(bi)) return;
      (place as any).breath_index = Math.floor(bi);
      (place as any).breath_last_processed = Math.floor(bi);
      (place as any).breath_last_processed_ms = Date.now();
      record_place_breath_tick({
        place_id: place.id,
        breath_index: Math.floor(bi),
        sent_at_ms: Number(msg?.sent_at_ms),
      });

      place_breath_tick_applied_count++;
      const nowMs = Date.now();
      if (place_breath_tick_applied_count % 60 === 0) {
        // eslint-disable-next-line no-console
        console.log(
          '[MOVE_UNIFY_TEST] renderer applied PLACE_BREATH_TICK ' +
            JSON.stringify({
              place_id: place.id,
              breath_index: (place as any).breath_index,
              applied_count: place_breath_tick_applied_count,
              delta_ms: last_place_breath_tick_applied_ms > 0 ? Math.max(0, nowMs - last_place_breath_tick_applied_ms) : 0,
            })
        );
      }
      last_place_breath_tick_applied_ms = nowMs;
    } catch {
      // ignore
    }
  });

  // Server-authoritative movement updates (batched)
  wsClient.on('ENTITY_MOVED_BATCH', (msg: any) => {
    try {
      const place = config.get_place();
      if (!place) return;
      const scene_places = Array.isArray(config.get_scene_places?.()) ? (config.get_scene_places?.() ?? []) : [];
      const place_by_id = new Map<string, any>();
      for (const p of scene_places) {
        if (p && typeof p.id === 'string') place_by_id.set(String(p.id), p as any);
      }
      place_by_id.set(String(place.id), place as any);
      const updates: any[] = Array.isArray(msg?.updates) ? msg.updates : [];
      if (updates.length === 0) return;

      const seq_map: Map<string, number> = ((mod as any).__move_seq_by_ref ??= new Map());
      let localActorApplied = 0;
      let lastLocalActorStep: { actor_ref: string; x: number; y: number; z: number | null; seq: number | null } | null = null;
      let lastLocalActorElevationChange: { actor_ref: string; from_z: number | null; to_z: number | null; seq: number | null } | null = null;

      for (const u of updates) {
        const pid = String(u?.place_id ?? '');
        if (!pid) continue;
        const target_place: any = place_by_id.get(pid) ?? null;
        if (!target_place) continue;
        const ref = String(u?.entity_ref ?? '');
        if (!ref) continue;
        const x = Math.floor(Number(u?.x));
        const y = Math.floor(Number(u?.y));
        const z = (typeof u?.z === 'number' && Number.isFinite(u.z)) ? Math.floor(u.z) : undefined;
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

        if (ref.startsWith('actor.')) {
          for (const [other_place_id, other_place] of place_by_id.entries()) {
            if (other_place_id === pid || !other_place?.contents?.actors_present) continue;
            other_place.contents.actors_present = other_place.contents.actors_present.filter((a0: any) => a0.actor_ref !== ref);
          }
          const a: any = target_place.contents.actors_present.find((a0: any) => a0.actor_ref === ref);
          if (!a) {
            config.request_scene_place_refresh?.(pid);
            continue;
          }
          const prevZ = (typeof (a as any).elevation === 'number' && Number.isFinite((a as any).elevation))
            ? Math.floor((a as any).elevation)
            : null;
          const seq = (typeof u?.seq === 'number' && Number.isFinite(u.seq)) ? Math.floor(u.seq) : null;
          const last = seq_map.get(ref) ?? 0;
          if (seq !== null && seq < last) continue;
          if (seq !== null) {
            seq_map.set(ref, seq);
            (a as any).move_seq = seq;
          }
          a.tile_position = { x, y };
          if (typeof z === 'number') (a as any).elevation = z;
          set_npc_tracked_position(ref, { x, y });
          localActorApplied += 1;
          const nextZ = (typeof z === 'number') ? z : prevZ;
          if (prevZ !== nextZ) {
            lastLocalActorElevationChange = {
              actor_ref: ref,
              from_z: prevZ,
              to_z: nextZ,
              seq,
            };
          }
          lastLocalActorStep = {
            actor_ref: ref,
            x,
            y,
            z: typeof z === 'number' ? z : null,
            seq,
          };
          continue;
        }

        if (ref.startsWith('npc.')) {
          const n: any = target_place.contents.npcs_present.find((n0: any) => n0.npc_ref === ref);
          if (!n) continue;
          const seq = (typeof u?.seq === 'number' && Number.isFinite(u.seq)) ? Math.floor(u.seq) : null;
          const last = seq_map.get(ref) ?? 0;
          if (seq !== null && seq < last) continue;
          if (seq !== null) {
            seq_map.set(ref, seq);
            (n as any).move_seq = seq;
          }
          n.tile_position = { x, y };
          if (typeof z === 'number') (n as any).elevation = z;
          set_npc_tracked_position(ref, { x, y });
          continue;
        }
      }

      record_move_batch_received({
        place_id: place.id,
        total_updates: updates.length,
        local_actor_updates: localActorApplied,
        sent_at_ms: Number(msg?.sent_at_ms),
      });

      if (localActorApplied > 0) {
        if (lastLocalActorStep) {
          record_local_actor_step_applied({
            actor_ref: lastLocalActorStep.actor_ref,
            place_id: place.id,
            breath_index: Math.floor(Number((place as any)?.breath_index ?? 0)) || 0,
            x: lastLocalActorStep.x,
            y: lastLocalActorStep.y,
            z: lastLocalActorStep.z,
            seq: lastLocalActorStep.seq,
          });
        }
        if (lastLocalActorElevationChange) {
          console.log(
            '[MOVE_UNIFY_TEST] renderer applied local actor elevation change ' +
              JSON.stringify({
                place_id: place.id,
                actor_ref: lastLocalActorElevationChange.actor_ref,
                from_z: lastLocalActorElevationChange.from_z,
                to_z: lastLocalActorElevationChange.to_z,
                seq: lastLocalActorElevationChange.seq,
                breath_index: Math.floor(Number((place as any)?.breath_index ?? 0)) || 0,
              })
          );
        }
        const nowMs = Date.now();
        // eslint-disable-next-line no-console
        console.log(
          '[MOVE_VEL_TEST] renderer applied local move batch ' +
            JSON.stringify({
              place_id: place.id,
              local_actor_updates: localActorApplied,
              total_updates: updates.length,
              delta_ms: last_local_move_batch_applied_ms > 0 ? Math.max(0, nowMs - last_local_move_batch_applied_ms) : 0,
            })
        );
        last_local_move_batch_applied_ms = nowMs;
      }
    } catch {
      // ignore
    }
  });

  wsClient.on('PLACE_TILE_MOVED_BATCH', (msg: any) => {
    try {
      const place = config.get_place();
      if (!place) return;
      const updates: any[] = Array.isArray(msg?.updates) ? msg.updates : [];
      if (updates.length === 0) return;

      const scenePlaces = Array.isArray(config.get_scene_places?.()) ? (config.get_scene_places?.() ?? []) : [];
      const allKnownPlaces = new Map<string, Place>();
      allKnownPlaces.set(String(place.id), place);
      for (const scenePlace of scenePlaces) {
        if (!scenePlace?.id) continue;
        allKnownPlaces.set(String(scenePlace.id), scenePlace);
      }

      const getLayerKey = (placeRef: Place, z: number): string => {
        const baseZ = Math.floor(Number((placeRef as any)?.coordinates?.elevation ?? 0)) || 0;
        const offset = Math.floor(z - baseZ);
        return tile_offset_to_layer_key(offset);
      };
      const ensureLayer = (placeRef: Place, layerKey: string): any => {
        const placeAny: any = placeRef as any;
        if (!placeAny[layerKey]) {
          const width = Math.max(1, Math.floor(Number(placeRef.tile_grid?.width ?? 1)));
          const height = Math.max(1, Math.floor(Number(placeRef.tile_grid?.height ?? 1)));
          placeAny[layerKey] = {
            width,
            height,
            cells: Array.from({ length: height }, () => Array.from({ length: width }, () => null)),
          };
        }
        return placeAny[layerKey];
      };

      const readTile = (placeRef: Place, pos: { x: number; y: number; z: number }): any | null => {
        const layer = ensureLayer(placeRef, getLayerKey(placeRef, Math.floor(Number(pos.z) || 0)));
        const x = Math.floor(Number(pos.x));
        const y = Math.floor(Number(pos.y));
        if (!Array.isArray(layer?.cells?.[y])) return null;
        return layer.cells[y][x] ?? null;
      };

      const clearTile = (placeRef: Place, pos: { x: number; y: number; z: number }): any | null => {
        const layer = ensureLayer(placeRef, getLayerKey(placeRef, Math.floor(Number(pos.z) || 0)));
        const x = Math.floor(Number(pos.x));
        const y = Math.floor(Number(pos.y));
        if (!Array.isArray(layer?.cells?.[y])) return null;
        const tile = layer.cells[y][x] ?? null;
        if (!tile) return null;
        layer.cells[y][x] = null;
        return tile;
      };

      const writeTile = (placeRef: Place, pos: { x: number; y: number; z: number }, tile: any): boolean => {
        const layer = ensureLayer(placeRef, getLayerKey(placeRef, Math.floor(Number(pos.z) || 0)));
        const x = Math.floor(Number(pos.x));
        const y = Math.floor(Number(pos.y));
        if (!Array.isArray(layer?.cells?.[y])) return false;
        layer.cells[y][x] = tile;
        return true;
      };

      let applied = 0;
      let crossPlaceApplied = 0;
      let crossPlaceDeferred = 0;
      for (const u of updates) {
        const pid = String(u?.place_id ?? '');
        const fromPlaceId = String(u?.from_place_id ?? pid ?? '');
        const toPlaceId = String(u?.to_place_id ?? pid ?? '');
        const from = u?.from;
        const to = u?.to;
        if (!from || !to) continue;
        const samePlaceMove = fromPlaceId === toPlaceId;

        if (samePlaceMove) {
          const localPlace = allKnownPlaces.get(pid);
          if (!localPlace || pid !== String(place.id)) continue;
          const tile = clearTile(localPlace, from);
          if (!tile) continue;
          if (!writeTile(localPlace, to, tile)) {
            writeTile(localPlace, from, tile);
            continue;
          }
          applied += 1;
          continue;
        }

        const sourcePlace = allKnownPlaces.get(fromPlaceId);
        const targetPlace = allKnownPlaces.get(toPlaceId);
        const tile = sourcePlace ? clearTile(sourcePlace, from) : null;
        if (tile && targetPlace && writeTile(targetPlace, to, tile)) {
          applied += 1;
          crossPlaceApplied += 1;
          continue;
        }
        if (tile && sourcePlace) {
          void writeTile(sourcePlace, from, tile);
        }
        if (sourcePlace && String(place.id) === fromPlaceId) {
          const removed = clearTile(sourcePlace, from);
          if (removed) {
            applied += 1;
            crossPlaceDeferred += 1;
          }
        } else if (targetPlace && String(place.id) === toPlaceId) {
          const targetExisting = readTile(targetPlace, to);
          if (targetExisting) {
            applied += 1;
            crossPlaceDeferred += 1;
          }
        }
      }
      if (applied > 0) {
        console.log('[MOVE_UNIFY_TEST] renderer applied tile move batch ' + JSON.stringify({ place_id: place.id, applied, cross_place_applied: crossPlaceApplied, cross_place_deferred: crossPlaceDeferred }));
      }
    } catch {
      // ignore
    }
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
    get rect() { return rect; },
    set rect(next_rect: Rect) { rect = next_rect; },
    Focusable: true,

// Draw callback for PlaceModule - renders the place with all entities and effects
    Draw(canvas: Canvas): void {
      const place = config.get_place();

      const { width: view_w, height: view_h } = inner_size();
      const visible_w = view_w * view.scale;
      const visible_h = view_h * view.scale;
      const markers = place ? {
        left: view.offset_x > 0 ? '<' : undefined,
        right: view.offset_x + visible_w < place.tile_grid.width ? '>' : undefined,
        bottom: view.offset_y > 0 ? 'v' : undefined,
        top: view.offset_y + visible_h < place.tile_grid.height ? '^' : undefined,
      } : undefined;

      if (should_draw_module_chrome(gizmo_config, gizmo_state)) {
        draw_module_border(canvas, {
          rect,
          style: PANEL_BORDER_PRESETS.default_double.style,
          border_rgb,
          weight_index: PANEL_BORDER_PRESETS.default_double.weight_index,
          markers,
          header: {
            text: 'PLACE',
            reserve_left_cols: 2 + ((gizmo_config.enabled?.length ?? 0) * 2),
          },
        });
        draw_module_gizmos(canvas, rect, gizmo_config, gizmo_state);
      }

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
        const initial_target = config.get_camera_target_position?.() ?? get_primary_actor_focus_position(place) ?? config.get_actor_position?.() ?? null;
        const target = initial_target ?? place.tile_grid.default_entry;
        debug_log_place("First render, centering on", {
          target,
          using_actor: !!initial_target,
          default_entry: place.tile_grid.default_entry,
          place_size: { w: place.tile_grid.width, h: place.tile_grid.height }
        });
        center_on_scene_tile(target.x, target.y, place);
        camera.schedule_save(place);
      }

      const painter_active = !!config.is_place_painter_active?.();
      const camera_target_mode = config.get_camera_target_mode?.() ?? (painter_active ? 'free' : 'follow_actor');

      // Follow actor normally; in painter mode preserve free camera view.
      const camera_target = (config.get_camera_target_position?.() ?? get_primary_actor_focus_position(place) ?? config.get_actor_position?.() ?? null);
      if (camera_target && camera_target_mode !== 'free') {
        center_on_scene_tile(camera_target.x, camera_target.y, place);
      }

      // Poll input actions and update movement intent every frame.
      // This removes reliance on event timing for movement.
      const INTENT_RESEND_INTERVAL_MS = 750;
      const intent = get_move_intent();
      const actor = get_controlled_place_actor(place);
      if (actor && !painter_active) {
        const mode = get_move_mode();
        record_intent_observed(intent, { mode, place_id: place.id, actor_ref: actor.actor_ref });
        const has_movement = intent !== null;
        const last_intent = input_state.last_polled_intent;
        const intent_changed = has_movement && (
          !last_intent || 
          intent.dx !== last_intent.dx || 
          intent.dy !== last_intent.dy
        );
        const now_ms = Date.now();
        // Resend periodically while a direction is held (survives server restarts / silent failures).
        const intent_stale = has_movement && (now_ms - input_state.last_intent_sent_ms) >= INTENT_RESEND_INTERVAL_MS;

        if (has_movement && (intent_changed || intent_stale)) {
          const reason = intent_changed ? 'change' : 'resend';
          // Server-authoritative: send intent update to backend (held intent wins).
          void post_intent_update({
            actor_ref: actor.actor_ref,
            place_id: place.id,
            dx: intent.dx,
            dy: intent.dy,
            mode,
            reason,
          });
          input_state.last_intent_sent_ms = now_ms;
        } else if (!has_movement && last_intent) {
          // No movement intent - stop realtime movement
          try {
            const ae: any = (typeof document !== 'undefined') ? (document as any).activeElement : null;
            const payload = {
              actor_ref: actor.actor_ref,
              place_id: place.id,
              stop_reason: 'no_move_intent',
              last_intent,
              active_element: ae ? { tag: String(ae.tagName || ''), id: String(ae.id || ''), cls: String(ae.className || '') } : null,
            };
            debug_log_place('MOVE_UNIFY_TEST realtime stop requested', payload);
          } catch {
            // ignore
          }
          void post_intent_update({
            actor_ref: actor.actor_ref,
            place_id: place.id,
            dx: 0,
            dy: 0,
            mode,
            reason: 'release',
          });
          input_state.last_intent_sent_ms = 0;
        }

        // Track last intent
        input_state.last_polled_intent = intent ? { dx: intent.dx, dy: intent.dy } : null;
      }

      if (painter_active) {
        const intent = get_move_intent();
        if (intent) {
          const now_ms = Date.now();
          if (now_ms - last_painter_key_pan_ms >= 90) {
            last_painter_key_pan_ms = now_ms;
            view.offset_x += intent.dx;
            view.offset_y += intent.dy;
            camera.clamp_to_bounds(place, inner_w, inner_h);
            update_painter_camera_target_from_view(place);
            camera.schedule_save(place);
            debug_log_place('PLACE_PAINTER camera key pan', { dx: intent.dx, dy: intent.dy, offset_x: view.offset_x, offset_y: view.offset_y });
          }
        }
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

    OnGlobalPointerDown(e: PointerEvent): void {
      handle_global_pointer_down_for_gizmos(e, rect, gizmo_config, gizmo_state);
    },

    OnPointerMove(e: PointerEvent): void {
      update_gizmo_hover_state(e.x, e.y, rect, gizmo_config, gizmo_state);
      const place = config.get_place();
      if (!place) return;
      const painter_tool = config.get_place_painter_tool?.() ?? 'paint';
      const painter_preview = config.get_place_painter_preview?.() ?? null;
      const is_connector_paint = painter_tool === 'paint' && painter_preview?.kind === 'tile' && painter_preview?.id === 'place_connector';
      const allow_border_targets = is_topology_painter_tool(painter_tool) || is_connector_paint;

      // Update hover
      const scene_tile = screen_to_tile(e.x, e.y);
      const resolved = scene_tile ? resolve_scene_tile(place, scene_tile.x, scene_tile.y, { prefer_selected_border: allow_border_targets }) : null;
      if (resolved && (resolved.is_interior || (allow_border_targets && resolved.is_border))) {
        const focus_world_z = get_focus_world_z_for_place(place);
        const local_world_z = focus_world_z - resolved.offset.z;
        const hit = get_entity_hit_at_world_z(resolved.tile_x, resolved.tile_y, resolved.place, local_world_z);
        const entity = hit?.entity ?? null;
        hovered = { x: resolved.tile_x, y: resolved.tile_y, place_id: resolved.place.id, world_z: local_world_z, entity: entity ?? undefined };

      // Ground hover callback for highlighting (single item only)
      if (config.on_hover_ground_item) {
        const ids = resolved.place.id === place.id && config.get_ground_item_ids_at
          ? config.get_ground_item_ids_at(resolved.tile_x, resolved.tile_y)
          : get_items_on_ground_at_world_z(resolved.place, resolved.tile_x, resolved.tile_y, local_world_z);

        if (ids.length === 1) {
          config.on_hover_ground_item(resolved.tile_x, resolved.tile_y, ids[0]!);
        } else {
          config.on_hover_ground_item(resolved.tile_x, resolved.tile_y, null);
        }
      }
      } else {
        hovered = null;
        config.on_hover_ground_item?.(-1, -1, null);
      }

      if (config.is_place_painter_active?.()) {
        if (!e.buttons) {
          if (painter_shape_drag_active) {
            painter_shape_drag_active = false;
            void config.on_place_painter_shape_end?.();
          }
          if (painter_tool === 'place_resize') {
            const active_resize = config.get_place_painter_resize_preview?.() ?? null;
            if (active_resize) {
              const scene_tile = screen_to_tile(e.x, e.y);
              const resolved = scene_tile ? resolve_scene_tile(place, scene_tile.x, scene_tile.y, { prefer_selected_border: allow_border_targets }) : null;
              if (resolved && resolved.place.id === active_resize.place_id && (resolved.is_interior || (allow_border_targets && resolved.is_border))) {
                config.on_place_painter_resize_update?.({
                  place_id: resolved.place.id,
                  tile_position: { x: resolved.tile_x, y: resolved.tile_y },
                  world_z: get_focus_world_z_for_place(place),
                  region_position: {
                    x: Math.floor(Number(get_place_region_bounds(resolved.place).origin.x ?? 0)) + resolved.tile_x,
                    y: Math.floor(Number(get_place_region_bounds(resolved.place).origin.y ?? 0)) + resolved.tile_y,
                    z: get_focus_world_z_for_place(place),
                  },
                });
              }
            }
          }
          if (painter_move_drag_active) {
            painter_move_drag_active = false;
            config.on_place_painter_move_end?.();
          }
          last_painter_drag_key = null;
        } else {
          const scene_tile = screen_to_tile(e.x, e.y);
          const resolved = scene_tile ? resolve_scene_tile(place, scene_tile.x, scene_tile.y, { prefer_selected_border: allow_border_targets }) : null;
          if (resolved && (resolved.is_interior || (allow_border_targets && resolved.is_border))) {
            const focus_world_z = get_focus_world_z_for_place(place);
            const absolute_world_z = focus_world_z;
            const place_origin_z = Math.floor(Number(get_place_region_bounds(resolved.place).origin.z ?? 0)) || 0;
            if (painter_shape_drag_active) {
              config.on_place_painter_shape_update?.({
                place_id: resolved.place.id,
                tile_position: { x: resolved.tile_x, y: resolved.tile_y },
                world_z: absolute_world_z,
              });
              return;
            }
            if (painter_tool === 'move' && painter_move_drag_active) {
              config.on_place_painter_move_update?.({
                place_id: resolved.place.id,
                tile_position: { x: resolved.tile_x, y: resolved.tile_y },
                world_z: absolute_world_z,
              });
              return;
            }
            const active_resize = config.get_place_painter_resize_preview?.() ?? null;
            if (painter_tool === 'place_resize' && active_resize && active_resize.place_id === resolved.place.id) {
              const region_position = {
                x: Math.floor(Number(get_place_region_bounds(resolved.place).origin.x ?? 0)) + resolved.tile_x,
                y: Math.floor(Number(get_place_region_bounds(resolved.place).origin.y ?? 0)) + resolved.tile_y,
                z: absolute_world_z,
              };
              config.on_place_painter_resize_update?.({
                place_id: resolved.place.id,
                tile_position: { x: resolved.tile_x, y: resolved.tile_y },
                world_z: region_position.z,
                region_position,
              });
              return;
            }
            const button = (e.buttons & 2) !== 0 ? 2 : (e.buttons & 1) !== 0 ? 0 : null;
            if (button !== null) {
              const drag_key = `${button}:${resolved.place.id}:${resolved.tile_x}:${resolved.tile_y}:${absolute_world_z}`;
              if (drag_key !== last_painter_drag_key) {
                last_painter_drag_key = drag_key;
                const hit = get_entity_hit_at_world_z(resolved.tile_x, resolved.tile_y, resolved.place, absolute_world_z);
                const entity = hit?.entity ?? null;
                console.log('[PLACE_PAINTER] drag paint dispatch ' + JSON.stringify({
                  x: e.x,
                  y: e.y,
                  button,
                  place_id: resolved.place.id,
                  tile_x: resolved.tile_x,
                  tile_y: resolved.tile_y,
                  focus_world_z: absolute_world_z,
                }));
                void config.on_place_painter_primary_action?.({
                  place_id: resolved.place.id,
                  tile_position: { x: resolved.tile_x, y: resolved.tile_y },
                  world_z: absolute_world_z,
                  region_position: {
                    x: Math.floor(Number(get_place_region_bounds(resolved.place).origin.x ?? 0)) + resolved.tile_x,
                    y: Math.floor(Number(get_place_region_bounds(resolved.place).origin.y ?? 0)) + resolved.tile_y,
                    z: absolute_world_z,
                  },
                  button,
                  entity_ref: entity
                    ? ('npc_ref' in entity ? (entity as PlaceNPC).npc_ref : (entity as PlaceActor).actor_ref)
                    : undefined,
                  entity_type: entity
                    ? ('npc_ref' in entity ? 'npc' : 'actor')
                    : undefined,
                });
              }
            }
          }
        }
      }

      last_pointer_x = e.x;
      last_pointer_y = e.y;
    },

    OnPointerUp(e: PointerEvent): void {
      if (painter_shape_drag_active) {
        const place = config.get_place();
        if (place) {
          const painter_tool = config.get_place_painter_tool_for_button?.(e.button) ?? config.get_place_painter_tool?.() ?? 'paint';
          const painter_preview = config.get_place_painter_preview?.() ?? null;
          const is_connector_paint = painter_tool === 'paint' && painter_preview?.kind === 'tile' && painter_preview?.id === 'place_connector';
          const allow_border_targets = is_topology_painter_tool(painter_tool) || is_connector_paint;
          const scene_tile = screen_to_tile(e.x, e.y);
          const resolved = scene_tile ? resolve_scene_tile(place, scene_tile.x, scene_tile.y, { prefer_selected_border: allow_border_targets }) : null;
          if (resolved && (resolved.is_interior || (allow_border_targets && resolved.is_border))) {
            config.on_place_painter_shape_update?.({
              place_id: resolved.place.id,
              tile_position: { x: resolved.tile_x, y: resolved.tile_y },
              world_z: get_focus_world_z_for_place(place),
            });
          }
        }
        painter_shape_drag_active = false;
        void config.on_place_painter_shape_end?.();
      }
      if (painter_move_drag_active) {
        painter_move_drag_active = false;
        config.on_place_painter_move_end?.();
      }
      last_painter_drag_key = null;
    },

    OnDragStart(e: DragEvent): void {
      if (gizmo_state.is_move_mode || gizmo_state.is_resize_mode) {
        gizmo_state.move_start_x = e.start_x;
        gizmo_state.move_start_y = e.start_y;
        if (!gizmo_state.original_rect) gizmo_state.original_rect = { ...rect };
        return;
      }

      const place = config.get_place();
      if (!place) return;

      if (config.is_place_painter_active?.() && e.space && (e.buttons & 1) !== 0) {
        painter_pan_drag_active = true;
        painter_pan_start = { x: e.start_x, y: e.start_y };
        painter_pan_view_start = { x: view.offset_x, y: view.offset_y };
        debug_log_place('PLACE_PAINTER drag pan start', { start_x: e.start_x, start_y: e.start_y, offset_x: view.offset_x, offset_y: view.offset_y });
        return;
      }

      // Don't start a ground drag if a UI drag is active.
      if (config.is_dragging?.()) return;

      const tile = screen_to_tile(e.start_x, e.start_y);
      if (!tile) return;
      const resolved = resolve_scene_tile(place, tile.x, tile.y);
      if (!resolved || !resolved.is_interior || resolved.place.id !== place.id) return;

      const focus_world_z = get_focus_world_z_for_place(place);

      // Range check (touch): 3D touch range (within 1 tile XY and 1 level Z).
      const actor_wp = get_player_actor_world_pos(place);
      if (actor_wp) {
        const tgt = { x: resolved.tile_x, y: resolved.tile_y, z: focus_world_z };
        if (!is_within_range_xy_z(actor_wp, tgt, 1.5, 1)) return;
      }

      const items_on_ground = get_items_on_ground_at_world_z(place, resolved.tile_x, resolved.tile_y, focus_world_z);

      // Allow direct dragging when at least one item exists.
      // Single item = drag that item; 2+ items = drag the whole pile (sweep).
      if ((items_on_ground as any[]).length < 1) return;

      config.on_drag_start_ground_item?.(resolved.tile_x, resolved.tile_y);
    },

    OnDragMove(e): void {
      if (gizmo_state.is_move_mode && gizmo_state.original_rect) {
        const next_rect = handle_move_drag(e.x, e.y, gizmo_state, gizmo_state.original_rect, config.on_move);
        if (next_rect) rect = next_rect;
        return;
      }

      if (gizmo_state.is_resize_mode && gizmo_state.is_dragging_resize && gizmo_state.original_rect) {
        const next_rect = handle_resize_drag(
          e.x,
          e.y,
          gizmo_state,
          gizmo_state.original_rect,
          12,
          8,
          Number.MAX_SAFE_INTEGER,
          Number.MAX_SAFE_INTEGER,
          config.on_resize,
        );
        if (next_rect) rect = next_rect;
        return;
      }

      const place = config.get_place();
      if (!place) return;
      if (config.is_place_painter_active?.() && painter_pan_drag_active) {
        view.offset_x = painter_pan_view_start.x - e.dx * view.scale;
        view.offset_y = painter_pan_view_start.y - e.dy * view.scale;
        const { width, height } = inner_size();
        camera.clamp_to_bounds(place, width, height);
        update_painter_camera_target_from_view(place);
        camera.schedule_save(place);
        return;
      }
      void e;
    },

    OnDragEnd(e: DragEvent): void {
      if (gizmo_state.is_resize_mode && gizmo_state.is_dragging_resize) {
        config.on_resize_end?.(rect);
        gizmo_state.is_dragging_resize = false;
        gizmo_state.original_rect = null;
        return;
      }
      if (gizmo_state.is_move_mode) {
        config.on_move_end?.(rect);
        gizmo_state.original_rect = null;
        return;
      }

      debug_log_place(`[OnDragEnd] ========== DRAG END ==========`);
      debug_log_place(`[OnDragEnd] Called at screen position (${e.x}, ${e.y})`);
      debug_log_place(`[OnDragEnd] config.is_dragging exists: ${!!config.is_dragging}`);
      debug_log_place(`[OnDragEnd] config.on_drop exists: ${!!config.on_drop}`);
      debug_log_place(`[OnDragEnd] config.get_drag_source exists: ${!!config.get_drag_source}`);

      const place = config.get_place();
      if (config.is_place_painter_active?.() && painter_pan_drag_active) {
        painter_pan_drag_active = false;
        if (place) {
          update_painter_camera_target_from_view(place);
          debug_log_place(`[PLACE_PAINTER] drag pan end ${JSON.stringify({ offset_x: view.offset_x, offset_y: view.offset_y })}`);
        }
        return;
      }
      if (config.is_place_painter_active?.() && painter_move_drag_active) {
        debug_log_place(`[PLACE_PAINTER] suppressing generic OnDragEnd during move drag`);
        return;
      }
      
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

      if (!place) {
        debug_log_place(`[OnDragEnd] No place loaded - ignoring`);
        return;
      }
      debug_log_place(`[OnDragEnd] Place: ${place.id}`);

      // Use screen_to_tile like OnClick does for consistent coordinate calculation
      const tile = screen_to_tile(e.x, e.y);
      const resolved = tile ? resolve_scene_tile(place, tile.x, tile.y) : null;
      debug_log_place(`[OnDragEnd] screen_to_tile(${e.x}, ${e.y}) returned: ${tile ? `(${tile.x}, ${tile.y})` : 'null'}`);
      
      if (!resolved || !resolved.is_interior || resolved.place.id !== place.id) {
        debug_log_place(`[OnDragEnd] Drop outside visible area - ignoring`);
        return;
      }

      const tile_x = resolved.tile_x;
      const tile_y = resolved.tile_y;

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

    OnPointerDown(e: PointerEvent): void {
      update_gizmo_hover_state(e.x, e.y, rect, gizmo_config, gizmo_state);
      if (is_in_gizmo_area(e.x, e.y, rect, gizmo_config)) {
        const gizmo = handle_gizmo_click(e.x, e.y, rect, gizmo_config, gizmo_state);
        if (gizmo === 'move' || gizmo === 'resize') {
          gizmo_state.move_start_x = e.x;
          gizmo_state.move_start_y = e.y;
          gizmo_state.original_rect = { ...rect };
        }
        return;
      }

      if (gizmo_state.is_resize_mode) {
        const edge = get_resize_edge(e.x, e.y, rect);
        if (edge) {
          gizmo_state.resize_edge = edge;
          gizmo_state.is_dragging_resize = true;
          gizmo_state.move_start_x = e.x;
          gizmo_state.move_start_y = e.y;
          gizmo_state.original_rect = { ...rect };
          return;
        }
      }

      if (gizmo_state.is_move_mode) {
        gizmo_state.move_start_x = e.x;
        gizmo_state.move_start_y = e.y;
        if (!gizmo_state.original_rect) gizmo_state.original_rect = { ...rect };
        return;
      }

      const place = config.get_place();
      if (!place) return;
      const painter_active = !!config.is_place_painter_active?.();
      if (!painter_active) return;
      last_painter_drag_key = null;
      const painter_tool = config.get_place_painter_tool_for_button?.(e.button) ?? config.get_place_painter_tool?.() ?? 'paint';
      const painter_preview = config.get_place_painter_preview?.() ?? null;
      const is_connector_paint = painter_tool === 'paint' && painter_preview?.kind === 'tile' && painter_preview?.id === 'place_connector';
      const allow_border_targets = is_topology_painter_tool(painter_tool) || is_connector_paint;

      const focus_z = config.get_focus_z ? config.get_focus_z() : DEFAULT_FOCUS_Z;
      const center_world_z = get_world_z_center_for_place(place);
      const visible_planes_z = get_defined_scene_world_zs(place);
      const focus_world_z = Math.floor(visible_planes_z[Math.max(0, Math.min(visible_planes_z.length - 1, focus_z))] ?? center_world_z);
      const scene_tile = screen_to_tile(e.x, e.y);
      const resolved = scene_tile ? resolve_scene_tile(place, scene_tile.x, scene_tile.y, { prefer_selected_border: allow_border_targets }) : null;
      if (!resolved || (!resolved.is_interior && !(allow_border_targets && resolved.is_border))) return;
      const absolute_world_z = focus_world_z;
      const place_origin_z = Math.floor(Number(get_place_region_bounds(resolved.place).origin.z ?? 0)) || 0;
      const place_local_z = absolute_world_z - place_origin_z;

      console.log('[PLACE_PAINTER] pointer down dispatch ' + JSON.stringify({
        x: e.x,
        y: e.y,
        button: e.button,
        place_id: resolved.place.id,
        tile_x: resolved.tile_x,
        tile_y: resolved.tile_y,
        focus_world_z: absolute_world_z,
      }));

      const painter_target = get_place_painter_entity_target(resolved.place, resolved.tile_x, resolved.tile_y, absolute_world_z);
      const region_position = {
        x: Math.floor(Number(get_place_region_bounds(resolved.place).origin.x ?? 0)) + resolved.tile_x,
        y: Math.floor(Number(get_place_region_bounds(resolved.place).origin.y ?? 0)) + resolved.tile_y,
        z: absolute_world_z,
      };
      if (is_shape_painter_tool(painter_tool)) {
        painter_shape_drag_active = true;
        config.on_place_painter_shape_start?.({
          place_id: resolved.place.id,
          tile_position: { x: resolved.tile_x, y: resolved.tile_y },
          world_z: absolute_world_z,
          button: e.button,
        });
        return;
      }
      if (painter_tool === 'move') {
        const selected_place_id = config.get_scene_selected_place_id?.() ?? place.id;
        if (resolved.place.id !== selected_place_id || !painter_target) {
          void config.on_place_painter_primary_action?.({
            place_id: resolved.place.id,
            tile_position: { x: resolved.tile_x, y: resolved.tile_y },
            world_z: absolute_world_z,
            region_position,
            button: e.button,
            entity_ref: painter_target?.entity_ref,
            entity_type: painter_target?.entity_type,
          });
          return;
        }
        painter_move_drag_active = true;
        config.on_place_painter_move_start?.({
          place_id: resolved.place.id,
          tile_position: { x: resolved.tile_x, y: resolved.tile_y },
          world_z: absolute_world_z,
          entity_ref: painter_target.entity_ref,
          entity_type: painter_target.entity_type,
        });
        return;
      }
      if (painter_tool === 'place_resize') {
        const selected_place_id = config.get_scene_selected_place_id?.() ?? place.id;
        const active_resize = config.get_place_painter_resize_preview?.() ?? null;
        if (active_resize && active_resize.place_id === selected_place_id && resolved.place.id === selected_place_id) {
          config.on_place_painter_resize_update?.({
            place_id: resolved.place.id,
            tile_position: { x: resolved.tile_x, y: resolved.tile_y },
            world_z: absolute_world_z,
            region_position,
          });
          config.on_place_painter_resize_end?.();
          return;
        }
        const resize_face = select_place_resize_face(resolved.place, { x: resolved.tile_x, y: resolved.tile_y, z: place_local_z });
        if (resolved.place.id !== selected_place_id || !resize_face) {
          void config.on_place_painter_primary_action?.({
            place_id: resolved.place.id,
            tile_position: { x: resolved.tile_x, y: resolved.tile_y },
            world_z: absolute_world_z,
            region_position,
            button: e.button,
            entity_ref: painter_target?.entity_ref,
            entity_type: painter_target?.entity_type,
          });
          return;
        }
        config.on_place_painter_resize_start?.({
          place_id: resolved.place.id,
          tile_position: { x: resolved.tile_x, y: resolved.tile_y },
          world_z: absolute_world_z,
          region_position,
        });
        return;
      }
      void config.on_place_painter_primary_action?.({
        place_id: resolved.place.id,
        tile_position: { x: resolved.tile_x, y: resolved.tile_y },
        world_z: absolute_world_z,
        region_position,
        button: e.button,
        entity_ref: painter_target?.entity_ref,
        entity_type: painter_target?.entity_type,
      });
    },

    OnClick(e: PointerEvent): void {
      const place = config.get_place();
      if (!place) return;

      const painter_active = !!config.is_place_painter_active?.();
      if (painter_active) {
        console.log('[PLACE_PAINTER] click ignored because pointer-down already handles painter action ' + JSON.stringify({ button: e.button, x: e.x, y: e.y }));
        return;
      }
      if (!painter_active && e.button !== 0) {
        console.log('[PLACE_PAINTER] place click ignored ' + JSON.stringify({ painter_active, button: e.button, reason: 'non_left_click_game_mode' }));
        return;
      }

      const focus_z = config.get_focus_z ? config.get_focus_z() : DEFAULT_FOCUS_Z;
      const center_world_z = get_world_z_center_for_place(place);
      const visible_planes_z = get_defined_scene_world_zs(place);
      const base_z = get_place_base_z(place);
      const focus_world_z = Math.floor(visible_planes_z[Math.max(0, Math.min(visible_planes_z.length - 1, focus_z))] ?? center_world_z);

      // Convert screen to tile coordinates
      const scene_tile = screen_to_tile(e.x, e.y);
      const resolved = scene_tile ? resolve_scene_tile(place, scene_tile.x, scene_tile.y) : null;
      if (!resolved || !resolved.is_interior) return;

      const active_place = resolved.place;
      const active_tile = { x: resolved.tile_x, y: resolved.tile_y };
      const local_focus_world_z = focus_world_z - resolved.offset.z;

      console.log('[PLACE_PAINTER] place click ' + JSON.stringify({ painter_active, x: e.x, y: e.y, button: e.button, place_id: active_place.id, tile_x: active_tile.x, tile_y: active_tile.y, focus_world_z: local_focus_world_z }));

      if (painter_active) {
        const hit = get_entity_hit_at_world_z(active_tile.x, active_tile.y, active_place, local_focus_world_z);
        const entity = hit?.entity ?? null;
        console.log('[PLACE_PAINTER] primary action dispatch ' + JSON.stringify({
          place_id: active_place.id,
          tile_x: active_tile.x,
          tile_y: active_tile.y,
          world_z: local_focus_world_z,
          button: e.button,
          entity_ref: entity
            ? ('npc_ref' in entity ? (entity as PlaceNPC).npc_ref : (entity as PlaceActor).actor_ref)
            : null,
        }));
        void config.on_place_painter_primary_action?.({
          place_id: active_place.id,
          tile_position: { x: active_tile.x, y: active_tile.y },
          world_z: local_focus_world_z,
          region_position: {
            x: Math.floor(Number(get_place_region_bounds(active_place).origin.x ?? 0)) + active_tile.x,
            y: Math.floor(Number(get_place_region_bounds(active_place).origin.y ?? 0)) + active_tile.y,
            z: Math.floor(Number(get_place_region_bounds(active_place).origin.z ?? 0)) + local_focus_world_z,
          },
          button: e.button,
          entity_ref: entity
            ? ('npc_ref' in entity ? (entity as PlaceNPC).npc_ref : (entity as PlaceActor).actor_ref)
            : undefined,
          entity_type: entity
            ? ('npc_ref' in entity ? 'npc' : 'actor')
            : undefined,
        });
        return;
      }

      // Focus gating: clicks/targets resolve only within the focused world layer.

      // PRIORITY 1: Handle double-click on ground items (structure plane)
      if (e.click_count === 2 && config.on_double_click_ground) {
        const item_ids = get_items_on_ground_at_world_z(active_place, active_tile.x, active_tile.y, local_focus_world_z);
        
        if (item_ids.length > 0) {
           // Grab/open range: 3D touch range (within 1 tile XY and 1 level Z).
           const actor_wp = get_player_actor_world_pos(place);
           if (actor_wp) {
             const tgt = { x: active_tile.x, y: active_tile.y, z: local_focus_world_z };
             if (!is_within_range_xy_z(actor_wp, tgt, 1.5, 1)) {
              debug_log_place(`Double-click on ground items rejected: out of touch range (actor=(${actor_wp.x},${actor_wp.y},${actor_wp.z}) tile=(${active_tile.x},${active_tile.y},${local_focus_world_z}))`);
              return;
             }
            debug_log_place(`Double-click on ground items at (${active_tile.x},${active_tile.y}), count: ${item_ids.length} (wz=${local_focus_world_z})`);
            if (active_place.id === place.id) config.on_double_click_ground(active_tile.x, active_tile.y);
          }
          return;
        }
      }

      // PRIORITY 1.5: Double-click tile container (structure plane)
      // defs+deltas migration: do not rely on legacy stored tile.tags to decide container-ness.
      // Use structural markers (contents/capacity/glyph hints) and let the backend validate.
      if (e.click_count === 2 && config.on_open_tile_container) {
        const t = get_place_tile_at_world_z(active_place, active_tile.x, active_tile.y, local_focus_world_z) as any;
        const is_container_tile =
          Array.isArray(t?.contents) ||
          Array.isArray((t as any)?.grow_surfaces) ||
          tile_has_tag(t as any, 'GROW') ||
          !!t?.container_capacity ||
          !!t?.container_glyphs;

        const is_container_structure = (() => {
          const structs = get_structures_at_world_z(active_tile.x, active_tile.y, active_place, local_focus_world_z);
          for (const s of structs) {
            if (!s) continue;
            if (Array.isArray((s as any).contents) || !!(s as any).container_capacity) return true;
            const tags = Array.isArray((s as any).tags) ? (s as any).tags : [];
            if (tags.some((tag: any) => String(tag?.name ?? '').toUpperCase() === 'CONTAINER')) return true;
          }
          return false;
        })();

        if (is_container_tile || is_container_structure) {
          if (active_place.id === place.id) config.on_open_tile_container(active_tile.x, active_tile.y, local_focus_world_z);
          return;
        }
      }

      // PRIORITY 2: Connector travel
      const connector_hit = (local_focus_world_z === get_place_base_z(active_place)) ? get_connector_at_tile(place, active_place, active_tile.x, active_tile.y, local_focus_world_z) : null;
      if (connector_hit) {
        const player = get_controlled_place_actor(place);
        if (!player) return;

        const dist_to_connector = Math.sqrt(
          Math.pow(player.tile_position.x - connector_hit.approach_x, 2) +
          Math.pow(player.tile_position.y - connector_hit.approach_y, 2)
        );

        if (dist_to_connector > 2) {
          debug_log_place("CONNECTOR: Player too far, pathing to connector", {
            player_pos: player.tile_position,
            connector_pos: { x: connector_hit.border_x, y: connector_hit.border_y },
            approach_pos: { x: connector_hit.approach_x, y: connector_hit.approach_y },
            distance: dist_to_connector,
          });

          const mode = get_move_mode();
          void fetch('http://localhost:8787/api/movement/move_to', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              session_token: config.get_session_token?.() ?? undefined,
              entity_ref: player.actor_ref,
              place_id: place.id,
              x: connector_hit.approach_x,
              y: connector_hit.approach_y,
              z: local_focus_world_z,
              mode,
            }),
          })
            .then(async (r) => {
              const j = await r.json().catch(() => null);
              if (!r.ok) {
                debug_log_place('CONNECTOR: approach move rejected (server)', { status: r.status, body: j });
                return;
              }
              if (j?.queued === false || j?.rejected === true) {
                debug_log_place('CONNECTOR: approach move not queued (server)', j);
                return;
              }
              debug_log_place('CONNECTOR: approach move accepted (server)', j);
            })
            .catch(() => {
              // ignore
            });
          return;
        }

        const actor_is_on_connector_border =
          player.tile_position.x === connector_hit.border_x &&
          player.tile_position.y === connector_hit.border_y;

        if (actor_is_on_connector_border) {
          const outward_direction = connector_hit.connector.place_a_id === place.id
            ? String(connector_hit.connector.direction_from_a ?? 'connector')
            : opposite_connector_direction(String(connector_hit.connector.direction_from_a ?? 'connector'));
          const outward_step = connector_direction_to_step(outward_direction);
          if (!outward_step) {
            debug_log_place('CONNECTOR: border transition rejected due to unsupported connector direction', {
              actor_ref: player.actor_ref,
              target_place_id: connector_hit.target_place_id,
              direction: outward_direction,
              border_pos: { x: connector_hit.border_x, y: connector_hit.border_y },
            });
            return;
          }
          debug_log_place('CONNECTOR: actor on border tile, sending authoritative seam intent', {
            actor_ref: player.actor_ref,
            target_place_id: connector_hit.target_place_id,
            direction: outward_direction,
            step: outward_step,
            border_pos: { x: connector_hit.border_x, y: connector_hit.border_y },
          });
          void fetch('http://localhost:8787/api/movement/intent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              session_token: config.get_session_token?.() ?? undefined,
              entity_ref: player.actor_ref,
              place_id: place.id,
              dx: outward_step.dx,
              dy: outward_step.dy,
              mode: get_move_mode(),
            }),
          })
            .then(async (r) => {
              const j = await r.json().catch(() => null);
              if (!r.ok) {
                debug_log_place('CONNECTOR: seam intent rejected (server)', { status: r.status, body: j });
                return;
              }
              debug_log_place('CONNECTOR: seam intent accepted (server)', j);
            })
            .catch(() => {
              // ignore
            });
          return;
        }

        const mode = get_move_mode();
        void fetch('http://localhost:8787/api/movement/move_to', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_token: config.get_session_token?.() ?? undefined,
            entity_ref: player.actor_ref,
            place_id: place.id,
            x: connector_hit.border_x,
            y: connector_hit.border_y,
            z: local_focus_world_z,
            mode,
          }),
        })
          .then(async (r) => {
            const j = await r.json().catch(() => null);
            if (!r.ok) {
              debug_log_place('CONNECTOR: border move rejected (server)', { status: r.status, body: j });
              return;
            }
            if (j?.queued === false || j?.rejected === true) {
              debug_log_place('CONNECTOR: border move not queued (server)', j);
              return;
            }
            debug_log_place('CONNECTOR: border move accepted (server)', j);
          })
          .catch(() => {
            // ignore
          });
        return;
      }

      // Entity selection (focus world-z only)
        const hit = get_entity_hit_at_world_z(active_tile.x, active_tile.y, active_place, local_focus_world_z);
      const entity = hit?.entity ?? null;
      if (entity) {
        const is_npc = "npc_ref" in entity;
        const ref = is_npc
          ? (entity as PlaceNPC).npc_ref
          : (entity as PlaceActor).actor_ref;

        if (hit) {
          last_entity_hit = { ref, part: hit.part, voxel: hit.voxel };
          const k = `hit_ctx:${ref}:${hit.part}`;
          if (!multitile_devlog_once.has(k)) {
            multitile_devlog_once.add(k);
            debug_log_place(`MULTITILE_TEST PASS interaction resolves hit context (entity=${ref} part=${hit.part} voxel=${hit.voxel.x},${hit.voxel.y},${hit.voxel.z})`);
          }

          try {
            const slots = get_body_slots_for_character_hit({
              body_slot_representation: (entity as any)?.body_slot_representation ?? null,
              hit_part: hit.part,
              hit_voxel: null,
            });
            if (slots.length > 0) {
              const k2 = `hit_slots:${ref}:${hit.part}`;
              if (!multitile_devlog_once.has(k2)) {
                multitile_devlog_once.add(k2);
                debug_log_place(`MULTITILE_TEST body slots for hit (entity=${ref} part=${hit.part} slots=${slots.join(',')})`);
              }
            }
          } catch {
            // ignore
          }
        }

        // Phase 2: Handle double-click on NPC (e.click_count is set by runtime)
        if (e.click_count === 2 && is_npc && config.on_double_click_npc) {
          // Check distance (touch range) - 3D.
          const actor_wp = get_player_actor_world_pos(active_place);
          if (actor_wp) {
            const npc_wz = get_entity_world_z(entity as any, get_place_base_z(active_place));
            const tgt = { x: active_tile.x, y: active_tile.y, z: npc_wz };
            if (is_within_range_xy_z(actor_wp, tgt, 1.5, 1)) {
              debug_log_place(`Double-click on NPC: ${ref}`);
              config.on_double_click_npc(ref);
            } else {
              debug_log_place(`Double-click on NPC too far: ${ref} actor=(${actor_wp.x},${actor_wp.y},${actor_wp.z}) npc=(${active_tile.x},${active_tile.y},${npc_wz})`);
            }
          }
          return;
        }
        
        // Single click: Set internal target
        set_target({ x: active_tile.x, y: active_tile.y, place_id: active_place.id, entity });
        
        // Call external target selection callback if provided
        if (config.on_select_target) {
          config.on_select_target(ref);
        }
        
        console.log(`[PlaceModule] Target selected: ${ref}`);
        return;
      }

      // Find the actor (player) to move
      // For now, move the first actor found
      const actor = get_controlled_place_actor(place);
      if (!actor) {
        debug_log_place("Click-to-move: No actor to move");
        return;
      }

      const start_x = actor.tile_position.x;
      const start_y = actor.tile_position.y;

      // Don't move if already there
      if (active_place.id !== place.id) {
        return;
      }

      if (start_x === active_tile.x && start_y === active_tile.y) {
        return;
      }

       const mode = get_move_mode();

       // Server-authoritative click-to-move: send goal to backend (server computes path + steps).
       void fetch('http://localhost:8787/api/movement/move_to', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({
            session_token: config.get_session_token?.() ?? undefined,
            entity_ref: actor.actor_ref,
            place_id: place.id,
             x: active_tile.x,
            y: active_tile.y,
            z: local_focus_world_z,
            mode,
          }),
       })
        .then(async (r) => {
          const j = await r.json().catch(() => null);
          if (!r.ok) {
            debug_log_place('Click-to-move rejected (server)', { status: r.status, body: j });
            return;
          }
          if (j?.queued === false || j?.rejected === true) {
            debug_log_place('Click-to-move not queued (server)', j);
            return;
          }
          debug_log_place('Click-to-move accepted (server)', j);
        })
         .catch(() => {
           // ignore
         });
    },

    OnPointerLeave(): void {
      clear_gizmo_hover_state(gizmo_state);
      hovered = null;
    },

    OnContextMenu(e: PointerEvent): void {
      const place = config.get_place();
      if (!place) return;
      if (config.is_place_painter_active?.()) return;

      const focus_z = config.get_focus_z ? config.get_focus_z() : DEFAULT_FOCUS_Z;
      const center_world_z = get_world_z_center_for_place(place);
      const visible_planes_z = get_defined_scene_world_zs(place);
      const base_z = get_place_base_z(place);
      const focus_world_z = Math.floor(visible_planes_z[Math.max(0, Math.min(visible_planes_z.length - 1, focus_z))] ?? center_world_z);

      // Convert screen to tile coordinates
      const scene_tile = screen_to_tile(e.x, e.y);
      const resolved = scene_tile ? resolve_scene_tile(place, scene_tile.x, scene_tile.y) : null;
      if (!resolved) {
        // Right click is INSPECT only. If user clicks near a connector (outside bounds), inspect that tile.
        const connector_hit = get_connector_from_screen(place, place, e.x, e.y, focus_world_z);
        if (connector_hit && config.on_inspect) {
          config.on_inspect({
            type: "adjacent_place",
            ref: connector_hit.target_place_id,
            place_id: place.id,
            tile_position: { x: connector_hit.border_x, y: connector_hit.border_y, z: focus_world_z },
          });
        } else if (config.on_inspect) {
          config.on_inspect({
            type: "place",
            ref: place.id,
            place_id: place.id,
            tile_position: { x: Math.max(0, Math.floor(view.offset_x)), y: Math.max(0, Math.floor(view.offset_y)), z: focus_world_z },
          });
        }
        return;
      }

      const active_place = resolved.place;
      const tile = { x: resolved.tile_x, y: resolved.tile_y };
      const local_focus_world_z = focus_world_z - resolved.offset.z;

      // Handle inspection if callback configured
      if (config.on_inspect) {
        const tile_key = `${active_place.id}:${tile.x},${tile.y}`;
        
        // Shift+Right-click forces tile inspection
        if (e.shift) {
          config.on_inspect({
            type: "tile",
            place_id: active_place.id,
            tile_position: { x: tile.x, y: tile.y, z: local_focus_world_z },
          });
          return;
        }
        
        // Normal right-click: cycle through inspectable targets
        // Order: Characters -> Structures -> Items -> Tile
        const inspectable_targets: Array<{ type: "npc" | "actor" | "structure" | "item" | "item_pile" | "tile"; ref?: string }> = [];

        // No pick-topmost: inspection targets come only from the focused world layer.
        // 1. Add characters (NPCs/Actors)
        const all_entities = get_all_entities_at_world_z(tile.x, tile.y, active_place, local_focus_world_z);
        for (const ent of all_entities) {
          const is_npc = "npc_ref" in ent;
          inspectable_targets.push({
            type: is_npc ? "npc" : "actor",
            ref: is_npc
              ? (ent as PlaceNPC).npc_ref
              : (ent as PlaceActor).actor_ref
          });
        }

        // 2. Add structure instances
        const structs = get_structures_at_world_z(tile.x, tile.y, active_place, local_focus_world_z);
        for (const s of structs) {
          const structure_id = String((s as any)?.id ?? '').trim();
          if (!structure_id) continue;
          inspectable_targets.push({
            type: "structure",
            ref: structure_id.startsWith('structure.') ? structure_id : `structure.${structure_id}`,
          });
        }

        // 3. Add items on ground (focused world layer)
        const item_ids = get_items_on_ground_at_world_z(active_place, tile.x, tile.y, local_focus_world_z);
        if (item_ids.length > 1) {
          inspectable_targets.push({
            type: "item_pile",
            ref: item_ids.join(','),
          });
        }
        for (const id of item_ids) {
          inspectable_targets.push({ type: "item", ref: id.startsWith('item.') ? id : `item.${id}` });
        }

        // 4. Add tile itself
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
              place_id: active_place.id,
              tile_position: { x: tile.x, y: tile.y, z: local_focus_world_z }
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
      // No wrap/cycle: clamp to visible layer count.
      if (!config.set_focus_z) return;
      const cur = config.get_focus_z ? config.get_focus_z() : DEFAULT_FOCUS_Z;
      const dir = e.delta_y < 0 ? 1 : (e.delta_y > 0 ? -1 : 0);
      const plane_count = Math.max(1, get_defined_scene_world_zs(config.get_place()).length);
      const next = clamp_int(cur + dir, 0, plane_count - 1);
      if (next !== cur) {
        config.set_focus_z(next);
      }
    },

    // Realtime key-up support (used for jump press duration + held-key movement).
    // Movement is now driven by polling get_move_intent() in Draw - this handler only handles jump.
    OnKeyUp(e: KeyboardEvent): void {
      const place = config.get_place();
      if (!place) return;

      const k = String(e.key ?? '');
      const kl = k.toLowerCase();

      // Jump/ascend is triggered on keydown; keyup only clears local timing state.
      if (kl === ' ') {
        input_state.space_down_ms = null;
        return;
      }
    },

    // Release held-movement if focus leaves the place.
    OnBlur(): void {
      try {
        const place = config.get_place();
        input_state.held_keys.clear();
        input_state.held_order = [];
        input_state.space_down_ms = null;
      } catch {
        // ignore
      }
    },

    // Key-up should work even when focus shifts mid-press.
    OnGlobalKeyUp(e: KeyboardEvent): void {
      // Delegate to the same release logic.
      mod.OnKeyUp?.(e);
    },

    OnKeyDown(e: KeyboardEvent): void {
      const place = config.get_place();
      if (!place) return;

      // Space is jump/ascend; it overrides normal movement on the initiation breath server-side.
      if (e.key === ' ') {
        if (!e.repeat) {
          input_state.space_down_ms = Date.now();
          void trigger_actor_ascend();
        }
        return;
      }

      const scroll_step = Math.max(1, view.scale);
      const { width: inner_w, height: inner_h } = inner_size();
      const bounds = camera.get_bounds(place, inner_w, inner_h);

      switch (e.key) {
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
