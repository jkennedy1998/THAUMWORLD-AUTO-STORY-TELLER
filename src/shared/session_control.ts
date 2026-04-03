import * as fs from "node:fs";
import { parse } from "jsonc-parser";
import { getSessionMeta } from "./session.js";
import { ensure_dir_exists } from "../engine/log_store.js";
import { get_data_slot_dir, get_session_control_path } from "../engine/paths.js";

type SessionControlBinding = {
  controlled_actor_ref: string;
  updated_at: string;
  created_at?: string;
  boot_session_id?: string;
  last_seen_at?: string;
  lease_expires_at?: string;
};

type SessionControlFile = {
  schema_version: 1;
  bindings: Record<string, SessionControlBinding>;
};

type ClientSessionBindingEntry = {
  client_session_id: string;
  binding: SessionControlBinding;
};

export type ControlledActorClaim = {
  client_session_id: string;
  actor_ref: string;
  updated_at: string;
  created_at?: string;
  boot_session_id?: string;
  last_seen_at?: string;
  lease_expires_at?: string;
};

const CLAIM_RECONNECT_GRACE_MS = 30_000;

function make_empty_session_control_file(): SessionControlFile {
  return {
    schema_version: 1,
    bindings: {},
  };
}

function load_session_control_file(slot: number): SessionControlFile {
  const path = get_session_control_path(slot);
  try {
    if (!fs.existsSync(path)) return make_empty_session_control_file();
    const parsed = parse(fs.readFileSync(path, "utf-8")) as any;
    if (parsed?.schema_version !== 1 || typeof parsed?.bindings !== "object" || !parsed.bindings) {
      return make_empty_session_control_file();
    }
    return {
      schema_version: 1,
      bindings: parsed.bindings as Record<string, SessionControlBinding>,
    };
  } catch {
    return make_empty_session_control_file();
  }
}

function prune_inactive_guest_claims(file: SessionControlFile): boolean {
  const active_boot_session_id = getSessionMeta().session_id;
  let changed = false;
  for (const [client_session_id, binding] of Object.entries(file.bindings)) {
    const binding_boot_session_id = String(binding?.boot_session_id ?? "").trim();
    if (!binding_boot_session_id || binding_boot_session_id !== active_boot_session_id) {
      delete file.bindings[client_session_id];
      changed = true;
    }
  }
  return changed;
}

function prune_expired_claims(file: SessionControlFile): boolean {
  const now = Date.now();
  let changed = false;
  for (const [client_session_id, binding] of Object.entries(file.bindings)) {
    const lease_expires_at = Date.parse(String(binding?.lease_expires_at ?? "").trim());
    if (Number.isFinite(lease_expires_at) && lease_expires_at < now) {
      delete file.bindings[client_session_id];
      changed = true;
    }
  }
  return changed;
}

function load_active_session_control_file(slot: number): SessionControlFile {
  const file = load_session_control_file(slot);
  if (prune_inactive_guest_claims(file) || prune_expired_claims(file)) {
    save_session_control_file(slot, file);
  }
  return file;
}

function build_lease_timestamps(now_iso: string): { last_seen_at: string; lease_expires_at: string } {
  const now_ms = Date.parse(now_iso);
  const base_ms = Number.isFinite(now_ms) ? now_ms : Date.now();
  return {
    last_seen_at: new Date(base_ms).toISOString(),
    lease_expires_at: new Date(base_ms + CLAIM_RECONNECT_GRACE_MS).toISOString(),
  };
}

function now_iso_timestamp(): string {
  return new Date().toISOString();
}

function save_session_control_file(slot: number, file: SessionControlFile): void {
  ensure_dir_exists(get_data_slot_dir(slot));
  fs.writeFileSync(get_session_control_path(slot), JSON.stringify(file, null, 2), "utf-8");
}

function find_client_session_binding_by_actor_ref(file: SessionControlFile, actor_ref: string): ClientSessionBindingEntry | null {
  const ref = String(actor_ref ?? "").trim();
  if (!ref) return null;
  for (const [client_session_id, binding] of Object.entries(file.bindings)) {
    if (String(binding?.controlled_actor_ref ?? "").trim() === ref) {
      return { client_session_id, binding };
    }
  }
  return null;
}

function require_client_session_id(client_session_id: string): string {
  const sid = String(client_session_id ?? "").trim();
  if (!sid) throw new Error("missing_client_session_id");
  return sid;
}

export function get_controlled_actor_ref_for_client_session(slot: number, client_session_id: string): string | null {
  const sid = require_client_session_id(client_session_id);
  const file = load_active_session_control_file(slot);
  const binding = file.bindings[sid];
  return typeof binding?.controlled_actor_ref === "string" && binding.controlled_actor_ref.trim().length > 0
    ? binding.controlled_actor_ref.trim()
    : null;
}

