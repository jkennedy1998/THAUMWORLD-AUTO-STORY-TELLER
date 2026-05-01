import {
  clone_painter_document_breath,
  clone_painter_document_playback,
  create_painter_group,
  clone_painter_document,
  clone_painter_group,
  clone_painter_voxel_record,
  get_painter_group_content_state_at_breath,
  make_painter_coord_key,
  normalize_painter_group_content_states,
  type PainterCoordKey,
  type PainterDocument,
  type PainterGroup,
  type PainterGroupContentState,
  type PainterGroupLocationKey,
  type PainterGroupLocationOffset,
  type PainterOccupiedBounds,
  type PainterVoxelRecord,
} from './painter_document.js';
import { derive_group_breath_range, derive_group_raster_segment_ranges } from './painter_breath.js';

export type ResolvedPainterVoxel = {
  x: number;
  y: number;
  z: number;
  winning_group_id: string;
  cell: PainterVoxelRecord;
};

export type PainterGroupWorldBounds = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
};

export type PainterDocumentRuntime = {
  document: PainterDocument;
  active_breath: number;
  group_voxel_index: Map<string, Map<string, PainterVoxelRecord>>;
  coordinate_group_index: Map<string, string[]>;
  resolved_visible_index: Map<string, ResolvedPainterVoxel>;
  resolved_group_bounds_index: Map<string, PainterGroupWorldBounds>;
};

export type ResolveVoxelWinnerResult = {
  winning_group_id: string | null;
  cell: PainterVoxelRecord | null;
};

export type PainterPreviewCellChange = {
  x: number;
  y: number;
  z: number;
  char: string;
  rgb: { r: number; g: number; b: number };
  weight_index: number;
};

type PainterDocumentBounds = PainterDocument['bounds'];

type PainterVoxelExtents = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
};

function touch_modified_at(document: PainterDocument): void {
  if (document.metadata) document.metadata.modified_at = new Date().toISOString();
}

function normalize_group_order(document: PainterDocument): string[] {
  const known = new Set(Object.keys(document.groups));
  const ordered = document.group_order.filter((groupId) => known.has(groupId));
  for (const groupId of Object.keys(document.groups)) {
    if (!ordered.includes(groupId)) ordered.push(groupId);
  }
  return ordered;
}

function normalize_document_bounds(bounds: PainterDocument['bounds']): PainterDocumentBounds {
  const minX = Math.floor((bounds as any).minX ?? 0);
  const minY = Math.floor((bounds as any).minY ?? 0);
  const width = Math.max(1, Math.floor(bounds.width ?? 1));
  const height = Math.max(1, Math.floor(bounds.height ?? 1));
  const minZ = Math.floor(bounds.minZ ?? 0);
  const maxZ = Math.floor(bounds.maxZ ?? minZ);
  return {
    minX,
    minY,
    width,
    height,
    depth: Math.max(1, maxZ - minZ + 1),
    minZ: Math.min(minZ, maxZ),
    maxZ: Math.max(minZ, maxZ),
  };
}

function clone_location_offset(offset: PainterGroupLocationOffset): PainterGroupLocationOffset {
  return { x: offset.x, y: offset.y, z: offset.z };
}

function is_zero_location_offset(offset: PainterGroupLocationOffset): boolean {
  return offset.x === 0 && offset.y === 0 && offset.z === 0;
}

