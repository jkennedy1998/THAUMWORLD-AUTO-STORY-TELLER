import { apply_shader_bindings } from "../shader_registry.js";
import type { EntityPayload, RenderContext, RenderLayer, RenderOutput } from "../types.js";

function get_initial(name: string): string {
    if (!name || name.length === 0) return "?";
    return name.charAt(0).toUpperCase();
}

export function shade_entity_default(payload: EntityPayload, _ctx: RenderContext): RenderOutput {
    const nm = String(payload.name ?? payload.id ?? '');
    const part = String(_ctx.body_part ?? 'body');
    const profile = payload.entity_render;
    const npc_initial_char = payload.kind === 'npc' ? get_initial(nm) : '';
    const base_char = typeof profile?.body_part_chars?.[part] === 'string' && profile.body_part_chars[part]!.length > 0
        ? profile.body_part_chars[part]!.charAt(0)
        : (npc_initial_char
            ? npc_initial_char
            : (typeof profile?.default_char === 'string' && profile.default_char.length > 0
                ? profile.default_char.charAt(0)
                : get_initial(nm)));
    const binding = profile?.body_part_shaders?.[part] ?? profile?.render_shader ?? payload.render_shader;
    const shaded = apply_shader_bindings({
        char: base_char,
        fg: payload.base_fg,
        weight_index: 3,
    }, _ctx, binding);
    const layer: RenderLayer = {
        char: shaded.char,
        fg: shaded.fg,
        z: 0,
        style: 'regular',
        weight_index: shaded.weight_index,
    };
    return { layers: [layer] };
}