export function get_claiming_client_session_id_for_actor_ref(slot: number, actor_ref: string): string | null {
  const file = load_active_session_control_file(slot);
  const existing_owner = find_client_session_binding_by_actor_ref(file, actor_ref);
  return existing_owner?.client_session_id ?? null;
}

export function list_controlled_actor_claims(slot: number): ControlledActorClaim[] {
  const file = load_active_session_control_file(slot);
  return Object.entries(file.bindings)
    .map(([client_session_id, binding]) => ({
      client_session_id,
      actor_ref: String(binding?.controlled_actor_ref ?? "").trim(),
      updated_at: String(binding?.updated_at ?? "").trim(),
      created_at: typeof binding?.created_at === "string" ? binding.created_at : undefined,
      boot_session_id: typeof binding?.boot_session_id === "string" ? binding.boot_session_id : undefined,
      last_seen_at: typeof binding?.last_seen_at === "string" ? binding.last_seen_at : undefined,
      lease_expires_at: typeof binding?.lease_expires_at === "string" ? binding.lease_expires_at : undefined,
    }))
    .filter((entry) => entry.actor_ref.length > 0);
}

export function set_controlled_actor_ref_for_client_session(slot: number, client_session_id: string, actor_ref: string): string {
  const sid = require_client_session_id(client_session_id);
  const ref = String(actor_ref ?? "").trim();
  if (!ref.startsWith("actor.")) throw new Error("invalid_controlled_actor_ref");

  const file = load_active_session_control_file(slot);
  const session_meta = getSessionMeta();
  const existing_owner = find_client_session_binding_by_actor_ref(file, ref);
  if (existing_owner && existing_owner.client_session_id !== sid) {
    throw new Error("controlled_actor_already_claimed");
  }
  const now = now_iso_timestamp();
  const lease = build_lease_timestamps(now);
  const prev = file.bindings[sid];
  file.bindings[sid] = {
    controlled_actor_ref: ref,
    updated_at: now,
    created_at: prev?.created_at ?? now,
    boot_session_id: session_meta.session_id,
    last_seen_at: lease.last_seen_at,
    lease_expires_at: lease.lease_expires_at,
  };
  save_session_control_file(slot, file);
  return ref;
}

export function touch_controlled_actor_ref_for_client_session(slot: number, client_session_id: string): string | null {
  const sid = require_client_session_id(client_session_id);
  const file = load_active_session_control_file(slot);
  const existing = file.bindings[sid];
  if (!existing || !String(existing.controlled_actor_ref ?? "").trim()) return null;
  const session_meta = getSessionMeta();
  const now = now_iso_timestamp();
  const lease = build_lease_timestamps(now);
  file.bindings[sid] = {
    ...existing,
    updated_at: now,
    boot_session_id: session_meta.session_id,
    last_seen_at: lease.last_seen_at,
    lease_expires_at: lease.lease_expires_at,
  };
  save_session_control_file(slot, file);
  return String(existing.controlled_actor_ref ?? "").trim() || null;
}

export function refresh_controlled_actor_lease_for_client_session(slot: number, client_session_id: string): string | null {
  const sid = require_client_session_id(client_session_id);
  const file = load_active_session_control_file(slot);
  const existing = file.bindings[sid];
  if (!existing || !String(existing.controlled_actor_ref ?? "").trim()) return null;
  const session_meta = getSessionMeta();
  const lease = build_lease_timestamps(now_iso_timestamp());
  file.bindings[sid] = {
    ...existing,
    boot_session_id: session_meta.session_id,
    last_seen_at: lease.last_seen_at,
    lease_expires_at: lease.lease_expires_at,
  };
  save_session_control_file(slot, file);
  return String(existing.controlled_actor_ref ?? "").trim() || null;
}

export function release_controlled_actor_ref_for_client_session(slot: number, client_session_id: string): boolean {
  const sid = require_client_session_id(client_session_id);
  const file = load_active_session_control_file(slot);
  if (!file.bindings[sid]) return false;
  delete file.bindings[sid];
  save_session_control_file(slot, file);
  return true;
}

export function assign_controlled_actor_ref_for_client_session(slot: number, client_session_id: string, preferred_actor_ref?: string | null): string {
  const sid = require_client_session_id(client_session_id);
  const existing = get_controlled_actor_ref_for_client_session(slot, sid);

  const preferred = String(preferred_actor_ref ?? "").trim();
  if (preferred.startsWith("actor.")) {
    if (existing && existing !== preferred) {
      throw new Error("controlled_actor_release_required");
    }
    return set_controlled_actor_ref_for_client_session(slot, sid, preferred);
  }

  if (existing) return existing;

  throw new Error("controlled_actor_binding_required");
}