function add_offset(a: PainterGroupLocationOffset, b: PainterGroupLocationOffset): PainterGroupLocationOffset {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function set_group_content_state_array(group: PainterGroup, stateId: string, voxelMap: Map<string, PainterVoxelRecord>): void {
  group.content_states = normalize_painter_group_content_states(
    group.content_states.map((state) => state.id === stateId
      ? { ...state, content: Array.from(voxelMap.values()).map(clone_painter_voxel_record) }
      : state),
    undefined
  );
  if (group.metadata) group.metadata.modified_at = new Date().toISOString();
}

function create_content_state_id(): string {
  return `content_state_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function create_empty_content_state(label: string, length_breaths: number): PainterGroupContentState {
  return {
    id: create_content_state_id(),
    label,
    index: 0,
    length_breaths: Math.max(1, Math.floor(length_breaths)),
    content: [],
  };
}

function sync_group_timing_compat(group: PainterGroup): void {
  let cursor = Math.max(0, Math.floor(group.start ?? 0));
  group.content_states = normalize_painter_group_content_states(group.content_states).map((state, index) => {
    const next = {
      ...state,
      index,
      length_breaths: Math.max(1, Math.floor(state.length_breaths ?? 1)),
    };
    cursor += next.length_breaths;
    return next;
  });
  const derivativeEnd = Math.max(Math.max(0, Math.floor(group.start ?? 0)), cursor - 1);
  group.cropped_start = Math.max(Math.floor(group.start ?? 0), Math.floor(group.cropped_start ?? group.start ?? 0));
  group.cropped_end = Math.max(group.cropped_start, Math.min(Math.floor(group.cropped_end ?? derivativeEnd), derivativeEnd));
  group.breath_start = group.cropped_start;
  group.breath_end = group.cropped_end;
}

function sync_group_crop_to_content_bounds(group: PainterGroup): void {
  sync_group_timing_compat(group);
  const derivativeEnd = derive_group_breath_range(group).derivative_end;
  const start = Math.max(0, Math.floor(group.start ?? 0));
  group.cropped_start = start;
  group.cropped_end = derivativeEnd;
  group.breath_start = group.cropped_start;
  group.breath_end = group.cropped_end;
}

function scan_world_extents_from_voxel_maps(voxelMaps: Iterable<Map<string, PainterVoxelRecord>>): PainterVoxelExtents | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const voxelMap of voxelMaps) {
    for (const voxel of voxelMap.values()) {
      minX = Math.min(minX, voxel.x);
      minY = Math.min(minY, voxel.y);
      minZ = Math.min(minZ, voxel.z);
      maxX = Math.max(maxX, voxel.x);
      maxY = Math.max(maxY, voxel.y);
      maxZ = Math.max(maxZ, voxel.z);
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

function scan_all_authored_world_extents(document: PainterDocument): PainterVoxelExtents | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const group of Object.values(document.groups)) {
    const offsets = [group.location_base, ...group.location_keys.map((key) => key.offset)].map(clone_location_offset);
    for (const state of group.content_states) {
      for (const voxel of state.content) {
        for (const offset of offsets) {
          const worldX = voxel.x + offset.x;
          const worldY = voxel.y + offset.y;
          const worldZ = voxel.z + offset.z;
          minX = Math.min(minX, worldX);
          minY = Math.min(minY, worldY);
          minZ = Math.min(minZ, worldZ);
          maxX = Math.max(maxX, worldX);
          maxY = Math.max(maxY, worldY);
          maxZ = Math.max(maxZ, worldZ);
        }
      }
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

export function derive_painter_occupied_bounds(runtime: PainterDocumentRuntime): PainterOccupiedBounds | null {
  const extents = scan_world_extents_from_voxel_maps(runtime.group_voxel_index.values());
  if (!extents) return null;
  return { ...extents };
}

function derive_painter_document_bounds(runtime: PainterDocumentRuntime): PainterDocumentBounds {
  const extents = scan_all_authored_world_extents(runtime.document);
  if (!extents) {
    return { minX: 0, minY: 0, width: 1, height: 1, depth: 1, minZ: 0, maxZ: 0 };
  }
  return {
    minX: extents.minX,
    minY: extents.minY,
    width: Math.max(1, extents.maxX - extents.minX + 1),
    height: Math.max(1, extents.maxY - extents.minY + 1),
    depth: Math.max(1, extents.maxZ - extents.minZ + 1),
    minZ: extents.minZ,
    maxZ: extents.maxZ,
  };
}

function refresh_document_extents(runtime: PainterDocumentRuntime): void {
  runtime.document.bounds = derive_painter_document_bounds(runtime);
  runtime.document.occupied_bounds = derive_painter_occupied_bounds(runtime);
}

export function is_painter_group_active_at_breath(group: PainterGroup, breath: number): boolean {
  const targetBreath = Math.floor(breath);
  const range = derive_group_breath_range(group);
  return targetBreath >= range.cropped_start && targetBreath <= range.cropped_end;
}

export function resolve_painter_group_location_at_breath(group: PainterGroup, breath: number): PainterGroupLocationOffset {
  const targetBreath = Math.floor(breath);
  let resolved = clone_location_offset(group.location_base);
  for (const key of group.location_keys) {
    if (key.breath > targetBreath) break;
    resolved = clone_location_offset(key.offset);
  }
  return resolved;
}

export function resolve_nearest_painter_group_location_key(group: PainterGroup, breath: number): PainterGroupLocationKey | null {
  const targetBreath = Math.floor(breath);
  let best: PainterGroupLocationKey | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const key of group.location_keys) {
    const distance = Math.abs(key.breath - targetBreath);
    if (distance < bestDistance || (distance === bestDistance && best && key.breath < best.breath)) {
      best = { breath: key.breath, offset: clone_location_offset(key.offset) };
      bestDistance = distance;
    } else if (distance === bestDistance && !best) {
      best = { breath: key.breath, offset: clone_location_offset(key.offset) };
      bestDistance = distance;
    }
  }
  return best;
}

export function get_exact_painter_group_location_key(group: PainterGroup, breath: number): PainterGroupLocationKey | null {
  const targetBreath = Math.floor(breath);
  const key = group.location_keys.find((entry) => entry.breath === targetBreath) ?? null;
  return key ? { breath: key.breath, offset: clone_location_offset(key.offset) } : null;
}

export function set_painter_group_location_key(runtime: PainterDocumentRuntime, groupId: string, breath: number, offset: PainterGroupLocationOffset): void {
  const group = runtime.document.groups[groupId];
  if (!group) throw new Error(`painter_group_not_found:${groupId}`);
  const targetBreath = Math.floor(breath);
  const nextOffset = clone_location_offset(offset);
  const groupStart = Math.max(0, Math.floor(group.start ?? 0));
  if (group.location_keys.length === 0 && (targetBreath <= groupStart || is_zero_location_offset(group.location_base))) {
    group.location_base = nextOffset;
    if (group.metadata) group.metadata.modified_at = new Date().toISOString();
    touch_modified_at(runtime.document);
    rebuild_runtime_indices(runtime);
    return;
  }
  const nextKey: PainterGroupLocationKey = {
    breath: targetBreath,
    offset: nextOffset,
  };
  const existingIndex = group.location_keys.findIndex((entry) => entry.breath === targetBreath);
  if (existingIndex >= 0) {
    group.location_keys[existingIndex] = nextKey;
  } else {
    group.location_keys = [...group.location_keys, nextKey].sort((a, b) => a.breath - b.breath);
  }
  if (group.metadata) group.metadata.modified_at = new Date().toISOString();
  touch_modified_at(runtime.document);
  rebuild_runtime_indices(runtime);
}

export function set_painter_group_breath_span(runtime: PainterDocumentRuntime, groupId: string, breathStart: number, breathEnd: number): void {
  const group = runtime.document.groups[groupId];
  if (!group) throw new Error(`painter_group_not_found:${groupId}`);
  const nextStart = Math.max(0, Math.floor(breathStart));
  const nextEnd = Math.max(nextStart, Math.floor(breathEnd));
  group.cropped_start = nextStart;
  group.cropped_end = nextEnd;
  group.breath_start = nextStart;
  group.breath_end = nextEnd;
  if (group.content_states.length === 1) {
    const onlyState = group.content_states[0]!;
    onlyState.length_breaths = Math.max(1, nextEnd - Math.max(0, Math.floor(group.start ?? 0)) + 1);
  }
  if (group.metadata) group.metadata.modified_at = new Date().toISOString();
  touch_modified_at(runtime.document);
  rebuild_runtime_indices(runtime);
}

export function offset_painter_group_in_time(runtime: PainterDocumentRuntime, groupId: string, deltaBreaths: number): void {
  const group = runtime.document.groups[groupId];
  if (!group) throw new Error(`painter_group_not_found:${groupId}`);
  const delta = Math.floor(deltaBreaths);
  if (delta === 0) return;
  const minimumBreath = Math.min(
    Math.max(0, Math.floor(group.start ?? 0)),
    Math.max(0, Math.floor(group.cropped_start ?? group.start ?? 0)),
    Math.max(0, Math.floor(group.cropped_end ?? group.cropped_start ?? group.start ?? 0)),
    ...group.location_keys.map((key) => Math.floor(key.breath)),
  );
  const appliedDelta = Math.max(-minimumBreath, delta);
  if (appliedDelta === 0) return;
  group.start = Math.max(0, Math.floor(group.start ?? 0) + appliedDelta);
  group.cropped_start = Math.max(group.start, Math.floor(group.cropped_start ?? group.start) + appliedDelta);
  group.cropped_end = Math.max(group.cropped_start, Math.floor(group.cropped_end ?? group.cropped_start) + appliedDelta);
  group.location_keys = group.location_keys.map((key) => ({
    breath: Math.max(0, Math.floor(key.breath) + appliedDelta),
    offset: clone_location_offset(key.offset),
  })).sort((a, b) => a.breath - b.breath);
  sync_group_timing_compat(group);
  if (group.metadata) group.metadata.modified_at = new Date().toISOString();
  touch_modified_at(runtime.document);
  rebuild_runtime_indices(runtime);
}

export function set_painter_group_timing(runtime: PainterDocumentRuntime, groupId: string, args: {
  start: number;
  cropped_start: number;
  cropped_end: number;
}): void {
  const group = runtime.document.groups[groupId];
  if (!group) throw new Error(`painter_group_not_found:${groupId}`);
  group.start = Math.max(0, Math.floor(args.start));
  group.cropped_start = Math.max(group.start, Math.floor(args.cropped_start));
  group.cropped_end = Math.max(group.cropped_start, Math.floor(args.cropped_end));
  sync_group_timing_compat(group);
  if (group.metadata) group.metadata.modified_at = new Date().toISOString();
  touch_modified_at(runtime.document);
  rebuild_runtime_indices(runtime);
}

export function set_painter_group_raster_segment_length(runtime: PainterDocumentRuntime, groupId: string, contentStateId: string, lengthBreaths: number): void {
  const group = runtime.document.groups[groupId];
  if (!group) throw new Error(`painter_group_not_found:${groupId}`);
  const targetLength = Math.max(1, Math.floor(lengthBreaths));
  group.content_states = normalize_painter_group_content_states(group.content_states, {
    legacy_voxels: [],
  }).map((state) => state.id === contentStateId ? { ...state, length_breaths: targetLength } : state);
  sync_group_crop_to_content_bounds(group);
  if (group.metadata) group.metadata.modified_at = new Date().toISOString();
  touch_modified_at(runtime.document);
  rebuild_runtime_indices(runtime);
}

export function split_painter_group_raster_segment(runtime: PainterDocumentRuntime, groupId: string, contentStateId: string, splitBreath: number): void {
  const group = runtime.document.groups[groupId];
  if (!group) throw new Error(`painter_group_not_found:${groupId}`);
  const segments = derive_group_raster_segment_ranges(group);
  const target = segments.find((segment) => segment.segment_id === contentStateId) ?? null;
  if (!target) throw new Error(`painter_content_state_not_found:${contentStateId}`);
  const splitAt = Math.floor(splitBreath);
  if (splitAt <= target.start || splitAt > target.end) return;
  const leftLength = splitAt - target.start;
  const rightLength = target.end - splitAt + 1;
  const nextStates: PainterGroupContentState[] = [];
  for (const state of normalize_painter_group_content_states(group.content_states)) {
    if (state.id !== contentStateId) {
      nextStates.push(state);
      continue;
    }
    nextStates.push({
      ...state,
      length_breaths: Math.max(1, leftLength),
    });
    nextStates.push({
      ...state,
      id: `content_state_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      label: `${state.label} B`,
      length_breaths: Math.max(1, rightLength),
    });
  }
  group.content_states = nextStates;
  sync_group_crop_to_content_bounds(group);
  if (group.metadata) group.metadata.modified_at = new Date().toISOString();
  touch_modified_at(runtime.document);
  rebuild_runtime_indices(runtime);
}

