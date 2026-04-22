import type { PainterDocument, PainterVoxelRecord } from '../ascii_painter/painter_document.js';

export type PainterDocumentAuthorityMode = 'local_compat' | 'authoritative_host';

export type PainterSessionLifecycle = 'idle' | 'connecting' | 'multiplayer_ready' | 'local_only' | 'error';

export type PainterDocumentBootstrap = {
  document_id: string;
  authority_mode: PainterDocumentAuthorityMode;
  slot: number;
  revision: number;
  snapshot: PainterDocument | null;
  session_token: string | null;
  connection_id: string | null;
  reconnect_token: string | null;
  host_boot_id?: string | null;
  join_mode?: string | null;
  supports_join?: boolean;
  error?: string | null;
};

export type PainterApplyGroupVoxelsCommand = {
  kind: 'apply_group_voxels';
  document_id: string;
  group_id: string;
  base_revision: number;
  command_id: string;
  voxels: PainterVoxelRecord[];
};

export type PainterGroupCommand = {
  kind:
    | 'create_group'
    | 'delete_group'
    | 'duplicate_group'
    | 'rename_group'
    | 'set_group_visibility'
    | 'set_group_locked'
    | 'reorder_groups'
    | 'reset_document'
    | 'undo_group'
    | 'redo_group';
  document_id: string;
  base_revision: number;
  command_id: string;
  group_id?: string;
  source_group_id?: string;
  target_group_id?: string;
  group_name?: string;
  visible?: boolean;
  locked?: boolean;
  next_group_order?: string[];
};

export type PainterCommand = PainterApplyGroupVoxelsCommand | PainterGroupCommand;

export type PainterDocumentEvent = {
  type:
    | 'PAINTER_DOCUMENT_BOOTSTRAPPED'
    | 'PAINTER_DOCUMENT_PATCHED'
    | 'PAINTER_DOCUMENT_REPLACED'
    | 'PAINTER_LAYER_CHANGED'
    | 'PAINTER_COMMAND_REJECTED'
    | 'PAINTER_REVISION_CONFLICT';
  document_id: string;
  revision: number;
  group_id?: string | null;
  command_kind?: string | null;
  payload?: Record<string, unknown>;
};
