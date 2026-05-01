import { create_painter_document, create_painter_group, make_painter_coord_key } from '../ascii_painter/painter_document.js';
import { normalize_painter_document_runtime, resolve_painter_voxel_winner } from '../ascii_painter/painter_document_runtime.js';
import { apply_painter_group_structure_change, apply_painter_group_structure_command, apply_painter_group_voxel_changes, apply_painter_group_voxel_command, redo_painter_group_changes, save_painter_document_snapshot, undo_painter_group_changes } from './painter_document_store.js';

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
assert(runtime.document.groups[top_group_id]?.content_states.some((state) => state.content.some((voxel) => voxel.char === 'B')) === true, 'reordering groups should preserve top group authored voxel data');

const retimed = apply_painter_group_structure_change(slot, with_top_group.document_id, {
  kind: 'set_document_timing',
  breath_range_start: 4,
  breath_range_end: 14,
  frames_per_breath: 3,
  loop_enabled: false,
});
runtime = normalize_painter_document_runtime(retimed.snapshot);
assert(runtime.document.breath.range_start === 4 && runtime.document.breath.range_end === 14, 'set_document_timing should update stored document breath range');
assert(runtime.document.playback.frames_per_breath === 3 && runtime.document.playback.loop_enabled === false, 'set_document_timing should update stored document playback cadence');

const staleApply = apply_painter_group_voxel_command(slot, with_top_group.document_id, base_group_id, [{
  x: 4,
  y: 4,
  z: 1,
  cell: { char: 'Z', rgb: { r: 0, g: 255, b: 0 }, weight_index: 2 },
}], { base_revision: 1, breath: 0, auto_key: true });
assert(staleApply.applied_from_stale_base === true, 'stale-base voxel commands should still apply and be marked as stale-base');
assert(staleApply.server_revision_before >= 1 && staleApply.server_revision_after === staleApply.snapshot.revision, 'stale-base metadata should report authoritative revision transition');
runtime = normalize_painter_document_runtime(staleApply.snapshot.snapshot);
assert(runtime.group_voxel_index.get(base_group_id)?.get(make_painter_coord_key(4, 4, 1))?.char === 'Z', 'stale-base voxel command should still update authoritative snapshot');

const breathDocument = create_painter_document(6, 6, { default_group_name: 'Breath Store' });
const breathGroupId = breathDocument.group_order[0]!;
breathDocument.groups[breathGroupId]!.start = 2;
breathDocument.groups[breathGroupId]!.cropped_start = 2;
breathDocument.groups[breathGroupId]!.cropped_end = 4;
breathDocument.groups[breathGroupId]!.breath_start = 2;
breathDocument.groups[breathGroupId]!.breath_end = 4;
breathDocument.groups[breathGroupId]!.content_states[0]!.length_breaths = 3;
breathDocument.groups[breathGroupId]!.content_states[0]!.content = [];
const breathDocumentId = `painter_store_breath_${Date.now()}`;
save_painter_document_snapshot(slot, {
  document_id: breathDocumentId,
  revision: 1,
  updated_at: new Date().toISOString(),
  snapshot: breathDocument,
});
const appliedAtBreath = apply_painter_group_voxel_command(slot, breathDocumentId, breathGroupId, [{
  x: 1,
  y: 1,
  z: 0,
  cell: { char: 'K', rgb: { r: 255, g: 255, b: 255 }, weight_index: 1 },
}], { breath: 3, auto_key: true });
runtime = normalize_painter_document_runtime(appliedAtBreath.snapshot.snapshot);
assert(runtime.document.groups[breathGroupId]!.content_states.length === 3, 'authoritative voxel apply should create a one-breath frame at the requested breath');
assert(runtime.document.groups[breathGroupId]!.content_states[1]!.length_breaths === 1, 'authoritative voxel apply should isolate the requested breath');
assert(runtime.document.groups[breathGroupId]!.content_states[1]!.content[0]?.char === 'K', 'authoritative voxel apply should write into the targeted breath frame');
const undoneBreath = undo_painter_group_changes(slot, breathDocumentId, breathGroupId);
runtime = normalize_painter_document_runtime(undoneBreath.snapshot);
assert(runtime.document.groups[breathGroupId]!.content_states[1]!.content.length === 0, 'undo should clear the targeted breath frame without shifting to another breath');
const redoneBreath = redo_painter_group_changes(slot, breathDocumentId, breathGroupId);
runtime = normalize_painter_document_runtime(redoneBreath.snapshot);
assert(runtime.document.groups[breathGroupId]!.content_states[1]!.content[0]?.char === 'K', 'redo should restore the targeted breath frame content');

const singleGroupDocumentId = `painter_store_single_group_${Date.now()}`;
save_painter_document_snapshot(slot, {
  document_id: singleGroupDocumentId,
  revision: 1,
  updated_at: new Date().toISOString(),
  snapshot: create_painter_document(4, 4, { min_z: 0, max_z: 0, default_group_name: 'Solo' }),
});
let lastGroupDeleteFailed = false;
try {
  apply_painter_group_structure_command(slot, singleGroupDocumentId, {
    kind: 'delete_group',
    group_id: create_painter_document(1, 1, { min_z: 0, max_z: 0, default_group_name: 'Unused' }).group_order[0]!,
  });
} catch (error) {
  lastGroupDeleteFailed = error instanceof Error && error.message === 'painter_group_not_found';
}
assert(lastGroupDeleteFailed === true, 'delete_group should still reject missing groups before last-group semantics');

const soloDocument = create_painter_document(4, 4, { min_z: 0, max_z: 0, default_group_name: 'Solo 2' });
const soloGroupId = soloDocument.group_order[0]!;
const soloDocumentId2 = `painter_store_single_group_real_${Date.now()}`;
save_painter_document_snapshot(slot, {
  document_id: soloDocumentId2,
  revision: 1,
  updated_at: new Date().toISOString(),
  snapshot: soloDocument,
});
let deleteLastGroupRejected = false;
try {
  apply_painter_group_structure_command(slot, soloDocumentId2, {
    kind: 'delete_group',
    group_id: soloGroupId,
  });
} catch (error) {
  deleteLastGroupRejected = error instanceof Error && error.message === 'painter_last_group_delete_forbidden';
}
assert(deleteLastGroupRejected, 'delete_group should reject deleting the final remaining group');

console.log('painter_document_store tests passed');
