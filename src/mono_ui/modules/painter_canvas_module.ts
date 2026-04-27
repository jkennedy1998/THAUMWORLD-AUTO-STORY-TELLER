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
import type { Grid, Brush, ToolType, GridCell } from '../../ascii_painter/types.js';
import { createGrid, getCell, setCell } from '../../ascii_painter/types.js';
import { drawCell, drawLine, eraseCell, sampleCell, previewLine, previewRectStroke, previewRectFill } from '../../ascii_painter/tools.js';
import { has_any_edit_channel, resolve_edit_channels_with_modifiers, type EditChannels } from '../../ascii_painter/edit_mask.js';
import { logGroupCellAction, addToGroupBatch, type HistoryManager, type CellChange } from '../../ascii_painter/history.js';
import { get_color_by_name } from '../colors.js';
import { draw_module_border, PANEL_BORDER_PRESETS } from '../module_borders.js';
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
import { get_principal_view_plane_axis, make_place_view_state, map_screen_direction_to_world_delta, type PlaceViewState } from '../runtime/place_view_projection.js';
import { diag_log } from '../../shared/diagnostics.js';
import { cells_match_edit_channels, get_flood_fill_voxels, get_line_voxels_3d } from '../../shared/painter_tools.js';
import {
  order_resolved_targets,
  type OrderedResolvedTargets,
  type ResolvedTarget,
} from '../runtime/interaction_runtime_types.js';

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
  get_active_group_world_bounds?: () => { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number } | null;
  get_active_group_locked?: () => boolean;
  get_current_tool: () => ToolType;
  get_preview_brush?: () => Brush;
  get_brush_for_button?: (button: number) => Brush;
  get_brush_edit_channels_for_button?: (button: number) => EditChannels;
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
  get_selection_mode: () => SelectionMode;
  // Text tool spacing and leading
  get_text_spacing: () => number; // -16 to 16, horizontal movement per character
  get_text_charlead: () => number; // -16 to 16, vertical movement per character
  get_text_enterlead: () => number; // -16 to 16, vertical movement per Enter key
  get_text_enterspace: () => number; // -16 to 16, horizontal offset on Enter key
  preview_points: { x: number; y: number }[];
  on_edit_committed: () => void;
  on_live_stroke_preview?: (args: { changes: CellChange[]; anchor_world: { x: number; y: number; z: number } | null; plane: number | null }) => void;
  on_sample_cell: (cell: { char: string; rgb: Rgb; weight_index: number }, sample: { button: number; shift: boolean; ctrl: boolean; alt: boolean; meta: boolean }) => void;
  get_left_click_tool: () => ToolType;
  get_right_click_tool: () => ToolType;
  get_focus_layer_z?: () => number;
  get_focus_world_plane?: () => number | null;
  cycle_focus_layer?: (dir: 1 | -1) => void;
  // History manager for undo/redo
  history: HistoryManager;
  // Selection callbacks
  on_selection_change?: (args?: { depthMin?: number; depthMax?: number; kind?: 'rect' | 'lasso' | 'clear' | 'select_all' | 'invert' | 'other' }) => void;
  on_world_selection_change?: (args: {
    kind: 'rect' | 'lasso' | 'clear' | 'select_all' | 'invert';
    mode?: SelectionMode;
    cells?: Array<{ x: number; y: number; z: number }>;
  }) => void;
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
  get_world_point_for_grid?: (x: number, y: number) => { x: number; y: number; z: number } | null;
  get_world_point_for_grid_on_plane?: (x: number, y: number, plane: number) => { x: number; y: number; z: number } | null;
  get_grid_point_for_world?: (world: { x: number; y: number; z: number }) => { x: number; y: number } | null;
  get_view_state?: () => PlaceViewState;
  get_focus_content_bounds?: () => { min_x: number; min_y: number; max_x: number; max_y: number } | null;
  get_selection_status?: () => string | null;
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
};

