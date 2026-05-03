import {
  create_painter_document,
  create_painter_group,
  create_painter_voxel_record,
  get_painter_group_content_state_at_breath,
  make_painter_coord_key,
} from './painter_document.js';
import {
  blank_painter_group_raster_segment,
  export_painter_document,
  get_active_painter_property_block_at_breath,
  get_exact_painter_property_block,
  get_painter_group_properties_by_kind,
  is_painter_group_active_at_breath,
  move_painter_group_raster_segment,
  move_painter_group_property_block,
  normalize_painter_document_runtime,
  offset_painter_group_in_time,
  remove_painter_group,
  reorder_painter_groups,
  resolve_painter_group_location_at_breath,
  resolve_painter_group_property_blocks_at_breath,
  resolve_painter_voxel_winner,
  set_group_voxel,
  set_group_voxel_at_breath,
  set_painter_group_content_state,
  set_painter_group_location_key,
  set_painter_group_property_block,
  set_painter_group_raster_segment_edge_destructive,
  set_painter_group_visibility,
  set_painter_group_breath_span,
  set_painter_runtime_active_breath,
  swap_painter_group_raster_segments,
  erase_group_voxel,
  erase_group_voxel_at_breath,
} from './painter_document_runtime.js';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function getFirstRasterPropertyBlocks(group: ReturnType<typeof create_painter_group>): ReturnType<typeof get_painter_group_properties_by_kind>[number]['blocks'] {
  const property = get_painter_group_properties_by_kind(group, 'raster')[0]!;
  return property.blocks;
}

function assertRasterBlocksDoNotOverlap(group: ReturnType<typeof create_painter_group>, message: string): void {
  const blocks = [...getFirstRasterPropertyBlocks(group)].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let index = 1; index < blocks.length; index += 1) {
    assert(blocks[index - 1]!.end < blocks[index]!.start, message);
  }
}

const document = create_painter_document(20, 10, { min_z: -2, max_z: 2, default_group_name: 'Base' });
const baseGroupId = document.group_order[0]!;
const topGroup = create_painter_group('Top');
document.groups[topGroup.id] = topGroup;
document.group_order.push(topGroup.id);

const runtime = normalize_painter_document_runtime(document);
const key = make_painter_coord_key(2, 3, 1);

const spanHoldGroup = create_painter_group('Span Hold', { breath_start: 2, breath_end: 8 });
spanHoldGroup.start = 2;
spanHoldGroup.cropped_start = 2;
spanHoldGroup.cropped_end = 8;
spanHoldGroup.breath_start = 2;
spanHoldGroup.breath_end = 8;
spanHoldGroup.properties.raster_1!.blocks = [
  {
    id: 'state_a',
    type: 'content',
    start: 2,
    end: 5,
    value: { kind: 'raster', voxels: [create_painter_voxel_record({ x: 0, y: 0, z: 0, char: 'S', rgb: { r: 255, g: 255, b: 255 }, weight_index: 1 })] },
  },
  {
    id: 'state_b',
    type: 'content',
    start: 6,
    end: 8,
    value: { kind: 'raster', voxels: [create_painter_voxel_record({ x: 0, y: 0, z: 0, char: 'T', rgb: { r: 255, g: 0, b: 0 }, weight_index: 1 })] },
  },
];
assert(get_painter_group_content_state_at_breath(spanHoldGroup, 1) === null, 'group content should not resolve before group span start');
assert(get_painter_group_content_state_at_breath(spanHoldGroup, 2)?.content[0]?.char === 'S', 'first content block should hold from group span start');
assert(get_painter_group_content_state_at_breath(spanHoldGroup, 5)?.content[0]?.char === 'S', 'first content block should continue holding until a later block takes over');
assert(get_painter_group_content_state_at_breath(spanHoldGroup, 6)?.content[0]?.char === 'T', 'later content block should take over at its authored start');
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

