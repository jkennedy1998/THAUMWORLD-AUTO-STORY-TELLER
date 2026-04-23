import { create_painter_group, create_painter_voxel_record, type PainterDocument } from './painter_document.js';
import {
  add_painter_group,
  duplicate_painter_group,
  erase_group_voxel,
  normalize_painter_document_runtime,
  remove_painter_group,
  rename_painter_group,
  reorder_painter_groups,
  set_group_voxel,
  set_painter_group_locked,
  set_painter_group_visibility,
} from './painter_document_runtime.js';
import type {
  PainterAuthoritativeSnapshotMeta,
  PainterGroupPlaneRegistry,
  PainterReplaceDocumentMeta,
  PainterSessionCellChangeInput,
  PainterSessionCellHistoryChange,
  PainterSessionGroupCommand,
  PainterSessionState,
} from './painter_session_types.js';

function clone_group_plane_registry(registry: PainterGroupPlaneRegistry): PainterGroupPlaneRegistry {
  return {
    group_id_to_plane: new Map(registry.group_id_to_plane),
    plane_to_group_id: new Map(registry.plane_to_group_id),
  };
}

function build_group_plane_registry(state: PainterSessionState, preserve_existing: boolean): PainterGroupPlaneRegistry {
  const discovered_ids = [...state.runtime.document.group_order].filter((group_id) => !!state.runtime.document.groups[group_id]);
  const preserved = preserve_existing
    ? new Map(state.group_plane_registry.group_id_to_plane)
    : new Map<string, number>();
  const next_group_id_to_plane = new Map<string, number>();
  const used_planes = new Set<number>();
  for (const group_id of discovered_ids) {
    const priorPlane = preserved.get(group_id);
    if (typeof priorPlane === 'number' && !used_planes.has(priorPlane)) {
      next_group_id_to_plane.set(group_id, priorPlane);
      used_planes.add(priorPlane);
    }
  }
  let nextPlane = used_planes.size > 0 ? Math.max(...Array.from(used_planes)) + 1 : 0;
  for (const group_id of discovered_ids) {
    if (next_group_id_to_plane.has(group_id)) continue;
    while (used_planes.has(nextPlane)) nextPlane += 1;
    next_group_id_to_plane.set(group_id, nextPlane);
    used_planes.add(nextPlane);
    nextPlane += 1;
  }
  return {
    group_id_to_plane: next_group_id_to_plane,
    plane_to_group_id: new Map(Array.from(next_group_id_to_plane.entries(), ([group_id, plane]) => [plane, group_id])),
  };
}

function make_history_cell_from_runtime_record(record: { char: string; rgb: { r: number; g: number; b: number }; weight_index: number } | null | undefined): { char: string; rgb: { r: number; g: number; b: number }; weight_index: number } {
  if (!record) return { char: ' ', rgb: { r: 0, g: 0, b: 0 }, weight_index: 0 };
  return {
    char: record.char,
    rgb: { ...record.rgb },
    weight_index: record.weight_index,
  };
}

export type PainterSessionCore = {
  get_state: () => PainterSessionState;
  replace_document: (document: PainterDocument, meta?: PainterReplaceDocumentMeta) => void;
  set_lineage: (lineage_id: string | null, authoritative_revision?: number) => void;
  refresh_derived_state: (options?: { preserve_existing_group_planes?: boolean }) => void;
  apply_group_command: (command: PainterSessionGroupCommand) => { created_group_id?: string | null };
  apply_cell_changes: (group_id: string, changes: PainterSessionCellChangeInput[]) => { applied: boolean; history_changes: PainterSessionCellHistoryChange[] };
  apply_authoritative_snapshot: (document: PainterDocument, meta: PainterAuthoritativeSnapshotMeta) => { applied: boolean; reason?: string };
  get_group_id_for_plane: (plane: number) => string | null;
  get_plane_for_group_id: (group_id: string | null | undefined) => number | null;
  get_group_planes: () => number[];
  get_nearest_group_plane: (plane: number) => number | null;
};

