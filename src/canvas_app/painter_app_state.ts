/**
 * ASCII Painter App State
 * 
 * Creates the module graph for the immersive ASCII painter.
 * Uses the mono_ui module system with panning, zooming, and drawing tools.
 */

import type { Canvas, Module, PointerEvent, Rect, Rgb } from '../mono_ui/types.js';
import { create_module_registry, type ModuleRegistry } from '../mono_ui/module_registry.js';
import type { AppearanceSlotTargetMask, AppearanceSlotValue, Grid, Brush, ToolEditTarget, ToolType, GridCell } from '../ascii_painter/types.js';
import { clone_appearance_slot_assignments, createGrid, exportGrid, get_enabled_appearance_slots, importGrid } from '../ascii_painter/types.js';
import { createHistoryManager, logCellAction, logGroupAction, clearHistory, canUndoGroup, canRedoGroup, getGroupHistoryState, popRedoGroupAction, popUndoGroupAction, type HistoryAction, type HistoryManager } from '../ascii_painter/history.js';
import { get_color_by_name, nearest_indexed_lerp_rgb, nearest_indexed_rgb } from '../mono_ui/colors.js';
import { resolve_material_rgb } from '../mono_ui/runtime/material_registry.js';
import type { SelectionMode } from '../ascii_painter/selection.js';
import { clearSelection, createSelectionBitmap, invertSelection, isSelected, selectAll, setSelected, type SelectionBitmap } from '../ascii_painter/selection.js';
import { make_painter_canvas_module, type PainterInteractionAnchor } from '../mono_ui/modules/painter_canvas_module.js';
import { make_file_menu_module } from '../mono_ui/modules/painter_file_menu_module.js';
import { make_character_selector_module } from '../mono_ui/modules/character_selector_module.js';
import { make_brush_preview_module } from '../mono_ui/modules/brush_preview_module.js';
import { make_brush_color_block_module } from '../mono_ui/modules/brush_color_block_module.js';
import { make_color_selector_module } from '../mono_ui/modules/color_selector_module.js';
import { make_color_picker_module } from '../mono_ui/modules/color_picker_module.js';
import { make_indexed_palette_module } from '../mono_ui/modules/indexed_palette_module.js';
import { make_palette_slot_color_picker_module } from '../mono_ui/modules/palette_slot_color_picker_module.js';
import { make_toolbox_module } from '../mono_ui/modules/toolbox_module.js';
import { make_tool_properties_module, type ToolPropertyRow } from '../mono_ui/modules/tool_properties_module.js';
import { make_controls_module } from '../mono_ui/modules/controls_module.js';
import { make_customization_module } from '../mono_ui/modules/customization_module.js';
import { make_floating_panel_module } from '../mono_ui/modules/floating_panel_module.js';
import {
  initModuleLayoutPersistence,
  saveModulePosition,
  getModulePosition,
  clearModulePositions,
  getModuleVisibility,
  saveModuleVisibility,
} from '../ascii_painter/module_position_storage.js';
import { createGradiatorState, type GradiatorState, type GradiatorSlot, setActiveGradiatorSlot, selectGradiatorChar, addGradiatorChar, removeGradiatorChar, setGradiatorChar } from '../ascii_painter/gradiator.js';
import { saveGradiatorState, loadGradiatorState } from '../ascii_painter/gradiator_storage.js';
import {
  exportToJSON,
  exportToText,
  importFromJSON,
  importFromText,
  downloadFile,
  readFileAsText,
  autoSave,
  loadAutoSave,
  clearAutoSave,
  generateFilename,
  exportPainterDocumentToJSON,
  importPainterDocumentFromJSON,
  autoSavePainterDocument,
  loadAutoSavePainterDocument,
  // 3D VoxelSpace support
  importVoxelSpaceFromJSON,
  loadAutoSaveVoxelSpace,
  // Tool properties persistence
  saveToolProperties,
  loadToolProperties,
  clearToolProperties,
  type ToolProperties,
} from '../ascii_painter/save_system.js';
// 3D VoxelSpace imports
import type { VoxelSpace, VoxelLayer, CameraConfig, CameraMode } from '../ascii_painter/voxel_space.js';
import { 
  createVoxelSpace, 
  getLayer, 
  getOrCreateLayer, 
  addLayer, 
  removeLayer, 
  duplicateLayer,
  getVoxel,
  setVoxel,
  importVoxelSpace,
  getVisibleLayers,
  gridToVoxelSpace,
  debugVoxelSpace,
  createDefaultCamera,
} from '../ascii_painter/voxel_space.js';
import { makeGroupsModule, resolve_groups_timeline_visible_span, type GroupListItem } from '../mono_ui/modules/groups_module.js';
import { build_legacy_voxel_space_from_painter_runtime, import_legacy_voxel_space_as_painter_document } from '../ascii_painter/painter_document_legacy_adapter.js';
import { clone_painter_voxel_record, create_painter_document, create_painter_group, create_painter_voxel_record, get_painter_group_raster_state_at_breath, type PainterDocument, type PainterVoxelRecord } from '../ascii_painter/painter_document.js';
import { add_painter_group, duplicate_painter_group, erase_group_voxel, export_painter_document, get_exact_painter_group_raster_state, normalize_painter_document_runtime, remove_painter_group, rename_painter_group, reorder_painter_groups, resolve_nearest_painter_group_move_block, resolve_nearest_painter_group_raster_state, resolve_painter_group_location_at_breath, resolve_painter_group_preview_winner, set_group_voxel, set_painter_group_locked, set_painter_group_visibility, set_painter_runtime_active_breath, type PainterDocumentRuntime } from '../ascii_painter/painter_document_runtime.js';
import { derive_group_breath_range, derive_group_raster_segment_ranges, derive_painter_document_authored_breath_bounds, derive_painter_document_suggested_breath_range, get_painter_document_breath_range, get_painter_document_file_breath_range, get_painter_document_playback, step_painter_breath_playback } from '../ascii_painter/painter_breath.js';
import { create_painter_session_core } from '../ascii_painter/painter_session_core.js';
import type { PainterGroupPlaneRegistry } from '../ascii_painter/painter_session_types.js';
import { resolve_edit_channels_with_modifiers, type EditChannels } from '../ascii_painter/edit_mask.js';
import { diag_log } from '../shared/diagnostics.js';
import { get_ui_customization_state, get_ui_semantic_rgb, load_ui_customization_state, save_ui_customization_role_color, set_ui_customization_role_color, type UiCustomizationState, type UiSemanticColorRole } from '../mono_ui/runtime/ui_customization_store.js';
import { delete_indexed_palette_entry, duplicate_indexed_palette_entry, get_indexed_palette_state, load_indexed_palette_state, reorder_indexed_palette_entries, save_indexed_palette_state, update_indexed_palette_entry_rgb, type IndexedPaletteState } from '../mono_ui/runtime/indexed_palette_store.js';
import { get_camera_limit_profile, sanitize_camera_config_for_app } from '../mono_ui/runtime/camera_limits.js';
import { get_camera_settings_for_app, load_camera_settings, reset_camera_settings, save_camera_settings } from '../mono_ui/runtime/camera_customization_store.js';

function normalize_painter_tool(tool: ToolType): ToolType {
  return tool;
}

import { makePlaceCameraControlModule } from '../mono_ui/modules/place_camera_control_module.js';
import { VoxelDOMRenderer, createVoxelDOMRenderer } from '../ascii_painter/voxel_dom_renderer.js';
import { clone_projected_scene, commit_grid_to_painter_world, get_painter_focus_slot_for_anchor, get_painter_world_content_bounds_center, painter_projection_grid_point_to_world, painter_projection_world_to_grid_point, project_painter_display_space, project_painter_runtime_display_space, project_world_to_painter_display_cell, sync_grid_to_painter_projection, type PainterDisplayProjection, type PainterProjectedScene } from '../ascii_painter/painter_view_projection_adapter.js';
import { touch_world_layers_owner } from '../mono_ui/world_layers_owner.js';
import { get_principal_view_plane_axis, get_transition_tilt_for_command, get_view_basis_for_state, make_place_view_state, map_screen_direction_to_world_delta, step_place_view_action, type PlaceViewState } from '../mono_ui/runtime/place_view_projection.js';
import { start_roll_transition, start_swing_transition, type PlaceCameraTransition } from '../mono_ui/runtime/place_camera_pose.js';
import { clamp_anchor_to_viewport_px, compute_anchor_relative_mouse_parallax } from '../mono_ui/runtime/camera_anchor_runtime.js';
import { resolve_place_view_transition_frame } from '../mono_ui/runtime/place_view_camera_runtime.js';
import { apply_world_selection_mode, clear_world_selection, create_world_selection, decode_world_copy_data, encode_world_copy_data, get_world_selection_bounds, has_world_selection, parse_world_cell_key, set_world_selected, type WorldCopyData, type WorldSelection } from '../ascii_painter/world_selection.js';
import { project_world_point_with_roll, unproject_plane_point_with_roll } from '../mono_ui/runtime/place_view_projection.js';
import { create_painter_controls_runtime, PAINTER_TOOL_SEQUENCE_BINDINGS } from './controls_wiring.js';
import { control_binding_matches_keyboard_event } from '../mono_ui/runtime/controls_binding_matcher.js';
import {
  begin_plain_text_control_frame,
  clear_plain_text_control_interaction,
  create_plain_text_control_state,
  draw_plain_text_control,
  draw_plain_text_row,
  press_plain_text_control,
  release_hovered_plain_text_control,
  update_plain_text_hover,
} from '../mono_ui/ux/plain_text_controls.js';
import { create_profile_scope, type ProfileScope } from '../user_profiles/profile_scope.js';
import { resolve_profile_scope } from '../user_profiles/named_profile_store.js';
import { create_painter_tool_shortcut_interpreter } from './painter_tool_shortcut_interpreter.js';
import { create_painter_sync_client } from './painter_sync_client.js';
import { PAINTER_APP_CONFIG, apply_painter_multiplayer_transport_config } from './painter_runtime_config.js';
import { create_module_3d_camera } from '../engine/camera/camera_core.js';
import type { WorldPoint3 } from '../engine/camera/camera_types.js';
import { create_painter_camera_resolver, type PainterCameraSubject } from '../ascii_painter/camera/painter_camera_resolver.js';
import { get_painter_camera_boot_policy, get_painter_camera_detached_policy, get_painter_camera_text_cursor_policy } from '../ascii_painter/camera/painter_camera_policy.js';
import type { PainterLaunchIntent } from './painter_launch_types.js';
import { clear_launch_record } from '../engine_launch/persistence.js';
import { persist_painter_resume_file } from './painter_launch_adapter.js';
import { DEFAULT_LOCAL_MULTIPLAYER_TRANSPORT } from '../shared/multiplayer_transport.js';
import type { EngineContentRef } from '../engine_multiplayer/content_refs.js';
import { create_painter_file_content_ref, create_painter_remote_document_content_ref } from './painter_content_refs.js';
import {
  build_interaction_pointer_state,
  build_view_instance,
  create_interaction_registry_runtime,
  order_resolved_targets,
  select_current_resolved_target,
  type InteractionConsumerAdapters,
  type InteractionHoverState,
  type InteractionHoverResolution,
  type ResolvedTarget,
  type InteractionSession,
  type InteractionSessionResolution,
  type OrderedResolvedTargets,
  type ViewInstance,
} from '../mono_ui/runtime/interaction_runtime_types.js';

function painterDiag(message: string, payload?: Record<string, unknown>): void {
  diag_log('painter', 'verbose', 'PAINTER', message, payload);
}

function painterImportant(message: string, payload?: Record<string, unknown>): void {
  diag_log('painter', 'important', 'PAINTER', message, payload);
}

function painterRuntimeLog(message: string, payload?: Record<string, unknown>): void {
  try {
    console.log(`[PAINTER_GROUP_RUNTIME] ${message} ${JSON.stringify(payload ?? {})}`);
  } catch {
    console.log(`[PAINTER_GROUP_RUNTIME] ${message}`);
  }
}

function is_tai_fresh_state_enabled(): boolean {
  return Boolean((window as Window).electronAPI?.toolAssistedInputsBootConfig?.enabled)
    && Boolean((window as Window).electronAPI?.toolAssistedInputsBootConfig?.resetState);
}

function painterPerf(message: string, payload?: Record<string, unknown>): void {
  diag_log('performance_metrics', 'important', 'PAINTER', message, payload);
}

function painterCameraDiag(message: string, payload?: Record<string, unknown>): void {
  diag_log('camera', 'verbose', 'PAINTER_CAMERA', message, payload);
}

function painterTimelineDiag(message: string, payload?: Record<string, unknown>): void {
  diag_log('painter', 'verbose', 'PAINTER_TIMELINE', message, payload);
}

function summarizePainterTimelineGroup(group: PainterDocument['groups'][string]): Record<string, unknown> {
  const range = derive_group_breath_range(group);
  return {
    group_id: group.id,
    start: Math.max(0, Math.floor(group.start ?? 0)),
    cropped_start: range.cropped_start,
    cropped_end: range.cropped_end,
    derivative_end: range.derivative_end,
    raster_segments: derive_group_raster_segment_ranges(group).map((segment) => ({
      id: segment.segment_id,
      start: segment.start,
      end: segment.end,
      length_breaths: segment.length_breaths,
      is_blank: segment.state.content.length < 1,
    })),
    move_blocks: (Array.isArray(group.property_ids) ? group.property_ids : [])
      .map((propertyId) => group.properties?.[propertyId] ?? null)
      .filter((property): property is NonNullable<typeof property> => !!property && property.kind === 'move')
      .flatMap((property) => property.blocks.map((block) => ({
        property_id: property.id,
        block_id: block.id,
        start: Math.floor(block.start),
        end: Math.max(Math.floor(block.start), Math.floor(block.end)),
        breath: Math.floor(block.start),
        is_blank: block.type === 'blank',
      }))),
  };
}
import { create_painter_tool_assisted_inputs_wiring } from './painter_tool_assisted_inputs_wiring.js';

// Configuration matching the game but with relaxed letter spacing
export const PAINTER_CONFIG = PAINTER_APP_CONFIG;

// Canvas dimensions (separate from grid dimensions)
const CANVAS_WIDTH = 80;
const CANVAS_HEIGHT = 40;

export type PainterAppState = {
  modules: readonly Module[];
  module_registry: ModuleRegistry;
  update_layout: (grid_width: number, grid_height: number) => void;

  // Global pointer move hook for screen-space parallax.
  on_pointer_move_global?: (x: number, y: number, e: any) => void;
  on_pointer_down_global?: (x: number, y: number, e: any) => void;
  on_pointer_up_global?: (x: number, y: number, e: any) => void;

  // Import/export surface kept for existing UI wiring; uses PainterDocument.
  export_grid: () => string;
  import_grid: (json: string) => void;
  clear_canvas: () => void;

  // Document operations
  export_document: () => string;
  set_camera_mode: (mode: CameraMode) => void;
  set_parallax_intensity: (intensity: number) => void;
  toggle_show_all_layers: () => void;

  // Group operations
  add_group: () => void;
  delete_group: (group_id: string) => void;
  duplicate_group: (group_id: string) => void;
  select_group: (group_id: string) => void;
  toggle_group_visibility: (group_id: string) => void;
  toggle_group_lock: (group_id: string) => void;

  // DOM Renderer operations
  init_dom_renderer: () => void;
  render_dom_layers: () => void;
  set_mouse_parallax: (x: number, y: number) => void;
  set_dom_viewport: (viewport: {
    x: number;
    y: number;
    width: number;
    height: number;
    tileW?: number;
    tileH?: number;
    fontSizePx?: number;
    offsetX?: number;
    offsetY?: number;
  }) => void;

  // Debug functions
  debug_camera_config: () => void;
  force_save_camera: () => void;

  // Save system
  save_to_file: (filename?: string) => void;
  load_from_file: (file: File) => Promise<void>;
  export_as_text: () => string;
  new_canvas: (width: number, height: number) => void;
  start_from_launch_intent: (intent: PainterLaunchIntent) => Promise<void>;
  current_filename: string;
  get_interaction_adapters: () => InteractionConsumerAdapters;
  get_interaction_hover_state: () => InteractionHoverResolution | null;
  get_interaction_session_state: () => InteractionSessionResolution | null;
  multiplayer_sync: ReturnType<typeof create_painter_sync_client>;
  get_active_join_content_refs: () => EngineContentRef[];
};

type PainterSessionRole = 'host' | 'participant';

type PainterAppStateOptions = {
  skip_boot_restore?: boolean;
  skip_multiplayer_bootstrap?: boolean;
  get_join_snapshot?: () => import('../mono_ui/runtime/automation_interfaces.js').ToolAssistedInputsJoinSnapshot | null;
};

type PainterDomViewport = {
  x: number;
  y: number;
  width: number;
  height: number;
  tileW?: number;
  tileH?: number;
  fontSizePx?: number;
  offsetX?: number;
  offsetY?: number;
};

type LegacyPainterGroupCompatState = {
  active_group_id: string | null;
};

function create_legacy_painter_group_id(): string {
  return `painter_group_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function create_painter_app_state(options?: PainterAppStateOptions): PainterAppState {
  let active_profile_scope: ProfileScope = create_profile_scope(PAINTER_APP_CONFIG.selected_data_slot, 'thaum_painter');
  const profile_scope_ready = resolve_profile_scope(PAINTER_APP_CONFIG.selected_data_slot, 'thaum_painter').then((scope) => {
    active_profile_scope = scope;
    return scope;
  }).catch(() => active_profile_scope);
  initModuleLayoutPersistence(PAINTER_APP_CONFIG.selected_data_slot, 'thaum_painter', {
    get_profile_scope: () => active_profile_scope,
    profile_scope_ready,
    on_layout_loaded: () => {
      applyPersistedPainterModuleLayout();
    },
  });
  if (is_tai_fresh_state_enabled()) {
    clearAutoSave();
    clearToolProperties();
    void reset_camera_settings(PAINTER_APP_CONFIG.selected_data_slot, 'thaum_painter', active_profile_scope).catch(() => null);
    clearModulePositions();
    try {
      window.localStorage.removeItem('thaumworld_ascii_painter_last_file_path');
    } catch {
      // ignore
    }
    painterRuntimeLog('tai fresh state reset applied');
  }

  const painter_sync = create_painter_sync_client({
    slot: PAINTER_APP_CONFIG.selected_data_slot,
    get_api_base_url: () => PAINTER_APP_CONFIG.api_base_url,
    get_bridge_ws_base_url: () => PAINTER_APP_CONFIG.bridge_ws_base_url,
    reconnect_token_storage_key: PAINTER_APP_CONFIG.reconnect_token_storage_key,
  });
  if (!options?.skip_multiplayer_bootstrap) {
    void painter_sync.bootstrap().then((sync_state) => {
      painterImportant('painter authority ready', {
        authority_mode: sync_state.authority_mode,
        lifecycle: sync_state.lifecycle,
        slot: PAINTER_APP_CONFIG.selected_data_slot,
      });
    });
  }

  // Create the drawing grid (legacy 2D)
  const grid = createGrid(CANVAS_WIDTH, CANVAS_HEIGHT);
  const initial_painter_document = create_painter_document(CANVAS_WIDTH, CANVAS_HEIGHT, { min_z: 0, max_z: 0, default_group_name: 'Group 1' });
  let painter_document_runtime: PainterDocumentRuntime = normalize_painter_document_runtime(initial_painter_document);
  const painter_session_core = create_painter_session_core(export_painter_document(painter_document_runtime));
  let painter_current_breath = Math.max(0, Math.floor(painter_document_runtime.active_breath));
  let painter_timeline_view_start_breath = 0;
  let painter_timeline_view_span_breaths = 24;
  let painter_playback_running = false;
  let painter_playback_frame_carry = 0;
  let last_projection_runtime_log_signature = '';
  const DEFAULT_USER_SELECTION_COLOR_RGB: Rgb = { ...get_color_by_name('pumpkin').rgb };
  const saved_tool_props = loadToolProperties();
  let ui_customization_state: UiCustomizationState = get_ui_customization_state();
  let indexed_palette_state: IndexedPaletteState = get_indexed_palette_state();
  let active_indexed_palette_entry_id: string | null = indexed_palette_state.entries[0]?.id ?? null;
  let user_selection_color_rgb: Rgb = { ...ui_customization_state.colors.vivid };
  type PainterSelectionChannelState = {
    connection_id: string;
    color_rgb: Rgb;
    selection: WorldSelection;
    updated_at_ms: number;
  };
  const selection_channels_by_connection = new Map<string, PainterSelectionChannelState>();
  let move_preview_selection_override: WorldSelection | null = null;
  let world_clipboard_data: WorldCopyData | null = null;
  let legacy_group_compat: LegacyPainterGroupCompatState = {
    active_group_id: null,
  };
  let active_group_property_id: string | null = null;
  let current_filename = 'untitled';
  let current_file_path: string | null = null;
  let current_session_role: PainterSessionRole = 'host';
  let current_painter_document_lineage_id: string | null = null;
  let suppress_recent_file_persistence = false;
  let authoritative_revision_applied = 0;
  let canvas_module: ReturnType<typeof make_painter_canvas_module> | null = null;
  let painter_groups_auto_key_enabled = false;

  function get_local_selection_connection_id(): string {
    return String(painter_sync.get_state().bootstrap?.connection_id ?? 'local').trim() || 'local';
  }

  function clone_world_selection_cells(selection: WorldSelection): WorldSelection {
    return { cells: new Set(selection.cells) };
  }

  function get_or_create_selection_channel(connection_id: string, color_rgb?: Rgb): PainterSelectionChannelState {
    const normalized = String(connection_id ?? '').trim() || 'local';
    const existing = selection_channels_by_connection.get(normalized);
    if (existing) {
      if (color_rgb) existing.color_rgb = { ...color_rgb };
      return existing;
    }
    const created: PainterSelectionChannelState = {
      connection_id: normalized,
      color_rgb: color_rgb ? { ...color_rgb } : { ...user_selection_color_rgb },
      selection: create_world_selection(),
      updated_at_ms: Date.now(),
    };
    selection_channels_by_connection.set(normalized, created);
    return created;
  }

  function get_local_selection_channel(): PainterSelectionChannelState {
    return get_or_create_selection_channel(get_local_selection_connection_id(), user_selection_color_rgb);
  }

  function get_local_world_selection(): WorldSelection {
    return get_local_selection_channel().selection;
  }

  function apply_ui_customization_runtime(next: UiCustomizationState): void {
    ui_customization_state = next;
    user_selection_color_rgb = { ...next.colors.vivid };
    get_local_selection_channel().color_rgb = { ...user_selection_color_rgb };
  }

  void profile_scope_ready.then((profile_scope) => load_ui_customization_state(PAINTER_APP_CONFIG.selected_data_slot, {
    vivid_seed_rgb: saved_tool_props.user_selection_color_rgb ?? DEFAULT_USER_SELECTION_COLOR_RGB,
    profile_scope,
  })).then((next) => {
    apply_ui_customization_runtime(next);
  }).catch(() => {
    // ignore slot customization load failures and keep defaults in memory
  });

  function apply_indexed_palette_runtime(next: IndexedPaletteState): void {
    indexed_palette_state = next;
    if (!indexed_palette_state.entries.some((entry) => entry.id === active_indexed_palette_entry_id)) {
      active_indexed_palette_entry_id = indexed_palette_state.entries[0]?.id ?? null;
    }
  }

  async function persist_indexed_palette_runtime(next: IndexedPaletteState): Promise<void> {
    apply_indexed_palette_runtime(next);
    const saved = await save_indexed_palette_state(PAINTER_APP_CONFIG.selected_data_slot, next, active_profile_scope);
    apply_indexed_palette_runtime(saved);
  }

  void profile_scope_ready.then((profile_scope) => load_indexed_palette_state(PAINTER_APP_CONFIG.selected_data_slot, profile_scope)).then((next) => {
    apply_indexed_palette_runtime(next);
  }).catch(() => {
    // ignore indexed palette load failures and keep defaults in memory
  });

  function clear_all_selection_channels(options?: { publish?: boolean }): void {
    selection_channels_by_connection.clear();
    const local = get_local_selection_channel();
    clear_world_selection(local.selection);
    local.updated_at_ms = Date.now();
    if (options?.publish !== false) publish_local_selection_channel();
  }

  function set_move_preview_selection_cells(cells: Array<{ x: number; y: number; z: number }> | null): void {
    if (!cells || cells.length < 1) {
      move_preview_selection_override = null;
      syncDOMRenderer();
      return;
    }
    const next = create_world_selection();
    for (const cell of cells) set_world_selected(next, cell.x, cell.y, cell.z, true);
    move_preview_selection_override = next;
    syncDOMRenderer();
  }

  function replace_selection_channel_from_snapshot(connection_id: string, cells: Array<{ x: number; y: number; z: number }>, color_rgb: Rgb, updated_at_ms: number): void {
    const channel = get_or_create_selection_channel(connection_id, color_rgb);
    const next = create_world_selection();
    for (const cell of cells) {
      set_world_selected(next, cell.x, cell.y, cell.z, true);
    }
    channel.selection = next;
    channel.color_rgb = { ...color_rgb };
    channel.updated_at_ms = updated_at_ms;
  }

  function sync_selection_channels_from_multiplayer_state(selection_channels: Array<{ connection_id: string; color_rgb: Rgb; cells: Array<{ x: number; y: number; z: number }>; updated_at_ms: number }>): void {
    const nextKeys = new Set<string>();
    const localConnectionId = get_local_selection_connection_id();
    if (localConnectionId !== 'local' && selection_channels_by_connection.has('local') && !selection_channels_by_connection.has(localConnectionId)) {
      const legacyLocal = selection_channels_by_connection.get('local');
      if (legacyLocal) {
        selection_channels_by_connection.set(localConnectionId, {
          connection_id: localConnectionId,
          color_rgb: { ...legacyLocal.color_rgb },
          selection: clone_world_selection_cells(legacyLocal.selection),
          updated_at_ms: legacyLocal.updated_at_ms,
        });
      }
      selection_channels_by_connection.delete('local');
    }
    for (const channel of selection_channels) {
      const connection_id = String(channel.connection_id ?? '').trim();
      if (!connection_id) continue;
      nextKeys.add(connection_id);
      replace_selection_channel_from_snapshot(connection_id, channel.cells ?? [], channel.color_rgb, channel.updated_at_ms ?? Date.now());
    }
    for (const key of Array.from(selection_channels_by_connection.keys())) {
      if (key === localConnectionId) continue;
      if (nextKeys.has(key)) continue;
      selection_channels_by_connection.delete(key);
    }
    get_local_selection_channel().color_rgb = { ...user_selection_color_rgb };
  }

  function serialize_world_selection_cells(selection: WorldSelection): Array<{ x: number; y: number; z: number }> {
    return Array.from(selection.cells).map((key) => parse_world_cell_key(key));
  }

  function publish_local_selection_channel(): void {
    const active = painter_sync.get_state().bootstrap;
    const channel = get_local_selection_channel();
    if (!active?.session_token) return;
    void painter_sync.submit_selection({
      document_id: active.document_id,
      color_rgb: channel.color_rgb,
      cells: serialize_world_selection_cells(channel.selection),
    }).catch((error) => {
      painterImportant('failed to submit painter selection channel', {
        error: error instanceof Error ? error.message : String(error),
        connection_id: channel.connection_id,
      });
    });
  }
  const LAST_FILE_PATH_KEY = 'thaumworld_ascii_painter_last_file_path';
  let runtime_group_planes: PainterGroupPlaneRegistry = {
    group_id_to_plane: new Map<string, number>(),
    plane_to_group_id: new Map<number, string>(),
  };

  function sync_local_session_state_from_core(): void {
    const state = painter_session_core.get_state();
    painter_document_runtime = state.runtime;
    runtime_group_planes = state.group_plane_registry;
  }

  function syncActivePainterBreathAcrossState(nextBreath: number): void {
    painter_current_breath = clampPainterBreathToNonNegative(nextBreath);
    set_painter_runtime_active_breath(painter_document_runtime, painter_current_breath);
    painter_session_core.set_active_breath(painter_current_breath);
  }

  function getPainterDocumentBreathRange(): { start: number; end: number } {
    return get_painter_document_breath_range(painter_document_runtime.document);
  }

  function getPainterDocumentFileBreathRange(): { start: number; end: number } {
    return get_painter_document_file_breath_range(painter_document_runtime.document);
  }

  function clampPainterBreathToNonNegative(breath: number): number {
    return Math.max(0, Math.floor(Number.isFinite(breath) ? breath : painter_current_breath));
  }

  function stopPainterPlayback(): void {
    painter_playback_running = false;
    painter_playback_frame_carry = 0;
  }

  function syncPainterTimingStateAfterDocumentMutation(): void {
    syncActivePainterBreathAcrossState(painter_current_breath);
    painter_timeline_view_start_breath = Math.max(0, Math.min(painter_timeline_view_start_breath, getPainterDocumentBreathRange().end));
  }
  sync_local_session_state_from_core();
  syncActivePainterBreathAcrossState(painter_current_breath);
  let voxelSpace = build_legacy_voxel_space_from_painter_runtime(painter_document_runtime);

  function get_group_id_for_legacy_z(z: number): string | null {
    return painter_session_core.get_group_id_for_plane(z);
  }

  function get_legacy_group_planes(): number[] {
    return Array.from(runtime_group_planes.plane_to_group_id.keys()).sort((a, b) => a - b);
  }

  function get_legacy_z_for_group_id(group_id: string | null | undefined): number | null {
    return painter_session_core.get_plane_for_group_id(group_id);
  }

  function rebuild_runtime_group_plane_registry(options?: { preserve_existing?: boolean }): void {
    painter_session_core.refresh_derived_state({ preserve_existing_group_planes: options?.preserve_existing ?? true });
    sync_local_session_state_from_core();
    sync_lineage_state_from_core();
  }

  function get_runtime_group_planes(): number[] {
    return painter_session_core.get_group_planes();
  }

  function get_nearest_runtime_group_plane(plane: number): number | null {
    return painter_session_core.get_nearest_group_plane(plane);
  }

  function getPainterFocusPlaneAxis(viewState?: PlaceViewState): 'x' | 'y' | 'z' {
    const resolvedViewState = viewState ?? make_place_view_state(painter_camera_state.principal_view, painter_camera_state.roll_quarter_turn);
    return get_principal_view_plane_axis(resolvedViewState.principal_view);
  }

  function sync_legacy_group_compat_state(options?: { preserve_group_order?: boolean }): void {
    void options;
    rebuild_runtime_group_plane_registry({ preserve_existing: true });
    if (!legacy_group_compat.active_group_id || !painter_document_runtime.document.groups[legacy_group_compat.active_group_id]) {
      legacy_group_compat.active_group_id = painter_document_runtime.document.group_order[0] ?? null;
    }
    sync_active_group_property_selection();
  }

  function resolve_default_group_property_id(group_id: string | null): string | null {
    if (!group_id) return null;
    const group = painter_document_runtime.document.groups[group_id];
    if (!group) return null;
    const orderedProperty = group.property_ids.find((property_id) => {
      const property = group.properties[property_id];
      return property?.kind === 'raster' || property?.kind === 'move';
    }) ?? null;
    return orderedProperty;
  }

  function sync_active_group_property_selection(): void {
    const activeGroupId = legacy_group_compat.active_group_id;
    if (!activeGroupId) {
      active_group_property_id = null;
      return;
    }
    const group = painter_document_runtime.document.groups[activeGroupId];
    if (!group) {
      active_group_property_id = null;
      return;
    }
    if (active_group_property_id && group.properties[active_group_property_id]) return;
    active_group_property_id = resolve_default_group_property_id(activeGroupId);
  }

  function resetPainterHistoryState(reason: string): void {
    clearHistory(history);
    painterDiag('reset painter history state', { reason });
  }

  function make_runtime_cell_signature(summary: { contributor_coords: number; resolved_coords: number; focus_world_plane: number | null }): string {
    return `${summary.contributor_coords}|${summary.resolved_coords}|${summary.focus_world_plane ?? 'null'}`;
  }

  function rebuild_runtime_from_voxel_space(options?: { preserve_group_order?: boolean }): void {
    const preserve_group_order = options?.preserve_group_order ?? false;
    const next_document = import_legacy_voxel_space_as_painter_document(voxelSpace, {
      group_order: preserve_group_order ? painter_document_runtime.document.group_order : undefined,
      active_group_id: legacy_group_compat.active_group_id,
    });
    painter_session_core.replace_document(next_document, {
      lineage_id: current_painter_document_lineage_id,
      authoritative_revision: authoritative_revision_applied,
    });
    sync_local_session_state_from_core();
    sync_lineage_state_from_core();
    sync_legacy_group_compat_state({ preserve_group_order });
  }

  function syncVoxelSpaceCameraFromPainterCamera(): void {
    voxelSpace.camera = structuredClone(painter_camera_state);
  }

  function syncPainterDocumentCameraFromPainterCamera(): void {
    painter_document_runtime.document.camera = structuredClone(painter_camera_state);
  }

  function rebuild_voxel_space_from_runtime(): void {
    const preferred_active_group_id = legacy_group_compat.active_group_id;
    const preservedCamera = structuredClone(painter_camera_state);
    syncPainterDocumentCameraFromPainterCamera();
    voxelSpace = build_legacy_voxel_space_from_painter_runtime(painter_document_runtime);
    painter_camera_state = structuredClone(preservedCamera);
    syncVoxelSpaceCameraFromPainterCamera();
    syncPainterDocumentCameraFromPainterCamera();
    sync_legacy_group_compat_state({ preserve_group_order: true });
    if (preferred_active_group_id && painter_document_runtime.document.groups[preferred_active_group_id]) {
      legacy_group_compat.active_group_id = preferred_active_group_id;
    }
    if (legacy_group_compat.active_group_id && !painter_document_runtime.document.groups[legacy_group_compat.active_group_id]) {
      legacy_group_compat.active_group_id = painter_document_runtime.document.group_order[0] ?? null;
    }
  }

  function sync_painter_runtime_after_mutation(options?: { preserve_group_order?: boolean; focus_active_group?: boolean }): void {
    sync_legacy_group_compat_state({ preserve_group_order: options?.preserve_group_order ?? true });
    syncPainterTimingStateAfterDocumentMutation();
    ensureValidFocusPlane();
    refreshPainterProjectionFromWorld();
  }

  function log_runtime_summary(event: string): void {
    const summary = {
      active_group_id: legacy_group_compat.active_group_id,
      group_order: [...painter_document_runtime.document.group_order],
      group_count: Object.keys(painter_document_runtime.document.groups).length,
      contributor_coords: painter_document_runtime.coordinate_group_index.size,
      resolved_coords: painter_document_runtime.resolved_visible_index.size,
      occupied_bounds: painter_document_runtime.document.occupied_bounds,
    };
    painterImportant(event, summary);
    painterRuntimeLog(event, summary);
  }

  function submit_group_command_if_authoritative(command: {
    kind: 'set_document_timing' | 'set_document_loop_window' | 'create_group' | 'offset_group_in_time' | 'set_group_timing' | 'set_group_breath_span' | 'set_group_property_block_length' | 'split_group_property_block' | 'swap_group_property_blocks' | 'blank_group_property_block' | 'trim_group_property_block_edge' | 'merge_group_blank_property_block' | 'compact_group_blank_property_block_left' | 'set_group_property_block_edge_destructive' | 'delete_group' | 'duplicate_group' | 'rename_group' | 'set_group_visibility' | 'set_group_locked' | 'set_group_raster_state' | 'set_group_property_block' | 'move_group_property_block' | 'reorder_groups' | 'reset_document' | 'undo_group' | 'redo_group';
    group_id?: string;
    source_group_id?: string;
    target_group_id?: string;
    group_name?: string;
    visible?: boolean;
    locked?: boolean;
    delta_breaths?: number;
    breath_range_start?: number;
    breath_range_end?: number;
    frames_per_breath?: number;
    loop_enabled?: boolean;
    breath_start?: number;
    breath_end?: number;
    start?: number;
    cropped_start?: number;
    cropped_end?: number;
    property_id?: string;
    property_kind?: 'raster' | 'move' | 'rotation' | 'opacity';
    property_label?: string;
    block_id?: string;
    source_block_id?: string;
    target_block_id?: string;
    split_breath?: number;
    length_breaths?: number;
    breath?: number;
    voxels?: PainterVoxelRecord[];
    value?: { kind: 'raster'; voxels: PainterVoxelRecord[] } | { kind: 'vec3'; x: number; y: number; z: number } | { kind: 'scalar'; value: number };
    target_breath?: number;
    edge?: 'start' | 'end';
    direction?: 'left' | 'right';
    next_group_order?: string[];
  }): void {
    if (!can_submit_to_authoritative_document()) return;
    void painter_sync.submit_group_command(command).catch((error) => {
      diag_log('painter', 'important', 'PAINTER', 'failed to submit painter group command', {
        kind: command.kind,
        error: error instanceof Error ? error.message : String(error),
      }, { sink: 'warn' });
    });
  }

  function clear_current_anchor_cell(): boolean {
    const anchorWorld = getPainterOrchestratorInteractionAnchor().world ?? getPainterInteractionAnchor().world;
    if (!anchorWorld) return false;
    const applied = apply_authored_group_cell_changes([{
      worldX: anchorWorld.x,
      worldY: anchorWorld.y,
      worldZ: anchorWorld.z,
      newCell: { char: ' ', rgb: { r: 0, g: 0, b: 0 }, weight_index: 0 },
    }]);
    if (applied) {
      refreshPainterProjectionFromWorld();
      log_runtime_summary('clear current anchor cell summary');
    }
    return applied;
  }

  function clear_active_group_authored_voxels(): boolean {
    const active_group_id = resolve_current_runtime_group_id();
    if (!active_group_id) return false;
    const voxel_map = painter_document_runtime.group_voxel_index.get(active_group_id);
    if (!voxel_map || voxel_map.size < 1) return false;
    const changes = Array.from(voxel_map.values()).map((voxel) => ({
      worldX: voxel.x,
      worldY: voxel.y,
      worldZ: voxel.z,
      newCell: { char: ' ', rgb: { r: 0, g: 0, b: 0 }, weight_index: 0 },
    }));
    const applied = apply_authored_group_cell_changes(changes);
    if (!applied) return false;
    refreshPainterProjectionFromWorld();
    if (can_submit_to_authoritative_document()) {
      void painter_sync.submit_cell_changes(active_group_id, painter_current_breath, painter_groups_auto_key_enabled, changes.map((change) => ({
        x: change.worldX,
        y: change.worldY,
        z: change.worldZ,
        cell: make_history_cell_from_runtime_record(change.newCell),
      }))).catch((error) => {
        diag_log('painter', 'important', 'PAINTER', 'failed to submit active-group clear command', {
          error: error instanceof Error ? error.message : String(error),
          active_group_id,
        }, { sink: 'warn' });
      });
    }
    log_runtime_summary('active group cleared summary');
    return true;
  }

  function reset_painter_document_state(): boolean {
    const document = create_painter_document(CANVAS_WIDTH, CANVAS_HEIGHT, { min_z: 0, max_z: 0, default_group_name: 'Group 1' });
    applyPainterDocumentSnapshot(document);
    painter_groups_auto_key_enabled = true;
    painterDiag('groups auto key enabled for reset document', { enabled: painter_groups_auto_key_enabled });
    setCurrentPainterDocumentLineage(`memory:reset:${Date.now()}`, 'reset_document');
    log_runtime_summary('painter document reset summary');
    if (painter_sync.get_state().authority_mode === 'authoritative_host') {
      submit_group_command_if_authoritative({ kind: 'reset_document' });
    }
    return true;
  }

  function is_group_structural_action(action: HistoryAction | null | undefined): boolean {
    return !!action && (
      action.type === 'create_group'
      || action.type === 'delete_group'
      || action.type === 'duplicate_group'
      || action.type === 'rename_group'
      || action.type === 'set_group_visibility'
      || action.type === 'set_group_locked'
      || action.type === 'offset_group_in_time'
      || action.type === 'set_group_timing'
      || action.type === 'set_group_breath_span'
      || action.type === 'set_group_property_block_length'
      || action.type === 'split_group_property_block'
      || action.type === 'swap_group_property_blocks'
      || action.type === 'set_group_raster_state'
      || action.type === 'set_group_property_block'
      || action.type === 'reorder_groups'
    );
  }

  function is_cell_history_action(action: HistoryAction | null | undefined): boolean {
    return !!action && !!action.cellChanges && action.cellChanges.length > 0;
  }

  function apply_group_structural_action_from_history(action: HistoryAction, direction: 'undo' | 'redo'): boolean {
    const useOld = direction === 'undo';
    const groupId = action.groupId ?? action.targetGroupId ?? action.sourceGroupId ?? null;
    switch (action.type) {
      case 'create_group': {
        if (direction === 'undo') {
          if (groupId) remove_painter_group(painter_document_runtime, groupId);
        } else if (action.newGroupData) {
          add_painter_group(painter_document_runtime, action.newGroupData);
          legacy_group_compat.active_group_id = action.newGroupData.id;
        }
        break;
      }
      case 'delete_group': {
        if (direction === 'undo' && action.oldGroupData) {
          add_painter_group(painter_document_runtime, action.oldGroupData);
          legacy_group_compat.active_group_id = action.oldGroupData.id;
        } else if (groupId) {
          remove_painter_group(painter_document_runtime, groupId);
        }
        break;
      }
      case 'duplicate_group': {
        if (direction === 'undo') {
          if (action.targetGroupId) remove_painter_group(painter_document_runtime, action.targetGroupId);
        } else if (action.newGroupData) {
          add_painter_group(painter_document_runtime, action.newGroupData);
          legacy_group_compat.active_group_id = action.newGroupData.id;
        }
        break;
      }
      case 'rename_group': {
        const next = useOld ? action.oldGroupData : action.newGroupData;
        if (groupId && next) rename_painter_group(painter_document_runtime, groupId, next.name);
        break;
      }
      case 'set_group_visibility': {
        const next = useOld ? action.oldGroupData : action.newGroupData;
        if (groupId && next) set_painter_group_visibility(painter_document_runtime, groupId, next.visible);
        break;
      }
      case 'set_group_locked': {
        const next = useOld ? action.oldGroupData : action.newGroupData;
        if (groupId && next) set_painter_group_locked(painter_document_runtime, groupId, next.locked);
        break;
      }
      case 'offset_group_in_time':
      case 'set_group_timing':
      case 'set_group_breath_span':
      case 'set_group_property_block_length':
      case 'split_group_property_block':
      case 'swap_group_property_blocks':
      case 'set_group_raster_state':
      case 'set_group_property_block': {
        const next = useOld ? action.oldGroupData : action.newGroupData;
        if (groupId && next) {
          painter_document_runtime.document.groups[groupId] = structuredClone(next);
          legacy_group_compat.active_group_id = next.id;
        }
        break;
      }
      case 'reorder_groups': {
        const nextOrder = useOld ? action.oldGroupOrder : action.newGroupOrder;
        if (nextOrder) reorder_painter_groups(painter_document_runtime, nextOrder);
        break;
      }
      default:
        return false;
    }
    sync_painter_runtime_after_mutation({ preserve_group_order: true });
    log_runtime_summary(direction === 'undo' ? 'group structural undo summary' : 'group structural redo summary');
    return true;
  }

  function apply_cell_action_from_history(action: HistoryAction, direction: 'undo' | 'redo'): boolean {
    if (!action.cellChanges || action.cellChanges.length < 1) return false;
    for (const change of action.cellChanges) {
      const group_id = change.group_id;
      const coordKey = `${change.worldX}:${change.worldY}:${change.worldZ}`;
      const nextCell = direction === 'undo' ? change.oldCell : change.newCell;
      if ((nextCell?.char ?? ' ') === ' ') {
        erase_group_voxel(painter_document_runtime, group_id, coordKey);
      } else {
        set_group_voxel(painter_document_runtime, group_id, create_painter_voxel_record({
          x: change.worldX,
          y: change.worldY,
          z: change.worldZ,
          char: nextCell.char,
          rgb: { ...nextCell.rgb },
          weight_index: nextCell.weight_index,
        }));
      }
    }
    sync_painter_runtime_after_mutation({ preserve_group_order: true });
    log_runtime_summary(direction === 'undo' ? 'cell history undo summary' : 'cell history redo summary');
    return true;
  }

  function apply_painter_history_action(action: HistoryAction, direction: 'undo' | 'redo'): boolean {
    if (is_group_structural_action(action)) {
      return apply_group_structural_action_from_history(action, direction);
    }
    if (is_cell_history_action(action)) {
      return apply_cell_action_from_history(action, direction);
    }
    return false;
  }

  function get_total_group_history_entries(): number {
    let total = 0;
    for (const stack of history.group_histories.values()) {
      total += stack.undo.length + stack.redo.length;
    }
    return total;
  }

  function undo_painter_history(): { description: string; type: HistoryAction['type'] } | null {
    const group_id = resolve_current_runtime_group_id();
    if (!group_id || !canUndoGroup(history, group_id)) return null;
    const action = popUndoGroupAction(history, group_id);
    if (!action) return null;
    if (apply_painter_history_action(action, 'undo')) {
      return { description: action.description, type: action.type };
    }
    return null;
  }

  function redo_painter_history(): { description: string; type: HistoryAction['type'] } | null {
    const group_id = resolve_current_runtime_group_id();
    if (!group_id || !canRedoGroup(history, group_id)) return null;
    const action = popRedoGroupAction(history, group_id);
    if (!action) return null;
    if (apply_painter_history_action(action, 'redo')) {
      return { description: action.description, type: action.type };
    }
    return null;
  }

  function isAuthoritativeUndoRedoSupported(type: HistoryAction['type']): boolean {
    return type === 'draw_cells'
      || type === 'erase_cells'
      || type === 'fill'
      || type === 'paste'
      || type === 'clear_canvas';
  }

  function performPainterUndo(): string | null {
    const group_id = resolve_current_runtime_group_id();
    const result = undo_painter_history();
    if (result) {
      if (group_id && isAuthoritativeUndoRedoSupported(result.type)) {
        submit_group_command_if_authoritative({ kind: 'undo_group', group_id });
      }
      return result.description;
    }
    return null;
  }

  function performPainterRedo(): string | null {
    const group_id = resolve_current_runtime_group_id();
    const result = redo_painter_history();
    if (result) {
      if (group_id && isAuthoritativeUndoRedoSupported(result.type)) {
        submit_group_command_if_authoritative({ kind: 'redo_group', group_id });
      }
      return result.description;
    }
    return null;
  }

  function get_group_history_stats(group_id: string): { current_index: number; total_actions: number } {
    const state = getGroupHistoryState(history, group_id);
    return {
      current_index: state.current_position,
      total_actions: state.total_actions,
    };
  }

  function get_group_undo_redo_counts(group_id: string): { undo_count: number; redo_count: number } {
    const state = getGroupHistoryState(history, group_id);
    return {
      undo_count: state.current_position,
      redo_count: Math.max(0, state.total_actions - state.current_position),
    };
  }

  function make_history_cell_from_runtime_record(record: GridCell | null | undefined): GridCell {
    if (!record) return { char: ' ', graphic: undefined, appearance_slots: undefined, materials: undefined, rgb: { r: 0, g: 0, b: 0 }, weight_index: 0 };
    return {
      char: record.char,
      graphic: record.graphic ? { ...record.graphic } : undefined,
      appearance_slots: clone_appearance_slot_assignments(record.appearance_slots),
      materials: record.materials ? { ...record.materials } : undefined,
      rgb: { ...record.rgb },
      weight_index: record.weight_index,
      render_index: record.render_index,
    };
  }

  function apply_authored_group_cell_changes(changes: Array<{
    worldX: number;
    worldY: number;
    worldZ: number;
    newCell: GridCell;
  }>, options?: { log_history?: boolean }): boolean {
    const active_group_id = resolve_current_runtime_group_id();
    if (!active_group_id) {
      painterImportant('skipping authored group mutation: no active group', { change_count: changes.length });
      return false;
    }
    const group = painter_document_runtime.document.groups[active_group_id];
    if (!group) {
      painterImportant('skipping authored group mutation: active group missing', { active_group_id, change_count: changes.length });
      return false;
    }
    if (group.locked) {
      painterDiag('skipping authored group mutation: group locked', { active_group_id, change_count: changes.length });
      return false;
    }
    const { applied, history_changes, rejected_reason } = painter_session_core.apply_cell_changes(active_group_id, painter_current_breath, changes, {
      auto_key: painter_groups_auto_key_enabled,
    });
    if (!applied) {
      if (rejected_reason === 'no_visible_raster_content') {
        painterDiag('rejected authored group mutation: no visible raster content at current breath', {
          active_group_id,
          change_count: changes.length,
          active_breath: painter_current_breath,
          auto_key: painter_groups_auto_key_enabled,
        });
      }
      return false;
    }
    sync_local_session_state_from_core();
    sync_lineage_state_from_core();
    sync_painter_runtime_after_mutation({ preserve_group_order: true });
    if (options?.log_history !== false && history_changes.length > 0) {
      logCellAction(history, 'draw_cells', `Group ${active_group_id} edit`, { group_id: active_group_id }, history_changes);
    }
      painterDiag('applied authored group cell changes', {
        active_group_id,
        change_count: changes.length,
        occupied_bounds: painter_document_runtime.document.occupied_bounds,
        history_size: get_total_group_history_entries(),
      });
    log_runtime_summary('authored group cell changes applied summary');
    return true;
  }

  function quantizeCellDirectColorsToIndexed(cell: GridCell): GridCell {
    const next: GridCell = {
      char: cell.char,
      graphic: cell.graphic ? { ...cell.graphic } : undefined,
      appearance_slots: clone_appearance_slot_assignments(cell.appearance_slots),
      materials: cell.materials ? { ...cell.materials } : undefined,
      rgb: nearest_indexed_rgb(cell.rgb),
      weight_index: cell.weight_index,
      render_index: cell.render_index,
    };
    if (next.appearance_slots) {
      for (const [slot, value] of Object.entries(next.appearance_slots)) {
        if (!value || value.kind !== 'flat_rgb') continue;
        next.appearance_slots[Number(slot) as 1 | 2 | 3] = { kind: 'flat_rgb', rgb: nearest_indexed_rgb(value.rgb) };
      }
    }
    return next;
  }

  function cells_match_for_flatten(a: GridCell, b: GridCell): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function flattenPainterDocumentColorsToIndexed(): boolean {
    finalizePendingPainterCanvasChanges();
    commitProjectedGridToWorld();
    const ordered_group_ids = painter_document_runtime.document.group_order.filter((group_id) => !!painter_document_runtime.document.groups[group_id]);
    let applied_any = false;
    for (const group_id of ordered_group_ids) {
      const group = painter_document_runtime.document.groups[group_id];
      if (!group || group.locked || !group.visible) continue;
      const visible_voxels = painter_document_runtime.group_voxel_index.get(group_id);
      if (!visible_voxels || visible_voxels.size < 1) continue;
      const changes: Array<{ worldX: number; worldY: number; worldZ: number; newCell: GridCell }> = [];
      for (const voxel of visible_voxels.values()) {
        const oldCell = make_history_cell_from_runtime_record(voxel);
        const newCell = quantizeCellDirectColorsToIndexed(oldCell);
        if (cells_match_for_flatten(oldCell, newCell)) continue;
        changes.push({
          worldX: voxel.x,
          worldY: voxel.y,
          worldZ: voxel.z,
          newCell,
        });
      }
      if (changes.length < 1) continue;
      const { applied, history_changes, rejected_reason } = painter_session_core.apply_cell_changes(group_id, painter_current_breath, changes, {
        auto_key: painter_groups_auto_key_enabled,
      });
      if (!applied) {
        painterDiag('flatten to indexed rejected for group', { group_id, rejected_reason, change_count: changes.length, active_breath: painter_current_breath });
        continue;
      }
      if (history_changes.length > 0) {
        logCellAction(history, 'draw_cells', `Flatten ${group.name} To Indexed`, { group_id }, history_changes);
      }
      applied_any = true;
    }
    if (!applied_any) return false;
    sync_local_session_state_from_core();
    sync_lineage_state_from_core();
    sync_painter_runtime_after_mutation({ preserve_group_order: true, focus_active_group: true });
    log_runtime_summary('flatten painter document to indexed summary');
    schedule_auto_save();
    return true;
  }

  function get_palette_group_entries(): Array<{ group_id: string; legacy_z: number; fake_z: number; layer: VoxelLayer }> {
    const entries: Array<{ group_id: string; legacy_z: number; fake_z: number; layer: VoxelLayer }> = [];
    const orderedGroupIds = painter_document_runtime.document.group_order.filter((group_id) => !!painter_document_runtime.document.groups[group_id]);
    const count = orderedGroupIds.length;
    for (let index = 0; index < count; index += 1) {
      const group_id = orderedGroupIds[index]!;
      const group = painter_document_runtime.document.groups[group_id];
      if (!group) continue;
      const legacy_z = get_legacy_z_for_group_id(group_id) ?? index;
      entries.push({
        group_id,
        legacy_z,
        fake_z: index,
        layer: {
          z: legacy_z,
          name: group.name,
          visible: group.visible,
          opacity: group.opacity,
          locked: group.locked,
          cells: [],
        },
      });
    }
    return entries;
  }

  function get_group_entry_for_palette_z(fake_z: number): { group_id: string; legacy_z: number; fake_z: number; layer: VoxelLayer } | null {
    return get_palette_group_entries().find((entry) => entry.fake_z === fake_z) ?? null;
  }

  function get_palette_z_for_group_id(group_id: string | null | undefined): number | null {
    return get_palette_group_entries().find((entry) => entry.group_id === group_id)?.fake_z ?? null;
  }

  function resolve_current_runtime_group_id(): string | null {
    const active_group_id = legacy_group_compat.active_group_id;
    if (active_group_id && painter_document_runtime.document.groups[active_group_id]) return active_group_id;
    const tail_group_id = painter_document_runtime.document.group_order[painter_document_runtime.document.group_order.length - 1] ?? null;
    if (tail_group_id && painter_document_runtime.document.groups[tail_group_id]) {
      legacy_group_compat.active_group_id = tail_group_id;
      return tail_group_id;
    }
    const first_group_id = painter_document_runtime.document.group_order[0] ?? null;
    if (first_group_id && painter_document_runtime.document.groups[first_group_id]) {
      legacy_group_compat.active_group_id = first_group_id;
      return first_group_id;
    }
    return null;
  }

  function get_active_group_selection(): WorldSelection {
    const active_group_id = resolve_current_runtime_group_id();
    if (!active_group_id) return create_world_selection();
    const groupIndex = painter_document_runtime.group_voxel_index.get(active_group_id);
    if (!groupIndex) return create_world_selection();
    const next = create_world_selection();
    for (const key of get_local_world_selection().cells) {
      const point = parse_world_cell_key(key);
      const coordKey = `${point.x}:${point.y}:${point.z}`;
      if (!groupIndex.has(coordKey)) continue;
      next.cells.add(key);
    }
    return next;
  }

  function get_active_group_world_copy_data(): WorldCopyData | null {
    const active_group_id = resolve_current_runtime_group_id();
    if (!active_group_id) return null;
    const groupIndex = painter_document_runtime.group_voxel_index.get(active_group_id);
    if (!groupIndex) return null;
    const active_group_selection = get_active_group_selection();
    const points: Array<{ x: number; y: number; z: number; cell: GridCell }> = [];
    for (const key of active_group_selection.cells) {
      const point = parse_world_cell_key(key);
      const coordKey = `${point.x}:${point.y}:${point.z}`;
      const record = groupIndex.get(coordKey);
      if (!record) continue;
      points.push({
        x: point.x,
        y: point.y,
        z: point.z,
        cell: make_history_cell_from_runtime_record(record),
      });
    }
    if (points.length < 1) return null;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    for (const point of points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      minZ = Math.min(minZ, point.z);
    }
    const anchor = { x: minX, y: minY, z: minZ };
    return {
      anchor,
      source_view: make_place_view_state(getPainterDisplayViewState().principal_view, getPainterDisplayViewState().roll_quarter_turn),
      cells: points.map((point) => ({
        dx: point.x - anchor.x,
        dy: point.y - anchor.y,
        dz: point.z - anchor.z,
        cell: make_history_cell_from_runtime_record(point.cell),
      })),
    };
  }

  function get_active_group_selected_world_voxels(): Array<{ x: number; y: number; z: number; cell: GridCell }> {
    const active_group_id = resolve_current_runtime_group_id();
    if (!active_group_id) return [];
    const groupIndex = painter_document_runtime.group_voxel_index.get(active_group_id);
    if (!groupIndex) return [];
    const selection = get_active_group_selection();
    const out: Array<{ x: number; y: number; z: number; cell: GridCell }> = [];
    for (const key of selection.cells) {
      const point = parse_world_cell_key(key);
      const record = groupIndex.get(`${point.x}:${point.y}:${point.z}`);
      if (!record) continue;
      out.push({
        x: point.x,
        y: point.y,
        z: point.z,
        cell: make_history_cell_from_runtime_record(record),
      });
    }
    return out;
  }

  function get_active_group_world_bounds(): { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number } | null {
    const active_group_id = resolve_current_runtime_group_id();
    if (!active_group_id) return null;
    const bounds = painter_document_runtime.resolved_group_bounds_index.get(active_group_id) ?? null;
    return bounds ? { ...bounds } : null;
  }

  function for_each_active_group_world_position(callback: (world: { x: number; y: number; z: number }) => void): void {
    const bounds = get_active_group_world_bounds();
    if (!bounds) return;
    for (let z = bounds.minZ; z <= bounds.maxZ; z += 1) {
      for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
        for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
          callback({ x, y, z });
        }
      }
    }
  }

  function getPainterGroupDisplayOrder(): string[] {
    return [...painter_document_runtime.document.group_order]
      .filter((group_id) => !!painter_document_runtime.document.groups[group_id])
      .reverse();
  }

  function mapGroupDisplayOrderToRuntimeOrder(display_group_order: string[]): string[] {
    return [...display_group_order].reverse();
  }

  function getDominantRasterBlockRgb(block: { type: string; value?: unknown }): { r: number; g: number; b: number } | undefined {
    if (block.type !== 'content') return undefined;
    const value = block.value as { kind?: string; voxels?: Array<{ rgb: { r: number; g: number; b: number } }> } | undefined;
    if (value?.kind !== 'raster' || !Array.isArray(value.voxels) || value.voxels.length < 1) return undefined;
    const counts = new Map<string, { rgb: { r: number; g: number; b: number }; count: number; firstIndex: number }>();
    value.voxels.forEach((voxel, index) => {
      const rgb = voxel.rgb;
      const key = `${Math.floor(rgb.r)},${Math.floor(rgb.g)},${Math.floor(rgb.b)}`;
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { rgb: { r: Math.floor(rgb.r), g: Math.floor(rgb.g), b: Math.floor(rgb.b) }, count: 1, firstIndex: index });
    });
    let winner: { rgb: { r: number; g: number; b: number }; count: number; firstIndex: number } | null = null;
    for (const entry of counts.values()) {
      if (!winner || entry.count > winner.count || (entry.count === winner.count && entry.firstIndex < winner.firstIndex)) winner = entry;
    }
    return winner?.rgb;
  }

  function getPainterGroupListItems(): GroupListItem[] {
    const displayOrder = getPainterGroupDisplayOrder();
    return displayOrder.map((group_id) => {
      const group = painter_document_runtime.document.groups[group_id]!;
      const groupBreathRange = derive_group_breath_range(group);
      const propertyRows: NonNullable<GroupListItem['property_rows']> = group.property_ids
        .map((property_id) => group.properties[property_id] ?? null)
        .filter((property): property is NonNullable<typeof property> & { kind: 'raster' | 'move' } => !!property && (property.kind === 'raster' || property.kind === 'move'))
        .map((property) => ({
          property_id: property.id,
          kind: property.kind,
          label: property.label,
          blocks: property.blocks
            .map((block) => ({
              id: block.id,
              breath: block.start,
              start: block.start,
              end: block.end,
              is_blank: block.type === 'blank',
              dominant_rgb: property.kind === 'raster' ? getDominantRasterBlockRgb(block) : undefined,
            })),
        }));
      return {
        id: group_id,
        label: group.name,
        selected: legacy_group_compat.active_group_id === group_id,
        selected_property_id: legacy_group_compat.active_group_id === group_id ? active_group_property_id ?? undefined : undefined,
        group_start: groupBreathRange.start,
        cropped_start: groupBreathRange.cropped_start,
        cropped_end: groupBreathRange.cropped_end,
        derivative_end: groupBreathRange.derivative_end,
        visible: group.visible,
        locked: group.locked,
        can_delete: displayOrder.length > 1,
        breath_start: groupBreathRange.cropped_start,
        breath_end: groupBreathRange.cropped_end,
        property_rows: propertyRows,
      };
    });
  }

  function getPainterGroupsTimelineVisibleSpan(): number {
    const groupsRect = layer_palette_module?.rect ?? layer_palette_rect;
    return Math.max(1, resolve_groups_timeline_visible_span(groupsRect));
  }

  function setCurrentPainterBreath(nextBreath: number): void {
    const normalized = clampPainterBreathToNonNegative(nextBreath);
    if (normalized === painter_current_breath) return;
    syncActivePainterBreathAcrossState(normalized);
    const visibleSpan = getPainterGroupsTimelineVisibleSpan();
    const visibleEnd = painter_timeline_view_start_breath + visibleSpan - 1;
    if (painter_current_breath < painter_timeline_view_start_breath) painter_timeline_view_start_breath = painter_current_breath;
    else if (painter_current_breath > visibleEnd) painter_timeline_view_start_breath = Math.max(0, painter_current_breath - visibleSpan + 1);
    ensureValidFocusPlane();
    refreshPainterProjectionFromWorld();
    painterDiag('current painter breath changed', { breath: painter_current_breath });
  }

  function stepCurrentPainterBreath(delta: number): void {
    if (!Number.isFinite(delta) || delta === 0) return;
    setCurrentPainterBreath(painter_current_breath + Math.trunc(delta));
  }

  function setPainterTimelineViewStart(nextStart: number): void {
    const fileRange = getPainterDocumentFileBreathRange();
    const loopRange = getPainterDocumentBreathRange();
    painter_timeline_view_start_breath = Math.max(0, Math.min(Math.max(fileRange.end, loopRange.end, painter_current_breath), Math.floor(nextStart)));
  }

  function applyPainterDocumentTiming(args: {
    breath_range_start: number;
    breath_range_end: number;
    frames_per_breath: number;
    loop_enabled: boolean;
  }): void {
    painter_session_core.apply_group_command({ kind: 'set_document_timing', ...args });
    sync_local_session_state_from_core();
    sync_lineage_state_from_core();
    sync_painter_runtime_after_mutation({ preserve_group_order: true });
    schedule_auto_save();
    submit_group_command_if_authoritative({ kind: 'set_document_timing', ...args });
  }

  function setPainterDocumentTiming(args: {
    breath_range_start: number;
    breath_range_end: number;
    frames_per_breath: number;
    loop_enabled: boolean;
  }): void {
    applyPainterDocumentTiming({
      breath_range_start: Math.max(0, Math.floor(args.breath_range_start)),
      breath_range_end: Math.max(0, Math.floor(args.breath_range_end)),
      frames_per_breath: Math.max(1, Math.floor(args.frames_per_breath)),
      loop_enabled: args.loop_enabled,
    });
  }

  function setPainterDocumentLoopWindow(args: {
    breath_start: number;
    breath_end: number;
  }): void {
    const normalizedStart = Math.max(0, Math.floor(args.breath_start));
    const normalizedEnd = Math.max(normalizedStart, Math.floor(args.breath_end));
    painter_session_core.apply_group_command({ kind: 'set_document_loop_window', breath_start: normalizedStart, breath_end: normalizedEnd });
    sync_local_session_state_from_core();
    sync_lineage_state_from_core();
    sync_painter_runtime_after_mutation({ preserve_group_order: true });
    schedule_auto_save();
    submit_group_command_if_authoritative({ kind: 'set_document_loop_window', breath_start: normalizedStart, breath_end: normalizedEnd });
  }

  function setPainterDocumentTimingPreservingLoop(args: {
    breath_range_start: number;
    breath_range_end: number;
    frames_per_breath: number;
    loop_enabled: boolean;
  }): void {
    const previousLoop = getPainterDocumentBreathRange();
    setPainterDocumentTiming(args);
    setPainterDocumentLoopWindow({
      breath_start: previousLoop.start,
      breath_end: previousLoop.end,
    });
  }

  function fitPainterDocumentTimingToContent(): void {
    const suggested = derive_painter_document_suggested_breath_range(painter_document_runtime.document);
    setPainterDocumentLoopWindow({
      breath_start: suggested.start,
      breath_end: suggested.end,
    });
  }

  function togglePainterPlayback(): void {
    if (painter_playback_running) {
      stopPainterPlayback();
      return;
    }
    painter_playback_running = true;
    painter_playback_frame_carry = 0;
    setCurrentPainterBreath(painter_current_breath);
  }

  window.setInterval(() => {
    if (!painter_playback_running) return;
    const step = step_painter_breath_playback({
      document: painter_document_runtime.document,
      current_breath: painter_current_breath,
      frame_carry: painter_playback_frame_carry,
      elapsed_frames: 1,
    });
    painter_playback_frame_carry = step.frame_carry;
    if (step.next_breath !== painter_current_breath) {
      setCurrentPainterBreath(step.next_breath);
    }
    if (step.is_finished) stopPainterPlayback();
  }, Math.floor(1000 / 60));

  function cloneLocationOffset(offset: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    return { x: Math.floor(offset.x), y: Math.floor(offset.y), z: Math.floor(offset.z) };
  }

  function resolveEditableGroupLocationBreath(group_id: string): number | null {
    const group = painter_document_runtime.document.groups[group_id];
    if (!group) return null;
    if (painter_groups_auto_key_enabled) return painter_current_breath;
    const nearest = resolve_nearest_painter_group_move_block(group, painter_current_breath);
    return nearest?.breath ?? null;
  }

  function resolveEditableGroupContentBreath(group_id: string): number | null {
    const group = painter_document_runtime.document.groups[group_id];
    if (!group) return null;
    if (painter_groups_auto_key_enabled) return painter_current_breath;
    const nearest = resolve_nearest_painter_group_raster_state(group, painter_current_breath);
    return nearest ? (derive_group_raster_segment_ranges(group).find((segment) => segment.segment_id === nearest.id)?.start ?? null) : null;
  }

  function ensureEditableContentStateForGroup(group_id: string): boolean {
    const group = painter_document_runtime.document.groups[group_id];
    if (!group) return false;
    const targetBreath = resolveEditableGroupContentBreath(group_id);
    if (targetBreath === null) return false;
    if (targetBreath !== painter_current_breath) setCurrentPainterBreath(targetBreath);
    const refreshedGroup = painter_document_runtime.document.groups[group_id];
    if (!refreshedGroup) return false;
    const exact = get_exact_painter_group_raster_state(refreshedGroup, painter_current_breath);
    if (exact) return true;
    const resolved = get_painter_group_raster_state_at_breath(refreshedGroup, painter_current_breath)
      ?? null;
    if (!resolved) return false;
    const oldGroupData = structuredClone(refreshedGroup);
    painter_session_core.apply_group_command({
      kind: 'set_group_raster_state',
      group_id,
      breath: painter_current_breath,
      voxels: resolved.content.map(clone_painter_voxel_record),
    });
    sync_local_session_state_from_core();
    sync_lineage_state_from_core();
    const newGroupData = painter_document_runtime.document.groups[group_id] ? structuredClone(painter_document_runtime.document.groups[group_id]!) : undefined;
    logGroupAction(history, 'set_group_raster_state', `Edit Raster State ${refreshedGroup.name}`, {
      groupId: group_id,
      oldGroupData,
      newGroupData,
    });
    sync_painter_runtime_after_mutation({ preserve_group_order: true, focus_active_group: true });
    submit_group_command_if_authoritative({
      kind: 'set_group_raster_state',
      group_id,
      breath: painter_current_breath,
      voxels: resolved.content.map(clone_painter_voxel_record),
    });
    painterDiag('ensured editable content state for group', {
      group_id,
      breath: painter_current_breath,
      auto_key: painter_groups_auto_key_enabled,
      cloned_from_breath: derive_group_raster_segment_ranges(refreshedGroup).find((segment) => segment.segment_id === resolved.id)?.start ?? painter_current_breath,
    });
    return true;
  }

  function applyPainterGroupLocationDelta(group_id: string, delta: { x: number; y: number; z: number }, source: 'nudge' | 'drag'): boolean {
    const group = painter_document_runtime.document.groups[group_id];
    if (!group || group.locked) return false;
    const targetBreath = resolveEditableGroupLocationBreath(group_id);
    if (targetBreath === null) {
      painterDiag('skipping group location edit: no editable move block', {
        group_id,
        source,
        active_breath: painter_current_breath,
        auto_key: painter_groups_auto_key_enabled,
      });
      return false;
    }
    if (targetBreath !== painter_current_breath) setCurrentPainterBreath(targetBreath);
    if (delta.x === 0 && delta.y === 0 && delta.z === 0) return false;
    const oldGroupData = structuredClone(group);
    const resolvedBase = resolve_painter_group_location_at_breath(group, targetBreath);
    const targetMoveBlock = resolve_nearest_painter_group_move_block(group, targetBreath);
    const primaryMoveProperty = group.property_ids.map((propertyId) => group.properties[propertyId] ?? null).find((property) => property?.kind === 'move') ?? null;
    const targetPropertyId = targetMoveBlock?.property_id ?? primaryMoveProperty?.id ?? null;
    const nextOffset = {
      x: resolvedBase.x + Math.floor(delta.x),
      y: resolvedBase.y + Math.floor(delta.y),
      z: resolvedBase.z + Math.floor(delta.z),
    };
    painter_session_core.apply_group_command({
      kind: 'set_group_property_block',
      group_id,
      property_kind: 'move',
      property_id: targetPropertyId ?? undefined,
      property_label: primaryMoveProperty?.label ?? 'move',
      breath: targetBreath,
      value: { kind: 'vec3', x: nextOffset.x, y: nextOffset.y, z: nextOffset.z },
    });
    sync_local_session_state_from_core();
    sync_lineage_state_from_core();
    const newGroupData = painter_document_runtime.document.groups[group_id] ? structuredClone(painter_document_runtime.document.groups[group_id]!) : undefined;
    logGroupAction(history, 'set_group_property_block', `Move Group ${group.name}`, {
      groupId: group_id,
      oldGroupData,
      newGroupData,
    });
    sync_painter_runtime_after_mutation({ preserve_group_order: true, focus_active_group: true });
    submit_group_command_if_authoritative({
      kind: 'set_group_property_block',
      group_id,
      property_kind: 'move',
      property_id: targetPropertyId ?? undefined,
      property_label: primaryMoveProperty?.label ?? 'move',
      breath: targetBreath,
      value: { kind: 'vec3', x: nextOffset.x, y: nextOffset.y, z: nextOffset.z },
    });
    schedule_auto_save();
    painterDiag('group location edited', {
      group_id,
      source,
      target_breath: targetBreath,
      delta: cloneLocationOffset(delta),
      next_offset: cloneLocationOffset(nextOffset),
      auto_key: painter_groups_auto_key_enabled,
    });
    return true;
  }

  function nudgeActivePainterGroupLocation(direction: 'left' | 'right' | 'up' | 'down'): boolean {
    const group_id = resolve_current_runtime_group_id();
    if (!group_id) return false;
    const worldDelta = map_screen_direction_to_world_delta(getPainterViewState(), direction);
    return applyPainterGroupLocationDelta(group_id, worldDelta, 'nudge');
  }

  function nudgeActivePainterGroupDepth(direction: -1 | 1): boolean {
    const group_id = resolve_current_runtime_group_id();
    if (!group_id) return false;
    const basis = get_view_basis_for_state(getPainterViewState());
    const delta = {
      x: basis.forward.x * direction,
      y: basis.forward.y * direction,
      z: basis.forward.z * direction,
    };
    return applyPainterGroupLocationDelta(group_id, delta, 'nudge');
  }

  function movePainterGroupPropertyBlock(group_id: string, property_id: string, block_id: string, target_breath: number): void {
    finalizePendingPainterCanvasChanges();
    commitProjectedGridToWorld();
    const group = painter_document_runtime.document.groups[group_id];
    if (!group || group.locked) return;
    const property = group.properties?.[property_id] ?? null;
    const oldGroupData = structuredClone(group);
    if (!property) return;
    painterTimelineDiag('command_dispatch', {
      command_kind: 'move_group_property_block',
      group_id,
      property_id,
      block_id,
      target_breath: Math.max(0, Math.floor(target_breath)),
      current_breath: painter_current_breath,
      old_group_summary: summarizePainterTimelineGroup(oldGroupData),
    });
    painter_session_core.apply_group_command({ kind: 'move_group_property_block', group_id, property_id: property.id, block_id, target_breath });
    sync_local_session_state_from_core();
    sync_lineage_state_from_core();
    const newGroupData = painter_document_runtime.document.groups[group_id] ? structuredClone(painter_document_runtime.document.groups[group_id]!) : undefined;
    painterTimelineDiag('command_applied_local', {
      command_kind: 'move_group_property_block',
      group_id,
      property_id,
      block_id,
      target_breath: Math.max(0, Math.floor(target_breath)),
      current_breath: painter_current_breath,
      old_group_summary: summarizePainterTimelineGroup(oldGroupData),
      new_group_summary: newGroupData ? summarizePainterTimelineGroup(newGroupData) : null,
    });
    logGroupAction(history, 'set_group_property_block', `Move Property Block ${group.name}`, {
      groupId: group_id,
      oldGroupData,
      newGroupData,
    });
    sync_painter_runtime_after_mutation({ preserve_group_order: true, focus_active_group: true });
    submit_group_command_if_authoritative({ kind: 'move_group_property_block', group_id, property_id, block_id, target_breath });
    schedule_auto_save();
  }

  function removePainterGroupProperty(group_id: string, property_id: string): void {
    const group = painter_document_runtime.document.groups[group_id];
    if (!group || group.locked || !group.properties[property_id] || group.property_ids.length <= 1) return;
    const oldGroupData = structuredClone(group);
    painter_session_core.apply_group_command({ kind: 'remove_group_property', group_id, property_id });
    sync_local_session_state_from_core();
    sync_lineage_state_from_core();
    if (active_group_property_id === property_id) active_group_property_id = resolve_default_group_property_id(group_id);
    const newGroupData = painter_document_runtime.document.groups[group_id] ? structuredClone(painter_document_runtime.document.groups[group_id]!) : undefined;
    logGroupAction(history, 'reorder_groups', `Remove Property ${group.name}`, {
      groupId: group_id,
      oldGroupData,
      newGroupData,
    });
    sync_painter_runtime_after_mutation({ preserve_group_order: true, focus_active_group: true });
    schedule_auto_save();
  }

  const PAINTER_CAMERA_APP_ID = 'thaum_painter' as const;
  const PAINTER_CAMERA_LIMITS = get_camera_limit_profile(PAINTER_CAMERA_APP_ID);

  function getSavedPainterCameraConfig(): Partial<CameraConfig> {
    return get_camera_settings_for_app(PAINTER_CAMERA_APP_ID);
  }

  function persistPainterCameraConfig(partial: Partial<CameraConfig>): void {
    void save_camera_settings(PAINTER_APP_CONFIG.selected_data_slot, PAINTER_CAMERA_APP_ID, partial, active_profile_scope).catch(() => null);
  }

  function resetPainterCameraConfig(): void {
    void reset_camera_settings(PAINTER_APP_CONFIG.selected_data_slot, PAINTER_CAMERA_APP_ID, active_profile_scope).catch(() => null);
  }

  function clampPainterCameraScalar(value: number, limits: { min: number; max: number }): number {
    return Math.max(limits.min, Math.min(limits.max, value));
  }

  function sanitizePainterCameraConfig(config: Partial<typeof voxelSpace.camera> | null | undefined): Partial<typeof voxelSpace.camera> {
    if (!config) return {};
    const next: Partial<typeof voxelSpace.camera> = sanitize_camera_config_for_app(PAINTER_CAMERA_APP_ID, config);
    return next;
  }

  function getEffectivePainterCameraForProjection(): CameraConfig {
    return {
      ...painter_camera_state,
      movement_per_layer: clampPainterCameraScalar(painter_camera_state.movement_per_layer ?? 0, PAINTER_CAMERA_LIMITS.movement_per_layer),
      scale_per_layer: clampPainterCameraScalar(painter_camera_state.scale_per_layer ?? 0, PAINTER_CAMERA_LIMITS.scale_per_layer),
      mouse_angle_yaw_deg: clampPainterCameraScalar(painter_camera_state.mouse_angle_yaw_deg ?? 0, PAINTER_CAMERA_LIMITS.mouse_angle_yaw_deg),
      mouse_angle_pitch_deg: clampPainterCameraScalar(painter_camera_state.mouse_angle_pitch_deg ?? 0, PAINTER_CAMERA_LIMITS.mouse_angle_pitch_deg),
      mouse_angle_spring: clampPainterCameraScalar(painter_camera_state.mouse_angle_spring ?? 0, PAINTER_CAMERA_LIMITS.mouse_angle_spring),
      render_distance_planes: Math.round(clampPainterCameraScalar(painter_camera_state.render_distance_planes ?? 2, PAINTER_CAMERA_LIMITS.render_distance_planes)),
      calibration: {
        x: clampPainterCameraScalar(Math.round(painter_camera_state.calibration?.x ?? 0), PAINTER_CAMERA_LIMITS.calibration_x),
        y: clampPainterCameraScalar(Math.round(painter_camera_state.calibration?.y ?? 0), PAINTER_CAMERA_LIMITS.calibration_y),
      },
      parallax_size_enabled: painter_camera_state.parallax_size_enabled ?? false,
    };
  }

  function createSanitizedPainterCamera(overrides?: Partial<CameraConfig> | null | undefined): CameraConfig {
    const base = createDefaultCamera();
    return {
      ...base,
      ...sanitizePainterCameraConfig(base),
      ...(overrides ? sanitizePainterCameraConfig(overrides) : {}),
    };
  }

  let painter_camera_state: CameraConfig = createSanitizedPainterCamera();
  syncVoxelSpaceCameraFromPainterCamera();
  let painter_target_view = make_place_view_state(painter_camera_state.principal_view, painter_camera_state.roll_quarter_turn);
  let painter_display_view = make_place_view_state(painter_camera_state.principal_view, painter_camera_state.roll_quarter_turn);
  const painter_camera = create_module_3d_camera<PainterCameraSubject, PlaceViewState>({
    resolver: create_painter_camera_resolver({
      resolve_document_center: () => getPainterDocumentCenterWorld(),
      resolve_text_cursor: () => getPainterCanvasRuntimeApi()?.getTextCursorInteractionAnchor?.()?.world ?? null,
      resolve_tool_anchor: () => getPainterInteractionAnchor().world ?? null,
      get_view_state: () => getPainterDisplayViewState(),
    }),
    initial_orientation: painter_target_view,
    initial_frame_anchor_world: getPainterDocumentCenterWorld(),
    initial_focus_plane: Math.floor(painter_camera_state.focus_plane ?? getPainterDocumentCenterWorld().z),
    initial_follow_policy: get_painter_camera_boot_policy().follow_policy,
    initial_motion_style: get_painter_camera_boot_policy().motion_style,
    initial_subject: { kind: 'document_center' },
  });
  painter_camera.recenterOnSubject();

  function mergeSavedPainterCameraConfig(config: Partial<CameraConfig> | null | undefined): void {
    painter_camera_state = { ...painter_camera_state, ...sanitizePainterCameraConfig(painter_camera_state) };
    if (!config || Object.keys(config).length < 1) return;
    painter_camera_state = { ...painter_camera_state, ...sanitizePainterCameraConfig(config) };
    syncPainterViewStatesFromLegacyCamera();
    if (typeof config.use_focus_layer_opacity !== 'boolean' && typeof config.show_all_layers === 'boolean') {
      painter_camera_state.use_focus_layer_opacity = !config.show_all_layers;
    }
    syncVoxelSpaceCameraFromPainterCamera();
  }
  
  // Load saved camera configuration
  const savedCameraConfig = getSavedPainterCameraConfig();
  mergeSavedPainterCameraConfig(savedCameraConfig);
  void profile_scope_ready.then((profile_scope) => load_camera_settings(PAINTER_APP_CONFIG.selected_data_slot, PAINTER_CAMERA_APP_ID, profile_scope)).then((config) => {
    mergeSavedPainterCameraConfig(config);
    syncPainterCameraViewTransform();
  }).catch(() => null);
  painter_camera_state.mode = 'rotated_ortho';
  syncVoxelSpaceCameraFromPainterCamera();
  syncPainterCameraViewTransform();

  // Flag to prevent saving during initialization
  let isAppInitialized = false;
  // Set to true after a short delay to allow initial renders to complete
  setTimeout(() => {
    isAppInitialized = true;
  }, 500);

  // Create DOM-based voxel renderer for true off-grid rendering
  let domRenderer: VoxelDOMRenderer | null = null;
  let domRoot: HTMLElement | null = null;
  let painter_view_transition: PlaceCameraTransition | null = null;
  let last_pointer_x = Number.NaN;
  let last_pointer_y = Number.NaN;
  let dom_viewport: PainterDomViewport | null = null;
  sync_legacy_group_compat_state();
  let painter_display_projection!: PainterDisplayProjection;
  let active_transition_visual: {
    active: boolean;
    transition_euler: { x: number; y: number; z: number };
    visual_pivot_px: { x: number; y: number } | null;
  } = {
    active: false,
    transition_euler: { x: 0, y: 0, z: 0 },
    visual_pivot_px: null,
  };
  let painter_transition_anchor: {
    anchor: PainterInteractionAnchor;
    target_world: { x: number; y: number; z: number };
    projection_anchor_world: { x: number; y: number; z: number };
    visual_pivot_px: { x: number; y: number } | null;
  } | null = null;

  function isPainterDomRootConnected(container?: HTMLElement | null): boolean {
    if (!domRoot || !domRoot.isConnected) return false;
    if (!container) return true;
    return domRoot.parentElement === container;
  }

  function resetPainterDOMRendererState(): void {
    domRenderer = null;
    domRoot = null;
  }

  function getPainterDocumentBounds(): { minX: number; minY: number; width: number; height: number; minZ: number; maxZ: number } {
    return {
      minX: painter_document_runtime.document.bounds.minX,
      minY: painter_document_runtime.document.bounds.minY,
      width: painter_document_runtime.document.bounds.width,
      height: painter_document_runtime.document.bounds.height,
      minZ: painter_document_runtime.document.bounds.minZ,
      maxZ: painter_document_runtime.document.bounds.maxZ,
    };
  }

  function getPainterDocumentCenterWorld(): { x: number; y: number; z: number } {
    const bounds = getPainterDocumentBounds();
    return {
      x: bounds.minX + Math.floor((bounds.width - 1) / 2),
      y: bounds.minY + Math.floor((bounds.height - 1) / 2),
      z: bounds.minZ + Math.floor((bounds.maxZ - bounds.minZ) / 2),
    };
  }

  function normalizePainterWorld(world: { x: number; y: number; z: number } | null | undefined, fallback?: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    const safeFallback = fallback ?? getPainterDocumentCenterWorld();
    return {
      x: Number.isFinite(world?.x) ? Math.floor(world!.x) : safeFallback.x,
      y: Number.isFinite(world?.y) ? Math.floor(world!.y) : safeFallback.y,
      z: Number.isFinite(world?.z) ? Math.floor(world!.z) : safeFallback.z,
    };
  }

  // Calculate layout - positions are in grid coordinates
  // Total grid is 200x50, we center the canvas with padding
  let GRID_WIDTH: number = PAINTER_CONFIG.grid_width;
  let GRID_HEIGHT: number = PAINTER_CONFIG.grid_height;

  function get_default_canvas_rect(): Rect {
    return {
      x0: 20,
      y0: 4,
      x1: 99,
      y1: 43,
    };
  }

  const file_menu_rect: Rect = {
    x0: 0,
    y0: 0,
    x1: GRID_WIDTH - 1,
    y1: 2
  };

  let canvas_rect: Rect = getModulePosition('painter_canvas') ?? get_default_canvas_rect();
  const PAINTER_CANVAS_VIEW_ID = 'painter_canvas_view';

  function getPainterCameraProjectionView() {
    return painter_camera.getProjectionView();
  }

  function syncPainterCameraViewStateToLegacyCamera(): void {
    painter_camera_state.principal_view = painter_target_view.principal_view;
    painter_camera_state.roll_quarter_turn = painter_target_view.roll_quarter_turn;
    painter_camera_state.focus_plane = getPainterCameraProjectionView().focus_plane;
    syncVoxelSpaceCameraFromPainterCamera();
  }

  function setPainterTargetViewState(viewState: PlaceViewState): void {
    painter_target_view = make_place_view_state(viewState.principal_view, viewState.roll_quarter_turn);
    painter_camera.setOrientation(painter_target_view);
    syncPainterCameraViewStateToLegacyCamera();
  }

  function setPainterDisplayViewState(viewState: PlaceViewState): void {
    painter_display_view = make_place_view_state(viewState.principal_view, viewState.roll_quarter_turn);
  }

  function syncPainterViewStatesFromLegacyCamera(): void {
    const current = make_place_view_state(painter_camera_state.principal_view, painter_camera_state.roll_quarter_turn);
    setPainterTargetViewState(current);
    setPainterDisplayViewState(current);
    painter_camera.setFocusPlane(Math.floor(painter_camera_state.focus_plane ?? getPainterCameraProjectionView().focus_plane));
  }

  function getPainterViewState(): PlaceViewState {
    return painter_target_view;
  }

  function getPainterDisplayViewState(): PlaceViewState {
    return painter_display_view;
  }

  function getPainterTextCursorAnchor(): PainterInteractionAnchor | null {
    return getPainterCanvasRuntimeApi()?.getTextCursorInteractionAnchor?.() ?? null;
  }

  function activatePainterTextCursorCameraPolicy(): void {
    const policy = get_painter_camera_text_cursor_policy();
    painter_camera.setSubject({ kind: 'text_cursor' });
    painter_camera.setFollowPolicy(policy.follow_policy);
    painter_camera.setMotionStyle(policy.motion_style);
    painter_camera.recenterOnSubject();
  }

  function syncPainterToolCameraPolicy(): void {
    const textAnchor = getPainterTextCursorAnchor();
    const cameraView = getPainterCameraProjectionView();
    const currentSubject = cameraView.subject;
    if (textAnchor?.world) {
      if (!currentSubject || currentSubject.kind !== 'text_cursor') {
        activatePainterTextCursorCameraPolicy();
      } else if (cameraView.follow_active) {
        painter_camera.tick();
      }
      return;
    }
    if (currentSubject && currentSubject.kind === 'text_cursor') {
      const detachedPolicy = get_painter_camera_detached_policy();
      painter_camera.clearSubject();
      painter_camera.setFollowPolicy(detachedPolicy.follow_policy);
      painter_camera.setMotionStyle(detachedPolicy.motion_style);
    }
  }

  function handlePainterTextCursorAnchorChanged(_anchor: PainterInteractionAnchor | null): void {
    syncPainterToolCameraPolicy();
    refreshPainterProjectionFromWorld();
  }

  function getPainterInteractionAnchor(): PainterInteractionAnchor {
    const orchestratorAnchor = getPainterOrchestratorInteractionAnchor();
    if (orchestratorAnchor.world || orchestratorAnchor.screen) return orchestratorAnchor;
    const textAnchor = getPainterTextCursorAnchor();
    if (textAnchor) return textAnchor;
    return getPainterStableViewAnchor();
  }

  function getPainterOrchestratorInteractionAnchor(): PainterInteractionAnchor {
    const orchestratorTarget = getPainterOrchestratorResolvedTarget();
    if (!orchestratorTarget) {
      return { kind: 'viewport_center', screen: null, world: null };
    }
    return {
      kind: 'pointer',
      screen: orchestratorTarget.screen_position
        ? { x: orchestratorTarget.screen_position.x, y: orchestratorTarget.screen_position.y }
        : null,
      world: orchestratorTarget.world_position
        ? {
            x: orchestratorTarget.world_position.x,
            y: orchestratorTarget.world_position.y,
            z: orchestratorTarget.world_position.z,
          }
        : null,
    };
  }

  function getPainterOrchestratorResolvedTarget(): ResolvedTarget | null {
    return select_current_resolved_target({
      session_state: painter_interaction_session_state,
      hover_state: painter_interaction_hover_state,
    });
  }

  function getPainterOrchestratorFocusTargetWorld(viewState: PlaceViewState = getPainterDisplayViewState()): { x: number; y: number; z: number } | null {
    const orchestratorTarget = getPainterOrchestratorResolvedTarget();
    if (!orchestratorTarget?.world_position) return null;
    const plane = orchestratorTarget.target_type === 'painter_plane'
      ? orchestratorTarget.plane_coordinate
      : null;
    return getPainterPreviewFocusTargetWorld(orchestratorTarget.world_position, plane, viewState);
  }

  function getPainterViewportTiles(): { width: number; height: number } {
    if (!canvas_rect) {
      return { width: CANVAS_WIDTH, height: CANVAS_HEIGHT };
    }
    return {
      width: Math.max(1, canvas_rect.x1 - canvas_rect.x0 + 1),
      height: Math.max(1, canvas_rect.y1 - canvas_rect.y0 + 1),
    };
  }

  function getPainterAutomationCameraTarget(): { x: number; y: number; z: number } {
    return getPainterCanvasFrameAnchorWorld();
  }

  function getPainterPreservedCameraState(): {
    frame_anchor_world: { x: number; y: number; z: number };
    focus_world_plane: number;
  } {
    return {
      frame_anchor_world: { ...getPainterCanvasFrameAnchorWorld() },
      focus_world_plane: getPainterFocusWorldPlane(),
    };
  }

  function restorePainterCameraState(state: {
    frame_anchor_world: { x: number; y: number; z: number };
    focus_world_plane: number;
  } | null | undefined): void {
    const fallbackTarget = getPainterDocumentCenterWorld();
    const nextFrameAnchor = state?.frame_anchor_world ?? fallbackTarget;
    setPainterCameraFrameAnchorWorld(nextFrameAnchor);
    if (Number.isFinite(state?.focus_world_plane)) {
      setCurrentFocusWorldPlane(state!.focus_world_plane);
    } else {
      ensureValidFocusPlane();
    }
  }

  function setPainterWorldPlaneCoordinate(world: { x: number; y: number; z: number }, plane: number, viewState: PlaceViewState = getPainterDisplayViewState()): { x: number; y: number; z: number } {
    const axis = get_principal_view_plane_axis(viewState.principal_view);
    if (axis === 'x') return { ...world, x: Math.floor(plane) };
    if (axis === 'y') return { ...world, y: Math.floor(plane) };
    return { ...world, z: Math.floor(plane) };
  }

  function getPainterCanvasFrameAnchorWorld(): { x: number; y: number; z: number } {
    return normalizePainterWorld(getPainterCameraProjectionView().frame_anchor_world, getPainterDocumentCenterWorld());
  }

  function getPainterFocusWorldPlane(): number {
    return Math.floor(getPainterCameraProjectionView().focus_plane);
  }

  function getPainterPreviewFocusTargetWorld(interactionWorld: { x: number; y: number; z: number } | null, plane: number | null, viewState: PlaceViewState = getPainterDisplayViewState()): { x: number; y: number; z: number } {
    const frameWorld = getPainterCanvasFrameAnchorWorld();
    if (interactionWorld) {
      const normalizedInteraction = normalizePainterWorldTarget(interactionWorld, viewState);
      const axis = get_principal_view_plane_axis(viewState.principal_view);
      if (axis === 'x') return { ...frameWorld, x: normalizedInteraction.x };
      if (axis === 'y') return { ...frameWorld, y: normalizedInteraction.y };
      return { ...frameWorld, z: normalizedInteraction.z };
    }
    if (typeof plane === 'number') {
      return setPainterWorldPlaneCoordinate(frameWorld, plane, viewState);
    }
    return frameWorld;
  }

  function getPainterCanvasViewInstance(): ViewInstance {
    syncPainterToolCameraPolicy();
    return build_view_instance({
      module_id: 'painter_canvas',
      view_id: PAINTER_CANVAS_VIEW_ID,
      space_kind: 'hybrid',
      viewport_rect: canvas_rect,
      capabilities: {
        resolves_2d_targets: true,
        resolves_3d_targets: true,
        produces_drag_payloads: true,
        accepts_drag_payloads: true,
        supports_text_input: true,
        supports_wheel_depth: true,
        owns_view_instances: true,
      },
      camera_state: {
        frame_anchor: getPainterCanvasFrameAnchorWorld(),
        focus_target: getPainterOrchestratorFocusTargetWorld()
          ?? (painter_display_projection ? getPainterPreviewFocusTargetWorld(null, painter_display_projection.focus_world_plane) : getPainterCanvasFrameAnchorWorld()),
        focus_plane: painter_display_projection?.focus_world_plane ?? getPainterFocusWorldPlane(),
        orientation: getPainterDisplayViewState().principal_view,
        projection_mode: 'rotated_ortho',
        transition_state: painter_view_transition ? { active: true, kind: painter_view_transition.kind, phase: painter_view_transition.phase } : null,
      },
      content_ref: current_file_path ?? current_filename ?? 'painter_document',
    });
  }

  type PainterCanvasRuntimeApi = ReturnType<typeof make_painter_canvas_module> & {
    getTextCursorInteractionAnchor?: () => PainterInteractionAnchor | null;
    resolveInteractionTargets?: (x: number, y: number) => OrderedResolvedTargets;
  };

  function getPainterCanvasRuntimeApi(): PainterCanvasRuntimeApi | null {
    if (!canvas_module) return null;
    return canvas_module as PainterCanvasRuntimeApi;
  }

  function normalizePainterWorldTarget(world: { x: number; y: number; z: number }, viewState: PlaceViewState = getPainterDisplayViewState()): { x: number; y: number; z: number } {
    void viewState;
    return normalizePainterWorld(world, getPainterDocumentCenterWorld());
  }

  function setPainterCameraFrameAnchorWorld(world: WorldPoint3, options?: { detach_follow?: boolean }): void {
    const nextWorld = normalizePainterWorldTarget(world);
    painter_camera.setFrameAnchor(nextWorld);
    if (options?.detach_follow !== false) {
      const detachedPolicy = get_painter_camera_detached_policy();
      painter_camera.setFollowPolicy(detachedPolicy.follow_policy);
      painter_camera.setMotionStyle(detachedPolicy.motion_style);
      painter_camera.notifyManualPan();
    }
  }

  function setPainterCameraFrameAnchorFromPan(anchor: WorldPoint3, context: { source: 'screen_drag' | 'axis_step'; detach_follow: boolean }): void {
    const next = normalizePainterWorldTarget(anchor);
    setPainterCameraFrameAnchorWorld(next, { detach_follow: context.detach_follow });
    refreshPainterProjectionFromWorld(getPainterStableViewAnchor(), {
      persist_target_world: false,
      target_world: next,
      projection_anchor_world: next,
    });
  }

  function getPainterPanStepSizePx(): { x: number; y: number } {
    return {
      x: Number.isFinite(dom_viewport?.tileW) && (dom_viewport?.tileW ?? 0) > 0 ? Number(dom_viewport?.tileW) : 0,
      y: Number.isFinite(dom_viewport?.tileH) && (dom_viewport?.tileH ?? 0) > 0 ? Number(dom_viewport?.tileH) : 0,
    };
  }

  function syncCompatibilityFocusPlaneFromCameraTarget(viewState: PlaceViewState = getPainterDisplayViewState()): number {
    void viewState;
    const plane = getPainterFocusWorldPlane();
    painter_camera_state.focus_plane = plane;
    syncVoxelSpaceCameraFromPainterCamera();
    return plane;
  }

  function applyFocusWorldPlaneToProjection(worldPlane: number): void {
    if (!painter_display_projection) return;
    const focus = get_painter_focus_slot_for_anchor({
      view_state: painter_display_projection.view_state,
      visible_planes: painter_display_projection.visible_planes,
      fallback_world_plane: worldPlane,
    });
    painter_display_projection.focus_slot = focus.focus_slot;
    painter_display_projection.focus_world_plane = focus.focus_world_plane;
    painter_display_projection.scene.camera.focus_plane = focus.focus_slot;
  }

  function setCurrentFocusWorldPlane(worldPlane: number, options?: { persist?: boolean }): void {
    const nextPlane = Math.floor(worldPlane);
    painter_camera.setFocusPlane(nextPlane);
    painter_camera.notifyManualDepthChange();
    const compatibilityPlane = syncCompatibilityFocusPlaneFromCameraTarget();
    applyFocusWorldPlaneToProjection(compatibilityPlane);
    if (options?.persist && isAppInitialized) {
      persistPainterCameraConfig({ focus_plane: compatibilityPlane });
    }
  }

  function getPainterAnchorScreenPoint(anchor: PainterInteractionAnchor): { x: number; y: number } {
    if (anchor.world) {
      const gridPoint = painterWorldToGridPoint(anchor.world);
      if (gridPoint) {
        return {
          x: canvas_rect.x0 + gridPoint.x + 0.5,
          y: canvas_rect.y0 + gridPoint.y + 0.5,
        };
      }
    }
    return {
      x: (canvas_rect.x0 + canvas_rect.x1) / 2,
      y: (canvas_rect.y0 + canvas_rect.y1) / 2,
    };
  }

  function getPainterAnchorPivotPx(anchor: PainterInteractionAnchor): { x: number; y: number } | null {
    if (!dom_viewport) return null;
    const screen = getPainterAnchorScreenPoint(anchor);
    const tileW = Number.isFinite(dom_viewport.tileW) ? dom_viewport.tileW as number : 0;
    const tileH = Number.isFinite(dom_viewport.tileH) ? dom_viewport.tileH as number : 0;
    if (!(tileW > 0) || !(tileH > 0)) return null;
    return clamp_anchor_to_viewport_px({
      x: (screen.x - canvas_rect.x0) * tileW,
      y: (screen.y - canvas_rect.y0) * tileH,
    }, {
      width: dom_viewport.width,
      height: dom_viewport.height,
    });
  }

  function getPainterAnchorParallax(anchor: PainterInteractionAnchor, transitionActive: boolean): { x: number; y: number } {
    if (transitionActive) return { x: 0, y: 0 };
    const screen = getPainterAnchorScreenPoint(anchor);
    const pointer_x = Number.isFinite(last_pointer_x) ? last_pointer_x : screen.x;
    const pointer_y = Number.isFinite(last_pointer_y) ? last_pointer_y : screen.y;
    return compute_anchor_relative_mouse_parallax({
      viewport: canvas_rect,
      anchor_screen_x: screen.x,
      anchor_screen_y: screen.y,
      pointer_x,
      pointer_y,
    });
  }

  function syncPainterCameraViewTransform(state: PlaceViewState = getPainterViewState()): void {
    void state;
    painter_camera_state.mode = 'rotated_ortho';
    painter_camera_state.pan_x = 0;
    painter_camera_state.pan_y = 0;
    painter_camera_state.euler_rotation = { x: 0, y: 0, z: 0 };
    syncVoxelSpaceCameraFromPainterCamera();
  }

  function getCurrentPainterFocusSlot(): number {
    return painter_display_projection?.focus_slot ?? 0;
  }

  function shouldCenterPainterTarget(anchor: PainterInteractionAnchor): boolean {
    if (!(painter_camera_state.center_target_in_view ?? false)) return false;
    switch (anchor.kind) {
      case 'text_cursor':
        return true;
      default:
        return false;
    }
  }

  function rebuildPainterDisplayProjection(viewState: PlaceViewState, anchor: PainterInteractionAnchor, options?: {
    persist_target_world?: boolean;
    target_world?: { x: number; y: number; z: number } | null;
    projection_anchor_world?: { x: number; y: number; z: number } | null;
  }): PainterDisplayProjection {
    const requestedTargetWorld = options?.target_world ?? anchor.world ?? null;
    const targetWorld = requestedTargetWorld
      ? normalizePainterWorldTarget(requestedTargetWorld)
      : getPainterCanvasFrameAnchorWorld();
    const projectionAnchorWorld = options?.projection_anchor_world
      ? normalizePainterWorldTarget(options.projection_anchor_world)
      : getPainterCanvasFrameAnchorWorld();
    if (options?.persist_target_world !== false) {
      setPainterCameraFrameAnchorWorld(projectionAnchorWorld, { detach_follow: false });
    }
    const viewport = getPainterViewportTiles();
    const projected = project_painter_runtime_display_space({
      runtime: painter_document_runtime,
      view_state: viewState,
      focus_slot: 0,
      target_world: targetWorld,
      projection_anchor_world: projectionAnchorWorld,
      viewport_width: viewport.width,
      viewport_height: viewport.height,
      center_target_in_view: shouldCenterPainterTarget(anchor),
      render_distance_planes: getEffectivePainterCameraForProjection().render_distance_planes,
    });
    const previousAxis = painter_display_projection
      ? get_principal_view_plane_axis(painter_display_projection.view_state.principal_view)
      : null;
    const nextAxis = get_principal_view_plane_axis(viewState.principal_view);
    const axisChanged = previousAxis !== null && previousAxis !== nextAxis;
    const focus = get_painter_focus_slot_for_anchor({
      anchor_world: axisChanged ? targetWorld : undefined,
      view_state: viewState,
      visible_planes: projected.visible_planes,
      fallback_world_plane: getPainterFocusWorldPlane(),
    });
    projected.focus_slot = focus.focus_slot;
    projected.focus_world_plane = focus.focus_world_plane;
    projected.scene.camera.focus_plane = focus.focus_slot;
    const projectionSummary = {
      contributor_coords: painter_document_runtime.coordinate_group_index.size,
      resolved_coords: painter_document_runtime.resolved_visible_index.size,
      focus_world_plane: projected.focus_world_plane,
    };
    const signature = make_runtime_cell_signature(projectionSummary);
    if (signature !== last_projection_runtime_log_signature) {
      last_projection_runtime_log_signature = signature;
      painterDiag('rebuilt painter projection from runtime source', projectionSummary);
      painterRuntimeLog('rebuilt painter projection from runtime source', projectionSummary);
    }
    return projected;
  }

  function syncProjectedGridFromDisplay(): void {
    if (!painter_display_projection) return;
    sync_grid_to_painter_projection(grid, painter_display_projection);
  }

  function commitProjectedGridToWorld(): void {
    if (!painter_display_projection) return;
    commit_grid_to_painter_world({
      grid,
      projection: painter_display_projection,
    });
  }

  function applyPainterProjectedCameraTuning(args?: {
    transition_euler?: { x: number; y: number; z: number };
    visual_pivot_px?: { x: number; y: number } | null;
  }): void {
    if (!painter_display_projection) return;
    const projectedCamera = painter_display_projection.scene.camera;
    const effectiveCamera = getEffectivePainterCameraForProjection();
    projectedCamera.mode = 'rotated_ortho';
    (projectedCamera as any).pan_behavior = 'uniform';
    projectedCamera.pan_x = 0;
    projectedCamera.pan_y = 0;
    projectedCamera.show_all_layers = true;
    projectedCamera.use_focus_layer_opacity = effectiveCamera.use_focus_layer_opacity;
    projectedCamera.center_target_in_view = effectiveCamera.center_target_in_view;
    projectedCamera.parallax_intensity = effectiveCamera.parallax_intensity;
    projectedCamera.parallax_move_enabled = effectiveCamera.parallax_move_enabled;
    projectedCamera.parallax_size_enabled = effectiveCamera.parallax_size_enabled;
    projectedCamera.scale_per_layer = effectiveCamera.scale_per_layer;
    projectedCamera.movement_per_layer = effectiveCamera.movement_per_layer;
    projectedCamera.mouse_angle_yaw_deg = effectiveCamera.mouse_angle_yaw_deg;
    projectedCamera.mouse_angle_pitch_deg = effectiveCamera.mouse_angle_pitch_deg;
    projectedCamera.mouse_angle_spring = effectiveCamera.mouse_angle_spring;
    projectedCamera.base_layer_scale = effectiveCamera.base_layer_scale;
    projectedCamera.char_spacing_x = effectiveCamera.char_spacing_x;
    projectedCamera.char_spacing_y = effectiveCamera.char_spacing_y;
    projectedCamera.calibration = { ...effectiveCamera.calibration };
    projectedCamera.euler_rotation = { x: 0, y: 0, z: 0 };
    const nextTransitionEuler = args?.transition_euler
      ?? (active_transition_visual.active ? active_transition_visual.transition_euler : undefined)
      ?? painter_camera_state.transition_euler
      ?? { x: 0, y: 0, z: 0 };
    (projectedCamera as any).transition_euler = { ...nextTransitionEuler };
    const nextVisualPivot = args?.visual_pivot_px === undefined
      ? (active_transition_visual.active ? active_transition_visual.visual_pivot_px : getPainterAnchorPivotPx(getPainterOrchestratorInteractionAnchor().world ? getPainterOrchestratorInteractionAnchor() : getPainterInteractionAnchor()))
      : args.visual_pivot_px;
    if (nextVisualPivot) {
      (projectedCamera as any).visual_pivot_px = { ...nextVisualPivot };
    } else {
      delete (projectedCamera as any).visual_pivot_px;
    }
    const focusSlot = painter_display_projection.focus_slot;
    projectedCamera.focus_plane = focusSlot;
    for (const [slot, layer] of painter_display_projection.scene.slots.entries()) {
      if (!layer) continue;
      if (!(projectedCamera.use_focus_layer_opacity ?? true)) {
        layer.opacity = 1.0;
      } else if (slot === focusSlot) {
        layer.opacity = 1.0;
      } else {
        const dist = Math.abs(slot - focusSlot);
        layer.opacity = dist === 1 ? 0.62 : 0.45;
      }
    }

  }

  painter_display_projection = project_painter_runtime_display_space({
    runtime: painter_document_runtime,
    view_state: getPainterDisplayViewState(),
    focus_slot: 0,
    target_world: getPainterCanvasFrameAnchorWorld(),
    projection_anchor_world: getPainterCanvasFrameAnchorWorld(),
    viewport_width: Math.max(1, canvas_rect.x1 - canvas_rect.x0 + 1),
    viewport_height: Math.max(1, canvas_rect.y1 - canvas_rect.y0 + 1),
    render_distance_planes: getEffectivePainterCameraForProjection().render_distance_planes,
  });
  sync_grid_to_painter_projection(grid, painter_display_projection);

  function painterGridPointToWorld(x: number, y: number): { x: number; y: number; z: number } | null {
    if (!painter_display_projection) return null;
    return painter_projection_grid_point_to_world({ projection: painter_display_projection, x, y });
  }

  function painterWorldToGridPoint(world: { x: number; y: number; z: number }): { x: number; y: number } | null {
    if (!painter_display_projection) return null;
    return painter_projection_world_to_grid_point({ projection: painter_display_projection, world });
  }

  function finalizePendingPainterCanvasChanges(): void {
    const canvasWithFinalize = canvas_module as typeof canvas_module & { finalizePendingChanges?: () => void };
    canvasWithFinalize.finalizePendingChanges?.();
  }

  function refreshPainterProjectionFromWorld(anchor: PainterInteractionAnchor = getPainterStableViewAnchor(), options?: {
    persist_target_world?: boolean;
    target_world?: { x: number; y: number; z: number } | null;
    projection_anchor_world?: { x: number; y: number; z: number } | null;
  }): void {
    syncPainterToolCameraPolicy();
    painter_display_projection = rebuildPainterDisplayProjection(getPainterDisplayViewState(), anchor, options);
    syncProjectedGridFromDisplay();
    syncPainterCanvasSelectionFromWorld();
    applyPainterProjectedCameraTuning();
    syncDOMRenderer();
  }

  function getPainterStableViewAnchor(): PainterInteractionAnchor {
    return {
      kind: 'viewport_center',
      screen: null,
      world: getPainterCanvasFrameAnchorWorld(),
    };
  }

  function refreshPainterProjectionPreservingCameraFrame(): void {
    const targetWorld = getPainterOrchestratorFocusTargetWorld() ?? getPainterCanvasFrameAnchorWorld();
    refreshPainterProjectionFromWorld(getPainterStableViewAnchor(), {
      persist_target_world: false,
      target_world: targetWorld,
      projection_anchor_world: getPainterCanvasFrameAnchorWorld(),
    });
  }

  function createNextPainterGroupName(): string {
    return `Group ${painter_document_runtime.document.group_order.length + 1}`;
  }

  function focusActiveGroupPlane(): void {
    if (getPainterFocusPlaneAxis() !== 'z') return;
    const active_group_id = resolve_current_runtime_group_id();
    const selectedZ = get_legacy_z_for_group_id(active_group_id) ?? getPainterFocusWorldPlane();
    if (selectedZ !== null) {
      setCurrentFocusWorldPlane(selectedZ, { persist: true });
    }
  }

  function addPainterGroupStructure(): void {
    finalizePendingPainterCanvasChanges();
    commitProjectedGridToWorld();
    painterImportant('group add starting', {
      current_file_path,
      current_filename,
      active_group_id: legacy_group_compat.active_group_id,
    });
    const created = create_painter_group(createNextPainterGroupName(), {
      breath_start: painter_document_runtime.active_breath,
      breath_end: painter_document_runtime.active_breath,
    });
    const result = painter_session_core.apply_group_command({ kind: 'create_group', group: created });
    sync_local_session_state_from_core();
    sync_lineage_state_from_core();
    logGroupAction(history, 'create_group', `Create Group ${created.name}`, {
      groupId: result.created_group_id ?? created.id,
      newGroupData: created,
    });
    submit_group_command_if_authoritative({
      kind: 'create_group',
      group_name: created.name,
      target_group_id: result.created_group_id ?? created.id,
      breath_start: created.breath_start,
      breath_end: created.breath_end,
    });
    legacy_group_compat.active_group_id = result.created_group_id ?? created.id;
    sync_painter_runtime_after_mutation({ preserve_group_order: true, focus_active_group: true });
    schedule_auto_save();
    painterImportant('group added', { group_id: result.created_group_id ?? created.id, name: created.name });
    log_runtime_summary('group added summary');
  }

  function deletePainterGroupStructure(z: number): void {
    finalizePendingPainterCanvasChanges();
    commitProjectedGridToWorld();
    const entry = get_group_entry_for_palette_z(z);
    if (!entry) return;
    const oldGroupData = painter_document_runtime.document.groups[entry.group_id]
      ? structuredClone(painter_document_runtime.document.groups[entry.group_id]!)
      : undefined;
    painter_session_core.apply_group_command({ kind: 'delete_group', group_id: entry.group_id });
    sync_local_session_state_from_core();
    sync_lineage_state_from_core();
    logGroupAction(history, 'delete_group', `Delete Group ${oldGroupData?.name ?? entry.group_id}`, {
      groupId: entry.group_id,
      oldGroupData,
    });
    submit_group_command_if_authoritative({ kind: 'delete_group', group_id: entry.group_id });
    if (legacy_group_compat.active_group_id === entry.group_id) {
      legacy_group_compat.active_group_id = painter_document_runtime.document.group_order[0] ?? null;
    }
    sync_painter_runtime_after_mutation({ preserve_group_order: true, focus_active_group: true });
    schedule_auto_save();
    painterImportant('group deleted', { group_id: entry.group_id, z: entry.legacy_z });
    log_runtime_summary('group deleted summary');
  }

  function duplicatePainterGroupStructure(z: number): void {
    finalizePendingPainterCanvasChanges();
    commitProjectedGridToWorld();
    const entry = get_group_entry_for_palette_z(z);
    if (!entry) return;
    const result = painter_session_core.apply_group_command({ kind: 'duplicate_group', source_group_id: entry.group_id });
    sync_local_session_state_from_core();
    sync_lineage_state_from_core();
    const duplicatedId = result.created_group_id;
    const duplicated = duplicatedId ? structuredClone(painter_document_runtime.document.groups[duplicatedId]!) : null;
    if (!duplicated) return;
    logGroupAction(history, 'duplicate_group', `Duplicate Group ${duplicated.name}`, {
      sourceGroupId: entry.group_id,
      targetGroupId: duplicated.id,
      newGroupData: duplicated,
    });
    submit_group_command_if_authoritative({ kind: 'duplicate_group', source_group_id: entry.group_id, target_group_id: duplicated.id });
    legacy_group_compat.active_group_id = duplicated.id;
    sync_painter_runtime_after_mutation({ preserve_group_order: true, focus_active_group: true });
    schedule_auto_save();
    painterImportant('group duplicated', { source_group_id: entry.group_id, duplicated_group_id: duplicated.id });
    log_runtime_summary('group duplicated summary');
  }

  function addPainterGroup(): void {
    addPainterGroupStructure();
  }

  function deletePainterGroup(group_id: string): void {
    try {
      finalizePendingPainterCanvasChanges();
      commitProjectedGridToWorld();
      const oldGroupData = painter_document_runtime.document.groups[group_id]
        ? structuredClone(painter_document_runtime.document.groups[group_id]!)
        : undefined;
      if (!oldGroupData) return;
      painter_session_core.apply_group_command({ kind: 'delete_group', group_id });
      sync_local_session_state_from_core();
      sync_lineage_state_from_core();
      logGroupAction(history, 'delete_group', `Delete Group ${oldGroupData.name ?? group_id}`, {
        groupId: group_id,
        oldGroupData,
      });
      submit_group_command_if_authoritative({ kind: 'delete_group', group_id });
      if (legacy_group_compat.active_group_id === group_id) {
        legacy_group_compat.active_group_id = painter_document_runtime.document.group_order[0] ?? null;
      }
      sync_painter_runtime_after_mutation({ preserve_group_order: true, focus_active_group: true });
      schedule_auto_save();
      painterImportant('group deleted', { group_id });
      log_runtime_summary('group deleted summary');
    } catch (e) {
      diag_log('painter', 'important', 'PAINTER', 'cannot delete group', { group_id, error: e instanceof Error ? e.message : String(e) }, { sink: 'error' });
    }
  }

  function duplicatePainterGroup(group_id: string): void {
    finalizePendingPainterCanvasChanges();
    commitProjectedGridToWorld();
    const result = painter_session_core.apply_group_command({ kind: 'duplicate_group', source_group_id: group_id });
    sync_local_session_state_from_core();
    sync_lineage_state_from_core();
    const duplicatedId = result.created_group_id;
    const duplicated = duplicatedId ? structuredClone(painter_document_runtime.document.groups[duplicatedId]!) : null;
    if (!duplicated) return;
    logGroupAction(history, 'duplicate_group', `Duplicate Group ${duplicated.name}`, {
      sourceGroupId: group_id,
      targetGroupId: duplicated.id,
      newGroupData: duplicated,
    });
    submit_group_command_if_authoritative({ kind: 'duplicate_group', source_group_id: group_id, target_group_id: duplicated.id });
    legacy_group_compat.active_group_id = duplicated.id;
    sync_painter_runtime_after_mutation({ preserve_group_order: true, focus_active_group: true });
    schedule_auto_save();
    painterImportant('group duplicated', { source_group_id: group_id, duplicated_group_id: duplicated.id });
    log_runtime_summary('group duplicated summary');
  }

  function selectPainterGroup(group_id: string): void {
    finalizePendingPainterCanvasChanges();
    commitProjectedGridToWorld();
    rebuild_runtime_group_plane_registry({ preserve_existing: true });
    legacy_group_compat.active_group_id = group_id;
    active_group_property_id = resolve_default_group_property_id(group_id);
    ensureValidFocusPlane();
    refreshPainterProjectionFromWorld();
    painterDiag('group selected', { group_id, focus_plane: voxelSpace.camera.focus_plane });
  }

  function selectPainterGroupProperty(group_id: string, property_id: string): void {
    if (legacy_group_compat.active_group_id !== group_id) selectPainterGroup(group_id);
    const group = painter_document_runtime.document.groups[group_id];
    if (!group?.properties[property_id]) return;
    active_group_property_id = property_id;
    painterDiag('group property selected', { group_id, property_id });
  }

  function togglePainterGroupVisibility(group_id: string): void {
    finalizePendingPainterCanvasChanges();
    commitProjectedGridToWorld();
    const group = painter_document_runtime.document.groups[group_id];
    if (!group) return;
    const oldGroupData = structuredClone(group);
    painter_session_core.apply_group_command({ kind: 'set_group_visibility', group_id, visible: !group.visible });
    sync_local_session_state_from_core();
    sync_lineage_state_from_core();
    const newGroupData = painter_document_runtime.document.groups[group_id] ? structuredClone(painter_document_runtime.document.groups[group_id]!) : undefined;
    logGroupAction(history, 'set_group_visibility', `Toggle Group Visibility ${group.name}`, {
      groupId: group_id,
      oldGroupData,
      newGroupData,
    });
    submit_group_command_if_authoritative({ kind: 'set_group_visibility', group_id, visible: Boolean(newGroupData?.visible) });
    sync_painter_runtime_after_mutation({ preserve_group_order: true });
    schedule_auto_save();
    painterDiag('group visibility toggled', { group_id, visible: Boolean(newGroupData?.visible) });
  }

  function togglePainterGroupLock(group_id: string): void {
    finalizePendingPainterCanvasChanges();
    commitProjectedGridToWorld();
    const group = painter_document_runtime.document.groups[group_id];
    if (!group) return;
    const oldGroupData = structuredClone(group);
    painter_session_core.apply_group_command({ kind: 'set_group_locked', group_id, locked: !group.locked });
    sync_local_session_state_from_core();
    sync_lineage_state_from_core();
    const newGroupData = painter_document_runtime.document.groups[group_id] ? structuredClone(painter_document_runtime.document.groups[group_id]!) : undefined;
    logGroupAction(history, 'set_group_locked', `Toggle Group Lock ${group.name}`, {
      groupId: group_id,
      oldGroupData,
      newGroupData,
    });
    submit_group_command_if_authoritative({ kind: 'set_group_locked', group_id, locked: Boolean(newGroupData?.locked) });
    sync_painter_runtime_after_mutation({ preserve_group_order: true });
    schedule_auto_save();
    painterDiag('group lock toggled', { group_id, locked: Boolean(newGroupData?.locked) });
  }

  function setPainterGroupBreathSpan(group_id: string, breath_start: number, breath_end: number): void {
    finalizePendingPainterCanvasChanges();
    commitProjectedGridToWorld();
    const group = painter_document_runtime.document.groups[group_id];
    if (!group) return;
    const oldGroupData = structuredClone(group);
    painter_session_core.apply_group_command({
      kind: 'set_group_breath_span',
      group_id,
      breath_start,
      breath_end,
    });
    sync_local_session_state_from_core();
    sync_lineage_state_from_core();
    const newGroupData = painter_document_runtime.document.groups[group_id] ? structuredClone(painter_document_runtime.document.groups[group_id]!) : undefined;
    logGroupAction(history, 'set_group_breath_span', `Set Group Span ${group.name}`, {
      groupId: group_id,
      oldGroupData,
      newGroupData,
    });
    submit_group_command_if_authoritative({
      kind: 'set_group_breath_span',
      group_id,
      breath_start: Math.max(0, Math.floor(newGroupData?.breath_start ?? breath_start)),
      breath_end: Math.max(0, Math.floor(newGroupData?.breath_end ?? breath_end)),
    });
    sync_painter_runtime_after_mutation({ preserve_group_order: true, focus_active_group: true });
    schedule_auto_save();
    painterDiag('group breath span changed', {
      group_id,
      breath_start: newGroupData?.breath_start ?? null,
      breath_end: newGroupData?.breath_end ?? null,
    });
  }

  function setPainterGroupTiming(group_id: string, args: { start: number; cropped_start: number; cropped_end: number }): void {
    finalizePendingPainterCanvasChanges();
    commitProjectedGridToWorld();
    const group = painter_document_runtime.document.groups[group_id];
    if (!group) return;
    const oldGroupData = structuredClone(group);
    painter_session_core.apply_group_command({ kind: 'set_group_timing', group_id, ...args });
    sync_local_session_state_from_core();
    sync_lineage_state_from_core();
    const newGroupData = painter_document_runtime.document.groups[group_id] ? structuredClone(painter_document_runtime.document.groups[group_id]!) : undefined;
    logGroupAction(history, 'set_group_timing', `Set Group Timing ${group.name}`, {
      groupId: group_id,
      oldGroupData,
      newGroupData,
    });
    submit_group_command_if_authoritative({
      kind: 'set_group_timing',
      group_id,
      start: Math.max(0, Math.floor(newGroupData?.start ?? args.start)),
      cropped_start: Math.max(0, Math.floor(newGroupData?.cropped_start ?? args.cropped_start)),
      cropped_end: Math.max(0, Math.floor(newGroupData?.cropped_end ?? args.cropped_end)),
    });
    sync_painter_runtime_after_mutation({ preserve_group_order: true, focus_active_group: true });
    schedule_auto_save();
  }

  function offsetPainterGroupInTime(group_id: string, delta_breaths: number): void {
    finalizePendingPainterCanvasChanges();
    commitProjectedGridToWorld();
    const group = painter_document_runtime.document.groups[group_id];
    if (!group) return;
    const oldGroupData = structuredClone(group);
    painter_session_core.apply_group_command({ kind: 'offset_group_in_time', group_id, delta_breaths });
    sync_local_session_state_from_core();
    sync_lineage_state_from_core();
    const newGroupData = painter_document_runtime.document.groups[group_id] ? structuredClone(painter_document_runtime.document.groups[group_id]!) : undefined;
    logGroupAction(history, 'offset_group_in_time', `Offset Group In Time ${group.name}`, {
      groupId: group_id,
      oldGroupData,
      newGroupData,
    });
    submit_group_command_if_authoritative({
      kind: 'offset_group_in_time',
      group_id,
      delta_breaths: Math.floor(delta_breaths),
    });
    sync_painter_runtime_after_mutation({ preserve_group_order: true, focus_active_group: true });
    schedule_auto_save();
  }

  function setPainterGroupPropertyBlockLength(group_id: string, property_id: string, block_id: string, length_breaths: number): void {
    finalizePendingPainterCanvasChanges();
    commitProjectedGridToWorld();
    const group = painter_document_runtime.document.groups[group_id];
    if (!group) return;
    const oldGroupData = structuredClone(group);
    painter_session_core.apply_group_command({ kind: 'set_group_property_block_length', group_id, property_id, block_id, length_breaths });
    sync_local_session_state_from_core();
    sync_lineage_state_from_core();
    const newGroupData = painter_document_runtime.document.groups[group_id] ? structuredClone(painter_document_runtime.document.groups[group_id]!) : undefined;
    logGroupAction(history, 'set_group_property_block_length', `Set Property Block Length ${group.name}`, {
      groupId: group_id,
      oldGroupData,
      newGroupData,
    });
    submit_group_command_if_authoritative({
      kind: 'set_group_property_block_length',
      group_id,
      property_id,
      block_id,
      length_breaths: Math.max(1, Math.floor(length_breaths)),
    });
    sync_painter_runtime_after_mutation({ preserve_group_order: true, focus_active_group: true });
    schedule_auto_save();
  }

  function splitPainterGroupPropertyBlock(group_id: string, property_id: string, block_id: string, split_breath: number): void {
    finalizePendingPainterCanvasChanges();
    commitProjectedGridToWorld();
    const group = painter_document_runtime.document.groups[group_id];
    if (!group) return;
    const oldGroupData = structuredClone(group);
    painterTimelineDiag('command_dispatch', {
      command_kind: 'split_group_property_block',
      group_id,
      property_id,
      block_id,
      split_breath: Math.max(0, Math.floor(split_breath)),
      current_breath: painter_current_breath,
      old_group_summary: summarizePainterTimelineGroup(oldGroupData),
    });
    painter_session_core.apply_group_command({ kind: 'split_group_property_block', group_id, property_id, block_id, split_breath });
    sync_local_session_state_from_core();
    sync_lineage_state_from_core();
    const newGroupData = painter_document_runtime.document.groups[group_id] ? structuredClone(painter_document_runtime.document.groups[group_id]!) : undefined;
    painterTimelineDiag('command_applied_local', {
      command_kind: 'split_group_property_block',
      group_id,
      property_id,
      block_id,
      split_breath: Math.max(0, Math.floor(split_breath)),
      current_breath: painter_current_breath,
      old_group_summary: summarizePainterTimelineGroup(oldGroupData),
      new_group_summary: newGroupData ? summarizePainterTimelineGroup(newGroupData) : null,
    });
    logGroupAction(history, 'split_group_property_block', `Split Property Block ${group.name}`, {
      groupId: group_id,
      oldGroupData,
      newGroupData,
    });
    submit_group_command_if_authoritative({
      kind: 'split_group_property_block',
      group_id,
      property_id,
      block_id,
      split_breath: Math.max(0, Math.floor(split_breath)),
    });
    sync_painter_runtime_after_mutation({ preserve_group_order: true, focus_active_group: true });
    schedule_auto_save();
  }

  function swapPainterGroupPropertyBlocks(group_id: string, property_id: string, source_block_id: string, target_block_id: string): void {
    finalizePendingPainterCanvasChanges();
    commitProjectedGridToWorld();
    const group = painter_document_runtime.document.groups[group_id];
    if (!group || source_block_id === target_block_id) return;
    const oldGroupData = structuredClone(group);
    painterTimelineDiag('command_dispatch', {
      command_kind: 'swap_group_property_blocks',
      group_id,
      property_id,
      source_block_id,
      target_block_id,
      current_breath: painter_current_breath,
      old_group_summary: summarizePainterTimelineGroup(oldGroupData),
    });
    painter_session_core.apply_group_command({ kind: 'swap_group_property_blocks', group_id, property_id, source_block_id, target_block_id });
    sync_local_session_state_from_core();
    sync_lineage_state_from_core();
    const newGroupData = painter_document_runtime.document.groups[group_id] ? structuredClone(painter_document_runtime.document.groups[group_id]!) : undefined;
    painterTimelineDiag('command_applied_local', {
      command_kind: 'swap_group_property_blocks',
      group_id,
      property_id,
      source_block_id,
      target_block_id,
      current_breath: painter_current_breath,
      old_group_summary: summarizePainterTimelineGroup(oldGroupData),
      new_group_summary: newGroupData ? summarizePainterTimelineGroup(newGroupData) : null,
    });
    logGroupAction(history, 'swap_group_property_blocks', `Swap Property Blocks ${group.name}`, {
      groupId: group_id,
      oldGroupData,
      newGroupData,
    });
    submit_group_command_if_authoritative({
      kind: 'swap_group_property_blocks',
      group_id,
      property_id,
      source_block_id,
      target_block_id,
    });
    sync_painter_runtime_after_mutation({ preserve_group_order: true, focus_active_group: true });
    schedule_auto_save();
  }

  function blankPainterGroupPropertyBlock(group_id: string, property_id: string, block_id: string): void {
    finalizePendingPainterCanvasChanges();
    commitProjectedGridToWorld();
    const group = painter_document_runtime.document.groups[group_id];
    if (!group) return;
    const oldGroupData = structuredClone(group);
    painterTimelineDiag('command_dispatch', {
      command_kind: 'blank_group_property_block',
      group_id,
      property_id,
      block_id,
      current_breath: painter_current_breath,
      old_group_summary: summarizePainterTimelineGroup(oldGroupData),
    });
    painter_session_core.apply_group_command({ kind: 'blank_group_property_block', group_id, property_id, block_id });
    sync_local_session_state_from_core();
    sync_lineage_state_from_core();
    const newGroupData = painter_document_runtime.document.groups[group_id] ? structuredClone(painter_document_runtime.document.groups[group_id]!) : undefined;
    painterTimelineDiag('command_applied_local', {
      command_kind: 'blank_group_property_block',
      group_id,
      property_id,
      block_id,
      current_breath: painter_current_breath,
      old_group_summary: summarizePainterTimelineGroup(oldGroupData),
      new_group_summary: newGroupData ? summarizePainterTimelineGroup(newGroupData) : null,
    });
    logGroupAction(history, 'set_group_property_block', `Blank Property Block ${group.name}`, {
      groupId: group_id,
      oldGroupData,
      newGroupData,
    });
    submit_group_command_if_authoritative({ kind: 'blank_group_property_block', group_id, property_id, block_id });
    sync_painter_runtime_after_mutation({ preserve_group_order: true, focus_active_group: true });
    schedule_auto_save();
  }

  function trimPainterGroupPropertyBlockEdge(group_id: string, property_id: string, block_id: string, edge: 'start' | 'end'): void {
    finalizePendingPainterCanvasChanges();
    commitProjectedGridToWorld();
    const group = painter_document_runtime.document.groups[group_id];
    if (!group) return;
    const oldGroupData = structuredClone(group);
    painter_session_core.apply_group_command({ kind: 'trim_group_property_block_edge', group_id, property_id, block_id, edge });
    sync_local_session_state_from_core();
    sync_lineage_state_from_core();
    const newGroupData = painter_document_runtime.document.groups[group_id] ? structuredClone(painter_document_runtime.document.groups[group_id]!) : undefined;
    logGroupAction(history, 'set_group_property_block_length', `Trim Property Block ${group.name}`, {
      groupId: group_id,
      oldGroupData,
      newGroupData,
    });
    submit_group_command_if_authoritative({ kind: 'trim_group_property_block_edge', group_id, property_id, block_id, edge });
    sync_painter_runtime_after_mutation({ preserve_group_order: true, focus_active_group: true });
    schedule_auto_save();
  }

  function mergePainterGroupBlankPropertyBlock(group_id: string, property_id: string, block_id: string, direction: 'left' | 'right'): void {
    finalizePendingPainterCanvasChanges();
    commitProjectedGridToWorld();
    const group = painter_document_runtime.document.groups[group_id];
    if (!group) return;
    const oldGroupData = structuredClone(group);
    painterTimelineDiag('command_dispatch', {
      command_kind: 'merge_group_blank_property_block',
      group_id,
      property_id,
      block_id,
      direction,
      current_breath: painter_current_breath,
      old_group_summary: summarizePainterTimelineGroup(oldGroupData),
    });
    painter_session_core.apply_group_command({ kind: 'merge_group_blank_property_block', group_id, property_id, block_id, direction });
    sync_local_session_state_from_core();
    sync_lineage_state_from_core();
    const newGroupData = painter_document_runtime.document.groups[group_id] ? structuredClone(painter_document_runtime.document.groups[group_id]!) : undefined;
    painterTimelineDiag('command_applied_local', {
      command_kind: 'merge_group_blank_property_block',
      group_id,
      property_id,
      block_id,
      direction,
      current_breath: painter_current_breath,
      old_group_summary: summarizePainterTimelineGroup(oldGroupData),
      new_group_summary: newGroupData ? summarizePainterTimelineGroup(newGroupData) : null,
    });
    logGroupAction(history, 'set_group_property_block_length', `Merge Blank Property Block ${group.name}`, {
      groupId: group_id,
      oldGroupData,
      newGroupData,
    });
    submit_group_command_if_authoritative({ kind: 'merge_group_blank_property_block', group_id, property_id, block_id, direction });
    sync_painter_runtime_after_mutation({ preserve_group_order: true, focus_active_group: true });
    schedule_auto_save();
  }

  function compactPainterGroupBlankPropertyBlockLeft(group_id: string, property_id: string, block_id: string): void {
    finalizePendingPainterCanvasChanges();
    commitProjectedGridToWorld();
    const group = painter_document_runtime.document.groups[group_id];
    if (!group) return;
    const oldGroupData = structuredClone(group);
    painterTimelineDiag('command_dispatch', {
      command_kind: 'compact_group_blank_property_block_left',
      group_id,
      property_id,
      block_id,
      current_breath: painter_current_breath,
      old_group_summary: summarizePainterTimelineGroup(oldGroupData),
    });
    painter_session_core.apply_group_command({ kind: 'compact_group_blank_property_block_left', group_id, property_id, block_id });
    sync_local_session_state_from_core();
    sync_lineage_state_from_core();
    const newGroupData = painter_document_runtime.document.groups[group_id] ? structuredClone(painter_document_runtime.document.groups[group_id]!) : undefined;
    painterTimelineDiag('command_applied_local', {
      command_kind: 'compact_group_blank_property_block_left',
      group_id,
      property_id,
      block_id,
      current_breath: painter_current_breath,
      old_group_summary: summarizePainterTimelineGroup(oldGroupData),
      new_group_summary: newGroupData ? summarizePainterTimelineGroup(newGroupData) : null,
    });
    logGroupAction(history, 'set_group_property_block_length', `Compact Blank Property Block ${group.name}`, {
      groupId: group_id,
      oldGroupData,
      newGroupData,
    });
    submit_group_command_if_authoritative({ kind: 'compact_group_blank_property_block_left', group_id, property_id, block_id });
    sync_painter_runtime_after_mutation({ preserve_group_order: true, focus_active_group: true });
    schedule_auto_save();
  }

  function setPainterGroupPropertyBlockEdgeDestructive(group_id: string, property_id: string, block_id: string, edge: 'start' | 'end', target_breath: number): void {
    finalizePendingPainterCanvasChanges();
    commitProjectedGridToWorld();
    const group = painter_document_runtime.document.groups[group_id];
    if (!group) return;
    const oldGroupData = structuredClone(group);
    painterTimelineDiag('command_dispatch', {
      command_kind: 'set_group_property_block_edge_destructive',
      group_id,
      property_id,
      block_id,
      edge,
      target_breath: Math.max(0, Math.floor(target_breath)),
      current_breath: painter_current_breath,
      old_group_summary: summarizePainterTimelineGroup(oldGroupData),
    });
    painter_session_core.apply_group_command({ kind: 'set_group_property_block_edge_destructive', group_id, property_id, block_id, edge, target_breath });
    sync_local_session_state_from_core();
    sync_lineage_state_from_core();
    const newGroupData = painter_document_runtime.document.groups[group_id] ? structuredClone(painter_document_runtime.document.groups[group_id]!) : undefined;
    painterTimelineDiag('command_applied_local', {
      command_kind: 'set_group_property_block_edge_destructive',
      group_id,
      property_id,
      block_id,
      edge,
      target_breath: Math.max(0, Math.floor(target_breath)),
      current_breath: painter_current_breath,
      old_group_summary: summarizePainterTimelineGroup(oldGroupData),
      new_group_summary: newGroupData ? summarizePainterTimelineGroup(newGroupData) : null,
    });
    logGroupAction(history, 'set_group_property_block_length', `Set Property Block Edge ${group.name}`, {
      groupId: group_id,
      oldGroupData,
      newGroupData,
    });
    submit_group_command_if_authoritative({ kind: 'set_group_property_block_edge_destructive', group_id, property_id, block_id, edge, target_breath });
    sync_painter_runtime_after_mutation({ preserve_group_order: true, focus_active_group: true });
    schedule_auto_save();
  }

  function renamePainterGroup(group_id: string, newName: string): void {
    const entry = get_palette_group_entries().find((candidate) => candidate.group_id === group_id) ?? null;
    const group = painter_document_runtime.document.groups[group_id];
    if (!group) return;
    const oldGroupData = structuredClone(group);
    const oldName = group.name;
    painter_session_core.apply_group_command({ kind: 'rename_group', group_id, group_name: newName });
    sync_local_session_state_from_core();
    sync_lineage_state_from_core();
    const newGroupData = painter_document_runtime.document.groups[group_id] ? structuredClone(painter_document_runtime.document.groups[group_id]!) : undefined;
    logGroupAction(history, 'rename_group', `Rename Group ${oldName}`, {
      groupId: group_id,
      oldGroupData,
      newGroupData,
    });
    submit_group_command_if_authoritative({ kind: 'rename_group', group_id, group_name: newName });
    sync_painter_runtime_after_mutation({ preserve_group_order: true });
    schedule_auto_save();
    painterImportant('group renamed', { group_id, legacy_z: entry?.legacy_z ?? null, old_name: oldName, new_name: newName });
  }

  function reorderPainterGroups(next_group_order: string[]): void {
    if (next_group_order.length < 1) return;
    const oldGroupOrder = [...painter_document_runtime.document.group_order];
    painter_session_core.apply_group_command({ kind: 'reorder_groups', next_group_order });
    sync_local_session_state_from_core();
    sync_lineage_state_from_core();
    logGroupAction(history, 'reorder_groups', 'Reorder Groups', {
      oldGroupOrder,
      newGroupOrder: [...painter_document_runtime.document.group_order],
    });
    submit_group_command_if_authoritative({ kind: 'reorder_groups', next_group_order: [...painter_document_runtime.document.group_order] });
    sync_painter_runtime_after_mutation({ preserve_group_order: true });
    schedule_auto_save();
    painterDiag('reordered groups without mutating world z', {
      next_group_order,
      focus_plane: voxelSpace.camera.focus_plane,
      active_group_id: legacy_group_compat.active_group_id,
    });
    log_runtime_summary('groups reordered summary');
  }

  function reorderPainterGroupProperties(group_id: string, next_property_order: string[]): void {
    const group = painter_document_runtime.document.groups[group_id];
    if (!group || group.locked || next_property_order.length < 1) return;
    const oldGroupData = structuredClone(group);
    painter_session_core.apply_group_command({ kind: 'reorder_group_properties', group_id, next_property_order });
    sync_local_session_state_from_core();
    sync_lineage_state_from_core();
    sync_active_group_property_selection();
    const newGroupData = painter_document_runtime.document.groups[group_id] ? structuredClone(painter_document_runtime.document.groups[group_id]!) : undefined;
    logGroupAction(history, 'reorder_groups', `Reorder Properties ${group.name}`, {
      groupId: group_id,
      oldGroupData,
      newGroupData,
    });
    sync_painter_runtime_after_mutation({ preserve_group_order: true, focus_active_group: true });
    schedule_auto_save();
  }

  function getPainterCanvasModuleApi(): (ReturnType<typeof make_painter_canvas_module> & {
    getSelectionBitmap?: () => SelectionBitmap;
    setSelectionBitmap?: (bitmap: SelectionBitmap) => void;
  }) | null {
    if (!canvas_module) return null;
    return canvas_module as ReturnType<typeof make_painter_canvas_module> & {
      getSelectionBitmap?: () => SelectionBitmap;
      setSelectionBitmap?: (bitmap: SelectionBitmap) => void;
    };
  }

  function deriveProjectedSelectionBitmap(): SelectionBitmap {
    const bitmap = createSelectionBitmap(grid.width, grid.height);
    if (!painter_display_projection) return bitmap;
    for (const key of get_local_world_selection().cells) {
      const [rawX, rawY, rawZ] = key.split(',').map((value) => Number.parseInt(value, 10));
      const x = rawX ?? 0;
      const y = rawY ?? 0;
      const z = rawZ ?? 0;
      const projected = project_world_point_with_roll({ x, y, z }, painter_display_projection.view_state);
      if (projected.plane !== painter_display_projection.focus_world_plane) continue;
      const gridPoint = painterWorldToGridPoint({ x, y, z });
      if (!gridPoint) continue;
      setSelected(bitmap, gridPoint.x, gridPoint.y, true);
    }
    return bitmap;
  }

  function syncPainterCanvasSelectionFromWorld(): void {
    getPainterCanvasModuleApi()?.setSelectionBitmap?.(deriveProjectedSelectionBitmap());
  }

  function apply_world_selection_cells(mode: SelectionMode, cells: Iterable<{ x: number; y: number; z: number }>): void {
    const localSelection = get_local_world_selection();
    const incoming = create_world_selection();
    for (const world of cells) {
      set_world_selected(incoming, world.x, world.y, world.z, true);
    }
    apply_world_selection_mode(localSelection, incoming, mode);
    syncPainterCanvasSelectionFromWorld();
    syncDOMRenderer();
    publish_local_selection_channel();
  }

  function handle_world_selection_change(args: {
    kind: 'rect' | 'lasso' | 'clear' | 'select_all' | 'invert' | 'brush' | 'bucket';
    mode?: SelectionMode;
    cells?: Array<{ x: number; y: number; z: number }>;
  }): void {
    const localSelection = get_local_world_selection();
    if (args.kind === 'clear') {
      clear_world_selection(localSelection);
      syncPainterCanvasSelectionFromWorld();
      syncDOMRenderer();
      publish_local_selection_channel();
      return;
    }
    if (args.kind === 'select_all') {
      clear_world_selection(localSelection);
      for_each_active_group_world_position((world) => {
        set_world_selected(localSelection, world.x, world.y, world.z, true);
      });
      syncPainterCanvasSelectionFromWorld();
      syncDOMRenderer();
      publish_local_selection_channel();
      return;
    }
    if (args.kind === 'invert') {
      const next = create_world_selection();
      for_each_active_group_world_position((world) => {
        const key = `${world.x},${world.y},${world.z}` as const;
        if (!localSelection.cells.has(key)) set_world_selected(next, world.x, world.y, world.z, true);
      });
      localSelection.cells = next.cells;
      syncPainterCanvasSelectionFromWorld();
      syncDOMRenderer();
      publish_local_selection_channel();
      return;
    }
    apply_world_selection_cells(args.mode ?? selection_mode, args.cells ?? []);
  }

  function hasAnyVisibleSelectionChannels(): boolean {
    for (const channel of selection_channels_by_connection.values()) {
      if (channel.selection.cells.size > 0) return true;
    }
    return false;
  }

  function applyLivePreviewToProjectedScene(scene: PainterProjectedScene, alternateWithBase: boolean): void {
    if (!painter_display_projection) return;
    const cycleIndex = Math.floor(performance.now() / 400);
    const active_group_id = resolve_current_runtime_group_id();
    if (!active_group_id) return;
    for (const change of live_stroke_preview_changes) {
      const displayCell = project_world_to_painter_display_cell({
        projection: painter_display_projection,
        world: { x: change.worldX, y: change.worldY, z: change.worldZ },
      });
      if (!displayCell) continue;
      const slot = scene.slots.get(displayCell.slot);
      const row = slot?.cells[displayCell.y];
      if (!row) continue;
      const winner = resolve_painter_group_preview_winner(painter_document_runtime, active_group_id, {
        x: change.worldX,
        y: change.worldY,
        z: change.worldZ,
        char: change.newCell.char,
        graphic: change.newCell.graphic ? { ...change.newCell.graphic } : undefined,
        appearance_slots: clone_appearance_slot_assignments(change.newCell.appearance_slots),
        materials: change.newCell.materials ? { ...change.newCell.materials } : undefined,
        rgb: { ...change.newCell.rgb },
        weight_index: change.newCell.weight_index,
      });
      const previewCell = makeResolvedPreviewCell(winner);
      const baseCell = row[displayCell.x];
      const hasBase = !!baseCell && (((typeof baseCell.char === 'string') && baseCell.char !== ' ') || !!baseCell.graphic);
      if (alternateWithBase && hasBase && cycleIndex % 2 === 0) continue;
      row[displayCell.x] = previewCell;
    }
  }

  function applySelectionPreviewToProjectedScene(scene: PainterProjectedScene): void {
    if (!painter_display_projection) return;
    const localConnectionId = get_local_selection_connection_id();
    const cycleIndex = Math.floor(performance.now() / 400);
    const projectedSelections = new Map<string, Array<{ connection_id: string; is_local: boolean; color_rgb: Rgb }>>();
    for (const channel of selection_channels_by_connection.values()) {
      const effectiveSelection = channel.connection_id === localConnectionId && move_preview_selection_override
        ? move_preview_selection_override
        : channel.selection;
      const bestByCell = new Map<string, { key: string; connection_id: string; is_local: boolean; color_rgb: Rgb }>();
      for (const worldKey of effectiveSelection.cells) {
        const { x, y, z } = parse_world_cell_key(worldKey);
        const displayCell = project_world_to_painter_display_cell({ projection: painter_display_projection, world: { x, y, z } });
        if (!displayCell) continue;
        const key = `${displayCell.slot}:${displayCell.x}:${displayCell.y}`;
        const prev = bestByCell.get(key);
        if (prev) continue;
        bestByCell.set(key, {
          key,
          connection_id: channel.connection_id,
          is_local: channel.connection_id === localConnectionId,
          color_rgb: { ...channel.color_rgb },
        });
      }
      for (const entry of bestByCell.values()) {
        const list = projectedSelections.get(entry.key);
        if (list) list.push({ connection_id: entry.connection_id, is_local: entry.is_local, color_rgb: entry.color_rgb });
        else projectedSelections.set(entry.key, [{ connection_id: entry.connection_id, is_local: entry.is_local, color_rgb: entry.color_rgb }]);
      }
    }

    for (const [key, candidates] of projectedSelections.entries()) {
      const [slotRaw, xRaw, yRaw] = key.split(':');
      const slotIndex = Number.parseInt(slotRaw ?? '0', 10);
      const x = Number.parseInt(xRaw ?? '0', 10);
      const y = Number.parseInt(yRaw ?? '0', 10);
      const slot = scene.slots.get(slotIndex);
      const row = slot?.cells[y];
      const baseCell = row?.[x];
      if (!slot || !row || !baseCell) continue;
      const hasBase = (typeof baseCell.char === 'string' && baseCell.char !== ' ') || !!baseCell.graphic;
      candidates.sort((a, b) => {
        if (a.is_local !== b.is_local) return a.is_local ? -1 : 1;
        return a.connection_id.localeCompare(b.connection_id);
      });
      const cycleLength = candidates.length + (hasBase ? 1 : 0);
      const visibleIndex = cycleLength > 0 ? (cycleIndex % cycleLength) : 0;
      if (hasBase && visibleIndex === 0) continue;
      const owner = candidates[(visibleIndex - (hasBase ? 1 : 0) + candidates.length) % candidates.length] ?? candidates[0]!;
      row[x] = {
        ...baseCell,
        char: hasBase ? baseCell.char : '•',
        rgb: { ...owner.color_rgb },
        weight_index: hasBase ? baseCell.weight_index : 1,
      };
    }
  }

  function getPainterSelectionStatus(): string | null {
    const localSelection = get_local_world_selection();
    if (!has_world_selection(localSelection)) return null;
    const bounds = get_world_selection_bounds(localSelection);
    if (!bounds) return null;
    const depthSpan = (bounds.max_z - bounds.min_z + 1);
    return `SEL ${localSelection.cells.size} vox / DEPTH ${bounds.min_z}->${bounds.max_z} / SPAN ${depthSpan}`;
  }

  function updateWorldSelectionFromProjectedBitmap(mode: SelectionMode, depthRange?: { depthMin?: number; depthMax?: number; kind?: 'rect' | 'lasso' | 'clear' | 'select_all' | 'invert' | 'other' }): void {
    if (depthRange?.kind === 'clear') {
      clear_world_selection(get_local_world_selection());
      syncPainterCanvasSelectionFromWorld();
      syncDOMRenderer();
      publish_local_selection_channel();
      return;
    }
    if (depthRange?.kind === 'select_all') {
      handle_world_selection_change({ kind: 'select_all' });
      return;
    }
    if (depthRange?.kind === 'invert') {
      handle_world_selection_change({ kind: 'invert' });
      return;
    }
    const bitmap = getPainterCanvasModuleApi()?.getSelectionBitmap?.();
    if (!bitmap || !painter_display_projection) return;
    const incoming = create_world_selection();
    const focusPlane = painter_display_projection.focus_world_plane;
    if (focusPlane === null || focusPlane === undefined) {
      apply_world_selection_mode(get_local_world_selection(), incoming, mode);
      return;
    }
    for (let y = 0; y < bitmap.height; y += 1) {
      for (let x = 0; x < bitmap.width; x += 1) {
        if (!isSelected(bitmap, x, y)) continue;
        const u = x + painter_display_projection.projected_bounds.min_u;
        const v = y + painter_display_projection.projected_bounds.min_v;
        const depthMin = depthRange?.depthMin ?? focusPlane;
        const depthMax = depthRange?.depthMax ?? focusPlane;
        for (let plane = Math.min(depthMin, depthMax); plane <= Math.max(depthMin, depthMax); plane += 1) {
          const world = unproject_plane_point_with_roll({ u, v, plane }, painter_display_projection.view_state);
          set_world_selected(incoming, world.x, world.y, world.z, true);
        }
      }
    }
    apply_world_selection_mode(get_local_world_selection(), incoming, mode);
    syncPainterCanvasSelectionFromWorld();
    syncDOMRenderer();
    publish_local_selection_channel();
  }

  function stepPainterViewAction(action: 'swing_left' | 'swing_right' | 'swing_up' | 'swing_down' | 'roll_left' | 'roll_right'): void {
    if (painter_view_transition) return;
    const now = performance.now();
    const current = getPainterViewState();
    const transitionTargetWorld = getPainterCanvasFrameAnchorWorld();
    const transitionAnchor: PainterInteractionAnchor = {
      kind: 'viewport_center',
      screen: null,
      world: { ...transitionTargetWorld },
    };
    painter_transition_anchor = {
      anchor: transitionAnchor,
      target_world: { ...transitionTargetWorld },
      projection_anchor_world: { ...transitionTargetWorld },
      visual_pivot_px: getPainterAnchorPivotPx(transitionAnchor),
    };
    if (action === 'roll_left' || action === 'roll_right') {
      const direction = action === 'roll_left' ? 'left' : 'right';
      painter_view_transition = start_roll_transition(direction, now, current.roll_quarter_turn, get_transition_tilt_for_command(current, 'roll', direction, 45));
      return;
    }
    const direction = action.replace('swing_', '') as 'left' | 'right' | 'up' | 'down';
    painter_view_transition = start_swing_transition(direction, now, get_transition_tilt_for_command(current, 'swing', direction, 45));
  }

  function getCanvasPasteTransformApi(): (ReturnType<typeof make_painter_canvas_module> & {
    hasWorldPastePreview?: () => boolean;
    stepPasteViewAction?: (action: 'swing_left' | 'swing_right' | 'swing_up' | 'swing_down' | 'roll_left' | 'roll_right') => void;
    setPasteAngleMode?: () => void;
  }) | null {
    if (!canvas_module) return null;
    return canvas_module as ReturnType<typeof make_painter_canvas_module> & {
      hasWorldPastePreview?: () => boolean;
      stepPasteViewAction?: (action: 'swing_left' | 'swing_right' | 'swing_up' | 'swing_down' | 'roll_left' | 'roll_right') => void;
      setPasteAngleMode?: () => void;
    };
  }

  function canRoutePasteTransformActions(): boolean {
    const api = getCanvasPasteTransformApi();
    return !!api?.hasWorldPastePreview?.();
  }

  function stepPasteTransformAction(action: 'swing_left' | 'swing_right' | 'swing_up' | 'swing_down' | 'roll_left' | 'roll_right'): void {
    getCanvasPasteTransformApi()?.stepPasteViewAction?.(action);
  }

  function isMoveMaskModifierEvent(e: KeyboardEvent): boolean {
    return e.code === 'Backquote' && e.shiftKey;
  }

  function stepPainterDepth(dir: -1 | 1): void {
    const axis = getPainterFocusPlaneAxis(getPainterDisplayViewState());
    const currentPlane = getPainterFocusWorldPlane();
    const nextPlane = currentPlane + dir;
    if (!Number.isFinite(nextPlane) || nextPlane === currentPlane) return;
    const canvasWithDepthRetarget = canvas_module as typeof canvas_module & { handleDepthStepDuringActiveStroke?: (nextPlane: number) => void };
    canvasWithDepthRetarget.handleDepthStepDuringActiveStroke?.(nextPlane);
    setCurrentFocusWorldPlane(nextPlane, { persist: true });
    refreshPainterProjectionPreservingCameraFrame();
    painterDiag('navigation depth stepped', {
      axis,
      direction: dir,
      current_plane: currentPlane,
      next_plane: nextPlane,
      focus_slot: painter_display_projection.focus_slot,
      focus_world_plane: painter_display_projection.focus_world_plane,
    });
  }

  // Initialize DOM renderer when container is available
  function initDOMRenderer(): void {
    const container = document.getElementById('voxel_layers_container');
    if (!container) {
      diag_log('renderer', 'important', 'PAINTER', 'voxel layers container not found; DOM renderer not initialized', {}, { sink: 'warn' });
      return;
    }

    if (domRenderer && isPainterDomRootConnected(container)) return;
    if (domRenderer && !isPainterDomRootConnected(container)) {
      resetPainterDOMRendererState();
    }

    // Phase 0.5: single-owner lifecycle for #voxel_layers_container.
    // If the game place layers are mounted, release them before mounting painter layers.
    try {
      const other = container.querySelectorAll('[data-place-world-layers]');
      for (const el of Array.from(other)) {
        try {
          el.remove();
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }

    domRoot = document.createElement('div');
    domRoot.style.position = 'absolute';
    domRoot.style.left = '0px';
    domRoot.style.top = '0px';
    domRoot.style.width = '100%';
    domRoot.style.height = '100%';
    domRoot.style.pointerEvents = 'none';
    domRoot.setAttribute('data-world-layers-owner', 'painter');
    domRoot.setAttribute('data-painter-world-layers', 'true');
    container.appendChild(domRoot);

    domRenderer = createVoxelDOMRenderer(
      domRoot,
      PAINTER_CONFIG.font_family,
      PAINTER_CONFIG.base_font_size_px,
      PAINTER_CONFIG.weight_index_to_css,
      PAINTER_CONFIG.render_backend,
      PAINTER_CONFIG.render_theme_id,
    );
    applyPainterProjectedCameraTuning();
    domRenderer.setProjectedScene(getPainterRenderScene());
    painterImportant('dom renderer initialized');
  }

  // Sync DOM renderer with current voxelSpace
  function syncDOMRenderer(): void {
    if (domRenderer) {
      applyPainterProjectedCameraTuning();
      domRenderer.setProjectedScene(getPainterRenderScene());
    }
  }

  function syncRendererFromProjection(): void {
    syncDOMRenderer();
  }

  function ensureValidFocusPlane(): void {
    const axis = getPainterFocusPlaneAxis();
    const currentPlane = getPainterFocusWorldPlane();
    const documentCenter = getPainterDocumentCenterWorld();
    if (axis === 'x') {
      if (!Number.isFinite(currentPlane)) {
        setCurrentFocusWorldPlane(documentCenter.x);
      }
    } else if (axis === 'y') {
      if (!Number.isFinite(currentPlane)) {
        setCurrentFocusWorldPlane(documentCenter.y);
      }
    } else if (!Number.isFinite(currentPlane)) {
      setCurrentFocusWorldPlane(documentCenter.z);
    }
    syncCompatibilityFocusPlaneFromCameraTarget();
  }

  // Create history manager
  const history = createHistoryManager(50);
  function sync_lineage_state_from_core(): void {
    const state = painter_session_core.get_state();
    current_painter_document_lineage_id = state.lineage_id;
    authoritative_revision_applied = state.authoritative_revision;
  }
  sync_lineage_state_from_core();
  let boot_document_restored = false;

  // Try to load auto-save on startup (try VoxelSpace first, then fallback to Grid)
  const saved_painter_document = options?.skip_boot_restore ? null : loadAutoSavePainterDocument();
  if (saved_painter_document) {
    painterDiag('restoring autosaved painter document');
    painterImportant('boot restore source chosen', { source: 'autosaved_painter_document' });
    applyPainterDocumentSnapshot(saved_painter_document);
    setCurrentPainterDocumentLineage(`autosave:painter_document:${Date.now()}`, 'autosaved_painter_document');
    clearLastUsedFilePath();
    boot_document_restored = true;
    painterImportant('loaded autosaved painter document artwork');
  } else {
    const saved_voxel_space = options?.skip_boot_restore ? null : loadAutoSaveVoxelSpace();
    if (saved_voxel_space) {
    painterDiag('restoring autosaved voxel space');
    painterImportant('boot restore source chosen', { source: 'autosaved_voxel_space' });
    voxelSpace = saved_voxel_space;
    rebuild_runtime_from_voxel_space();
    setCurrentPainterDocumentLineage(`autosave:voxel_space:${Date.now()}`, 'autosaved_voxel_space');
    // Re-apply saved camera config after loading auto-save (camera settings are global, not per-artwork)
    const savedCameraConfig = getSavedPainterCameraConfig();
    mergeSavedPainterCameraConfig(savedCameraConfig);
    syncPainterCameraViewTransform();
    ensureValidFocusPlane();
    setPainterCameraFrameAnchorWorld(getPainterDocumentCenterWorld());
    painter_display_projection = rebuildPainterDisplayProjection(getPainterDisplayViewState(), getPainterStableViewAnchor());
    syncProjectedGridFromDisplay();
    syncDOMRenderer();
    clearLastUsedFilePath();
    boot_document_restored = true;
    painterImportant('loaded autosaved voxel space artwork');
    } else {
      // Fallback to legacy grid auto-save
      const saved_grid = options?.skip_boot_restore ? null : loadAutoSave();
      if (saved_grid) {
        painterDiag('restoring legacy autosaved grid');
        painterImportant('boot restore source chosen', { source: 'legacy_autosaved_grid' });
        grid.width = saved_grid.width;
        grid.height = saved_grid.height;
        grid.cells = saved_grid.cells;
        // Sync voxelSpace to grid
        voxelSpace = gridToVoxelSpace(grid, 0);
        rebuild_runtime_from_voxel_space();
        setCurrentPainterDocumentLineage(`autosave:legacy_grid:${Date.now()}`, 'legacy_autosaved_grid');
        // Re-apply saved camera config after loading legacy auto-save
        const savedCameraConfig = getSavedPainterCameraConfig();
        mergeSavedPainterCameraConfig(savedCameraConfig);
        syncPainterCameraViewTransform();
        ensureValidFocusPlane();
        setPainterCameraFrameAnchorWorld(getPainterDocumentCenterWorld());
        painter_display_projection = rebuildPainterDisplayProjection(getPainterDisplayViewState(), getPainterStableViewAnchor());
        syncProjectedGridFromDisplay();
        syncDOMRenderer();
        clearLastUsedFilePath();
        boot_document_restored = true;
        painterImportant('loaded autosaved artwork legacy format');
      }
    }
  }

  resetPainterHistoryState('initial painter state');
  
  // Current tool state
  let current_tool: ToolType = 'pencil';
  
  // Tool mapping for left/right click
  let left_click_tool: ToolType = normalize_painter_tool(saved_tool_props.left_click_tool as ToolType || 'pencil');
  let right_click_tool: ToolType = normalize_painter_tool(saved_tool_props.right_click_tool as ToolType || 'eraser');

  function maybeCommitPendingPainterPlacementModes(nextLeftTool: ToolType, nextRightTool: ToolType): void {
    if (canvas_module?.hasMovePreview() && nextLeftTool !== 'move' && nextRightTool !== 'move') {
      canvas_module.leaveMovePreview();
    }
    if (canvas_module?.hasPastePreview() && nextLeftTool !== 'paste' && nextRightTool !== 'paste') {
      canvas_module.leavePastePreview();
    }
  }

  function select_current_tool(tool: ToolType): void {
    const normalized = normalize_painter_tool(tool);
    maybeCommitPendingPainterPlacementModes(left_click_tool, right_click_tool);
    current_tool = normalized;
    if (current_tool === 'text') {
      activatePainterTextCursorCameraPolicy();
      refreshPainterProjectionPreservingCameraFrame();
    } else {
      syncPainterToolCameraPolicy();
    }
    painterDiag('selected tool', { tool: current_tool });
  }

  function assign_left_click_tool(tool: ToolType): void {
    tool = normalize_painter_tool(tool);
    maybeCommitPendingPainterPlacementModes(tool, right_click_tool);
    left_click_tool = tool;
    active_property_side = 'left';
    saveToolProperties({ left_click_tool: tool, active_property_side: 'left' });
    painterDiag('left-click tool changed', { tool });
  }

  function assign_primary_tool(tool: ToolType): void {
    tool = normalize_painter_tool(tool);
    select_current_tool(tool);
    assign_left_click_tool(tool);
  }

  function assign_right_click_tool(tool: ToolType): void {
    tool = normalize_painter_tool(tool);
    maybeCommitPendingPainterPlacementModes(left_click_tool, tool);
    right_click_tool = tool;
    active_property_side = 'right';
    saveToolProperties({ right_click_tool: tool, active_property_side: 'right' });
    painterDiag('right-click tool changed', { tool });
  }

  const painter_tool_shortcut_interpreter = create_painter_tool_shortcut_interpreter({
    on_assign_primary: assign_primary_tool,
    on_assign_secondary: assign_right_click_tool,
    tool_sequences: PAINTER_TOOL_SEQUENCE_BINDINGS,
  });
  
  let active_property_side: 'left' | 'right' = saved_tool_props.active_property_side === 'right' ? 'right' : 'left';

  function getDigitKeyFromToolShortcutEvent(e: KeyboardEvent): string | null {
    if (e.ctrlKey || e.metaKey || e.altKey) return null;
    const match = /^Digit([0-9])$/.exec(String(e.code ?? ''));
    return match ? match[1]! : null;
  }

  function isModifierOnlyKeyEvent(e: KeyboardEvent): boolean {
    return e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta';
  }

  function maybeHandlePainterToolShortcutKeydown(e: KeyboardEvent): boolean {
    if (isPainterTextCaptureActive() || e.repeat) return false;
    const digit = getDigitKeyFromToolShortcutEvent(e);
    if (!digit) return false;
    const result = painter_tool_shortcut_interpreter.trigger_digit(digit);
    if (result === 'ignored') return false;
    e.preventDefault();
    return true;
  }

  function maybeEarlyCommitPendingToolShortcutForKeydown(e: KeyboardEvent): void {
    if (!painter_tool_shortcut_interpreter.has_pending_input()) return;
    if (isModifierOnlyKeyEvent(e)) return;
    if (getDigitKeyFromToolShortcutEvent(e)) return;
    painter_tool_shortcut_interpreter.flush_pending_primary();
  }

  function jumpCurrentPainterBreathToActiveGroupBoundary(edge: 'start' | 'end'): void {
    const group_id = resolve_current_runtime_group_id();
    if (!group_id) return;
    const group = painter_document_runtime.document.groups[group_id];
    if (!group) return;
    const range = derive_group_breath_range(group);
    setCurrentPainterBreath(edge === 'start' ? range.cropped_start : range.cropped_end);
  }

  function performPainterUndoShortcut(): boolean {
    finalizePendingPainterCanvasChanges();
    return Boolean(performPainterUndo());
  }

  function performPainterRedoShortcut(): boolean {
    finalizePendingPainterCanvasChanges();
    return Boolean(performPainterRedo());
  }

  function performPainterCopyShortcut(): boolean {
    canvas_module?.copySelection();
    return true;
  }

  function leavePendingPainterPlacement(): boolean {
    if (canvas_module?.hasMovePreview()) return canvas_module.leaveMovePreview();
    if (canvas_module?.hasPastePreview()) return canvas_module.leavePastePreview();
    return false;
  }

  function routePainterPositionalAction(action: 'nudge_left' | 'nudge_right' | 'nudge_up' | 'nudge_down' | 'nudge_backward' | 'nudge_forward' | 'rotate_left' | 'rotate_right'): boolean {
    const screenDirectionByAction: Partial<Record<typeof action, 'left' | 'right' | 'up' | 'down'>> = {
      nudge_left: 'left',
      nudge_right: 'right',
      nudge_up: 'up',
      nudge_down: 'down',
    };
    const screenDirection = screenDirectionByAction[action];
    const basis = get_view_basis_for_state(getPainterViewState());
    const worldDelta = screenDirection
      ? map_screen_direction_to_world_delta(getPainterViewState(), screenDirection)
      : action === 'nudge_backward'
        ? { x: -basis.forward.x, y: -basis.forward.y, z: -basis.forward.z }
        : action === 'nudge_forward'
          ? { x: basis.forward.x, y: basis.forward.y, z: basis.forward.z }
          : null;
    const getToolForSide = (side: 'left' | 'right'): ToolType => side === 'right' ? right_click_tool : left_click_tool;
    const orderedSides: Array<'left' | 'right'> = active_property_side === 'right' ? ['right', 'left'] : ['left', 'right'];
    const hasSelection = has_world_selection(get_local_world_selection());

    if (hasSelection) {
      for (const side of orderedSides) {
        const tool = getToolForSide(side);
        if (tool === 'selectangle' || tool === 'lassoselect' || tool === 'copy') {
          if (!canvas_module || !worldDelta) return false;
          active_property_side = side;
          return canvas_module.nudgeSelectionByWorldDelta(worldDelta);
        }
        if (tool === 'move') {
          if (!canvas_module || !worldDelta) return false;
          active_property_side = side;
          return canvas_module.nudgeMovePreviewByWorldDelta(worldDelta);
        }
      }
      if (screenDirection) return nudgeActivePainterGroupLocation(screenDirection);
      if (action === 'nudge_backward') return nudgeActivePainterGroupDepth(-1);
      if (action === 'nudge_forward') return nudgeActivePainterGroupDepth(1);
      return false;
    }

    for (const side of orderedSides) {
      const tool = getToolForSide(side);
      if (tool === 'paste') {
        if (!canvas_module) return false;
        active_property_side = side;
        if (worldDelta) return canvas_module.nudgePastePreviewByWorldDelta(worldDelta);
        if (action === 'rotate_left') {
          canvas_module.stepPasteViewAction('roll_left');
          return true;
        }
        if (action === 'rotate_right') {
          canvas_module.stepPasteViewAction('roll_right');
          return true;
        }
        return false;
      }
      if (tool === 'text') {
        if (!canvas_module || !worldDelta) return false;
        active_property_side = side;
        return canvas_module.nudgeTextCursorByWorldDelta(worldDelta);
      }
    }

    if (screenDirection) return nudgeActivePainterGroupLocation(screenDirection);
    if (action === 'nudge_backward') return nudgeActivePainterGroupDepth(-1);
    if (action === 'nudge_forward') return nudgeActivePainterGroupDepth(1);
    return false;
  }

  const left_brush: Brush = {
    char: saved_tool_props.left_brush_char ?? '█',
    graphic: saved_tool_props.left_brush_graphic
      ? { ...saved_tool_props.left_brush_graphic, weight_index: mapBrushWeightToGraphicWeight(saved_tool_props.left_brush_weight_index ?? 1) }
      : undefined,
    appearance_slots: clone_appearance_slot_assignments(saved_tool_props.left_brush_appearance_slots),
    materials: saved_tool_props.left_brush_materials ? { ...saved_tool_props.left_brush_materials } : undefined,
    rgb: { ...saved_tool_props.left_brush_rgb },
    weight_index: saved_tool_props.left_brush_weight_index ?? 1,
  };
  const right_brush: Brush = {
    char: saved_tool_props.right_brush_char ?? '█',
    graphic: saved_tool_props.right_brush_graphic
      ? { ...saved_tool_props.right_brush_graphic, weight_index: mapBrushWeightToGraphicWeight(saved_tool_props.right_brush_weight_index ?? 1) }
      : undefined,
    appearance_slots: clone_appearance_slot_assignments(saved_tool_props.right_brush_appearance_slots),
    materials: saved_tool_props.right_brush_materials ? { ...saved_tool_props.right_brush_materials } : undefined,
    rgb: { ...saved_tool_props.right_brush_rgb },
    weight_index: saved_tool_props.right_brush_weight_index ?? 1,
  };

  let left_brush_size = saved_tool_props.left_brush_size ?? saved_tool_props.brush_size ?? 1;
  let right_brush_size = saved_tool_props.right_brush_size ?? saved_tool_props.brush_size ?? 1;
  let left_edit_channels: EditChannels = { ...saved_tool_props.left_brush_edit_channels };
  let right_edit_channels: EditChannels = { ...saved_tool_props.right_brush_edit_channels };
  let left_brush_slot_targets: AppearanceSlotTargetMask = { ...saved_tool_props.left_brush_slot_targets };
  let right_brush_slot_targets: AppearanceSlotTargetMask = { ...saved_tool_props.right_brush_slot_targets };

  function cloneAppearanceValue(value: AppearanceSlotValue | undefined): AppearanceSlotValue | undefined {
    if (!value) return undefined;
    return value.kind === 'material'
      ? { kind: 'material', material_id: value.material_id }
      : { kind: 'flat_rgb', rgb: { ...value.rgb } };
  }

  function inferSelectedAppearanceFromBrush(brush: Brush, slot_targets: AppearanceSlotTargetMask): AppearanceSlotValue {
    const slots = get_enabled_appearance_slots(slot_targets);
    const values = slots.map((slot) => brush.appearance_slots?.[slot]).filter((value): value is AppearanceSlotValue => !!value);
    if (values.length === 0) return { kind: 'flat_rgb', rgb: { ...brush.rgb } };
    if (values.every((value) => value.kind === 'material')) {
      const first_material = values[0]!.material_id;
      if (values.every((value) => value.material_id === first_material)) {
        return { kind: 'material', material_id: first_material };
      }
    }
    if (values.every((value) => value.kind === 'flat_rgb')) {
      const first_rgb = values[0]!.rgb;
      if (values.every((value) => value.rgb.r === first_rgb.r && value.rgb.g === first_rgb.g && value.rgb.b === first_rgb.b)) {
        return { kind: 'flat_rgb', rgb: { ...first_rgb } };
      }
    }
    return { kind: 'flat_rgb', rgb: { ...brush.rgb } };
  }

  let left_selected_appearance: AppearanceSlotValue = cloneAppearanceValue(saved_tool_props.left_selected_appearance)
    ?? inferSelectedAppearanceFromBrush(left_brush, left_brush_slot_targets);
  let right_selected_appearance: AppearanceSlotValue = cloneAppearanceValue(saved_tool_props.right_selected_appearance)
    ?? inferSelectedAppearanceFromBrush(right_brush, right_brush_slot_targets);
  let left_select_channels: EditChannels = { ...saved_tool_props.left_bucket_select_channels };
  let right_select_channels: EditChannels = { ...saved_tool_props.right_bucket_select_channels };
  let bucket_continuous = saved_tool_props.bucket_continuous ?? true;
  let bucket_same_depth_only = saved_tool_props.bucket_same_depth_only ?? true;
  let bucket_allow_diagonal = saved_tool_props.bucket_allow_diagonal ?? false;
  let rect_select_all_depths = saved_tool_props.rect_select_all_depths ?? false;
  let lasso_select_all_depths = saved_tool_props.lasso_select_all_depths ?? false;
  let left_target: ToolEditTarget = saved_tool_props.left_target ?? 'content';
  let right_target: ToolEditTarget = saved_tool_props.right_target ?? 'content';
  let picker_pick_for_opposite_hand = saved_tool_props.picker_pick_for_opposite_hand ?? false;
  let tool_target_invert_held = false;
  let move_mask_modifier_held = false;

  function getBrushForSide(side: 'left' | 'right'): Brush {
    return side === 'right' ? right_brush : left_brush;
  }

  function mapBrushWeightToGraphicWeight(weight_index: number): 0 | 1 | 2 | 3 {
    const clamped = Math.max(0, Math.min(3, Math.floor(Number(weight_index) || 0)));
    return (3 - clamped) as 0 | 1 | 2 | 3;
  }

  function mapGraphicWeightToBrushWeight(weight_index: number): 0 | 1 | 2 | 3 {
    const clamped = Math.max(0, Math.min(3, Math.floor(Number(weight_index) || 0)));
    return (3 - clamped) as 0 | 1 | 2 | 3;
  }

  function syncBrushGraphicWeight(brush: Brush): void {
    if (brush.graphic) brush.graphic = { ...brush.graphic, weight_index: mapBrushWeightToGraphicWeight(brush.weight_index) };
  }

  function getBrushSlotTargetsForSide(side: 'left' | 'right'): AppearanceSlotTargetMask {
    return side === 'right' ? right_brush_slot_targets : left_brush_slot_targets;
  }

  function getSelectedAppearanceForSide(side: 'left' | 'right'): AppearanceSlotValue {
    return cloneAppearanceValue(side === 'right' ? right_selected_appearance : left_selected_appearance)
      ?? { kind: 'flat_rgb', rgb: { ...getBrushForSide(side).rgb } };
  }

  function setSelectedAppearanceForSide(side: 'left' | 'right', value: AppearanceSlotValue): void {
    if (side === 'right') right_selected_appearance = cloneAppearanceValue(value)!;
    else left_selected_appearance = cloneAppearanceValue(value)!;
  }

  function saveSelectedAppearanceState(side: 'left' | 'right'): void {
    saveToolProperties({
      left_selected_appearance: cloneAppearanceValue(left_selected_appearance),
      right_selected_appearance: cloneAppearanceValue(right_selected_appearance),
      active_property_side: side,
    });
  }

  function getSelectedAppearanceDisplayRgb(value: AppearanceSlotValue | undefined, fallback: Rgb): Rgb {
    if (!value) return { ...fallback };
    if (value.kind === 'flat_rgb') return { ...value.rgb };
    return resolve_material_rgb(value.material_id, '2nd_lightest') ?? { ...fallback };
  }

  function deriveBrushMaterialsFromAppearanceSlots(appearance_slots: Brush['appearance_slots']): Brush['materials'] {
    if (!appearance_slots) return undefined;
    const next: NonNullable<Brush['materials']> = {};
    for (const slot of [1, 2, 3] as const) {
      const value = appearance_slots[slot];
      if (value?.kind === 'material') next[slot] = value.material_id;
    }
    return Object.keys(next).length > 0 ? next : undefined;
  }

  function applySelectedAppearanceToBrush(brush: Brush, appearance: AppearanceSlotValue, slot_targets?: AppearanceSlotTargetMask): void {
    const slots = get_enabled_appearance_slots(slot_targets ?? { slot_1: true, slot_2: false, slot_3: false });
    const next_slots = clone_appearance_slot_assignments(brush.appearance_slots) ?? {};
    const next_materials = { ...(brush.materials ?? {}) };
    for (const slot of slots) {
      next_slots[slot] = appearance.kind === 'material'
        ? { kind: 'material', material_id: appearance.material_id }
        : { kind: 'flat_rgb', rgb: { ...appearance.rgb } };
      if (appearance.kind === 'material') next_materials[slot] = appearance.material_id;
      else delete next_materials[slot];
    }
    brush.appearance_slots = Object.keys(next_slots).length > 0 ? next_slots : undefined;
    brush.materials = Object.keys(next_materials).length > 0 ? next_materials : undefined;
    brush.rgb = getSelectedAppearanceDisplayRgb(appearance, brush.rgb);
  }

  function deriveDetailAppearanceFromHands(left: AppearanceSlotValue, right: AppearanceSlotValue): AppearanceSlotValue {
    if (left.kind === 'flat_rgb' && right.kind === 'flat_rgb') {
      return { kind: 'flat_rgb', rgb: nearest_indexed_lerp_rgb(left.rgb, right.rgb, 0.5) };
    }
    if (left.kind === 'material' && right.kind === 'material' && left.material_id === right.material_id) {
      return { kind: 'material', material_id: left.material_id };
    }
    return cloneAppearanceValue(left)!;
  }

  function syncGraphicBrushAppearanceFromHands(brush: Brush): void {
    if (!brush.graphic) return;
    brush.appearance_slots = makeBrushAppearanceSlotsFromHands();
    brush.materials = deriveBrushMaterialsFromAppearanceSlots(brush.appearance_slots);
  }

  function syncAllGraphicBrushAppearancesFromHands(): void {
    syncGraphicBrushAppearanceFromHands(left_brush);
    syncGraphicBrushAppearanceFromHands(right_brush);
  }

  function applyBrushMaterial(brush: Brush, material_id: string | null, slot_targets?: AppearanceSlotTargetMask): void {
    const side: 'left' | 'right' = brush === right_brush ? 'right' : 'left';
    if (!material_id) return;
    const appearance: AppearanceSlotValue = { kind: 'material', material_id };
    setSelectedAppearanceForSide(side, appearance);
    applySelectedAppearanceToBrush(brush, appearance, slot_targets);
    syncAllGraphicBrushAppearancesFromHands();
  }

  function applyBrushColor(brush: Brush, rgb: Rgb, slot_targets?: AppearanceSlotTargetMask): void {
    const side: 'left' | 'right' = brush === right_brush ? 'right' : 'left';
    const appearance: AppearanceSlotValue = { kind: 'flat_rgb', rgb: { ...rgb } };
    setSelectedAppearanceForSide(side, appearance);
    applySelectedAppearanceToBrush(brush, appearance, slot_targets);
    syncAllGraphicBrushAppearancesFromHands();
  }

  function makeBrushAppearanceSlotsFromHands(): NonNullable<Brush['appearance_slots']> {
    const left = getSelectedAppearanceForSide('left');
    const right = getSelectedAppearanceForSide('right');
    return {
      1: cloneAppearanceValue(left),
      2: cloneAppearanceValue(right),
      3: deriveDetailAppearanceFromHands(left, right),
    };
  }

  syncBrushGraphicWeight(left_brush);
  syncBrushGraphicWeight(right_brush);
  syncAllGraphicBrushAppearancesFromHands();

  function getBrushMaterialState(side: 'left' | 'right'): { kind: 'none' | 'material' | 'color' | 'mixed'; material_id: string | null } {
    const selected = getSelectedAppearanceForSide(side);
    return selected.kind === 'material'
      ? { kind: 'material', material_id: selected.material_id }
      : { kind: 'color', material_id: null };
  }

  function getBrushSelectedMaterialId(side: 'left' | 'right'): string | null {
    const selected = getSelectedAppearanceForSide(side);
    return selected.kind === 'material' ? selected.material_id : null;
  }

  function getBrushSelectedPaletteRgb(side: 'left' | 'right'): Rgb | undefined {
    const selected = getSelectedAppearanceForSide(side);
    return selected.kind === 'flat_rgb' ? { ...selected.rgb } : undefined;
  }

  function getBrushSelectedDisplayRgb(side: 'left' | 'right'): Rgb {
    return getSelectedAppearanceDisplayRgb(getSelectedAppearanceForSide(side), getBrushForSide(side).rgb);
  }

  function getBrushForButton(button: number): Brush {
    return getBrushForSide(button === 2 ? 'right' : 'left');
  }

  function getBrushSizeForSide(side: 'left' | 'right'): number {
    return side === 'right' ? right_brush_size : left_brush_size;
  }

  function getEditChannelsForSide(side: 'left' | 'right'): EditChannels {
    return side === 'right' ? right_edit_channels : left_edit_channels;
  }

  function getSelectChannelsForSide(side: 'left' | 'right'): EditChannels {
    return side === 'right' ? right_select_channels : left_select_channels;
  }

  function saveBrushSlotTargets(): void {
    saveToolProperties({
      left_brush_slot_targets: left_brush_slot_targets,
      right_brush_slot_targets: right_brush_slot_targets,
    });
  }

  function saveSharedEditChannels(): void {
    saveToolProperties({
      left_brush_edit_channels: left_edit_channels,
      right_brush_edit_channels: right_edit_channels,
      left_picker_edit_channels: left_edit_channels,
      right_picker_edit_channels: right_edit_channels,
    });
  }

  function saveSharedSelectChannels(): void {
    saveToolProperties({
      left_bucket_select_channels: left_select_channels,
      right_bucket_select_channels: right_select_channels,
    });
  }

  function tool_supports_selection_target(tool: ToolType): boolean {
    return tool === 'pencil' || tool === 'eraser' || tool === 'bucket' || tool === 'line' || tool === 'rect_stroke' || tool === 'rect_fill';
  }

  function getToolTargetForSide(side: 'left' | 'right'): ToolEditTarget {
    return side === 'right' ? right_target : left_target;
  }

  function setToolTargetForSide(side: 'left' | 'right', target: ToolEditTarget): void {
    if (side === 'right') right_target = target;
    else left_target = target;
    saveToolProperties({ left_target, right_target });
  }

  function invertToolTarget(target: ToolEditTarget): ToolEditTarget {
    return target === 'selection' ? 'content' : 'selection';
  }

  function getEffectiveToolTargetForButton(button: number, tool?: ToolType): ToolEditTarget {
    const side: 'left' | 'right' = button === 2 ? 'right' : 'left';
    const resolvedTool = tool ?? (side === 'right' ? right_click_tool : left_click_tool);
    const base = getToolTargetForSide(side);
    return tool_target_invert_held && tool_supports_selection_target(resolvedTool) ? invertToolTarget(base) : base;
  }

  function set_user_selection_color(rgb: Rgb): void {
    const next = set_ui_customization_role_color('vivid', rgb);
    apply_ui_customization_runtime(next);
    saveToolProperties({ user_selection_color_rgb });
    void save_ui_customization_role_color(PAINTER_APP_CONFIG.selected_data_slot, 'vivid', rgb, active_profile_scope).catch(() => null);
    syncDOMRenderer();
    publish_local_selection_channel();
  }

  function getBrushSizeForButton(button: number): number {
    return getBrushSizeForSide(button === 2 ? 'right' : 'left');
  }

  function getPreviewBrush(): Brush {
    return getBrushForSide(active_property_side);
  }

  function saveBrushState(side: 'left' | 'right'): void {
    const brush = getBrushForSide(side);
    if (side === 'left') {
      saveToolProperties({
        left_brush_char: brush.char,
        left_brush_rgb: { ...brush.rgb },
        left_brush_graphic: brush.graphic ? { ...brush.graphic } : undefined,
        left_brush_appearance_slots: clone_appearance_slot_assignments(brush.appearance_slots),
        left_brush_materials: brush.materials ? { ...brush.materials } : undefined,
        left_selected_appearance: cloneAppearanceValue(left_selected_appearance),
        left_brush_weight_index: brush.weight_index,
        left_brush_size,
        brush_size: left_brush_size,
        active_property_side: side,
      });
      return;
    }
    saveToolProperties({
      right_brush_char: brush.char,
      right_brush_rgb: { ...brush.rgb },
      right_brush_graphic: brush.graphic ? { ...brush.graphic } : undefined,
      right_brush_appearance_slots: clone_appearance_slot_assignments(brush.appearance_slots),
      right_brush_materials: brush.materials ? { ...brush.materials } : undefined,
      right_selected_appearance: cloneAppearanceValue(right_selected_appearance),
      right_brush_weight_index: brush.weight_index,
      right_brush_size,
      active_property_side: side,
    });
  }
  
  // Text tool: space replaces character or preserves it
  let space_replace = true;
  
  // Text tool: spacing (horizontal movement per character, -16 to 16)
  let text_spacing = saved_tool_props.text_spacing ?? 1;
  
  // Text tool: charlead (vertical movement per character, -16 to 16)
  let text_charlead = saved_tool_props.text_charlead ?? 0;
  
  // Text tool: enterlead (vertical movement on Enter key, -16 to 16)
  let text_enterlead = saved_tool_props.text_enterlead ?? 1;
  
  // Text tool: enterspace (horizontal offset on Enter key, -16 to 16)
  let text_enterspace = saved_tool_props.text_enterspace ?? 0;
  
  // Paste tool: space replaces character or preserves it
  let paste_space_replace = saved_tool_props.paste_space_replace ?? true;
  
  // Paste tool: scale (0.1 to 3.0, representing 10% to 300%)
  let paste_scale = saved_tool_props.paste_scale ?? 1.0;
  let paste_angle_mode: 'relative' | 'absolute' = saved_tool_props.paste_angle_mode ?? 'relative';
  
  // Paste tool: ignore space option (true = skip null/space cells)
  let paste_ignore_space = saved_tool_props.paste_ignore_space ?? false;
  
  // Paste tool: ignore color option (true = skip cells matching ignore_color)
  let paste_ignore_color = saved_tool_props.paste_ignore_color ?? false;
  
  // Paste tool: color to ignore (indexed color rgb)
  let paste_ignore_color_rgb: { r: number; g: number; b: number } = saved_tool_props.paste_ignore_color_rgb ?? { r: 255, g: 255, b: 255 };
  
  // Paste tool: ignore pure black preset
  let paste_ignore_black = saved_tool_props.paste_ignore_black ?? false;
  
  // Paste tool: ignore pure white preset
  let paste_ignore_white = saved_tool_props.paste_ignore_white ?? false;
  
  // Gradiator state for image/text conversion - load from storage or create default
  const gradiator_state = loadGradiatorState();
  painterDiag('tool properties loaded');
  painterDiag('gradiator state loaded', {
    activeSlot: gradiator_state.activeSlot,
    slotLengths: gradiator_state.slots.map((slot) => typeof slot === 'string' ? slot.length : -1),
  });
  
  // Selection mode
  let selection_mode: SelectionMode = 'replace';
  
  // Clipboard for copy/paste
  let clipboard_data: string | null = null;
  
  // Preview points for line/rect tools
  let preview_points: { x: number; y: number }[] = [];

  let live_stroke_preview_changes: Array<{
    worldX: number;
    worldY: number;
    worldZ: number;
    newCell: GridCell;
  }> = [];

  function rememberLastUsedFilePath(filePath: string | null | undefined): void {
    const normalized = typeof filePath === 'string' ? filePath.trim() : '';
    if (!normalized) return;
    try {
      window.localStorage.setItem(LAST_FILE_PATH_KEY, normalized);
    } catch {
      // ignore
    }
  }

  function clearLastUsedFilePath(): void {
    try {
      window.localStorage.removeItem(LAST_FILE_PATH_KEY);
      painterImportant('last used file path cleared');
    } catch {
      // ignore
    }
  }

  function setActiveFileAssociation(filePath: string): void {
    current_file_path = filePath;
    current_filename = inferFilenameFromPath(filePath);
    rememberLastUsedFilePath(filePath);
    if (!suppress_recent_file_persistence) {
      persist_painter_resume_file(filePath);
    }
    painterImportant('active file association set', {
      current_file_path,
      current_filename,
      suppress_recent_file_persistence,
    });
  }

  function clearActiveFileAssociation(nextFilename: string = 'untitled', opts?: { clearLastUsed?: boolean }): void {
    current_file_path = null;
    current_filename = nextFilename;
    if (opts?.clearLastUsed) clearLastUsedFilePath();
    if (opts?.clearLastUsed) clear_launch_record('ascii_painter', PAINTER_APP_CONFIG.selected_data_slot);
    painterImportant('active file association cleared', {
      current_file_path,
      current_filename,
      current_painter_document_lineage_id,
      clear_last_used: Boolean(opts?.clearLastUsed),
    });
  }

  function get_active_painter_document_id(): string {
    const sync_state = painter_sync.get_state();
    return String(sync_state.bootstrap?.document_id ?? 'default_canvas').trim() || 'default_canvas';
  }

  function get_active_join_content_refs(): EngineContentRef[] {
    const refs: EngineContentRef[] = [];
    if (current_file_path) refs.push(create_painter_file_content_ref(current_file_path));
    const document_id = get_active_painter_document_id();
    if (document_id) refs.push(create_painter_remote_document_content_ref(document_id));
    return refs;
  }

  function is_multiplayer_host_role(): boolean {
    const sync_state = painter_sync.get_state();
    return current_session_role === 'host' && sync_state.authority_mode === 'authoritative_host' && Boolean(sync_state.bootstrap?.session_token);
  }

  function is_participant_role(): boolean {
    return current_session_role === 'participant';
  }

  function log_painter_host_flow(event: string, payload: Record<string, unknown> = {}): void {
    const sync_state = painter_sync.get_state();
    console.log('[PAINTER_HOST_FLOW]', JSON.stringify({
      event,
      slot: PAINTER_APP_CONFIG.selected_data_slot,
      current_session_role,
      authority_mode: sync_state.authority_mode,
      lifecycle: sync_state.lifecycle,
      session_token_present: Boolean(sync_state.bootstrap?.session_token),
      document_id: String(sync_state.bootstrap?.document_id ?? '').trim() || get_active_painter_document_id(),
      current_file_path,
      current_filename,
      ...payload,
    }));
  }

  function log_painter_hosted_session(event: string, payload: Record<string, unknown> = {}): void {
    console.log('[PAINTER_HOSTED_SESSION]', JSON.stringify({
      event,
      slot: PAINTER_APP_CONFIG.selected_data_slot,
      api_base_url: PAINTER_APP_CONFIG.api_base_url,
      current_session_role,
      current_file_path,
      current_filename,
      ...payload,
    }));
  }

  async function publish_hosted_painter_session_metadata(): Promise<void> {
    log_painter_hosted_session('publish_entered');
    if (!is_multiplayer_host_role()) {
      log_painter_hosted_session('publish_skipped', {
        reason: 'not_multiplayer_host_role',
      });
      return;
    }
    const sync_state = painter_sync.get_state();
    const session_token = String(sync_state.bootstrap?.session_token ?? '').trim();
    if (!session_token) {
      log_painter_hosted_session('publish_skipped', {
        reason: 'missing_session_token',
      });
      return;
    }
    const payload = {
      slot: PAINTER_APP_CONFIG.selected_data_slot,
      session_token,
      document_id: get_active_painter_document_id(),
      display_name: current_filename,
      file_backed: Boolean(current_file_path),
    };
    log_painter_hosted_session('publish_request', {
      document_id: payload.document_id,
      display_name: payload.display_name,
      file_backed: payload.file_backed,
      session_token_present: true,
    });
    painterImportant('publishing hosted painter session metadata', payload);
    const response = await fetch(`${PAINTER_APP_CONFIG.api_base_url}/painter/hosted-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => null) as any;
    log_painter_hosted_session('publish_response', {
      status: response.status,
      ok: Boolean(data?.ok),
      error: data?.error ?? null,
      hosted_document_id: data?.hosted_session?.document_id ?? null,
    });
    if (!response.ok || !data?.ok) {
      log_painter_hosted_session('publish_failed', {
        status: response.status,
        error: data?.error ?? null,
      });
      throw new Error(String(data?.error ?? `painter_hosted_session_publish_failed:${response.status}`));
    }
    log_painter_hosted_session('publish_succeeded', {
      hosted_document_id: data?.hosted_session?.document_id ?? payload.document_id,
      display_name: data?.hosted_session?.display_name ?? payload.display_name,
      file_backed: data?.hosted_session?.file_backed ?? payload.file_backed,
    });
    console.log('[PAINTER_HOST_READY]', JSON.stringify({
      event: 'remote_join_ready',
      slot: PAINTER_APP_CONFIG.selected_data_slot,
      api_base_url: PAINTER_APP_CONFIG.api_base_url,
      document_id: data?.hosted_session?.document_id ?? payload.document_id,
      display_name: data?.hosted_session?.display_name ?? payload.display_name,
      file_backed: data?.hosted_session?.file_backed ?? payload.file_backed,
      current_file_path,
      current_filename,
      current_session_role,
    }));
  }

  async function clear_hosted_painter_session_metadata(): Promise<void> {
    const sync_state = painter_sync.get_state();
    const session_token = String(sync_state.bootstrap?.session_token ?? '').trim();
    if (!session_token) return;
    painterImportant('clearing hosted painter session metadata', { slot: PAINTER_APP_CONFIG.selected_data_slot });
    const response = await fetch(`${PAINTER_APP_CONFIG.api_base_url}/painter/hosted-session`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot: PAINTER_APP_CONFIG.selected_data_slot, session_token }),
    });
    const data = await response.json().catch(() => null) as any;
    if (!response.ok || !data?.ok) {
      throw new Error(String(data?.error ?? `painter_hosted_session_clear_failed:${response.status}`));
    }
  }

  async function replace_authoritative_document_for_all(document: PainterDocument, source: string): Promise<void> {
    if (!is_multiplayer_host_role()) return;
    const sync_state = painter_sync.get_state();
    const session_token = String(sync_state.bootstrap?.session_token ?? '').trim();
    if (!session_token) return;
    const document_id = get_active_painter_document_id();
    const payload = {
      slot: PAINTER_APP_CONFIG.selected_data_slot,
      session_token,
      document_id,
      base_revision: sync_state.bootstrap?.revision ?? 0,
      command_id: `replace_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      snapshot: document,
    };
    painterImportant('replacing authoritative painter document', {
      document_id,
      source,
      current_filename,
      file_backed: Boolean(current_file_path),
    });
    const response = await fetch(`${PAINTER_APP_CONFIG.api_base_url}/painter/document/replace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => null) as any;
    if (!response.ok || !data?.ok) {
      throw new Error(String(data?.error ?? `painter_document_replace_failed:${response.status}`));
    }
    setCurrentPainterDocumentLineage(make_authoritative_lineage_id(document_id), source);
  }

  async function sync_hosted_document_authority(document: PainterDocument, source: string): Promise<void> {
    log_painter_host_flow('sync_authority_started', { source });
    if (!is_multiplayer_host_role()) {
      log_painter_host_flow('sync_authority_skipped', { source, reason: 'not_multiplayer_host_role' });
      return;
    }
    try {
      log_painter_host_flow('replace_started', { source });
      await replace_authoritative_document_for_all(document, source);
      log_painter_host_flow('replace_succeeded', { source });
    } catch (error) {
      log_painter_host_flow('replace_failed', { source, message: error instanceof Error ? error.message : String(error) });
      throw error;
    }
    try {
      log_painter_host_flow('publish_started', { source });
      await publish_hosted_painter_session_metadata();
      log_painter_host_flow('publish_succeeded', { source });
    } catch (error) {
      log_painter_host_flow('publish_failed', { source, message: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  function return_to_painter_launch_menu(reason: string): void {
    painterImportant('returning to painter launch menu', { reason, role: current_session_role });
    window.location.reload();
  }

  function setCurrentPainterDocumentLineage(lineage_id: string, source: string): void {
    painter_session_core.set_lineage(lineage_id, 0);
    sync_lineage_state_from_core();
    painterImportant('painter document lineage set', {
      lineage_id,
      source,
      current_file_path,
      current_filename,
    });
  }

  function make_authoritative_lineage_id(document_id: string): string {
    return `authoritative:${String(document_id ?? '').trim() || 'default_canvas'}`;
  }

  function can_submit_to_authoritative_document(): boolean {
    const sync_state = painter_sync.get_state();
    if (sync_state.authority_mode !== 'authoritative_host') return false;
    const document_id = String(sync_state.bootstrap?.document_id ?? '').trim();
    if (!document_id) return false;
    const authoritative_lineage_id = make_authoritative_lineage_id(document_id);
    const matches = current_painter_document_lineage_id === authoritative_lineage_id;
    if (!matches) {
      painterImportant('authoritative submit blocked due to lineage mismatch', {
        current_painter_document_lineage_id,
        authoritative_lineage_id,
        document_id,
        current_file_path,
        current_filename,
      });
    }
    return matches;
  }

  function cloneGridCellForPreview(cell: GridCell): GridCell {
    return make_history_cell_from_runtime_record(cell);
  }

  function makeResolvedPreviewCell(winner: ReturnType<typeof resolve_painter_group_preview_winner>): GridCell {
    if (!winner.cell) {
      return { char: ' ', graphic: undefined, appearance_slots: undefined, materials: undefined, rgb: { r: 0, g: 0, b: 0 }, weight_index: 0 };
    }
    return make_history_cell_from_runtime_record(winner.cell);
  }

  function getPainterRenderScene(): PainterProjectedScene {
    if (!painter_display_projection) {
      return {
        bounds: { width: 0, height: 0, minZ: 0, maxZ: 0, depth: 1 },
        camera: voxelSpace.camera,
        slots: new Map(),
      };
    }
    const needsLivePreview = live_stroke_preview_changes.length > 0;
    const needsSelectionPreview = hasAnyVisibleSelectionChannels();
    if (!needsLivePreview && !needsSelectionPreview) {
      return painter_display_projection.scene;
    }
    const previewScene = clone_projected_scene(painter_display_projection.scene);
    const active_group_id = resolve_current_runtime_group_id();
    if (needsLivePreview && active_group_id) applyLivePreviewToProjectedScene(previewScene, current_tool === 'paste');
    if (needsSelectionPreview) applySelectionPreviewToProjectedScene(previewScene);
    return previewScene;
  }

  async function getAsciiDrawingsDir(): Promise<string | null> {
    try {
      if (!window.electronAPI?.getAsciiDrawingsDir) return null;
      return await window.electronAPI.getAsciiDrawingsDir();
    } catch {
      return null;
    }
  }

  function inferFilenameFromPath(path: string): string {
    const parts = path.split(/[/\\]/g);
    const last = parts[parts.length - 1] || 'untitled.json';
    return last.replace(/\.json$/i, '');
  }

  function makeNewFileBasename(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    return `drawing_${stamp}.json`;
  }

  function apply_authoritative_painter_bootstrap(bootstrap: { document_id: string; revision: number; snapshot: PainterDocument | null }): void {
    if (!bootstrap.snapshot || bootstrap.revision <= authoritative_revision_applied) return;
    const result = painter_session_core.apply_authoritative_snapshot(bootstrap.snapshot, {
      document_id: bootstrap.document_id,
      revision: bootstrap.revision,
    });
    sync_local_session_state_from_core();
    sync_lineage_state_from_core();
    if (!result.applied) {
      painterImportant('authoritative bootstrap skipped due to local lineage mismatch', {
        incoming_document_id: bootstrap.document_id,
        incoming_lineage_id: make_authoritative_lineage_id(bootstrap.document_id),
        current_painter_document_lineage_id,
        revision: bootstrap.revision,
      });
      return;
    }
    applyPainterDocumentSnapshot(bootstrap.snapshot, { reset_history: false });
    if (is_participant_role()) {
      clearActiveFileAssociation(current_filename || String(bootstrap.document_id ?? '').trim() || 'untitled', { clearLastUsed: true });
    }
    authoritative_revision_applied = Math.max(authoritative_revision_applied, bootstrap.revision);
    boot_document_restored = true;
    painterImportant('applied authoritative painter bootstrap', {
      document_id: bootstrap.document_id,
      revision: bootstrap.revision,
      role: current_session_role,
    });
  }

  function exportCurrentPainterDocument(): PainterDocument {
    return export_painter_document(painter_document_runtime);
  }

  function exportCurrentPainterDocumentText(): string {
    const { minX, minY, width, height } = painter_document_runtime.document.bounds;
    const resolvedByXY = new Map<string, string>();
    for (const resolved of painter_document_runtime.resolved_visible_index.values()) {
      resolvedByXY.set(`${resolved.x}:${resolved.y}`, resolved.cell.char);
    }
    const lines: string[] = [];
    for (let y = minY; y < minY + height; y += 1) {
      let line = '';
      for (let x = minX; x < minX + width; x += 1) {
        line += resolvedByXY.get(`${x}:${y}`) ?? ' ';
      }
      lines.push(line);
    }
    return lines.join('\n');
  }

  function applyPainterDocumentSnapshot(document: PainterDocument, options?: { reset_history?: boolean }): void {
    const preservedCameraState = getPainterPreservedCameraState();
    stopPainterPlayback();
    painter_session_core.replace_document(document, {
      lineage_id: current_painter_document_lineage_id,
      authoritative_revision: authoritative_revision_applied,
    });
    sync_local_session_state_from_core();
    sync_lineage_state_from_core();
    syncPainterTimingStateAfterDocumentMutation();
    rebuild_voxel_space_from_runtime();

    const savedCam = getSavedPainterCameraConfig();
    if (savedCam && Object.keys(savedCam).length > 0) {
      painter_camera_state = createSanitizedPainterCamera(savedCam);
      syncVoxelSpaceCameraFromPainterCamera();
      syncPainterViewStatesFromLegacyCamera();
    }

    syncPainterCameraViewTransform();
    ensureValidFocusPlane();
    restorePainterCameraState(preservedCameraState);
    painter_display_projection = rebuildPainterDisplayProjection(getPainterDisplayViewState(), getPainterStableViewAnchor());
    syncProjectedGridFromDisplay();
    syncDOMRenderer();
    if (options?.reset_history !== false) {
      resetPainterHistoryState('apply painter document snapshot');
    }
  }

  painter_sync.subscribe((sync_state) => {
    sync_selection_channels_from_multiplayer_state(sync_state.selection_channels);
    syncPainterCanvasSelectionFromWorld();
    syncDOMRenderer();
    if (!sync_state.bootstrap?.snapshot) return;
    apply_authoritative_painter_bootstrap(sync_state.bootstrap);
  });

  window.addEventListener('painter-hosted-session-updated', ((event: Event) => {
    const payload = (event as CustomEvent<{ hosted_session?: { display_name?: string | null } | null }>).detail;
    const hosted_session = payload?.hosted_session ?? null;
    if (!is_participant_role()) return;
    if (!hosted_session) return;
    current_filename = String(hosted_session.display_name ?? current_filename).trim() || current_filename;
    painterImportant('participant updated hosted painting display name', { current_filename });
  }) as EventListener);

  window.addEventListener('painter-session-ended', ((event: Event) => {
    const payload = (event as CustomEvent<{ reason?: string | null }>).detail;
    return_to_painter_launch_menu(String(payload?.reason ?? 'session_ended'));
  }) as EventListener);

  async function writeArtworkToFileAtomic(filePath: string): Promise<void> {
    const data = exportPainterDocumentToJSON(exportCurrentPainterDocument());
    const api = window.electronAPI;
    if (!api?.writeFileAtomic) {
      throw new Error('electronAPI.writeFileAtomic unavailable');
    }
    const result = await api.writeFileAtomic(filePath, data);
    if (!result?.success) {
      throw new Error(result?.error || 'Failed to write file');
    }
  }

  async function flush_auto_save(): Promise<void> {
    if (auto_save_timer) {
      clearTimeout(auto_save_timer);
      auto_save_timer = null;
    }
    // Prefer file-backed autosave when a file is active.
    painterImportant('flush auto save requested', {
      current_file_path,
      current_filename,
      file_backed: Boolean(current_file_path && window.electronAPI?.writeFileAtomic),
    });
    if (current_file_path && window.electronAPI?.writeFileAtomic) {
      painterImportant('flush auto save writing active file', {
        current_file_path,
        current_filename,
      });
      await writeArtworkToFileAtomic(current_file_path);
      return;
    }
    painterImportant('flush auto save writing in-memory autosave', {
      current_file_path,
      current_filename,
    });
    autoSavePainterDocument(exportCurrentPainterDocument(), current_filename);
  }

  // Auto-save timer
  let auto_save_timer: ReturnType<typeof setTimeout> | null = null;
  let painter_interaction_registry: ReturnType<typeof create_interaction_registry_runtime> | null = null;

  // Create module registry
  const registry = create_module_registry();

  function applyPersistedPainterModuleLayout(): void {
    const savedCanvasRect = getModulePosition('painter_canvas');
    if (savedCanvasRect) {
      canvas_rect = savedCanvasRect;
      if (canvas_module) canvas_module.rect = savedCanvasRect;
      refreshPainterProjectionPreservingCameraFrame();
    }

    const applyModuleRect = (moduleId: string): void => {
      const module = registry.get(moduleId);
      const savedRect = getModulePosition(moduleId);
      if (module && savedRect) module.rect = savedRect;
    };

    applyModuleRect('char_selector');
    applyModuleRect('brush_preview');
    applyModuleRect('color_selector');
    applyModuleRect('color_block');
    applyModuleRect('toolbox');
    applyModuleRect('tool_properties');
    applyModuleRect('customization_panel');
    applyModuleRect('customization_picker');
    applyModuleRect('indexed_palette_panel');
    applyModuleRect('indexed_palette_picker');
    applyModuleRect('selection_panel');
    applyModuleRect('layer_palette');
    applyModuleRect('camera_control');
    applyModuleRect('controls_panel');

    char_selector_open = getInitialModuleVisibility('char_selector', true);
    brush_preview_open = getInitialModuleVisibility('brush_preview', true);
    color_selector_open = getInitialModuleVisibility('color_selector', true);
    color_block_open = getInitialModuleVisibility('color_block', true);
    toolbox_open = getInitialModuleVisibility('toolbox', true);
    tool_properties_open = getInitialModuleVisibility('tool_properties', true);
    customization_open = getInitialModuleVisibility('customization_panel', false);
    customization_picker_open = getInitialModuleVisibility('customization_picker', false);
    indexed_palette_open = getInitialModuleVisibility('indexed_palette_panel', false);
    indexed_palette_picker_open = getInitialModuleVisibility('indexed_palette_picker', false);
    selection_panel_open = getInitialModuleVisibility('selection_panel', true);
    layer_palette_open = getInitialModuleVisibility('layer_palette', true);
    camera_control_open = getInitialModuleVisibility('camera_control', false);
    controls_open = getInitialModuleVisibility('controls_panel', false);

    if (registry.has('char_selector')) registry.set_visibility('char_selector', char_selector_open);
    if (registry.has('brush_preview')) registry.set_visibility('brush_preview', brush_preview_open);
    if (registry.has('color_selector')) registry.set_visibility('color_selector', color_selector_open);
    if (registry.has('color_block')) registry.set_visibility('color_block', color_block_open);
    if (registry.has('toolbox')) registry.set_visibility('toolbox', toolbox_open);
    if (registry.has('tool_properties')) registry.set_visibility('tool_properties', tool_properties_open);
    if (registry.has('customization_panel')) registry.set_visibility('customization_panel', customization_open);
    if (registry.has('customization_picker')) registry.set_visibility('customization_picker', customization_picker_open);
    if (registry.has('indexed_palette_panel')) registry.set_visibility('indexed_palette_panel', indexed_palette_open);
    if (registry.has('indexed_palette_picker')) registry.set_visibility('indexed_palette_picker', indexed_palette_picker_open);
    if (registry.has('selection_panel')) registry.set_visibility('selection_panel', selection_panel_open);
    if (registry.has('layer_palette')) registry.set_visibility('layer_palette', layer_palette_open);
    if (registry.has('camera_control')) registry.set_visibility('camera_control', camera_control_open);
    if (registry.has('controls_panel')) registry.set_visibility('controls_panel', controls_open);
  }
  refreshPainterInteractionRegistry();
  registry.subscribe(() => {
    refreshPainterInteractionRegistry();
  });

  // Schedule auto-save (debounced - waits for user to stop making changes)
  function schedule_auto_save() {
    if (auto_save_timer) {
      clearTimeout(auto_save_timer);
    }
    auto_save_timer = setTimeout(() => {
      void flush_auto_save().then(() => {
        painterDiag('auto-saved artwork');
      }).catch((e) => {
        diag_log('painter', 'important', 'PAINTER', 'auto-save failed', { error: e instanceof Error ? e.message : String(e) }, { sink: 'warn' });
      });
    }, 2000); // Auto-save shortly after last change
  }

  // Ensure we don't lose the last few strokes if the app closes quickly.
  window.addEventListener('beforeunload', () => {
    try {
      void flush_auto_save();
    } catch {
      // ignore
    }
  });

  async function loadArtworkFromContent(content: string, loadedPath?: string): Promise<void> {
    painterDiag('loading artwork content', { loadedPath: loadedPath ?? null, size: content.length });
    const preservedCameraState = getPainterPreservedCameraState();
    let loadedPainterDocument: PainterDocument | null = null;
    try {
      loadedPainterDocument = importPainterDocumentFromJSON(content);
    } catch {
      loadedPainterDocument = null;
    }

    if (loadedPainterDocument) {
      applyPainterDocumentSnapshot(loadedPainterDocument);
      setCurrentPainterDocumentLineage(loadedPath ? `file:${loadedPath}` : `memory:json:${Date.now()}`, loadedPath ? 'json_file_load' : 'json_memory_load');
    } else {
      voxelSpace = importVoxelSpaceFromJSON(content);
      rebuild_runtime_from_voxel_space({ preserve_group_order: true });
      setCurrentPainterDocumentLineage(loadedPath ? `file:${loadedPath}` : `memory:legacy_json:${Date.now()}`, loadedPath ? 'legacy_file_load' : 'legacy_memory_load');
      clear_all_selection_channels({ publish: false });

      // Apply persisted camera/UI settings (do not import from file)
      const savedCam = getSavedPainterCameraConfig();
      if (savedCam && Object.keys(savedCam).length > 0) {
        painter_camera_state = createSanitizedPainterCamera(savedCam);
        syncVoxelSpaceCameraFromPainterCamera();
        syncPainterViewStatesFromLegacyCamera();
      }

      ensureValidFocusPlane();
      restorePainterCameraState(preservedCameraState);
      painter_display_projection = rebuildPainterDisplayProjection(getPainterDisplayViewState(), getPainterStableViewAnchor());
      syncProjectedGridFromDisplay();
      syncDOMRenderer();

      resetPainterHistoryState('load artwork legacy voxel fallback');
    }

    if (loadedPath) {
      setActiveFileAssociation(loadedPath);
    } else {
      clearActiveFileAssociation(current_filename, { clearLastUsed: true });
    }

    painterImportant('artwork content loaded', {
      loaded_path: loadedPath ?? null,
      current_file_path,
      current_filename,
    });

    schedule_auto_save();
    console.log('[PAINTER_LAUNCH]', JSON.stringify({
      event: 'sync_hosted_document_authority_after_load',
      loaded_path: loadedPath ?? null,
      current_file_path,
      current_filename,
      current_session_role,
    }));
    await sync_hosted_document_authority(exportCurrentPainterDocument(), loadedPath ? 'host_load_file' : 'host_load_memory');
  }

  async function new_file(): Promise<void> {
    log_painter_host_flow('new_file_started');
    const preservedCameraState = getPainterPreservedCameraState();
    const dir = await getAsciiDrawingsDir();
    if (!dir) {
      // Fallback: just create a new in-memory canvas
      const document = create_painter_document(CANVAS_WIDTH, CANVAS_HEIGHT, { min_z: 0, max_z: 0, default_group_name: 'Group 1' });
      applyPainterDocumentSnapshot(document);
      painter_groups_auto_key_enabled = true;
      painterDiag('groups auto key enabled for new file', { enabled: painter_groups_auto_key_enabled, branch: 'in_memory' });
      setCurrentPainterDocumentLineage(`memory:new_file:${Date.now()}`, 'new_file_in_memory');
      clear_all_selection_channels({ publish: false });
      const savedCam = getSavedPainterCameraConfig();
      if (savedCam && Object.keys(savedCam).length > 0) {
        painter_camera_state = { ...painter_camera_state, ...sanitizePainterCameraConfig(savedCam) };
        syncVoxelSpaceCameraFromPainterCamera();
        syncPainterViewStatesFromLegacyCamera();
      }
      syncPainterCameraViewTransform();
      restorePainterCameraState(preservedCameraState);
      painter_display_projection = rebuildPainterDisplayProjection(getPainterDisplayViewState(), getPainterStableViewAnchor());
      syncProjectedGridFromDisplay();
      syncDOMRenderer();
      resetPainterHistoryState('new file in-memory fallback');
      clearActiveFileAssociation('untitled', { clearLastUsed: true });
      clearAutoSave();
      log_painter_host_flow('new_file_ready_for_sync', { branch: 'in_memory' });
      try {
        await sync_hosted_document_authority(exportCurrentPainterDocument(), 'host_new_file_memory');
        log_painter_host_flow('new_file_sync_completed', { branch: 'in_memory' });
      } catch (error) {
        log_painter_host_flow('new_file_sync_failed', { branch: 'in_memory', message: error instanceof Error ? error.message : String(error) });
        throw error;
      }
      return;
    }

    const basename = makeNewFileBasename();
    const filePath = `${dir}\\${basename}`;

    const document = create_painter_document(CANVAS_WIDTH, CANVAS_HEIGHT, { min_z: 0, max_z: 0, default_group_name: 'Group 1' });
    applyPainterDocumentSnapshot(document);
    painter_groups_auto_key_enabled = true;
    painterDiag('groups auto key enabled for new file', { enabled: painter_groups_auto_key_enabled, branch: 'file_backed' });
    setCurrentPainterDocumentLineage(`file:${filePath}`, 'new_file_backed');
    clear_all_selection_channels({ publish: false });
    const savedCam = getSavedPainterCameraConfig();
    if (savedCam && Object.keys(savedCam).length > 0) {
      painter_camera_state = { ...painter_camera_state, ...sanitizePainterCameraConfig(savedCam) };
      syncVoxelSpaceCameraFromPainterCamera();
      syncPainterViewStatesFromLegacyCamera();
    }
    syncPainterCameraViewTransform();
    restorePainterCameraState(preservedCameraState);
    painter_display_projection = rebuildPainterDisplayProjection(getPainterDisplayViewState(), getPainterStableViewAnchor());
    syncProjectedGridFromDisplay();
    syncDOMRenderer();
    resetPainterHistoryState('new file initialized');

    setActiveFileAssociation(filePath);

    await writeArtworkToFileAtomic(filePath);
    log_painter_host_flow('new_file_ready_for_sync', { branch: 'file_backed', file_path: filePath });
    try {
      await sync_hosted_document_authority(exportCurrentPainterDocument(), 'host_new_file');
      log_painter_host_flow('new_file_sync_completed', { branch: 'file_backed', file_path: filePath });
    } catch (error) {
      log_painter_host_flow('new_file_sync_failed', { branch: 'file_backed', file_path: filePath, message: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  async function save_file(): Promise<void> {
    const dir = await getAsciiDrawingsDir();
    if (!current_file_path && dir) {
      current_file_path = `${dir}\\${makeNewFileBasename()}`;
      current_filename = inferFilenameFromPath(current_file_path);
    }
    if (!current_file_path) {
      // Fallback for non-electron
      const name = generateFilename('ascii_art', 'json');
      const data = exportPainterDocumentToJSON(exportCurrentPainterDocument());
      downloadFile(data, name, 'application/json');
      return;
    }
    await writeArtworkToFileAtomic(current_file_path);
    rememberLastUsedFilePath(current_file_path);
    await publish_hosted_painter_session_metadata();
  }

  async function load_file(): Promise<void> {
    const dir = await getAsciiDrawingsDir();
    const api = window.electronAPI;
    if (!dir || !api?.showOpenDialog || !api?.readFile) {
      // Browser fallback
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        const content = await readFileAsText(file);
        await loadArtworkFromContent(content);
      };
      input.click();
      return;
    }

    const openResp = await api.showOpenDialog({
      defaultPath: dir,
      properties: ['openFile'],
      filters: [
        { name: 'ASCII Drawings', extensions: ['json'] },
      ],
    });

    if (!openResp?.success) throw new Error(openResp?.error || 'Open dialog failed');
    const result = openResp.result;
    if (!result || result.canceled || !result.filePaths || result.filePaths.length === 0) return;

    const path = result.filePaths[0];
    const readResp = await api.readFile(path);
    if (!readResp?.success) throw new Error(readResp?.error || 'Failed to read file');
    await loadArtworkFromContent(readResp.content || '', path);
  }

  async function rename_painting(): Promise<void> {
    if (!is_multiplayer_host_role() && current_session_role !== 'host') return;
    const next_name = String(window.prompt('Rename painting', current_filename) ?? '').trim();
    if (!next_name) return;
    const sanitized = next_name.endsWith('.json') ? next_name : `${next_name}.json`;
    if (current_file_path && window.electronAPI?.writeFileAtomic) {
      const dir = current_file_path.includes('\\') ? current_file_path.slice(0, current_file_path.lastIndexOf('\\')) : null;
      if (dir) {
        const next_path = `${dir}\${sanitized}`;
        await writeArtworkToFileAtomic(next_path);
        setActiveFileAssociation(next_path);
      } else {
        current_filename = sanitized.replace(/\.json$/i, '');
      }
    } else {
      current_filename = sanitized.replace(/\.json$/i, '');
    }
    await publish_hosted_painter_session_metadata();
    painterImportant('painting renamed', { current_file_path, current_filename });
  }

  async function quit_painting(): Promise<void> {
    if (current_session_role === 'host' && is_multiplayer_host_role()) {
      const sync_state = painter_sync.get_state();
      const session_token = String(sync_state.bootstrap?.session_token ?? '').trim();
      if (session_token) {
        const response = await fetch(`${PAINTER_APP_CONFIG.api_base_url}/painter/session/end`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slot: PAINTER_APP_CONFIG.selected_data_slot,
            session_token,
            reason: 'host_quit_painting',
          }),
        });
        const data = await response.json().catch(() => null) as any;
        if (!response.ok || !data?.ok) {
          throw new Error(String(data?.error ?? `painter_session_end_failed:${response.status}`));
        }
      }
    }
    return_to_painter_launch_menu(current_session_role === 'host' ? 'host_quit_painting' : 'participant_quit_painting');
  }

  // Auto-open the last file on boot (best effort).
  // IMPORTANT: Never set current_file_path without loading, otherwise beforeunload autosave
  // could overwrite the last file with whatever is currently in memory.
  if (!options?.skip_boot_restore && window.electronAPI?.readFile) {
    void (async () => {
      const api = window.electronAPI;
      if (!api?.readFile) return;
      if (boot_document_restored) {
        painterImportant('boot reopen skipped', {
          reason: 'boot_document_restored',
          current_file_path,
          current_filename,
        });
        return;
      }
      let last: string | null = null;
      try {
        last = window.localStorage.getItem(LAST_FILE_PATH_KEY);
      } catch {
        last = null;
      }
      painterImportant('boot reopen candidate read', {
        last_file_path: last,
        current_file_path,
        current_filename,
      });
      if (!last) return;

      const res = await api.readFile(last);
      if (!res?.success || typeof res.content !== 'string') {
        try {
          window.localStorage.removeItem(LAST_FILE_PATH_KEY);
        } catch {
          // ignore
        }
        return;
      }

      painterImportant('boot restore source chosen', {
        source: 'last_file_reopen',
        path: last,
      });
      await loadArtworkFromContent(res.content, last);
    })().catch(() => {
      // ignore
    });
  }

  function applyLiveStrokePreview(args: {
    changes: Array<{
      worldX: number;
      worldY: number;
      worldZ: number;
      newCell: GridCell;
    }>;
    anchor_world: { x: number; y: number; z: number } | null;
    plane: number | null;
  }): void {
    live_stroke_preview_changes = args.changes.map((change) => ({
      worldX: change.worldX,
      worldY: change.worldY,
      worldZ: change.worldZ,
      newCell: make_history_cell_from_runtime_record(change.newCell),
    }));
    const normalizedAnchor = args.anchor_world ? normalizePainterWorldTarget(args.anchor_world) : null;
    const painterView = getPainterCanvasViewInstance();
    const frameAnchorWorld = painterView.camera_state?.frame_anchor ?? getPainterCanvasFrameAnchorWorld();
    const previewTargetWorld = getPainterPreviewFocusTargetWorld(normalizedAnchor, args.plane, getPainterDisplayViewState());
    const anchorChanged = !!normalizedAnchor && (
      previewTargetWorld.x !== frameAnchorWorld.x
      || previewTargetWorld.y !== frameAnchorWorld.y
      || previewTargetWorld.z !== frameAnchorWorld.z
    );
    const planeChanged = typeof args.plane === 'number'
      && Math.floor(args.plane) !== (painter_display_projection?.focus_world_plane ?? getPainterFocusWorldPlane());
    if (normalizedAnchor && (anchorChanged || planeChanged)) {
      const currentAnchor = getPainterInteractionAnchor();
      refreshPainterProjectionFromWorld({
        ...currentAnchor,
        kind: 'pointer',
        world: { ...normalizedAnchor },
      }, {
        persist_target_world: false,
        target_world: previewTargetWorld,
        projection_anchor_world: frameAnchorWorld,
      });
      return;
    }
    if (!normalizedAnchor && planeChanged) {
      refreshPainterProjectionFromWorld(getPainterStableViewAnchor(), {
        persist_target_world: false,
        target_world: previewTargetWorld,
        projection_anchor_world: frameAnchorWorld,
      });
      return;
    }
    syncDOMRenderer();
  }
  
  // Keyboard shortcuts for layer navigation
  // NOTE: Page Up/Down and Tab removed - use Layer Palette UI buttons instead
  
  // Create canvas module
  canvas_module = make_painter_canvas_module({
    id: 'painter_canvas',
    view_id: PAINTER_CANVAS_VIEW_ID,
    rect: canvas_rect,
    grid,
    get_camera: () => voxelSpace.camera,
    get_selected_z: () => getPainterFocusWorldPlane(),
    get_active_group_id: () => resolve_current_runtime_group_id(),
    get_world_cell: (world) => {
      const coordKey = `${Math.floor(world.x)}:${Math.floor(world.y)}:${Math.floor(world.z)}`;
      const resolved = painter_document_runtime.resolved_visible_index.get(coordKey) ?? null;
      if (!resolved) return { char: ' ', graphic: undefined, appearance_slots: undefined, materials: undefined, rgb: { r: 0, g: 0, b: 0 }, weight_index: 0 };
      return make_history_cell_from_runtime_record(resolved.cell);
    },
    get_active_group_world_cell: (world) => {
      const group_id = resolve_current_runtime_group_id();
      if (!group_id) return { char: ' ', graphic: undefined, appearance_slots: undefined, materials: undefined, rgb: { r: 0, g: 0, b: 0 }, weight_index: 0 };
      const coordKey = `${Math.floor(world.x)}:${Math.floor(world.y)}:${Math.floor(world.z)}`;
      const record = painter_document_runtime.group_voxel_index.get(group_id)?.get(coordKey) ?? null;
      if (!record) return { char: ' ', graphic: undefined, appearance_slots: undefined, materials: undefined, rgb: { r: 0, g: 0, b: 0 }, weight_index: 0 };
      return make_history_cell_from_runtime_record(record);
    },
    get_active_group_world_voxels: () => {
      const group_id = resolve_current_runtime_group_id();
      if (!group_id) return [];
      const groupIndex = painter_document_runtime.group_voxel_index.get(group_id);
      if (!groupIndex) return [];
      return Array.from(groupIndex.values()).map((record) => ({
        x: record.x,
        y: record.y,
        z: record.z,
        cell: make_history_cell_from_runtime_record(record),
      }));
    },
    get_active_group_world_bounds: () => get_active_group_world_bounds(),
    get_active_group_locked: () => {
      const group_id = resolve_current_runtime_group_id();
      return group_id ? Boolean(painter_document_runtime.document.groups[group_id]?.locked) : false;
    },
    on_group_location_drag_commit: (delta) => {
      const group_id = resolve_current_runtime_group_id();
      if (!group_id) return false;
      return applyPainterGroupLocationDelta(group_id, delta, 'drag');
    },
    get_current_tool: () => current_tool,
    get_preview_brush: () => getPreviewBrush(),
    get_brush_for_button: (button) => getBrushForButton(button),
    get_tool_target_for_button: (button, tool) => getEffectiveToolTargetForButton(button, tool),
    get_brush_edit_channels_for_button: (button) => getEditChannelsForSide(button === 2 ? 'right' : 'left'),
    get_appearance_slot_targets_for_button: (button) => getBrushSlotTargetsForSide(button === 2 ? 'right' : 'left'),
    get_bucket_select_channels_for_button: (button) => getSelectChannelsForSide(button === 2 ? 'right' : 'left'),
    get_brush_size: () => getBrushSizeForSide(active_property_side),
    get_brush_size_for_button: (button) => getBrushSizeForButton(button),
    get_bucket_continuous: () => bucket_continuous,
    get_bucket_same_depth_only: () => bucket_same_depth_only,
    get_bucket_allow_diagonal: () => bucket_allow_diagonal,
    get_rect_select_all_depths: () => rect_select_all_depths,
    get_lasso_select_all_depths: () => lasso_select_all_depths,
    get_space_replace: () => space_replace,
    get_paste_space_replace: () => paste_space_replace,
    get_paste_scale: () => paste_scale,
    get_paste_angle_mode: () => paste_angle_mode,
    get_gradiator_state: () => gradiator_state,
    get_paste_ignore_space: () => paste_ignore_space,
    get_paste_ignore_black: () => paste_ignore_black,
    get_paste_ignore_white: () => paste_ignore_white,
    get_paste_ignore_color: () => paste_ignore_color,
    get_paste_ignore_color_rgb: () => paste_ignore_color_rgb,
    get_move_mask_modifier_held: () => move_mask_modifier_held,
    get_world_point_for_grid: (x, y) => painterGridPointToWorld(x, y),
    get_world_point_for_grid_on_plane: (x, y, plane) => {
      if (!painter_display_projection) return null;
      const targetX = Math.floor(x);
      const targetY = Math.floor(y);
      if (targetX < 0 || targetX >= painter_display_projection.projected_bounds.width || targetY < 0 || targetY >= painter_display_projection.projected_bounds.height) return null;
      return unproject_plane_point_with_roll({
        u: targetX + painter_display_projection.projected_bounds.min_u,
        v: targetY + painter_display_projection.projected_bounds.min_v,
        plane: Math.floor(plane),
      }, painter_display_projection.view_state);
    },
    get_grid_point_for_world: (world) => painterWorldToGridPoint(world),
    // Interaction mapping must follow the currently rendered/displayed view,
    // not the pending target view, otherwise text/draw input can be resolved
    // against a different angle than the one on screen during startup or view
    // transitions.
    get_view_state: () => getPainterDisplayViewState(),
    get_is_playing: () => painter_playback_running,
    on_step_view_action: (action) => {
      stepPainterViewAction(action);
    },
    on_step_depth: (dir) => {
      stepPainterDepth(dir);
    },
    handle_text_mode_reserved_shortcut: (e) => {
      const cameraActionBindings: Array<{ id: string; action: 'swing_left' | 'swing_right' | 'swing_up' | 'swing_down' | 'roll_left' | 'roll_right' }> = [
        { id: 'painter.view.swing_left', action: 'swing_left' },
        { id: 'painter.view.swing_right', action: 'swing_right' },
        { id: 'painter.view.swing_up', action: 'swing_up' },
        { id: 'painter.view.swing_down', action: 'swing_down' },
        { id: 'painter.view.roll_left', action: 'roll_left' },
        { id: 'painter.view.roll_right', action: 'roll_right' },
      ];
      for (const binding of cameraActionBindings) {
        if (!control_binding_matches_keyboard_event(painter_controls.runtime.get_binding(binding.id), e)) continue;
        stepPainterViewAction(binding.action);
        return true;
      }
      const depthActionBindings: Array<{ id: string; dir: -1 | 1 }> = [
        { id: 'painter.view.depth_prev', dir: -1 },
        { id: 'painter.view.depth_next', dir: 1 },
      ];
      for (const binding of depthActionBindings) {
        if (!control_binding_matches_keyboard_event(painter_controls.runtime.get_binding(binding.id), e)) continue;
        stepPainterDepth(binding.dir);
        return true;
      }
      return false;
    },
    get_camera_frame_anchor_world: () => getPainterCanvasFrameAnchorWorld(),
    set_camera_frame_anchor_world: (anchor, context) => {
      setPainterCameraFrameAnchorFromPan(anchor, context);
    },
    get_pan_step_size_px: () => getPainterPanStepSizePx(),
    on_history_applied: () => {
      refreshPainterProjectionFromWorld();
    },
    on_text_cursor_anchor_changed: (anchor) => {
      handlePainterTextCursorAnchorChanged(anchor);
    },
    get_selection_status: () => getPainterSelectionStatus(),
    get_selection_mode: () => selection_mode,
    get_text_spacing: () => text_spacing,
    get_text_charlead: () => text_charlead,
    get_text_enterlead: () => text_enterlead,
    get_text_enterspace: () => text_enterspace,
    preview_points,
    get_left_click_tool: () => left_click_tool,
    get_right_click_tool: () => right_click_tool,
    get_focus_layer_z: () => getPainterFocusWorldPlane(),
    get_focus_world_plane: () => painter_display_projection?.focus_world_plane ?? getPainterFocusWorldPlane(),
    cycle_focus_layer: (dir) => {
      stepPainterDepth(dir < 0 ? -1 : 1);
    },
    history,
    on_undo_request: () => performPainterUndo(),
    on_redo_request: () => performPainterRedo(),
    on_edit_committed: () => {
      schedule_auto_save();
    },
    on_live_stroke_preview: ({ changes, anchor_world, plane }) => {
      applyLiveStrokePreview({
        changes: changes.map((change) => ({
          worldX: change.worldX,
          worldY: change.worldY,
          worldZ: change.worldZ,
          newCell: make_history_cell_from_runtime_record(change.newCell),
        })),
        anchor_world,
        plane,
      });
    },
    on_commit_cell_changes: ({ changes }) => {
      const applied_locally = apply_authored_group_cell_changes(changes.map((change) => ({
        worldX: change.worldX,
        worldY: change.worldY,
        worldZ: change.worldZ,
        newCell: make_history_cell_from_runtime_record(change.newCell),
      })));
      if (applied_locally) {
        refreshPainterProjectionPreservingCameraFrame();
      }
      if (!can_submit_to_authoritative_document()) return;
      const active_group_id = resolve_current_runtime_group_id();
      if (!active_group_id) return;
      void painter_sync.submit_cell_changes(active_group_id, painter_current_breath, painter_groups_auto_key_enabled, changes.map((change) => ({
        x: change.worldX,
        y: change.worldY,
        z: change.worldZ,
        cell: make_history_cell_from_runtime_record(change.newCell),
      }))).catch((error) => {
        diag_log('painter', 'important', 'PAINTER', 'failed to submit painter cell changes', {
          error: error instanceof Error ? error.message : String(error),
          change_count: changes.length,
        }, { sink: 'warn' });
      });
    },
    on_sample_cell: (cell, sample) => {
      const clicked_side: 'left' | 'right' = sample.button === 2 ? 'right' : 'left';
      const target_side: 'left' | 'right' = picker_pick_for_opposite_hand
        ? (clicked_side === 'left' ? 'right' : 'left')
        : clicked_side;
      active_property_side = target_side;
      const brush = getBrushForSide(target_side);

      const channels = resolve_edit_channels_with_modifiers(getEditChannelsForSide(clicked_side), sample);
      if (channels.char) {
        brush.char = cell.char;
        brush.graphic = cell.graphic ? { ...cell.graphic } : undefined;
        brush.materials = cell.materials ? { ...cell.materials } : undefined;
        brush.appearance_slots = clone_appearance_slot_assignments(cell.appearance_slots);
      }
      if (channels.color) {
        const slot_targets = getBrushSlotTargetsForSide(target_side);
        const enabled_slots = get_enabled_appearance_slots(slot_targets);
        const sampled_values = enabled_slots.map((slot) => cell.appearance_slots?.[slot]).filter((value): value is AppearanceSlotValue => !!value);
        const sampled_flat_slot = sampled_values.find((value) => value.kind === 'flat_rgb');
        const sampled_material_slot = sampled_values.find((value) => value.kind === 'material');
        brush.rgb = sampled_flat_slot?.kind === 'flat_rgb' ? { ...sampled_flat_slot.rgb } : { ...cell.rgb };
        if (sampled_material_slot?.kind === 'material') setSelectedAppearanceForSide(target_side, { kind: 'material', material_id: sampled_material_slot.material_id });
        else if (sampled_flat_slot?.kind === 'flat_rgb') setSelectedAppearanceForSide(target_side, { kind: 'flat_rgb', rgb: { ...sampled_flat_slot.rgb } });
        else setSelectedAppearanceForSide(target_side, { kind: 'flat_rgb', rgb: { ...cell.rgb } });
        if (!channels.char) {
          const next_slots = clone_appearance_slot_assignments(brush.appearance_slots) ?? {};
          for (const slot of enabled_slots) {
            const value = cell.appearance_slots?.[slot];
            if (value) next_slots[slot] = value.kind === 'material'
              ? { kind: 'material', material_id: value.material_id }
              : { kind: 'flat_rgb', rgb: { ...value.rgb } };
            else delete next_slots[slot];
          }
          brush.materials = cell.materials ? { ...cell.materials } : brush.materials;
          brush.appearance_slots = Object.keys(next_slots).length > 0 ? next_slots : undefined;
        }
      }
      if (channels.weight) {
        brush.weight_index = cell.graphic ? mapGraphicWeightToBrushWeight(cell.weight_index) : cell.weight_index;
        syncBrushGraphicWeight(brush);
      }

      saveBrushState(target_side);
    },
    get_local_world_selection_cells: () => serialize_world_selection_cells(get_local_world_selection()),
    get_active_group_selected_world_voxels: () => get_active_group_selected_world_voxels(),
    on_move_preview_selection_change: (cells: Array<{ x: number; y: number; z: number }> | null) => {
      set_move_preview_selection_cells(cells);
    },
    on_move_selection_commit: (cells: Array<{ x: number; y: number; z: number }>) => {
      set_move_preview_selection_cells(null);
      handle_world_selection_change({ kind: 'brush', mode: 'replace', cells });
    },
    on_selection_change: (args) => {
      updateWorldSelectionFromProjectedBitmap(selection_mode, args);
    },
    on_world_selection_change: (args) => {
      handle_world_selection_change(args);
    },
    get_world_copy_data: () => {
      const data = get_active_group_world_copy_data();
      if (!data) return null;
      world_clipboard_data = data;
      return encode_world_copy_data(data);
    },
    set_world_copy_data: (data) => {
      const decoded = decode_world_copy_data(data);
      if (decoded) world_clipboard_data = decoded;
    },
    on_copy_data: async (data) => {
      clipboard_data = data;
      // Also write to Windows clipboard via Electron
      try {
        if (window.electronAPI?.clipboardWriteText) {
          await window.electronAPI.clipboardWriteText(data);
        }
      } catch (e) {
        diag_log('input', 'important', 'PAINTER', 'failed to write to system clipboard', { error: e instanceof Error ? e.message : String(e) }, { sink: 'warn' });
      }
    },
    get_clipboard_data: async () => {
      // First try to get from system clipboard
      try {
        if (window.electronAPI?.clipboardReadText) {
          const result = await window.electronAPI.clipboardReadText();
          if (result.success && result.text) {
            return result.text;
          }
        }
      } catch (e) {
        diag_log('input', 'important', 'PAINTER', 'failed to read from system clipboard', { error: e instanceof Error ? e.message : String(e) }, { sink: 'warn' });
      }
      // Fall back to internal clipboard
      return world_clipboard_data ? encode_world_copy_data(world_clipboard_data) : clipboard_data;
    },
    on_move: (new_rect) => {
      canvas_rect = new_rect;
      saveModulePosition('painter_canvas', new_rect);
      refreshPainterProjectionPreservingCameraFrame();
      painterDiag('canvas moved', { rect: new_rect });
    },
    on_resize: (new_rect) => {
      canvas_rect = new_rect;
      saveModulePosition('painter_canvas', new_rect);
      refreshPainterProjectionPreservingCameraFrame();
      painterDiag('canvas resized', { rect: new_rect });
    },
    on_close: () => {
      canvas_rect = get_default_canvas_rect();
      saveModulePosition('painter_canvas', canvas_rect);
      refreshPainterProjectionPreservingCameraFrame();
      painterDiag('canvas reset to default position');
    },
    on_mouse_move: (offsetX, offsetY) => {
      void offsetX;
      void offsetY;
    }
  });
  syncPainterCanvasSelectionFromWorld();

  function getInitialModuleVisibility(moduleId: string, fallback: boolean): boolean {
    return getModuleVisibility(moduleId) ?? fallback;
  }

  // Track module visibility state - MUST be declared before file menu
  let char_selector_open = getInitialModuleVisibility('char_selector', true);
  let brush_preview_open = getInitialModuleVisibility('brush_preview', true);
  let color_selector_open = getInitialModuleVisibility('color_selector', true);
  let color_block_open = getInitialModuleVisibility('color_block', true);
  let toolbox_open = getInitialModuleVisibility('toolbox', true);
  let tool_properties_open = getInitialModuleVisibility('tool_properties', true);
  let customization_open = getInitialModuleVisibility('customization_panel', false);
  let customization_picker_open = getInitialModuleVisibility('customization_picker', false);
  let indexed_palette_open = getInitialModuleVisibility('indexed_palette_panel', false);
  let indexed_palette_picker_open = getInitialModuleVisibility('indexed_palette_picker', false);
  let selection_panel_open = getInitialModuleVisibility('selection_panel', true);
  let controls_open = getInitialModuleVisibility('controls_panel', false);

  function setModuleOpen(moduleId: string, visible: boolean, setOpen: (v: boolean) => void): void {
    setOpen(visible);
    if (registry.has(moduleId)) {
      registry.set_visibility(moduleId, visible);
      if (visible) {
        registry.bring_to_front(moduleId);
      }
    }
    saveModuleVisibility(moduleId, visible);
  }

  function toggleModule(
    isOpen: boolean,
    setOpen: (v: boolean) => void,
    moduleId: string,
    createModule: () => Module,
  ): void {
    if (!registry.has(moduleId)) {
      registry.register(createModule());
    }
    setModuleOpen(moduleId, !isOpen, setOpen);
  }
  
  // Create module instances (but don't register yet)
  let char_selector_module: Module | null = null;
  let brush_preview_module: Module | null = null;
  let color_selector_module: Module | null = null;
  let color_block_module: Module | null = null;
  let toolbox_module: Module | null = null;
  let tool_properties_module: Module | null = null;
  let customization_module: Module | null = null;
  let customization_picker_module: Module | null = null;
  let indexed_palette_module: Module | null = null;
  let indexed_palette_picker_module: Module | null = null;
  let selection_panel_module: Module | null = null;
  let controls_module: Module | null = null;
  let active_customization_role: UiSemanticColorRole = 'vivid';

  const painter_controls = create_painter_controls_runtime(PAINTER_APP_CONFIG.selected_data_slot, {
    get_profile_scope: () => active_profile_scope,
  });
  void profile_scope_ready.then(() => painter_controls.load()).catch(() => null);

  function isToolTargetInvertBindingEvent(e: KeyboardEvent): boolean {
    const binding = painter_controls.runtime.get_binding('painter.tool_target_invert');
    return binding?.kind === 'keyboard' ? binding.code === e.code : false;
  }
  const painter_tai = create_painter_tool_assisted_inputs_wiring({
    data_slot: PAINTER_APP_CONFIG.selected_data_slot,
    get_tool_state: () => ({ current_tool, left_click_tool, right_click_tool }),
    get_focus_plane: () => painter_display_projection?.focus_world_plane ?? getPainterFocusWorldPlane(),
    get_camera_target: () => getPainterAutomationCameraTarget(),
    get_bounds: () => voxelSpace.bounds,
    get_interaction_anchor: () => getPainterInteractionAnchor(),
    get_cell: (x, y, z) => {
      const plane = typeof z === 'number' ? z : (painter_display_projection?.focus_world_plane ?? getPainterFocusWorldPlane());
      return getVoxel(voxelSpace, x, y, plane);
    },
    get_join_snapshot: () => options?.get_join_snapshot?.() ?? null,
    get_text_value: (source, field) => {
      if (source === 'join') {
        const snapshot = options?.get_join_snapshot?.() ?? null;
        const key = String(field ?? '').trim();
        if (!snapshot) return null;
        if (key === 'selected_connection_id') return snapshot.selected_connection_id ?? '';
        if (key === 'selected_connection_host') return snapshot.selected_connection_host ?? '';
        if (key === 'selected_connection_kind') return snapshot.selected_connection_kind ?? '';
        if (key === 'probe_status') return snapshot.probe_status ?? '';
        if (key === 'supports_join') return snapshot.supports_join ? 'true' : 'false';
        if (key === 'join_mode') return snapshot.join_mode ?? '';
        if (key === 'world_label') return snapshot.world_label ?? '';
        if (key === 'painter_document_id') return snapshot.painter_document_id ?? '';
        if (key === 'api_base_url') return snapshot.api_base_url ?? '';
        if (key === 'bridge_ws_base_url') return snapshot.bridge_ws_base_url ?? '';
        const status_line_match = /^status_line_(\d+)$/.exec(key);
        if (status_line_match) {
          const index = Number(status_line_match[1]);
          return snapshot.status_lines[index] ?? '';
        }
        return null;
      }
      if (source === 'session') {
        const key = String(field ?? '').trim();
        if (key === 'authority_mode') return painter_sync.get_state().authority_mode;
        if (key === 'session_lifecycle') return painter_sync.get_state().lifecycle;
        if (key === 'document_id') return String(painter_sync.get_state().bootstrap?.document_id ?? '');
        if (key === 'connection_id') return String(painter_sync.get_state().bootstrap?.connection_id ?? '');
        if (key === 'supports_join') return painter_sync.get_state().bootstrap?.supports_join ? 'true' : 'false';
        if (key === 'join_mode') return String(painter_sync.get_state().bootstrap?.join_mode ?? '');
        return null;
      }
      if (source === 'layer_name') {
        const z = Number(field ?? '');
        if (!Number.isFinite(z)) return null;
        const from_palette = get_group_entry_for_palette_z(Math.floor(z));
        if (from_palette) return from_palette.layer.name;
        return getLayer(voxelSpace, Math.floor(z))?.name ?? null;
      }
      if (source === 'runtime_value') {
        const key = String(field ?? '').trim();
        if (key === 'active_group_id') return legacy_group_compat.active_group_id ?? '';
        if (key === 'active_group_palette_z') return String(get_palette_z_for_group_id(legacy_group_compat.active_group_id) ?? -1);
        if (key === 'focus_plane') return String(getPainterFocusWorldPlane());
        if (key === 'camera_target_plane') return String(getPainterFocusWorldPlane());
        if (key === 'display_focus_plane') return String(painter_display_projection?.focus_world_plane ?? getPainterFocusWorldPlane());
        if (key === 'group_count') return String(Object.keys(painter_document_runtime.document.groups).length);
        if (key === 'group_order') return painter_document_runtime.document.group_order.join(',');
        if (key === 'contributor_coords') return String(painter_document_runtime.coordinate_group_index.size);
        if (key === 'resolved_coords') return String(painter_document_runtime.resolved_visible_index.size);
        if (key === 'local_selection_count') return String(get_local_world_selection().cells.size);
        if (key === 'clipboard_cell_count') return String(world_clipboard_data?.cells.length ?? 0);
        if (key === 'active_group_bounds') {
          const bounds = get_active_group_world_bounds();
          return bounds ? `${bounds.minX},${bounds.minY},${bounds.minZ}:${bounds.maxX},${bounds.maxY},${bounds.maxZ}` : '';
        }
        if (key === 'authority_mode') return painter_sync.get_state().authority_mode;
        if (key === 'last_patch_command_kind') return painter_sync.get_state().last_patch_command_kind ?? '';
        if (key === 'last_patch_group_id') return painter_sync.get_state().last_patch_group_id ?? '';
        if (key === 'last_patch_revision') return String(painter_sync.get_state().last_patch_revision ?? 0);
        if (key === 'active_group_history_index') {
          const active_group_id = resolve_current_runtime_group_id();
          if (!active_group_id) return '0';
          return String(get_group_history_stats(active_group_id).current_index);
        }
        if (key === 'active_group_history_count') {
          const active_group_id = resolve_current_runtime_group_id();
          if (!active_group_id) return '0';
          return String(get_group_history_stats(active_group_id).total_actions);
        }
        if (key === 'active_group_undo_count') {
          const active_group_id = resolve_current_runtime_group_id();
          if (!active_group_id) return '0';
          return String(get_group_undo_redo_counts(active_group_id).undo_count);
        }
        if (key === 'active_group_redo_count') {
          const active_group_id = resolve_current_runtime_group_id();
          if (!active_group_id) return '0';
          return String(get_group_undo_redo_counts(active_group_id).redo_count);
        }
      }
      return null;
    },
    invoke_helper: (helper, payload) => {
      if (helper === 'start_layer_rename') {
        const z = Number((payload as any)?.z ?? 0);
        const layerPalette = layer_palette_module as any;
        if (!Number.isFinite(z) || typeof layerPalette?.beginRenameGroup !== 'function') return false;
        const legacy_group_id = get_group_id_for_legacy_z(Math.floor(z));
        if (!legacy_group_id) return false;
        const started = Boolean(layerPalette.beginRenameGroup(legacy_group_id));
        if (!started) return false;
        try {
          return Boolean((window as any).TOOL_ASSISTED_INPUTS_RUNTIME?.focus_module?.('layer_palette'));
        } catch {
          return started;
        }
      }
      if (helper === 'focus_module') {
        const module_id = String((payload as any)?.module_id ?? '').trim();
        if (!module_id) return false;
        try {
          return Boolean((window as any).TOOL_ASSISTED_INPUTS_RUNTIME?.focus_module?.(module_id));
        } catch {
          return false;
        }
      }
      if (helper === 'reset_painter_module_layout') {
        clearModulePositions();
        canvas_rect = get_default_canvas_rect();
        canvas_module.rect = canvas_rect;
        if (!layer_palette_module) return false;
        layer_palette_module.rect = {
          x0: canvas_rect.x1 + 2,
          y0: canvas_rect.y0,
          x1: canvas_rect.x1 + 22,
          y1: canvas_rect.y0 + 20,
        };
        if (camera_control_module) {
          camera_control_module.rect = {
            x0: canvas_rect.x1 + 2,
            y0: canvas_rect.y0 + 22,
            x1: canvas_rect.x1 + 30,
            y1: canvas_rect.y0 + 40,
          };
        }
        refreshPainterProjectionPreservingCameraFrame();
        return true;
      }
      if (helper === 'select_group_by_palette_z') {
        const z = Math.floor(Number((payload as any)?.z));
        if (!Number.isFinite(z)) return false;
        const entry = get_group_entry_for_palette_z(z);
        if (!entry) return false;
        selectPainterGroup(entry.group_id);
        return true;
      }
      if (helper === 'undo_painter') {
        const description = performPainterUndo();
        if (description) {
          refreshPainterProjectionFromWorld();
          return true;
        }
        return false;
      }
      if (helper === 'redo_painter') {
        return Boolean(performPainterRedo());
      }
      if (helper === 'add_group') {
        const created = create_painter_group(`Layer ${painter_document_runtime.document.group_order.length + 1}`, {
          breath_start: painter_document_runtime.active_breath,
          breath_end: painter_document_runtime.active_breath,
        });
        const result = painter_session_core.apply_group_command({ kind: 'create_group', group: created });
        sync_local_session_state_from_core();
        sync_lineage_state_from_core();
        logGroupAction(history, 'create_group', `Create Group ${created.name}`, {
          groupId: result.created_group_id ?? created.id,
          newGroupData: created,
        });
        submit_group_command_if_authoritative({
          kind: 'create_group',
          group_name: created.name,
          target_group_id: result.created_group_id ?? created.id,
          breath_start: created.breath_start,
          breath_end: created.breath_end,
        });
        legacy_group_compat.active_group_id = result.created_group_id ?? created.id;
        sync_painter_runtime_after_mutation({ preserve_group_order: true, focus_active_group: true });
        log_runtime_summary('tai add group summary');
        return true;
      }
      if (helper === 'duplicate_active_group') {
        const active_group_id = resolve_current_runtime_group_id();
        if (!active_group_id) return false;
        const result = painter_session_core.apply_group_command({ kind: 'duplicate_group', source_group_id: active_group_id });
        sync_local_session_state_from_core();
        sync_lineage_state_from_core();
        const duplicatedId = result.created_group_id;
        const duplicated = duplicatedId ? structuredClone(painter_document_runtime.document.groups[duplicatedId]!) : null;
        if (!duplicated) return false;
        logGroupAction(history, 'duplicate_group', `Duplicate Group ${duplicated.name}`, {
          sourceGroupId: active_group_id,
          targetGroupId: duplicated.id,
          newGroupData: duplicated,
        });
        submit_group_command_if_authoritative({ kind: 'duplicate_group', source_group_id: active_group_id, target_group_id: duplicated.id });
        legacy_group_compat.active_group_id = duplicated.id;
        sync_painter_runtime_after_mutation({ preserve_group_order: true, focus_active_group: true });
        log_runtime_summary('tai duplicate active group summary');
        return true;
      }
      if (helper === 'reverse_group_order') {
        const oldGroupOrder = [...painter_document_runtime.document.group_order];
        painter_session_core.apply_group_command({ kind: 'reorder_groups', next_group_order: [...painter_document_runtime.document.group_order].reverse() });
        sync_local_session_state_from_core();
        sync_lineage_state_from_core();
        logGroupAction(history, 'reorder_groups', 'Reorder Groups', {
          oldGroupOrder,
          newGroupOrder: [...painter_document_runtime.document.group_order],
        });
        submit_group_command_if_authoritative({ kind: 'reorder_groups', next_group_order: [...painter_document_runtime.document.group_order] });
        sync_painter_runtime_after_mutation({ preserve_group_order: true });
        log_runtime_summary('tai reverse group order summary');
        return true;
      }
      if (helper === 'clear_anchor_cell') {
        return clear_current_anchor_cell();
      }
      if (helper === 'clear_selection') {
        clear_all_selection_channels();
        refreshPainterProjectionFromWorld();
        return true;
      }
      if (helper === 'reset_painter_document') {
        return reset_painter_document_state();
      }
      if (helper === 'clear_painter_cells') {
        const cells = Array.isArray((payload as any)?.cells) ? (payload as any).cells : [];
        const authored_changes: Array<{ worldX: number; worldY: number; worldZ: number; newCell: GridCell }> = [];
        for (const cell of cells) {
          const x = Math.floor(Number(cell?.x));
          const y = Math.floor(Number(cell?.y));
          const z = Math.floor(Number(cell?.z));
          if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
          authored_changes.push({ worldX: x, worldY: y, worldZ: z, newCell: { char: ' ', rgb: { r: 0, g: 0, b: 0 }, weight_index: 0 } });
        }
        const applied = apply_authored_group_cell_changes(authored_changes);
        if (applied) {
          refreshPainterProjectionFromWorld();
          return true;
        }
        return false;
      }
      return false;
    },
  });

  let painter_interaction_hover_state: InteractionHoverResolution | null = null;
  let painter_interaction_session_state: InteractionSessionResolution | null = null;

  function toPainterSessionResolution(session: InteractionSession): InteractionSessionResolution {
    return {
      consumer_id: 'painter',
      view: getPainterCanvasViewInstance(),
      session,
    };
  }

  function toPainterHoverResolution(hover: InteractionHoverState): InteractionHoverResolution {
    return {
      consumer_id: 'painter',
      view: getPainterCanvasViewInstance(),
      hover,
      resolved_targets: hover.resolved_targets,
    };
  }

  const painter_interaction_adapters: InteractionConsumerAdapters = {
    view_registration: {
      get_view_instances: () => [getPainterCanvasViewInstance()],
    },
    resolution: {
      resolve_targets: (input) => {
        const runtimeApi = getPainterCanvasRuntimeApi();
        return runtimeApi?.resolveInteractionTargets?.(input.pointer.x, input.pointer.y) ?? order_resolved_targets([]);
      },
    },
    session_handler: {
      begin_interaction: (session) => {
        painter_interaction_session_state = toPainterSessionResolution(session);
      },
      update_interaction: (session) => {
        painter_interaction_session_state = toPainterSessionResolution(session);
      },
      end_interaction: (session) => {
        painter_interaction_session_state = toPainterSessionResolution(session);
      },
      cancel_interaction: (session) => {
        painter_interaction_session_state = toPainterSessionResolution(session);
      },
      update_hover: (hover) => {
        painter_interaction_hover_state = toPainterHoverResolution(hover);
      },
    },
  };
  painter_interaction_registry = create_interaction_registry_runtime();

  function refreshPainterInteractionRegistry(): void {
    painter_interaction_registry?.sync_consumers({ painter: painter_interaction_adapters });
  }
  refreshPainterInteractionRegistry();
  window.setTimeout(() => {
    void painter_tai.runtime.start_configured();
  }, 0);
  
  // Define rects for floating modules (with saved position fallback)
  function getModuleRectWithSave(id: string, defaultRect: Rect): Rect {
    const saved = getModulePosition(id);
    return saved || defaultRect;
  }
  
  const char_selector_rect: Rect = getModuleRectWithSave('char_selector', {
    x0: 150,
    y0: 10,
    x1: 161,  // Wider to accommodate 4 chars across
    y1: 35
  });
  
  const brush_preview_rect: Rect = getModuleRectWithSave('brush_preview', {
    x0: 130,
    y0: 10,
    x1: 136,
    y1: 15
  });
  
  const color_selector_rect: Rect = getModuleRectWithSave('color_selector', {
    x0: 110,
    y0: 10,
    x1: 124,
    y1: 35
  });

  const color_block_rect: Rect = getModuleRectWithSave('color_block', {
    x0: 123,
    y0: 10,
    x1: 149,
    y1: 31,
  });
  
  const toolbox_rect: Rect = getModuleRectWithSave('toolbox', {
    x0: 10,
    y0: 10,
    x1: 26,
    y1: 30
  });
  
  const tool_properties_rect: Rect = getModuleRectWithSave('tool_properties', {
    x0: 30,
    y0: 10,
    x1: 50,
    y1: 18
  });

  const customization_rect: Rect = getModuleRectWithSave('customization_panel', {
    x0: 52,
    y0: 10,
    x1: 78,
    y1: 20,
  });

  const customization_picker_rect: Rect = getModuleRectWithSave('customization_picker', {
    x0: 80,
    y0: 10,
    x1: 114,
    y1: 28,
  });

  const indexed_palette_rect: Rect = getModuleRectWithSave('indexed_palette_panel', {
    x0: 52,
    y0: 22,
    x1: 88,
    y1: 38,
  });

  const indexed_palette_picker_rect: Rect = getModuleRectWithSave('indexed_palette_picker', {
    x0: 90,
    y0: 22,
    x1: 124,
    y1: 40,
  });
  
  // Layer Palette - positioned on the right side
  const layer_palette_rect: Rect = getModuleRectWithSave('layer_palette', {
    x0: canvas_rect.x1 + 2,  // Right of canvas
    y0: canvas_rect.y0,
    x1: canvas_rect.x1 + 22, // 20 chars wide
    y1: canvas_rect.y0 + 20  // Show up to ~17 layers
  });

  // Camera Control - positioned below layer palette
  const camera_control_rect: Rect = getModuleRectWithSave('camera_control', {
    x0: canvas_rect.x1 + 2,  // Right of canvas
    y0: canvas_rect.y0 + 22,
    x1: canvas_rect.x1 + 30, // 28 chars wide
    y1: canvas_rect.y0 + 40  // 18 chars tall
  });

  // Factory functions for creating modules
  function create_char_selector_module(): Module {
    painterDiag('creating char selector module', { rect: char_selector_rect });
    return make_character_selector_module({
      id: 'char_selector',
      rect: char_selector_rect,
      get_selected_char: () => getPreviewBrush().char,
      get_selected_visual_key: () => getPreviewBrush().graphic ? `graphic:${getPreviewBrush().graphic!.graphic_id}` : `char:${getPreviewBrush().char}`,
      get_left_selected_char: () => left_brush.char,
      get_right_selected_char: () => right_brush.char,
      get_left_selected_visual_key: () => left_brush.graphic ? `graphic:${left_brush.graphic.graphic_id}` : `char:${left_brush.char}`,
      get_right_selected_visual_key: () => right_brush.graphic ? `graphic:${right_brush.graphic.graphic_id}` : `char:${right_brush.char}`,
      get_left_rgb: () => left_brush.rgb,
      get_right_rgb: () => right_brush.rgb,
      get_left_weight_index: () => left_brush.weight_index,
      get_right_weight_index: () => right_brush.weight_index,
      get_gradiator_state: () => gradiator_state,
      on_gradiator_slot_select: (slot) => {
        setActiveGradiatorSlot(gradiator_state, slot);
        saveGradiatorState(gradiator_state);
        painterDiag('selected gradiator slot from visual picker', { slot });
      },
      on_gradiator_char_select: (slot, x) => {
        selectGradiatorChar(gradiator_state, slot, x);
        painterDiag('selected gradiator char position from visual picker', { slot, x });
      },
      on_gradiator_add_char: (slot) => {
        addGradiatorChar(gradiator_state, slot);
        saveGradiatorState(gradiator_state);
        painterDiag('added gradiator char from visual picker', { slot });
      },
      on_gradiator_remove_char: (slot) => {
        removeGradiatorChar(gradiator_state, slot);
        saveGradiatorState(gradiator_state);
        painterDiag('removed gradiator char from visual picker', { slot });
      },
      on_visual_select: (visual, button) => {
        active_property_side = button === 2 ? 'right' : 'left';
        const brush = getBrushForButton(button);
        const current_weight = brush.weight_index;
        const seededAppearanceSlots = makeBrushAppearanceSlotsFromHands();
        brush.char = visual.char;
        brush.graphic = visual.graphic
          ? { ...visual.graphic, weight_index: current_weight as 0 | 1 | 2 | 3 }
          : undefined;
        brush.appearance_slots = visual.graphic ? seededAppearanceSlots : clone_appearance_slot_assignments(visual.appearance_slots);
        brush.materials = visual.graphic
          ? deriveBrushMaterialsFromAppearanceSlots(seededAppearanceSlots)
          : (visual.materials ? { ...visual.materials } : undefined);
        if (visual.graphic) {
          brush.rgb = active_property_side === 'right' ? { ...right_brush.rgb } : { ...left_brush.rgb };
          brush.weight_index = current_weight;
        } else {
          applyBrushColor(brush, visual.rgb);
        }
        syncBrushGraphicWeight(brush);
        saveBrushState(active_property_side);
        painterDiag('selected visual', { key: visual.key, graphic_id: visual.graphic?.graphic_id ?? null, char: visual.char, seeded_from_hands: !!visual.graphic, preserved_weight: current_weight });
      },
      on_char_select: (char, button) => {
        // Check if we're editing a gradiator
        if (gradiator_state.isEditing && gradiator_state.editSlot !== null) {
          // Set the character in the gradiator at the selected position
          setGradiatorChar(gradiator_state, gradiator_state.editSlot, gradiator_state.editCursorX, char);
          saveGradiatorState(gradiator_state);
          painterDiag('set gradiator character', { char, position: gradiator_state.editCursorX });
        } else {
          // Normal brush character selection
          active_property_side = button === 2 ? 'right' : 'left';
          const brush = getBrushForButton(button);
          brush.char = char;
          brush.graphic = undefined;
          saveBrushState(active_property_side);
          painterDiag('selected character', { char, preserved_appearance: true });
        }
      },
      on_move: (new_rect) => {
        if (char_selector_module) {
          char_selector_module.rect = new_rect;
          saveModulePosition('char_selector', new_rect);
        }
      },
      on_close: () => {
        setModuleOpen('char_selector', false, (v) => { char_selector_open = v; });
      }
    });
  }
  
  function create_brush_preview_module(): Module {
    return make_brush_preview_module({
      id: 'brush_preview',
      rect: brush_preview_rect,
      get_left_brush: () => left_brush,
      get_right_brush: () => right_brush,
      get_left_brush_size: () => left_brush_size,
      get_right_brush_size: () => right_brush_size,
      get_active_side: () => active_property_side,
      on_move: (new_rect) => {
        if (brush_preview_module) {
          brush_preview_module.rect = new_rect;
          saveModulePosition('brush_preview', new_rect);
        }
      },
      on_close: () => {
        setModuleOpen('brush_preview', false, (v) => { brush_preview_open = v; });
      }
    });
  }
  
  function create_color_selector_module(): Module {
    return make_color_selector_module({
      id: 'color_selector',
      rect: color_selector_rect,
      get_brush: () => getPreviewBrush(),
      get_left_brush: () => getBrushForSide('left'),
      get_right_brush: () => getBrushForSide('right'),
      get_left_rgb: () => getBrushSelectedPaletteRgb('left'),
      get_right_rgb: () => getBrushSelectedPaletteRgb('right'),
      get_left_material_id: () => getBrushSelectedMaterialId('left'),
      get_right_material_id: () => getBrushSelectedMaterialId('right'),
      get_slot_targets: () => getBrushSlotTargetsForSide(active_property_side),
      on_color_select: (rgb, button) => {
        // Check if we're selecting the ignore color
        if ((globalThis as any).__selecting_ignore_color) {
          paste_ignore_color_rgb = rgb;
          saveToolProperties({ paste_ignore_color_rgb: rgb });
          (globalThis as any).__selecting_ignore_color = false;
          painterDiag('set ignore color', { rgb });
        } else {
          active_property_side = button === 2 ? 'right' : 'left';
          applyBrushColor(getBrushForButton(button), rgb, getBrushSlotTargetsForSide(active_property_side));
          saveBrushState('left');
          saveBrushState('right');
          painterDiag('selected color', { rgb, side: active_property_side, selected_appearance_kind: 'flat_rgb' });
        }
      },
      on_material_select: (material_id, button) => {
        active_property_side = button === 2 ? 'right' : 'left';
        applyBrushMaterial(getBrushForButton(button), material_id, getBrushSlotTargetsForSide(active_property_side));
        saveBrushState('left');
        saveBrushState('right');
        painterDiag('selected material', { material_id, side: active_property_side, slot_targets: getBrushSlotTargetsForSide(active_property_side), selected_appearance_kind: 'material' });
      },
      on_move: (new_rect) => {
        if (color_selector_module) {
          color_selector_module.rect = new_rect;
          saveModulePosition('color_selector', new_rect);
        }
      },
      on_close: () => {
        setModuleOpen('color_selector', false, (v) => { color_selector_open = v; });
      }
    });
  }

  function create_color_block_module(): Module {
    return make_brush_color_block_module({
      id: 'color_block',
      rect: color_block_rect,
      get_left_rgb: () => getBrushSelectedDisplayRgb('left'),
      get_right_rgb: () => getBrushSelectedDisplayRgb('right'),
      on_color_commit: (side, rgb) => {
        active_property_side = side;
        applyBrushColor(getBrushForSide(side), rgb, getBrushSlotTargetsForSide(side));
        saveBrushState('left');
        saveBrushState('right');
        painterDiag('selected color from color block', { side, rgb, selected_appearance_kind: 'flat_rgb' });
      },
      on_move: (new_rect) => {
        if (color_block_module) {
          color_block_module.rect = new_rect;
          saveModulePosition('color_block', new_rect);
        }
      },
      on_close: () => {
        setModuleOpen('color_block', false, (v) => { color_block_open = v; });
      },
    });
  }
  
  function create_toolbox_module(): Module {
    return make_toolbox_module({
      id: 'toolbox',
      rect: toolbox_rect,
      get_current_tool: () => current_tool,
      get_left_click_tool: () => left_click_tool,
      get_right_click_tool: () => right_click_tool,
      on_tool_select: select_current_tool,
      on_left_click_tool_change: assign_left_click_tool,
      on_right_click_tool_change: assign_right_click_tool,
      matches_tool_shortcut: () => false,
      on_tool_shortcut: (tool) => {
        if (isPainterTextCaptureActive()) return;
        painter_tool_shortcut_interpreter.trigger(tool);
      },
      on_move: (new_rect) => {
        if (toolbox_module) {
          toolbox_module.rect = new_rect;
          saveModulePosition('toolbox', new_rect);
        }
      },
      on_resize: (new_rect) => {
        if (toolbox_module) {
          toolbox_module.rect = new_rect;
        }
      },
      on_close: () => {
        setModuleOpen('toolbox', false, (v) => { toolbox_open = v; });
      }
    });
  }
  
  function create_tool_properties_module(): Module {
    function get_tool_label(tool: ToolType): string {
      switch (tool) {
        case 'pencil': return 'PENCIL';
        case 'eraser': return 'ERASER';
        case 'bucket': return 'BUCKET';
        case 'eyedropper': return 'DROPPER';
        case 'line': return 'LINE';
        case 'rect_stroke': return 'RECT';
        case 'rect_fill': return 'FILL';
        case 'text': return 'TEXT';
        case 'selectangle': return 'RECTSEL';
        case 'lassoselect': return 'LASSO';
        case 'copy': return 'COPY';
        case 'paste': return 'PASTE';
        case 'move': return 'MOVE';
        default: return String(tool).toUpperCase();
      }
    }

    function is_brush_size_tool(tool: ToolType): boolean {
      return tool === 'pencil' || tool === 'eraser';
    }

    function cycle_hand_toggle_state(left: boolean, right: boolean, side: 'left' | 'right' | 'both'): { left: boolean; right: boolean } {
      if (side === 'both') {
        return left && right
          ? { left: false, right: false }
          : { left: true, right: true };
      }
      if (side === 'left') {
        if (left && right) return { left: false, right: true };
        if (left) return { left: false, right };
        return { left: true, right };
      }
      if (left && right) return { left: true, right: false };
      if (right) return { left, right: false };
      return { left, right: true };
    }

    function toggle_edit_channel_pair<T extends Record<string, boolean>>(
      side: 'left' | 'right' | 'both',
      channel: keyof T,
      left_channels: T,
      right_channels: T,
      apply: (next_left: T, next_right: T) => void,
    ): void {
      const next = cycle_hand_toggle_state(!!left_channels[channel], !!right_channels[channel], side);
      apply(
        { ...left_channels, [channel]: next.left },
        { ...right_channels, [channel]: next.right },
      );
    }

    function append_edit_channel_rows(
      rows: ToolPropertyRow[],
      prefix: string,
      left_tool_enabled: boolean,
      right_tool_enabled: boolean,
      left_channels: EditChannels,
      right_channels: EditChannels,
      on_toggle: (side: 'left' | 'right' | 'both', channel: keyof EditChannels) => void,
    ): void {
      const specs: Array<{ channel: keyof EditChannels; id: string; label: string; shortcut: string }> = [
        { channel: 'char', id: 'char', label: 'CHA', shortcut: 'CTR' },
        { channel: 'color', id: 'color', label: 'COL', shortcut: 'SHF' },
        { channel: 'weight', id: 'weight', label: 'WGT', shortcut: 'ALT' },
      ];
      rows.push({
        type: 'edit_channel_matrix',
        id: `${prefix}_matrix`,
        columns: specs.map((spec) => ({
          id: spec.id,
          label: spec.label,
          shortcut: spec.shortcut,
          left_value: left_channels[spec.channel],
          right_value: right_channels[spec.channel],
          left_enabled: left_tool_enabled,
          right_enabled: right_tool_enabled,
        })),
        on_toggle: (side, column_id) => {
          on_toggle(side, column_id as keyof EditChannels);
        },
      });
    }

    function append_target_rows(rows: ToolPropertyRow[], left_tool: ToolType, right_tool: ToolType): void {
      rows.push({
        type: 'edit_channel_matrix',
        id: 'target_matrix',
        row_label: 'target',
        columns: [
          {
            id: 'selection',
            label: 'select',
            shortcut: '',
            left_value: getToolTargetForSide('left') === 'selection',
            right_value: getToolTargetForSide('right') === 'selection',
            left_enabled: true,
            right_enabled: true,
          },
          {
            id: 'image',
            label: 'image',
            shortcut: '',
            left_value: getToolTargetForSide('left') === 'content',
            right_value: getToolTargetForSide('right') === 'content',
            left_enabled: true,
            right_enabled: true,
          },
        ],
        on_toggle: (side, column_id) => {
          const next_target: ToolEditTarget = column_id === 'selection' ? 'selection' : 'content';
          const sides: Array<'left' | 'right'> = side === 'both' ? ['left', 'right'] : [side];
          for (const target_side of sides) {
            setToolTargetForSide(target_side, next_target);
          }
        },
      });
    }

    function append_size_rows(rows: ToolPropertyRow[]): void {
      rows.push({
        type: 'dual_slider',
        id: 'shared_brush_size',
        label: 'SIZE',
        min: 1,
        max: 5,
        left_value: left_brush_size,
        right_value: right_brush_size,
        format_value: (value) => `${value}x${value}`,
        show_value_label: false,
        on_change: (value, side) => {
          active_property_side = side;
          if (side === 'right') right_brush_size = value;
          else left_brush_size = value;
          saveBrushState(side);
        },
      });
      rows.push({
        type: 'dual_slider',
        id: 'shared_brush_weight',
        label: 'WEIGHT',
        min: 0,
        max: 3,
        left_value: left_brush.weight_index,
        right_value: right_brush.weight_index,
        show_value_label: false,
        on_change: (value, side) => {
          active_property_side = side;
          const brush = getBrushForSide(side);
          brush.weight_index = value;
          syncBrushGraphicWeight(brush);
          saveBrushState(side);
        },
      });
    }

    function append_slot_target_rows(rows: ToolPropertyRow[]): void {
      rows.push({
        type: 'edit_channel_matrix',
        id: 'shared_slot_targets',
        row_label: 'MAT',
        columns: [
          {
            id: 'slot_1',
            label: '1',
            shortcut: '',
            left_value: left_brush_slot_targets.slot_1,
            right_value: right_brush_slot_targets.slot_1,
            left_enabled: true,
            right_enabled: true,
          },
          {
            id: 'slot_2',
            label: '2',
            shortcut: '',
            left_value: left_brush_slot_targets.slot_2,
            right_value: right_brush_slot_targets.slot_2,
            left_enabled: true,
            right_enabled: true,
          },
          {
            id: 'slot_3',
            label: '3',
            shortcut: '',
            left_value: left_brush_slot_targets.slot_3,
            right_value: right_brush_slot_targets.slot_3,
            left_enabled: true,
            right_enabled: true,
          },
        ],
        on_toggle: (side, column_id) => {
          const key = column_id as keyof AppearanceSlotTargetMask;
          toggle_edit_channel_pair(
            side,
            key,
            left_brush_slot_targets,
            right_brush_slot_targets,
            (next_left, next_right) => {
              if (side !== 'both') active_property_side = side;
              left_brush_slot_targets = next_left;
              right_brush_slot_targets = next_right;
              saveBrushSlotTargets();
            },
          );
        },
      });
    }

    function append_shared_matrix_rows(rows: ToolPropertyRow[]): void {
      append_edit_channel_rows(
        rows,
        'shared_select',
        true,
        true,
        left_select_channels,
        right_select_channels,
        (side, channel) => {
          toggle_edit_channel_pair(side, channel, left_select_channels, right_select_channels, (next_left, next_right) => {
            if (side !== 'both') active_property_side = side;
            left_select_channels = next_left;
            right_select_channels = next_right;
            saveSharedSelectChannels();
          });
        },
      );
      const select_row = rows[rows.length - 1];
      if (select_row?.type === 'edit_channel_matrix') select_row.row_label = 'Select';

      append_edit_channel_rows(
        rows,
        'shared_edit',
        true,
        true,
        left_edit_channels,
        right_edit_channels,
        (side, channel) => {
          toggle_edit_channel_pair(side, channel, left_edit_channels, right_edit_channels, (next_left, next_right) => {
            if (side !== 'both') active_property_side = side;
            left_edit_channels = next_left;
            right_edit_channels = next_right;
            saveSharedEditChannels();
          });
        },
      );
      const edit_row = rows[rows.length - 1];
      if (edit_row?.type === 'edit_channel_matrix') edit_row.row_label = 'Edit';

      append_slot_target_rows(rows);
    }

    function append_tool_specific_rows(rows: ToolPropertyRow[], left_tool: ToolType, right_tool: ToolType): void {
      if (left_tool === 'bucket' || right_tool === 'bucket') {
        rows.push({
          type: 'single_toggle',
          id: 'bucket_continuous',
          label: 'CONT',
          value: bucket_continuous,
          on_toggle: () => {
            bucket_continuous = !bucket_continuous;
            saveToolProperties({ bucket_continuous });
          },
        });
        rows.push({
          type: 'single_cycle',
          id: 'bucket_depth',
          label: 'DEPTH',
          value: bucket_same_depth_only ? 'SAME' : 'ALL',
          options: ['SAME', 'ALL'],
          on_cycle: () => {
            bucket_same_depth_only = !bucket_same_depth_only;
            saveToolProperties({ bucket_same_depth_only });
          },
        });
        rows.push({
          type: 'single_toggle',
          id: 'bucket_diagonal',
          label: 'DIAG',
          value: bucket_allow_diagonal,
          on_toggle: () => {
            bucket_allow_diagonal = !bucket_allow_diagonal;
            saveToolProperties({ bucket_allow_diagonal });
          },
        });
      }

      if (left_tool === 'selectangle' || right_tool === 'selectangle' || left_tool === 'lassoselect' || right_tool === 'lassoselect') {
        if (left_tool === 'selectangle' || right_tool === 'selectangle') {
          rows.push({
            type: 'single_toggle',
            id: 'rect_select_all_depths',
            label: 'RECTDEP',
            value: rect_select_all_depths,
            on_toggle: () => {
              rect_select_all_depths = !rect_select_all_depths;
              saveToolProperties({ rect_select_all_depths });
            },
          });
        }
        if (left_tool === 'lassoselect' || right_tool === 'lassoselect') {
          rows.push({
            type: 'single_toggle',
            id: 'lasso_select_all_depths',
            label: 'LASSODEP',
            value: lasso_select_all_depths,
            on_toggle: () => {
              lasso_select_all_depths = !lasso_select_all_depths;
              saveToolProperties({ lasso_select_all_depths });
            },
          });
        }
      }

      if (left_tool === 'paste' || right_tool === 'paste') {
        rows.push({
          type: 'single_cycle',
          id: 'paste_angle_mode',
          label: 'MODE',
          value: paste_angle_mode === 'absolute' ? 'ABS' : 'REL',
          options: ['REL', 'ABS'],
          on_cycle: () => {
            paste_angle_mode = paste_angle_mode === 'absolute' ? 'relative' : 'absolute';
            saveToolProperties({ paste_angle_mode });
            getCanvasPasteTransformApi()?.setPasteAngleMode?.();
          },
        });
        const pasteActionButtons: Array<{ id: 'swing_left' | 'swing_right' | 'swing_up' | 'swing_down' | 'roll_left' | 'roll_right'; label: string }> = [
          { id: 'swing_left', label: 'S.L' },
          { id: 'swing_right', label: 'S.R' },
          { id: 'swing_up', label: 'S.U' },
          { id: 'swing_down', label: 'S.D' },
          { id: 'roll_left', label: 'R.L' },
          { id: 'roll_right', label: 'R.R' },
        ];
        for (const action of pasteActionButtons) {
          rows.push({
            type: 'single_cycle',
            id: `paste_${action.id}`,
            label: action.label,
            value: '',
            enabled: canRoutePasteTransformActions(),
            on_cycle: () => {
              stepPasteTransformAction(action.id);
            },
          });
        }
      }

      if (left_tool === 'text' || right_tool === 'text') {
        rows.push({
          type: 'single_toggle',
          id: 'text_space_replace',
          label: 'SPACE',
          value: space_replace,
          on_toggle: () => {
            space_replace = !space_replace;
          },
        });
        rows.push({
          type: 'single_stepper',
          id: 'text_spacing',
          label: 'SPACEX',
          value: `${text_spacing > 0 ? '+' : ''}${text_spacing}`,
          on_decrement: () => {
            text_spacing = Math.max(-16, text_spacing - 1);
            saveToolProperties({ text_spacing });
          },
          on_increment: () => {
            text_spacing = Math.min(16, text_spacing + 1);
            saveToolProperties({ text_spacing });
          },
        });
        rows.push({
          type: 'single_stepper',
          id: 'text_charlead',
          label: 'CHARY',
          value: `${text_charlead > 0 ? '+' : ''}${text_charlead}`,
          on_decrement: () => {
            text_charlead = Math.max(-16, text_charlead - 1);
            saveToolProperties({ text_charlead });
          },
          on_increment: () => {
            text_charlead = Math.min(16, text_charlead + 1);
            saveToolProperties({ text_charlead });
          },
        });
        rows.push({
          type: 'single_stepper',
          id: 'text_enterlead',
          label: 'ENTY',
          value: `${text_enterlead > 0 ? '+' : ''}${text_enterlead}`,
          on_decrement: () => {
            text_enterlead = Math.max(-16, text_enterlead - 1);
            saveToolProperties({ text_enterlead });
          },
          on_increment: () => {
            text_enterlead = Math.min(16, text_enterlead + 1);
            saveToolProperties({ text_enterlead });
          },
        });
        rows.push({
          type: 'single_stepper',
          id: 'text_enterspace',
          label: 'ENTX',
          value: `${text_enterspace > 0 ? '+' : ''}${text_enterspace}`,
          on_decrement: () => {
            text_enterspace = Math.max(-16, text_enterspace - 1);
            saveToolProperties({ text_enterspace });
          },
          on_increment: () => {
            text_enterspace = Math.min(16, text_enterspace + 1);
            saveToolProperties({ text_enterspace });
          },
        });
      }

      if (left_tool === 'eyedropper' || right_tool === 'eyedropper') {
        rows.push({
          type: 'single_cycle',
          id: 'picker_target',
          label: 'PICK',
          value: picker_pick_for_opposite_hand ? 'OPP' : 'SELF',
          options: ['SELF', 'OPP'],
          on_cycle: () => {
            picker_pick_for_opposite_hand = !picker_pick_for_opposite_hand;
            saveToolProperties({ picker_pick_for_opposite_hand });
          },
        });
      }
    }

    function build_stacked_property_rows(): ToolPropertyRow[] {
      const rows: ToolPropertyRow[] = [];
      const left_tool = left_click_tool;
      const right_tool = right_click_tool;

      const shared_rows: ToolPropertyRow[] = [];
      const target_rows: ToolPropertyRow[] = [];
      const size_rows: ToolPropertyRow[] = [];
      const tool_rows: ToolPropertyRow[] = [];

      append_shared_matrix_rows(shared_rows);
      append_target_rows(target_rows, left_tool, right_tool);
      append_size_rows(size_rows);
      append_tool_specific_rows(tool_rows, left_tool, right_tool);

      rows.push(...shared_rows);
      if (shared_rows.length > 0 && (target_rows.length > 0 || size_rows.length > 0 || tool_rows.length > 0)) {
        rows.push({ type: 'separator', id: 'shared_separator' });
      }
      rows.push(...target_rows);
      if (target_rows.length > 0 && (size_rows.length > 0 || tool_rows.length > 0)) {
        rows.push({ type: 'separator', id: 'target_separator' });
      }
      rows.push(...size_rows);
      rows.push(...tool_rows);
      if (tool_target_invert_held) {
        if (rows.length > 0) rows.push({ type: 'separator', id: 'invert_separator' });
        rows.push({ type: 'info', id: 'tool_target_invert_info', text: 'TEMP TARGET INVERT [`]', rgb: get_ui_semantic_rgb('vivid') });
      }
      return rows;
    }

    return make_tool_properties_module({
      id: 'tool_properties',
      rect: tool_properties_rect,
      get_current_tool: () => current_tool,
      get_brush_size: () => getBrushSizeForSide(active_property_side),
      get_left_brush_size: () => left_brush_size,
      get_right_brush_size: () => right_brush_size,
      get_active_side: () => active_property_side,
      property_rows: () => build_stacked_property_rows(),
      on_brush_size_change: (size, side) => {
        active_property_side = side;
        if (side === 'right') right_brush_size = size;
        else left_brush_size = size;
        saveBrushState(side);
        painterDiag('selected brush size', { size, side });
      },
      get_space_replace: () => space_replace,
      on_space_replace_change: (replace) => {
        space_replace = replace;
        painterDiag('space replace toggled', { replace });
      },
      get_text_spacing: () => text_spacing,
      on_text_spacing_change: (spacing) => {
        text_spacing = spacing;
        saveToolProperties({ text_spacing: spacing });
        painterDiag('text spacing changed', { spacing });
      },
      get_text_charlead: () => text_charlead,
      on_text_charlead_change: (charlead) => {
        text_charlead = charlead;
        saveToolProperties({ text_charlead: charlead });
        painterDiag('text charlead changed', { charlead });
      },
      get_text_enterlead: () => text_enterlead,
      on_text_enterlead_change: (enterlead) => {
        text_enterlead = enterlead;
        saveToolProperties({ text_enterlead: enterlead });
        painterDiag('text enterlead changed', { enterlead });
      },
      get_text_enterspace: () => text_enterspace,
      on_text_enterspace_change: (enterspace) => {
        text_enterspace = enterspace;
        saveToolProperties({ text_enterspace: enterspace });
        painterDiag('text enterspace changed', { enterspace });
      },
      get_selection_mode: () => selection_mode,
      on_selection_mode_change: (mode) => {
        selection_mode = mode;
        painterDiag('selection mode changed', { mode });
      },
      get_paste_space_replace: () => paste_space_replace,
      on_paste_space_replace_change: (replace) => {
        paste_space_replace = replace;
        saveToolProperties({ paste_space_replace: replace });
        painterDiag('paste space replace changed', { replace });
      },
      get_paste_scale: () => paste_scale,
      on_paste_scale_change: (scale) => {
        paste_scale = Math.max(0.1, Math.min(3.0, scale));
        saveToolProperties({ paste_scale });
        painterDiag('paste scale changed', { scale: paste_scale });
      },
      get_paste_ignore_space: () => paste_ignore_space,
      on_paste_ignore_space_change: (ignore) => {
        paste_ignore_space = ignore;
        saveToolProperties({ paste_ignore_space: ignore });
        painterDiag('paste ignore space changed', { ignore });
      },
      get_paste_ignore_black: () => paste_ignore_black,
      on_paste_ignore_black_change: (ignore) => {
        paste_ignore_black = ignore;
        saveToolProperties({ paste_ignore_black: ignore });
        painterDiag('paste ignore black changed', { ignore });
      },
      get_paste_ignore_white: () => paste_ignore_white,
      on_paste_ignore_white_change: (ignore) => {
        paste_ignore_white = ignore;
        saveToolProperties({ paste_ignore_white: ignore });
        painterDiag('paste ignore white changed', { ignore });
      },
      get_paste_ignore_color: () => paste_ignore_color,
      on_paste_ignore_color_change: (ignore) => {
        paste_ignore_color = ignore;
        saveToolProperties({ paste_ignore_color: ignore });
        painterDiag('paste ignore color changed', { ignore });
      },
      get_paste_ignore_color_rgb: () => paste_ignore_color_rgb,
      on_paste_ignore_color_select: () => {
        // Enter "color select mode" for ignore color
        // We'll set a flag that the color selector will check
        (globalThis as any).__selecting_ignore_color = true;
        painterImportant('select a color from the color selector to ignore');
      },
      on_selection_clear: () => {
        (canvas_module as any).clearSelection?.();
        painterDiag('selection cleared');
      },
      on_selection_invert: () => {
        (canvas_module as any).invertSelection?.();
        painterDiag('selection inverted');
      },
      on_selection_all: () => {
        (canvas_module as any).selectAll?.();
        painterDiag('select all');
      },
      on_move: (new_rect) => {
        if (tool_properties_module) {
          tool_properties_module.rect = new_rect;
          saveModulePosition('tool_properties', new_rect);
        }
      },
      on_resize: (new_rect) => {
        if (tool_properties_module) {
          tool_properties_module.rect = new_rect;
        }
      },
      on_close: () => {
        setModuleOpen('tool_properties', false, (v) => { tool_properties_open = v; });
      }
    });
  }

  function open_customization_picker(): void {
    if (!registry.has('customization_picker')) {
      customization_picker_module = create_customization_picker_module();
      registry.register(customization_picker_module);
    }
    setModuleOpen('customization_picker', true, (v) => { customization_picker_open = v; });
  }

  function create_customization_module(): Module {
    return make_customization_module({
      id: 'customization_panel',
      rect: customization_rect,
      get_active_role: () => active_customization_role,
      get_role_color: (role) => ui_customization_state.colors[role],
      on_role_select: (role) => {
        active_customization_role = role;
        open_customization_picker();
      },
      on_move: (new_rect) => {
        if (customization_module) customization_module.rect = new_rect;
        saveModulePosition('customization_panel', new_rect);
      },
      on_close: () => {
        setModuleOpen('customization_panel', false, (v) => { customization_open = v; });
      },
    });
  }

  function create_customization_picker_module(): Module {
    return make_color_picker_module({
      id: 'customization_picker',
      rect: customization_picker_rect,
      title: () => `SET ${active_customization_role.replace(/_/g, ' ').toUpperCase()}`,
      get_committed_rgb: () => ui_customization_state.colors[active_customization_role],
      on_preview_change: (rgb) => {
        const next = set_ui_customization_role_color(active_customization_role, rgb);
        apply_ui_customization_runtime(next);
      },
      on_commit: (rgb) => {
        const next = set_ui_customization_role_color(active_customization_role, rgb);
        apply_ui_customization_runtime(next);
        saveToolProperties({ user_selection_color_rgb: ui_customization_state.colors.vivid });
        void save_ui_customization_role_color(PAINTER_APP_CONFIG.selected_data_slot, active_customization_role, rgb, active_profile_scope).then((saved) => {
          apply_ui_customization_runtime(saved);
          saveToolProperties({ user_selection_color_rgb: saved.colors.vivid });
        }).catch(() => null);
      },
      on_move: (new_rect) => {
        if (customization_picker_module) customization_picker_module.rect = new_rect;
        saveModulePosition('customization_picker', new_rect);
      },
      on_close: () => {
        setModuleOpen('customization_picker', false, (v) => { customization_picker_open = v; });
      },
    });
  }

  function getActiveIndexedPaletteEntry() {
    return indexed_palette_state.entries.find((entry) => entry.id === active_indexed_palette_entry_id) ?? indexed_palette_state.entries[0] ?? null;
  }

  function open_indexed_palette_picker(): void {
    if (!registry.has('indexed_palette_picker')) {
      indexed_palette_picker_module = create_indexed_palette_picker_module();
      registry.register(indexed_palette_picker_module);
    }
    setModuleOpen('indexed_palette_picker', true, (v) => { indexed_palette_picker_open = v; });
  }

  function create_indexed_palette_module(): Module {
    return make_indexed_palette_module({
      id: 'indexed_palette_panel',
      rect: indexed_palette_rect,
      get_palette_state: () => indexed_palette_state,
      get_active_entry_id: () => active_indexed_palette_entry_id,
      on_select_entry: (id) => {
        active_indexed_palette_entry_id = id;
        open_indexed_palette_picker();
      },
      on_reorder_entries: (next_ids) => {
        void persist_indexed_palette_runtime(reorder_indexed_palette_entries(next_ids)).catch(() => null);
      },
      on_duplicate_entry: (id) => {
        const next = duplicate_indexed_palette_entry(id);
        const source_index = indexed_palette_state.entries.findIndex((entry) => entry.id === id);
        const duplicated = source_index >= 0 ? next.entries[source_index + 1] ?? next.entries[source_index] ?? next.entries[0] ?? null : next.entries[0] ?? null;
        active_indexed_palette_entry_id = duplicated?.id ?? active_indexed_palette_entry_id;
        open_indexed_palette_picker();
        void persist_indexed_palette_runtime(next).catch(() => null);
      },
      on_delete_entry: (id) => {
        const current_index = indexed_palette_state.entries.findIndex((entry) => entry.id === id);
        const fallback = indexed_palette_state.entries[current_index - 1] ?? indexed_palette_state.entries[current_index + 1] ?? indexed_palette_state.entries[0] ?? null;
        active_indexed_palette_entry_id = fallback?.id ?? active_indexed_palette_entry_id;
        void persist_indexed_palette_runtime(delete_indexed_palette_entry(id)).catch(() => null);
      },
      on_flatten_document: () => {
        flattenPainterDocumentColorsToIndexed();
      },
      on_move: (new_rect) => {
        if (indexed_palette_module) indexed_palette_module.rect = new_rect;
        saveModulePosition('indexed_palette_panel', new_rect);
      },
      on_close: () => {
        setModuleOpen('indexed_palette_panel', false, (v) => { indexed_palette_open = v; });
      },
    });
  }

  function create_indexed_palette_picker_module(): Module {
    return make_palette_slot_color_picker_module({
      id: 'indexed_palette_picker',
      rect: indexed_palette_picker_rect,
      title: () => {
        const entry = getActiveIndexedPaletteEntry();
        return entry ? `SET ${(entry.label ?? 'COLOR').toUpperCase()}` : 'SET PALETTE COLOR';
      },
      get_active_entry: () => getActiveIndexedPaletteEntry(),
      on_commit: (rgb) => {
        const entry = getActiveIndexedPaletteEntry();
        if (!entry) return;
        void persist_indexed_palette_runtime(update_indexed_palette_entry_rgb(entry.id, rgb)).catch(() => null);
      },
      on_move: (new_rect) => {
        if (indexed_palette_picker_module) indexed_palette_picker_module.rect = new_rect;
        saveModulePosition('indexed_palette_picker', new_rect);
      },
      on_close: () => {
        setModuleOpen('indexed_palette_picker', false, (v) => { indexed_palette_picker_open = v; });
      },
    });
  }

  function create_controls_panel_module(): Module {
    return make_controls_module({
      id: 'controls_panel',
      rect: getModuleRectWithSave('controls_panel', { x0: 138, y0: 8, x1: 198, y1: 38 }),
      get_is_visible: () => controls_open,
      get_definitions: () => painter_controls.runtime.get_definitions('painter'),
      get_binding_label: (action_id) => painter_controls.runtime.get_binding_label(action_id),
      get_conflicts: (action_id) => painter_controls.runtime.get_conflicts(action_id),
      set_binding: (action_id, binding) => painter_controls.runtime.set_binding(action_id, binding),
      on_close: () => setModuleOpen('controls_panel', false, (v) => { controls_open = v; }),
      on_move: (new_rect) => {
        if (controls_module) controls_module.rect = new_rect;
        saveModulePosition('controls_panel', new_rect);
      },
    });
  }

  function create_selection_panel_module(): Module {
    const uiBackground = () => get_ui_semantic_rgb('background');
    const uiMedium = () => get_ui_semantic_rgb('medium');
    const modeOptions: Array<{ mode: SelectionMode; label: string }> = [
      { mode: 'replace', label: 'Replace' },
      { mode: 'additive', label: 'Additive' },
      { mode: 'subtract', label: 'Subtract' },
      { mode: 'intersect', label: 'Intersect' },
    ];
    const actionButtons: Array<{ id: 'all' | 'invert' | 'clear'; label: string }> = [
      { id: 'all', label: '[All]' },
      { id: 'invert', label: '[Invert]' },
      { id: 'clear', label: '[Clear]' },
    ];
    const textControls = create_plain_text_control_state();

    function getRowY(rect: Rect, rowIndexFromBottom: number): number {
      return rect.y1 - 2 - rowIndexFromBottom;
    }

    function drawText(c: Canvas, rect: Rect, x: number, y: number, text: string, rgb: Rgb, weight_index: 0 | 1 | 2 | 3): void {
      for (let i = 0; i < text.length && x + i < rect.x1; i += 1) {
        c.set(x + i, y, { char: text[i]!, rgb, weight_index, style: 'regular' });
      }
    }

    return make_floating_panel_module({
      id: 'selection_panel',
      rect: getModuleRectWithSave('selection_panel', { x0: 138, y0: 28, x1: 166, y1: 40 }),
      title: () => 'SELECTION',
      is_visible: () => selection_panel_open,
      background: { rgb: uiBackground() },
      border: {
      },
      gizmos: {
        enabled: ['close', 'move', 'seamless'],
        can_close: true,
        can_move: true,
        can_save_position: false,
        on_close: () => setModuleOpen('selection_panel', false, (v) => { selection_panel_open = v; }),
        on_move: (new_rect) => {
          if (selection_panel_module) selection_panel_module.rect = new_rect;
          saveModulePosition('selection_panel', new_rect);
        },
        on_move_end: (new_rect) => {
          if (selection_panel_module) selection_panel_module.rect = new_rect;
          saveModulePosition('selection_panel', new_rect);
        },
      },
      draw_content(c: Canvas, rect: Rect): void {
        begin_plain_text_control_frame(textControls);
        const status = getPainterSelectionStatus() ?? 'SEL 0';
        const statusY = getRowY(rect, 6);
        const replaceY = getRowY(rect, 5);
        const actionTopY = getRowY(rect, 2);
        const footerY = getRowY(rect, 0);
        const textX = rect.x0 + 1;

        if (statusY > rect.y0) drawText(c, rect, textX, statusY, status, user_selection_color_rgb, 1);

        for (let i = 0; i < modeOptions.length; i += 1) {
          const option = modeOptions[i]!;
          const y = replaceY - i;
          if (y <= rect.y0) continue;
          const selected = selection_mode === option.mode;
          const id = `mode:${option.mode}`;
          const marker = selected ? '[x]' : '[ ]';
          const label = `${marker} ${option.label}`;
          const baseWeight = selected ? 2 : 1;
          draw_plain_text_row(c, {
            id,
            text: label,
            x: textX,
            y,
            row_x0: rect.x0 + 1,
            row_x1: rect.x1 - 1,
            state: textControls,
            selected,
            base_weight_index: 1,
            selected_weight_index: baseWeight,
            pressed_weight_index: Math.min(3, baseWeight + 1),
          });
        }

        for (let i = 0; i < actionButtons.length; i += 1) {
          const button = actionButtons[i]!;
          const y = actionTopY - i;
          if (y <= rect.y0) continue;
          const id = `action:${button.id}`;
          draw_plain_text_control(c, {
            id,
            text: button.label,
            x: textX,
            y,
            state: textControls,
            hitbox: 'text_only',
            base_weight_index: 1,
            selected_weight_index: 1,
            pressed_weight_index: 2,
          });
        }

        if (footerY > rect.y0) {
          const footer = tool_target_invert_held ? '` invert held' : '` invert key';
          drawText(c, rect, textX, footerY, footer, uiMedium(), 1);
        }
      },
      on_pointer_down_content(e: PointerEvent): void {
        press_plain_text_control(textControls, e.x, e.y);
      },
      on_pointer_move_content(e: PointerEvent): void {
        update_plain_text_hover(textControls, e.x, e.y);
      },
      on_pointer_leave_content(): void {
        clear_plain_text_control_interaction(textControls);
      },
      on_pointer_up_content(): void {
        const hitId = release_hovered_plain_text_control(textControls);
        if (!hitId) return;
        if (hitId.startsWith('mode:')) {
          const mode = hitId.slice('mode:'.length) as SelectionMode;
          selection_mode = mode;
          return;
        }
        if (hitId === 'action:all') {
          handle_world_selection_change({ kind: 'select_all' });
          return;
        }
        if (hitId === 'action:invert') {
          handle_world_selection_change({ kind: 'invert' });
          return;
        }
        if (hitId === 'action:clear') handle_world_selection_change({ kind: 'clear' });
      },
    });
  }

  // Create file menu module
  const file_menu = make_file_menu_module({
    id: 'painter_file_menu',
    rect: file_menu_rect,
    get_is_host: () => current_session_role === 'host',
    get_screen_size: () => ({ width: GRID_WIDTH, height: GRID_HEIGHT }),
    get_status_text: () => {
      const preview = getPreviewBrush();
      const focusPlane = painter_display_projection?.focus_world_plane ?? voxelSpace.camera.focus_plane;
      const activeGroup = resolve_current_runtime_group_id() ?? '-';
      const counts = activeGroup !== '-' ? get_group_undo_redo_counts(activeGroup) : { undo_count: 0, redo_count: 0 };
      return `L:${left_click_tool} R:${right_click_tool} CUR:${current_tool} CHAR:${preview.char} SIZE:L${getBrushSizeForSide('left')} R${getBrushSizeForSide('right')} DEPTH:${focusPlane} GRP:${activeGroup} U:${counts.undo_count} R:${counts.redo_count}`;
    },
    on_save: () => {
      if (current_session_role !== 'host') return;
      void save_file().catch((e) => {
        diag_log('painter', 'important', 'PAINTER', 'save failed', { error: e instanceof Error ? e.message : String(e) }, { sink: 'error' });
        alert('Save failed: ' + (e as Error).message);
      });
    },
    on_load: () => {
      if (current_session_role !== 'host') return;
      void load_file().catch((e) => {
        diag_log('painter', 'important', 'PAINTER', 'load failed', { error: e instanceof Error ? e.message : String(e) }, { sink: 'error' });
        alert('Load failed: ' + (e as Error).message);
      });
    },
    on_new: () => {
      if (current_session_role !== 'host') return;
      if (!confirm('Create new file? Unsaved changes will be lost.')) return;
      void new_file().catch((e) => {
        diag_log('painter', 'important', 'PAINTER', 'new file failed', { error: e instanceof Error ? e.message : String(e) }, { sink: 'error' });
        alert('New file failed: ' + (e as Error).message);
      });
    },
    on_clear: () => {
      if (!clear_active_group_authored_voxels()) {
        painterImportant('active group clear skipped', { reason: 'no_active_group_or_empty_group' });
        return;
      }
      painterImportant('active group cleared', { undo_available: true, active_group_id: resolve_current_runtime_group_id() });
      schedule_auto_save();
    },
    on_rename_painting: () => {
      if (current_session_role !== 'host') return;
      void rename_painting().catch((e) => {
        diag_log('painter', 'important', 'PAINTER', 'rename painting failed', { error: e instanceof Error ? e.message : String(e) }, { sink: 'error' });
      });
    },
    on_quit_painting: () => {
      void quit_painting().catch((e) => {
        diag_log('painter', 'important', 'PAINTER', 'quit painting failed', { error: e instanceof Error ? e.message : String(e) }, { sink: 'error' });
      });
    },
    on_reset_positions: () => {
      if (confirm('Reset all panel positions?')) {
        clearModulePositions();
        // Reload the page to apply default positions
        window.location.reload();
      }
    },
    on_reset_camera: () => {
      if (confirm('Reset camera to default settings?')) {
        resetPainterCameraConfig();
        // Apply default camera settings immediately
        painter_camera_state = createSanitizedPainterCamera();
        syncVoxelSpaceCameraFromPainterCamera();
        syncPainterViewStatesFromLegacyCamera();
        refreshPainterProjectionPreservingCameraFrame();
      }
    },
    on_toggle_toolbox: () => {
      toggleModule(
        toolbox_open,
        (v) => { toolbox_open = v; },
        'toolbox',
        create_toolbox_module
      );
    },
    on_toggle_char_selector: () => {
      toggleModule(
        char_selector_open,
        (v) => { char_selector_open = v; },
        'char_selector',
        create_char_selector_module
      );
    },
    on_toggle_color_selector: () => {
      toggleModule(
        color_selector_open,
        (v) => { color_selector_open = v; },
        'color_selector',
        create_color_selector_module
      );
    },
    on_toggle_color_block: () => {
      toggleModule(
        color_block_open,
        (v) => { color_block_open = v; },
        'color_block',
        create_color_block_module
      );
    },
    on_toggle_brush_preview: () => {
      toggleModule(
        brush_preview_open,
        (v) => { brush_preview_open = v; },
        'brush_preview',
        create_brush_preview_module
      );
    },
    on_toggle_tool_properties: () => {
      toggleModule(
        tool_properties_open,
        (v) => { tool_properties_open = v; },
        'tool_properties',
        create_tool_properties_module
      );
    },
    on_toggle_customization: () => {
      toggleModule(
        customization_open,
        (v) => { customization_open = v; },
        'customization_panel',
        create_customization_module
      );
    },
    on_toggle_indexed_palette: () => {
      toggleModule(
        indexed_palette_open,
        (v) => { indexed_palette_open = v; },
        'indexed_palette_panel',
        create_indexed_palette_module
      );
    },
    on_toggle_layer_palette: () => {
      toggleModule(
        layer_palette_open,
        (v) => { layer_palette_open = v; },
        'layer_palette',
        create_layer_palette_module
      );
    },
    on_toggle_camera: () => {
      toggleModule(
        camera_control_open,
        (v) => { camera_control_open = v; },
        'camera_control',
        create_camera_control_module
      );
    },
    on_toggle_controls: () => {
      toggleModule(
        controls_open,
        (v) => { controls_open = v; },
        'controls_panel',
        create_controls_panel_module
      );
    }
  });

  // Create Layer Palette module (3D layers UI)
  let layer_palette_open = getInitialModuleVisibility('layer_palette', true);
  let layer_palette_module: Module | null = null;

  function isPainterCanvasTextCaptureActive(): boolean {
    return Boolean((canvas_module as any)?.WantsTextCapture?.());
  }

  function isPainterTextCaptureActive(): boolean {
    return isPainterCanvasTextCaptureActive() || Boolean((layer_palette_module as any)?.WantsTextCapture?.());
  }
  
  function create_layer_palette_module(): Module {
    return makeGroupsModule({
      id: 'layer_palette',
      rect: layer_palette_rect,
      title: 'GROUPS',
      get_groups: () => getPainterGroupListItems(),
      get_current_breath: () => painter_current_breath,
      get_file_breath_range: () => getPainterDocumentFileBreathRange(),
      get_loop_breath_range: () => getPainterDocumentBreathRange(),
      on_set_current_breath: (breath: number) => {
        setCurrentPainterBreath(breath);
      },
      get_timeline_view_start: () => painter_timeline_view_start_breath,
      get_timeline_view_span: () => painter_timeline_view_span_breaths,
      on_set_timeline_view_start: (breath: number) => {
        setPainterTimelineViewStart(breath);
      },
      on_set_document_loop_window: (breath_start: number, breath_end: number) => {
        setPainterDocumentLoopWindow({ breath_start, breath_end });
      },
      get_auto_key_enabled: () => painter_groups_auto_key_enabled,
      on_toggle_auto_key: () => {
        painter_groups_auto_key_enabled = !painter_groups_auto_key_enabled;
        painterDiag('groups auto key toggled', { enabled: painter_groups_auto_key_enabled });
      },
      get_frames_per_breath: () => get_painter_document_playback(painter_document_runtime.document).frames_per_breath,
      on_step_frames_per_breath: (delta: number) => {
        const range = getPainterDocumentFileBreathRange();
        const playback = get_painter_document_playback(painter_document_runtime.document);
        setPainterDocumentTimingPreservingLoop({
          breath_range_start: range.start,
          breath_range_end: range.end,
          frames_per_breath: playback.frames_per_breath + delta,
          loop_enabled: playback.loop_enabled,
        });
      },
      on_select_group: (group_id: string) => {
        selectPainterGroup(group_id);
      },
      on_select_group_property: (group_id: string, property_id: string) => {
        selectPainterGroupProperty(group_id, property_id);
      },
      on_toggle_group_visibility: (group_id: string) => {
        togglePainterGroupVisibility(group_id);
      },
      on_toggle_group_lock: (group_id: string) => {
        togglePainterGroupLock(group_id);
      },
      on_rename_group: (group_id: string, newName: string) => {
        renamePainterGroup(group_id, newName);
      },
      on_add_group: () => {
        addPainterGroupStructure();
      },
      on_delete_group: (group_id: string) => {
        deletePainterGroup(group_id);
      },
      on_reorder_groups: (next_group_order: string[]) => {
        reorderPainterGroups(mapGroupDisplayOrderToRuntimeOrder(next_group_order));
      },
      on_reorder_group_properties: (group_id: string, next_property_order: string[]) => {
        reorderPainterGroupProperties(group_id, next_property_order);
      },
      on_remove_group_property: (group_id: string, property_id: string) => {
        removePainterGroupProperty(group_id, property_id);
      },
      on_offset_group_in_time: (group_id: string, delta_breaths: number) => {
        offsetPainterGroupInTime(group_id, delta_breaths);
      },
      on_set_group_timing: (group_id: string, start: number, cropped_start: number, cropped_end: number) => {
        setPainterGroupTiming(group_id, { start, cropped_start, cropped_end });
      },
      on_set_group_property_block_length: (group_id: string, property_id: string, block_id: string, length_breaths: number) => {
        setPainterGroupPropertyBlockLength(group_id, property_id, block_id, length_breaths);
      },
      on_split_group_property_block: (group_id: string, property_id: string, block_id: string, split_breath: number) => {
        splitPainterGroupPropertyBlock(group_id, property_id, block_id, split_breath);
      },
      on_swap_group_property_blocks: (group_id: string, property_id: string, source_block_id: string, target_block_id: string) => {
        swapPainterGroupPropertyBlocks(group_id, property_id, source_block_id, target_block_id);
      },
      on_blank_group_property_block: (group_id: string, property_id: string, block_id: string) => {
        blankPainterGroupPropertyBlock(group_id, property_id, block_id);
      },
      on_trim_group_property_block_edge: (group_id: string, property_id: string, block_id: string, edge: 'start' | 'end') => {
        trimPainterGroupPropertyBlockEdge(group_id, property_id, block_id, edge);
      },
      on_merge_group_blank_property_block: (group_id: string, property_id: string, block_id: string, direction: 'left' | 'right') => {
        mergePainterGroupBlankPropertyBlock(group_id, property_id, block_id, direction);
      },
      on_compact_group_blank_property_block_left: (group_id: string, property_id: string, block_id: string) => {
        compactPainterGroupBlankPropertyBlockLeft(group_id, property_id, block_id);
      },
      on_set_group_property_block_edge_destructive: (group_id: string, property_id: string, block_id: string, edge: 'start' | 'end', target_breath: number) => {
        setPainterGroupPropertyBlockEdgeDestructive(group_id, property_id, block_id, edge, target_breath);
      },
      on_move_group_property_block: (group_id: string, property_id: string, block_id: string, target_breath: number) => {
        movePainterGroupPropertyBlock(group_id, property_id, block_id, target_breath);
      },
      on_move: (new_rect) => {
        if (layer_palette_module) {
          layer_palette_module.rect = new_rect;
          saveModulePosition('layer_palette', new_rect);
        }
      },
      on_resize: (new_rect) => {
        if (layer_palette_module) {
          layer_palette_module.rect = new_rect;
        }
      },
      on_close: () => {
        setModuleOpen('layer_palette', false, (v) => { layer_palette_open = v; });
      }
    });
  }
  
  // Register initial modules
  registry.register(file_menu);
  registry.register(canvas_module);
  
  // Register Layer Palette (3D layers)
  layer_palette_module = create_layer_palette_module();
  registry.register(layer_palette_module);

  // Create Camera Control module (closed by default)
  let camera_control_open = getInitialModuleVisibility('camera_control', false);
  let camera_control_module: Module | null = null;

  function create_camera_control_module(): Module {
    return makePlaceCameraControlModule({
      id: 'camera_control',
      rect: camera_control_rect,
      title: 'Painter Camera',
      getCamera: () => voxelSpace.camera,
      action_rows: [
        [
          { id: 'roll_left', label: 'R.L' },
          { id: 'swing_up', label: '↑' },
          { id: 'roll_right', label: 'R.R' },
        ],
        [
          { id: 'swing_left', label: '←' },
          { id: 'pan_placeholder', label: '·' },
          { id: 'swing_right', label: '→' },
        ],
        [
          { id: 'depth_prev', label: '-' },
          { id: 'swing_down', label: '↓' },
          { id: 'depth_next', label: '+' },
        ],
      ],
      onAction: (id) => {
        if (id === 'swing_left' || id === 'swing_right' || id === 'swing_up' || id === 'swing_down' || id === 'roll_left' || id === 'roll_right') {
          stepPainterViewAction(id);
          return;
        }
        if (id === 'depth_prev') {
          stepPainterDepth(-1);
          return;
        }
        if (id === 'depth_next') {
          stepPainterDepth(1);
        }
      },
      slider_specs: {
        movement_per_layer: { ...PAINTER_CAMERA_LIMITS.movement_per_layer, step: 1, digits: 0 },
        scale_per_layer: { ...PAINTER_CAMERA_LIMITS.scale_per_layer, step: 0.01, digits: 2 },
        mouse_angle_yaw_deg: { ...PAINTER_CAMERA_LIMITS.mouse_angle_yaw_deg, step: 0.5, digits: 1 },
        mouse_angle_pitch_deg: { ...PAINTER_CAMERA_LIMITS.mouse_angle_pitch_deg, step: 0.5, digits: 1 },
        mouse_angle_spring: { ...PAINTER_CAMERA_LIMITS.mouse_angle_spring, step: 0.5, digits: 1 },
        calibration_x: { ...PAINTER_CAMERA_LIMITS.calibration_x },
        calibration_y: { ...PAINTER_CAMERA_LIMITS.calibration_y },
        render_distance_planes: { ...PAINTER_CAMERA_LIMITS.render_distance_planes, step: 1, digits: 0 },
      },
      onParallaxMoveToggle: (enabled) => {
        painter_camera_state.parallax_move_enabled = enabled;
        syncVoxelSpaceCameraFromPainterCamera();
        syncPainterDocumentCameraFromPainterCamera();
        applyPainterProjectedCameraTuning();
        if (isAppInitialized) {
          persistPainterCameraConfig({ parallax_move_enabled: enabled });
        }
        painterCameraDiag('parallax move toggled', { enabled });
      },
      onParallaxSizeToggle: (enabled) => {
        painter_camera_state.parallax_size_enabled = enabled;
        syncVoxelSpaceCameraFromPainterCamera();
        syncPainterDocumentCameraFromPainterCamera();
        applyPainterProjectedCameraTuning();
        if (isAppInitialized) {
          persistPainterCameraConfig({ parallax_size_enabled: enabled });
        }
        painterCameraDiag('parallax size toggled', { enabled });
      },
      occlusionLabel: 'Focus Opacity',
      getOcclusionEnabled: () => painter_camera_state.use_focus_layer_opacity ?? true,
      onOcclusionToggle: (enabled) => {
        painter_camera_state.use_focus_layer_opacity = enabled;
        syncVoxelSpaceCameraFromPainterCamera();
        syncPainterDocumentCameraFromPainterCamera();
        applyPainterProjectedCameraTuning();
        if (isAppInitialized) {
          persistPainterCameraConfig({ use_focus_layer_opacity: enabled });
        }
        painterCameraDiag('focus opacity toggled', { enabled });
      },
      onCenterTargetToggle: (enabled) => {
        painter_camera_state.center_target_in_view = enabled;
        syncVoxelSpaceCameraFromPainterCamera();
        syncPainterDocumentCameraFromPainterCamera();
        refreshPainterProjectionPreservingCameraFrame();
        if (isAppInitialized) {
          persistPainterCameraConfig({ center_target_in_view: enabled });
        }
        painterCameraDiag('center target toggled', { enabled });
      },
      onCalibrationChange: (x, y) => {
        const nextCalibration = sanitizePainterCameraConfig({ calibration: { x, y } }).calibration ?? { x: 0, y: 0 };
        painter_camera_state.calibration = nextCalibration;
        syncVoxelSpaceCameraFromPainterCamera();
        syncPainterDocumentCameraFromPainterCamera();
        applyPainterProjectedCameraTuning();
        if (isAppInitialized) {
          persistPainterCameraConfig({ calibration: nextCalibration });
        }
      },
      onCalibrationReset: () => {
        painter_camera_state.calibration = { x: 0, y: 0 };
        syncVoxelSpaceCameraFromPainterCamera();
        syncPainterDocumentCameraFromPainterCamera();
        applyPainterProjectedCameraTuning();
        if (isAppInitialized) {
          persistPainterCameraConfig({ calibration: { x: 0, y: 0 } });
        }
      },
      onScalePerLayerChange: (value) => {
        const nextValue = sanitizePainterCameraConfig({ scale_per_layer: value }).scale_per_layer ?? 0;
        painter_camera_state.scale_per_layer = nextValue;
        syncVoxelSpaceCameraFromPainterCamera();
        syncPainterDocumentCameraFromPainterCamera();
        applyPainterProjectedCameraTuning();
        if (isAppInitialized) {
          persistPainterCameraConfig({ scale_per_layer: nextValue });
        }
      },
      onMovementPerLayerChange: (value) => {
        const nextValue = sanitizePainterCameraConfig({ movement_per_layer: value }).movement_per_layer ?? 0;
        painter_camera_state.movement_per_layer = nextValue;
        syncVoxelSpaceCameraFromPainterCamera();
        syncPainterDocumentCameraFromPainterCamera();
        applyPainterProjectedCameraTuning();
        if (isAppInitialized) {
          persistPainterCameraConfig({ movement_per_layer: nextValue });
        }
      },
      onMouseAngleYawDegChange: (value) => {
        const nextValue = sanitizePainterCameraConfig({ mouse_angle_yaw_deg: value }).mouse_angle_yaw_deg ?? 0;
        painter_camera_state.mouse_angle_yaw_deg = nextValue;
        syncVoxelSpaceCameraFromPainterCamera();
        syncPainterDocumentCameraFromPainterCamera();
        applyPainterProjectedCameraTuning();
        if (isAppInitialized) {
          persistPainterCameraConfig({ mouse_angle_yaw_deg: nextValue });
        }
      },
      onMouseAnglePitchDegChange: (value) => {
        const nextValue = sanitizePainterCameraConfig({ mouse_angle_pitch_deg: value }).mouse_angle_pitch_deg ?? 0;
        painter_camera_state.mouse_angle_pitch_deg = nextValue;
        syncVoxelSpaceCameraFromPainterCamera();
        syncPainterDocumentCameraFromPainterCamera();
        applyPainterProjectedCameraTuning();
        if (isAppInitialized) {
          persistPainterCameraConfig({ mouse_angle_pitch_deg: nextValue });
        }
      },
      onMouseAngleSpringChange: (value) => {
        const nextValue = sanitizePainterCameraConfig({ mouse_angle_spring: value }).mouse_angle_spring ?? painter_camera_state.mouse_angle_spring;
        painter_camera_state.mouse_angle_spring = nextValue;
        syncVoxelSpaceCameraFromPainterCamera();
        syncPainterDocumentCameraFromPainterCamera();
        applyPainterProjectedCameraTuning();
        if (isAppInitialized) {
          persistPainterCameraConfig({ mouse_angle_spring: nextValue });
        }
      },
      onRenderDistancePlanesChange: (value) => {
        const nextValue = sanitizePainterCameraConfig({ render_distance_planes: value }).render_distance_planes ?? 2;
        painter_camera_state.render_distance_planes = nextValue;
        syncVoxelSpaceCameraFromPainterCamera();
        syncPainterDocumentCameraFromPainterCamera();
        refreshPainterProjectionPreservingCameraFrame();
        if (isAppInitialized) {
          persistPainterCameraConfig({ render_distance_planes: nextValue });
        }
      },
      onMove: (new_rect) => {
        if (camera_control_module) {
          camera_control_module.rect = new_rect;
          saveModulePosition('camera_control', new_rect);
        }
      },
      onResize: (new_rect) => {
        if (camera_control_module) {
          camera_control_module.rect = new_rect;
          saveModulePosition('camera_control', new_rect);
        }
      },
      onClose: () => {
        setModuleOpen('camera_control', false, (v) => { camera_control_open = v; });
      }
    });
  }

  // Register floating modules (open by default)
  char_selector_module = create_char_selector_module();
  brush_preview_module = create_brush_preview_module();
  color_selector_module = create_color_selector_module();
  color_block_module = create_color_block_module();
  toolbox_module = create_toolbox_module();
  tool_properties_module = create_tool_properties_module();
  customization_module = create_customization_module();
  customization_picker_module = create_customization_picker_module();
  indexed_palette_module = create_indexed_palette_module();
  indexed_palette_picker_module = create_indexed_palette_picker_module();
  selection_panel_module = create_selection_panel_module();
  camera_control_module = create_camera_control_module();
  controls_module = create_controls_panel_module();
  registry.register(char_selector_module);
  registry.register(brush_preview_module);
  registry.register(color_selector_module);
  registry.register(color_block_module);
  registry.register(toolbox_module);
  registry.register(tool_properties_module);
  registry.register(customization_module);
  registry.register(customization_picker_module);
  registry.register(indexed_palette_module);
  registry.register(indexed_palette_picker_module);
  registry.register(selection_panel_module);
  registry.register(camera_control_module);
  registry.register(controls_module);

  registry.set_visibility('char_selector', char_selector_open);
  registry.set_visibility('brush_preview', brush_preview_open);
  registry.set_visibility('color_selector', color_selector_open);
  registry.set_visibility('color_block', color_block_open);
  registry.set_visibility('toolbox', toolbox_open);
  registry.set_visibility('tool_properties', tool_properties_open);
  registry.set_visibility('customization_panel', customization_open);
  registry.set_visibility('customization_picker', customization_picker_open);
  registry.set_visibility('indexed_palette_panel', indexed_palette_open);
  registry.set_visibility('indexed_palette_picker', indexed_palette_picker_open);
  registry.set_visibility('selection_panel', selection_panel_open);
  registry.set_visibility('layer_palette', layer_palette_open);
  registry.set_visibility('camera_control', camera_control_open);
  registry.set_visibility('controls_panel', controls_open);

  window.addEventListener('keydown', (e) => {
    if (isToolTargetInvertBindingEvent(e) && !tool_target_invert_held) {
      tool_target_invert_held = true;
      painterDiag('tool target invert held', { active: true });
    }
    if (isMoveMaskModifierEvent(e)) {
      move_mask_modifier_held = true;
    }
  });

  window.addEventListener('keyup', (e) => {
    if (isToolTargetInvertBindingEvent(e) && tool_target_invert_held) {
      tool_target_invert_held = false;
      painterDiag('tool target invert released', { active: false });
    }
    if (e.code === 'Backquote') {
      move_mask_modifier_held = false;
    }
  });

  window.addEventListener('pointerdown', () => {
    if (isPainterTextCaptureActive()) return;
    painter_tool_shortcut_interpreter.flush_pending_primary();
  }, { capture: true });

  window.addEventListener('keydown', (e) => {
    if (!isPainterTextCaptureActive() && (e.code === 'Enter' || e.code === 'Escape') && leavePendingPainterPlacement()) {
      e.preventDefault();
      return;
    }
    if (maybeHandlePainterToolShortcutKeydown(e)) return;
    maybeEarlyCommitPendingToolShortcutForKeydown(e);
    const editActionHandlers: Array<{ id: string; run: () => boolean }> = [
      { id: 'painter.edit.undo', run: () => performPainterUndoShortcut() },
      { id: 'painter.edit.redo', run: () => performPainterRedoShortcut() },
      { id: 'painter.edit.copy', run: () => performPainterCopyShortcut() },
    ];
    for (const binding of editActionHandlers) {
      if (!control_binding_matches_keyboard_event(painter_controls.runtime.get_binding(binding.id), e)) continue;
      e.preventDefault();
      binding.run();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyZ') {
      e.preventDefault();
      performPainterRedoShortcut();
      return;
    }
    if (tool_target_invert_held && canRoutePasteTransformActions()) {
      const pasteActionByCode: Partial<Record<string, 'swing_left' | 'swing_right' | 'swing_up' | 'swing_down' | 'roll_left' | 'roll_right'>> = {
        Numpad4: 'swing_left',
        Numpad6: 'swing_right',
        Numpad8: 'swing_up',
        Numpad2: 'swing_down',
        Numpad7: 'roll_left',
        Numpad9: 'roll_right',
      };
      const pasteAction = pasteActionByCode[e.code];
      if (pasteAction) {
        e.preventDefault();
        stepPasteTransformAction(pasteAction);
        return;
      }
    }
    if (!isPainterCanvasTextCaptureActive()) {
      const cameraActionBindings: Array<{ id: string; action: 'swing_left' | 'swing_right' | 'swing_up' | 'swing_down' | 'roll_left' | 'roll_right' }> = [
        { id: 'painter.view.swing_left', action: 'swing_left' },
        { id: 'painter.view.swing_right', action: 'swing_right' },
        { id: 'painter.view.swing_up', action: 'swing_up' },
        { id: 'painter.view.swing_down', action: 'swing_down' },
        { id: 'painter.view.roll_left', action: 'roll_left' },
        { id: 'painter.view.roll_right', action: 'roll_right' },
      ];
      for (const binding of cameraActionBindings) {
        if (!control_binding_matches_keyboard_event(painter_controls.runtime.get_binding(binding.id), e)) continue;
        e.preventDefault();
        stepPainterViewAction(binding.action);
        return;
      }
      const depthActionBindings: Array<{ id: string; dir: -1 | 1 }> = [
        { id: 'painter.view.depth_prev', dir: -1 },
        { id: 'painter.view.depth_next', dir: 1 },
      ];
      for (const binding of depthActionBindings) {
        if (!control_binding_matches_keyboard_event(painter_controls.runtime.get_binding(binding.id), e)) continue;
        e.preventDefault();
        stepPainterDepth(binding.dir);
        return;
      }
    }
    const positionalActionHandlers: Array<{ id: string; action: 'nudge_left' | 'nudge_right' | 'nudge_up' | 'nudge_down' | 'nudge_backward' | 'nudge_forward' | 'rotate_left' | 'rotate_right' }> = [
      { id: 'painter.position.nudge_left', action: 'nudge_left' },
      { id: 'painter.position.nudge_right', action: 'nudge_right' },
      { id: 'painter.position.nudge_up', action: 'nudge_up' },
      { id: 'painter.position.nudge_down', action: 'nudge_down' },
      { id: 'painter.position.nudge_backward', action: 'nudge_backward' },
      { id: 'painter.position.nudge_forward', action: 'nudge_forward' },
      { id: 'painter.position.rotate_left', action: 'rotate_left' },
      { id: 'painter.position.rotate_right', action: 'rotate_right' },
    ];
    for (const binding of positionalActionHandlers) {
      if (!control_binding_matches_keyboard_event(painter_controls.runtime.get_binding(binding.id), e)) continue;
      if (isPainterTextCaptureActive()) return;
      e.preventDefault();
      routePainterPositionalAction(binding.action);
      return;
    }
    const timingActionHandlers: Array<{ id: string; run: () => void }> = [
      { id: 'painter.breath.step_back', run: () => stepCurrentPainterBreath(-1) },
      { id: 'painter.breath.step_forward', run: () => stepCurrentPainterBreath(1) },
      { id: 'painter.breath.jump_active_group_start', run: () => jumpCurrentPainterBreathToActiveGroupBoundary('start') },
      { id: 'painter.breath.jump_active_group_end', run: () => jumpCurrentPainterBreathToActiveGroupBoundary('end') },
      { id: 'painter.breath.play_pause', run: () => togglePainterPlayback() },
      { id: 'painter.breath.jump_start', run: () => setCurrentPainterBreath(getPainterDocumentBreathRange().start) },
      { id: 'painter.breath.jump_end', run: () => setCurrentPainterBreath(getPainterDocumentBreathRange().end) },
    ];
    for (const binding of timingActionHandlers) {
      if (!control_binding_matches_keyboard_event(painter_controls.runtime.get_binding(binding.id), e)) continue;
      e.preventDefault();
      binding.run();
      return;
    }
    if (control_binding_matches_keyboard_event(painter_controls.runtime.get_binding('global.open_controls'), e)) {
      e.preventDefault();
      toggleModule(controls_open, (v) => { controls_open = v; }, 'controls_panel', create_controls_panel_module);
    }
  });

  (window as any).CONTROLS = {
    open: () => setModuleOpen('controls_panel', true, (v) => { controls_open = v; }),
    close: () => setModuleOpen('controls_panel', false, (v) => { controls_open = v; }),
    toggle: () => toggleModule(controls_open, (v) => { controls_open = v; }, 'controls_panel', create_controls_panel_module),
    runtime: painter_controls.runtime,
  };
  (window as any).TOOL_ASSISTED_INPUTS = {
    start: (next_script_ref: string) => {
      const script_ref = String(next_script_ref ?? '').trim();
      if (!script_ref) return;
      void painter_tai.runtime.start(script_ref);
    },
    stop: () => {
      void painter_tai.runtime.stop();
    },
    get_status: () => painter_tai.runtime.get_status(),
  };

  function update_layout(grid_width: number, grid_height: number): void {
    GRID_WIDTH = Math.max(1, Math.floor(Number(grid_width) || GRID_WIDTH));
    GRID_HEIGHT = Math.max(1, Math.floor(Number(grid_height) || GRID_HEIGHT));
    (PAINTER_CONFIG as any).grid_width = GRID_WIDTH;
    (PAINTER_CONFIG as any).grid_height = GRID_HEIGHT;

    file_menu_rect.x1 = GRID_WIDTH - 1;
  }

  async function start_from_launch_intent(intent: PainterLaunchIntent): Promise<void> {
    console.log('[PAINTER_LAUNCH]', JSON.stringify({
      event: 'start_from_launch_intent',
      intent_kind: intent.kind,
      slot: PAINTER_APP_CONFIG.selected_data_slot,
      path: 'path' in intent ? intent.path : null,
      document_id: 'document_id' in intent ? intent.document_id : null,
      join_target_id: 'join_target_id' in intent ? intent.join_target_id : null,
      api_base_url: 'api_base_url' in intent ? intent.api_base_url ?? null : null,
      bridge_ws_base_url: 'bridge_ws_base_url' in intent ? intent.bridge_ws_base_url ?? null : null,
      transport_kind: 'transport_kind' in intent ? intent.transport_kind ?? null : null,
      room_id: 'relay_room_id' in intent ? intent.relay_room_id ?? null : null,
    }));
    const previousSuppress = suppress_recent_file_persistence;
    suppress_recent_file_persistence = intent.persist_recent === false;
    try {
      if (intent.kind === 'join_authoritative') {
        painter_sync.set_expect_local_host_boot(false);
        if (intent.api_base_url && intent.bridge_ws_base_url) {
          apply_painter_multiplayer_transport_config({
            transport_kind: intent.transport_kind ?? 'direct_http_ws',
            api_base_url: intent.api_base_url,
            bridge_ws_base_url: intent.bridge_ws_base_url,
            room_id: intent.relay_room_id ?? undefined,
            attach_token: intent.relay_attach_token ?? undefined,
          });
        }
        current_session_role = 'participant';
        console.log('[PAINTER_LAUNCH]', JSON.stringify({ event: 'launch_role_assigned', intent_kind: intent.kind, role: current_session_role, document_id: intent.document_id }));
        current_filename = intent.display_name;
        const sync_state = await painter_sync.bootstrap(true, intent.document_id);
        painterImportant('launch intent bootstrapped multiplayer state', {
          intent_kind: intent.kind,
          authority_mode: sync_state.authority_mode,
          lifecycle: sync_state.lifecycle,
          join_target_id: intent.join_target_id,
          document_id: intent.document_id,
        });
        if (!sync_state.bootstrap?.snapshot) {
          throw new Error(`missing_authoritative_snapshot:${intent.document_id}`);
        }
        apply_authoritative_painter_bootstrap(sync_state.bootstrap);
        current_filename = intent.display_name;
        clearActiveFileAssociation(intent.display_name, { clearLastUsed: true });
        return;
      }
      painter_sync.set_expect_local_host_boot(true);
      apply_painter_multiplayer_transport_config({
        host_input: 'local',
        transport_kind: DEFAULT_LOCAL_MULTIPLAYER_TRANSPORT.transport_kind,
        api_base_url: DEFAULT_LOCAL_MULTIPLAYER_TRANSPORT.api_base_url,
        bridge_ws_base_url: DEFAULT_LOCAL_MULTIPLAYER_TRANSPORT.bridge_ws_base_url,
        room_id: undefined,
        attach_token: undefined,
      });
      const sync_state = await painter_sync.bootstrap(true);
      painterImportant('launch intent bootstrapped multiplayer state', {
        intent_kind: intent.kind,
        authority_mode: sync_state.authority_mode,
        lifecycle: sync_state.lifecycle,
      });
      if (sync_state.authority_mode !== 'authoritative_host' || !sync_state.bootstrap?.session_token) {
        console.error('[PAINTER_LAUNCH]', JSON.stringify({
          event: 'host_bootstrap_blocked',
          intent_kind: intent.kind,
          authority_mode: sync_state.authority_mode,
          lifecycle: sync_state.lifecycle,
          session_token_present: Boolean(sync_state.bootstrap?.session_token),
          error: sync_state.bootstrap?.error ?? null,
        }));
        throw new Error(`painter_host_bootstrap_not_authoritative:${sync_state.bootstrap?.error ?? sync_state.authority_mode}`);
      }
      console.log('[PAINTER_LAUNCH]', JSON.stringify({
        event: 'host_bootstrap_authoritative_ready',
        intent_kind: intent.kind,
        authority_mode: sync_state.authority_mode,
        lifecycle: sync_state.lifecycle,
        session_token_present: true,
      }));
      current_session_role = 'host';
      console.log('[PAINTER_LAUNCH]', JSON.stringify({ event: 'launch_role_assigned', intent_kind: intent.kind, role: current_session_role }));
      if (intent.kind === 'new_document') {
        await new_file();
        return;
      }
      if (intent.kind === 'resume_file' || intent.kind === 'load_file') {
        const api = window.electronAPI;
        if (!api?.readFile) throw new Error('electronAPI.readFile unavailable');
        const readResp = await api.readFile(intent.path);
        if (!readResp?.success || typeof readResp.content !== 'string') {
          throw new Error(readResp?.error || 'Failed to read painting file');
        }
        await loadArtworkFromContent(readResp.content, intent.path);
        return;
      }
    } finally {
      suppress_recent_file_persistence = previousSuppress;
    }
  }
  
  return {
    modules: registry.get_all(),
    module_registry: registry,
    multiplayer_sync: painter_sync,
    get_active_join_content_refs,
    update_layout,

     on_pointer_move_global: (x: number, y: number, e: any) => {
       last_pointer_x = x;
       last_pointer_y = y;
       const pointer_state = build_interaction_pointer_state({
         x,
         y,
         pointer_id: e?.pointer_id,
         button: e?.button,
         buttons: e?.buttons,
         shift: e?.shift,
         ctrl: e?.ctrl,
         alt: e?.alt,
         meta: e?.meta,
       });
       const move_resolution = painter_interaction_registry.process_pointer_move(pointer_state);
       painter_interaction_hover_state = move_resolution.hover;
       painter_interaction_session_state = move_resolution.session ?? painter_interaction_session_state;
     },
     on_pointer_down_global: (x: number, y: number, e: any) => {
       const pointer_state = build_interaction_pointer_state({
         x,
         y,
         pointer_id: e?.pointer_id,
         button: e?.button,
         buttons: e?.buttons,
         shift: e?.shift,
         ctrl: e?.ctrl,
         alt: e?.alt,
         meta: e?.meta,
       });
       const down_resolution = painter_interaction_registry.process_pointer_down(pointer_state, 'draw');
       painter_interaction_session_state = down_resolution.session;
     },
     on_pointer_up_global: (x: number, y: number, e: any) => {
       const pointer_state = build_interaction_pointer_state({
         x,
         y,
         pointer_id: e?.pointer_id,
         button: e?.button,
         buttons: e?.buttons,
         shift: e?.shift,
         ctrl: e?.ctrl,
         alt: e?.alt,
         meta: e?.meta,
       });
       const up_resolution = painter_interaction_registry.process_pointer_up(pointer_state);
       painter_interaction_session_state = up_resolution.session;
     },
    
    export_grid: () => exportPainterDocumentToJSON(exportCurrentPainterDocument()),
    
    import_grid: (json: string) => {
      try {
        const document = importPainterDocumentFromJSON(json);
        applyPainterDocumentSnapshot(document);
        setCurrentPainterDocumentLineage(`memory:import_document:${Date.now()}`, 'import_document');
        clearActiveFileAssociation('untitled', { clearLastUsed: true });
        clearAutoSave();
        painterImportant('imported painter document');
      } catch (e) {
        diag_log('painter', 'important', 'PAINTER', 'failed to import painter document', { error: e instanceof Error ? e.message : String(e) }, { sink: 'error' });
      }
    },
    
    clear_canvas: () => {
      if (clear_active_group_authored_voxels()) {
        painterImportant('active group cleared via legacy clear_canvas surface', { active_group_id: resolve_current_runtime_group_id() });
        schedule_auto_save();
      }
    },

    save_to_file: (filename?: string) => {
      void (async () => {
        if (filename) {
          const dir = await getAsciiDrawingsDir();
          if (dir) {
            const base = filename.endsWith('.json') ? filename : `${filename}.json`;
            setActiveFileAssociation(`${dir}\\${base}`);
          }
        }
        await save_file();
      })().catch((e) => {
        diag_log('painter', 'important', 'PAINTER', 'save failed', { error: e instanceof Error ? e.message : String(e) }, { sink: 'error' });
      });
    },

    load_from_file: async (file: File) => {
      try {
        const content = await readFileAsText(file);
        await loadArtworkFromContent(content);
        clearActiveFileAssociation(file.name.replace(/\.json$/i, ''), { clearLastUsed: true });
        painterImportant('loaded file', { filename: current_filename });
        painterDiag('loaded voxel space', { summary: debugVoxelSpace(voxelSpace) });
        schedule_auto_save();
      } catch (e) {
        diag_log('painter', 'important', 'PAINTER', 'failed to load file', { error: e instanceof Error ? e.message : String(e) }, { sink: 'error' });
        alert('Failed to load file: ' + (e as Error).message);
      }
    },

    export_as_text: () => {
      return exportCurrentPainterDocumentText();
    },
    start_from_launch_intent,
    get_interaction_adapters: () => painter_interaction_adapters,
    get_interaction_hover_state: () => painter_interaction_hover_state,
    get_interaction_session_state: () => painter_interaction_session_state,

    new_canvas: (width: number, height: number) => {
      const document = create_painter_document(width, height, { min_z: 0, max_z: 0, default_group_name: 'Group 1' });
      applyPainterDocumentSnapshot(document);
      setCurrentPainterDocumentLineage(`memory:new_canvas:${Date.now()}`, 'new_canvas');
      clearActiveFileAssociation('untitled', { clearLastUsed: true });
      clearAutoSave();
      painterImportant('new canvas created', { width, height, group_count: painter_document_runtime.document.group_order.length });
    },

    current_filename,
    
    // Document operations
    export_document: () => {
      return exportPainterDocumentToJSON(exportCurrentPainterDocument());
    },

    set_camera_mode: (_mode: CameraMode) => {
      painter_camera_state.mode = 'rotated_ortho';
      syncVoxelSpaceCameraFromPainterCamera();
    },
    
    set_parallax_intensity: (intensity: number) => {
      painter_camera_state.parallax_intensity = Math.max(0, Math.min(1, intensity));
      syncVoxelSpaceCameraFromPainterCamera();
    },
    
    toggle_show_all_layers: () => {
      painter_camera_state.use_focus_layer_opacity = !painter_camera_state.use_focus_layer_opacity;
      syncVoxelSpaceCameraFromPainterCamera();
      applyPainterProjectedCameraTuning();
    },
    
    // Group operations
    add_group: () => {
      addPainterGroup();
    },
    
    delete_group: (group_id: string) => {
      deletePainterGroup(group_id);
    },
    
    duplicate_group: (group_id: string) => {
      duplicatePainterGroup(group_id);
    },
    
    select_group: (group_id: string) => {
      selectPainterGroup(group_id);
    },
    
    toggle_group_visibility: (group_id: string) => {
      togglePainterGroupVisibility(group_id);
    },
    
    toggle_group_lock: (group_id: string) => {
      togglePainterGroupLock(group_id);
    },

    // DOM Renderer operations
    init_dom_renderer: () => {
      initDOMRenderer();
    },

    render_dom_layers: () => {
      if (!domRenderer || !isPainterDomRootConnected(document.getElementById('voxel_layers_container'))) {
        initDOMRenderer();
      }
      if (domRenderer) {
        const targetViewBefore = getPainterViewState();
        const displayViewBefore = getPainterDisplayViewState();
        commitProjectedGridToWorld();
        const resolved = resolve_place_view_transition_frame({
          target_view: targetViewBefore,
          hard_view: displayViewBefore,
          transition: painter_view_transition,
          now_ms: performance.now(),
        });
        const next = resolved.target_view;
        const viewChanged = next.principal_view !== targetViewBefore.principal_view || next.roll_quarter_turn !== targetViewBefore.roll_quarter_turn;
        setPainterTargetViewState(next);
        setPainterDisplayViewState(resolved.hard_view);
        syncCompatibilityFocusPlaneFromCameraTarget(resolved.hard_view);
        syncPainterCameraViewTransform(resolved.hard_view);
        voxelSpace.camera.transition_euler = resolved.frame.euler;
        const interactionAnchor = painter_transition_anchor?.anchor ?? getPainterStableViewAnchor();
        const transitionTargetWorld = painter_transition_anchor?.target_world ?? getPainterCanvasFrameAnchorWorld();
        const transitionProjectionAnchorWorld = painter_transition_anchor?.projection_anchor_world ?? transitionTargetWorld;
        painter_display_projection = rebuildPainterDisplayProjection(resolved.hard_view, interactionAnchor, {
          persist_target_world: false,
          target_world: transitionTargetWorld,
          projection_anchor_world: transitionProjectionAnchorWorld,
        });
        syncProjectedGridFromDisplay();
        const pivotPx = painter_transition_anchor?.visual_pivot_px ?? getPainterAnchorPivotPx(interactionAnchor);
        const mouseParallax = getPainterAnchorParallax(interactionAnchor, resolved.frame.active);
        active_transition_visual = {
          active: resolved.frame.active,
          transition_euler: { ...resolved.frame.euler },
          visual_pivot_px: pivotPx ? { ...pivotPx } : null,
        };
        applyPainterProjectedCameraTuning({
          transition_euler: voxelSpace.camera.transition_euler,
          visual_pivot_px: pivotPx,
        });
        domRenderer.setProjectedScene(getPainterRenderScene());
        domRenderer.setMouseParallax(mouseParallax.x, mouseParallax.y);
        painter_view_transition = resolved.transition;
        if (!resolved.frame.active) {
          painter_transition_anchor = null;
        }
        if (viewChanged && isAppInitialized) {
          persistPainterCameraConfig({ principal_view: painter_target_view.principal_view, roll_quarter_turn: painter_target_view.roll_quarter_turn });
        }
        touch_world_layers_owner('painter');
        domRenderer.render();
      }
    },

    set_mouse_parallax: (x: number, y: number) => {
      if (domRenderer) {
        domRenderer.setMouseParallax(x, y);
      }
    },

    set_dom_viewport: (viewport: {
      x: number;
      y: number;
      width: number;
      height: number;
      tileW?: number;
      tileH?: number;
      fontSizePx?: number;
      offsetX?: number;
      offsetY?: number;
    }) => {
      dom_viewport = { ...viewport };
      if (domRenderer) {
        domRenderer.setViewport(viewport);
      }
    },

    // Debug function to check camera persistence
    debug_camera_config: () => {
      const config = getSavedPainterCameraConfig();
      painterCameraDiag('debug camera config', { config, voxel_camera: voxelSpace.camera, isAppInitialized });
      return config;
    },

    // Force save camera config
    force_save_camera: () => {
      persistPainterCameraConfig({
        calibration: voxelSpace.camera.calibration,
        principal_view: voxelSpace.camera.principal_view,
        roll_quarter_turn: voxelSpace.camera.roll_quarter_turn,
        scale_per_layer: voxelSpace.camera.scale_per_layer,
        movement_per_layer: voxelSpace.camera.movement_per_layer,
        mouse_angle_yaw_deg: voxelSpace.camera.mouse_angle_yaw_deg,
        mouse_angle_pitch_deg: voxelSpace.camera.mouse_angle_pitch_deg,
        mouse_angle_spring: voxelSpace.camera.mouse_angle_spring,
        render_distance_planes: voxelSpace.camera.render_distance_planes,
        parallax_move_enabled: voxelSpace.camera.parallax_move_enabled,
        parallax_size_enabled: voxelSpace.camera.parallax_size_enabled,
        use_focus_layer_opacity: voxelSpace.camera.use_focus_layer_opacity,
      });
      painterCameraDiag('force saved camera config');
    },
  };
}
