import type { RenderContext, RenderLayer, RenderOutput } from "../types.js";

export type EntityPayload = {
    kind: 'actor' | 'npc';
    id?: string;
    name?: string;
    tags?: any[];
    base_fg?: { r: number; g: number; b: number };
};

function get_initial(name: string): string {
    if (!name || name.length === 0) return "?";
    return name.charAt(0).toUpperCase();
}

export function shade_entity_default(payload: EntityPayload, _ctx: RenderContext): RenderOutput {
    const nm = String(payload.name ?? payload.id ?? '');
    const char = get_initial(nm);
    const layer: RenderLayer = {
        char,
        fg: payload.base_fg,
        z: 0,
        style: 'regular',
        weight_index: 6,
    };
    return { layers: [layer] };
}
