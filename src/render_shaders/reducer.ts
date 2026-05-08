import type { Cell, Rgb } from "../mono_ui/types.js";
import { nearest_indexed_rgb } from "../mono_ui/colors.js";
import type { RenderLayer } from "./types.js";

export type ReduceOptions = {
    fallback_rgb?: Rgb;
    fallback_style?: string;
    fallback_weight_index?: number;
    fallback_render_index?: number;
    quantize_to_palette?: boolean;
    light_mag?: number;
};

function clamp_byte(n: number): number {
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(255, Math.round(n)));
}

export function reduce_layers_to_cell(layers: readonly RenderLayer[], opts?: ReduceOptions): Cell {
    const fallback_rgb: Rgb = opts?.fallback_rgb ?? { r: 200, g: 200, b: 200 };
    const fallback_style = (opts?.fallback_style ?? 'regular') as any;
    const fallback_weight_index = typeof opts?.fallback_weight_index === 'number' ? opts.fallback_weight_index : 0;
    const fallback_render_index = typeof opts?.fallback_render_index === 'number' ? opts.fallback_render_index : 0;
    const quantize = Boolean(opts?.quantize_to_palette);

    if (!layers || layers.length === 0) {
        return {
            char: ' ',
            graphic: undefined,
            appearance_slots: undefined,
            materials: undefined,
            light_mag: opts?.light_mag,
            rgb: quantize ? nearest_indexed_rgb(fallback_rgb) : fallback_rgb,
            style: fallback_style,
            weight_index: fallback_weight_index,
            render_index: fallback_render_index,
        };
    }

    // Highest z wins char.
    let top = layers[0]!;
    for (const l of layers) {
        if (l.z >= top.z) top = l;
    }

    const char = String(top.char ?? ' ').charAt(0) || ' ';

    const rgb0 = top.fg ?? fallback_rgb;
    const rgb = { r: clamp_byte(rgb0.r), g: clamp_byte(rgb0.g), b: clamp_byte(rgb0.b) };

    const out_rgb = quantize ? nearest_indexed_rgb(rgb) : rgb;

    return {
        char,
        graphic: top.graphic,
        appearance_slots: top.appearance_slots,
        materials: top.materials,
        light_mag: opts?.light_mag,
        rgb: out_rgb,
        style: (top.style ?? fallback_style) as any,
        weight_index: typeof top.weight_index === 'number' ? top.weight_index : fallback_weight_index,
        render_index: fallback_render_index,
    };
}
