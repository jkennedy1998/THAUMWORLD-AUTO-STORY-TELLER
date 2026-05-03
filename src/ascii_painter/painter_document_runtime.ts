import {
  clone_painter_document_breath,
  clone_painter_document_playback,
  clone_painter_channel,
  create_painter_group,
  derive_painter_group_properties_from_legacy_state,
  clone_painter_document,
  clone_painter_group,
  clone_painter_property,
  clone_painter_voxel_record,
  get_default_channel_value,
  get_painter_group_content_state_at_breath,
  make_painter_coord_key,
  type PainterChannel,
  type PainterChannelKind,
  type PainterChannelKey,
  normalize_painter_group_content_states,
  type PainterCoordKey,
  type PainterDocument,
  type PainterGroup,
  type PainterGroupContentState,
  type PainterGroupLocationKey,
  type PainterGroupLocationOffset,
  type PainterOccupiedBounds,
  type PainterProperty,
  type PainterPropertyBlock,
  type PainterVoxelRecord,
} from './painter_document.js';
import { derive_group_breath_range, derive_group_raster_segment_ranges, evaluate_channel_at_breath, get_exact_channel_key, get_nearest_channel_key } from './painter_breath.js';

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

type PainterTimelineSummary = {
  group_id: string;
  start: number;
  cropped_start: number;
  cropped_end: number;
  derivative_end: number;
  raster_segments: Array<{ id: string; start: number; end: number; length_breaths: number; is_blank: boolean }>;
  move_blocks: Array<{ property_id: string; block_id: string; start: number; end: number; breath: number; is_blank: boolean }>;
};

function painter_timeline_runtime_log(event: string, payload?: Record<string, unknown>): void {
  try {
    console.log(`[PAINTER_TIMELINE_DEBUG] ${event} ${JSON.stringify(payload ?? {})}`);
  } catch {
    console.log(`[PAINTER_TIMELINE_DEBUG] ${event}`);
  }
}

function summarize_painter_group_timeline(group: PainterGroup): PainterTimelineSummary {
  const range = derive_group_breath_range(group);
  return {
    group_id: group.id,
    start: Math.max(0, Math.floor(group.start ?? 0)),
    cropped_start: range.cropped_start,
    cropped_end: range.cropped_end,
    derivative_end: range.derivative_end,
    raster_segments: derive_group_raster_segment_ranges(group).map((segment) => ({
      id: segment.segment_id,
      start: segment.start,
      end: segment.end,
      length_breaths: segment.length_breaths,
      is_blank: segment.state.content.length < 1,
    })),
    move_blocks: (Array.isArray(group.property_ids) ? group.property_ids : [])
      .map((propertyId) => group.properties?.[propertyId] ?? null)
      .filter((property): property is PainterProperty => !!property && property.kind === 'move')
      .flatMap((property) => property.blocks.map((block) => ({
        property_id: property.id,
        block_id: block.id,
        start: Math.floor(block.start),
        end: Math.max(Math.floor(block.start), Math.floor(block.end)),
        breath: Math.floor(block.start),
        is_blank: block.type === 'blank',
      }))),
  };
}

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

function get_group_channels_by_kind(group: PainterGroup, kind: PainterChannelKind): PainterChannel[] {
  const orderedIds = Array.isArray(group.channel_ids) ? group.channel_ids : [];
  const out: PainterChannel[] = [];
  for (const id of orderedIds) {
    const channel = group.channels?.[id];
    if (!channel || channel.kind !== kind) continue;
    out.push(channel);
  }
  return out;
}

export function get_painter_group_properties_by_kind(group: PainterGroup, kind: PainterProperty['kind']): PainterProperty[] {
  const orderedIds = Array.isArray(group.property_ids) ? group.property_ids : [];
  const out: PainterProperty[] = [];
  for (const id of orderedIds) {
    const property = group.properties?.[id];
    if (!property || property.kind !== kind) continue;
    out.push(clone_painter_property(property));
  }
  return out;
}

function sync_group_properties_compat(group: PainterGroup): void {
  const derived = derive_painter_group_properties_from_legacy_state({
    channels: group.channels,
    channel_ids: group.channel_ids,
    content_states: group.content_states,
    group_start: group.start,
  });
  const nextProperties: Record<string, PainterGroup['properties'][string]> = { ...group.properties };
  for (const [propertyId, property] of Object.entries(derived.properties)) nextProperties[propertyId] = property;
  const nextPropertyIds = [...group.property_ids.filter((propertyId) => !!nextProperties[propertyId])];
  for (const propertyId of derived.property_ids) {
    if (!nextPropertyIds.includes(propertyId)) nextPropertyIds.push(propertyId);
  }
  for (const propertyId of Object.keys(nextProperties)) {
    if (!nextPropertyIds.includes(propertyId)) nextPropertyIds.push(propertyId);
  }
  group.property_ids = nextPropertyIds;
  group.properties = nextProperties;
}

export function get_active_painter_property_block_at_breath(property: PainterProperty, breath: number): PainterPropertyBlock | null {
  const targetBreath = Math.floor(breath);
  for (const block of property.blocks) {
    if (targetBreath >= block.start && targetBreath <= block.end) return structuredClone(block);
  }
  return null;
}

export function get_exact_painter_property_block(property: PainterProperty, breath: number): PainterPropertyBlock | null {
  const targetBreath = Math.floor(breath);
  const exact = property.blocks.find((block) => block.start === targetBreath) ?? null;
  return exact ? structuredClone(exact) : null;
}

export function resolve_painter_group_property_blocks_at_breath(group: PainterGroup, breath: number, kind?: PainterProperty['kind']): PainterPropertyBlock[] {
  const propertyIds = Array.isArray(group.property_ids) ? group.property_ids : [];
  const out: PainterPropertyBlock[] = [];
  for (const propertyId of propertyIds) {
    const property = group.properties?.[propertyId];
    if (!property || (kind && property.kind !== kind)) continue;
    const active = get_active_painter_property_block_at_breath(property, breath);
    if (active) out.push(active);
  }
  return out;
}

function resolve_group_raster_property_voxels_at_breath(group: PainterGroup, breath: number): PainterVoxelRecord[] {
  const propertyStack = get_painter_group_properties_by_kind(group, 'raster');
  const voxelMap = new Map<string, PainterVoxelRecord>();
  for (const property of propertyStack) {
    const block = get_active_painter_property_block_at_breath(property, breath);
    if (!block || block.type !== 'content' || block.value.kind !== 'raster') continue;
    for (const voxel of block.value.voxels) voxelMap.set(voxel.key, clone_painter_voxel_record(voxel));
  }
  return Array.from(voxelMap.values()).sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
}

function create_blank_property_block(start: number, end: number): PainterPropertyBlock {
  const normalizedStart = Math.max(0, Math.floor(start));
  const normalizedEnd = Math.max(normalizedStart, Math.floor(end));
  return {
    id: make_runtime_property_block_id(),
    type: 'blank',
    start: normalizedStart,
    end: normalizedEnd,
    mode: 'clip',
    left_boundary: 'clip',
    right_boundary: 'clip',
  };
}

