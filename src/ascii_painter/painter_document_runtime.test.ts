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
  remove_painter_group,
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

assert(runtime.document.bounds.minX === 0 && runtime.document.bounds.minY === 0, 'empty document should start at minimal origin bounds');
assert(runtime.document.bounds.width === 1 && runtime.document.bounds.height === 1, 'empty document should start with minimal width and height');
assert(runtime.document.bounds.minZ === 0 && runtime.document.bounds.maxZ === 0, 'empty document should start with minimal z extent');

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
assert(exported.bounds.minX === 2 && exported.bounds.minY === 3, 'document bounds should snap to authored content min x/y');
assert(exported.bounds.width === 1 && exported.bounds.height === 1, 'single authored coordinate should produce single-cell x/y extents');
assert(exported.bounds.minZ === 1 && exported.bounds.maxZ === 1, 'document bounds should snap to authored content z extent');

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
assert(expanded.bounds.minX === -2 && expanded.bounds.minY === -1, 'document bounds should expand toward authored negative extents');
assert(expanded.bounds.width === 8 && expanded.bounds.height === 6, 'document bounds should span authored x/y content extents');
assert(expanded.bounds.minZ === -3 && expanded.bounds.maxZ === 6, 'document bounds should span authored depth extents');

erase_group_voxel(runtime, topGroup.id, make_painter_coord_key(-2, -1, -3));
erase_group_voxel(runtime, topGroup.id, make_painter_coord_key(5, 4, 6));
erase_group_voxel(runtime, topGroup.id, key);

const shrunk = export_painter_document(runtime);
assert(shrunk.bounds.minX === 0 && shrunk.bounds.minY === 0, 'empty authored content should fall back to minimal x/y origin bounds');
assert(shrunk.bounds.width === 1 && shrunk.bounds.height === 1, 'empty authored content should fall back to minimal width and height');
assert(shrunk.bounds.minZ === 0 && shrunk.bounds.maxZ === 0, 'empty authored content should fall back to minimal z extent');
assert(shrunk.occupied_bounds === null, 'empty authored content should clear occupied bounds');

set_group_voxel(runtime, topGroup.id, create_painter_voxel_record({
  x: 7,
  y: 8,
  z: 9,
  char: 'Q',
  rgb: { r: 255, g: 0, b: 255 },
  weight_index: 1,
}));
remove_painter_group(runtime, topGroup.id);

const afterGroupDelete = export_painter_document(runtime);
assert(afterGroupDelete.bounds.width === 1 && afterGroupDelete.bounds.height === 1, 'deleting the last authored group should return to minimal bounds');
assert(afterGroupDelete.bounds.minZ === 0 && afterGroupDelete.bounds.maxZ === 0, 'deleting the last authored group should return to minimal z bounds');

console.log('painter_document_runtime tests passed');
