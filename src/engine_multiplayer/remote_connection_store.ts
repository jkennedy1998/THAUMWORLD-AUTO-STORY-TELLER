import { build_remote_relay_transport_config } from '../shared/multiplayer_transport.js';
import type { EngineConnectionEntry } from './connection_types.js';

const STORAGE_KEY = 'thaumworld_recent_remote_sessions';

type StoredRemoteConnection = {
  id: string;
  join_code: string;
  label: string;
  relay_origin: string;
  room_id?: string;
  app_kind?: 'thaumworld' | 'ascii_painter' | 'unknown';
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

function read_raw_remote_connections(): StoredRemoteConnection[] {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry): StoredRemoteConnection | null => {
        const id = String(entry?.id ?? '').trim();
        const join_code = String(entry?.join_code ?? '').trim();
        const relay_origin = String(entry?.relay_origin ?? '').trim();
        if (!id || !join_code || !relay_origin) return null;
        return {
          id,
          join_code,
          label: String(entry?.label ?? '').trim() || join_code,
          relay_origin,
          room_id: String(entry?.room_id ?? '').trim() || undefined,
          app_kind: entry?.app_kind === 'thaumworld' || entry?.app_kind === 'ascii_painter' ? entry.app_kind : 'unknown',
          created_at: String(entry?.created_at ?? '').trim() || new Date(0).toISOString(),
          updated_at: String(entry?.updated_at ?? '').trim() || String(entry?.created_at ?? '').trim() || new Date(0).toISOString(),
          last_connected_at: String(entry?.last_connected_at ?? '').trim() || undefined,
          last_seen_online_at: String(entry?.last_seen_online_at ?? '').trim() || undefined,
        };
      })
      .filter((entry): entry is StoredRemoteConnection => entry !== null)
      .sort((a, b) => (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0));
  } catch {
    return [];
  }
}

function write_raw_remote_connections(entries: StoredRemoteConnection[]): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries, null, 2));
  } catch {
    // ignore persistence failure
  }
}

