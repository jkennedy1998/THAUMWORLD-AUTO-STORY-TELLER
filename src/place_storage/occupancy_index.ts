import type { Place } from "../types/place.js";
import type { PlaceTile } from "../types/place.js";
import { eval_body_model_voxels, get_body_model_def } from "../shared/body_model.js";
import { get_facing, type Direction } from "../npc_ai/facing_system.js";
import { build_physics_tag_flags, has_tag_name, resolve_tile_physics_tags } from "../shared/physics_tags.js";

export type PlaceOccupancyIndex = {
  width: number;
  height: number;

  // Movement blockers on the walking plane (z=1).
  blocks_movement_z1: boolean[][];

  // LOS blockers on z=1 (initially same as OCCUPIES semantics).
  blocks_los_z1: boolean[][];

  // Multi-voxel owner occupancy keyed by absolute world voxel.
  // Key format: "x_y_z".
  occupants_by_voxel: Map<string, Array<{ owner_kind: string; owner_id: string; part: string; tags: any[] }>>;
};

// NOTE: Do not cache this index for now.
// The place object is mutated in-place (movement, interactions), which can stale a WeakMap cache.
// Once correctness is proven, reintroduce caching with explicit invalidation/revisioning.

function make_bool_grid(w: number, h: number, fill: boolean): boolean[][] {
  const rows: boolean[][] = [];
  for (let y = 0; y < h; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < w; x++) row.push(fill);
    rows.push(row);
  }
  return rows;
}

function get_tile(tiles_obj: any, x: number, y: number): PlaceTile | null {
  try {
    const t = tiles_obj?.cells?.[y]?.[x];
    return (t as any) ?? null;
  } catch {
    return null;
  }
}

function tile_blocks_movement_runtime(tile: any): boolean {
  if (!tile) return false;
  return resolve_tile_physics_tags(tile).occupies;
}

function tile_blocks_los_runtime(tile: any): boolean {
  if (!tile) return false;
  return has_tag_name(resolve_tile_physics_tags(tile).effective_tags, 'COVER');
}

export function get_place_occupancy_index(place: Place): PlaceOccupancyIndex {
  const w = Math.max(1, Math.floor(Number((place as any)?.tile_grid?.width ?? 1)));
  const h = Math.max(1, Math.floor(Number((place as any)?.tile_grid?.height ?? 1)));

  const blocks_z1 = make_bool_grid(w, h, false);
  const blocks_los_z1 = make_bool_grid(w, h, false);
  const occupants_by_voxel = new Map<string, Array<{ owner_kind: string; owner_id: string; part: string; tags: any[] }>>();

  const base_z = (() => {
    try {
      const z = Number((place as any)?.coordinates?.elevation);
      return Number.isFinite(z) ? Math.floor(z) : 0;
    } catch {
      return 0;
    }
  })();

  function add_occupant(x: number, y: number, z: number, occ: { owner_kind: string; owner_id: string; part: string; tags: any[] }): void {
    const k = `${Math.floor(x)}_${Math.floor(y)}_${Math.floor(z)}`;
    const arr = occupants_by_voxel.get(k);
    if (arr) arr.push(occ);
    else occupants_by_voxel.set(k, [occ]);
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t1 = get_tile((place as any)?.tiles, x, y);
      const b = tile_blocks_movement_runtime(t1);
      blocks_z1[y]![x] = b;
      blocks_los_z1[y]![x] = tile_blocks_los_runtime(t1);
    }
  }

  // Multi-voxel character occupancy (from place contents snapshot).
  // This is used for collision/selection/raycasting in voxel-aware systems.
  try {
    const resolve_facing = (e: any, ref: string): Direction | null => {
      const f0 = String(e?.facing ?? '').toLowerCase();
      if (
        f0 === 'north' ||
        f0 === 'south' ||
        f0 === 'east' ||
        f0 === 'west' ||
        f0 === 'northeast' ||
        f0 === 'northwest' ||
        f0 === 'southeast' ||
        f0 === 'southwest'
      ) {
        return f0 as any;
      }
      try {
        return get_facing(ref);
      } catch {
        return null;
      }
    };

    const add_entity = (e: any, owner_kind: string, owner_id: string): void => {
      const tp = e?.tile_position;
      if (!tp || typeof tp.x !== 'number' || typeof tp.y !== 'number') return;
      const ez0 = Number(e?.elevation);
      const ez = Number.isFinite(ez0) ? Math.floor(ez0) : base_z;
      const def = get_body_model_def(e?.body_model_id);
      const facing = resolve_facing(e, owner_id);
      const vox = eval_body_model_voxels(def, { mode: 'physical', facing });
      for (const v of vox) {
        const x = Math.floor(tp.x) + Math.floor(Number(v.dx ?? 0));
        const y = Math.floor(tp.y) + Math.floor(Number(v.dy ?? 0));
        const z = ez + Math.floor(Number(v.dz ?? 0));
        const tags = Array.isArray((v as any)?.tags) ? (v as any).tags : [];
        add_occupant(x, y, z, { owner_kind, owner_id, part: String((v as any)?.part ?? ''), tags });
      }
    };

    for (const npc of Array.isArray((place as any)?.contents?.npcs_present) ? (place as any).contents.npcs_present : []) {
      const ref = String((npc as any)?.npc_ref ?? '');
      if (ref) add_entity(npc, 'npc', ref);
    }
    for (const actor of Array.isArray((place as any)?.contents?.actors_present) ? (place as any).contents.actors_present : []) {
      const ref = String((actor as any)?.actor_ref ?? '');
      if (ref) add_entity(actor, 'actor', ref);
    }
  } catch {
    // ignore
  }

  // Multi-voxel structure instances (from place.structures snapshot).
  try {
    for (const s of Array.isArray((place as any)?.structures) ? (place as any).structures : []) {
      const id = String((s as any)?.id ?? '');
      if (!id) continue;
      const origin = (s as any)?.origin;
      const ox = Number(origin?.x);
      const oy = Number(origin?.y);
      const oz0 = Number(origin?.z);
      if (!Number.isFinite(ox) || !Number.isFinite(oy)) continue;
      const oz = Number.isFinite(oz0) ? Math.floor(oz0) : base_z;

      const phys = Array.isArray((s as any)?.body_model?.physical)
        ? (s as any).body_model.physical
        : [{ part: 'body', dx: 0, dy: 0, dz: 0, tags: Array.isArray((s as any)?.tags) ? (s as any).tags : [] }];

      for (const v of phys) {
        const x = Math.floor(ox) + Math.floor(Number((v as any)?.dx ?? 0));
        const y = Math.floor(oy) + Math.floor(Number((v as any)?.dy ?? 0));
        const z = oz + Math.floor(Number((v as any)?.dz ?? 0));
        const tags = Array.isArray((v as any)?.tags) ? (v as any).tags : (Array.isArray((s as any)?.tags) ? (s as any).tags : []);
        add_occupant(x, y, z, { owner_kind: 'structure', owner_id: id, part: String((v as any)?.part ?? 'body'), tags });
      }
    }
  } catch {
    // ignore
  }

  const idx: PlaceOccupancyIndex = {
    width: w,
    height: h,
    blocks_movement_z1: blocks_z1,
    blocks_los_z1,
    occupants_by_voxel,
  };
  return idx;
}

