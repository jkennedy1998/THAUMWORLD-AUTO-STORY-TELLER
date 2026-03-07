import type { RenderContext, RenderLayer } from "../types.js";
import { apply_ui_default_container_modifier } from "./default_container.js";
import { apply_ui_place_tile_interaction_modifier } from "./place_tile_interaction.js";
import { apply_ui_tool_mismatch_modifier } from "./tool_mismatch.js";
import { apply_ui_weight_modifier } from "./weight.js";
import { apply_ui_pulse_modifier } from "./pulse.js";

export type UiModifier = {
    id: string;
    apply: (layers: RenderLayer[], ctx: RenderContext) => void;
};

// Program-order UI modifiers.
export const UI_MODIFIERS: readonly UiModifier[] = [
    { id: 'ui_tool_mismatch', apply: (layers, ctx) => apply_ui_tool_mismatch_modifier(layers, ctx) },
    { id: 'ui_default_container', apply: (layers, ctx) => apply_ui_default_container_modifier(layers, ctx) },
    { id: 'ui_place_tile_interaction', apply: (layers, ctx) => apply_ui_place_tile_interaction_modifier(layers, ctx) },
    { id: 'ui_weight', apply: (layers, ctx) => apply_ui_weight_modifier(layers, ctx) },
    { id: 'ui_pulse', apply: (layers, ctx) => apply_ui_pulse_modifier(layers, ctx) },
];
