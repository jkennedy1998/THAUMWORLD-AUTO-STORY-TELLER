/**
 * ASCII Painter App State
 * 
 * Creates the module graph for the immersive ASCII painter.
 * Uses the mono_ui module system with panning, zooming, and drawing tools.
 */

import type { Module, Rect, Rgb } from '../mono_ui/types.js';
import { create_module_registry, type ModuleRegistry } from '../mono_ui/module_registry.js';
import type { Grid, Brush, ToolType, GridCell } from '../ascii_painter/types.js';
import { createGrid, exportGrid, importGrid } from '../ascii_painter/types.js';
import { createHistoryManager, logCellAction, logGroupAction, clearHistory, canUndo, canRedo, getHistoryState, type HistoryAction, type HistoryManager } from '../ascii_painter/history.js';
import { get_color_by_name } from '../mono_ui/colors.js';
import type { SelectionMode } from '../ascii_painter/selection.js';
import { clearSelection, createSelectionBitmap, invertSelection, isSelected, selectAll, setSelected, type SelectionBitmap } from '../ascii_painter/selection.js';
import { make_painter_canvas_module, type PainterInteractionAnchor } from '../mono_ui/modules/painter_canvas_module.js';
import { make_file_menu_module } from '../mono_ui/modules/painter_file_menu_module.js';
import { make_character_selector_module } from '../mono_ui/modules/character_selector_module.js';
import { make_brush_preview_module } from '../mono_ui/modules/brush_preview_module.js';
import { make_color_selector_module } from '../mono_ui/modules/color_selector_module.js';
import { make_weight_selector_module } from '../mono_ui/modules/weight_selector_module.js';
import { make_toolbox_module } from '../mono_ui/modules/toolbox_module.js';
import { make_tool_properties_module, type ToolPropertyRow } from '../mono_ui/modules/tool_properties_module.js';
import { make_controls_module } from '../mono_ui/modules/controls_module.js';
import {
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
  saveCameraConfig,
  loadPainterCameraConfig as loadCameraConfig,
  savePainterCameraCalibration,
  clearCameraConfig,
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
import { makeLayerPaletteModule, type LayerPaletteRow } from '../ascii_painter/layer_palette_module.js';
import { make_navigation_module } from '../ascii_painter/navigation_module.js';
import { build_legacy_voxel_space_from_painter_runtime, import_legacy_voxel_space_as_painter_document } from '../ascii_painter/painter_document_legacy_adapter.js';
import { create_painter_document, create_painter_group, create_painter_voxel_record, type PainterDocument } from '../ascii_painter/painter_document.js';
import { add_painter_group, duplicate_painter_group, erase_group_voxel, export_painter_document, normalize_painter_document_runtime, remove_painter_group, rename_painter_group, reorder_painter_groups, set_group_voxel, set_painter_group_locked, set_painter_group_visibility, type PainterDocumentRuntime } from '../ascii_painter/painter_document_runtime.js';
import { resolve_edit_channels_with_modifiers, type EditChannels } from '../ascii_painter/edit_mask.js';
import { diag_log } from '../shared/diagnostics.js';

function normalize_painter_tool(tool: ToolType): ToolType {
  return tool;
}
import { makePlaceCameraControlModule } from '../mono_ui/modules/place_camera_control_module.js';
import { VoxelDOMRenderer, createVoxelDOMRenderer } from '../ascii_painter/voxel_dom_renderer.js';
import { commit_grid_to_painter_world, get_painter_focus_slot_for_anchor, get_painter_projection_focus_content_bounds, get_painter_world_content_bounds_center, painter_projection_grid_point_to_world, painter_projection_world_to_grid_point, project_painter_display_space, project_painter_runtime_display_space, project_world_to_painter_display_cell, sync_grid_to_painter_projection, type PainterDisplayProjection } from '../ascii_painter/painter_view_projection_adapter.js';
import { touch_world_layers_owner } from '../mono_ui/world_layers_owner.js';
import { get_principal_view_plane_axis, get_transition_tilt_for_command, make_place_view_state, type PlaceViewState } from '../mono_ui/runtime/place_view_projection.js';
import { start_roll_transition, start_swing_transition, type PlaceCameraTransition } from '../mono_ui/runtime/place_camera_pose.js';
import { clamp_anchor_to_viewport_px, compute_anchor_relative_mouse_parallax } from '../mono_ui/runtime/camera_anchor_runtime.js';
import { resolve_place_view_transition_frame } from '../mono_ui/runtime/place_view_camera_runtime.js';
import { apply_world_selection_mode, clear_world_selection, create_world_selection, decode_world_copy_data, encode_world_copy_data, get_world_selection_bounds, has_world_selection, parse_world_cell_key, set_world_selected, type WorldCopyData, type WorldSelection } from '../ascii_painter/world_selection.js';
import { project_world_point_with_roll, unproject_plane_point_with_roll } from '../mono_ui/runtime/place_view_projection.js';
import { create_painter_controls_runtime } from './controls_wiring.js';
import { control_binding_matches_keyboard_event } from '../mono_ui/runtime/controls_binding_matcher.js';
import { create_painter_tool_shortcut_interpreter } from './painter_tool_shortcut_interpreter.js';
import { create_painter_sync_client } from './painter_sync_client.js';
import { PAINTER_APP_CONFIG } from './painter_runtime_config.js';

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

  // Grid operations (legacy - operates on current layer)
  export_grid: () => string;
  import_grid: (json: string) => void;
  clear_canvas: () => void;

  // Document operations
  export_document: () => string;
  import_legacy_voxel_space: (json: string) => void;
  get_legacy_voxel_space: () => VoxelSpace;
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
  current_filename: string;
  multiplayer_sync: ReturnType<typeof create_painter_sync_client>;
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
  group_ids_by_legacy_z: Map<number, string>;
  group_order: string[];
  active_group_id: string | null;
};

type PainterGroupPlaneRegistry = {
  group_id_to_plane: Map<string, number>;
  plane_to_group_id: Map<number, string>;
};

