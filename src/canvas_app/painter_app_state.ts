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
import { createHistoryManager, pushSnapshot, undo, redo } from '../ascii_painter/history.js';
import { get_color_by_name } from '../mono_ui/colors.js';
import { make_painter_canvas_module } from '../mono_ui/modules/painter_canvas_module.js';
import { make_painter_toolbar_module } from '../mono_ui/modules/painter_toolbar_module.js';
import { make_file_menu_module } from '../mono_ui/modules/painter_file_menu_module.js';
import { make_character_selector_module } from '../mono_ui/modules/character_selector_module.js';
import { make_brush_preview_module } from '../mono_ui/modules/brush_preview_module.js';
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
  generateFilename
} from '../ascii_painter/save_system.js';

// Configuration matching the game but with relaxed letter spacing
export const PAINTER_CONFIG = {
  font_family: '"Martian Mono", "Noto Sans Mono", monospace',
  base_font_size_px: 32,
  base_line_height_mult: 29.8 / 32,
  base_letter_spacing_mult: -0.10, // Relaxed from -0.18
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

  // Grid operations
  export_grid: () => string;
  import_grid: (json: string) => void;
  clear_canvas: () => void;

  // Save system
  save_to_file: (filename?: string) => void;
  load_from_file: (file: File) => Promise<void>;
  export_as_text: () => string;
  new_canvas: (width: number, height: number) => void;
  current_filename: string;
};

