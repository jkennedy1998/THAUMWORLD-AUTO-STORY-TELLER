import type { Rgb } from "../mono_ui/types.js";
import { normalize_signed_sample, sample_char_gradient, sample_color_bands, sample_weight_bands } from "./gradient_sampling.js";
import { resolve_checker_driver, resolve_sine_driver } from "./global_animation.js";
import { resolve_perlin_sample } from "./noise.js";
import type { RenderShaderBinding, RenderShaderBindings, RenderShaderId } from "./definitions.js";
import type { RenderContext } from "./types.js";

export type RenderShaderDefinition = {
    id: RenderShaderId;
    field_type: 'binary' | 'scalar';
    sample: (ctx: RenderContext, binding: RenderShaderBinding) => number;
};

function num(params: Record<string, unknown> | undefined, key: string, fallback: number): number {
    const n = Number(params?.[key]);
    return Number.isFinite(n) ? n : fallback;
}

function bool(params: Record<string, unknown> | undefined, key: string, fallback: boolean): boolean {
    const v = params?.[key];
    return typeof v === 'boolean' ? v : fallback;
}

function z_mode(params: Record<string, unknown> | undefined): 'global' | 'place' {
    return params?.z_mode === 'global' ? 'global' : 'place';
}

export const RENDER_SHADER_REGISTRY: readonly RenderShaderDefinition[] = [
    {
        id: 'checker_binary',
        field_type: 'binary',
        sample: (ctx, binding) => resolve_checker_driver(ctx, {
            z_mode: z_mode(binding.params),
            breaths_per_swap: num(binding.params, 'breaths_per_swap', 1),
        }).on ? 1 : 0,
    },
    {
        id: 'sine_wave',
        field_type: 'scalar',
        sample: (ctx, binding) => resolve_sine_driver(ctx, {
            wavelength: num(binding.params, 'wavelength', 18),
            breaths_per_cycle: num(binding.params, 'breaths_per_cycle', 6),
            phase: num(binding.params, 'phase', 0),
        }),
    },
    {
        id: 'perlin_noise',
        field_type: 'scalar',
        sample: (ctx, binding) => resolve_perlin_sample(ctx, {
            scale_x: num(binding.params, 'scale_x', 0.18),
            scale_y: num(binding.params, 'scale_y', num(binding.params, 'scale_x', 0.18)),
            scale_z: num(binding.params, 'scale_z', num(binding.params, 'scale_x', 0.18)),
            z_offset: num(binding.params, 'z_offset', 0),
            animated: bool(binding.params, 'animated', false),
            animation_speed: num(binding.params, 'animation_speed', 0.1),
            seed: num(binding.params, 'seed', 0),
        }),
    },
];

const SHADER_BY_ID = new Map<RenderShaderId, RenderShaderDefinition>(
    RENDER_SHADER_REGISTRY.map((shader) => [shader.id, shader]),
);

export function get_render_shader(id: RenderShaderId): RenderShaderDefinition | null {
    return SHADER_BY_ID.get(id) ?? null;
}

export function resolve_shader_sample(ctx: RenderContext, binding: RenderShaderBinding): { definition: RenderShaderDefinition; sample: number; normalized: number } | null {
    const definition = get_render_shader(binding.shader_id);
    if (!definition) return null;
    const sample = definition.sample(ctx, binding);
    const normalized = definition.field_type === 'binary'
        ? (sample > 0 ? 1 : 0)
        : normalize_signed_sample(sample);
    return { definition, sample, normalized };
}

export function apply_shader_outputs(base: {
    char: string;
    fg?: Rgb;
    weight_index: number;
}, ctx: RenderContext, binding?: RenderShaderBinding | null): {
    char: string;
    fg?: Rgb;
    weight_index: number;
} {
    if (!binding) return base;
    const resolved = resolve_shader_sample(ctx, binding);
    if (!resolved) return base;
    const output = binding.output ?? {};
    const char = typeof output.char === 'string' && output.char.length > 0
        ? output.char.charAt(0)
        : (typeof output.char_gradient === 'string' && output.char_gradient.length > 0
            ? sample_char_gradient(resolved.normalized, output.char_gradient, base.char)
            : base.char);
    const fg = Array.isArray(output.color_bands) && output.color_bands.length > 0 && base.fg
        ? sample_color_bands(resolved.normalized, output.color_bands, base.fg)
        : base.fg;
    const weight_index = Array.isArray(output.weight_bands) && output.weight_bands.length > 0
        ? sample_weight_bands(resolved.normalized, output.weight_bands, base.weight_index)
        : base.weight_index;
    return { char, fg, weight_index };
}

export function apply_shader_bindings(base: {
    char: string;
    fg?: Rgb;
    weight_index: number;
}, ctx: RenderContext, bindings?: RenderShaderBindings | null): {
    char: string;
    fg?: Rgb;
    weight_index: number;
} {
    if (!bindings) return base;
    const list = Array.isArray(bindings) ? bindings : [bindings];
    let out = base;
    for (const binding of list) {
      out = apply_shader_outputs(out, ctx, binding);
    }
    return out;
}
