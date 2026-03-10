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
import { clearSelection, selectAll, invertSelection } from '../ascii_painter/selection.js';
import { make_painter_canvas_module } from '../mono_ui/modules/painter_canvas_module.js';
import { make_painter_toolbar_module } from '../mono_ui/modules/painter_toolbar_module.js';
import { make_file_menu_module } from '../mono_ui/modules/painter_file_menu_module.js';
import { make_character_selector_module } from '../mono_ui/modules/character_selector_module.js';
import { make_brush_preview_module } from '../mono_ui/modules/brush_preview_module.js';
import { make_color_selector_module } from '../mono_ui/modules/color_selector_module.js';
import { make_weight_selector_module } from '../mono_ui/modules/weight_selector_module.js';
import { make_toolbox_module } from '../mono_ui/modules/toolbox_module.js';
import { make_tool_properties_module } from '../mono_ui/modules/tool_properties_module.js';
import { saveModulePosition, getModulePosition, clearModulePositions } from '../ascii_painter/module_position_storage.js';
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
  loadCameraConfig,
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
  getVisibleLayers,
  voxelSpaceToGrid,
  gridToVoxelSpace,
  debugVoxelSpace,
  createDefaultCamera,
} from '../ascii_painter/voxel_space.js';
import { makeLayerRendererModule } from '../ascii_painter/layer_renderer_module.js';
import { makeLayerPaletteModule } from '../ascii_painter/layer_palette_module.js';
import { makeCameraControlModule } from '../ascii_painter/camera_control_module.js';
import { VoxelDOMRenderer, createVoxelDOMRenderer } from '../ascii_painter/voxel_dom_renderer.js';
import { touch_world_layers_owner } from '../mono_ui/world_layers_owner.js';

// Configuration matching the game but with relaxed letter spacing
export const PAINTER_CONFIG = {
  font_family: '"Martian Mono", "Noto Sans Mono", monospace',
  base_font_size_px: 32,
  base_line_height_mult: 29.8 / 32,
  base_letter_spacing_mult: -0.10,
  weight_index_to_css: [100, 200, 300, 400, 500, 600, 700, 800] as const,
  grid_width: 200,
  grid_height: 50,
} as const;

// Canvas dimensions (separate from grid dimensions)
const CANVAS_WIDTH = 80;
const CANVAS_HEIGHT = 40;

