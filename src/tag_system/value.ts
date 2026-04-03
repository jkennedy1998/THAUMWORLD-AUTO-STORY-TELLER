import { get_tag_value_mag, type ResolvedTagState } from "./resolved.js";

export type EntityValueMagBreakdown = {
  base_value_mag: number;
  tag_value_mag: number;
  total_value_mag: number;
};

function normalize_mag(value: unknown, fallback: number = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

export function get_entity_base_value_mag(entity: { base_value_mag?: number; mag?: number } | null | undefined): number {
  if (!entity || typeof entity !== "object") return 0;
  if (typeof entity.base_value_mag === "number" && Number.isFinite(entity.base_value_mag)) {
    return normalize_mag(entity.base_value_mag, 0);
  }
  if (typeof entity.mag === "number" && Number.isFinite(entity.mag)) {
    return normalize_mag(entity.mag, 0);
  }
  return 0;
}

export function get_entity_tag_value_mag(tag_states: ResolvedTagState[] | null | undefined): number {
  const states = Array.isArray(tag_states) ? tag_states : [];
  return states.reduce((sum, tag_state) => sum + get_tag_value_mag(tag_state), 0);
}

export function get_entity_total_value_mag(entity: { base_value_mag?: number; mag?: number } | null | undefined, tag_states: ResolvedTagState[] | null | undefined): number {
  return get_entity_base_value_mag(entity) + get_entity_tag_value_mag(tag_states);
}

export function build_entity_value_mag_breakdown(entity: { base_value_mag?: number; mag?: number } | null | undefined, tag_states: ResolvedTagState[] | null | undefined): EntityValueMagBreakdown {
  const base_value_mag = get_entity_base_value_mag(entity);
  const tag_value_mag = get_entity_tag_value_mag(tag_states);
  return {
    base_value_mag,
    tag_value_mag,
    total_value_mag: base_value_mag + tag_value_mag,
  };
}
