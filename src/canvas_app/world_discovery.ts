import { DEFAULT_LOCAL_MULTIPLAYER_TRANSPORT, type MultiplayerTransportConfig } from '../shared/multiplayer_transport.js';
import { build_join_directory } from '../engine_multiplayer/join_directory.js';
import { fetch_host_status as fetch_engine_host_status, resolve_connection_transport, type HostStatus } from '../engine_multiplayer/connection_probe.js';
import type { EngineConnectionEntry, EngineConnectionProbeResult } from '../engine_multiplayer/connection_types.js';

export type { HostStatus };

export type JoinableWorldEntry = {
  id: string;
  label: string;
  api_base_url: string;
  bridge_ws_base_url: string;
  host_origin: string;
  supports_join: boolean;
  online: boolean;
  source_kind: 'local' | 'saved_remote';
  saved_host_id?: string;
  host_address?: string;
  last_connected_at?: string;
  last_seen_online_at?: string;
  description?: string;
  local?: boolean;
  host_mode?: string;
  join_mode?: string;
  painter_document_id?: string | null;
  painter_display_name?: string | null;
  painter_file_backed?: boolean;
  services?: string[];
};

function format_relative_timestamp(raw: number | undefined): string {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 'unknown';
  const elapsedMs = Math.max(0, Date.now() - raw);
  const elapsedMinutes = Math.floor(elapsedMs / 60000);
  if (elapsedMinutes < 1) return 'just now';
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) return `${elapsedDays}d ago`;
  return new Date(raw).toLocaleDateString();
}

function build_world_entry(connection: EngineConnectionEntry, probe: EngineConnectionProbeResult | undefined, slot: number): JoinableWorldEntry {
  const transport = resolve_connection_transport(connection, connection.transport?.slot ?? slot);
  const online = probe?.status === 'online';
  const lastSeenMs = connection.history?.last_seen_online_at_ms;
  const lastConnectedMs = connection.history?.last_connected_at_ms;
  const isLocal = connection.kind === 'local';
  const description = online
    ? connection.kind === 'local'
      ? `local host ${String(probe?.host_mode ?? 'host')} - ${String(probe?.join_mode ?? 'join enabled')}`
      : `${connection.host} online - ${String(probe?.join_mode ?? 'join enabled')}${lastConnectedMs ? `, joined ${format_relative_timestamp(lastConnectedMs)}` : ''}`
    : isLocal
      ? 'local host offline'
      : `${connection.host} offline - ${lastSeenMs ? `last seen ${format_relative_timestamp(lastSeenMs)}` : 'never seen online'}${lastConnectedMs ? `, joined ${format_relative_timestamp(lastConnectedMs)}` : ', never joined'}`;
  return {
    id: connection.kind === 'saved_manual' ? `saved:${connection.id}` : connection.id,
    label: String(probe?.painter_display_name ?? probe?.world_label ?? connection.name),
    api_base_url: transport.api_base_url,
    bridge_ws_base_url: transport.bridge_ws_base_url,
    host_origin: transport.host_origin,
    supports_join: Boolean(probe?.supports_join),
    online,
    source_kind: isLocal ? 'local' : 'saved_remote',
    saved_host_id: connection.kind === 'saved_manual' ? connection.id : undefined,
    host_address: isLocal ? 'local' : connection.host,
    last_connected_at: typeof lastConnectedMs === 'number' ? new Date(lastConnectedMs).toISOString() : undefined,
    last_seen_online_at: typeof lastSeenMs === 'number' ? new Date(lastSeenMs).toISOString() : undefined,
    description,
    local: isLocal,
    host_mode: probe?.host_mode,
    join_mode: probe?.join_mode,
    painter_document_id: probe?.painter_document_id ?? null,
    painter_display_name: probe?.painter_display_name ?? null,
    painter_file_backed: Boolean(probe?.painter_file_backed),
    services: [],
  };
}

export async function fetch_host_status(slot: number, transport: MultiplayerTransportConfig = DEFAULT_LOCAL_MULTIPLAYER_TRANSPORT): Promise<HostStatus | null> {
  return fetch_engine_host_status(slot, transport);
}

export async function fetch_local_host_status(slot: number): Promise<HostStatus | null> {
  return fetch_engine_host_status(slot, DEFAULT_LOCAL_MULTIPLAYER_TRANSPORT);
}

export async function discover_local_joinable_worlds(slot: number): Promise<JoinableWorldEntry[]> {
  const directory = await build_join_directory(slot);
  return directory.connections
    .filter((connection) => connection.kind === 'local')
    .map((connection) => build_world_entry(connection, directory.probes_by_connection_id[connection.id], slot));
}

export async function discover_manual_joinable_worlds(slot: number): Promise<JoinableWorldEntry[]> {
  const directory = await build_join_directory(slot);
  return directory.connections
    .filter((connection) => connection.kind === 'saved_manual')
    .map((connection) => build_world_entry(connection, directory.probes_by_connection_id[connection.id], slot));
}

export async function discover_joinable_worlds(slot: number): Promise<JoinableWorldEntry[]> {
  const directory = await build_join_directory(slot);
  return directory.connections.map((connection) => build_world_entry(connection, directory.probes_by_connection_id[connection.id], slot));
}
