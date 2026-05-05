import { create_painter_document, create_painter_group, create_painter_voxel_record } from './painter_document.js';
import {
  clamp_breath_to_painter_document_range,
  derive_group_breath_range,
  derive_painter_document_authored_breath_bounds,
  derive_painter_document_suggested_breath_range,
  get_painter_document_breath_range,
  get_painter_document_file_breath_range,
  get_painter_document_playback,
  step_painter_breath_playback,
} from './painter_breath.js';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const document = create_painter_document(8, 8, {
  breath_range_start: 2,
  breath_range_end: 6,
  frames_per_breath: 3,
  loop_enabled: false,
});
const baseGroupId = document.group_order[0]!;
document.groups[baseGroupId]!.start = 2;
document.groups[baseGroupId]!.cropped_start = 2;
document.groups[baseGroupId]!.cropped_end = 6;
document.groups[baseGroupId]!.breath_start = 2;
document.groups[baseGroupId]!.breath_end = 6;
document.groups[baseGroupId]!.properties.raster_1!.blocks = [{
  id: 'base_hold',
  type: 'content',
  start: 2,
  end: 6,
  value: { kind: 'raster', voxels: [create_painter_voxel_record({ x: 0, y: 0, z: 0, char: 'A', rgb: { r: 255, g: 255, b: 255 }, weight_index: 1 })] },
}];
document.groups[baseGroupId]!.property_ids.push('move_1');
document.groups[baseGroupId]!.properties.move_1 = {
  id: 'move_1',
  kind: 'move',
  label: 'move',
  process_mode: 'add',
  blocks: [{ id: 'loc_a', type: 'content', start: 5, end: 6, value: { kind: 'vec3', x: 1, y: 0, z: 0 } }],
};

const laterGroup = create_painter_group('Later', { breath_start: 9, breath_end: 12 });
laterGroup.start = 9;
laterGroup.cropped_start = 9;
laterGroup.cropped_end = 12;
laterGroup.properties.raster_1!.blocks = [{ id: 'later_hold', type: 'content', start: 9, end: 12, value: { kind: 'raster', voxels: [] } }];
laterGroup.property_ids.push('move_1');
laterGroup.properties.move_1 = {
  id: 'move_1',
  kind: 'move',
  label: 'move',
  process_mode: 'add',
  blocks: [{ id: 'loc_b', type: 'content', start: 11, end: 12, value: { kind: 'vec3', x: 0, y: 1, z: 0 } }],
};
document.groups[laterGroup.id] = laterGroup;
document.group_order.push(laterGroup.id);

const range = get_painter_document_breath_range(document);
assert(range.start === 2 && range.end === 6, 'document breath range should expose loop start/end');
assert(clamp_breath_to_painter_document_range(document, -5) === 2, 'breath clamp should honor loop start');
assert(clamp_breath_to_painter_document_range(document, 99) === 6, 'breath clamp should honor loop end');
const fileRange = get_painter_document_file_breath_range(document);
assert(fileRange.start === 2 && fileRange.end === 12, 'file breath range should derive from authored content extent');

const playback = get_painter_document_playback(document);
assert(playback.frames_per_breath === 3 && playback.loop_enabled === false, 'document playback should expose file-owned cadence settings');

const groupRange = derive_group_breath_range(document.groups[baseGroupId]!);
assert(groupRange.start === 2 && groupRange.cropped_start === 2 && groupRange.cropped_end === 6 && groupRange.derivative_end === 6, 'group breath range should expose start, crop, and derivative bounds from property block timing');

const bounds = derive_painter_document_authored_breath_bounds(document);
assert(bounds?.min_breath === 2 && bounds?.max_breath === 12, 'authored breath bounds should include group spans and property block starts');

const suggested = derive_painter_document_suggested_breath_range(document);
assert(suggested.start === 2 && suggested.end === 12, 'suggested breath range should hug authored content exactly');

let playbackStep = step_painter_breath_playback({
  document,
  current_breath: 2,
  frame_carry: 0,
  elapsed_frames: 2,
});
assert(playbackStep.next_breath === 2 && playbackStep.frame_carry === 2, 'playback should hold current breath until cadence threshold is reached');
playbackStep = step_painter_breath_playback({
  document,
  current_breath: 2,
  frame_carry: playbackStep.frame_carry,
  elapsed_frames: 1,
});
assert(playbackStep.next_breath === 3 && playbackStep.frame_carry === 0, 'playback should advance one breath when enough frames accrue');
playbackStep = step_painter_breath_playback({
  document,
  current_breath: 6,
  frame_carry: 0,
  elapsed_frames: 3,
});
assert(playbackStep.next_breath === 6 && playbackStep.is_finished === true, 'non-looping playback should stop at the loop end breath');

console.log('painter_breath tests passed');
