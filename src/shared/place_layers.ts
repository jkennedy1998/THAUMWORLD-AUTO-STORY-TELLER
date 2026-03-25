import type { Place, PlaceTile } from "../types/place.js";
import type { Voxel3 } from './coords.js';

export function get_place_base_world_z(place: Place | null | undefined): number {
  return Math.floor(Number((place as any)?.coordinates?.elevation ?? 0)) || 0;
}

export function get_place_base_z(place: Place | null | undefined): number {
  return get_place_base_world_z(place);
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

export function get_place_layer_key_for_world_z(place: Place | null | undefined, world_z: number): string | null {
  const offset = world_z_to_layer_offset(place, world_z);
  if (offset == null) return null;
  return tile_offset_to_layer_key(offset);
}

export function world_z_to_layer_offset(place: Place | null | undefined, world_z: number): number | null {
  const offset = Math.floor(Number(world_z) - Number(get_place_base_world_z(place)));
  if (!Number.isFinite(offset)) return null;
  return offset;
}

export function layer_offset_to_world_z(place: Place | null | undefined, offset: number): number {
  return get_place_base_world_z(place) + Math.floor(Number(offset) || 0);
}

export function get_place_tile_at_world_z(place: Place | null | undefined, tile_x: number, tile_y: number, world_z: number): PlaceTile | null {
  try {
    const offset = world_z_to_layer_offset(place, world_z);
    if (offset == null || !Number.isFinite(offset)) return null;
    return (get_place_tile_layer(place, offset)?.cells?.[tile_y]?.[tile_x] ?? null) as PlaceTile | null;
  } catch {
    return null;
  }
}

export function get_place_tile_kind_at_world_z(place: Place | null | undefined, tile_x: number, tile_y: number, world_z: number): string | null {
  try {
    const p: any = place as any;
    if (!p) return null;
    const structure = Array.isArray(p.structures)
      ? p.structures.find((s: any) => {
          const origin = s?.origin;
          if (!origin) return false;
          const ox = Math.floor(Number(origin.x) || 0);
          const oy = Math.floor(Number(origin.y) || 0);
          const oz = Math.floor(Number(origin.z) || 0);
          const phys = Array.isArray(s?.body_model?.physical) ? s.body_model.physical : [{ dx: 0, dy: 0, dz: 0 }];
          return phys.some((v: any) => (
            ox + Math.floor(Number(v?.dx ?? 0)) === tile_x &&
            oy + Math.floor(Number(v?.dy ?? 0)) === tile_y &&
            oz + Math.floor(Number(v?.dz ?? 0)) === world_z
          ));
        })
      : null;
    if (structure) return String((structure as any)?.def_id ?? (structure as any)?.kind ?? '').trim() || null;

    const tile = get_place_tile_at_world_z(place, tile_x, tile_y, world_z);
    const kind = String((tile as any)?.kind ?? '').trim();
    return kind || null;
  } catch {
    return null;
  }
}

export function get_place_tile_at_world_voxel(place: Place | null | undefined, voxel: Voxel3): PlaceTile | null {
  return get_place_tile_at_world_z(place, voxel.x, voxel.y, voxel.z);
}

export function set_place_tile_at_world_voxel(place: Place | null | undefined, voxel: Voxel3, tile: PlaceTile | null): boolean {
  try {
    const layer_key = get_place_layer_key_for_world_z(place, voxel.z);
    if (!layer_key || !place) return false;
    const layer = (place as any)?.[layer_key];
    if (!layer?.cells?.[voxel.y]) return false;
    layer.cells[voxel.y][voxel.x] = tile;
    return true;
  } catch {
    return false;
  }
}

export function get_defined_place_world_zs(place: Place | null | undefined): number[] {
  const base_z = get_place_base_world_z(place);
  const out = new Set<number>();
  if ((place as any)?.tiles) out.add(base_z);
  for (const key of Object.keys((place as any) ?? {})) {
    const offset = tile_layer_key_to_offset(key);
    if (offset === null) continue;
    out.add(base_z + offset);
  }
  return Array.from(out).sort((a, b) => a - b);
}

export function list_place_world_z_layers(place: Place | null | undefined): number[] {
  return get_defined_place_world_zs(place);
}
