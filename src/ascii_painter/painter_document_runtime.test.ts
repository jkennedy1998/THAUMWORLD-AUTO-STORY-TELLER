import {
  create_painter_document,
  create_painter_group,
  create_painter_voxel_record,
  get_painter_group_content_state_at_breath,
  make_painter_coord_key,
} from './painter_document.js';
import {
  erase_group_voxel,
  erase_group_voxel_at_breath,
  offset_painter_group_in_time,
  export_painter_document,
  is_painter_group_active_at_breath,
  normalize_painter_document_runtime,
  remove_painter_group,
  reorder_painter_groups,
  resolve_painter_group_location_at_breath,
  resolve_painter_voxel_winner,
  set_group_voxel,
  set_group_voxel_at_breath,
  set_painter_group_content_state,
  set_painter_group_breath_span,
  set_painter_group_location_key,
  set_painter_runtime_active_breath,
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

const spanHoldGroup = create_painter_group('Span Hold', { breath_start: 2, breath_end: 8 });
spanHoldGroup.content_states = [
  {
    ...spanHoldGroup.content_states[0]!,
    index: 0,
    length_breaths: 4,
    content: [create_painter_voxel_record({ x: 0, y: 0, z: 0, char: 'S', rgb: { r: 255, g: 255, b: 255 }, weight_index: 1 })],
  },
  {
    ...spanHoldGroup.content_states[0]!,
    id: 'later_state',
    label: 'State 2',
    index: 1,
    length_breaths: 3,
    content: [create_painter_voxel_record({ x: 0, y: 0, z: 0, char: 'T', rgb: { r: 255, g: 0, b: 0 }, weight_index: 1 })],
  },
];
assert(get_painter_group_content_state_at_breath(spanHoldGroup, 1) === null, 'group content should not resolve before group span start');
assert(get_painter_group_content_state_at_breath(spanHoldGroup, 2)?.content[0]?.char === 'S', 'first content state should hold from group span start');
assert(get_painter_group_content_state_at_breath(spanHoldGroup, 5)?.content[0]?.char === 'S', 'first content state should continue holding until a later state takes over');
assert(get_painter_group_content_state_at_breath(spanHoldGroup, 6)?.content[0]?.char === 'T', 'later content state should take over at its derived segment start');
assert(get_painter_group_content_state_at_breath(spanHoldGroup, 9) === null, 'group content should not resolve after group span end');

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

runtime.document.groups[baseGroupId]!.location_keys.push({ breath: 3, offset: { x: 2, y: 0, z: 0 } });
const beforeSpanState = structuredClone(runtime.document.groups[baseGroupId]!);
offset_painter_group_in_time(runtime, baseGroupId, 4);
assert(runtime.document.groups[baseGroupId]?.start === 4, 'offset_painter_group_in_time should move group start');
assert(runtime.document.groups[baseGroupId]?.cropped_start === 4 && runtime.document.groups[baseGroupId]?.cropped_end === 4, 'offset_painter_group_in_time should move cropped group range');
assert(runtime.document.groups[baseGroupId]?.location_keys[0]?.breath === 7, 'offset_painter_group_in_time should move all location key breaths');
set_painter_group_breath_span(runtime, baseGroupId, 0, 9);
assert(runtime.document.groups[baseGroupId]?.breath_start === 0 && runtime.document.groups[baseGroupId]?.breath_end === 9, 'set_painter_group_breath_span should update authored group span');
assert(runtime.document.groups[baseGroupId]?.content_states[0]?.content.length === beforeSpanState.content_states[0]?.content.length, 'set_painter_group_breath_span should preserve raster content payload');
assert(runtime.document.groups[baseGroupId]?.location_keys.length === beforeSpanState.location_keys.length, 'set_painter_group_breath_span should not mutate location keys');
assert(is_painter_group_active_at_breath(runtime.document.groups[baseGroupId]!, 4) === true, 'group should be active at updated span interior breath');
assert(is_painter_group_active_at_breath(runtime.document.groups[baseGroupId]!, 10) === false, 'group should be inactive outside updated span');

const contentSplitDocument = create_painter_document(8, 8, { default_group_name: 'Split Test' });
const contentSplitGroupId = contentSplitDocument.group_order[0]!;
contentSplitDocument.groups[contentSplitGroupId]!.cropped_end = 4;
contentSplitDocument.groups[contentSplitGroupId]!.breath_end = 4;
contentSplitDocument.groups[contentSplitGroupId]!.content_states[0]!.length_breaths = 5;
contentSplitDocument.groups[contentSplitGroupId]!.content_states[0]!.content = [
  create_painter_voxel_record({ x: 0, y: 0, z: 0, char: 'A', rgb: { r: 255, g: 255, b: 255 }, weight_index: 1 }),
];
const contentSplitRuntime = normalize_painter_document_runtime(contentSplitDocument);
set_painter_group_content_state(contentSplitRuntime, contentSplitGroupId, 2, [
  create_painter_voxel_record({ x: 0, y: 0, z: 0, char: 'B', rgb: { r: 255, g: 0, b: 0 }, weight_index: 1 }),
]);
assert(contentSplitRuntime.document.groups[contentSplitGroupId]!.content_states.length === 2, 'setting content state at an interior breath should split the active segment');
assert(contentSplitRuntime.document.groups[contentSplitGroupId]!.content_states[0]!.length_breaths === 2, 'splitting content state should keep the left segment duration');
assert(contentSplitRuntime.document.groups[contentSplitGroupId]!.content_states[1]!.length_breaths === 3, 'splitting content state should assign the remaining duration to the new right segment');
assert(get_painter_group_content_state_at_breath(contentSplitRuntime.document.groups[contentSplitGroupId]!, 1)?.content[0]?.char === 'A', 'breaths before the split should keep the original content');
assert(get_painter_group_content_state_at_breath(contentSplitRuntime.document.groups[contentSplitGroupId]!, 2)?.content[0]?.char === 'B', 'breaths at the split should resolve to the inserted content state');

const heldEditDocument = create_painter_document(8, 8, { default_group_name: 'Held Edit' });
const heldEditGroupId = heldEditDocument.group_order[0]!;
heldEditDocument.groups[heldEditGroupId]!.cropped_end = 4;
heldEditDocument.groups[heldEditGroupId]!.breath_end = 4;
heldEditDocument.groups[heldEditGroupId]!.content_states[0]!.length_breaths = 5;
heldEditDocument.groups[heldEditGroupId]!.content_states[0]!.content = [
  create_painter_voxel_record({ x: 1, y: 1, z: 0, char: 'H', rgb: { r: 255, g: 255, b: 255 }, weight_index: 1 }),
];
const heldEditRuntime = normalize_painter_document_runtime(heldEditDocument);
set_painter_runtime_active_breath(heldEditRuntime, 3);
set_group_voxel_at_breath(heldEditRuntime, heldEditGroupId, 3, create_painter_voxel_record({
  x: 2,
  y: 1,
  z: 0,
  char: 'I',
  rgb: { r: 0, g: 255, b: 0 },
  weight_index: 1,
}), { auto_key: false });
assert(heldEditRuntime.document.groups[heldEditGroupId]!.content_states.length === 1, 'editing visible held raster content should mutate the viewed matrix instead of creating a new frame');
assert(get_painter_group_content_state_at_breath(heldEditRuntime.document.groups[heldEditGroupId]!, 0)?.content.some((voxel) => voxel.char === 'I') === true, 'editing a held matrix should update the shared viewed content state');

const autoKeyDocument = create_painter_document(8, 8, { default_group_name: 'Auto Key Create' });
const autoKeyGroupId = autoKeyDocument.group_order[0]!;
autoKeyDocument.groups[autoKeyGroupId]!.start = 2;
autoKeyDocument.groups[autoKeyGroupId]!.cropped_start = 2;
autoKeyDocument.groups[autoKeyGroupId]!.cropped_end = 4;
autoKeyDocument.groups[autoKeyGroupId]!.breath_start = 2;
autoKeyDocument.groups[autoKeyGroupId]!.breath_end = 4;
autoKeyDocument.groups[autoKeyGroupId]!.content_states[0]!.length_breaths = 3;
autoKeyDocument.groups[autoKeyGroupId]!.content_states[0]!.content = [];
const autoKeyRuntime = normalize_painter_document_runtime(autoKeyDocument);
const rejectedBlank = set_group_voxel_at_breath(autoKeyRuntime, autoKeyGroupId, 3, create_painter_voxel_record({
  x: 0,
  y: 0,
  z: 0,
  char: 'X',
  rgb: { r: 255, g: 255, b: 0 },
  weight_index: 1,
}), { auto_key: false });
assert(rejectedBlank.applied === false, 'manual drawing without auto-key should reject when no raster content is visible');
const createdBlank = set_group_voxel_at_breath(autoKeyRuntime, autoKeyGroupId, 3, create_painter_voxel_record({
  x: 0,
  y: 0,
  z: 0,
  char: 'X',
  rgb: { r: 255, g: 255, b: 0 },
  weight_index: 1,
}), { auto_key: true });
assert(createdBlank.applied === true, 'auto-key drawing should create a frame when no raster content is visible');
assert(autoKeyRuntime.document.groups[autoKeyGroupId]!.content_states.length === 3, 'auto-key drawing into an empty held span should isolate a one-breath frame');
assert(autoKeyRuntime.document.groups[autoKeyGroupId]!.content_states[1]!.length_breaths === 1, 'auto-key frame creation should create a one-breath frame');
assert(get_painter_group_content_state_at_breath(autoKeyRuntime.document.groups[autoKeyGroupId]!, 3)?.content[0]?.char === 'X', 'newly auto-keyed frame should hold the painted content at the current breath');
const rejectedErase = erase_group_voxel_at_breath(autoKeyRuntime, autoKeyGroupId, 1, make_painter_coord_key(0, 0, 0));
assert(rejectedErase.applied === false, 'erasing with no visible raster content should reject instead of creating a frame');

const locationCleanupGroup = create_painter_group('Move Cleanup', { breath_start: 0, breath_end: 12 });
document.groups[locationCleanupGroup.id] = locationCleanupGroup;
document.group_order.push(locationCleanupGroup.id);
const cleanupRuntime = normalize_painter_document_runtime(document);
set_painter_group_location_key(cleanupRuntime, locationCleanupGroup.id, 6, { x: 4, y: 0, z: 0 });
assert(cleanupRuntime.document.groups[locationCleanupGroup.id]!.location_keys.length === 0, 'first move edit should update location_base without creating a hidden keyframe');
assert(cleanupRuntime.document.groups[locationCleanupGroup.id]!.location_base.x === 4, 'first move edit should update location_base');
set_painter_group_location_key(cleanupRuntime, locationCleanupGroup.id, 9, { x: 7, y: 0, z: 0 });
assert(cleanupRuntime.document.groups[locationCleanupGroup.id]!.location_keys.length === 1, 'second distinct move edit should create explicit move animation');
assert(cleanupRuntime.document.groups[locationCleanupGroup.id]!.location_keys[0]!.breath === 9, 'second distinct move edit should key at the edited breath');
assert(resolve_painter_group_location_at_breath(cleanupRuntime.document.groups[locationCleanupGroup.id]!, 8).x === 4, 'resolved move channel should hold location_base before the first explicit key');
assert(resolve_painter_group_location_at_breath(cleanupRuntime.document.groups[locationCleanupGroup.id]!, 9).x === 7, 'resolved move channel should switch at the explicit key');

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
