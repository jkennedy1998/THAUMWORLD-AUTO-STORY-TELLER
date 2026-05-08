import type { PainterDocument, PainterGroup, PainterPropertyKind, PainterPropertyValue, PainterVoxelRecord } from './painter_document.js';
import type { PainterDocumentRuntime } from './painter_document_runtime.js';
import type { GridCell } from './types.js';

export type PainterGroupPlaneRegistry = {
  group_id_to_plane: Map<string, number>;
  plane_to_group_id: Map<number, string>;
};

export type PainterSessionState = {
  runtime: PainterDocumentRuntime;
  lineage_id: string | null;
  authoritative_revision: number;
  group_plane_registry: PainterGroupPlaneRegistry;
};

export type PainterSessionGroupCommand =
  | { kind: 'set_document_timing'; breath_range_start: number; breath_range_end: number; frames_per_breath: number; loop_enabled: boolean }
  | { kind: 'set_document_loop_window'; breath_start: number; breath_end: number }
  | { kind: 'create_group'; group: PainterGroup }
  | { kind: 'offset_group_in_time'; group_id: string; delta_breaths: number }
  | { kind: 'set_group_timing'; group_id: string; start: number; cropped_start: number; cropped_end: number }
  | { kind: 'set_group_breath_span'; group_id: string; breath_start: number; breath_end: number }
  | { kind: 'set_group_property_block_length'; group_id: string; property_id: string; block_id: string; length_breaths: number }
  | { kind: 'split_group_property_block'; group_id: string; property_id: string; block_id: string; split_breath: number }
  | { kind: 'swap_group_property_blocks'; group_id: string; property_id: string; source_block_id: string; target_block_id: string }
  | { kind: 'blank_group_property_block'; group_id: string; property_id: string; block_id: string }
  | { kind: 'trim_group_property_block_edge'; group_id: string; property_id: string; block_id: string; edge: 'start' | 'end' }
  | { kind: 'merge_group_blank_property_block'; group_id: string; property_id: string; block_id: string; direction: 'left' | 'right' }
  | { kind: 'compact_group_blank_property_block_left'; group_id: string; property_id: string; block_id: string }
  | { kind: 'set_group_property_block_edge_destructive'; group_id: string; property_id: string; block_id: string; edge: 'start' | 'end'; target_breath: number }
  | { kind: 'delete_group'; group_id: string }
  | { kind: 'duplicate_group'; source_group_id: string }
  | { kind: 'rename_group'; group_id: string; group_name: string }
  | { kind: 'set_group_visibility'; group_id: string; visible: boolean }
  | { kind: 'set_group_locked'; group_id: string; locked: boolean }
  | { kind: 'set_group_raster_state'; group_id: string; breath: number; voxels: PainterVoxelRecord[] }
  | { kind: 'add_group_property'; group_id: string; property_kind: Extract<PainterPropertyKind, 'raster' | 'move'>; after_property_id?: string | null; property_label?: string }
  | { kind: 'remove_group_property'; group_id: string; property_id: string }
  | { kind: 'reorder_group_properties'; group_id: string; next_property_order: string[] }
  | { kind: 'set_group_property_block'; group_id: string; property_kind: Extract<PainterPropertyKind, 'move' | 'rotation'>; property_id?: string | null; property_label?: string; breath: number; value: PainterPropertyValue }
  | { kind: 'move_group_property_block'; group_id: string; property_id: string; block_id: string; target_breath: number }
  | { kind: 'reorder_groups'; next_group_order: string[] };

export type PainterSessionCellChangeInput = {
  worldX: number;
  worldY: number;
  worldZ: number;
  newCell: GridCell;
};

export type PainterSessionCellHistoryChange = {
  x: number;
  y: number;
  worldX: number;
  worldY: number;
  worldZ: number;
  group_id: string;
  oldCell: GridCell;
  newCell: GridCell;
};

export type PainterAuthoritativeSnapshotMeta = {
  document_id: string;
  revision: number;
};

export type PainterReplaceDocumentMeta = {
  lineage_id?: string | null;
  authoritative_revision?: number;
};
