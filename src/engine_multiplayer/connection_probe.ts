import { build_api_url, build_multiplayer_transport_config, type MultiplayerTransportConfig } from '../shared/multiplayer_transport.js';
import type { EngineConnectionEntry, EngineConnectionProbeResult } from './connection_types.js';

export type HostStatus = {
  ok: true;
  slot: number;
  host_boot_id: string;
  world_label: string;
  host_mode: string;
  join_mode: string;
  supports_join: boolean;
  painter_joinable?: boolean;
  painter_document_id?: string | null;
  painter_display_name?: string | null;
  painter_file_backed?: boolean;
  services: string[];
};

async function fetch_json(url: string): Promise<any | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export function resolve_connection_transport(connection: EngineConnectionEntry, slot: number): MultiplayerTransportConfig {
  if (connection.kind === 'local' || connection.host === 'local') {
    return build_multiplayer_transport_config({ host: 'localhost' });
  }
  if (connection.transport?.api_base_url || connection.transport?.bridge_ws_base_url) {
    return build_multiplayer_transport_config({
      host: connection.host,
      api_base_url: connection.transport.api_base_url,
      bridge_ws_base_url: connection.transport.bridge_ws_base_url,
    });
  }
  return build_multiplayer_transport_config({ host: connection.host });
}

export async function fetch_host_status(slot: number, transport: MultiplayerTransportConfig): Promise<HostStatus | null> {
  const data = await fetch_json(`${build_api_url(transport.api_base_url, '/host/status')}?slot=${encodeURIComponent(String(slot))}`);
  if (!data?.ok) return null;
  return data as HostStatus;
}

export async function probe_connection(connection: EngineConnectionEntry, slot: number): Promise<EngineConnectionProbeResult> {
  const transport = resolve_connection_transport(connection, slot);
  const checked_at_ms = Date.now();
  const status = await fetch_host_status(slot, transport);
  if (!status) {
    return {
      connection_id: connection.id,
      status: 'offline',
      status_message: connection.kind === 'local' ? 'local host offline' : `${connection.host} offline`,
      checked_at_ms,
    };
  }
  return {
    connection_id: connection.id,
    status: 'online',
    status_message: `${String(status.join_mode ?? 'join enabled')}`,
    supports_join: Boolean(status.supports_join),
    host_mode: String(status.host_mode ?? 'host'),
    join_mode: String(status.join_mode ?? 'join enabled'),
    world_label: typeof status.world_label === 'string' ? status.world_label : null,
    painter_document_id: typeof status.painter_document_id === 'string' ? status.painter_document_id : null,
    painter_display_name: typeof status.painter_display_name === 'string' ? status.painter_display_name : null,
    painter_file_backed: Boolean(status.painter_file_backed),
    checked_at_ms,
  };
}

export async function probe_connections(connections: readonly EngineConnectionEntry[], slot: number): Promise<Record<string, EngineConnectionProbeResult>> {
  const results = await Promise.all(connections.map(async (connection) => {
    const probe = await probe_connection(connection, slot);
    return [connection.id, probe] as const;
  }));
  return Object.fromEntries(results);
}
