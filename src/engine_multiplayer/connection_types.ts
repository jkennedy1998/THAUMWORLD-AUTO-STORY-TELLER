export type EngineConnectionKind = 'local' | 'lan_discovered' | 'saved_manual' | 'remote_join_code';

export type { EngineContentRef, EngineContentRefKind } from './content_refs.js';

export type EngineConnectionMethod = 'local' | 'direct' | 'remote_relay';

export type EngineConnectionScope = 'local_machine' | 'lan' | 'wifi' | 'internet';

export type EngineConnectionTransport = {
  transport_kind?: 'direct_http_ws' | 'relay_ws_tunnel';
  api_base_url?: string;
  bridge_ws_base_url?: string;
  relay_https_origin?: string;
  relay_wss_origin?: string;
  room_id?: string;
  join_code?: string;
  attach_token?: string;
  slot?: number;
};

export type EngineConnectionHistory = {
  created_at_ms?: number;
  updated_at_ms?: number;
  last_connected_at_ms?: number;
  last_seen_online_at_ms?: number;
};

export type EngineRemoteSessionMetadata = {
  room_id?: string;
  session_id?: string;
  join_code?: string;
  relay_origin?: string;
  visibility?: 'private' | 'shared' | 'public';
  app_kind?: 'thaumworld' | 'ascii_painter' | 'unknown';
};

export type EngineConnectionEntry = {
  id: string;
  name: string;
  host: string;
  kind: EngineConnectionKind;
  method?: EngineConnectionMethod;
  scope: EngineConnectionScope;
  transport?: EngineConnectionTransport;
  history?: EngineConnectionHistory;
  metadata?: {
    source_label?: string;
    remote_session?: EngineRemoteSessionMetadata;
  };
};

export type EngineConnectionProbeStatus = 'checking' | 'online' | 'offline' | 'error';

export type EngineConnectionProbeResult = {
  connection_id: string;
  status: EngineConnectionProbeStatus;
  status_message?: string;
  supports_join?: boolean;
  host_mode?: string;
  join_mode?: string;
  world_label?: string | null;
  painter_document_id?: string | null;
  painter_display_name?: string | null;
  painter_file_backed?: boolean;
  relay_https_origin?: string;
  relay_wss_origin?: string;
  room_id?: string;
  join_code?: string;
  attach_token?: string;
  api_base_url?: string;
  bridge_ws_base_url?: string;
  checked_at_ms: number;
};

export type EngineJoinSelection = {
  connection: EngineConnectionEntry;
  method: EngineConnectionMethod;
  probe: EngineConnectionProbeResult | null;
  transport: {
    transport_kind: 'direct_http_ws' | 'relay_ws_tunnel';
    api_base_url: string;
    bridge_ws_base_url: string;
    relay_https_origin?: string;
    relay_wss_origin?: string;
    room_id?: string;
    join_code?: string;
    attach_token?: string;
  };
};

export function is_connection_removable(kind: EngineConnectionKind): boolean {
  return kind === 'saved_manual' || kind === 'remote_join_code';
}

export function is_connection_name_editable(kind: EngineConnectionKind): boolean {
  return kind === 'saved_manual' || kind === 'remote_join_code';
}

export function is_connection_host_editable(kind: EngineConnectionKind): boolean {
  return kind === 'saved_manual';
}
