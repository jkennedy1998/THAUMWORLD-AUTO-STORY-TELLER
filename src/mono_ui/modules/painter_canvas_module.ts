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
import { drawCell, drawLine, eraseCell, applyTool, sampleCell, previewLine, previewRectStroke, previewRectFill } from '../../ascii_painter/tools.js';
import { logCellAction, logSelectionAction, startBatch, endBatch, addToBatch, cancelBatch, undo, redo, getHistoryState, type HistoryManager, type CellChange } from '../../ascii_painter/history.js';
import { get_brightest_indexed_rgb, get_color_by_name, get_darkest_indexed_rgb } from '../colors.js';
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
import type { VoxelSpace } from '../../ascii_painter/voxel_space.js';
import { getOrCreateLayer, getVisibleLayers, getVoxel, setVoxel } from '../../ascii_painter/voxel_space.js';
import type { CameraAnchor } from '../runtime/camera_anchor_runtime.js';
import { make_place_view_state, map_screen_direction_to_world_delta, type PlaceViewState } from '../runtime/place_view_projection.js';

export interface CanvasViewport {
  x: number;      // Screen X position in pixels
  y: number;      // Screen Y position in pixels
  width: number;  // Width in pixels
  height: number; // Height in pixels
  // Note: Pan offset is stored in CameraConfig (camera.pan_x/y)
  // The camera owns the view position in world space
}

export type PainterCanvasOptions = {
  id: string;
  rect: Rect;
  grid: Grid;
  brush?: Brush;
  // Always fetch the latest space (it can be replaced on load/new).
  get_space: () => VoxelSpace;
  get_selected_z: () => number;
  get_current_tool: () => ToolType;
  get_preview_brush?: () => Brush;
  get_brush_for_button?: (button: number) => Brush;
  get_brush_size: () => number;
  get_brush_size_for_button?: (button: number) => number;
  get_space_replace: () => boolean;
  get_paste_space_replace: () => boolean;
  get_selection_mode: () => SelectionMode;
  // Text tool spacing and leading
  get_text_spacing: () => number; // -16 to 16, horizontal movement per character
  get_text_charlead: () => number; // -16 to 16, vertical movement per character
  get_text_enterlead: () => number; // -16 to 16, vertical movement per Enter key
  get_text_enterspace: () => number; // -16 to 16, horizontal offset on Enter key
  preview_points: { x: number; y: number }[];
  on_push_snapshot: () => void;
  on_sample_cell: (cell: { char: string; rgb: Rgb; weight_index: number }, button: number) => void;
  get_left_click_tool: () => ToolType;
  get_right_click_tool: () => ToolType;
  get_focus_layer_z?: () => number;
  get_focus_world_plane?: () => number | null;
  cycle_focus_layer?: (dir: 1 | -1) => void;
  // History manager for undo/redo
  history: HistoryManager;
  // Selection callbacks
  on_selection_change?: (args?: { depthMin?: number; depthMax?: number; kind?: 'rect' | 'lasso' | 'clear' | 'select_all' | 'invert' | 'other' }) => void;
  on_copy_data?: (data: string) => void | Promise<void>;
  get_clipboard_data?: () => string | null | Promise<string | null>;
  get_world_copy_data?: () => string | null;
  set_world_copy_data?: (data: string) => void;
  // Gizmo callbacks for move/resize/close
  on_move?: (new_rect: Rect) => void;
  on_resize?: (new_rect: Rect) => void;
  on_close?: () => void;
  // Viewport callback for DOM renderer
  on_viewport_change?: (viewport: CanvasViewport) => void;
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
  get_grid_point_for_world?: (world: { x: number; y: number; z: number }) => { x: number; y: number } | null;
  get_view_state?: () => PlaceViewState;
  get_focus_content_bounds?: () => { min_x: number; min_y: number; max_x: number; max_y: number } | null;
  get_selection_overlay_cells?: () => Array<{ x: number; y: number; char: string; weight_index: number }>;
  get_selection_status?: () => string | null;
  on_history_applied?: () => void;
};

export type PainterInteractionAnchor = CameraAnchor;

