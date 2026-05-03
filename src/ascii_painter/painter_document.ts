import type { Rgb } from '../mono_ui/types.js';
import type { CameraConfig } from './voxel_space.js';

export type PainterCoordKey = string;

export type PainterOccupiedBounds = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
};

export type PainterDocumentMetadata = {
  title?: string;
  description?: string;
  created_at: string;
  modified_at: string;
};

export type PainterDocumentBreath = {
  start: 0;
  cropped_start: number;
  cropped_end: number;
  range_start: number;
  range_end: number;
};

export type PainterDocumentPlayback = {
  frames_per_breath: number;
  loop_enabled: boolean;
};

export type PainterVoxelRecord = {
  key: PainterCoordKey;
  x: number;
  y: number;
  z: number;
  char: string;
  rgb: Rgb;
  weight_index: number;
};

export type PainterGroupLocationOffset = {
  x: number;
  y: number;
  z: number;
};

export type PainterGroupLocationKey = {
  breath: number;
  offset: PainterGroupLocationOffset;
};

export type PainterGroupContentState = {
  id: string;
  label: string;
  index: number;
  length_breaths: number;
  content: PainterVoxelRecord[];
};

export type PainterChannelKind =
  | 'raster_content'
  | 'location'
  | 'rotation';

export type PainterChannelBehavior =
  | 'clip'
  | 'linear'
  | 'similarities'
  | 'forward_stacked'
  | 'backstacked'
  | 'interpolate';

export type PainterBoundaryBehavior =
  | 'none'
  | 'clip'
  | 'linear'
  | 'loopin'
  | 'loopout';

export type PainterChannelValue =
  | { kind: 'raster'; voxels: PainterVoxelRecord[] }
  | { kind: 'vec3'; x: number; y: number; z: number }
  | { kind: 'scalar'; value: number };

export type PainterPropertyKind =
  | 'raster'
  | 'move'
  | 'rotation'
  | 'opacity';

export type PainterProcessMode =
  | 'add';

export type PainterBoundaryType =
  | 'clip'
  | 'hold'
  | 'linear'
  | 'loopin'
  | 'loopout';

export type PainterBlankMode =
  | 'clip'
  | 'linear';

export type PainterPropertyValue = PainterChannelValue;

export type PainterPropertyContentBlock = {
  id: string;
  type: 'content';
  start: number;
  end: number;
  value: PainterPropertyValue;
};

export type PainterPropertyBlankBlock = {
  id: string;
  type: 'blank';
  start: number;
  end: number;
  mode: PainterBlankMode;
  left_boundary: PainterBoundaryType;
  right_boundary: PainterBoundaryType;
};

export type PainterPropertyBlock = PainterPropertyContentBlock | PainterPropertyBlankBlock;

export type PainterProperty = {
  id: string;
  kind: PainterPropertyKind;
  label: string;
  process_mode: PainterProcessMode;
  blocks: PainterPropertyBlock[];
};

export type PainterChannelKey = {
  id: string;
  breath: number;
  value: PainterChannelValue;
};

export type PainterChannel = {
  id: string;
  kind: PainterChannelKind;
  label: string;
  gap_behavior: PainterChannelBehavior;
  before_first_behavior: PainterBoundaryBehavior;
  after_last_behavior: PainterBoundaryBehavior;
  keys: PainterChannelKey[];
};

export type PainterGroup = {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  start: number;
  cropped_start: number;
  cropped_end: number;
  breath_start: number;
  breath_end: number;
  property_ids: string[];
  properties: Record<string, PainterProperty>;
  channel_ids: string[];
  channels: Record<string, PainterChannel>;
  content_states: PainterGroupContentState[];
  location_base: PainterGroupLocationOffset;
  location_keys: PainterGroupLocationKey[];
  metadata?: {
    created_at?: string;
    modified_at?: string;
    origin?: { x: number; y: number; z: number };
  };
};

export type PainterDocument = {
  version: 5;
  bounds: {
    minX: number;
    minY: number;
    width: number;
    height: number;
    depth: number;
    minZ: number;
    maxZ: number;
  };
  occupied_bounds?: PainterOccupiedBounds | null;
  groups: Record<string, PainterGroup>;
  group_order: string[];
  breath: PainterDocumentBreath;
  playback: PainterDocumentPlayback;
  camera?: CameraConfig;
  metadata?: PainterDocumentMetadata;
};

