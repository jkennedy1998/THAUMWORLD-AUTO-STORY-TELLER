import type { PainterDocument, PainterGroup } from './painter_document.js';
import type { PainterDocumentRuntime } from './painter_document_runtime.js';

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
  | { kind: 'create_group'; group: PainterGroup }
  | { kind: 'delete_group'; group_id: string }
  | { kind: 'duplicate_group'; source_group_id: string }
  | { kind: 'rename_group'; group_id: string; group_name: string }
  | { kind: 'set_group_visibility'; group_id: string; visible: boolean }
  | { kind: 'set_group_locked'; group_id: string; locked: boolean }
  | { kind: 'reorder_groups'; next_group_order: string[] };

export type PainterSessionCellChangeInput = {
  worldX: number;
  worldY: number;
  worldZ: number;
  newCell: { char: string; rgb: { r: number; g: number; b: number }; weight_index: number };
};

export type PainterSessionCellHistoryChange = {
  x: number;
  y: number;
  worldX: number;
  worldY: number;
  worldZ: number;
  group_id: string;
  oldCell: { char: string; rgb: { r: number; g: number; b: number }; weight_index: number };
  newCell: { char: string; rgb: { r: number; g: number; b: number }; weight_index: number };
};

export type PainterAuthoritativeSnapshotMeta = {
  document_id: string;
  revision: number;
};

export type PainterReplaceDocumentMeta = {
  lineage_id?: string | null;
  authoritative_revision?: number;
};
