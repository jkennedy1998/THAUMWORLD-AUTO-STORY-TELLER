import { normalize_signed_mag } from "./core.js";

export const DISPERSE_DEFAULT_PERIOD_BREATHS = 30;
export const DISPERSE_MAX_EVENTS_PER_PULSE = 1024;
export const SPOIL_DEFAULT_PERIOD_BREATHS = 300;

export function project_disperse_period_breaths(time_mag: number): number {
  const normalized = normalize_signed_mag(time_mag, 0);
  if (normalized === 0) return DISPERSE_DEFAULT_PERIOD_BREATHS;
  if (normalized > 0) return Math.max(1, Math.floor(DISPERSE_DEFAULT_PERIOD_BREATHS * (2 ** normalized)));
  return Math.max(1, Math.floor(DISPERSE_DEFAULT_PERIOD_BREATHS / (2 ** Math.abs(normalized))));
}

export function project_spoil_period_breaths(time_mag: number): number {
  const normalized = normalize_signed_mag(time_mag, 0);
  if (normalized === 0) return SPOIL_DEFAULT_PERIOD_BREATHS;
  if (normalized > 0) return Math.max(1, Math.floor(SPOIL_DEFAULT_PERIOD_BREATHS * (2 ** normalized)));
  return Math.max(1, Math.floor(SPOIL_DEFAULT_PERIOD_BREATHS / (2 ** Math.abs(normalized))));
}
