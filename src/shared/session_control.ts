import * as fs from "node:fs";
import { parse } from "jsonc-parser";
import { getSessionMeta, SESSION_ID } from "./session.js";
import { ensure_dir_exists } from "../engine/log_store.js";
import { get_data_slot_dir, get_session_control_path } from "../engine/paths.js";
import { resolve_runtime_player_actor_id } from "../actor_storage/store.js";

type SessionControlBinding = {
  controlled_actor_ref: string;
  updated_at: string;
  created_at?: string;
};

type SessionControlFile = {
  schema_version: 1;
  bindings: Record<string, SessionControlBinding>;
};

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

function save_session_control_file(slot: number, file: SessionControlFile): void {
  ensure_dir_exists(get_data_slot_dir(slot));
  fs.writeFileSync(get_session_control_path(slot), JSON.stringify(file, null, 2), "utf-8");
}

export function get_controlled_actor_ref_for_session(slot: number, session_id?: string | null): string | null {
  const sid = String(session_id ?? SESSION_ID).trim();
  if (!sid) return null;
  const file = load_session_control_file(slot);
  const binding = file.bindings[sid];
  return typeof binding?.controlled_actor_ref === "string" && binding.controlled_actor_ref.trim().length > 0
    ? binding.controlled_actor_ref.trim()
    : null;
}

export function set_controlled_actor_ref_for_session(slot: number, actor_ref: string, session_id?: string | null): string {
  const sid = String(session_id ?? SESSION_ID).trim();
  const ref = String(actor_ref ?? "").trim();
  if (!sid) throw new Error("missing_session_id");
  if (!ref.startsWith("actor.")) throw new Error("invalid_controlled_actor_ref");

  const file = load_session_control_file(slot);
  const now = getSessionMeta().created_at;
  const prev = file.bindings[sid];
  file.bindings[sid] = {
    controlled_actor_ref: ref,
    updated_at: now,
    created_at: prev?.created_at ?? now,
  };
  save_session_control_file(slot, file);
  return ref;
}

export function get_or_bind_controlled_actor_ref(slot: number, preferred_actor_ref?: string | null, session_id?: string | null): string {
  const preferred = String(preferred_actor_ref ?? "").trim();
  if (preferred.startsWith("actor.")) {
    return set_controlled_actor_ref_for_session(slot, preferred, session_id);
  }

  const existing = get_controlled_actor_ref_for_session(slot, session_id);
  if (existing) return existing;

  const actor_id = resolve_runtime_player_actor_id(slot);
  const actor_ref = `actor.${actor_id}`;
  return set_controlled_actor_ref_for_session(slot, actor_ref, session_id);
}
