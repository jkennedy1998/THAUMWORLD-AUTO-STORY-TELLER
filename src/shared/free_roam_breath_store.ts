import * as fs from "node:fs";
import * as path from "node:path";

import { get_data_slot_dir } from "../engine/paths.js";
import { SERVICE_CONFIG } from "./constants.js";

type FreeRoamBreathFile = {
  schema_version: 1;
  updated_at: string;
  places: Record<string, { breath_index: number }>;
};

function get_slot(slot?: number): number {
  const s = slot ?? (SERVICE_CONFIG.DEFAULT_DATA_SLOT || 1);
  return Number.isFinite(s) && s > 0 ? s : 1;
}

function get_store_dir(slot?: number): string {
  return path.join(get_data_slot_dir(get_slot(slot)), "ephemeral");
}

function get_store_path(slot?: number): string {
  return path.join(get_store_dir(slot), "free_roam_place_breaths.json");
}

function ensure_dir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function read_file(slot?: number): FreeRoamBreathFile {
  const file_path = get_store_path(slot);
  try {
    if (!fs.existsSync(file_path)) {
      return { schema_version: 1, updated_at: new Date().toISOString(), places: {} };
    }
    const parsed = JSON.parse(fs.readFileSync(file_path, "utf-8")) as FreeRoamBreathFile;
    if (parsed?.schema_version !== 1 || typeof parsed.places !== "object") {
      return { schema_version: 1, updated_at: new Date().toISOString(), places: {} };
    }
    return parsed;
  } catch {
    return { schema_version: 1, updated_at: new Date().toISOString(), places: {} };
  }
}

function write_file(slot: number, file: FreeRoamBreathFile): void {
  const dir = get_store_dir(slot);
  ensure_dir(dir);
  const file_path = get_store_path(slot);
  const tmp_path = `${file_path}.tmp`;
  fs.writeFileSync(tmp_path, JSON.stringify(file, null, 2), "utf-8");
  fs.renameSync(tmp_path, file_path);
}

export function set_free_roam_place_breath(slot: number | undefined, place_id: string, breath_index: number): void {
  const s = get_slot(slot);
  const pid = String(place_id ?? "").trim();
  if (!pid) return;
  const next_breath = Math.max(0, Math.floor(Number(breath_index) || 0));
  const file = read_file(s);
  const existing = Math.max(0, Math.floor(Number(file.places[pid]?.breath_index ?? 0)) || 0);
  if (existing === next_breath) return;
  file.places[pid] = { breath_index: next_breath };
  file.updated_at = new Date().toISOString();
  write_file(s, file);
}

export function get_free_roam_place_breath(slot: number | undefined, place_id: string): number | null {
  const s = get_slot(slot);
  const pid = String(place_id ?? "").trim();
  if (!pid) return null;
  const file = read_file(s);
  const breath_index = file.places[pid]?.breath_index;
  if (typeof breath_index !== "number" || !Number.isFinite(breath_index)) return null;
  return Math.max(0, Math.floor(breath_index));
}