function make_random_id(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function clamp_int(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? Math.floor(value) : fallback;
  return Number.isFinite(n) ? n : fallback;
}

function clone_location_offset(offset: PainterGroupLocationOffset | null | undefined): PainterGroupLocationOffset {
  return {
    x: clamp_int(offset?.x, 0),
    y: clamp_int(offset?.y, 0),
    z: clamp_int(offset?.z, 0),
  };
}

function normalize_document_breath(breath: any): PainterDocumentBreath {
  const start = 0;
  const rangeStart = Math.max(0, clamp_int(breath?.range_start, 0));
  const rangeEnd = Math.max(rangeStart, clamp_int(breath?.range_end, rangeStart));
  const croppedStart = Math.max(rangeStart, clamp_int(breath?.cropped_start, rangeStart));
  const croppedEnd = Math.max(croppedStart, Math.min(rangeEnd, clamp_int(breath?.cropped_end, rangeEnd)));
  return {
    start,
    cropped_start: croppedStart,
    cropped_end: croppedEnd,
    range_start: rangeStart,
    range_end: rangeEnd,
  };
}

function normalize_document_playback(playback: any): PainterDocumentPlayback {
  return {
    frames_per_breath: Math.max(1, clamp_int(playback?.frames_per_breath, 1)),
    loop_enabled: playback?.loop_enabled !== false,
  };
}

function sort_voxels(voxels: PainterVoxelRecord[]): PainterVoxelRecord[] {
  return [...voxels].sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
}

function normalize_content_state_like(state: any, fallbackLabel: string): PainterGroupContentState {
  const lengthBreaths = Math.max(1, clamp_int(state?.length_breaths, 1));
  return {
    id: String(state?.id ?? '').trim() || make_random_id('content_state'),
    label: String(state?.label ?? '').trim() || fallbackLabel,
    index: Math.max(0, clamp_int(state?.index, 0)),
    length_breaths: lengthBreaths,
    content: sort_voxels(
      Array.isArray(state?.content)
        ? state.content.map((voxel: PainterVoxelRecord) => clone_painter_voxel_record(voxel))
        : []
    ),
  };
}

function normalize_property_kind(kind: unknown): PainterPropertyKind {
  switch (String(kind ?? '').trim()) {
    case 'move':
      return 'move';
    case 'rotation':
      return 'rotation';
    case 'opacity':
      return 'opacity';
    case 'raster':
    default:
      return 'raster';
  }
}

function normalize_process_mode(mode: unknown): PainterProcessMode {
  return 'add';
}

function normalize_boundary_type(boundary: unknown): PainterBoundaryType {
  switch (String(boundary ?? '').trim()) {
    case 'hold':
      return 'hold';
    case 'linear':
      return 'linear';
    case 'loopin':
      return 'loopin';
    case 'loopout':
      return 'loopout';
    case 'clip':
    default:
      return 'clip';
  }
}

function property_kind_from_channel_kind(kind: PainterChannelKind): PainterPropertyKind {
  switch (kind) {
    case 'location':
      return 'move';
    case 'rotation':
      return 'rotation';
    case 'raster_content':
    default:
      return 'raster';
  }
}

function normalize_property_value(value: PainterPropertyValue | null | undefined, fallbackKind: PainterPropertyKind): PainterPropertyValue {
  const channelKind: PainterChannelKind = fallbackKind === 'move'
    ? 'location'
    : fallbackKind === 'rotation'
      ? 'rotation'
      : 'raster_content';
  return clone_channel_value(value ?? undefined, channelKind);
}

function normalize_property_block_like(blockLike: any, fallbackKind: PainterPropertyKind, fallbackStart: number): PainterPropertyBlock {
  const start = Math.max(0, clamp_int(blockLike?.start, fallbackStart));
  const end = Math.max(start, clamp_int(blockLike?.end, start));
  if (String(blockLike?.type ?? '').trim() === 'blank') {
    return {
      id: String(blockLike?.id ?? '').trim() || make_random_id('property_block'),
      type: 'blank',
      start,
      end,
      mode: String(blockLike?.mode ?? '').trim() === 'linear' ? 'linear' : 'clip',
      left_boundary: normalize_boundary_type(blockLike?.left_boundary),
      right_boundary: normalize_boundary_type(blockLike?.right_boundary),
    };
  }
  return {
    id: String(blockLike?.id ?? '').trim() || make_random_id('property_block'),
    type: 'content',
    start,
    end,
    value: normalize_property_value(blockLike?.value, fallbackKind),
  };
}

function normalize_property_blocks(blocks: unknown, fallbackKind: PainterPropertyKind): PainterPropertyBlock[] {
  const ordered = new Map<string, PainterPropertyBlock>();
  if (Array.isArray(blocks)) {
    for (let index = 0; index < blocks.length; index += 1) {
      const normalized = normalize_property_block_like(blocks[index], fallbackKind, index);
      ordered.set(normalized.id, normalized);
    }
  }
  return Array.from(ordered.values()).sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));
}