export function make_painter_canvas_module(opts: PainterCanvasOptions): Module {
  let rect = opts.rect;

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

  function getPreviewBrush(): Brush {
      return drag_start_buttons
        ? getBrushForButton(getDragButton())
      : opts.get_preview_brush?.() ?? opts.brush ?? getBrushForButton(0);
  }

  function getSpace(): VoxelSpace {
    return opts.get_space();
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
    const space = getSpace();
    return {
      // NOTE: Pointer events delivered to modules are already in grid-tile coordinates
      // that account for the mono_canvas CSS transform (global UI pan) via
      // getBoundingClientRect() in CanvasRuntime.
      // If we also apply the global pan here, the mouse-to-grid mapping drifts
      // further off with every global pan tile.
      x: (space.camera.pan_x ?? 0),
      y: (space.camera.pan_y ?? 0)
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

  function getInteractionAnchor(): PainterInteractionAnchor {
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

    if (current_mouse_pos && current_mouse_pos.x >= rect.x0 && current_mouse_pos.x <= rect.x1 && current_mouse_pos.y >= rect.y0 && current_mouse_pos.y <= rect.y1) {
      const grid = screenToGrid(current_mouse_pos.x, current_mouse_pos.y);
      const world = opts.get_world_point_for_grid?.(grid.x, grid.y) ?? { x: grid.x, y: grid.y, z: focusZ };
      return {
        kind: 'pointer',
        world,
        screen: { x: current_mouse_pos.x + 0.5, y: current_mouse_pos.y + 0.5 },
      };
    }

    const selectionBounds = hasSelection(selection_bitmap) ? getSelectionBounds(selection_bitmap) : null;
    if (selectionBounds) {
      const centerX = selectionBounds.x + (selectionBounds.width - 1) / 2;
      const centerY = selectionBounds.y + (selectionBounds.height - 1) / 2;
      const world = opts.get_world_point_for_grid?.(centerX, centerY) ?? { x: centerX, y: centerY, z: focusZ };
      return {
        kind: 'selection',
        world,
        screen: {
          x: rect.x0 + (opts.get_world_point_for_grid ? centerX : (centerX - pan.x)) + 0.5,
          y: rect.y0 + (opts.get_world_point_for_grid ? centerY : (centerY - pan.y)) + 0.5,
        },
      };
    }

    return {
      kind: 'viewport_center',
      world: null,
      screen: {
        x: (rect.x0 + rect.x1 + 1) / 2,
        y: (rect.y0 + rect.y1 + 1) / 2,
      },
    };
  }

  // Atomic pan functions - all panning operations use these for consistency
  // Positive deltaX = pan right (shows content to the left)
  // Positive deltaY = pan up (shows content below)
  function panBy(deltaX: number, deltaY: number): void {
    const camera = getSpace().camera;
    const oldX = camera.pan_x ?? 0;
    const oldY = camera.pan_y ?? 0;
    camera.pan_x = oldX + deltaX;
    camera.pan_y = oldY + deltaY;
    emitViewport();
  }

  function panTo(x: number, y: number): void {
    const camera = getSpace().camera;
    const oldX = camera.pan_x ?? 0;
    const oldY = camera.pan_y ?? 0;
    camera.pan_x = x;
    camera.pan_y = y;
    emitViewport();
  }

  let is_panning = false;
  let is_drawing = false;
  let is_erasing = false;
  let is_weighing = false;  // For weighter tool
  let is_coloring = false;  // For colorer tool
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

  function exitTextMode(commitPending: boolean): void {
    if (!text_mode_active) return;
    if (commitPending && pending_changes.length > 0) {
      logCellAction(opts.history, 'draw_cells', 'Type Text', opts.get_selected_z(), pending_changes);
      pending_changes = [];
      opts.on_push_snapshot();
    }
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

  // Function to emit viewport updates for DOM renderer
  function emitViewport() {
    if (opts.on_viewport_change) {
      opts.on_viewport_change({
        x: rect.x0,
        y: rect.y0,
        width: rect.x1 - rect.x0 + 1,
        height: rect.y1 - rect.y0 + 1
        // Pan is read directly from camera by DOM renderer
      });
    }
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

  // Check if a cell can be edited (inside selection or no selection active, and layer not locked)
  function canEditCell(x: number, y: number): boolean {
    // Check if current layer is locked
    const selectedZ = opts.get_selected_z();
    const layer = getSpace().layers.get(selectedZ);
    if (layer?.locked) return false;
    
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
  function trackChange(x: number, y: number, oldCell: GridCell, newCell: GridCell): void {
    const world = opts.get_world_point_for_grid?.(x, y) ?? { x, y, z: opts.get_selected_z() };
    const existingIndex = pending_changes.findIndex(c => c.worldX === world.x && c.worldY === world.y && c.worldZ === world.z);
    if (existingIndex >= 0 && pending_changes[existingIndex]) {
      // Update newCell but keep original oldCell
      pending_changes[existingIndex].newCell = newCell;
    } else {
      pending_changes.push({ x, y, worldX: world.x, worldY: world.y, worldZ: world.z, oldCell: { ...oldCell }, newCell: { ...newCell } });
    }
    
    // Also add to batch if batching
    if (is_drawing_batch) {
      addToBatch(opts.history, { x, y, worldX: world.x, worldY: world.y, worldZ: world.z, oldCell, newCell });
    }
  }

  function makeEmptyCell(): GridCell {
    return { char: ' ', rgb: { r: 0, g: 0, b: 0 }, weight_index: 0 };
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

  function trackWorldChange(world: { x: number; y: number; z: number }, oldCell: GridCell | null, newCell: GridCell | null): void {
    const gridPoint = opts.get_grid_point_for_world?.(world);
    const x = gridPoint?.x ?? -1;
    const y = gridPoint?.y ?? -1;
    const normalizedOld = oldCell ? { ...oldCell } : makeEmptyCell();
    const normalizedNew = newCell ? { ...newCell } : makeEmptyCell();
    const existingIndex = pending_changes.findIndex(c => c.worldX === world.x && c.worldY === world.y && c.worldZ === world.z);
    if (existingIndex >= 0 && pending_changes[existingIndex]) {
      pending_changes[existingIndex].newCell = normalizedNew;
    } else {
      pending_changes.push({ x, y, worldX: world.x, worldY: world.y, worldZ: world.z, oldCell: normalizedOld, newCell: normalizedNew });
    }
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
    if ((is_drawing || is_erasing || is_weighing || is_coloring) && pending_changes.length > 0) {
      const selected_z = opts.get_selected_z();
      let tool_name = 'Draw';
      let action_type: 'draw_cells' | 'erase_cells' = 'draw_cells';
      if (is_erasing) {
        tool_name = 'Erase';
        action_type = 'erase_cells';
      } else if (is_weighing) {
        tool_name = 'Apply Weight';
      } else if (is_coloring) {
        tool_name = 'Apply Color';
      }
      logCellAction(opts.history, action_type, tool_name, selected_z, pending_changes);
      pending_changes = [];
      opts.on_push_snapshot();
    }
    if (text_mode_active && pending_changes.length > 0) {
      const selected_z = opts.get_selected_z();
      logCellAction(opts.history, 'draw_cells', `Type Text`, selected_z, pending_changes);
      pending_changes = [];
      opts.on_push_snapshot();
    }
    is_drawing = false;
    is_erasing = false;
    is_weighing = false;
    is_coloring = false;
    drag_start = null;
    last_draw_pos = null;
    opts.preview_points.length = 0;
    drag_start_buttons = 0;
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

  function formatSelectionVolumeLabel(width: number, height: number, depthMin?: number | null, depthMax?: number | null): string {
    const safeMin = typeof depthMin === 'number' ? depthMin : 0;
    const safeMax = typeof depthMax === 'number' ? depthMax : safeMin;
    const depth = Math.abs(safeMax - safeMin) + 1;
    return `Selecting: ${width}x${height}x${depth} Z:${safeMin}->${safeMax}`;
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
              trackChange(draw_x, draw_y, oldCell, newCell);
            }
          }
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
              trackChange(draw_x, draw_y, oldCell, newCell);
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
              trackChange(draw_x, draw_y, oldCell, newCell);
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
    getInteractionAnchor: () => PainterInteractionAnchor;
    finalizePendingChanges: () => void;
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
      opts.on_selection_change?.({ kind: 'clear' });
    },
    selectAll: () => {
      selectAll(selection_bitmap);
      opts.on_selection_change?.({ kind: 'select_all' });
    },
    invertSelection: () => {
      invertSelection(selection_bitmap);
      opts.on_selection_change?.({ kind: 'invert' });
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

    getInteractionAnchor: () => getInteractionAnchor(),

    finalizePendingChanges: () => finalizePendingChanges(),

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
      const space = getSpace();

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
      const visibleLayers = getVisibleLayers(space).sort((a, b) => a.z - b.z);
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

      // Draw selection as an animated checkerboard overlay on the focused projected slice.
      if (hasSelection(selection_bitmap) || (opts.get_selection_overlay_cells?.().length ?? 0) > 0) {
        const checker_phase = Math.floor(performance.now() / 400) % 2;
        const checker_dark = get_darkest_indexed_rgb();
        const checker_light = get_brightest_indexed_rgb();
        const overlayCells = opts.get_selection_overlay_cells?.() ?? [];
        const overlayOccupied = new Set<string>();

        for (const overlay of overlayCells) {
          const canvas_x = rect.x0 + overlay.x;
          const canvas_y = rect.y0 + overlay.y;
          if (canvas_x < rect.x0 || canvas_x > rect.x1 || canvas_y < rect.y0 || canvas_y > rect.y1) continue;
          overlayOccupied.add(`${overlay.x},${overlay.y}`);
          const checker_is_light = ((overlay.x + overlay.y + checker_phase) % 2) === 0;
          const checker_rgb = checker_is_light ? checker_light : checker_dark;
          c.set(canvas_x, canvas_y, {
            char: overlay.char,
            rgb: checker_rgb,
            style: 'regular',
            weight_index: overlay.weight_index || 1,
            render_index: 2,
          });
        }

        for (let gy = start_y; gy < end_y; gy++) {
          for (let gx = start_x; gx < end_x; gx++) {
            if (!isSelected(selection_bitmap, gx, gy)) continue;

            const canvas_x = rect.x0 + (gx - start_x);
            const canvas_y = rect.y0 + (gy - start_y);

            if (canvas_x < rect.x0 || canvas_x > rect.x1 ||
                canvas_y < rect.y0 || canvas_y > rect.y1) continue;

            const checker_is_light = ((gx + gy + checker_phase) % 2) === 0;
            const checker_rgb = checker_is_light ? checker_light : checker_dark;
            const cell = getCell(opts.grid, gx, gy);
            const is_empty = !cell || cell.char === ' ';

            if (is_empty && !overlayOccupied.has(`${gx},${gy}`)) {
              c.set(canvas_x, canvas_y, {
                char: '•',
                rgb: checker_rgb,
                style: 'regular',
                weight_index: 1,
                render_index: 2,
              });
            }
          }
        }
      }

      // Draw paste preview - shows exactly what will be pasted (with ignore filters applied)
      if (paste_preview_data && paste_preview_pos) {
        const space_replace = opts.get_paste_space_replace();
        const ignore_space = opts.get_paste_ignore_space();
        const ignore_black = opts.get_paste_ignore_black();
        const ignore_white = opts.get_paste_ignore_white();
        const ignore_color = opts.get_paste_ignore_color();
        const ignore_color_rgb = opts.get_paste_ignore_color_rgb();
        
        for (let y = 0; y < paste_preview_data.height; y++) {
          for (let x = 0; x < paste_preview_data.width; x++) {
            const paste_cell = paste_preview_data.cells[y]?.[x];
            
            const grid_x = paste_preview_pos.x + x;
            const grid_y = paste_preview_pos.y + y;
            
            if (grid_x < start_x || grid_x >= end_x || grid_y < start_y || grid_y >= end_y) continue;
            
            const canvas_x = rect.x0 + (grid_x - start_x);
            const canvas_y = rect.y0 + (grid_y - start_y);
            
            let char: string;
            let rgb: { r: number; g: number; b: number };
            let weight: number;
            let should_show_paste = false;
            
            // Check if this cell should be ignored
            let is_ignored = false;
            
            // Check ignore space (null/undefined cells represent spaces in copy data)
            if (ignore_space && (!paste_cell || paste_cell.char === ' ')) {
              is_ignored = true;
            }
            
            if (paste_cell && !is_ignored) {
              // Check ignore black (only pure black RGB 0,0,0)
              if (ignore_black) {
                if (paste_cell.rgb.r === 0 && paste_cell.rgb.g === 0 && paste_cell.rgb.b === 0) {
                  is_ignored = true;
                }
              }
              
              // Check ignore white (only pure white RGB 255,255,255)
              if (!is_ignored && ignore_white) {
                if (paste_cell.rgb.r === 255 && paste_cell.rgb.g === 255 && paste_cell.rgb.b === 255) {
                  is_ignored = true;
                }
              }
              
              // Check ignore color
              if (!is_ignored && ignore_color) {
                const colorThreshold = 30;
                const rDiff = Math.abs(paste_cell.rgb.r - ignore_color_rgb.r);
                const gDiff = Math.abs(paste_cell.rgb.g - ignore_color_rgb.g);
                const bDiff = Math.abs(paste_cell.rgb.b - ignore_color_rgb.b);
                if (rDiff <= colorThreshold && gDiff <= colorThreshold && bDiff <= colorThreshold) {
                  is_ignored = true;
                }
              }
            }
            
            if (is_ignored) {
              // Ignored - show underlying cell
              const underlying = getCell(opts.grid, grid_x, grid_y);
              char = underlying?.char ?? ' ';
              rgb = underlying?.rgb ?? { r: 0, g: 0, b: 0 };
              weight = underlying?.weight_index ?? 0;
              should_show_paste = false;
            } else if (paste_cell && paste_cell.char !== ' ') {
              // Show the paste cell
              char = paste_cell.char;
              rgb = paste_cell.rgb;
              weight = paste_cell.weight_index;
              should_show_paste = true;
            } else if (space_replace) {
              // Space with replace mode: show space
              char = ' ';
              rgb = { r: 0, g: 0, b: 0 };
              weight = 0;
              should_show_paste = true;
            } else {
              // Space with preserve mode: show underlying cell
              const underlying = getCell(opts.grid, grid_x, grid_y);
              char = underlying?.char ?? ' ';
              rgb = underlying?.rgb ?? { r: 0, g: 0, b: 0 };
              weight = underlying?.weight_index ?? 0;
              should_show_paste = false;
            }
            
            // Flash effect for preview
            // Use high render_index (200) to ensure paste preview appears ABOVE all layers
            // Layers use render_index = layerZ + 10, so minimum is 10, maximum depends on layer count
            if (flash_state === 1 || !should_show_paste) {
              c.set(canvas_x, canvas_y, {
                char: char,
                rgb: rgb,
                style: 'regular',
                weight_index: weight,
                render_index: 200
              });
            }
          }
        }
      }

      // Draw preview points for line/rect/select/lasso tools
      if (opts.preview_points.length > 0) {
        const is_selection_preview = is_selecting || is_lasso_selecting;
        const preview_brush = getPreviewBrush();
        const preview_color = is_selection_preview 
          ? get_color_by_name('vivid_yellow').rgb 
          : preview_brush.rgb;
        const preview_char = is_selection_preview ? '▫' : preview_brush.char;
        for (const point of opts.preview_points) {
          const canvas_x = rect.x0 + (point.x - start_x);
          const canvas_y = rect.y0 + (point.y - start_y);
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
      if (paste_preview_world_data && paste_preview_world_anchor) {
        const previewWorldData: WorldCopyData = paste_preview_world_data as WorldCopyData;
        const previewWorldAnchor: { x: number; y: number; z: number } = paste_preview_world_anchor as { x: number; y: number; z: number };
        for (const entry of previewWorldData.cells) {
          const cell = entry.cell;
          const world = {
            x: previewWorldAnchor.x + entry.dx,
            y: previewWorldAnchor.y + entry.dy,
            z: previewWorldAnchor.z + entry.dz,
          };
          const gridPoint = opts.get_grid_point_for_world?.(world);
          if (!gridPoint) continue;
          const canvas_x = rect.x0 + gridPoint.x;
          const canvas_y = rect.y0 + gridPoint.y;
          if (canvas_x < rect.x0 || canvas_x > rect.x1 || canvas_y < rect.y0 || canvas_y > rect.y1) continue;
          c.set(canvas_x, canvas_y, {
            char: cell?.char ?? '•',
            rgb: cell?.rgb ?? get_color_by_name('vivid_cyan').rgb,
            style: 'regular',
            weight_index: cell?.weight_index ?? 1,
            render_index: 2,
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
        const camera = getSpace().camera;
        view_start = { x: camera.pan_x ?? 0, y: camera.pan_y ?? 0 };
        return;
      }

      const tool_for_button = e.button === 2 ? opts.get_right_click_tool() : opts.get_left_click_tool();

      if (text_mode_active) {
        if (tool_for_button === 'text') {
          moveTextCursorTo(grid_x, grid_y);
          if (text_current_line === 0) {
            text_start_x = text_cursor_x;
            text_start_world = text_cursor_world ? { ...text_cursor_world } : null;
            text_line_start_worlds[0] = cloneWorldPoint(text_start_world) ?? getTextCurrentWorld();
            text_line_end_worlds[0] = cloneWorldPoint(text_start_world) ?? getTextCurrentWorld();
          }
          return;
        }
        exitTextMode(true);
      }

      // Handle paste tool
      if (tool_for_button === 'paste') {
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
            console.log('Image pasted from clipboard:', imageData.width, 'x', imageData.height);
            const scaledData = scale !== 1.0 ? scaleCopyData(imageData, scale) : imageData;
            paste_preview_data = scaledData;
            paste_preview_world_data = null;
            paste_preview_world_anchor = null;
            // Center the paste on the cursor
            paste_preview_pos = { 
              x: grid_x - Math.floor(scaledData.width / 2), 
              y: grid_y - Math.floor(scaledData.height / 2) 
            };
            showStatus(`Image paste: ${scaledData.width}x${scaledData.height} @ ${Math.round(scale * 100)}% - Click to place`);
          } else {
            // No image, try text clipboard
            Promise.resolve(opts.get_clipboard_data?.()).then(clipboard => {
              console.log('Paste tool clicked, clipboard data:', clipboard ? 'exists' : 'empty');
              if (clipboard) {
                const worldData = decode_world_copy_data(clipboard);
                if (worldData) {
                  paste_preview_world_data = worldData;
                  paste_preview_world_anchor = opts.get_world_point_for_grid?.(grid_x, grid_y) ?? { x: grid_x, y: grid_y, z: opts.get_selected_z() };
                  opts.set_world_copy_data?.(clipboard);
                  showStatus(`3D paste preview: ${worldData.cells.length} voxels - Click to place`);
                  return;
                }
                // Try to decode special format first
                console.log('Decoding clipboard data, first 200 chars:', clipboard.substring(0, 200));
                const specialData = decodeFromSpecialFormat(clipboard);
                if (specialData) {
                  // Special format with colors/weights - apply scaling
                  console.log(`Decoded special format: ${specialData.width}x${specialData.height}`);
                  // Debug: Show first few cells
                  for (let y = 0; y < Math.min(3, specialData.height); y++) {
                    for (let x = 0; x < Math.min(5, specialData.width); x++) {
                      const cell = specialData.cells[y]?.[x];
                      if (cell) {
                        console.log(`  Cell[${y}][${x}]: char='${cell.char}', rgb=(${cell.rgb.r},${cell.rgb.g},${cell.rgb.b}), weight=${cell.weight_index}`);
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
                  showStatus(`Paste preview: ${textData.width}x${textData.height} @ ${Math.round(scale * 100)}% - Click to place`);
                }
              } else {
                showStatus('Clipboard empty! Copy something first.');
              }
            }).catch(err => {
              console.error('Failed to read clipboard:', err);
              showStatus('Failed to read clipboard!');
            });
          }
        }).catch(err => {
          console.error('Failed to paste image:', err);
          showStatus('Failed to read image from clipboard!');
        });
        return;
      }

      if (e.button === 0 || e.button === 2) {
        if (grid_x < 0 || grid_x >= opts.grid.width || grid_y < 0 || grid_y >= opts.grid.height) return;

        if (tool_for_button === 'eyedropper') {
          const cell = sampleCell(opts.grid, grid_x, grid_y);
          if (cell) {
            opts.on_sample_cell(cell, e.button);
          }
          return;
        }

        if (tool_for_button === 'bucket') {
          if (canEditCell(grid_x, grid_y)) {
            // Capture full grid before fill (bucket can affect large areas)
            const beforeRegion = captureRegion(0, 0, opts.grid.width - 1, opts.grid.height - 1);
            
            // Apply bucket fill
            applyTool(opts.grid, 'bucket', grid_x, grid_y, getBrushForButton(e.button));
            
            // Diff and track changes
            diffRegion(beforeRegion, 0, 0, opts.grid.width - 1, opts.grid.height - 1);
            
            // Log the action
            if (pending_changes.length > 0) {
              const selected_z = opts.get_selected_z();
              logCellAction(opts.history, 'draw_cells', `Fill`, selected_z, pending_changes);
              pending_changes = [];
              opts.on_push_snapshot();
            }
          }
          return;
        }

        if (tool_for_button === 'text') {
          text_mode_active = false;
          text_mode_active = true;
          moveTextCursorTo(grid_x, grid_y);
          text_start_x = text_cursor_x;
          text_start_world = text_cursor_world ? { ...text_cursor_world } : null;
          text_current_line = 0;
          text_line_start_worlds = [cloneWorldPoint(text_start_world) ?? getTextCurrentWorld()].filter((value): value is { x: number; y: number; z: number } => value !== null);
          text_line_end_worlds = [cloneWorldPoint(text_start_world) ?? getTextCurrentWorld()].filter((value): value is { x: number; y: number; z: number } => value !== null);
          return;
        }

        if (tool_for_button === 'pencil') {
          is_drawing = true;
          last_draw_pos = { x: grid_x, y: grid_y };
          drawWithBrushSize(grid_x, grid_y, false, getBrushForButton(e.button), getBrushSizeForButton(e.button));
          return;
        }

        if (tool_for_button === 'eraser') {
          is_erasing = true;
          last_draw_pos = { x: grid_x, y: grid_y };
          drawWithBrushSize(grid_x, grid_y, true, getBrushForButton(e.button), getBrushSizeForButton(e.button));
          return;
        }

        // Weighter tool - changes only the weight of existing characters
        if (tool_for_button === 'weighter') {
          is_weighing = true;
          last_draw_pos = { x: grid_x, y: grid_y };
          const brush = getBrushForButton(e.button);
          applyWeightWithBrushSize(grid_x, grid_y, brush.weight_index, getBrushSizeForButton(e.button));
          return;
        }

        // Colorer tool - changes only the color of existing characters
        if (tool_for_button === 'colorer') {
          is_coloring = true;
          last_draw_pos = { x: grid_x, y: grid_y };
          const brush = getBrushForButton(e.button);
          applyColorWithBrushSize(grid_x, grid_y, brush.rgb, getBrushSizeForButton(e.button));
          return;
        }

        // Selection tool (rectangular)
        if (tool_for_button === 'selectangle') {
          is_selecting = true;
          selection_drag_start = { x: grid_x, y: grid_y };
          selection_drag_start_plane = opts.get_focus_world_plane?.() ?? opts.get_selected_z();
          selection_drag_end_plane = selection_drag_start_plane;
          showStatus('Selection: drag to select area');
          return;
        }

        // Lasso selection tool (freehand)
        if (tool_for_button === 'lassoselect') {
          is_lasso_selecting = true;
          lasso_points = [{ x: grid_x, y: grid_y }];
          showStatus('Lasso: drag to draw selection area');
          return;
        }

        // Copy tool - copy current selection
        if (tool_for_button === 'copy') {
          copyCurrentSelection();
          return;
        }

        if (tool_for_button === 'line' || tool_for_button.startsWith('rect_')) {
          is_drawing = true;
          drag_start = { x: grid_x, y: grid_y };
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

      if (is_erasing && last_draw_pos) {
        const grid_coords = localToGrid(local_x, local_y);
        const grid_x = grid_coords.x;
        const grid_y = grid_coords.y;
        if (grid_x < 0 || grid_x >= opts.grid.width || grid_y < 0 || grid_y >= opts.grid.height) return;
        if (grid_x !== last_draw_pos.x || grid_y !== last_draw_pos.y) {
          drawLineWithBrushSize(last_draw_pos.x, last_draw_pos.y, grid_x, grid_y, true, getBrushForButton(getDragButton()), getBrushSizeForButton(getDragButton()));
          last_draw_pos = { x: grid_x, y: grid_y };
        }
        return;
      }

      if (is_drawing && last_draw_pos) {
        const grid_coords = localToGrid(local_x, local_y);
        const grid_x = grid_coords.x;
        const grid_y = grid_coords.y;
        if (grid_x < 0 || grid_x >= opts.grid.width || grid_y < 0 || grid_y >= opts.grid.height) return;
        if (grid_x !== last_draw_pos.x || grid_y !== last_draw_pos.y) {
          drawLineWithBrushSize(last_draw_pos.x, last_draw_pos.y, grid_x, grid_y, false, getBrushForButton(getDragButton()), getBrushSizeForButton(getDragButton()));
          last_draw_pos = { x: grid_x, y: grid_y };
        }
        return;
      }

      // Weighter tool - drag to apply weight with brush size
      if (is_weighing && last_draw_pos) {
        const grid_coords = localToGrid(local_x, local_y);
        const grid_x = grid_coords.x;
        const grid_y = grid_coords.y;
        if (grid_x < 0 || grid_x >= opts.grid.width || grid_y < 0 || grid_y >= opts.grid.height) return;
        if (grid_x !== last_draw_pos.x || grid_y !== last_draw_pos.y) {
          const brush = getBrushForButton(getDragButton());
          applyWeightWithBrushSize(grid_x, grid_y, brush.weight_index, getBrushSizeForButton(getDragButton()));
          last_draw_pos = { x: grid_x, y: grid_y };
        }
        return;
      }

      // Colorer tool - drag to apply color with brush size
      if (is_coloring && last_draw_pos) {
        const grid_coords = localToGrid(local_x, local_y);
        const grid_x = grid_coords.x;
        const grid_y = grid_coords.y;
        if (grid_x < 0 || grid_x >= opts.grid.width || grid_y < 0 || grid_y >= opts.grid.height) return;
        if (grid_x !== last_draw_pos.x || grid_y !== last_draw_pos.y) {
          const brush = getBrushForButton(getDragButton());
          applyColorWithBrushSize(grid_x, grid_y, brush.rgb, getBrushSizeForButton(getDragButton()));
          last_draw_pos = { x: grid_x, y: grid_y };
        }
        return;
      }

      // Selection preview - use distinctive dashed pattern
      if (is_selecting && selection_drag_start) {
        const grid_coords = localToGrid(local_x, local_y);
        const grid_x = grid_coords.x;
        const grid_y = grid_coords.y;
        // Show preview rect
        const new_points = previewRectStroke(selection_drag_start.x, selection_drag_start.y, grid_x, grid_y);
        opts.preview_points.length = 0;
        opts.preview_points.push(...new_points);
        // Also show status while dragging
        const width = Math.abs(grid_x - selection_drag_start.x) + 1;
        const height = Math.abs(grid_y - selection_drag_start.y) + 1;
        const range = getSelectionPlaneRange();
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

      if (is_drawing && drag_start) {
        const current_coords = localToGrid(local_x, local_y);
        const current_x = current_coords.x;
        const current_y = current_coords.y;
        const tool_for_drag = (drag_start_buttons & 2) ? opts.get_right_click_tool() : opts.get_left_click_tool();
        let new_points: { x: number; y: number }[] = [];
        if (tool_for_drag === 'line') {
          new_points = previewLine(drag_start.x, drag_start.y, current_x, current_y);
        } else if (tool_for_drag === 'rect_stroke') {
          new_points = previewRectStroke(drag_start.x, drag_start.y, current_x, current_y);
        } else if (tool_for_drag === 'rect_fill') {
          new_points = previewRectFill(drag_start.x, drag_start.y, current_x, current_y);
        }
        if (new_points.length > 0) {
          opts.preview_points.length = 0;
          opts.preview_points.push(...new_points);
        }
      }

      // Paste preview follows mouse
      if (opts.get_current_tool() === 'paste' && paste_preview_data) {
        const grid_coords = localToGrid(local_x, local_y);
        paste_preview_pos = { x: grid_coords.x, y: grid_coords.y };
      } else if (opts.get_current_tool() === 'paste' && paste_preview_world_data) {
        const grid_coords = localToGrid(local_x, local_y);
        paste_preview_world_anchor = opts.get_world_point_for_grid?.(grid_coords.x, grid_coords.y) ?? { x: grid_coords.x, y: grid_coords.y, z: opts.get_selected_z() };
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
        const start_x = selection_drag_start.x;
        const start_y = selection_drag_start.y;
        
        // Create temporary selection bitmap for the new rect
        const temp_bitmap = createSelectionBitmap(opts.grid.width, opts.grid.height);
        selectRect(temp_bitmap, start_x, start_y, end_x, end_y);
        
        // Apply selection mode
        applySelectionMode(selection_bitmap, temp_bitmap, opts.get_selection_mode());
        
        const width = Math.abs(end_x - start_x) + 1;
        const height = Math.abs(end_y - start_y) + 1;
        
        const range = getSelectionPlaneRange();
        showStatus(formatSelectionVolumeLabel(width, height, range?.depthMin, range?.depthMax).replace('Selecting:', 'Selected'));
        console.log(`[PainterSelection] rect commit ${width}x${height} Z:${range?.depthMin ?? 0}->${range?.depthMax ?? range?.depthMin ?? 0} mode=${opts.get_selection_mode()}`);
        
        is_selecting = false;
        selection_drag_start = null;
        selection_drag_start_plane = null;
        selection_drag_end_plane = null;
        opts.preview_points = [];
        opts.on_selection_change?.({ depthMin: range?.depthMin, depthMax: range?.depthMax, kind: 'rect' });
        drag_start_buttons = 0;
        return;
      }

      // Lasso selection finalization
      if (is_lasso_selecting && lasso_points.length >= 3) {
        console.log('Lasso drag end, points:', lasso_points.length);
        
        // Create temporary selection bitmap for the lasso polygon
        const temp_bitmap = createSelectionBitmap(opts.grid.width, opts.grid.height);
        selectPolygon(temp_bitmap, lasso_points);
        
        // Apply selection mode
        applySelectionMode(selection_bitmap, temp_bitmap, opts.get_selection_mode());
        
        let selectedCount = 0;
        for (let y = 0; y < opts.grid.height; y++) {
          for (let x = 0; x < opts.grid.width; x++) {
            if (isSelected(selection_bitmap, x, y)) selectedCount++;
          }
        }
        
        showStatus(`Lasso selected ${selectedCount} cells`);
        
        is_lasso_selecting = false;
        lasso_points = [];
        opts.preview_points = [];
        opts.on_selection_change?.();
        drag_start_buttons = 0;
        return;
      }

      if (!is_drawing && !is_erasing) {
        drag_start_buttons = 0;
        return;
      }

      const tool_for_end = (drag_start_buttons & 2) ? opts.get_right_click_tool() : opts.get_left_click_tool();
      if ((tool_for_end === 'line' || tool_for_end.startsWith('rect_')) && drag_start) {
        const local_x = e.x - rect.x0;
        const local_y = e.y - rect.y0;
        const grid_coords = localToGrid(local_x, local_y);
        const end_x = grid_coords.x;
        const end_y = grid_coords.y;
        const start_x = drag_start.x;
        const start_y = drag_start.y;
        
        // Capture region before applying tool
        const minX = Math.min(start_x, end_x);
        const maxX = Math.max(start_x, end_x);
        const minY = Math.min(start_y, end_y);
        const maxY = Math.max(start_y, end_y);
        const beforeRegion = captureRegion(minX, minY, maxX, maxY);
        
        // Apply the tool
        applyTool(opts.grid, tool_for_end, end_x, end_y, getBrushForButton(getDragButton()), drag_start);
        
        // Diff and track changes
        diffRegion(beforeRegion, minX, minY, maxX, maxY);
        
        // Log the action
        if (pending_changes.length > 0) {
          const selected_z = opts.get_selected_z();
          const toolName = tool_for_end === 'line' ? 'Draw Line' : 
                          tool_for_end === 'rect_stroke' ? 'Draw Rectangle (stroke)' : 
                          'Draw Rectangle (fill)';
          logCellAction(opts.history, 'draw_cells', toolName, selected_z, pending_changes);
          pending_changes = [];
          opts.on_push_snapshot();
        }
      }

      is_drawing = false;
      is_erasing = false;
      is_weighing = false;
      is_coloring = false;
      drag_start = null;
      last_draw_pos = null;
      opts.preview_points = [];
      drag_start_buttons = 0;
    },

    OnPointerUp(e: PointerEvent): void {
      if (opts.get_current_tool() === 'paste' && paste_preview_world_data && paste_preview_world_anchor) {
        const spaceReplace = opts.get_paste_space_replace();
        const ignoreColorRgb = opts.get_paste_ignore_color_rgb();
        let placed = 0;
        let cleared = 0;
        let preserved = 0;
        let skippedIgnored = 0;
        const createdLayers = new Set<number>();
        let minPasteZ = Number.POSITIVE_INFINITY;
        let maxPasteZ = Number.NEGATIVE_INFINITY;
        for (const entry of paste_preview_world_data.cells) {
          const world = {
            x: paste_preview_world_anchor.x + entry.dx,
            y: paste_preview_world_anchor.y + entry.dy,
            z: paste_preview_world_anchor.z + entry.dz,
          };
          minPasteZ = Math.min(minPasteZ, world.z);
          maxPasteZ = Math.max(maxPasteZ, world.z);
          const oldCell = getVoxel(getSpace(), world.x, world.y, world.z);
          const isIgnored = isIgnoredPasteCell(entry.cell, ignoreColorRgb);
          if (isIgnored) {
            skippedIgnored++;
            preserved++;
          } else if (entry.cell && entry.cell.char !== ' ') {
            if (!getSpace().layers.has(world.z)) createdLayers.add(world.z);
            getOrCreateLayer(getSpace(), world.z);
            if (setVoxel(getSpace(), world.x, world.y, world.z, { ...entry.cell })) {
              trackWorldChange(world, oldCell, entry.cell);
              placed++;
            } else {
              preserved++;
            }
          } else if (spaceReplace) {
            const clearedCell = makeEmptyCell();
            if (!getSpace().layers.has(world.z)) createdLayers.add(world.z);
            getOrCreateLayer(getSpace(), world.z);
            if (setVoxel(getSpace(), world.x, world.y, world.z, clearedCell)) {
              trackWorldChange(world, oldCell, clearedCell);
              cleared++;
            } else {
              preserved++;
            }
          } else {
            preserved++;
          }
        }
        if (pending_changes.length > 0) {
          const selected_z = opts.get_selected_z();
          logCellAction(opts.history, 'draw_cells', `Paste`, selected_z, pending_changes);
          pending_changes = [];
          opts.on_push_snapshot();
        }
        const zLabel = Number.isFinite(minPasteZ) && Number.isFinite(maxPasteZ) ? ` Z:${minPasteZ}->${maxPasteZ}` : '';
        showStatus(`Pasted 3D (${placed} placed, ${skippedIgnored} ignored, ${preserved} preserved, ${cleared} cleared, ${createdLayers.size} layers created${zLabel})`);
        paste_preview_world_data = null;
        paste_preview_world_anchor = null;
        return;
      }

      // Handle paste placement
      if (opts.get_current_tool() === 'paste' && paste_preview_data && paste_preview_pos) {
        // Check if current layer is locked
        const selectedZ = opts.get_selected_z();
        const layer = getSpace().layers.get(selectedZ);
        if (layer?.locked) {
          showStatus('Cannot paste: layer is locked');
          return;
        }
        
        const spaceReplace = opts.get_paste_space_replace();
        const ignoreSpace = opts.get_paste_ignore_space();
        const ignoreBlack = opts.get_paste_ignore_black();
        const ignoreWhite = opts.get_paste_ignore_white();
        const ignoreColor = opts.get_paste_ignore_color();
        const ignoreColorRgb = opts.get_paste_ignore_color_rgb();
        
        console.log('Paste: spaceReplace =', spaceReplace, 'ignoreSpace =', ignoreSpace, 'ignoreBlack =', ignoreBlack, 'ignoreWhite =', ignoreWhite, 'ignoreColor =', ignoreColor);
        
        // Build ignore status message
        const ignoredParts: string[] = [];
        if (ignoreSpace) ignoredParts.push('spaces');
        if (ignoreBlack) ignoredParts.push('black');
        if (ignoreWhite) ignoredParts.push('white');
        if (ignoreColor) ignoredParts.push('color');
        const ignoreStatus = ignoredParts.length > 0 ? ignoredParts.join('+') : 'none';
        
        // Custom paste with ignore support - ignored cells preserve underlying content
        let placed = 0;
        let preserved = 0;
        let cleared = 0;
        let skippedIgnored = 0;
        
        // Debug: Log first few cells of paste data
        console.log('Paste data sample (first 3 rows):');
        for (let y = 0; y < Math.min(3, paste_preview_data.height); y++) {
          let row = '';
          for (let x = 0; x < Math.min(10, paste_preview_data.width); x++) {
            const cell = paste_preview_data.cells[y]?.[x];
            row += cell ? cell.char : '?';
          }
          console.log(`  Row ${y}: "${row}"`);
        }
        
        for (let y = 0; y < paste_preview_data.height; y++) {
          for (let x = 0; x < paste_preview_data.width; x++) {
            const cell = paste_preview_data.cells[y]?.[x];
            const targetX = paste_preview_pos.x + x;
            const targetY = paste_preview_pos.y + y;
            
            // Debug first cell
            if (y === 0 && x === 0 && cell) {
              console.log(`First cell being pasted: char='${cell.char}', rgb=(${cell.rgb.r},${cell.rgb.g},${cell.rgb.b}), weight=${cell.weight_index}`);
            }
            
            // Check bounds
            if (targetX < 0 || targetX >= opts.grid.width || targetY < 0 || targetY >= opts.grid.height) {
              continue;
            }
            
            // Check if this cell should be ignored
            let isIgnored = false;
            
            // Check ignore space (null/undefined cells represent spaces in copy data)
            if (ignoreSpace && (!cell || cell.char === ' ')) {
              isIgnored = true;
            }
            
            if (cell && !isIgnored) {
              // Check ignore black (only pure black RGB 0,0,0)
              if (ignoreBlack) {
                if (cell.rgb.r === 0 && cell.rgb.g === 0 && cell.rgb.b === 0) {
                  isIgnored = true;
                }
              }
              
              // Check ignore white (only pure white RGB 255,255,255)
              if (!isIgnored && ignoreWhite) {
                if (cell.rgb.r === 255 && cell.rgb.g === 255 && cell.rgb.b === 255) {
                  isIgnored = true;
                }
              }
              
              // Check ignore color
              if (!isIgnored && ignoreColor) {
                const colorThreshold = 30;
                const rDiff = Math.abs(cell.rgb.r - ignoreColorRgb.r);
                const gDiff = Math.abs(cell.rgb.g - ignoreColorRgb.g);
                const bDiff = Math.abs(cell.rgb.b - ignoreColorRgb.b);
                if (rDiff <= colorThreshold && gDiff <= colorThreshold && bDiff <= colorThreshold) {
                  isIgnored = true;
                }
              }
            }
            
            // Handle the cell
            if (isIgnored) {
              // Ignored cells always preserve underlying content
              skippedIgnored++;
              preserved++;
            } else if (cell && cell.char !== ' ') {
              // Non-space cell: place it
              const oldCell = getGridCell(targetX, targetY);
              opts.grid.cells[targetY]![targetX] = { ...cell };
              const newCell = getGridCell(targetX, targetY);
              if (oldCell && newCell) {
                trackChange(targetX, targetY, oldCell, newCell);
              }
              placed++;
            } else {
              // Space/empty cell: handle based on spaceReplace
              if (spaceReplace) {
                const oldCell = getGridCell(targetX, targetY);
                opts.grid.cells[targetY]![targetX] = {
                  char: ' ',
                  rgb: { r: 0, g: 0, b: 0 },
                  weight_index: 0
                };
                const newCell = getGridCell(targetX, targetY);
                if (oldCell && newCell) {
                  trackChange(targetX, targetY, oldCell, newCell);
                }
                cleared++;
              } else {
                preserved++;
              }
            }
          }
        }
        
        // Log the paste action
        if (pending_changes.length > 0) {
          const selected_z = opts.get_selected_z();
          logCellAction(opts.history, 'draw_cells', `Paste`, selected_z, pending_changes);
          pending_changes = [];
          opts.on_push_snapshot();
        }
        
        console.log(`Paste complete: ${placed} placed, ${skippedIgnored} ignored (preserved), ${cleared} cleared, ${preserved} preserved`);
        showStatus(`Pasted ${paste_preview_data.width}x${paste_preview_data.height} (placed:${placed}, ignored:${skippedIgnored}, preserved:${preserved}, cleared:${cleared})`);
        paste_preview_data = null;
        paste_preview_pos = null;
        return;
      }

      const tool_for_up = (drag_start_buttons & 2) ? opts.get_right_click_tool() : opts.get_left_click_tool();
      if (is_drawing && drag_start && (tool_for_up === 'line' || tool_for_up.startsWith('rect_'))) {
        const local_x = e.x - rect.x0;
        const local_y = e.y - rect.y0;
        const end_coords = localToGrid(local_x, local_y);
        const end_x = end_coords.x;
        const end_y = end_coords.y;
        const start_x = drag_start.x;
        const start_y = drag_start.y;
        
        // Capture region before applying tool
        const minX = Math.min(start_x, end_x);
        const maxX = Math.max(start_x, end_x);
        const minY = Math.min(start_y, end_y);
        const maxY = Math.max(start_y, end_y);
        const beforeRegion = captureRegion(minX, minY, maxX, maxY);
        
        // Apply the tool
        applyTool(opts.grid, tool_for_up, end_x, end_y, getBrushForButton(getDragButton()), drag_start);
        
        // Diff and track changes
        diffRegion(beforeRegion, minX, minY, maxX, maxY);
        
        // Log the action
        if (pending_changes.length > 0) {
          const selected_z = opts.get_selected_z();
          const toolName = tool_for_up === 'line' ? 'Draw Line' : 
                          tool_for_up === 'rect_stroke' ? 'Draw Rectangle (stroke)' : 
                          'Draw Rectangle (fill)';
          logCellAction(opts.history, 'draw_cells', toolName, selected_z, pending_changes);
          pending_changes = [];
          opts.on_push_snapshot();
        }
      }
      
      // Handle selection in OnPointerUp as fallback (OnDragEnd might not fire for clicks)
      if (is_selecting && selection_drag_start) {
        const local_x = e.x - rect.x0;
        const local_y = e.y - rect.y0;
        const end_coords = localToGrid(local_x, local_y);
        const end_x = end_coords.x;
        const end_y = end_coords.y;
        const start_x = selection_drag_start.x;
        const start_y = selection_drag_start.y;
        
        // Create temporary selection bitmap for the new rect
        const temp_bitmap = createSelectionBitmap(opts.grid.width, opts.grid.height);
        selectRect(temp_bitmap, start_x, start_y, end_x, end_y);
        
        // Apply selection mode
        applySelectionMode(selection_bitmap, temp_bitmap, opts.get_selection_mode());
        
        const width = Math.abs(end_x - start_x) + 1;
        const height = Math.abs(end_y - start_y) + 1;
        const range = getSelectionPlaneRange();
        showStatus(formatSelectionVolumeLabel(width, height, range?.depthMin, range?.depthMax).replace('Selecting:', 'Selected'));
        console.log(`[PainterSelection] rect fallback commit ${width}x${height} Z:${range?.depthMin ?? 0}->${range?.depthMax ?? range?.depthMin ?? 0} mode=${opts.get_selection_mode()}`);
        
        is_selecting = false;
        selection_drag_start = null;
        selection_drag_start_plane = null;
        selection_drag_end_plane = null;
        opts.preview_points = [];
        opts.on_selection_change?.({ depthMin: range?.depthMin, depthMax: range?.depthMax, kind: 'rect' });
      }
      
      // Handle lasso selection in OnPointerUp as fallback
      if (is_lasso_selecting && lasso_points.length >= 3) {
        console.log('Lasso in OnPointerUp, points:', lasso_points.length);
        
        // Create temporary selection bitmap for the lasso polygon
        const temp_bitmap = createSelectionBitmap(opts.grid.width, opts.grid.height);
        selectPolygon(temp_bitmap, lasso_points);
        
        // Apply selection mode
        applySelectionMode(selection_bitmap, temp_bitmap, opts.get_selection_mode());
        
        let selectedCount = 0;
        for (let y = 0; y < opts.grid.height; y++) {
          for (let x = 0; x < opts.grid.width; x++) {
            if (isSelected(selection_bitmap, x, y)) selectedCount++;
          }
        }
        
        showStatus(`Lasso selected ${selectedCount} cells`);
        
        is_lasso_selecting = false;
        lasso_points = [];
        opts.preview_points = [];
        opts.on_selection_change?.();
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
      if ((is_drawing || is_erasing || is_weighing || is_coloring) && pending_changes.length > 0) {
        const selected_z = opts.get_selected_z();
        let tool_name = 'Draw';
        let action_type: 'draw_cells' | 'erase_cells' = 'draw_cells';
        
        if (is_erasing) {
          tool_name = 'Erase';
          action_type = 'erase_cells';
        } else if (is_weighing) {
          tool_name = 'Apply Weight';
        } else if (is_coloring) {
          tool_name = 'Apply Color';
        }
        
        logCellAction(opts.history, action_type, tool_name, selected_z, pending_changes);
        pending_changes = [];
        opts.on_push_snapshot();
      }
      
      // Log text changes when exiting text mode via click
      if (text_mode_active && pending_changes.length > 0) {
        const selected_z = opts.get_selected_z();
        logCellAction(opts.history, 'draw_cells', `Type Text`, selected_z, pending_changes);
        pending_changes = [];
        opts.on_push_snapshot();
      }
      
      is_drawing = false;
      is_erasing = false;
      is_weighing = false;
      is_coloring = false;
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

      if (!e.shift && opts.cycle_focus_layer) {
        if (is_selecting && selection_drag_start) {
          const dir = e.delta_y < 0 ? 1 : (e.delta_y > 0 ? -1 : 0);
          if (dir !== 0) {
            opts.cycle_focus_layer(dir as 1 | -1);
            selection_drag_end_plane = opts.get_focus_world_plane?.() ?? (selection_drag_end_plane ?? opts.get_selected_z());
            const local_x = e.x - rect.x0;
            const local_y = e.y - rect.y0;
            const end_coords = localToGrid(local_x, local_y);
            const width = Math.abs(end_coords.x - selection_drag_start.x) + 1;
            const height = Math.abs(end_coords.y - selection_drag_start.y) + 1;
            const range = getSelectionPlaneRange();
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

      // Scroll updates camera pan position
      // Note: In grid coordinates, Y increases upward
      // Scroll down (delta_y > 0) = show content above = decrease pan_y
      const scroll_step = 2; // Grid cells per scroll
      if (e.shift) {
        // Horizontal scroll: right shows content to the left = increase pan_x
        panBy(e.delta_x > 0 ? scroll_step : -scroll_step, 0);
      } else {
        // Vertical scroll: down shows content above = decrease pan_y
        panBy(0, e.delta_y > 0 ? -scroll_step : scroll_step);
      }
    },

    OnKeyDown(e: KeyboardEvent): void {
      ensureGridShapeState();
      // Undo - Ctrl+Z
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        finalizePendingChanges();
        const description = undo(opts.history, getSpace());
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
        const description = redo(opts.history, getSpace());
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
        console.log('Copy shortcut detected, hasSelection:', hasSelection(selection_bitmap));
        copyCurrentSelection();
        e.preventDefault();
        return;
      }

      // Text mode handling
      if (text_mode_active) {
        syncTextCursorGridFromWorld();
        const selected_z = opts.get_selected_z();
        
        // Check if current layer is locked
        const layer = getSpace().layers.get(selected_z);
        if (layer?.locked) {
          showStatus('Cannot type: layer is locked');
          e.preventDefault();
          return;
        }
        
        if (e.key === 'Enter') {
          // Log text action before starting new line
          if (pending_changes.length > 0) {
            logCellAction(opts.history, 'draw_cells', `Type Text`, selected_z, pending_changes);
            pending_changes = [];
            opts.on_push_snapshot();
          }
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
            if (opts.get_space_replace()) {
              opts.grid.cells[text_cursor_y]![text_cursor_x] = {
                char: ' ',
                rgb: { ...text_brush.rgb },
                weight_index: text_brush.weight_index
              };
            }
            // Move cursor by spacing and charlead
            moveTextCursorByScreenDelta(opts.get_text_spacing(), opts.get_text_charlead());
            setCurrentLineEndWorld(getTextCurrentWorld());
          }
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
      space_held = false;
      is_panning = false;
      is_drawing = false;
      is_erasing = false;
      is_weighing = false;
      is_coloring = false;
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
      if (!text_mode_active || !text) return;
      syncTextCursorGridFromWorld();
      
      const selected_z = opts.get_selected_z();
      
      // Check if current layer is locked
      const layer = getSpace().layers.get(selected_z);
      if (layer?.locked) {
        showStatus('Cannot type: layer is locked');
        return;
      }
      
      for (const char of text) {
        // Handle newline characters (from paste operations) like Enter key
        if (char === '\n' || char === '\r') {
          // Log text action before starting new line
          if (pending_changes.length > 0) {
            logCellAction(opts.history, 'draw_cells', `Type Text`, selected_z, pending_changes);
            pending_changes = [];
            opts.on_push_snapshot();
          }
          
          // New line using enterlead and enterspace (same as Enter key)
          moveTextCursorToNextLine();
          
          // Check bounds after newline
          if (text_cursor_x < 0 || text_cursor_x >= opts.grid.width ||
              text_cursor_y < 0 || text_cursor_y >= opts.grid.height) {
            text_mode_active = false;
            break;
          }
          continue;
        }
        
        if (text_cursor_x >= 0 && text_cursor_x < opts.grid.width &&
            text_cursor_y >= 0 && text_cursor_y < opts.grid.height) {
          const text_brush = getPreviewBrush();
          
          // Track the change for undo
          const oldCell = getGridCell(text_cursor_x, text_cursor_y);
          
          if (char === ' ') {
            if (opts.get_space_replace()) {
              opts.grid.cells[text_cursor_y]![text_cursor_x] = {
                char: ' ',
                rgb: { ...text_brush.rgb },
                weight_index: text_brush.weight_index
              };
              const newCell = getGridCell(text_cursor_x, text_cursor_y);
              if (oldCell && newCell) {
                trackChange(text_cursor_x, text_cursor_y, oldCell, newCell);
              }
            }
          } else {
            opts.grid.cells[text_cursor_y]![text_cursor_x] = {
              char: char,
              rgb: { ...text_brush.rgb },
              weight_index: text_brush.weight_index
            };
            const newCell = getGridCell(text_cursor_x, text_cursor_y);
            if (oldCell && newCell) {
              trackChange(text_cursor_x, text_cursor_y, oldCell, newCell);
            }
          }
          
          // Move cursor according to spacing and charlead
          const spacing = opts.get_text_spacing();
          const charlead = opts.get_text_charlead();
          moveTextCursorByScreenDelta(spacing, charlead);
          setCurrentLineEndWorld(getTextCurrentWorld());
          
          // Check bounds
          if (text_cursor_x < 0 || text_cursor_x >= opts.grid.width ||
              text_cursor_y < 0 || text_cursor_y >= opts.grid.height) {
            // Log remaining text before exiting
            if (pending_changes.length > 0) {
              logCellAction(opts.history, 'draw_cells', `Type Text`, selected_z, pending_changes);
              pending_changes = [];
              opts.on_push_snapshot();
            }
            text_mode_active = false;
            break;
          }
        }
      }
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
