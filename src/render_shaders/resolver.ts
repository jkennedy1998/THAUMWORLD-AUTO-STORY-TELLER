import type { RenderContext, RenderOutput, DiscriminatedRenderPayload } from "./types.js";
import { shade_item_default } from "./base/item_default.js";
import { shade_entity_default } from "./base/entity_default.js";
import { shade_tile_ground_items } from "./base/tile_ground_items.js";
import { shade_tile_simple } from "./base/tile_simple.js";
import { shade_pile_default } from "./base/pile_default.js";
import { shade_ui_slot_default } from "./base/slot_default.js";
import { shade_ui_widget_default } from "./base/widget_default.js";
import { TAG_MODIFIERS } from "./tags/index.js";
import { UI_MODIFIERS } from "./ui/index.js";
import { reduce_layers_to_cell } from "./reducer.js";
import type { Cell } from "../mono_ui/types.js";

export function resolve_render(payload: DiscriminatedRenderPayload, ctx: RenderContext): RenderOutput {
    let out: RenderOutput;
    if (payload.kind === 'item') out = shade_item_default(payload, ctx);
    else if (payload.kind === 'pile') out = shade_pile_default(payload as any, ctx);
    else if (payload.kind === 'tile' && payload.tile_kind === 'ground_items') out = shade_tile_ground_items(payload, ctx);
    else if (payload.kind === 'tile' && payload.tile_kind === 'simple') out = shade_tile_simple(payload, ctx);
    else if (payload.kind === 'ui' && (payload as any).ui_kind === 'slot') out = shade_ui_slot_default(payload as any, ctx);
    else if (payload.kind === 'ui' && (payload as any).ui_kind === 'widget') out = shade_ui_widget_default(payload as any, ctx);
    else if (payload.kind === 'actor' || payload.kind === 'npc') out = shade_entity_default(payload as any, ctx);
    else out = { layers: [{ char: '?', z: 0 }] };

    const tags: any[] = (payload as any)?.tags ?? [];
    // Tag modifiers: program order.
    for (const m of TAG_MODIFIERS) {
        try {
            m.apply(out.layers, tags, ctx);
        } catch {
            // ignore
        }
    }

    // UI modifiers: program order, applied after tag modifiers.
    for (const m of UI_MODIFIERS) {
        try {
            m.apply(out.layers, ctx);
        } catch {
            // ignore
        }
    }
    return out;
}

export function resolve_char(payload: DiscriminatedRenderPayload, ctx: RenderContext): string {
    const out = resolve_render(payload, ctx);
    if (!out.layers || out.layers.length === 0) return ' ';
    let top = out.layers[0]!;
    for (const l of out.layers) {
        if (l.z >= top.z) top = l;
    }
    return String(top.char ?? ' ').charAt(0) || ' ';
}

export function resolve_cell(payload: DiscriminatedRenderPayload, ctx: RenderContext): Cell {
    const out = resolve_render(payload, ctx);
    const fallback_rgb = (payload as any)?.base_fg;
    return reduce_layers_to_cell(out.layers, {
        fallback_rgb,
        fallback_style: 'regular',
        fallback_weight_index: 1,
        fallback_render_index: 0,
        quantize_to_palette: false,
    });
}
