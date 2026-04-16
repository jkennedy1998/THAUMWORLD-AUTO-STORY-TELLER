/**
 * ASCII Painter App State
 * 
 * Creates the module graph for the immersive ASCII painter.
 * Uses the mono_ui module system with panning, zooming, and drawing tools.
 */

import type { Module, Rect, Rgb } from '../mono_ui/types.js';
import { create_module_registry, type ModuleRegistry } from '../mono_ui/module_registry.js';
import type { Grid, Brush, ToolType } from '../ascii_painter/types.js';
import { createGrid, exportGrid, importGrid } from '../ascii_painter/types.js';
import { createHistoryManager, logLayerAction, pushSnapshot, canUndo, canRedo, getHistoryState } from '../ascii_painter/history.js';
import { get_color_by_name } from '../mono_ui/colors.js';
import type { SelectionMode } from '../ascii_painter/selection.js';
import { clearSelection, createSelectionBitmap, invertSelection, isSelected, selectAll, setSelected, type SelectionBitmap } from '../ascii_painter/selection.js';
import { make_painter_canvas_module, type PainterInteractionAnchor } from '../mono_ui/modules/painter_canvas_module.js';
import { make_painter_toolbar_module } from '../mono_ui/modules/painter_toolbar_module.js';
import { make_file_menu_module } from '../mono_ui/modules/painter_file_menu_module.js';
import { make_character_selector_module } from '../mono_ui/modules/character_selector_module.js';
import { make_brush_preview_module } from '../mono_ui/modules/brush_preview_module.js';
import { make_color_selector_module } from '../mono_ui/modules/color_selector_module.js';
import { make_weight_selector_module } from '../mono_ui/modules/weight_selector_module.js';
import { make_toolbox_module } from '../mono_ui/modules/toolbox_module.js';
import { make_tool_properties_module } from '../mono_ui/modules/tool_properties_module.js';
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
  // 3D VoxelSpace support
  exportVoxelSpaceToJSON,
  exportVoxelSpaceArtworkToJSON,
  importVoxelSpaceFromJSON,
  autoSaveVoxelSpace,
  loadAutoSaveVoxelSpace,
  exportVoxelSpaceToText,
  // Tool properties persistence
  saveToolProperties,
  loadToolProperties,
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
  getVisibleLayers,
  voxelSpaceToGrid,
  gridToVoxelSpace,
  debugVoxelSpace,
  createDefaultCamera,
} from '../ascii_painter/voxel_space.js';
import { makeLayerRendererModule } from '../ascii_painter/layer_renderer_module.js';
import { makeLayerPaletteModule } from '../ascii_painter/layer_palette_module.js';
import { makePlaceCameraControlModule } from '../mono_ui/modules/place_camera_control_module.js';
import { VoxelDOMRenderer, createVoxelDOMRenderer } from '../ascii_painter/voxel_dom_renderer.js';
import { commit_grid_to_painter_world, get_painter_focus_slot_for_anchor, get_painter_projection_focus_content_bounds, get_painter_world_content_bounds_center, painter_projection_grid_point_to_world, painter_projection_world_to_grid_point, project_painter_display_space, sync_grid_to_painter_projection, type PainterDisplayProjection } from '../ascii_painter/painter_view_projection_adapter.js';
import { touch_world_layers_owner } from '../mono_ui/world_layers_owner.js';
import { get_transition_tilt_for_command, make_place_view_state, type PlaceViewState } from '../mono_ui/runtime/place_view_projection.js';
import { start_roll_transition, start_swing_transition, type PlaceCameraTransition } from '../mono_ui/runtime/place_camera_pose.js';
import { clamp_anchor_to_viewport_px, compute_anchor_relative_mouse_parallax } from '../mono_ui/runtime/camera_anchor_runtime.js';
import { resolve_place_view_transition_frame } from '../mono_ui/runtime/place_view_camera_runtime.js';
import { apply_world_selection_mode, clear_world_selection, create_world_copy_data_from_selection, create_world_selection, decode_world_copy_data, encode_world_copy_data, get_world_selection_bounds, has_world_selection, set_world_selected, type WorldCopyData, type WorldSelection } from '../ascii_painter/world_selection.js';
import { project_world_point_with_roll, unproject_plane_point_with_roll } from '../mono_ui/runtime/place_view_projection.js';
import { create_painter_controls_runtime } from './controls_wiring.js';
import { control_binding_matches_keyboard_event } from '../mono_ui/runtime/controls_binding_matcher.js';
import { create_painter_tool_shortcut_interpreter } from './painter_tool_shortcut_interpreter.js';
import { create_painter_tool_assisted_inputs_wiring } from './painter_tool_assisted_inputs_wiring.js';
import {
  THAUMWORLD_RENDER_THEME,
  get_theme_base_font_size_px,
  get_theme_font_family,
  get_theme_weight_index_to_css,
} from '../mono_ui/runtime/render_theme.js';

// Configuration matching the game but with relaxed letter spacing
export const PAINTER_CONFIG = {
  render_backend: THAUMWORLD_RENDER_THEME.backend,
  render_theme_id: THAUMWORLD_RENDER_THEME.id,
  font_family: get_theme_font_family(THAUMWORLD_RENDER_THEME),
  base_font_size_px: get_theme_base_font_size_px(THAUMWORLD_RENDER_THEME),
  base_line_height_mult: 1,
  base_letter_spacing_mult: 0,
  weight_index_to_css: get_theme_weight_index_to_css(THAUMWORLD_RENDER_THEME),
  grid_width: 200,
  grid_height: 50,
} as const;

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

  // VoxelSpace operations (new 3D system)
  export_voxel_space: () => string;
  import_voxel_space: (json: string) => void;
  get_voxel_space: () => VoxelSpace;
  set_camera_mode: (mode: CameraMode) => void;
  set_parallax_intensity: (intensity: number) => void;
  toggle_show_all_layers: () => void;

  // Layer operations
  add_layer: () => void;
  delete_layer: (z: number) => void;
  duplicate_layer: (z: number) => void;
  select_layer: (z: number) => void;
  toggle_layer_visibility: (z: number) => void;
  toggle_layer_lock: (z: number) => void;

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

