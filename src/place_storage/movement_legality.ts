import type { Place } from "../types/place.js";
import { eval_body_model_voxels, get_body_model_def } from "../shared/body_model.js";
import { get_facing, type Direction } from "../npc_ai/facing_system.js";

export type OwnerRef = { kind: "actor" | "npc" | "structure" | "item"; id: string };

export type MovementMode = "WALK" | "SWIM" | "CLIMB" | "FLY";
export type SupportPolicy = "any_footprint" | "all_footprint";

export type Voxel = { x: number; y: number; z: number };

export type MoveCheck =
  | { ok: true }
  | {
      ok: false;
      reason: "out_of_bounds" | "blocked" | "no_support" | "reserved";
      detail?: any;
    };

export type LegalityContext = {
  exclude_owner?: OwnerRef;
  reserved_stance_origins?: Set<string>; // key "x_y_z"
  support_policy?: SupportPolicy; // default: any_footprint
  // Escape hatch used by pathfinding options; not a gameplay rule.
  ignore_occupants?: boolean;
  // Allow stepping into unsupported space (e.g. walking off ledges) and let gravity resolve.
  // Default: false.
  allow_unsupported?: boolean;
};

function base_z(place: Place): number {
  try {
    const z = Number((place as any)?.coordinates?.elevation);
    return Number.isFinite(z) ? Math.floor(z) : 0;
  } catch {
    return 0;
  }
}

export function get_place_world_z_bounds(place: Place): { min_z: number; max_z: number } {
  const bz = base_z(place);

  let min_z = bz;
  let max_z = bz;

  try {
    if ((place as any)?.tiles_z0?.cells) min_z = Math.min(min_z, bz - 1);
    if ((place as any)?.tiles_z1?.cells) max_z = Math.max(max_z, bz + 1);
  } catch {
    // ignore
  }

  // Structures may extend the authored z bounds.
  try {
    const structs: any[] = Array.isArray((place as any)?.structures) ? (place as any).structures : [];
    for (const s of structs) {
      if (!s || typeof s !== 'object') continue;
      const o = (s as any).origin;
      const ox = Math.floor(Number(o?.x));
      const oy = Math.floor(Number(o?.y));
      const oz = Math.floor(Number(o?.z));
      if (!Number.isFinite(ox) || !Number.isFinite(oy) || !Number.isFinite(oz)) continue;

      let local_min = 0;
      let local_max = 0;
      try {
        const body_model_id = typeof (s as any).body_model?.id === 'string' ? String((s as any).body_model.id) : (typeof (s as any).body_model_id === 'string' ? String((s as any).body_model_id) : null);
        if (body_model_id) {
          const def = get_body_model_def(body_model_id);
          const facing = resolve_entity_facing(s, String((s as any).id ?? ''));
          const vox = eval_body_model_voxels(def, { mode: 'physical', facing });
          for (const v of vox) {
            const dz = Math.floor(Number((v as any).dz ?? 0));
            if (!Number.isFinite(dz)) continue;
            local_min = Math.min(local_min, dz);
            local_max = Math.max(local_max, dz);
          }
        } else {
          // No body model: treat origin voxel as the only voxel.
          local_min = 0;
          local_max = 0;
        }
      } catch {
        // ignore
      }

      min_z = Math.min(min_z, oz + local_min);
      max_z = Math.max(max_z, oz + local_max);
    }
  } catch {
    // ignore
  }

  // Clamp min/max into a sane ordering.
  if (min_z > max_z) {
    const t = min_z;
    min_z = max_z;
    max_z = t;
  }

  return { min_z, max_z };
}

function key_xyz(x: number, y: number, z: number): string {
  return `${Math.floor(x)}_${Math.floor(y)}_${Math.floor(z)}`;
}

