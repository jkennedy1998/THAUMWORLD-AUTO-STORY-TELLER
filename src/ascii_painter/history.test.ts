import {
  canRedoGroup,
  canUndoGroup,
  createHistoryManager,
  getGroupHistoryState,
  logGroupCellAction,
  popRedoGroupAction,
  popUndoGroupAction,
  type CellChange,
} from './history.js';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function makeCell(char: string): { char: string; rgb: { r: number; g: number; b: number }; weight_index: number } {
  return {
    char,
    rgb: { r: 255, g: 255, b: 255 },
    weight_index: 1,
  };
}

function makeChange(group_id: string, worldX: number, charBefore: string, charAfter: string): CellChange {
  return {
    x: worldX,
    y: 0,
    worldX,
    worldY: 0,
    worldZ: 0,
    group_id,
    oldCell: makeCell(charBefore),
    newCell: makeCell(charAfter),
  };
}

const history = createHistoryManager(10);

logGroupCellAction(history, 'draw_cells', 'Group A stroke 1', { group_id: 'group-a' }, [makeChange('group-a', 0, ' ', 'A')]);
logGroupCellAction(history, 'draw_cells', 'Group A stroke 2', { group_id: 'group-a' }, [makeChange('group-a', 1, ' ', 'B')]);
logGroupCellAction(history, 'draw_cells', 'Group B stroke 1', { group_id: 'group-b' }, [makeChange('group-b', 2, ' ', 'C')]);

assert(canUndoGroup(history, 'group-a'), 'group A should have undo available after edits');
assert(canUndoGroup(history, 'group-b'), 'group B should have undo available after edits');

let groupAState = getGroupHistoryState(history, 'group-a');
let groupBState = getGroupHistoryState(history, 'group-b');

assert(groupAState.current_position === 2 && groupAState.total_actions === 2, 'group A should track its own two undo entries');
assert(groupBState.current_position === 1 && groupBState.total_actions === 1, 'group B should track its own single undo entry');

const undoneA = popUndoGroupAction(history, 'group-a');
assert(undoneA?.description.includes('Group A stroke 2'), 'group A undo should pop its most recent action');

groupAState = getGroupHistoryState(history, 'group-a');
groupBState = getGroupHistoryState(history, 'group-b');

assert(groupAState.current_position === 1 && groupAState.total_actions === 2, 'group A undo should move only group A history state');
assert(groupBState.current_position === 1 && groupBState.total_actions === 1, 'group B history should be unchanged by group A undo');
assert(canRedoGroup(history, 'group-a'), 'group A should have redo after its undo');
assert(!canRedoGroup(history, 'group-b'), 'group B should not gain redo when group A undoes');

logGroupCellAction(history, 'draw_cells', 'Group B stroke 2', { group_id: 'group-b' }, [makeChange('group-b', 3, ' ', 'D')]);
groupAState = getGroupHistoryState(history, 'group-a');
groupBState = getGroupHistoryState(history, 'group-b');

assert(groupAState.current_position === 1 && groupAState.total_actions === 2, 'group A redo should survive group B edits');
assert(groupBState.current_position === 2 && groupBState.total_actions === 2, 'group B should append its own second edit');

logGroupCellAction(history, 'draw_cells', 'Group A stroke 3', { group_id: 'group-a' }, [makeChange('group-a', 4, ' ', 'E')]);
groupAState = getGroupHistoryState(history, 'group-a');
groupBState = getGroupHistoryState(history, 'group-b');

assert(!canRedoGroup(history, 'group-a'), 'new edit in group A should clear only group A redo');
assert(groupAState.current_position === 2 && groupAState.total_actions === 2, 'group A total actions should remain undo plus redo after redo clear');
assert(groupBState.current_position === 2 && groupBState.total_actions === 2, 'group B history should remain untouched by group A redo clearing');

const undoneB = popUndoGroupAction(history, 'group-b');
assert(undoneB?.description.includes('Group B stroke 2'), 'group B undo should pop only its own latest action');
const redoneB = popRedoGroupAction(history, 'group-b');
assert(redoneB?.description.includes('Group B stroke 2'), 'group B redo should restore only its own latest action');

console.log('history tests passed');