function normalize_property_block_ranges(blocks: PainterPropertyBlock[]): PainterPropertyBlock[] {
  return blocks
    .map((block) => block.type === 'blank'
      ? {
          ...block,
          start: Math.max(0, clamp_int(block.start, 0)),
          end: Math.max(Math.max(0, clamp_int(block.start, 0)), clamp_int(block.end, block.start)),
          mode: (block.mode === 'linear' ? 'linear' : 'clip') as PainterBlankMode,
        }
      : {
          ...block,
          start: Math.max(0, clamp_int(block.start, 0)),
          end: Math.max(Math.max(0, clamp_int(block.start, 0)), clamp_int(block.end, block.start)),
        })
    .sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));
}

function normalize_property_like(propertyLike: any, fallbackKind: PainterPropertyKind, fallbackLabel: string): PainterProperty {
  const kind = normalize_property_kind(propertyLike?.kind ?? fallbackKind);
  return {
    id: String(propertyLike?.id ?? '').trim() || make_random_id('property'),
    kind,
    label: String(propertyLike?.label ?? '').trim() || fallbackLabel,
    process_mode: normalize_process_mode(propertyLike?.process_mode),
    blocks: normalize_property_block_ranges(normalize_property_blocks(propertyLike?.blocks, kind)),
  };
}

export function get_default_channel_value(kind: PainterChannelKind): PainterChannelValue {
  switch (kind) {
    case 'location':
      return { kind: 'vec3', x: 0, y: 0, z: 0 };
    case 'rotation':
      return { kind: 'scalar', value: 0 };
    case 'raster_content':
    default:
      return { kind: 'raster', voxels: [] };
  }
}

function clone_channel_value(value: PainterChannelValue | null | undefined, kind: PainterChannelKind): PainterChannelValue {
  if (!value || typeof value !== 'object') return get_default_channel_value(kind);
  if ((value as any).kind === 'vec3') {
    return {
      kind: 'vec3',
      x: clamp_int((value as any).x, 0),
      y: clamp_int((value as any).y, 0),
      z: clamp_int((value as any).z, 0),
    };
  }
  if ((value as any).kind === 'scalar') {
    return { kind: 'scalar', value: clamp_int((value as any).value, 0) };
  }
  if ((value as any).kind === 'raster') {
    return {
      kind: 'raster',
      voxels: Array.isArray((value as any).voxels)
        ? (value as any).voxels.map((voxel: PainterVoxelRecord) => clone_painter_voxel_record(voxel))
        : [],
    };
  }
  return get_default_channel_value(kind);
}

function normalize_channel_kind(kind: unknown): PainterChannelKind {
  return kind === 'location' || kind === 'rotation' || kind === 'raster_content' ? kind : 'raster_content';
}

function normalize_channel_behavior(value: unknown): PainterChannelBehavior {
  return value === 'clip' || value === 'linear' || value === 'similarities' || value === 'forward_stacked' || value === 'backstacked' || value === 'interpolate'
    ? value
    : 'clip';
}

function normalize_boundary_behavior(value: unknown): PainterBoundaryBehavior {
  return value === 'none' || value === 'clip' || value === 'linear' || value === 'loopin' || value === 'loopout'
    ? value
    : 'none';
}

function normalize_channel_key(keyLike: any, kind: PainterChannelKind, fallbackBreath: number): PainterChannelKey {
  return {
    id: String(keyLike?.id ?? '').trim() || make_random_id('channel_key'),
    breath: Math.max(0, clamp_int(keyLike?.breath, fallbackBreath)),
    value: clone_channel_value(keyLike?.value, kind),
  };
}

function normalize_channel_keys(keys: unknown, kind: PainterChannelKind): PainterChannelKey[] {
  const out = new Map<number, PainterChannelKey>();
  if (Array.isArray(keys)) {
    for (let i = 0; i < keys.length; i += 1) {
      const normalized = normalize_channel_key(keys[i], kind, i);
      out.set(normalized.breath, normalized);
    }
  }
  return Array.from(out.values()).sort((a, b) => a.breath - b.breath || a.id.localeCompare(b.id));
}

function normalize_channel_like(channelLike: any, fallbackKind: PainterChannelKind, fallbackLabel: string): PainterChannel {
  const kind = normalize_channel_kind(channelLike?.kind ?? fallbackKind);
  return {
    id: String(channelLike?.id ?? '').trim() || make_random_id('channel'),
    kind,
    label: String(channelLike?.label ?? '').trim() || fallbackLabel,
    gap_behavior: normalize_channel_behavior(channelLike?.gap_behavior),
    before_first_behavior: normalize_boundary_behavior(channelLike?.before_first_behavior),
    after_last_behavior: normalize_boundary_behavior(channelLike?.after_last_behavior),
    keys: normalize_channel_keys(channelLike?.keys, kind),
  };
}

function get_primary_channel(group: Pick<PainterGroup, 'channel_ids' | 'channels'>, kind: PainterChannelKind): PainterChannel | null {
  const orderedIds = Array.isArray(group.channel_ids) ? group.channel_ids : [];
  for (const id of orderedIds) {
    const channel = group.channels?.[id];
    if (channel?.kind === kind) return channel;
  }
  return null;
}

