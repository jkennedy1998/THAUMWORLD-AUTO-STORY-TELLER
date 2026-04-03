import type { TagInstance } from "./registry.js";
import { get_tag_stacking_mode } from "./definitions.js";
import { tag_key } from "./tag_key.js";

export type EffectiveTagRemoveOp = {
  key: string;
  mag: number;
};

export function clone_tag_instance(tag: TagInstance): TagInstance {
  return JSON.parse(JSON.stringify(tag ?? {})) as TagInstance;
}

export function normalize_tag_instances(tags: unknown): TagInstance[] {
  if (!Array.isArray(tags)) return [];
  return tags
    .filter((tag) => !!tag && typeof tag === "object" && String((tag as any).name ?? "").trim().length > 0)
    .map((tag) => {
      const next = clone_tag_instance(tag as TagInstance);
      if (typeof next.mag !== "number" || !Number.isFinite(next.mag)) next.mag = 1;
      if (!Array.isArray(next.meta)) next.meta = [];
      return next;
    });
}

function normalize_mag(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

export function build_tag_delta_from_base_and_desired(base_tags: TagInstance[], desired_tags: TagInstance[]): { tag_add: TagInstance[]; tag_remove: EffectiveTagRemoveOp[] } {
  const tag_add: TagInstance[] = [];
  const tag_remove: EffectiveTagRemoveOp[] = [];
  const desired_by_key = new Map<string, TagInstance[]>();
  const base_by_key = new Map<string, TagInstance[]>();

  for (const tag of desired_tags) {
    const key = tag_key(tag);
    const list = desired_by_key.get(key) ?? [];
    list.push(tag);
    desired_by_key.set(key, list);
  }
  for (const tag of base_tags) {
    const key = tag_key(tag);
    const list = base_by_key.get(key) ?? [];
    list.push(tag);
    base_by_key.set(key, list);
  }

  const all_keys = new Set<string>([...base_by_key.keys(), ...desired_by_key.keys()]);
  for (const key of all_keys) {
    const base_list = base_by_key.get(key) ?? [];
    const desired_list = desired_by_key.get(key) ?? [];
    const name = String((desired_list[0] ?? base_list[0])?.name ?? "");
    const stacking = get_tag_stacking_mode(name);

    if (stacking === "sum") {
      const base_mag = base_list.reduce((sum, tag) => sum + normalize_mag(tag.mag, 1), 0);
      const desired_mag = desired_list.reduce((sum, tag) => sum + normalize_mag(tag.mag, 1), 0);
      if (desired_mag > base_mag) {
        const seed = desired_list[0] ?? base_list[0];
        if (seed) {
          const add_tag = clone_tag_instance(seed);
          add_tag.mag = desired_mag - base_mag;
          tag_add.push(add_tag);
        }
      } else if (desired_mag < base_mag) {
        tag_remove.push({ key, mag: base_mag - desired_mag });
      }
      continue;
    }

    const base_tag = base_list[0] ?? null;
    const desired_tag = desired_list[0] ?? null;
    const base_raw = base_tag ? JSON.stringify(base_tag) : null;
    const desired_raw = desired_tag ? JSON.stringify(desired_tag) : null;

    if (base_tag && !desired_tag) {
      tag_remove.push({ key, mag: Math.max(1, normalize_mag(base_tag.mag, 1)) });
      continue;
    }
    if (!base_tag && desired_tag) {
      tag_add.push(clone_tag_instance(desired_tag));
      continue;
    }
    if (base_tag && desired_tag && base_raw !== desired_raw) {
      tag_remove.push({ key, mag: Math.max(1, normalize_mag(base_tag.mag, 1)) });
      tag_add.push(clone_tag_instance(desired_tag));
    }
  }

  return { tag_add, tag_remove };
}