function create_raster_content_property_block(start: number, end: number, voxels: PainterVoxelRecord[], id?: string): PainterPropertyBlock {
  const normalizedStart = Math.max(0, Math.floor(start));
  const normalizedEnd = Math.max(normalizedStart, Math.floor(end));
  return {
    id: id ?? make_runtime_property_block_id(),
    type: 'content',
    start: normalizedStart,
    end: normalizedEnd,
    value: {
      kind: 'raster',
      voxels: voxels.map(clone_painter_voxel_record),
    },
  };
}

function create_value_property_block(start: number, end: number, value: PainterProperty['blocks'][number] extends infer _T ? any : never, id?: string): PainterPropertyBlock {
  const normalizedStart = Math.max(0, Math.floor(start));
  const normalizedEnd = Math.max(normalizedStart, Math.floor(end));
  return {
    id: id ?? make_runtime_property_block_id(),
    type: 'content',
    start: normalizedStart,
    end: normalizedEnd,
    value: structuredClone(value),
  };
}

function normalize_property_blocks_in_place(property: PainterProperty): void {
  property.blocks = property.blocks
    .map((block) => block.type === 'blank'
      ? { ...block, start: Math.max(0, Math.floor(block.start)), end: Math.max(Math.max(0, Math.floor(block.start)), Math.floor(block.end)), mode: (block.mode === 'linear' ? 'linear' : 'clip') as 'clip' | 'linear', left_boundary: block.left_boundary ?? 'clip', right_boundary: block.right_boundary ?? 'clip' }
      : { ...block, start: Math.max(0, Math.floor(block.start)), end: Math.max(Math.max(0, Math.floor(block.start)), Math.floor(block.end)) })
    .sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));
}

function merge_adjacent_property_blocks(property: PainterProperty): void {
  normalize_property_blocks_in_place(property);
  const merged: PainterPropertyBlock[] = [];
  for (const block of property.blocks) {
    const last = merged[merged.length - 1] ?? null;
    if (!last) {
      merged.push(block);
      continue;
    }
    if (last.type === 'blank' && block.type === 'blank' && last.end + 1 >= block.start && last.mode === block.mode) {
      last.end = Math.max(last.end, block.end);
      continue;
    }
    merged.push(block);
  }
  property.blocks = merged;
}

function normalize_non_raster_hold_ranges(property: PainterProperty): void {
  if (property.kind === 'raster') return;
  normalize_property_blocks_in_place(property);
  for (let index = 0; index < property.blocks.length; index += 1) {
    const block = property.blocks[index]!;
    const next = property.blocks[index + 1] ?? null;
    if (next) block.end = Math.max(block.start, next.start - 1);
    else block.end = Math.max(block.start, block.end);
  }
}

function find_property_and_block(group: PainterGroup, blockId: string, kind?: PainterProperty['kind']): { property: PainterProperty; block: PainterPropertyBlock; index: number } | null {
  for (const propertyId of Array.isArray(group.property_ids) ? group.property_ids : []) {
    const property = group.properties?.[propertyId];
    if (!property || (kind && property.kind !== kind)) continue;
    const index = property.blocks.findIndex((block) => block.id === blockId);
    if (index >= 0) return { property, block: property.blocks[index]!, index };
  }
  return null;
}

function get_primary_property(group: PainterGroup, kind: PainterProperty['kind'], createIfMissing: boolean): PainterProperty | null {
  const existing = get_painter_group_properties_by_kind(group, kind)[0] ?? null;
  if (existing) return group.properties[existing.id] ?? existing;
  if (!createIfMissing) return null;
  const propertyId = make_runtime_property_id(kind);
  const property = clone_painter_property({
    id: propertyId,
    kind,
    label: kind === 'raster' ? 'content' : kind,
    process_mode: 'add',
    blocks: kind === 'raster'
      ? [create_blank_property_block(Math.floor(group.start ?? group.breath_start ?? 0), Math.max(Math.floor(group.start ?? group.breath_start ?? 0), Math.floor(group.breath_end ?? group.cropped_end ?? group.start ?? 0)))]
      : [],
  });
  group.properties[propertyId] = property;
  group.property_ids.push(propertyId);
  return property;
}

function sync_group_timing_from_properties(group: PainterGroup): void {
  const blocks = (Array.isArray(group.property_ids) ? group.property_ids : [])
    .map((id) => group.properties?.[id] ?? null)
    .filter((property): property is PainterProperty => !!property)
    .flatMap((property) => property.blocks);
  const minStart = blocks.length > 0 ? blocks.reduce((min, block) => Math.min(min, Math.floor(block.start)), Math.floor(blocks[0]!.start)) : Math.max(0, Math.floor(group.start ?? 0));
  const maxEnd = blocks.length > 0 ? blocks.reduce((max, block) => Math.max(max, Math.floor(block.end)), minStart) : Math.max(minStart, Math.floor(group.breath_end ?? group.cropped_end ?? minStart));
  group.start = minStart;
  group.cropped_start = minStart;
  group.cropped_end = maxEnd;
  group.breath_start = group.cropped_start;
  group.breath_end = group.cropped_end;
}

function ensure_group_channel(group: PainterGroup, args: { kind: PainterChannelKind; label: string; channel_id?: string | null }): PainterChannel {
  const requestedId = String(args.channel_id ?? '').trim();
  if (requestedId && group.channels[requestedId]) return group.channels[requestedId]!;
  const existing = get_group_channels_by_kind(group, args.kind)[0] ?? null;
  if (existing) return existing;
  const id = requestedId || `${args.kind}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const channel = clone_painter_channel({
    id,
    kind: args.kind,
    label: args.label,
    gap_behavior: 'clip',
    before_first_behavior: 'none',
    after_last_behavior: 'none',
    keys: [],
  });
  group.channels[id] = channel;
  group.channel_ids = [...group.channel_ids.filter((channelId) => channelId !== id), id];
  sync_group_properties_compat(group);
  return channel;
}

function set_channel_key(channel: PainterChannel, breath: number, value: PainterChannelKey['value']): void {
  const targetBreath = Math.max(0, Math.floor(breath));
  const nextKey: PainterChannelKey = {
    id: channel.keys.find((key) => key.breath === targetBreath)?.id ?? `channel_key_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    breath: targetBreath,
    value: structuredClone(value),
  };
  const nextKeys = channel.keys.filter((key) => key.breath !== targetBreath);
  nextKeys.push(nextKey);
  channel.keys = nextKeys.sort((a, b) => a.breath - b.breath || a.id.localeCompare(b.id));
}

function move_channel_key_by_id(channel: PainterChannel, keyId: string, targetBreath: number): void {
  const normalizedKeyId = String(keyId ?? '').trim();
  const nextBreath = Math.max(0, Math.floor(targetBreath));
  const sourceKey = channel.keys.find((key) => key.id === normalizedKeyId) ?? null;
  if (!sourceKey) throw new Error(`painter_channel_key_id_not_found:${normalizedKeyId}`);
  const nextKeys = channel.keys.filter((key) => key.id !== normalizedKeyId && key.breath !== nextBreath);
  nextKeys.push({ ...sourceKey, breath: nextBreath });
  channel.keys = nextKeys.sort((a, b) => a.breath - b.breath || a.id.localeCompare(b.id));
}