function derive_content_states_from_raster_channel(group: PainterGroup): PainterGroupContentState[] | null {
  const rasterChannel = get_primary_channel(group, 'raster_content');
  if (!rasterChannel || rasterChannel.keys.length < 2) return null;
  const keys = [...rasterChannel.keys].sort((a, b) => a.breath - b.breath || a.id.localeCompare(b.id));
  const states: PainterGroupContentState[] = [];
  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index]!;
    const next = keys[index + 1]!;
    const lengthBreaths = Math.max(1, Math.floor(next.breath) - Math.floor(key.breath));
    states.push({
      id: key.id,
      label: `State ${index + 1}`,
      index,
      length_breaths: lengthBreaths,
      content: key.value.kind === 'raster' ? sort_voxels(key.value.voxels.map(clone_painter_voxel_record)) : [],
    });
  }
  return states;
}

function create_legacy_location_channel(base: PainterGroupLocationOffset | null | undefined, keys: PainterGroupLocationKey[] | null | undefined): PainterChannel | null {
  const baseOffset = clone_location_offset(base);
  const normalizedKeys = Array.isArray(keys)
    ? keys.map((key) => ({ breath: Math.max(0, clamp_int(key?.breath, 0)), offset: clone_location_offset(key?.offset) }))
    : [];
  if (baseOffset.x === 0 && baseOffset.y === 0 && baseOffset.z === 0 && normalizedKeys.length < 1) return null;
  const keysOut: PainterChannelKey[] = [];
  if (baseOffset.x !== 0 || baseOffset.y !== 0 || baseOffset.z !== 0) {
    keysOut.push({
      id: make_random_id('channel_key'),
      breath: 0,
      value: { kind: 'vec3', x: baseOffset.x, y: baseOffset.y, z: baseOffset.z },
    });
  }
  for (const key of normalizedKeys) {
    keysOut.push({
      id: make_random_id('channel_key'),
      breath: key.breath,
      value: { kind: 'vec3', x: key.offset.x, y: key.offset.y, z: key.offset.z },
    });
  }
  return {
    id: 'location_1',
    kind: 'location',
    label: 'move',
    gap_behavior: 'clip',
    before_first_behavior: 'none',
    after_last_behavior: 'none',
    keys: normalize_channel_keys(keysOut, 'location'),
  };
}

function create_legacy_raster_channel(states: PainterGroupContentState[] | null | undefined, startBreath: number): PainterChannel | null {
  const normalizedStates = Array.isArray(states) ? normalize_painter_group_content_states(states) : [];
  if (normalizedStates.length < 1) return null;
  let cursor = Math.max(0, Math.floor(startBreath));
  const keysOut: PainterChannelKey[] = [];
  for (const state of normalizedStates) {
    keysOut.push({
      id: state.id,
      breath: cursor,
      value: { kind: 'raster', voxels: state.content.map(clone_painter_voxel_record) },
    });
    cursor += Math.max(1, Math.floor(state.length_breaths ?? 1));
  }
  keysOut.push({
    id: make_random_id('channel_key'),
    breath: cursor,
    value: { kind: 'raster', voxels: [] },
  });
  return {
    id: 'raster_content_1',
    kind: 'raster_content',
    label: 'content',
    gap_behavior: 'clip',
    before_first_behavior: 'none',
    after_last_behavior: 'none',
    keys: normalize_channel_keys(keysOut, 'raster_content'),
  };
}

