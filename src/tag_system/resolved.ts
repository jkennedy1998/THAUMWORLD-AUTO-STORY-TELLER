import {
  get_tag_definition,
  type NormalizedTagDefinition,
  type NormalizedRuntimeProjection,
} from "./definitions.js";
import type { TagInstance } from "./registry.js";
import { apply_tag_deltas, type TagRemoveOp } from "./tag_deltas.js";
import { tag_key } from "./tag_key.js";
import { compute_dimension_value_delta } from "../mag/value.js";

export type ResolvedTagState = {
  key: string;
  name: string;
  definition: NormalizedTagDefinition | null;
  source: string | null;
  expiry: number | null;
  meta: string[];
  scope: string[];
  stored_mag: number;
  dim_mag: Record<string, number>;
  info: unknown[] | undefined;
  value_mag: number;
};

function normalize_mag(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function normalize_dim_mag(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!key) continue;
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    out[key] = Math.floor(n);
  }
  return out;
}

function build_resolved_dim_mag(definition: NormalizedTagDefinition | null, instance: TagInstance): Record<string, number> {
  const out: Record<string, number> = {};
  if (definition) {
    for (const dimension of definition.dimensions) {
      out[dimension.id] = dimension.default_mag;
    }
  }
  const instance_dims = normalize_dim_mag(instance.dim_mag);
  for (const [key, value] of Object.entries(instance_dims)) {
    out[key] = value;
  }
  return out;
}

function compute_tag_value_mag(definition: NormalizedTagDefinition | null, stored_mag: number, dim_mag: Record<string, number>): number {
  if (!definition) return stored_mag;
  const base_value = definition.base_tag_value_mag;
  const dimension_delta = compute_dimension_value_delta(definition, dim_mag);
  if (definition.quantity_dimension_id) {
    return base_value + dimension_delta + Math.max(0, stored_mag - 1);
  }
  return base_value + dimension_delta;
}

export function resolve_tag_state(definition: NormalizedTagDefinition | null, instance: TagInstance): ResolvedTagState {
  const dim_mag = build_resolved_dim_mag(definition, instance);
  const stored_mag = definition?.quantity_dimension_id
    ? normalize_mag(dim_mag[definition.quantity_dimension_id], normalize_mag(instance.mag, 1))
    : normalize_mag(instance.mag, 1);
  return {
    key: tag_key(instance),
    name: String(instance?.name ?? "").trim().toUpperCase(),
    definition,
    source: typeof instance.source === "string" ? instance.source : null,
    expiry: typeof instance.expiry === "number" && Number.isFinite(instance.expiry) ? instance.expiry : null,
    meta: Array.isArray(instance.meta) ? [...instance.meta].map((entry) => String(entry ?? "").trim().toUpperCase()).filter(Boolean) : [],
    scope: Array.isArray(instance.scope) ? [...instance.scope].map((entry) => String(entry ?? "").trim().toUpperCase()).filter(Boolean) : [],
    stored_mag,
    dim_mag,
    info: Array.isArray(instance.info) ? [...instance.info] : instance.info,
    value_mag: compute_tag_value_mag(definition, stored_mag, dim_mag),
  };
}

export function resolve_tag_state_from_instance(instance: TagInstance): ResolvedTagState {
  const definition = get_tag_definition(String(instance?.name ?? ""));
  return resolve_tag_state(definition, instance);
}

export function resolve_tag_states_from_instances(tags: TagInstance[]): ResolvedTagState[] {
  const items = Array.isArray(tags) ? tags : [];
  return items.map((tag) => resolve_tag_state_from_instance(tag));
}

export function resolve_tag_states(opts: {
  base: TagInstance[];
  add?: TagInstance[];
  remove?: TagRemoveOp[];
}): ResolvedTagState[] {
  const tags = apply_tag_deltas(opts);
  return resolve_tag_states_from_instances(tags);
}

export function get_tag_dim_mag(tag_state: ResolvedTagState, dim_id: string): number {
  const key = String(dim_id ?? "").trim();
  if (!key) return 0;
  return normalize_mag(tag_state?.dim_mag?.[key], 0);
}

export function get_tag_value_mag(tag_state: ResolvedTagState): number {
  return normalize_mag(tag_state?.value_mag, 0);
}

export function project_tag_runtime_value(tag_state: ResolvedTagState, dim_id: string): {
  projection: NormalizedRuntimeProjection | null;
  dim_mag: number;
} {
  const key = String(dim_id ?? "").trim();
  if (!key) return { projection: null, dim_mag: 0 };
  const dimension = tag_state.definition?.dimensions.find((entry) => entry.id === key) ?? null;
  return {
    projection: dimension?.runtime_projection ?? null,
    dim_mag: get_tag_dim_mag(tag_state, key),
  };
}
