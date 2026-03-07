import type { ItemPayload, RenderContext, RenderLayer, RenderOutput } from "../types.js";
import { is_container_tagged, resolve_container_glyph } from "../tags/container_glyphs.js";

function pick_base_char(payload: ItemPayload): string {
    const ch = String(payload.display_char ?? '').charAt(0);
    if (ch && ch !== '·' && ch !== ' ') return ch;
    const name = String(payload.name ?? '');
    if (name.length > 0) return name.charAt(0).toLowerCase();
    return '?';
}

function apply_qty_overlay(base_char: string, qty: number | undefined): string {
    const q = typeof qty === 'number' ? qty : 1;
    if (!Number.isFinite(q) || q <= 1) return base_char;
    if (q > 9) return '+';
    return String(Math.trunc(q));
}

function apply_item_char_overrides(base_char: string, payload: ItemPayload, ctx: RenderContext): string {
    // Open/closed glyphs are only meaningful for container-items.
    if (is_container_tagged((payload as any).tags)) {
        return resolve_container_glyph(payload, ctx);
    }
    return base_char;
}

export function shade_item_default(payload: ItemPayload, _ctx: RenderContext): RenderOutput {
    const base0 = pick_base_char(payload);
    const base = apply_item_char_overrides(base0, payload, _ctx);
    const char = is_container_tagged((payload as any).tags)
        ? base
        : apply_qty_overlay(base, payload.qty);

    const layer: RenderLayer = {
        char,
        fg: payload.base_fg,
        z: 0,
        style: 'regular',
        weight_index: 5,
        // Style/weight/color are filled by caller/reducer for now.
    };

    return { layers: [layer] };
}