function derive_properties_from_legacy_group(args: {
  channels: Record<string, PainterChannel>;
  channel_ids: string[];
  content_states?: PainterGroupContentState[] | null;
  group_start?: number;
}): { property_ids: string[]; properties: Record<string, PainterProperty> } {
  const properties = new Map<string, PainterProperty>();
  const propertyIds: string[] = [];
  for (const channelId of args.channel_ids) {
    const channel = args.channels[channelId];
    if (!channel) continue;
    const kind = property_kind_from_channel_kind(channel.kind);
    const blocks: PainterPropertyBlock[] = [];
    const sortedKeys = [...channel.keys].sort((a, b) => a.breath - b.breath || a.id.localeCompare(b.id));
    if (kind === 'raster') {
      for (let index = 0; index < Math.max(0, sortedKeys.length - 1); index += 1) {
        const key = sortedKeys[index]!;
        const next = sortedKeys[index + 1]!;
        const start = Math.max(0, Math.floor(key.breath));
        const end = Math.max(start, Math.floor(next.breath) - 1);
        if (key.value.kind === 'raster' && key.value.voxels.length > 0) {
          blocks.push({
            id: key.id,
            type: 'content',
            start,
            end,
            value: { kind: 'raster', voxels: key.value.voxels.map(clone_painter_voxel_record) },
          });
        } else {
          blocks.push({
            id: key.id,
            type: 'blank',
            start,
            end,
            mode: 'clip',
            left_boundary: 'clip',
            right_boundary: 'clip',
          });
        }
      }
    } else {
      for (let index = 0; index < sortedKeys.length; index += 1) {
        const key = sortedKeys[index]!;
        const next = sortedKeys[index + 1] ?? null;
        const start = Math.max(0, Math.floor(key.breath));
        const end = next ? Math.max(start, Math.floor(next.breath) - 1) : start;
        blocks.push({
          id: key.id,
          type: 'content',
          start,
          end,
          value: normalize_property_value(key.value, kind),
        });
      }
    }
    const property = normalize_property_like({
      id: channel.id,
      kind,
      label: channel.label,
      process_mode: 'add',
      blocks,
    }, kind, channel.label);
    properties.set(property.id, property);
    propertyIds.push(property.id);
  }
  if (!Array.from(properties.values()).some((property) => property.kind === 'raster')) {
    const normalizedStates = normalize_painter_group_content_states(args.content_states ?? []);
    let cursor = Math.max(0, Math.floor(args.group_start ?? 0));
    const blocks: PainterPropertyBlock[] = normalizedStates.map((state) => {
      const start = cursor;
      const end = cursor + Math.max(1, Math.floor(state.length_breaths ?? 1)) - 1;
      cursor = end + 1;
      return state.content.length > 0
        ? {
            id: state.id,
            type: 'content',
            start,
            end,
            value: { kind: 'raster', voxels: state.content.map(clone_painter_voxel_record) },
          }
        : {
            id: state.id,
            type: 'blank',
            start,
            end,
            mode: 'clip',
            left_boundary: 'clip',
            right_boundary: 'clip',
          };
    });
    const property = normalize_property_like({ id: 'raster_1', kind: 'raster', label: 'content', process_mode: 'add', blocks }, 'raster', 'content');
    properties.set(property.id, property);
    propertyIds.push(property.id);
  }
  return {
    property_ids: propertyIds.filter((id, index) => properties.has(id) && propertyIds.indexOf(id) === index),
    properties: Object.fromEntries(Array.from(properties.entries())),
  };
}

export function derive_painter_group_properties_from_legacy_state(args: {
  channels: Record<string, PainterChannel>;
  channel_ids: string[];
  content_states?: PainterGroupContentState[] | null;
  group_start?: number;
}): { property_ids: string[]; properties: Record<string, PainterProperty> } {
  return derive_properties_from_legacy_group(args);
}

export function normalize_painter_group_properties(
  properties: unknown,
  propertyIds: unknown,
): { property_ids: string[]; properties: Record<string, PainterProperty> } {
  const normalizedMap = new Map<string, PainterProperty>();
  const orderedIds: string[] = [];
  if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
    for (const [id, propertyLike] of Object.entries(properties as Record<string, unknown>)) {
      const normalized = normalize_property_like({ ...(propertyLike as object), id }, normalize_property_kind((propertyLike as any)?.kind), String((propertyLike as any)?.label ?? id));
      normalizedMap.set(normalized.id, normalized);
    }
  } else if (Array.isArray(properties)) {
    for (let i = 0; i < properties.length; i += 1) {
      const normalized = normalize_property_like(properties[i], normalize_property_kind((properties[i] as any)?.kind), `Property ${i + 1}`);
      normalizedMap.set(normalized.id, normalized);
    }
  }
  if (Array.isArray(propertyIds)) {
    for (const id of propertyIds) {
      const normalizedId = String(id ?? '').trim();
      if (!normalizedId || !normalizedMap.has(normalizedId) || orderedIds.includes(normalizedId)) continue;
      orderedIds.push(normalizedId);
    }
  }
  for (const id of normalizedMap.keys()) {
    if (!orderedIds.includes(id)) orderedIds.push(id);
  }
  if (normalizedMap.size < 1) {
    const property = normalize_property_like({
      id: 'raster_1',
      kind: 'raster',
      label: 'content',
      process_mode: 'add',
      blocks: [{
        id: make_random_id('property_block'),
        type: 'blank',
        start: 0,
        end: 0,
        mode: 'clip',
        left_boundary: 'clip',
        right_boundary: 'clip',
      }],
    }, 'raster', 'content');
    return {
      property_ids: [property.id],
      properties: { [property.id]: property },
    };
  }
  return {
    property_ids: orderedIds,
    properties: Object.fromEntries(Array.from(normalizedMap.entries())),
  };
}

export function clone_painter_property(property: PainterProperty): PainterProperty {
  return normalize_property_like(property, property.kind, property.label);
}

