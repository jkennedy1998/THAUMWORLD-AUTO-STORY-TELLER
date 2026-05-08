import {
  DEFAULT_LOCAL_MULTIPLAYER_TRANSPORT,
  build_multiplayer_transport_config,
  normalize_join_host_input,
} from '../shared/multiplayer_transport.js';
import type { EngineConnectionEntry } from './connection_types.js';
import { list_recent_remote_connections } from './remote_connection_store.js';

const STORAGE_KEY = 'thaumworld_saved_join_hosts';

type StoredManualConnection = {
  id: string;
  host: string;
  label: string;
  created_at: string;
  updated_at: string;
  last_connected_at?: string;
  last_seen_online_at?: string;
};

function parse_iso_ms(raw: string | undefined): number | undefined {
  const value = Date.parse(String(raw ?? '').trim());
  return Number.isFinite(value) ? value : undefined;
}

function to_iso(ms: number | undefined): string | undefined {
  return typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

function read_raw_manual_connections(): StoredManualConnection[] {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry): StoredManualConnection | null => {
        const id = String(entry?.id ?? '').trim();
        const host = String(entry?.host ?? '').trim();
        if (!id || !host) return null;
        return {
          id,
          host,
          label: String(entry?.label ?? '').trim() || host,
          created_at: String(entry?.created_at ?? '').trim() || new Date(0).toISOString(),
          updated_at: String(entry?.updated_at ?? '').trim() || String(entry?.created_at ?? '').trim() || new Date(0).toISOString(),
          last_connected_at: String(entry?.last_connected_at ?? '').trim() || undefined,
          last_seen_online_at: String(entry?.last_seen_online_at ?? '').trim() || undefined,
        };
      })
      .filter((entry): entry is StoredManualConnection => entry !== null)
      .sort((a, b) => (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0));
  } catch {
    return [];
  }
}

function write_raw_manual_connections(entries: StoredManualConnection[]): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries, null, 2));
  } catch {
    // ignore persistence failure
  }
}

function create_manual_connection_id(): string {
  return `connection_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function to_engine_connection(entry: StoredManualConnection): EngineConnectionEntry {
  const transport = build_multiplayer_transport_config({ host: entry.host });
  return {
    id: entry.id,
    name: entry.label,
    host: entry.host,
    kind: 'saved_manual',
    method: 'direct',
    scope: 'wifi',
    transport: {
      api_base_url: transport.api_base_url,
      bridge_ws_base_url: transport.bridge_ws_base_url,
    },
    history: {
      created_at_ms: parse_iso_ms(entry.created_at),
      updated_at_ms: parse_iso_ms(entry.updated_at),
      last_connected_at_ms: parse_iso_ms(entry.last_connected_at),
      last_seen_online_at_ms: parse_iso_ms(entry.last_seen_online_at),
    },
  };
}

function update_manual_connection(id: string, updater: (entry: StoredManualConnection) => StoredManualConnection): EngineConnectionEntry | null {
  const normalized_id = String(id ?? '').trim();
  if (!normalized_id) return null;
  const existing = read_raw_manual_connections();
  const match = existing.find((entry) => entry.id === normalized_id);
  if (!match) return null;
  const next = updater(match);
  write_raw_manual_connections([next, ...existing.filter((entry) => entry.id !== normalized_id)]);
  return to_engine_connection(next);
}

export function get_builtin_local_connection(slot: number): EngineConnectionEntry {
  return {
    id: `local:slot_${slot}`,
    name: 'Local',
    host: 'local',
    kind: 'local',
    method: 'local',
    scope: 'local_machine',
    transport: {
      api_base_url: DEFAULT_LOCAL_MULTIPLAYER_TRANSPORT.api_base_url,
      bridge_ws_base_url: DEFAULT_LOCAL_MULTIPLAYER_TRANSPORT.bridge_ws_base_url,
      slot,
    },
    metadata: {
      source_label: 'local host auto-detect',
    },
  };
}

export function list_saved_manual_connections(): EngineConnectionEntry[] {
  return read_raw_manual_connections().map(to_engine_connection);
}

export function list_engine_connections(slot: number): EngineConnectionEntry[] {
  return [get_builtin_local_connection(slot), ...list_recent_remote_connections(), ...list_saved_manual_connections()];
}

export function save_manual_connection(host: string, name?: string): EngineConnectionEntry {
  const normalized_host = normalize_join_host_input(host).normalized_host;
  const normalized_name = String(name ?? '').trim() || normalized_host;
  const now = new Date().toISOString();
  const existing = read_raw_manual_connections();
  const match = existing.find((entry) => entry.host.toLowerCase() === normalized_host.toLowerCase()) ?? null;
  const next: StoredManualConnection = match
    ? {
        ...match,
        host: normalized_host,
        label: normalized_name,
        updated_at: now,
      }
    : {
        id: create_manual_connection_id(),
        host: normalized_host,
        label: normalized_name,
        created_at: now,
        updated_at: now,
      };
  write_raw_manual_connections([next, ...existing.filter((entry) => entry.id !== next.id)]);
  return to_engine_connection(next);
}

export function rename_manual_connection(id: string, next_name: string): EngineConnectionEntry {
  const normalized_name = String(next_name ?? '').trim();
  if (!normalized_name) throw new Error('connection_name_required');
  const updated = update_manual_connection(id, (entry) => ({
    ...entry,
    label: normalized_name,
    updated_at: new Date().toISOString(),
  }));
  if (!updated) throw new Error('connection_not_found');
  return updated;
}

export function update_manual_connection_host(id: string, host: string): EngineConnectionEntry {
  const normalized_host = normalize_join_host_input(host).normalized_host;
  const updated = update_manual_connection(id, (entry) => ({
    ...entry,
    host: normalized_host,
    updated_at: new Date().toISOString(),
  }));
  if (!updated) throw new Error('connection_not_found');
  return updated;
}

export function forget_manual_connection(id: string): void {
  const normalized_id = String(id ?? '').trim();
  if (!normalized_id) return;
  write_raw_manual_connections(read_raw_manual_connections().filter((entry) => entry.id !== normalized_id));
}

export function mark_connection_seen_online(id: string): void {
  void update_manual_connection(id, (entry) => {
    const now = new Date().toISOString();
    return {
      ...entry,
      updated_at: now,
      last_seen_online_at: now,
    };
  });
}

export function mark_connection_connected(id: string): void {
  void update_manual_connection(id, (entry) => {
    const now = new Date().toISOString();
    return {
      ...entry,
      updated_at: now,
      last_connected_at: now,
      last_seen_online_at: now,
    };
  });
}

export function migrate_legacy_saved_connection(entry: EngineConnectionEntry): void {
  if (entry.kind !== 'saved_manual') return;
  const existing = read_raw_manual_connections();
  if (existing.some((item) => item.id === entry.id)) return;
  write_raw_manual_connections([
    {
      id: entry.id,
      host: entry.host,
      label: entry.name,
      created_at: to_iso(entry.history?.created_at_ms) ?? new Date().toISOString(),
      updated_at: to_iso(entry.history?.updated_at_ms) ?? new Date().toISOString(),
      last_connected_at: to_iso(entry.history?.last_connected_at_ms),
      last_seen_online_at: to_iso(entry.history?.last_seen_online_at_ms),
    },
    ...existing,
  ]);
}
