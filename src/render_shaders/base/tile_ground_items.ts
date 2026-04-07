import { get_color_by_name } from "../../mono_ui/colors.js";
import type { RenderContext, RenderLayer, RenderOutput, TilePayload } from "../types.js";

function clamp_int(n: unknown, lo: number, hi: number): number {
    const v = typeof n === 'number' ? Math.trunc(n) : 0;
    if (!Number.isFinite(v)) return lo;
    return Math.max(lo, Math.min(hi, v));
}

export function shade_tile_ground_items(payload: TilePayload, _ctx: RenderContext): RenderOutput {
    const count = clamp_int(payload.pile_count, 0, 9999);
    let char = '·';
    if (count >= 2) {
        char = count > 10 ? '#' : '*';
    } else {
        const qty = clamp_int(payload.single_qty, 1, 9999);
        // Preserve current PlaceModule convention:
        // qty>10 => '$', qty>1 => '*', qty==1 => '·'
        char = qty > 10 ? '$' : (qty > 1 ? '*' : '·');
    }

    const layer: RenderLayer = {
        char,
        fg: payload.base_fg ?? get_color_by_name('vivid_yellow').rgb,
        z: 0,
        style: 'regular',
        weight_index: 2,
    };
    return { layers: [layer] };
}
