import { resolve_sine_driver } from "../global_animation.js";
import type { RenderContext, RenderLayer } from "../types.js";

const FLORA_WEIGHT_MIN = 0;
const FLORA_WEIGHT_MAX = 3;
const FLORA_WIND_WAVELENGTH = 24;
const FLORA_WIND_BREATHS_PER_CYCLE = 18;

function has_flora_tag(tags: any[]): boolean {
    if (!Array.isArray(tags)) return false;
    return tags.some((tag: any) => String(tag?.name ?? '').toUpperCase() === 'FLORA');
}

export function apply_flora_modifier(layers: RenderLayer[], tags: any[], ctx: RenderContext): void {
    if (!Array.isArray(layers) || layers.length <= 0) return;
    if (!has_flora_tag(tags)) return;

    const sample = resolve_sine_driver(ctx, {
        wavelength: FLORA_WIND_WAVELENGTH,
        breaths_per_cycle: FLORA_WIND_BREATHS_PER_CYCLE,
    });
    for (const layer of layers) {
        const normalized = (sample + 1) / 2;
        layer.weight_index = Math.max(FLORA_WEIGHT_MIN, Math.min(FLORA_WEIGHT_MAX, Math.round(normalized * FLORA_WEIGHT_MAX)));
    }
}