export function swap_painter_group_raster_segments(runtime: PainterDocumentRuntime, groupId: string, sourceContentStateId: string, targetContentStateId: string): void {
  const group = runtime.document.groups[groupId];
  if (!group) throw new Error(`painter_group_not_found:${groupId}`);
  if (sourceContentStateId === targetContentStateId) return;
  const states = normalize_painter_group_content_states(group.content_states, {
    legacy_voxels: [],
  });
  const sourceIndex = states.findIndex((state) => state.id === sourceContentStateId);
  const targetIndex = states.findIndex((state) => state.id === targetContentStateId);
  if (sourceIndex < 0 || targetIndex < 0) throw new Error('painter_content_state_not_found');
  const nextStates = [...states];
  const temp = nextStates[sourceIndex]!;
  nextStates[sourceIndex] = nextStates[targetIndex]!;
  nextStates[targetIndex] = temp;
  group.content_states = nextStates.map((state, index) => ({ ...state, index }));
  sync_group_crop_to_content_bounds(group);
  if (group.metadata) group.metadata.modified_at = new Date().toISOString();
  touch_modified_at(runtime.document);
  rebuild_runtime_indices(runtime);
}

export function resolve_nearest_painter_group_content_state(group: PainterGroup, breath: number): PainterGroupContentState | null {
  const targetBreath = Math.floor(breath);
  let best: PainterGroupContentState | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestStart = Number.POSITIVE_INFINITY;
  for (const segment of derive_group_raster_segment_ranges(group)) {
    const distance = Math.abs(segment.start - targetBreath);
    if (distance < bestDistance || (distance === bestDistance && segment.start < bestStart)) {
      best = {
        id: segment.state.id,
        label: segment.state.label,
        index: segment.state.index,
        length_breaths: segment.state.length_breaths,
        content: segment.state.content.map(clone_painter_voxel_record),
      };
      bestDistance = distance;
      bestStart = segment.start;
    }
  }
  return best;
}