export function normalize_painter_group_channels(
  channels: unknown,
  channelIds: unknown,
  opts?: {
    legacy_location_base?: PainterGroupLocationOffset | null;
    legacy_location_keys?: PainterGroupLocationKey[] | null;
    legacy_content_states?: PainterGroupContentState[] | null;
    legacy_group_start?: number;
  }
): { channel_ids: string[]; channels: Record<string, PainterChannel> } {
  const normalizedMap = new Map<string, PainterChannel>();
  const orderedIds: string[] = [];
  if (channels && typeof channels === 'object' && !Array.isArray(channels)) {
    for (const [id, channelLike] of Object.entries(channels as Record<string, unknown>)) {
      const normalized = normalize_channel_like({ ...(channelLike as object), id }, normalize_channel_kind((channelLike as any)?.kind), String((channelLike as any)?.label ?? id));
      normalizedMap.set(normalized.id, normalized);
    }
  } else if (Array.isArray(channels)) {
    for (let i = 0; i < channels.length; i += 1) {
      const normalized = normalize_channel_like(channels[i], normalize_channel_kind((channels[i] as any)?.kind), `Channel ${i + 1}`);
      normalizedMap.set(normalized.id, normalized);
    }
  }
  if (Array.isArray(channelIds)) {
    for (const id of channelIds) {
      const normalizedId = String(id ?? '').trim();
      if (!normalizedId || !normalizedMap.has(normalizedId) || orderedIds.includes(normalizedId)) continue;
      orderedIds.push(normalizedId);
    }
  }
  for (const id of normalizedMap.keys()) {
    if (!orderedIds.includes(id)) orderedIds.push(id);
  }
  const legacyRasterChannel = create_legacy_raster_channel(opts?.legacy_content_states ?? undefined, Math.max(0, Math.floor(opts?.legacy_group_start ?? 0)));
  if (legacyRasterChannel && !Array.from(normalizedMap.values()).some((channel) => channel.kind === 'raster_content')) {
    normalizedMap.set(legacyRasterChannel.id, legacyRasterChannel);
    if (!orderedIds.includes(legacyRasterChannel.id)) orderedIds.push(legacyRasterChannel.id);
  }
  const legacyLocationChannel = create_legacy_location_channel(opts?.legacy_location_base, opts?.legacy_location_keys ?? undefined);
  if (legacyLocationChannel && !Array.from(normalizedMap.values()).some((channel) => channel.kind === 'location')) {
    normalizedMap.set(legacyLocationChannel.id, legacyLocationChannel);
    if (!orderedIds.includes(legacyLocationChannel.id)) orderedIds.push(legacyLocationChannel.id);
  }
  return {
    channel_ids: orderedIds,
    channels: Object.fromEntries(Array.from(normalizedMap.entries())),
  };
}

export function clone_painter_channel(channel: PainterChannel): PainterChannel {
  return normalize_channel_like(channel, channel.kind, channel.label);
}

export function make_painter_coord_key(x: number, y: number, z: number): PainterCoordKey {
  return `${Math.floor(x)}:${Math.floor(y)}:${Math.floor(z)}`;
}

export function create_painter_voxel_record(args: {
  x: number;
  y: number;
  z: number;
  char: string;
  rgb: Rgb;
  weight_index: number;
}): PainterVoxelRecord {
  const x = Math.floor(args.x);
  const y = Math.floor(args.y);
  const z = Math.floor(args.z);
  return {
    key: make_painter_coord_key(x, y, z),
    x,
    y,
    z,
    char: String(args.char ?? ' ').slice(0, 1) || ' ',
    rgb: { ...args.rgb },
    weight_index: Math.max(0, Math.min(3, Math.floor(args.weight_index))),
  };
}

export function clone_painter_voxel_record(voxel: PainterVoxelRecord): PainterVoxelRecord {
  return {
    key: make_painter_coord_key(voxel.x, voxel.y, voxel.z),
    x: Math.floor(voxel.x),
    y: Math.floor(voxel.y),
    z: Math.floor(voxel.z),
    char: String(voxel.char ?? ' ').slice(0, 1) || ' ',
    rgb: { ...voxel.rgb },
    weight_index: Math.max(0, Math.min(3, Math.floor(voxel.weight_index))),
  };
}

export function create_painter_group_content_state(
  label: string = 'State 1',
  content: PainterVoxelRecord[] = [],
): PainterGroupContentState {
  return {
    id: make_random_id('content_state'),
    label: String(label ?? '').trim() || 'State 1',
    index: 0,
    length_breaths: 1,
    content: sort_voxels(content.map(clone_painter_voxel_record)),
  };
}

export function clone_painter_group_content_state(state: PainterGroupContentState): PainterGroupContentState {
  return normalize_content_state_like(state, state.label);
}

