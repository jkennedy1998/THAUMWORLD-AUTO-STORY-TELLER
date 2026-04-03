export type ResolvedSurfaceTarget = {
  container_id: string;
  slot_index: number | null;
};

const SURFACE_PREFIX = "surface_target|";
const SLOT_PREFIX = "slot_target|";

export function build_surface_target_id(container_id: string): string {
  return `${SURFACE_PREFIX}${container_id}`;
}

export function build_slot_target_id(container_id: string, slot_index: number): string {
  return `${SLOT_PREFIX}${container_id}|${Math.max(0, Math.floor(slot_index))}`;
}

export function resolve_surface_target_id(target_id: string | null | undefined): ResolvedSurfaceTarget | null {
  const raw = String(target_id ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith(SURFACE_PREFIX)) {
    const container_id = raw.slice(SURFACE_PREFIX.length);
    return container_id ? { container_id, slot_index: null } : null;
  }
  if (raw.startsWith(SLOT_PREFIX)) {
    const rest = raw.slice(SLOT_PREFIX.length);
    const last_sep = rest.lastIndexOf("|");
    if (last_sep < 1) return null;
    const container_id = rest.slice(0, last_sep);
    const slot_raw = rest.slice(last_sep + 1);
    const slot_index = Number(slot_raw);
    if (!container_id || !Number.isFinite(slot_index)) return null;
    return { container_id, slot_index: Math.max(0, Math.floor(slot_index)) };
  }
  return null;
}

export function get_container_id_from_target_id(target_id: string | null | undefined): string | null {
  const resolved = resolve_surface_target_id(target_id);
  return resolved?.container_id ?? null;
}
