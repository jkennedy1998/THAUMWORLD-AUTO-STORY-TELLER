import { get_color_by_alias } from "../mono_ui/colors.js";
import type { Rgb } from "../mono_ui/types.js";

export function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

export function normalize_signed_sample(value: number): number {
    return clamp01((Number.isFinite(value) ? value : 0) * 0.5 + 0.5);
}

export function sample_band_index(value: number, band_count: number): number {
    const count = Math.max(1, Math.floor(Number.isFinite(band_count) ? band_count : 1));
    const v = clamp01(value);
    return Math.min(count - 1, Math.floor(v * count));
}

export function sample_char_gradient(value: number, gradient: string, fallback: string = ' '): string {
    const chars = String(gradient ?? '');
    if (chars.length < 1) return String(fallback ?? ' ').charAt(0) || ' ';
    const idx = sample_band_index(value, chars.length);
    return chars.charAt(idx) || String(fallback ?? ' ').charAt(0) || ' ';
}

export function sample_color_bands(value: number, color_names: readonly string[], fallback: Rgb): Rgb {
    if (!Array.isArray(color_names) || color_names.length < 1) return fallback;
    const idx = sample_band_index(value, color_names.length);
    const name = color_names[idx];
    if (typeof name !== 'string' || name.length < 1) return fallback;
    try {
        return get_color_by_alias(name).rgb;
    } catch {
        return fallback;
    }
}

export function sample_weight_bands(value: number, weights: readonly number[], fallback: number): number {
    if (!Array.isArray(weights) || weights.length < 1) return fallback;
    const idx = sample_band_index(value, weights.length);
    const weight = Number(weights[idx]);
    return Number.isFinite(weight) ? Math.floor(weight) : fallback;
}
