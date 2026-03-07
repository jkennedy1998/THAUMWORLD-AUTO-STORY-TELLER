import type { RenderContext, RenderLayer } from "../types.js";
import { apply_container_modifier } from "./container.js";
import { apply_fire_modifier } from "./fire.js";

export type TagModifier = {
    id: string;
    apply: (layers: RenderLayer[], tags: any[], ctx: RenderContext) => void;
};

// Program-order modifiers. Do not encode per-item priorities.
export const TAG_MODIFIERS: readonly TagModifier[] = [
    {
        id: 'CONTAINER',
        apply: (layers, tags, ctx) => apply_container_modifier(layers, tags, ctx),
    },
    {
        id: 'FIRE!',
        apply: (layers, tags, _ctx) => apply_fire_modifier(layers, tags),
    },
];
