import type { RenderContext, RenderLayer } from "../types.js";

function is_fg_locked(layer: RenderLayer): boolean {
    return Array.isArray(layer.flags) && layer.flags.includes('fg_locked');
}

export function apply_ui_place_tile_interaction_modifier(layers: RenderLayer[], ctx: RenderContext): void {
    if (!layers || layers.length === 0) return;
    // Shared interaction palette across place + inventory.
    if (ctx.where !== 'place_tile' && ctx.where !== 'container_ui' && ctx.where !== 'character_slot') return;

    const selected = Boolean(ctx.ui?.selected);
    const hovered = Boolean(ctx.ui?.hovered);
    if (!selected && !hovered) return;

    // Match the current tabletop UX palette.
    // NOTE: precedence differs by context:
    // - place_tile: selected (open) should stay visible even when hovered
    // - inventory slots: hover should be the strongest cue
    const place_priority = ctx.where === 'place_tile';
    const rgb = place_priority
        ? (selected ? { r: 180, g: 100, b: 220 } : { r: 255, g: 255, b: 100 })
        : (hovered ? { r: 255, g: 255, b: 100 } : { r: 180, g: 100, b: 220 });

    for (const l of layers) {
        if (is_fg_locked(l)) continue;
        l.fg = rgb;
    }
}
