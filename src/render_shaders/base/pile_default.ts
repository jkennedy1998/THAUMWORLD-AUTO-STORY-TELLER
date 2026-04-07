import type { PilePayload, RenderContext, RenderLayer, RenderOutput } from "../types.js";
import { shade_item_default } from "./item_default.js";
import { get_color_by_name } from "../../mono_ui/colors.js";

function clamp_int(n: unknown, lo: number, hi: number): number {
    const v = typeof n === 'number' ? Math.trunc(n) : 0;
    if (!Number.isFinite(v)) return lo;
    return Math.max(lo, Math.min(hi, v));
}

function pick_pile_char(count: number, single_qty: number | undefined): string {
    if (count >= 2) return count > 10 ? '#' : '*';
    const qty = clamp_int(single_qty, 1, 9999);
    return qty > 10 ? '$' : (qty > 1 ? '*' : '·');
}

export function shade_pile_default(payload: PilePayload, ctx: RenderContext): RenderOutput {
    const count = clamp_int(payload.pile_count, 0, 9999);

    const base_fg = payload.base_fg ?? get_color_by_name('vivid_yellow').rgb;

    // Use the item shader to derive fg/style/weight (incl. tag + UI modifiers later).
    const item_out = shade_item_default(
        {
            kind: 'item',
            id: payload.id,
            def_id: payload.def_id,
            name: payload.name,
            qty: payload.qty,
            display_char: payload.display_char,
            tags: payload.tags,
            base_fg,
        } as any,
        ctx,
    );

    const base_layer = item_out.layers[0] ?? ({ char: '·', z: 0 } as RenderLayer);
    const layer: RenderLayer = { ...base_layer };
    
    // If this is a multi-item pile, render the pile glyph but keep the rep item's styling.
    if (count >= 2) {
        layer.char = pick_pile_char(count, undefined);
        layer.weight_index = Math.max(typeof layer.weight_index === 'number' ? layer.weight_index : 1, 5);
    }

    return { layers: [layer] };
}
