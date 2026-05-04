import { create_painter_document, create_painter_voxel_record, get_painter_group_raster_state_at_breath } from '../ascii_painter/painter_document.js';
import { derive_group_raster_segment_ranges } from '../ascii_painter/painter_breath.js';
import { normalize_painter_document_runtime, set_painter_group_property_block } from '../ascii_painter/painter_document_runtime.js';
import { apply_painter_group_structure_change, save_painter_document_snapshot } from './painter_document_store.js';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function firstPropertyId(document: ReturnType<typeof create_painter_document>, groupId: string, kind: 'raster' | 'move'): string {
  const group = document.groups[groupId]!;
  const propertyId = group.property_ids.find((id) => group.properties[id]?.kind === kind);
  if (!propertyId) throw new Error(`missing_property:${kind}`);
  return propertyId;
}

const slot = 998;
const document_id = `painter_store_span_${Date.now()}`;
const document = create_painter_document(8, 8, { min_z: 0, max_z: 0, default_group_name: 'Base' });
const base_group_id = document.group_order[0]!;
const baseRasterPropertyId = firstPropertyId(document, base_group_id, 'raster');
document.groups[base_group_id]!.properties[baseRasterPropertyId]!.blocks = [
  {
    id: 'raster_a',
    type: 'content',
    start: 0,
    end: 2,
    value: { kind: 'raster', voxels: [create_painter_voxel_record({ x: 0, y: 0, z: 0, char: 'A', rgb: { r: 255, g: 255, b: 255 }, weight_index: 1 })] },
  },
];
const seededRuntime = normalize_painter_document_runtime(document);
set_painter_group_property_block(seededRuntime, base_group_id, {
  property_kind: 'move',
  breath: 2,
  value: { kind: 'vec3', x: 1, y: 0, z: 0 },
});
save_painter_document_snapshot(slot, {
  document_id,
  revision: 1,
  updated_at: new Date().toISOString(),
  snapshot: seededRuntime.document,
});

const created = apply_painter_group_structure_change(slot, document_id, {
  kind: 'create_group',
  group_name: 'Span Group',
  target_group_id: 'span_group_test',
  breath_start: 6,
  breath_end: 10,
});
let runtime = normalize_painter_document_runtime(created.snapshot);
assert(runtime.document.groups['span_group_test']?.breath_start === 6, 'create_group should preserve explicit authored breath start in store path');
assert(runtime.document.groups['span_group_test']?.breath_end === 10, 'create_group should preserve explicit authored breath end in store path');
assert(derive_group_raster_segment_ranges(runtime.document.groups['span_group_test']!)[0]?.start === 6, 'create_group should derive the first block start from the group start');

const beforeSpan = structuredClone(runtime.document.groups[base_group_id]!);
const resized = apply_painter_group_structure_change(slot, document_id, {
  kind: 'set_group_breath_span',
  group_id: base_group_id,
  breath_start: 3,
  breath_end: 7,
});
runtime = normalize_painter_document_runtime(resized.snapshot);
assert(runtime.document.groups[base_group_id]?.breath_start === 3 && runtime.document.groups[base_group_id]?.breath_end === 7, 'set_group_breath_span should persist authored span changes in store path');
assert(derive_group_raster_segment_ranges(runtime.document.groups[base_group_id]!)[0]?.start === derive_group_raster_segment_ranges(beforeSpan)[0]?.start, 'set_group_breath_span should not rewrite property block starts');
assert(runtime.document.groups[base_group_id]!.property_ids.length === beforeSpan.property_ids.length, 'set_group_breath_span should preserve authored properties');

const retimed = apply_painter_group_structure_change(slot, document_id, {
  kind: 'set_group_timing',
  group_id: base_group_id,
  start: 4,
  cropped_start: 5,
  cropped_end: 8,
});
runtime = normalize_painter_document_runtime(retimed.snapshot);
assert(runtime.document.groups[base_group_id]?.start === 4, 'set_group_timing should persist group start');
assert(runtime.document.groups[base_group_id]?.cropped_start === 5 && runtime.document.groups[base_group_id]?.cropped_end === 8, 'set_group_timing should persist cropped window');

const offset = apply_painter_group_structure_change(slot, document_id, {
  kind: 'offset_group_in_time',
  group_id: base_group_id,
  delta_breaths: 3,
});
runtime = normalize_painter_document_runtime(offset.snapshot);
const offsetMovePropertyId = firstPropertyId(runtime.document, base_group_id, 'move');
assert(runtime.document.groups[base_group_id]?.start === 3, 'offset_group_in_time should sync group start from offset property blocks');
assert(runtime.document.groups[base_group_id]!.properties[offsetMovePropertyId]!.blocks[0]?.start === 5, 'offset_group_in_time should persist move property block offsets in store path');

const rasterPropertyId = firstPropertyId(runtime.document, base_group_id, 'raster');
const rasterBlockId = runtime.document.groups[base_group_id]!.properties[rasterPropertyId]!.blocks[0]!.id;
const relengthed = apply_painter_group_structure_change(slot, document_id, {
  kind: 'set_group_property_block_length',
  group_id: base_group_id,
  property_id: rasterPropertyId,
  block_id: rasterBlockId,
  length_breaths: 6,
});
runtime = normalize_painter_document_runtime(relengthed.snapshot);
assert(runtime.document.groups[base_group_id]!.properties[rasterPropertyId]!.blocks[0]?.end === 8, 'set_group_property_block_length should persist raster duration changes');
assert(runtime.document.groups[base_group_id]?.cropped_start === runtime.document.groups[base_group_id]?.start, 'raster duration changes should sync crop start to property bounds');
assert(runtime.document.groups[base_group_id]?.cropped_end === 8, 'raster duration changes should sync crop end to property bounds');

const split = apply_painter_group_structure_change(slot, document_id, {
  kind: 'split_group_property_block',
  group_id: base_group_id,
  property_id: rasterPropertyId,
  block_id: rasterBlockId,
  split_breath: 6,
});
runtime = normalize_painter_document_runtime(split.snapshot);
const splitBlocks = runtime.document.groups[base_group_id]!.properties[rasterPropertyId]!.blocks;
assert(splitBlocks.length === 2, 'split_group_property_block should create a second raster block');
assert(splitBlocks[0]!.start === 3 && splitBlocks[0]!.end === 5, 'split should shorten the left block span');
assert(splitBlocks[1]!.start === 6 && splitBlocks[1]!.end === 8, 'split should create the right block span from the remainder');

const swapped = apply_painter_group_structure_change(slot, document_id, {
  kind: 'swap_group_property_blocks',
  group_id: base_group_id,
  property_id: rasterPropertyId,
  source_block_id: splitBlocks[0]!.id,
  target_block_id: splitBlocks[1]!.id,
});
runtime = normalize_painter_document_runtime(swapped.snapshot);
assert(get_painter_group_raster_state_at_breath(runtime.document.groups[base_group_id]!, 6)?.content[0]?.char === 'A', 'swap_group_property_blocks should preserve raster payload after swapping spans');

console.log('painter_document_store_span tests passed');
