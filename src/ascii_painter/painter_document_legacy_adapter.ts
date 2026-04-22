import type { GridCell } from './types.js';
import {
  clone_painter_voxel_record,
  create_painter_document,
  create_painter_group,
  create_painter_voxel_record,
  type PainterDocument,
} from './painter_document.js';
import {
  normalize_painter_document_runtime,
  type PainterDocumentRuntime,
} from './painter_document_runtime.js';
import {
  addLayer,
  createVoxelSpace,
  getLayer,
  setVoxel,
  type VoxelLayer,
  type VoxelSpace,
} from './voxel_space.js';

function is_non_empty_cell(cell: GridCell | null | undefined): cell is GridCell {
  return !!cell && cell.char !== ' ';
}

export function import_legacy_voxel_space_as_painter_document(legacy: VoxelSpace, opts?: {
  group_ids_by_legacy_z?: Map<number, string>;
  group_order?: string[];
  active_group_id?: string | null;
}): PainterDocument {
  const document = create_painter_document(legacy.bounds.width, legacy.bounds.height, {
    min_z: legacy.bounds.minZ,
    max_z: legacy.bounds.maxZ,
    default_group_name: 'Layer 0',
  });
  document.groups = {};
  document.group_order = [];
  const descending_zs = Array.from(legacy.layers.keys()).sort((a, b) => b - a);
  const preferredOrder = opts?.group_order ?? [];
  const entries: Array<{ group_id: string; z: number; layer: VoxelLayer }> = [];
  for (const z of descending_zs) {
    const layer = legacy.layers.get(z);
    if (!layer) continue;
    const group = create_painter_group(layer.name);
    const preferredId = opts?.group_ids_by_legacy_z?.get(z) ?? null;
    if (preferredId) group.id = preferredId;
    group.name = layer.name;
    group.visible = layer.visible;
    group.locked = layer.locked;
    group.opacity = layer.opacity;
    group.voxels = [];
    for (let y = 0; y < legacy.bounds.height; y += 1) {
      const row = layer.cells[y];
      if (!row) continue;
      for (let x = 0; x < legacy.bounds.width; x += 1) {
        const cell = row[x];
        if (!is_non_empty_cell(cell)) continue;
        group.voxels.push(create_painter_voxel_record({
          x,
          y,
          z,
          char: cell.char,
          rgb: { ...cell.rgb },
          weight_index: cell.weight_index,
        }));
      }
    }
    document.groups[group.id] = group;
    entries.push({ group_id: group.id, z, layer });
  }
  document.group_order = preferredOrder.filter((groupId) => !!document.groups[groupId]);
  for (const entry of entries) {
    if (!document.group_order.includes(entry.group_id)) document.group_order.push(entry.group_id);
  }
  document.camera = structuredClone(legacy.camera);
  document.metadata = legacy.metadata ? { ...legacy.metadata } : document.metadata;
  return normalize_painter_document_runtime(document).document;
}

export function build_legacy_voxel_space_from_painter_runtime(runtime: PainterDocumentRuntime): VoxelSpace {
  const document = runtime.document;
  const legacy = createVoxelSpace(document.bounds.width, document.bounds.height, {
    minZ: document.bounds.minZ,
    maxZ: document.bounds.maxZ,
    defaultZ: document.bounds.minZ,
  });
  legacy.layers.clear();
  for (let z = document.bounds.minZ; z <= document.bounds.maxZ; z += 1) {
    addLayer(legacy, z, `Layer ${z}`);
  }
  for (const [coordKey, resolved] of runtime.resolved_visible_index.entries()) {
    const winnerGroup = runtime.document.groups[resolved.winning_group_id];
    if (!winnerGroup?.visible) continue;
    const layer = getLayer(legacy, resolved.z);
    if (!layer) continue;
    layer.visible = true;
    setVoxel(legacy, resolved.x - document.bounds.minX, resolved.y - document.bounds.minY, resolved.z, {
      char: resolved.cell.char,
      rgb: { ...resolved.cell.rgb },
      weight_index: resolved.cell.weight_index,
    });
  }
  legacy.camera = document.camera ? structuredClone(document.camera) : legacy.camera;
  legacy.metadata = document.metadata ? { ...document.metadata } : legacy.metadata;
  return legacy;
}

export function build_projection_source_voxel_space_from_painter_runtime(runtime: PainterDocumentRuntime): VoxelSpace {
  const source = createVoxelSpace(runtime.document.bounds.width, runtime.document.bounds.height, {
    minZ: runtime.document.bounds.minZ,
    maxZ: runtime.document.bounds.maxZ,
    defaultZ: runtime.document.bounds.minZ,
  });
  source.layers.clear();
  for (let z = runtime.document.bounds.minZ; z <= runtime.document.bounds.maxZ; z += 1) {
    addLayer(source, z, `resolved_plane_${z}`);
  }
  for (const resolved of runtime.resolved_visible_index.values()) {
    setVoxel(source, resolved.x - runtime.document.bounds.minX, resolved.y - runtime.document.bounds.minY, resolved.z, {
      char: resolved.cell.char,
      rgb: { ...resolved.cell.rgb },
      weight_index: resolved.cell.weight_index,
    });
  }
  source.camera = runtime.document.camera ? structuredClone(runtime.document.camera) : source.camera;
  source.metadata = runtime.document.metadata ? { ...runtime.document.metadata } : source.metadata;
  return source;
}
