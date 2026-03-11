import type { Direction } from "../npc_ai/facing_system.js";

export type BodyModelVoxel = {
  part: string;
  dx: number;
  dy: number;
  dz: number;
  tags?: any[];
};

export type BodyModelDef = {
  id: string;
  // Stable default pose used for collision/hits.
  physical: BodyModelVoxel[];
  // Optional render poses keyed by state/facing.
  render?: Record<string, BodyModelVoxel[]>;
  // Optional part used as the canonical anchor (camera pan + focus).
  anchor_part?: string;
};

export type BodyModelEvalMode = "physical" | "render";

export const DEFAULT_CHARACTER_BODY_MODEL_ID = "character.biped_2z";

export const BODY_MODEL_CHARACTER_BIPED_2Z: BodyModelDef = {
  id: DEFAULT_CHARACTER_BODY_MODEL_ID,
  anchor_part: "body",
  physical: [
    { part: "body", dx: 0, dy: 0, dz: 0, tags: [{ name: "OCCUPIES", mag: 1, meta: [] }] },
    { part: "head", dx: 0, dy: 0, dz: 1, tags: [{ name: "OCCUPIES", mag: 1, meta: [] }] },
  ],
};

export function resolve_character_body_model_id(_kind_id: string | null | undefined): string {
  // For now, all current kinds render/occupy as a 2-voxel vertical stack.
  // Later: derive from kind definition.
  return DEFAULT_CHARACTER_BODY_MODEL_ID;
}

export function get_body_model_def(body_model_id: string | null | undefined): BodyModelDef {
  const id = String(body_model_id ?? "");
  if (id === DEFAULT_CHARACTER_BODY_MODEL_ID) return BODY_MODEL_CHARACTER_BIPED_2Z;
  // Fallback: treat unknown as the default character model.
  return BODY_MODEL_CHARACTER_BIPED_2Z;
}

export function rotate_offset_xy(dx: number, dy: number, facing: Direction | null | undefined): { dx: number; dy: number } {
  const d = String(facing ?? '').toLowerCase();
  // Define identity as facing EAST. Other facings rotate around origin.
  // Coordinate system: +x east, +y north.
  // east: (dx,dy)
  // north: 90deg CCW: (-dy, dx)
  // west: 180deg: (-dx, -dy)
  // south: 90deg CW: (dy, -dx)
  if (d === 'north') return { dx: -dy, dy: dx };
  if (d === 'west') return { dx: -dx, dy: -dy };
  if (d === 'south') return { dx: dy, dy: -dx };
  // east + diagonals/unknown: no transform for now.
  return { dx, dy };
}

export function eval_body_model_voxels(
  def: BodyModelDef,
  opts?: { mode?: BodyModelEvalMode; pose_key?: string; facing?: Direction | null },
): BodyModelVoxel[] {
  const mode: BodyModelEvalMode = (opts?.mode ?? "physical") === "render" ? "render" : "physical";
  const pose_key = String(opts?.pose_key ?? "");
  const facing = (opts?.facing ?? null) as any;

  let vox = def.physical;
  if (mode === "render" && def.render && pose_key && Array.isArray(def.render[pose_key])) {
    vox = def.render[pose_key]!;
  }

  // Apply facing transform in a stable way.
  const out: BodyModelVoxel[] = [];
  for (const v of vox) {
    const o = rotate_offset_xy(v.dx, v.dy, facing);
    out.push({ ...v, dx: o.dx, dy: o.dy });
  }
  return out;
}

export function pick_anchor_voxel(def: BodyModelDef, voxels: readonly BodyModelVoxel[]): BodyModelVoxel {
  const want = String(def.anchor_part ?? "");
  if (want) {
    const found = voxels.find((v) => String(v.part) === want);
    if (found) return found;
  }
  return (voxels[0] ?? { part: "anchor", dx: 0, dy: 0, dz: 0 }) as any;
}

export function compute_anchor_world_voxel(opts: {
  origin: { x: number; y: number; z: number };
  body_model_id?: string | null;
  facing?: Direction | null;
  mode?: BodyModelEvalMode;
  pose_key?: string;
}): { x: number; y: number; z: number; part: string } {
  const def = get_body_model_def(opts.body_model_id);
  const vox = eval_body_model_voxels(def, { mode: opts.mode ?? 'physical', pose_key: opts.pose_key, facing: opts.facing ?? null });
  const a = pick_anchor_voxel(def, vox);
  return {
    x: Math.floor(opts.origin.x) + Math.floor(Number(a.dx ?? 0)),
    y: Math.floor(opts.origin.y) + Math.floor(Number(a.dy ?? 0)),
    z: Math.floor(opts.origin.z) + Math.floor(Number(a.dz ?? 0)),
    part: String((a as any)?.part ?? 'anchor'),
  };
}
