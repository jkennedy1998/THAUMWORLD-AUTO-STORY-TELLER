import type { RenderContext, RenderLayer } from "../types.js";

export function apply_ui_weight_modifier(layers: RenderLayer[], ctx: RenderContext): void {
    if (!layers || layers.length === 0) return;
    const hovered = Boolean(ctx.ui?.hovered);
    const selected = Boolean(ctx.ui?.selected);
    const targeted = Boolean(ctx.ui?.targeted);
    if (!hovered && !selected && !targeted) return;

    for (const l of layers) {
        const cur = typeof l.weight_index === 'number' ? l.weight_index : 1;
        l.weight_index = Math.min(3, cur + 1);
    }
}
