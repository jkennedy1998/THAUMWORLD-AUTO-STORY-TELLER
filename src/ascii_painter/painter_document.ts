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
  version: 4;
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
  const states = normalize_painter_group_content_states(group.content_states);
  if (states.length < 1) return null;
  const targetBreath = Math.floor(breath);
  const baseStart = Math.max(0, Math.floor(group.start ?? group.breath_start ?? 0));
  const croppedStart = Math.max(baseStart, Math.floor(group.breath_start ?? group.cropped_start ?? baseStart));
  const croppedEnd = Math.max(croppedStart, Math.floor(group.breath_end ?? group.cropped_end ?? croppedStart));
  if (targetBreath < croppedStart || targetBreath > croppedEnd) return null;
  let cursor = Math.max(0, Math.floor(group.start ?? group.breath_start));
  let winning: PainterGroupContentState | null = null;
  for (const state of states) {
    const segmentStart = cursor;
    const segmentEnd = segmentStart + Math.max(1, state.length_breaths) - 1;
    if (targetBreath >= segmentStart && targetBreath <= segmentEnd) {
      winning = { ...state };
      break;
    }
    cursor = segmentEnd + 1;
  }
  return winning ? clone_painter_group_content_state(winning) : null;
}

export function get_painter_group_initial_content_state(group: PainterGroup): PainterGroupContentState {
  const states = normalize_painter_group_content_states(group.content_states);
  return clone_painter_group_content_state(states[0]!);
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
    content_states: [{ ...create_painter_group_content_state('State 1', []), length_breaths: Math.max(1, croppedEnd - start + 1) }],
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
    content_states: normalize_painter_group_content_states((groupLike as any).content_states, {
      legacy_voxels: Array.isArray(groupLike.voxels) ? groupLike.voxels : [],
    }),
    location_base: clone_location_offset((groupLike as any).location_base),
    location_keys: Array.isArray((groupLike as any).location_keys)
      ? (groupLike as any).location_keys.map((key: PainterGroupLocationKey) => ({
          breath: clamp_int(key?.breath, start),
          offset: clone_location_offset(key?.offset),
        })).sort((a: PainterGroupLocationKey, b: PainterGroupLocationKey) => a.breath - b.breath)
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
    version: 4,
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
    version: 4,
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
