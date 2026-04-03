import type { ResolvedTagState } from "../tag_system/resolved.js";
import { normalize_signed_mag } from "./core.js";

export const CONTAINER_DEFAULT_CAPACITY_MAG = 1;
export const CONTAINER_MIN_CAPACITY_MAG = -1;

function normalize_container_capacity_mag(value: unknown, fallback: number = CONTAINER_DEFAULT_CAPACITY_MAG): number {
  return Math.max(CONTAINER_MIN_CAPACITY_MAG, normalize_signed_mag(value, fallback));
}

export function project_container_max_slots(capacity_mag: unknown): number {
  const mag = normalize_container_capacity_mag(capacity_mag, CONTAINER_DEFAULT_CAPACITY_MAG);
  return Math.max(1, 2 ** (mag + 1));
}

export function resolve_container_capacity_mag_from_states(states: ResolvedTagState[] | null | undefined): number | null {
  const resolved = Array.isArray(states) ? states : [];
  let best: number | null = null;
  for (const state of resolved) {
    if (String(state?.name ?? "").trim().toUpperCase() !== "CONTAINER") continue;
    const value = normalize_container_capacity_mag(state?.dim_mag?.container_capacity_mag, CONTAINER_DEFAULT_CAPACITY_MAG);
    if (best === null || value > best) best = value;
  }
  return best;
}
