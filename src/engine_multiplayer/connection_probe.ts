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

function log_probe(event: string, payload: Record<string, unknown>): void {
  console.log('[JOIN_PROBE]', JSON.stringify({ event, ...payload }));
}

async function fetch_json(url: string): Promise<any | null> {
  try {
    const started_at_ms = Date.now();
    log_probe('http_request_started', { url, started_at_ms });
    const res = await fetch(url);
    const latency_ms = Date.now() - started_at_ms;
    if (!res.ok) {
      log_probe('http_request_failed', { url, status: res.status, latency_ms });
      return null;
    }
    const data = await res.json();
    log_probe('http_request_succeeded', { url, status: res.status, latency_ms, ok: Boolean(data?.ok) });
    return data;
  } catch (error) {
    log_probe('http_request_error', { url, message: error instanceof Error ? error.message : String(error) });
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
  const url = `${build_api_url(transport.api_base_url, '/host/status')}?slot=${encodeURIComponent(String(slot))}`;
  log_probe('host_status_started', {
    slot,
    host_input: transport.host_input,
    api_base_url: transport.api_base_url,
    bridge_ws_base_url: transport.bridge_ws_base_url,
    url,
  });
  const started_at_ms = Date.now();
  const data = await fetch_json(url);
  const latency_ms = Date.now() - started_at_ms;
  if (!data?.ok) {
    log_probe('host_status_unavailable', {
      slot,
      host_input: transport.host_input,
      api_base_url: transport.api_base_url,
      url,
      latency_ms,
    });
    return null;
  }
  log_probe('host_status_succeeded', {
    slot,
    host_input: transport.host_input,
    api_base_url: transport.api_base_url,
    url,
    latency_ms,
    supports_join: Boolean(data?.supports_join),
    join_mode: data?.join_mode ?? null,
    host_mode: data?.host_mode ?? null,
    painter_document_id: data?.painter_document_id ?? null,
  });
  return data as HostStatus;
}

export async function probe_connection(connection: EngineConnectionEntry, slot: number): Promise<EngineConnectionProbeResult> {
  const transport = resolve_connection_transport(connection, slot);
  const checked_at_ms = Date.now();
  log_probe('probe_started', {
    slot,
    connection_id: connection.id,
    connection_kind: connection.kind,
    connection_host: connection.host,
    api_base_url: transport.api_base_url,
    bridge_ws_base_url: transport.bridge_ws_base_url,
  });
  const status = await fetch_host_status(slot, transport);
  if (!status) {
    log_probe('probe_completed', {
      slot,
      connection_id: connection.id,
      connection_kind: connection.kind,
      connection_host: connection.host,
      status: 'offline',
      checked_at_ms,
    });
    return {
      connection_id: connection.id,
      status: 'offline',
      status_message: connection.kind === 'local' ? 'local host offline' : `${connection.host} offline`,
      checked_at_ms,
    };
  }
  log_probe('probe_completed', {
    slot,
    connection_id: connection.id,
    connection_kind: connection.kind,
    connection_host: connection.host,
    status: 'online',
    supports_join: Boolean(status.supports_join),
    host_mode: status.host_mode,
    join_mode: status.join_mode,
    painter_document_id: status.painter_document_id ?? null,
    checked_at_ms,
  });
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
