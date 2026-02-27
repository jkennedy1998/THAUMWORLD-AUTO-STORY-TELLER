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
import { make_color_selector_module } from '../mono_ui/modules/color_selector_module.js';
import { make_weight_selector_module } from '../mono_ui/modules/weight_selector_module.js';
import { make_toolbox_module } from '../mono_ui/modules/toolbox_module.js';
import { make_tool_properties_module } from '../mono_ui/modules/tool_properties_module.js';
import { saveModulePosition, getModulePosition, clearModulePositions } from '../ascii_painter/module_position_storage.js';
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
  
  // Tool mapping for left/right click
  let left_click_tool: ToolType = 'pencil';
  let right_click_tool: ToolType = 'eraser';
  
  // Brush state
  const brush: Brush = {
    char: '█',
    rgb: get_color_by_name('off_white').rgb,
    weight_index: 4
  };
  
  // Brush tip size (1-5, for 1x1 to 5x5)
  let brush_size = 1;
  
  // Text tool: space replaces character or preserves it
  let space_replace = true;
  
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
    get_current_tool: () => current_tool,
    brush,
    get_brush_size: () => brush_size,
    get_space_replace: () => space_replace,
    preview_points,
    get_left_click_tool: () => left_click_tool,
    get_right_click_tool: () => right_click_tool,
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
  
  // Factory functions for creating modules
  function create_char_selector_module(): Module {
    console.log('Creating char selector module at rect:', char_selector_rect);
    return make_character_selector_module({
      id: 'char_selector',
      rect: char_selector_rect,
      selected_char: brush.char,
      on_char_select: (char) => {
        brush.char = char;
        console.log('Selected character:', char);
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
        brush.rgb = rgb;
        console.log('Selected color:', rgb);
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
        console.log('Left-click tool:', tool);
      },
      on_right_click_tool_change: (tool) => {
        right_click_tool = tool;
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
        console.log('Selected brush size:', size);
      },
      get_space_replace: () => space_replace,
      on_space_replace_change: (replace) => {
        space_replace = replace;
        console.log('Space replace:', replace);
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
    },
    on_reset_positions: () => {
      if (confirm('Reset all panel positions?')) {
        clearModulePositions();
        // Reload the page to apply default positions
        window.location.reload();
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
    }
  });
  
  // Register initial modules
  registry.register(file_menu);
  registry.register(canvas_module);
  
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
  
  console.log('Registered modules:', registry.get_all().map(m => ({ id: m.id, rect: m.rect })));
  
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