export function get_voxel_occupants(place: Place, x: number, y: number, world_z: number): Array<{ owner_kind: string; owner_id: string; part: string; tags: any[] }> {
  const idx = get_place_occupancy_index(place);
  const k = `${Math.floor(x)}_${Math.floor(y)}_${Math.floor(world_z)}`;
  return idx.occupants_by_voxel.get(k) ?? [];
}

export function pick_voxel_hit_target(
  place: Place,
  x: number,
  y: number,
  world_z: number,
): { owner_kind: string; owner_id: string; part: string; voxel: { x: number; y: number; z: number } } | null {
  const occ = get_voxel_occupants(place, x, y, world_z);
  if (!occ || occ.length === 0) return null;

  // Stable priority: actors over npcs over everything else, then stable by id.
  const sorted = [...occ].sort((a, b) => {
    const pa = a.owner_kind === 'actor' ? 0 : a.owner_kind === 'npc' ? 1 : 2;
    const pb = b.owner_kind === 'actor' ? 0 : b.owner_kind === 'npc' ? 1 : 2;
    if (pa !== pb) return pa - pb;
    return String(a.owner_id).localeCompare(String(b.owner_id));
  });
  const top = sorted[0]!;
  return { owner_kind: top.owner_kind, owner_id: top.owner_id, part: top.part, voxel: { x: Math.floor(x), y: Math.floor(y), z: Math.floor(world_z) } };
}

export function place_voxel_blocks_movement(place: Place, x: number, y: number, world_z: number): boolean {
  // Out of bounds blocks.
  const idx = get_place_occupancy_index(place);
  if (x < 0 || y < 0 || x >= idx.width || y >= idx.height) return true;

  // Any OCCUPIES occupant blocks movement.
  const occ = get_voxel_occupants(place, x, y, world_z);
  if (occ.some((o) => build_physics_tag_flags(o.tags).occupies)) {
    return true;
  }

  // Tile-based semantics remain authoritative for z=1 walking plane.
  const wz = Math.floor(Number(world_z));
  if (Number.isFinite(wz)) {
    // Authored mapping: tiles live at base_z, supports at base_z-1.
    let base_z = 0;
    try {
      const z = Number((place as any)?.coordinates?.elevation);
      base_z = Number.isFinite(z) ? Math.floor(z) : 0;
    } catch {
      base_z = 0;
    }
    if (wz === base_z) {
      // z=1 in the original relative scheme.
      if (idx.blocks_movement_z1[y]?.[x]) return true;
    }
  }

  return false;
}

export function place_voxel_blocks_los(place: Place, x: number, y: number, world_z: number): boolean {
  const idx = get_place_occupancy_index(place);
  if (x < 0 || y < 0 || x >= idx.width || y >= idx.height) return true;

  // Any COVER occupant blocks LOS.
  const occ = get_voxel_occupants(place, x, y, world_z);
  if (occ.some((o) => has_tag_name(o.tags, 'COVER'))) {
    return true;
  }

  // Tile-based LOS remains authoritative on authored structure plane.
  const wz = Math.floor(Number(world_z));
  if (Number.isFinite(wz)) {
    let base_z = 0;
    try {
      const z = Number((place as any)?.coordinates?.elevation);
      base_z = Number.isFinite(z) ? Math.floor(z) : 0;
    } catch {
      base_z = 0;
    }
    if (wz === base_z) {
      return !!idx.blocks_los_z1[y]?.[x];
    }
  }
  return false;
}

export function place_tile_blocks_movement(place: Place, x: number, y: number): boolean {
  const idx = get_place_occupancy_index(place);
  if (x < 0 || y < 0 || x >= idx.width || y >= idx.height) return true;
  if (idx.blocks_movement_z1[y]?.[x]) return true;
  return false;
}

export function place_tile_blocks_los(place: Place, x: number, y: number): boolean {
  const idx = get_place_occupancy_index(place);
  if (x < 0 || y < 0 || x >= idx.width || y >= idx.height) return true;
  return !!idx.blocks_los_z1[y]?.[x];
}