set_painter_group_location_key(runtime, baseGroupId, 3, { x: 2, y: 0, z: 0 });
const beforeSpanState = structuredClone(runtime.document.groups[baseGroupId]!);
offset_painter_group_in_time(runtime, baseGroupId, 4);
assert(runtime.document.groups[baseGroupId]?.start === 4, 'offset_painter_group_in_time should move group start');
assert(runtime.document.groups[baseGroupId]?.cropped_start === 4 && runtime.document.groups[baseGroupId]?.cropped_end === 7, 'offset_painter_group_in_time should move property-derived cropped group range');
assert(get_painter_group_properties_by_kind(runtime.document.groups[baseGroupId]!, 'move')[0]?.blocks[0]?.start === 7, 'offset_painter_group_in_time should move move block starts');
set_painter_group_breath_span(runtime, baseGroupId, 0, 9);
assert(runtime.document.groups[baseGroupId]?.breath_start === 0 && runtime.document.groups[baseGroupId]?.breath_end === 9, 'set_painter_group_breath_span should update authored group span');
assert(get_painter_group_content_state_at_breath(runtime.document.groups[baseGroupId]!, 4)?.content.length === get_painter_group_content_state_at_breath(beforeSpanState, 0)?.content.length, 'set_painter_group_breath_span should preserve raster content payload');
assert(is_painter_group_active_at_breath(runtime.document.groups[baseGroupId]!, 4) === true, 'group should be active at updated span interior breath');
assert(is_painter_group_active_at_breath(runtime.document.groups[baseGroupId]!, 10) === false, 'group should be inactive outside updated span');

const contentSplitDocument = create_painter_document(8, 8, { default_group_name: 'Split Test' });
const contentSplitGroupId = contentSplitDocument.group_order[0]!;
contentSplitDocument.groups[contentSplitGroupId]!.cropped_end = 4;
contentSplitDocument.groups[contentSplitGroupId]!.breath_end = 4;
contentSplitDocument.groups[contentSplitGroupId]!.properties.raster_1!.blocks = [
  {
    id: 'split_source',
    type: 'content',
    start: 0,
    end: 4,
    value: { kind: 'raster', voxels: [create_painter_voxel_record({ x: 0, y: 0, z: 0, char: 'A', rgb: { r: 255, g: 255, b: 255 }, weight_index: 1 })] },
  },
];
const contentSplitRuntime = normalize_painter_document_runtime(contentSplitDocument);
set_painter_group_content_state(contentSplitRuntime, contentSplitGroupId, 2, [
  create_painter_voxel_record({ x: 0, y: 0, z: 0, char: 'B', rgb: { r: 255, g: 0, b: 0 }, weight_index: 1 }),
]);
const splitBlocks = get_painter_group_properties_by_kind(contentSplitRuntime.document.groups[contentSplitGroupId]!, 'raster')[0]!.blocks;
assert(splitBlocks.length === 2, 'setting content at an interior breath should split the active content block');
assert(splitBlocks[0]!.start === 0 && splitBlocks[0]!.end === 1, 'splitting content block should keep the left segment duration');
assert(splitBlocks[1]!.start === 2 && splitBlocks[1]!.end === 4, 'splitting content block should assign the remaining duration to the new right segment');
assert(splitBlocks[0]!.type === 'content' && splitBlocks[1]!.type === 'content' && splitBlocks[0]!.id !== splitBlocks[1]!.id, 'splitting identical raster content should preserve two distinct authored content blocks');
assert(get_painter_group_content_state_at_breath(contentSplitRuntime.document.groups[contentSplitGroupId]!, 1)?.content[0]?.char === 'A', 'breaths before the split should keep the original content');
assert(get_painter_group_content_state_at_breath(contentSplitRuntime.document.groups[contentSplitGroupId]!, 2)?.content[0]?.char === 'B', 'breaths at the split should resolve to the inserted content block');

