import { get_color_by_name } from "../../mono_ui/colors.js";
import type { RenderContext, RenderLayer } from "../types.js";

const CONTAINER_TAGS = new Set<string>([
    'CONTAINER',
    'BAG',
    'SACK',
    'POUCH',
    'BACKPACK',
    'WALLET',
    'CHEST',
    'BOX',
]);

function has_container_tag(tags: any[]): boolean {
    if (!tags || !Array.isArray(tags)) return false;
    for (const t of tags) {
        const name = String(t?.name ?? '').toUpperCase();
        if (CONTAINER_TAGS.has(name)) return true;
    }
    return false;
}

export function apply_container_modifier(layers: RenderLayer[], tags: any[], ctx: RenderContext): void {
    if (!layers || layers.length === 0) return;
    if (!has_container_tag(tags)) return;

    const ui = ctx?.ui;
    if (!ui?.selected) return;
    if (ui?.hovered || ui?.highlighted || ui?.targeted) return;

    const rgb = get_color_by_name('pumpkin').rgb;
    for (const l of layers) {
        l.fg = rgb;
    }
}
