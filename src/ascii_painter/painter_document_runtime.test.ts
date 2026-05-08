import {
  create_painter_document,
  create_painter_group,
  create_painter_voxel_record,
  get_painter_group_raster_state_at_breath,
  make_painter_coord_key,
  type PainterProperty,
} from './painter_document.js';
import {
  add_painter_group_property,
  blank_painter_group_property_block,
  export_painter_document,
  get_active_painter_property_block_at_breath,
  get_exact_painter_property_block,
  get_painter_group_properties_by_kind,
  is_painter_group_active_at_breath,
  move_painter_group_property_block,
  normalize_painter_document_runtime,
  offset_painter_group_in_time,
  reorder_painter_groups,
  resolve_painter_group_location_at_breath,
  resolve_painter_group_property_blocks_at_breath,
  resolve_painter_voxel_winner,
  set_group_voxel,
  set_group_voxel_at_breath,
  set_painter_group_breath_span,
  set_painter_group_property_block,
  set_painter_group_property_block_edge_destructive,
  set_painter_group_raster_state,
  set_painter_group_visibility,
  set_painter_runtime_active_breath,
  split_painter_group_property_block,
  swap_painter_group_property_blocks,
  erase_group_voxel,
  erase_group_voxel_at_breath,
  set_painter_document_loop_window,
} from './painter_document_runtime.js';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function voxel(char: string, x = 0, y = 0, z = 0) {
  return create_painter_voxel_record({ x, y, z, char, rgb: { r: 255, g: 255, b: 255 }, weight_index: 1 });
}

function firstProperty(group: ReturnType<typeof create_painter_group>, kind: PainterProperty['kind']): PainterProperty {
  const property = get_painter_group_properties_by_kind(group, kind)[0];
  if (!property) throw new Error(`missing_property:${kind}`);
  return property;
}

function firstMutableProperty(group: ReturnType<typeof create_painter_group>, kind: PainterProperty['kind']): PainterProperty {
  const propertyId = group.property_ids.find((id) => group.properties[id]?.kind === kind);
  if (!propertyId) throw new Error(`missing_mutable_property:${kind}`);
  return group.properties[propertyId]!;
}

