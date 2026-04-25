import { list_engine_connections, mark_connection_seen_online } from './connection_store.js';
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
  if (!online && connection.kind === 'saved_manual') return 3;
  if (!online && connection.kind === 'lan_discovered') return 4;
  return 5;
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
    if (connection.kind === 'saved_manual' && probes_by_connection_id[connection.id]?.status === 'online') {
      mark_connection_seen_online(connection.id);
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
    probe,
    transport: {
      api_base_url: transport.api_base_url,
      bridge_ws_base_url: transport.bridge_ws_base_url,
    },
  };
}
