import { create_painter_document, create_painter_group, make_painter_coord_key } from '../ascii_painter/painter_document.js';
import { normalize_painter_document_runtime, resolve_painter_voxel_winner } from '../ascii_painter/painter_document_runtime.js';
import { apply_painter_group_structure_change, apply_painter_group_voxel_changes, redo_painter_group_changes, save_painter_document_snapshot, undo_painter_group_changes } from './painter_document_store.js';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const slot = 997;
const document_id = `painter_store_overlap_${Date.now()}`;
const document = create_painter_document(8, 8, { min_z: 0, max_z: 2, default_group_name: 'Base' });
const base_group_id = document.group_order[0]!;
const initial = save_painter_document_snapshot(slot, {
  document_id,
  revision: 1,
  updated_at: new Date().toISOString(),
  snapshot: document,
});

const with_top_group = apply_painter_group_structure_change(slot, initial.document_id, {
  kind: 'create_group',
  group_name: 'Top',
  target_group_id: 'top_group_overlap_test',
});
const top_group_id = 'top_group_overlap_test';

apply_painter_group_voxel_changes(slot, with_top_group.document_id, base_group_id, [{
  x: 2,
  y: 3,
  z: 1,
  cell: { char: 'A', rgb: { r: 255, g: 255, b: 255 }, weight_index: 1 },
}]);

const after_top_write = apply_painter_group_voxel_changes(slot, with_top_group.document_id, top_group_id, [{
  x: 2,
  y: 3,
  z: 1,
  cell: { char: 'B', rgb: { r: 255, g: 0, b: 0 }, weight_index: 2 },
}]);

let runtime = normalize_painter_document_runtime(after_top_write.snapshot);
const key = make_painter_coord_key(2, 3, 1);
let winner = resolve_painter_voxel_winner(runtime, key);
assert(winner.winning_group_id === top_group_id, 'top group write should win exact overlap in stored document');
assert(runtime.group_voxel_index.get(base_group_id)?.get(key)?.char === 'A', 'top group write should not delete lower group authored voxel in store history path');

const after_undo = undo_painter_group_changes(slot, with_top_group.document_id, top_group_id);
runtime = normalize_painter_document_runtime(after_undo.snapshot);
winner = resolve_painter_voxel_winner(runtime, key);
assert(winner.winning_group_id === base_group_id, 'undoing top group changes should restore lower group as visible winner');
assert(winner.cell?.char === 'A', 'undo should restore lower group cell after overlap removal');

const after_redo = redo_painter_group_changes(slot, with_top_group.document_id, top_group_id);
runtime = normalize_painter_document_runtime(after_redo.snapshot);
winner = resolve_painter_voxel_winner(runtime, key);
assert(winner.winning_group_id === top_group_id, 'redoing top group changes should restore top overlap winner');
assert(winner.cell?.char === 'B', 'redo should restore top group overlap cell');

const renamed = apply_painter_group_structure_change(slot, with_top_group.document_id, {
  kind: 'rename_group',
  group_id: top_group_id,
  group_name: 'Renamed Top',
});
runtime = normalize_painter_document_runtime(renamed.snapshot);
assert(runtime.document.groups[top_group_id]?.name === 'Renamed Top', 'rename_group should update authored group name in stored snapshot');

const hidden = apply_painter_group_structure_change(slot, with_top_group.document_id, {
  kind: 'set_group_visibility',
  group_id: top_group_id,
  visible: false,
});
runtime = normalize_painter_document_runtime(hidden.snapshot);
assert(runtime.document.groups[top_group_id]?.visible === false, 'set_group_visibility should update authored group visibility');
winner = resolve_painter_voxel_winner(runtime, key);
assert(winner.winning_group_id === base_group_id, 'hidden top group should reveal lower overlap winner in stored snapshot');

const locked = apply_painter_group_structure_change(slot, with_top_group.document_id, {
  kind: 'set_group_locked',
  group_id: top_group_id,
  locked: true,
});
runtime = normalize_painter_document_runtime(locked.snapshot);
assert(runtime.document.groups[top_group_id]?.locked === true, 'set_group_locked should update authored group lock state');

const reordered = apply_painter_group_structure_change(slot, with_top_group.document_id, {
  kind: 'reorder_groups',
  next_group_order: [top_group_id, base_group_id],
});
runtime = normalize_painter_document_runtime(reordered.snapshot);
assert(runtime.document.group_order[0] === top_group_id, 'reorder_groups should change authored group order in stored snapshot');
winner = resolve_painter_voxel_winner(runtime, key);
assert(winner.winning_group_id === base_group_id, 'reordering groups should change exact overlap winner without deleting top group voxels');
assert(runtime.group_voxel_index.get(top_group_id)?.get(key)?.char === 'B', 'reordering groups should preserve top group authored voxel data');

console.log('painter_document_store tests passed');
