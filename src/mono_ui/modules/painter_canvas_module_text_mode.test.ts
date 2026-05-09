import { createGrid, getCell, type Brush, type GridCell } from '../../ascii_painter/types.js';
import { createHistoryManager } from '../../ascii_painter/history.js';
import { make_painter_canvas_module } from './painter_canvas_module.js';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function makePointerEvent(x: number, y: number, button: number, target_module_id: string | null = 'painter_canvas'): any {
  return {
    pointer_id: 1,
    kind: 'down',
    x,
    y,
    prev_x: x,
    prev_y: y,
    step_dx: 0,
    step_dy: 0,
    button,
    buttons: button === 2 ? 2 : 1,
    shift: false,
    ctrl: false,
    alt: false,
    meta: false,
    space: false,
    target_module_id,
  };
}

function makeKeyEvent(key: string): any {
  return {
    key,
    code: key === 'Escape' ? 'Escape' : key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault() {},
  };
}

const grid = createGrid(8, 4);
const history = createHistoryManager();
const brush: Brush = { char: 'X', rgb: { r: 200, g: 100, b: 50 }, weight_index: 1 };
const commits: Array<{ description: string; changes: Array<{ x: number; y: number; oldCell: GridCell; newCell: GridCell }> }> = [];
let leftTool: any = 'text';

const module = make_painter_canvas_module({
  id: 'painter',
  rect: { x0: 0, y0: 0, x1: 7, y1: 3 },
  grid,
  brush,
  get_camera: () => ({ pan_x: 0, pan_y: 0, zoom: 1 } as any),
  get_selected_z: () => 0,
  get_active_group_id: () => 'group-1',
  get_world_cell: ({ x, y }) => getCell(grid, x, y)!,
  get_current_tool: () => leftTool,
  get_left_click_tool: () => leftTool,
  get_right_click_tool: () => 'eraser',
  get_brush_size: () => 1,
  get_space_replace: () => true,
  get_paste_space_replace: () => true,
  get_selection_mode: () => 'replace',
  get_text_spacing: () => 1,
  get_text_charlead: () => 0,
  get_text_enterlead: () => 1,
  get_text_enterspace: () => 0,
  preview_points: [],
  on_edit_committed: () => {},
  on_sample_cell: () => {},
  history,
  on_world_selection_change: () => {},
  get_gradiator_state: () => ({ chars: [], isEditing: false, editSlot: null, editCursorX: 0 } as any),
  get_paste_scale: () => 1,
  get_paste_ignore_space: () => false,
  get_paste_ignore_black: () => false,
  get_paste_ignore_white: () => false,
  get_paste_ignore_color: () => false,
  get_paste_ignore_color_rgb: () => ({ r: 0, g: 0, b: 0 }),
  on_undo_request: () => null,
  on_redo_request: () => null,
  on_commit_cell_changes: (args) => {
    commits.push({
      description: args.description,
      changes: args.changes.map((change) => ({ x: change.x, y: change.y, oldCell: change.oldCell, newCell: change.newCell })),
    });
  },
});

(module as any).OnPointerDown?.(makePointerEvent(1, 1, 0));
assert((module as any).WantsTextCapture?.() === true, 'text mode should activate on text-tool pointer down');

(module as any).OnTextInput?.('A');
assert(getCell(grid, 1, 1)!.char === 'A', 'typing should write the first text cell');
assert(commits.length === 0, 'typing should not auto-commit immediately');

(module as any).OnGlobalPointerDown?.(makePointerEvent(20, 20, 0, 'color_selector'));
assert((module as any).WantsTextCapture?.() === true, 'valid text-edit UI click should keep text mode active');
assert(commits.length === 0, 'valid text-edit UI click should not auto-commit text changes');

(module as any).OnBlur?.();
assert((module as any).WantsTextCapture?.() === true, 'blur should not exit active text mode');
assert(commits.length === 0, 'blur should not auto-commit text changes');
assert(getCell(grid, 1, 1)!.char === 'A', 'blur should preserve pending text edits');

