import type { TagInstance } from "./registry.js";
import { get_tag_stacking_mode } from "./definitions.js";
import { tag_key } from "./tag_key.js";

export type TagRemoveOp = {
  key: string;
  mag: number;
};

function clone_tag(t: TagInstance): TagInstance {
  return {
    name: t.name,
    mag: t.mag,
    dim_mag: t.dim_mag && typeof t.dim_mag === "object"
      ? Object.fromEntries(
          Object.entries(t.dim_mag)
            .filter(([key, value]) => key && typeof value === "number" && Number.isFinite(value))
            .map(([key, value]) => [key, Math.floor(value)]),
        )
      : undefined,
    meta: Array.isArray(t.meta) ? [...t.meta] : [],
    info: Array.isArray(t.info) ? [...t.info] : t.info,
    source: t.source,
    expiry: t.expiry,
    scope: Array.isArray(t.scope) ? [...t.scope] : t.scope,
  };
}

function normalize_mag(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function merge_dimension_mag(existing: TagInstance, incoming: TagInstance): void {
  const next = { ...(existing.dim_mag ?? {}) } as Record<string, number>;
  const source = incoming.dim_mag ?? {};
  let has_any = Object.keys(next).length > 0;
  for (const [key, value] of Object.entries(source)) {
    if (!key) continue;
    const amt = normalize_mag(value, 0);
    if (!Number.isFinite(amt)) continue;
    next[key] = normalize_mag(next[key], 0) + amt;
    has_any = true;
  }
  if (has_any) existing.dim_mag = next;
}

function merge_stack_like_fields(existing: TagInstance, incoming: TagInstance, incoming_mag: number): void {
  existing.mag = normalize_mag(existing.mag, 1) + incoming_mag;
  merge_dimension_mag(existing, incoming);
}

function reduce_stack_like_fields(existing: TagInstance, amount: number): void {
  existing.mag = Math.max(0, normalize_mag(existing.mag, 1) - amount);
  if (existing.dim_mag && typeof existing.dim_mag === "object") {
    const next: Record<string, number> = {};
    for (const [key, value] of Object.entries(existing.dim_mag)) {
      const reduced = Math.max(0, normalize_mag(value, 0) - amount);
      if (reduced > 0) next[key] = reduced;
    }
    existing.dim_mag = Object.keys(next).length > 0 ? next : undefined;
  }
}

/**
 * Apply remove+add ops on top of base tags.
 * Multi-instance tags are keyed by tag_key(); stacks are tracked via mag.
 */
export function apply_tag_deltas(opts: {
  base: TagInstance[];
  add?: TagInstance[];
  remove?: TagRemoveOp[];
}): TagInstance[] {
  const base = Array.isArray(opts.base) ? opts.base : [];
  const add = Array.isArray(opts.add) ? opts.add : [];
  const remove = Array.isArray(opts.remove) ? opts.remove : [];

  const by_key = new Map<string, TagInstance>();

  for (const t of base) {
    if (!t || !t.name) continue;
    const k = tag_key(t);
    const existing = by_key.get(k);
    const stacking = get_tag_stacking_mode(String(t.name));
    if (existing && stacking === "sum") {
      merge_stack_like_fields(existing, t, normalize_mag(t.mag, 1));
    } else if (!existing) {
      const cloned = clone_tag({ ...t, mag: normalize_mag(t.mag, 1) } as TagInstance);
      by_key.set(k, cloned);
    }
  }

  for (const op of remove) {
    const k = String(op?.key ?? "");
    const amt = typeof op?.mag === "number" && Number.isFinite(op.mag) ? Math.max(0, Math.floor(op.mag)) : 0;
    if (!k || amt <= 0) continue;
    const existing = by_key.get(k);
    if (!existing) continue;
    const stacking = get_tag_stacking_mode(String(existing.name));
    if (stacking !== "sum") {
      by_key.delete(k);
      continue;
    }
    reduce_stack_like_fields(existing, amt);
    if (existing.mag <= 0) by_key.delete(k);
  }

  for (const t of add) {
    if (!t || !t.name) continue;
    const k = tag_key(t);
    const amt = typeof t.mag === "number" && Number.isFinite(t.mag) ? Math.max(1, Math.floor(t.mag)) : 1;
    const existing = by_key.get(k);
    const stacking = get_tag_stacking_mode(String(t.name));
    if (existing && stacking === "sum") {
      merge_stack_like_fields(existing, t, amt);
    } else if (!existing) {
      const cloned = clone_tag({ ...t, mag: amt } as TagInstance);
      by_key.set(k, cloned);
    }
  }

  return Array.from(by_key.values());
}
