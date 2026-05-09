import { createGrid, type Brush } from '../../ascii_painter/types.js';
import { createHistoryManager } from '../../ascii_painter/history.js';
import { make_painter_canvas_module } from './painter_canvas_module.js';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function makeKeyEvent(key: string): any {
  return {
    key,
    code: key,
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
let currentAnchor = { x: 0, y: 0, z: 0 };
let anchorUpdates: Array<{ x: number; y: number; z: number; source: 'screen_drag' | 'axis_step' }> = [];
let gestureEndCalls = 0;

const module = make_painter_canvas_module({
  id: 'painter',
  rect: { x0: 0, y0: 0, x1: 7, y1: 3 },
  grid,
  brush,
  get_camera: () => ({ pan_x: 0, pan_y: 0, zoom: 1 } as any),
  get_selected_z: () => 0,
  get_active_group_id: () => 'group-1',
  get_world_cell: () => ({ char: ' ', rgb: { r: 0, g: 0, b: 0 }, weight_index: 0 }),
  get_current_tool: () => 'pencil',
  get_left_click_tool: () => 'pencil',
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
  get_view_state: () => ({ principal_view: 'top', roll_quarter_turn: 0 }),
  get_camera_frame_anchor_world: () => currentAnchor,
  set_camera_frame_anchor_world: (anchor, context) => {
    currentAnchor = { ...anchor };
    anchorUpdates.push({ ...anchor, source: context.source });
  },
  get_pan_step_size_px: () => ({ x: 10, y: 10 }),
  on_pan_gesture_end: () => {
    gestureEndCalls += 1;
  },
});

const pan = (module as any).getPanTargetAdapter?.();
assert(!!pan, 'painter canvas should expose a pan target adapter');
pan.applyScreenDelta?.(12, -8);
assert(anchorUpdates.length === 1, 'screen drag pan should update the shared camera anchor');
assert(anchorUpdates[0]?.x === -1 && anchorUpdates[0]?.y === 0 && anchorUpdates[0]?.source === 'screen_drag', 'screen drag pan should convert screen pixels into a world-anchor step');
pan.applyAxisDelta?.({ x: 2, y: -3 });
assert(anchorUpdates.length === 2, 'axis pan should update the shared camera anchor');
assert(anchorUpdates[1]?.x === -3 && anchorUpdates[1]?.y === 3 && anchorUpdates[1]?.source === 'axis_step', 'axis pan should move the shared camera anchor in world space');
pan.endGesture?.();
assert(gestureEndCalls === 1, 'ending a pan gesture should notify the painter pan callback');

(module as any).OnKeyDown?.(makeKeyEvent('ArrowRight'));
(module as any).OnKeyDown?.(makeKeyEvent('ArrowUp'));
assert(anchorUpdates.length === 4, 'keyboard pan should also route through the shared camera pan adapter');
assert(anchorUpdates[2]?.x === -4 && anchorUpdates[2]?.y === 3 && anchorUpdates[2]?.source === 'axis_step', 'ArrowRight should pan one world step right');
assert(anchorUpdates[3]?.x === -4 && anchorUpdates[3]?.y === 2 && anchorUpdates[3]?.source === 'axis_step', 'ArrowUp should pan one world step up');

console.log('painter_canvas_module_pan tests passed');
