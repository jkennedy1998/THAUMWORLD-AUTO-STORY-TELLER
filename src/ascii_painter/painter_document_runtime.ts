import {
  create_painter_group,
  clone_painter_document,
  clone_painter_group,
  clone_painter_voxel_record,
  make_painter_coord_key,
  type PainterCoordKey,
  type PainterDocument,
  type PainterGroup,
  type PainterOccupiedBounds,
  type PainterVoxelRecord,
} from './painter_document.js';

export type ResolvedPainterVoxel = {
  x: number;
  y: number;
  z: number;
  winning_group_id: string;
  cell: PainterVoxelRecord;
};

export type PainterDocumentRuntime = {
  document: PainterDocument;
  group_voxel_index: Map<string, Map<string, PainterVoxelRecord>>;
  coordinate_group_index: Map<string, string[]>;
  resolved_visible_index: Map<string, ResolvedPainterVoxel>;
};

export type ResolveVoxelWinnerResult = {
  winning_group_id: string | null;
  cell: PainterVoxelRecord | null;
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

function set_group_voxel_array(group: PainterGroup, voxelMap: Map<string, PainterVoxelRecord>): void {
  group.voxels = Array.from(voxelMap.values())
    .sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x)
    .map(clone_painter_voxel_record);
  if (group.metadata) group.metadata.modified_at = new Date().toISOString();
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

function scan_runtime_voxel_extents(runtime: PainterDocumentRuntime): PainterVoxelExtents | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const voxelMap of runtime.group_voxel_index.values()) {
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

export function derive_painter_occupied_bounds(runtime: PainterDocumentRuntime): PainterOccupiedBounds | null {
  const extents = scan_runtime_voxel_extents(runtime);
  if (!extents) return null;
  return { ...extents };
}

function derive_painter_document_bounds(runtime: PainterDocumentRuntime): PainterDocumentBounds {
  const extents = scan_runtime_voxel_extents(runtime);
  if (!extents) {
    return {
      minX: 0,
      minY: 0,
      width: 1,
      height: 1,
      depth: 1,
      minZ: 0,
      maxZ: 0,
    };
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

export function resolve_painter_voxel_winner(runtime: PainterDocumentRuntime, coordKey: PainterCoordKey): ResolveVoxelWinnerResult {
  const contributors = runtime.coordinate_group_index.get(coordKey) ?? [];
  if (contributors.length < 1) return { winning_group_id: null, cell: null };
  for (let i = runtime.document.group_order.length - 1; i >= 0; i -= 1) {
    const groupId = runtime.document.group_order[i]!;
    if (!contributors.includes(groupId)) continue;
    const group = runtime.document.groups[groupId];
    if (!group?.visible) continue;
    const voxel = runtime.group_voxel_index.get(groupId)?.get(coordKey) ?? null;
    if (voxel) {
      return {
        winning_group_id: groupId,
        cell: clone_painter_voxel_record(voxel),
      };
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

export function normalize_painter_document_runtime(document: PainterDocument): PainterDocumentRuntime {
  const cloned = clone_painter_document(document);
  cloned.bounds = normalize_document_bounds(cloned.bounds);
  cloned.group_order = normalize_group_order(cloned);
  const groupVoxelIndex = new Map<string, Map<string, PainterVoxelRecord>>();
  const coordinateGroupIndex = new Map<string, string[]>();
  for (const groupId of Object.keys(cloned.groups)) {
    const group = cloned.groups[groupId]!;
    const voxelMap = new Map<string, PainterVoxelRecord>();
    for (const voxel of Array.isArray(group.voxels) ? group.voxels : []) {
      const normalized = clone_painter_voxel_record({ ...voxel, key: make_painter_coord_key(voxel.x, voxel.y, voxel.z) });
      voxelMap.set(normalized.key, normalized);
    }
    groupVoxelIndex.set(groupId, voxelMap);
    set_group_voxel_array(group, voxelMap);
    for (const key of voxelMap.keys()) {
      const contributors = coordinateGroupIndex.get(key) ?? [];
      if (!contributors.includes(groupId)) contributors.push(groupId);
      coordinateGroupIndex.set(key, contributors);
    }
  }
  const runtime: PainterDocumentRuntime = {
    document: cloned,
    group_voxel_index: groupVoxelIndex,
    coordinate_group_index: coordinateGroupIndex,
    resolved_visible_index: new Map<string, ResolvedPainterVoxel>(),
  };
  refresh_document_extents(runtime);
  for (const key of coordinateGroupIndex.keys()) rebuild_winner_for_coord(runtime, key);
  return runtime;
}

export function get_group_voxel(runtime: PainterDocumentRuntime, groupId: string, coordKey: PainterCoordKey): PainterVoxelRecord | null {
  const voxel = runtime.group_voxel_index.get(groupId)?.get(coordKey) ?? null;
  return voxel ? clone_painter_voxel_record(voxel) : null;
}

export function set_group_voxel(runtime: PainterDocumentRuntime, groupId: string, voxel: PainterVoxelRecord): void {
  const group = runtime.document.groups[groupId];
  if (!group) throw new Error(`painter_group_not_found:${groupId}`);
  const normalized = clone_painter_voxel_record({ ...voxel, key: make_painter_coord_key(voxel.x, voxel.y, voxel.z) });
  let voxelMap = runtime.group_voxel_index.get(groupId);
  if (!voxelMap) {
    voxelMap = new Map<string, PainterVoxelRecord>();
    runtime.group_voxel_index.set(groupId, voxelMap);
  }
  voxelMap.set(normalized.key, normalized);
  const contributors = runtime.coordinate_group_index.get(normalized.key) ?? [];
  if (!contributors.includes(groupId)) contributors.push(groupId);
  runtime.coordinate_group_index.set(normalized.key, contributors);
  set_group_voxel_array(group, voxelMap);
  touch_modified_at(runtime.document);
  refresh_document_extents(runtime);
  rebuild_winner_for_coord(runtime, normalized.key);
}

export function erase_group_voxel(runtime: PainterDocumentRuntime, groupId: string, coordKey: PainterCoordKey): void {
  const group = runtime.document.groups[groupId];
  const voxelMap = runtime.group_voxel_index.get(groupId);
  if (!group || !voxelMap?.has(coordKey)) return;
  voxelMap.delete(coordKey);
  set_group_voxel_array(group, voxelMap);
  const nextContributors = (runtime.coordinate_group_index.get(coordKey) ?? []).filter((id) => id !== groupId);
  if (nextContributors.length > 0) runtime.coordinate_group_index.set(coordKey, nextContributors);
  else runtime.coordinate_group_index.delete(coordKey);
  touch_modified_at(runtime.document);
  refresh_document_extents(runtime);
  rebuild_winner_for_coord(runtime, coordKey);
}

export function reorder_painter_groups(runtime: PainterDocumentRuntime, nextGroupOrder: string[]): void {
  const normalized = nextGroupOrder.filter((groupId) => !!runtime.document.groups[groupId]);
  for (const groupId of Object.keys(runtime.document.groups)) {
    if (!normalized.includes(groupId)) normalized.push(groupId);
  }
  runtime.document.group_order = normalized;
  touch_modified_at(runtime.document);
  for (const key of runtime.coordinate_group_index.keys()) rebuild_winner_for_coord(runtime, key);
}

export function set_painter_group_visibility(runtime: PainterDocumentRuntime, groupId: string, visible: boolean): void {
  const group = runtime.document.groups[groupId];
  if (!group || group.visible === visible) return;
  group.visible = visible;
  touch_modified_at(runtime.document);
  const voxelMap = runtime.group_voxel_index.get(groupId);
  if (!voxelMap) return;
  for (const key of voxelMap.keys()) rebuild_winner_for_coord(runtime, key);
}

export function set_painter_group_locked(runtime: PainterDocumentRuntime, groupId: string, locked: boolean): void {
  const group = runtime.document.groups[groupId];
  if (!group || group.locked === locked) return;
  group.locked = locked;
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
  const nextGroup = group ? clone_painter_group(group) : create_painter_group(`Group ${runtime.document.group_order.length + 1}`);
  runtime.document.groups[nextGroup.id] = nextGroup;
  runtime.group_voxel_index.set(nextGroup.id, new Map<string, PainterVoxelRecord>());
  const insertBefore = opts?.insert_before_group_id;
  const nextOrder = runtime.document.group_order.filter((groupId) => groupId !== nextGroup.id);
  const insertIndex = insertBefore ? nextOrder.indexOf(insertBefore) : -1;
  if (insertIndex >= 0) nextOrder.splice(insertIndex, 0, nextGroup.id);
  else nextOrder.push(nextGroup.id);
  runtime.document.group_order = nextOrder;
  touch_modified_at(runtime.document);
  return clone_painter_group(nextGroup);
}

export function remove_painter_group(runtime: PainterDocumentRuntime, groupId: string): void {
  const group = runtime.document.groups[groupId];
  if (!group) return;
  const voxelMap = runtime.group_voxel_index.get(groupId);
  if (voxelMap) {
    for (const coordKey of voxelMap.keys()) {
      const nextContributors = (runtime.coordinate_group_index.get(coordKey) ?? []).filter((id) => id !== groupId);
      if (nextContributors.length > 0) runtime.coordinate_group_index.set(coordKey, nextContributors);
      else runtime.coordinate_group_index.delete(coordKey);
      rebuild_winner_for_coord(runtime, coordKey);
    }
  }
  runtime.group_voxel_index.delete(groupId);
  delete runtime.document.groups[groupId];
  runtime.document.group_order = runtime.document.group_order.filter((id) => id !== groupId);
  touch_modified_at(runtime.document);
  refresh_document_extents(runtime);
}

export function duplicate_painter_group(runtime: PainterDocumentRuntime, groupId: string, newName?: string): PainterGroup {
  const source = runtime.document.groups[groupId];
  if (!source) throw new Error(`painter_group_not_found:${groupId}`);
  const duplicated = clone_painter_group(source);
  duplicated.id = create_painter_group().id;
  duplicated.name = newName ?? `${source.name} (copy)`;
  duplicated.locked = false;
  const inserted = add_painter_group(runtime, duplicated);
  const voxelMap = new Map<string, PainterVoxelRecord>();
  for (const voxel of duplicated.voxels) {
    voxelMap.set(voxel.key, clone_painter_voxel_record(voxel));
    const contributors = runtime.coordinate_group_index.get(voxel.key) ?? [];
    if (!contributors.includes(inserted.id)) contributors.push(inserted.id);
    runtime.coordinate_group_index.set(voxel.key, contributors);
    rebuild_winner_for_coord(runtime, voxel.key);
  }
  runtime.group_voxel_index.set(inserted.id, voxelMap);
  runtime.document.groups[inserted.id] = { ...runtime.document.groups[inserted.id]!, voxels: Array.from(voxelMap.values()).map(clone_painter_voxel_record) };
  refresh_document_extents(runtime);
  touch_modified_at(runtime.document);
  return clone_painter_group(runtime.document.groups[inserted.id]!);
}

export function export_painter_document(runtime: PainterDocumentRuntime): PainterDocument {
  refresh_document_extents(runtime);
  return clone_painter_document(runtime.document);
}