function assertBlocksDoNotOverlap(group: ReturnType<typeof create_painter_group>, propertyId: string, message: string): void {
  const blocks = [...group.properties[propertyId]!.blocks].sort((a, b) => a.start - b.start || a.end - b.end);
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

const legacyContentStatesKey = 'content' + '_states';
assert(!(legacyContentStatesKey in runtime.document.groups[baseGroupId]!), 'normalized groups should not keep legacy raster state arrays');
assert(!('channels' in runtime.document.groups[baseGroupId]!), 'normalized groups should not keep legacy channels');

const spanHoldGroup = create_painter_group('Span Hold', { breath_start: 2, breath_end: 8 });
firstMutableProperty(spanHoldGroup, 'raster').blocks = [
  { id: 'state_a', type: 'content', start: 2, end: 5, value: { kind: 'raster', voxels: [voxel('S')] } },
  { id: 'state_b', type: 'content', start: 6, end: 8, value: { kind: 'raster', voxels: [voxel('T')] } },
];
assert(get_painter_group_raster_state_at_breath(spanHoldGroup, 1) === null, 'group raster should not resolve before group span start');
assert(get_painter_group_raster_state_at_breath(spanHoldGroup, 2)?.content[0]?.char === 'S', 'first raster block should resolve at its start');
assert(get_painter_group_raster_state_at_breath(spanHoldGroup, 5)?.content[0]?.char === 'S', 'first raster block should hold through its span');
assert(get_painter_group_raster_state_at_breath(spanHoldGroup, 6)?.content[0]?.char === 'T', 'later raster block should take over');
assert(get_painter_group_raster_state_at_breath(spanHoldGroup, 9) === null, 'group raster should not resolve after group span end');

assert(runtime.document.bounds.minX === 0 && runtime.document.bounds.minY === 0, 'empty document should start at minimal origin bounds');
assert(runtime.document.bounds.width === 1 && runtime.document.bounds.height === 1, 'empty document should start with minimal width and height');
assert(runtime.document.bounds.minZ === 0 && runtime.document.bounds.maxZ === 0, 'empty document should start with minimal z extent');

set_group_voxel(runtime, baseGroupId, voxel('A', 2, 3, 1));
set_group_voxel(runtime, topGroup.id, create_painter_voxel_record({ x: 2, y: 3, z: 1, char: 'B', rgb: { r: 255, g: 0, b: 0 }, weight_index: 2 }));

let winner = resolve_painter_voxel_winner(runtime, key);
assert(winner.winning_group_id === topGroup.id, 'top group should win overlap by order');
assert(winner.cell?.char === 'B', 'top overlap winner should expose top char');
assert(runtime.group_voxel_index.get(baseGroupId)?.get(key)?.char === 'A', 'writing to top group should preserve lower group authored voxel data');

set_painter_group_visibility(runtime, topGroup.id, false);
winner = resolve_painter_voxel_winner(runtime, key);
assert(winner.winning_group_id === baseGroupId, 'hidden top group should reveal lower group');
set_painter_group_visibility(runtime, topGroup.id, true);
reorder_painter_groups(runtime, [topGroup.id, baseGroupId]);
winner = resolve_painter_voxel_winner(runtime, key);
assert(winner.winning_group_id === baseGroupId, 'reorder should change exact-coordinate winner');
erase_group_voxel(runtime, baseGroupId, key);
winner = resolve_painter_voxel_winner(runtime, key);
assert(winner.winning_group_id === topGroup.id, 'erasing lower group should leave top winner');

set_painter_group_property_block(runtime, baseGroupId, { property_kind: 'move', breath: 3, value: { kind: 'vec3', x: 2, y: 0, z: 0 } });
const beforeSpanState = structuredClone(runtime.document.groups[baseGroupId]!);
offset_painter_group_in_time(runtime, baseGroupId, 4);
assert(runtime.document.groups[baseGroupId]?.start === 4, 'offset_painter_group_in_time should move group start');
assert(firstProperty(runtime.document.groups[baseGroupId]!, 'move').blocks[0]?.start === 7, 'offset_painter_group_in_time should move move block starts');
set_painter_group_breath_span(runtime, baseGroupId, 0, 9);
assert(runtime.document.groups[baseGroupId]?.breath_start === 0 && runtime.document.groups[baseGroupId]?.breath_end === 9, 'set_painter_group_breath_span should update authored group span');
assert(get_painter_group_raster_state_at_breath(runtime.document.groups[baseGroupId]!, 4)?.content.length === get_painter_group_raster_state_at_breath(beforeSpanState, 0)?.content.length, 'set_painter_group_breath_span should preserve raster content payload');
assert(is_painter_group_active_at_breath(runtime.document.groups[baseGroupId]!, 4) === true, 'group should be active at updated span interior breath');
assert(is_painter_group_active_at_breath(runtime.document.groups[baseGroupId]!, 10) === false, 'group should be inactive outside updated span');

set_painter_document_loop_window(runtime, { breath_start: 10, breath_end: 16 });
assert(runtime.document.breath.cropped_start === 10 && runtime.document.breath.cropped_end === 16, 'document loop window should extend beyond stored file timing bounds');

const contentSplitDocument = create_painter_document(8, 8, { default_group_name: 'Split Test' });
const contentSplitGroupId = contentSplitDocument.group_order[0]!;
contentSplitDocument.groups[contentSplitGroupId]!.cropped_end = 4;
contentSplitDocument.groups[contentSplitGroupId]!.breath_end = 4;
firstMutableProperty(contentSplitDocument.groups[contentSplitGroupId]!, 'raster').blocks = [
  { id: 'split_source', type: 'content', start: 0, end: 4, value: { kind: 'raster', voxels: [voxel('A')] } },
];
const contentSplitRuntime = normalize_painter_document_runtime(contentSplitDocument);
set_painter_group_raster_state(contentSplitRuntime, contentSplitGroupId, 2, [voxel('B')]);
const splitBlocks = firstProperty(contentSplitRuntime.document.groups[contentSplitGroupId]!, 'raster').blocks;
assert(splitBlocks.length === 2, 'setting raster at an interior breath should split the active block');
assert(splitBlocks[0]!.start === 0 && splitBlocks[0]!.end === 1, 'splitting raster block should keep the left duration');
assert(splitBlocks[1]!.start === 2 && splitBlocks[1]!.end === 4, 'splitting raster block should assign remaining duration to the new right block');
assert(get_painter_group_raster_state_at_breath(contentSplitRuntime.document.groups[contentSplitGroupId]!, 1)?.content[0]?.char === 'A', 'breaths before the split should keep original content');
assert(get_painter_group_raster_state_at_breath(contentSplitRuntime.document.groups[contentSplitGroupId]!, 2)?.content[0]?.char === 'B', 'breaths at the split should resolve to inserted content');

const heldEditDocument = create_painter_document(8, 8, { default_group_name: 'Held Edit' });
const heldEditGroupId = heldEditDocument.group_order[0]!;
heldEditDocument.groups[heldEditGroupId]!.cropped_end = 4;
heldEditDocument.groups[heldEditGroupId]!.breath_end = 4;
firstMutableProperty(heldEditDocument.groups[heldEditGroupId]!, 'raster').blocks = [
  { id: 'held_block', type: 'content', start: 0, end: 4, value: { kind: 'raster', voxels: [voxel('H', 1, 1)] } },
];
const heldEditRuntime = normalize_painter_document_runtime(heldEditDocument);
set_painter_runtime_active_breath(heldEditRuntime, 3);
set_group_voxel_at_breath(heldEditRuntime, heldEditGroupId, 3, voxel('I', 2, 1), { auto_key: false });
assert(firstProperty(heldEditRuntime.document.groups[heldEditGroupId]!, 'raster').blocks.length === 1, 'editing visible held raster content should mutate the viewed block');
assert(get_painter_group_raster_state_at_breath(heldEditRuntime.document.groups[heldEditGroupId]!, 0)?.content.some((entry) => entry.char === 'I') === true, 'editing a held matrix should update the shared viewed content block');

const autoKeyDocument = create_painter_document(8, 8, { default_group_name: 'Auto Key Create' });
const autoKeyGroupId = autoKeyDocument.group_order[0]!;
autoKeyDocument.groups[autoKeyGroupId]!.start = 2;
autoKeyDocument.groups[autoKeyGroupId]!.cropped_start = 2;
autoKeyDocument.groups[autoKeyGroupId]!.cropped_end = 4;
autoKeyDocument.groups[autoKeyGroupId]!.breath_start = 2;
autoKeyDocument.groups[autoKeyGroupId]!.breath_end = 4;
firstMutableProperty(autoKeyDocument.groups[autoKeyGroupId]!, 'raster').blocks = [{ id: 'auto_blank', type: 'blank', start: 2, end: 4, mode: 'clip', left_boundary: 'clip', right_boundary: 'clip' }];
const autoKeyRuntime = normalize_painter_document_runtime(autoKeyDocument);
assert(set_group_voxel_at_breath(autoKeyRuntime, autoKeyGroupId, 3, voxel('X'), { auto_key: false }).applied === false, 'manual drawing without auto-key should reject blank raster spans');
assert(set_group_voxel_at_breath(autoKeyRuntime, autoKeyGroupId, 3, voxel('X'), { auto_key: true }).applied === true, 'auto-key drawing should create a block when no raster content is visible');
const autoBlocks = firstProperty(autoKeyRuntime.document.groups[autoKeyGroupId]!, 'raster').blocks;
assert(autoBlocks.length === 3, 'auto-key drawing into a blank span should isolate a one-breath content block');
assert(autoBlocks[1]!.start === 3 && autoBlocks[1]!.end === 3, 'auto-key block creation should create a one-breath content block');
assert(get_painter_group_raster_state_at_breath(autoKeyRuntime.document.groups[autoKeyGroupId]!, 3)?.content[0]?.char === 'X', 'new auto-keyed block should hold painted content');
assert(erase_group_voxel_at_breath(autoKeyRuntime, autoKeyGroupId, 1, make_painter_coord_key(0, 0, 0)).applied === false, 'erasing with no visible raster content should reject');

const propertyMoveDocument = create_painter_document(8, 8, { default_group_name: 'Property Move' });
const propertyMoveGroupId = propertyMoveDocument.group_order[0]!;
const propertyMoveRuntime = normalize_painter_document_runtime(propertyMoveDocument);
const createdMoveProperty = set_painter_group_property_block(propertyMoveRuntime, propertyMoveGroupId, { property_kind: 'move', property_label: 'move', breath: 2, value: { kind: 'vec3', x: 1, y: 0, z: 0 } });
set_painter_group_property_block(propertyMoveRuntime, propertyMoveGroupId, { property_kind: 'move', property_id: createdMoveProperty.property_id, property_label: 'move', breath: 5, value: { kind: 'vec3', x: 3, y: 0, z: 0 } });
const moveProperty = firstProperty(propertyMoveRuntime.document.groups[propertyMoveGroupId]!, 'move');
const exactMoveBlock = get_exact_painter_property_block(moveProperty, 2);
assert(exactMoveBlock?.id, 'property block setter should create an exact move block');
assert(resolve_painter_group_location_at_breath(propertyMoveRuntime.document.groups[propertyMoveGroupId]!, 4).x === 0, 'move blocks should not implicitly hold through timeline gaps');
move_painter_group_property_block(propertyMoveRuntime, propertyMoveGroupId, { property_id: moveProperty.id, block_id: exactMoveBlock!.id, target_breath: 4 });
const movedProperty = firstProperty(propertyMoveRuntime.document.groups[propertyMoveGroupId]!, 'move');
assert(get_exact_painter_property_block(movedProperty, 2) === null, 'property block move should clear original start breath');
assert(get_exact_painter_property_block(movedProperty, 4)?.type === 'content', 'property block move should create a new exact start breath');
assert(resolve_painter_group_location_at_breath(propertyMoveRuntime.document.groups[propertyMoveGroupId]!, 3).x === 0, 'moving first move block should update pre-block evaluation');
assert(resolve_painter_group_location_at_breath(propertyMoveRuntime.document.groups[propertyMoveGroupId]!, 4).x === 1, 'moving first move block should update new block start');
assert(resolve_painter_group_property_blocks_at_breath(propertyMoveRuntime.document.groups[propertyMoveGroupId]!, 4, 'move').length === 1, 'active move block resolution should include active move blocks');

const movedGapDocument = create_painter_document(8, 8, { default_group_name: 'Moved Gap' });
const movedGapGroupId = movedGapDocument.group_order[0]!;
const movedGapRuntime = normalize_painter_document_runtime(movedGapDocument);
const gapMove = set_painter_group_property_block(movedGapRuntime, movedGapGroupId, { property_kind: 'move', breath: 3, value: { kind: 'vec3', x: 4, y: 0, z: -7 } });
let gapMoveProperty = firstProperty(movedGapRuntime.document.groups[movedGapGroupId]!, 'move');
const firstGapBlockId = gapMoveProperty.blocks[0]!.id;
set_painter_group_property_block_edge_destructive(movedGapRuntime, movedGapGroupId, gapMove.property_id, firstGapBlockId, 'end', 5);
set_painter_group_property_block(movedGapRuntime, movedGapGroupId, { property_kind: 'move', property_id: gapMove.property_id, breath: 6, value: { kind: 'vec3', x: -2, y: 0, z: -6 } });
gapMoveProperty = firstProperty(movedGapRuntime.document.groups[movedGapGroupId]!, 'move');
const secondGapBlockId = gapMoveProperty.blocks.find((block) => block.start === 6)!.id;
move_painter_group_property_block(movedGapRuntime, movedGapGroupId, { property_id: gapMove.property_id, block_id: secondGapBlockId, target_breath: 9 });
gapMoveProperty = firstProperty(movedGapRuntime.document.groups[movedGapGroupId]!, 'move');
const firstGapBlock = gapMoveProperty.blocks.find((block) => block.id === firstGapBlockId)!;
const secondGapBlock = gapMoveProperty.blocks.find((block) => block.id === secondGapBlockId)!;
assert(firstGapBlock.start === 3 && firstGapBlock.end === 5, 'moving a later move block should not stretch the previous move block into the gap');
assert(secondGapBlock.start === 9 && secondGapBlock.end === 9, 'moving a move block should move only that block span');
assert(resolve_painter_group_location_at_breath(movedGapRuntime.document.groups[movedGapGroupId]!, 6).x === 0, 'breaths opened by moving a move block should resolve as no move');
assert(resolve_painter_group_location_at_breath(movedGapRuntime.document.groups[movedGapGroupId]!, 8).x === 0, 'move timeline gaps should not inherit previous content blocks');

const additiveMoveDocument = create_painter_document(8, 8, { default_group_name: 'Additive Move' });
const additiveMoveGroupId = additiveMoveDocument.group_order[0]!;
const additiveRuntime = normalize_painter_document_runtime(additiveMoveDocument);
const firstMove = set_painter_group_property_block(additiveRuntime, additiveMoveGroupId, { property_kind: 'move', breath: 0, value: { kind: 'vec3', x: 1, y: 0, z: 0 } });
add_painter_group_property(additiveRuntime, additiveMoveGroupId, { property_kind: 'move', property_label: 'move 2' });
const secondMoveId = additiveRuntime.document.groups[additiveMoveGroupId]!.property_ids.find((id) => id !== firstMove.property_id && additiveRuntime.document.groups[additiveMoveGroupId]!.properties[id]?.kind === 'move')!;
set_painter_group_property_block(additiveRuntime, additiveMoveGroupId, { property_kind: 'move', property_id: secondMoveId, breath: 0, value: { kind: 'vec3', x: 0, y: 2, z: 0 } });
assert(resolve_painter_group_location_at_breath(additiveRuntime.document.groups[additiveMoveGroupId]!, 0).x === 1, 'first move property should contribute to additive move resolution');
assert(resolve_painter_group_location_at_breath(additiveRuntime.document.groups[additiveMoveGroupId]!, 0).y === 2, 'second move property should add to move resolution');
blank_painter_group_property_block(additiveRuntime, additiveMoveGroupId, secondMoveId, firstProperty(additiveRuntime.document.groups[additiveMoveGroupId]!, 'move').id === secondMoveId ? firstProperty(additiveRuntime.document.groups[additiveMoveGroupId]!, 'move').blocks[0]!.id : additiveRuntime.document.groups[additiveMoveGroupId]!.properties[secondMoveId]!.blocks[0]!.id);
assert(resolve_painter_group_location_at_breath(additiveRuntime.document.groups[additiveMoveGroupId]!, 0).y === 0, 'blank move blocks should contribute no offset');

const rasterResizeDocument = create_painter_document(8, 8, { default_group_name: 'Raster Resize' });
const rasterResizeGroupId = rasterResizeDocument.group_order[0]!;
const rasterResizeRuntime = normalize_painter_document_runtime(rasterResizeDocument);
set_painter_group_raster_state(rasterResizeRuntime, rasterResizeGroupId, 0, [voxel('R')]);
const resizeProperty = firstProperty(rasterResizeRuntime.document.groups[rasterResizeGroupId]!, 'raster');
const resizeBlockId = resizeProperty.blocks[0]!.id;
set_painter_group_property_block_edge_destructive(rasterResizeRuntime, rasterResizeGroupId, resizeProperty.id, resizeBlockId, 'end', 5);
let resizedGroup = rasterResizeRuntime.document.groups[rasterResizeGroupId]!;
let resizedBlock = firstProperty(resizedGroup, 'raster').blocks[0]!;
assert(resizedBlock.start === 0 && resizedBlock.end === 5, 'destructive end resize should expand a content block across requested span');
assert(get_painter_group_raster_state_at_breath(resizedGroup, 5)?.content[0]?.char === 'R', 'expanded destructive end resize should preserve content at new end');
set_painter_group_property_block_edge_destructive(rasterResizeRuntime, rasterResizeGroupId, resizeProperty.id, resizeBlockId, 'start', 3);
resizedGroup = rasterResizeRuntime.document.groups[rasterResizeGroupId]!;
resizedBlock = firstProperty(resizedGroup, 'raster').blocks[0]!;
assert(resizedBlock.start === 3 && resizedBlock.end === 5, 'destructive start resize should shrink content block to requested span');
assert(get_painter_group_raster_state_at_breath(resizedGroup, 2) === null, 'destructive start resize should remove content before requested new start');

const overlapMoveDocument = create_painter_document(8, 8, { default_group_name: 'Overlap Move' });
const overlapMoveGroupId = overlapMoveDocument.group_order[0]!;
const overlapProperty = firstMutableProperty(overlapMoveDocument.groups[overlapMoveGroupId]!, 'raster');
overlapProperty.blocks = [
  { id: 'move_a', type: 'content', start: 0, end: 1, value: { kind: 'raster', voxels: [voxel('A')] } },
  { id: 'move_b', type: 'content', start: 3, end: 5, value: { kind: 'raster', voxels: [voxel('B')] } },
];
const overlapMoveRuntime = normalize_painter_document_runtime(overlapMoveDocument);
move_painter_group_property_block(overlapMoveRuntime, overlapMoveGroupId, { property_id: overlapProperty.id, block_id: 'move_a', target_breath: 4 });
const overlapMovedGroup = overlapMoveRuntime.document.groups[overlapMoveGroupId]!;
assertBlocksDoNotOverlap(overlapMovedGroup, overlapProperty.id, 'destructive move should not leave overlapping raster blocks');
assert(get_painter_group_raster_state_at_breath(overlapMovedGroup, 3)?.content[0]?.char === 'B', 'destructive move should preserve unclaimed content before moved span');
assert(get_painter_group_raster_state_at_breath(overlapMovedGroup, 4)?.content[0]?.char === 'A', 'destructive move should overwrite destination span');

const swapDocument = create_painter_document(8, 8, { default_group_name: 'Swap Raster' });
const swapGroupId = swapDocument.group_order[0]!;
const swapProperty = firstMutableProperty(swapDocument.groups[swapGroupId]!, 'raster');
swapProperty.blocks = [
  { id: 'swap_a', type: 'content', start: 0, end: 1, value: { kind: 'raster', voxels: [voxel('A')] } },
  { id: 'swap_b', type: 'content', start: 2, end: 3, value: { kind: 'raster', voxels: [voxel('B')] } },
];
const swapRuntime = normalize_painter_document_runtime(swapDocument);
swap_painter_group_property_blocks(swapRuntime, swapGroupId, swapProperty.id, 'swap_a', 'swap_b');
assert(get_painter_group_raster_state_at_breath(swapRuntime.document.groups[swapGroupId]!, 0)?.content[0]?.char === 'B', 'generic swap should move target raster content to source span');
assert(get_painter_group_raster_state_at_breath(swapRuntime.document.groups[swapGroupId]!, 2)?.content[0]?.char === 'A', 'generic swap should move source raster content to target span');

const exported = export_painter_document(runtime);
assert(exported.version === 6, 'exported painter document should use property-only version');
assert(!(legacyContentStatesKey in exported.groups[baseGroupId]!), 'exported groups should not include legacy raster state arrays');

console.log('painter_document_runtime tests passed');
