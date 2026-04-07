import type { RenderContext, RenderLayer } from "../types.js";

function pulse_weight(time_ms: number | undefined): number {
    const t = typeof time_ms === 'number' ? time_ms : 0;
    const phase = Math.floor(t / 220) % 4;
    return phase;
}

export function apply_ui_pulse_modifier(layers: RenderLayer[], ctx: RenderContext): void {
    if (!layers || layers.length === 0) return;
    const highlighted = Boolean(ctx.ui?.highlighted);
    if (!highlighted) return;

    // Don't pulse when the UI is already in a strong emphasis state.
    if (ctx.ui?.hovered || ctx.ui?.selected || ctx.ui?.targeted) return;

    for (const l of layers) {
        l.weight_index = pulse_weight(ctx.time_ms);
    }
}
