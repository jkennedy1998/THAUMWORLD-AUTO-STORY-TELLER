import type { PainterDocument, PainterPropertyKind, PainterPropertyValue, PainterVoxelRecord } from '../ascii_painter/painter_document.js';

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
  selection_channels?: PainterSelectionChannelSnapshot[];
};

export type PainterSelectionChannelSnapshot = {
  connection_id: string;
  color_rgb: { r: number; g: number; b: number };
  cells: Array<{ x: number; y: number; z: number }>;
  updated_at_ms: number;
};

export type PainterCommandResultMetadata = {
  base_revision?: number | null;
  server_revision_before?: number | null;
  server_revision_after?: number | null;
  applied_from_stale_base?: boolean;
  command_id?: string | null;
};

export type PainterApplyGroupVoxelsCommand = {
  kind: 'apply_group_voxels';
  document_id: string;
  group_id: string;
  base_revision: number;
  command_id: string;
  breath: number;
  auto_key?: boolean;
  voxels: PainterVoxelRecord[];
};

export type PainterGroupCommand = {
  kind:
    | 'set_document_timing'
    | 'set_document_loop_window'
    | 'create_group'
    | 'offset_group_in_time'
    | 'set_group_timing'
    | 'set_group_breath_span'
    | 'set_group_property_block_length'
    | 'split_group_property_block'
    | 'swap_group_property_blocks'
    | 'delete_group'
    | 'duplicate_group'
    | 'rename_group'
    | 'set_group_visibility'
    | 'set_group_locked'
    | 'set_group_property_block'
    | 'blank_group_property_block'
    | 'trim_group_property_block_edge'
    | 'merge_group_blank_property_block'
    | 'compact_group_blank_property_block_left'
    | 'move_group_property_block'
    | 'set_group_property_block_edge_destructive'
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
  delta_breaths?: number;
  breath_range_start?: number;
  breath_range_end?: number;
  frames_per_breath?: number;
  loop_enabled?: boolean;
  breath_start?: number;
  breath_end?: number;
  start?: number;
  cropped_start?: number;
  cropped_end?: number;
  property_id?: string;
  property_kind?: PainterPropertyKind;
  property_label?: string;
  block_id?: string;
  source_block_id?: string;
  target_block_id?: string;
  split_breath?: number;
  length_breaths?: number;
  next_group_order?: string[];
  value?: PainterPropertyValue;
  target_breath?: number;
  edge?: 'start' | 'end';
  direction?: 'left' | 'right';
};

export type PainterGroupRasterStateCommand = {
  kind: 'set_group_raster_state';
  document_id: string;
  base_revision: number;
  command_id: string;
  group_id: string;
  breath: number;
  voxels: PainterVoxelRecord[];
};

export type PainterCommand =
  | PainterApplyGroupVoxelsCommand
  | PainterGroupCommand
  | PainterGroupRasterStateCommand;

export type PainterDocumentEvent = {
  type:
    | 'PAINTER_DOCUMENT_BOOTSTRAPPED'
    | 'PAINTER_DOCUMENT_PATCHED'
    | 'PAINTER_DOCUMENT_REPLACED'
    | 'PAINTER_SELECTION_UPDATED'
    | 'PAINTER_LAYER_CHANGED'
    | 'PAINTER_COMMAND_REJECTED'
    | 'PAINTER_REVISION_CONFLICT';
  document_id: string;
  revision: number;
  group_id?: string | null;
  command_kind?: string | null;
  payload?: Record<string, unknown> & PainterCommandResultMetadata;
};
