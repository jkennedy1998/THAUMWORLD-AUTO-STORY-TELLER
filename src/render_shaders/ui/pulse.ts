import type { RenderContext, RenderLayer } from "../types.js";

function pulse_weight(time_ms: number | undefined, base: number): number {
    const t = typeof time_ms === 'number' ? time_ms : 0;
    const phase = (Math.floor(t / 220) % 2) === 0;
    return phase ? Math.max(base, 5) : 7;
}

export function apply_ui_pulse_modifier(layers: RenderLayer[], ctx: RenderContext): void {
    if (!layers || layers.length === 0) return;
    const highlighted = Boolean(ctx.ui?.highlighted);
    if (!highlighted) return;

    // Don't pulse when the UI is already in a strong emphasis state.
    if (ctx.ui?.hovered || ctx.ui?.selected || ctx.ui?.targeted) return;

    for (const l of layers) {
        const cur = typeof l.weight_index === 'number' ? l.weight_index : 5;
        l.weight_index = pulse_weight(ctx.time_ms, cur);
    }
}
