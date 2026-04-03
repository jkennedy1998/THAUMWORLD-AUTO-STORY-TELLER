import type { TagInstance } from "../tag_system/registry.js";

export type AwarenessClarity = "clear" | "obscured";

export type AwarenessEntry = {
  target_ref: string;
  clarity?: AwarenessClarity;
  updated_at?: string;
};

function normalize_target_ref(value: unknown): string {
  return String(value ?? "").trim();
}

function normalize_clarity(value: unknown): AwarenessClarity | undefined {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "obscured") return "obscured";
  if (raw === "clear") return "clear";
  return undefined;
}

function normalize_entry(value: unknown): AwarenessEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const target_ref = normalize_target_ref((value as any).target_ref);
  if (!target_ref) return null;
  const clarity = normalize_clarity((value as any).clarity);
  const updated_at = typeof (value as any).updated_at === "string" && String((value as any).updated_at).trim()
    ? String((value as any).updated_at).trim()
    : undefined;
  return { target_ref, clarity, updated_at };
}

function awareness_from_tag(tag: TagInstance): AwarenessEntry | null {
  if (String(tag?.name ?? "").trim().toUpperCase() !== "AWARENESS") return null;
  const info = Array.isArray(tag?.info) ? tag.info : [];
  const target_ref = normalize_target_ref(info[0]);
  if (!target_ref) return null;
  const clarity = normalize_clarity(info.find((entry) => normalize_clarity(entry)));
  return {
    target_ref,
    clarity,
    updated_at: new Date().toISOString(),
  };
}

export function get_awareness_list(entity: Record<string, unknown> | null | undefined): AwarenessEntry[] {
  const raw = (entity as any)?.awareness;
  if (!Array.isArray(raw)) return [];
  const deduped = new Map<string, AwarenessEntry>();
  for (const value of raw) {
    const entry = normalize_entry(value);
    if (!entry) continue;
    deduped.set(entry.target_ref, entry);
  }
  return [...deduped.values()];
}

export function set_awareness_entry(entity: Record<string, unknown>, target_ref: string, clarity?: string | null): boolean {
  const target = normalize_target_ref(target_ref);
  if (!target) return false;
  const current = get_awareness_list(entity);
  const normalized = normalize_clarity(clarity);
  const next: AwarenessEntry = {
    target_ref: target,
    clarity: normalized,
    updated_at: new Date().toISOString(),
  };
  const idx = current.findIndex((entry) => entry.target_ref === target);
  if (idx >= 0) current[idx] = next;
  else current.push(next);
  (entity as any).awareness = current;
  return true;
}

export function has_awareness_entry(entity: Record<string, unknown> | null | undefined, target_ref: string): boolean {
  const target = normalize_target_ref(target_ref);
  if (!target) return false;
  return get_awareness_list(entity).some((entry) => entry.target_ref === target);
}

export function migrate_awareness_tags_to_state(entity: Record<string, unknown>): boolean {
  let changed = false;
  const migrate_list = (tags: unknown): TagInstance[] => {
    if (!Array.isArray(tags)) return [];
    const kept: TagInstance[] = [];
    for (const raw of tags) {
      const tag = raw as TagInstance;
      const awareness = awareness_from_tag(tag);
      if (awareness) {
        set_awareness_entry(entity, awareness.target_ref, awareness.clarity ?? null);
        changed = true;
        continue;
      }
      kept.push(tag);
    }
    return kept;
  };

  const legacy_tags = migrate_list((entity as any).tags);
  const tag_add = migrate_list((entity as any).tag_add);
  const before_tags = JSON.stringify((entity as any).tags ?? []);
  const before_tag_add = JSON.stringify((entity as any).tag_add ?? []);
  if (before_tags !== JSON.stringify(legacy_tags)) {
    (entity as any).tags = legacy_tags;
    changed = true;
  }
  if (before_tag_add !== JSON.stringify(tag_add)) {
    (entity as any).tag_add = tag_add;
    changed = true;
  }
  return changed;
}
