import { list_engine_connections, mark_connection_seen_online } from './connection_store.js';
import { mark_remote_connection_seen_online } from './remote_connection_store.js';
import { probe_connections, resolve_connection_transport } from './connection_probe.js';
import type { EngineConnectionEntry, EngineConnectionProbeResult, EngineJoinSelection } from './connection_types.js';

export type EngineJoinDirectory = {
  connections: EngineConnectionEntry[];
  probes_by_connection_id: Record<string, EngineConnectionProbeResult>;
};

function connection_rank(connection: EngineConnectionEntry, probe: EngineConnectionProbeResult | undefined): number {
  const online = probe?.status === 'online';
  if (online && connection.kind === 'local') return 0;
  if (online && connection.kind === 'lan_discovered') return 1;
  if (online && connection.kind === 'saved_manual') return 2;
  if (online && connection.kind === 'remote_join_code') return 3;
  if (!online && connection.kind === 'remote_join_code') return 4;
  if (!online && connection.kind === 'saved_manual') return 5;
  if (!online && connection.kind === 'lan_discovered') return 6;
  return 7;
}

function sort_connections(connections: EngineConnectionEntry[], probes_by_connection_id: Record<string, EngineConnectionProbeResult>): EngineConnectionEntry[] {
  return [...connections].sort((a, b) => {
    const rank = connection_rank(a, probes_by_connection_id[a.id]) - connection_rank(b, probes_by_connection_id[b.id]);
    if (rank !== 0) return rank;
    const aSeen = a.history?.last_seen_online_at_ms ?? 0;
    const bSeen = b.history?.last_seen_online_at_ms ?? 0;
    if (bSeen !== aSeen) return bSeen - aSeen;
    return a.name.localeCompare(b.name);
  });
}

export async function build_join_directory(slot: number): Promise<EngineJoinDirectory> {
  const connections = list_engine_connections(slot);
  const probes_by_connection_id = await probe_connections(connections, slot);
  for (const connection of connections) {
    if (probes_by_connection_id[connection.id]?.status !== 'online') continue;
    if (connection.kind === 'saved_manual') {
      mark_connection_seen_online(connection.id);
      continue;
    }
    if (connection.kind === 'remote_join_code') {
      mark_remote_connection_seen_online(connection.id);
    }
  }
  return {
    connections: sort_connections(connections, probes_by_connection_id),
    probes_by_connection_id,
  };
}

export function build_join_selection(connection: EngineConnectionEntry, probe: EngineConnectionProbeResult | null, slot: number): EngineJoinSelection {
  const transport = resolve_connection_transport(connection, slot);
  return {
    connection,
    method: connection.method ?? (transport.transport_kind === 'relay_ws_tunnel' ? 'remote_relay' : connection.kind === 'local' ? 'local' : 'direct'),
    probe,
    transport: {
      transport_kind: transport.transport_kind,
      api_base_url: probe?.api_base_url ?? transport.api_base_url,
      bridge_ws_base_url: probe?.bridge_ws_base_url ?? transport.bridge_ws_base_url,
      relay_https_origin: transport.transport_kind === 'relay_ws_tunnel' ? (probe?.relay_https_origin ?? transport.relay_https_origin) : undefined,
      relay_wss_origin: transport.transport_kind === 'relay_ws_tunnel' ? (probe?.relay_wss_origin ?? transport.relay_wss_origin) : undefined,
      room_id: transport.transport_kind === 'relay_ws_tunnel' ? (probe?.room_id ?? transport.room_id) : undefined,
      join_code: transport.transport_kind === 'relay_ws_tunnel' ? (probe?.join_code ?? transport.join_code) : undefined,
      attach_token: transport.transport_kind === 'relay_ws_tunnel' ? (probe?.attach_token ?? transport.attach_token) : undefined,
    },
  };
}
