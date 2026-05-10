/**
 * ASCII Painter Canvas Module - Selection, Copy/Paste Edition
 * 
 * Features:
 * - Text tool with Enter for new lines
 * - Selection system with rectangle select
 * - Copy/Paste with special format preservation
 * - Selection operations: replace, additive, subtract, intersect
 * - Flashing selection borders
 */

import type { Canvas, Module, Rect, Rgb, PointerEvent, DragEvent, WheelEvent, Cell } from '../types.js';
import type { AppearanceSlotTargetMask, Grid, Brush, ToolType, GridCell } from '../../ascii_painter/types.js';
import type { ToolEditTarget } from '../../ascii_painter/types.js';
import { clone_appearance_slot_assignments, createGrid, DEFAULT_APPEARANCE_SLOT_TARGET_MASK, get_enabled_appearance_slots, getCell, setCell } from '../../ascii_painter/types.js';
import { buildTextEntryCell, drawCell, drawLine, eraseCell, sampleCell, previewLine, previewRectStroke, previewRectFill } from '../../ascii_painter/tools.js';
import { has_any_edit_channel, resolve_edit_channels_with_modifiers, type EditChannels } from '../../ascii_painter/edit_mask.js';
import { logGroupCellAction, addToGroupBatch, type HistoryManager, type CellChange } from '../../ascii_painter/history.js';
import { get_color_by_name } from '../colors.js';
import { draw_module_border, PANEL_BORDER_PRESETS } from '../module_borders.js';
import { get_ui_semantic_rgb } from '../runtime/ui_customization_store.js';
import type { SelectionBitmap, SelectionMode } from '../../ascii_painter/selection.js';
import { createSelectionBitmap, selectRect, deselectRect, selectPolygon, isSelected, hasSelection, getSelectionBounds, isSelectionBorder, clearSelection, selectAll, invertSelection, applySelectionMode } from '../../ascii_painter/selection.js';
import type { CopyData } from '../../ascii_painter/copy_paste.js';
import { encodeToSpecialFormat, decodeFromSpecialFormat, copyFromGrid, textToCopyData } from '../../ascii_painter/copy_paste.js';
import { decode_world_copy_data, type WorldCopyData } from '../../ascii_painter/world_selection.js';
import { pasteImageFromClipboard } from '../../ascii_painter/image_import.js';
import type { GradiatorState } from '../../ascii_painter/gradiator.js';
import { scaleCopyData, scaleTextToCopyData } from '../../ascii_painter/gradiator.js';
import type { ModuleGizmosConfig, GizmoState } from '../module_gizmos.js';
import { clear_gizmo_hover_state, draw_module_gizmos, handle_gizmo_click, create_gizmo_state, is_in_gizmo_area, handle_move_drag, get_resize_edge, handle_resize_drag, handle_global_pointer_down_for_gizmos, should_draw_module_chrome, update_gizmo_hover_state } from '../module_gizmos.js';
import type { CameraConfig } from '../../ascii_painter/voxel_space.js';
import type { CameraAnchor } from '../runtime/camera_anchor_runtime.js';
import { get_principal_view_plane_axis, make_place_view_state, map_screen_direction_to_world_delta, project_world_point_with_roll, remap_world_offset_between_views, step_place_view_action, unproject_plane_point_with_roll, type PlaceViewState } from '../runtime/place_view_projection.js';
import { diag_log } from '../../shared/diagnostics.js';
import { create_painter_canvas_pan_adapter } from './adapters/painter_canvas_pan_adapter.js';
import { cells_match_edit_channels, get_flood_fill_voxels } from '../../shared/painter_tools.js';
import {
  order_resolved_targets,
  type OrderedResolvedTargets,
  type ResolvedTarget,
} from '../runtime/interaction_runtime_types.js';
import {
  draw_canvas_nav_cluster,
  get_canvas_nav_hit,
  get_canvas_nav_reserved_left_x,
  type CanvasNavButtonId,
  type CanvasNavViewAction,
} from './canvas_nav_cluster.js';

function painterCanvasDiag(message: string, payload?: Record<string, unknown>): void {
  diag_log('painter', 'verbose', 'PAINTER_CANVAS', message, payload);
}

function painterCanvasImportant(message: string, payload?: Record<string, unknown>): void {
  diag_log('painter', 'important', 'PAINTER_CANVAS', message, payload);
}

export type PainterCanvasOptions = {
  id: string;
  view_id?: string;
  rect: Rect;
  grid: Grid;
  brush?: Brush;
  get_camera: () => CameraConfig;
  get_selected_z: () => number;
  get_active_group_id: () => string | null;
  get_world_cell: (world: { x: number; y: number; z: number }) => GridCell;
  get_active_group_world_cell?: (world: { x: number; y: number; z: number }) => GridCell;
  get_active_group_world_voxels?: () => Array<{ x: number; y: number; z: number; cell: GridCell }>;
  get_active_group_selected_world_voxels?: () => Array<{ x: number; y: number; z: number; cell: GridCell }>;
  get_local_world_selection_cells?: () => Array<{ x: number; y: number; z: number }>;
  get_active_group_world_bounds?: () => { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number } | null;
  get_active_group_locked?: () => boolean;
  on_group_location_drag_commit?: (delta: { x: number; y: number; z: number }) => boolean;
  get_current_tool: () => ToolType;
  get_preview_brush?: () => Brush;
  get_brush_for_button?: (button: number) => Brush;
  get_brush_edit_channels_for_button?: (button: number) => EditChannels;
  get_appearance_slot_targets_for_button?: (button: number) => AppearanceSlotTargetMask;
  get_bucket_select_channels_for_button?: (button: number) => EditChannels;
  get_brush_size: () => number;
  get_brush_size_for_button?: (button: number) => number;
  get_bucket_continuous?: () => boolean;
  get_bucket_same_depth_only?: () => boolean;
  get_bucket_allow_diagonal?: () => boolean;
  get_rect_select_all_depths?: () => boolean;
  get_lasso_select_all_depths?: () => boolean;
  get_space_replace: () => boolean;
  get_paste_space_replace: () => boolean;
  get_paste_angle_mode?: () => 'relative' | 'absolute';
  get_selection_mode: () => SelectionMode;
  // Text tool spacing and leading
  get_text_spacing: () => number; // -16 to 16, horizontal movement per character
  get_text_charlead: () => number; // -16 to 16, vertical movement per character
  get_text_enterlead: () => number; // -16 to 16, vertical movement per Enter key
  get_text_enterspace: () => number; // -16 to 16, horizontal offset on Enter key
  preview_points: { x: number; y: number }[];
  on_edit_committed: () => void;
  on_live_stroke_preview?: (args: { changes: CellChange[]; anchor_world: { x: number; y: number; z: number } | null; plane: number | null }) => void;
  on_sample_cell: (cell: GridCell, sample: { button: number; shift: boolean; ctrl: boolean; alt: boolean; meta: boolean }) => void;
  get_left_click_tool: () => ToolType;
  get_right_click_tool: () => ToolType;
  get_tool_target_for_button?: (button: number, tool: ToolType) => ToolEditTarget;
  get_focus_layer_z?: () => number;
  get_focus_world_plane?: () => number | null;
  cycle_focus_layer?: (dir: 1 | -1) => void;
  // History manager for undo/redo
  history: HistoryManager;
  // Selection callbacks
  on_selection_change?: (args?: { depthMin?: number; depthMax?: number; kind?: 'rect' | 'lasso' | 'clear' | 'select_all' | 'invert' | 'other' }) => void;
  on_world_selection_change?: (args: {
    kind: 'rect' | 'lasso' | 'clear' | 'select_all' | 'invert' | 'brush' | 'bucket';
    mode?: SelectionMode;
    cells?: Array<{ x: number; y: number; z: number }>;
  }) => void;
  on_move_preview_selection_change?: (cells: Array<{ x: number; y: number; z: number }> | null) => void;
  on_move_selection_commit?: (cells: Array<{ x: number; y: number; z: number }>) => void;
  on_copy_data?: (data: string) => void | Promise<void>;
  get_clipboard_data?: () => string | null | Promise<string | null>;
  get_world_copy_data?: () => string | null;
  set_world_copy_data?: (data: string) => void;
  // Gizmo callbacks for move/resize/close
  on_move?: (new_rect: Rect) => void;
  on_resize?: (new_rect: Rect) => void;
  on_close?: () => void;
  // Mouse parallax callback for DOM renderer
  on_mouse_move?: (offsetX: number, offsetY: number) => void;
  // Gradiator and scale for paste
  get_gradiator_state: () => GradiatorState;
  get_paste_scale: () => number;
  // Paste ignore options
  get_paste_ignore_space: () => boolean;
  get_paste_ignore_black: () => boolean;
  get_paste_ignore_white: () => boolean;
  get_paste_ignore_color: () => boolean;
  get_paste_ignore_color_rgb: () => { r: number; g: number; b: number };
  get_move_mask_modifier_held?: () => boolean;
  get_world_point_for_grid?: (x: number, y: number) => { x: number; y: number; z: number } | null;
  get_world_point_for_grid_on_plane?: (x: number, y: number, plane: number) => { x: number; y: number; z: number } | null;
  get_grid_point_for_world?: (world: { x: number; y: number; z: number }) => { x: number; y: number } | null;
  get_view_state?: () => PlaceViewState;
  get_is_playing?: () => boolean;
  get_selection_status?: () => string | null;
  on_step_view_action?: (action: PainterViewAction) => void;
  on_step_depth?: (dir: -1 | 1) => void;
  get_camera_frame_anchor_world?: () => { x: number; y: number; z: number };
  set_camera_frame_anchor_world?: (anchor: { x: number; y: number; z: number }, context: { source: 'screen_drag' | 'axis_step'; detach_follow: boolean }) => void;
  get_pan_step_size_px?: () => { x: number; y: number };
  on_pan_gesture_end?: () => void;
  on_history_applied?: () => void;
  on_undo_request: () => string | null;
  on_redo_request: () => string | null;
  on_commit_cell_changes?: (args: {
    action_type: 'draw_cells' | 'erase_cells' | 'fill' | 'paste' | 'clear_canvas';
    description: string;
    z?: number;
    group_id: string;
    changes: CellChange[];
  }) => void;
  on_text_cursor_anchor_changed?: (anchor: PainterInteractionAnchor | null) => void;
};

export type PainterInteractionAnchor = CameraAnchor;
export type PainterViewAction = CanvasNavViewAction;

export type RasterMoveSourceVoxel = { x: number; y: number; z: number; cell: GridCell };

export type RasterMoveChangeDescriptor = {
  world: { x: number; y: number; z: number };
  oldCell: GridCell;
  newCell: GridCell;
};

function cloneRasterMoveCell(cell: GridCell): GridCell {
  return {
    char: cell.char,
    graphic: cell.graphic ? { ...cell.graphic } : undefined,
    appearance_slots: clone_appearance_slot_assignments(cell.appearance_slots),
    materials: cell.materials ? { ...cell.materials } : undefined,
    rgb: { ...cell.rgb },
    weight_index: cell.weight_index,
    render_index: cell.render_index,
  };
}

function makeEmptyRasterMoveCell(): GridCell {
  return {
    char: ' ',
    graphic: undefined,
    appearance_slots: undefined,
    materials: undefined,
    rgb: { r: 0, g: 0, b: 0 },
    weight_index: 0,
  };
}

export function build_raster_move_change_descriptors(
  source: RasterMoveSourceVoxel[],
  delta: { x: number; y: number; z: number },
  getCellAt: (world: { x: number; y: number; z: number }) => GridCell,
): RasterMoveChangeDescriptor[] {
  const destinationByKey = new Map<string, { world: { x: number; y: number; z: number }; cell: GridCell }>();
  for (const entry of source) {
    const world = { x: entry.x + delta.x, y: entry.y + delta.y, z: entry.z + delta.z };
    destinationByKey.set(`${world.x},${world.y},${world.z}`, {
      world,
      cell: cloneRasterMoveCell(entry.cell),
    });
  }

  const changes: RasterMoveChangeDescriptor[] = [];
  for (const entry of source) {
    const world = { x: entry.x, y: entry.y, z: entry.z };
    if (destinationByKey.has(`${world.x},${world.y},${world.z}`)) continue;
    changes.push({
      world,
      oldCell: cloneRasterMoveCell(getCellAt(world)),
      newCell: makeEmptyRasterMoveCell(),
    });
  }
  for (const destination of destinationByKey.values()) {
    changes.push({
      world: destination.world,
      oldCell: cloneRasterMoveCell(getCellAt(destination.world)),
      newCell: cloneRasterMoveCell(destination.cell),
    });
  }
  return changes;
}

