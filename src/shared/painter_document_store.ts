import { get_data_slot_dir } from '../engine/paths.js';
import { create_painter_document, create_painter_group, type PainterDocument } from '../ascii_painter/painter_document.js';
import { import_legacy_voxel_space_as_painter_document } from '../ascii_painter/painter_document_legacy_adapter.js';
import { add_painter_group, duplicate_painter_group, erase_group_voxel_at_breath, export_painter_document, normalize_painter_document_runtime, offset_painter_group_in_time, remove_painter_group, rename_painter_group, reorder_painter_groups, set_group_voxel_at_breath, set_painter_document_loop_window, set_painter_document_timing, set_painter_group_breath_span, set_painter_group_content_state, set_painter_group_location_key, set_painter_group_locked, set_painter_group_raster_segment_length, set_painter_group_timing, set_painter_group_visibility, set_painter_runtime_active_breath } from '../ascii_painter/painter_document_runtime.js';
import { split_painter_group_raster_segment, swap_painter_group_raster_segments } from '../ascii_painter/painter_document_runtime.js';
import { importVoxelSpace, type VoxelSpaceExport } from '../ascii_painter/voxel_space.js';
import { read_jsonc_file_or_default, write_json_file } from './json_file.js';

type PainterDocumentRecordV2 = {
  document_id: string;
  revision: number;
  updated_at: string;
  snapshot: PainterDocument;
};

type PainterDocumentRecordV1 = {
  document_id: string;
  revision: number;
  updated_at: string;
  snapshot: VoxelSpaceExport;
};

type PainterDocumentFileV2 = {
  schema_version: 2;
  documents: Record<string, PainterDocumentRecordV2>;
};

type PainterGroupVoxelHistoryEntry = {
  group_id: string;
  breath: number;
  changes: Array<{
    key: string;
    before: { key: string; x: number; y: number; z: number; char: string; rgb: { r: number; g: number; b: number }; weight_index: number } | null;
    after: { key: string; x: number; y: number; z: number; char: string; rgb: { r: number; g: number; b: number }; weight_index: number } | null;
  }>;
};

const painter_group_histories = new Map<string, { undo: PainterGroupVoxelHistoryEntry[]; redo: PainterGroupVoxelHistoryEntry[] }>();

type PainterDocumentFileV1 = {
  schema_version: 1;
  documents: Record<string, PainterDocumentRecordV1>;
};

export type PainterDocumentSnapshot = {
  document_id: string;
  revision: number;
  updated_at: string;
  snapshot: PainterDocument;
};

export type PainterCommandApplyMetadata = {
  base_revision: number | null;
  server_revision_before: number;
  server_revision_after: number;
  applied_from_stale_base: boolean;
};

export type PainterCommandApplyResult = PainterCommandApplyMetadata & {
  snapshot: PainterDocumentSnapshot;
};

const DEFAULT_DOCUMENT_ID = 'default_canvas';

function get_painter_document_store_path(slot: number): string {
  return `${get_data_slot_dir(slot)}/painter_documents.json`;
}

function create_default_document_snapshot(): PainterDocument {
  return create_painter_document(80, 40, { min_z: 0, max_z: 0, default_group_name: 'Group 1' });
}

function create_empty_file(): PainterDocumentFileV2 {
  return { schema_version: 2, documents: {} };
}

function normalize_document_id(document_id?: string | null): string {
  const normalized = String(document_id ?? '').trim();
  return normalized || DEFAULT_DOCUMENT_ID;
}

function make_history_key(slot: number, document_id: string, group_id: string): string {
  return `${slot}:${document_id}:${group_id}`;
}

function normalize_base_revision(base_revision?: number | null): number | null {
  const next = Number(base_revision);
  if (!Number.isFinite(next)) return null;
  return Math.max(0, Math.floor(next));
}

