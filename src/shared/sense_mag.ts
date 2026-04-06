import { load_actor } from "../actor_storage/store.js";
import { DISTANCE_MAG_TABLE } from "../inspection/clarity_system.js";
import { load_npc } from "../npc_storage/store.js";
import type { SenseType } from "../action_system/perception.js";

export type SupportedSenseType = "light" | "pressure";

type SenseRangeBands = {
  detailed_mag: number | null;
  obscured_mag: number | null;
};

const LIGHT_RANGE_BY_SENSE_MAG: Record<number, SenseRangeBands> = {
  0: { detailed_mag: null, obscured_mag: null },
  1: { detailed_mag: null, obscured_mag: 1 },
  2: { detailed_mag: 3, obscured_mag: 4 },
  3: { detailed_mag: 4, obscured_mag: 5 },
  4: { detailed_mag: 5, obscured_mag: 6 },
  5: { detailed_mag: 6, obscured_mag: 7 },
};

const PRESSURE_RANGE_BY_SENSE_MAG: Record<number, SenseRangeBands> = {
  0: { detailed_mag: 0, obscured_mag: 1 },
  1: { detailed_mag: 0, obscured_mag: 2 },
  2: { detailed_mag: 0, obscured_mag: 3 },
  3: { detailed_mag: 1, obscured_mag: 4 },
  4: { detailed_mag: 1, obscured_mag: 5 },
  5: { detailed_mag: 2, obscured_mag: 6 },
};

const DEFAULT_SENSE_MAG: Record<SupportedSenseType, number> = {
  light: 2,
  pressure: 2,
};

type DetectionClarity = "clear" | "obscured" | "none";

export type SenseDetectionResult = {
  sense: SupportedSenseType;
  clarity: DetectionClarity;
  identity_known: boolean;
  location_known: boolean;
  observer_sense_mag: number;
  broadcast_mag: number;
  detailed_range_tiles: number;
  obscured_range_tiles: number;
};

function clamp_supported_mag(value: unknown): number {
  const num = Math.floor(Number(value));
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(5, num));
}

function lookup_distance_tiles(distance_mag: number | null): number {
  if (distance_mag === null) return 0;
  const clamped = Math.max(-2, Math.min(7, Math.floor(distance_mag)));
  return DISTANCE_MAG_TABLE[clamped] ?? 0;
}

function get_range_bands(sense: SupportedSenseType, sense_mag: number): SenseRangeBands {
  const clamped = clamp_supported_mag(sense_mag);
  const fallback = sense === "light"
    ? { detailed_mag: 3, obscured_mag: 4 }
    : { detailed_mag: 0, obscured_mag: 3 };
  return sense === "light"
    ? (LIGHT_RANGE_BY_SENSE_MAG[clamped] || fallback)
    : (PRESSURE_RANGE_BY_SENSE_MAG[clamped] || fallback);
}

function read_mag_from_tags(entity: Record<string, unknown> | null | undefined, names: string[], fallback: number): number {
  const senses = entity && typeof entity === "object" ? (entity as any).senses : null;
  if (senses && typeof senses === "object") {
    if (names.includes("LIGHT") || names.includes("SENSE_LIGHT") || names.includes("LIGHT_SENSE") || names.includes("VISION") || names.includes("SIGHT")) {
      const mag = Number((senses as any).light);
      if (Number.isFinite(mag)) return clamp_supported_mag(mag);
    }
    if (names.includes("PRESSURE") || names.includes("SENSE_PRESSURE") || names.includes("PRESSURE_SENSE") || names.includes("HEARING")) {
      const mag = Number((senses as any).pressure);
      if (Number.isFinite(mag)) return clamp_supported_mag(mag);
    }
  }

  const resolved = Array.isArray((entity as any)?.resolved_tag_states) ? (entity as any).resolved_tag_states : [];
  for (const entry of resolved) {
    const name = String(entry?.name ?? "").trim().toUpperCase();
    if (!names.includes(name)) continue;
    const mag = Number(entry?.stored_mag);
    if (Number.isFinite(mag)) return clamp_supported_mag(mag);
  }

  const raw_tags = Array.isArray((entity as any)?.tags) ? (entity as any).tags : [];
  for (const entry of raw_tags) {
    const name = String(entry?.name ?? "").trim().toUpperCase();
    if (!names.includes(name)) continue;
    const mag = Number(entry?.mag);
    if (Number.isFinite(mag)) return clamp_supported_mag(mag);
  }

  return fallback;
}

export function get_entity_sense_mag(entity: Record<string, unknown> | null | undefined, sense: SupportedSenseType): number {
  if (sense === "light") {
    return read_mag_from_tags(entity, ["LIGHT", "SENSE_LIGHT", "LIGHT_SENSE", "VISION", "SIGHT"], DEFAULT_SENSE_MAG.light);
  }
  return read_mag_from_tags(entity, ["PRESSURE", "SENSE_PRESSURE", "PRESSURE_SENSE", "HEARING"], DEFAULT_SENSE_MAG.pressure);
}

export function get_observer_sense_mag(slot: number, observer_ref: string, sense: SupportedSenseType): number {
  if (observer_ref.startsWith("actor.")) {
    const result = load_actor(slot, observer_ref.replace(/^actor\./, ""));
    return result.ok && result.actor ? get_entity_sense_mag(result.actor as Record<string, unknown>, sense) : DEFAULT_SENSE_MAG[sense];
  }
  if (observer_ref.startsWith("npc.")) {
    const result = load_npc(slot, observer_ref.replace(/^npc\./, ""));
    return result.ok && result.npc ? get_entity_sense_mag(result.npc as Record<string, unknown>, sense) : DEFAULT_SENSE_MAG[sense];
  }
  return DEFAULT_SENSE_MAG[sense];
}

export function evaluate_sense_detection(
  sense: SupportedSenseType,
  observer_sense_mag: number,
  broadcast_mag: number,
  distance_tiles: number,
): SenseDetectionResult {
  const bands = get_range_bands(sense, observer_sense_mag);
  const detailed_range_tiles = lookup_distance_tiles(bands.detailed_mag === null ? null : bands.detailed_mag + broadcast_mag);
  const obscured_range_tiles = lookup_distance_tiles(bands.obscured_mag === null ? null : bands.obscured_mag + broadcast_mag);

  let clarity: DetectionClarity = "none";
  if (detailed_range_tiles > 0 && distance_tiles <= detailed_range_tiles) clarity = "clear";
  else if (obscured_range_tiles > 0 && distance_tiles <= obscured_range_tiles) clarity = "obscured";

  const location_known = clarity !== "none";
  const identity_known = sense === "light" && clarity === "clear";

  return {
    sense,
    clarity,
    identity_known,
    location_known,
    observer_sense_mag: clamp_supported_mag(observer_sense_mag),
    broadcast_mag: Math.floor(Number(broadcast_mag) || 0),
    detailed_range_tiles,
    obscured_range_tiles,
  };
}

export function get_obscured_detection_range_tiles(
  sense: SupportedSenseType,
  observer_sense_mag: number,
  broadcast_mag: number,
): number {
  return evaluate_sense_detection(sense, observer_sense_mag, broadcast_mag, 0).obscured_range_tiles;
}

export function is_supported_runtime_sense(sense: SenseType): sense is SupportedSenseType {
  return sense === "light" || sense === "pressure";
}
