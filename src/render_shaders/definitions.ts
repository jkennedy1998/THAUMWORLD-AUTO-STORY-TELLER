import type { GraphicsModel, MaterialOptionsBySlot } from './graphics_contract.js';

export type RenderShaderId = 'checker_binary' | 'sine_wave' | 'perlin_noise';

export type RenderShaderZMode = 'global' | 'place';

export type RenderShaderBinding = {
    shader_id: RenderShaderId;
    params?: Record<string, unknown>;
    output?: {
        char?: string;
        char_gradient?: string;
        color_bands?: string[];
        weight_bands?: number[];
    };
};

export type RenderShaderBindings = RenderShaderBinding | RenderShaderBinding[];

export type EntityRenderProfile = {
    default_char?: string;
    body_part_chars?: Record<string, string>;
    render_shader?: RenderShaderBindings;
    body_part_shaders?: Record<string, RenderShaderBindings>;
    graphics?: GraphicsModel;
    materials?: MaterialOptionsBySlot;
    group_render?: {
        part_roles?: string[];
        main_part_role?: string;
    };
    animation?: {
        family?: string;
        default_state?: string;
    };
};
