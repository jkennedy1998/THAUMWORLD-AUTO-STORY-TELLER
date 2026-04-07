import type { RenderContext, RenderLayer, RenderOutput, UiSlotPayload } from "../types.js";

function get_slot_rgb(slot_type: string | undefined): { r: number; g: number; b: number } {
    const t = String(slot_type ?? '').toLowerCase();
    if (t === 'tool') return { r: 220, g: 60, b: 60 };
    if (t === 'armor') return { r: 60, g: 120, b: 220 };
    if (t === 'garb') return { r: 60, g: 180, b: 100 };
    // neutral/default
    return { r: 120, g: 120, b: 120 };
}

function pulse_weight(time_ms: number | undefined): number {
    const t = typeof time_ms === 'number' ? time_ms : 0;
    return Math.floor(t / 220) % 4;
}

export function shade_ui_slot_default(payload: UiSlotPayload, ctx: RenderContext): RenderOutput {
    const fg = payload.base_fg ?? get_slot_rgb(payload.slot_type);
    const highlighted = Boolean(ctx.ui?.highlighted);
    const hovered = Boolean(ctx.ui?.hovered);
    const placeholder = Boolean(payload.is_placeholder);

    // Keep slots visually light by default; emphasize via hover/highlight.
    let weight_index = placeholder ? 0 : 1;
    if (highlighted) weight_index = pulse_weight(ctx.time_ms);
    if (hovered) weight_index = Math.min(3, weight_index + 1);

    const layer: RenderLayer = {
        char: '·',
        fg,
        z: 0,
        style: 'regular',
        weight_index,
    };

    return { layers: [layer] };
}
