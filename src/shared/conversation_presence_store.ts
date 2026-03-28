import * as fs from "node:fs";
import * as path from "node:path";

import { get_data_slot_dir } from "../engine/paths.js";
import { get_free_roam_place_breath } from "./free_roam_breath_store.js";
import { SERVICE_CONFIG } from "./constants.js";

type PresenceEntry = {
  npc_ref: string;
  target_ref: string;
  expires_at_breath: number;
  place_id?: string;
};

type PresenceFile = {
  schema_version: 2;
  updated_at: string;
  conversations: Record<string, { target_ref: string; expires_at_breath: number; place_id?: string }>;
};

function get_slot(slot?: number): number {
  const s = slot ?? (SERVICE_CONFIG.DEFAULT_DATA_SLOT || 1);
  return Number.isFinite(s) && s > 0 ? s : 1;
}

export function get_current_conversation_breath(slot?: number, place_id?: string | null): number {
  const pid = String(place_id ?? "").trim();
  if (pid) {
    const free_roam_breath = get_free_roam_place_breath(slot, pid);
    if (typeof free_roam_breath === "number" && Number.isFinite(free_roam_breath)) {
      return Math.max(0, Math.floor(free_roam_breath));
    }
  }
  return Math.max(0, Math.floor(Date.now() / 1000));
}

function get_presence_dir(slot?: number): string {
  const data_dir = get_data_slot_dir(get_slot(slot));
  return path.join(data_dir, "ephemeral");
}

function get_presence_path(slot?: number): string {
  return path.join(get_presence_dir(slot), "conversation_presence.json");
}

function ensure_dir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function read_file(slot?: number): PresenceFile {
  const p = get_presence_path(slot);
  try {
    if (!fs.existsSync(p)) {
      return { schema_version: 2, updated_at: new Date().toISOString(), conversations: {} };
    }
    const raw = fs.readFileSync(p, "utf-8");
    const parsed = JSON.parse(raw) as any;
    if (!parsed || typeof parsed.conversations !== "object") {
      return { schema_version: 2, updated_at: new Date().toISOString(), conversations: {} };
    }

    const migrated: PresenceFile = {
      schema_version: 2,
      updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : new Date().toISOString(),
      conversations: {},
    };
    for (const [npc_ref, entry] of Object.entries(parsed.conversations as Record<string, any>)) {
      if (!entry || typeof entry.target_ref !== "string") continue;
      if (typeof entry.expires_at_breath === "number" && Number.isFinite(entry.expires_at_breath)) {
        migrated.conversations[npc_ref] = {
          target_ref: entry.target_ref,
          expires_at_breath: Math.max(0, Math.floor(entry.expires_at_breath)),
          place_id: typeof entry.place_id === "string" && entry.place_id.length > 0 ? entry.place_id : undefined,
        };
        continue;
      }
      if (typeof entry.timeout_at_ms === "number" && Number.isFinite(entry.timeout_at_ms)) {
        migrated.conversations[npc_ref] = {
          target_ref: entry.target_ref,
          expires_at_breath: Math.max(0, Math.floor(entry.timeout_at_ms / 1000)),
          place_id: typeof entry.place_id === "string" && entry.place_id.length > 0 ? entry.place_id : undefined,
        };
      }
    }
    return migrated;
  } catch {
    return { schema_version: 2, updated_at: new Date().toISOString(), conversations: {} };
  }
}

function write_file(slot: number, file: PresenceFile): void {
  const dir = get_presence_dir(slot);
  ensure_dir(dir);
  const p = get_presence_path(slot);
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2));
  fs.renameSync(tmp, p);
}

function prune_expired(slot: number, file: PresenceFile): boolean {
  let changed = false;
  for (const [npc_ref, entry] of Object.entries(file.conversations)) {
    if (!entry || typeof entry.expires_at_breath !== "number") {
      delete file.conversations[npc_ref];
      changed = true;
      continue;
    }
    const current_breath = get_current_conversation_breath(slot, entry.place_id ?? null);
    if (current_breath >= entry.expires_at_breath) {
      delete file.conversations[npc_ref];
      changed = true;
    }
  }
  return changed;
}

export function set_conversation_presence(
  slot: number | undefined,
  npc_ref: string,
  target_ref: string,
  expires_at_breath: number,
  place_id?: string | null,
): void {
  const s = get_slot(slot);
  const file = read_file(s);
  prune_expired(s, file);
  file.conversations[npc_ref] = {
    target_ref,
    expires_at_breath: Math.max(0, Math.floor(expires_at_breath)),
    place_id: typeof place_id === "string" && place_id.length > 0 ? place_id : undefined,
  };
  file.updated_at = new Date().toISOString();
  write_file(s, file);
}

export function clear_conversation_presence(slot: number | undefined, npc_ref: string): void {
  const s = get_slot(slot);
  const file = read_file(s);
  const pruned = prune_expired(s, file);
  if (file.conversations[npc_ref]) {
    delete file.conversations[npc_ref];
    file.updated_at = new Date().toISOString();
    write_file(s, file);
    return;
  }
  if (pruned) {
    file.updated_at = new Date().toISOString();
    write_file(s, file);
  }
}

export function get_conversation_presence(slot: number | undefined, npc_ref: string): PresenceEntry | null {
  const s = get_slot(slot);
  const file = read_file(s);
  const changed = prune_expired(s, file);
  if (changed) {
    file.updated_at = new Date().toISOString();
    write_file(s, file);
  }
  const entry = file.conversations[npc_ref];
  if (!entry) return null;
  return {
    npc_ref,
    target_ref: entry.target_ref,
    expires_at_breath: entry.expires_at_breath,
    place_id: typeof entry.place_id === "string" && entry.place_id.length > 0 ? entry.place_id : undefined,
  };
}

export function is_in_conversation_presence(slot: number | undefined, npc_ref: string): boolean {
  return get_conversation_presence(slot, npc_ref) !== null;
}
