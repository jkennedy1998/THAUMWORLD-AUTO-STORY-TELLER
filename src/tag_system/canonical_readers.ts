import type { ResolvedTagState } from "./resolved.js";
import { has_awareness_entry } from "../shared/awareness.js";

function normalize_resolved_tag_states(entity: Record<string, unknown> | null | undefined): ResolvedTagState[] {
  const raw = (entity as any)?.resolved_tag_states;
  return Array.isArray(raw) ? (raw as ResolvedTagState[]) : [];
}

function normalize_tag_name(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

export function get_resolved_tag_states_from_entity(entity: Record<string, unknown> | null | undefined): ResolvedTagState[] {
  return normalize_resolved_tag_states(entity);
}

export function get_resolved_tag_state(entity: Record<string, unknown> | null | undefined, tag_name: string): ResolvedTagState | null {
  const want = normalize_tag_name(tag_name);
  return normalize_resolved_tag_states(entity).find((tag) => normalize_tag_name(tag.name) === want) ?? null;
}

export function get_resolved_tag_stored_mag(entity: Record<string, unknown> | null | undefined, tag_name: string): number {
  const match = get_resolved_tag_state(entity, tag_name);
  return match ? Math.max(0, Math.floor(Number(match.stored_mag ?? 0) || 0)) : 0;
}

export function has_resolved_tag(entity: Record<string, unknown> | null | undefined, tag_name: string): boolean {
  return !!get_resolved_tag_state(entity, tag_name);
}

export function get_status_effect_names(entity: Record<string, unknown> | null | undefined): string[] {
  return normalize_resolved_tag_states(entity)
    .filter((tag) => normalize_tag_name(tag.name) !== "AWARENESS")
    .map((tag) => String(tag.name).toLowerCase())
    .slice(0, 3);
}

export function has_awareness_target(entity: Record<string, unknown> | null | undefined, target_ref: string): boolean {
  const want = String(target_ref ?? "").trim();
  if (!want) return false;
  if (has_awareness_entry(entity, want)) return true;
  return normalize_resolved_tag_states(entity).some((tag) => {
    if (normalize_tag_name(tag.name) !== "AWARENESS") return false;
    const info = Array.isArray(tag.info) ? tag.info : [];
    return info.some((entry) => String(entry ?? "") === want);
  });
}