function make_runtime_property_id(kind: string): string {
  return `${kind}_property_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function make_runtime_property_block_id(): string {
  return `property_block_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function resolve_primary_location_channel(group: PainterGroup): PainterChannel | null {
  return get_group_channels_by_kind(group, 'location')[0] ?? null;
}

function resolve_primary_raster_channel(group: PainterGroup): PainterChannel | null {
  return get_group_channels_by_kind(group, 'raster_content')[0] ?? null;
}

function sync_raster_channel_from_content_states(group: PainterGroup): void {
  const channel = ensure_group_channel(group, { kind: 'raster_content', label: 'content', channel_id: resolve_primary_raster_channel(group)?.id ?? null });
  let cursor = Math.max(0, Math.floor(group.start ?? group.breath_start ?? 0));
  const keys = normalize_painter_group_content_states(group.content_states).map((state) => {
    const nextKey: PainterChannelKey = {
      id: state.id,
      breath: cursor,
      value: {
        kind: 'raster',
        voxels: state.content.map(clone_painter_voxel_record),
      },
    };
    cursor += Math.max(1, Math.floor(state.length_breaths ?? 1));
    return nextKey;
  });
  keys.push({
    id: `${channel.id}_terminal`,
    breath: cursor,
    value: { kind: 'raster', voxels: [] },
  });
  channel.keys = keys;
  sync_group_properties_compat(group);
}

function set_group_content_state_array(group: PainterGroup, stateId: string, voxelMap: Map<string, PainterVoxelRecord>): void {
  group.content_states = normalize_painter_group_content_states(
    group.content_states.map((state) => state.id === stateId
      ? { ...state, content: Array.from(voxelMap.values()).map(clone_painter_voxel_record) }
      : state),
    undefined
  );
  sync_raster_channel_from_content_states(group);
  sync_group_properties_compat(group);
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

function is_blank_content_state(state: PainterGroupContentState): boolean {
  return state.content.length < 1;
}

function normalize_raster_blank_states(group: PainterGroup): void {
  group.content_states = normalize_painter_group_content_states(group.content_states);
  sync_group_properties_compat(group);
}

function merge_adjacent_blank_raster_states(group: PainterGroup): void {
  const normalized = normalize_painter_group_content_states(group.content_states);
  const merged: PainterGroupContentState[] = [];
  for (const state of normalized) {
    const last = merged[merged.length - 1] ?? null;
    if (last && is_blank_content_state(last) && is_blank_content_state(state)) {
      last.length_breaths += Math.max(1, state.length_breaths);
      continue;
    }
    merged.push({ ...state });
  }
  group.content_states = merged.map((state, index) => ({ ...state, index }));
  sync_group_properties_compat(group);
}

function trim_terminal_blank_raster_states(group: PainterGroup): void {
  while (group.content_states.length > 0 && is_blank_content_state(group.content_states[0]!)) group.content_states.shift();
  while (group.content_states.length > 0 && is_blank_content_state(group.content_states[group.content_states.length - 1]!)) group.content_states.pop();
  group.content_states = group.content_states.map((state, index) => ({ ...state, index }));
  sync_group_properties_compat(group);
}

type RasterTimelineCell = {
  source_id: string;
  label: string;
  content: PainterVoxelRecord[];
};

function build_raster_timeline_cells(group: PainterGroup): { start: number; end: number; cells: Array<RasterTimelineCell | null> } {
  const segments = derive_group_raster_segment_ranges(group);
  const start = segments.length > 0
    ? segments.reduce((min, segment) => Math.min(min, segment.start), Number.POSITIVE_INFINITY)
    : Math.max(0, Math.floor(group.start ?? group.breath_start ?? 0));
  const end = segments.length > 0
    ? segments.reduce((max, segment) => Math.max(max, segment.end), Math.max(0, start))
    : Math.max(start, Math.floor(group.breath_end ?? group.cropped_end ?? start));
  const cells: Array<RasterTimelineCell | null> = [];
  for (let breath = start; breath <= end; breath += 1) cells.push(null);
  for (const segment of segments) {
    const cell = segment.state.content.length <= 0
      ? null
      : {
          source_id: segment.segment_id,
          label: segment.state.label,
          content: segment.state.content.map(clone_painter_voxel_record),
        } satisfies RasterTimelineCell;
    for (let breath = segment.start; breath <= segment.end; breath += 1) {
      cells[breath - start] = cell ? { ...cell, content: cell.content.map(clone_painter_voxel_record) } : null;
    }
  }
  return {
    start,
    end: Math.max(start, end),
    cells,
  };
}

function rebuild_raster_states_from_timeline(group: PainterGroup, timelineStart: number, cells: Array<RasterTimelineCell | null>): void {
  let firstContent = -1;
  let lastContent = -1;
  for (let i = 0; i < cells.length; i += 1) {
    if (!cells[i]) continue;
    if (firstContent < 0) firstContent = i;
    lastContent = i;
  }
  if (firstContent < 0 || lastContent < 0) {
    group.content_states = [{ ...create_empty_content_state('Blank', Math.max(1, cells.length || 1)), index: 0 }];
    group.start = Math.max(0, timelineStart);
    sync_group_timing_compat(group, { preserve_blank_boundaries: true });
    return;
  }
  const trimmed = cells.slice(firstContent, lastContent + 1);
  group.start = Math.max(0, timelineStart + firstContent);
  const nextStates: PainterGroupContentState[] = [];
  const idUsage = new Map<string, number>();
  let cursor = 0;
  while (cursor < trimmed.length) {
    const cell = trimmed[cursor] ?? null;
    let runEnd = cursor;
    while (runEnd + 1 < trimmed.length) {
      const next = trimmed[runEnd + 1] ?? null;
      if (cell === null && next === null) {
        runEnd += 1;
        continue;
      }
      if (cell !== null && next !== null && next.source_id === cell.source_id && next.label === cell.label) {
        runEnd += 1;
        continue;
      }
      break;
    }
    const length = runEnd - cursor + 1;
    if (cell === null) {
      nextStates.push({ ...create_empty_content_state('Blank', length), index: nextStates.length });
    } else {
      const seen = idUsage.get(cell.source_id) ?? 0;
      idUsage.set(cell.source_id, seen + 1);
      nextStates.push({
        id: seen === 0 ? cell.source_id : create_content_state_id(),
        label: cell.label,
        index: nextStates.length,
        length_breaths: length,
        content: cell.content.map(clone_painter_voxel_record),
      });
    }
    cursor = runEnd + 1;
  }
  group.content_states = nextStates;
  sync_group_timing_compat(group, { preserve_blank_boundaries: true });
}

function sync_group_timing_compat(group: PainterGroup, opts?: { preserve_blank_boundaries?: boolean }): void {
  let cursor = Math.max(0, Math.floor(group.start ?? 0));
  if (opts?.preserve_blank_boundaries !== true) normalize_raster_blank_states(group);
  group.content_states = normalize_painter_group_content_states(group.content_states).map((state, index) => {
    const next = {
      ...state,
      index,
      length_breaths: Math.max(1, Math.floor(state.length_breaths ?? 1)),
    };
    cursor += next.length_breaths;
    return next;
  });
  sync_raster_channel_from_content_states(group);
  const derivativeEnd = Math.max(Math.max(0, Math.floor(group.start ?? 0)), cursor - 1);
  group.cropped_start = Math.max(Math.floor(group.start ?? 0), Math.floor(group.cropped_start ?? group.start ?? 0));
  group.cropped_end = Math.max(group.cropped_start, Math.min(Math.floor(group.cropped_end ?? derivativeEnd), derivativeEnd));
  group.breath_start = group.cropped_start;
  group.breath_end = group.cropped_end;
  sync_group_properties_compat(group);
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
    const offsets = get_painter_group_properties_by_kind(group, 'move')
      .flatMap((property) => property.blocks)
      .map((block) => block.type === 'content' && block.value.kind === 'vec3'
        ? { x: block.value.x, y: block.value.y, z: block.value.z }
        : { x: 0, y: 0, z: 0 });
    if (offsets.length < 1) offsets.push({ x: 0, y: 0, z: 0 });
    for (const property of get_painter_group_properties_by_kind(group, 'raster')) {
      for (const block of property.blocks) {
        if (block.type !== 'content' || block.value.kind !== 'raster') continue;
        for (const voxel of block.value.voxels) {
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
  const properties = get_painter_group_properties_by_kind(group, 'move');
  if (properties.length > 0) {
    return properties.reduce((resolved, property) => {
      const block = get_active_painter_property_block_at_breath(property, breath);
      if (!block || block.type !== 'content' || block.value.kind !== 'vec3') return resolved;
      return add_offset(resolved, { x: block.value.x, y: block.value.y, z: block.value.z });
    }, { x: 0, y: 0, z: 0 } satisfies PainterGroupLocationOffset);
  }
  return get_group_channels_by_kind(group, 'location').reduce((resolved, channel) => {
    const value = evaluate_channel_at_breath(channel, breath);
    return value.kind === 'vec3'
      ? add_offset(resolved, { x: value.x, y: value.y, z: value.z })
      : resolved;
  }, { x: 0, y: 0, z: 0 } satisfies PainterGroupLocationOffset);
}

export function resolve_nearest_painter_group_location_key(group: PainterGroup, breath: number): PainterGroupLocationKey | null {
  const channel = resolve_primary_location_channel(group);
  const key = channel ? get_nearest_channel_key(channel, breath) : null;
  return key && key.value.kind === 'vec3'
    ? { breath: key.breath, offset: { x: key.value.x, y: key.value.y, z: key.value.z } }
    : null;
}

export function get_exact_painter_group_location_key(group: PainterGroup, breath: number): PainterGroupLocationKey | null {
  const channel = resolve_primary_location_channel(group);
  const key = channel ? get_exact_channel_key(channel, breath) : null;
  return key && key.value.kind === 'vec3'
    ? { breath: key.breath, offset: { x: key.value.x, y: key.value.y, z: key.value.z } }
    : null;
}

export function set_painter_group_location_key(runtime: PainterDocumentRuntime, groupId: string, breath: number, offset: PainterGroupLocationOffset): void {
  set_painter_group_channel_key(runtime, groupId, {
    channel_kind: 'location',
    channel_label: 'move',
    breath,
    value: { kind: 'vec3', x: offset.x, y: offset.y, z: offset.z },
  });
}

export function set_painter_group_property_block(runtime: PainterDocumentRuntime, groupId: string, args: {
  property_kind: 'move' | 'rotation';
  property_label?: string;
  property_id?: string | null;
  breath: number;
  value: PainterChannelKey['value'];
}): { property_id: string } {
  const group = runtime.document.groups[groupId];
  if (!group) throw new Error(`painter_group_not_found:${groupId}`);
  const targetBreath = Math.max(0, Math.floor(args.breath));
  const requestedId = String(args.property_id ?? '').trim();
  let property = requestedId ? group.properties[requestedId] ?? null : null;
  if (!property) property = get_primary_property(group, args.property_kind, true);
  if (!property) throw new Error(`painter_property_not_found:${requestedId || args.property_kind}`);
  property.label = String(args.property_label ?? '').trim() || property.label;
  const nextBlocks = property.blocks.filter((block) => !(block.start === targetBreath));
  const following = nextBlocks.filter((block) => block.start > targetBreath).sort((a, b) => a.start - b.start)[0] ?? null;
  nextBlocks.push(create_value_property_block(targetBreath, following ? Math.max(targetBreath, following.start - 1) : targetBreath, args.value));
  property.blocks = nextBlocks;
  merge_adjacent_property_blocks(property);
  normalize_non_raster_hold_ranges(property);
  sync_group_timing_from_properties(group);
  if (group.metadata) group.metadata.modified_at = new Date().toISOString();
  touch_modified_at(runtime.document);
  rebuild_runtime_indices(runtime);
  return { property_id: property.id };
}

export function set_painter_group_channel_key(runtime: PainterDocumentRuntime, groupId: string, args: {
  channel_kind: PainterChannelKind;
  channel_label?: string;
  channel_id?: string | null;
  breath: number;
  value: PainterChannelKey['value'];
}): { channel_id: string } {
  const property_kind: PainterProperty['kind'] = args.channel_kind === 'location'
    ? 'move'
    : args.channel_kind === 'rotation'
      ? 'rotation'
      : 'raster';
  const result = set_painter_group_property_block(runtime, groupId, {
    property_kind: property_kind === 'move' || property_kind === 'rotation' ? property_kind : 'move',
    property_label: args.channel_label,
    property_id: args.channel_id,
    breath: args.breath,
    value: args.value,
  });
  return { channel_id: result.property_id };
}

export function move_painter_group_channel_key(runtime: PainterDocumentRuntime, groupId: string, args: {
  channel_id: string;
  key_breath: number;
  target_breath: number;
}): void {
  move_painter_group_property_block(runtime, groupId, {
    property_id: args.channel_id,
    block_id: args.channel_id,
    target_breath: args.target_breath,
  });
}

export function move_painter_group_property_block(runtime: PainterDocumentRuntime, groupId: string, args: {
  property_id: string;
  block_id: string;
  target_breath: number;
}): void {
  const group = runtime.document.groups[groupId];
  if (!group) throw new Error(`painter_group_not_found:${groupId}`);
  const before = summarize_painter_group_timeline(group);
  painter_timeline_runtime_log('runtime_before', {
    command_kind: 'move_group_property_block',
    group_id: groupId,
    property_id: args.property_id,
    block_id: args.block_id,
    target_breath: Math.max(0, Math.floor(args.target_breath)),
    before,
  });
  const property = group.properties[args.property_id];
  if (!property) throw new Error(`painter_property_not_found:${args.property_id}`);
  const targetBlock = property.blocks.find((block) => block.id === args.block_id) ?? null;
  if (!targetBlock) throw new Error(`painter_property_block_not_found:${args.block_id}`);
  const targetBreath = Math.max(0, Math.floor(args.target_breath));
  const delta = targetBreath - targetBlock.start;
  targetBlock.start = targetBreath;
  targetBlock.end = Math.max(targetBreath, targetBlock.end + delta);
  merge_adjacent_property_blocks(property);
  normalize_non_raster_hold_ranges(property);
  sync_group_timing_from_properties(group);
  if (group.metadata) group.metadata.modified_at = new Date().toISOString();
  touch_modified_at(runtime.document);
  rebuild_runtime_indices(runtime);
  painter_timeline_runtime_log('runtime_after', {
    command_kind: 'move_group_property_block',
    group_id: groupId,
    property_id: args.property_id,
    block_id: args.block_id,
    target_breath: Math.max(0, Math.floor(args.target_breath)),
    before,
    after: summarize_painter_group_timeline(group),
  });
}

export function set_painter_group_breath_span(runtime: PainterDocumentRuntime, groupId: string, breathStart: number, breathEnd: number): void {
  const group = runtime.document.groups[groupId];
  if (!group) throw new Error(`painter_group_not_found:${groupId}`);
  const nextStart = Math.max(0, Math.floor(breathStart));
  const nextEnd = Math.max(nextStart, Math.floor(breathEnd));
  group.start = nextStart;
  group.cropped_start = nextStart;
  group.cropped_end = nextEnd;
  group.breath_start = nextStart;
  group.breath_end = nextEnd;
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
    ...(Array.isArray(group.property_ids) ? group.property_ids : []).flatMap((propertyId) => (group.properties?.[propertyId]?.blocks ?? []).map((block) => Math.floor(block.start))),
  );
  const appliedDelta = Math.max(-minimumBreath, delta);
  if (appliedDelta === 0) return;
  group.start = Math.max(0, Math.floor(group.start ?? 0) + appliedDelta);
  for (const propertyId of Array.isArray(group.property_ids) ? group.property_ids : []) {
    const property = group.properties?.[propertyId];
    if (!property) continue;
    property.blocks = property.blocks.map((block) => ({
      ...block,
      start: Math.max(0, Math.floor(block.start) + appliedDelta),
      end: Math.max(0, Math.floor(block.end) + appliedDelta),
    }));
  }
  sync_group_timing_from_properties(group);
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
  group.breath_start = group.cropped_start;
  group.breath_end = group.cropped_end;
  if (group.metadata) group.metadata.modified_at = new Date().toISOString();
  touch_modified_at(runtime.document);
  rebuild_runtime_indices(runtime);
}

export function set_painter_group_raster_segment_length(runtime: PainterDocumentRuntime, groupId: string, contentStateId: string, lengthBreaths: number): void {
  const group = runtime.document.groups[groupId];
  if (!group) throw new Error(`painter_group_not_found:${groupId}`);
  const targetLength = Math.max(1, Math.floor(lengthBreaths));
  const resolved = find_property_and_block(group, contentStateId, 'raster');
  if (!resolved) throw new Error(`painter_content_state_not_found:${contentStateId}`);
  resolved.block.end = resolved.block.start + targetLength - 1;
  merge_adjacent_property_blocks(resolved.property);
  sync_group_timing_from_properties(group);
  if (group.metadata) group.metadata.modified_at = new Date().toISOString();
  touch_modified_at(runtime.document);
  rebuild_runtime_indices(runtime);
}

export function split_painter_group_raster_segment(runtime: PainterDocumentRuntime, groupId: string, contentStateId: string, splitBreath: number): void {
  const group = runtime.document.groups[groupId];
  if (!group) throw new Error(`painter_group_not_found:${groupId}`);
  const before = summarize_painter_group_timeline(group);
  painter_timeline_runtime_log('runtime_before', {
    command_kind: 'split_group_raster_segment',
    group_id: groupId,
    content_state_id: contentStateId,
    split_breath: Math.floor(splitBreath),
    before,
  });
  const resolved = find_property_and_block(group, contentStateId, 'raster');
  const target = resolved ? { segment_id: resolved.block.id, start: resolved.block.start, end: resolved.block.end, block: resolved.block, property: resolved.property } : null;
  if (!target) throw new Error(`painter_content_state_not_found:${contentStateId}`);
  const splitAt = Math.floor(splitBreath);
  if (splitAt <= target.start || splitAt > target.end) return;
  const left = target.block.type === 'blank'
    ? create_blank_property_block(target.start, splitAt - 1)
    : create_raster_content_property_block(target.start, splitAt - 1, target.block.value.kind === 'raster' ? target.block.value.voxels : [], target.block.id);
  const right = target.block.type === 'blank'
    ? create_blank_property_block(splitAt, target.end)
    : create_raster_content_property_block(splitAt, target.end, target.block.value.kind === 'raster' ? target.block.value.voxels : []);
  replace_raster_block(target.property, contentStateId, [left, right]);
  sync_group_timing_from_properties(group);
  if (group.metadata) group.metadata.modified_at = new Date().toISOString();
  touch_modified_at(runtime.document);
  rebuild_runtime_indices(runtime);
  painter_timeline_runtime_log('runtime_after', {
    command_kind: 'split_group_raster_segment',
    group_id: groupId,
    content_state_id: contentStateId,
    split_breath: Math.floor(splitBreath),
    before,
    after: summarize_painter_group_timeline(group),
  });
}

export function swap_painter_group_raster_segments(runtime: PainterDocumentRuntime, groupId: string, sourceContentStateId: string, targetContentStateId: string): void {
  const group = runtime.document.groups[groupId];
  if (!group) throw new Error(`painter_group_not_found:${groupId}`);
  if (sourceContentStateId === targetContentStateId) return;
  const before = summarize_painter_group_timeline(group);
  painter_timeline_runtime_log('runtime_before', {
    command_kind: 'swap_group_raster_segments',
    group_id: groupId,
    source_content_state_id: sourceContentStateId,
    target_content_state_id: targetContentStateId,
    before,
  });
  const sourceResolved = find_property_and_block(group, sourceContentStateId, 'raster');
  const targetResolved = find_property_and_block(group, targetContentStateId, 'raster');
  if (!sourceResolved || !targetResolved || sourceResolved.property.id !== targetResolved.property.id) throw new Error('painter_content_state_not_found');
  const sourceStart = sourceResolved.block.start;
  const sourceEnd = sourceResolved.block.end;
  sourceResolved.block.start = targetResolved.block.start;
  sourceResolved.block.end = targetResolved.block.end;
  targetResolved.block.start = sourceStart;
  targetResolved.block.end = sourceEnd;
  merge_adjacent_property_blocks(sourceResolved.property);
  sync_group_timing_from_properties(group);
  if (group.metadata) group.metadata.modified_at = new Date().toISOString();
  touch_modified_at(runtime.document);
  rebuild_runtime_indices(runtime);
  painter_timeline_runtime_log('runtime_after', {
    command_kind: 'swap_group_raster_segments',
    group_id: groupId,
    source_content_state_id: sourceContentStateId,
    target_content_state_id: targetContentStateId,
    before,
    after: summarize_painter_group_timeline(group),
  });
}

export function blank_painter_group_raster_segment(runtime: PainterDocumentRuntime, groupId: string, contentStateId: string): void {
  const group = runtime.document.groups[groupId];
  if (!group) throw new Error(`painter_group_not_found:${groupId}`);
  const before = summarize_painter_group_timeline(group);
  painter_timeline_runtime_log('runtime_before', {
    command_kind: 'blank_group_raster_segment',
    group_id: groupId,
    content_state_id: contentStateId,
    before,
  });
  const resolved = find_property_and_block(group, contentStateId, 'raster');
  if (!resolved) throw new Error(`painter_content_state_not_found:${contentStateId}`);
  replace_raster_block(resolved.property, contentStateId, [create_blank_property_block(resolved.block.start, resolved.block.end)]);
  sync_group_timing_from_properties(group);
  if (group.metadata) group.metadata.modified_at = new Date().toISOString();
  touch_modified_at(runtime.document);
  rebuild_runtime_indices(runtime);
  painter_timeline_runtime_log('runtime_after', {
    command_kind: 'blank_group_raster_segment',
    group_id: groupId,
    content_state_id: contentStateId,
    before,
    after: summarize_painter_group_timeline(group),
  });
}

export function trim_painter_group_raster_segment_edge(runtime: PainterDocumentRuntime, groupId: string, contentStateId: string, edge: 'start' | 'end'): void {
  const group = runtime.document.groups[groupId];
  if (!group) throw new Error(`painter_group_not_found:${groupId}`);
  const resolved = find_property_and_block(group, contentStateId, 'raster');
  if (!resolved) throw new Error('painter_content_state_not_found');
  const target = resolved.block;
  if (target.end <= target.start) {
    blank_painter_group_raster_segment(runtime, groupId, contentStateId);
    return;
  }
  if (edge === 'start') {
    target.start += 1;
  } else {
    target.end -= 1;
  }
  merge_adjacent_property_blocks(resolved.property);
  sync_group_timing_from_properties(group);
  if (group.metadata) group.metadata.modified_at = new Date().toISOString();
  touch_modified_at(runtime.document);
  rebuild_runtime_indices(runtime);
}

export function merge_painter_group_blank_segment(runtime: PainterDocumentRuntime, groupId: string, contentStateId: string, direction: 'left' | 'right'): void {
  const group = runtime.document.groups[groupId];
  if (!group) throw new Error(`painter_group_not_found:${groupId}`);
  const before = summarize_painter_group_timeline(group);
  painter_timeline_runtime_log('runtime_before', {
    command_kind: 'merge_group_blank_segment',
    group_id: groupId,
    content_state_id: contentStateId,
    direction,
    before,
  });
  const resolved = find_property_and_block(group, contentStateId, 'raster');
  if (!resolved || resolved.block.type !== 'blank') throw new Error('painter_content_state_not_found');
  const blocks = resolved.property.blocks;
  const index = blocks.findIndex((block) => block.id === contentStateId);
  if (index < 0) throw new Error('painter_content_state_not_found');
  if (direction === 'left') {
    const previous = blocks[index - 1] ?? null;
    if (!previous || previous.type !== 'content') return;
    previous.end = Math.max(previous.end, resolved.block.end);
    blocks.splice(index, 1);
  } else {
    const next = blocks[index + 1] ?? null;
    if (!next || next.type !== 'content') return;
    next.start = Math.min(next.start, resolved.block.start);
    blocks.splice(index, 1);
  }
  merge_adjacent_property_blocks(resolved.property);
  sync_group_timing_from_properties(group);
  if (group.metadata) group.metadata.modified_at = new Date().toISOString();
  touch_modified_at(runtime.document);
  rebuild_runtime_indices(runtime);
  painter_timeline_runtime_log('runtime_after', {
    command_kind: 'merge_group_blank_segment',
    group_id: groupId,
    content_state_id: contentStateId,
    direction,
    before,
    after: summarize_painter_group_timeline(group),
  });
}

export function compact_painter_group_blank_segment_left(runtime: PainterDocumentRuntime, groupId: string, contentStateId: string): void {
  const group = runtime.document.groups[groupId];
  if (!group) throw new Error(`painter_group_not_found:${groupId}`);
  const before = summarize_painter_group_timeline(group);
  painter_timeline_runtime_log('runtime_before', {
    command_kind: 'compact_group_blank_segment_left',
    group_id: groupId,
    content_state_id: contentStateId,
    before,
  });
  merge_painter_group_blank_segment(runtime, groupId, contentStateId, 'left');
  painter_timeline_runtime_log('runtime_after', {
    command_kind: 'compact_group_blank_segment_left',
    group_id: groupId,
    content_state_id: contentStateId,
    before,
    after: summarize_painter_group_timeline(runtime.document.groups[groupId]!),
  });
}

export function move_painter_group_raster_segment(runtime: PainterDocumentRuntime, groupId: string, contentStateId: string, targetBreath: number): void {
  const group = runtime.document.groups[groupId];
  if (!group) throw new Error(`painter_group_not_found:${groupId}`);
  const before = summarize_painter_group_timeline(group);
  painter_timeline_runtime_log('runtime_before', {
    command_kind: 'move_group_raster_segment',
    group_id: groupId,
    content_state_id: contentStateId,
    target_breath: Math.max(0, Math.floor(targetBreath)),
    before,
  });
  const resolved = find_property_and_block(group, contentStateId, 'raster');
  if (!resolved) throw new Error('painter_content_state_not_found');
  const nextStart = Math.max(0, Math.floor(targetBreath));
  rewrite_painter_group_raster_property_span_destructive(group, resolved.property, resolved.block, nextStart, nextStart + (resolved.block.end - resolved.block.start));
  if (group.metadata) group.metadata.modified_at = new Date().toISOString();
  touch_modified_at(runtime.document);
  rebuild_runtime_indices(runtime);
  painter_timeline_runtime_log('runtime_after', {
    command_kind: 'move_group_raster_segment',
    group_id: groupId,
    content_state_id: contentStateId,
    target_breath: Math.max(0, Math.floor(targetBreath)),
    before,
    after: summarize_painter_group_timeline(group),
  });
}

function rewrite_painter_group_raster_segment_span_destructive(group: PainterGroup, target: ReturnType<typeof derive_group_raster_segment_ranges>[number], nextStart: number, nextEnd: number): void {
  const targetStart = Math.max(0, Math.floor(nextStart));
  const targetEnd = Math.max(targetStart, Math.floor(nextEnd));
  const timeline = build_raster_timeline_cells(group);
  const minBreath = Math.min(timeline.start, targetStart);
  const maxBreath = Math.max(timeline.end, targetEnd);
  const cells: Array<RasterTimelineCell | null> = [];
  for (let breath = minBreath; breath <= maxBreath; breath += 1) {
    const sourceIndex = breath - timeline.start;
    cells.push(sourceIndex >= 0 && sourceIndex < timeline.cells.length ? timeline.cells[sourceIndex]! : null);
  }
  const fillCell = target.state.content.length > 0
    ? {
        source_id: target.segment_id,
        label: target.state.label,
        content: target.state.content.map(clone_painter_voxel_record),
      } satisfies RasterTimelineCell
    : null;
  for (let breath = target.start; breath <= target.end; breath += 1) {
    cells[breath - minBreath] = null;
  }
  for (let breath = targetStart; breath <= targetEnd; breath += 1) {
    cells[breath - minBreath] = fillCell
      ? {
          source_id: fillCell.source_id,
          label: fillCell.label,
          content: fillCell.content.map(clone_painter_voxel_record),
        }
      : null;
  }
  rebuild_raster_states_from_timeline(group, minBreath, cells);
}

type RasterPropertyTimelineCell = {
  source_id: string;
  type: 'content' | 'blank';
  voxels: PainterVoxelRecord[];
};

function rewrite_painter_group_raster_property_span_destructive(group: PainterGroup, property: PainterProperty, target: PainterPropertyBlock, nextStart: number, nextEnd: number): void {
  normalize_property_blocks_in_place(property);
  const targetStart = Math.max(0, Math.floor(nextStart));
  const targetEnd = Math.max(targetStart, Math.floor(nextEnd));
  const minBreath = Math.min(target.start, targetStart, ...property.blocks.map((block) => block.start));
  const maxBreath = Math.max(target.end, targetEnd, ...property.blocks.map((block) => block.end));
  const cells: Array<RasterPropertyTimelineCell | null> = [];
  for (let breath = minBreath; breath <= maxBreath; breath += 1) cells.push(null);

  for (const block of property.blocks) {
    const cell: RasterPropertyTimelineCell = block.type === 'content' && block.value.kind === 'raster'
      ? { source_id: block.id, type: 'content', voxels: block.value.voxels.map(clone_painter_voxel_record) }
      : { source_id: block.id, type: 'blank', voxels: [] };
    for (let breath = block.start; breath <= block.end; breath += 1) cells[breath - minBreath] = cell;
  }

  for (let breath = target.start; breath <= target.end; breath += 1) cells[breath - minBreath] = null;
  const fillCell: RasterPropertyTimelineCell = target.type === 'content' && target.value.kind === 'raster'
    ? { source_id: target.id, type: 'content', voxels: target.value.voxels.map(clone_painter_voxel_record) }
    : { source_id: target.id, type: 'blank', voxels: [] };
  for (let breath = targetStart; breath <= targetEnd; breath += 1) cells[breath - minBreath] = fillCell;

  let firstContent = -1;
  let lastContent = -1;
  for (let index = 0; index < cells.length; index += 1) {
    if (cells[index]?.type !== 'content') continue;
    if (firstContent < 0) firstContent = index;
    lastContent = index;
  }

  if (firstContent < 0 || lastContent < 0) {
    property.blocks = [create_blank_property_block(minBreath, maxBreath)];
    sync_group_timing_from_properties(group);
    return;
  }

  const nextBlocks: PainterPropertyBlock[] = [];
  const idUsage = new Map<string, number>();
  let cursor = firstContent;
  while (cursor <= lastContent) {
    const cell = cells[cursor] ?? null;
    let runEnd = cursor;
    while (runEnd + 1 <= lastContent) {
      const next = cells[runEnd + 1] ?? null;
      const sameBlank = (!cell || cell.type === 'blank') && (!next || next.type === 'blank');
      const sameContent = cell?.type === 'content' && next?.type === 'content' && cell.source_id === next.source_id;
      if (!sameBlank && !sameContent) break;
      runEnd += 1;
    }

    const start = minBreath + cursor;
    const end = minBreath + runEnd;
    if (!cell || cell.type === 'blank') {
      nextBlocks.push(create_blank_property_block(start, end));
    } else {
      const seen = idUsage.get(cell.source_id) ?? 0;
      idUsage.set(cell.source_id, seen + 1);
      nextBlocks.push(create_raster_content_property_block(start, end, cell.voxels, seen === 0 ? cell.source_id : undefined));
    }
    cursor = runEnd + 1;
  }

  property.blocks = nextBlocks;
  merge_adjacent_property_blocks(property);
  sync_group_timing_from_properties(group);
}

export function set_painter_group_raster_segment_edge_destructive(runtime: PainterDocumentRuntime, groupId: string, contentStateId: string, edge: 'start' | 'end', targetBreath: number): void {
  const group = runtime.document.groups[groupId];
  if (!group) throw new Error(`painter_group_not_found:${groupId}`);
  const before = summarize_painter_group_timeline(group);
  painter_timeline_runtime_log('runtime_before', {
    command_kind: 'set_group_raster_segment_edge_destructive',
    group_id: groupId,
    content_state_id: contentStateId,
    edge,
    target_breath: Math.max(0, Math.floor(targetBreath)),
    before,
  });
  const resolved = find_property_and_block(group, contentStateId, 'raster');
  if (!resolved) throw new Error('painter_content_state_not_found');
  const nextBreath = Math.max(0, Math.floor(targetBreath));
  if (edge === 'start') {
    rewrite_painter_group_raster_property_span_destructive(group, resolved.property, resolved.block, Math.min(nextBreath, resolved.block.end), resolved.block.end);
  } else {
    rewrite_painter_group_raster_property_span_destructive(group, resolved.property, resolved.block, resolved.block.start, Math.max(nextBreath, resolved.block.start));
  }
  if (group.metadata) group.metadata.modified_at = new Date().toISOString();
  touch_modified_at(runtime.document);
  rebuild_runtime_indices(runtime);
  painter_timeline_runtime_log('runtime_after', {
    command_kind: 'set_group_raster_segment_edge_destructive',
    group_id: groupId,
    content_state_id: contentStateId,
    edge,
    target_breath: Math.max(0, Math.floor(targetBreath)),
    before,
    after: summarize_painter_group_timeline(group),
  });
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

function get_primary_raster_property_for_edit(group: PainterGroup): PainterProperty {
  const property = get_primary_property(group, 'raster', true);
  if (!property) throw new Error('painter_raster_property_not_found');
  return property;
}

function replace_raster_block(property: PainterProperty, blockId: string, replacement: PainterPropertyBlock[]): void {
  const next: PainterPropertyBlock[] = [];
  for (const block of property.blocks) {
    if (block.id !== blockId) {
      next.push(block);
      continue;
    }
    for (const entry of replacement) next.push(entry);
  }
  property.blocks = next;
  merge_adjacent_property_blocks(property);
}

export function set_painter_group_content_state(runtime: PainterDocumentRuntime, groupId: string, breath: number, voxels: PainterVoxelRecord[]): void {
  const group = runtime.document.groups[groupId];
  if (!group) throw new Error(`painter_group_not_found:${groupId}`);
  const property = get_primary_raster_property_for_edit(group);
  const targetBreath = Math.floor(breath);
  const nextContent = voxels.map(clone_painter_voxel_record);
  const exactBlock = property.blocks.find((entry) => entry.start === targetBreath) ?? null;
  if (exactBlock) {
    exactBlock.end = Math.max(targetBreath, exactBlock.end);
    if (nextContent.length < 1) {
      replace_raster_block(property, exactBlock.id, [create_blank_property_block(exactBlock.start, exactBlock.end)]);
    } else {
      replace_raster_block(property, exactBlock.id, [create_raster_content_property_block(exactBlock.start, exactBlock.end, nextContent, exactBlock.id)]);
    }
  } else {
    const containingBlock = property.blocks.find((entry) => targetBreath >= entry.start && targetBreath <= entry.end) ?? null;
    if (!containingBlock) throw new Error(`painter_content_state_not_found_at_breath:${targetBreath}`);
    const replacement: PainterPropertyBlock[] = [];
    if (containingBlock.start < targetBreath) {
      replacement.push(containingBlock.type === 'blank'
        ? create_blank_property_block(containingBlock.start, targetBreath - 1)
        : create_raster_content_property_block(containingBlock.start, targetBreath - 1, containingBlock.value.kind === 'raster' ? containingBlock.value.voxels : []));
    }
    replacement.push(nextContent.length < 1
      ? create_blank_property_block(targetBreath, containingBlock.end)
      : create_raster_content_property_block(targetBreath, containingBlock.end, nextContent));
    replace_raster_block(property, containingBlock.id, replacement);
  }
  sync_group_timing_from_properties(group);
  if (group.metadata) group.metadata.modified_at = new Date().toISOString();
  touch_modified_at(runtime.document);
  rebuild_runtime_indices(runtime);
}

function insert_empty_exact_content_state_at_breath(group: PainterGroup, breath: number): PainterGroupContentState {
  const property = get_primary_raster_property_for_edit(group);
  const targetBreath = Math.max(0, Math.floor(breath));
  const containingBlock = property.blocks.find((entry) => targetBreath >= entry.start && targetBreath <= entry.end) ?? null;
  const inserted = create_raster_content_property_block(targetBreath, targetBreath, []);
  if (containingBlock) {
    const replacement: PainterPropertyBlock[] = [];
    if (containingBlock.start < targetBreath) {
      replacement.push(containingBlock.type === 'blank'
        ? create_blank_property_block(containingBlock.start, targetBreath - 1)
        : create_raster_content_property_block(containingBlock.start, targetBreath - 1, containingBlock.value.kind === 'raster' ? containingBlock.value.voxels : []));
    }
    replacement.push(inserted);
    if (containingBlock.end > targetBreath) {
      replacement.push(containingBlock.type === 'blank'
        ? create_blank_property_block(targetBreath + 1, containingBlock.end)
        : create_raster_content_property_block(targetBreath + 1, containingBlock.end, containingBlock.value.kind === 'raster' ? containingBlock.value.voxels : []));
    }
    replace_raster_block(property, containingBlock.id, replacement);
  } else {
    property.blocks.push(inserted);
    merge_adjacent_property_blocks(property);
  }
  sync_group_timing_from_properties(group);
  return {
    id: inserted.id,
    label: property.label,
    index: 0,
    length_breaths: 1,
    content: [],
  };
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
      const offset = resolve_painter_group_location_at_breath(group, runtime.active_breath);
      for (const localVoxel of resolve_group_raster_property_voxels_at_breath(group, runtime.active_breath)) {
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
  return insert_empty_exact_content_state_at_breath(group, breath);
}

export function set_group_voxel_at_breath(runtime: PainterDocumentRuntime, groupId: string, breath: number, voxel: PainterVoxelRecord, options?: {
  auto_key?: boolean;
}): { applied: boolean; reason?: 'no_visible_raster_content' } {
  const group = runtime.document.groups[groupId];
  if (!group) throw new Error(`painter_group_not_found:${groupId}`);
  const resolved = resolve_group_voxel_edit_state(group, breath, { auto_key: options?.auto_key, allow_create: true });
  if (!resolved.state_id) return { applied: false, reason: 'no_visible_raster_content' };
  const resolvedBlock = find_property_and_block(group, resolved.state_id, 'raster');
  if (!resolvedBlock || resolvedBlock.block.type !== 'content' || resolvedBlock.block.value.kind !== 'raster') return { applied: false, reason: 'no_visible_raster_content' };
  const offset = resolve_painter_group_location_at_breath(group, breath);
  const localVoxel = unproject_painter_group_world_voxel_to_local(clone_painter_voxel_record(voxel), offset);
  const stateMap = new Map<string, PainterVoxelRecord>();
  for (const existing of resolvedBlock.block.value.voxels) stateMap.set(existing.key, clone_painter_voxel_record(existing));
  stateMap.set(localVoxel.key, localVoxel);
  resolvedBlock.block.value.voxels = Array.from(stateMap.values()).map(clone_painter_voxel_record);
  merge_adjacent_property_blocks(resolvedBlock.property);
  sync_group_timing_from_properties(group);
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
  const resolvedBlock = find_property_and_block(group, resolved.state_id, 'raster');
  if (!resolvedBlock || resolvedBlock.block.type !== 'content' || resolvedBlock.block.value.kind !== 'raster') return { applied: false, reason: 'no_visible_raster_content' };
  const offset = resolve_painter_group_location_at_breath(group, breath);
  const localVoxel = unproject_painter_group_world_voxel_to_local(worldVoxel, offset);
  const stateMap = new Map<string, PainterVoxelRecord>();
  for (const existing of resolvedBlock.block.value.voxels) stateMap.set(existing.key, clone_painter_voxel_record(existing));
  stateMap.delete(localVoxel.key);
  resolvedBlock.block.value.voxels = Array.from(stateMap.values()).map(clone_painter_voxel_record);
  merge_adjacent_property_blocks(resolvedBlock.property);
  sync_group_timing_from_properties(group);
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

export function reorder_painter_group_properties(runtime: PainterDocumentRuntime, groupId: string, nextPropertyOrder: string[]): void {
  const group = runtime.document.groups[groupId];
  if (!group) return;
  const normalized = nextPropertyOrder.filter((propertyId) => !!group.properties[propertyId]);
  for (const propertyId of group.property_ids) {
    if (!normalized.includes(propertyId) && group.properties[propertyId]) normalized.push(propertyId);
  }
  for (const propertyId of Object.keys(group.properties)) {
    if (!normalized.includes(propertyId)) normalized.push(propertyId);
  }
  group.property_ids = normalized;
  if (group.metadata) group.metadata.modified_at = new Date().toISOString();
  touch_modified_at(runtime.document);
  rebuild_runtime_indices(runtime);
}

export function add_painter_group_property(runtime: PainterDocumentRuntime, groupId: string, args: {
  property_kind: 'raster' | 'move';
  after_property_id?: string | null;
  property_label?: string;
}): { property_id: string } {
  const group = runtime.document.groups[groupId];
  if (!group) throw new Error(`painter_group_not_found:${groupId}`);
  const propertyId = make_runtime_property_id(args.property_kind);
  const propertyLabel = String(args.property_label ?? '').trim() || `${args.property_kind}`;
  group.properties[propertyId] = clone_painter_property({
    id: propertyId,
    kind: args.property_kind,
    label: propertyLabel,
    process_mode: 'add',
    blocks: args.property_kind === 'raster'
      ? [create_blank_property_block(Math.floor(group.breath_start ?? group.start ?? 0), Math.max(Math.floor(group.breath_start ?? group.start ?? 0), Math.floor(group.breath_end ?? group.cropped_end ?? group.start ?? 0)))]
      : [],
  });
  const nextPropertyIds = [...group.property_ids.filter((id) => id !== propertyId)];
  const afterId = String(args.after_property_id ?? '').trim();
  const insertIndex = afterId ? nextPropertyIds.indexOf(afterId) + 1 : nextPropertyIds.length;
  nextPropertyIds.splice(Math.max(0, Math.min(nextPropertyIds.length, insertIndex < 0 ? nextPropertyIds.length : insertIndex)), 0, propertyId);
  group.property_ids = nextPropertyIds;
  if (group.metadata) group.metadata.modified_at = new Date().toISOString();
  touch_modified_at(runtime.document);
  rebuild_runtime_indices(runtime);
  return { property_id: propertyId };
}

export function remove_painter_group_property(runtime: PainterDocumentRuntime, groupId: string, propertyId: string): void {
  const group = runtime.document.groups[groupId];
  if (!group) return;
  const property = group.properties[propertyId];
  if (!property) return;
  delete group.properties[propertyId];
  group.property_ids = group.property_ids.filter((id) => id !== propertyId);
  sync_group_timing_from_properties(group);
  if (group.metadata) group.metadata.modified_at = new Date().toISOString();
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
