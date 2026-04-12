import { randomBytes } from "node:crypto";
import { get_data_slot_dir } from "../engine/paths.js";
import { getSessionMeta } from "./session.js";
import { read_jsonc_file_or_default, write_json_file } from "./json_file.js";

type MultiplayerSessionRecord = {
  client_session_id: string;
  connection_id: string;
  session_token: string;
  reconnect_token: string;
  created_at: string;
  last_seen_at: string;
  lease_expires_at: string;
  boot_session_id: string;
};

type MultiplayerSessionFile = {
  schema_version: 1;
  sessions: Record<string, MultiplayerSessionRecord>;
};

export type MultiplayerSessionBootstrap = {
  client_session_id: string;
  connection_id: string;
  session_token: string;
  reconnect_token: string;
  created_at: string;
  last_seen_at: string;
  lease_expires_at: string;
  boot_session_id: string;
};

const SESSION_RECONNECT_GRACE_MS = 30_000;

function get_multiplayer_session_path(slot: number): string {
  return `${get_data_slot_dir(slot)}/multiplayer_sessions.json`;
}

function make_empty_file(): MultiplayerSessionFile {
  return { schema_version: 1, sessions: {} };
}

function load_file(slot: number): MultiplayerSessionFile {
  const filePath = get_multiplayer_session_path(slot);
  const parsed = read_jsonc_file_or_default<any>(filePath, make_empty_file);
  if (parsed?.schema_version !== 1 || typeof parsed?.sessions !== "object" || !parsed.sessions) {
    return make_empty_file();
  }
  return { schema_version: 1, sessions: parsed.sessions as Record<string, MultiplayerSessionRecord> };
}

function save_file(slot: number, file: MultiplayerSessionFile): void {
  write_json_file(get_multiplayer_session_path(slot), file);
}

function prune_inactive_boot_sessions(file: MultiplayerSessionFile): boolean {
  const active_boot_session_id = getSessionMeta().session_id;
  let changed = false;
  for (const [session_token, record] of Object.entries(file.sessions)) {
    if (String(record?.boot_session_id ?? "").trim() !== active_boot_session_id) {
      delete file.sessions[session_token];
      changed = true;
    }
  }
  return changed;
}

function load_active_file(slot: number): MultiplayerSessionFile {
  const file = load_file(slot);
  if (prune_inactive_boot_sessions(file) || prune_expired_sessions(file)) save_file(slot, file);
  return file;
}

function prune_expired_sessions(file: MultiplayerSessionFile): boolean {
  const now = Date.now();
  let changed = false;
  for (const [session_token, record] of Object.entries(file.sessions)) {
    const lease_expires_at = Date.parse(String(record?.lease_expires_at ?? "").trim());
    if (Number.isFinite(lease_expires_at) && lease_expires_at < now) {
      delete file.sessions[session_token];
      changed = true;
    }
  }
  return changed;
}

function now_iso(): string {
  return new Date().toISOString();
}

function make_token(): string {
  return randomBytes(24).toString("hex");
}

function make_id(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

function to_bootstrap(record: MultiplayerSessionRecord): MultiplayerSessionBootstrap {
  return {
    client_session_id: record.client_session_id,
    connection_id: record.connection_id,
    session_token: record.session_token,
    reconnect_token: record.reconnect_token,
    created_at: record.created_at,
    last_seen_at: record.last_seen_at,
    lease_expires_at: record.lease_expires_at,
    boot_session_id: record.boot_session_id,
  };
}

function build_session_lease_timestamps(now: string): { last_seen_at: string; lease_expires_at: string } {
  const now_ms = Date.parse(now);
  const base_ms = Number.isFinite(now_ms) ? now_ms : Date.now();
  return {
    last_seen_at: new Date(base_ms).toISOString(),
    lease_expires_at: new Date(base_ms + SESSION_RECONNECT_GRACE_MS).toISOString(),
  };
}

function find_by_reconnect_token(file: MultiplayerSessionFile, reconnect_token: string): MultiplayerSessionRecord | null {
  const token = String(reconnect_token ?? "").trim();
  if (!token) return null;
  for (const record of Object.values(file.sessions)) {
    if (String(record?.reconnect_token ?? "").trim() === token) return record;
  }
  return null;
}

export function issue_or_resume_multiplayer_session(slot: number, reconnect_token?: string | null): MultiplayerSessionBootstrap {
  const file = load_active_file(slot);
  const session_meta = getSessionMeta();
  const resumed = find_by_reconnect_token(file, String(reconnect_token ?? "").trim());
  const now = now_iso();
  const lease = build_session_lease_timestamps(now);
  if (resumed) {
    delete file.sessions[resumed.session_token];
    const next: MultiplayerSessionRecord = {
      ...resumed,
      connection_id: make_id("conn"),
      session_token: make_token(),
      last_seen_at: lease.last_seen_at,
      lease_expires_at: lease.lease_expires_at,
      boot_session_id: session_meta.session_id,
    };
    file.sessions[next.session_token] = next;
    save_file(slot, file);
    return to_bootstrap(next);
  }

  const created: MultiplayerSessionRecord = {
    client_session_id: make_id("client"),
    connection_id: make_id("conn"),
    session_token: make_token(),
    reconnect_token: make_token(),
    created_at: now,
    last_seen_at: lease.last_seen_at,
    lease_expires_at: lease.lease_expires_at,
    boot_session_id: session_meta.session_id,
  };
  file.sessions[created.session_token] = created;
  save_file(slot, file);
  return to_bootstrap(created);
}

export function resolve_multiplayer_session_by_token(slot: number, session_token: string): MultiplayerSessionBootstrap | null {
  const token = String(session_token ?? "").trim();
  if (!token) return null;
  const file = load_active_file(slot);
  const record = file.sessions[token];
  return record ? to_bootstrap(record) : null;
}

export function touch_multiplayer_session_by_token(slot: number, session_token: string): MultiplayerSessionBootstrap | null {
  const token = String(session_token ?? "").trim();
  if (!token) return null;
  const file = load_active_file(slot);
  const record = file.sessions[token];
  if (!record) return null;
  const lease = build_session_lease_timestamps(now_iso());
  const next: MultiplayerSessionRecord = { ...record, last_seen_at: lease.last_seen_at, lease_expires_at: lease.lease_expires_at };
  file.sessions[token] = next;
  save_file(slot, file);
  return to_bootstrap(next);
}

export function resolve_multiplayer_session_by_client_session_id(slot: number, client_session_id: string): MultiplayerSessionBootstrap | null {
  const target = String(client_session_id ?? "").trim();
  if (!target) return null;
  const file = load_active_file(slot);
  for (const record of Object.values(file.sessions)) {
    if (String(record?.client_session_id ?? "").trim() === target) {
      return to_bootstrap(record);
    }
  }
  return null;
}
