import { create_painter_document } from './painter_document.js';
import { create_painter_session_core } from './painter_session_core.js';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const document = create_painter_document(4, 4);
const session = create_painter_session_core(document);
const state0 = session.get_state();
const group_id = state0.runtime.document.group_order[0]!;
session.apply_group_command({ kind: 'add_group_property', group_id, property_kind: 'raster', property_label: 'Raster' });

const change_result = session.apply_cell_changes(group_id, 0, [{
  worldX: 1,
  worldY: 2,
  worldZ: 0,
  newCell: {
    char: '@',
    graphic: { graphic_id: 'tile_test', view_direction: 'south', weight_index: 2 },
    appearance_slots: { 1: { kind: 'flat_rgb', rgb: { r: 7, g: 8, b: 9 } } },
    materials: { 1: 'STONE_PALE' },
    rgb: { r: 7, g: 8, b: 9 },
    weight_index: 2,
  },
}], { auto_key: true });

assert(change_result.applied, 'cell change should apply');
assert(change_result.history_changes[0]?.newCell.graphic?.graphic_id === 'tile_test', 'history changes should preserve graphic payload');
assert(change_result.history_changes[0]?.newCell.appearance_slots?.[1]?.kind === 'flat_rgb', 'history changes should preserve appearance slots');
assert(change_result.history_changes[0]?.newCell.materials?.[1] === 'STONE_PALE', 'history changes should preserve materials');

const state1 = session.get_state();
const voxel = state1.runtime.group_voxel_index.get(group_id)?.get('1:2:0');
assert(voxel?.graphic?.graphic_id === 'tile_test', 'runtime voxel write should preserve graphic payload');
assert(voxel?.appearance_slots?.[1]?.kind === 'flat_rgb', 'runtime voxel write should preserve appearance slots');
assert(voxel?.materials?.[1] === 'STONE_PALE', 'runtime voxel write should preserve materials');

const graphic_only_result = session.apply_cell_changes(group_id, 0, [{
  worldX: 2,
  worldY: 1,
  worldZ: 0,
  newCell: {
    char: ' ',
    graphic: { graphic_id: 'tile_graphic_only', view_direction: 'south', weight_index: 1 },
    appearance_slots: { 1: { kind: 'flat_rgb', rgb: { r: 10, g: 20, b: 30 } } },
    materials: undefined,
    rgb: { r: 10, g: 20, b: 30 },
    weight_index: 1,
  },
}], { auto_key: true });

assert(graphic_only_result.applied, 'graphic-only cell change should apply');
const graphic_only_voxel = session.get_state().runtime.group_voxel_index.get(group_id)?.get('2:1:0');
assert(graphic_only_voxel?.graphic?.graphic_id === 'tile_graphic_only', 'graphic-only voxel should not be erased just because char is space');
assert(graphic_only_voxel?.appearance_slots?.[1]?.kind === 'flat_rgb', 'graphic-only voxel should preserve appearance slots');

console.log('painter_session_core tests passed');
