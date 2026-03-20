import type { RenderContext, RenderLayer, RenderOutput, TilePayload } from "../types.js";
import { apply_shader_bindings } from "../shader_registry.js";

export function shade_tile_simple(payload: TilePayload, ctx: RenderContext): RenderOutput {
    const ch = String((payload as any).char ?? ' ').charAt(0) || ' ';
    const base_weight = typeof (payload as any).weight_index === 'number' ? (payload as any).weight_index : 3;
    const shaded = apply_shader_bindings({
        char: ch,
        fg: payload.base_fg,
        weight_index: base_weight,
    }, ctx, payload.render_shader);
    const layer: RenderLayer = {
        char: shaded.char,
        fg: shaded.fg,
        z: 0,
        style: (payload as any).style ?? 'regular',
        weight_index: shaded.weight_index,
    };
    return { layers: [layer] };
}
