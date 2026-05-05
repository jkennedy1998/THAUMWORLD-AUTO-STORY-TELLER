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

export type PainterPropertyValue =
  | { kind: 'raster'; voxels: PainterVoxelRecord[] }
  | { kind: 'vec3'; x: number; y: number; z: number }
  | { kind: 'scalar'; value: number };

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

export type PainterGroupRasterState = {
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
  property_ids: string[];
  properties: Record<string, PainterProperty>;
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

function normalize_document_breath(breath: any): PainterDocumentBreath {
  const start = 0;
  const rangeStart = Math.max(0, clamp_int(breath?.range_start, 0));
  const rangeEnd = Math.max(rangeStart, clamp_int(breath?.range_end, rangeStart));
  const croppedStart = Math.max(0, clamp_int(breath?.cropped_start, rangeStart));
  const croppedEnd = Math.max(croppedStart, clamp_int(breath?.cropped_end, Math.max(rangeEnd, croppedStart)));
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

function normalize_process_mode(_mode: unknown): PainterProcessMode {
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

export function get_default_property_value(kind: PainterPropertyKind): PainterPropertyValue {
  switch (kind) {
    case 'move':
      return { kind: 'vec3', x: 0, y: 0, z: 0 };
    case 'rotation':
    case 'opacity':
      return { kind: 'scalar', value: 0 };
    case 'raster':
    default:
      return { kind: 'raster', voxels: [] };
  }
}

export function clone_painter_property_value(value: PainterPropertyValue | null | undefined, fallbackKind: PainterPropertyKind): PainterPropertyValue {
  if (!value || typeof value !== 'object') return get_default_property_value(fallbackKind);
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
      voxels: sort_voxels(Array.isArray((value as any).voxels)
        ? (value as any).voxels.map((voxel: PainterVoxelRecord) => clone_painter_voxel_record(voxel))
        : []),
    };
  }
  return get_default_property_value(fallbackKind);
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
    value: clone_painter_property_value(blockLike?.value, fallbackKind),
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
  return Array.from(ordered.values())
    .sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));
}

function normalize_property_like(propertyLike: any, fallbackKind: PainterPropertyKind, fallbackLabel: string): PainterProperty {
  const kind = normalize_property_kind(propertyLike?.kind ?? fallbackKind);
  return {
    id: String(propertyLike?.id ?? '').trim() || make_random_id('property'),
    kind,
    label: String(propertyLike?.label ?? '').trim() || fallbackLabel,
    process_mode: normalize_process_mode(propertyLike?.process_mode),
    blocks: normalize_property_blocks(propertyLike?.blocks, kind),
  };
}

function create_default_raster_property(start: number, end: number): PainterProperty {
  const normalizedStart = Math.max(0, Math.floor(start));
  const normalizedEnd = Math.max(normalizedStart, Math.floor(end));
  return {
    id: 'raster_1',
    kind: 'raster',
    label: 'content',
    process_mode: 'add',
    blocks: [{
      id: make_random_id('property_block'),
      type: 'blank',
      start: normalizedStart,
      end: normalizedEnd,
      mode: 'clip',
      left_boundary: 'clip',
      right_boundary: 'clip',
    }],
  };
}

export function normalize_painter_group_properties(
  properties: unknown,
  propertyIds: unknown,
  opts?: { start?: number; end?: number },
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
    const property = create_default_raster_property(Math.max(0, clamp_int(opts?.start, 0)), Math.max(0, clamp_int(opts?.end, opts?.start ?? 0)));
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

export function get_painter_group_raster_state_at_breath(group: PainterGroup, breath: number): PainterGroupRasterState | null {
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

export function get_painter_group_initial_raster_state(group: PainterGroup): PainterGroupRasterState {
  return get_painter_group_raster_state_at_breath(group, Math.floor(group.start ?? group.breath_start ?? 0))
    ?? { id: make_random_id('property_block'), label: 'content', index: 0, length_breaths: 1, content: [] };
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
  const rasterProperty = create_default_raster_property(start, croppedEnd);
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
    property_ids: [rasterProperty.id],
    properties: { [rasterProperty.id]: rasterProperty },
    metadata: {
      created_at: now,
      modified_at: now,
    },
  };
}

export function clone_painter_group(group: PainterGroup): PainterGroup {
  const groupLike = group as PainterGroup;
  const start = Math.max(0, clamp_int((groupLike as any).start, clamp_int((groupLike as any).breath_start, 0)));
  const croppedStart = Math.max(start, clamp_int((groupLike as any).cropped_start, clamp_int((groupLike as any).breath_start, start)));
  const croppedEnd = Math.max(croppedStart, clamp_int((groupLike as any).cropped_end, clamp_int((groupLike as any).breath_end, croppedStart)));
  const normalizedProperties = normalize_painter_group_properties((groupLike as any).properties, (groupLike as any).property_ids, { start, end: croppedEnd });
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
    version: 5,
    bounds,
    occupied_bounds: document.occupied_bounds ? { ...document.occupied_bounds } : null,
    groups: Object.fromEntries(
      Object.entries(document.groups ?? {}).map(([groupId, group]) => [groupId, clone_painter_group(group)])
    ),
    group_order: Array.isArray(document.group_order) ? [...document.group_order].filter((id) => !!(document.groups ?? {})[id]) : [],
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
