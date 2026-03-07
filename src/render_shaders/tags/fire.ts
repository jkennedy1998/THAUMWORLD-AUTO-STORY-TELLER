import { get_color_by_name } from "../../mono_ui/colors.js";
import type { RenderLayer } from "../types.js";

export function apply_fire_modifier(layers: RenderLayer[], tags: any[]): void {
    if (!tags || !Array.isArray(tags) || layers.length === 0) return;
    const fire = tags.find((t: any) => String(t?.name ?? '') === 'FIRE!');
    if (!fire) return;

    const mag = typeof fire.mag === 'number' ? fire.mag : 0;
    const rgb = mag > 3 ? get_color_by_name('vivid_red').rgb : get_color_by_name('pumpkin').rgb;

    for (const l of layers) {
        l.fg = rgb;
        // Prevent UI hover/selection coloring from overriding tag-driven fg.
        if (Array.isArray(l.flags)) {
            if (!l.flags.includes('fg_locked')) l.flags.push('fg_locked');
        } else {
            l.flags = ['fg_locked'];
        }
    }
}