function create_remote_connection_id(): string {
  return `remote_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function to_engine_connection(entry: StoredRemoteConnection): EngineConnectionEntry {
  const transport = build_remote_relay_transport_config({
    relay_https_origin: entry.relay_origin,
    room_id: entry.room_id,
    join_code: entry.join_code,
    host_input: entry.join_code,
  });
  return {
    id: entry.id,
    name: entry.label,
    host: entry.join_code,
    kind: 'remote_join_code',
    method: 'remote_relay',
    scope: 'internet',
    transport,
    history: {
      created_at_ms: parse_iso_ms(entry.created_at),
      updated_at_ms: parse_iso_ms(entry.updated_at),
      last_connected_at_ms: parse_iso_ms(entry.last_connected_at),
      last_seen_online_at_ms: parse_iso_ms(entry.last_seen_online_at),
    },
    metadata: {
      source_label: 'recent remote session',
      remote_session: {
        room_id: entry.room_id,
        join_code: entry.join_code,
        relay_origin: entry.relay_origin,
        visibility: 'private',
        app_kind: entry.app_kind ?? 'unknown',
      },
    },
  };
}

function update_remote_connection(id: string, updater: (entry: StoredRemoteConnection) => StoredRemoteConnection): EngineConnectionEntry | null {
  const normalized_id = String(id ?? '').trim();
  if (!normalized_id) return null;
  const existing = read_raw_remote_connections();
  const match = existing.find((entry) => entry.id === normalized_id);
  if (!match) return null;
  const next = updater(match);
  write_raw_remote_connections([next, ...existing.filter((entry) => entry.id !== normalized_id)]);
  return to_engine_connection(next);
}

export function list_recent_remote_connections(): EngineConnectionEntry[] {
  return read_raw_remote_connections().map(to_engine_connection);
}

export function remember_remote_join_code(args: {
  join_code: string;
  label?: string | null;
  relay_origin: string;
  room_id?: string | null;
  app_kind?: 'thaumworld' | 'ascii_painter' | 'unknown';
}): EngineConnectionEntry {
  const join_code = String(args.join_code ?? '').trim();
  const relay_origin = String(args.relay_origin ?? '').trim();
  if (!join_code) throw new Error('join_code_required');
  if (!relay_origin) throw new Error('relay_origin_required');
  const now = new Date().toISOString();
  const existing = read_raw_remote_connections();
  const match = existing.find((entry) => entry.join_code.toLowerCase() === join_code.toLowerCase() && entry.relay_origin.toLowerCase() === relay_origin.toLowerCase()) ?? null;
  const next: StoredRemoteConnection = match
    ? {
        ...match,
        label: String(args.label ?? '').trim() || match.label,
        room_id: String(args.room_id ?? '').trim() || match.room_id,
        app_kind: args.app_kind ?? match.app_kind ?? 'unknown',
        updated_at: now,
      }
    : {
        id: create_remote_connection_id(),
        join_code,
        label: String(args.label ?? '').trim() || join_code,
        relay_origin,
        room_id: String(args.room_id ?? '').trim() || undefined,
        app_kind: args.app_kind ?? 'unknown',
        created_at: now,
        updated_at: now,
      };
  write_raw_remote_connections([next, ...existing.filter((entry) => entry.id !== next.id)]);
  return to_engine_connection(next);
}

export function rename_remote_connection(id: string, next_name: string): EngineConnectionEntry {
  const normalized_name = String(next_name ?? '').trim();
  if (!normalized_name) throw new Error('connection_name_required');
  const updated = update_remote_connection(id, (entry) => ({
    ...entry,
    label: normalized_name,
    updated_at: new Date().toISOString(),
  }));
  if (!updated) throw new Error('connection_not_found');
  return updated;
}

export function forget_remote_connection(id: string): void {
  const normalized_id = String(id ?? '').trim();
  if (!normalized_id) return;
  write_raw_remote_connections(read_raw_remote_connections().filter((entry) => entry.id !== normalized_id));
}

export function mark_remote_connection_seen_online(id: string): void {
  void update_remote_connection(id, (entry) => {
    const now = new Date().toISOString();
    return {
      ...entry,
      updated_at: now,
      last_seen_online_at: now,
    };
  });
}

export function mark_remote_connection_connected(id: string): void {
  void update_remote_connection(id, (entry) => {
    const now = new Date().toISOString();
    return {
      ...entry,
      updated_at: now,
      last_connected_at: now,
      last_seen_online_at: now,
    };
  });
}

export function migrate_legacy_remote_connection(entry: EngineConnectionEntry): void {
  if (entry.kind !== 'remote_join_code') return;
  const transport = entry.transport;
  const join_code = String(entry.metadata?.remote_session?.join_code ?? entry.host ?? '').trim();
  const relay_origin = String(entry.metadata?.remote_session?.relay_origin ?? transport?.relay_https_origin ?? '').trim();
  if (!join_code || !relay_origin) return;
  const existing = read_raw_remote_connections();
  if (existing.some((item) => item.id === entry.id)) return;
  write_raw_remote_connections([
    {
      id: entry.id,
      join_code,
      label: entry.name,
      relay_origin,
      room_id: String(entry.metadata?.remote_session?.room_id ?? transport?.room_id ?? '').trim() || undefined,
      app_kind: entry.metadata?.remote_session?.app_kind ?? 'unknown',
      created_at: to_iso(entry.history?.created_at_ms) ?? new Date().toISOString(),
      updated_at: to_iso(entry.history?.updated_at_ms) ?? new Date().toISOString(),
      last_connected_at: to_iso(entry.history?.last_connected_at_ms),
      last_seen_online_at: to_iso(entry.history?.last_seen_online_at_ms),
    },
    ...existing,
  ]);
}