export type PainterAppState = {
  modules: readonly Module[];
  module_registry: ModuleRegistry;

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

export function create_painter_app_state(): PainterAppState {
  // Create the drawing grid (legacy 2D)
  const grid = createGrid(CANVAS_WIDTH, CANVAS_HEIGHT);
  
  // Create VoxelSpace (new 3D system) - wraps the grid
  let voxelSpace = createVoxelSpace(CANVAS_WIDTH, CANVAS_HEIGHT, { defaultZ: 0 });
  
  // Load saved camera configuration
  const savedCameraConfig = loadCameraConfig();
  if (savedCameraConfig && Object.keys(savedCameraConfig).length > 0) {
    voxelSpace.camera = { ...voxelSpace.camera, ...savedCameraConfig };
  }

  // Flag to prevent saving during initialization
  let isAppInitialized = false;
  // Set to true after a short delay to allow initial renders to complete
  setTimeout(() => {
    isAppInitialized = true;
  }, 500);

  // Create DOM-based voxel renderer for true off-grid rendering
  let domRenderer: VoxelDOMRenderer | null = null;
  let domRoot: HTMLElement | null = null;

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
      PAINTER_CONFIG.base_font_size_px
    );
    domRenderer.setSpace(voxelSpace);
    console.log('[Painter] DOM renderer initialized');
  }

  // Sync DOM renderer with current voxelSpace
  function syncDOMRenderer(): void {
    if (domRenderer) {
      domRenderer.setSpace(voxelSpace);
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
    voxelSpace = saved_voxel_space;
    // Re-apply saved camera config after loading auto-save (camera settings are global, not per-artwork)
    const savedCameraConfig = loadCameraConfig();
    if (savedCameraConfig && Object.keys(savedCameraConfig).length > 0) {
      voxelSpace.camera = { ...voxelSpace.camera, ...savedCameraConfig };
    }
    ensureValidFocusPlane();
    // Sync grid to current layer
    const currentLayer = getLayer(voxelSpace, voxelSpace.camera.focus_plane);
    if (currentLayer) {
      grid.width = voxelSpace.bounds.width;
      grid.height = voxelSpace.bounds.height;
      grid.cells = currentLayer.cells;
    }
    syncDOMRenderer();
    console.log('🎨 Loaded auto-saved VoxelSpace artwork');
  } else {
    // Fallback to legacy grid auto-save
    const saved_grid = loadAutoSave();
    if (saved_grid) {
      grid.width = saved_grid.width;
      grid.height = saved_grid.height;
      grid.cells = saved_grid.cells;
      // Sync voxelSpace to grid
      voxelSpace = gridToVoxelSpace(grid, 0);
      // Re-apply saved camera config after loading legacy auto-save
      const savedCameraConfig = loadCameraConfig();
      if (savedCameraConfig && Object.keys(savedCameraConfig).length > 0) {
        voxelSpace.camera = { ...voxelSpace.camera, ...savedCameraConfig };
      }
      ensureValidFocusPlane();
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
  
  // Brush state
  const brush: Brush = {
    char: '█',
    rgb: get_color_by_name('off_white').rgb,
    weight_index: 4
  };
  
  // Brush tip size (1-5, for 1x1 to 5x5)
  let brush_size = saved_tool_props.brush_size ?? 1;
  
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
  
  // Selection mode
  let selection_mode: SelectionMode = 'replace';
  
  // Clipboard for copy/paste
  let clipboard_data: string | null = null;
  
  // Preview points for line/rect tools
  let preview_points: { x: number; y: number }[] = [];

  // Current filename for save operations
  let current_filename = 'untitled';
  let current_file_path: string | null = null;
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
    voxelSpace = importVoxelSpaceFromJSON(content);

    // Apply persisted camera/UI settings (do not import from file)
    const savedCam = loadCameraConfig();
    if (savedCam && Object.keys(savedCam).length > 0) {
      voxelSpace.camera = { ...createDefaultCamera(), ...savedCam };
    }

    ensureValidFocusPlane();
    syncDOMRenderer();

    const currentLayer = getLayer(voxelSpace, voxelSpace.camera.focus_plane);
    if (currentLayer) {
      grid.width = voxelSpace.bounds.width;
      grid.height = voxelSpace.bounds.height;
      grid.cells = currentLayer.cells;
    }

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
      const savedCam = loadCameraConfig();
      if (savedCam && Object.keys(savedCam).length > 0) {
        voxelSpace.camera = { ...voxelSpace.camera, ...savedCam };
      }
      ensureValidFocusPlane();
      syncDOMRenderer();
      const currentLayer = getLayer(voxelSpace, 0);
      if (currentLayer) {
        grid.width = CANVAS_WIDTH;
        grid.height = CANVAS_HEIGHT;
        grid.cells = currentLayer.cells;
      }
      pushSnapshot(history, grid);
      current_filename = 'untitled';
      current_file_path = null;
      clearAutoSave();
      return;
    }

    const basename = makeNewFileBasename();
    const filePath = `${dir}\\${basename}`;

    voxelSpace = createVoxelSpace(CANVAS_WIDTH, CANVAS_HEIGHT, { defaultZ: 0 });
    const savedCam = loadCameraConfig();
    if (savedCam && Object.keys(savedCam).length > 0) {
      voxelSpace.camera = { ...voxelSpace.camera, ...savedCam };
    }
    ensureValidFocusPlane();
    syncDOMRenderer();

    const currentLayer = getLayer(voxelSpace, 0);
    if (currentLayer) {
      grid.width = CANVAS_WIDTH;
      grid.height = CANVAS_HEIGHT;
      grid.cells = currentLayer.cells;
    }
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
  
  // Calculate layout - positions are in grid coordinates
  // Total grid is 200x50, we center the canvas with padding
  const GRID_WIDTH = 200;
  const GRID_HEIGHT = 50;
  const CANVAS_DISPLAY_WIDTH = 80;  // Visible canvas width
  const CANVAS_DISPLAY_HEIGHT = 38; // Visible canvas height
  const PADDING_X = 10;             // Padding on each side
  
  // Center the canvas horizontally
  const canvas_start_x = Math.floor((GRID_WIDTH - CANVAS_DISPLAY_WIDTH - PADDING_X * 2) / 2);
  const canvas_start_y = 4;
  
  const file_menu_rect: Rect = {
    x0: 0,
    y0: 0,
    x1: GRID_WIDTH - 1,
    y1: 2
  };

  const toolbar_rect: Rect = {
    x0: 0,
    y0: GRID_HEIGHT - 3,  // Bottom area
    x1: GRID_WIDTH - 1,
    y1: GRID_HEIGHT - 1
  };

  let canvas_rect: Rect = {
    x0: canvas_start_x + PADDING_X,
    y0: canvas_start_y,
    x1: canvas_start_x + PADDING_X + CANVAS_DISPLAY_WIDTH - 1,
    y1: canvas_start_y + CANVAS_DISPLAY_HEIGHT - 1
  };
  
  // Create toolbar module
  const toolbar_module = make_painter_toolbar_module({
    id: 'painter_toolbar',
    rect: toolbar_rect,
    get_current_tool: () => current_tool,
    on_tool_select: (tool) => {
      current_tool = tool;
      // Update the toolbar module's tool reference
      // The module will re-render with the new selection
    }
  });
  
  // Create canvas module
  const canvas_module = make_painter_canvas_module({
    id: 'painter_canvas',
    rect: canvas_rect,
    grid,
    get_space: () => voxelSpace,
    get_selected_z: () => voxelSpace.camera.focus_plane,
    get_current_tool: () => current_tool,
    brush,
    get_brush_size: () => brush_size,
    get_space_replace: () => space_replace,
    get_paste_space_replace: () => paste_space_replace,
    get_paste_scale: () => paste_scale,
    get_gradiator_state: () => gradiator_state,
    get_paste_ignore_space: () => paste_ignore_space,
    get_paste_ignore_black: () => paste_ignore_black,
    get_paste_ignore_white: () => paste_ignore_white,
    get_paste_ignore_color: () => paste_ignore_color,
    get_paste_ignore_color_rgb: () => paste_ignore_color_rgb,
    get_selection_mode: () => selection_mode,
    get_text_spacing: () => text_spacing,
    get_text_charlead: () => text_charlead,
    get_text_enterlead: () => text_enterlead,
    get_text_enterspace: () => text_enterspace,
    preview_points,
    get_left_click_tool: () => left_click_tool,
    get_right_click_tool: () => right_click_tool,
    history,
    on_push_snapshot: () => {
      pushSnapshot(history, grid);
      schedule_auto_save();
    },
    on_sample_cell: (cell) => {
      brush.char = cell.char;
      brush.rgb = { ...cell.rgb };
      brush.weight_index = cell.weight_index;
    },
    on_selection_change: () => {
      // Force redraw when selection changes
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
      return clipboard_data;
    },
    on_move: (new_rect) => {
      // Update canvas_rect when moved
      canvas_rect = new_rect;
      console.log('Canvas moved:', new_rect);
    },
    on_resize: (new_rect) => {
      // Update canvas_rect
      canvas_rect = new_rect;
      console.log('Canvas resized:', new_rect);
    },
    on_close: () => {
      // Reset canvas to default position
      canvas_rect = {
        x0: canvas_start_x + PADDING_X,
        y0: canvas_start_y,
        x1: canvas_start_x + PADDING_X + CANVAS_DISPLAY_WIDTH - 1,
        y1: canvas_start_y + CANVAS_DISPLAY_HEIGHT - 1
      };
      console.log('Canvas reset to default position');
    },
    on_viewport_change: (viewport) => {
      // Viewport is driven by the main render loop (src/canvas_app/main.ts) using runtime tile metrics.
      // No-op to avoid mixing coordinate systems.
      void viewport;
    },
    on_mouse_move: (offsetX, offsetY) => {
      // Forward mouse parallax to DOM renderer
      if (domRenderer) {
        domRenderer.setMouseParallax(offsetX, offsetY);
      }
    }
  });

  // Track module visibility state - MUST be declared before file menu
  let char_selector_open = true;
  let brush_preview_open = true;
  let color_selector_open = true;
  let weight_selector_open = true;
  let toolbox_open = true;
  let tool_properties_open = true;
  
  // Helper function to toggle any module
  function toggleModule(
    isOpen: boolean,
    setOpen: (v: boolean) => void,
    moduleId: string,
    createModule: () => Module,
    moduleVar: Module | null
  ): void {
    if (isOpen) {
      setOpen(false);
      registry.unregister(moduleId);
    } else {
      if (!registry.get_all().find(m => m.id === moduleId)) {
        setOpen(true);
        const mod = createModule();
        registry.register(mod);
      }
    }
  }
  
  // Create module instances (but don't register yet)
  let char_selector_module: Module | null = null;
  let brush_preview_module: Module | null = null;
  let color_selector_module: Module | null = null;
  let weight_selector_module: Module | null = null;
  let toolbox_module: Module | null = null;
  let tool_properties_module: Module | null = null;
  
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
      selected_char: brush.char,
      on_char_select: (char) => {
        // Check if we're editing a gradiator
        if (gradiator_state.isEditing && gradiator_state.editSlot !== null) {
          // Set the character in the gradiator at the selected position
          setGradiatorChar(gradiator_state, gradiator_state.editSlot, gradiator_state.editCursorX, char);
          saveGradiatorState(gradiator_state);
          console.log('Set gradiator character:', char, 'at position', gradiator_state.editCursorX);
        } else {
          // Normal brush character selection
          brush.char = char;
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
        char_selector_open = false;
        registry.unregister('char_selector');
        char_selector_module = null;
      }
    });
  }
  
  function create_brush_preview_module(): Module {
    return make_brush_preview_module({
      id: 'brush_preview',
      rect: brush_preview_rect,
      get_brush: () => brush,
      on_move: (new_rect) => {
        if (brush_preview_module) {
          brush_preview_module.rect = new_rect;
          saveModulePosition('brush_preview', new_rect);
        }
      },
      on_close: () => {
        brush_preview_open = false;
        registry.unregister('brush_preview');
        brush_preview_module = null;
      }
    });
  }
  
  function create_color_selector_module(): Module {
    return make_color_selector_module({
      id: 'color_selector',
      rect: color_selector_rect,
      get_brush: () => brush,
      on_color_select: (rgb) => {
        // Check if we're selecting the ignore color
        if ((globalThis as any).__selecting_ignore_color) {
          paste_ignore_color_rgb = rgb;
          saveToolProperties({ paste_ignore_color_rgb: rgb });
          (globalThis as any).__selecting_ignore_color = false;
          console.log('Set ignore color:', rgb);
        } else {
          brush.rgb = rgb;
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
        color_selector_open = false;
        registry.unregister('color_selector');
        color_selector_module = null;
      }
    });
  }
  
  function create_weight_selector_module(): Module {
    return make_weight_selector_module({
      id: 'weight_selector',
      rect: weight_selector_rect,
      get_weight_index: () => brush.weight_index,
      on_weight_change: (weight_index) => {
        brush.weight_index = weight_index;
        console.log('Selected weight:', weight_index);
      },
      on_move: (new_rect) => {
        if (weight_selector_module) {
          weight_selector_module.rect = new_rect;
          saveModulePosition('weight_selector', new_rect);
        }
      },
      on_close: () => {
        weight_selector_open = false;
        registry.unregister('weight_selector');
        weight_selector_module = null;
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
        left_click_tool = tool;
        saveToolProperties({ left_click_tool: tool });
        console.log('Left-click tool:', tool);
      },
      on_right_click_tool_change: (tool) => {
        right_click_tool = tool;
        saveToolProperties({ right_click_tool: tool });
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
        toolbox_open = false;
        registry.unregister('toolbox');
        toolbox_module = null;
      }
    });
  }
  
  function create_tool_properties_module(): Module {
    return make_tool_properties_module({
      id: 'tool_properties',
      rect: tool_properties_rect,
      get_current_tool: () => current_tool,
      get_brush_size: () => brush_size,
      on_brush_size_change: (size) => {
        brush_size = size;
        saveToolProperties({ brush_size: size });
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
        tool_properties_open = false;
        registry.unregister('tool_properties');
        tool_properties_module = null;
      }
    });
  }

  // Create file menu module
  const file_menu = make_file_menu_module({
    id: 'painter_file_menu',
    rect: file_menu_rect,
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
        create_toolbox_module,
        toolbox_module
      );
    },
    on_toggle_char_selector: () => {
      toggleModule(
        char_selector_open,
        (v) => { char_selector_open = v; },
        'char_selector',
        create_char_selector_module,
        char_selector_module
      );
    },
    on_toggle_color_selector: () => {
      toggleModule(
        color_selector_open,
        (v) => { color_selector_open = v; },
        'color_selector',
        create_color_selector_module,
        color_selector_module
      );
    },
    on_toggle_weight_selector: () => {
      toggleModule(
        weight_selector_open,
        (v) => { weight_selector_open = v; },
        'weight_selector',
        create_weight_selector_module,
        weight_selector_module
      );
    },
    on_toggle_brush_preview: () => {
      toggleModule(
        brush_preview_open,
        (v) => { brush_preview_open = v; },
        'brush_preview',
        create_brush_preview_module,
        brush_preview_module
      );
    },
    on_toggle_tool_properties: () => {
      toggleModule(
        tool_properties_open,
        (v) => { tool_properties_open = v; },
        'tool_properties',
        create_tool_properties_module,
        tool_properties_module
      );
    },
    on_toggle_layer_palette: () => {
      toggleModule(
        layer_palette_open,
        (v) => { layer_palette_open = v; },
        'layer_palette',
        create_layer_palette_module,
        layer_palette_module
      );
    },
    on_toggle_camera: () => {
      toggleModule(
        camera_control_open,
        (v) => { camera_control_open = v; },
        'camera_control',
        create_camera_control_module,
        camera_control_module
      );
    }
  });

  // Create Layer Palette module (3D layers UI)
  let layer_palette_open = true;
  let layer_palette_module: Module | null = null;
  
  function create_layer_palette_module(): Module {
    return makeLayerPaletteModule({
      id: 'layer_palette',
      rect: layer_palette_rect,
      getSpace: () => voxelSpace,
      onLayerSelect: (z) => {
        console.log('Layer selected:', z);
        // Switch to this layer
        const layer = getLayer(voxelSpace, z);
        if (layer && !layer.locked) {
          voxelSpace.camera.focus_plane = z;
          grid.cells = layer.cells; // Sync grid to new layer
        }
      },
      onLayerVisibilityToggle: (z) => {
        const layer = getLayer(voxelSpace, z);
        if (layer) {
          layer.visible = !layer.visible;
          console.log('Layer', z, 'visibility:', layer.visible);
        }
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
        // Find next available Z
        const zs = Array.from(voxelSpace.layers.keys());
        const maxZ = zs.length > 0 ? Math.max(...zs) : -1;
        const newZ = maxZ + 1;
        addLayer(voxelSpace, newZ, `Layer ${newZ}`);
        // Select the new layer
        voxelSpace.camera.focus_plane = newZ;
        const newLayer = getLayer(voxelSpace, newZ);
        if (newLayer) {
          grid.cells = newLayer.cells;
        }
        // Log to history
        logLayerAction(history, 'add_layer', `Add Layer ${newZ}`, newZ, newLayer);
        console.log('Added layer at Z:', newZ);
      },
      onDeleteLayer: (z) => {
        try {
          // Capture layer data before deletion
          const layerToDelete = getLayer(voxelSpace, z);
          removeLayer(voxelSpace, z);
          // Log to history
          if (layerToDelete) {
            logLayerAction(history, 'delete_layer', `Delete Layer ${z}`, z, layerToDelete);
          }
          // Switch to another layer if needed
          if (voxelSpace.camera.focus_plane === z) {
            const remainingZs = Array.from(voxelSpace.layers.keys());
            if (remainingZs.length > 0) {
              voxelSpace.camera.focus_plane = remainingZs[0]!;
              const layer = getLayer(voxelSpace, remainingZs[0]!);
              if (layer) {
                grid.cells = layer.cells;
              }
            }
          }
          console.log('Deleted layer at Z:', z);
        } catch (e) {
          console.error('Cannot delete layer:', e);
        }
      },
      onDuplicateLayer: (z) => {
        const zs = Array.from(voxelSpace.layers.keys());
        const maxZ = zs.length > 0 ? Math.max(...zs) : -1;
        const newZ = maxZ + 1;
        duplicateLayer(voxelSpace, z, newZ);
        voxelSpace.camera.focus_plane = newZ;
        const newLayer = getLayer(voxelSpace, newZ);
        if (newLayer) {
          grid.cells = newLayer.cells;
        }
        // Log to history
        logLayerAction(history, 'duplicate_layer', `Duplicate Layer ${z} → ${newZ}`, newZ, newLayer, z, newZ);
        console.log('Duplicated layer', z, 'to', newZ);
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
        
        // Sync grid to current layer
        const currentLayer = getLayer(voxelSpace, voxelSpace.camera.focus_plane);
        if (currentLayer) {
          grid.cells = currentLayer.cells;
        }
        
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
        layer_palette_open = false;
        registry.unregister('layer_palette');
        layer_palette_module = null;
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
  let camera_control_open = false;
  let camera_control_module: Module | null = null;

  function create_camera_control_module(): Module {
    return makeCameraControlModule({
      id: 'camera_control',
      rect: camera_control_rect,
      getSpace: () => voxelSpace,
      onParallaxMoveToggle: (enabled) => {
        voxelSpace.camera.parallax_move_enabled = enabled;
        if (isAppInitialized) {
          saveCameraConfig({ parallax_move_enabled: enabled });
        }
        console.log('Parallax move:', enabled ? 'enabled' : 'disabled');
      },
      onParallaxSizeToggle: (enabled) => {
        voxelSpace.camera.parallax_size_enabled = enabled;
        if (isAppInitialized) {
          saveCameraConfig({ parallax_size_enabled: enabled });
        }
        console.log('Parallax size:', enabled ? 'enabled' : 'disabled');
      },
      onOcclusionToggle: (enabled) => {
        // When occlusion is enabled, we DON'T show all layers (show_all_layers = false)
        voxelSpace.camera.show_all_layers = !enabled;
        if (isAppInitialized) {
          saveCameraConfig({ show_all_layers: voxelSpace.camera.show_all_layers });
        }
        console.log('Voxel occlusion:', enabled ? 'enabled' : 'disabled');
      },
      onOrientationChange: (orientation) => {
        voxelSpace.camera.orientation = orientation;
        if (isAppInitialized) {
          saveCameraConfig({ orientation });
        }
      },
      onEulerRotate: (axis, degrees) => {
        if (!voxelSpace.camera.euler_rotation) {
          voxelSpace.camera.euler_rotation = { x: 0, y: 0, z: 0 };
        }
        voxelSpace.camera.euler_rotation[axis] = degrees;
        if (isAppInitialized) {
          saveCameraConfig({ euler_rotation: voxelSpace.camera.euler_rotation });
        }
        console.log(`Euler rotation ${axis}: ${degrees}°`);
        // TODO: Apply CSS transform to canvas container
      },
      onPanReset: () => {
        // Reset pan offsets - handled in canvas module
        console.log('Pan reset requested');
      },
      onCalibrationChange: (x, y) => {
        if (domRenderer) {
          domRenderer.setCalibration(x, y);
        }
        if (isAppInitialized) {
          saveCameraConfig({ calibration: { x, y } });
        }
      },
      onCalibrationReset: () => {
        if (domRenderer && voxelSpace) {
          domRenderer.setCalibration(0, 0);
        }
        if (isAppInitialized) {
          saveCameraConfig({ calibration: { x: 0, y: 0 } });
        }
      },
      onScalePerLayerChange: (value) => {
        if (isAppInitialized) {
          saveCameraConfig({ scale_per_layer: value });
        }
      },
      onMovementPerLayerChange: (value) => {
        if (isAppInitialized) {
          saveCameraConfig({ movement_per_layer: value });
        }
      },
      onBaseLayerScaleChange: (value) => {
        if (isAppInitialized) {
          saveCameraConfig({ base_layer_scale: value });
        }
      },
      onCharSpacingXChange: (value) => {
        if (isAppInitialized) {
          saveCameraConfig({ char_spacing_x: value });
        }
      },
      onCharSpacingYChange: (value) => {
        if (isAppInitialized) {
          saveCameraConfig({ char_spacing_y: value });
        }
      },
      onPanXChange: (value) => {
        voxelSpace.camera.pan_x = value;
        if (isAppInitialized) {
          saveCameraConfig({ pan_x: value });
        }
        // Viewport will be updated automatically on next frame by main loop
      },
      onPanYChange: (value) => {
        voxelSpace.camera.pan_y = value;
        if (isAppInitialized) {
          saveCameraConfig({ pan_y: value });
        }
        // Viewport will be updated automatically on next frame by main loop
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
        camera_control_open = false;
        registry.unregister('camera_control');
        camera_control_module = null;
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
  registry.register(char_selector_module);
  registry.register(brush_preview_module);
  registry.register(color_selector_module);
  registry.register(weight_selector_module);
  registry.register(toolbox_module);
  registry.register(tool_properties_module);
  
  return {
    modules: registry.get_all(),
    module_registry: registry,

     // Screen-space parallax: centered on the canvas module, but responsive anywhere.
     on_pointer_move_global: (x: number, y: number) => {
       if (!domRenderer) return;
       const r = canvas_rect;
       const cx = (r.x0 + r.x1) / 2;
       const cy = (r.y0 + r.y1) / 2;
       const max_dx = (r.x1 - r.x0) / 2;
       const max_dy = (r.y1 - r.y0) / 2;
       const clamped_x = Math.max(r.x0, Math.min(r.x1, x));
       const clamped_y = Math.max(r.y0, Math.min(r.y1, y));
       const ox = max_dx > 0 ? (clamped_x - cx) / max_dx : 0;
       const oy = max_dy > 0 ? (clamped_y - cy) / max_dy : 0;
       domRenderer.setMouseParallax(ox, oy);
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

      // Apply persisted camera config to the new space
      const savedCam = loadCameraConfig();
      if (savedCam && Object.keys(savedCam).length > 0) {
        voxelSpace.camera = { ...voxelSpace.camera, ...savedCam };
      }

      ensureValidFocusPlane();

      syncDOMRenderer();
      // Sync grid to the new VoxelSpace
      const currentLayer = getLayer(voxelSpace, 0);
      if (currentLayer) {
        grid.width = width;
        grid.height = height;
        grid.cells = currentLayer.cells;
      }
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
        ensureValidFocusPlane();
        syncDOMRenderer();
        // Update grid reference to current layer
        const currentLayer = getLayer(voxelSpace, voxelSpace.camera.focus_plane);
        if (currentLayer) {
          grid.width = voxelSpace.bounds.width;
          grid.height = voxelSpace.bounds.height;
          grid.cells = currentLayer.cells;
        }
        pushSnapshot(history, grid);
        console.log('🎨 Imported VoxelSpace:', debugVoxelSpace(voxelSpace));
      } catch (e) {
        console.error('Failed to import VoxelSpace:', e);
      }
    },
    
    get_voxel_space: () => voxelSpace,
    
    set_camera_mode: (mode: CameraMode) => {
      voxelSpace.camera.mode = mode;
    },
    
    set_parallax_intensity: (intensity: number) => {
      voxelSpace.camera.parallax_intensity = Math.max(0, Math.min(1, intensity));
    },
    
    toggle_show_all_layers: () => {
      voxelSpace.camera.show_all_layers = !voxelSpace.camera.show_all_layers;
    },
    
    // Layer operations
    add_layer: () => {
      const zs = Array.from(voxelSpace.layers.keys());
      const maxZ = zs.length > 0 ? Math.max(...zs) : 0;
      const newZ = maxZ + 1;
      addLayer(voxelSpace, newZ, `Layer ${newZ}`);
      console.log('➕ Added layer at Z=', newZ);
    },
    
    delete_layer: (z: number) => {
      try {
        removeLayer(voxelSpace, z);
        // If we deleted the current layer, switch to another
        if (z === voxelSpace.camera.focus_plane) {
          const remainingZs = Array.from(voxelSpace.layers.keys());
          if (remainingZs.length > 0) {
            voxelSpace.camera.focus_plane = remainingZs[0]!;
            const layer = getLayer(voxelSpace, voxelSpace.camera.focus_plane);
            if (layer) {
              grid.cells = layer.cells;
            }
          }
        }
        console.log('🗑️ Deleted layer at Z=', z);
      } catch (e) {
        console.error('Cannot delete layer:', e);
      }
    },
    
    duplicate_layer: (z: number) => {
      const zs = Array.from(voxelSpace.layers.keys());
      const maxZ = zs.length > 0 ? Math.max(...zs) : 0;
      const newZ = maxZ + 1;
      duplicateLayer(voxelSpace, z, newZ);
      console.log('📋 Duplicated layer', z, 'to', newZ);
    },
    
    select_layer: (z: number) => {
      voxelSpace.camera.focus_plane = z;
      if (isAppInitialized) {
        saveCameraConfig({ focus_plane: z });
      }
      const layer = getLayer(voxelSpace, z);
      if (layer) {
        grid.cells = layer.cells;
        console.log('✓ Selected layer Z=', z);
      }
    },
    
    toggle_layer_visibility: (z: number) => {
      const layer = getLayer(voxelSpace, z);
      if (layer) {
        layer.visible = !layer.visible;
        console.log('👁 Layer', z, 'visible:', layer.visible);
      }
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
        calibration: voxelSpace.camera.calibration,
        scale_per_layer: voxelSpace.camera.scale_per_layer,
        movement_per_layer: voxelSpace.camera.movement_per_layer,
        base_layer_scale: voxelSpace.camera.base_layer_scale,
        char_spacing_x: voxelSpace.camera.char_spacing_x,
        char_spacing_y: voxelSpace.camera.char_spacing_y,
      });
      console.log('[Camera Debug] Force saved camera config');
    },
  };
}