function create_legacy_painter_group_id(): string {
  return `painter_group_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function create_painter_app_state(): PainterAppState {
  if (is_tai_fresh_state_enabled()) {
    clearAutoSave();
    clearToolProperties();
    clearCameraConfig();
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
    api_base_url: PAINTER_APP_CONFIG.api_base_url,
    websocket_port: PAINTER_APP_CONFIG.websocket_port,
    reconnect_token_storage_key: PAINTER_APP_CONFIG.reconnect_token_storage_key,
  });
  void painter_sync.bootstrap().then((sync_state) => {
    painterImportant('painter authority ready', {
      authority_mode: sync_state.authority_mode,
      lifecycle: sync_state.lifecycle,
      slot: PAINTER_APP_CONFIG.selected_data_slot,
    });
  });

  // Create the drawing grid (legacy 2D)
  const grid = createGrid(CANVAS_WIDTH, CANVAS_HEIGHT);
  
  // Create VoxelSpace (new 3D system) - wraps the grid
  let voxelSpace = createVoxelSpace(CANVAS_WIDTH, CANVAS_HEIGHT, { defaultZ: 0 });
  let painter_document_runtime: PainterDocumentRuntime = normalize_painter_document_runtime(import_legacy_voxel_space_as_painter_document(voxelSpace));
  let last_projection_runtime_log_signature = '';
  const world_selection: WorldSelection = create_world_selection();
  let world_clipboard_data: WorldCopyData | null = null;
  let legacy_group_compat: LegacyPainterGroupCompatState = {
    group_ids_by_legacy_z: new Map<number, string>(),
    group_order: [],
    active_group_id: null,
  };
  let runtime_group_planes: PainterGroupPlaneRegistry = {
    group_id_to_plane: new Map<string, number>(),
    plane_to_group_id: new Map<number, string>(),
  };

  function get_group_id_for_legacy_z(z: number): string | null {
    return runtime_group_planes.plane_to_group_id.get(z) ?? null;
  }

  function get_legacy_group_planes(): number[] {
    return Array.from(runtime_group_planes.plane_to_group_id.keys()).sort((a, b) => a - b);
  }

  function get_legacy_z_for_group_id(group_id: string | null | undefined): number | null {
    if (!group_id) return null;
    return runtime_group_planes.group_id_to_plane.get(group_id) ?? null;
  }

  function rebuild_runtime_group_plane_registry(options?: { preserve_existing?: boolean }): void {
    const preserve_existing = options?.preserve_existing ?? true;
    const discovered_ids = [...painter_document_runtime.document.group_order].filter((group_id) => !!painter_document_runtime.document.groups[group_id]);
    const preserved = preserve_existing
      ? new Map(runtime_group_planes.group_id_to_plane)
      : new Map<string, number>();
    const next_group_id_to_plane = new Map<string, number>();
    const used_planes = new Set<number>();
    for (const group_id of discovered_ids) {
      const priorPlane = preserved.get(group_id);
      if (typeof priorPlane === 'number' && !used_planes.has(priorPlane)) {
        next_group_id_to_plane.set(group_id, priorPlane);
        used_planes.add(priorPlane);
      }
    }
    let nextPlane = used_planes.size > 0 ? Math.max(...Array.from(used_planes)) + 1 : 0;
    for (const group_id of discovered_ids) {
      if (next_group_id_to_plane.has(group_id)) continue;
      while (used_planes.has(nextPlane)) nextPlane += 1;
      next_group_id_to_plane.set(group_id, nextPlane);
      used_planes.add(nextPlane);
      nextPlane += 1;
    }
    runtime_group_planes = {
      group_id_to_plane: next_group_id_to_plane,
      plane_to_group_id: new Map(Array.from(next_group_id_to_plane.entries(), ([group_id, plane]) => [plane, group_id])),
    };
  }

  function get_runtime_group_planes(): number[] {
    return Array.from(runtime_group_planes.plane_to_group_id.keys()).sort((a, b) => a - b);
  }

  function get_nearest_runtime_group_plane(plane: number): number | null {
    const planes = get_runtime_group_planes();
    if (planes.length < 1) return null;
    return planes.reduce((best, candidate) => (
      Math.abs(candidate - plane) < Math.abs(best - plane) ? candidate : best
    ), planes[0]!);
  }

  function getPainterFocusPlaneAxis(viewState?: PlaceViewState): 'x' | 'y' | 'z' {
    const resolvedViewState = viewState ?? make_place_view_state(voxelSpace.camera.principal_view, voxelSpace.camera.roll_quarter_turn);
    return get_principal_view_plane_axis(resolvedViewState.principal_view);
  }

  function sync_active_group_to_focus_plane(): void {
    if (getPainterFocusPlaneAxis() !== 'z') {
      if (!legacy_group_compat.active_group_id || !legacy_group_compat.group_order.includes(legacy_group_compat.active_group_id)) {
        legacy_group_compat.active_group_id = legacy_group_compat.group_order[0] ?? null;
      }
      return;
    }
    const from_focus = get_group_id_for_legacy_z(getCurrentFocusWorldPlane());
    if (from_focus) {
      legacy_group_compat.active_group_id = from_focus;
      return;
    }
    legacy_group_compat.active_group_id = legacy_group_compat.group_order[0] ?? null;
  }

  function sync_legacy_group_compat_state(options?: { preserve_group_order?: boolean }): void {
    const preserve_group_order = options?.preserve_group_order ?? false;
    const discovered_ids = [...painter_document_runtime.document.group_order].filter((group_id) => !!painter_document_runtime.document.groups[group_id]);
    rebuild_runtime_group_plane_registry({ preserve_existing: true });
    legacy_group_compat.group_ids_by_legacy_z = new Map(Array.from(runtime_group_planes.plane_to_group_id.entries()));
    if (preserve_group_order) {
      const next_order = legacy_group_compat.group_order.filter((group_id) => discovered_ids.includes(group_id));
      for (const group_id of discovered_ids) {
        if (!next_order.includes(group_id)) next_order.push(group_id);
      }
      legacy_group_compat.group_order = next_order;
    } else {
      legacy_group_compat.group_order = discovered_ids;
    }
    if (!legacy_group_compat.active_group_id || !legacy_group_compat.group_order.includes(legacy_group_compat.active_group_id)) {
      sync_active_group_to_focus_plane();
    }
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
      group_ids_by_legacy_z: legacy_group_compat.group_ids_by_legacy_z,
      group_order: preserve_group_order ? legacy_group_compat.group_order : undefined,
      active_group_id: legacy_group_compat.active_group_id,
    });
    painter_document_runtime = normalize_painter_document_runtime(next_document);
    sync_legacy_group_compat_state({ preserve_group_order });
  }

  function syncPainterDocumentCameraFromVoxelCamera(): void {
    painter_document_runtime.document.camera = structuredClone(voxelSpace.camera);
  }

  function rebuild_voxel_space_from_runtime(): void {
    const preferred_active_group_id = legacy_group_compat.active_group_id;
    const preservedCamera = structuredClone(voxelSpace.camera);
    syncPainterDocumentCameraFromVoxelCamera();
    voxelSpace = build_legacy_voxel_space_from_painter_runtime(painter_document_runtime);
    voxelSpace.camera = preservedCamera;
    syncPainterDocumentCameraFromVoxelCamera();
    sync_legacy_group_compat_state({ preserve_group_order: true });
    legacy_group_compat.group_order = painter_document_runtime.document.group_order.filter((group_id) => !!painter_document_runtime.document.groups[group_id]);
    if (preferred_active_group_id && legacy_group_compat.group_order.includes(preferred_active_group_id)) {
      legacy_group_compat.active_group_id = preferred_active_group_id;
    }
    if (legacy_group_compat.active_group_id && !legacy_group_compat.group_order.includes(legacy_group_compat.active_group_id)) {
      legacy_group_compat.active_group_id = legacy_group_compat.group_order[0] ?? null;
    }
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
    kind: 'create_group' | 'delete_group' | 'duplicate_group' | 'rename_group' | 'set_group_visibility' | 'set_group_locked' | 'reorder_groups' | 'reset_document' | 'undo_group' | 'redo_group';
    group_id?: string;
    source_group_id?: string;
    target_group_id?: string;
    group_name?: string;
    visible?: boolean;
    locked?: boolean;
    next_group_order?: string[];
  }): void {
    if (painter_sync.get_state().authority_mode !== 'authoritative_host') return;
    void painter_sync.submit_group_command(command).catch((error) => {
      diag_log('painter', 'important', 'PAINTER', 'failed to submit painter group command', {
        kind: command.kind,
        error: error instanceof Error ? error.message : String(error),
      }, { sink: 'warn' });
    });
  }

  function clear_current_anchor_cell(): boolean {
    const anchorWorld = getPainterInteractionAnchor().world;
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
    if (painter_sync.get_state().authority_mode === 'authoritative_host') {
      void painter_sync.submit_cell_changes(active_group_id, changes.map((change) => ({
        x: change.worldX,
        y: change.worldY,
        z: change.worldZ,
        cell: {
          char: change.newCell.char,
          rgb: { ...change.newCell.rgb },
          weight_index: change.newCell.weight_index,
        },
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
      case 'reorder_groups': {
        const nextOrder = useOld ? action.oldGroupOrder : action.newGroupOrder;
        if (nextOrder) reorder_painter_groups(painter_document_runtime, nextOrder);
        break;
      }
      default:
        return false;
    }
    rebuild_voxel_space_from_runtime();
    refreshPainterProjectionFromWorld();
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
    rebuild_voxel_space_from_runtime();
    refreshPainterProjectionFromWorld();
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

  function undo_painter_history(): string | null {
    if (!canUndo(history)) return null;
    const action = history.actions[history.current_index - 1];
    if (!action) return null;
    history.current_index -= 1;
    if (apply_painter_history_action(action, 'undo')) {
      return action.description;
    }
    history.current_index += 1;
    return null;
  }

  function redo_painter_history(): string | null {
    if (!canRedo(history)) return null;
    const action = history.actions[history.current_index];
    if (!action) return null;
    history.current_index += 1;
    if (apply_painter_history_action(action, 'redo')) {
      return action.description;
    }
    history.current_index -= 1;
    return null;
  }

  function performPainterUndo(): string | null {
    const description = undo_painter_history();
    if (description) {
      const action = history.actions[history.current_index];
      const group_id = action?.group_id ?? null;
      if (group_id) submit_group_command_if_authoritative({ kind: 'undo_group', group_id });
      return description;
    }
    return null;
  }

  function performPainterRedo(): string | null {
    const action = history.actions[history.current_index] ?? null;
    const description = redo_painter_history();
    if (description) {
      const group_id = action?.group_id ?? null;
      if (group_id) submit_group_command_if_authoritative({ kind: 'redo_group', group_id });
      return description;
    }
    return null;
  }

  function get_group_history_stats(group_id: string): { current_index: number; total_actions: number } {
    let current_index = 0;
    let total_actions = 0;
    for (let index = 0; index < history.actions.length; index += 1) {
      const action = history.actions[index];
      if (!action) continue;
      const action_group_id = action.group_id ?? action.groupId ?? action.targetGroupId ?? action.sourceGroupId ?? null;
      if (action_group_id !== group_id) continue;
      total_actions += 1;
      if (index < history.current_index) current_index += 1;
    }
    return { current_index, total_actions };
  }

  function make_history_cell_from_runtime_record(record: { char: string; rgb: { r: number; g: number; b: number }; weight_index: number } | null | undefined): { char: string; rgb: { r: number; g: number; b: number }; weight_index: number } {
    if (!record) return { char: ' ', rgb: { r: 0, g: 0, b: 0 }, weight_index: 0 };
    return {
      char: record.char,
      rgb: { ...record.rgb },
      weight_index: record.weight_index,
    };
  }

  function apply_authored_group_cell_changes(changes: Array<{
    worldX: number;
    worldY: number;
    worldZ: number;
    newCell: { char: string; rgb: { r: number; g: number; b: number }; weight_index: number };
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
    const history_changes: Array<{
      x: number;
      y: number;
      worldX: number;
      worldY: number;
      worldZ: number;
      group_id: string;
      oldCell: { char: string; rgb: { r: number; g: number; b: number }; weight_index: number };
      newCell: { char: string; rgb: { r: number; g: number; b: number }; weight_index: number };
    }> = [];
    for (const change of changes) {
      const nextChar = String(change.newCell.char ?? ' ').slice(0, 1) || ' ';
      const coordKey = `${Math.floor(change.worldX)}:${Math.floor(change.worldY)}:${Math.floor(change.worldZ)}`;
      const prior = painter_document_runtime.group_voxel_index.get(active_group_id)?.get(coordKey) ?? null;
      const oldCell = make_history_cell_from_runtime_record(prior);
      const nextCell = make_history_cell_from_runtime_record({
        char: nextChar,
        rgb: { ...change.newCell.rgb },
        weight_index: change.newCell.weight_index,
      });
      if (nextChar === ' ') {
        erase_group_voxel(painter_document_runtime, active_group_id, coordKey);
      } else {
        set_group_voxel(painter_document_runtime, active_group_id, create_painter_voxel_record({
          x: change.worldX,
          y: change.worldY,
          z: change.worldZ,
          char: nextChar,
          rgb: { ...change.newCell.rgb },
          weight_index: change.newCell.weight_index,
        }));
      }
      history_changes.push({
        x: change.worldX,
        y: change.worldY,
        worldX: change.worldX,
        worldY: change.worldY,
        worldZ: change.worldZ,
        group_id: active_group_id,
        oldCell,
        newCell: nextCell,
      });
    }
    rebuild_voxel_space_from_runtime();
    if (options?.log_history !== false && history_changes.length > 0) {
      logCellAction(history, 'draw_cells', `Group ${active_group_id} edit`, { group_id: active_group_id }, history_changes);
    }
    painterDiag('applied authored group cell changes', {
      active_group_id,
      change_count: changes.length,
      occupied_bounds: painter_document_runtime.document.occupied_bounds,
      history_size: history.actions.length,
    });
    log_runtime_summary('authored group cell changes applied summary');
    return true;
  }

  function get_palette_group_entries(): Array<{ group_id: string; legacy_z: number; fake_z: number; layer: VoxelLayer }> {
    const entries: Array<{ group_id: string; legacy_z: number; fake_z: number; layer: VoxelLayer }> = [];
    const count = legacy_group_compat.group_order.length;
    for (let index = 0; index < count; index += 1) {
      const group_id = legacy_group_compat.group_order[index]!;
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

  function get_active_group_legacy_z(): number | null {
    return get_legacy_z_for_group_id(legacy_group_compat.active_group_id) ?? getCurrentFocusWorldPlane();
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
    for (const key of world_selection.cells) {
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
    const points: Array<{ x: number; y: number; z: number; cell: { char: string; rgb: { r: number; g: number; b: number }; weight_index: number } }> = [];
    for (const key of active_group_selection.cells) {
      const point = parse_world_cell_key(key);
      const coordKey = `${point.x}:${point.y}:${point.z}`;
      const record = groupIndex.get(coordKey);
      if (!record) continue;
      points.push({
        x: point.x,
        y: point.y,
        z: point.z,
        cell: {
          char: record.char,
          rgb: { ...record.rgb },
          weight_index: record.weight_index,
        },
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
      cells: points.map((point) => ({
        dx: point.x - anchor.x,
        dy: point.y - anchor.y,
        dz: point.z - anchor.z,
        cell: {
          char: point.cell.char,
          rgb: { ...point.cell.rgb },
          weight_index: point.cell.weight_index,
        },
      })),
    };
  }

  function getPaletteGroupRows(): LayerPaletteRow[] {
    return get_palette_group_entries().map((entry) => ({
      z: entry.fake_z,
      name: entry.layer.name,
      visible: entry.layer.visible,
      locked: entry.layer.locked,
    }));
  }

  const PAINTER_CAMERA_LIMITS = {
    movement_per_layer: { min: -12, max: 12 },
    scale_per_layer: { min: -0.04, max: 0.04 },
    mouse_angle_yaw_deg: { min: -10, max: 10 },
    mouse_angle_pitch_deg: { min: -8, max: 8 },
    mouse_angle_spring: { min: 4, max: 20 },
    render_distance_planes: { min: 0, max: 8 },
    calibration: { min: -80, max: 80 },
  } as const;

  function clampPainterCameraScalar(value: number, limits: { min: number; max: number }): number {
    return Math.max(limits.min, Math.min(limits.max, value));
  }

  function sanitizePainterCameraConfig(config: Partial<typeof voxelSpace.camera> | null | undefined): Partial<typeof voxelSpace.camera> {
    if (!config) return {};
    const next: Partial<typeof voxelSpace.camera> = { ...config };
    if (typeof next.movement_per_layer === 'number') {
      next.movement_per_layer = clampPainterCameraScalar(next.movement_per_layer, PAINTER_CAMERA_LIMITS.movement_per_layer);
    }
    if (typeof next.scale_per_layer === 'number') {
      next.scale_per_layer = clampPainterCameraScalar(next.scale_per_layer, PAINTER_CAMERA_LIMITS.scale_per_layer);
    }
    if (typeof next.mouse_angle_yaw_deg === 'number') {
      next.mouse_angle_yaw_deg = clampPainterCameraScalar(next.mouse_angle_yaw_deg, PAINTER_CAMERA_LIMITS.mouse_angle_yaw_deg);
    }
    if (typeof next.mouse_angle_pitch_deg === 'number') {
      next.mouse_angle_pitch_deg = clampPainterCameraScalar(next.mouse_angle_pitch_deg, PAINTER_CAMERA_LIMITS.mouse_angle_pitch_deg);
    }
    if (typeof next.mouse_angle_spring === 'number') {
      next.mouse_angle_spring = clampPainterCameraScalar(next.mouse_angle_spring, PAINTER_CAMERA_LIMITS.mouse_angle_spring);
    }
    if (typeof next.render_distance_planes === 'number') {
      next.render_distance_planes = Math.round(clampPainterCameraScalar(next.render_distance_planes, PAINTER_CAMERA_LIMITS.render_distance_planes));
    }
    if (next.calibration) {
      next.calibration = {
        x: clampPainterCameraScalar(Math.round(next.calibration.x ?? 0), PAINTER_CAMERA_LIMITS.calibration),
        y: clampPainterCameraScalar(Math.round(next.calibration.y ?? 0), PAINTER_CAMERA_LIMITS.calibration),
      };
    }
    // Painter depth stacking should stay grid-faithful by default.
    if (typeof next.parallax_size_enabled === 'boolean' && next.parallax_size_enabled) {
      next.parallax_size_enabled = false;
    }
    return next;
  }

  function getEffectivePainterCameraForProjection(): typeof voxelSpace.camera {
    return {
      ...voxelSpace.camera,
      movement_per_layer: clampPainterCameraScalar(voxelSpace.camera.movement_per_layer ?? 0, PAINTER_CAMERA_LIMITS.movement_per_layer),
      scale_per_layer: clampPainterCameraScalar(voxelSpace.camera.scale_per_layer ?? 0, PAINTER_CAMERA_LIMITS.scale_per_layer),
      mouse_angle_yaw_deg: clampPainterCameraScalar(voxelSpace.camera.mouse_angle_yaw_deg ?? 0, PAINTER_CAMERA_LIMITS.mouse_angle_yaw_deg),
      mouse_angle_pitch_deg: clampPainterCameraScalar(voxelSpace.camera.mouse_angle_pitch_deg ?? 0, PAINTER_CAMERA_LIMITS.mouse_angle_pitch_deg),
      mouse_angle_spring: clampPainterCameraScalar(voxelSpace.camera.mouse_angle_spring ?? 0, PAINTER_CAMERA_LIMITS.mouse_angle_spring),
      render_distance_planes: Math.round(clampPainterCameraScalar(voxelSpace.camera.render_distance_planes ?? 2, PAINTER_CAMERA_LIMITS.render_distance_planes)),
      calibration: {
        x: clampPainterCameraScalar(Math.round(voxelSpace.camera.calibration?.x ?? 0), PAINTER_CAMERA_LIMITS.calibration),
        y: clampPainterCameraScalar(Math.round(voxelSpace.camera.calibration?.y ?? 0), PAINTER_CAMERA_LIMITS.calibration),
      },
      parallax_size_enabled: false,
    };
  }

  function createSanitizedPainterCamera(overrides?: Partial<typeof voxelSpace.camera> | null | undefined): typeof voxelSpace.camera {
    const base = createDefaultCamera();
    return {
      ...base,
      ...sanitizePainterCameraConfig(base),
      ...(overrides ? sanitizePainterCameraConfig(overrides) : {}),
    };
  }

  let painter_target_view = make_place_view_state(voxelSpace.camera.principal_view, voxelSpace.camera.roll_quarter_turn);
  let painter_display_view = make_place_view_state(voxelSpace.camera.principal_view, voxelSpace.camera.roll_quarter_turn);

  function mergeSavedPainterCameraConfig(config: ReturnType<typeof loadCameraConfig> | null | undefined): void {
    voxelSpace.camera = { ...voxelSpace.camera, ...sanitizePainterCameraConfig(voxelSpace.camera) };
    if (!config || Object.keys(config).length < 1) return;
    voxelSpace.camera = { ...voxelSpace.camera, ...sanitizePainterCameraConfig(config) };
    syncPainterViewStatesFromLegacyCamera();
    if (typeof config.use_focus_layer_opacity !== 'boolean' && typeof config.show_all_layers === 'boolean') {
      voxelSpace.camera.use_focus_layer_opacity = !config.show_all_layers;
    }
  }
  
  // Load saved camera configuration
  const savedCameraConfig = loadCameraConfig();
  mergeSavedPainterCameraConfig(savedCameraConfig);
  voxelSpace.camera.mode = 'rotated_ortho';
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
  let painter_camera_target_world = {
    x: painter_document_runtime.document.bounds.minX + Math.floor(painter_document_runtime.document.bounds.width / 2),
    y: painter_document_runtime.document.bounds.minY + Math.floor(painter_document_runtime.document.bounds.height / 2),
    z: painter_document_runtime.document.bounds.minZ,
  };
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
      z: voxelSpace.camera.focus_plane,
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

  let canvas_rect: Rect = get_default_canvas_rect();

  function syncPainterCameraViewStateToLegacyCamera(): void {
    voxelSpace.camera.principal_view = painter_target_view.principal_view;
    voxelSpace.camera.roll_quarter_turn = painter_target_view.roll_quarter_turn;
  }

  function setPainterTargetViewState(viewState: PlaceViewState): void {
    painter_target_view = make_place_view_state(viewState.principal_view, viewState.roll_quarter_turn);
    syncPainterCameraViewStateToLegacyCamera();
  }

  function setPainterDisplayViewState(viewState: PlaceViewState): void {
    painter_display_view = make_place_view_state(viewState.principal_view, viewState.roll_quarter_turn);
  }

  function syncPainterViewStatesFromLegacyCamera(): void {
    const current = make_place_view_state(voxelSpace.camera.principal_view, voxelSpace.camera.roll_quarter_turn);
    setPainterTargetViewState(current);
    setPainterDisplayViewState(current);
  }

  function getPainterViewState(): PlaceViewState {
    return painter_target_view;
  }

  function getPainterDisplayViewState(): PlaceViewState {
    return painter_display_view;
  }

  function getPainterInteractionAnchor(): PainterInteractionAnchor {
    const canvasWithAnchor = canvas_module as typeof canvas_module & { getInteractionAnchor?: () => PainterInteractionAnchor };
    return canvasWithAnchor.getInteractionAnchor?.() ?? { kind: 'viewport_center', screen: null, world: null };
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

  function getPainterFallbackTargetWorld(): { x: number; y: number; z: number } {
    const bounds = getPainterDocumentBounds();
    const axis = getPainterFocusPlaneAxis(getPainterDisplayViewState());
    const fallbackZ = getPainterCameraTargetPlaneCoordinate(getPainterDisplayViewState());
    return {
      x: Math.max(bounds.minX, Math.min(bounds.minX + bounds.width - 1, painter_camera_target_world.x)),
      y: Math.max(bounds.minY, Math.min(bounds.minY + bounds.height - 1, painter_camera_target_world.y)),
      z: axis === 'z'
        ? Math.floor(Number.isFinite(painter_camera_target_world.z) ? painter_camera_target_world.z : fallbackZ)
        : Math.max(bounds.minZ, Math.min(bounds.maxZ, Number.isFinite(painter_camera_target_world.z) ? painter_camera_target_world.z : fallbackZ)),
    };
  }

  function clampPainterWorldToDocument(world: { x: number; y: number; z: number }, viewState: PlaceViewState = getPainterDisplayViewState()): { x: number; y: number; z: number } {
    const bounds = getPainterDocumentBounds();
    const axis = getPainterFocusPlaneAxis(viewState);
    return {
      x: Math.max(bounds.minX, Math.min(bounds.minX + bounds.width - 1, Math.floor(world.x))),
      y: Math.max(bounds.minY, Math.min(bounds.minY + bounds.height - 1, Math.floor(world.y))),
      z: axis === 'z'
        ? Math.floor(world.z)
        : Math.max(bounds.minZ, Math.min(bounds.maxZ, Math.floor(world.z))),
    };
  }

  function setPainterCameraTargetWorld(world: { x: number; y: number; z: number } | null | undefined): void {
    if (!world) return;
    painter_camera_target_world = clampPainterWorldToDocument(world);
  }

  function getCurrentFocusWorldPlane(): number {
    return getPainterCameraTargetPlaneCoordinate();
  }

  function setPainterCameraTargetPlaneCoordinate(plane: number, viewState: PlaceViewState = getPainterViewState()): void {
    const nextPlane = Math.floor(plane);
    const axis = get_principal_view_plane_axis(viewState.principal_view);
    if (axis === 'x') {
      painter_camera_target_world = { ...painter_camera_target_world, x: nextPlane };
      return;
    }
    if (axis === 'y') {
      painter_camera_target_world = { ...painter_camera_target_world, y: nextPlane };
      return;
    }
    painter_camera_target_world = { ...painter_camera_target_world, z: nextPlane };
  }

  function getPainterCameraTargetPlaneCoordinate(viewState: PlaceViewState = getPainterDisplayViewState()): number {
    const axis = get_principal_view_plane_axis(viewState.principal_view);
    if (axis === 'x') return Math.floor(painter_camera_target_world.x);
    if (axis === 'y') return Math.floor(painter_camera_target_world.y);
    return Math.floor(painter_camera_target_world.z);
  }

  function syncCompatibilityFocusPlaneFromCameraTarget(viewState: PlaceViewState = getPainterDisplayViewState()): number {
    const plane = getPainterCameraTargetPlaneCoordinate(viewState);
    voxelSpace.camera.focus_plane = plane;
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
    painter_display_projection.space.camera.focus_plane = focus.focus_slot;
  }

  function setCurrentFocusWorldPlane(worldPlane: number, options?: { persist?: boolean }): void {
    const nextPlane = Math.floor(worldPlane);
    setPainterCameraTargetPlaneCoordinate(nextPlane);
    const compatibilityPlane = syncCompatibilityFocusPlaneFromCameraTarget();
    applyFocusWorldPlaneToProjection(compatibilityPlane);
    if (options?.persist && isAppInitialized) {
      saveCameraConfig({ focus_plane: compatibilityPlane });
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
    voxelSpace.camera.mode = 'rotated_ortho';
    voxelSpace.camera.pan_x = 0;
    voxelSpace.camera.pan_y = 0;
    voxelSpace.camera.euler_rotation = { x: 0, y: 0, z: 0 };
  }

  function getCurrentPainterFocusSlot(): number {
    return painter_display_projection?.focus_slot ?? 0;
  }

  function shouldCenterPainterTarget(anchor: PainterInteractionAnchor): boolean {
    if (!(voxelSpace.camera.center_target_in_view ?? false)) return false;
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
    if (options?.persist_target_world !== false) {
      setPainterCameraTargetWorld(requestedTargetWorld);
    }
    const targetWorld = requestedTargetWorld
      ? clampPainterWorldToDocument(requestedTargetWorld)
      : getPainterFallbackTargetWorld();
    const projectionAnchorWorld = options?.projection_anchor_world
      ? clampPainterWorldToDocument(options.projection_anchor_world)
      : targetWorld;
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
      fallback_world_plane: getPainterCameraTargetPlaneCoordinate(viewState),
    });
    projected.focus_slot = focus.focus_slot;
    projected.focus_world_plane = focus.focus_world_plane;
    projected.space.camera.focus_plane = focus.focus_slot;
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
    const projectedCamera = painter_display_projection.space.camera;
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
      ?? voxelSpace.camera.transition_euler
      ?? { x: 0, y: 0, z: 0 };
    (projectedCamera as any).transition_euler = { ...nextTransitionEuler };
    const nextVisualPivot = args?.visual_pivot_px === undefined
      ? (active_transition_visual.active ? active_transition_visual.visual_pivot_px : getPainterAnchorPivotPx(getPainterInteractionAnchor()))
      : args.visual_pivot_px;
    if (nextVisualPivot) {
      (projectedCamera as any).visual_pivot_px = { ...nextVisualPivot };
    } else {
      delete (projectedCamera as any).visual_pivot_px;
    }
    const focusSlot = painter_display_projection.focus_slot;
    projectedCamera.focus_plane = focusSlot;
    for (const [slot, layer] of painter_display_projection.space.layers.entries()) {
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
    target_world: getPainterFallbackTargetWorld(),
    projection_anchor_world: getPainterFallbackTargetWorld(),
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
      world: getPainterFallbackTargetWorld(),
    };
  }

  function refreshPainterProjectionPreservingCurrentTarget(): void {
    const targetWorld = getPainterFallbackTargetWorld();
    refreshPainterProjectionFromWorld(getPainterStableViewAnchor(), {
      persist_target_world: false,
      target_world: targetWorld,
      projection_anchor_world: targetWorld,
    });
  }

  function createNextPainterGroupName(): string {
    return `Group ${painter_document_runtime.document.group_order.length + 1}`;
  }

  function focusActiveGroupPlane(): void {
    if (getPainterFocusPlaneAxis() !== 'z') return;
    sync_legacy_group_compat_state({ preserve_group_order: true });
    const selectedZ = get_active_group_legacy_z();
    if (selectedZ !== null) {
      setCurrentFocusWorldPlane(selectedZ, { persist: true });
    }
  }

  function addPainterGroupStructure(): void {
    finalizePendingPainterCanvasChanges();
    commitProjectedGridToWorld();
    const created = add_painter_group(painter_document_runtime, create_painter_group(createNextPainterGroupName()));
    rebuild_runtime_group_plane_registry({ preserve_existing: true });
    logGroupAction(history, 'create_group', `Create Group ${created.name}`, {
      groupId: created.id,
      newGroupData: created,
    });
    submit_group_command_if_authoritative({ kind: 'create_group', group_name: created.name, target_group_id: created.id });
    legacy_group_compat.active_group_id = created.id;
    rebuild_voxel_space_from_runtime();
    focusActiveGroupPlane();
    ensureValidFocusPlane();
    refreshPainterProjectionFromWorld();
    schedule_auto_save();
    painterImportant('group added', { group_id: created.id, name: created.name });
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
    remove_painter_group(painter_document_runtime, entry.group_id);
    rebuild_runtime_group_plane_registry({ preserve_existing: true });
    logGroupAction(history, 'delete_group', `Delete Group ${oldGroupData?.name ?? entry.group_id}`, {
      groupId: entry.group_id,
      oldGroupData,
    });
    submit_group_command_if_authoritative({ kind: 'delete_group', group_id: entry.group_id });
    if (legacy_group_compat.active_group_id === entry.group_id) {
      legacy_group_compat.active_group_id = painter_document_runtime.document.group_order[0] ?? null;
    }
    rebuild_voxel_space_from_runtime();
    focusActiveGroupPlane();
    ensureValidFocusPlane();
    refreshPainterProjectionFromWorld();
    schedule_auto_save();
    painterImportant('group deleted', { group_id: entry.group_id, z: entry.legacy_z });
    log_runtime_summary('group deleted summary');
  }

  function duplicatePainterGroupStructure(z: number): void {
    finalizePendingPainterCanvasChanges();
    commitProjectedGridToWorld();
    const entry = get_group_entry_for_palette_z(z);
    if (!entry) return;
    const duplicated = duplicate_painter_group(painter_document_runtime, entry.group_id);
    rebuild_runtime_group_plane_registry({ preserve_existing: true });
    logGroupAction(history, 'duplicate_group', `Duplicate Group ${duplicated.name}`, {
      sourceGroupId: entry.group_id,
      targetGroupId: duplicated.id,
      newGroupData: duplicated,
    });
    submit_group_command_if_authoritative({ kind: 'duplicate_group', source_group_id: entry.group_id, target_group_id: duplicated.id });
    legacy_group_compat.active_group_id = duplicated.id;
    rebuild_voxel_space_from_runtime();
    focusActiveGroupPlane();
    ensureValidFocusPlane();
    refreshPainterProjectionFromWorld();
    schedule_auto_save();
    painterImportant('group duplicated', { source_group_id: entry.group_id, duplicated_group_id: duplicated.id });
    log_runtime_summary('group duplicated summary');
  }

  function addPainterGroup(): void {
    addPainterGroupStructure();
  }

  function deletePainterGroup(group_id: string): void {
    try {
      const fake_z = get_palette_z_for_group_id(group_id);
      if (fake_z === null) return;
      deletePainterGroupStructure(fake_z);
    } catch (e) {
      diag_log('painter', 'important', 'PAINTER', 'cannot delete group', { group_id, error: e instanceof Error ? e.message : String(e) }, { sink: 'error' });
    }
  }

  function duplicatePainterGroup(group_id: string): void {
    const fake_z = get_palette_z_for_group_id(group_id);
    if (fake_z === null) return;
    duplicatePainterGroupStructure(fake_z);
  }

  function selectPainterGroup(group_id: string): void {
    finalizePendingPainterCanvasChanges();
    commitProjectedGridToWorld();
    rebuild_runtime_group_plane_registry({ preserve_existing: true });
    legacy_group_compat.active_group_id = group_id;
    focusActiveGroupPlane();
    ensureValidFocusPlane();
    refreshPainterProjectionFromWorld();
    painterDiag('group selected', { group_id, focus_plane: voxelSpace.camera.focus_plane });
  }

  function togglePainterGroupVisibility(group_id: string): void {
    finalizePendingPainterCanvasChanges();
    commitProjectedGridToWorld();
    const group = painter_document_runtime.document.groups[group_id];
    if (!group) return;
    const oldGroupData = structuredClone(group);
    set_painter_group_visibility(painter_document_runtime, group_id, !group.visible);
    const newGroupData = painter_document_runtime.document.groups[group_id] ? structuredClone(painter_document_runtime.document.groups[group_id]!) : undefined;
    logGroupAction(history, 'set_group_visibility', `Toggle Group Visibility ${group.name}`, {
      groupId: group_id,
      oldGroupData,
      newGroupData,
    });
    submit_group_command_if_authoritative({ kind: 'set_group_visibility', group_id, visible: Boolean(newGroupData?.visible) });
    rebuild_voxel_space_from_runtime();
    refreshPainterProjectionFromWorld();
    schedule_auto_save();
    painterDiag('group visibility toggled', { group_id, visible: Boolean(newGroupData?.visible) });
  }

  function togglePainterGroupLock(group_id: string): void {
    finalizePendingPainterCanvasChanges();
    commitProjectedGridToWorld();
    const group = painter_document_runtime.document.groups[group_id];
    if (!group) return;
    const oldGroupData = structuredClone(group);
    set_painter_group_locked(painter_document_runtime, group_id, !group.locked);
    const newGroupData = painter_document_runtime.document.groups[group_id] ? structuredClone(painter_document_runtime.document.groups[group_id]!) : undefined;
    logGroupAction(history, 'set_group_locked', `Toggle Group Lock ${group.name}`, {
      groupId: group_id,
      oldGroupData,
      newGroupData,
    });
    submit_group_command_if_authoritative({ kind: 'set_group_locked', group_id, locked: Boolean(newGroupData?.locked) });
    rebuild_voxel_space_from_runtime();
    schedule_auto_save();
    painterDiag('group lock toggled', { group_id, locked: Boolean(newGroupData?.locked) });
  }

  function renamePainterGroup(group_id: string, newName: string): void {
    const entry = get_palette_group_entries().find((candidate) => candidate.group_id === group_id) ?? null;
    const group = painter_document_runtime.document.groups[group_id];
    if (!group) return;
    const oldGroupData = structuredClone(group);
    const oldName = group.name;
    rename_painter_group(painter_document_runtime, group_id, newName);
    const newGroupData = painter_document_runtime.document.groups[group_id] ? structuredClone(painter_document_runtime.document.groups[group_id]!) : undefined;
    logGroupAction(history, 'rename_group', `Rename Group ${oldName}`, {
      groupId: group_id,
      oldGroupData,
      newGroupData,
    });
    submit_group_command_if_authoritative({ kind: 'rename_group', group_id, group_name: newName });
    rebuild_voxel_space_from_runtime();
    schedule_auto_save();
    painterImportant('group renamed', { group_id, legacy_z: entry?.legacy_z ?? null, old_name: oldName, new_name: newName });
  }

  function reorderPainterGroups(next_group_order: string[]): void {
    if (next_group_order.length < 1) return;
    const oldGroupOrder = [...painter_document_runtime.document.group_order];
    reorder_painter_groups(painter_document_runtime, next_group_order);
    logGroupAction(history, 'reorder_groups', 'Reorder Groups', {
      oldGroupOrder,
      newGroupOrder: [...painter_document_runtime.document.group_order],
    });
    submit_group_command_if_authoritative({ kind: 'reorder_groups', next_group_order: [...painter_document_runtime.document.group_order] });
    legacy_group_compat.group_order = [...painter_document_runtime.document.group_order];
    rebuild_voxel_space_from_runtime();
    schedule_auto_save();
    painterDiag('reordered groups without mutating world z', {
      next_group_order,
      focus_plane: voxelSpace.camera.focus_plane,
      active_group_id: legacy_group_compat.active_group_id,
    });
    log_runtime_summary('groups reordered summary');
  }

  function getPainterFocusContentBounds(): { min_x: number; min_y: number; max_x: number; max_y: number } | null {
    if (!painter_display_projection) return null;
    return get_painter_projection_focus_content_bounds(painter_display_projection);
  }

  function getPainterCanvasModuleApi(): (typeof canvas_module & {
    getSelectionBitmap?: () => SelectionBitmap;
    setSelectionBitmap?: (bitmap: SelectionBitmap) => void;
  }) | null {
    return canvas_module as typeof canvas_module & {
      getSelectionBitmap?: () => SelectionBitmap;
      setSelectionBitmap?: (bitmap: SelectionBitmap) => void;
    };
  }

  function deriveProjectedSelectionBitmap(): SelectionBitmap {
    const bitmap = createSelectionBitmap(grid.width, grid.height);
    if (!painter_display_projection) return bitmap;
    for (const key of world_selection.cells) {
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

  function getProjectedSelectionOverlayCells(): Array<{ x: number; y: number; char: string; weight_index: number }> {
    if (!painter_display_projection) return [];
    const byGrid = new Map<string, { x: number; y: number; char: string; weight_index: number; slot: number }>();
    for (const key of world_selection.cells) {
      const [rawX, rawY, rawZ] = key.split(',').map((value) => Number.parseInt(value, 10));
      const x = rawX ?? 0;
      const y = rawY ?? 0;
      const z = rawZ ?? 0;
      const displayCell = project_world_to_painter_display_cell({
        projection: painter_display_projection,
        world: { x, y, z },
      });
      if (!displayCell) continue;
      const cell = getVoxel(voxelSpace, x, y, z);
      if (!cell || cell.char === ' ') continue;
      const key2 = `${displayCell.x},${displayCell.y}`;
      const prev = byGrid.get(key2);
      if (!prev || displayCell.slot >= prev.slot) {
        byGrid.set(key2, { x: displayCell.x, y: displayCell.y, char: cell.char, weight_index: cell.weight_index, slot: displayCell.slot });
      }
    }
    return Array.from(byGrid.values()).map(({ x, y, char, weight_index }) => ({ x, y, char, weight_index }));
  }

  function getPainterSelectionStatus(): string | null {
    if (!has_world_selection(world_selection)) return null;
    const bounds = get_world_selection_bounds(world_selection);
    if (!bounds) return null;
    const depthSpan = (bounds.max_z - bounds.min_z + 1);
    return `SEL ${world_selection.cells.size} vox / DEPTH ${bounds.min_z}->${bounds.max_z} / SPAN ${depthSpan}`;
  }

  function updateWorldSelectionFromProjectedBitmap(mode: SelectionMode, depthRange?: { depthMin?: number; depthMax?: number; kind?: 'rect' | 'lasso' | 'clear' | 'select_all' | 'invert' | 'other' }): void {
    if (depthRange?.kind === 'clear') {
      clear_world_selection(world_selection);
      syncPainterCanvasSelectionFromWorld();
      return;
    }
    if (depthRange?.kind === 'select_all') {
      clear_world_selection(world_selection);
      for (const resolved of painter_document_runtime.resolved_visible_index.values()) {
        set_world_selected(world_selection, resolved.x, resolved.y, resolved.z, true);
      }
      syncPainterCanvasSelectionFromWorld();
      return;
    }
    if (depthRange?.kind === 'invert') {
      const next = create_world_selection();
      for (const resolved of painter_document_runtime.resolved_visible_index.values()) {
        const key = `${resolved.x},${resolved.y},${resolved.z}` as const;
        if (!world_selection.cells.has(key)) set_world_selected(next, resolved.x, resolved.y, resolved.z, true);
      }
      world_selection.cells = next.cells;
      syncPainterCanvasSelectionFromWorld();
      return;
    }
    const bitmap = getPainterCanvasModuleApi()?.getSelectionBitmap?.();
    if (!bitmap || !painter_display_projection) return;
    const incoming = create_world_selection();
    const focusPlane = painter_display_projection.focus_world_plane;
    if (focusPlane === null || focusPlane === undefined) {
      apply_world_selection_mode(world_selection, incoming, mode);
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
          const cell = getVoxel(voxelSpace, world.x, world.y, world.z);
          if (!cell || cell.char === ' ') continue;
          set_world_selected(incoming, world.x, world.y, world.z, true);
        }
      }
    }
    apply_world_selection_mode(world_selection, incoming, mode);
  }

  function stepPainterViewAction(action: 'swing_left' | 'swing_right' | 'swing_up' | 'swing_down' | 'roll_left' | 'roll_right'): void {
    if (painter_view_transition) return;
    const now = performance.now();
    const current = getPainterViewState();
    const transitionTargetWorld = getPainterFallbackTargetWorld();
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

  function stepPainterDepth(dir: -1 | 1): void {
    const axis = getPainterFocusPlaneAxis(getPainterDisplayViewState());
    const currentPlane = getCurrentFocusWorldPlane();
    let nextPlane = currentPlane + dir;
    if (axis === 'x') {
      const bounds = getPainterDocumentBounds();
      nextPlane = Math.max(bounds.minX, Math.min(bounds.minX + bounds.width - 1, nextPlane));
    } else if (axis === 'y') {
      const bounds = getPainterDocumentBounds();
      nextPlane = Math.max(bounds.minY, Math.min(bounds.minY + bounds.height - 1, nextPlane));
    } else {
      const planes = get_runtime_group_planes();
      if (planes.length < 1) return;
      const currentIndex = planes.indexOf(currentPlane);
      const anchorIndex = currentIndex >= 0
        ? currentIndex
        : planes.indexOf(get_nearest_runtime_group_plane(currentPlane) ?? planes[0]!);
      const nextIndex = Math.max(0, Math.min(planes.length - 1, anchorIndex + dir));
      nextPlane = planes[nextIndex]!;
    }
    if (!Number.isFinite(nextPlane) || nextPlane === currentPlane) return;
    const canvasWithDepthRetarget = canvas_module as typeof canvas_module & { handleDepthStepDuringActiveStroke?: (nextPlane: number) => void };
    canvasWithDepthRetarget.handleDepthStepDuringActiveStroke?.(nextPlane);
    setCurrentFocusWorldPlane(nextPlane, { persist: true });
    refreshPainterProjectionPreservingCurrentTarget();
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
    if (domRenderer) return; // Already initialized

    const container = document.getElementById('voxel_layers_container');
    if (!container) {
      diag_log('renderer', 'important', 'PAINTER', 'voxel layers container not found; DOM renderer not initialized', {}, { sink: 'warn' });
      return;
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
    domRenderer.setSpace(getPainterRenderSpace());
    painterImportant('dom renderer initialized');
  }

  // Sync DOM renderer with current voxelSpace
  function syncDOMRenderer(): void {
    if (domRenderer) {
      applyPainterProjectedCameraTuning();
      domRenderer.setSpace(getPainterRenderSpace());
    }
  }

  function syncRendererFromProjection(): void {
    syncDOMRenderer();
  }

  function ensureValidFocusPlane(): void {
    const axis = getPainterFocusPlaneAxis();
    const zs = get_runtime_group_planes();
    if (zs.length === 0) {
      setCurrentFocusWorldPlane(0);
      legacy_group_compat.active_group_id = null;
      return;
    }
    if (axis === 'x') {
      const bounds = getPainterDocumentBounds();
      const nextPlane = Math.max(bounds.minX, Math.min(bounds.minX + bounds.width - 1, getCurrentFocusWorldPlane()));
      if (nextPlane !== getCurrentFocusWorldPlane()) {
        setCurrentFocusWorldPlane(nextPlane);
      }
    } else if (axis === 'y') {
      const bounds = getPainterDocumentBounds();
      const nextPlane = Math.max(bounds.minY, Math.min(bounds.minY + bounds.height - 1, getCurrentFocusWorldPlane()));
      if (nextPlane !== getCurrentFocusWorldPlane()) {
        setCurrentFocusWorldPlane(nextPlane);
      }
    } else if (!Number.isFinite(getCurrentFocusWorldPlane())) {
      setCurrentFocusWorldPlane(zs[0]!);
    } else {
      const currentPlane = getCurrentFocusWorldPlane();
      const nearestPlane = zs.reduce((best, candidate) => (
        Math.abs(candidate - currentPlane) < Math.abs(best - currentPlane) ? candidate : best
      ), zs[0]!);
      if (nearestPlane !== currentPlane && !zs.includes(currentPlane)) {
        setCurrentFocusWorldPlane(nearestPlane);
      }
    }
    syncCompatibilityFocusPlaneFromCameraTarget();
    sync_active_group_to_focus_plane();
  }

  // Create history manager
  const history = createHistoryManager(50);
  let boot_document_restored = false;

  // Try to load auto-save on startup (try VoxelSpace first, then fallback to Grid)
  const saved_painter_document = loadAutoSavePainterDocument();
  if (saved_painter_document) {
    painterDiag('restoring autosaved painter document');
    applyPainterDocumentSnapshot(saved_painter_document);
    clearLastUsedFilePath();
    boot_document_restored = true;
    painterImportant('loaded autosaved painter document artwork');
  } else {
    const saved_voxel_space = loadAutoSaveVoxelSpace();
    if (saved_voxel_space) {
    painterDiag('restoring autosaved voxel space');
    voxelSpace = saved_voxel_space;
    rebuild_runtime_from_voxel_space();
    // Re-apply saved camera config after loading auto-save (camera settings are global, not per-artwork)
    const savedCameraConfig = loadCameraConfig();
    mergeSavedPainterCameraConfig(savedCameraConfig);
    syncPainterCameraViewTransform();
    ensureValidFocusPlane();
    setPainterCameraTargetWorld(getPainterDocumentCenterWorld());
    painter_display_projection = rebuildPainterDisplayProjection(getPainterDisplayViewState(), { kind: 'viewport_center', screen: null, world: painter_camera_target_world });
    syncProjectedGridFromDisplay();
    syncDOMRenderer();
    clearLastUsedFilePath();
    boot_document_restored = true;
    painterImportant('loaded autosaved voxel space artwork');
    } else {
      // Fallback to legacy grid auto-save
      const saved_grid = loadAutoSave();
      if (saved_grid) {
        painterDiag('restoring legacy autosaved grid');
        grid.width = saved_grid.width;
        grid.height = saved_grid.height;
        grid.cells = saved_grid.cells;
        // Sync voxelSpace to grid
        voxelSpace = gridToVoxelSpace(grid, 0);
        rebuild_runtime_from_voxel_space();
        // Re-apply saved camera config after loading legacy auto-save
        const savedCameraConfig = loadCameraConfig();
        mergeSavedPainterCameraConfig(savedCameraConfig);
        syncPainterCameraViewTransform();
        ensureValidFocusPlane();
        setPainterCameraTargetWorld(getPainterDocumentCenterWorld());
        painter_display_projection = rebuildPainterDisplayProjection(getPainterDisplayViewState(), { kind: 'viewport_center', screen: null, world: painter_camera_target_world });
        syncProjectedGridFromDisplay();
        syncDOMRenderer();
        clearLastUsedFilePath();
        boot_document_restored = true;
        painterImportant('loaded autosaved artwork legacy format');
      }
    }
  }

  resetPainterHistoryState('initial painter state');
  
  // Load saved tool properties
  const saved_tool_props = loadToolProperties();
  
  // Current tool state
  let current_tool: ToolType = 'pencil';
  
  // Tool mapping for left/right click
  let left_click_tool: ToolType = normalize_painter_tool(saved_tool_props.left_click_tool as ToolType || 'pencil');
  let right_click_tool: ToolType = normalize_painter_tool(saved_tool_props.right_click_tool as ToolType || 'eraser');

  function assign_left_click_tool(tool: ToolType): void {
    tool = normalize_painter_tool(tool);
    left_click_tool = tool;
    active_property_side = 'left';
    saveToolProperties({ left_click_tool: tool, active_property_side: 'left' });
  }

  function assign_right_click_tool(tool: ToolType): void {
    tool = normalize_painter_tool(tool);
    right_click_tool = tool;
    active_property_side = 'right';
    saveToolProperties({ right_click_tool: tool, active_property_side: 'right' });
  }

  const painter_tool_shortcut_interpreter = create_painter_tool_shortcut_interpreter({
    on_assign_primary: assign_left_click_tool,
    on_assign_secondary: assign_right_click_tool,
  });
  
  let active_property_side: 'left' | 'right' = saved_tool_props.active_property_side === 'right' ? 'right' : 'left';

  const left_brush: Brush = {
    char: saved_tool_props.left_brush_char ?? '█',
    rgb: { ...saved_tool_props.left_brush_rgb },
    weight_index: saved_tool_props.left_brush_weight_index ?? 1,
  };
  const right_brush: Brush = {
    char: saved_tool_props.right_brush_char ?? '█',
    rgb: { ...saved_tool_props.right_brush_rgb },
    weight_index: saved_tool_props.right_brush_weight_index ?? 1,
  };

  let left_brush_size = saved_tool_props.left_brush_size ?? saved_tool_props.brush_size ?? 1;
  let right_brush_size = saved_tool_props.right_brush_size ?? saved_tool_props.brush_size ?? 1;
  let left_brush_edit_channels: EditChannels = { ...saved_tool_props.left_brush_edit_channels };
  let right_brush_edit_channels: EditChannels = { ...saved_tool_props.right_brush_edit_channels };
  let left_picker_edit_channels: EditChannels = { ...saved_tool_props.left_picker_edit_channels };
  let right_picker_edit_channels: EditChannels = { ...saved_tool_props.right_picker_edit_channels };
  let picker_pick_for_opposite_hand = saved_tool_props.picker_pick_for_opposite_hand ?? false;

  function getBrushForSide(side: 'left' | 'right'): Brush {
    return side === 'right' ? right_brush : left_brush;
  }

  function getBrushForButton(button: number): Brush {
    return getBrushForSide(button === 2 ? 'right' : 'left');
  }

  function getBrushSizeForSide(side: 'left' | 'right'): number {
    return side === 'right' ? right_brush_size : left_brush_size;
  }

  function getBrushEditChannelsForSide(side: 'left' | 'right'): EditChannels {
    return side === 'right' ? right_brush_edit_channels : left_brush_edit_channels;
  }

  function getPickerEditChannelsForSide(side: 'left' | 'right'): EditChannels {
    return side === 'right' ? right_picker_edit_channels : left_picker_edit_channels;
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

  // Current filename for save operations
  let current_filename = 'untitled';
  let current_file_path: string | null = null;
  let authoritative_revision_applied = 0;
  const LAST_FILE_PATH_KEY = 'thaumworld_ascii_painter_last_file_path';
  let live_stroke_preview_changes: Array<{
    worldX: number;
    worldY: number;
    worldZ: number;
    newCell: { char: string; rgb: { r: number; g: number; b: number }; weight_index: number };
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
    } catch {
      // ignore
    }
  }

  function setActiveFileAssociation(filePath: string): void {
    current_file_path = filePath;
    current_filename = inferFilenameFromPath(filePath);
    rememberLastUsedFilePath(filePath);
  }

  function clearActiveFileAssociation(nextFilename: string = 'untitled', opts?: { clearLastUsed?: boolean }): void {
    current_file_path = null;
    current_filename = nextFilename;
    if (opts?.clearLastUsed) clearLastUsedFilePath();
  }

  function cloneGridCellForPreview(cell: GridCell): GridCell {
    return {
      char: cell.char,
      rgb: { ...cell.rgb },
      weight_index: cell.weight_index,
    };
  }

  function cloneProjectedRenderSpace(space: VoxelSpace): VoxelSpace {
    return {
      bounds: { ...space.bounds },
      camera: {
        ...space.camera,
        calibration: { ...space.camera.calibration },
        euler_rotation: { ...space.camera.euler_rotation },
        transition_euler: space.camera.transition_euler ? { ...space.camera.transition_euler } : undefined,
        visual_pivot_px: space.camera.visual_pivot_px ? { ...space.camera.visual_pivot_px } : undefined,
      },
      metadata: space.metadata ? { ...space.metadata } : undefined,
      layers: new Map(Array.from(space.layers.entries(), ([z, layer]) => [z, {
        z: layer.z,
        name: layer.name,
        visible: layer.visible,
        opacity: layer.opacity,
        // Preview overlays write into a transient clone of the projected display space.
        locked: false,
        cells: layer.cells.map((row) => row.map((cell) => cloneGridCellForPreview(cell))),
      }])),
    };
  }

  function getPainterRenderSpace(): VoxelSpace {
    if (!painter_display_projection || live_stroke_preview_changes.length < 1) {
      return painter_display_projection.space;
    }
    const previewSpace = cloneProjectedRenderSpace(painter_display_projection.space);
    for (const change of live_stroke_preview_changes) {
      const displayCell = project_world_to_painter_display_cell({
        projection: painter_display_projection,
        world: { x: change.worldX, y: change.worldY, z: change.worldZ },
      });
      if (!displayCell) continue;
      setVoxel(previewSpace, displayCell.x, displayCell.y, displayCell.slot, {
        char: change.newCell.char,
        rgb: { ...change.newCell.rgb },
        weight_index: change.newCell.weight_index,
      });
    }
    return previewSpace;
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
    applyPainterDocumentSnapshot(bootstrap.snapshot);
    authoritative_revision_applied = bootstrap.revision;
    clearActiveFileAssociation(String(bootstrap.document_id ?? '').trim() || 'untitled', { clearLastUsed: true });
    boot_document_restored = true;
    painterImportant('applied authoritative painter bootstrap', {
      document_id: bootstrap.document_id,
      revision: bootstrap.revision,
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

  function applyPainterDocumentSnapshot(document: PainterDocument): void {
    painter_document_runtime = normalize_painter_document_runtime(document);
    rebuild_voxel_space_from_runtime();
    clear_world_selection(world_selection);

    const savedCam = loadCameraConfig();
    if (savedCam && Object.keys(savedCam).length > 0) {
      voxelSpace.camera = createSanitizedPainterCamera(savedCam);
      syncPainterViewStatesFromLegacyCamera();
    }

    syncPainterCameraViewTransform();
    ensureValidFocusPlane();
    setPainterCameraTargetWorld(getPainterDocumentCenterWorld());
    painter_display_projection = rebuildPainterDisplayProjection(getPainterDisplayViewState(), { kind: 'viewport_center', screen: null, world: painter_camera_target_world });
    syncProjectedGridFromDisplay();
    syncDOMRenderer();
    resetPainterHistoryState('apply painter document snapshot');
  }

  painter_sync.subscribe((sync_state) => {
    if (sync_state.authority_mode !== 'authoritative_host' || !sync_state.bootstrap?.snapshot) return;
    apply_authoritative_painter_bootstrap(sync_state.bootstrap);
  });

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
    if (current_file_path && window.electronAPI?.writeFileAtomic) {
      await writeArtworkToFileAtomic(current_file_path);
      return;
    }
    autoSavePainterDocument(exportCurrentPainterDocument(), current_filename);
  }

  // Auto-save timer
  let auto_save_timer: ReturnType<typeof setTimeout> | null = null;

  // Create module registry
  const registry = create_module_registry();

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
    let loadedPainterDocument: PainterDocument | null = null;
    try {
      loadedPainterDocument = importPainterDocumentFromJSON(content);
    } catch {
      loadedPainterDocument = null;
    }

    if (loadedPainterDocument) {
      applyPainterDocumentSnapshot(loadedPainterDocument);
    } else {
      voxelSpace = importVoxelSpaceFromJSON(content);
      rebuild_runtime_from_voxel_space({ preserve_group_order: true });
      clear_world_selection(world_selection);

      // Apply persisted camera/UI settings (do not import from file)
      const savedCam = loadCameraConfig();
      if (savedCam && Object.keys(savedCam).length > 0) {
        voxelSpace.camera = createSanitizedPainterCamera(savedCam);
        syncPainterViewStatesFromLegacyCamera();
      }

      ensureValidFocusPlane();
      setPainterCameraTargetWorld(getPainterDocumentCenterWorld());
      painter_display_projection = rebuildPainterDisplayProjection(getPainterDisplayViewState(), { kind: 'viewport_center', screen: null, world: painter_camera_target_world });
      syncProjectedGridFromDisplay();
      syncDOMRenderer();

      resetPainterHistoryState('load artwork legacy voxel fallback');
    }

    if (loadedPath) {
      setActiveFileAssociation(loadedPath);
    } else {
      clearActiveFileAssociation(current_filename, { clearLastUsed: true });
    }

    schedule_auto_save();
  }

  async function new_file(): Promise<void> {
    const dir = await getAsciiDrawingsDir();
    if (!dir) {
      // Fallback: just create a new in-memory canvas
      voxelSpace = createVoxelSpace(CANVAS_WIDTH, CANVAS_HEIGHT, { defaultZ: 0 });
      rebuild_runtime_from_voxel_space();
      clear_world_selection(world_selection);
      const savedCam = loadCameraConfig();
      if (savedCam && Object.keys(savedCam).length > 0) {
        voxelSpace.camera = { ...voxelSpace.camera, ...savedCam };
        syncPainterViewStatesFromLegacyCamera();
      }
      syncPainterCameraViewTransform();
      ensureValidFocusPlane();
      setPainterCameraTargetWorld(getPainterDocumentCenterWorld());
      painter_display_projection = rebuildPainterDisplayProjection(getPainterDisplayViewState(), { kind: 'viewport_center', screen: null, world: painter_camera_target_world });
      syncProjectedGridFromDisplay();
      syncDOMRenderer();
      resetPainterHistoryState('new file in-memory fallback');
      clearActiveFileAssociation('untitled', { clearLastUsed: true });
      clearAutoSave();
      return;
    }

    const basename = makeNewFileBasename();
    const filePath = `${dir}\\${basename}`;

    voxelSpace = createVoxelSpace(CANVAS_WIDTH, CANVAS_HEIGHT, { defaultZ: 0 });
    rebuild_runtime_from_voxel_space();
    clear_world_selection(world_selection);
    const savedCam = loadCameraConfig();
    if (savedCam && Object.keys(savedCam).length > 0) {
      voxelSpace.camera = { ...voxelSpace.camera, ...savedCam };
      syncPainterViewStatesFromLegacyCamera();
    }
    syncPainterCameraViewTransform();
    ensureValidFocusPlane();
    setPainterCameraTargetWorld(getPainterDocumentCenterWorld());
    painter_display_projection = rebuildPainterDisplayProjection(getPainterDisplayViewState(), { kind: 'viewport_center', screen: null, world: painter_camera_target_world });
    syncProjectedGridFromDisplay();
    syncDOMRenderer();
    resetPainterHistoryState('new file initialized');

    setActiveFileAssociation(filePath);

    await writeArtworkToFileAtomic(filePath);
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

  // Auto-open the last file on boot (best effort).
  // IMPORTANT: Never set current_file_path without loading, otherwise beforeunload autosave
  // could overwrite the last file with whatever is currently in memory.
  if (window.electronAPI?.readFile) {
    void (async () => {
      const api = window.electronAPI;
      if (!api?.readFile) return;
      if (boot_document_restored) return;
      let last: string | null = null;
      try {
        last = window.localStorage.getItem(LAST_FILE_PATH_KEY);
      } catch {
        last = null;
      }
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
      newCell: { char: string; rgb: { r: number; g: number; b: number }; weight_index: number };
    }>;
    anchor_world: { x: number; y: number; z: number } | null;
    plane: number | null;
  }): void {
    void args.anchor_world;
    void args.plane;
    live_stroke_preview_changes = args.changes.map((change) => ({
      worldX: change.worldX,
      worldY: change.worldY,
      worldZ: change.worldZ,
      newCell: {
        char: change.newCell.char,
        rgb: { ...change.newCell.rgb },
        weight_index: change.newCell.weight_index,
      },
    }));
    syncDOMRenderer();
  }
  
  // Keyboard shortcuts for layer navigation
  // NOTE: Page Up/Down and Tab removed - use Layer Palette UI buttons instead
  
  // Create canvas module
  const canvas_module = make_painter_canvas_module({
    id: 'painter_canvas',
    rect: canvas_rect,
    grid,
    get_camera: () => voxelSpace.camera,
    get_selected_z: () => getPainterCameraTargetPlaneCoordinate(),
    get_active_group_id: () => legacy_group_compat.active_group_id,
    get_world_cell: (world) => {
      const coordKey = `${Math.floor(world.x)}:${Math.floor(world.y)}:${Math.floor(world.z)}`;
      const resolved = painter_document_runtime.resolved_visible_index.get(coordKey) ?? null;
      if (!resolved) return { char: ' ', rgb: { r: 0, g: 0, b: 0 }, weight_index: 0 };
      return {
        char: resolved.cell.char,
        rgb: { ...resolved.cell.rgb },
        weight_index: resolved.cell.weight_index,
      };
    },
    get_active_group_world_cell: (world) => {
      const group_id = resolve_current_runtime_group_id();
      if (!group_id) return { char: ' ', rgb: { r: 0, g: 0, b: 0 }, weight_index: 0 };
      const coordKey = `${Math.floor(world.x)}:${Math.floor(world.y)}:${Math.floor(world.z)}`;
      const record = painter_document_runtime.group_voxel_index.get(group_id)?.get(coordKey) ?? null;
      if (!record) return { char: ' ', rgb: { r: 0, g: 0, b: 0 }, weight_index: 0 };
      return {
        char: record.char,
        rgb: { ...record.rgb },
        weight_index: record.weight_index,
      };
    },
    get_active_group_locked: () => {
      const group_id = resolve_current_runtime_group_id();
      return group_id ? Boolean(painter_document_runtime.document.groups[group_id]?.locked) : false;
    },
    get_current_tool: () => current_tool,
    get_preview_brush: () => getPreviewBrush(),
    get_brush_for_button: (button) => getBrushForButton(button),
    get_brush_edit_channels_for_button: (button) => getBrushEditChannelsForSide(button === 2 ? 'right' : 'left'),
    get_brush_size: () => getBrushSizeForSide(active_property_side),
    get_brush_size_for_button: (button) => getBrushSizeForButton(button),
    get_space_replace: () => space_replace,
    get_paste_space_replace: () => paste_space_replace,
    get_paste_scale: () => paste_scale,
    get_gradiator_state: () => gradiator_state,
    get_paste_ignore_space: () => paste_ignore_space,
    get_paste_ignore_black: () => paste_ignore_black,
    get_paste_ignore_white: () => paste_ignore_white,
    get_paste_ignore_color: () => paste_ignore_color,
    get_paste_ignore_color_rgb: () => paste_ignore_color_rgb,
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
    get_view_state: () => getPainterViewState(),
    get_focus_content_bounds: () => getPainterFocusContentBounds(),
    on_history_applied: () => {
      refreshPainterProjectionFromWorld();
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
    get_focus_layer_z: () => getPainterCameraTargetPlaneCoordinate(),
    get_focus_world_plane: () => painter_display_projection?.focus_world_plane ?? getPainterCameraTargetPlaneCoordinate(),
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
          newCell: {
            char: change.newCell.char,
            rgb: { ...change.newCell.rgb },
            weight_index: change.newCell.weight_index,
          },
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
        newCell: {
          char: change.newCell.char,
          rgb: { ...change.newCell.rgb },
          weight_index: change.newCell.weight_index,
        },
      })));
      if (applied_locally) {
        refreshPainterProjectionPreservingCurrentTarget();
      }
      const authority_mode = painter_sync.get_state().authority_mode;
      if (authority_mode !== 'authoritative_host') return;
      const active_group_id = resolve_current_runtime_group_id();
      if (!active_group_id) return;
      void painter_sync.submit_cell_changes(active_group_id, changes.map((change) => ({
        x: change.worldX,
        y: change.worldY,
        z: change.worldZ,
        cell: {
          char: change.newCell.char,
          rgb: { ...change.newCell.rgb },
          weight_index: change.newCell.weight_index,
        },
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

      const channels = resolve_edit_channels_with_modifiers(getPickerEditChannelsForSide(clicked_side), sample);
      if (channels.char) brush.char = cell.char;
      if (channels.color) brush.rgb = { ...cell.rgb };
      if (channels.weight) brush.weight_index = cell.weight_index;

      saveBrushState(target_side);
    },
    on_selection_change: (args) => {
      updateWorldSelectionFromProjectedBitmap(selection_mode, args);
    },
    get_selection_overlay_cells: () => getProjectedSelectionOverlayCells(),
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
      // Update canvas_rect when moved
      canvas_rect = new_rect;
      refreshPainterProjectionPreservingCurrentTarget();
      painterDiag('canvas moved', { rect: new_rect });
    },
    on_resize: (new_rect) => {
      // Update canvas_rect
      canvas_rect = new_rect;
      refreshPainterProjectionPreservingCurrentTarget();
      painterDiag('canvas resized', { rect: new_rect });
    },
    on_close: () => {
      // Reset canvas to default position
      canvas_rect = get_default_canvas_rect();
      refreshPainterProjectionPreservingCurrentTarget();
      painterDiag('canvas reset to default position');
    },
    on_viewport_change: (viewport) => {
      // Viewport is driven by the main render loop (src/canvas_app/main.ts) using runtime tile metrics.
      // No-op to avoid mixing coordinate systems.
      void viewport;
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
  let weight_selector_open = getInitialModuleVisibility('weight_selector', true);
  let toolbox_open = getInitialModuleVisibility('toolbox', true);
  let tool_properties_open = getInitialModuleVisibility('tool_properties', true);
  let controls_open = getInitialModuleVisibility('controls_panel', false);

  function setModuleOpen(moduleId: string, visible: boolean, setOpen: (v: boolean) => void): void {
    setOpen(visible);
    if (registry.has(moduleId)) {
      registry.set_visibility(moduleId, visible);
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
  let weight_selector_module: Module | null = null;
  let toolbox_module: Module | null = null;
  let tool_properties_module: Module | null = null;
  let controls_module: Module | null = null;

  const painter_controls = create_painter_controls_runtime(PAINTER_APP_CONFIG.selected_data_slot);
  void painter_controls.load();
  const painter_tai = create_painter_tool_assisted_inputs_wiring({
    data_slot: PAINTER_APP_CONFIG.selected_data_slot,
    get_tool_state: () => ({ current_tool, left_click_tool, right_click_tool }),
    get_focus_plane: () => painter_display_projection?.focus_world_plane ?? getPainterCameraTargetPlaneCoordinate(),
    get_camera_target: () => getPainterFallbackTargetWorld(),
    get_bounds: () => voxelSpace.bounds,
    get_interaction_anchor: () => getPainterInteractionAnchor(),
    get_cell: (x, y, z) => {
      const plane = typeof z === 'number' ? z : (painter_display_projection?.focus_world_plane ?? getPainterCameraTargetPlaneCoordinate());
      return getVoxel(voxelSpace, x, y, plane);
    },
    get_text_value: (source, field) => {
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
        if (key === 'focus_plane') return String(getPainterCameraTargetPlaneCoordinate());
        if (key === 'camera_target_plane') return String(getPainterCameraTargetPlaneCoordinate());
        if (key === 'display_focus_plane') return String(painter_display_projection?.focus_world_plane ?? getPainterCameraTargetPlaneCoordinate());
        if (key === 'group_count') return String(Object.keys(painter_document_runtime.document.groups).length);
        if (key === 'group_order') return painter_document_runtime.document.group_order.join(',');
        if (key === 'contributor_coords') return String(painter_document_runtime.coordinate_group_index.size);
        if (key === 'resolved_coords') return String(painter_document_runtime.resolved_visible_index.size);
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
      }
      return null;
    },
    invoke_helper: (helper, payload) => {
      if (helper === 'start_layer_rename') {
        const z = Number((payload as any)?.z ?? 0);
        const layerPalette = layer_palette_module as any;
        if (!Number.isFinite(z) || typeof layerPalette?.beginRenameLayer !== 'function') return false;
        const direct_palette_z = get_group_entry_for_palette_z(Math.floor(z)) ? Math.floor(z) : null;
        const legacy_group_id = get_group_id_for_legacy_z(Math.floor(z));
        const palette_z = direct_palette_z ?? get_palette_z_for_group_id(legacy_group_id);
        if (!Number.isFinite(Number(palette_z))) return false;
        const started = Boolean(layerPalette.beginRenameLayer(Number(palette_z)));
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
        if (navigation_module) {
          navigation_module.rect = {
            x0: canvas_rect.x1 + 2,
            y0: canvas_rect.y0 + 22,
            x1: canvas_rect.x1 + 30,
            y1: canvas_rect.y0 + 32,
          };
        }
        refreshPainterProjectionPreservingCurrentTarget();
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
        const created = add_painter_group(painter_document_runtime, create_painter_group(`Layer ${painter_document_runtime.document.group_order.length + 1}`));
        logGroupAction(history, 'create_group', `Create Group ${created.name}`, {
          groupId: created.id,
          newGroupData: created,
        });
        submit_group_command_if_authoritative({ kind: 'create_group', group_name: created.name, target_group_id: created.id });
        legacy_group_compat.active_group_id = created.id;
        rebuild_voxel_space_from_runtime();
        refreshPainterProjectionFromWorld();
        log_runtime_summary('tai add group summary');
        return true;
      }
      if (helper === 'duplicate_active_group') {
        const active_group_id = resolve_current_runtime_group_id();
        if (!active_group_id) return false;
        const duplicated = duplicate_painter_group(painter_document_runtime, active_group_id);
        logGroupAction(history, 'duplicate_group', `Duplicate Group ${duplicated.name}`, {
          sourceGroupId: active_group_id,
          targetGroupId: duplicated.id,
          newGroupData: duplicated,
        });
        submit_group_command_if_authoritative({ kind: 'duplicate_group', source_group_id: active_group_id, target_group_id: duplicated.id });
        legacy_group_compat.active_group_id = duplicated.id;
        rebuild_voxel_space_from_runtime();
        refreshPainterProjectionFromWorld();
        log_runtime_summary('tai duplicate active group summary');
        return true;
      }
      if (helper === 'reverse_group_order') {
        const oldGroupOrder = [...painter_document_runtime.document.group_order];
        reorder_painter_groups(painter_document_runtime, [...painter_document_runtime.document.group_order].reverse());
        logGroupAction(history, 'reorder_groups', 'Reorder Groups', {
          oldGroupOrder,
          newGroupOrder: [...painter_document_runtime.document.group_order],
        });
        submit_group_command_if_authoritative({ kind: 'reorder_groups', next_group_order: [...painter_document_runtime.document.group_order] });
        legacy_group_compat.group_order = [...painter_document_runtime.document.group_order];
        rebuild_voxel_space_from_runtime();
        refreshPainterProjectionFromWorld();
        log_runtime_summary('tai reverse group order summary');
        return true;
      }
      if (helper === 'clear_anchor_cell') {
        return clear_current_anchor_cell();
      }
      if (helper === 'reset_painter_document') {
        return reset_painter_document_state();
      }
      if (helper === 'clear_painter_cells') {
        const cells = Array.isArray((payload as any)?.cells) ? (payload as any).cells : [];
        const authored_changes: Array<{ worldX: number; worldY: number; worldZ: number; newCell: { char: string; rgb: { r: number; g: number; b: number }; weight_index: number } }> = [];
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
    x1: 121,
    y1: 35
  });
  
  const weight_selector_rect: Rect = getModuleRectWithSave('weight_selector', {
    x0: 90,
    y0: 10,
    x1: 103,
    y1: 18
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
  
  // Layer Palette - positioned on the right side
  const layer_palette_rect: Rect = getModuleRectWithSave('layer_palette', {
    x0: canvas_rect.x1 + 2,  // Right of canvas
    y0: canvas_rect.y0,
    x1: canvas_rect.x1 + 22, // 20 chars wide
    y1: canvas_rect.y0 + 20  // Show up to ~17 layers
  });

  // Camera Control - positioned below layer palette
  const navigation_rect: Rect = getModuleRectWithSave('navigation', {
    x0: canvas_rect.x1 + 2,
    y0: canvas_rect.y0 + 22,
    x1: canvas_rect.x1 + 30,
    y1: canvas_rect.y0 + 32,
  });

  // Camera Control - positioned below navigation
  const camera_control_rect: Rect = getModuleRectWithSave('camera_control', {
    x0: canvas_rect.x1 + 2,  // Right of canvas
    y0: canvas_rect.y0 + 34, // Below navigation
    x1: canvas_rect.x1 + 30, // 28 chars wide
    y1: canvas_rect.y0 + 52  // 18 chars tall
  });

  // Factory functions for creating modules
  function create_char_selector_module(): Module {
    painterDiag('creating char selector module', { rect: char_selector_rect });
    return make_character_selector_module({
      id: 'char_selector',
      rect: char_selector_rect,
      get_selected_char: () => getPreviewBrush().char,
      get_left_selected_char: () => left_brush.char,
      get_right_selected_char: () => right_brush.char,
      get_left_rgb: () => left_brush.rgb,
      get_right_rgb: () => right_brush.rgb,
      get_left_weight_index: () => left_brush.weight_index,
      get_right_weight_index: () => right_brush.weight_index,
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
          getBrushForButton(button).char = char;
          saveBrushState(active_property_side);
          painterDiag('selected character', { char });
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
      get_left_rgb: () => left_brush.rgb,
      get_right_rgb: () => right_brush.rgb,
      on_color_select: (rgb, button) => {
        // Check if we're selecting the ignore color
        if ((globalThis as any).__selecting_ignore_color) {
          paste_ignore_color_rgb = rgb;
          saveToolProperties({ paste_ignore_color_rgb: rgb });
          (globalThis as any).__selecting_ignore_color = false;
          painterDiag('set ignore color', { rgb });
        } else {
          active_property_side = button === 2 ? 'right' : 'left';
          getBrushForButton(button).rgb = { ...rgb };
          saveBrushState(active_property_side);
          painterDiag('selected color', { rgb });
        }
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
  
  function create_weight_selector_module(): Module {
    return make_weight_selector_module({
      id: 'weight_selector',
      rect: weight_selector_rect,
      get_weight_index: () => getPreviewBrush().weight_index,
      get_left_weight_index: () => left_brush.weight_index,
      get_right_weight_index: () => right_brush.weight_index,
      on_weight_change: (weight_index, button) => {
        active_property_side = button === 2 ? 'right' : 'left';
        getBrushForButton(button).weight_index = weight_index;
        saveBrushState(active_property_side);
        painterDiag('selected weight', { weight_index });
      },
      on_move: (new_rect) => {
        if (weight_selector_module) {
          weight_selector_module.rect = new_rect;
          saveModulePosition('weight_selector', new_rect);
        }
      },
      on_close: () => {
        setModuleOpen('weight_selector', false, (v) => { weight_selector_open = v; });
      }
    });
  }
  
  function create_toolbox_module(): Module {
    return make_toolbox_module({
      id: 'toolbox',
      rect: toolbox_rect,
      get_current_tool: () => current_tool,
      get_left_click_tool: () => left_click_tool,
      get_right_click_tool: () => right_click_tool,
      on_tool_select: (tool) => {
        current_tool = normalize_painter_tool(tool);
        painterDiag('selected tool', { tool });
      },
      on_left_click_tool_change: (tool) => {
        tool = normalize_painter_tool(tool);
        active_property_side = 'left';
        left_click_tool = tool;
        saveToolProperties({ left_click_tool: tool, active_property_side: 'left' });
        painterDiag('left-click tool changed', { tool });
      },
      on_right_click_tool_change: (tool) => {
        tool = normalize_painter_tool(tool);
        active_property_side = 'right';
        right_click_tool = tool;
        saveToolProperties({ right_click_tool: tool, active_property_side: 'right' });
        painterDiag('right-click tool changed', { tool });
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
        default: return String(tool).toUpperCase();
      }
    }

    function is_brush_size_tool(tool: ToolType): boolean {
      return tool === 'pencil' || tool === 'eraser';
    }

    function append_side_tool_rows(rows: ToolPropertyRow[], side: 'left' | 'right', tool: ToolType): void {
      const prefix = side === 'left' ? '[L]' : '[R]';
      const header_rgb = side === 'left' ? get_color_by_name('vivid_blue').rgb : get_color_by_name('vivid_red').rgb;
      rows.push({ type: 'info', id: `${side}_tool_header`, text: `${prefix} ${get_tool_label(tool)}`, rgb: header_rgb });

      if (is_brush_size_tool(tool)) {
        rows.push({ type: 'info', id: `${side}_tool_shared_brush`, text: 'size above' });
        return;
      }
      if (tool === 'text') {
        rows.push({ type: 'info', id: `${side}_tool_shared_text`, text: 'text above' });
        return;
      }
      if (tool === 'eyedropper') {
        rows.push({ type: 'info', id: `${side}_tool_shared_picker`, text: 'picker above' });
        return;
      }
      rows.push({ type: 'info', id: `${side}_tool_none`, text: 'no options' });
    }

    function format_edit_channel_summary(channels: EditChannels): string {
      return `${channels.char ? 'C' : '-'}${channels.color ? 'O' : '-'}${channels.weight ? 'W' : '-'}`;
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

    function build_stacked_property_rows(): ToolPropertyRow[] {
      const rows: ToolPropertyRow[] = [];
      const left_tool = left_click_tool;
      const right_tool = right_click_tool;
      const left_summary = `${get_tool_label(left_tool)} ${left_brush_size}x${left_brush_size} ${format_edit_channel_summary(left_brush_edit_channels)}`;
      const right_summary = `${get_tool_label(right_tool)} ${right_brush_size}x${right_brush_size} ${format_edit_channel_summary(right_brush_edit_channels)}`;
      const hands_match = left_tool === right_tool
        && left_brush_size === right_brush_size
        && left_brush_edit_channels.char === right_brush_edit_channels.char
        && left_brush_edit_channels.color === right_brush_edit_channels.color
        && left_brush_edit_channels.weight === right_brush_edit_channels.weight;

      rows.push({ type: 'info', id: 'left_hand_summary', text: `[L] ${left_summary}`, rgb: get_color_by_name('vivid_blue').rgb });
      rows.push({ type: 'info', id: 'right_hand_summary', text: `[R] ${right_summary}`, rgb: get_color_by_name('vivid_red').rgb });
      rows.push({
        type: 'info',
        id: 'hand_match_summary',
        text: hands_match ? 'HANDS MATCH SPATIALLY' : 'HANDS DIFFER: TOOL / SIZE / MASK',
        rgb: hands_match ? get_color_by_name('vivid_green').rgb : get_color_by_name('vivid_yellow').rgb,
      });
      rows.push({ type: 'info', id: 'hand_match_spacer', text: '' });

      if (is_brush_size_tool(left_tool) || is_brush_size_tool(right_tool)) {
        rows.push({ type: 'info', id: 'shared_brush_header', text: '[BRUSH]', rgb: get_color_by_name('vivid_yellow').rgb });
        rows.push({
          type: 'dual_slider',
          id: 'shared_brush_size',
          label: 'SIZE',
          min: 1,
          max: 5,
          left_value: left_brush_size,
          right_value: right_brush_size,
          format_value: (value) => `${value}x${value}`,
          on_change: (value, side) => {
            active_property_side = side;
            if (side === 'right') right_brush_size = value;
            else left_brush_size = value;
            saveBrushState(side);
          },
        });
        append_edit_channel_rows(
          rows,
          'brush',
          left_tool === 'pencil',
          right_tool === 'pencil',
          left_brush_edit_channels,
          right_brush_edit_channels,
          (side, channel) => {
            if (side === 'both') {
              const next_value = !(left_brush_edit_channels[channel] && right_brush_edit_channels[channel]);
              left_brush_edit_channels = { ...left_brush_edit_channels, [channel]: next_value };
              right_brush_edit_channels = { ...right_brush_edit_channels, [channel]: next_value };
              saveToolProperties({ left_brush_edit_channels, right_brush_edit_channels });
              return;
            }
            active_property_side = side;
            const next = { ...(side === 'right' ? right_brush_edit_channels : left_brush_edit_channels) };
            next[channel] = !next[channel];
            if (side === 'right') {
              right_brush_edit_channels = next;
              saveToolProperties({ right_brush_edit_channels: next });
            } else {
              left_brush_edit_channels = next;
              saveToolProperties({ left_brush_edit_channels: next });
            }
          },
        );
      }

      if (left_tool === 'text' || right_tool === 'text') {
        rows.push({ type: 'info', id: 'shared_text_header', text: '[TEXT]', rgb: get_color_by_name('vivid_yellow').rgb });
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
        rows.push({ type: 'info', id: 'shared_picker_header', text: '[PICKER]', rgb: get_color_by_name('vivid_yellow').rgb });
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
        append_edit_channel_rows(
          rows,
          'picker',
          left_tool === 'eyedropper',
          right_tool === 'eyedropper',
          left_picker_edit_channels,
          right_picker_edit_channels,
          (side, channel) => {
            if (side === 'both') {
              const next_value = !(left_picker_edit_channels[channel] && right_picker_edit_channels[channel]);
              left_picker_edit_channels = { ...left_picker_edit_channels, [channel]: next_value };
              right_picker_edit_channels = { ...right_picker_edit_channels, [channel]: next_value };
              saveToolProperties({ left_picker_edit_channels, right_picker_edit_channels });
              return;
            }
            active_property_side = side;
            const next = { ...(side === 'right' ? right_picker_edit_channels : left_picker_edit_channels) };
            next[channel] = !next[channel];
            if (side === 'right') {
              right_picker_edit_channels = next;
              saveToolProperties({ right_picker_edit_channels: next });
            } else {
              left_picker_edit_channels = next;
              saveToolProperties({ left_picker_edit_channels: next });
            }
          },
        );
      }

      rows.push({ type: 'info', id: 'left_spacer', text: '' });
      append_side_tool_rows(rows, 'left', left_tool);
      rows.push({ type: 'info', id: 'mid_spacer', text: '' });
      append_side_tool_rows(rows, 'right', right_tool);
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
      get_gradiator_state: () => gradiator_state,
      on_gradiator_slot_select: (slot) => {
        setActiveGradiatorSlot(gradiator_state, slot);
        saveGradiatorState(gradiator_state);
        painterDiag('selected gradiator slot', { slot });
      },
      on_gradiator_char_select: (slot, x) => {
        selectGradiatorChar(gradiator_state, slot, x);
        // Don't save on selection, only on actual changes
        painterDiag('selected gradiator char position', { slot, x });
      },
      on_gradiator_add_char: (slot) => {
        addGradiatorChar(gradiator_state, slot);
        saveGradiatorState(gradiator_state);
        painterDiag('added gradiator char', { slot });
      },
      on_gradiator_remove_char: (slot) => {
        removeGradiatorChar(gradiator_state, slot);
        saveGradiatorState(gradiator_state);
        painterDiag('removed gradiator char', { slot });
      },
      on_gradiator_char_set: (slot, x, char) => {
        setGradiatorChar(gradiator_state, slot, x, char);
        saveGradiatorState(gradiator_state);
        painterDiag('set gradiator char', { slot, x, char });
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

  // Create file menu module
  const file_menu = make_file_menu_module({
    id: 'painter_file_menu',
    rect: file_menu_rect,
    get_screen_size: () => ({ width: GRID_WIDTH, height: GRID_HEIGHT }),
    get_status_text: () => {
      const preview = getPreviewBrush();
      const focusPlane = painter_display_projection?.focus_world_plane ?? voxelSpace.camera.focus_plane;
      const activeGroup = resolve_current_runtime_group_id() ?? '-';
      return `L:${left_click_tool} R:${right_click_tool} CUR:${current_tool} CHAR:${preview.char} SIZE:L${getBrushSizeForSide('left')} R${getBrushSizeForSide('right')} DEPTH:${focusPlane} GRP:${activeGroup}`;
    },
    on_save: () => {
      void save_file().catch((e) => {
        diag_log('painter', 'important', 'PAINTER', 'save failed', { error: e instanceof Error ? e.message : String(e) }, { sink: 'error' });
        alert('Save failed: ' + (e as Error).message);
      });
    },
    on_load: () => {
      void load_file().catch((e) => {
        diag_log('painter', 'important', 'PAINTER', 'load failed', { error: e instanceof Error ? e.message : String(e) }, { sink: 'error' });
        alert('Load failed: ' + (e as Error).message);
      });
    },
    on_new: () => {
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
    on_reset_positions: () => {
      if (confirm('Reset all panel positions?')) {
        clearModulePositions();
        // Reload the page to apply default positions
        window.location.reload();
      }
    },
    on_reset_camera: () => {
      if (confirm('Reset camera to default settings?')) {
        clearCameraConfig();
        // Apply default camera settings immediately
        voxelSpace.camera = createSanitizedPainterCamera();
        syncPainterViewStatesFromLegacyCamera();
        refreshPainterProjectionPreservingCurrentTarget();
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
    on_toggle_weight_selector: () => {
      toggleModule(
        weight_selector_open,
        (v) => { weight_selector_open = v; },
        'weight_selector',
        create_weight_selector_module
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
    on_toggle_layer_palette: () => {
      toggleModule(
        layer_palette_open,
        (v) => { layer_palette_open = v; },
        'layer_palette',
        create_layer_palette_module
      );
    },
    on_toggle_navigation: () => {
      toggleModule(
        navigation_open,
        (v) => { navigation_open = v; },
        'navigation',
        create_navigation_module
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
  
  function create_layer_palette_module(): Module {
    return makeLayerPaletteModule({
      id: 'layer_palette',
      rect: layer_palette_rect,
      title: 'GROUPS',
      getRows: () => getPaletteGroupRows(),
      getSelectedZ: () => get_palette_z_for_group_id(legacy_group_compat.active_group_id) ?? null,
      getLayerId: (z) => get_group_entry_for_palette_z(z)?.group_id ?? null,
      getSelectedLayerId: () => legacy_group_compat.active_group_id,
      onLayerIdSelect: (group_id) => {
        selectPainterGroup(group_id);
      },
      onLayerIdVisibilityToggle: (group_id) => {
        togglePainterGroupVisibility(group_id);
      },
      onLayerIdLockToggle: (group_id) => {
        togglePainterGroupLock(group_id);
      },
      onLayerIdRename: (group_id, newName) => {
        renamePainterGroup(group_id, newName);
      },
      onDeleteLayerId: (group_id) => {
        deletePainterGroup(group_id);
      },
      onDuplicateLayerId: (group_id) => {
        duplicatePainterGroup(group_id);
      },
      onReorderLayerIds: (next_group_order) => {
        reorderPainterGroups([...next_group_order].reverse());
      },
      onLayerSelect: (z) => {
        const entry = get_group_entry_for_palette_z(z);
        if (!entry) return;
        selectPainterGroup(entry.group_id);
      },
      onLayerVisibilityToggle: (z) => {
        const entry = get_group_entry_for_palette_z(z);
        if (!entry) return;
        togglePainterGroupVisibility(entry.group_id);
      },
      onLayerLockToggle: (z) => {
        const entry = get_group_entry_for_palette_z(z);
        if (!entry) return;
        togglePainterGroupLock(entry.group_id);
      },
      onLayerRename: (z, newName) => {
        const entry = get_group_entry_for_palette_z(z);
        if (!entry) return;
        renamePainterGroup(entry.group_id, newName);
      },
      onAddLayer: () => {
        addPainterGroupStructure();
      },
      onDeleteLayer: (z) => {
        deletePainterGroupStructure(z);
      },
      onDuplicateLayer: (z) => {
        duplicatePainterGroupStructure(z);
      },
      onMergeDown: (z) => {
        const entry = get_group_entry_for_palette_z(z);
        if (!entry) return;
        const { mergeLayerDown } = require('../ascii_painter/voxel_space.js');
        mergeLayerDown(voxelSpace, entry.legacy_z);
        sync_legacy_group_compat_state({ preserve_group_order: true });
        sync_active_group_to_focus_plane();
        refreshPainterProjectionFromWorld();
        painterImportant('merged layer down', { z: entry.legacy_z });
      },
      onReorderLayers: (newZOrder) => {
        const next_group_order = newZOrder
          .map((fake_z) => get_group_entry_for_palette_z(fake_z)?.group_id ?? null)
          .filter((group_id): group_id is string => !!group_id);
        reorderPainterGroups([...next_group_order].reverse());
      },
      onMove: (new_rect) => {
        if (layer_palette_module) {
          layer_palette_module.rect = new_rect;
          saveModulePosition('layer_palette', new_rect);
        }
      },
      onResize: (new_rect) => {
        if (layer_palette_module) {
          layer_palette_module.rect = new_rect;
        }
      },
      onClose: () => {
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

  let navigation_open = getInitialModuleVisibility('navigation', true);
  let navigation_module: Module | null = null;

  function create_navigation_module(): Module {
    return make_navigation_module({
      id: 'navigation',
      rect: navigation_rect,
      title: 'Navigation',
      get_focus_world_plane: () => painter_display_projection?.focus_world_plane ?? voxelSpace.camera.focus_plane,
      get_focus_slot: () => painter_display_projection?.focus_slot ?? 0,
      get_visible_planes: () => painter_display_projection?.visible_planes ?? [],
      on_action: (action) => {
        switch (action) {
          case 'depth_prev':
            stepPainterDepth(-1);
            break;
          case 'depth_next':
            stepPainterDepth(1);
            break;
          case 'swing_left':
          case 'swing_right':
          case 'swing_up':
          case 'swing_down':
          case 'roll_left':
          case 'roll_right':
            stepPainterViewAction(action);
            break;
        }
      },
      on_move: (new_rect) => {
        if (navigation_module) {
          navigation_module.rect = new_rect;
          saveModulePosition('navigation', new_rect);
        }
      },
      on_resize: (new_rect) => {
        if (navigation_module) {
          navigation_module.rect = new_rect;
          saveModulePosition('navigation', new_rect);
        }
      },
      onClose: () => {
        setModuleOpen('navigation', false, (v) => { navigation_open = v; });
      },
    });
  }

  // Create Camera Control module (closed by default)
  let camera_control_open = getInitialModuleVisibility('camera_control', false);
  let camera_control_module: Module | null = null;

  function create_camera_control_module(): Module {
    return makePlaceCameraControlModule({
      id: 'camera_control',
      rect: camera_control_rect,
      title: 'Painter Camera',
      getCamera: () => voxelSpace.camera,
      slider_specs: {
        movement_per_layer: { ...PAINTER_CAMERA_LIMITS.movement_per_layer, step: 1, digits: 0 },
        scale_per_layer: { ...PAINTER_CAMERA_LIMITS.scale_per_layer, step: 0.01, digits: 2 },
        mouse_angle_yaw_deg: { ...PAINTER_CAMERA_LIMITS.mouse_angle_yaw_deg, step: 0.5, digits: 1 },
        mouse_angle_pitch_deg: { ...PAINTER_CAMERA_LIMITS.mouse_angle_pitch_deg, step: 0.5, digits: 1 },
        mouse_angle_spring: { ...PAINTER_CAMERA_LIMITS.mouse_angle_spring, step: 0.5, digits: 1 },
        calibration_x: { ...PAINTER_CAMERA_LIMITS.calibration, step: 1, digits: 0 },
        calibration_y: { ...PAINTER_CAMERA_LIMITS.calibration, step: 1, digits: 0 },
        render_distance_planes: { ...PAINTER_CAMERA_LIMITS.render_distance_planes, step: 1, digits: 0 },
      },
      action_rows: [
        [
          { id: 'swing_up', label: 'S.Up' },
          { id: 'swing_down', label: 'S.Dn' },
        ],
        [
          { id: 'swing_left', label: 'S.L' },
          { id: 'swing_right', label: 'S.R' },
          { id: 'roll_left', label: 'R.L' },
          { id: 'roll_right', label: 'R.R' },
        ],
      ],
      onAction: (id) => {
        switch (id) {
          case 'swing_up':
          case 'swing_down':
          case 'swing_left':
          case 'swing_right':
          case 'roll_left':
          case 'roll_right':
            stepPainterViewAction(id);
            break;
        }
      },
      onParallaxMoveToggle: (enabled) => {
        voxelSpace.camera.parallax_move_enabled = enabled;
        syncPainterDocumentCameraFromVoxelCamera();
        applyPainterProjectedCameraTuning();
        if (isAppInitialized) {
          saveCameraConfig({ parallax_move_enabled: enabled });
        }
        painterCameraDiag('parallax move toggled', { enabled });
      },
      onParallaxSizeToggle: (enabled) => {
        voxelSpace.camera.parallax_size_enabled = false;
        syncPainterDocumentCameraFromVoxelCamera();
        applyPainterProjectedCameraTuning();
        if (isAppInitialized) {
          saveCameraConfig({ parallax_size_enabled: false });
        }
        painterCameraDiag('parallax size toggled', { enabled: false });
      },
      occlusionLabel: 'Focus Opacity',
      getOcclusionEnabled: () => voxelSpace.camera.use_focus_layer_opacity ?? true,
      onOcclusionToggle: (enabled) => {
        voxelSpace.camera.use_focus_layer_opacity = enabled;
        syncPainterDocumentCameraFromVoxelCamera();
        applyPainterProjectedCameraTuning();
        if (isAppInitialized) {
          saveCameraConfig({ use_focus_layer_opacity: enabled });
        }
        painterCameraDiag('focus opacity toggled', { enabled });
      },
      onCenterTargetToggle: (enabled) => {
        voxelSpace.camera.center_target_in_view = enabled;
        syncPainterDocumentCameraFromVoxelCamera();
        refreshPainterProjectionPreservingCurrentTarget();
        if (isAppInitialized) {
          saveCameraConfig({ center_target_in_view: enabled });
        }
        painterCameraDiag('center target toggled', { enabled });
      },
      onCalibrationChange: (x, y) => {
        const nextCalibration = sanitizePainterCameraConfig({ calibration: { x, y } }).calibration ?? { x: 0, y: 0 };
        voxelSpace.camera.calibration = nextCalibration;
        syncPainterDocumentCameraFromVoxelCamera();
        applyPainterProjectedCameraTuning();
        if (isAppInitialized) {
          savePainterCameraCalibration(nextCalibration);
        }
      },
      onCalibrationReset: () => {
        voxelSpace.camera.calibration = { x: 0, y: 0 };
        syncPainterDocumentCameraFromVoxelCamera();
        applyPainterProjectedCameraTuning();
        if (isAppInitialized) {
          savePainterCameraCalibration({ x: 0, y: 0 });
        }
      },
      onScalePerLayerChange: (value) => {
        const nextValue = sanitizePainterCameraConfig({ scale_per_layer: value }).scale_per_layer ?? 0;
        voxelSpace.camera.scale_per_layer = nextValue;
        syncPainterDocumentCameraFromVoxelCamera();
        applyPainterProjectedCameraTuning();
        if (isAppInitialized) {
          saveCameraConfig({ scale_per_layer: nextValue });
        }
      },
      onMovementPerLayerChange: (value) => {
        const nextValue = sanitizePainterCameraConfig({ movement_per_layer: value }).movement_per_layer ?? 0;
        voxelSpace.camera.movement_per_layer = nextValue;
        syncPainterDocumentCameraFromVoxelCamera();
        applyPainterProjectedCameraTuning();
        if (isAppInitialized) {
          saveCameraConfig({ movement_per_layer: nextValue });
        }
      },
      onMouseAngleYawDegChange: (value) => {
        const nextValue = sanitizePainterCameraConfig({ mouse_angle_yaw_deg: value }).mouse_angle_yaw_deg ?? 0;
        voxelSpace.camera.mouse_angle_yaw_deg = nextValue;
        syncPainterDocumentCameraFromVoxelCamera();
        applyPainterProjectedCameraTuning();
        if (isAppInitialized) {
          saveCameraConfig({ mouse_angle_yaw_deg: nextValue });
        }
      },
      onMouseAnglePitchDegChange: (value) => {
        const nextValue = sanitizePainterCameraConfig({ mouse_angle_pitch_deg: value }).mouse_angle_pitch_deg ?? 0;
        voxelSpace.camera.mouse_angle_pitch_deg = nextValue;
        syncPainterDocumentCameraFromVoxelCamera();
        applyPainterProjectedCameraTuning();
        if (isAppInitialized) {
          saveCameraConfig({ mouse_angle_pitch_deg: nextValue });
        }
      },
      onMouseAngleSpringChange: (value) => {
        const nextValue = sanitizePainterCameraConfig({ mouse_angle_spring: value }).mouse_angle_spring ?? voxelSpace.camera.mouse_angle_spring;
        voxelSpace.camera.mouse_angle_spring = nextValue;
        syncPainterDocumentCameraFromVoxelCamera();
        applyPainterProjectedCameraTuning();
        if (isAppInitialized) {
          saveCameraConfig({ mouse_angle_spring: nextValue });
        }
      },
      onRenderDistancePlanesChange: (value) => {
        const nextValue = sanitizePainterCameraConfig({ render_distance_planes: value }).render_distance_planes ?? 2;
        voxelSpace.camera.render_distance_planes = nextValue;
        syncPainterDocumentCameraFromVoxelCamera();
        refreshPainterProjectionPreservingCurrentTarget();
        if (isAppInitialized) {
          saveCameraConfig({ render_distance_planes: nextValue });
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
  weight_selector_module = create_weight_selector_module();
  toolbox_module = create_toolbox_module();
  tool_properties_module = create_tool_properties_module();
  navigation_module = create_navigation_module();
  camera_control_module = create_camera_control_module();
  controls_module = create_controls_panel_module();
  registry.register(char_selector_module);
  registry.register(brush_preview_module);
  registry.register(color_selector_module);
  registry.register(weight_selector_module);
  registry.register(toolbox_module);
  registry.register(tool_properties_module);
  registry.register(navigation_module);
  registry.register(camera_control_module);
  registry.register(controls_module);

  registry.set_visibility('char_selector', char_selector_open);
  registry.set_visibility('brush_preview', brush_preview_open);
  registry.set_visibility('color_selector', color_selector_open);
  registry.set_visibility('weight_selector', weight_selector_open);
  registry.set_visibility('toolbox', toolbox_open);
  registry.set_visibility('tool_properties', tool_properties_open);
  registry.set_visibility('layer_palette', layer_palette_open);
  registry.set_visibility('navigation', navigation_open);
  registry.set_visibility('camera_control', camera_control_open);
  registry.set_visibility('controls_panel', controls_open);

  window.addEventListener('keydown', (e) => {
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
  
  return {
    modules: registry.get_all(),
    module_registry: registry,
    multiplayer_sync: painter_sync,
    update_layout,

     on_pointer_move_global: (x: number, y: number) => {
       last_pointer_x = x;
       last_pointer_y = y;
     },
    
    export_grid: () => {
      const data = exportGrid(grid);
      return JSON.stringify(data, null, 2);
    },
    
    import_grid: (json: string) => {
      try {
        const data = JSON.parse(json);
        const new_grid = importGrid(data);
        // Copy new grid data
        voxelSpace = gridToVoxelSpace(new_grid, 0);
        rebuild_runtime_from_voxel_space();
        clear_world_selection(world_selection);
        syncPainterCameraViewTransform();
        ensureValidFocusPlane();
        setPainterCameraTargetWorld(getPainterDocumentCenterWorld());
        painter_display_projection = rebuildPainterDisplayProjection(getPainterDisplayViewState(), { kind: 'viewport_center', screen: null, world: painter_camera_target_world });
        syncProjectedGridFromDisplay();
        syncDOMRenderer();
        resetPainterHistoryState('import legacy grid');
      } catch (e) {
        diag_log('painter', 'important', 'PAINTER', 'failed to import grid', { error: e instanceof Error ? e.message : String(e) }, { sink: 'error' });
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

    new_canvas: (width: number, height: number) => {
      const document = create_painter_document(width, height, { min_z: 0, max_z: 0, default_group_name: 'Group 1' });
      applyPainterDocumentSnapshot(document);
      clearActiveFileAssociation('untitled', { clearLastUsed: true });
      clearAutoSave();
      painterImportant('new canvas created', { width, height, group_count: painter_document_runtime.document.group_order.length });
    },

    current_filename,
    
    // Document operations
    export_document: () => {
      return exportPainterDocumentToJSON(exportCurrentPainterDocument());
    },
    
    import_legacy_voxel_space: (json: string) => {
      try {
        const { importVoxelSpace } = require('../ascii_painter/voxel_space.js');
        const parsed = JSON.parse(json);
        voxelSpace = importVoxelSpace(parsed);
        rebuild_runtime_from_voxel_space({ preserve_group_order: true });
        clear_world_selection(world_selection);
        syncPainterCameraViewTransform();
        ensureValidFocusPlane();
        setPainterCameraTargetWorld(getPainterDocumentCenterWorld());
        painter_display_projection = rebuildPainterDisplayProjection(getPainterDisplayViewState(), { kind: 'viewport_center', screen: null, world: painter_camera_target_world });
        syncProjectedGridFromDisplay();
        syncDOMRenderer();
        resetPainterHistoryState('import legacy voxel space');
        painterImportant('imported legacy voxel space');
        painterDiag('imported legacy voxel space summary', { summary: debugVoxelSpace(voxelSpace) });
      } catch (e) {
        diag_log('painter', 'important', 'PAINTER', 'failed to import legacy voxel space', { error: e instanceof Error ? e.message : String(e) }, { sink: 'error' });
      }
    },
    
    get_legacy_voxel_space: () => voxelSpace,
    
    set_camera_mode: (_mode: CameraMode) => {
      voxelSpace.camera.mode = 'rotated_ortho';
    },
    
    set_parallax_intensity: (intensity: number) => {
      voxelSpace.camera.parallax_intensity = Math.max(0, Math.min(1, intensity));
    },
    
    toggle_show_all_layers: () => {
      voxelSpace.camera.use_focus_layer_opacity = !voxelSpace.camera.use_focus_layer_opacity;
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
        const transitionTargetWorld = painter_transition_anchor?.target_world ?? getPainterFallbackTargetWorld();
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
        domRenderer.setSpace(getPainterRenderSpace());
        domRenderer.setMouseParallax(mouseParallax.x, mouseParallax.y);
        painter_view_transition = resolved.transition;
        if (!resolved.frame.active) {
          painter_transition_anchor = null;
        }
        if (viewChanged && isAppInitialized) {
          saveCameraConfig({ principal_view: painter_target_view.principal_view, roll_quarter_turn: painter_target_view.roll_quarter_turn });
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
      const config = loadCameraConfig();
      painterCameraDiag('debug camera config', { config, voxel_camera: voxelSpace.camera, isAppInitialized });
      return config;
    },

    // Force save camera config
    force_save_camera: () => {
      saveCameraConfig({
        painter_calibration: voxelSpace.camera.calibration,
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