export function create_painter_app_state(): PainterAppState {
  // Create the drawing grid (legacy 2D)
  const grid = createGrid(CANVAS_WIDTH, CANVAS_HEIGHT);
  
  // Create VoxelSpace (new 3D system) - wraps the grid
  let voxelSpace = createVoxelSpace(CANVAS_WIDTH, CANVAS_HEIGHT, { defaultZ: 0 });

  function mergeSavedPainterCameraConfig(config: ReturnType<typeof loadCameraConfig> | null | undefined): void {
    if (!config || Object.keys(config).length < 1) return;
    voxelSpace.camera = { ...voxelSpace.camera, ...config };
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
  let painter_camera_target_world = { x: Math.floor(voxelSpace.bounds.width / 2), y: Math.floor(voxelSpace.bounds.height / 2), z: voxelSpace.camera.focus_plane };
  let painter_display_projection!: PainterDisplayProjection;

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

  const toolbar_rect: Rect = {
    x0: 0,
    y0: GRID_HEIGHT - 3,
    x1: GRID_WIDTH - 1,
    y1: GRID_HEIGHT - 1
  };

  let canvas_rect: Rect = get_default_canvas_rect();

  function getPainterViewState(): PlaceViewState {
    return make_place_view_state(voxelSpace.camera.principal_view, voxelSpace.camera.roll_quarter_turn);
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
    const visibleZs = Array.from(voxelSpace.layers.keys()).sort((a, b) => a - b);
    const fallbackZ = typeof voxelSpace.camera.focus_plane === 'number'
      ? voxelSpace.camera.focus_plane
      : (visibleZs[0] ?? 0);
    return {
      x: Math.max(0, Math.min(voxelSpace.bounds.width - 1, painter_camera_target_world.x)),
      y: Math.max(0, Math.min(voxelSpace.bounds.height - 1, painter_camera_target_world.y)),
      z: Math.max(voxelSpace.bounds.minZ, Math.min(voxelSpace.bounds.maxZ, Number.isFinite(painter_camera_target_world.z) ? painter_camera_target_world.z : fallbackZ)),
    };
  }

  function getPainterProjectionAnchorWorld(): { x: number; y: number; z: number } {
    return get_painter_world_content_bounds_center(voxelSpace);
  }

  function setPainterCameraTargetWorld(world: { x: number; y: number; z: number } | null | undefined): void {
    if (!world) return;
    painter_camera_target_world = {
      x: Math.max(0, Math.min(voxelSpace.bounds.width - 1, Math.floor(world.x))),
      y: Math.max(0, Math.min(voxelSpace.bounds.height - 1, Math.floor(world.y))),
      z: Math.max(voxelSpace.bounds.minZ, Math.min(voxelSpace.bounds.maxZ, Math.floor(world.z))),
    };
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

  function rebuildPainterDisplayProjection(viewState: PlaceViewState, anchor: PainterInteractionAnchor): PainterDisplayProjection {
    setPainterCameraTargetWorld(anchor.world ?? null);
    const targetWorld = getPainterFallbackTargetWorld();
    const projectionAnchorWorld = getPainterProjectionAnchorWorld();
    const viewport = getPainterViewportTiles();
    const projected = project_painter_display_space({
      source: voxelSpace,
      view_state: viewState,
      focus_slot: getCurrentPainterFocusSlot(),
      target_world: targetWorld,
      projection_anchor_world: projectionAnchorWorld,
      viewport_width: viewport.width,
      viewport_height: viewport.height,
      center_target_in_view: shouldCenterPainterTarget(anchor),
    });
    const focus = get_painter_focus_slot_for_anchor({
      anchor_world: targetWorld,
      view_state: viewState,
      visible_planes: projected.visible_planes,
      fallback_world_plane: targetWorld.z,
    });
    projected.focus_slot = focus.focus_slot;
    projected.focus_world_plane = focus.focus_world_plane;
    projected.space.camera.focus_plane = focus.focus_slot;
    voxelSpace.camera.focus_plane = focus.focus_world_plane ?? voxelSpace.camera.focus_plane;
    return projected;
  }

  function syncProjectedGridFromDisplay(): void {
    if (!painter_display_projection) return;
    sync_grid_to_painter_projection(grid, painter_display_projection);
  }

  function commitProjectedGridToWorld(): void {
    if (!painter_display_projection) return;
    commit_grid_to_painter_world({
      source: voxelSpace,
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
    projectedCamera.mode = 'rotated_ortho';
    (projectedCamera as any).pan_behavior = 'uniform';
    projectedCamera.pan_x = 0;
    projectedCamera.pan_y = 0;
    projectedCamera.show_all_layers = true;
    projectedCamera.use_focus_layer_opacity = voxelSpace.camera.use_focus_layer_opacity;
    projectedCamera.center_target_in_view = voxelSpace.camera.center_target_in_view;
    projectedCamera.parallax_intensity = voxelSpace.camera.parallax_intensity;
    projectedCamera.parallax_move_enabled = voxelSpace.camera.parallax_move_enabled;
    projectedCamera.parallax_size_enabled = voxelSpace.camera.parallax_size_enabled;
    projectedCamera.scale_per_layer = voxelSpace.camera.scale_per_layer;
    projectedCamera.movement_per_layer = voxelSpace.camera.movement_per_layer;
    projectedCamera.mouse_angle_yaw_deg = voxelSpace.camera.mouse_angle_yaw_deg;
    projectedCamera.mouse_angle_pitch_deg = voxelSpace.camera.mouse_angle_pitch_deg;
    projectedCamera.mouse_angle_spring = voxelSpace.camera.mouse_angle_spring;
    projectedCamera.base_layer_scale = voxelSpace.camera.base_layer_scale;
    projectedCamera.char_spacing_x = voxelSpace.camera.char_spacing_x;
    projectedCamera.char_spacing_y = voxelSpace.camera.char_spacing_y;
    projectedCamera.calibration = { ...voxelSpace.camera.calibration };
    projectedCamera.euler_rotation = { x: 0, y: 0, z: 0 };
    (projectedCamera as any).transition_euler = args?.transition_euler ? { ...args.transition_euler } : { x: 0, y: 0, z: 0 };
    if (args?.visual_pivot_px) {
      (projectedCamera as any).visual_pivot_px = { ...args.visual_pivot_px };
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

  painter_display_projection = project_painter_display_space({
    source: voxelSpace,
    view_state: getPainterViewState(),
    focus_slot: 0,
    target_world: getPainterFallbackTargetWorld(),
    projection_anchor_world: getPainterProjectionAnchorWorld(),
    viewport_width: Math.max(1, canvas_rect.x1 - canvas_rect.x0 + 1),
    viewport_height: Math.max(1, canvas_rect.y1 - canvas_rect.y0 + 1),
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

  function refreshPainterProjectionFromWorld(anchor: PainterInteractionAnchor = getPainterInteractionAnchor()): void {
    painter_display_projection = rebuildPainterDisplayProjection(getPainterViewState(), anchor);
    syncProjectedGridFromDisplay();
    syncPainterCanvasSelectionFromWorld();
    applyPainterProjectedCameraTuning();
    syncDOMRenderer();
  }

  function addPainterLayer(): void {
    finalizePendingPainterCanvasChanges();
    commitProjectedGridToWorld();
    const zs = Array.from(voxelSpace.layers.keys());
    const maxZ = zs.length > 0 ? Math.max(...zs) : 0;
    const newZ = maxZ + 1;
    addLayer(voxelSpace, newZ, `Layer ${newZ}`);
    const newLayer = getLayer(voxelSpace, newZ);
    if (newLayer) {
      logLayerAction(history, 'add_layer', `Add Layer ${newZ}`, newZ, newLayer);
    }
    voxelSpace.camera.focus_plane = newZ;
    if (isAppInitialized) {
      saveCameraConfig({ focus_plane: newZ });
    }
    refreshPainterProjectionFromWorld();
    pushSnapshot(history, grid);
    schedule_auto_save();
    console.log('➕ Added layer at Z=', newZ);
  }

  function deletePainterLayer(z: number): void {
    try {
      finalizePendingPainterCanvasChanges();
      commitProjectedGridToWorld();
      const layerToDelete = getLayer(voxelSpace, z);
      removeLayer(voxelSpace, z);
      if (layerToDelete) {
        logLayerAction(history, 'delete_layer', `Delete Layer ${z}`, z, layerToDelete);
      }
      if (z === voxelSpace.camera.focus_plane) {
        const remainingZs = Array.from(voxelSpace.layers.keys());
        if (remainingZs.length > 0) {
          voxelSpace.camera.focus_plane = remainingZs[0]!;
        }
      }
      refreshPainterProjectionFromWorld();
      console.log('🗑️ Deleted layer at Z=', z);
    } catch (e) {
      console.error('Cannot delete layer:', e);
    }
  }

  function duplicatePainterLayer(z: number): void {
    finalizePendingPainterCanvasChanges();
    commitProjectedGridToWorld();
    const zs = Array.from(voxelSpace.layers.keys());
    const maxZ = zs.length > 0 ? Math.max(...zs) : 0;
    const newZ = maxZ + 1;
    duplicateLayer(voxelSpace, z, newZ);
    const newLayer = getLayer(voxelSpace, newZ);
    if (newLayer) {
      logLayerAction(history, 'duplicate_layer', `Duplicate Layer ${z} → ${newZ}`, newZ, newLayer, z, newZ);
    }
    voxelSpace.camera.focus_plane = newZ;
    refreshPainterProjectionFromWorld();
    console.log('📋 Duplicated layer', z, 'to', newZ);
  }

  function selectPainterLayer(z: number): void {
    finalizePendingPainterCanvasChanges();
    commitProjectedGridToWorld();
    voxelSpace.camera.focus_plane = z;
    if (isAppInitialized) {
      saveCameraConfig({ focus_plane: z });
    }
    refreshPainterProjectionFromWorld();
    console.log('✓ Selected layer/plane=', z);
  }

  function togglePainterLayerVisibility(z: number): void {
    finalizePendingPainterCanvasChanges();
    commitProjectedGridToWorld();
    const layer = getLayer(voxelSpace, z);
    if (layer) {
      layer.visible = !layer.visible;
      refreshPainterProjectionFromWorld();
      console.log('👁 Layer', z, 'visible:', layer.visible);
    }
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
      const projected = project_world_point_with_roll({ x, y, z }, painter_display_projection.view_state);
      const slot = painter_display_projection.visible_planes.findIndex((plane) => Math.floor(plane) === Math.floor(projected.plane));
      if (slot < 0) continue;
      const gridPoint = {
        x: projected.u - painter_display_projection.projected_bounds.min_u,
        y: projected.v - painter_display_projection.projected_bounds.min_v,
      };
      if (gridPoint.x < 0 || gridPoint.x >= painter_display_projection.projected_bounds.width || gridPoint.y < 0 || gridPoint.y >= painter_display_projection.projected_bounds.height) continue;
      const cell = getVoxel(voxelSpace, x, y, z);
      if (!cell || cell.char === ' ') continue;
      const key2 = `${gridPoint.x},${gridPoint.y}`;
      const prev = byGrid.get(key2);
      if (!prev || slot >= prev.slot) {
        byGrid.set(key2, { x: gridPoint.x, y: gridPoint.y, char: cell.char, weight_index: cell.weight_index, slot });
      }
    }
    return Array.from(byGrid.values()).map(({ x, y, char, weight_index }) => ({ x, y, char, weight_index }));
  }

  function getPainterSelectionStatus(): string | null {
    if (!has_world_selection(world_selection)) return null;
    const bounds = get_world_selection_bounds(world_selection);
    if (!bounds) return null;
    const planeCount = (bounds.max_z - bounds.min_z + 1);
    return `SEL ${world_selection.cells.size} vox / ${planeCount} planes / Z:${bounds.min_z}->${bounds.max_z}`;
  }

  function updateWorldSelectionFromProjectedBitmap(mode: SelectionMode, depthRange?: { depthMin?: number; depthMax?: number; kind?: 'rect' | 'lasso' | 'clear' | 'select_all' | 'invert' | 'other' }): void {
    if (depthRange?.kind === 'clear') {
      clear_world_selection(world_selection);
      syncPainterCanvasSelectionFromWorld();
      return;
    }
    if (depthRange?.kind === 'select_all') {
      clear_world_selection(world_selection);
      for (const [z, layer] of voxelSpace.layers.entries()) {
        for (let y = 0; y < voxelSpace.bounds.height; y += 1) {
          const row = layer.cells[y];
          if (!row) continue;
          for (let x = 0; x < voxelSpace.bounds.width; x += 1) {
            const cell = row[x];
            if (!cell || cell.char === ' ') continue;
            set_world_selected(world_selection, x, y, z, true);
          }
        }
      }
      syncPainterCanvasSelectionFromWorld();
      return;
    }
    if (depthRange?.kind === 'invert') {
      const next = create_world_selection();
      for (const [z, layer] of voxelSpace.layers.entries()) {
        for (let y = 0; y < voxelSpace.bounds.height; y += 1) {
          const row = layer.cells[y];
          if (!row) continue;
          for (let x = 0; x < voxelSpace.bounds.width; x += 1) {
            const cell = row[x];
            if (!cell || cell.char === ' ') continue;
            const key = `${x},${y},${z}` as const;
            if (!world_selection.cells.has(key)) set_world_selected(next, x, y, z, true);
          }
        }
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
    if (action === 'roll_left' || action === 'roll_right') {
      const direction = action === 'roll_left' ? 'left' : 'right';
      painter_view_transition = start_roll_transition(direction, now, current.roll_quarter_turn, get_transition_tilt_for_command(current, 'roll', direction, 45));
      return;
    }
    const direction = action.replace('swing_', '') as 'left' | 'right' | 'up' | 'down';
    painter_view_transition = start_swing_transition(direction, now, get_transition_tilt_for_command(current, 'swing', direction, 45));
  }

  // Initialize DOM renderer when container is available
  function initDOMRenderer(): void {
    if (domRenderer) return; // Already initialized

    const container = document.getElementById('voxel_layers_container');
    if (!container) {
      console.warn('[Painter] Voxel layers container not found, DOM renderer not initialized');
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
    domRenderer.setSpace(painter_display_projection.space);
    console.log('[Painter] DOM renderer initialized');
  }

  // Sync DOM renderer with current voxelSpace
  function syncDOMRenderer(): void {
    if (domRenderer) {
      applyPainterProjectedCameraTuning();
      domRenderer.setSpace(painter_display_projection.space);
    }
  }

  function ensureValidFocusPlane(): void {
    const zs = Array.from(voxelSpace.layers.keys()).sort((a, b) => a - b);
    if (zs.length === 0) {
      voxelSpace.camera.focus_plane = 0;
      return;
    }
    if (!voxelSpace.layers.has(voxelSpace.camera.focus_plane)) {
      voxelSpace.camera.focus_plane = zs[0]!;
    }
  }

  // Create history manager
  const history = createHistoryManager(50);

  // Try to load auto-save on startup (try VoxelSpace first, then fallback to Grid)
  const saved_voxel_space = loadAutoSaveVoxelSpace();
  if (saved_voxel_space) {
    console.log('[Painter bootstrap] restoring autosaved VoxelSpace');
    voxelSpace = saved_voxel_space;
    // Re-apply saved camera config after loading auto-save (camera settings are global, not per-artwork)
    const savedCameraConfig = loadCameraConfig();
    mergeSavedPainterCameraConfig(savedCameraConfig);
    syncPainterCameraViewTransform();
    ensureValidFocusPlane();
    setPainterCameraTargetWorld({ x: Math.floor(voxelSpace.bounds.width / 2), y: Math.floor(voxelSpace.bounds.height / 2), z: voxelSpace.camera.focus_plane });
    painter_display_projection = rebuildPainterDisplayProjection(getPainterViewState(), { kind: 'viewport_center', screen: null, world: painter_camera_target_world });
    syncProjectedGridFromDisplay();
    syncDOMRenderer();
    console.log('🎨 Loaded auto-saved VoxelSpace artwork');
  } else {
    // Fallback to legacy grid auto-save
    const saved_grid = loadAutoSave();
    if (saved_grid) {
      console.log('[Painter bootstrap] restoring legacy autosaved grid');
      grid.width = saved_grid.width;
      grid.height = saved_grid.height;
      grid.cells = saved_grid.cells;
      // Sync voxelSpace to grid
      voxelSpace = gridToVoxelSpace(grid, 0);
      // Re-apply saved camera config after loading legacy auto-save
      const savedCameraConfig = loadCameraConfig();
      mergeSavedPainterCameraConfig(savedCameraConfig);
      syncPainterCameraViewTransform();
      ensureValidFocusPlane();
      setPainterCameraTargetWorld({ x: Math.floor(voxelSpace.bounds.width / 2), y: Math.floor(voxelSpace.bounds.height / 2), z: voxelSpace.camera.focus_plane });
      painter_display_projection = rebuildPainterDisplayProjection(getPainterViewState(), { kind: 'viewport_center', screen: null, world: painter_camera_target_world });
      syncProjectedGridFromDisplay();
      syncDOMRenderer();
      console.log('🎨 Loaded auto-saved artwork (legacy format)');
    }
  }

  pushSnapshot(history, grid);
  
  // Load saved tool properties
  const saved_tool_props = loadToolProperties();
  
  // Current tool state
  let current_tool: ToolType = 'pencil';
  
  // Tool mapping for left/right click
  let left_click_tool: ToolType = saved_tool_props.left_click_tool as ToolType || 'pencil';
  let right_click_tool: ToolType = saved_tool_props.right_click_tool as ToolType || 'eraser';

  function assign_left_click_tool(tool: ToolType): void {
    left_click_tool = tool;
    current_tool = tool;
    active_property_side = 'left';
    saveToolProperties({ left_click_tool: tool, active_property_side: 'left' });
  }

  function assign_right_click_tool(tool: ToolType): void {
    right_click_tool = tool;
    current_tool = tool;
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

  function getBrushForSide(side: 'left' | 'right'): Brush {
    return side === 'right' ? right_brush : left_brush;
  }

  function getBrushForButton(button: number): Brush {
    return getBrushForSide(button === 2 ? 'right' : 'left');
  }

  function getBrushSizeForSide(side: 'left' | 'right'): number {
    return side === 'right' ? right_brush_size : left_brush_size;
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
  console.log('[Painter bootstrap] tool properties loaded');
  console.log('[Painter bootstrap] gradiator state loaded', {
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
  const world_selection: WorldSelection = create_world_selection();
  let world_clipboard_data: WorldCopyData | null = null;
  const LAST_FILE_PATH_KEY = 'thaumworld_ascii_painter_last_file_path';

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

  async function writeArtworkToFileAtomic(filePath: string): Promise<void> {
    const data = exportVoxelSpaceArtworkToJSON(voxelSpace);
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
    autoSaveVoxelSpace(voxelSpace, current_filename);
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
        console.log('💾 Auto-saved artwork');
      }).catch((e) => {
        console.warn('Auto-save failed:', e);
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
    console.log('[Painter bootstrap] loading artwork content', { loadedPath: loadedPath ?? null, size: content.length });
    voxelSpace = importVoxelSpaceFromJSON(content);
    clear_world_selection(world_selection);

    // Apply persisted camera/UI settings (do not import from file)
    const savedCam = loadCameraConfig();
    if (savedCam && Object.keys(savedCam).length > 0) {
      voxelSpace.camera = { ...createDefaultCamera(), ...savedCam };
    }

    ensureValidFocusPlane();
    setPainterCameraTargetWorld({ x: Math.floor(voxelSpace.bounds.width / 2), y: Math.floor(voxelSpace.bounds.height / 2), z: voxelSpace.camera.focus_plane });
    painter_display_projection = rebuildPainterDisplayProjection(getPainterViewState(), { kind: 'viewport_center', screen: null, world: painter_camera_target_world });
    syncProjectedGridFromDisplay();
    syncDOMRenderer();

    pushSnapshot(history, grid);

    if (loadedPath) {
      current_file_path = loadedPath;
      current_filename = inferFilenameFromPath(loadedPath);
      try {
        window.localStorage.setItem(LAST_FILE_PATH_KEY, loadedPath);
      } catch {
        // ignore
      }
    }

    schedule_auto_save();
  }

  async function new_file(): Promise<void> {
    const dir = await getAsciiDrawingsDir();
    if (!dir) {
      // Fallback: just create a new in-memory canvas
      voxelSpace = createVoxelSpace(CANVAS_WIDTH, CANVAS_HEIGHT, { defaultZ: 0 });
      clear_world_selection(world_selection);
      const savedCam = loadCameraConfig();
      if (savedCam && Object.keys(savedCam).length > 0) {
        voxelSpace.camera = { ...voxelSpace.camera, ...savedCam };
      }
      syncPainterCameraViewTransform();
      ensureValidFocusPlane();
      setPainterCameraTargetWorld({ x: Math.floor(voxelSpace.bounds.width / 2), y: Math.floor(voxelSpace.bounds.height / 2), z: voxelSpace.camera.focus_plane });
      painter_display_projection = rebuildPainterDisplayProjection(getPainterViewState(), { kind: 'viewport_center', screen: null, world: painter_camera_target_world });
      syncProjectedGridFromDisplay();
      syncDOMRenderer();
      pushSnapshot(history, grid);
      current_filename = 'untitled';
      current_file_path = null;
      clearAutoSave();
      return;
    }

    const basename = makeNewFileBasename();
    const filePath = `${dir}\\${basename}`;

    voxelSpace = createVoxelSpace(CANVAS_WIDTH, CANVAS_HEIGHT, { defaultZ: 0 });
    clear_world_selection(world_selection);
    const savedCam = loadCameraConfig();
    if (savedCam && Object.keys(savedCam).length > 0) {
      voxelSpace.camera = { ...voxelSpace.camera, ...savedCam };
    }
    syncPainterCameraViewTransform();
    ensureValidFocusPlane();
    setPainterCameraTargetWorld({ x: Math.floor(voxelSpace.bounds.width / 2), y: Math.floor(voxelSpace.bounds.height / 2), z: voxelSpace.camera.focus_plane });
    painter_display_projection = rebuildPainterDisplayProjection(getPainterViewState(), { kind: 'viewport_center', screen: null, world: painter_camera_target_world });
    syncProjectedGridFromDisplay();
    syncDOMRenderer();
    pushSnapshot(history, grid);

    current_file_path = filePath;
    current_filename = inferFilenameFromPath(filePath);
    try {
      window.localStorage.setItem(LAST_FILE_PATH_KEY, filePath);
    } catch {
      // ignore
    }

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
      const data = exportVoxelSpaceArtworkToJSON(voxelSpace);
      downloadFile(data, name, 'application/json');
      return;
    }
    await writeArtworkToFileAtomic(current_file_path);
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
  
  // Keyboard shortcuts for layer navigation
  // NOTE: Page Up/Down and Tab removed - use Layer Palette UI buttons instead
  
  // Create toolbar module
  const toolbar_module = make_painter_toolbar_module({
    id: 'painter_toolbar',
    rect: toolbar_rect,
    get_current_tool: () => current_tool,
    on_tool_select: (tool) => {
      current_tool = tool;
      // Update the toolbar module's tool reference
      // The module will re-render with the new selection
    },
    matches_tool_shortcut: (tool, e) => painter_controls.matches_tool_shortcut(tool, e),
    on_tool_shortcut: (tool) => {
      painter_tool_shortcut_interpreter.trigger(tool);
    },
  });
  
  // Create canvas module
  const canvas_module = make_painter_canvas_module({
    id: 'painter_canvas',
    rect: canvas_rect,
    grid,
    get_space: () => voxelSpace,
    get_selected_z: () => voxelSpace.camera.focus_plane,
    get_current_tool: () => current_tool,
    get_preview_brush: () => getPreviewBrush(),
    get_brush_for_button: (button) => getBrushForButton(button),
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
    get_focus_layer_z: () => voxelSpace.camera.focus_plane,
    get_focus_world_plane: () => painter_display_projection?.focus_world_plane ?? voxelSpace.camera.focus_plane,
    cycle_focus_layer: (dir) => {
      commitProjectedGridToWorld();
      const slots = painter_display_projection.visible_planes;
      const currentSlot = painter_display_projection.focus_slot;
      const nextSlot = Math.max(0, Math.min(Math.max(0, slots.length - 1), currentSlot + dir));
      const nextPlane = slots[nextSlot];
      if (typeof nextPlane === 'number' && nextSlot !== currentSlot) {
        voxelSpace.camera.focus_plane = nextPlane;
        painter_display_projection.focus_slot = nextSlot;
        painter_display_projection.focus_world_plane = nextPlane;
        painter_display_projection.space.camera.focus_plane = nextSlot;
        syncProjectedGridFromDisplay();
      }
    },
    history,
    on_push_snapshot: () => {
      commitProjectedGridToWorld();
      pushSnapshot(history, grid);
      schedule_auto_save();
    },
    on_sample_cell: (cell, button) => {
      active_property_side = button === 2 ? 'right' : 'left';
      const brush = getBrushForButton(button);
      brush.char = cell.char;
      brush.rgb = { ...cell.rgb };
      brush.weight_index = cell.weight_index;
      saveBrushState(active_property_side);
    },
    on_selection_change: (args) => {
      updateWorldSelectionFromProjectedBitmap(selection_mode, args);
    },
    get_selection_overlay_cells: () => getProjectedSelectionOverlayCells(),
    get_world_copy_data: () => {
      const data = create_world_copy_data_from_selection(world_selection, voxelSpace);
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
        console.warn('Failed to write to system clipboard:', e);
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
        console.warn('Failed to read from system clipboard:', e);
      }
      // Fall back to internal clipboard
      return world_clipboard_data ? encode_world_copy_data(world_clipboard_data) : clipboard_data;
    },
    on_move: (new_rect) => {
      // Update canvas_rect when moved
      canvas_rect = new_rect;
      painter_display_projection = rebuildPainterDisplayProjection(getPainterViewState(), getPainterInteractionAnchor());
      syncProjectedGridFromDisplay();
      console.log('Canvas moved:', new_rect);
    },
    on_resize: (new_rect) => {
      // Update canvas_rect
      canvas_rect = new_rect;
      painter_display_projection = rebuildPainterDisplayProjection(getPainterViewState(), getPainterInteractionAnchor());
      syncProjectedGridFromDisplay();
      console.log('Canvas resized:', new_rect);
    },
    on_close: () => {
      // Reset canvas to default position
      canvas_rect = get_default_canvas_rect();
      painter_display_projection = rebuildPainterDisplayProjection(getPainterViewState(), getPainterInteractionAnchor());
      syncProjectedGridFromDisplay();
      console.log('Canvas reset to default position');
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

  const painter_controls = create_painter_controls_runtime(1);
  void painter_controls.load();
  const painter_tai = create_painter_tool_assisted_inputs_wiring({
    data_slot: 1,
    get_tool_state: () => ({ current_tool, left_click_tool, right_click_tool }),
    get_focus_plane: () => painter_display_projection?.focus_world_plane ?? voxelSpace.camera.focus_plane,
    get_camera_target: () => getPainterFallbackTargetWorld(),
    get_bounds: () => voxelSpace.bounds,
    get_interaction_anchor: () => getPainterInteractionAnchor(),
    get_cell: (x, y, z) => {
      const plane = typeof z === 'number' ? z : (painter_display_projection?.focus_world_plane ?? voxelSpace.camera.focus_plane);
      return getVoxel(voxelSpace, x, y, plane);
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
  const camera_control_rect: Rect = getModuleRectWithSave('camera_control', {
    x0: canvas_rect.x1 + 2,  // Right of canvas
    y0: canvas_rect.y0 + 22, // Below layer palette
    x1: canvas_rect.x1 + 30, // 28 chars wide
    y1: canvas_rect.y0 + 40  // 18 chars tall
  });

  // Factory functions for creating modules
  function create_char_selector_module(): Module {
    console.log('Creating char selector module at rect:', char_selector_rect);
    return make_character_selector_module({
      id: 'char_selector',
      rect: char_selector_rect,
      get_selected_char: () => getPreviewBrush().char,
      get_left_selected_char: () => left_brush.char,
      get_right_selected_char: () => right_brush.char,
      on_char_select: (char, button) => {
        // Check if we're editing a gradiator
        if (gradiator_state.isEditing && gradiator_state.editSlot !== null) {
          // Set the character in the gradiator at the selected position
          setGradiatorChar(gradiator_state, gradiator_state.editSlot, gradiator_state.editCursorX, char);
          saveGradiatorState(gradiator_state);
          console.log('Set gradiator character:', char, 'at position', gradiator_state.editCursorX);
        } else {
          // Normal brush character selection
          active_property_side = button === 2 ? 'right' : 'left';
          getBrushForButton(button).char = char;
          saveBrushState(active_property_side);
          console.log('Selected character:', char);
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
          console.log('Set ignore color:', rgb);
        } else {
          active_property_side = button === 2 ? 'right' : 'left';
          getBrushForButton(button).rgb = { ...rgb };
          saveBrushState(active_property_side);
          console.log('Selected color:', rgb);
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
        console.log('Selected weight:', weight_index);
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
        current_tool = tool;
        console.log('Selected tool:', tool);
      },
      on_left_click_tool_change: (tool) => {
        active_property_side = 'left';
        left_click_tool = tool;
        saveToolProperties({ left_click_tool: tool, active_property_side: 'left' });
        console.log('Left-click tool:', tool);
      },
      on_right_click_tool_change: (tool) => {
        active_property_side = 'right';
        right_click_tool = tool;
        saveToolProperties({ right_click_tool: tool, active_property_side: 'right' });
        console.log('Right-click tool:', tool);
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
    return make_tool_properties_module({
      id: 'tool_properties',
      rect: tool_properties_rect,
      get_current_tool: () => current_tool,
      get_brush_size: () => getBrushSizeForSide(active_property_side),
      get_left_brush_size: () => left_brush_size,
      get_right_brush_size: () => right_brush_size,
      get_active_side: () => active_property_side,
      on_brush_size_change: (size, side) => {
        active_property_side = side;
        if (side === 'right') right_brush_size = size;
        else left_brush_size = size;
        saveBrushState(side);
        console.log('Selected brush size:', size);
      },
      get_space_replace: () => space_replace,
      on_space_replace_change: (replace) => {
        space_replace = replace;
        console.log('Space replace:', replace);
      },
      get_text_spacing: () => text_spacing,
      on_text_spacing_change: (spacing) => {
        text_spacing = spacing;
        saveToolProperties({ text_spacing: spacing });
        console.log('Text spacing:', spacing);
      },
      get_text_charlead: () => text_charlead,
      on_text_charlead_change: (charlead) => {
        text_charlead = charlead;
        saveToolProperties({ text_charlead: charlead });
        console.log('Text charlead:', charlead);
      },
      get_text_enterlead: () => text_enterlead,
      on_text_enterlead_change: (enterlead) => {
        text_enterlead = enterlead;
        saveToolProperties({ text_enterlead: enterlead });
        console.log('Text enterlead:', enterlead);
      },
      get_text_enterspace: () => text_enterspace,
      on_text_enterspace_change: (enterspace) => {
        text_enterspace = enterspace;
        saveToolProperties({ text_enterspace: enterspace });
        console.log('Text enterspace:', enterspace);
      },
      get_selection_mode: () => selection_mode,
      on_selection_mode_change: (mode) => {
        selection_mode = mode;
        console.log('Selection mode:', mode);
      },
      get_paste_space_replace: () => paste_space_replace,
      on_paste_space_replace_change: (replace) => {
        paste_space_replace = replace;
        saveToolProperties({ paste_space_replace: replace });
        console.log('Paste space replace:', replace);
      },
      get_paste_scale: () => paste_scale,
      on_paste_scale_change: (scale) => {
        paste_scale = Math.max(0.1, Math.min(3.0, scale));
        saveToolProperties({ paste_scale });
        console.log('Paste scale:', paste_scale);
      },
      get_paste_ignore_space: () => paste_ignore_space,
      on_paste_ignore_space_change: (ignore) => {
        paste_ignore_space = ignore;
        saveToolProperties({ paste_ignore_space: ignore });
        console.log('Paste ignore space:', ignore);
      },
      get_paste_ignore_black: () => paste_ignore_black,
      on_paste_ignore_black_change: (ignore) => {
        paste_ignore_black = ignore;
        saveToolProperties({ paste_ignore_black: ignore });
        console.log('Paste ignore black:', ignore);
      },
      get_paste_ignore_white: () => paste_ignore_white,
      on_paste_ignore_white_change: (ignore) => {
        paste_ignore_white = ignore;
        saveToolProperties({ paste_ignore_white: ignore });
        console.log('Paste ignore white:', ignore);
      },
      get_paste_ignore_color: () => paste_ignore_color,
      on_paste_ignore_color_change: (ignore) => {
        paste_ignore_color = ignore;
        saveToolProperties({ paste_ignore_color: ignore });
        console.log('Paste ignore color:', ignore);
      },
      get_paste_ignore_color_rgb: () => paste_ignore_color_rgb,
      on_paste_ignore_color_select: () => {
        // Enter "color select mode" for ignore color
        // We'll set a flag that the color selector will check
        (globalThis as any).__selecting_ignore_color = true;
        console.log('Select a color from the color selector to ignore');
      },
      get_gradiator_state: () => gradiator_state,
      on_gradiator_slot_select: (slot) => {
        setActiveGradiatorSlot(gradiator_state, slot);
        saveGradiatorState(gradiator_state);
        console.log('Selected gradiator slot:', slot);
      },
      on_gradiator_char_select: (slot, x) => {
        selectGradiatorChar(gradiator_state, slot, x);
        // Don't save on selection, only on actual changes
        console.log('Selected gradiator char position:', slot, x);
      },
      on_gradiator_add_char: (slot) => {
        addGradiatorChar(gradiator_state, slot);
        saveGradiatorState(gradiator_state);
        console.log('Added char to gradiator:', slot);
      },
      on_gradiator_remove_char: (slot) => {
        removeGradiatorChar(gradiator_state, slot);
        saveGradiatorState(gradiator_state);
        console.log('Removed char from gradiator:', slot);
      },
      on_gradiator_char_set: (slot, x, char) => {
        setGradiatorChar(gradiator_state, slot, x, char);
        saveGradiatorState(gradiator_state);
        console.log('Set gradiator char:', slot, x, char);
      },
      on_selection_clear: () => {
        (canvas_module as any).clearSelection?.();
        console.log('Selection cleared');
      },
      on_selection_invert: () => {
        (canvas_module as any).invertSelection?.();
        console.log('Selection inverted');
      },
      on_selection_all: () => {
        (canvas_module as any).selectAll?.();
        console.log('Select all');
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
      return `L:${left_click_tool} R:${right_click_tool} CUR:${current_tool} CHAR:${preview.char} SIZE:L${getBrushSizeForSide('left')} R${getBrushSizeForSide('right')} Z:${voxelSpace.camera.focus_plane}`;
    },
    on_save: () => {
      void save_file().catch((e) => {
        console.error('Save failed:', e);
        alert('Save failed: ' + (e as Error).message);
      });
    },
    on_load: () => {
      void load_file().catch((e) => {
        console.error('Load failed:', e);
        alert('Load failed: ' + (e as Error).message);
      });
    },
    on_new: () => {
      if (!confirm('Create new file? Unsaved changes will be lost.')) return;
      void new_file().catch((e) => {
        console.error('New file failed:', e);
        alert('New file failed: ' + (e as Error).message);
      });
    },
    on_clear: () => {
      // Clear current layer without confirmation (undo available)
      pushSnapshot(history, grid);
      for (let y = 0; y < grid.height; y++) {
        const row = grid.cells[y];
        if (!row) continue;
        for (let x = 0; x < grid.width; x++) {
          row[x] = {
            char: ' ',
            rgb: { r: 0, g: 0, b: 0 },
            weight_index: 0
          };
        }
      }
      console.log('🗑️ Layer cleared (use Ctrl+Z to undo)');
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
        voxelSpace.camera = createDefaultCamera();
        // Sync DOM renderer if it exists
        if (domRenderer) {
          domRenderer.setSpace(voxelSpace);
        }
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
      getSpace: () => voxelSpace,
      onLayerSelect: (z) => {
        const layer = getLayer(voxelSpace, z);
        if (layer && !layer.locked) selectPainterLayer(z);
      },
      onLayerVisibilityToggle: (z) => {
        togglePainterLayerVisibility(z);
      },
      onLayerLockToggle: (z) => {
        const layer = getLayer(voxelSpace, z);
        if (layer) {
          layer.locked = !layer.locked;
          console.log('Layer', z, 'locked:', layer.locked);
        }
      },
      onLayerRename: (z, newName) => {
        const layer = getLayer(voxelSpace, z);
        if (layer) {
          const oldName = layer.name;
          layer.name = newName;
          console.log(`Renamed layer ${z}: "${oldName}" → "${newName}"`);
        }
      },
      onAddLayer: () => {
        addPainterLayer();
      },
      onDeleteLayer: (z) => {
        deletePainterLayer(z);
      },
      onDuplicateLayer: (z) => {
        duplicatePainterLayer(z);
      },
      onMergeDown: (z) => {
        const { mergeLayerDown } = require('../ascii_painter/voxel_space.js');
        mergeLayerDown(voxelSpace, z);
        console.log('Merged layer', z, 'down');
      },
      onReorderLayers: (newZOrder) => {
        // Reorder layers based on the new Z order array
        // newZOrder contains Z values in their new visual order (top to bottom)
        const oldLayers = new Map(voxelSpace.layers);
        voxelSpace.layers.clear();
        
        // Rebuild layers with new Z values
        // Top layer (index 0) gets highest Z, bottom layer gets Z=0
        // This matches getSortedLayers() which sorts by b.z - a.z (descending)
        const oldToNewZ = new Map<number, number>();
        const maxZ = newZOrder.length - 1;
        
        // Rebuild the layers map with new Z coordinates
        for (let i = 0; i < newZOrder.length; i++) {
          const oldZ = newZOrder[i]!;
          const layer = oldLayers.get(oldZ);
          if (layer) {
            const newZ = maxZ - i; // Top layer gets highest Z
            layer.z = newZ;
            voxelSpace.layers.set(newZ, layer);
            oldToNewZ.set(oldZ, newZ);
          }
        }
        
        // Update focus plane if needed
        const oldFocusPlane = voxelSpace.camera.focus_plane;
        if (oldToNewZ.has(oldFocusPlane)) {
          voxelSpace.camera.focus_plane = oldToNewZ.get(oldFocusPlane)!;
        }
        
        painter_display_projection = rebuildPainterDisplayProjection(getPainterViewState(), getPainterInteractionAnchor());
        syncProjectedGridFromDisplay();
        
        // Update bounds
        voxelSpace.bounds.minZ = 0;
        voxelSpace.bounds.maxZ = maxZ;
        voxelSpace.bounds.depth = newZOrder.length;
        
        console.log('Reordered layers:', newZOrder, '→ Z values:', newZOrder.map((_, i) => maxZ - i));
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
  registry.register(toolbar_module);
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
      getSpace: () => voxelSpace,
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
        applyPainterProjectedCameraTuning();
        if (isAppInitialized) {
          saveCameraConfig({ parallax_move_enabled: enabled });
        }
        console.log('Parallax move:', enabled ? 'enabled' : 'disabled');
      },
      onParallaxSizeToggle: (enabled) => {
        voxelSpace.camera.parallax_size_enabled = enabled;
        applyPainterProjectedCameraTuning();
        if (isAppInitialized) {
          saveCameraConfig({ parallax_size_enabled: enabled });
        }
        console.log('Parallax size:', enabled ? 'enabled' : 'disabled');
      },
      occlusionLabel: 'Focus Opacity',
      getOcclusionEnabled: () => voxelSpace.camera.use_focus_layer_opacity ?? true,
      onOcclusionToggle: (enabled) => {
        voxelSpace.camera.use_focus_layer_opacity = enabled;
        applyPainterProjectedCameraTuning();
        if (isAppInitialized) {
          saveCameraConfig({ use_focus_layer_opacity: enabled });
        }
        console.log('Focus opacity:', enabled ? 'enabled' : 'disabled');
      },
      onCenterTargetToggle: (enabled) => {
        voxelSpace.camera.center_target_in_view = enabled;
        painter_display_projection = rebuildPainterDisplayProjection(getPainterViewState(), getPainterInteractionAnchor());
        syncProjectedGridFromDisplay();
        applyPainterProjectedCameraTuning();
        if (isAppInitialized) {
          saveCameraConfig({ center_target_in_view: enabled });
        }
        console.log('Center target:', enabled ? 'enabled' : 'disabled');
      },
      onCalibrationChange: (x, y) => {
        voxelSpace.camera.calibration = { x, y };
        applyPainterProjectedCameraTuning();
        if (isAppInitialized) {
          savePainterCameraCalibration({ x, y });
        }
      },
      onCalibrationReset: () => {
        voxelSpace.camera.calibration = { x: 0, y: 0 };
        applyPainterProjectedCameraTuning();
        if (isAppInitialized) {
          savePainterCameraCalibration({ x: 0, y: 0 });
        }
      },
      onScalePerLayerChange: (value) => {
        voxelSpace.camera.scale_per_layer = value;
        applyPainterProjectedCameraTuning();
        if (isAppInitialized) {
          saveCameraConfig({ scale_per_layer: value });
        }
      },
      onMovementPerLayerChange: (value) => {
        voxelSpace.camera.movement_per_layer = value;
        applyPainterProjectedCameraTuning();
        if (isAppInitialized) {
          saveCameraConfig({ movement_per_layer: value });
        }
      },
      onMouseAngleYawDegChange: (value) => {
        voxelSpace.camera.mouse_angle_yaw_deg = value;
        applyPainterProjectedCameraTuning();
        if (isAppInitialized) {
          saveCameraConfig({ mouse_angle_yaw_deg: value });
        }
      },
      onMouseAnglePitchDegChange: (value) => {
        voxelSpace.camera.mouse_angle_pitch_deg = value;
        applyPainterProjectedCameraTuning();
        if (isAppInitialized) {
          saveCameraConfig({ mouse_angle_pitch_deg: value });
        }
      },
      onMouseAngleSpringChange: (value) => {
        voxelSpace.camera.mouse_angle_spring = value;
        applyPainterProjectedCameraTuning();
        if (isAppInitialized) {
          saveCameraConfig({ mouse_angle_spring: value });
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
  camera_control_module = create_camera_control_module();
  controls_module = create_controls_panel_module();
  registry.register(char_selector_module);
  registry.register(brush_preview_module);
  registry.register(color_selector_module);
  registry.register(weight_selector_module);
  registry.register(toolbox_module);
  registry.register(tool_properties_module);
  registry.register(camera_control_module);
  registry.register(controls_module);

  registry.set_visibility('char_selector', char_selector_open);
  registry.set_visibility('brush_preview', brush_preview_open);
  registry.set_visibility('color_selector', color_selector_open);
  registry.set_visibility('weight_selector', weight_selector_open);
  registry.set_visibility('toolbox', toolbox_open);
  registry.set_visibility('tool_properties', tool_properties_open);
  registry.set_visibility('layer_palette', layer_palette_open);
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
        grid.width = new_grid.width;
        grid.height = new_grid.height;
        grid.cells = new_grid.cells;
        pushSnapshot(history, grid);
      } catch (e) {
        console.error('Failed to import grid:', e);
      }
    },
    
    clear_canvas: () => {
      pushSnapshot(history, grid);
      for (let y = 0; y < grid.height; y++) {
        const row = grid.cells[y];
        if (!row) continue;
        for (let x = 0; x < grid.width; x++) {
          row[x] = {
            char: ' ',
            rgb: { r: 0, g: 0, b: 0 },
            weight_index: 0
          };
        }
      }
      schedule_auto_save();
    },

    save_to_file: (filename?: string) => {
      void (async () => {
        if (filename) {
          const dir = await getAsciiDrawingsDir();
          if (dir) {
            const base = filename.endsWith('.json') ? filename : `${filename}.json`;
            current_file_path = `${dir}\\${base}`;
            current_filename = inferFilenameFromPath(current_file_path);
          }
        }
        await save_file();
      })().catch((e) => {
        console.error('Save failed:', e);
      });
    },

    load_from_file: async (file: File) => {
      try {
        const content = await readFileAsText(file);
        await loadArtworkFromContent(content);
        current_filename = file.name.replace(/\.json$/i, '');
        current_file_path = null;
        console.log('📂 Loaded file:', current_filename);
        console.log(debugVoxelSpace(voxelSpace));
        schedule_auto_save();
      } catch (e) {
        console.error('Failed to load file:', e);
        alert('Failed to load file: ' + (e as Error).message);
      }
    },

    export_as_text: () => {
      return exportVoxelSpaceToText(voxelSpace);
    },

    new_canvas: (width: number, height: number) => {
      // Create new VoxelSpace with default single layer
      voxelSpace = createVoxelSpace(width, height, { defaultZ: 0 });
      clear_world_selection(world_selection);

      // Apply persisted camera config to the new space
      const savedCam = loadCameraConfig();
      if (savedCam && Object.keys(savedCam).length > 0) {
        voxelSpace.camera = { ...voxelSpace.camera, ...savedCam };
      }
      syncPainterCameraViewTransform();

      ensureValidFocusPlane();
      setPainterCameraTargetWorld({ x: Math.floor(voxelSpace.bounds.width / 2), y: Math.floor(voxelSpace.bounds.height / 2), z: voxelSpace.camera.focus_plane });
      painter_display_projection = rebuildPainterDisplayProjection(getPainterViewState(), { kind: 'viewport_center', screen: null, world: painter_camera_target_world });
      syncProjectedGridFromDisplay();
      syncDOMRenderer();
      pushSnapshot(history, grid);
      current_filename = 'untitled';
      clearAutoSave();
      console.log('🆕 New canvas created:', width, 'x', height);
      console.log(debugVoxelSpace(voxelSpace));
    },

    current_filename,
    
    // VoxelSpace operations (3D support)
    export_voxel_space: () => {
      const { exportVoxelSpace } = require('../ascii_painter/voxel_space.js');
      const data = exportVoxelSpace(voxelSpace);
      return JSON.stringify(data, null, 2);
    },
    
    import_voxel_space: (json: string) => {
      try {
        const { importVoxelSpace } = require('../ascii_painter/voxel_space.js');
        const parsed = JSON.parse(json);
        voxelSpace = importVoxelSpace(parsed);
        clear_world_selection(world_selection);
        syncPainterCameraViewTransform();
        ensureValidFocusPlane();
        setPainterCameraTargetWorld({ x: Math.floor(voxelSpace.bounds.width / 2), y: Math.floor(voxelSpace.bounds.height / 2), z: voxelSpace.camera.focus_plane });
        painter_display_projection = rebuildPainterDisplayProjection(getPainterViewState(), { kind: 'viewport_center', screen: null, world: painter_camera_target_world });
        syncProjectedGridFromDisplay();
        syncDOMRenderer();
        pushSnapshot(history, grid);
        console.log('🎨 Imported VoxelSpace:', debugVoxelSpace(voxelSpace));
      } catch (e) {
        console.error('Failed to import VoxelSpace:', e);
      }
    },
    
    get_voxel_space: () => voxelSpace,
    
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
    
    // Layer operations
    add_layer: () => {
      addPainterLayer();
    },
    
    delete_layer: (z: number) => {
      deletePainterLayer(z);
    },
    
    duplicate_layer: (z: number) => {
      duplicatePainterLayer(z);
    },
    
    select_layer: (z: number) => {
      selectPainterLayer(z);
    },
    
    toggle_layer_visibility: (z: number) => {
      togglePainterLayerVisibility(z);
    },
    
    toggle_layer_lock: (z: number) => {
      const layer = getLayer(voxelSpace, z);
      if (layer) {
        layer.locked = !layer.locked;
        console.log('🔒 Layer', z, 'locked:', layer.locked);
      }
    },

    // DOM Renderer operations
    init_dom_renderer: () => {
      initDOMRenderer();
    },

    render_dom_layers: () => {
      if (domRenderer) {
        const current = getPainterViewState();
        commitProjectedGridToWorld();
        const resolved = resolve_place_view_transition_frame({
          target_view: current,
          hard_view: current,
          transition: painter_view_transition,
          now_ms: performance.now(),
        });
        const next = resolved.target_view;
        const viewChanged = next.principal_view !== voxelSpace.camera.principal_view || next.roll_quarter_turn !== voxelSpace.camera.roll_quarter_turn;
        voxelSpace.camera.principal_view = next.principal_view;
        voxelSpace.camera.roll_quarter_turn = next.roll_quarter_turn;
        syncPainterCameraViewTransform(resolved.hard_view);
        voxelSpace.camera.transition_euler = resolved.frame.euler;
        const interactionAnchor = getPainterInteractionAnchor();
        painter_display_projection = rebuildPainterDisplayProjection(resolved.hard_view, interactionAnchor);
        syncProjectedGridFromDisplay();
        const pivotPx = getPainterAnchorPivotPx(interactionAnchor);
        const mouseParallax = getPainterAnchorParallax(interactionAnchor, resolved.frame.active);
        applyPainterProjectedCameraTuning({
          transition_euler: voxelSpace.camera.transition_euler,
          visual_pivot_px: pivotPx,
        });
        domRenderer.setSpace(painter_display_projection.space);
        domRenderer.setMouseParallax(mouseParallax.x, mouseParallax.y);
        painter_view_transition = resolved.transition;
        if (viewChanged && isAppInitialized) {
          saveCameraConfig({ principal_view: voxelSpace.camera.principal_view, roll_quarter_turn: voxelSpace.camera.roll_quarter_turn });
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
      console.log('[Camera Debug] Current saved config:', config);
      console.log('[Camera Debug] Current voxelSpace camera:', voxelSpace.camera);
      console.log('[Camera Debug] isAppInitialized:', isAppInitialized);
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
        parallax_move_enabled: voxelSpace.camera.parallax_move_enabled,
        parallax_size_enabled: voxelSpace.camera.parallax_size_enabled,
        use_focus_layer_opacity: voxelSpace.camera.use_focus_layer_opacity,
      });
      console.log('[Camera Debug] Force saved camera config');
    },
  };
}