function get_tile_at_world_z(place: Place, x: number, y: number, world_z: number): any | null {
  try {
    const bz = base_z(place);
    const wz = Math.floor(Number(world_z));
    if (!Number.isFinite(wz)) return null;
    if (wz === bz - 1) return ((place as any)?.tiles_z0?.cells?.[y]?.[x] ?? null) as any;
    if (wz === bz) return ((place as any)?.tiles?.cells?.[y]?.[x] ?? null) as any;
    if (wz === bz + 1) return ((place as any)?.tiles_z1?.cells?.[y]?.[x] ?? null) as any;
    return null;
  } catch {
    return null;
  }
}

function has_tag(tags: any, name: string): boolean {
  const up = String(name ?? "").toUpperCase();
  if (!Array.isArray(tags)) return false;
  return tags.some((t: any) => String(t?.name ?? "").toUpperCase() === up);
}

function tile_has_occupies(place: Place, x: number, y: number, z: number): boolean {
  const t = get_tile_at_world_z(place, x, y, z);
  if (!t) return false;
  return has_tag((t as any)?.tags ?? [], "OCCUPIES");
}

function resolve_entity_facing(e: any, owner_id: string): Direction | null {
  const f0 = String(e?.facing ?? "").toLowerCase();
  if (
    f0 === "north" ||
    f0 === "south" ||
    f0 === "east" ||
    f0 === "west" ||
    f0 === "northeast" ||
    f0 === "northwest" ||
    f0 === "southeast" ||
    f0 === "southwest"
  ) {
    return f0 as any;
  }
  // Fallback: current in-memory facing state.
  try {
    return get_facing(owner_id);
  } catch {
    return null;
  }
}

type OccupantInfo = { owner_kind: string; owner_id: string; part: string; tags: any[] };

const move_unify_support_occupant_marked = new Set<string>();

function owner_matches(a: OwnerRef | null | undefined, b: OwnerRef | null | undefined): boolean {
  if (!a || !b) return false;
  return String(a.kind) === String(b.kind) && String(a.id) === String(b.id);
}

function voxel_has_occupies_tag(tags: any[]): boolean {
  return Array.isArray(tags) && tags.some((t: any) => String(t?.name ?? "").toUpperCase() === "OCCUPIES");
}