export function get_exact_painter_group_content_state(group: PainterGroup, breath: number): PainterGroupContentState | null {
  const targetBreath = Math.floor(breath);
  const segment = derive_group_raster_segment_ranges(group).find((entry) => entry.start === targetBreath) ?? null;
  return segment
    ? {
        id: segment.state.id,
        label: segment.state.label,
        index: segment.state.index,
        length_breaths: segment.state.length_breaths,
        content: segment.state.content.map(clone_painter_voxel_record),
      }
    : null;
}

export function set_painter_group_content_state(runtime: PainterDocumentRuntime, groupId: string, breath: number, voxels: PainterVoxelRecord[]): void {
  const group = runtime.document.groups[groupId];
  if (!group) throw new Error(`painter_group_not_found:${groupId}`);
  const targetBreath = Math.floor(breath);
  const exactSegment = derive_group_raster_segment_ranges(group).find((entry) => entry.start === targetBreath) ?? null;
  const nextContent = voxels.map(clone_painter_voxel_record);
  if (exactSegment) {
    group.content_states = group.content_states.map((state, index) => state.id === exactSegment.segment_id
      ? {
          ...state,
          index,
          content: nextContent,
        }
      : { ...state, index });
  } else {
    const containingSegment = derive_group_raster_segment_ranges(group).find((entry) => targetBreath >= entry.start && targetBreath <= entry.end) ?? null;
    if (!containingSegment) throw new Error(`painter_content_state_not_found_at_breath:${targetBreath}`);
    const leftLength = targetBreath - containingSegment.start;
    const rightLength = containingSegment.end - targetBreath + 1;
    const nextStates: PainterGroupContentState[] = [];
    for (const state of group.content_states) {
      if (state.id !== containingSegment.segment_id) {
        nextStates.push(state);
        continue;
      }
      if (leftLength > 0) {
        nextStates.push({
          ...state,
          length_breaths: leftLength,
        });
      }
      nextStates.push({
        id: `content_state_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        label: leftLength > 0 ? `${state.label} B` : state.label,
        index: nextStates.length,
        length_breaths: Math.max(1, rightLength),
        content: nextContent,
      });
    }
    group.content_states = normalize_painter_group_content_states(nextStates);
  }
  sync_group_timing_compat(group);
  if (group.metadata) group.metadata.modified_at = new Date().toISOString();
  touch_modified_at(runtime.document);
  rebuild_runtime_indices(runtime);
}

function insert_empty_exact_content_state_at_breath(group: PainterGroup, breath: number): PainterGroupContentState {
  const targetBreath = Math.max(0, Math.floor(breath));
  const segments = derive_group_raster_segment_ranges(group);
  const containingSegment = segments.find((entry) => targetBreath >= entry.start && targetBreath <= entry.end) ?? null;
  const firstSegment = segments[0] ?? null;
  const lastSegment = segments[segments.length - 1] ?? null;
  const nextStates: PainterGroupContentState[] = [];
  const inserted = create_empty_content_state(`State ${group.content_states.length + 1}`, 1);

  if (containingSegment) {
    for (const state of group.content_states) {
      if (state.id !== containingSegment.segment_id) {
        nextStates.push(state);
        continue;
      }
      const leftLength = targetBreath - containingSegment.start;
      const rightLength = containingSegment.end - targetBreath;
      if (leftLength > 0) nextStates.push({ ...state, length_breaths: leftLength });
      nextStates.push(inserted);
      if (rightLength > 0) nextStates.push({
        ...state,
        id: create_content_state_id(),
        label: `${state.label} C`,
        length_breaths: rightLength,
      });
    }
    group.content_states = normalize_painter_group_content_states(nextStates);
    sync_group_timing_compat(group);
  } else if (!firstSegment || targetBreath < firstSegment.start) {
    const gapLength = firstSegment ? Math.max(0, firstSegment.start - targetBreath - 1) : 0;
    const leadingStates = [inserted];
    if (gapLength > 0) leadingStates.push(create_empty_content_state('Hold', gapLength));
    group.content_states = normalize_painter_group_content_states([...leadingStates, ...group.content_states]);
    group.start = targetBreath;
    sync_group_timing_compat(group);
  } else if (lastSegment && targetBreath > lastSegment.end) {
    const gapLength = Math.max(0, targetBreath - lastSegment.end - 1);
    const trailingStates = gapLength > 0 ? [create_empty_content_state('Hold', gapLength), inserted] : [inserted];
    group.content_states = normalize_painter_group_content_states([...group.content_states, ...trailingStates]);
    sync_group_timing_compat(group);
  } else {
    throw new Error(`painter_content_state_not_found_at_breath:${targetBreath}`);
  }

  group.cropped_start = Math.min(Math.floor(group.cropped_start ?? group.start ?? targetBreath), targetBreath);
  group.cropped_end = Math.max(Math.floor(group.cropped_end ?? targetBreath), targetBreath);
  group.breath_start = group.cropped_start;
  group.breath_end = group.cropped_end;
  return group.content_states.find((state) => state.id === inserted.id) ?? inserted;
}

function resolve_group_voxel_edit_state(group: PainterGroup, breath: number, options?: {
  auto_key?: boolean;
  allow_create?: boolean;
}): { state_id: string | null; reason: 'ok' | 'no_visible_raster_content' } {
  const targetBreath = Math.floor(breath);
  const visibleState = get_painter_group_content_state_at_breath(group, targetBreath);
  if (visibleState && visibleState.content.length > 0) return { state_id: visibleState.id, reason: 'ok' };
  if (!options?.allow_create || options?.auto_key !== true) return { state_id: null, reason: 'no_visible_raster_content' };
  const created = insert_empty_exact_content_state_at_breath(group, targetBreath);
  return { state_id: created.id, reason: 'ok' };
}

export function project_painter_group_local_voxel_to_world(voxel: PainterVoxelRecord, offset: PainterGroupLocationOffset): PainterVoxelRecord {
  return clone_painter_voxel_record({
    ...voxel,
    x: voxel.x + offset.x,
    y: voxel.y + offset.y,
    z: voxel.z + offset.z,
    key: make_painter_coord_key(voxel.x + offset.x, voxel.y + offset.y, voxel.z + offset.z),
  });
}

export function unproject_painter_group_world_voxel_to_local(voxel: PainterVoxelRecord, offset: PainterGroupLocationOffset): PainterVoxelRecord {
  return clone_painter_voxel_record({
    ...voxel,
    x: voxel.x - offset.x,
    y: voxel.y - offset.y,
    z: voxel.z - offset.z,
    key: make_painter_coord_key(voxel.x - offset.x, voxel.y - offset.y, voxel.z - offset.z),
  });
}

function rebuild_runtime_indices(runtime: PainterDocumentRuntime): void {
  runtime.group_voxel_index.clear();
  runtime.coordinate_group_index.clear();
  runtime.resolved_visible_index.clear();
  runtime.resolved_group_bounds_index.clear();

  for (const groupId of Object.keys(runtime.document.groups)) {
    const group = runtime.document.groups[groupId]!;
    const voxelMap = new Map<string, PainterVoxelRecord>();
    if (group.visible && is_painter_group_active_at_breath(group, runtime.active_breath)) {
      const activeState = get_painter_group_content_state_at_breath(group, runtime.active_breath);
      const offset = resolve_painter_group_location_at_breath(group, runtime.active_breath);
      for (const localVoxel of activeState?.content ?? []) {
        const worldVoxel = project_painter_group_local_voxel_to_world(localVoxel, offset);
        voxelMap.set(worldVoxel.key, worldVoxel);
      }
      const extents = scan_world_extents_from_voxel_maps([voxelMap]);
      if (extents) runtime.resolved_group_bounds_index.set(groupId, extents);
    }
    runtime.group_voxel_index.set(groupId, voxelMap);
    for (const key of voxelMap.keys()) {
      const contributors = runtime.coordinate_group_index.get(key) ?? [];
      if (!contributors.includes(groupId)) contributors.push(groupId);
      runtime.coordinate_group_index.set(key, contributors);
    }
  }

  for (const key of runtime.coordinate_group_index.keys()) rebuild_winner_for_coord(runtime, key);
  refresh_document_extents(runtime);
}

export function set_painter_runtime_active_breath(runtime: PainterDocumentRuntime, breath: number): void {
  runtime.active_breath = Math.floor(breath);
  rebuild_runtime_indices(runtime);
}

export function resolve_painter_voxel_winner(runtime: PainterDocumentRuntime, coordKey: PainterCoordKey): ResolveVoxelWinnerResult {
  const contributors = runtime.coordinate_group_index.get(coordKey) ?? [];
  if (contributors.length < 1) return { winning_group_id: null, cell: null };
  for (let i = runtime.document.group_order.length - 1; i >= 0; i -= 1) {
    const groupId = runtime.document.group_order[i]!;
    if (!contributors.includes(groupId)) continue;
    const group = runtime.document.groups[groupId];
    if (!group?.visible) continue;
    if (!is_painter_group_active_at_breath(group, runtime.active_breath)) continue;
    const voxel = runtime.group_voxel_index.get(groupId)?.get(coordKey) ?? null;
    if (voxel) {
      return { winning_group_id: groupId, cell: clone_painter_voxel_record(voxel) };
    }
  }
  return { winning_group_id: null, cell: null };
}

export function resolve_painter_group_preview_winner(runtime: PainterDocumentRuntime, groupId: string, change: PainterPreviewCellChange): ResolveVoxelWinnerResult {
  const coordKey = make_painter_coord_key(change.x, change.y, change.z);
  const previewClearsCell = String(change.char ?? ' ') === ' ';
  const contributors = new Set(runtime.coordinate_group_index.get(coordKey) ?? []);
  if (previewClearsCell) contributors.delete(groupId);
  else contributors.add(groupId);
  if (contributors.size < 1) return { winning_group_id: null, cell: null };
  for (let i = runtime.document.group_order.length - 1; i >= 0; i -= 1) {
    const candidateGroupId = runtime.document.group_order[i]!;
    if (!contributors.has(candidateGroupId)) continue;
    const group = runtime.document.groups[candidateGroupId];
    if (!group?.visible || !is_painter_group_active_at_breath(group, runtime.active_breath)) continue;
    if (candidateGroupId === groupId) {
      if (previewClearsCell) continue;
      return {
        winning_group_id: groupId,
        cell: clone_painter_voxel_record({
          x: Math.floor(change.x),
          y: Math.floor(change.y),
          z: Math.floor(change.z),
          key: coordKey,
          char: String(change.char ?? ' ').charAt(0) || ' ',
          rgb: { ...change.rgb },
          weight_index: change.weight_index,
        }),
      };
    }
    const voxel = runtime.group_voxel_index.get(candidateGroupId)?.get(coordKey) ?? null;
    if (voxel) {
      return { winning_group_id: candidateGroupId, cell: clone_painter_voxel_record(voxel) };
    }
  }
  return { winning_group_id: null, cell: null };
}

function rebuild_winner_for_coord(runtime: PainterDocumentRuntime, coordKey: PainterCoordKey): void {
  const winner = resolve_painter_voxel_winner(runtime, coordKey);
  if (!winner.winning_group_id || !winner.cell) {
    runtime.resolved_visible_index.delete(coordKey);
    return;
  }
  runtime.resolved_visible_index.set(coordKey, {
    x: winner.cell.x,
    y: winner.cell.y,
    z: winner.cell.z,
    winning_group_id: winner.winning_group_id,
    cell: winner.cell,
  });
}

export function normalize_painter_document_runtime(document: PainterDocument, opts?: { active_breath?: number }): PainterDocumentRuntime {
  const cloned = clone_painter_document(document);
  cloned.bounds = normalize_document_bounds(cloned.bounds);
  cloned.group_order = normalize_group_order(cloned);
  const runtime: PainterDocumentRuntime = {
    document: cloned,
    active_breath: Math.floor(opts?.active_breath ?? 0),
    group_voxel_index: new Map<string, Map<string, PainterVoxelRecord>>(),
    coordinate_group_index: new Map<string, string[]>(),
    resolved_visible_index: new Map<string, ResolvedPainterVoxel>(),
    resolved_group_bounds_index: new Map<string, PainterGroupWorldBounds>(),
  };
  rebuild_runtime_indices(runtime);
  return runtime;
}

export function get_group_voxel(runtime: PainterDocumentRuntime, groupId: string, coordKey: PainterCoordKey): PainterVoxelRecord | null {
  const voxel = runtime.group_voxel_index.get(groupId)?.get(coordKey) ?? null;
  return voxel ? clone_painter_voxel_record(voxel) : null;
}

function get_or_create_active_content_state(group: PainterGroup, breath: number): PainterGroupContentState {
  const activeState = get_painter_group_content_state_at_breath(group, breath);
  if (activeState) return activeState;
  const createdState = {
    id: `content_state_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    label: `State ${group.content_states.length + 1}`,
    index: group.content_states.length,
    length_breaths: 1,
    content: [],
  } satisfies PainterGroupContentState;
  group.content_states = normalize_painter_group_content_states([...group.content_states, createdState]);
  return createdState;
}

export function set_group_voxel_at_breath(runtime: PainterDocumentRuntime, groupId: string, breath: number, voxel: PainterVoxelRecord, options?: {
  auto_key?: boolean;
}): { applied: boolean; reason?: 'no_visible_raster_content' } {
  const group = runtime.document.groups[groupId];
  if (!group) throw new Error(`painter_group_not_found:${groupId}`);
  const resolved = resolve_group_voxel_edit_state(group, breath, { auto_key: options?.auto_key, allow_create: true });
  if (!resolved.state_id) return { applied: false, reason: 'no_visible_raster_content' };
  const state = group.content_states.find((entry) => entry.id === resolved.state_id) ?? null;
  if (!state) return { applied: false, reason: 'no_visible_raster_content' };
  const offset = resolve_painter_group_location_at_breath(group, breath);
  const localVoxel = unproject_painter_group_world_voxel_to_local(clone_painter_voxel_record(voxel), offset);
  const stateMap = new Map<string, PainterVoxelRecord>();
  for (const existing of state.content) stateMap.set(existing.key, clone_painter_voxel_record(existing));
  stateMap.set(localVoxel.key, localVoxel);
  set_group_content_state_array(group, state.id, stateMap);
  touch_modified_at(runtime.document);
  rebuild_runtime_indices(runtime);
  return { applied: true };
}

export function erase_group_voxel_at_breath(runtime: PainterDocumentRuntime, groupId: string, breath: number, coordKey: PainterCoordKey): { applied: boolean; reason?: 'no_visible_raster_content' } {
  const group = runtime.document.groups[groupId];
  const worldVoxel = runtime.group_voxel_index.get(groupId)?.get(coordKey) ?? null;
  if (!group || !worldVoxel) return { applied: false, reason: 'no_visible_raster_content' };
  const resolved = resolve_group_voxel_edit_state(group, breath, { auto_key: false, allow_create: false });
  if (!resolved.state_id) return { applied: false, reason: 'no_visible_raster_content' };
  const state = group.content_states.find((entry) => entry.id === resolved.state_id) ?? null;
  if (!state) return { applied: false, reason: 'no_visible_raster_content' };
  const offset = resolve_painter_group_location_at_breath(group, breath);
  const localVoxel = unproject_painter_group_world_voxel_to_local(worldVoxel, offset);
  const stateMap = new Map<string, PainterVoxelRecord>();
  for (const existing of state.content) stateMap.set(existing.key, clone_painter_voxel_record(existing));
  stateMap.delete(localVoxel.key);
  set_group_content_state_array(group, state.id, stateMap);
  touch_modified_at(runtime.document);
  rebuild_runtime_indices(runtime);
  return { applied: true };
}

export function set_group_voxel(runtime: PainterDocumentRuntime, groupId: string, voxel: PainterVoxelRecord): void {
  set_group_voxel_at_breath(runtime, groupId, runtime.active_breath, voxel, { auto_key: true });
}

export function erase_group_voxel(runtime: PainterDocumentRuntime, groupId: string, coordKey: PainterCoordKey): void {
  erase_group_voxel_at_breath(runtime, groupId, runtime.active_breath, coordKey);
}

export function reorder_painter_groups(runtime: PainterDocumentRuntime, nextGroupOrder: string[]): void {
  const normalized = nextGroupOrder.filter((groupId) => !!runtime.document.groups[groupId]);
  for (const groupId of Object.keys(runtime.document.groups)) {
    if (!normalized.includes(groupId)) normalized.push(groupId);
  }
  runtime.document.group_order = normalized;
  touch_modified_at(runtime.document);
  rebuild_runtime_indices(runtime);
}

export function set_painter_group_visibility(runtime: PainterDocumentRuntime, groupId: string, visible: boolean): void {
  const group = runtime.document.groups[groupId];
  if (!group || group.visible === visible) return;
  group.visible = visible;
  touch_modified_at(runtime.document);
  rebuild_runtime_indices(runtime);
}

export function set_painter_group_locked(runtime: PainterDocumentRuntime, groupId: string, locked: boolean): void {
  const group = runtime.document.groups[groupId];
  if (!group || group.locked === locked) return;
  group.locked = locked;
  touch_modified_at(runtime.document);
}

export function set_painter_document_timing(runtime: PainterDocumentRuntime, args: {
  breath_range_start: number;
  breath_range_end: number;
  frames_per_breath: number;
  loop_enabled: boolean;
}): void {
  runtime.document.breath = clone_painter_document_breath({
    start: 0,
    cropped_start: Math.max(0, Math.floor(args.breath_range_start)),
    cropped_end: Math.max(0, Math.floor(args.breath_range_end)),
    range_start: Math.max(0, Math.floor(args.breath_range_start)),
    range_end: Math.max(0, Math.floor(args.breath_range_end)),
  });
  runtime.document.playback = clone_painter_document_playback({
    frames_per_breath: Math.max(1, Math.floor(args.frames_per_breath)),
    loop_enabled: args.loop_enabled,
  });
  touch_modified_at(runtime.document);
}

export function set_painter_document_loop_window(runtime: PainterDocumentRuntime, args: {
  breath_start: number;
  breath_end: number;
}): void {
  const current = clone_painter_document_breath(runtime.document.breath);
  const rangeStart = Math.max(0, Math.floor(current.range_start ?? 0));
  const rangeEnd = Math.max(rangeStart, Math.floor(current.range_end ?? rangeStart));
  const nextStart = Math.max(rangeStart, Math.min(rangeEnd, Math.floor(args.breath_start)));
  const nextEnd = Math.max(nextStart, Math.min(rangeEnd, Math.floor(args.breath_end)));
  runtime.document.breath = clone_painter_document_breath({
    ...current,
    cropped_start: nextStart,
    cropped_end: nextEnd,
  });
  touch_modified_at(runtime.document);
}

export function rename_painter_group(runtime: PainterDocumentRuntime, groupId: string, nextName: string): void {
  const group = runtime.document.groups[groupId];
  if (!group) return;
  group.name = String(nextName ?? '').trim() || group.name;
  if (group.metadata) group.metadata.modified_at = new Date().toISOString();
  touch_modified_at(runtime.document);
}

export function add_painter_group(runtime: PainterDocumentRuntime, group?: PainterGroup, opts?: { insert_before_group_id?: string }): PainterGroup {
  const nextGroup = group ? clone_painter_group(group) : create_painter_group(`Group ${runtime.document.group_order.length + 1}`, {
    breath_start: runtime.active_breath,
    breath_end: runtime.active_breath,
  });
  runtime.document.groups[nextGroup.id] = nextGroup;
  const insertBefore = opts?.insert_before_group_id;
  const nextOrder = runtime.document.group_order.filter((groupId) => groupId !== nextGroup.id);
  const insertIndex = insertBefore ? nextOrder.indexOf(insertBefore) : -1;
  if (insertIndex >= 0) nextOrder.splice(insertIndex, 0, nextGroup.id);
  else nextOrder.push(nextGroup.id);
  runtime.document.group_order = nextOrder;
  touch_modified_at(runtime.document);
  rebuild_runtime_indices(runtime);
  return clone_painter_group(nextGroup);
}

export function remove_painter_group(runtime: PainterDocumentRuntime, groupId: string): void {
  if (!runtime.document.groups[groupId]) return;
  delete runtime.document.groups[groupId];
  runtime.document.group_order = runtime.document.group_order.filter((id) => id !== groupId);
  touch_modified_at(runtime.document);
  rebuild_runtime_indices(runtime);
}

export function duplicate_painter_group(runtime: PainterDocumentRuntime, groupId: string, newName?: string): PainterGroup {
  const source = runtime.document.groups[groupId];
  if (!source) throw new Error(`painter_group_not_found:${groupId}`);
  const duplicated = clone_painter_group(source);
  duplicated.id = create_painter_group().id;
  duplicated.name = newName ?? `${source.name} (copy)`;
  duplicated.locked = false;
  const inserted = add_painter_group(runtime, duplicated);
  touch_modified_at(runtime.document);
  rebuild_runtime_indices(runtime);
  return clone_painter_group(runtime.document.groups[inserted.id]!);
}

export function export_painter_document(runtime: PainterDocumentRuntime): PainterDocument {
  refresh_document_extents(runtime);
  return clone_painter_document(runtime.document);
}
