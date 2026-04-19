import type { VoxelSpaceExport } from '../ascii_painter/voxel_space.js';

export type PainterDocumentAuthorityMode = 'local_compat' | 'authoritative_host';

export type PainterSessionLifecycle = 'idle' | 'connecting' | 'multiplayer_ready' | 'local_only' | 'error';

export type PainterDocumentBootstrap = {
  document_id: string;
  authority_mode: PainterDocumentAuthorityMode;
  slot: number;
  revision: number;
  snapshot: VoxelSpaceExport | null;
  session_token: string | null;
  connection_id: string | null;
  reconnect_token: string | null;
  host_boot_id?: string | null;
  join_mode?: string | null;
  supports_join?: boolean;
  error?: string | null;
};

export type PainterApplyCellsCommand = {
  kind: 'apply_cells';
  document_id: string;
  base_revision: number;
  command_id: string;
  cells: Array<{
    x: number;
    y: number;
    z: number;
    char: string;
    rgb: { r: number; g: number; b: number };
    weight_index: number;
    render_index?: number;
  }>;
};

export type PainterLayerCommand = {
  kind: 'add_layer' | 'delete_layer' | 'duplicate_layer' | 'toggle_layer_visibility' | 'toggle_layer_lock' | 'rename_layer';
  document_id: string;
  base_revision: number;
  command_id: string;
  z?: number;
  next_z?: number;
  visible?: boolean;
  locked?: boolean;
  name?: string;
};

export type PainterCommand = PainterApplyCellsCommand | PainterLayerCommand;

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
  payload?: Record<string, unknown>;
};