export type PainterInteractionAnchor = CameraAnchor;

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
  
  // Global pan offset from CSS transform (when panning blank space)
  let global_pan_offset = { x: 0, y: 0 };

  // Unified coordinate system helpers - ALL coordinate calculations go through these
  
  /**
   * Get total pan (camera pan + global CSS pan offset)
   * This is the single source of truth for pan calculations
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
  
  /**
   * Set the global pan offset (called from runtime when CSS transform changes)
   */
  function setGlobalPanOffset(x: number, y: number): void {
    global_pan_offset.x = x;
    global_pan_offset.y = y;
  }

  // Legacy helper - kept for compatibility but uses unified system
  function getPan(): { x: number; y: number } {
    return getTotalPan();
  }

  function getTextCursorInteractionAnchor(): PainterInteractionAnchor | null {
    const focusZ = opts.get_selected_z();
    const pan = getPan();
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

  // Atomic pan functions - all panning operations use these for consistency
  // Positive deltaX = pan right (shows content to the left)
  // Positive deltaY = pan up (shows content below)
  function panBy(deltaX: number, deltaY: number): void {
    const camera = getCamera();
    const oldX = camera.pan_x ?? 0;
    const oldY = camera.pan_y ?? 0;
    camera.pan_x = oldX + deltaX;
    camera.pan_y = oldY + deltaY;
    emitViewport();
  }

  function panTo(x: number, y: number): void {
    const camera = getCamera();
    const oldX = camera.pan_x ?? 0;
    const oldY = camera.pan_y ?? 0;
    camera.pan_x = x;
    camera.pan_y = y;
    emitViewport();
  }

  let is_panning = false;
  let is_drawing = false;
  let is_erasing = false;
  let active_draw_channels: EditChannels = { char: true, color: true, weight: true };
  let active_stroke_tool: ToolType | null = null;
  let drag_start: { x: number; y: number } | null = null;
  let last_draw_pos: { x: number; y: number } | null = null;
  let pan_start: { x: number; y: number } | null = null;
  let view_start: { x: number; y: number } | null = null;
  let drag_start_buttons = 0;
  let space_held = false;

  // Text input state
  let text_mode_active = false;
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

  function cloneGridCell(cell: GridCell): GridCell {
    return {
      char: cell.char,
      rgb: { ...cell.rgb },
      weight_index: cell.weight_index,
    };
  }

  function gridCellsEqual(a: GridCell | null | undefined, b: GridCell | null | undefined): boolean {
    if (!a || !b) return false;
    return a.char === b.char
      && a.rgb.r === b.rgb.r
      && a.rgb.g === b.rgb.g
      && a.rgb.b === b.rgb.b
      && a.weight_index === b.weight_index;
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
      const newCell: GridCell = {
        char: brush.char,
        rgb: { ...brush.rgb },
        weight_index: brush.weight_index,
      };
      if (gridCellsEqual(oldCell, newCell)) continue;
      changesByWorld.set(worldKey(world), buildChange(world, oldCell, newCell, { x: point.x, y: point.y }));
    }
    return Array.from(changesByWorld.values());
  }

  function buildLinePreviewChanges(start_world: { x: number; y: number; z: number }, end_world: { x: number; y: number; z: number }, brush: Brush): CellChange[] {
    const changesByWorld = new Map<string, CellChange>();
    for (const world of get_line_voxels_3d(start_world, end_world)) {
      const gridPoint = opts.get_grid_point_for_world?.(world) ?? null;
      if (gridPoint && !canEditCell(gridPoint.x, gridPoint.y)) continue;
      const oldCell = cloneGridCell(getActiveGroupWorldCell(world));
      const newCell: GridCell = {
        char: brush.char,
        rgb: { ...brush.rgb },
        weight_index: brush.weight_index,
      };
      if (gridCellsEqual(oldCell, newCell)) continue;
      changesByWorld.set(worldKey(world), buildChange(world, oldCell, newCell, gridPoint));
    }
    return Array.from(changesByWorld.values());
  }

  function setPreviewPoints(points: Array<{ x: number; y: number }>): void {
    opts.preview_points.length = 0;
    opts.preview_points.push(...points);
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

  function buildWorldPastePreviewChanges(worldData: WorldCopyData, anchor: { x: number; y: number; z: number }): PastePreviewResult {
    const result = createEmptyPastePreviewResult();
    const ignoreColorRgb = opts.get_paste_ignore_color_rgb();
    const changesByWorld = new Map<string, CellChange>();
    for (const entry of worldData.cells) {
      const world = {
        x: anchor.x + entry.dx,
        y: anchor.y + entry.dy,
        z: anchor.z + entry.dz,
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
      if (entry.cell && entry.cell.char !== ' ') {
        changesByWorld.set(worldKey(world), buildChange(world, oldCell, entry.cell, opts.get_grid_point_for_world?.(world) ?? null));
        result.placed += 1;
        continue;
      }
      if (opts.get_paste_space_replace()) {
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
        if (cell && cell.char !== ' ') {
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
      pending_changes = normalizeCommittedChanges(buildLinePreviewChanges(shape_start_world, endWorld, getBrushForButton(getDragButton())));
      setPreviewPoints([]);
      maybeEmitLiveStrokePreview();
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
      const preview = buildWorldPastePreviewChanges(paste_preview_world_data, paste_preview_world_anchor);
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

  function exitTextMode(commitPending: boolean): void {
    if (!text_mode_active) return;
    if (commitPending) commitPendingTextChanges('Type Text');
    text_mode_active = false;
    text_cursor_world = null;
    text_start_world = null;
    text_current_line = 0;
    text_line_start_worlds = [];
    text_line_end_worlds = [];
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

  function tryMoveTextCursorToWorld(world: { x: number; y: number; z: number }): boolean {
    const gridPoint = opts.get_grid_point_for_world?.(world);
    if (gridPoint) {
      const nextX = Math.floor(gridPoint.x);
      const nextY = Math.floor(gridPoint.y);
      if (nextX < 0 || nextX >= opts.grid.width || nextY < 0 || nextY >= opts.grid.height) return false;
      text_cursor_x = nextX;
      text_cursor_y = nextY;
      text_cursor_world = { x: world.x, y: world.y, z: world.z };
      return true;
    }
    if (opts.get_grid_point_for_world) return false;
    if (world.x < 0 || world.x >= opts.grid.width || world.y < 0 || world.y >= opts.grid.height) return false;
    moveTextCursorTo(world.x, world.y);
    return true;
  }

  function moveTextCursorByScreenDelta(screen_dx: number, screen_dy: number): boolean {
    syncTextCursorGridFromWorld();
    const current = getTextCurrentWorld();
    const delta = getScreenVectorWorldDelta(screen_dx, screen_dy);
    return tryMoveTextCursorToWorld({
      x: current.x + delta.x,
      y: current.y + delta.y,
      z: current.z + delta.z,
    });
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
    return tryMoveTextCursorToWorld(next);
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
    const committed_changes = pending_changes.map((change) => ({ ...change, oldCell: { ...change.oldCell }, newCell: { ...change.newCell } }));
    const active_group_id = requireActiveGroupId();
    logGroupCellAction(opts.history, 'draw_cells', description, { z: opts.get_selected_z(), group_id: active_group_id }, pending_changes);
    opts.on_commit_cell_changes?.({
      action_type: 'draw_cells',
      description,
      z: opts.get_selected_z(),
      group_id: active_group_id,
      changes: committed_changes,
    });
    pending_changes = [];
    clearLiveStrokePreview();
    opts.on_edit_committed();
  }

  function commitLoggedCellChanges(action_type: 'draw_cells' | 'erase_cells' | 'fill' | 'paste' | 'clear_canvas', description: string, z: number): void {
    if (pending_changes.length < 1) return;
    const committed_changes = pending_changes.map((change) => ({ ...change, oldCell: { ...change.oldCell }, newCell: { ...change.newCell } }));
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
      oldCell: { ...change.oldCell },
      newCell: { ...change.newCell },
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
    const plane = anchorWorld.z;
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
          text_mode_active = false;
          break;
        }
        continue;
      }

      if (text_cursor_x < 0 || text_cursor_x >= opts.grid.width || text_cursor_y < 0 || text_cursor_y >= opts.grid.height) continue;

      const text_brush = getPreviewBrush();
      const oldCell = getGridCell(text_cursor_x, text_cursor_y);

      if (char === ' ') {
        if (opts.get_space_replace()) {
          opts.grid.cells[text_cursor_y]![text_cursor_x] = {
            char: ' ',
            rgb: { ...text_brush.rgb },
            weight_index: text_brush.weight_index,
          };
          const newCell = getGridCell(text_cursor_x, text_cursor_y);
          if (oldCell && newCell) {
            trackChange(text_cursor_x, text_cursor_y, oldCell, newCell);
            maybeEmitLiveTextPreview(true);
          }
        }
      } else {
        opts.grid.cells[text_cursor_y]![text_cursor_x] = {
          char,
          rgb: { ...text_brush.rgb },
          weight_index: text_brush.weight_index,
        };
        const newCell = getGridCell(text_cursor_x, text_cursor_y);
        if (oldCell && newCell) {
          trackChange(text_cursor_x, text_cursor_y, oldCell, newCell);
          maybeEmitLiveTextPreview(true);
        }
      }

      moveTextCursorByScreenDelta(opts.get_text_spacing(), opts.get_text_charlead());
      setCurrentLineEndWorld(getTextCurrentWorld());

      if (text_cursor_x < 0 || text_cursor_x >= opts.grid.width || text_cursor_y < 0 || text_cursor_y >= opts.grid.height) {
        commitPendingTextChanges(commitDescription);
        text_mode_active = false;
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

  // Emit initial viewport
  emitViewport();

  // Cell change tracking for action-based undo
  let pending_changes: CellChange[] = [];
  let is_drawing_batch = false;
  let last_live_stroke_preview_at = 0;
  const LIVE_STROKE_PREVIEW_INTERVAL_MS = 24;
  let active_stroke_world_plane: number | null = null;
  let active_stroke_anchor_world: { x: number; y: number; z: number } | null = null;
  let interaction_current_world: { x: number; y: number; z: number } | null = null;
  let interaction_end_world: { x: number; y: number; z: number } | null = null;
  let shape_start_world: { x: number; y: number; z: number } | null = null;

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
    return cell ? { ...cell } : null;
  }

  // Track a cell change for undo
  function trackChange(x: number, y: number, oldCell: GridCell, newCell: GridCell): boolean {
    const world = getWorldPointForEditPlane(x, y);
    if (!world) return false;
    return trackWorldChange(world, oldCell, newCell, { x, y });
  }

  function trackWorldChange(world: { x: number; y: number; z: number }, oldCell: GridCell, newCell: GridCell, grid?: { x: number; y: number } | null): boolean {
    const group_id = requireActiveGroupId();
    const existingIndex = pending_changes.findIndex(c => c.worldX === world.x && c.worldY === world.y && c.worldZ === world.z);
    if (existingIndex >= 0 && pending_changes[existingIndex]) {
      // Update newCell but keep original oldCell
      pending_changes[existingIndex].newCell = newCell;
    } else {
      const gridPoint = grid ?? opts.get_grid_point_for_world?.(world) ?? null;
      pending_changes.push({
        x: gridPoint?.x ?? 0,
        y: gridPoint?.y ?? 0,
        worldX: world.x,
        worldY: world.y,
        worldZ: world.z,
        group_id,
        oldCell: { ...oldCell },
        newCell: { ...newCell },
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
    return { char: ' ', rgb: { r: 0, g: 0, b: 0 }, weight_index: 0 };
  }

  function isEmptyCell(cell: GridCell | null | undefined): boolean {
    return !cell || cell.char === ' ';
  }

  function cellsEqual(a: GridCell, b: GridCell): boolean {
    return a.char === b.char
      && a.rgb.r === b.rgb.r
      && a.rgb.g === b.rgb.g
      && a.rgb.b === b.rgb.b
      && a.weight_index === b.weight_index;
  }

  function applyBrushEditToCell(cell: GridCell, brush: Brush, channels: EditChannels): GridCell {
    const next: GridCell = { char: cell.char, rgb: { ...cell.rgb }, weight_index: cell.weight_index };
    if (channels.char && channels.color && channels.weight) {
      return { char: brush.char, rgb: { ...brush.rgb }, weight_index: brush.weight_index };
    }
    if (channels.char) next.char = brush.char;
    if (channels.color) next.rgb = { ...brush.rgb };
    if (channels.weight) next.weight_index = brush.weight_index;
    return next;
  }

  function applyEraserEditToCell(cell: GridCell, channels: EditChannels): GridCell {
    const next: GridCell = { char: cell.char, rgb: { ...cell.rgb }, weight_index: cell.weight_index };
    if (channels.char) next.char = ' ';
    if (channels.color) next.rgb = { r: 0, g: 0, b: 0 };
    if (channels.weight) next.weight_index = 0;
    return next;
  }

  function sampleActiveGroupWorldCell(world: { x: number; y: number; z: number }): GridCell {
    const cell = opts.get_active_group_world_cell?.(world) ?? opts.get_world_cell(world);
    return cell
      ? { char: cell.char, rgb: { ...cell.rgb }, weight_index: cell.weight_index }
      : makeEmptyCell();
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
      cell: { char: entry.cell.char, rgb: { ...entry.cell.rgb }, weight_index: entry.cell.weight_index },
    }));
  }

  function getActiveGroupWorldBounds(): { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number } | null {
    return opts.get_active_group_world_bounds?.() ?? null;
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
    const nextStartCell = applyBrushEditToCell(startCell, brush, editChannels);
    if (cellsEqual(startCell, nextStartCell)) return 0;
    const selectChannels = getBucketSelectChannelsForButton(button);
    const domain = enumerateBoundedWorldDomain(bounds);
    if (domain.length < 1) return 0;
    const filled = get_flood_fill_voxels({
      start: startWorld,
      sample: (world) => {
        if (!isWorldInsideBounds(world, bounds)) return null;
        const sampled = sampleActiveGroupWorldCell(world);
        return { char: sampled.char, rgb: { ...sampled.rgb }, weight: sampled.weight_index };
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
      const newCell = applyBrushEditToCell(oldCell, brush, editChannels);
      if (cellsEqual(oldCell, newCell)) continue;
      if (!trackWorldChange(world, oldCell, newCell, opts.get_grid_point_for_world?.(world) ?? null)) continue;
      changed += 1;
    }
    return changed;
  }

  function isIgnoredPasteCell(cell: GridCell | null, ignoreColorRgb: { r: number; g: number; b: number }): boolean {
    if (opts.get_paste_ignore_space() && (!cell || cell.char === ' ')) return true;
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
    if (text_mode_active && pending_changes.length > 0) {
      const selected_z = opts.get_selected_z();
      commitLoggedCellChanges('draw_cells', 'Type Text', selected_z);
    }
    clearActiveStrokeState();
  }

  function moveTextCursorTo(grid_x: number, grid_y: number): void {
    text_cursor_x = clamp(Math.floor(grid_x), 0, Math.max(0, opts.grid.width - 1));
    text_cursor_y = clamp(Math.floor(grid_y), 0, Math.max(0, opts.grid.height - 1));
    text_cursor_world = opts.get_world_point_for_grid?.(text_cursor_x, text_cursor_y) ?? { x: text_cursor_x, y: text_cursor_y, z: opts.get_selected_z() };
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
          region.set(`${x},${y}`, { ...cell });
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
        
        if (oldCell && newCell) {
          // Check if cell actually changed
          if (oldCell.char !== newCell.char ||
              oldCell.rgb.r !== newCell.rgb.r ||
              oldCell.rgb.g !== newCell.rgb.g ||
              oldCell.rgb.b !== newCell.rgb.b ||
              oldCell.weight_index !== newCell.weight_index) {
            trackChange(x, y, oldCell, newCell);
          }
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
                  opts.grid.cells[draw_y]![draw_x] = { ...oldCell };
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
        const newCell = applyEraserEditToCell(cell, channels);
        if (cellsEqual(oldCell, newCell)) continue;
        opts.grid.cells[draw_y]![draw_x] = { char: newCell.char, rgb: { ...newCell.rgb }, weight_index: newCell.weight_index };
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

  function applyCharWithBrushSize(x: number, y: number, char: string, size: number): void {
    const offset = Math.floor(size / 2);
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        const draw_x = x - offset + dx;
        const draw_y = y - offset + dy;
        if (draw_x >= 0 && draw_x < opts.grid.width && draw_y >= 0 && draw_y < opts.grid.height && canEditCell(draw_x, draw_y)) {
          const oldCell = getGridCell(draw_x, draw_y);
          const cell = getCell(opts.grid, draw_x, draw_y);
          if (cell && cell.char !== ' ' && oldCell) {
            cell.char = char;
            const newCell = getGridCell(draw_x, draw_y);
            if (newCell && !trackChange(draw_x, draw_y, oldCell, newCell)) {
              opts.grid.cells[draw_y]![draw_x] = { ...oldCell };
            }
          }
        }
      }
    }
  }

  function applyCharAndColorWithBrushSize(x: number, y: number, brush: Brush, size: number): void {
    const offset = Math.floor(size / 2);
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        const draw_x = x - offset + dx;
        const draw_y = y - offset + dy;
        if (draw_x >= 0 && draw_x < opts.grid.width && draw_y >= 0 && draw_y < opts.grid.height && canEditCell(draw_x, draw_y)) {
          const oldCell = getGridCell(draw_x, draw_y);
          const cell = getCell(opts.grid, draw_x, draw_y);
          if (cell && cell.char !== ' ' && oldCell) {
            cell.char = brush.char;
            cell.rgb = { ...brush.rgb };
            const newCell = getGridCell(draw_x, draw_y);
            if (newCell && !trackChange(draw_x, draw_y, oldCell, newCell)) {
              opts.grid.cells[draw_y]![draw_x] = { ...oldCell };
            }
          }
        }
      }
    }
  }

  function applyBrushEditWithBrushSize(x: number, y: number, brush: Brush, size: number, channels: EditChannels): void {
    if (!has_any_edit_channel(channels)) return;
    if (channels.char && channels.color && channels.weight) {
      drawWithBrushSize(x, y, false, brush, size);
      return;
    }
    if (channels.char && channels.color && !channels.weight) {
      applyCharAndColorWithBrushSize(x, y, brush, size);
      return;
    }
    if (channels.char && !channels.color && !channels.weight) {
      applyCharWithBrushSize(x, y, brush.char, size);
      return;
    }
    if (!channels.char && channels.color && !channels.weight) {
      applyColorWithBrushSize(x, y, brush.rgb, size);
      return;
    }
    if (!channels.char && !channels.color && channels.weight) {
      applyWeightWithBrushSize(x, y, brush.weight_index, size);
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
        if (!cell || !oldCell || cell.char === ' ') continue;
        if (channels.char) cell.char = brush.char;
        if (channels.color) cell.rgb = { ...brush.rgb };
        if (channels.weight) cell.weight_index = brush.weight_index;
        const newCell = getGridCell(draw_x, draw_y);
        if (newCell && !trackChange(draw_x, draw_y, oldCell, newCell)) {
          opts.grid.cells[draw_y]![draw_x] = { ...oldCell };
        }
      }
    }
  }

  function drawLineWithBrushEditChannels(x0: number, y0: number, x1: number, y1: number, brush: Brush, size: number, channels: EditChannels): void {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let curr_x = x0;
    let curr_y = y0;

    while (true) {
      applyBrushEditWithBrushSize(curr_x, curr_y, brush, size, channels);
      if (curr_x === x1 && curr_y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; curr_x += sx; }
      if (e2 < dx) { err += dx; curr_y += sy; }
    }
  }

  // Apply weight to cells with brush size
  function applyWeightWithBrushSize(x: number, y: number, weight_index: number, size: number): void {
    const offset = Math.floor(size / 2);
    
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        const draw_x = x - offset + dx;
        const draw_y = y - offset + dy;
        
        if (draw_x >= 0 && draw_x < opts.grid.width &&
            draw_y >= 0 && draw_y < opts.grid.height &&
            canEditCell(draw_x, draw_y)) {
          const oldCell = getGridCell(draw_x, draw_y);
          const cell = getCell(opts.grid, draw_x, draw_y);
          if (cell && cell.char !== ' ' && oldCell) {
            cell.weight_index = weight_index;
            const newCell = getGridCell(draw_x, draw_y);
            if (newCell) {
              if (!trackChange(draw_x, draw_y, oldCell, newCell)) {
                opts.grid.cells[draw_y]![draw_x] = { ...oldCell };
              }
            }
          }
        }
      }
    }
  }

  // Apply color to cells with brush size
  function applyColorWithBrushSize(x: number, y: number, rgb: Rgb, size: number): void {
    const offset = Math.floor(size / 2);
    
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        const draw_x = x - offset + dx;
        const draw_y = y - offset + dy;
        
        if (draw_x >= 0 && draw_x < opts.grid.width &&
            draw_y >= 0 && draw_y < opts.grid.height &&
            canEditCell(draw_x, draw_y)) {
          const oldCell = getGridCell(draw_x, draw_y);
          const cell = getCell(opts.grid, draw_x, draw_y);
          if (cell && cell.char !== ' ' && oldCell) {
            cell.rgb = { ...rgb };
            const newCell = getGridCell(draw_x, draw_y);
            if (newCell) {
              if (!trackChange(draw_x, draw_y, oldCell, newCell)) {
                opts.grid.cells[draw_y]![draw_x] = { ...oldCell };
              }
            }
          }
        }
      }
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
    setGlobalPanOffset: (x: number, y: number) => void;
    getTextCursorInteractionAnchor: () => PainterInteractionAnchor | null;
    resolveInteractionTargets: (x: number, y: number) => OrderedResolvedTargets;
    finalizePendingChanges: () => void;
    handleDepthStepDuringActiveStroke: (nextPlane: number) => void;
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

    setGlobalPanOffset: (x: number, y: number) => {
      setGlobalPanOffset(x, y);
    },

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
          ? get_color_by_name('vivid_yellow').rgb 
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
        const status_color = get_color_by_name('vivid_yellow').rgb;
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
        const border_color = get_color_by_name('medium_gray').rgb;
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
          const cursor_color = get_color_by_name('vivid_yellow').rgb;
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
      const debug_color = get_color_by_name('vivid_cyan').rgb;
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

      const selection_status = opts.get_selection_status?.();
      if (selection_status) {
        const msg = selection_status.slice(0, Math.max(0, rect.x1 - rect.x0 - 2));
        const base_x = Math.max(rect.x0 + 1, rect.x1 - msg.length);
        const y = rect.y0;
        const rgb = get_color_by_name('vivid_cyan').rgb;
        for (let i = 0; i < msg.length; i++) {
          const x = base_x + i;
          if (x > rect.x1) break;
          c.set(x, y, {
            char: msg[i] ?? ' ',
            rgb,
            style: 'regular',
            weight_index: 2,
            render_index: 999,
          });
        }
      }
      // Draw a border around the selected canvas bounds (replaces the origin crosshair).
      // This stays clipped to the module rect and gives a clear "drawing space" frame.
      if (!gizmo_state.is_resize_mode) {
        const bounds_color = get_color_by_name('pale_gray').rgb;

        const contentBounds = opts.get_focus_content_bounds?.() ?? null;
        const left = rect.x0 + (contentBounds?.min_x ?? 0);
        const bottom = rect.y0 + (contentBounds?.min_y ?? 0);
        const right = rect.x0 + (contentBounds?.max_x ?? Math.max(0, opts.grid.width - 1));
        const top = rect.y0 + (contentBounds?.max_y ?? Math.max(0, opts.grid.height - 1));

        const x0 = Math.max(rect.x0, left);
        const x1 = Math.min(rect.x1, right);
        const y0 = Math.max(rect.y0, bottom);
        const y1 = Math.min(rect.y1, top);

        if (x0 <= x1 && y0 <= y1) {
          for (let x = x0; x <= x1; x++) {
            if (bottom >= rect.y0 && bottom <= rect.y1) {
              c.set(x, bottom, { char: '─', rgb: bounds_color, style: 'regular', weight_index: 1, render_index: 996 });
            }
            if (top >= rect.y0 && top <= rect.y1) {
              c.set(x, top, { char: '─', rgb: bounds_color, style: 'regular', weight_index: 1, render_index: 996 });
            }
          }

          for (let y = y0; y <= y1; y++) {
            if (left >= rect.x0 && left <= rect.x1) {
              c.set(left, y, { char: '│', rgb: bounds_color, style: 'regular', weight_index: 1, render_index: 996 });
            }
            if (right >= rect.x0 && right <= rect.x1) {
              c.set(right, y, { char: '│', rgb: bounds_color, style: 'regular', weight_index: 1, render_index: 996 });
            }
          }

          if (left >= rect.x0 && left <= rect.x1 && bottom >= rect.y0 && bottom <= rect.y1) {
            c.set(left, bottom, { char: '└', rgb: bounds_color, style: 'regular', weight_index: 1, render_index: 996 });
          }
          if (right >= rect.x0 && right <= rect.x1 && bottom >= rect.y0 && bottom <= rect.y1) {
            c.set(right, bottom, { char: '┘', rgb: bounds_color, style: 'regular', weight_index: 1, render_index: 996 });
          }
          if (left >= rect.x0 && left <= rect.x1 && top >= rect.y0 && top <= rect.y1) {
            c.set(left, top, { char: '┌', rgb: bounds_color, style: 'regular', weight_index: 1, render_index: 996 });
          }
          if (right >= rect.x0 && right <= rect.x1 && top >= rect.y0 && top <= rect.y1) {
            c.set(right, top, { char: '┐', rgb: bounds_color, style: 'regular', weight_index: 1, render_index: 996 });
          }
        }
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

      // Space + Left click = pan mode.
      // Use event-captured keyboard state so this works even if key focus routing is imperfect.
      if (!text_mode_active && e.space && e.button === 0) {
        is_panning = true;
        pan_start = { x: local_x, y: local_y };
        // Use camera pan as the starting point
        const camera = getCamera();
        view_start = { x: camera.pan_x ?? 0, y: camera.pan_y ?? 0 };
        return;
      }

      const tool_for_button = e.button === 2 ? opts.get_right_click_tool() : opts.get_left_click_tool();

      if (tool_for_button !== 'paste' && (paste_preview_data || paste_preview_world_data)) {
        clearPendingPreviewChanges();
        paste_preview_data = null;
        paste_preview_pos = null;
        paste_preview_world_data = null;
        paste_preview_world_anchor = null;
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
        clearPendingPreviewChanges();
        const scale = opts.get_paste_scale();
        // Get fresh gradiator state at paste time (not cached)
        const freshGradiatorState = opts.get_gradiator_state();
        
        // First check for images in clipboard
        // Pass targetWidth based on scale: 100% means use original image dimensions with pixel-perfect mapping
        const targetWidth = scale === 1.0 ? undefined : 80;
        const pixelPerfect = scale === 1.0;
        pasteImageFromClipboard(targetWidth, freshGradiatorState, pixelPerfect).then(imageData => {
          if (imageData) {
            // Image found in clipboard - scale it if needed
            painterCanvasDiag('image pasted from clipboard', { width: imageData.width, height: imageData.height });
            const scaledData = scale !== 1.0 ? scaleCopyData(imageData, scale) : imageData;
            paste_preview_data = scaledData;
            paste_preview_world_data = null;
            paste_preview_world_anchor = null;
            // Center the paste on the cursor
            paste_preview_pos = { 
              x: grid_x - Math.floor(scaledData.width / 2), 
              y: grid_y - Math.floor(scaledData.height / 2) 
            };
            updatePastePreviewAtGrid(paste_preview_pos.x, paste_preview_pos.y);
            showStatus(`Image paste: ${scaledData.width}x${scaledData.height} @ ${Math.round(scale * 100)}% - Click to place`);
          } else {
            // No image, try text clipboard
            Promise.resolve(opts.get_clipboard_data?.()).then(clipboard => {
              painterCanvasDiag('paste tool clicked', { clipboard: clipboard ? 'exists' : 'empty' });
              if (clipboard) {
                const worldData = decode_world_copy_data(clipboard);
                if (worldData) {
                  paste_preview_world_data = worldData;
                  paste_preview_world_anchor = opts.get_world_point_for_grid?.(grid_x, grid_y) ?? { x: grid_x, y: grid_y, z: opts.get_selected_z() };
                  updatePastePreviewAtGrid(grid_x, grid_y);
                  opts.set_world_copy_data?.(clipboard);
                  showStatus(`3D paste preview: ${worldData.cells.length} voxels - Click to place`);
                  return;
                }
                // Try to decode special format first
                painterCanvasDiag('decoding clipboard data', { preview: clipboard.substring(0, 200) });
                const specialData = decodeFromSpecialFormat(clipboard);
                if (specialData) {
                  // Special format with colors/weights - apply scaling
                  painterCanvasDiag('decoded special format', { width: specialData.width, height: specialData.height });
                  // Debug: Show first few cells
                  for (let y = 0; y < Math.min(3, specialData.height); y++) {
                    for (let x = 0; x < Math.min(5, specialData.width); x++) {
                      const cell = specialData.cells[y]?.[x];
                      if (cell) {
                        painterCanvasDiag('decoded special format sample cell', { y, x, char: cell.char, rgb: cell.rgb, weight_index: cell.weight_index });
                      }
                    }
                  }
                  const scaledData = scale !== 1.0 ? scaleCopyData(specialData, scale) : specialData;
                  paste_preview_data = scaledData;
                  paste_preview_world_data = null;
                  paste_preview_world_anchor = null;
                  // Center the paste on the cursor
                  paste_preview_pos = { 
                    x: grid_x - Math.floor(scaledData.width / 2), 
                    y: grid_y - Math.floor(scaledData.height / 2) 
                  };
                  updatePastePreviewAtGrid(paste_preview_pos.x, paste_preview_pos.y);
                  showStatus(`Paste preview: ${scaledData.width}x${scaledData.height} @ ${Math.round(scale * 100)}% - Click to place`);
                } else {
                  // Plain text - convert and scale
                  const textData = scaleTextToCopyData(clipboard, scale);
                  paste_preview_data = textData;
                  paste_preview_world_data = null;
                  paste_preview_world_anchor = null;
                  // Center the paste on the cursor
                  paste_preview_pos = { 
                    x: grid_x - Math.floor(textData.width / 2), 
                    y: grid_y - Math.floor(textData.height / 2) 
                  };
                  updatePastePreviewAtGrid(paste_preview_pos.x, paste_preview_pos.y);
                  showStatus(`Paste preview: ${textData.width}x${textData.height} @ ${Math.round(scale * 100)}% - Click to place`);
                }
              } else {
                showStatus('Clipboard empty! Copy something first.');
              }
            }).catch(err => {
              diag_log('input', 'important', 'PAINTER_CANVAS', 'failed to read clipboard', { error: err instanceof Error ? err.message : String(err) }, { sink: 'error' });
              showStatus('Failed to read clipboard!');
            });
          }
        }).catch(err => {
          diag_log('painter', 'important', 'PAINTER_CANVAS', 'failed to paste image', { error: err instanceof Error ? err.message : String(err) }, { sink: 'error' });
          showStatus('Failed to read image from clipboard!');
        });
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
          if (canEditCell(grid_x, grid_y)) {
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
          text_mode_active = false;
          text_mode_active = true;
          moveTextCursorTo(grid_x, grid_y);
          resetTextEntryAnchorAtCurrentCursor();
          return;
        }

        if (tool_for_button === 'pencil') {
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

        if (tool_for_button === 'line' || tool_for_button.startsWith('rect_')) {
          active_stroke_tool = tool_for_button;
          active_stroke_world_plane = opts.get_selected_z();
          active_stroke_anchor_world = getWorldPointForEditPlane(grid_x, grid_y, active_stroke_world_plane);
          if (!active_stroke_anchor_world) {
            showStatus('Cannot start stroke on selected depth here');
            active_stroke_tool = null;
            active_stroke_world_plane = null;
            return;
          }
          shape_start_world = { ...active_stroke_anchor_world };
          setInteractionCurrentWorld(active_stroke_anchor_world);
          setInteractionEndWorld(null);
          is_drawing = true;
          drag_start = { x: grid_x, y: grid_y };
          setPreviewPoints(tool_for_button === 'line'
            ? [{ x: grid_x, y: grid_y }]
            : []);
        }
      }
    },

    OnDragMove(e: DragEvent): void {
      const local_x = e.x - rect.x0;
      const local_y = e.y - rect.y0;
      
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

      if (is_panning && pan_start && view_start) {
        // Drag panning: subtract delta from starting position
        // Drag right (positive delta) = show content to left = decrease pan_x
        // Drag down (positive delta) = show content above = decrease pan_y
        const panSpeed = 0.5; // Convert pixel movement to grid cell pan
        const newPanX = view_start.x - (local_x - pan_start.x) * panSpeed;
        const newPanY = view_start.y - (local_y - pan_start.y) * panSpeed;
        panTo(newPanX, newPanY);
        return;
      }

        if (isActiveEraserStroke() && last_draw_pos) {
        const grid_coords = localToGrid(local_x, local_y);
        const grid_x = grid_coords.x;
        const grid_y = grid_coords.y;
        if (grid_x < 0 || grid_x >= opts.grid.width || grid_y < 0 || grid_y >= opts.grid.height) return;
        setInteractionCurrentWorld(getWorldPointForEditPlane(grid_x, grid_y, active_stroke_world_plane ?? opts.get_selected_z()));
        if (grid_x !== last_draw_pos.x || grid_y !== last_draw_pos.y) {
          const points = previewLine(last_draw_pos.x, last_draw_pos.y, grid_x, grid_y);
          for (const point of points) eraseWithBrushSizeAndChannels(point.x, point.y, getBrushSizeForButton(getDragButton()), active_draw_channels);
          last_draw_pos = { x: grid_x, y: grid_y };
          maybeEmitLiveStrokePreview();
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
          drawLineWithBrushEditChannels(last_draw_pos.x, last_draw_pos.y, grid_x, grid_y, getBrushForButton(getDragButton()), getBrushSizeForButton(getDragButton()), active_draw_channels);
          last_draw_pos = { x: grid_x, y: grid_y };
          maybeEmitLiveStrokePreview();
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

        if (isActiveShapeStroke()) {
          const current_coords = localToGrid(local_x, local_y);
          const current_x = current_coords.x;
          const current_y = current_coords.y;
          updateLineRectPreview({ x: current_x, y: current_y });
        }

        // Paste preview follows mouse
        if (opts.get_current_tool() === 'paste' && paste_preview_data) {
          const grid_coords = localToGrid(local_x, local_y);
          updatePastePreviewAtGrid(grid_coords.x, grid_coords.y);
        } else if (opts.get_current_tool() === 'paste' && paste_preview_world_data) {
          const grid_coords = localToGrid(local_x, local_y);
          updatePastePreviewAtGrid(grid_coords.x, grid_coords.y);
        }
    },

    OnDragEnd(e: DragEvent): void {
      if (is_panning) {
        is_panning = false;
        pan_start = null;
        view_start = null;
        drag_start_buttons = 0;
        return;
      }

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
      if (opts.get_current_tool() === 'paste' && paste_preview_world_data && paste_preview_world_anchor) {
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
        return;
      }

      // Handle paste placement
      if (opts.get_current_tool() === 'paste' && paste_preview_data && paste_preview_pos) {
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
        if (pending_changes.length > 0) {
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

      if (is_panning) {
        is_panning = false;
        pan_start = null;
        view_start = null;
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
      
      // Log text changes when exiting text mode via click
      if (text_mode_active && pending_changes.length > 0) {
        const selected_z = opts.get_selected_z();
        commitLoggedCellChanges('draw_cells', 'Type Text', selected_z);
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
      }
    },

    OnWheel(e: WheelEvent): void {
      if (e.ctrl) {
        const zoom_step = 0.1;
        scale = clamp(scale + (e.delta_y > 0 ? zoom_step : -zoom_step), 0.5, 3.0);
        return;
      }

      if (!e.shift && !e.alt && opts.cycle_focus_layer) {
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
      if (e.shift) {
        panBy(e.delta_y > 0 ? scroll_step : -scroll_step, 0);
      } else if (e.alt) {
        panBy(0, e.delta_y > 0 ? -scroll_step : scroll_step);
      }
    },

    OnKeyDown(e: KeyboardEvent): void {
      ensureGridShapeState();
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
              opts.grid.cells[text_cursor_y]![text_cursor_x] = {
                char: ' ',
                rgb: { r: 0, g: 0, b: 0 },
                weight_index: 0
              };
              const newCell = getGridCell(text_cursor_x, text_cursor_y);
              if (oldCell && newCell) {
                trackChange(text_cursor_x, text_cursor_y, oldCell, newCell);
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
            opts.grid.cells[text_cursor_y]![text_cursor_x] = {
              char: ' ',
              rgb: { r: 0, g: 0, b: 0 },
              weight_index: 0
            };
            const newCell = getGridCell(text_cursor_x, text_cursor_y);
            if (oldCell && newCell) {
              trackChange(text_cursor_x, text_cursor_y, oldCell, newCell);
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
              opts.grid.cells[text_cursor_y]![text_cursor_x] = {
                char: ' ',
                rgb: { ...text_brush.rgb },
                weight_index: text_brush.weight_index
              };
              const newCell = getGridCell(text_cursor_x, text_cursor_y);
              if (oldCell && newCell) {
                trackChange(text_cursor_x, text_cursor_y, oldCell, newCell);
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
        space_held = true;
        e.preventDefault();
        return;
      }

      // Arrow keys update camera pan position
      // Note: In grid coordinates, Y increases upward
      // ArrowUp = show content below = increase pan_y
      const pan_step = 1; // Move 1 grid cell per keypress
      switch (e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
          panBy(0, pan_step);
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          panBy(0, -pan_step);
          break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
          panBy(-pan_step, 0);
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          panBy(pan_step, 0);
          break;
      }
    },

    OnPointerLeave(): void {
      clear_gizmo_hover_state(gizmo_state);
    },

    OnGlobalPointerDown(e: PointerEvent): void {
      handle_global_pointer_down_for_gizmos(e, rect, gizmo_config, gizmo_state);
      if (text_mode_active && (e.x < rect.x0 || e.x > rect.x1 || e.y < rect.y0 || e.y > rect.y1)) {
        exitTextMode(true);
      }
    },

    OnKeyUp(e: KeyboardEvent): void {
      if (e.code === 'Space') {
        space_held = false;
      }
    },

    OnBlur(): void {
      exitTextMode(true);
      clearPendingPreviewChanges();
      paste_preview_data = null;
      paste_preview_pos = null;
      paste_preview_world_data = null;
      paste_preview_world_anchor = null;
      space_held = false;
      is_panning = false;
      is_drawing = false;
      is_erasing = false;
      active_draw_channels = { char: true, color: true, weight: true };
      active_stroke_world_plane = null;
      active_stroke_anchor_world = null;
      is_selecting = false;
      is_lasso_selecting = false;
      pan_start = null;
      view_start = null;
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
    }
  };
  
  return module;
}

// Export selection operations for external UI controls
export { clearSelection, selectAll, invertSelection, hasSelection };
export type { SelectionBitmap };

// Export type for the painter canvas module (includes emitViewport)
export type PainterCanvasModule = ReturnType<typeof make_painter_canvas_module>;
