import type { CardinalDirection, GraphicId, GraphicsModel, TileConnectivityModel, TileConnectivityVariant } from './graphics_contract.js';
import type { DiscriminatedRenderPayload, RenderContext } from './types.js';

const DIRECTION_BITS: Record<CardinalDirection, number> = {
  north: 1,
  east: 2,
  south: 4,
  west: 8,
};

const VARIANT_FOR_MASK: Record<number, TileConnectivityVariant> = {
  0: 'isolated',
  1: 'end_cap_n',
  2: 'end_cap_e',
  3: 'corner_ne',
  4: 'end_cap_s',
  5: 'straight_vertical',
  6: 'corner_se',
  7: 't_missing_w',
  8: 'end_cap_w',
  9: 'corner_nw',
  10: 'straight_horizontal',
  11: 't_missing_s',
  12: 'corner_sw',
  13: 't_missing_e',
  14: 't_missing_n',
  15: 'center',
};

function can_connect_to_kind(connectivity: TileConnectivityModel, current_kind: string, neighbor_kind: string | null | undefined): boolean {
  if (typeof neighbor_kind !== 'string' || neighbor_kind.trim().length <= 0) return false;
  const normalized_neighbor = neighbor_kind.trim();
  if (Array.isArray(connectivity.connect_tile_ids) && connectivity.connect_tile_ids.length > 0) {
    return connectivity.connect_tile_ids.includes(normalized_neighbor);
  }
  return normalized_neighbor === current_kind;
}

function resolve_connectivity_mask(connectivity: TileConnectivityModel, current_kind: string, ctx: RenderContext): number {
  const neighbors = ctx.tile_neighbors;
  if (!neighbors) return 0;
  let mask = 0;
  for (const dir of Object.keys(DIRECTION_BITS) as CardinalDirection[]) {
    if (can_connect_to_kind(connectivity, current_kind, neighbors[dir])) {
      mask |= DIRECTION_BITS[dir];
    }
  }
  return mask;
}

export function resolve_connected_graphic_id(graphics: GraphicsModel | undefined, payload: DiscriminatedRenderPayload | undefined, ctx: RenderContext, base_graphic_id: GraphicId): GraphicId {
  const connectivity = graphics?.connectivity;
  if (!connectivity || connectivity.mode !== 'cardinal_4') return base_graphic_id;
  if (payload?.kind !== 'tile') return base_graphic_id;
  const tile_kind = typeof payload.def_id === 'string' ? payload.def_id.trim() : '';
  if (tile_kind.length <= 0) return base_graphic_id;
  const mask = resolve_connectivity_mask(connectivity, tile_kind, ctx);
  const variant = VARIANT_FOR_MASK[mask] ?? 'isolated';
  const variant_graphic = connectivity.variant_graphic_ids?.[variant]
    ?? (variant === 'center' ? connectivity.variant_graphic_ids?.cross : undefined);
  return typeof variant_graphic === 'string' && variant_graphic.length > 0 ? variant_graphic : base_graphic_id;
}
