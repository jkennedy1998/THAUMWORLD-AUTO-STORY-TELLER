import { SERVICE_CONFIG } from "./constants.js";
import path from "node:path";

export type ThaumBootRole = "host" | "client" | "unknown";

export function get_configured_data_slot(): number {
  const env_slot = Number(process.env.DATA_SLOT ?? "");
  if (Number.isFinite(env_slot) && env_slot > 0) return Math.floor(env_slot);
  const default_slot = Number(SERVICE_CONFIG.DEFAULT_DATA_SLOT ?? 1);
  return Number.isFinite(default_slot) && default_slot > 0 ? Math.floor(default_slot) : 1;
}

export function get_boot_role(): ThaumBootRole {
  const raw = String(process.env.THAUM_BOOT_ROLE ?? "").trim().toLowerCase();
  if (raw === "host") return "host";
  if (raw === "client") return "client";
  return "unknown";
}

export function should_manage_ollama(): boolean {
  if (process.env.THAUM_MANAGE_OLLAMA === "true") return true;
  if (process.env.THAUM_MANAGE_OLLAMA === "false") return false;
  return get_boot_role() === "host";
}

export function should_run_host_cli(): boolean {
  if (process.env.THAUM_ENABLE_HOST_CLI === "true") return true;
  if (process.env.THAUM_ENABLE_HOST_CLI === "false") return false;
  return false;
}

export function get_host_session_file_path(slot?: number): string {
  const explicit = String(process.env.THAUM_HOST_SESSION_FILE ?? "").trim();
  if (explicit) return explicit;
  const resolvedSlot = typeof slot === "number" && Number.isFinite(slot) && slot > 0
    ? Math.floor(slot)
    : get_configured_data_slot();
  return path.join(process.cwd(), "local_data", `data_slot_${resolvedSlot}`, "host_session.json");
}