export function normalize_painter_group_content_states(states: unknown, opts?: {
  legacy_voxels?: PainterVoxelRecord[];
}): PainterGroupContentState[] {
  const normalized = Array.isArray(states)
    ? states.map((state, index) => normalize_content_state_like(state, `State ${index + 1}`))
    : [];
  if (normalized.length > 0) {
    return normalized.map((state, index) => ({ ...state, index }));
  }
  const legacyContent = Array.isArray(opts?.legacy_voxels) ? opts.legacy_voxels.map(clone_painter_voxel_record) : [];
  return [create_painter_group_content_state('State 1', legacyContent)];
}

export function get_painter_group_content_state_at_breath(group: PainterGroup, breath: number): PainterGroupContentState | null {
  const targetBreath = Math.floor(breath);
  const baseStart = Math.max(0, Math.floor(group.start ?? group.breath_start ?? 0));
  const croppedStart = Math.max(baseStart, Math.floor(group.breath_start ?? group.cropped_start ?? baseStart));
  const croppedEnd = Math.max(croppedStart, Math.floor(group.breath_end ?? group.cropped_end ?? croppedStart));
  if (targetBreath < croppedStart || targetBreath > croppedEnd) return null;
  const orderedIds = Array.isArray(group.property_ids) ? group.property_ids : [];
  for (const propertyId of orderedIds) {
    const property = group.properties?.[propertyId];
    if (!property || property.kind !== 'raster') continue;
    const block = property.blocks.find((entry) => targetBreath >= entry.start && targetBreath <= entry.end) ?? null;
    if (!block) continue;
    if (block.type === 'blank') {
      return {
        id: block.id,
        label: property.label,
        index: 0,
        length_breaths: Math.max(1, block.end - block.start + 1),
        content: [],
      };
    }
    if (block.value.kind !== 'raster') return null;
    return {
      id: block.id,
      label: property.label,
      index: 0,
      length_breaths: Math.max(1, block.end - block.start + 1),
      content: block.value.voxels.map(clone_painter_voxel_record),
    };
  }
  return null;
}

export function get_painter_group_initial_content_state(group: PainterGroup): PainterGroupContentState {
  return get_painter_group_content_state_at_breath(group, Math.floor(group.start ?? group.breath_start ?? 0))
    ?? create_painter_group_content_state('State 1', []);
}

export function create_painter_group(name: string = 'Group', opts?: {
  start?: number;
  cropped_start?: number;
  cropped_end?: number;
  breath_start?: number;
  breath_end?: number;
}): PainterGroup {
  const now = new Date().toISOString();
  const start = Math.max(0, Math.floor(opts?.start ?? opts?.breath_start ?? 0));
  const croppedStart = Math.max(start, Math.floor(opts?.cropped_start ?? opts?.breath_start ?? start));
  const croppedEnd = Math.max(croppedStart, Math.floor(opts?.cropped_end ?? opts?.breath_end ?? croppedStart));
  return {
    id: make_random_id('group'),
    name,
    visible: true,
    locked: false,
    opacity: 1,
    start,
    cropped_start: croppedStart,
    cropped_end: croppedEnd,
    breath_start: croppedStart,
    breath_end: croppedEnd,
    property_ids: ['raster_1'],
    properties: {
      raster_1: {
        id: 'raster_1',
        kind: 'raster',
        label: 'content',
        process_mode: 'add',
        blocks: [{ id: make_random_id('property_block'), type: 'blank', start, end: croppedEnd, mode: 'clip', left_boundary: 'clip', right_boundary: 'clip' }],
      },
    },
    channel_ids: [],
    channels: {},
    content_states: [create_painter_group_content_state('State 1', [])],
    location_base: { x: 0, y: 0, z: 0 },
    location_keys: [],
    metadata: {
      created_at: now,
      modified_at: now,
    },
  };
}

export function clone_painter_group(group: PainterGroup): PainterGroup {
  const groupLike = group as PainterGroup & { voxels?: PainterVoxelRecord[] };
  const start = Math.max(0, clamp_int((groupLike as any).start, clamp_int((groupLike as any).breath_start, 0)));
  const croppedStart = Math.max(start, clamp_int((groupLike as any).cropped_start, clamp_int((groupLike as any).breath_start, start)));
  const croppedEnd = Math.max(croppedStart, clamp_int((groupLike as any).cropped_end, clamp_int((groupLike as any).breath_end, croppedStart)));
  const normalizedProperties = normalize_painter_group_properties((groupLike as any).properties, (groupLike as any).property_ids);
  return {
    id: String(groupLike.id ?? '').trim() || make_random_id('group'),
    name: String(groupLike.name ?? '').trim() || 'Group',
    visible: groupLike.visible !== false,
    locked: groupLike.locked === true,
    opacity: typeof groupLike.opacity === 'number' ? groupLike.opacity : 1,
    start,
    cropped_start: croppedStart,
    cropped_end: croppedEnd,
    breath_start: croppedStart,
    breath_end: croppedEnd,
    property_ids: normalizedProperties.property_ids,
    properties: normalizedProperties.properties,
    channel_ids: Array.isArray(groupLike.channel_ids) ? [...groupLike.channel_ids] : [],
    channels: groupLike.channels ? Object.fromEntries(Object.entries(groupLike.channels).map(([id, channel]) => [id, clone_painter_channel(channel)])) : {},
    content_states: normalize_painter_group_content_states((groupLike as any).content_states, {
      legacy_voxels: Array.isArray(groupLike.voxels) ? groupLike.voxels : [],
    }),
    location_base: clone_location_offset((groupLike as any).location_base),
    location_keys: Array.isArray((groupLike as any).location_keys)
      ? (groupLike as any).location_keys.map((key: PainterGroupLocationKey) => ({ breath: clamp_int(key?.breath, start), offset: clone_location_offset(key?.offset) }))
      : [],
    metadata: groupLike.metadata ? {
      ...groupLike.metadata,
      origin: groupLike.metadata.origin ? { ...groupLike.metadata.origin } : undefined,
    } : undefined,
  };
}