export function create_painter_app_state(): PainterAppState {
  // Create the drawing grid
  const grid = createGrid(CANVAS_WIDTH, CANVAS_HEIGHT);
  
  // Create history manager
  const history = createHistoryManager(50);

  // Try to load auto-save on startup
  const saved_grid = loadAutoSave();
  if (saved_grid) {
    grid.width = saved_grid.width;
    grid.height = saved_grid.height;
    grid.cells = saved_grid.cells;
    console.log('🎨 Loaded auto-saved artwork');
  }

  pushSnapshot(history, grid);
  
  // Current tool state
  let current_tool: ToolType = 'pencil';
  
  // Brush state
  const brush: Brush = {
    char: '█',
    rgb: get_color_by_name('off_white').rgb,
    weight_index: 4
  };
  
  // Preview points for line/rect tools
  let preview_points: { x: number; y: number }[] = [];

  // Current filename for save operations
  let current_filename = 'untitled';

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
      autoSave(grid, current_filename);
      console.log('💾 Auto-saved to localStorage');
    }, 60000); // Auto-save 60 seconds (1 minute) after last change
  }
  
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

  const canvas_rect: Rect = {
    x0: canvas_start_x + PADDING_X,
    y0: canvas_start_y,
    x1: canvas_start_x + PADDING_X + CANVAS_DISPLAY_WIDTH - 1,
    y1: canvas_start_y + CANVAS_DISPLAY_HEIGHT - 1
  };
  
  // Create toolbar module
  const toolbar_module = make_painter_toolbar_module({
    id: 'painter_toolbar',
    rect: toolbar_rect,
    current_tool,
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
    current_tool,
    brush,
    preview_points,
    on_push_snapshot: () => {
      pushSnapshot(history, grid);
      schedule_auto_save();
    },
    on_sample_cell: (cell) => {
      brush.char = cell.char;
      brush.rgb = { ...cell.rgb };
      brush.weight_index = cell.weight_index;
    }
  });
  
  // Create file menu module
  const file_menu = make_file_menu_module({
    id: 'painter_file_menu',
    rect: file_menu_rect,
    on_save: () => {
      // Create filename input dialog
      const filename = prompt('Save as:', current_filename + '.json');
      if (filename) {
        const name = filename.replace('.json', '');
        const data = exportToJSON(grid, { title: name, description: 'ASCII Art', tags: ['ascii_painter'] });
        downloadFile(data, filename, 'application/json');
        current_filename = name;
        autoSave(grid, current_filename);
      }
    },
    on_load: () => {
      // Create file input element
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          try {
            const content = await readFileAsText(file);
            const new_grid = importFromJSON(content);
            grid.width = new_grid.width;
            grid.height = new_grid.height;
            grid.cells = new_grid.cells;
            pushSnapshot(history, grid);
            current_filename = file.name.replace('.json', '');
            schedule_auto_save();
          } catch (err) {
            console.error('Failed to load file:', err);
            alert('Failed to load file: ' + (err as Error).message);
          }
        }
      };
      input.click();
    },
    on_new: () => {
      if (confirm('Create new canvas? Unsaved changes will be lost.')) {
        const new_grid = createGrid(CANVAS_WIDTH, CANVAS_HEIGHT);
        grid.width = new_grid.width;
        grid.height = new_grid.height;
        grid.cells = new_grid.cells;
        pushSnapshot(history, grid);
        current_filename = 'untitled';
        clearAutoSave();
      }
    },
    on_export_text: () => {
      const text = exportToText(grid);
      downloadFile(text, current_filename + '.txt', 'text/plain');
    },
    on_clear: () => {
      if (confirm('Clear canvas? This cannot be undone.')) {
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
      }
    }
  });

  // Create character selector module (floating on right side)
  const char_selector_rect: Rect = {
    x0: 170,
    y0: 10,
    x1: 175,
    y1: 35
  };
  
  const char_selector_module = make_character_selector_module({
    id: 'char_selector',
    rect: char_selector_rect,
    selected_char: brush.char,
    on_char_select: (char) => {
      brush.char = char;
      console.log('Selected character:', char);
    },
    on_move: (new_rect) => {
      // Update the module's rect when moved
      char_selector_module.rect = new_rect;
    },
    on_close: () => {
      registry.unregister('char_selector');
    }
  });
  
  // Create brush preview module (floating, shows current brush)
  const brush_preview_rect: Rect = {
    x0: 150,
    y0: 10,
    x1: 155,
    y1: 15
  };
  
  const brush_preview_module = make_brush_preview_module({
    id: 'brush_preview',
    rect: brush_preview_rect,
    get_brush: () => brush,
    on_move: (new_rect) => {
      // Update the module's rect when moved
      brush_preview_module.rect = new_rect;
    },
    on_close: () => {
      registry.unregister('brush_preview');
    }
  });
  
  // Register initial modules
  registry.register(file_menu);
  registry.register(toolbar_module);
  registry.register(canvas_module);
  registry.register(char_selector_module);
  registry.register(brush_preview_module);
  
  return {
    modules: registry.get_all(),
    module_registry: registry,
    
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
      const name = filename || current_filename || generateFilename('ascii_art', 'json');
      if (filename) current_filename = filename;
      const data = exportToJSON(grid, { title: current_filename, description: 'ASCII Art', tags: ['ascii_painter'] });
      downloadFile(data, name, 'application/json');
      autoSave(grid, current_filename); // Also update auto-save
    },

    load_from_file: async (file: File) => {
      try {
        const content = await readFileAsText(file);
        const new_grid = importFromJSON(content);
        grid.width = new_grid.width;
        grid.height = new_grid.height;
        grid.cells = new_grid.cells;
        pushSnapshot(history, grid);
        current_filename = file.name.replace('.json', '');
        schedule_auto_save();
      } catch (e) {
        console.error('Failed to load file:', e);
        alert('Failed to load file: ' + (e as Error).message);
      }
    },

    export_as_text: () => {
      return exportToText(grid);
    },

    new_canvas: (width: number, height: number) => {
      const new_grid = createGrid(width, height);
      grid.width = new_grid.width;
      grid.height = new_grid.height;
      grid.cells = new_grid.cells;
      pushSnapshot(history, grid);
      current_filename = 'untitled';
      clearAutoSave();
    },

    current_filename
  };
}
