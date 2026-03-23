import type { Place, PlaceTile } from "../types/place.js";

export function get_place_base_z(place: Place | null | undefined): number {
  return Math.floor(Number((place as any)?.coordinates?.elevation ?? 0)) || 0;
}

export function tile_layer_key_to_offset(key: string): number | null {
  if (key === "tiles") return 0;
  const m = /^tiles_z(-?\d+)$/.exec(String(key ?? ""));
  if (!m) return null;
  const raw = Math.floor(Number(m[1]));
  if (!Number.isFinite(raw)) return null;
  return raw === 0 ? -1 : raw;
}

export function tile_offset_to_layer_key(offset: number): string {
  const normalized = Math.floor(Number(offset) || 0);
  if (normalized === 0) return "tiles";
  return normalized === -1 ? "tiles_z0" : `tiles_z${normalized}`;
}

export function get_place_tile_layer(place: Place | null | undefined, offset: number): any | null {
  const layer_key = tile_offset_to_layer_key(offset);
  return (place as any)?.[layer_key] ?? null;
}

export function get_place_tile_at_world_z(place: Place | null | undefined, tile_x: number, tile_y: number, world_z: number): PlaceTile | null {
  try {
    const offset = Math.floor(Number(world_z) - Number(get_place_base_z(place)));
    if (!Number.isFinite(offset)) return null;
    return (get_place_tile_layer(place, offset)?.cells?.[tile_y]?.[tile_x] ?? null) as PlaceTile | null;
  } catch {
    return null;
  }
}

export function get_defined_place_world_zs(place: Place | null | undefined): number[] {
  const base_z = get_place_base_z(place);
  const out = new Set<number>();
  if ((place as any)?.tiles) out.add(base_z);
  for (const key of Object.keys((place as any) ?? {})) {
    const offset = tile_layer_key_to_offset(key);
    if (offset === null) continue;
    out.add(base_z + offset);
  }
  return Array.from(out).sort((a, b) => a - b);
}