function find_blocking_occupant_at(place: Place, x: number, y: number, z: number, ctx: LegalityContext | undefined): OccupantInfo | null {
  if (ctx?.ignore_occupants) return null;

  const ex = ctx?.exclude_owner ?? null;
  const want_x = Math.floor(x);
  const want_y = Math.floor(y);
  const want_z = Math.floor(z);
  const bz = base_z(place);

  // NPCs
  for (const npc of (place as any)?.contents?.npcs_present ?? []) {
    const id = String((npc as any)?.npc_ref ?? "");
    if (!id) continue;
    if (ex && ex.kind === "npc" && ex.id === id) continue;
    const tp = (npc as any)?.tile_position;
    if (!tp) continue;
    const ez0 = Number((npc as any)?.elevation);
    const ez = Number.isFinite(ez0) ? Math.floor(ez0) : bz;
    const def = get_body_model_def((npc as any)?.body_model_id);
    const facing = resolve_entity_facing(npc, id);
    const vox = eval_body_model_voxels(def, { mode: "physical", facing });
    for (const v of vox) {
      const tags = Array.isArray((v as any)?.tags) ? (v as any).tags : [];
      if (!voxel_has_occupies_tag(tags)) continue;
      const wx = Math.floor(tp.x) + Math.floor(Number((v as any)?.dx ?? 0));
      const wy = Math.floor(tp.y) + Math.floor(Number((v as any)?.dy ?? 0));
      const wz = ez + Math.floor(Number((v as any)?.dz ?? 0));
      if (wx === want_x && wy === want_y && wz === want_z) {
        return { owner_kind: "npc", owner_id: id, part: String((v as any)?.part ?? "body"), tags };
      }
    }
  }

  // Actors
  for (const actor of (place as any)?.contents?.actors_present ?? []) {
    const id = String((actor as any)?.actor_ref ?? "");
    if (!id) continue;
    if (ex && ex.kind === "actor" && ex.id === id) continue;
    const tp = (actor as any)?.tile_position;
    if (!tp) continue;
    const ez0 = Number((actor as any)?.elevation);
    const ez = Number.isFinite(ez0) ? Math.floor(ez0) : bz;
    const def = get_body_model_def((actor as any)?.body_model_id);
    const facing = resolve_entity_facing(actor, id);
    const vox = eval_body_model_voxels(def, { mode: "physical", facing });
    for (const v of vox) {
      const tags = Array.isArray((v as any)?.tags) ? (v as any).tags : [];
      if (!voxel_has_occupies_tag(tags)) continue;
      const wx = Math.floor(tp.x) + Math.floor(Number((v as any)?.dx ?? 0));
      const wy = Math.floor(tp.y) + Math.floor(Number((v as any)?.dy ?? 0));
      const wz = ez + Math.floor(Number((v as any)?.dz ?? 0));
      if (wx === want_x && wy === want_y && wz === want_z) {
        return { owner_kind: "actor", owner_id: id, part: String((v as any)?.part ?? "body"), tags };
      }
    }
  }

  // Structures
  for (const s of (place as any)?.structures ?? []) {
    const id = String((s as any)?.id ?? "");
    if (!id) continue;
    if (ex && ex.kind === "structure" && ex.id === id) continue;
    const origin = (s as any)?.origin;
    const ox = Number(origin?.x);
    const oy = Number(origin?.y);
    const oz0 = Number(origin?.z);
    if (!Number.isFinite(ox) || !Number.isFinite(oy)) continue;
    const oz = Number.isFinite(oz0) ? Math.floor(oz0) : bz;
    const phys = Array.isArray((s as any)?.body_model?.physical)
      ? (s as any).body_model.physical
      : [{ part: "body", dx: 0, dy: 0, dz: 0, tags: Array.isArray((s as any)?.tags) ? (s as any).tags : [] }];
    for (const v of phys) {
      const tags = Array.isArray((v as any)?.tags)
        ? (v as any).tags
        : (Array.isArray((s as any)?.tags) ? (s as any).tags : []);
      if (!voxel_has_occupies_tag(tags)) continue;
      const wx = Math.floor(ox) + Math.floor(Number((v as any)?.dx ?? 0));
      const wy = Math.floor(oy) + Math.floor(Number((v as any)?.dy ?? 0));
      const wz = oz + Math.floor(Number((v as any)?.dz ?? 0));
      if (wx === want_x && wy === want_y && wz === want_z) {
        return { owner_kind: "structure", owner_id: id, part: String((v as any)?.part ?? "body"), tags };
      }
    }
  }

  return null;
}

