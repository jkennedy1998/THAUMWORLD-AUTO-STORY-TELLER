import {
  build_api_url,
  build_multiplayer_transport_config,
  build_remote_relay_transport_config,
  type MultiplayerTransportConfig,
} from '../shared/multiplayer_transport.js';
import { build_remote_relay_transport_from_resolved, resolve_remote_relay_join_code } from '../shared/remote_control_client.js';
import { make_request_id } from '../shared/request_id.js';
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

async function fetch_json(url: string, options?: { request_id?: string | null }): Promise<any | null> {
  try {
    const started_at_ms = Date.now();
    log_probe('http_request_started', { url, started_at_ms, request_id: options?.request_id ?? null });
    const res = await fetch(url, {
      headers: options?.request_id ? { 'x-join-request-id': options.request_id } : undefined,
    });
    const latency_ms = Date.now() - started_at_ms;
    if (!res.ok) {
      log_probe('http_request_failed', { url, status: res.status, latency_ms, request_id: options?.request_id ?? null });
      return null;
    }
    const data = await res.json();
    log_probe('http_request_succeeded', { url, status: res.status, latency_ms, ok: Boolean(data?.ok), request_id: options?.request_id ?? null });
    return data;
  } catch (error) {
    log_probe('http_request_error', { url, message: error instanceof Error ? error.message : String(error), request_id: options?.request_id ?? null });
    return null;
  }
}

export function resolve_connection_transport(connection: EngineConnectionEntry, slot: number): MultiplayerTransportConfig {
  if (connection.transport?.transport_kind === 'relay_ws_tunnel') {
    return build_remote_relay_transport_config({
      relay_https_origin: String(connection.transport.relay_https_origin ?? connection.metadata?.remote_session?.relay_origin ?? '').trim() || 'https://invalid-relay.local',
      relay_wss_origin: connection.transport.relay_wss_origin,
      room_id: connection.transport.room_id,
      join_code: connection.transport.join_code ?? connection.metadata?.remote_session?.join_code ?? connection.host,
      attach_token: connection.transport.attach_token,
      api_base_url: connection.transport.api_base_url,
      bridge_ws_base_url: connection.transport.bridge_ws_base_url,
      host_input: connection.host,
    });
  }
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
  const request_id = make_request_id('host_status');
  log_probe('host_status_started', {
    slot,
    host_input: transport.host_input,
    api_base_url: transport.api_base_url,
    bridge_ws_base_url: transport.bridge_ws_base_url,
    url,
    request_id,
  });
  const started_at_ms = Date.now();
  const data = await fetch_json(url, { request_id });
  const latency_ms = Date.now() - started_at_ms;
  if (!data?.ok) {
    log_probe('host_status_unavailable', {
      slot,
      host_input: transport.host_input,
      api_base_url: transport.api_base_url,
      url,
      latency_ms,
      request_id,
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
    request_id,
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
    connection_method: connection.method ?? (connection.kind === 'remote_join_code' ? 'remote_relay' : connection.kind === 'local' ? 'local' : 'direct'),
    connection_host: connection.host,
    transport_kind: transport.transport_kind,
    api_base_url: transport.api_base_url,
    bridge_ws_base_url: transport.bridge_ws_base_url,
  });
  if (transport.transport_kind === 'relay_ws_tunnel') {
    const join_code = String(transport.join_code ?? connection.metadata?.remote_session?.join_code ?? connection.host ?? '').trim();
    const relay_origin = String(transport.relay_https_origin ?? connection.metadata?.remote_session?.relay_origin ?? '').trim();
    const resolved = relay_origin && join_code
      ? await resolve_remote_relay_join_code(relay_origin, { join_code, slot, app_kind: connection.metadata?.remote_session?.app_kind ?? 'unknown' })
      : { ok: false, error: 'remote_join_code_missing' };
    if (!resolved.ok || !resolved.room?.room_id || !resolved.attach_token || !resolved.relay_https_origin) {
      log_probe('probe_completed', {
        slot,
        method: 'remote_relay',
        connection_id: connection.id,
        connection_kind: connection.kind,
        connection_host: connection.host,
        status: 'offline',
        reason: resolved.error ?? 'remote_join_resolution_failed',
        relay_https_origin: relay_origin || null,
        join_code: join_code || null,
        checked_at_ms,
      });
      return {
        connection_id: connection.id,
        status: 'offline',
        status_message: String(resolved.error ?? 'remote join code unavailable'),
        join_mode: 'remote_relay_unavailable',
        checked_at_ms,
      };
    }
    const resolvedTransport = build_remote_relay_transport_from_resolved({
      relay_origin: resolved.relay_https_origin,
      relay_wss_origin: resolved.relay_wss_origin,
      room_id: resolved.room.room_id,
      attach_token: resolved.attach_token,
      join_code,
    });
    const status = resolved.host_online === false ? 'offline' : 'online';
    log_probe('probe_completed', {
      slot,
      method: 'remote_relay',
      connection_id: connection.id,
      connection_kind: connection.kind,
      connection_host: connection.host,
      status,
      supports_join: status === 'online',
      join_mode: status === 'online' ? 'remote_relay_attach_ready' : 'remote_relay_host_offline',
      room_id: resolved.room.room_id,
      relay_https_origin: resolved.relay_https_origin,
      join_code,
      app_kind: resolved.room.app_kind,
      checked_at_ms,
    });
    return {
      connection_id: connection.id,
      status,
      status_message: status === 'online' ? 'remote relay ready' : 'remote host offline',
      supports_join: status === 'online',
      host_mode: 'remote_relay_host',
      join_mode: status === 'online' ? 'remote_relay_attach_ready' : 'remote_relay_host_offline',
      world_label: typeof resolved.room.world_label === 'string' ? resolved.room.world_label : null,
      relay_https_origin: resolved.relay_https_origin,
      relay_wss_origin: resolved.relay_wss_origin ?? undefined,
      room_id: resolved.room.room_id,
      join_code,
      attach_token: resolved.attach_token,
      api_base_url: resolvedTransport.api_base_url,
      bridge_ws_base_url: resolvedTransport.bridge_ws_base_url,
      checked_at_ms,
    };
  }
  const status = await fetch_host_status(slot, transport);
  if (!status) {
    log_probe('probe_completed', {
      slot,
      method: transport.transport_kind,
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
    method: transport.transport_kind,
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
