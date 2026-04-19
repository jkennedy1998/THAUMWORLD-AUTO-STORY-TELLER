import { get_data_slot_dir } from '../engine/paths.js';
import { createVoxelSpace, exportVoxelSpace, importVoxelSpace, setVoxel, type VoxelSpace, type VoxelSpaceExport } from '../ascii_painter/voxel_space.js';
import type { GridCell } from '../ascii_painter/types.js';
import { read_jsonc_file_or_default, write_json_file } from './json_file.js';

type PainterDocumentRecord = {
  document_id: string;
  revision: number;
  updated_at: string;
  snapshot: VoxelSpaceExport;
};

type PainterDocumentFile = {
  schema_version: 1;
  documents: Record<string, PainterDocumentRecord>;
};

export type PainterDocumentSnapshot = {
  document_id: string;
  revision: number;
  updated_at: string;
  snapshot: VoxelSpaceExport;
};

const DEFAULT_DOCUMENT_ID = 'default_canvas';

function get_painter_document_store_path(slot: number): string {
  return `${get_data_slot_dir(slot)}/painter_documents.json`;
}

function create_default_document_snapshot(): VoxelSpaceExport {
  return exportVoxelSpace(createVoxelSpace(80, 40, { defaultZ: 0 }));
}

function create_empty_file(): PainterDocumentFile {
  return { schema_version: 1, documents: {} };
}

function load_file(slot: number): PainterDocumentFile {
  const parsed = read_jsonc_file_or_default<any>(get_painter_document_store_path(slot), create_empty_file);
  if (parsed?.schema_version !== 1 || typeof parsed?.documents !== 'object' || !parsed.documents) {
    return create_empty_file();
  }
  return { schema_version: 1, documents: parsed.documents as Record<string, PainterDocumentRecord> };
}

function save_file(slot: number, file: PainterDocumentFile): void {
  write_json_file(get_painter_document_store_path(slot), file);
}

function normalize_document_id(document_id?: string | null): string {
  const normalized = String(document_id ?? '').trim();
  return normalized || DEFAULT_DOCUMENT_ID;
}

function sanitize_snapshot(snapshot: VoxelSpaceExport): VoxelSpaceExport {
  return exportVoxelSpace(importVoxelSpace(snapshot));
}

export function get_or_create_painter_document_snapshot(slot: number, document_id?: string | null): PainterDocumentSnapshot {
  const file = load_file(slot);
  const normalized_document_id = normalize_document_id(document_id);
  const existing = file.documents[normalized_document_id];
  if (existing) {
    return {
      document_id: existing.document_id,
      revision: Math.max(1, Math.floor(Number(existing.revision ?? 1)) || 1),
      updated_at: String(existing.updated_at ?? '').trim() || new Date().toISOString(),
      snapshot: sanitize_snapshot(existing.snapshot),
    };
  }
  const created: PainterDocumentRecord = {
    document_id: normalized_document_id,
    revision: 1,
    updated_at: new Date().toISOString(),
    snapshot: create_default_document_snapshot(),
  };
  file.documents[normalized_document_id] = created;
  save_file(slot, file);
  return {
    document_id: created.document_id,
    revision: created.revision,
    updated_at: created.updated_at,
    snapshot: created.snapshot,
  };
}

export function save_painter_document_snapshot(slot: number, snapshot: PainterDocumentSnapshot): PainterDocumentSnapshot {
  const file = load_file(slot);
  const normalized_document_id = normalize_document_id(snapshot.document_id);
  const next: PainterDocumentRecord = {
    document_id: normalized_document_id,
    revision: Math.max(1, Math.floor(Number(snapshot.revision ?? 1)) || 1),
    updated_at: String(snapshot.updated_at ?? '').trim() || new Date().toISOString(),
    snapshot: sanitize_snapshot(snapshot.snapshot),
  };
  file.documents[normalized_document_id] = next;
  save_file(slot, file);
  return {
    document_id: next.document_id,
    revision: next.revision,
    updated_at: next.updated_at,
    snapshot: next.snapshot,
  };
}

export function load_painter_document_voxel_space(slot: number, document_id?: string | null): VoxelSpace {
  return importVoxelSpace(get_or_create_painter_document_snapshot(slot, document_id).snapshot);
}

export function apply_painter_cell_changes(slot: number, document_id: string, changes: Array<{ x: number; y: number; z: number; cell: GridCell }>): PainterDocumentSnapshot {
  const current = get_or_create_painter_document_snapshot(slot, document_id);
  const space = importVoxelSpace(current.snapshot);
  let changed = false;
  for (const change of changes) {
    if (setVoxel(space, change.x, change.y, change.z, { ...change.cell })) {
      changed = true;
    }
  }
  if (!changed) return current;
  return save_painter_document_snapshot(slot, {
    document_id: current.document_id,
    revision: current.revision + 1,
    updated_at: new Date().toISOString(),
    snapshot: exportVoxelSpace(space),
  });
}
