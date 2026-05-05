import {
  clone_painter_document_breath,
  clone_painter_document_playback,
  get_default_painter_document_breath,
  get_default_painter_document_playback,
  type PainterDocument,
  type PainterDocumentBreath,
  type PainterDocumentPlayback,
  type PainterGroup,
  type PainterGroupRasterState,
  type PainterProperty,
} from './painter_document.js';

export type PainterDocumentBreathRange = {
  start: number;
  end: number;
};

export type PainterDocumentAuthoredBreathBounds = {
  min_breath: number;
  max_breath: number;
};

export type PainterGroupBreathRange = {
  start: number;
  cropped_start: number;
  cropped_end: number;
  derivative_end: number;
  derivative_length: number;
};

export type PainterGroupRasterSegmentRange = {
  segment_id: string;
  index: number;
  start: number;
  end: number;
  length_breaths: number;
  state: PainterGroupRasterState;
};

export type PainterBreathPlaybackStepResult = {
  next_breath: number;
  frame_carry: number;
  did_loop: boolean;
  is_finished: boolean;
};

function clamp_int(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? Math.floor(value) : fallback;
  return Number.isFinite(n) ? n : fallback;
}

export function normalize_painter_document_breath(breath: PainterDocumentBreath | null | undefined): PainterDocumentBreath {
  return clone_painter_document_breath(breath ?? get_default_painter_document_breath());
}

export function normalize_painter_document_playback(playback: PainterDocumentPlayback | null | undefined): PainterDocumentPlayback {
  return clone_painter_document_playback(playback ?? get_default_painter_document_playback());
}

export function get_painter_document_breath(document: PainterDocument): PainterDocumentBreath {
  return normalize_painter_document_breath(document.breath);
}

export function get_painter_document_playback(document: PainterDocument): PainterDocumentPlayback {
  return normalize_painter_document_playback(document.playback);
}

export function get_painter_document_breath_range(document: PainterDocument): PainterDocumentBreathRange {
  const breath = get_painter_document_breath(document);
  return { start: breath.cropped_start, end: breath.cropped_end };
}

export function get_painter_document_file_breath_range(document: PainterDocument): PainterDocumentBreathRange {
  const authored = derive_painter_document_authored_breath_bounds(document);
  if (authored) {
    return {
      start: Math.max(0, authored.min_breath),
      end: Math.max(Math.max(0, authored.min_breath), authored.max_breath),
    };
  }
  return { start: 0, end: 0 };
}

export function derive_group_raster_segment_ranges(group: PainterGroup): PainterGroupRasterSegmentRange[] {
  const orderedIds = Array.isArray(group.property_ids) ? group.property_ids : [];
  const rasterProperties: PainterProperty[] = orderedIds
    .map((id) => group.properties?.[id] ?? null)
    .filter((property): property is PainterProperty => !!property && property.kind === 'raster');
  if (rasterProperties.length > 0) {
    const segments: PainterGroupRasterSegmentRange[] = [];
    let index = 0;
    for (const property of rasterProperties) {
      for (const block of property.blocks) {
        const start = Math.max(0, Math.floor(block.start));
        const end = Math.max(start, Math.floor(block.end));
        segments.push({
          segment_id: block.id,
          index,
          start,
          end,
          length_breaths: Math.max(1, end - start + 1),
          state: {
            id: block.id,
            label: property.label,
            index,
            length_breaths: Math.max(1, end - start + 1),
            content: block.type === 'content' && block.value.kind === 'raster'
              ? block.value.voxels.map((voxel) => structuredClone(voxel))
              : [],
          },
        });
        index += 1;
      }
    }
    return segments.sort((a, b) => a.start - b.start || a.end - b.end || a.segment_id.localeCompare(b.segment_id));
  }
  const start = Math.max(0, Math.floor(group.start ?? group.breath_start ?? 0));
  return [{
    segment_id: `blank_${group.id}`,
    index: 0,
    start,
    end: Math.max(start, Math.floor(group.breath_end ?? group.cropped_end ?? start)),
    length_breaths: Math.max(1, Math.floor(group.breath_end ?? group.cropped_end ?? start) - start + 1),
    state: { id: `blank_${group.id}`, label: 'content', index: 0, length_breaths: Math.max(1, Math.floor(group.breath_end ?? group.cropped_end ?? start) - start + 1), content: [] },
  }];
}

