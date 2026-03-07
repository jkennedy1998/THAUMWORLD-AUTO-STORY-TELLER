import type { RenderContext, RenderLayer } from "../types.js";

function is_fg_locked(layer: RenderLayer): boolean {
    return Array.isArray(layer.flags) && layer.flags.includes('fg_locked');
}

export function apply_ui_default_container_modifier(layers: RenderLayer[], ctx: RenderContext): void {
    if (!layers || layers.length === 0) return;
    const on = Boolean(ctx.ui?.default_container);
    if (!on) return;

    // Default container highlight: yellow.
    // Let hover/selected/targeted take priority (handled by other UI modifiers).
    if (ctx.ui?.hovered || ctx.ui?.selected || ctx.ui?.targeted) return;

    const rgb = { r: 255, g: 255, b: 100 };
    for (const l of layers) {
        if (is_fg_locked(l)) continue;
        l.fg = rgb;
    }
}
