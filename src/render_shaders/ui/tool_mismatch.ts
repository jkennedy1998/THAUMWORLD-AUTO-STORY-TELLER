import { get_color_by_name } from "../../mono_ui/colors.js";
import type { RenderContext, RenderLayer } from "../types.js";

function lock_fg(layer: RenderLayer): void {
    if (Array.isArray(layer.flags)) {
        if (!layer.flags.includes('fg_locked')) layer.flags.push('fg_locked');
    } else {
        layer.flags = ['fg_locked'];
    }
}

export function apply_ui_tool_mismatch_modifier(layers: RenderLayer[], ctx: RenderContext): void {
    if (!layers || layers.length === 0) return;
    if (ctx.where !== 'character_slot') return;
    if (!ctx.ui?.tool_mismatch) return;

    const rgb = get_color_by_name('medium_gray').rgb;
    for (const l of layers) {
        l.fg = rgb;
        lock_fg(l);
        const cur = typeof l.weight_index === 'number' ? l.weight_index : 1;
        l.weight_index = Math.min(cur, 3);
    }
}
