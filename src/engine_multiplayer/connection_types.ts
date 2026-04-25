export type EngineConnectionKind = 'local' | 'lan_discovered' | 'saved_manual';

export type EngineConnectionScope = 'local_machine' | 'lan' | 'wifi' | 'internet';

export type EngineConnectionTransport = {
  api_base_url?: string;
  bridge_ws_base_url?: string;
  slot?: number;
};

export type EngineConnectionHistory = {
  created_at_ms?: number;
  updated_at_ms?: number;
  last_connected_at_ms?: number;
  last_seen_online_at_ms?: number;
};

export type EngineConnectionEntry = {
  id: string;
  name: string;
  host: string;
  kind: EngineConnectionKind;
  scope: EngineConnectionScope;
  transport?: EngineConnectionTransport;
  history?: EngineConnectionHistory;
  metadata?: {
    source_label?: string;
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
  checked_at_ms: number;
};

export type EngineJoinSelection = {
  connection: EngineConnectionEntry;
  probe: EngineConnectionProbeResult | null;
  transport: {
    api_base_url: string;
    bridge_ws_base_url: string;
  };
};

export function is_connection_removable(kind: EngineConnectionKind): boolean {
  return kind === 'saved_manual';
}

export function is_connection_name_editable(kind: EngineConnectionKind): boolean {
  return kind === 'saved_manual';
}

export function is_connection_host_editable(kind: EngineConnectionKind): boolean {
  return kind === 'saved_manual';
}