const heldEditDocument = create_painter_document(8, 8, { default_group_name: 'Held Edit' });
const heldEditGroupId = heldEditDocument.group_order[0]!;
heldEditDocument.groups[heldEditGroupId]!.cropped_end = 4;
heldEditDocument.groups[heldEditGroupId]!.breath_end = 4;
heldEditDocument.groups[heldEditGroupId]!.properties.raster_1!.blocks = [
  {
    id: 'held_block',
    type: 'content',
    start: 0,
    end: 4,
    value: { kind: 'raster', voxels: [create_painter_voxel_record({ x: 1, y: 1, z: 0, char: 'H', rgb: { r: 255, g: 255, b: 255 }, weight_index: 1 })] },
  },
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
assert(get_painter_group_properties_by_kind(heldEditRuntime.document.groups[heldEditGroupId]!, 'raster')[0]!.blocks.length === 1, 'editing visible held raster content should mutate the viewed block instead of creating a new block');
assert(get_painter_group_content_state_at_breath(heldEditRuntime.document.groups[heldEditGroupId]!, 0)?.content.some((voxel) => voxel.char === 'I') === true, 'editing a held matrix should update the shared viewed content block');

const autoKeyDocument = create_painter_document(8, 8, { default_group_name: 'Auto Key Create' });
const autoKeyGroupId = autoKeyDocument.group_order[0]!;
autoKeyDocument.groups[autoKeyGroupId]!.start = 2;
autoKeyDocument.groups[autoKeyGroupId]!.cropped_start = 2;
autoKeyDocument.groups[autoKeyGroupId]!.cropped_end = 4;
autoKeyDocument.groups[autoKeyGroupId]!.breath_start = 2;
autoKeyDocument.groups[autoKeyGroupId]!.breath_end = 4;
autoKeyDocument.groups[autoKeyGroupId]!.properties.raster_1!.blocks = [{ id: 'auto_blank', type: 'blank', start: 2, end: 4, mode: 'clip', left_boundary: 'clip', right_boundary: 'clip' }];
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
assert(createdBlank.applied === true, 'auto-key drawing should create a block when no raster content is visible');
const autoBlocks = get_painter_group_properties_by_kind(autoKeyRuntime.document.groups[autoKeyGroupId]!, 'raster')[0]!.blocks;
assert(autoBlocks.length === 3, 'auto-key drawing into a blank span should isolate a one-breath content block');
assert(autoBlocks[1]!.start === 3 && autoBlocks[1]!.end === 3, 'auto-key block creation should create a one-breath content block');
assert(get_painter_group_content_state_at_breath(autoKeyRuntime.document.groups[autoKeyGroupId]!, 3)?.content[0]?.char === 'X', 'newly auto-keyed block should hold the painted content at the current breath');
const rejectedErase = erase_group_voxel_at_breath(autoKeyRuntime, autoKeyGroupId, 1, make_painter_coord_key(0, 0, 0));
assert(rejectedErase.applied === false, 'erasing with no visible raster content should reject instead of creating a block');

const propertyMoveDocument = create_painter_document(8, 8, { default_group_name: 'Property Move' });
const propertyMoveGroupId = propertyMoveDocument.group_order[0]!;
const propertyMoveRuntime = normalize_painter_document_runtime(propertyMoveDocument);
const createdMoveProperty = set_painter_group_property_block(propertyMoveRuntime, propertyMoveGroupId, {
  property_kind: 'move',
  property_label: 'move',
  breath: 2,
  value: { kind: 'vec3', x: 1, y: 0, z: 0 },
});
set_painter_group_property_block(propertyMoveRuntime, propertyMoveGroupId, {
  property_kind: 'move',
  property_id: createdMoveProperty.property_id,
  property_label: 'move',
  breath: 5,
  value: { kind: 'vec3', x: 3, y: 0, z: 0 },
});
const moveProperty = get_painter_group_properties_by_kind(propertyMoveRuntime.document.groups[propertyMoveGroupId]!, 'move')[0]!;
const exactMoveBlock = get_exact_painter_property_block(moveProperty, 2);
assert(exactMoveBlock?.id, 'property block setter should create an exact move block');
assert(resolve_painter_group_location_at_breath(propertyMoveRuntime.document.groups[propertyMoveGroupId]!, 4).x === 1, 'property block setter should hold move values through the block span');
move_painter_group_property_block(propertyMoveRuntime, propertyMoveGroupId, {
  property_id: moveProperty.id,
  block_id: exactMoveBlock!.id,
  target_breath: 4,
});
const movedProperty = get_painter_group_properties_by_kind(propertyMoveRuntime.document.groups[propertyMoveGroupId]!, 'move')[0]!;
assert(get_exact_painter_property_block(movedProperty, 2) === null, 'property block move should clear the original start breath');
assert(get_exact_painter_property_block(movedProperty, 4)?.type === 'content', 'property block move should create a new exact start breath');
assert(resolve_painter_group_location_at_breath(propertyMoveRuntime.document.groups[propertyMoveGroupId]!, 3).x === 0, 'moving the first move property block should update pre-block evaluation');
assert(resolve_painter_group_location_at_breath(propertyMoveRuntime.document.groups[propertyMoveGroupId]!, 4).x === 1, 'moving the first move property block should update the new block start');
assert(resolve_painter_group_property_blocks_at_breath(propertyMoveRuntime.document.groups[propertyMoveGroupId]!, 4, 'move').length === 1, 'group property block resolution should include active move blocks');

const blankClipDocument = create_painter_document(8, 8, { default_group_name: 'Blank Clip' });
const blankClipGroupId = blankClipDocument.group_order[0]!;
blankClipDocument.groups[blankClipGroupId]!.start = 0;
blankClipDocument.groups[blankClipGroupId]!.cropped_start = 0;
blankClipDocument.groups[blankClipGroupId]!.cropped_end = 3;
blankClipDocument.groups[blankClipGroupId]!.breath_start = 0;
blankClipDocument.groups[blankClipGroupId]!.breath_end = 3;
blankClipDocument.groups[blankClipGroupId]!.properties.raster_1!.blocks = [
  {
    id: 'clip_content',
    type: 'content',
    start: 0,
    end: 0,
    value: { kind: 'raster', voxels: [create_painter_voxel_record({ x: 0, y: 0, z: 0, char: 'C', rgb: { r: 255, g: 255, b: 255 }, weight_index: 1 })] },
  },
  { id: 'clip_gap', type: 'blank', start: 1, end: 3, mode: 'clip', left_boundary: 'clip', right_boundary: 'clip' },
];
assert(get_painter_group_content_state_at_breath(blankClipDocument.groups[blankClipGroupId]!, 2)?.content.length === 0, 'clip blank spans should contribute no raster content');

const rasterResizeDocument = create_painter_document(8, 8, { default_group_name: 'Raster Resize' });
const rasterResizeGroupId = rasterResizeDocument.group_order[0]!;
const rasterResizeRuntime = normalize_painter_document_runtime(rasterResizeDocument);
const resizeVoxel = create_painter_voxel_record({ x: 0, y: 0, z: 0, char: 'R', rgb: { r: 255, g: 255, b: 255 }, weight_index: 1 });
set_painter_group_content_state(rasterResizeRuntime, rasterResizeGroupId, 0, [resizeVoxel]);
const resizeBlockId = get_painter_group_properties_by_kind(rasterResizeRuntime.document.groups[rasterResizeGroupId]!, 'raster')[0]!.blocks[0]!.id;
set_painter_group_raster_segment_edge_destructive(rasterResizeRuntime, rasterResizeGroupId, resizeBlockId, 'end', 5);
let resizedGroup = rasterResizeRuntime.document.groups[rasterResizeGroupId]!;
let resizedBlock = get_painter_group_properties_by_kind(resizedGroup, 'raster')[0]!.blocks[0]!;
assert(resizedBlock.start === 0 && resizedBlock.end === 5, 'destructive end resize should expand a single content block across the full requested span');
assert(get_painter_group_content_state_at_breath(resizedGroup, 5)?.content[0]?.char === 'R', 'expanded destructive end resize should preserve content at the new end');
set_painter_group_raster_segment_edge_destructive(rasterResizeRuntime, rasterResizeGroupId, resizeBlockId, 'start', 3);
resizedGroup = rasterResizeRuntime.document.groups[rasterResizeGroupId]!;
resizedBlock = get_painter_group_properties_by_kind(resizedGroup, 'raster')[0]!.blocks[0]!;
assert(resizedGroup.start === 3, 'destructive start resize should move the group start when trimming from the left');
assert(resizedBlock.start === 3 && resizedBlock.end === 5, 'destructive start resize should shrink the content block to the requested remaining span');
assert(get_painter_group_content_state_at_breath(resizedGroup, 2) === null, 'destructive start resize should remove content before the requested new start');

const overlapResizeDocument = create_painter_document(8, 8, { default_group_name: 'Overlap Resize' });
const overlapResizeGroupId = overlapResizeDocument.group_order[0]!;
overlapResizeDocument.groups[overlapResizeGroupId]!.properties.raster_1!.blocks = [
  { id: 'resize_a', type: 'content', start: 0, end: 1, value: { kind: 'raster', voxels: [create_painter_voxel_record({ x: 0, y: 0, z: 0, char: 'A', rgb: { r: 255, g: 255, b: 255 }, weight_index: 1 })] } },
  { id: 'resize_b', type: 'content', start: 3, end: 4, value: { kind: 'raster', voxels: [create_painter_voxel_record({ x: 0, y: 0, z: 0, char: 'B', rgb: { r: 255, g: 255, b: 255 }, weight_index: 1 })] } },
];
const overlapResizeRuntime = normalize_painter_document_runtime(overlapResizeDocument);
set_painter_group_raster_segment_edge_destructive(overlapResizeRuntime, overlapResizeGroupId, 'resize_a', 'end', 4);
const overlapResizedGroup = overlapResizeRuntime.document.groups[overlapResizeGroupId]!;
assertRasterBlocksDoNotOverlap(overlapResizedGroup, 'destructive resize should not leave overlapping raster blocks');
assert(get_painter_group_content_state_at_breath(overlapResizedGroup, 4)?.content[0]?.char === 'A', 'destructive resize should overwrite claimed content span');

const overlapMoveDocument = create_painter_document(8, 8, { default_group_name: 'Overlap Move' });
const overlapMoveGroupId = overlapMoveDocument.group_order[0]!;
overlapMoveDocument.groups[overlapMoveGroupId]!.properties.raster_1!.blocks = [
  { id: 'move_a', type: 'content', start: 0, end: 1, value: { kind: 'raster', voxels: [create_painter_voxel_record({ x: 0, y: 0, z: 0, char: 'A', rgb: { r: 255, g: 255, b: 255 }, weight_index: 1 })] } },
  { id: 'move_b', type: 'content', start: 3, end: 5, value: { kind: 'raster', voxels: [create_painter_voxel_record({ x: 0, y: 0, z: 0, char: 'B', rgb: { r: 255, g: 255, b: 255 }, weight_index: 1 })] } },
];
const overlapMoveRuntime = normalize_painter_document_runtime(overlapMoveDocument);
move_painter_group_raster_segment(overlapMoveRuntime, overlapMoveGroupId, 'move_a', 4);
const overlapMovedGroup = overlapMoveRuntime.document.groups[overlapMoveGroupId]!;
assertRasterBlocksDoNotOverlap(overlapMovedGroup, 'destructive move should not leave overlapping raster blocks');
assert(get_painter_group_content_state_at_breath(overlapMovedGroup, 3)?.content[0]?.char === 'B', 'destructive move should preserve unclaimed content before the moved span');
assert(get_painter_group_content_state_at_breath(overlapMovedGroup, 4)?.content[0]?.char === 'A', 'destructive move should overwrite the claimed destination span');

const swapDocument = create_painter_document(8, 8, { default_group_name: 'Swap Content' });
const swapGroupId = swapDocument.group_order[0]!;
swapDocument.groups[swapGroupId]!.properties.raster_1!.blocks = [
  { id: 'swap_a', type: 'content', start: 0, end: 1, value: { kind: 'raster', voxels: [create_painter_voxel_record({ x: 0, y: 0, z: 0, char: 'A', rgb: { r: 255, g: 255, b: 255 }, weight_index: 1 })] } },
  { id: 'swap_b', type: 'content', start: 3, end: 5, value: { kind: 'raster', voxels: [create_painter_voxel_record({ x: 0, y: 0, z: 0, char: 'B', rgb: { r: 255, g: 255, b: 255 }, weight_index: 1 })] } },
];
const swapRuntime = normalize_painter_document_runtime(swapDocument);
swap_painter_group_raster_segments(swapRuntime, swapGroupId, 'swap_a', 'swap_b');
const swappedGroup = swapRuntime.document.groups[swapGroupId]!;
assert(get_painter_group_content_state_at_breath(swappedGroup, 0)?.content[0]?.char === 'B', 'content/content swap should move target content into the source span');
assert(get_painter_group_content_state_at_breath(swappedGroup, 3)?.content[0]?.char === 'A', 'content/content swap should move source content into the target span');
assertRasterBlocksDoNotOverlap(swappedGroup, 'content/content swap should not leave overlapping raster blocks');

const blankSwapDocument = create_painter_document(8, 8, { default_group_name: 'Blank Swap' });
const blankSwapGroupId = blankSwapDocument.group_order[0]!;
blankSwapDocument.groups[blankSwapGroupId]!.cropped_end = 4;
blankSwapDocument.groups[blankSwapGroupId]!.breath_end = 4;
blankSwapDocument.groups[blankSwapGroupId]!.properties.raster_1!.blocks = [
  { id: 'guard_content', type: 'content', start: 0, end: 1, value: { kind: 'raster', voxels: [create_painter_voxel_record({ x: 0, y: 0, z: 0, char: 'C', rgb: { r: 255, g: 255, b: 255 }, weight_index: 1 })] } },
  { id: 'guard_blank', type: 'blank', start: 2, end: 4, mode: 'clip', left_boundary: 'clip', right_boundary: 'clip' },
];
const blankSwapRuntime = normalize_painter_document_runtime(blankSwapDocument);
const blankSwapBefore = { start: blankSwapRuntime.document.groups[blankSwapGroupId]!.start, end: blankSwapRuntime.document.groups[blankSwapGroupId]!.breath_end };
swap_painter_group_raster_segments(blankSwapRuntime, blankSwapGroupId, 'guard_blank', 'guard_content');
const blankSwapGroup = blankSwapRuntime.document.groups[blankSwapGroupId]!;
const blankSwapBlocks = get_painter_group_properties_by_kind(blankSwapGroup, 'raster')[0]!.blocks;
assert(blankSwapBlocks.length === 1 && blankSwapBlocks[0]!.id === 'guard_content' && blankSwapBlocks[0]!.start === 2 && blankSwapBlocks[0]!.end === 4, 'blank/content swap should delete blank when it lands on an edge');
assert(get_painter_group_content_state_at_breath(blankSwapGroup, 2)?.content[0]?.char === 'C', 'old blank span should receive content after blank/content swap');
assert(blankSwapGroup.start === 2 && blankSwapGroup.breath_end === blankSwapBefore.end, 'edge blank deletion should trim group start to remaining content');
assertRasterBlocksDoNotOverlap(blankSwapGroup, 'blank/content swap should not leave overlapping raster blocks');

const blankedRuntime = normalize_painter_document_runtime(create_painter_document(8, 8, { default_group_name: 'Blank Segment' }));
const blankedGroupId = blankedRuntime.document.group_order[0]!;
set_painter_group_content_state(blankedRuntime, blankedGroupId, 0, [create_painter_voxel_record({ x: 0, y: 0, z: 0, char: 'Q', rgb: { r: 255, g: 255, b: 255 }, weight_index: 1 })]);
const blankedBlockId = get_painter_group_properties_by_kind(blankedRuntime.document.groups[blankedGroupId]!, 'raster')[0]!.blocks[0]!.id;
blank_painter_group_raster_segment(blankedRuntime, blankedGroupId, blankedBlockId);
assert(get_painter_group_content_state_at_breath(blankedRuntime.document.groups[blankedGroupId]!, 0)?.content.length === 0, 'blanking a raster segment should replace it with a clip blank span');

const exported = export_painter_document(runtime);
assert(exported.occupied_bounds?.minX === 2, 'occupied bounds should track minX');
assert(exported.occupied_bounds?.maxZ === 1, 'occupied bounds should track maxZ');
assert(exported.bounds.minX === 2 && exported.bounds.minY === 3, 'document bounds should snap to authored content min x/y');
assert(exported.bounds.width === 1 && exported.bounds.height === 1, 'single authored coordinate should produce single-cell x/y extents');
assert(exported.bounds.minZ === 1 && exported.bounds.maxZ === 1, 'document bounds should snap to authored content z extent');

set_group_voxel(runtime, topGroup.id, create_painter_voxel_record({ x: -2, y: -1, z: -3, char: 'N', rgb: { r: 0, g: 255, b: 255 }, weight_index: 1 }));
set_group_voxel(runtime, topGroup.id, create_painter_voxel_record({ x: 5, y: 4, z: 6, char: 'P', rgb: { r: 255, g: 255, b: 0 }, weight_index: 1 }));

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

set_group_voxel(runtime, topGroup.id, create_painter_voxel_record({ x: 7, y: 8, z: 9, char: 'Q', rgb: { r: 255, g: 0, b: 255 }, weight_index: 1 }));
remove_painter_group(runtime, topGroup.id);

const afterGroupDelete = export_painter_document(runtime);
assert(afterGroupDelete.bounds.width === 1 && afterGroupDelete.bounds.height === 1, 'deleting the last authored group should return to minimal bounds');
assert(afterGroupDelete.bounds.minZ === 0 && afterGroupDelete.bounds.maxZ === 0, 'deleting the last authored group should return to minimal z bounds');

console.log('painter_document_runtime tests passed');
