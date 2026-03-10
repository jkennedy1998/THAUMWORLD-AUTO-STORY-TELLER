import type { TagInstance } from "./registry.js";
import { tag_key } from "./tag_key.js";

export type TagRemoveOp = {
  key: string;
  mag: number;
};

function clone_tag(t: TagInstance): TagInstance {
  return {
    name: t.name,
    mag: t.mag,
    meta: Array.isArray(t.meta) ? [...t.meta] : [],
    info: Array.isArray(t.info) ? [...t.info] : t.info,
    source: t.source,
    expiry: t.expiry,
    scope: Array.isArray(t.scope) ? [...t.scope] : t.scope,
  };
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
    if (existing) {
      existing.mag = (existing.mag || 1) + (t.mag || 1);
    } else {
      by_key.set(k, clone_tag({ ...t, mag: t.mag || 1 } as TagInstance));
    }
  }

  for (const op of remove) {
    const k = String(op?.key ?? "");
    const amt = typeof op?.mag === "number" && Number.isFinite(op.mag) ? Math.max(0, Math.floor(op.mag)) : 0;
    if (!k || amt <= 0) continue;
    const existing = by_key.get(k);
    if (!existing) continue;
    existing.mag = Math.max(0, (existing.mag || 1) - amt);
    if (existing.mag <= 0) by_key.delete(k);
  }

  for (const t of add) {
    if (!t || !t.name) continue;
    const k = tag_key(t);
    const amt = typeof t.mag === "number" && Number.isFinite(t.mag) ? Math.max(1, Math.floor(t.mag)) : 1;
    const existing = by_key.get(k);
    if (existing) {
      existing.mag = (existing.mag || 1) + amt;
    } else {
      by_key.set(k, clone_tag({ ...t, mag: amt } as TagInstance));
    }
  }

  return Array.from(by_key.values());
}
