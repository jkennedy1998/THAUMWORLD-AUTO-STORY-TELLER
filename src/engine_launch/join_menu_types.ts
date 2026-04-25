import type { EngineConnectionEntry, EngineConnectionProbeResult } from '../engine_multiplayer/connection_types.js';

export type JoinMenuEditorMode = 'hidden' | 'add' | 'rename' | 'edit_host';

export type JoinMenuEditorState = {
  mode: JoinMenuEditorMode;
  connection_id: string | null;
  draft_name: string;
  draft_host: string;
  active_field: 'name' | 'host';
  error?: string | null;
};

export type JoinMenuState = {
  selected_connection_id: string | null;
  connections: readonly EngineConnectionEntry[];
  probes_by_connection_id: Record<string, EngineConnectionProbeResult>;
  status_lines: string[];
  is_refreshing: boolean;
  editor: JoinMenuEditorState;
};

export type TaiJoinRequest = {
  preferred_connection_id?: string | null;
  preferred_connection_kind?: 'local' | 'saved_manual' | 'lan_discovered' | null;
  preferred_host?: string | null;
  auto_join?: boolean;
};

export type TaiJoinResolution = {
  selected_connection_id: string | null;
  selected_connection_host?: string | null;
  selected_connection_kind?: EngineConnectionEntry['kind'] | null;
  probe_status?: EngineConnectionProbeResult['status'] | null;
  supports_join?: boolean;
  join_mode?: string | null;
  world_label?: string | null;
  painter_document_id?: string | null;
  api_base_url?: string | null;
  bridge_ws_base_url?: string | null;
  matched_by: 'id' | 'kind' | 'host' | 'default' | 'none';
  can_join: boolean;
  reason?: string;
};

export type TaiJoinSnapshot = {
  selected_connection_id: string | null;
  selected_connection_host: string | null;
  selected_connection_kind: EngineConnectionEntry['kind'] | null;
  probe_status: EngineConnectionProbeResult['status'] | null;
  supports_join: boolean;
  join_mode: string | null;
  world_label: string | null;
  painter_document_id: string | null;
  api_base_url: string | null;
  bridge_ws_base_url: string | null;
  status_lines: string[];
};