export function create_painter_session_core(initial_document: PainterDocument): PainterSessionCore {
  let state: PainterSessionState = {
    runtime: normalize_painter_document_runtime(initial_document),
    lineage_id: null,
    authoritative_revision: 0,
    group_plane_registry: {
      group_id_to_plane: new Map<string, number>(),
      plane_to_group_id: new Map<number, string>(),
    },
  };
  state.group_plane_registry = build_group_plane_registry(state, false);

  function get_state(): PainterSessionState {
    return {
      runtime: state.runtime,
      lineage_id: state.lineage_id,
      authoritative_revision: state.authoritative_revision,
      group_plane_registry: clone_group_plane_registry(state.group_plane_registry),
    };
  }

  function replace_document(document: PainterDocument, meta?: PainterReplaceDocumentMeta): void {
    state = {
      runtime: normalize_painter_document_runtime(document),
      lineage_id: meta?.lineage_id ?? state.lineage_id,
      authoritative_revision: meta?.authoritative_revision ?? state.authoritative_revision,
      group_plane_registry: state.group_plane_registry,
    };
    state.group_plane_registry = build_group_plane_registry(state, true);
  }

  function set_lineage(lineage_id: string | null, authoritative_revision: number = 0): void {
    state.lineage_id = lineage_id;
    state.authoritative_revision = authoritative_revision;
  }

  function refresh_derived_state(options?: { preserve_existing_group_planes?: boolean }): void {
    state.group_plane_registry = build_group_plane_registry(state, options?.preserve_existing_group_planes ?? true);
  }

  function apply_group_command(command: PainterSessionGroupCommand): { created_group_id?: string | null } {
    switch (command.kind) {
      case 'create_group': {
        const created = add_painter_group(state.runtime, command.group);
        refresh_derived_state({ preserve_existing_group_planes: true });
        return { created_group_id: created.id };
      }
      case 'delete_group': {
        remove_painter_group(state.runtime, command.group_id);
        refresh_derived_state({ preserve_existing_group_planes: true });
        return {};
      }
      case 'duplicate_group': {
        const duplicated = duplicate_painter_group(state.runtime, command.source_group_id);
        refresh_derived_state({ preserve_existing_group_planes: true });
        return { created_group_id: duplicated.id };
      }
      case 'rename_group': {
        rename_painter_group(state.runtime, command.group_id, command.group_name);
        return {};
      }
      case 'set_group_visibility': {
        set_painter_group_visibility(state.runtime, command.group_id, command.visible);
        return {};
      }
      case 'set_group_locked': {
        set_painter_group_locked(state.runtime, command.group_id, command.locked);
        return {};
      }
      case 'reorder_groups': {
        reorder_painter_groups(state.runtime, command.next_group_order);
        refresh_derived_state({ preserve_existing_group_planes: true });
        return {};
      }
    }
  }

  function apply_cell_changes(group_id: string, changes: PainterSessionCellChangeInput[]): { applied: boolean; history_changes: PainterSessionCellHistoryChange[] } {
    const group = state.runtime.document.groups[group_id];
    if (!group || group.locked) return { applied: false, history_changes: [] };
    const history_changes: PainterSessionCellHistoryChange[] = [];
    for (const change of changes) {
      const nextChar = String(change.newCell.char ?? ' ').slice(0, 1) || ' ';
      const coordKey = `${Math.floor(change.worldX)}:${Math.floor(change.worldY)}:${Math.floor(change.worldZ)}`;
      const prior = state.runtime.group_voxel_index.get(group_id)?.get(coordKey) ?? null;
      const oldCell = make_history_cell_from_runtime_record(prior);
      const nextCell = make_history_cell_from_runtime_record({
        char: nextChar,
        rgb: { ...change.newCell.rgb },
        weight_index: change.newCell.weight_index,
      });
      if (nextChar === ' ') {
        erase_group_voxel(state.runtime, group_id, coordKey);
      } else {
        set_group_voxel(state.runtime, group_id, create_painter_voxel_record({
          x: change.worldX,
          y: change.worldY,
          z: change.worldZ,
          char: nextChar,
          rgb: { ...change.newCell.rgb },
          weight_index: change.newCell.weight_index,
        }));
      }
      history_changes.push({
        x: change.worldX,
        y: change.worldY,
        worldX: change.worldX,
        worldY: change.worldY,
        worldZ: change.worldZ,
        group_id,
        oldCell,
        newCell: nextCell,
      });
    }
    refresh_derived_state({ preserve_existing_group_planes: true });
    return { applied: true, history_changes };
  }

  function apply_authoritative_snapshot(document: PainterDocument, meta: PainterAuthoritativeSnapshotMeta): { applied: boolean; reason?: string } {
    const lineage_id = `authoritative:${String(meta.document_id ?? '').trim() || 'default_canvas'}`;
    if (state.lineage_id && state.lineage_id !== lineage_id) {
      return { applied: false, reason: 'lineage_mismatch' };
    }
    replace_document(document, { lineage_id, authoritative_revision: meta.revision });
    return { applied: true };
  }

  function get_group_id_for_plane(plane: number): string | null {
    return state.group_plane_registry.plane_to_group_id.get(plane) ?? null;
  }

  function get_plane_for_group_id(group_id: string | null | undefined): number | null {
    if (!group_id) return null;
    return state.group_plane_registry.group_id_to_plane.get(group_id) ?? null;
  }

  function get_group_planes(): number[] {
    return Array.from(state.group_plane_registry.plane_to_group_id.keys()).sort((a, b) => a - b);
  }

  function get_nearest_group_plane(plane: number): number | null {
    const planes = get_group_planes();
    if (planes.length < 1) return null;
    return planes.reduce((best, candidate) => (
      Math.abs(candidate - plane) < Math.abs(best - plane) ? candidate : best
    ), planes[0]!);
  }

  return {
    get_state,
    replace_document,
    set_lineage,
    refresh_derived_state,
    apply_group_command,
    apply_cell_changes,
    apply_authoritative_snapshot,
    get_group_id_for_plane,
    get_plane_for_group_id,
    get_group_planes,
    get_nearest_group_plane,
  };
}
