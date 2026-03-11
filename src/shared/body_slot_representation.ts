export type BodySlotRepRule = {
  // Prefer mapping slots to semantic parts (stable across render animation).
  parts?: string[];
  // Optional explicit voxel offsets relative to the owner's origin.
  // Used for non-standard bodies later.
  voxels?: Array<{ dx: number; dy: number; dz: number }>;
};

export type BodySlotRepresentation = Record<string, BodySlotRepRule>;

// Default mapping for the current `character.biped_2z` body model.
// (Used when a kind does not specify an explicit representation.)
export const DEFAULT_CHARACTER_BODY_SLOT_REPRESENTATION: BodySlotRepresentation = {
  head: { parts: ['head'] },
  torso: { parts: ['body'] },
  hand_left: { parts: ['body'] },
  hand_right: { parts: ['body'] },
  leg_left: { parts: ['body'] },
  leg_right: { parts: ['body'] },
};

export function get_body_slots_for_character_hit(opts: {
  body_slot_representation?: BodySlotRepresentation | null;
  hit_part?: string | null;
  hit_voxel?: { dx: number; dy: number; dz: number } | null;
}): string[] {
  const rep = opts.body_slot_representation && typeof opts.body_slot_representation === 'object'
    ? (opts.body_slot_representation as BodySlotRepresentation)
    : null;
  const hit_part = String(opts.hit_part ?? '').trim();

  if (rep) {
    const out: string[] = [];
    for (const [slot_name, rule] of Object.entries(rep)) {
      if (!rule || typeof rule !== 'object') continue;
      const parts = Array.isArray(rule.parts) ? rule.parts : [];
      if (hit_part && parts.some((p) => String(p) === hit_part)) out.push(slot_name);
    }
    if (out.length > 0) return out;
  }

  // Fallback: current default body model uses parts "body" and "head".
  if (hit_part === 'head') return ['head'];
  if (hit_part === 'body') return ['torso'];
  return [];
}