export function derive_group_breath_range(group: PainterGroup): PainterGroupBreathRange {
  const start = Math.max(0, Math.floor(group.start ?? group.breath_start ?? 0));
  const blocks = (Array.isArray(group.property_ids) ? group.property_ids : [])
    .map((id) => group.properties?.[id] ?? null)
    .filter((property): property is PainterProperty => !!property)
    .flatMap((property) => property.blocks);
  const derivativeEnd = blocks.length > 0
    ? blocks.reduce((max, block) => Math.max(max, Math.floor(block.end)), start)
    : Math.max(start, Math.floor(group.breath_end ?? group.cropped_end ?? start));
  const croppedStart = Math.max(start, Math.floor(group.breath_start ?? group.cropped_start ?? start));
  const croppedEnd = Math.max(croppedStart, Math.min(Math.floor(group.breath_end ?? group.cropped_end ?? derivativeEnd), derivativeEnd));
  return {
    start,
    cropped_start: croppedStart,
    cropped_end: croppedEnd,
    derivative_end: derivativeEnd,
    derivative_length: Math.max(1, derivativeEnd - start + 1),
  };
}

export function get_group_raster_segment_at_breath(group: PainterGroup, breath: number): PainterGroupRasterSegmentRange | null {
  const target = Math.floor(breath);
  const groupRange = derive_group_breath_range(group);
  if (target < groupRange.cropped_start || target > groupRange.cropped_end) return null;
  for (const segment of derive_group_raster_segment_ranges(group)) {
    if (target >= segment.start && target <= segment.end) return segment;
  }
  return null;
}

export function is_breath_in_painter_document_range(document: PainterDocument, breath: number): boolean {
  const range = get_painter_document_breath_range(document);
  const target = clamp_int(breath, range.start);
  return target >= range.start && target <= range.end;
}

export function clamp_breath_to_painter_document_range(document: PainterDocument, breath: number): number {
  const range = get_painter_document_breath_range(document);
  const target = clamp_int(breath, range.start);
  return Math.max(range.start, Math.min(range.end, target));
}

export function wrap_breath_in_painter_document_range(document: PainterDocument, breath: number): number {
  const range = get_painter_document_breath_range(document);
  const width = Math.max(1, range.end - range.start + 1);
  const target = clamp_int(breath, range.start);
  const normalized = ((target - range.start) % width + width) % width;
  return range.start + normalized;
}

export function derive_painter_document_authored_breath_bounds(document: PainterDocument): PainterDocumentAuthoredBreathBounds | null {
  let min_breath = Number.POSITIVE_INFINITY;
  let max_breath = Number.NEGATIVE_INFINITY;
  for (const group of Object.values(document.groups)) {
    const groupRange = derive_group_breath_range(group);
    min_breath = Math.min(min_breath, groupRange.start, groupRange.cropped_start);
    max_breath = Math.max(max_breath, groupRange.cropped_end, groupRange.derivative_end);
    for (const propertyId of Array.isArray(group.property_ids) ? group.property_ids : []) {
      const property = group.properties?.[propertyId];
      if (!property) continue;
      for (const block of property.blocks) {
        min_breath = Math.min(min_breath, block.start);
        max_breath = Math.max(max_breath, block.end);
      }
    }
  }
  if (!Number.isFinite(min_breath) || !Number.isFinite(max_breath)) return null;
  return { min_breath, max_breath };
}

export function derive_painter_document_suggested_breath_range(document: PainterDocument): PainterDocumentBreathRange {
  const authored = derive_painter_document_authored_breath_bounds(document);
  if (!authored) {
    const breath = get_painter_document_breath(document);
    return { start: breath.range_start, end: breath.range_end };
  }
  return {
    start: Math.max(0, authored.min_breath),
    end: Math.max(Math.max(0, authored.min_breath), authored.max_breath),
  };
}

export function step_painter_breath_playback(args: {
  document: PainterDocument;
  current_breath: number;
  frame_carry: number;
  elapsed_frames: number;
}): PainterBreathPlaybackStepResult {
  const playback = get_painter_document_playback(args.document);
  const range = get_painter_document_breath_range(args.document);
  const startingBreath = clamp_breath_to_painter_document_range(args.document, args.current_breath);
  const framesPerBreath = Math.max(1, playback.frames_per_breath);
  let carry = Math.max(0, clamp_int(args.frame_carry, 0)) + Math.max(0, clamp_int(args.elapsed_frames, 0));
  let nextBreath = startingBreath;
  let didLoop = false;
  let isFinished = false;
  while (carry >= framesPerBreath) {
    carry -= framesPerBreath;
    if (nextBreath >= range.end) {
      if (!playback.loop_enabled) {
        nextBreath = range.end;
        carry = 0;
        isFinished = true;
        break;
      }
      nextBreath = range.start;
      didLoop = true;
      continue;
    }
    nextBreath += 1;
  }
  return {
    next_breath: nextBreath,
    frame_carry: carry,
    did_loop: didLoop,
    is_finished: isFinished,
  };
}
