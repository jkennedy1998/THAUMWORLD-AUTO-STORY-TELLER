import * as fs from "node:fs";
import * as path from "node:path";

import { get_data_slot_dir } from "../engine/paths.js";
import { SERVICE_CONFIG } from "./constants.js";

type PresenceEntry = {
  npc_ref: string;
  target_ref: string;
  timeout_at_ms: number;
};

type PresenceFile = {
  schema_version: 1;
  updated_at: string;
  conversations: Record<string, { target_ref: string; timeout_at_ms: number }>;
};

function get_slot(slot?: number): number {
  const s = slot ?? (SERVICE_CONFIG.DEFAULT_DATA_SLOT || 1);
  return Number.isFinite(s) && s > 0 ? s : 1;
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
      return { schema_version: 1, updated_at: new Date().toISOString(), conversations: {} };
    }
    const raw = fs.readFileSync(p, "utf-8");
    const parsed = JSON.parse(raw) as PresenceFile;
    if (parsed?.schema_version !== 1 || typeof parsed.conversations !== "object") {
      return { schema_version: 1, updated_at: new Date().toISOString(), conversations: {} };
    }
    return parsed;
  } catch {
    return { schema_version: 1, updated_at: new Date().toISOString(), conversations: {} };
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

function prune_expired(now_ms: number, file: PresenceFile): boolean {
  let changed = false;
  for (const [npc_ref, entry] of Object.entries(file.conversations)) {
    if (!entry || typeof entry.timeout_at_ms !== "number") {
      delete file.conversations[npc_ref];
      changed = true;
      continue;
    }
    if (now_ms >= entry.timeout_at_ms) {
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
  timeout_at_ms: number
): void {
  const s = get_slot(slot);
  const now = Date.now();
  const file = read_file(s);
  prune_expired(now, file);
  file.conversations[npc_ref] = { target_ref, timeout_at_ms };
  file.updated_at = new Date().toISOString();
  write_file(s, file);
}

export function clear_conversation_presence(slot: number | undefined, npc_ref: string): void {
  const s = get_slot(slot);
  const now = Date.now();
  const file = read_file(s);
  const pruned = prune_expired(now, file);
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
  const now = Date.now();
  const file = read_file(s);
  const changed = prune_expired(now, file);
  if (changed) {
    file.updated_at = new Date().toISOString();
    write_file(s, file);
  }
  const entry = file.conversations[npc_ref];
  if (!entry) return null;
  return {
    npc_ref,
    target_ref: entry.target_ref,
    timeout_at_ms: entry.timeout_at_ms,
  };
}

export function is_in_conversation_presence(slot: number | undefined, npc_ref: string): boolean {
  const entry = get_conversation_presence(slot, npc_ref);
  if (!entry) return false;
  return Date.now() < entry.timeout_at_ms;
}