function build_command_apply_result(current: PainterDocumentSnapshot, next: PainterDocumentSnapshot, base_revision?: number | null): PainterCommandApplyResult {
  const normalized_base_revision = normalize_base_revision(base_revision);
  return {
    snapshot: next,
    base_revision: normalized_base_revision,
    server_revision_before: current.revision,
    server_revision_after: next.revision,
    applied_from_stale_base: normalized_base_revision !== null && normalized_base_revision < current.revision,
  };
}

function get_group_history(slot: number, document_id: string, group_id: string): { undo: PainterGroupVoxelHistoryEntry[]; redo: PainterGroupVoxelHistoryEntry[] } {
  const key = make_history_key(slot, document_id, group_id);
  const existing = painter_group_histories.get(key);
  if (existing) return existing;
  const created = { undo: [], redo: [] };
  painter_group_histories.set(key, created);
  return created;
}

function clear_document_group_histories(slot: number, document_id: string): void {
  const prefix = `${slot}:${document_id}:`;
  for (const key of Array.from(painter_group_histories.keys())) {
    if (key.startsWith(prefix)) painter_group_histories.delete(key);
  }
}

function apply_history_entry(snapshot: PainterDocumentSnapshot, entry: PainterGroupVoxelHistoryEntry, direction: 'undo' | 'redo'): PainterDocumentSnapshot {
  const runtime = normalize_painter_document_runtime(snapshot.snapshot);
  const target_group = runtime.document.groups[entry.group_id];
  if (!target_group) throw new Error('painter_group_not_found');
  set_painter_runtime_active_breath(runtime, entry.breath);
  for (const change of entry.changes) {
    const next = direction === 'undo' ? change.before : change.after;
    if (!next || next.char === ' ') {
      erase_group_voxel_at_breath(runtime, entry.group_id, entry.breath, change.key);
      continue;
    }
    set_group_voxel_at_breath(runtime, entry.group_id, entry.breath, {
      key: next.key,
      x: next.x,
      y: next.y,
      z: next.z,
      char: next.char,
      rgb: { ...next.rgb },
      weight_index: next.weight_index,
    }, { auto_key: true });
  }
  return {
    document_id: snapshot.document_id,
    revision: snapshot.revision + 1,
    updated_at: new Date().toISOString(),
    snapshot: export_painter_document(runtime),
  };
}

function sanitize_snapshot(snapshot: PainterDocument): PainterDocument {
  return export_painter_document(normalize_painter_document_runtime(snapshot));
}

function migrate_v1_record(record: PainterDocumentRecordV1): PainterDocumentRecordV2 {
  const migrated = export_painter_document(normalize_painter_document_runtime(import_legacy_voxel_space_as_painter_document(importVoxelSpace(record.snapshot))));
  return {
    document_id: String(record.document_id ?? '').trim() || DEFAULT_DOCUMENT_ID,
    revision: Math.max(1, Math.floor(Number(record.revision ?? 1)) || 1),
    updated_at: String(record.updated_at ?? '').trim() || new Date().toISOString(),
    snapshot: migrated,
  };
}

function load_file(slot: number): PainterDocumentFileV2 {
  const parsed = read_jsonc_file_or_default<any>(get_painter_document_store_path(slot), create_empty_file);
  if (parsed?.schema_version === 2 && typeof parsed?.documents === 'object' && parsed.documents) {
    return {
      schema_version: 2,
      documents: Object.fromEntries(
        Object.entries(parsed.documents as Record<string, PainterDocumentRecordV2>).map(([documentId, record]) => [
          documentId,
          {
            document_id: String(record?.document_id ?? documentId).trim() || documentId,
            revision: Math.max(1, Math.floor(Number(record?.revision ?? 1)) || 1),
            updated_at: String(record?.updated_at ?? '').trim() || new Date().toISOString(),
            snapshot: sanitize_snapshot(record?.snapshot ?? create_default_document_snapshot()),
          },
        ])
      ),
    };
  }
  if (parsed?.schema_version === 1 && typeof parsed?.documents === 'object' && parsed.documents) {
    const migrated: PainterDocumentFileV2 = {
      schema_version: 2,
      documents: Object.fromEntries(
        Object.entries(parsed.documents as Record<string, PainterDocumentRecordV1>).map(([documentId, record]) => [documentId, migrate_v1_record(record)])
      ),
    };
    save_file(slot, migrated);
    return migrated;
  }
  return create_empty_file();
}