(module as any).OnTextInput?.('B');
assert(getCell(grid, 2, 1)!.char === 'B', 'typing should continue after valid edit interactions');
assert(commits.length === 0, 'continuing to type should still remain uncommitted until explicit text completion');

(module as any).OnGlobalPointerDown?.(makePointerEvent(30, 30, 0, null));
assert(commits.length === 1, 'off-UI/global pointer should auto-commit active text edits');
assert(commits[0]?.description === 'Type Text', 'off-UI auto-commit should commit as Type Text');
assert(commits[0]?.changes.length === 2, 'off-UI auto-commit should commit both typed glyph changes');
assert((module as any).WantsTextCapture?.() === false, 'off-UI/global pointer should end text mode');

leftTool = 'text';
(module as any).OnPointerDown?.(makePointerEvent(3, 1, 0));
(module as any).OnTextInput?.('C');
assert((module as any).WantsTextCapture?.() === true, 'text mode should restart for invalid-ui test');
(module as any).OnGlobalPointerDown?.(makePointerEvent(5, 5, 0, 'toolbox'));
assert(commits.length === 2, 'invalid non-edit UI click should auto-commit active text edits');
assert(commits[1]?.changes.length === 1, 'invalid non-edit UI click should commit the current text run');
assert((module as any).WantsTextCapture?.() === false, 'invalid non-edit UI click should end text mode');

const fallbackGrid = createGrid(8, 4);
const fallbackHistory = createHistoryManager();
const fallbackModule = make_painter_canvas_module({
  id: 'painter-fallback',
  rect: { x0: 0, y0: 0, x1: 7, y1: 3 },
  grid: fallbackGrid,
  brush,
  get_camera: () => ({ pan_x: 0, pan_y: 0, zoom: 1 } as any),
  get_selected_z: () => 5,
  get_active_group_id: () => 'group-1',
  get_world_cell: ({ x, y }) => getCell(fallbackGrid, x, y)!,
  get_world_point_for_grid: (x, y) => ({ x, y, z: 5 }),
  get_world_point_for_grid_on_plane: (x, y, plane) => ({ x, y, z: plane }),
  get_grid_point_for_world: () => null,
  get_current_tool: () => 'text',
  get_left_click_tool: () => 'text',
  get_right_click_tool: () => 'eraser',
  get_brush_size: () => 1,
  get_space_replace: () => true,
  get_paste_space_replace: () => true,
  get_selection_mode: () => 'replace',
  get_text_spacing: () => 1,
  get_text_charlead: () => 0,
  get_text_enterlead: () => 1,
  get_text_enterspace: () => 0,
  preview_points: [],
  on_edit_committed: () => {},
  on_sample_cell: () => {},
  history: fallbackHistory,
  on_world_selection_change: () => {},
  get_gradiator_state: () => ({ chars: [], isEditing: false, editSlot: null, editCursorX: 0 } as any),
  get_paste_scale: () => 1,
  get_paste_ignore_space: () => false,
  get_paste_ignore_black: () => false,
  get_paste_ignore_white: () => false,
  get_paste_ignore_color: () => false,
  get_paste_ignore_color_rgb: () => ({ r: 0, g: 0, b: 0 }),
  on_undo_request: () => null,
  on_redo_request: () => null,
  on_commit_cell_changes: () => {},
});

(fallbackModule as any).OnPointerDown?.(makePointerEvent(1, 1, 0, 'painter-fallback'));
(fallbackModule as any).OnTextInput?.('D');
(fallbackModule as any).OnTextInput?.('E');
assert(getCell(fallbackGrid, 1, 1)!.char === 'D', 'fallback text mode should write the first glyph');
assert(getCell(fallbackGrid, 2, 1)!.char === 'E', 'fallback text cursor should advance even when world-to-grid projection lookup fails');

console.log('painter_canvas_module_text_mode tests passed');