function resolve_owner_physical_voxels(place: Place, owner: OwnerRef): Array<{ part: string; dx: number; dy: number; dz: number; tags: any[] }> {
  const bz = base_z(place);

  if (owner.kind === "structure") {
    const s = ((place as any)?.structures ?? []).find((it: any) => String(it?.id ?? "") === String(owner.id));
    const phys = Array.isArray((s as any)?.body_model?.physical)
      ? (s as any).body_model.physical
      : [{ part: "body", dx: 0, dy: 0, dz: 0, tags: Array.isArray((s as any)?.tags) ? (s as any).tags : [] }];
    return phys.map((v: any) => ({
      part: String(v?.part ?? "body"),
      dx: Math.floor(Number(v?.dx ?? 0)),
      dy: Math.floor(Number(v?.dy ?? 0)),
      dz: Math.floor(Number(v?.dz ?? 0)),
      tags: Array.isArray(v?.tags) ? v.tags : (Array.isArray((s as any)?.tags) ? (s as any).tags : []),
    }));
  }

  // Actors/NPCs: look up snapshot if present; fallback to default character body model.
  if (owner.kind === "npc") {
    const npc = ((place as any)?.contents?.npcs_present ?? []).find((it: any) => String(it?.npc_ref ?? "") === String(owner.id));
    const def = get_body_model_def((npc as any)?.body_model_id);
    const facing = resolve_entity_facing(npc, owner.id);
    return eval_body_model_voxels(def, { mode: "physical", facing }).map((v: any) => ({
      part: String(v?.part ?? "body"),
      dx: Math.floor(Number(v?.dx ?? 0)),
      dy: Math.floor(Number(v?.dy ?? 0)),
      dz: Math.floor(Number(v?.dz ?? 0)),
      tags: Array.isArray(v?.tags) ? v.tags : [],
    }));
  }
  if (owner.kind === "actor") {
    const actor = ((place as any)?.contents?.actors_present ?? []).find((it: any) => String(it?.actor_ref ?? "") === String(owner.id));
    const def = get_body_model_def((actor as any)?.body_model_id);
    const facing = resolve_entity_facing(actor, owner.id);
    return eval_body_model_voxels(def, { mode: "physical", facing }).map((v: any) => ({
      part: String(v?.part ?? "body"),
      dx: Math.floor(Number(v?.dx ?? 0)),
      dy: Math.floor(Number(v?.dy ?? 0)),
      dz: Math.floor(Number(v?.dz ?? 0)),
      tags: Array.isArray(v?.tags) ? v.tags : [],
    }));
  }

  // Items: treat as a single voxel by default (non-blocking unless tags later say otherwise).
  return [{ part: "body", dx: 0, dy: 0, dz: 0, tags: [] }];
}