export function make_painter_canvas_module(opts: PainterCanvasOptions): Module {
  let rect = opts.rect;
  const view_id = opts.view_id ?? `${opts.id}_view`;

  function requireActiveGroupId(): string {
    const groupId = opts.get_active_group_id();
    if (!groupId) {
      throw new Error('Active group id is required for painter history changes');
    }
    return groupId;
  }

  function getPointerWorldAtScreenPosition(x: number, y: number): { x: number; y: number; z: number } | null {
    const grid = screenToGrid(x, y);
    if (grid.x < 0 || grid.x >= opts.grid.width || grid.y < 0 || grid.y >= opts.grid.height) return null;
    return interaction_current_world
      ?? opts.get_world_point_for_grid?.(grid.x, grid.y)
      ?? { x: grid.x, y: grid.y, z: opts.get_selected_z() };
  }

  function buildResolvedTargetsForPointer(x: number, y: number): OrderedResolvedTargets {
    const grid = screenToGrid(x, y);
    if (grid.x < 0 || grid.x >= opts.grid.width || grid.y < 0 || grid.y >= opts.grid.height) {
      return order_resolved_targets([]);
    }
    const world = getPointerWorldAtScreenPosition(x, y);
    const targets: ResolvedTarget[] = [];
    if (world) {
      targets.push({
        module_id: opts.id,
        view_id,
        domain: 'hybrid',
        target_type: 'painter_cell',
        target_ref: `${grid.x}:${grid.y}:${Math.floor(world.z)}`,
        screen_position: { x, y },
        local_position: { x: grid.x, y: grid.y },
        world_position: { ...world },
        grid_position: { x: grid.x, y: grid.y },
        priority: 0,
      });
      targets.push({
        module_id: opts.id,
        view_id,
        domain: 'world_3d',
        target_type: 'painter_plane',
        target_ref: `plane:${getWorldPointPlaneCoordinate(world) ?? opts.get_selected_z()}`,
        screen_position: { x, y },
        local_position: { x: grid.x, y: grid.y },
        world_position: { ...world },
        plane_coordinate: getWorldPointPlaneCoordinate(world) ?? opts.get_selected_z(),
        priority: 10,
      });
    }
    return order_resolved_targets(targets);
  }

  function getBrushForButton(button: number): Brush {
    if (opts.get_brush_for_button) return opts.get_brush_for_button(button === 2 ? 2 : 0);
    return opts.brush ?? opts.get_preview_brush?.() ?? { char: '█', rgb: get_color_by_name('off_white').rgb, weight_index: 2 };
  }

  function getBrushSizeForButton(button: number): number {
    if (opts.get_brush_size_for_button) return opts.get_brush_size_for_button(button === 2 ? 2 : 0);
    return opts.get_brush_size();
  }

  function getAppearanceSlotTargetsForButton(button: number): AppearanceSlotTargetMask {
    return opts.get_appearance_slot_targets_for_button?.(button === 2 ? 2 : 0) ?? DEFAULT_APPEARANCE_SLOT_TARGET_MASK;
  }

  function getDragButton(): number {
    return (drag_start_buttons & 2) ? 2 : 0;
  }

  function getCurrentDragTool(): ToolType {
    return getDragButton() === 2 ? opts.get_right_click_tool() : opts.get_left_click_tool();
  }

  function getCurrentDragChannels(modifiers?: { shift: boolean; ctrl: boolean; alt: boolean; meta: boolean }): EditChannels {
    const button = getDragButton();
    const base_channels = opts.get_brush_edit_channels_for_button?.(button) ?? { char: true, color: true, weight: true };
    return resolve_edit_channels_with_modifiers(base_channels, modifiers ?? { shift: false, ctrl: false, alt: false, meta: false });
  }

  function getBucketSelectChannelsForButton(button: number): EditChannels {
    return opts.get_bucket_select_channels_for_button?.(button === 2 ? 2 : 0) ?? { char: true, color: true, weight: true };
  }

  function getToolTargetForButton(button: number, tool: ToolType): ToolEditTarget {
    return opts.get_tool_target_for_button?.(button, tool) ?? 'content';
  }

  function isPasteToolActiveForAnyHand(): boolean {
    return opts.get_left_click_tool() === 'paste' || opts.get_right_click_tool() === 'paste';
  }

  function emitSelectionCells(mode: SelectionMode, cells: Array<{ x: number; y: number; z: number }>, kind: 'brush' | 'bucket' | 'rect' | 'lasso' = 'brush'): void {
    if (cells.length < 1) return;
    opts.on_world_selection_change?.({ kind, mode, cells });
  }

  function translateWorldCells<T extends { x: number; y: number; z: number }>(cells: T[], delta: { x: number; y: number; z: number }): Array<{ x: number; y: number; z: number }> {
    return cells.map((cell) => ({ x: cell.x + delta.x, y: cell.y + delta.y, z: cell.z + delta.z }));
  }

  function buildMoveContentCommitChanges(source: Array<{ x: number; y: number; z: number; cell: GridCell }>, delta: { x: number; y: number; z: number }): CellChange[] {
    const descriptors = build_raster_move_change_descriptors(
      source,
      delta,
      (world) => cloneGridCell(move_preview_group_snapshot.get(worldKey(world)) ?? makeEmptyCell()),
    );
    return normalizeCommittedChanges(descriptors.map((descriptor) => buildChange(
      descriptor.world,
      descriptor.oldCell,
      descriptor.newCell,
      opts.get_grid_point_for_world?.(descriptor.world) ?? null,
    )));
  }

  function clearMovePreview(): void {
    move_preview_mode = null;
    move_preview_anchor_world = null;
    move_preview_plane = null;
    move_preview_depth_offset = 0;
    move_preview_source_voxels = [];
    move_preview_source_selection = [];
    move_preview_group_snapshot.clear();
    last_move_preview_at = 0;
    last_move_preview_delta_key = null;
    opts.on_move_preview_selection_change?.(null);
    clearPendingPreviewChanges();
  }

  function isMovePreviewActive(): boolean {
    return move_preview_mode !== null;
  }

  function resolveMoveDeltaAt(grid_x: number, grid_y: number): { x: number; y: number; z: number } | null {
    if (!move_preview_anchor_world || move_preview_plane === null) return null;
    const current = getWorldPointForEditPlane(grid_x, grid_y, move_preview_plane + move_preview_depth_offset)
      ?? opts.get_world_point_for_grid?.(grid_x, grid_y)
      ?? null;
    if (!current) return null;
    return {
      x: current.x - move_preview_anchor_world.x,
      y: current.y - move_preview_anchor_world.y,
      z: current.z - move_preview_anchor_world.z,
    };
  }

  function updateMovePreviewAt(grid_x: number, grid_y: number, options?: { force?: boolean }): void {
    const delta = resolveMoveDeltaAt(grid_x, grid_y);
    if (!delta || !move_preview_mode) return;
    const deltaKey = `${delta.x},${delta.y},${delta.z}`;
    if (!options?.force && deltaKey === last_move_preview_delta_key) return;
    if (!options?.force && move_preview_mode !== 'selection_mask') {
      const now = Date.now();
      if (now - last_move_preview_at < LIVE_STROKE_PREVIEW_INTERVAL_MS) return;
      last_move_preview_at = now;
    } else if (options?.force) {
      last_move_preview_at = Date.now();
    }
    last_move_preview_delta_key = deltaKey;
    if (move_preview_mode === 'selection_mask') {
      opts.on_move_preview_selection_change?.(translateWorldCells(move_preview_source_selection, delta));
      return;
    }
    const previewChanges = buildMoveContentCommitChanges(move_preview_source_voxels, delta);
    replacePendingPreviewChanges(previewChanges, move_preview_anchor_world, move_preview_anchor_world?.z ?? null);
  }

  function startMovePreview(grid_x: number, grid_y: number): boolean {
    const anchorWorld = getWorldPointForEditPlane(grid_x, grid_y, opts.get_selected_z()) ?? opts.get_world_point_for_grid?.(grid_x, grid_y) ?? null;
    if (!anchorWorld) return false;
    const maskOnly = opts.get_move_mask_modifier_held?.() ?? false;
    if (maskOnly) {
      const selection = opts.get_local_world_selection_cells?.() ?? [];
      if (selection.length < 1) return false;
      move_preview_mode = 'selection_mask';
      move_preview_source_selection = selection;
    } else {
      const selected = opts.get_active_group_selected_world_voxels?.() ?? [];
      const wholeGroup = opts.get_active_group_world_voxels?.() ?? [];
      move_preview_mode = selected.length > 0 ? 'selection_content' : 'group';
      move_preview_group_snapshot = new Map(wholeGroup.map((entry) => [worldKey(entry), cloneGridCell(entry.cell)]));
      move_preview_source_voxels = (selected.length > 0 ? selected : wholeGroup).map((entry) => ({
        x: entry.x,
        y: entry.y,
        z: entry.z,
        cell: cloneGridCell(entry.cell),
      }));
      if (move_preview_source_voxels.length < 1) return false;
    }
    move_preview_anchor_world = anchorWorld;
    move_preview_plane = getWorldPointPlaneCoordinate(anchorWorld) ?? opts.get_selected_z();
    move_preview_depth_offset = 0;
    last_move_preview_at = 0;
    last_move_preview_delta_key = null;
    updateMovePreviewAt(grid_x, grid_y, { force: true });
    return true;
  }

  function commitMovePreviewAt(grid_x: number, grid_y: number): void {
    const delta = resolveMoveDeltaAt(grid_x, grid_y);
    if (!delta || !move_preview_mode) {
      clearMovePreview();
      return;
    }
    if (delta.x === 0 && delta.y === 0 && delta.z === 0) {
      clearMovePreview();
      return;
    }
    if (move_preview_mode === 'selection_mask') {
      opts.on_move_selection_commit?.(translateWorldCells(move_preview_source_selection, delta));
      clearMovePreview();
      showStatus(`Moved selection ${delta.x},${delta.y},${delta.z}`);
      return;
    }
    const previewChanges = buildMoveContentCommitChanges(move_preview_source_voxels, delta);
    pending_changes = previewChanges;
    if (pending_changes.length > 0) {
      const selected_z = move_preview_anchor_world?.z ?? opts.get_selected_z();
      commitLoggedCellChanges('draw_cells', 'Move', selected_z);
      if (move_preview_mode === 'selection_content') {
        const movedSelection = translateWorldCells(move_preview_source_voxels, delta);
        opts.on_move_selection_commit?.(movedSelection);
      }
    }
    clearMovePreview();
    showStatus(`Moved content ${delta.x},${delta.y},${delta.z}`);
  }

  function getPreviewBrush(): Brush {
      return drag_start_buttons
        ? getBrushForButton(getDragButton())
      : opts.get_preview_brush?.() ?? opts.brush ?? getBrushForButton(0);
  }

  function getCamera(): CameraConfig {
    return opts.get_camera();
  }
  
  // Size constraints for canvas resize
  const CANVAS_MIN_WIDTH = 20;
  const CANVAS_MIN_HEIGHT = 10;
  const CANVAS_MAX_WIDTH = 200;
  const CANVAS_MAX_HEIGHT = 100;

  let scale = 1;

  function getViewportWidth(): number {
    return Math.max(1, rect.x1 - rect.x0 + 1);
  }

  function getViewportHeight(): number {
    return Math.max(1, rect.y1 - rect.y0 + 1);
  }
  
  // Unified coordinate system helpers - ALL coordinate calculations go through these
  
  /**
   * Get the effective local canvas pan.
   * Pointer events already arrive in coordinates that account for runtime viewport pan.
    */
  function getTotalPan(): { x: number; y: number } {
    const camera = getCamera();
    return {
      // NOTE: Pointer events delivered to modules are already in grid-tile coordinates
      // that account for the mono_canvas CSS transform (global UI pan) via
      // getBoundingClientRect() in CanvasRuntime.
      // If we also apply the global pan here, the mouse-to-grid mapping drifts
      // further off with every global pan tile.
      x: (camera.pan_x ?? 0),
      y: (camera.pan_y ?? 0)
    };
  }
  
  /**
   * Convert screen coordinates to grid coordinates
   * Uses unified pan calculation for consistency
   */
  function screenToGrid(screenX: number, screenY: number): { x: number; y: number } {
    const local_x = screenX - rect.x0;
    const local_y = screenY - rect.y0;
    if (opts.get_world_point_for_grid) {
      return {
        x: Math.floor(local_x),
        y: Math.floor(local_y),
      };
    }
    const totalPan = getTotalPan();
    return {
      x: Math.floor(totalPan.x + local_x),
      y: Math.floor(totalPan.y + local_y)
    };
  }
  
  /**
   * Convert local canvas coordinates to grid coordinates
   * Uses unified pan calculation for consistency
   */
  function localToGrid(localX: number, localY: number): { x: number; y: number } {
    if (opts.get_world_point_for_grid) {
      return {
        x: Math.floor(localX),
        y: Math.floor(localY),
      };
    }
    const totalPan = getTotalPan();
    return {
      x: Math.floor(totalPan.x + localX),
      y: Math.floor(totalPan.y + localY)
    };
  }
  
  function getCanvasPanAdapter(): ReturnType<typeof create_painter_canvas_pan_adapter> {
    return create_painter_canvas_pan_adapter({
      get_world_anchor: () => opts.get_camera_frame_anchor_world?.() ?? { x: 0, y: 0, z: opts.get_selected_z() },
      set_world_anchor: (anchor, context) => {
        opts.set_camera_frame_anchor_world?.(anchor, context);
      },
      get_view_state: () => opts.get_view_state?.() ?? make_place_view_state('top', 0),
      get_screen_step_size_px: () => opts.get_pan_step_size_px?.() ?? { x: 0, y: 0 },
      on_gesture_end: opts.on_pan_gesture_end,
    });
  }

  function getTextCursorInteractionAnchor(): PainterInteractionAnchor | null {
    const focusZ = opts.get_selected_z();
    const pan = getTotalPan();
    if (text_mode_active) {
      const textWorld = text_cursor_world ?? opts.get_world_point_for_grid?.(text_cursor_x, text_cursor_y) ?? { x: text_cursor_x, y: text_cursor_y, z: focusZ };
      const textGrid = opts.get_grid_point_for_world?.(textWorld) ?? { x: text_cursor_x, y: text_cursor_y };
      return {
        kind: 'text_cursor',
        world: textWorld,
        screen: {
          x: rect.x0 + (opts.get_world_point_for_grid ? textGrid.x : (text_cursor_x - pan.x)) + 0.5,
          y: rect.y0 + (opts.get_world_point_for_grid ? textGrid.y : (text_cursor_y - pan.y)) + 0.5,
        },
      };
    }
    return null;
  }

  let is_drawing = false;
  let is_erasing = false;
  let active_draw_channels: EditChannels = { char: true, color: true, weight: true };
  let active_stroke_tool: ToolType | null = null;
  let drag_start: { x: number; y: number } | null = null;
  let last_draw_pos: { x: number; y: number } | null = null;
  let drag_start_buttons = 0;

  // Text input state
  let text_mode_active = false;
  let text_mode_button: number = 0;
  let text_cursor_x = 0;
  let text_cursor_y = 0;
  let text_start_x = 0;
  let text_current_line = 0;
  let text_cursor_world: { x: number; y: number; z: number } | null = null;
  let text_start_world: { x: number; y: number; z: number } | null = null;
  let text_line_start_worlds: { x: number; y: number; z: number }[] = [];
  let text_line_end_worlds: { x: number; y: number; z: number }[] = [];

  // Selection state
  let selection_bitmap = createSelectionBitmap(opts.grid.width, opts.grid.height);
  let is_selecting = false;
  let selection_drag_start: { x: number; y: number } | null = null;
  let selection_drag_start_world: { x: number; y: number; z: number } | null = null;
  let selection_drag_end_world: { x: number; y: number; z: number } | null = null;
  let selection_drag_start_plane: number | null = null;
  let selection_drag_end_plane: number | null = null;
  let is_lasso_selecting = false;
  let lasso_points: { x: number; y: number }[] = [];
  let flash_state = 0;
  let last_flash_time = 0;
  
  // Mouse tracking for visual debug
  let current_mouse_pos: { x: number; y: number } | null = null;

  // Paste preview state
  let paste_preview_data: CopyData | null = null;
  let paste_preview_pos: { x: number; y: number } | null = null;
  let paste_preview_world_data: WorldCopyData | null = null;
  let paste_preview_world_anchor: { x: number; y: number; z: number } | null = null;
  let paste_preview_rotation_view: PlaceViewState | null = null;
  let paste_preview_loading = false;
  let move_preview_mode: 'group' | 'selection_content' | 'selection_mask' | null = null;
  let move_preview_anchor_world: { x: number; y: number; z: number } | null = null;
  let move_preview_plane: number | null = null;
  let move_preview_depth_offset = 0;
  let move_preview_source_voxels: Array<{ x: number; y: number; z: number; cell: GridCell }> = [];
  let move_preview_source_selection: Array<{ x: number; y: number; z: number }> = [];
  let move_preview_group_snapshot = new Map<string, GridCell>();
  let group_location_border_hovered = false;
  let group_location_drag_active = false;
  let group_location_drag_anchor_world: { x: number; y: number; z: number } | null = null;
  let group_location_drag_plane: number | null = null;
  let group_location_drag_preview_delta: { x: number; y: number; z: number } | null = null;
  let active_line_selection_target = false;

  function cloneGridCell(cell: GridCell): GridCell {
    return {
      char: cell.char,
      graphic: cell.graphic ? { ...cell.graphic } : undefined,
      appearance_slots: clone_appearance_slot_assignments(cell.appearance_slots),
      materials: cell.materials ? { ...cell.materials } : undefined,
      rgb: { ...cell.rgb },
      weight_index: cell.weight_index,
      render_index: cell.render_index,
    };
  }

  function gridCellsEqual(a: GridCell | null | undefined, b: GridCell | null | undefined): boolean {
    if (!a || !b) return false;
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function worldKey(world: { x: number; y: number; z: number }): string {
    return `${world.x},${world.y},${world.z}`;
  }

  function getActiveGroupWorldCell(world: { x: number; y: number; z: number }): GridCell {
    return opts.get_active_group_world_cell?.(world) ?? opts.get_world_cell(world);
  }

  function normalizeCommittedChanges(changes: CellChange[]): CellChange[] {
    return changes.filter((change) => !gridCellsEqual(change.oldCell, change.newCell));
  }

  function buildChange(world: { x: number; y: number; z: number }, oldCell: GridCell, newCell: GridCell, gridPoint?: { x: number; y: number } | null): CellChange {
    return {
      x: gridPoint?.x ?? -1,
      y: gridPoint?.y ?? -1,
      worldX: world.x,
      worldY: world.y,
      worldZ: world.z,
      group_id: requireActiveGroupId(),
      oldCell: cloneGridCell(oldCell),
      newCell: cloneGridCell(newCell),
    };
  }

  function emitPreviewChanges(changes: CellChange[], anchor_world: { x: number; y: number; z: number } | null, plane: number | null): void {
    if (!opts.on_live_stroke_preview) return;
    opts.on_live_stroke_preview({
      changes: changes.map((change) => ({
        ...change,
        oldCell: cloneGridCell(change.oldCell),
        newCell: cloneGridCell(change.newCell),
      })),
      anchor_world: anchor_world ? { ...anchor_world } : null,
      plane,
    });
  }

  function replacePendingPreviewChanges(nextChanges: CellChange[], anchor_world: { x: number; y: number; z: number } | null, plane: number | null): void {
    const previous = pending_changes.map((change) => ({
      ...change,
      oldCell: cloneGridCell(change.oldCell),
      newCell: cloneGridCell(change.newCell),
    }));
    const nextByKey = new Map<string, CellChange>();
    for (const change of nextChanges) {
      nextByKey.set(`${change.worldX},${change.worldY},${change.worldZ}`, {
        ...change,
        oldCell: cloneGridCell(change.oldCell),
        newCell: cloneGridCell(change.newCell),
      });
    }
    const previewChanges: CellChange[] = [];
    for (const change of previous) {
      const key = `${change.worldX},${change.worldY},${change.worldZ}`;
      if (nextByKey.has(key)) continue;
      previewChanges.push({
        ...change,
        oldCell: cloneGridCell(change.oldCell),
        newCell: cloneGridCell(change.oldCell),
      });
    }
    for (const change of nextByKey.values()) {
      previewChanges.push(change);
    }
    emitPreviewChanges(previewChanges, anchor_world, plane);
    pending_changes = normalizeCommittedChanges(Array.from(nextByKey.values()));
  }

  function clearPendingPreviewChanges(anchor_world: { x: number; y: number; z: number } | null = null, plane: number | null = null): void {
    if (pending_changes.length < 1) {
      clearLiveStrokePreview();
      return;
    }
    emitPreviewChanges(pending_changes.map((change) => ({
      ...change,
      oldCell: cloneGridCell(change.oldCell),
      newCell: cloneGridCell(change.oldCell),
    })), anchor_world, plane);
    pending_changes = [];
    clearLiveStrokePreview();
  }

  function buildShapePreviewChanges(tool: 'line' | 'rect_stroke' | 'rect_fill', start: { x: number; y: number }, end: { x: number; y: number }, brush: Brush, plane: number | null): CellChange[] {
    const points = tool === 'line'
      ? previewLine(start.x, start.y, end.x, end.y)
      : tool === 'rect_stroke'
        ? previewRectStroke(start.x, start.y, end.x, end.y)
        : previewRectFill(start.x, start.y, end.x, end.y);
    const changesByWorld = new Map<string, CellChange>();
    for (const point of points) {
      if (!canEditCell(point.x, point.y)) continue;
      const world = getWorldPointForEditPlane(point.x, point.y, plane ?? opts.get_selected_z());
      if (!world) continue;
      const oldCell = cloneGridCell(getActiveGroupWorldCell(world));
      const newCell: GridCell = makeCellFromBrush(brush);
      if (gridCellsEqual(oldCell, newCell)) continue;
      changesByWorld.set(worldKey(world), buildChange(world, oldCell, newCell, { x: point.x, y: point.y }));
    }
    return Array.from(changesByWorld.values());
  }

  function buildLinePreviewChanges(start_world: { x: number; y: number; z: number }, end_world: { x: number; y: number; z: number }, brush: Brush): CellChange[] {
    const changesByWorld = new Map<string, CellChange>();
    for (const world of buildSizedLineWorldCells(start_world, end_world, getBrushSizeForButton(getDragButton()))) {
      const gridPoint = opts.get_grid_point_for_world?.(world) ?? null;
      if (gridPoint && !canEditCell(gridPoint.x, gridPoint.y)) continue;
      const oldCell = cloneGridCell(getActiveGroupWorldCell(world));
      const newCell = applyBrushEditToCell(oldCell, brush, active_draw_channels, getAppearanceSlotTargetsForButton(getDragButton()));
      if (gridCellsEqual(oldCell, newCell)) continue;
      changesByWorld.set(worldKey(world), buildChange(world, oldCell, newCell, gridPoint));
    }
    return Array.from(changesByWorld.values());
  }

  function setPreviewPoints(points: Array<{ x: number; y: number }>): void {
    opts.preview_points.length = 0;
    opts.preview_points.push(...points);
  }

  function getLineGridPointForWorld(world: { x: number; y: number; z: number }): { x: number; y: number } {
    const gridPoint = opts.get_grid_point_for_world?.(world);
    if (gridPoint) {
      return { x: Math.floor(gridPoint.x), y: Math.floor(gridPoint.y) };
    }
    return { x: Math.floor(world.x), y: Math.floor(world.y) };
  }

  function getPlanarSizedLineWorldCells(start_world: { x: number; y: number; z: number }, end_world: { x: number; y: number; z: number }, size: number, plane: number): Array<{ x: number; y: number; z: number }> {
    const out: Array<{ x: number; y: number; z: number }> = [];
    const seen = new Set<string>();
    const startGrid = getLineGridPointForWorld(start_world);
    const endGrid = getLineGridPointForWorld(end_world);
    for (const point of previewLine(startGrid.x, startGrid.y, endGrid.x, endGrid.y)) {
      for (const world of getBrushSelectionWorldCells(point.x, point.y, size, plane)) {
        const key = worldKey(world);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(world);
      }
    }
    return out;
  }

  function getProjectedSizedLineWorldCells(start_world: { x: number; y: number; z: number }, end_world: { x: number; y: number; z: number }, size: number): Array<{ x: number; y: number; z: number }> {
    const viewState = opts.get_view_state?.() ?? make_place_view_state('top', 0);
    const startProjected = project_world_point_with_roll(start_world, viewState);
    const endProjected = project_world_point_with_roll(end_world, viewState);
    const du = endProjected.u - startProjected.u;
    const dv = endProjected.v - startProjected.v;
    const dPlane = endProjected.plane - startProjected.plane;
    const steps = Math.max(Math.abs(du), Math.abs(dv), Math.abs(dPlane));
    const offset = Math.floor(size / 2);
    const out: Array<{ x: number; y: number; z: number }> = [];
    const seen = new Set<string>();

    for (let step = 0; step <= steps; step += 1) {
      const t = steps === 0 ? 0 : step / steps;
      const centerU = Math.round(startProjected.u + du * t);
      const centerV = Math.round(startProjected.v + dv * t);
      const plane = Math.round(startProjected.plane + dPlane * t);
      for (let dy = 0; dy < size; dy += 1) {
        for (let dx = 0; dx < size; dx += 1) {
          const world = unproject_plane_point_with_roll({
            u: centerU - offset + dx,
            v: centerV - offset + dy,
            plane,
          }, viewState);
          const key = worldKey(world);
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(world);
        }
      }
    }

    return out;
  }

  function buildSizedLineWorldCells(start_world: { x: number; y: number; z: number }, end_world: { x: number; y: number; z: number }, size: number): Array<{ x: number; y: number; z: number }> {
    const startPlane = getWorldPointPlaneCoordinate(start_world);
    const endPlane = getWorldPointPlaneCoordinate(end_world);
    if (startPlane !== null && endPlane !== null && startPlane === endPlane) {
      return getPlanarSizedLineWorldCells(start_world, end_world, size, startPlane);
    }
    return getProjectedSizedLineWorldCells(start_world, end_world, size);
  }

  function setPreviewPointsFromWorldCells(cells: Array<{ x: number; y: number; z: number }>): void {
    const seen = new Set<string>();
    const points: Array<{ x: number; y: number }> = [];
    for (const world of cells) {
      const gridPoint = opts.get_grid_point_for_world?.(world);
      if (!gridPoint) continue;
      const point = { x: Math.floor(gridPoint.x), y: Math.floor(gridPoint.y) };
      const key = `${point.x},${point.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      points.push(point);
    }
    setPreviewPoints(points);
  }

  function applyLineSelectionStroke(start_world: { x: number; y: number; z: number }, end_world: { x: number; y: number; z: number }, size: number): void {
    const cells = buildSizedLineWorldCells(start_world, end_world, size);
    emitSelectionCells(opts.get_selection_mode(), cells, 'brush');
    setPreviewPointsFromWorldCells(cells);
  }

  type PastePreviewResult = {
    changes: CellChange[];
    placed: number;
    cleared: number;
    preserved: number;
    skippedIgnored: number;
    minPasteZ: number;
    maxPasteZ: number;
  };

  function createEmptyPastePreviewResult(): PastePreviewResult {
    return {
      changes: [],
      placed: 0,
      cleared: 0,
      preserved: 0,
      skippedIgnored: 0,
      minPasteZ: Number.POSITIVE_INFINITY,
      maxPasteZ: Number.NEGATIVE_INFINITY,
    };
  }

  function getBasePasteTargetView(worldData: WorldCopyData): PlaceViewState {
    if ((opts.get_paste_angle_mode?.() ?? 'relative') === 'absolute') {
      return make_place_view_state(worldData.source_view?.principal_view ?? 'top', worldData.source_view?.roll_quarter_turn ?? 0);
    }
    return opts.get_view_state?.() ?? make_place_view_state('top', 0);
  }

  function getEffectivePasteTargetView(worldData: WorldCopyData): PlaceViewState {
    return paste_preview_rotation_view ?? getBasePasteTargetView(worldData);
  }

  function resetPastePreviewRotationView(worldData?: WorldCopyData | null): void {
    paste_preview_rotation_view = worldData ? getBasePasteTargetView(worldData) : null;
  }

  function stepPastePreviewViewAction(action: 'swing_left' | 'swing_right' | 'swing_up' | 'swing_down' | 'roll_left' | 'roll_right'): void {
    if (!paste_preview_world_data) return;
    const current = getEffectivePasteTargetView(paste_preview_world_data);
    paste_preview_rotation_view = step_place_view_action(current, action);
    if (paste_preview_world_anchor) {
      const gridPoint = opts.get_grid_point_for_world?.(paste_preview_world_anchor) ?? null;
      if (gridPoint) updatePastePreviewAtGrid(gridPoint.x, gridPoint.y);
    }
  }

  function buildWorldPastePreviewChanges(worldData: WorldCopyData, anchor: { x: number; y: number; z: number }, options?: { preview_only?: boolean }): PastePreviewResult {
    const result = createEmptyPastePreviewResult();
    const ignoreColorRgb = opts.get_paste_ignore_color_rgb();
    const changesByWorld = new Map<string, CellChange>();
    const targetView = getEffectivePasteTargetView(worldData);
    const sourceView = make_place_view_state(worldData.source_view?.principal_view ?? 'top', worldData.source_view?.roll_quarter_turn ?? 0);
    for (const entry of worldData.cells) {
      const remapped = remap_world_offset_between_views({ x: entry.dx, y: entry.dy, z: entry.dz }, sourceView, targetView);
      const world = {
        x: anchor.x + remapped.x,
        y: anchor.y + remapped.y,
        z: anchor.z + remapped.z,
      };
      result.minPasteZ = Math.min(result.minPasteZ, world.z);
      result.maxPasteZ = Math.max(result.maxPasteZ, world.z);
      const oldCell = cloneGridCell(opts.get_world_cell(world));
      const isIgnored = isIgnoredPasteCell(entry.cell, ignoreColorRgb);
      if (isIgnored) {
        result.skippedIgnored += 1;
        result.preserved += 1;
        continue;
      }
      if (entry.cell && (entry.cell.char !== ' ' || !!entry.cell.graphic)) {
        changesByWorld.set(worldKey(world), buildChange(world, oldCell, entry.cell, opts.get_grid_point_for_world?.(world) ?? null));
        result.placed += 1;
        continue;
      }
      if (opts.get_paste_space_replace()) {
        if (options?.preview_only && oldCell.char === ' ' && !oldCell.graphic) {
          result.preserved += 1;
          continue;
        }
        const clearedCell = makeEmptyCell();
        changesByWorld.set(worldKey(world), buildChange(world, oldCell, clearedCell, opts.get_grid_point_for_world?.(world) ?? null));
        result.cleared += 1;
      } else {
        result.preserved += 1;
      }
    }
    result.changes = Array.from(changesByWorld.values()).filter((change) => !gridCellsEqual(change.oldCell, change.newCell));
    return result;
  }

  function buildFlatPastePreviewChanges(data: CopyData, origin: { x: number; y: number }): PastePreviewResult {
    const result = createEmptyPastePreviewResult();
    const ignoreColorRgb = opts.get_paste_ignore_color_rgb();
    const changesByWorld = new Map<string, CellChange>();
    for (let y = 0; y < data.height; y++) {
      for (let x = 0; x < data.width; x++) {
        const cell = data.cells[y]?.[x];
        const gridX = origin.x + x;
        const gridY = origin.y + y;
        const world = opts.get_world_point_for_grid?.(gridX, gridY) ?? { x: gridX, y: gridY, z: opts.get_selected_z() };
        result.minPasteZ = Math.min(result.minPasteZ, world.z);
        result.maxPasteZ = Math.max(result.maxPasteZ, world.z);
        const oldCell = cloneGridCell(opts.get_world_cell(world));
        const isIgnored = isIgnoredPasteCell(cell ?? null, ignoreColorRgb);
        if (isIgnored) {
          result.skippedIgnored += 1;
          result.preserved += 1;
          continue;
        }
        if (cell && (cell.char !== ' ' || !!cell.graphic)) {
          changesByWorld.set(worldKey(world), buildChange(world, oldCell, cell, { x: gridX, y: gridY }));
          result.placed += 1;
          continue;
        }
        if (opts.get_paste_space_replace()) {
          const clearedCell = makeEmptyCell();
          changesByWorld.set(worldKey(world), buildChange(world, oldCell, clearedCell, { x: gridX, y: gridY }));
          result.cleared += 1;
        } else {
          result.preserved += 1;
        }
      }
    }
    result.changes = Array.from(changesByWorld.values()).filter((change) => !gridCellsEqual(change.oldCell, change.newCell));
    return result;
  }

  function updateLineRectPreview(end: { x: number; y: number }): void {
    if (!drag_start || !isShapeTool(active_stroke_tool)) return;
    if (active_stroke_tool === 'line' && shape_start_world) {
      const endWorld = getWorldPointForEditPlane(end.x, end.y, active_stroke_world_plane ?? opts.get_selected_z());
      if (!endWorld) {
        setInteractionCurrentWorld(null);
        pending_changes = [];
        setPreviewPoints([]);
        clearLiveStrokePreview();
        return;
      }
      active_stroke_anchor_world = { ...endWorld };
      setInteractionCurrentWorld(endWorld);
      if (active_line_selection_target) {
        pending_changes = [];
        applyLineSelectionStroke(shape_start_world, endWorld, getBrushSizeForButton(getDragButton()));
        emitLiveInteractionAnchor(endWorld);
      } else {
        pending_changes = normalizeCommittedChanges(buildLinePreviewChanges(shape_start_world, endWorld, getBrushForButton(getDragButton())));
        setPreviewPoints([]);
        maybeEmitLiveStrokePreview();
      }
      return;
    }
    setInteractionCurrentWorld(getWorldPointForEditPlane(end.x, end.y, active_stroke_world_plane ?? opts.get_selected_z()));
    const previewChanges = buildShapePreviewChanges(active_stroke_tool as 'line' | 'rect_stroke' | 'rect_fill', drag_start, end, getBrushForButton(getDragButton()), active_stroke_world_plane);
    pending_changes = normalizeCommittedChanges(previewChanges);
    const points = active_stroke_tool === 'rect_stroke'
      ? previewRectStroke(drag_start.x, drag_start.y, end.x, end.y)
      : previewRectFill(drag_start.x, drag_start.y, end.x, end.y);
    setPreviewPoints(points);
    maybeEmitLiveStrokePreview();
  }

  function updatePastePreviewAtGrid(grid_x: number, grid_y: number): void {
    if (paste_preview_world_data) {
      paste_preview_world_anchor = opts.get_world_point_for_grid?.(grid_x, grid_y) ?? { x: grid_x, y: grid_y, z: opts.get_selected_z() };
      const preview = buildWorldPastePreviewChanges(paste_preview_world_data, paste_preview_world_anchor, { preview_only: true });
      replacePendingPreviewChanges(preview.changes, paste_preview_world_anchor, paste_preview_world_anchor.z);
      return;
    }
    if (paste_preview_data) {
      paste_preview_pos = { x: grid_x, y: grid_y };
      const anchorWorld = opts.get_world_point_for_grid?.(grid_x, grid_y) ?? { x: grid_x, y: grid_y, z: opts.get_selected_z() };
      const preview = buildFlatPastePreviewChanges(paste_preview_data, paste_preview_pos);
      replacePendingPreviewChanges(preview.changes, anchorWorld, anchorWorld.z);
    }
  }

  function ensurePastePreviewAtGrid(grid_x: number, grid_y: number): void {
    if (paste_preview_data || paste_preview_world_data || paste_preview_loading) {
      updatePastePreviewAtGrid(grid_x, grid_y);
      return;
    }
    paste_preview_loading = true;
    const scale = opts.get_paste_scale();
    const freshGradiatorState = opts.get_gradiator_state();
    const targetWidth = scale === 1.0 ? undefined : 80;
    const pixelPerfect = scale === 1.0;
    pasteImageFromClipboard(targetWidth, freshGradiatorState, pixelPerfect).then((imageData) => {
      if (imageData) {
        const scaledData = scale !== 1.0 ? scaleCopyData(imageData, scale) : imageData;
        paste_preview_data = scaledData;
        paste_preview_world_data = null;
        paste_preview_world_anchor = null;
        paste_preview_rotation_view = null;
        paste_preview_pos = {
          x: grid_x - Math.floor(scaledData.width / 2),
          y: grid_y - Math.floor(scaledData.height / 2),
        };
        updatePastePreviewAtGrid(paste_preview_pos.x, paste_preview_pos.y);
        showStatus(`Image paste: ${scaledData.width}x${scaledData.height} @ ${Math.round(scale * 100)}% - Click to place`);
        return;
      }
      return Promise.resolve(opts.get_clipboard_data?.()).then((clipboard) => {
        if (!clipboard) return;
        const worldData = decode_world_copy_data(clipboard);
        if (worldData) {
          paste_preview_world_data = worldData;
          resetPastePreviewRotationView(worldData);
          paste_preview_world_anchor = opts.get_world_point_for_grid?.(grid_x, grid_y) ?? { x: grid_x, y: grid_y, z: opts.get_selected_z() };
          updatePastePreviewAtGrid(grid_x, grid_y);
          opts.set_world_copy_data?.(clipboard);
          showStatus(`3D paste preview: ${worldData.cells.length} voxels - Click to place`);
          return;
        }
        const specialData = decodeFromSpecialFormat(clipboard);
        if (specialData) {
          const scaledData = scale !== 1.0 ? scaleCopyData(specialData, scale) : specialData;
          paste_preview_data = scaledData;
          paste_preview_world_data = null;
          paste_preview_world_anchor = null;
          paste_preview_rotation_view = null;
          paste_preview_pos = {
            x: grid_x - Math.floor(scaledData.width / 2),
            y: grid_y - Math.floor(scaledData.height / 2),
          };
          updatePastePreviewAtGrid(paste_preview_pos.x, paste_preview_pos.y);
          showStatus(`Paste preview: ${scaledData.width}x${scaledData.height} @ ${Math.round(scale * 100)}% - Click to place`);
          return;
        }
        const textData = scaleTextToCopyData(clipboard, scale);
        if (textData) {
          paste_preview_data = textData;
          paste_preview_world_data = null;
          paste_preview_world_anchor = null;
          paste_preview_rotation_view = null;
          paste_preview_pos = {
            x: grid_x - Math.floor(textData.width / 2),
            y: grid_y - Math.floor(textData.height / 2),
          };
          updatePastePreviewAtGrid(paste_preview_pos.x, paste_preview_pos.y);
          showStatus(`Text paste: ${textData.width}x${textData.height} - Click to place`);
        }
      });
    }).catch(() => {
      // ignore clipboard load failures; user keeps control of the tool
    }).finally(() => {
      paste_preview_loading = false;
    });
  }

  function emitTextCursorAnchorChanged(): void {
    opts.on_text_cursor_anchor_changed?.(getTextCursorInteractionAnchor());
  }

  function isValidTextModeAuxiliaryTarget(module_id: string | null | undefined): boolean {
    if (!module_id) return false;
    return module_id === 'painter_canvas'
      || module_id === 'char_selector'
      || module_id === 'color_selector'
      || module_id === 'color_block'
      || module_id === 'tool_properties'
      || module_id === 'camera_control'
      || module_id === 'indexed_palette_panel'
      || module_id === 'indexed_palette_picker';
  }

  function exitTextMode(commitPending: boolean): void {
    if (!text_mode_active) return;
    if (commitPending) commitPendingTextChanges('Type Text');
    text_mode_active = false;
    text_mode_button = 0;
    text_cursor_world = null;
    text_start_world = null;
    text_current_line = 0;
    text_line_start_worlds = [];
    text_line_end_worlds = [];
    emitTextCursorAnchorChanged();
  }

  function cloneWorldPoint(world: { x: number; y: number; z: number } | null | undefined): { x: number; y: number; z: number } | null {
    if (!world) return null;
    return { x: world.x, y: world.y, z: world.z };
  }

  function getWorldPointPlaneCoordinate(world: { x: number; y: number; z: number } | null | undefined): number | null {
    if (!world) return null;
    const viewState = opts.get_view_state?.() ?? make_place_view_state('top');
    const axis = get_principal_view_plane_axis(viewState.principal_view);
    if (axis === 'x') return Math.floor(world.x);
    if (axis === 'y') return Math.floor(world.y);
    return Math.floor(world.z);
  }

  function setInteractionCurrentWorld(world: { x: number; y: number; z: number } | null | undefined): void {
    interaction_current_world = cloneWorldPoint(world);
  }

  function setInteractionEndWorld(world: { x: number; y: number; z: number } | null | undefined): void {
    interaction_end_world = cloneWorldPoint(world);
  }

  function setWorldPointPlaneCoordinate(world: { x: number; y: number; z: number }, plane: number): { x: number; y: number; z: number } {
    const viewState = opts.get_view_state?.() ?? make_place_view_state('top');
    const axis = get_principal_view_plane_axis(viewState.principal_view);
    if (axis === 'x') return { ...world, x: plane };
    if (axis === 'y') return { ...world, y: plane };
    return { ...world, z: plane };
  }

  function getCurrentStrokeGridPoint(): { x: number; y: number } | null {
    if (current_mouse_pos) {
      const local_x = current_mouse_pos.x - rect.x0;
      const local_y = current_mouse_pos.y - rect.y0;
      const grid_coords = localToGrid(local_x, local_y);
      if (grid_coords.x >= 0 && grid_coords.x < opts.grid.width && grid_coords.y >= 0 && grid_coords.y < opts.grid.height) {
        return grid_coords;
      }
    }
    return last_draw_pos ? { ...last_draw_pos } : null;
  }

  function isShapeTool(tool: ToolType | null | undefined): tool is 'line' | 'rect_stroke' | 'rect_fill' {
    return tool === 'line' || tool === 'rect_stroke' || tool === 'rect_fill';
  }

  function isActivePencilStroke(): boolean {
    return is_drawing && active_stroke_tool === 'pencil';
  }

  function isActiveEraserStroke(): boolean {
    return is_erasing && active_stroke_tool === 'eraser';
  }

  function isActiveShapeStroke(): boolean {
    return is_drawing && isShapeTool(active_stroke_tool) && !!drag_start;
  }

  function isActiveLineStroke(): boolean {
    return is_drawing && active_stroke_tool === 'line' && !!drag_start;
  }

  function clearActiveStrokeState(): void {
    clearLiveStrokePreview();
    is_drawing = false;
    is_erasing = false;
    active_draw_channels = { char: true, color: true, weight: true };
    active_stroke_tool = null;
    active_stroke_world_plane = null;
    active_stroke_anchor_world = null;
    interaction_current_world = null;
    interaction_end_world = null;
    shape_start_world = null;
    drag_start = null;
    last_draw_pos = null;
    setPreviewPoints([]);
    drag_start_buttons = 0;
    active_line_selection_target = false;
  }

  function handleDepthStepDuringActiveStroke(nextPlane: number): void {
    if (!(is_drawing || is_erasing)) return;
    if (!isActivePencilStroke() && !isActiveEraserStroke() && !isActiveShapeStroke()) return;
    const normalizedPlane = Math.floor(nextPlane);
    if (!Number.isFinite(normalizedPlane) || active_stroke_world_plane === normalizedPlane) return;
    active_stroke_world_plane = normalizedPlane;
    const strokeGridPoint = getCurrentStrokeGridPoint();
    const nextAnchor = strokeGridPoint
      ? getWorldPointForEditPlane(strokeGridPoint.x, strokeGridPoint.y, normalizedPlane)
      : null;
    active_stroke_anchor_world = nextAnchor
      ?? (active_stroke_anchor_world ? setWorldPointPlaneCoordinate(active_stroke_anchor_world, normalizedPlane) : null);
    setInteractionCurrentWorld(active_stroke_anchor_world);
    if (!strokeGridPoint) return;
    if (isActivePencilStroke()) {
      applyBrushEditWithBrushSize(
        strokeGridPoint.x,
        strokeGridPoint.y,
        getBrushForButton(getDragButton()),
        getBrushSizeForButton(getDragButton()),
        active_draw_channels,
      );
    } else if (isActiveEraserStroke()) {
      drawWithBrushSize(
        strokeGridPoint.x,
        strokeGridPoint.y,
        true,
        getBrushForButton(getDragButton()),
        getBrushSizeForButton(getDragButton()),
      );
    } else if (isActiveShapeStroke()) {
      updateLineRectPreview(strokeGridPoint);
      return;
    }
    last_draw_pos = { ...strokeGridPoint };
    maybeEmitLiveStrokePreview(true);
  }

  function sameWorldPoint(a: { x: number; y: number; z: number } | null | undefined, b: { x: number; y: number; z: number } | null | undefined): boolean {
    if (!a || !b) return false;
    return a.x === b.x && a.y === b.y && a.z === b.z;
  }

  function getTextViewState(): PlaceViewState {
    return opts.get_view_state?.() ?? make_place_view_state('top', 0);
  }

  function getScreenVectorWorldDelta(screen_dx: number, screen_dy: number): { x: number; y: number; z: number } {
    const state = getTextViewState();
    const right = map_screen_direction_to_world_delta(state, 'right');
    const up = map_screen_direction_to_world_delta(state, 'up');
    return {
      x: (right.x * screen_dx) + (up.x * screen_dy),
      y: (right.y * screen_dx) + (up.y * screen_dy),
      z: (right.z * screen_dx) + (up.z * screen_dy),
    };
  }

  function getTextCurrentWorld(): { x: number; y: number; z: number } {
    return cloneWorldPoint(text_cursor_world)
      ?? opts.get_world_point_for_grid?.(text_cursor_x, text_cursor_y)
      ?? { x: text_cursor_x, y: text_cursor_y, z: opts.get_selected_z() };
  }

  function setTextCursorPosition(nextX: number, nextY: number, world: { x: number; y: number; z: number }): boolean {
    if (nextX < 0 || nextX >= opts.grid.width || nextY < 0 || nextY >= opts.grid.height) return false;
    text_cursor_x = nextX;
    text_cursor_y = nextY;
    text_cursor_world = { x: world.x, y: world.y, z: world.z };
    emitTextCursorAnchorChanged();
    return true;
  }

  function tryMoveTextCursorToWorld(world: { x: number; y: number; z: number }): boolean {
    const gridPoint = opts.get_grid_point_for_world?.(world);
    if (gridPoint) {
      const nextX = Math.floor(gridPoint.x);
      const nextY = Math.floor(gridPoint.y);
      return setTextCursorPosition(nextX, nextY, world);
    }
    if (opts.get_grid_point_for_world) return false;
    if (world.x < 0 || world.x >= opts.grid.width || world.y < 0 || world.y >= opts.grid.height) return false;
    moveTextCursorTo(world.x, world.y);
    return true;
  }

  function tryMoveTextCursorToGridOnPlane(nextX: number, nextY: number, plane: number | null): boolean {
    if (nextX < 0 || nextX >= opts.grid.width || nextY < 0 || nextY >= opts.grid.height) return false;
    const resolvedPlane = typeof plane === 'number' ? Math.floor(plane) : null;
    const fallbackWorld = opts.get_world_point_for_grid_on_plane?.(nextX, nextY, resolvedPlane ?? opts.get_selected_z())
      ?? (() => {
        const baseWorld = opts.get_world_point_for_grid?.(nextX, nextY) ?? { x: nextX, y: nextY, z: opts.get_selected_z() };
        return resolvedPlane === null ? baseWorld : setWorldPointPlaneCoordinate(baseWorld, resolvedPlane);
      })();
    return setTextCursorPosition(nextX, nextY, fallbackWorld);
  }

  function moveTextCursorByScreenDelta(screen_dx: number, screen_dy: number): boolean {
    syncTextCursorGridFromWorld();
    const current = getTextCurrentWorld();
    const delta = getScreenVectorWorldDelta(screen_dx, screen_dy);
    if (tryMoveTextCursorToWorld({
      x: current.x + delta.x,
      y: current.y + delta.y,
      z: current.z + delta.z,
    })) {
      return true;
    }
    const fallbackDx = Math.trunc(screen_dx);
    const fallbackDy = Math.trunc(screen_dy);
    if (fallbackDx === 0 && fallbackDy === 0) return false;
    return tryMoveTextCursorToGridOnPlane(text_cursor_x + fallbackDx, text_cursor_y + fallbackDy, getWorldPointPlaneCoordinate(current));
  }

  function getCurrentLineStartWorld(): { x: number; y: number; z: number } {
    return cloneWorldPoint(text_line_start_worlds[text_current_line])
      ?? cloneWorldPoint(text_start_world)
      ?? getTextCurrentWorld();
  }

  function setCurrentLineEndWorld(world: { x: number; y: number; z: number }): void {
    text_line_end_worlds[text_current_line] = { x: world.x, y: world.y, z: world.z };
  }

  function moveTextCursorToNextLine(): boolean {
    const base = cloneWorldPoint(text_start_world) ?? getTextCurrentWorld();
    setCurrentLineEndWorld(getTextCurrentWorld());
    text_current_line += 1;
    const offset = getScreenVectorWorldDelta(opts.get_text_enterspace(), opts.get_text_enterlead() * text_current_line);
    const next = {
      x: base.x + offset.x,
      y: base.y + offset.y,
      z: base.z + offset.z,
    };
    text_line_start_worlds[text_current_line] = { ...next };
    text_line_end_worlds[text_current_line] = { ...next };
    if (tryMoveTextCursorToWorld(next)) return true;
    return tryMoveTextCursorToGridOnPlane(getTextStartGridX() + opts.get_text_enterspace(), text_cursor_y + opts.get_text_enterlead(), getWorldPointPlaneCoordinate(base));
  }

  function resetTextEntryAnchorAtCurrentCursor(): void {
    syncTextCursorGridFromWorld();
    text_start_x = text_cursor_x;
    text_start_world = cloneWorldPoint(getTextCurrentWorld());
    text_current_line = 0;
    const start = cloneWorldPoint(text_start_world) ?? getTextCurrentWorld();
    text_line_start_worlds = [{ ...start }];
    text_line_end_worlds = [{ ...start }];
  }

  function commitPendingTextChanges(description: string = 'Type Text'): void {
    if (pending_changes.length < 1) return;
    const committed_changes = pending_changes.map((change) => ({ ...change, oldCell: cloneGridCell(change.oldCell), newCell: cloneGridCell(change.newCell) }));
    const active_group_id = requireActiveGroupId();
    const textCommitPlane = committed_changes[0]?.worldZ ?? opts.get_selected_z();
    logGroupCellAction(opts.history, 'draw_cells', description, { z: textCommitPlane, group_id: active_group_id }, pending_changes);
    opts.on_commit_cell_changes?.({
      action_type: 'draw_cells',
      description,
      z: textCommitPlane,
      group_id: active_group_id,
      changes: committed_changes,
    });
    pending_changes = [];
    clearLiveStrokePreview();
    opts.on_edit_committed();
  }

  function commitLoggedCellChanges(action_type: 'draw_cells' | 'erase_cells' | 'fill' | 'paste' | 'clear_canvas', description: string, z: number): void {
    if (pending_changes.length < 1) return;
    const committed_changes = pending_changes.map((change) => ({ ...change, oldCell: cloneGridCell(change.oldCell), newCell: cloneGridCell(change.newCell) }));
    const active_group_id = requireActiveGroupId();
    logGroupCellAction(opts.history, action_type, description, { z, group_id: active_group_id }, pending_changes);
    opts.on_commit_cell_changes?.({ action_type, description, z, group_id: active_group_id, changes: committed_changes });
    pending_changes = [];
    clearLiveStrokePreview();
    opts.on_edit_committed();
  }

  function clonePendingChanges(): CellChange[] {
    return pending_changes.map((change) => ({
      ...change,
      oldCell: cloneGridCell(change.oldCell),
      newCell: cloneGridCell(change.newCell),
    }));
  }

  function maybeEmitLiveStrokePreview(force: boolean = false): void {
    if (!opts.on_live_stroke_preview) return;
    const now = Date.now();
    if (!force && now - last_live_stroke_preview_at < LIVE_STROKE_PREVIEW_INTERVAL_MS) return;
    last_live_stroke_preview_at = now;
    opts.on_live_stroke_preview({
      changes: clonePendingChanges(),
      anchor_world: cloneWorldPoint(interaction_current_world ?? active_stroke_anchor_world),
      plane: getWorldPointPlaneCoordinate(interaction_current_world ?? active_stroke_anchor_world),
    });
  }

  function emitLiveInteractionAnchor(world: { x: number; y: number; z: number } | null | undefined, force: boolean = false): void {
    if (!opts.on_live_stroke_preview) return;
    const now = Date.now();
    if (!force && now - last_live_stroke_preview_at < LIVE_STROKE_PREVIEW_INTERVAL_MS) return;
    last_live_stroke_preview_at = now;
    opts.on_live_stroke_preview({
      changes: clonePendingChanges(),
      anchor_world: cloneWorldPoint(world),
      plane: getWorldPointPlaneCoordinate(world),
    });
  }

  function clearLiveStrokePreview(): void {
    opts.on_live_stroke_preview?.({
      changes: [],
      anchor_world: null,
      plane: null,
    });
  }

  function maybeEmitLiveTextPreview(force: boolean = false): void {
    if (!opts.on_live_stroke_preview || pending_changes.length < 1) return;
    const anchorWorld = cloneWorldPoint(text_cursor_world)
      ?? cloneWorldPoint(text_start_world)
      ?? opts.get_world_point_for_grid?.(text_cursor_x, text_cursor_y)
      ?? { x: text_cursor_x, y: text_cursor_y, z: opts.get_selected_z() };
    const plane = getWorldPointPlaneCoordinate(anchorWorld) ?? anchorWorld.z;
    const now = Date.now();
    if (!force && now - last_live_stroke_preview_at < LIVE_STROKE_PREVIEW_INTERVAL_MS) return;
    last_live_stroke_preview_at = now;
    opts.on_live_stroke_preview({
      changes: clonePendingChanges(),
      anchor_world: { ...anchorWorld },
      plane,
    });
  }

  function insertTextAtCursor(text: string): void {
    if (!text_mode_active || !text) return;
    syncTextCursorGridFromWorld();

    if (opts.get_active_group_locked?.()) {
      showStatus('Cannot type: active group is locked');
      return;
    }

    const isChunkInput = text.length > 1;
    const commitDescription = isChunkInput ? 'Paste Text' : 'Type Text';

    for (const char of text) {
      if (char === '\n' || char === '\r') {
        if (!isChunkInput) {
          commitPendingTextChanges('Type Text');
        }
        moveTextCursorToNextLine();
        if (text_cursor_x < 0 || text_cursor_x >= opts.grid.width || text_cursor_y < 0 || text_cursor_y >= opts.grid.height) {
          exitTextMode(false);
          break;
        }
        continue;
      }

      if (text_cursor_x < 0 || text_cursor_x >= opts.grid.width || text_cursor_y < 0 || text_cursor_y >= opts.grid.height) continue;

      const text_brush = getBrushForButton(text_mode_button);
      const text_channels = opts.get_brush_edit_channels_for_button?.(text_mode_button) ?? { char: true, color: true, weight: true };
      const text_slot_targets = getAppearanceSlotTargetsForButton(text_mode_button);
      const oldCell = getGridCell(text_cursor_x, text_cursor_y);

      if (char === ' ') {
        if (opts.get_space_replace()) {
          opts.grid.cells[text_cursor_y]![text_cursor_x] = makeEmptyCell();
          const newCell = getGridCell(text_cursor_x, text_cursor_y);
          if (oldCell && newCell) {
            trackTextCursorChange(oldCell, newCell);
            maybeEmitLiveTextPreview(true);
          }
        }
      } else {
        opts.grid.cells[text_cursor_y]![text_cursor_x] = buildTextEntryCell(oldCell, text_brush, char, text_channels, text_slot_targets);
        const newCell = getGridCell(text_cursor_x, text_cursor_y);
        if (oldCell && newCell) {
          trackTextCursorChange(oldCell, newCell);
          maybeEmitLiveTextPreview(true);
        }
      }

      moveTextCursorByScreenDelta(opts.get_text_spacing(), opts.get_text_charlead());
      setCurrentLineEndWorld(getTextCurrentWorld());

      if (text_cursor_x < 0 || text_cursor_x >= opts.grid.width || text_cursor_y < 0 || text_cursor_y >= opts.grid.height) {
        commitPendingTextChanges(commitDescription);
        exitTextMode(false);
        break;
      }
    }

    if (text_mode_active && isChunkInput) {
      commitPendingTextChanges(commitDescription);
    }
  }

  // Legacy viewport callback removed: `main.ts` now owns painter DOM viewport
  // computation from shared runtime/layout state.
  function emitViewport() {
    // no-op
  }

  function updateRect(next_rect: Rect): void {
    rect = next_rect;
    emitViewport();
  }

  // Mouse position for parallax calculations (relative to canvas center, -1 to +1)
  let mouse_offset_x = 0;
  let mouse_offset_y = 0;

  // Status message for user feedback
  let status_message: string | null = null;
  let status_message_time = 0;

  // Gizmo configuration - enable move, resize, and close like other modules
  const gizmo_config: ModuleGizmosConfig = {
    enabled: ['move', 'resize', 'close', 'seamless'],
    can_close: true,
    can_move: true,
    can_save_position: false,
    on_close: opts.on_close,
    on_move: opts.on_move,
  };
  
  const gizmo_state: GizmoState = create_gizmo_state();
  let show_canvas_nav_cluster = false;
  let hovered_canvas_nav_button: CanvasNavButtonId | null = null;
  let pressed_canvas_nav_button: CanvasNavButtonId | null = null;

  // Emit initial viewport
  emitViewport();

  // Cell change tracking for action-based undo
  let pending_changes: CellChange[] = [];
  let is_drawing_batch = false;
  let last_live_stroke_preview_at = 0;
  let last_move_preview_at = 0;
  let last_move_preview_delta_key: string | null = null;
  const LIVE_STROKE_PREVIEW_INTERVAL_MS = 24;
  let active_stroke_world_plane: number | null = null;
  let active_stroke_anchor_world: { x: number; y: number; z: number } | null = null;
  let interaction_current_world: { x: number; y: number; z: number } | null = null;
  let interaction_end_world: { x: number; y: number; z: number } | null = null;
  let shape_start_world: { x: number; y: number; z: number } | null = null;

  function getCanvasTopLeftGizmoCount(): number {
    let count = 0;
    if (gizmo_config.enabled.includes('move') && gizmo_config.can_move) count++;
    if (gizmo_config.enabled.includes('close') && gizmo_config.can_close) count++;
    if (gizmo_config.enabled.includes('save_position') && gizmo_config.can_save_position) count++;
    if (gizmo_config.enabled.includes('resize')) count++;
    if (gizmo_config.enabled.includes('seamless')) count++;
    return count;
  }

  function getCanvasNavHit(x: number, y: number): CanvasNavButtonId | null {
    return get_canvas_nav_hit(rect, show_canvas_nav_cluster, getCanvasTopLeftGizmoCount(), x, y);
  }

  function updateCanvasNavHover(x: number, y: number): void {
    hovered_canvas_nav_button = getCanvasNavHit(x, y);
  }

  function clearCanvasNavInteraction(): void {
    hovered_canvas_nav_button = null;
    pressed_canvas_nav_button = null;
  }

  function getCanvasNavReservedLeftX(): number {
    return get_canvas_nav_reserved_left_x(rect, show_canvas_nav_cluster);
  }

  function getCursorWorldReadout(): string | null {
    const world = cloneWorldPoint(interaction_current_world)
      ?? cloneWorldPoint(text_cursor_world)
      ?? null;
    if (!world) return null;
    return `X:${world.x} Y:${world.y} Z:${world.z}`;
  }

  function showStatus(msg: string): void {
    status_message = msg;
    status_message_time = Date.now();
  }

  function ensureGridShapeState(): void {
      if (selection_bitmap.width !== opts.grid.width || selection_bitmap.height !== opts.grid.height) {
        selection_bitmap = createSelectionBitmap(opts.grid.width, opts.grid.height);
        opts.preview_points.length = 0;
        paste_preview_pos = null;
        text_cursor_x = Math.max(0, Math.min(opts.grid.width - 1, text_cursor_x));
        text_cursor_y = Math.max(0, Math.min(opts.grid.height - 1, text_cursor_y));
        syncTextCursorGridFromWorld();
        current_mouse_pos = null;
      }
    }

  function clamp(n: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, n));
  }

  function getWorldPointForEditPlane(x: number, y: number, plane: number = active_stroke_world_plane ?? opts.get_selected_z()): { x: number; y: number; z: number } | null {
    const fixedPlaneWorld = opts.get_world_point_for_grid_on_plane?.(x, y, plane);
    if (fixedPlaneWorld) return fixedPlaneWorld;
    if (!opts.get_world_point_for_grid_on_plane) {
      return opts.get_world_point_for_grid?.(x, y) ?? { x, y, z: plane };
    }
    return null;
  }

  // Check if a cell can be edited (inside selection or no selection active, and layer not locked)
  function canEditCell(x: number, y: number): boolean {
    if (opts.get_active_group_locked?.()) return false;
    
    // If no selection, allow editing anywhere
    if (!hasSelection(selection_bitmap)) return true;
    // If selection exists, only allow editing inside it
    return isSelected(selection_bitmap, x, y);
  }

  // Helper to get cell from grid at position
  function getGridCell(x: number, y: number): GridCell | null {
    if (x < 0 || x >= opts.grid.width || y < 0 || y >= opts.grid.height) return null;
    const cell = opts.grid.cells[y]?.[x];
    return cell ? cloneGridCell(cell) : null;
  }

  // Track a cell change for undo
  function trackChange(x: number, y: number, oldCell: GridCell, newCell: GridCell): boolean {
    const world = getWorldPointForEditPlane(x, y);
    if (!world) return false;
    return trackWorldChange(world, oldCell, newCell, { x, y });
  }

  function trackTextCursorChange(oldCell: GridCell, newCell: GridCell): boolean {
    const world = cloneWorldPoint(text_cursor_world)
      ?? opts.get_world_point_for_grid?.(text_cursor_x, text_cursor_y)
      ?? getWorldPointForEditPlane(text_cursor_x, text_cursor_y);
    if (!world) return false;
    return trackWorldChange(world, oldCell, newCell, { x: text_cursor_x, y: text_cursor_y });
  }

  function trackWorldChange(world: { x: number; y: number; z: number }, oldCell: GridCell, newCell: GridCell, grid?: { x: number; y: number } | null): boolean {
    const group_id = requireActiveGroupId();
    const existingIndex = pending_changes.findIndex(c => c.worldX === world.x && c.worldY === world.y && c.worldZ === world.z);
    if (existingIndex >= 0 && pending_changes[existingIndex]) {
      // Update newCell but keep original oldCell
      pending_changes[existingIndex].newCell = cloneGridCell(newCell);
    } else {
      const gridPoint = grid ?? opts.get_grid_point_for_world?.(world) ?? null;
      pending_changes.push({
        x: gridPoint?.x ?? 0,
        y: gridPoint?.y ?? 0,
        worldX: world.x,
        worldY: world.y,
        worldZ: world.z,
        group_id,
        oldCell: cloneGridCell(oldCell),
        newCell: cloneGridCell(newCell),
      });
    }
    
    // Also add to batch if batching
    if (is_drawing_batch) {
      const gridPoint = grid ?? opts.get_grid_point_for_world?.(world) ?? null;
      addToGroupBatch(opts.history, {
        x: gridPoint?.x ?? 0,
        y: gridPoint?.y ?? 0,
        worldX: world.x,
        worldY: world.y,
        worldZ: world.z,
        group_id,
        oldCell,
        newCell,
      });
    }
    return true;
  }

  function makeEmptyCell(): GridCell {
    return { char: ' ', graphic: undefined, appearance_slots: undefined, materials: undefined, rgb: { r: 0, g: 0, b: 0 }, weight_index: 0 };
  }

  function isEmptyCell(cell: GridCell | null | undefined): boolean {
    return !cell || (cell.char === ' ' && !cell.graphic);
  }

  function cellsEqual(a: GridCell, b: GridCell): boolean {
    return gridCellsEqual(a, b);
  }

  function makeCellFromBrush(brush: Brush): GridCell {
    return {
      char: brush.char,
      graphic: brush.graphic ? { ...brush.graphic } : undefined,
      appearance_slots: clone_appearance_slot_assignments(brush.appearance_slots),
      materials: brush.materials ? { ...brush.materials } : undefined,
      rgb: { ...brush.rgb },
      weight_index: brush.weight_index,
    };
  }

  function mergeBrushColorIntoSlots(cell: GridCell, brush: Brush, slot_targets?: AppearanceSlotTargetMask): GridCell {
    const next = cloneGridCell(cell);
    const slots = get_enabled_appearance_slots(slot_targets ?? DEFAULT_APPEARANCE_SLOT_TARGET_MASK);
    const next_slots = clone_appearance_slot_assignments(next.appearance_slots) ?? {};
    for (const slot of slots) {
      const value = brush.appearance_slots?.[slot];
      if (value) {
        next_slots[slot] = value.kind === 'material'
          ? { kind: 'material', material_id: value.material_id }
          : { kind: 'flat_rgb', rgb: { ...value.rgb } };
      }
    }
    next.appearance_slots = Object.keys(next_slots).length > 0 ? next_slots : undefined;
    if (next.materials) {
      const next_materials = { ...next.materials };
      for (const slot of slots) delete next_materials[slot];
      next.materials = Object.keys(next_materials).length > 0 ? next_materials : undefined;
    }
    return next;
  }

  function clearCellColorSlots(cell: GridCell, slot_targets?: AppearanceSlotTargetMask): GridCell {
    const next = cloneGridCell(cell);
    const slots = get_enabled_appearance_slots(slot_targets ?? DEFAULT_APPEARANCE_SLOT_TARGET_MASK);
    const next_slots = clone_appearance_slot_assignments(next.appearance_slots);
    if (next_slots) {
      for (const slot of slots) delete next_slots[slot];
      next.appearance_slots = Object.keys(next_slots).length > 0 ? next_slots : undefined;
    }
    if (next.materials) {
      const next_materials = { ...next.materials };
      for (const slot of slots) delete next_materials[slot];
      next.materials = Object.keys(next_materials).length > 0 ? next_materials : undefined;
    }
    return next;
  }

  function applyBrushEditToCell(cell: GridCell, brush: Brush, channels: EditChannels, slot_targets?: AppearanceSlotTargetMask): GridCell {
    const next = cloneGridCell(cell);
    if (channels.char && channels.color && channels.weight) {
      return makeCellFromBrush(brush);
    }
    if (channels.char) {
      next.char = brush.char;
      next.graphic = brush.graphic ? { ...brush.graphic } : undefined;
      next.appearance_slots = clone_appearance_slot_assignments(brush.appearance_slots);
      next.materials = brush.materials ? { ...brush.materials } : undefined;
    }
    if (channels.color) {
      next.rgb = { ...brush.rgb };
      if (!channels.char) {
        const color_merged = mergeBrushColorIntoSlots(next, brush, slot_targets);
        next.appearance_slots = color_merged.appearance_slots;
        next.materials = color_merged.materials;
      }
    }
    if (channels.weight) {
      next.weight_index = brush.weight_index;
      if (next.graphic) next.graphic = { ...next.graphic, weight_index: brush.weight_index as 0 | 1 | 2 | 3 };
    }
    return next;
  }

  function applyEraserEditToCell(cell: GridCell, channels: EditChannels, slot_targets?: AppearanceSlotTargetMask): GridCell {
    const next = cloneGridCell(cell);
    if (channels.char) {
      next.char = ' ';
      next.graphic = undefined;
      next.appearance_slots = undefined;
      next.materials = undefined;
    }
    if (channels.color) {
      next.rgb = { r: 0, g: 0, b: 0 };
      if (!channels.char) {
        const color_cleared = clearCellColorSlots(next, slot_targets);
        next.appearance_slots = color_cleared.appearance_slots;
        next.materials = color_cleared.materials;
      } else {
        next.appearance_slots = undefined;
        next.materials = undefined;
      }
    }
    if (channels.weight) {
      next.weight_index = 0;
      if (next.graphic) next.graphic = { ...next.graphic, weight_index: 0 };
    }
    return next;
  }

  function sampleActiveGroupWorldCell(world: { x: number; y: number; z: number }): GridCell {
    const cell = opts.get_active_group_world_cell?.(world) ?? opts.get_world_cell(world);
    return cell ? cloneGridCell(cell) : makeEmptyCell();
  }

  function getActiveViewPlaneAxis(): 'x' | 'y' | 'z' {
    const view = opts.get_view_state?.() ?? make_place_view_state('top', 0);
    return get_principal_view_plane_axis(view.principal_view);
  }

  function getActiveGroupWorldVoxels(): Array<{ x: number; y: number; z: number; cell: GridCell }> {
    return (opts.get_active_group_world_voxels?.() ?? []).map((entry) => ({
      x: entry.x,
      y: entry.y,
      z: entry.z,
      cell: cloneGridCell(entry.cell),
    }));
  }

  function getActiveGroupWorldBounds(): { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number } | null {
    return opts.get_active_group_world_bounds?.() ?? null;
  }

  type ProjectedGroupBorderSlice = {
    plane: number;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };

  function isPlaybackRunning(): boolean {
    return opts.get_is_playing?.() === true;
  }

  function getWorldPlaneCoordinateForAxis(world: { x: number; y: number; z: number }, axis: 'x' | 'y' | 'z'): number {
    return axis === 'x' ? Math.floor(world.x) : axis === 'y' ? Math.floor(world.y) : Math.floor(world.z);
  }

  function getActiveGroupProjectedBorderSlices(delta?: { x: number; y: number; z: number } | null): ProjectedGroupBorderSlice[] {
    const projectedByPlane = new Map<number, ProjectedGroupBorderSlice>();
    const planeAxis = getActiveViewPlaneAxis();
    const dx = delta?.x ?? 0;
    const dy = delta?.y ?? 0;
    const dz = delta?.z ?? 0;
    for (const voxel of getActiveGroupWorldVoxels()) {
      const shiftedWorld = { x: voxel.x + dx, y: voxel.y + dy, z: voxel.z + dz };
      const plane = getWorldPlaneCoordinateForAxis(shiftedWorld, planeAxis);
      const gridPoint = opts.get_grid_point_for_world?.(shiftedWorld) ?? null;
      if (!gridPoint) continue;
      const existing = projectedByPlane.get(plane);
      if (existing) {
        existing.minX = Math.min(existing.minX, gridPoint.x);
        existing.minY = Math.min(existing.minY, gridPoint.y);
        existing.maxX = Math.max(existing.maxX, gridPoint.x);
        existing.maxY = Math.max(existing.maxY, gridPoint.y);
      } else {
        projectedByPlane.set(plane, {
          plane,
          minX: gridPoint.x,
          minY: gridPoint.y,
          maxX: gridPoint.x,
          maxY: gridPoint.y,
        });
      }
    }
    return Array.from(projectedByPlane.values()).sort((a, b) => a.plane - b.plane);
  }

  function drawProjectedGroupBorderSlices(c: Canvas, rect: Rect, slices: ProjectedGroupBorderSlice[], rgb: Rgb, weight_index: number, render_index: number): void {
    for (const slice of slices) {
      const x0 = Math.max(rect.x0, rect.x0 + slice.minX);
      const x1 = Math.min(rect.x1, rect.x0 + slice.maxX);
      const y0 = Math.max(rect.y0, rect.y0 + slice.minY);
      const y1 = Math.min(rect.y1, rect.y0 + slice.maxY);
      if (x0 > x1 || y0 > y1) continue;
      for (let x = x0; x <= x1; x += 1) {
        c.set(x, y0, { char: '─', rgb, style: 'regular', weight_index, render_index });
        c.set(x, y1, { char: '─', rgb, style: 'regular', weight_index, render_index });
      }
      for (let y = y0; y <= y1; y += 1) {
        c.set(x0, y, { char: '│', rgb, style: 'regular', weight_index, render_index });
        c.set(x1, y, { char: '│', rgb, style: 'regular', weight_index, render_index });
      }
      c.set(x0, y0, { char: '└', rgb, style: 'regular', weight_index, render_index });
      c.set(x1, y0, { char: '┘', rgb, style: 'regular', weight_index, render_index });
      c.set(x0, y1, { char: '┌', rgb, style: 'regular', weight_index, render_index });
      c.set(x1, y1, { char: '┐', rgb, style: 'regular', weight_index, render_index });
    }
  }

  function getProjectedGroupBorderSliceHit(grid_x: number, grid_y: number, slices: ProjectedGroupBorderSlice[]): ProjectedGroupBorderSlice | null {
    for (const slice of slices) {
      if (grid_x < slice.minX || grid_x > slice.maxX || grid_y < slice.minY || grid_y > slice.maxY) continue;
      if (grid_x === slice.minX || grid_x === slice.maxX || grid_y === slice.minY || grid_y === slice.maxY) return slice;
    }
    return null;
  }

  function canEditGroupLocation(): boolean {
    return !isPlaybackRunning()
      && !opts.get_active_group_locked?.()
      && getActiveGroupWorldVoxels().length > 0
      && typeof opts.on_group_location_drag_commit === 'function';
  }

  function clearGroupLocationDrag(): void {
    group_location_drag_active = false;
    group_location_drag_anchor_world = null;
    group_location_drag_plane = null;
    group_location_drag_preview_delta = null;
  }

  function resolveGroupLocationDragDeltaAt(grid_x: number, grid_y: number): { x: number; y: number; z: number } | null {
    if (!group_location_drag_anchor_world || group_location_drag_plane === null) return null;
    const current = opts.get_world_point_for_grid_on_plane?.(grid_x, grid_y, group_location_drag_plane)
      ?? opts.get_world_point_for_grid?.(grid_x, grid_y)
      ?? getWorldPointForEditPlane(grid_x, grid_y, group_location_drag_plane)
      ?? null;
    if (!current) return null;
    return {
      x: current.x - group_location_drag_anchor_world.x,
      y: current.y - group_location_drag_anchor_world.y,
      z: current.z - group_location_drag_anchor_world.z,
    };
  }

  function updateGroupLocationHover(grid_x: number, grid_y: number): void {
    group_location_border_hovered = canEditGroupLocation()
      && Boolean(getProjectedGroupBorderSliceHit(grid_x, grid_y, getActiveGroupProjectedBorderSlices(group_location_drag_preview_delta)));
  }

  function startGroupLocationDrag(grid_x: number, grid_y: number): boolean {
    if (!canEditGroupLocation()) return false;
    const hitSlice = getProjectedGroupBorderSliceHit(grid_x, grid_y, getActiveGroupProjectedBorderSlices());
    if (!hitSlice) return false;
    const anchorWorld = opts.get_world_point_for_grid_on_plane?.(grid_x, grid_y, hitSlice.plane)
      ?? opts.get_world_point_for_grid?.(grid_x, grid_y)
      ?? getWorldPointForEditPlane(grid_x, grid_y, hitSlice.plane)
      ?? null;
    if (!anchorWorld) return false;
    group_location_drag_active = true;
    group_location_drag_anchor_world = anchorWorld;
    group_location_drag_plane = hitSlice.plane;
    group_location_drag_preview_delta = { x: 0, y: 0, z: 0 };
    group_location_border_hovered = true;
    showStatus(`Move group location @ ${hitSlice.plane}`);
    return true;
  }

  function updateGroupLocationDrag(grid_x: number, grid_y: number): void {
    const delta = resolveGroupLocationDragDeltaAt(grid_x, grid_y);
    if (!delta) return;
    group_location_drag_preview_delta = delta;
  }

  function commitGroupLocationDrag(grid_x: number, grid_y: number): void {
    const delta = resolveGroupLocationDragDeltaAt(grid_x, grid_y) ?? group_location_drag_preview_delta;
    if (!delta) {
      clearGroupLocationDrag();
      return;
    }
    if (delta.x === 0 && delta.y === 0 && delta.z === 0) {
      clearGroupLocationDrag();
      return;
    }
    const applied = opts.on_group_location_drag_commit?.(delta) ?? false;
    clearGroupLocationDrag();
    if (applied) showStatus(`Moved group ${delta.x},${delta.y},${delta.z}`);
  }

  function getBoundsAxisMin(bounds: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }, axis: 'x' | 'y' | 'z'): number {
    return axis === 'x' ? bounds.minX : axis === 'y' ? bounds.minY : bounds.minZ;
  }

  function getBoundsAxisMax(bounds: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }, axis: 'x' | 'y' | 'z'): number {
    return axis === 'x' ? bounds.maxX : axis === 'y' ? bounds.maxY : bounds.maxZ;
  }

  function isWorldInsideBounds(world: { x: number; y: number; z: number }, bounds: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }): boolean {
    return world.x >= bounds.minX
      && world.x <= bounds.maxX
      && world.y >= bounds.minY
      && world.y <= bounds.maxY
      && world.z >= bounds.minZ
      && world.z <= bounds.maxZ;
  }

  function enumerateBoundedWorldDomain(bounds: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }): Array<{ x: number; y: number; z: number }> {
    const out: Array<{ x: number; y: number; z: number }> = [];
    for (let z = bounds.minZ; z <= bounds.maxZ; z += 1) {
      for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
        for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
          out.push({ x, y, z });
        }
      }
    }
    return out;
  }

  function getBrushSelectionWorldCells(x: number, y: number, size: number, plane: number): Array<{ x: number; y: number; z: number }> {
    const out: Array<{ x: number; y: number; z: number }> = [];
    const seen = new Set<string>();
    const offset = Math.floor(size / 2);
    for (let dy = 0; dy < size; dy += 1) {
      for (let dx = 0; dx < size; dx += 1) {
        const draw_x = x - offset + dx;
        const draw_y = y - offset + dy;
        if (draw_x < 0 || draw_x >= opts.grid.width || draw_y < 0 || draw_y >= opts.grid.height) continue;
        const world = getWorldPointForEditPlane(draw_x, draw_y, plane);
        if (!world) continue;
        const key = worldKey(world);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(world);
      }
    }
    return out;
  }

  function applySelectionBrushAt(x: number, y: number, size: number, mode: SelectionMode, plane: number): void {
    emitSelectionCells(mode, getBrushSelectionWorldCells(x, y, size, plane), 'brush');
  }

  function applySelectionBrushLine(x0: number, y0: number, x1: number, y1: number, size: number, mode: SelectionMode, plane: number): void {
    const seen = new Set<string>();
    const out: Array<{ x: number; y: number; z: number }> = [];
    for (const point of previewLine(x0, y0, x1, y1)) {
      for (const world of getBrushSelectionWorldCells(point.x, point.y, size, plane)) {
        const key = worldKey(world);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(world);
      }
    }
    emitSelectionCells(mode, out, 'brush');
  }

  function buildSelectionWorldCellsFromBitmap(bitmap: SelectionBitmap, args: { depthMin: number; depthMax: number }): Array<{ x: number; y: number; z: number }> {
    const out: Array<{ x: number; y: number; z: number }> = [];
    const seen = new Set<string>();
    const bounds = getActiveGroupWorldBounds();
    if (!bounds) return out;
    for (let y = 0; y < bitmap.height; y += 1) {
      for (let x = 0; x < bitmap.width; x += 1) {
        if (!isSelected(bitmap, x, y)) continue;
        for (let plane = Math.min(args.depthMin, args.depthMax); plane <= Math.max(args.depthMin, args.depthMax); plane += 1) {
          const world = opts.get_world_point_for_grid_on_plane?.(x, y, plane) ?? null;
          if (!world || !isWorldInsideBounds(world, bounds)) continue;
          const key = worldKey(world);
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ x: world.x, y: world.y, z: world.z });
        }
      }
    }
    return out;
  }

  function buildRectSelectionWorldCells(startWorld: { x: number; y: number; z: number }, endWorld: { x: number; y: number; z: number }, allDepths: boolean): Array<{ x: number; y: number; z: number }> {
    const bounds = getActiveGroupWorldBounds();
    if (!bounds) return [];
    const axis = getActiveViewPlaneAxis();
    let minX = Math.min(startWorld.x, endWorld.x);
    let maxX = Math.max(startWorld.x, endWorld.x);
    let minY = Math.min(startWorld.y, endWorld.y);
    let maxY = Math.max(startWorld.y, endWorld.y);
    let minZ = Math.min(startWorld.z, endWorld.z);
    let maxZ = Math.max(startWorld.z, endWorld.z);
    if (allDepths) {
      if (axis === 'x') {
        minX = bounds.minX;
        maxX = bounds.maxX;
      } else if (axis === 'y') {
        minY = bounds.minY;
        maxY = bounds.maxY;
      } else {
        minZ = bounds.minZ;
        maxZ = bounds.maxZ;
      }
    }
    minX = Math.max(minX, bounds.minX);
    maxX = Math.min(maxX, bounds.maxX);
    minY = Math.max(minY, bounds.minY);
    maxY = Math.min(maxY, bounds.maxY);
    minZ = Math.max(minZ, bounds.minZ);
    maxZ = Math.min(maxZ, bounds.maxZ);
    const out: Array<{ x: number; y: number; z: number }> = [];
    for (let z = minZ; z <= maxZ; z += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          out.push({ x, y, z });
        }
      }
    }
    return out;
  }

  function emitWorldSelectionChange(args: { kind: 'rect' | 'lasso' | 'clear' | 'select_all' | 'invert'; mode?: SelectionMode; cells?: Array<{ x: number; y: number; z: number }> }): void {
    opts.on_world_selection_change?.(args);
  }

  function resetSelectionDragState(): void {
    is_selecting = false;
    selection_drag_start = null;
    selection_drag_start_world = null;
    selection_drag_end_world = null;
    selection_drag_start_plane = null;
    selection_drag_end_plane = null;
    interaction_current_world = null;
    interaction_end_world = null;
    opts.preview_points = [];
  }

  function getSelectionDomainPlaneRange(allDepths: boolean): { depthMin: number; depthMax: number } | null {
    const axis = getActiveViewPlaneAxis();
    const bounds = getActiveGroupWorldBounds();
    if (allDepths && bounds) {
      return {
        depthMin: getBoundsAxisMin(bounds, axis),
        depthMax: getBoundsAxisMax(bounds, axis),
      };
    }
    return getSelectionPlaneRange();
  }

  function formatSelectionVolumeLabel(width: number, height: number, depthMin?: number | null, depthMax?: number | null): string {
    const safeMin = typeof depthMin === 'number' ? depthMin : 0;
    const safeMax = typeof depthMax === 'number' ? depthMax : safeMin;
    const depth = Math.abs(safeMax - safeMin) + 1;
    return `Selecting: ${width}x${height}x${depth} DEPTH:${safeMin}->${safeMax}`;
  }

  function applyBucketFill(button: number, grid_x: number, grid_y: number, modifiers: { shift: boolean; ctrl: boolean; alt: boolean; meta: boolean }): number {
    const brush = getBrushForButton(button);
    const editChannels = resolve_edit_channels_with_modifiers(
      opts.get_brush_edit_channels_for_button?.(button === 2 ? 2 : 0) ?? { char: true, color: true, weight: true },
      modifiers,
    );
    if (!has_any_edit_channel(editChannels)) return 0;
    const startWorld = getWorldPointForEditPlane(grid_x, grid_y, opts.get_focus_world_plane?.() ?? opts.get_selected_z());
    if (!startWorld) return 0;
    const bounds = getActiveGroupWorldBounds();
    if (!bounds || !isWorldInsideBounds(startWorld, bounds)) return 0;
    const startCell = sampleActiveGroupWorldCell(startWorld);
    const slotTargets = getAppearanceSlotTargetsForButton(button);
    const nextStartCell = applyBrushEditToCell(startCell, brush, editChannels, slotTargets);
    if (cellsEqual(startCell, nextStartCell)) return 0;
    const selectChannels = getBucketSelectChannelsForButton(button);
    const domain = enumerateBoundedWorldDomain(bounds);
    if (domain.length < 1) return 0;
    const filled = get_flood_fill_voxels({
      start: startWorld,
      sample: (world) => {
        if (!isWorldInsideBounds(world, bounds)) return null;
        const sampled = sampleActiveGroupWorldCell(world);
        return {
          char: sampled.char,
          graphic: sampled.graphic ? { ...sampled.graphic } : undefined,
          appearance_slots: clone_appearance_slot_assignments(sampled.appearance_slots) as any,
          materials: (sampled.materials ? { ...sampled.materials } : undefined) as any,
          rgb: { ...sampled.rgb },
          weight: sampled.weight_index,
        };
      },
      matches: (candidate, target) => cells_match_edit_channels(candidate, target, selectChannels),
      enumerate_domain: () => domain,
      same_depth_only: opts.get_bucket_same_depth_only?.() ?? true,
      allow_diagonal: opts.get_bucket_allow_diagonal?.() ?? false,
      continuous: opts.get_bucket_continuous?.() ?? true,
      plane_axis: getActiveViewPlaneAxis(),
    });
    let changed = 0;
    for (const world of filled) {
      const oldCell = sampleActiveGroupWorldCell(world);
      const newCell = applyBrushEditToCell(oldCell, brush, editChannels, slotTargets);
      if (cellsEqual(oldCell, newCell)) continue;
      if (!trackWorldChange(world, oldCell, newCell, opts.get_grid_point_for_world?.(world) ?? null)) continue;
      changed += 1;
    }
    return changed;
  }

  function applyBucketSelection(button: number, grid_x: number, grid_y: number): number {
    const startWorld = getWorldPointForEditPlane(grid_x, grid_y, opts.get_focus_world_plane?.() ?? opts.get_selected_z());
    if (!startWorld) return 0;
    const bounds = getActiveGroupWorldBounds();
    if (!bounds || !isWorldInsideBounds(startWorld, bounds)) return 0;
    const selectChannels = getBucketSelectChannelsForButton(button);
    const domain = enumerateBoundedWorldDomain(bounds);
    if (domain.length < 1) return 0;
    const filled = get_flood_fill_voxels({
      start: startWorld,
      sample: (world) => {
        if (!isWorldInsideBounds(world, bounds)) return null;
        const sampled = sampleActiveGroupWorldCell(world);
        return {
          char: sampled.char,
          graphic: sampled.graphic ? { ...sampled.graphic } : undefined,
          appearance_slots: clone_appearance_slot_assignments(sampled.appearance_slots) as any,
          materials: (sampled.materials ? { ...sampled.materials } : undefined) as any,
          rgb: { ...sampled.rgb },
          weight: sampled.weight_index,
        };
      },
      matches: (candidate, target) => cells_match_edit_channels(candidate, target, selectChannels),
      enumerate_domain: () => domain,
      same_depth_only: opts.get_bucket_same_depth_only?.() ?? true,
      allow_diagonal: opts.get_bucket_allow_diagonal?.() ?? false,
      continuous: opts.get_bucket_continuous?.() ?? true,
      plane_axis: getActiveViewPlaneAxis(),
    });
    emitSelectionCells(opts.get_selection_mode(), filled, 'bucket');
    return filled.length;
  }

  function isIgnoredPasteCell(cell: GridCell | null, ignoreColorRgb: { r: number; g: number; b: number }): boolean {
    if (opts.get_paste_ignore_space() && (!cell || (cell.char === ' ' && !cell.graphic))) return true;
    if (!cell) return false;
    if (opts.get_paste_ignore_black() && cell.rgb.r === 0 && cell.rgb.g === 0 && cell.rgb.b === 0) return true;
    if (opts.get_paste_ignore_white() && cell.rgb.r === 255 && cell.rgb.g === 255 && cell.rgb.b === 255) return true;
    if (opts.get_paste_ignore_color()) {
      const colorThreshold = 30;
      const rDiff = Math.abs(cell.rgb.r - ignoreColorRgb.r);
      const gDiff = Math.abs(cell.rgb.g - ignoreColorRgb.g);
      const bDiff = Math.abs(cell.rgb.b - ignoreColorRgb.b);
      if (rDiff <= colorThreshold && gDiff <= colorThreshold && bDiff <= colorThreshold) return true;
    }
    return false;
  }

  function getResolvedCommitPlane(): number {
    return getWorldPointPlaneCoordinate(interaction_end_world ?? interaction_current_world ?? active_stroke_anchor_world) ?? opts.get_selected_z();
  }

  function copyCurrentSelection(): void {
    if (!hasSelection(selection_bitmap)) {
      showStatus('No selection to copy!');
      return;
    }
    const encoded3d = opts.get_world_copy_data?.();
    const data = copyFromGrid(opts.grid, selection_bitmap);
    if (!encoded3d && !data) {
      showStatus('No selection to copy!');
      return;
    }
    const encoded = encoded3d ?? encodeToSpecialFormat(data!);
    if (encoded3d) opts.set_world_copy_data?.(encoded3d);
    opts.on_copy_data?.(encoded);
    navigator.clipboard?.writeText(encoded).catch(() => {});
    showStatus(encoded3d ? 'Copied 3D selection to clipboard' : `Copied ${data!.width}x${data!.height} to clipboard`);
  }

  function finalizePendingChanges(): void {
    if ((is_drawing || is_erasing) && pending_changes.length > 0) {
      const selected_z = getResolvedCommitPlane();
      let tool_name = 'Draw';
      let action_type: 'draw_cells' | 'erase_cells' = 'draw_cells';
      if (is_erasing) {
        tool_name = 'Erase';
        action_type = 'erase_cells';
      } else if (active_stroke_tool === 'line') {
        tool_name = 'Draw Line';
      } else if (active_stroke_tool === 'rect_stroke') {
        tool_name = 'Draw Rectangle (stroke)';
      } else if (active_stroke_tool === 'rect_fill') {
        tool_name = 'Draw Rectangle (fill)';
      } else if (active_draw_channels.char && !active_draw_channels.color && !active_draw_channels.weight) {
        tool_name = 'Apply Char';
      } else if (!active_draw_channels.char && !active_draw_channels.color && active_draw_channels.weight) {
        tool_name = 'Apply Weight';
      } else if (!active_draw_channels.char && active_draw_channels.color && !active_draw_channels.weight) {
        tool_name = 'Apply Color';
      } else if (active_draw_channels.char && active_draw_channels.color && !active_draw_channels.weight) {
        tool_name = 'Apply Char+Color';
      }
      commitLoggedCellChanges(action_type, tool_name, selected_z);
    }
    clearActiveStrokeState();
  }

  function moveTextCursorTo(grid_x: number, grid_y: number): void {
    text_cursor_x = clamp(Math.floor(grid_x), 0, Math.max(0, opts.grid.width - 1));
    text_cursor_y = clamp(Math.floor(grid_y), 0, Math.max(0, opts.grid.height - 1));
    text_cursor_world = opts.get_world_point_for_grid?.(text_cursor_x, text_cursor_y) ?? { x: text_cursor_x, y: text_cursor_y, z: opts.get_selected_z() };
    emitTextCursorAnchorChanged();
  }

  function syncTextCursorGridFromWorld(): void {
    if (!text_mode_active || !text_cursor_world) return;
    const gridPoint = opts.get_grid_point_for_world?.(text_cursor_world);
    if (gridPoint) {
      text_cursor_x = clamp(Math.floor(gridPoint.x), 0, Math.max(0, opts.grid.width - 1));
      text_cursor_y = clamp(Math.floor(gridPoint.y), 0, Math.max(0, opts.grid.height - 1));
    }
  }

  function moveTextCursorByGridDelta(dx: number, dy: number): boolean {
    syncTextCursorGridFromWorld();
    const nextX = text_cursor_x + dx;
    const nextY = text_cursor_y + dy;
    if (nextX < 0 || nextX >= opts.grid.width || nextY < 0 || nextY >= opts.grid.height) return false;
    moveTextCursorTo(nextX, nextY);
    return true;
  }

  function getTextStartGridX(): number {
    if (text_start_world) {
      const gridPoint = opts.get_grid_point_for_world?.(text_start_world);
      if (gridPoint) return clamp(Math.floor(gridPoint.x), 0, Math.max(0, opts.grid.width - 1));
    }
    return text_start_x;
  }

  function getSelectionPlaneRange(): { depthMin: number; depthMax: number } | null {
    if (selection_drag_start_plane === null || selection_drag_end_plane === null) return null;
    return {
      depthMin: Math.min(selection_drag_start_plane, selection_drag_end_plane),
      depthMax: Math.max(selection_drag_start_plane, selection_drag_end_plane),
    };
  }

  // Capture a region of the grid for before/after comparison
  function captureRegion(minX: number, minY: number, maxX: number, maxY: number): Map<string, GridCell> {
    const region = new Map<string, GridCell>();
    const startX = Math.max(0, minX);
    const endX = Math.min(opts.grid.width - 1, maxX);
    const startY = Math.max(0, minY);
    const endY = Math.min(opts.grid.height - 1, maxY);
    
    for (let y = startY; y <= endY; y++) {
      for (let x = startX; x <= endX; x++) {
        const cell = getGridCell(x, y);
        if (cell) {
          region.set(`${x},${y}`, cloneGridCell(cell));
        }
      }
    }
    return region;
  }

  // Compare before/after regions and track changes
  function diffRegion(before: Map<string, GridCell>, minX: number, minY: number, maxX: number, maxY: number): void {
    const startX = Math.max(0, minX);
    const endX = Math.min(opts.grid.width - 1, maxX);
    const startY = Math.max(0, minY);
    const endY = Math.min(opts.grid.height - 1, maxY);
    
    for (let y = startY; y <= endY; y++) {
      for (let x = startX; x <= endX; x++) {
        const key = `${x},${y}`;
        const oldCell = before.get(key);
        const newCell = getGridCell(x, y);
        
        if (oldCell && newCell && !gridCellsEqual(oldCell, newCell)) {
          trackChange(x, y, oldCell, newCell);
        }
      }
    }
  }

  function drawWithBrushSize(x: number, y: number, is_eraser: boolean, brush: Brush, size: number): void {
    const offset = Math.floor(size / 2);
    
    // (debug logging removed)
    
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        const draw_x = x - offset + dx;
        const draw_y = y - offset + dy;
        
        if (draw_x >= 0 && draw_x < opts.grid.width &&
            draw_y >= 0 && draw_y < opts.grid.height &&
            canEditCell(draw_x, draw_y)) {
          
          const oldCell = getGridCell(draw_x, draw_y);
          
          if (is_eraser) {
            eraseCell(opts.grid, draw_x, draw_y);
          } else {
            drawCell(opts.grid, draw_x, draw_y, brush);
          }
          
          // Always track changes
            if (oldCell) {
              const newCell = getGridCell(draw_x, draw_y);
              if (newCell) {
                if (!trackChange(draw_x, draw_y, oldCell, newCell)) {
                  opts.grid.cells[draw_y]![draw_x] = cloneGridCell(oldCell);
                }
              }
            }
        }
      }
    }
  }

  function eraseWithBrushSizeAndChannels(x: number, y: number, size: number, channels: EditChannels): void {
    if (!has_any_edit_channel(channels)) return;
    const offset = Math.floor(size / 2);
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        const draw_x = x - offset + dx;
        const draw_y = y - offset + dy;
        if (draw_x < 0 || draw_x >= opts.grid.width || draw_y < 0 || draw_y >= opts.grid.height || !canEditCell(draw_x, draw_y)) continue;
        const oldCell = getGridCell(draw_x, draw_y);
        const cell = getCell(opts.grid, draw_x, draw_y);
        if (!cell || !oldCell) continue;
        const newCell = applyEraserEditToCell(cell, channels, getAppearanceSlotTargetsForButton(getDragButton()));
        if (cellsEqual(oldCell, newCell)) continue;
        opts.grid.cells[draw_y]![draw_x] = cloneGridCell(newCell);
        const committed = getGridCell(draw_x, draw_y);
        if (committed && !trackChange(draw_x, draw_y, oldCell, committed)) {
          opts.grid.cells[draw_y]![draw_x] = { ...oldCell };
        }
      }
    }
  }

  function drawLineWithBrushSize(x0: number, y0: number, x1: number, y1: number, is_eraser: boolean, brush: Brush, size: number): void {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let curr_x = x0;
    let curr_y = y0;

    while (true) {
      drawWithBrushSize(curr_x, curr_y, is_eraser, brush, size);
      if (curr_x === x1 && curr_y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; curr_x += sx; }
      if (e2 < dx) { err += dx; curr_y += sy; }
    }
    
    // Note: Line tool logs immediately after each stroke
    // The pending_changes will be logged in OnPointerUp for continuous drawing
  }

  function applyBrushEditWithBrushSize(x: number, y: number, brush: Brush, size: number, channels: EditChannels): void {
    if (!has_any_edit_channel(channels)) return;
    if (channels.char && channels.color && channels.weight) {
      drawWithBrushSize(x, y, false, brush, size);
      return;
    }

    const offset = Math.floor(size / 2);
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        const draw_x = x - offset + dx;
        const draw_y = y - offset + dy;
        if (draw_x < 0 || draw_x >= opts.grid.width || draw_y < 0 || draw_y >= opts.grid.height || !canEditCell(draw_x, draw_y)) continue;
        const oldCell = getGridCell(draw_x, draw_y);
        const cell = getCell(opts.grid, draw_x, draw_y);
        if (!cell || !oldCell || (cell.char === ' ' && !cell.graphic)) continue;
        const editedCell = applyBrushEditToCell(cloneGridCell(cell), brush, channels, getAppearanceSlotTargetsForButton(getDragButton()));
        opts.grid.cells[draw_y]![draw_x] = cloneGridCell(editedCell);
        const newCell = getGridCell(draw_x, draw_y);
        if (newCell && !trackChange(draw_x, draw_y, oldCell, newCell)) {
          opts.grid.cells[draw_y]![draw_x] = cloneGridCell(oldCell);
        }
      }
    }
  }

  function drawLineWithBrushEditChannels(x0: number, y0: number, x1: number, y1: number, brush: Brush, size: number, channels: EditChannels): void {
    for (const point of previewLine(x0, y0, x1, y1)) {
      applyBrushEditWithBrushSize(point.x, point.y, brush, size, channels);
    }
  }

  // Update flash animation
  function updateFlash(): void {
    const now = Date.now();
    if (now - last_flash_time > 500) {
      flash_state = (flash_state + 1) % 2;
      last_flash_time = now;
    }
  }

  const module: Module & {
    clearSelection: () => void;
    selectAll: () => void;
    invertSelection: () => void;
    hasSelection: () => boolean;
    getSelectionBitmap: () => SelectionBitmap;
    setSelectionBitmap: (bitmap: SelectionBitmap) => void;
    emitViewport: () => void;
    getPanTargetAdapter: () => ReturnType<typeof create_painter_canvas_pan_adapter>;
    getTextCursorInteractionAnchor: () => PainterInteractionAnchor | null;
    resolveInteractionTargets: (x: number, y: number) => OrderedResolvedTargets;
    finalizePendingChanges: () => void;
    handleDepthStepDuringActiveStroke: (nextPlane: number) => void;
    hasWorldPastePreview: () => boolean;
    stepPasteViewAction: (action: 'swing_left' | 'swing_right' | 'swing_up' | 'swing_down' | 'roll_left' | 'roll_right') => void;
    setPasteAngleMode: () => void;
  } = {
    id: opts.id,
    get rect() { return rect; },
    set rect(next_rect: Rect) { updateRect(next_rect); },
    Focusable: true,
    
    OnFocus(): void {
      // Canvas module gained focus
    },
    
    // Selection manipulation methods
    clearSelection: () => {
      clearSelection(selection_bitmap);
      emitWorldSelectionChange({ kind: 'clear' });
      if (!opts.on_world_selection_change) opts.on_selection_change?.({ kind: 'clear' });
    },
    selectAll: () => {
      emitWorldSelectionChange({ kind: 'select_all' });
      if (!opts.on_world_selection_change) opts.on_selection_change?.({ kind: 'select_all' });
    },
    invertSelection: () => {
      emitWorldSelectionChange({ kind: 'invert' });
      if (!opts.on_world_selection_change) opts.on_selection_change?.({ kind: 'invert' });
    },
    hasSelection: () => {
      return hasSelection(selection_bitmap);
    },
    getSelectionBitmap: () => ({
      width: selection_bitmap.width,
      height: selection_bitmap.height,
      cells: selection_bitmap.cells.map(row => [...row]),
    }),
    setSelectionBitmap: (bitmap: SelectionBitmap) => {
      selection_bitmap = {
        width: bitmap.width,
        height: bitmap.height,
        cells: bitmap.cells.map(row => [...row]),
      };
    },

    emitViewport: () => {
      emitViewport();
    },

    getPanTargetAdapter: () => getCanvasPanAdapter(),

    getTextCursorInteractionAnchor: () => getTextCursorInteractionAnchor(),

    resolveInteractionTargets: (x: number, y: number) => buildResolvedTargetsForPointer(x, y),

    finalizePendingChanges: () => finalizePendingChanges(),

    handleDepthStepDuringActiveStroke: (nextPlane: number) => handleDepthStepDuringActiveStroke(nextPlane),

    Draw(c: Canvas): void {
      ensureGridShapeState();
      updateFlash();

      const totalPan = getTotalPan();
      const viewport_width = getViewportWidth();
      const viewport_height = getViewportHeight();
      const start_x = clamp(Math.floor(totalPan.x), 0, opts.grid.width - 1);
      const end_x = clamp(Math.floor(totalPan.x + viewport_width), 0, opts.grid.width);
      const start_y = clamp(Math.floor(totalPan.y), 0, opts.grid.height - 1);
      const end_y = clamp(Math.floor(totalPan.y + viewport_height), 0, opts.grid.height);

      const selected_z = opts.get_selected_z();
      // NOTE: All layers (including selected) are now rendered by the DOM renderer
      // with proper transforms, parallax, and scaling. 
      // The type grid only renders editing overlays (selection, paste preview, etc).
      // This allows you to see the full 3D effect with all layers visible.
      
      // ARCHIVE: Old type grid layer rendering - replaced by DOM renderer
      /*
      const selectedLayer = space.layers.get(selected_z);
      if (selectedLayer && selectedLayer.visible) {
        for (let gy = start_y; gy < end_y; gy++) {
          for (let gx = start_x; gx < end_x; gx++) {
            const cell = selectedLayer.cells[gy]?.[gx];
            if (!cell || cell.char === ' ') continue;
            const canvas_x = rect.x0 + (gx - start_x);
            const canvas_y = rect.y0 + (gy - start_y);
            if (canvas_x < rect.x0 || canvas_x > rect.x1 ||
                canvas_y < rect.y0 || canvas_y > rect.y1) continue;
            c.set(canvas_x, canvas_y, {
              char: cell.char,
              rgb: cell.rgb,
              style: 'regular',
              weight_index: cell.weight_index,
              render_index: 100
            });
          }
        }
      }
      */

      // ARCHIVE: Old multi-layer grid-based rendering (replaced by DOM renderer)
      // See voxel_dom_renderer.ts for new implementation
      /*
      // OLD CODE - Rendered all layers to type grid with transforms
      // This caused issues with scaling (gaps between cells) and positioning
      const visibleLayers = [];
      const occlusionBuffer = new Map<string, number>();
      
      for (const layer of visibleLayers) {
        const zDistance = layer.z - selected_z;
        const layerRenderIndex = layer.z + 10;
        
        for (let gy = start_y; gy < end_y; gy++) {
          for (let gx = start_x; gx < end_x; gx++) {
            const cell = layer.cells[gy]?.[gx];
            if (!cell || cell.char === ' ') continue;
            
            const canvas_x = rect.x0 + (gx - start_x);
            const canvas_y = rect.y0 + (gy - start_y);
            
            if (canvas_x < rect.x0 || canvas_x > rect.x1 ||
                canvas_y < rect.y0 || canvas_y > rect.y1) continue;
            
            c.set(canvas_x, canvas_y, {
              char: cell.char,
              rgb: cell.rgb,
              style: 'regular',
              weight_index: cell.weight_index,
              render_index: layerRenderIndex
            });
          }
        }
      }
      */

      // Draw preview points for line/rect/select/lasso tools
      if (opts.preview_points.length > 0) {
        const is_selection_preview = is_selecting || is_lasso_selecting;
        const preview_brush = getPreviewBrush();
        const preview_color = is_selection_preview 
          ? get_ui_semantic_rgb('vivid')
          : preview_brush.rgb;
        const preview_char = is_selection_preview ? '▫' : preview_brush.char;
        for (const point of opts.preview_points) {
          const canvas_x = rect.x0 + (opts.get_world_point_for_grid ? point.x : (point.x - start_x));
          const canvas_y = rect.y0 + (opts.get_world_point_for_grid ? point.y : (point.y - start_y));
          if (canvas_x >= rect.x0 && canvas_x <= rect.x1 &&
              canvas_y >= rect.y0 && canvas_y <= rect.y1) {
            c.set(canvas_x, canvas_y, {
              char: preview_char,
              rgb: preview_color,
              style: 'regular',
              weight_index: 2,
              render_index: 1
            });
          }
        }
      }

      // Draw status message (if recent)
      if (status_message && Date.now() - status_message_time < 2000) {
        const status_color = get_ui_semantic_rgb('bright');
        const msg = status_message.slice(0, rect.x1 - rect.x0 - 2);
        const msg_y = rect.y0 + 1;
        for (let i = 0; i < msg.length; i++) {
          c.set(rect.x0 + 1 + i, msg_y, {
            char: msg[i]!,
            rgb: status_color,
            style: 'regular',
            weight_index: 2,
            render_index: 10
          });
        }
      }

      // Draw canvas border (standard double border; resize mode only tints it).
      if (should_draw_module_chrome(gizmo_config, gizmo_state)) {
        const border_color = get_ui_semantic_rgb('dimmest');
        const viewport_width = rect.x1 - rect.x0 + 1;
        const viewport_height = rect.y1 - rect.y0 + 1;
        const totalPan = getTotalPan();
        const show_left = totalPan.x > 0;
        const show_bottom = totalPan.y > 0;
        const show_right = totalPan.x + viewport_width < opts.grid.width;
        const show_top = totalPan.y + viewport_height < opts.grid.height;
        draw_module_border(c, {
          rect,
          style: PANEL_BORDER_PRESETS.default_double.style,
          border_rgb: border_color,
          weight_index: PANEL_BORDER_PRESETS.default_double.weight_index,
          markers: {
            top: show_top ? '^' : undefined,
            bottom: show_bottom ? 'v' : undefined,
            left: show_left ? '<' : undefined,
            right: show_right ? '>' : undefined,
          },
          header: {
            text: 'CANVAS',
            text_rgb: get_ui_semantic_rgb('medium'),
            reserve_left_cols: 2 + ((gizmo_config.enabled?.length ?? 0) * 2),
          },
        });
      }

      // Draw text cursor
      if (text_mode_active) {
        syncTextCursorGridFromWorld();
        const cursor_canvas_x = rect.x0 + text_cursor_x;
        const cursor_canvas_y = rect.y0 + text_cursor_y;
        if (cursor_canvas_x >= rect.x0 && cursor_canvas_x <= rect.x1 &&
            cursor_canvas_y >= rect.y0 && cursor_canvas_y <= rect.y1) {
          const cursor_color = get_ui_semantic_rgb('vivid');
          c.set(cursor_canvas_x, cursor_canvas_y, {
            char: '_',
            rgb: cursor_color,
            style: 'regular',
            weight_index: 3,
            render_index: 2
          });
        }
      }

      // DEBUG: Draw calibration info
      const debug_totalPan = getTotalPan();
      const debug_color = get_ui_semantic_rgb('medium');
      const debug_text = `PAN:${Math.floor(debug_totalPan.x)},${Math.floor(debug_totalPan.y)}`;
      
      // Draw pan values in top-left corner
      for (let i = 0; i < debug_text.length; i++) {
        const x = rect.x0 + i;
        const y = rect.y0;
        if (x <= rect.x1) {
          c.set(x, y, {
            char: debug_text[i] ?? ' ',
            rgb: debug_color,
            style: 'regular',
            weight_index: 2,
            render_index: 999
          });
        }
      }

      const max_right = getCanvasNavReservedLeftX();
      const cursor_world_readout = getCursorWorldReadout();
      if (cursor_world_readout) {
        const readout_max_width = Math.max(0, max_right - rect.x0 - 1);
        const readout = cursor_world_readout.slice(0, readout_max_width);
        const rgb = get_ui_semantic_rgb('medium');
        for (let i = 0; i < readout.length; i++) {
          const x = rect.x0 + 1 + i;
          if (x > max_right) break;
          c.set(x, rect.y0, {
            char: readout[i] ?? ' ',
            rgb,
            style: 'regular',
            weight_index: 1,
            render_index: 999,
          });
        }
      }

      const selection_status = opts.get_selection_status?.();
      if (selection_status) {
        const max_width = Math.max(0, max_right - rect.x0 - 1);
        const msg = selection_status.slice(0, max_width);
        const base_x = Math.max(rect.x0 + 1, max_right - msg.length);
        const y = rect.y0;
        const rgb = get_ui_semantic_rgb('bright');
        for (let i = 0; i < msg.length; i++) {
          const x = base_x + i;
          if (x > max_right) break;
          c.set(x, y, {
            char: msg[i] ?? ' ',
            rgb,
            style: 'regular',
            weight_index: 2,
            render_index: 999,
          });
        }
      }

      const activeGroupProjectedBorderSlices = getActiveGroupProjectedBorderSlices(group_location_drag_preview_delta);
      if (!gizmo_state.is_resize_mode && activeGroupProjectedBorderSlices.length > 0 && !isPlaybackRunning()) {
        const canEditLocation = canEditGroupLocation();
        const borderColor = canEditLocation
          ? (group_location_drag_active
            ? get_ui_semantic_rgb('vivid')
            : group_location_border_hovered
              ? get_ui_semantic_rgb('bright')
              : get_ui_semantic_rgb('medium'))
          : get_ui_semantic_rgb('dimmest');
        drawProjectedGroupBorderSlices(c, rect, activeGroupProjectedBorderSlices, borderColor, group_location_drag_active ? 2 : 1, canEditLocation ? 997 : 996);
      }

      // Visual debug: Show current mouse position
      if (current_mouse_pos) {
        const mouse_local_x = current_mouse_pos.x - rect.x0;
        const mouse_local_y = current_mouse_pos.y - rect.y0;
        if (mouse_local_x >= 0 && mouse_local_x < viewport_width && mouse_local_y >= 0 && mouse_local_y < viewport_height) {
          c.set(rect.x0 + mouse_local_x, rect.y0 + mouse_local_y, {
            char: 'M',
            rgb: get_color_by_name('vivid_magenta').rgb,
            style: 'bold',
            weight_index: 2,
            render_index: 997
          });
        }
      }

      // Visual debug: Show last click position
      const last_click = (module as any).last_click;
      if (last_click) {
        const click_local_x = last_click.x - rect.x0;
        const click_local_y = last_click.y - rect.y0;
        
        // Mark click position with X
        if (click_local_x >= 0 && click_local_x < viewport_width && click_local_y >= 0 && click_local_y < viewport_height) {
          c.set(rect.x0 + click_local_x, rect.y0 + click_local_y, {
            char: 'X',
            rgb: get_color_by_name('vivid_green').rgb,
            style: 'bold',
            weight_index: 2,
            render_index: 1000
          });
        }
        
        // Mark calculated grid position with +
        const grid_local_x = last_click.grid_x - Math.floor(debug_totalPan.x);
        const grid_local_y = last_click.grid_y - Math.floor(debug_totalPan.y);
        if (grid_local_x >= 0 && grid_local_x < viewport_width && grid_local_y >= 0 && grid_local_y < viewport_height) {
          c.set(rect.x0 + grid_local_x, rect.y0 + grid_local_y, {
            char: '+',
            rgb: get_color_by_name('vivid_red').rgb,
            style: 'bold',
            weight_index: 2,
            render_index: 1001
          });
        }
      }

      // Draw gizmos LAST so they appear on top (including resize borders)
      if (should_draw_module_chrome(gizmo_config, gizmo_state)) {
        draw_module_gizmos(c, rect, gizmo_config, gizmo_state);
      }

      draw_canvas_nav_cluster(c, {
        rect,
        show_cluster: show_canvas_nav_cluster,
        top_left_gizmo_count: getCanvasTopLeftGizmoCount(),
        hovered_button: hovered_canvas_nav_button,
        pressed_button: pressed_canvas_nav_button,
        render_index: 1003,
      });
    },

    OnPointerDown(e: PointerEvent): void {
      ensureGridShapeState();
      drag_start_buttons = e.buttons;
      // Use unified coordinate conversion
      const grid_coords = screenToGrid(e.x, e.y);
      const grid_x = grid_coords.x;
      const grid_y = grid_coords.y;
      const local_x = e.x - rect.x0;
      const local_y = e.y - rect.y0;
      const totalPan = getTotalPan();
      
      // (debug logging removed)
      
      // Store last click for visual debug
      (module as any).last_click = { x: e.x, y: e.y, grid_x, grid_y };

      // Handle canvas nav clicks before canvas content interactions
      updateCanvasNavHover(e.x, e.y);
      const navHit = getCanvasNavHit(e.x, e.y);
      if (navHit) {
        pressed_canvas_nav_button = navHit;
        if (navHit === 'nav_toggle') {
          show_canvas_nav_cluster = !show_canvas_nav_cluster;
          hovered_canvas_nav_button = getCanvasNavHit(e.x, e.y);
        } else if (navHit === 'depth_prev') {
          opts.on_step_depth?.(-1);
        } else if (navHit === 'depth_next') {
          opts.on_step_depth?.(1);
        } else if (navHit !== 'pan_placeholder') {
          opts.on_step_view_action?.(navHit);
        }
        return;
      }

      // Handle gizmo clicks first
      update_gizmo_hover_state(e.x, e.y, rect, gizmo_config, gizmo_state);
      if (is_in_gizmo_area(e.x, e.y, rect, gizmo_config)) {
        const gizmo = handle_gizmo_click(e.x, e.y, rect, gizmo_config, gizmo_state);
        if (gizmo === 'move') {
          gizmo_state.move_start_x = e.x;
          gizmo_state.move_start_y = e.y;
          gizmo_state.original_rect = { ...rect };
        }
        return;
      }

      // Handle resize mode edge clicking
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

      // Handle move mode - clicking anywhere starts the drag
      if (gizmo_state.is_move_mode) {
        gizmo_state.move_start_x = e.x;
        gizmo_state.move_start_y = e.y;
        gizmo_state.original_rect = { ...rect };
        return;
      }

      const tool_for_button = e.button === 2 ? opts.get_right_click_tool() : opts.get_left_click_tool();
      const tool_target = getToolTargetForButton(e.button, tool_for_button);

      if (tool_for_button !== 'paste' && !isPasteToolActiveForAnyHand() && (paste_preview_data || paste_preview_world_data)) {
        clearPendingPreviewChanges();
        paste_preview_data = null;
        paste_preview_pos = null;
        paste_preview_world_data = null;
        paste_preview_world_anchor = null;
        paste_preview_rotation_view = null;
      }
      if (tool_for_button !== 'move' && isMovePreviewActive()) {
        clearMovePreview();
      }

      if (text_mode_active) {
        if (tool_for_button === 'text') {
          moveTextCursorTo(grid_x, grid_y);
          resetTextEntryAnchorAtCurrentCursor();
          return;
        }
        exitTextMode(true);
      }

      // Handle paste tool
      if (tool_for_button === 'paste') {
        ensurePastePreviewAtGrid(grid_x, grid_y);
        return;
      }

      if (e.button === 0 || e.button === 2) {
        if (grid_x < 0 || grid_x >= opts.grid.width || grid_y < 0 || grid_y >= opts.grid.height) return;

        if (tool_for_button === 'eyedropper') {
          const cell = sampleCell(opts.grid, grid_x, grid_y);
          if (cell) {
            opts.on_sample_cell(cell, {
              button: e.button,
              shift: e.shift,
              ctrl: e.ctrl,
              alt: e.alt,
              meta: e.meta,
            });
          }
          return;
        }

        if (tool_for_button === 'bucket') {
          if (tool_target === 'selection') {
            const changed = applyBucketSelection(e.button, grid_x, grid_y);
            if (changed > 0) {
              showStatus(`Selected ${changed} voxels`);
            }
          } else if (canEditCell(grid_x, grid_y)) {
            const changed = applyBucketFill(e.button, grid_x, grid_y, {
              shift: e.shift,
              ctrl: e.ctrl,
              alt: e.alt,
              meta: e.meta,
            });
            if (changed > 0) {
              const selected_z = getResolvedCommitPlane();
              commitLoggedCellChanges('fill', 'Fill', selected_z);
            }
          }
          return;
        }

        if (tool_for_button === 'text') {
          exitTextMode(false);
          text_mode_active = true;
          text_mode_button = e.button;
          moveTextCursorTo(grid_x, grid_y);
          resetTextEntryAnchorAtCurrentCursor();
          emitTextCursorAnchorChanged();
          return;
        }

        if (tool_for_button === 'pencil') {
          if (tool_target === 'selection') {
            active_stroke_tool = 'pencil';
            active_stroke_world_plane = opts.get_selected_z();
            active_stroke_anchor_world = getWorldPointForEditPlane(grid_x, grid_y, active_stroke_world_plane);
            if (!active_stroke_anchor_world) {
              showStatus('Cannot start selection stroke on selected depth here');
              active_stroke_tool = null;
              active_stroke_world_plane = null;
              return;
            }
            setInteractionCurrentWorld(active_stroke_anchor_world);
            setInteractionEndWorld(null);
            is_drawing = true;
            last_draw_pos = { x: grid_x, y: grid_y };
            applySelectionBrushAt(grid_x, grid_y, getBrushSizeForButton(e.button), 'additive', active_stroke_world_plane);
            return;
          }
          const base_channels = opts.get_brush_edit_channels_for_button?.(e.button) ?? { char: true, color: true, weight: true };
          active_draw_channels = resolve_edit_channels_with_modifiers(base_channels, e);
          active_stroke_tool = 'pencil';
          active_stroke_world_plane = opts.get_selected_z();
          active_stroke_anchor_world = getWorldPointForEditPlane(grid_x, grid_y, active_stroke_world_plane);
          if (!active_stroke_anchor_world) {
            showStatus('Cannot start stroke on selected depth here');
            active_stroke_tool = null;
            active_stroke_world_plane = null;
            return;
          }
          setInteractionCurrentWorld(active_stroke_anchor_world);
          setInteractionEndWorld(null);
          is_drawing = true;
          last_draw_pos = { x: grid_x, y: grid_y };
          applyBrushEditWithBrushSize(grid_x, grid_y, getBrushForButton(e.button), getBrushSizeForButton(e.button), active_draw_channels);
          maybeEmitLiveStrokePreview(true);
          return;
        }

        if (tool_for_button === 'eraser') {
          if (tool_target === 'selection') {
            active_stroke_tool = 'eraser';
            active_stroke_world_plane = opts.get_selected_z();
            active_stroke_anchor_world = getWorldPointForEditPlane(grid_x, grid_y, active_stroke_world_plane);
            if (!active_stroke_anchor_world) {
              showStatus('Cannot start selection erase stroke on selected depth here');
              active_stroke_tool = null;
              active_stroke_world_plane = null;
              return;
            }
            setInteractionCurrentWorld(active_stroke_anchor_world);
            setInteractionEndWorld(null);
            is_erasing = true;
            last_draw_pos = { x: grid_x, y: grid_y };
            applySelectionBrushAt(grid_x, grid_y, getBrushSizeForButton(e.button), 'subtract', active_stroke_world_plane);
            return;
          }
          const base_channels = opts.get_brush_edit_channels_for_button?.(e.button) ?? { char: true, color: true, weight: true };
          active_draw_channels = resolve_edit_channels_with_modifiers(base_channels, e);
          active_stroke_tool = 'eraser';
          active_stroke_world_plane = opts.get_selected_z();
          active_stroke_anchor_world = getWorldPointForEditPlane(grid_x, grid_y, active_stroke_world_plane);
          if (!active_stroke_anchor_world) {
            showStatus('Cannot start stroke on selected depth here');
            active_stroke_tool = null;
            active_stroke_world_plane = null;
            return;
          }
          setInteractionCurrentWorld(active_stroke_anchor_world);
          setInteractionEndWorld(null);
          is_erasing = true;
          last_draw_pos = { x: grid_x, y: grid_y };
          eraseWithBrushSizeAndChannels(grid_x, grid_y, getBrushSizeForButton(e.button), active_draw_channels);
          maybeEmitLiveStrokePreview(true);
          return;
        }

        // Selection tool (rectangular)
        if (tool_for_button === 'selectangle') {
          is_selecting = true;
          selection_drag_start = { x: grid_x, y: grid_y };
          selection_drag_start_plane = opts.get_focus_world_plane?.() ?? opts.get_selected_z();
          selection_drag_end_plane = selection_drag_start_plane;
          selection_drag_start_world = getWorldPointForEditPlane(grid_x, grid_y, selection_drag_start_plane) ?? opts.get_world_point_for_grid?.(grid_x, grid_y) ?? { x: grid_x, y: grid_y, z: selection_drag_start_plane };
          selection_drag_end_world = cloneWorldPoint(selection_drag_start_world);
          setInteractionCurrentWorld(selection_drag_start_world);
          setInteractionEndWorld(null);
          emitLiveInteractionAnchor(interaction_current_world, true);
          showStatus('Selection: drag to select area');
          return;
        }

        if (tool_target === 'selection' && tool_for_button.startsWith('rect_')) {
          is_selecting = true;
          selection_drag_start = { x: grid_x, y: grid_y };
          selection_drag_start_plane = opts.get_focus_world_plane?.() ?? opts.get_selected_z();
          selection_drag_end_plane = selection_drag_start_plane;
          selection_drag_start_world = getWorldPointForEditPlane(grid_x, grid_y, selection_drag_start_plane) ?? opts.get_world_point_for_grid?.(grid_x, grid_y) ?? { x: grid_x, y: grid_y, z: selection_drag_start_plane };
          selection_drag_end_world = cloneWorldPoint(selection_drag_start_world);
          setInteractionCurrentWorld(selection_drag_start_world);
          setInteractionEndWorld(null);
          emitLiveInteractionAnchor(interaction_current_world, true);
          showStatus('Selection: drag rectangle');
          return;
        }

        // Lasso selection tool (freehand)
        if (tool_for_button === 'lassoselect') {
          is_lasso_selecting = true;
          lasso_points = [{ x: grid_x, y: grid_y }];
          selection_drag_start_plane = opts.get_focus_world_plane?.() ?? opts.get_selected_z();
          selection_drag_end_plane = selection_drag_start_plane;
          showStatus('Lasso: drag to draw selection area');
          return;
        }

        // Copy tool - copy current selection
        if (tool_for_button === 'copy') {
          copyCurrentSelection();
          return;
        }

        if (tool_for_button === 'move') {
          if (startGroupLocationDrag(grid_x, grid_y)) {
            return;
          }
          if (startMovePreview(grid_x, grid_y)) {
            showStatus((opts.get_move_mask_modifier_held?.() ?? false) ? 'Move selection preview' : 'Move content preview');
          }
          return;
        }

        if (tool_for_button === 'line' || tool_for_button.startsWith('rect_')) {
          if (tool_for_button === 'line' && tool_target !== 'selection') {
            const base_channels = opts.get_brush_edit_channels_for_button?.(e.button) ?? { char: true, color: true, weight: true };
            active_draw_channels = resolve_edit_channels_with_modifiers(base_channels, e);
          }
          active_stroke_tool = tool_for_button;
          active_line_selection_target = tool_for_button === 'line' && tool_target === 'selection';
          active_stroke_world_plane = opts.get_selected_z();
          active_stroke_anchor_world = getWorldPointForEditPlane(grid_x, grid_y, active_stroke_world_plane);
          if (!active_stroke_anchor_world) {
            showStatus('Cannot start stroke on selected depth here');
            active_stroke_tool = null;
            active_stroke_world_plane = null;
            active_line_selection_target = false;
            return;
          }
          shape_start_world = { ...active_stroke_anchor_world };
          setInteractionCurrentWorld(active_stroke_anchor_world);
          setInteractionEndWorld(null);
          is_drawing = true;
          drag_start = { x: grid_x, y: grid_y };
          if (active_line_selection_target && shape_start_world) {
            applyLineSelectionStroke(shape_start_world, shape_start_world, getBrushSizeForButton(e.button));
            emitLiveInteractionAnchor(shape_start_world, true);
          } else {
            setPreviewPoints([]);
          }
        }
      }
    },

    OnDragMove(e: DragEvent): void {
      const local_x = e.x - rect.x0;
      const local_y = e.y - rect.y0;

      if (group_location_drag_active) {
        const grid_coords = localToGrid(local_x, local_y);
        updateGroupLocationDrag(grid_coords.x, grid_coords.y);
        return;
      }
      
      // (debug logging removed)

      // Handle move mode dragging
      if (gizmo_state.is_move_mode && gizmo_state.original_rect) {
        const dx = e.x - gizmo_state.move_start_x;
        const dy = e.y - gizmo_state.move_start_y;
        
        const new_rect: Rect = {
          x0: gizmo_state.original_rect.x0 + dx,
          y0: gizmo_state.original_rect.y0 + dy,
          x1: gizmo_state.original_rect.x1 + dx,
          y1: gizmo_state.original_rect.y1 + dy,
        };
        
        updateRect(new_rect);
        
        if (opts.on_move) {
          opts.on_move(rect);
        }
        return;
      }

      // Handle gizmo resize
      if (gizmo_state.is_resize_mode && gizmo_state.is_dragging_resize && gizmo_state.original_rect) {
        const new_rect = handle_resize_drag(
          e.x, e.y, gizmo_state, gizmo_state.original_rect,
          CANVAS_MIN_WIDTH, CANVAS_MIN_HEIGHT, CANVAS_MAX_WIDTH, CANVAS_MAX_HEIGHT,
          (next_rect) => {
            updateRect(next_rect);
            opts.on_resize?.(next_rect);
          }
        );
        if (new_rect) {
          updateRect(new_rect);
        }
        return;
      }

      if (isActiveEraserStroke() && last_draw_pos) {
        const grid_coords = localToGrid(local_x, local_y);
        const grid_x = grid_coords.x;
        const grid_y = grid_coords.y;
        if (grid_x < 0 || grid_x >= opts.grid.width || grid_y < 0 || grid_y >= opts.grid.height) return;
        setInteractionCurrentWorld(getWorldPointForEditPlane(grid_x, grid_y, active_stroke_world_plane ?? opts.get_selected_z()));
        if (grid_x !== last_draw_pos.x || grid_y !== last_draw_pos.y) {
          if (getToolTargetForButton(getDragButton(), 'eraser') === 'selection') {
            applySelectionBrushLine(last_draw_pos.x, last_draw_pos.y, grid_x, grid_y, getBrushSizeForButton(getDragButton()), 'subtract', active_stroke_world_plane ?? opts.get_selected_z());
          } else {
            const points = previewLine(last_draw_pos.x, last_draw_pos.y, grid_x, grid_y);
            for (const point of points) eraseWithBrushSizeAndChannels(point.x, point.y, getBrushSizeForButton(getDragButton()), active_draw_channels);
          }
          last_draw_pos = { x: grid_x, y: grid_y };
          if (getToolTargetForButton(getDragButton(), 'eraser') !== 'selection') maybeEmitLiveStrokePreview();
        }
        return;
      }

      if (isActivePencilStroke() && last_draw_pos) {
        const grid_coords = localToGrid(local_x, local_y);
        const grid_x = grid_coords.x;
        const grid_y = grid_coords.y;
        if (grid_x < 0 || grid_x >= opts.grid.width || grid_y < 0 || grid_y >= opts.grid.height) return;
        setInteractionCurrentWorld(getWorldPointForEditPlane(grid_x, grid_y, active_stroke_world_plane ?? opts.get_selected_z()));
        if (grid_x !== last_draw_pos.x || grid_y !== last_draw_pos.y) {
          if (getToolTargetForButton(getDragButton(), 'pencil') === 'selection') {
            applySelectionBrushLine(last_draw_pos.x, last_draw_pos.y, grid_x, grid_y, getBrushSizeForButton(getDragButton()), 'additive', active_stroke_world_plane ?? opts.get_selected_z());
          } else {
            drawLineWithBrushEditChannels(last_draw_pos.x, last_draw_pos.y, grid_x, grid_y, getBrushForButton(getDragButton()), getBrushSizeForButton(getDragButton()), active_draw_channels);
          }
          last_draw_pos = { x: grid_x, y: grid_y };
          if (getToolTargetForButton(getDragButton(), 'pencil') !== 'selection') maybeEmitLiveStrokePreview();
        }
        return;
      }

      // Selection preview - use distinctive dashed pattern
      if (is_selecting && selection_drag_start) {
        const grid_coords = localToGrid(local_x, local_y);
        const grid_x = grid_coords.x;
        const grid_y = grid_coords.y;
        selection_drag_end_world = getWorldPointForEditPlane(grid_x, grid_y, selection_drag_end_plane ?? selection_drag_start_plane ?? opts.get_selected_z())
          ?? opts.get_world_point_for_grid?.(grid_x, grid_y)
          ?? { x: grid_x, y: grid_y, z: selection_drag_end_plane ?? selection_drag_start_plane ?? opts.get_selected_z() };
        setInteractionCurrentWorld(selection_drag_end_world);
        emitLiveInteractionAnchor(interaction_current_world);
        // Show preview rect
        const new_points = previewRectStroke(selection_drag_start.x, selection_drag_start.y, grid_x, grid_y);
        opts.preview_points.length = 0;
        opts.preview_points.push(...new_points);
        // Also show status while dragging
        const width = Math.abs(grid_x - selection_drag_start.x) + 1;
        const height = Math.abs(grid_y - selection_drag_start.y) + 1;
        const range = getSelectionDomainPlaneRange(opts.get_rect_select_all_depths?.() ?? false);
        const depth = range ? (range.depthMax - range.depthMin + 1) : 1;
        if (width > 1 || height > 1 || depth > 1) {
          showStatus(formatSelectionVolumeLabel(width, height, range?.depthMin, range?.depthMax));
        }
        return;
      }

      // Lasso selection - add points as user drags
      if (is_lasso_selecting) {
        const grid_coords = localToGrid(local_x, local_y);
        const grid_x = grid_coords.x;
        const grid_y = grid_coords.y;
        // Add point if moved to a new cell
        const last_point = lasso_points[lasso_points.length - 1];
        if (!last_point || last_point.x !== grid_x || last_point.y !== grid_y) {
          lasso_points.push({ x: grid_x, y: grid_y });
          // Preview the lasso outline - mutate in place to preserve reference
          opts.preview_points.length = 0;
          opts.preview_points.push(...lasso_points);
          showStatus(`Lasso: ${lasso_points.length} points`);
        }
        return;
      }

      if (isMovePreviewActive()) {
        const grid_coords = localToGrid(local_x, local_y);
        updateMovePreviewAt(grid_coords.x, grid_coords.y);
        return;
      }

        if (isActiveShapeStroke()) {
          const current_coords = localToGrid(local_x, local_y);
          const current_x = current_coords.x;
          const current_y = current_coords.y;
          updateLineRectPreview({ x: current_x, y: current_y });
        }

        // Paste preview follows mouse lazily once the paste tool is active.
        if (isPasteToolActiveForAnyHand()) {
          const grid_coords = localToGrid(local_x, local_y);
          ensurePastePreviewAtGrid(grid_coords.x, grid_coords.y);
        }
    },

    OnDragEnd(e: DragEvent): void {
      if (is_selecting && selection_drag_start) {
        const local_x = e.x - rect.x0;
        const local_y = e.y - rect.y0;
        const grid_coords = localToGrid(local_x, local_y);
        const end_x = grid_coords.x;
        const end_y = grid_coords.y;
        selection_drag_end_world = getWorldPointForEditPlane(end_x, end_y, selection_drag_end_plane ?? selection_drag_start_plane ?? opts.get_selected_z())
          ?? opts.get_world_point_for_grid?.(end_x, end_y)
          ?? { x: end_x, y: end_y, z: selection_drag_end_plane ?? selection_drag_start_plane ?? opts.get_selected_z() };
        setInteractionCurrentWorld(selection_drag_end_world);
        setInteractionEndWorld(interaction_current_world);
        const start_x = selection_drag_start.x;
        const start_y = selection_drag_start.y;
        const rectCells = selection_drag_start_world && selection_drag_end_world
          ? buildRectSelectionWorldCells(selection_drag_start_world, selection_drag_end_world, opts.get_rect_select_all_depths?.() ?? false)
          : [];
        emitWorldSelectionChange({ kind: 'rect', mode: opts.get_selection_mode(), cells: rectCells });

        const width = Math.abs(end_x - start_x) + 1;
        const height = Math.abs(end_y - start_y) + 1;
        const range = getSelectionDomainPlaneRange(opts.get_rect_select_all_depths?.() ?? false);
        showStatus(formatSelectionVolumeLabel(width, height, range?.depthMin, range?.depthMax).replace('Selecting:', 'Selected'));
        painterCanvasDiag('selection rect commit', { width, height, depth_min: range?.depthMin ?? 0, depth_max: range?.depthMax ?? range?.depthMin ?? 0, mode: opts.get_selection_mode() });
        resetSelectionDragState();
        if (!opts.on_world_selection_change) opts.on_selection_change?.({ depthMin: range?.depthMin, depthMax: range?.depthMax, kind: 'rect' });
        drag_start_buttons = 0;
        return;
      }

      // Lasso selection finalization
      if (is_lasso_selecting && lasso_points.length >= 3) {
        painterCanvasDiag('lasso drag end', { points: lasso_points.length });
        
        const temp_bitmap = createSelectionBitmap(opts.grid.width, opts.grid.height);
        selectPolygon(temp_bitmap, lasso_points);
        const range = getSelectionDomainPlaneRange(opts.get_lasso_select_all_depths?.() ?? false)
          ?? getSelectionPlaneRange()
          ?? { depthMin: opts.get_focus_world_plane?.() ?? opts.get_selected_z(), depthMax: opts.get_focus_world_plane?.() ?? opts.get_selected_z() };
        const lassoCells = buildSelectionWorldCellsFromBitmap(temp_bitmap, range);
        emitWorldSelectionChange({ kind: 'lasso', mode: opts.get_selection_mode(), cells: lassoCells });
        
        showStatus(`Lasso selected ${lassoCells.length} voxels`);
        
        is_lasso_selecting = false;
        lasso_points = [];
        opts.preview_points = [];
        if (!opts.on_world_selection_change) opts.on_selection_change?.({ depthMin: range.depthMin, depthMax: range.depthMax, kind: 'lasso' });
        drag_start_buttons = 0;
        return;
      }

      if (isMovePreviewActive()) {
        const local_x = e.x - rect.x0;
        const local_y = e.y - rect.y0;
        const grid_coords = localToGrid(local_x, local_y);
        commitMovePreviewAt(grid_coords.x, grid_coords.y);
        drag_start_buttons = 0;
        return;
      }

      if (group_location_drag_active) {
        const local_x = e.x - rect.x0;
        const local_y = e.y - rect.y0;
        const grid_coords = localToGrid(local_x, local_y);
        commitGroupLocationDrag(grid_coords.x, grid_coords.y);
        drag_start_buttons = 0;
        return;
      }

      if (!is_drawing && !is_erasing) {
        drag_start_buttons = 0;
        return;
      }

      if (isActiveLineStroke()) {
        return;
      }

      clearActiveStrokeState();
    },

    OnPointerUp(e: PointerEvent): void {
      pressed_canvas_nav_button = null;
      if (isPasteToolActiveForAnyHand() && paste_preview_world_data && paste_preview_world_anchor) {
        if (opts.get_active_group_locked?.()) {
          showStatus('Cannot paste: active group is locked');
          return;
        }
        const preview = buildWorldPastePreviewChanges(paste_preview_world_data, paste_preview_world_anchor);
        pending_changes = preview.changes;
        if (pending_changes.length > 0) {
          const selected_z = opts.get_selected_z();
          commitLoggedCellChanges('paste', 'Paste', selected_z);
        }
        const zLabel = Number.isFinite(preview.minPasteZ) && Number.isFinite(preview.maxPasteZ) ? ` Z:${preview.minPasteZ}->${preview.maxPasteZ}` : '';
        showStatus(`Pasted 3D (${preview.placed} placed, ${preview.skippedIgnored} ignored, ${preview.preserved} preserved, ${preview.cleared} cleared${zLabel})`);
        paste_preview_world_data = null;
        paste_preview_world_anchor = null;
        paste_preview_rotation_view = null;
        return;
      }

      // Handle paste placement
      if (isPasteToolActiveForAnyHand() && paste_preview_data && paste_preview_pos) {
        if (opts.get_active_group_locked?.()) {
          showStatus('Cannot paste: active group is locked');
          return;
        }
        
        const preview = buildFlatPastePreviewChanges(paste_preview_data, paste_preview_pos);
        pending_changes = preview.changes;
        if (pending_changes.length > 0) {
          const selected_z = opts.get_selected_z();
          commitLoggedCellChanges('draw_cells', 'Paste', selected_z);
        }
        painterCanvasImportant('paste complete', { placed: preview.placed, ignored_preserved: preview.skippedIgnored, cleared: preview.cleared, preserved: preview.preserved });
        showStatus(`Pasted ${paste_preview_data.width}x${paste_preview_data.height} (placed:${preview.placed}, ignored:${preview.skippedIgnored}, preserved:${preview.preserved}, cleared:${preview.cleared})`);
        paste_preview_data = null;
        paste_preview_pos = null;
        return;
      }

      const tool_for_up = (drag_start_buttons & 2) ? opts.get_right_click_tool() : opts.get_left_click_tool();
      if (isActiveLineStroke() && tool_for_up === 'line') {
        const local_x = e.x - rect.x0;
        const local_y = e.y - rect.y0;
        const end_coords = localToGrid(local_x, local_y);
        updateLineRectPreview({ x: end_coords.x, y: end_coords.y });
        setInteractionEndWorld(interaction_current_world);
        if (!active_line_selection_target && pending_changes.length > 0) {
          commitLoggedCellChanges('draw_cells', 'Draw Line', getResolvedCommitPlane());
        }
        clearActiveStrokeState();
        return;
      }
      if (is_drawing && drag_start && tool_for_up.startsWith('rect_')) {
        const local_x = e.x - rect.x0;
        const local_y = e.y - rect.y0;
        const end_coords = localToGrid(local_x, local_y);
        updateLineRectPreview({ x: end_coords.x, y: end_coords.y });
        setInteractionEndWorld(interaction_current_world);
      }
      
      // Handle selection in OnPointerUp as fallback (OnDragEnd might not fire for clicks)
      if (is_selecting && selection_drag_start) {
        const local_x = e.x - rect.x0;
        const local_y = e.y - rect.y0;
        const end_coords = localToGrid(local_x, local_y);
        const end_x = end_coords.x;
        const end_y = end_coords.y;
        selection_drag_end_world = getWorldPointForEditPlane(end_x, end_y, selection_drag_end_plane ?? selection_drag_start_plane ?? opts.get_selected_z())
          ?? opts.get_world_point_for_grid?.(end_x, end_y)
          ?? { x: end_x, y: end_y, z: selection_drag_end_plane ?? selection_drag_start_plane ?? opts.get_selected_z() };
        setInteractionCurrentWorld(selection_drag_end_world);
        setInteractionEndWorld(interaction_current_world);
        const start_x = selection_drag_start.x;
        const start_y = selection_drag_start.y;
        const rectCells = selection_drag_start_world && selection_drag_end_world
          ? buildRectSelectionWorldCells(selection_drag_start_world, selection_drag_end_world, opts.get_rect_select_all_depths?.() ?? false)
          : [];
        emitWorldSelectionChange({ kind: 'rect', mode: opts.get_selection_mode(), cells: rectCells });

        const width = Math.abs(end_x - start_x) + 1;
        const height = Math.abs(end_y - start_y) + 1;
        const range = getSelectionDomainPlaneRange(opts.get_rect_select_all_depths?.() ?? false);
        showStatus(formatSelectionVolumeLabel(width, height, range?.depthMin, range?.depthMax).replace('Selecting:', 'Selected'));
        painterCanvasDiag('selection rect fallback commit', { width, height, depth_min: range?.depthMin ?? 0, depth_max: range?.depthMax ?? range?.depthMin ?? 0, mode: opts.get_selection_mode() });
        resetSelectionDragState();
        if (!opts.on_world_selection_change) opts.on_selection_change?.({ depthMin: range?.depthMin, depthMax: range?.depthMax, kind: 'rect' });
      }
      
      // Handle lasso selection in OnPointerUp as fallback
      if (is_lasso_selecting && lasso_points.length >= 3) {
        painterCanvasDiag('lasso in pointer up', { points: lasso_points.length });
        const temp_bitmap = createSelectionBitmap(opts.grid.width, opts.grid.height);
        selectPolygon(temp_bitmap, lasso_points);
        const range = getSelectionDomainPlaneRange(opts.get_lasso_select_all_depths?.() ?? false)
          ?? getSelectionPlaneRange()
          ?? { depthMin: opts.get_focus_world_plane?.() ?? opts.get_selected_z(), depthMax: opts.get_focus_world_plane?.() ?? opts.get_selected_z() };
        const lassoCells = buildSelectionWorldCellsFromBitmap(temp_bitmap, range);
        emitWorldSelectionChange({ kind: 'lasso', mode: opts.get_selection_mode(), cells: lassoCells });
        
        showStatus(`Lasso selected ${lassoCells.length} voxels`);
        
        is_lasso_selecting = false;
        lasso_points = [];
        selection_drag_start_plane = null;
        selection_drag_end_plane = null;
        opts.preview_points = [];
        if (!opts.on_world_selection_change) opts.on_selection_change?.({ depthMin: range.depthMin, depthMax: range.depthMax, kind: 'lasso' });
      }
      
      // Reset gizmo states
      if (gizmo_state.is_move_mode) {
        gizmo_state.is_move_mode = false;
        gizmo_state.original_rect = null;
        emitViewport();
        if (opts.on_move) opts.on_move(rect);
      }

      if (gizmo_state.is_dragging_resize) {
        gizmo_state.is_dragging_resize = false;
        gizmo_state.resize_edge = null;
        emitViewport();
        if (opts.on_resize) opts.on_resize(rect);
      }

      // Log pending changes to history when drawing ends
      if ((is_drawing || is_erasing) && pending_changes.length > 0) {
        const selected_z = getResolvedCommitPlane();
        let tool_name = 'Draw';
        let action_type: 'draw_cells' | 'erase_cells' = 'draw_cells';
        
        if (is_erasing) {
          tool_name = 'Erase';
          action_type = 'erase_cells';
        } else if (active_stroke_tool === 'line') {
          tool_name = 'Draw Line';
        } else if (active_stroke_tool === 'rect_stroke') {
          tool_name = 'Draw Rectangle (stroke)';
        } else if (active_stroke_tool === 'rect_fill') {
          tool_name = 'Draw Rectangle (fill)';
        } else if (active_draw_channels.char && !active_draw_channels.color && !active_draw_channels.weight) {
          tool_name = 'Apply Char';
        } else if (!active_draw_channels.char && !active_draw_channels.color && active_draw_channels.weight) {
          tool_name = 'Apply Weight';
        } else if (!active_draw_channels.char && active_draw_channels.color && !active_draw_channels.weight) {
          tool_name = 'Apply Color';
        } else if (active_draw_channels.char && active_draw_channels.color && !active_draw_channels.weight) {
          tool_name = 'Apply Char+Color';
        }
        
        commitLoggedCellChanges(action_type, tool_name, selected_z);
      }
      
      is_drawing = false;
      is_erasing = false;
      active_draw_channels = { char: true, color: true, weight: true };
      active_stroke_tool = null;
      active_stroke_world_plane = null;
      active_stroke_anchor_world = null;
      is_selecting = false;
      is_lasso_selecting = false;
      selection_drag_start = null;
      lasso_points = [];
      drag_start = null;
      last_draw_pos = null;
      opts.preview_points = [];
      drag_start_buttons = 0;
    },

    OnPointerMove(e: PointerEvent): void {
      ensureGridShapeState();
      // Track current mouse position for visual debug
      current_mouse_pos = { x: e.x, y: e.y };
      const hoverGrid = screenToGrid(e.x, e.y);
      updateGroupLocationHover(hoverGrid.x, hoverGrid.y);
      updateCanvasNavHover(e.x, e.y);
      update_gizmo_hover_state(e.x, e.y, rect, gizmo_config, gizmo_state);
      
      // Handle resize edge detection when in resize mode but not dragging
      if (gizmo_state.is_resize_mode && !gizmo_state.is_dragging_resize) {
        gizmo_state.resize_edge = get_resize_edge(e.x, e.y, rect);
      }
      
      // Track mouse position relative to canvas center for parallax
      // Only track when inside the canvas rect
      if (e.x >= rect.x0 && e.x <= rect.x1 && e.y >= rect.y0 && e.y <= rect.y1) {
        const center_x = (rect.x0 + rect.x1) / 2;
        const center_y = (rect.y0 + rect.y1) / 2;
        const max_dist_x = (rect.x1 - rect.x0) / 2;
        const max_dist_y = (rect.y1 - rect.y0) / 2;
        
        // Normalize to -1 to +1 range
        mouse_offset_x = max_dist_x > 0 ? (e.x - center_x) / max_dist_x : 0;
        mouse_offset_y = max_dist_y > 0 ? (e.y - center_y) / max_dist_y : 0;
        
        // Pass to DOM renderer
        opts.on_mouse_move?.(mouse_offset_x, mouse_offset_y);

        if (isPasteToolActiveForAnyHand()) {
          const local_x = e.x - rect.x0;
          const local_y = e.y - rect.y0;
          const grid_coords = localToGrid(local_x, local_y);
          ensurePastePreviewAtGrid(grid_coords.x, grid_coords.y);
        }
      }

      if (group_location_drag_active) {
        const local_x = e.x - rect.x0;
        const local_y = e.y - rect.y0;
        const grid_coords = localToGrid(local_x, local_y);
        updateGroupLocationDrag(grid_coords.x, grid_coords.y);
      }
    },

    OnWheel(e: WheelEvent): void {
      if (e.ctrl) {
        const zoom_step = 0.1;
        scale = clamp(scale + (e.delta_y > 0 ? zoom_step : -zoom_step), 0.5, 3.0);
        return;
      }

      if (!e.shift && !e.alt && opts.cycle_focus_layer) {
        if (isMovePreviewActive()) {
          const dir = e.delta_y < 0 ? 1 : (e.delta_y > 0 ? -1 : 0);
          if (dir !== 0) {
            move_preview_depth_offset += dir;
            const local_x = e.x - rect.x0;
            const local_y = e.y - rect.y0;
            const grid_coords = localToGrid(local_x, local_y);
            updateMovePreviewAt(grid_coords.x, grid_coords.y, { force: true });
            return;
          }
        }
        if (is_selecting && selection_drag_start) {
          const dir = e.delta_y < 0 ? 1 : (e.delta_y > 0 ? -1 : 0);
          if (dir !== 0) {
            opts.cycle_focus_layer(dir as 1 | -1);
            selection_drag_end_plane = opts.get_focus_world_plane?.() ?? (selection_drag_end_plane ?? opts.get_selected_z());
            if (selection_drag_end_world && selection_drag_end_plane !== null) {
              selection_drag_end_world = setWorldPointPlaneCoordinate(selection_drag_end_world, selection_drag_end_plane);
            }
            if (interaction_current_world && selection_drag_end_plane !== null) {
              setInteractionCurrentWorld(setWorldPointPlaneCoordinate(interaction_current_world, selection_drag_end_plane));
              emitLiveInteractionAnchor(interaction_current_world, true);
            }
            const local_x = e.x - rect.x0;
            const local_y = e.y - rect.y0;
            const end_coords = localToGrid(local_x, local_y);
            const width = Math.abs(end_coords.x - selection_drag_start.x) + 1;
            const height = Math.abs(end_coords.y - selection_drag_start.y) + 1;
            const range = getSelectionDomainPlaneRange(opts.get_rect_select_all_depths?.() ?? false);
            showStatus(formatSelectionVolumeLabel(width, height, range?.depthMin, range?.depthMax));
            return;
          }
        }
        const dir = e.delta_y < 0 ? 1 : (e.delta_y > 0 ? -1 : 0);
        if (dir !== 0) {
          opts.cycle_focus_layer(dir as 1 | -1);
          return;
        }
      }

      // Plain vertical wheel is reserved for depth navigation.
      // Shift/Alt wheel keep explicit pan controls available.
      const scroll_step = 2; // Grid cells per scroll
      const pan = getCanvasPanAdapter();
      if (e.shift) {
        pan.applyAxisDelta?.({ x: e.delta_y > 0 ? scroll_step : -scroll_step });
      } else if (e.alt) {
        pan.applyAxisDelta?.({ y: e.delta_y > 0 ? -scroll_step : scroll_step });
      }
    },

    OnKeyDown(e: KeyboardEvent): void {
      ensureGridShapeState();
      if (isMovePreviewActive()) {
        const currentGrid = current_mouse_pos ? localToGrid(current_mouse_pos.x - rect.x0, current_mouse_pos.y - rect.y0) : { x: 0, y: 0 };
        const nudgeByCode: Partial<Record<string, { x: number; y: number; z: number }>> = {
          Numpad1: { x: -1, y: 0, z: 0 },
          Numpad3: { x: 1, y: 0, z: 0 },
          NumpadAdd: { x: 0, y: 0, z: 1 },
          NumpadSubtract: { x: 0, y: 0, z: -1 },
        };
        const nudge = nudgeByCode[e.code];
        if (nudge) {
          move_preview_depth_offset += nudge.z;
          if (move_preview_anchor_world) {
            move_preview_anchor_world = { ...move_preview_anchor_world, x: move_preview_anchor_world.x - nudge.x, y: move_preview_anchor_world.y - nudge.y, z: move_preview_anchor_world.z };
          }
          updateMovePreviewAt(currentGrid.x, currentGrid.y, { force: true });
          e.preventDefault();
          return;
        }
      }
      // Undo - Ctrl+Z
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        finalizePendingChanges();
        const description = opts.on_undo_request();
        if (description) {
          opts.on_history_applied?.();
          showStatus(`Undo: ${description}`);
        } else {
          showStatus('Nothing to undo!');
        }
        e.preventDefault();
        return;
      }
      
      // Redo - Ctrl+Y or Ctrl+Shift+Z
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        finalizePendingChanges();
        const description = opts.on_redo_request();
        if (description) {
          opts.on_history_applied?.();
          showStatus(`Redo: ${description}`);
        } else {
          showStatus('Nothing to redo!');
        }
        e.preventDefault();
        return;
      }

      // Copy - Ctrl+C
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        painterCanvasDiag('copy shortcut detected', { has_selection: hasSelection(selection_bitmap) });
        copyCurrentSelection();
        e.preventDefault();
        return;
      }

      // Text mode handling
      if (text_mode_active) {
        syncTextCursorGridFromWorld();

        if (opts.get_active_group_locked?.()) {
          showStatus('Cannot type: active group is locked');
          e.preventDefault();
          return;
        }
        
        if (e.key === 'Enter') {
          commitPendingTextChanges('Type Text');
          // Enter: New line using enterlead and enterspace
          moveTextCursorToNextLine();
          e.preventDefault();
          return;
        }
        
        if (e.key === 'Escape') {
          exitTextMode(true);
          e.preventDefault();
          return;
        }
        
        if (e.key === 'Backspace') {
          const lineStart = getCurrentLineStartWorld();
          const cursorWorld = getTextCurrentWorld();
          if (!sameWorldPoint(cursorWorld, lineStart) || text_current_line > 0) {
            if (sameWorldPoint(cursorWorld, lineStart) && text_current_line > 0) {
              text_current_line--;
              const previousEnd = cloneWorldPoint(text_line_end_worlds[text_current_line])
                ?? cloneWorldPoint(text_line_start_worlds[text_current_line])
                ?? cloneWorldPoint(text_start_world);
              if (previousEnd) {
                tryMoveTextCursorToWorld(previousEnd);
              }
            } else {
              moveTextCursorByScreenDelta(-opts.get_text_spacing(), -opts.get_text_charlead());
            }
            if (text_cursor_x >= 0 && text_cursor_x < opts.grid.width &&
                text_cursor_y >= 0 && text_cursor_y < opts.grid.height) {
              // Track the deletion for undo
              const oldCell = getGridCell(text_cursor_x, text_cursor_y);
              opts.grid.cells[text_cursor_y]![text_cursor_x] = makeEmptyCell();
              const newCell = getGridCell(text_cursor_x, text_cursor_y);
              if (oldCell && newCell) {
                trackTextCursorChange(oldCell, newCell);
                maybeEmitLiveTextPreview(true);
              }
            }
          }
          e.preventDefault();
          return;
        }
        
        if (e.key === 'Delete') {
          if (text_cursor_x >= 0 && text_cursor_x < opts.grid.width &&
              text_cursor_y >= 0 && text_cursor_y < opts.grid.height) {
            // Track the deletion for undo
            const oldCell = getGridCell(text_cursor_x, text_cursor_y);
            opts.grid.cells[text_cursor_y]![text_cursor_x] = makeEmptyCell();
            const newCell = getGridCell(text_cursor_x, text_cursor_y);
            if (oldCell && newCell) {
              trackTextCursorChange(oldCell, newCell);
              maybeEmitLiveTextPreview(true);
            }
          }
          e.preventDefault();
          return;
        }
        
        if (e.key === 'ArrowLeft') {
          moveTextCursorByScreenDelta(-1, 0);
          e.preventDefault();
          return;
        }
        if (e.key === 'ArrowRight') {
          moveTextCursorByScreenDelta(1, 0);
          e.preventDefault();
          return;
        }
        if (e.key === 'ArrowUp') {
          moveTextCursorByScreenDelta(0, 1);
          e.preventDefault();
          return;
        }
        if (e.key === 'ArrowDown') {
          moveTextCursorByScreenDelta(0, -1);
          e.preventDefault();
          return;
        }
        
        if (e.key === ' ' || e.code === 'Space') {
          // Handle space directly to ensure it works
          if (text_cursor_x >= 0 && text_cursor_x < opts.grid.width &&
              text_cursor_y >= 0 && text_cursor_y < opts.grid.height) {
            const text_brush = getPreviewBrush();
            const oldCell = getGridCell(text_cursor_x, text_cursor_y);
            if (opts.get_space_replace()) {
              opts.grid.cells[text_cursor_y]![text_cursor_x] = makeEmptyCell();
              const newCell = getGridCell(text_cursor_x, text_cursor_y);
              if (oldCell && newCell) {
                trackTextCursorChange(oldCell, newCell);
                maybeEmitLiveTextPreview(true);
              }
            }
            // Move cursor by spacing and charlead
            moveTextCursorByScreenDelta(opts.get_text_spacing(), opts.get_text_charlead());
            setCurrentLineEndWorld(getTextCurrentWorld());
          }
          e.preventDefault();
          return;
        }

        if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
          insertTextAtCursor(e.key);
          e.preventDefault();
          return;
        }
        
        // Let other printable characters pass through to OnTextInput
        return;
      }

      // Space for panning (only when NOT in text mode)
      if (e.code === 'Space') {
        e.preventDefault();
        return;
      }

      // Arrow keys update camera pan position
      // Note: In grid coordinates, Y increases upward
      // ArrowUp = show content below = increase pan_y
      const pan_step = 1; // Move 1 grid cell per keypress
      const pan = getCanvasPanAdapter();
      switch (e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
          pan.applyAxisDelta?.({ y: pan_step });
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          pan.applyAxisDelta?.({ y: -pan_step });
          break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
          pan.applyAxisDelta?.({ x: -pan_step });
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          pan.applyAxisDelta?.({ x: pan_step });
          break;
      }
    },

    OnPointerLeave(): void {
      clear_gizmo_hover_state(gizmo_state);
      clearCanvasNavInteraction();
      group_location_border_hovered = false;
    },

    OnGlobalPointerDown(e: PointerEvent): void {
      handle_global_pointer_down_for_gizmos(e, rect, gizmo_config, gizmo_state);
      if (!text_mode_active) return;
      const target_module_id = typeof (e as any)?.target_module_id === 'string' ? String((e as any).target_module_id) : null;
      if (isValidTextModeAuxiliaryTarget(target_module_id)) return;
      exitTextMode(true);
    },

    OnKeyUp(e: KeyboardEvent): void {
      if (e.code === 'Space') {
        return;
      }
    },

    OnBlur(): void {
      clearCanvasNavInteraction();
      if (!text_mode_active) {
        clearMovePreview();
      }
      clearGroupLocationDrag();
      if (!text_mode_active) {
        clearPendingPreviewChanges();
      }
      paste_preview_data = null;
      paste_preview_pos = null;
      paste_preview_world_data = null;
      paste_preview_world_anchor = null;
      paste_preview_rotation_view = null;
      is_drawing = false;
      is_erasing = false;
      active_draw_channels = { char: true, color: true, weight: true };
      active_stroke_world_plane = null;
      active_stroke_anchor_world = null;
      is_selecting = false;
      is_lasso_selecting = false;
      drag_start = null;
      selection_drag_start = null;
      lasso_points = [];
      last_draw_pos = null;
      opts.preview_points = [];
    },

    OnTextInput(text: string): void {
      insertTextAtCursor(text);
    },

    WantsTextCapture(): boolean {
      return text_mode_active;
    },
    hasWorldPastePreview(): boolean {
      return !!paste_preview_world_data;
    },
    stepPasteViewAction(action: 'swing_left' | 'swing_right' | 'swing_up' | 'swing_down' | 'roll_left' | 'roll_right'): void {
      stepPastePreviewViewAction(action);
    },
    setPasteAngleMode(): void {
      if (!paste_preview_world_data) return;
      resetPastePreviewRotationView(paste_preview_world_data);
      if (paste_preview_world_anchor) {
        const gridPoint = opts.get_grid_point_for_world?.(paste_preview_world_anchor) ?? null;
        if (gridPoint) updatePastePreviewAtGrid(gridPoint.x, gridPoint.y);
      }
    }
  };
  
  return module;
}

// Export selection operations for external UI controls
export { clearSelection, selectAll, invertSelection, hasSelection };
export type { SelectionBitmap };

// Export type for the painter canvas module (includes emitViewport)
export type PainterCanvasModule = ReturnType<typeof make_painter_canvas_module>;