function save_file(slot: number, file: PainterDocumentFileV2): void {
  write_json_file(get_painter_document_store_path(slot), file);
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
  const created: PainterDocumentRecordV2 = {
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
    snapshot: sanitize_snapshot(created.snapshot),
  };
}

export function save_painter_document_snapshot(slot: number, snapshot: PainterDocumentSnapshot): PainterDocumentSnapshot {
  const file = load_file(slot);
  const normalized_document_id = normalize_document_id(snapshot.document_id);
  const next: PainterDocumentRecordV2 = {
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

export function apply_painter_group_voxel_changes(
  slot: number,
  document_id: string,
  group_id: string,
  changes: Array<{ x: number; y: number; z: number; cell: { char: string; rgb: { r: number; g: number; b: number }; weight_index: number } }>,
  options?: { breath?: number; auto_key?: boolean }
): PainterDocumentSnapshot {
  const current = get_or_create_painter_document_snapshot(slot, document_id);
  const runtime = normalize_painter_document_runtime(current.snapshot);
  const group = runtime.document.groups[group_id];
  if (!group) throw new Error('painter_group_not_found');
  if (group.locked) throw new Error('painter_group_locked');
  const targetBreath = Math.max(0, Math.floor(options?.breath ?? runtime.active_breath));
  set_painter_runtime_active_breath(runtime, targetBreath);
  let changed = false;
  const history_entry: PainterGroupVoxelHistoryEntry = { group_id, breath: targetBreath, changes: [] };
  for (const change of changes) {
    const key = `${Math.floor(change.x)}:${Math.floor(change.y)}:${Math.floor(change.z)}`;
    const before = runtime.group_voxel_index.get(group_id)?.get(key) ?? null;
    const nextChar = String(change.cell.char ?? ' ').slice(0, 1) || ' ';
    if (nextChar === ' ') {
      if (runtime.group_voxel_index.get(group_id)?.has(key)) {
        erase_group_voxel_at_breath(runtime, group_id, targetBreath, key);
        history_entry.changes.push({
          key,
          before: before ? { ...before, rgb: { ...before.rgb } } : null,
          after: null,
        });
        changed = true;
      }
      continue;
    }
    const nextVoxel = {
      key,
      x: Math.floor(change.x),
      y: Math.floor(change.y),
      z: Math.floor(change.z),
      char: nextChar,
      rgb: { ...change.cell.rgb },
      weight_index: change.cell.weight_index,
    };
    const written = set_group_voxel_at_breath(runtime, group_id, targetBreath, nextVoxel, { auto_key: options?.auto_key ?? true });
    if (!written.applied) continue;
    history_entry.changes.push({
      key,
      before: before ? { ...before, rgb: { ...before.rgb } } : null,
      after: { ...nextVoxel, rgb: { ...nextVoxel.rgb } },
    });
    changed = true;
  }
  if (!changed) return current;
  const saved = save_painter_document_snapshot(slot, {
    document_id: current.document_id,
    revision: current.revision + 1,
    updated_at: new Date().toISOString(),
    snapshot: export_painter_document(runtime),
  });
  const groupHistory = get_group_history(slot, current.document_id, group_id);
  groupHistory.undo.push(history_entry);
  groupHistory.redo = [];
  if (groupHistory.undo.length > 100) groupHistory.undo.shift();
  return saved;
}

export function replace_painter_document_snapshot(
  slot: number,
  document_id: string,
  snapshot: PainterDocument,
  options?: { base_revision?: number | null }
): PainterCommandApplyResult {
  const normalized_document_id = normalize_document_id(document_id);
  const current = get_or_create_painter_document_snapshot(slot, normalized_document_id);
  clear_document_group_histories(slot, normalized_document_id);
  const next = save_painter_document_snapshot(slot, {
    document_id: normalized_document_id,
    revision: current.revision + 1,
    updated_at: new Date().toISOString(),
    snapshot,
  });
  return build_command_apply_result(current, next, options?.base_revision);
}

export function apply_painter_group_voxel_command(
  slot: number,
  document_id: string,
  group_id: string,
  changes: Array<{ x: number; y: number; z: number; cell: { char: string; rgb: { r: number; g: number; b: number }; weight_index: number } }>,
  options?: { base_revision?: number | null; breath?: number; auto_key?: boolean }
): PainterCommandApplyResult {
  const current = get_or_create_painter_document_snapshot(slot, document_id);
  const next = apply_painter_group_voxel_changes(slot, document_id, group_id, changes, { breath: options?.breath, auto_key: options?.auto_key ?? true });
  return build_command_apply_result(current, next, options?.base_revision);
}

export function undo_painter_group_changes(slot: number, document_id: string, group_id: string): PainterDocumentSnapshot {
  const current = get_or_create_painter_document_snapshot(slot, document_id);
  const groupHistory = get_group_history(slot, current.document_id, group_id);
  const entry = groupHistory.undo.pop();
  if (!entry) return current;
  const next = save_painter_document_snapshot(slot, apply_history_entry(current, entry, 'undo'));
  groupHistory.redo.push(entry);
  return next;
}

export function undo_painter_group_command(slot: number, document_id: string, group_id: string, options?: { base_revision?: number | null }): PainterCommandApplyResult {
  const current = get_or_create_painter_document_snapshot(slot, document_id);
  const next = undo_painter_group_changes(slot, document_id, group_id);
  return build_command_apply_result(current, next, options?.base_revision);
}

export function redo_painter_group_changes(slot: number, document_id: string, group_id: string): PainterDocumentSnapshot {
  const current = get_or_create_painter_document_snapshot(slot, document_id);
  const groupHistory = get_group_history(slot, current.document_id, group_id);
  const entry = groupHistory.redo.pop();
  if (!entry) return current;
  const next = save_painter_document_snapshot(slot, apply_history_entry(current, entry, 'redo'));
  groupHistory.undo.push(entry);
  return next;
}

export function redo_painter_group_command(slot: number, document_id: string, group_id: string, options?: { base_revision?: number | null }): PainterCommandApplyResult {
  const current = get_or_create_painter_document_snapshot(slot, document_id);
  const next = redo_painter_group_changes(slot, document_id, group_id);
  return build_command_apply_result(current, next, options?.base_revision);
}

function assert_group_exists(runtime: ReturnType<typeof normalize_painter_document_runtime>, group_id: string): void {
  if (!runtime.document.groups[group_id]) throw new Error('painter_group_not_found');
}

function assert_can_delete_group(runtime: ReturnType<typeof normalize_painter_document_runtime>, group_id: string): void {
  assert_group_exists(runtime, group_id);
  if (runtime.document.group_order.length <= 1) throw new Error('painter_last_group_delete_forbidden');
}

export function apply_painter_group_structure_change(
  slot: number,
  document_id: string,
  command:
    | { kind: 'set_document_timing'; breath_range_start: number; breath_range_end: number; frames_per_breath: number; loop_enabled: boolean }
    | { kind: 'set_document_loop_window'; breath_start: number; breath_end: number }
    | { kind: 'create_group'; group_name?: string; target_group_id?: string; breath_start?: number; breath_end?: number }
    | { kind: 'offset_group_in_time'; group_id: string; delta_breaths: number }
    | { kind: 'set_group_timing'; group_id: string; start: number; cropped_start: number; cropped_end: number }
    | { kind: 'set_group_breath_span'; group_id: string; breath_start: number; breath_end: number }
    | { kind: 'set_group_raster_segment_length'; group_id: string; content_state_id: string; length_breaths: number }
    | { kind: 'split_group_raster_segment'; group_id: string; content_state_id: string; split_breath: number }
    | { kind: 'swap_group_raster_segments'; group_id: string; source_content_state_id: string; target_content_state_id: string }
    | { kind: 'delete_group'; group_id: string }
    | { kind: 'duplicate_group'; source_group_id: string; target_group_id?: string }
    | { kind: 'rename_group'; group_id: string; group_name: string }
     | { kind: 'set_group_visibility'; group_id: string; visible: boolean }
     | { kind: 'set_group_locked'; group_id: string; locked: boolean }
     | { kind: 'set_group_content_state'; group_id: string; breath: number; voxels: Array<{ key: string; x: number; y: number; z: number; char: string; rgb: { r: number; g: number; b: number }; weight_index: number }> }
     | { kind: 'set_group_location_key'; group_id: string; breath: number; offset: { x: number; y: number; z: number } }
     | { kind: 'reorder_groups'; next_group_order: string[] }
     | { kind: 'reset_document' }
): PainterDocumentSnapshot {
  const current = get_or_create_painter_document_snapshot(slot, document_id);
  const runtime = normalize_painter_document_runtime(current.snapshot);

  switch (command.kind) {
    case 'set_document_timing': {
      set_painter_document_timing(runtime, command);
      break;
    }
    case 'set_document_loop_window': {
      set_painter_document_loop_window(runtime, command);
      break;
    }
    case 'create_group': {
      const group = create_painter_group(command.group_name || `Group ${runtime.document.group_order.length + 1}`, {
        breath_start: Math.max(0, Math.floor(command.breath_start ?? runtime.active_breath)),
        breath_end: Math.max(0, Math.floor(command.breath_end ?? command.breath_start ?? runtime.active_breath)),
      });
      if (command.target_group_id) group.id = command.target_group_id;
      add_painter_group(runtime, group);
      break;
    }
    case 'offset_group_in_time': {
      assert_group_exists(runtime, command.group_id);
      offset_painter_group_in_time(runtime, command.group_id, command.delta_breaths);
      break;
    }
    case 'set_group_breath_span': {
      assert_group_exists(runtime, command.group_id);
      set_painter_group_breath_span(runtime, command.group_id, command.breath_start, command.breath_end);
      break;
    }
    case 'set_group_timing': {
      assert_group_exists(runtime, command.group_id);
      set_painter_group_timing(runtime, command.group_id, command);
      break;
    }
    case 'set_group_raster_segment_length': {
      assert_group_exists(runtime, command.group_id);
      set_painter_group_raster_segment_length(runtime, command.group_id, command.content_state_id, command.length_breaths);
      break;
    }
    case 'split_group_raster_segment': {
      assert_group_exists(runtime, command.group_id);
      split_painter_group_raster_segment(runtime, command.group_id, command.content_state_id, command.split_breath);
      break;
    }
    case 'swap_group_raster_segments': {
      assert_group_exists(runtime, command.group_id);
      swap_painter_group_raster_segments(runtime, command.group_id, command.source_content_state_id, command.target_content_state_id);
      break;
    }
    case 'delete_group': {
      assert_can_delete_group(runtime, command.group_id);
      remove_painter_group(runtime, command.group_id);
      break;
    }
    case 'duplicate_group': {
      assert_group_exists(runtime, command.source_group_id);
      if (command.target_group_id && runtime.document.groups[command.target_group_id]) throw new Error('painter_group_already_exists');
      const duplicated = duplicate_painter_group(runtime, command.source_group_id);
      if (command.target_group_id && command.target_group_id !== duplicated.id) {
        const created = runtime.document.groups[duplicated.id];
        if (created) {
          runtime.document.groups[command.target_group_id] = { ...created, id: command.target_group_id };
          delete runtime.document.groups[duplicated.id];
          const voxelMap = runtime.group_voxel_index.get(duplicated.id);
          if (voxelMap) {
            runtime.group_voxel_index.set(command.target_group_id, voxelMap);
            runtime.group_voxel_index.delete(duplicated.id);
            for (const coordKey of voxelMap.keys()) {
              const contributors = runtime.coordinate_group_index.get(coordKey) ?? [];
              runtime.coordinate_group_index.set(coordKey, contributors.map((groupId) => groupId === duplicated.id ? command.target_group_id! : groupId));
            }
          }
          runtime.document.group_order = runtime.document.group_order.map((groupId) => groupId === duplicated.id ? command.target_group_id! : groupId);
        }
      }
      break;
    }
    case 'rename_group': {
      assert_group_exists(runtime, command.group_id);
      rename_painter_group(runtime, command.group_id, command.group_name);
      break;
    }
    case 'set_group_visibility': {
      assert_group_exists(runtime, command.group_id);
      set_painter_group_visibility(runtime, command.group_id, command.visible);
      break;
    }
    case 'set_group_locked': {
      assert_group_exists(runtime, command.group_id);
      set_painter_group_locked(runtime, command.group_id, command.locked);
      break;
    }
    case 'set_group_content_state': {
      assert_group_exists(runtime, command.group_id);
      set_painter_group_content_state(runtime, command.group_id, command.breath, command.voxels.map((voxel) => ({
        key: voxel.key,
        x: voxel.x,
        y: voxel.y,
        z: voxel.z,
        char: voxel.char,
        rgb: { ...voxel.rgb },
        weight_index: voxel.weight_index,
      })));
      break;
    }
    case 'set_group_location_key': {
      assert_group_exists(runtime, command.group_id);
      set_painter_group_location_key(runtime, command.group_id, command.breath, command.offset);
      break;
    }
    case 'reorder_groups': {
      reorder_painter_groups(runtime, command.next_group_order);
      break;
    }
    case 'reset_document': {
      return save_painter_document_snapshot(slot, {
        document_id: current.document_id,
        revision: current.revision + 1,
        updated_at: new Date().toISOString(),
        snapshot: create_default_document_snapshot(),
      });
    }
    default:
      throw new Error('painter_command_not_supported');
  }

  return save_painter_document_snapshot(slot, {
    document_id: current.document_id,
    revision: current.revision + 1,
    updated_at: new Date().toISOString(),
    snapshot: export_painter_document(runtime),
  });
}

export function apply_painter_group_structure_command(
  slot: number,
  document_id: string,
  command:
    | { kind: 'set_document_timing'; breath_range_start: number; breath_range_end: number; frames_per_breath: number; loop_enabled: boolean }
    | { kind: 'set_document_loop_window'; breath_start: number; breath_end: number }
    | { kind: 'create_group'; group_name?: string; target_group_id?: string; breath_start?: number; breath_end?: number }
    | { kind: 'offset_group_in_time'; group_id: string; delta_breaths: number }
    | { kind: 'set_group_timing'; group_id: string; start: number; cropped_start: number; cropped_end: number }
    | { kind: 'set_group_breath_span'; group_id: string; breath_start: number; breath_end: number }
    | { kind: 'set_group_raster_segment_length'; group_id: string; content_state_id: string; length_breaths: number }
    | { kind: 'split_group_raster_segment'; group_id: string; content_state_id: string; split_breath: number }
    | { kind: 'swap_group_raster_segments'; group_id: string; source_content_state_id: string; target_content_state_id: string }
    | { kind: 'delete_group'; group_id: string }
    | { kind: 'duplicate_group'; source_group_id: string; target_group_id?: string }
    | { kind: 'rename_group'; group_id: string; group_name: string }
     | { kind: 'set_group_visibility'; group_id: string; visible: boolean }
     | { kind: 'set_group_locked'; group_id: string; locked: boolean }
     | { kind: 'set_group_content_state'; group_id: string; breath: number; voxels: Array<{ key: string; x: number; y: number; z: number; char: string; rgb: { r: number; g: number; b: number }; weight_index: number }> }
     | { kind: 'set_group_location_key'; group_id: string; breath: number; offset: { x: number; y: number; z: number } }
     | { kind: 'reorder_groups'; next_group_order: string[] }
     | { kind: 'reset_document' },
  options?: { base_revision?: number | null }
): PainterCommandApplyResult {
  const current = get_or_create_painter_document_snapshot(slot, document_id);
  const next = apply_painter_group_structure_change(slot, document_id, command);
  return build_command_apply_result(current, next, options?.base_revision);
}