export function can_place_volume(place: Place, owner: OwnerRef, stance_origin: Voxel, mode: MovementMode, ctx: LegalityContext = {}): MoveCheck {
  const so = {
    x: Math.floor(Number(stance_origin?.x ?? 0)),
    y: Math.floor(Number(stance_origin?.y ?? 0)),
    z: Math.floor(Number(stance_origin?.z ?? 0)),
  };
  const detail_base = { stance_origin: { ...so }, mode };

  const w = Math.max(1, Math.floor(Number((place as any)?.tile_grid?.width ?? 1)));
  const h = Math.max(1, Math.floor(Number((place as any)?.tile_grid?.height ?? 1)));
  const zb = get_place_world_z_bounds(place);
  const bounds_detail = { x0: 0, y0: 0, x1: w - 1, y1: h - 1, min_z: zb.min_z, max_z: zb.max_z };

  if (so.x < 0 || so.y < 0 || so.x >= w || so.y >= h || so.z < zb.min_z || so.z > zb.max_z) {
    return { ok: false, reason: "out_of_bounds", detail: { ...detail_base, bounds: bounds_detail } };
  }

  // Reservations are stance-origin scoped.
  const res_key = key_xyz(so.x, so.y, so.z);
  if (ctx.reserved_stance_origins && ctx.reserved_stance_origins.has(res_key)) {
    return { ok: false, reason: "reserved", detail: { ...detail_base, reserved_key: res_key } };
  }

  const rel = resolve_owner_physical_voxels(place, owner);
  const occ_world: Array<{ x: number; y: number; z: number; part: string; tags: any[]; dz: number }> = [];
  for (const v of rel) {
    const wx = so.x + Math.floor(Number(v.dx ?? 0));
    const wy = so.y + Math.floor(Number(v.dy ?? 0));
    const wz = so.z + Math.floor(Number(v.dz ?? 0));
    occ_world.push({ x: wx, y: wy, z: wz, part: String(v.part ?? "body"), tags: v.tags ?? [], dz: Math.floor(Number(v.dz ?? 0)) });
  }

  // Collision: check all occupied voxels.
  for (const v of occ_world) {
    if (v.x < 0 || v.y < 0 || v.x >= w || v.y >= h || v.z < zb.min_z || v.z > zb.max_z) {
      return {
        ok: false,
        reason: "out_of_bounds",
        detail: { ...detail_base, blocked_voxel: { x: v.x, y: v.y, z: v.z }, bounds: bounds_detail },
      };
    }

    // Tile collision.
    if (tile_has_occupies(place, v.x, v.y, v.z)) {
      return {
        ok: false,
        reason: "blocked",
        detail: { ...detail_base, blocked_voxel: { x: v.x, y: v.y, z: v.z }, blocked_by: "tile", blocked_part: v.part },
      };
    }

    // Occupant collision.
    const occ = find_blocking_occupant_at(place, v.x, v.y, v.z, { ...ctx, exclude_owner: ctx.exclude_owner ?? owner });
    if (occ) {
      return {
        ok: false,
        reason: "blocked",
        detail: {
          ...detail_base,
          blocked_voxel: { x: v.x, y: v.y, z: v.z },
          blocked_by: "occupant",
          blocked_part: v.part,
          blocked_owner: { owner_kind: occ.owner_kind, owner_id: occ.owner_id, part: occ.part },
        },
      };
    }
  }

  // Support: mode-specific.
  if (mode === "WALK") {
    const policy: SupportPolicy = ctx.support_policy === "all_footprint" ? "all_footprint" : "any_footprint";
    const min_dz = occ_world.reduce((m, v) => Math.min(m, v.dz), 0);
    const footprint = occ_world.filter((v) => v.dz === min_dz);

    const supported: Array<{ x: number; y: number; z: number; supported: boolean; by: string | null }> = [];
    let any_supported = false;
    let all_supported = true;

    for (const f of footprint) {
      const below = { x: f.x, y: f.y, z: f.z - 1 };

      let ok = false;
      let by: string | null = null;

      if (below.x < 0 || below.y < 0 || below.x >= w || below.y >= h) {
        ok = false;
      } else {
        // Tile support.
        if (tile_has_occupies(place, below.x, below.y, below.z)) {
          ok = true;
          by = "tile";
        } else {
          // If no support layer is authored at base_z-1, treat as solid ground.
          const bz = base_z(place);
          const is_support_plane = Math.floor(below.z) === Math.floor(bz - 1);
          const has_support_tiles = !!(place as any)?.tiles_z0;
          if (is_support_plane && !has_support_tiles) {
            ok = true;
            by = "implicit_ground";
          } else {
            // Occupant support.
            const occ = find_blocking_occupant_at(place, below.x, below.y, below.z, { ...ctx, exclude_owner: ctx.exclude_owner ?? owner });
            if (occ) {
              ok = true;
              by = `occupant:${occ.owner_kind}:${occ.owner_id}`;
            }
          }
        }
      }

      supported.push({ ...below, supported: ok, by });
      any_supported = any_supported || ok;
      all_supported = all_supported && ok;
    }

    const support_ok = policy === "all_footprint" ? all_supported : any_supported;
    if (!support_ok) {
      if (ctx.allow_unsupported) {
        return { ok: true };
      }
      return {
        ok: false,
        reason: "no_support",
        detail: { ...detail_base, footprint_voxels: footprint.map((v) => ({ x: v.x, y: v.y, z: v.z, part: v.part })), support_checked: supported },
      };
    }

    // Devlog marker: detect when support comes from an occupant (not tiles).
    try {
      const any_occ = supported.some((s) => typeof s.by === 'string' && s.by.startsWith('occupant:'));
      const any_tile = supported.some((s) => s.by === 'tile' || s.by === 'implicit_ground');
      if (support_ok && any_occ && !any_tile) {
        const k = `${owner.kind}:${owner.id}:${key_xyz(so.x, so.y, so.z)}`;
        if (!move_unify_support_occupant_marked.has(k)) {
          move_unify_support_occupant_marked.add(k);
          // eslint-disable-next-line no-console
          console.log('[MOVE_UNIFY_TEST]', 'PASS stand on entity allowed (support from occupant)', {
            owner,
            stance_origin: so,
            support_checked: supported,
          });
        }
      }
    } catch {
      // ignore
    }
  }

  return { ok: true };
}
