export type UseTargetKind = "character" | "item" | "tile" | "place_tile" | "unknown";

export type UseTargetData = {
  kind: UseTargetKind;
  evasion?: number | null;
};

export function classify_use_target(targetRef: string | undefined | null): UseTargetKind {
  const ref = String(targetRef ?? "").trim();
  if (!ref) return "unknown";
  if (ref.startsWith("actor.") || ref.startsWith("npc.")) return "character";
  if (ref.startsWith("item.")) return "item";
  if (ref.startsWith("place_tile.")) return "place_tile";
  if (ref.startsWith("tile.") || ref.startsWith("region_tile.") || ref.startsWith("world_tile.")) return "tile";
  return "unknown";
}

export function get_projectile_distance_cr(distance_tiles: number): number {
  const distance = Number(distance_tiles);
  if (!Number.isFinite(distance)) return 1;
  return Math.max(1, Math.round(distance));
}

export function resolve_use_result_cr(opts: {
  targetRef?: string | null;
  targetData?: UseTargetData | null;
  distanceTiles?: number | null;
  resultAgainst: "evasion" | "distance" | "none";
  autoHitTargetTypes?: string[];
}): { requires_roll: boolean; cr: number | null; auto_hit: boolean; target_kind: UseTargetKind } {
  const target_kind = opts.targetData?.kind ?? classify_use_target(opts.targetRef);
  const auto_hit_types = new Set((opts.autoHitTargetTypes ?? []).map((entry) => String(entry).toLowerCase()));
  const auto_hit = auto_hit_types.has(target_kind);
  if (opts.resultAgainst === "none") return { requires_roll: false, cr: null, auto_hit, target_kind };
  if (auto_hit) return { requires_roll: false, cr: null, auto_hit: true, target_kind };
  if (opts.resultAgainst === "evasion") {
    const evasion = Number(opts.targetData?.evasion);
    return {
      requires_roll: true,
      cr: Number.isFinite(evasion) ? Math.max(1, Math.floor(evasion)) : 10,
      auto_hit: false,
      target_kind,
    };
  }
  if (opts.resultAgainst === "distance") {
    return {
      requires_roll: true,
      cr: get_projectile_distance_cr(Number(opts.distanceTiles ?? 0)),
      auto_hit: false,
      target_kind,
    };
  }
  return { requires_roll: false, cr: null, auto_hit, target_kind };
}
