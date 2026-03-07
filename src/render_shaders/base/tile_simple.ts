import type { RenderContext, RenderLayer, RenderOutput, TilePayload } from "../types.js";

export function shade_tile_simple(payload: TilePayload, _ctx: RenderContext): RenderOutput {
    const ch = String((payload as any).char ?? ' ').charAt(0) || ' ';
    const layer: RenderLayer = {
        char: ch,
        fg: payload.base_fg,
        z: 0,
        style: (payload as any).style ?? 'regular',
        weight_index: typeof (payload as any).weight_index === 'number' ? (payload as any).weight_index : 3,
    };
    return { layers: [layer] };
}
