import { get_facing } from "../npc_ai/facing_system.js";
import { eval_body_model_voxels, get_body_model_def } from "./body_model.js";

export type CharacterCameraFocus = {
  x: number;
  y: number;
  z: number;
  part: string;
};

export function get_character_camera_focus_tile(opts: {
  entity: any;
  entity_ref: string;
  fallback_world_z: number;
}): CharacterCameraFocus {
  const entity = opts.entity;
  const x0 = Math.floor(Number(entity?.tile_position?.x ?? 0)) || 0;
  const y0 = Math.floor(Number(entity?.tile_position?.y ?? 0)) || 0;
  const z0_raw = Number(entity?.elevation);
  const z0 = Number.isFinite(z0_raw) ? Math.floor(z0_raw) : (Math.floor(Number(opts.fallback_world_z)) || 0);

  try {
    const def = get_body_model_def(entity?.body_model_id);
    const facing = get_facing(String(opts.entity_ref ?? ""));
    const vox = eval_body_model_voxels(def, { mode: "physical", facing });
    if (!Array.isArray(vox) || vox.length < 1) {
      return { x: x0, y: y0, z: z0, part: "origin" };
    }

    const anchor_part = String(def?.anchor_part ?? "").toLowerCase();
    const part_rank = (part: string): number => {
      if (part === "feet" || part === "foot") return 0;
      if (part === "lower_body" || part === "body") return 1;
      if (anchor_part && part === anchor_part) return 2;
      return 99;
    };

    const chosen = [...vox].sort((a: any, b: any) => {
      const ap = String(a?.part ?? "").toLowerCase();
      const bp = String(b?.part ?? "").toLowerCase();
      const ar = part_rank(ap);
      const br = part_rank(bp);
      if (ar !== br) return ar - br;

      const adz = Math.floor(Number(a?.dz ?? 0));
      const bdz = Math.floor(Number(b?.dz ?? 0));
      const a_abs_dz = Math.abs(adz);
      const b_abs_dz = Math.abs(bdz);
      if (a_abs_dz !== b_abs_dz) return a_abs_dz - b_abs_dz;

      const adx = Math.floor(Number(a?.dx ?? 0));
      const ady = Math.floor(Number(a?.dy ?? 0));
      const bdx = Math.floor(Number(b?.dx ?? 0));
      const bdy = Math.floor(Number(b?.dy ?? 0));
      const am = Math.abs(adx) + Math.abs(ady);
      const bm = Math.abs(bdx) + Math.abs(bdy);
      if (am !== bm) return am - bm;

      if (a_abs_dz !== b_abs_dz) return a_abs_dz - b_abs_dz;
      if (Math.abs(ady) !== Math.abs(bdy)) return Math.abs(ady) - Math.abs(bdy);
      return Math.abs(adx) - Math.abs(bdx);
    })[0] as any;

    return {
      x: x0 + (Math.floor(Number(chosen?.dx ?? 0)) || 0),
      y: y0 + (Math.floor(Number(chosen?.dy ?? 0)) || 0),
      z: z0 + (Math.floor(Number(chosen?.dz ?? 0)) || 0),
      part: String(chosen?.part ?? "anchor"),
    };
  } catch {
    return { x: x0, y: y0, z: z0, part: "origin" };
  }
}
