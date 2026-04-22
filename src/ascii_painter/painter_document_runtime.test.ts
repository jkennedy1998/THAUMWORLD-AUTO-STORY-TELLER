import {
  create_painter_document,
  create_painter_group,
  create_painter_voxel_record,
  make_painter_coord_key,
} from './painter_document.js';
import {
  erase_group_voxel,
  export_painter_document,
  normalize_painter_document_runtime,
  reorder_painter_groups,
  resolve_painter_voxel_winner,
  set_group_voxel,
  set_painter_group_visibility,
} from './painter_document_runtime.js';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const document = create_painter_document(20, 10, { min_z: -2, max_z: 2, default_group_name: 'Base' });
const baseGroupId = document.group_order[0]!;
const topGroup = create_painter_group('Top');
document.groups[topGroup.id] = topGroup;
document.group_order.push(topGroup.id);

const runtime = normalize_painter_document_runtime(document);
const key = make_painter_coord_key(2, 3, 1);

set_group_voxel(runtime, baseGroupId, create_painter_voxel_record({
  x: 2,
  y: 3,
  z: 1,
  char: 'A',
  rgb: { r: 255, g: 255, b: 255 },
  weight_index: 1,
}));
set_group_voxel(runtime, topGroup.id, create_painter_voxel_record({
  x: 2,
  y: 3,
  z: 1,
  char: 'B',
  rgb: { r: 255, g: 0, b: 0 },
  weight_index: 2,
}));

let winner = resolve_painter_voxel_winner(runtime, key);
assert(winner.winning_group_id === topGroup.id, 'top group should win overlap by order');
assert(winner.cell?.char === 'B', 'top overlap winner should expose top char');
assert(runtime.group_voxel_index.get(baseGroupId)?.get(key)?.char === 'A', 'writing to top group should preserve lower group authored voxel data');

set_painter_group_visibility(runtime, topGroup.id, false);
winner = resolve_painter_voxel_winner(runtime, key);
assert(winner.winning_group_id === baseGroupId, 'hidden top group should reveal lower group');
assert(winner.cell?.char === 'A', 'lower group should become visible after hide');

set_painter_group_visibility(runtime, topGroup.id, true);
reorder_painter_groups(runtime, [topGroup.id, baseGroupId]);
winner = resolve_painter_voxel_winner(runtime, key);
assert(winner.winning_group_id === baseGroupId, 'reorder should change exact-coordinate winner');

erase_group_voxel(runtime, baseGroupId, key);
winner = resolve_painter_voxel_winner(runtime, key);
assert(winner.winning_group_id === topGroup.id, 'erasing lower group should leave top winner');

const exported = export_painter_document(runtime);
assert(exported.occupied_bounds?.minX === 2, 'occupied bounds should track minX');
assert(exported.occupied_bounds?.maxZ === 1, 'occupied bounds should track maxZ');
assert(exported.bounds.minX === 0 && exported.bounds.minY === 0, 'document bounds should remain stable after authored edits');
assert(exported.bounds.width === 20 && exported.bounds.height === 10, 'document bounds should retain original width and height');
assert(exported.bounds.minZ === -2 && exported.bounds.maxZ === 2, 'document bounds should retain original z range');

set_group_voxel(runtime, topGroup.id, create_painter_voxel_record({
  x: -2,
  y: -1,
  z: -3,
  char: 'N',
  rgb: { r: 0, g: 255, b: 255 },
  weight_index: 1,
}));
set_group_voxel(runtime, topGroup.id, create_painter_voxel_record({
  x: 5,
  y: 4,
  z: 6,
  char: 'P',
  rgb: { r: 255, g: 255, b: 0 },
  weight_index: 1,
}));

const expanded = export_painter_document(runtime);
assert(expanded.occupied_bounds?.minX === -2 && expanded.occupied_bounds?.minY === -1, 'occupied bounds should expand toward negative x/y when authored voxels are added there');
assert(expanded.occupied_bounds?.minZ === -3 && expanded.occupied_bounds?.maxZ === 6, 'occupied bounds should expand across authored voxel depth');
assert(expanded.bounds.minX === 0 && expanded.bounds.minY === 0, 'document bounds should stay stable even after far authored edits');
assert(expanded.bounds.width === 20 && expanded.bounds.height === 10, 'document bounds should keep original width/height after far edits');
assert(expanded.bounds.minZ === -2 && expanded.bounds.maxZ === 2, 'document bounds should keep original z range after far edits');

console.log('painter_document_runtime tests passed');
