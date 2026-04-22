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

export type PainterVoxelRecord = {
  key: PainterCoordKey;
  x: number;
  y: number;
  z: number;
  char: string;
  rgb: Rgb;
  weight_index: number;
};

export type PainterVoxelDelta = {
  x: number;
  y: number;
  z: number;
  next: PainterVoxelRecord | null;
};

export type PainterGroupFrame = {
  id: string;
  label: string;
  breath_offset?: number;
  deltas: PainterVoxelDelta[];
};

export type PainterGroup = {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  voxels: PainterVoxelRecord[];
  frames?: PainterGroupFrame[];
  metadata?: {
    created_at?: string;
    modified_at?: string;
    origin?: { x: number; y: number; z: number };
  };
};

export type PainterDocument = {
  version: 3;
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
  camera?: CameraConfig;
  metadata?: PainterDocumentMetadata;
};

function make_random_id(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
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
    key: voxel.key,
    x: voxel.x,
    y: voxel.y,
    z: voxel.z,
    char: voxel.char,
    rgb: { ...voxel.rgb },
    weight_index: voxel.weight_index,
  };
}

export function create_painter_group(name: string = 'Group'): PainterGroup {
  const now = new Date().toISOString();
  return {
    id: make_random_id('group'),
    name,
    visible: true,
    locked: false,
    opacity: 1,
    voxels: [],
    frames: [],
    metadata: {
      created_at: now,
      modified_at: now,
    },
  };
}

export function clone_painter_group(group: PainterGroup): PainterGroup {
  return {
    ...group,
    voxels: group.voxels.map(clone_painter_voxel_record),
    frames: Array.isArray(group.frames)
      ? group.frames.map((frame) => ({
          ...frame,
          deltas: frame.deltas.map((delta) => ({
            ...delta,
            next: delta.next ? clone_painter_voxel_record(delta.next) : null,
          })),
        }))
      : [],
    metadata: group.metadata ? {
      ...group.metadata,
      origin: group.metadata.origin ? { ...group.metadata.origin } : undefined,
    } : undefined,
  };
}

export function create_painter_document(width: number, height: number, options?: {
  min_x?: number;
  min_y?: number;
  min_z?: number;
  max_z?: number;
  default_group_name?: string;
}): PainterDocument {
  const minX = Math.floor(options?.min_x ?? 0);
  const minY = Math.floor(options?.min_y ?? 0);
  const minZ = Math.floor(options?.min_z ?? 0);
  const maxZ = Math.floor(options?.max_z ?? 0);
  const initialGroup = create_painter_group(options?.default_group_name ?? 'Group 1');
  const now = new Date().toISOString();
  return {
    version: 3,
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
    bounds,
    occupied_bounds: document.occupied_bounds ? { ...document.occupied_bounds } : null,
    groups: Object.fromEntries(
      Object.entries(document.groups).map(([groupId, group]) => [groupId, clone_painter_group(group)])
    ),
    group_order: [...document.group_order],
    camera: document.camera ? structuredClone(document.camera) : undefined,
    metadata: document.metadata ? { ...document.metadata } : undefined,
  };
}