export function create_painter_document(width: number, height: number, options?: {
  min_x?: number;
  min_y?: number;
  min_z?: number;
  max_z?: number;
  default_group_name?: string;
  initial_breath?: number;
  breath_range_start?: number;
  breath_range_end?: number;
  frames_per_breath?: number;
  loop_enabled?: boolean;
}): PainterDocument {
  const minX = Math.floor(options?.min_x ?? 0);
  const minY = Math.floor(options?.min_y ?? 0);
  const minZ = Math.floor(options?.min_z ?? 0);
  const maxZ = Math.floor(options?.max_z ?? 0);
  const initialBreath = Math.floor(options?.initial_breath ?? 0);
  const breath = normalize_document_breath({
    range_start: options?.breath_range_start ?? initialBreath,
    range_end: options?.breath_range_end ?? initialBreath,
  });
  const playback = normalize_document_playback({
    frames_per_breath: options?.frames_per_breath ?? 1,
    loop_enabled: options?.loop_enabled ?? true,
  });
  const initialGroup = create_painter_group(options?.default_group_name ?? 'Group 1', {
    breath_start: initialBreath,
    breath_end: initialBreath,
  });
  const now = new Date().toISOString();
  return {
    version: 5,
    bounds: {
      minX,
      minY,
      width: Math.max(1, Math.floor(width)),
      height: Math.max(1, Math.floor(height)),
      depth: Math.max(1, maxZ - minZ + 1),
      minZ: Math.min(minZ, maxZ),
      maxZ: Math.max(minZ, maxZ),
    },
    occupied_bounds: null,
    groups: {
      [initialGroup.id]: initialGroup,
    },
    group_order: [initialGroup.id],
    breath,
    playback,
    metadata: {
      created_at: now,
      modified_at: now,
    },
  };
}

export function clone_painter_document(document: PainterDocument): PainterDocument {
  const bounds = {
    minX: Math.floor((document.bounds as any).minX ?? 0),
    minY: Math.floor((document.bounds as any).minY ?? 0),
    width: Math.max(1, Math.floor(document.bounds.width ?? 1)),
    height: Math.max(1, Math.floor(document.bounds.height ?? 1)),
    depth: Math.max(1, Math.floor(document.bounds.depth ?? 1)),
    minZ: Math.floor(document.bounds.minZ ?? 0),
    maxZ: Math.floor(document.bounds.maxZ ?? 0),
  };
  return {
    ...document,
    version: 5,
    bounds,
    occupied_bounds: document.occupied_bounds ? { ...document.occupied_bounds } : null,
    groups: Object.fromEntries(
      Object.entries(document.groups).map(([groupId, group]) => [groupId, clone_painter_group(group)])
    ),
    group_order: [...document.group_order],
    breath: normalize_document_breath((document as any).breath),
    playback: normalize_document_playback((document as any).playback),
    camera: document.camera ? structuredClone(document.camera) : undefined,
    metadata: document.metadata ? { ...document.metadata } : undefined,
  };
}

export function get_default_painter_document_breath(): PainterDocumentBreath {
  return { start: 0, cropped_start: 0, cropped_end: 0, range_start: 0, range_end: 0 };
}

export function get_default_painter_document_playback(): PainterDocumentPlayback {
  return { frames_per_breath: 1, loop_enabled: true };
}

export function clone_painter_document_breath(breath: PainterDocumentBreath | null | undefined): PainterDocumentBreath {
  return normalize_document_breath(breath ?? get_default_painter_document_breath());
}

export function clone_painter_document_playback(playback: PainterDocumentPlayback | null | undefined): PainterDocumentPlayback {
  return normalize_document_playback(playback ?? get_default_painter_document_playback());
}
