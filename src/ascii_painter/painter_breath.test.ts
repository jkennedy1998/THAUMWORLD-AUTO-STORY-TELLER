import { create_painter_document, create_painter_group } from './painter_document.js';
import {
  clamp_breath_to_painter_document_range,
  derive_group_breath_range,
  derive_painter_document_authored_breath_bounds,
  derive_painter_document_suggested_breath_range,
  get_painter_document_breath_range,
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
document.groups[baseGroupId]!.content_states[0]!.length_breaths = 5;
document.groups[baseGroupId]!.location_keys.push({ breath: 5, offset: { x: 1, y: 0, z: 0 } });
const laterGroup = create_painter_group('Later', { breath_start: 9, breath_end: 12 });
laterGroup.start = 9;
laterGroup.cropped_start = 9;
laterGroup.cropped_end = 12;
laterGroup.content_states[0]!.length_breaths = 4;
laterGroup.location_keys.push({ breath: 11, offset: { x: 0, y: 1, z: 0 } });
document.groups[laterGroup.id] = laterGroup;
document.group_order.push(laterGroup.id);

const range = get_painter_document_breath_range(document);
assert(range.start === 2 && range.end === 6, 'document breath range should expose file-owned start/end');
assert(clamp_breath_to_painter_document_range(document, -5) === 2, 'breath clamp should honor file-owned start');
assert(clamp_breath_to_painter_document_range(document, 99) === 6, 'breath clamp should honor file-owned end');

const playback = get_painter_document_playback(document);
assert(playback.frames_per_breath === 3 && playback.loop_enabled === false, 'document playback should expose file-owned cadence settings');

const groupRange = derive_group_breath_range(document.groups[baseGroupId]!);
assert(groupRange.start === 2 && groupRange.cropped_start === 2 && groupRange.cropped_end === 6 && groupRange.derivative_end === 6, 'group breath range should expose start, crop, and derivative bounds from raster timing');

const bounds = derive_painter_document_authored_breath_bounds(document);
assert(bounds?.min_breath === 2 && bounds?.max_breath === 12, 'authored breath bounds should include group spans and keyed breaths');

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
assert(playbackStep.next_breath === 6 && playbackStep.is_finished === true, 'non-looping playback should stop at the file-owned end breath');

console.log('painter_breath tests passed');
