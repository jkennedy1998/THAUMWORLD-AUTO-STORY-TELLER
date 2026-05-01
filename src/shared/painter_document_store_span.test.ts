import { create_painter_document } from '../ascii_painter/painter_document.js';
import { derive_group_raster_segment_ranges } from '../ascii_painter/painter_breath.js';
import { normalize_painter_document_runtime } from '../ascii_painter/painter_document_runtime.js';
import { apply_painter_group_structure_change, save_painter_document_snapshot } from './painter_document_store.js';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const slot = 998;
const document_id = `painter_store_span_${Date.now()}`;
const document = create_painter_document(8, 8, { min_z: 0, max_z: 0, default_group_name: 'Base' });
const base_group_id = document.group_order[0]!;
document.groups[base_group_id]!.location_keys.push({ breath: 2, offset: { x: 1, y: 0, z: 0 } });
save_painter_document_snapshot(slot, {
  document_id,
  revision: 1,
  updated_at: new Date().toISOString(),
  snapshot: document,
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
assert(derive_group_raster_segment_ranges(runtime.document.groups['span_group_test']!)[0]?.start === 6, 'create_group should derive the first segment start from the group start');

const beforeSpan = structuredClone(runtime.document.groups[base_group_id]!);
const resized = apply_painter_group_structure_change(slot, document_id, {
  kind: 'set_group_breath_span',
  group_id: base_group_id,
  breath_start: 3,
  breath_end: 7,
});
runtime = normalize_painter_document_runtime(resized.snapshot);
assert(runtime.document.groups[base_group_id]?.breath_start === 3 && runtime.document.groups[base_group_id]?.breath_end === 7, 'set_group_breath_span should persist authored span changes in store path');
assert(derive_group_raster_segment_ranges(runtime.document.groups[base_group_id]!)[0]?.start === derive_group_raster_segment_ranges(beforeSpan)[0]?.start, 'set_group_breath_span should not change derived segment order or start');
assert(runtime.document.groups[base_group_id]?.location_keys.length === beforeSpan.location_keys.length, 'set_group_breath_span should not rewrite stored location keys');

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
assert(runtime.document.groups[base_group_id]?.start === 7, 'offset_group_in_time should persist group start offset in store path');
assert(runtime.document.groups[base_group_id]?.location_keys[0]?.breath === 5, 'offset_group_in_time should persist keyframe offsets in store path');

const relengthed = apply_painter_group_structure_change(slot, document_id, {
  kind: 'set_group_raster_segment_length',
  group_id: base_group_id,
  content_state_id: runtime.document.groups[base_group_id]!.content_states[0]!.id,
  length_breaths: 6,
});
runtime = normalize_painter_document_runtime(relengthed.snapshot);
assert(runtime.document.groups[base_group_id]?.content_states[0]?.length_breaths === 6, 'set_group_raster_segment_length should persist raster duration changes');
assert(runtime.document.groups[base_group_id]?.cropped_start === runtime.document.groups[base_group_id]?.start, 'raster duration changes should auto-sync crop start to full content bounds for now');
assert(runtime.document.groups[base_group_id]?.cropped_end === 12, 'raster duration changes should auto-sync crop end to derivative content bounds for now');

const splitSourceId = runtime.document.groups[base_group_id]!.content_states[0]!.id;
const split = apply_painter_group_structure_change(slot, document_id, {
  kind: 'split_group_raster_segment',
  group_id: base_group_id,
  content_state_id: splitSourceId,
  split_breath: 10,
});
runtime = normalize_painter_document_runtime(split.snapshot);
assert(runtime.document.groups[base_group_id]!.content_states.length === 2, 'split_group_raster_segment should create a second raster segment');
assert(runtime.document.groups[base_group_id]!.content_states[0]!.length_breaths === 3, 'split should shorten the left segment length');
assert(runtime.document.groups[base_group_id]!.content_states[1]!.length_breaths === 3, 'split should create the right segment length from the remainder');
assert(runtime.document.groups[base_group_id]!.cropped_start === runtime.document.groups[base_group_id]!.start, 'split should keep crop start synced to full content bounds for now');
assert(runtime.document.groups[base_group_id]!.cropped_end === 12, 'split should keep crop end synced to full derivative bounds for now');

const firstId = runtime.document.groups[base_group_id]!.content_states[0]!.id;
const secondId = runtime.document.groups[base_group_id]!.content_states[1]!.id;
const swapped = apply_painter_group_structure_change(slot, document_id, {
  kind: 'swap_group_raster_segments',
  group_id: base_group_id,
  source_content_state_id: firstId,
  target_content_state_id: secondId,
});
runtime = normalize_painter_document_runtime(swapped.snapshot);
assert(runtime.document.groups[base_group_id]!.content_states[0]!.id === secondId, 'swap_group_raster_segments should swap segment order');

console.log('painter_document_store_span tests passed');
