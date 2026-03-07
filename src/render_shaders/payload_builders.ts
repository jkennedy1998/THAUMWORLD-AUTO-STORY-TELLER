import type { ItemInstance } from "../item_instances/store.js";
import type { ItemDefinition } from "../item_storage/store.js";
import type { Rgb } from "../mono_ui/types.js";
import type { DiscriminatedRenderPayload } from "./types.js";

export function pick_tags(instance: any, definition: any): any[] {
    const inst_tags = instance && Array.isArray(instance.tags) ? instance.tags : null;
    if (inst_tags && inst_tags.length > 0) return inst_tags;
    const def_tags = definition && Array.isArray(definition.tags) ? definition.tags : null;
    return def_tags ?? [];
}

export function make_item_payload(
    instance: ItemInstance,
    definition: ItemDefinition,
    opts?: { base_fg?: Rgb },
): DiscriminatedRenderPayload {
    return {
        kind: 'item',
        id: instance.id,
        def_id: (definition as any)?.id ?? (instance as any)?.def_id,
        name: (definition as any)?.name ?? (instance as any)?.name,
        qty: instance.qty,
        display_char: (instance as any).display_char ?? (definition as any).display_char,
        tags: pick_tags(instance as any, definition as any),
        base_fg: opts?.base_fg,
    } as any;
}

export function make_item_like_payload(opts: {
    id: string;
    def_id?: string;
    name?: string;
    qty?: number;
    display_char?: string;
    tags?: any[];
    base_fg?: Rgb;
}): DiscriminatedRenderPayload {
    return {
        kind: 'item',
        id: opts.id,
        def_id: opts.def_id,
        name: opts.name,
        qty: opts.qty,
        display_char: typeof opts.display_char === 'string' ? String(opts.display_char).charAt(0) : undefined,
        tags: Array.isArray(opts.tags) ? opts.tags : [],
        base_fg: opts.base_fg,
    } as any;
}

export function make_slot_payload(opts: {
    id: string;
    slot_type?: 'tool' | 'armor' | 'garb' | 'neutral';
    is_placeholder?: boolean;
    base_fg?: Rgb;
}): DiscriminatedRenderPayload {
    return {
        kind: 'ui',
        ui_kind: 'slot',
        id: opts.id,
        slot_type: opts.slot_type,
        is_placeholder: opts.is_placeholder,
        base_fg: opts.base_fg,
    } as any;
}

export function make_widget_payload(opts: {
    id: string;
    widget: 'close' | 'move' | 'save_position' | 'resize';
    widget_state?: 'idle' | 'active' | 'disabled';
    base_fg?: Rgb;
}): DiscriminatedRenderPayload {
    return {
        kind: 'ui',
        ui_kind: 'widget',
        id: opts.id,
        widget: opts.widget,
        widget_state: opts.widget_state,
        base_fg: opts.base_fg,
    } as any;
}

export function make_pile_payload(opts: {
    id: string;
    pile_count: number;
    rep: {
        def_id?: string;
        name?: string;
        qty?: number;
        display_char?: string;
        tags?: any[];
    };
    base_fg?: Rgb;
}): DiscriminatedRenderPayload {
    return {
        kind: 'pile',
        id: opts.id,
        name: opts.rep.name,
        def_id: opts.rep.def_id,
        qty: opts.rep.qty,
        display_char: opts.rep.display_char,
        tags: Array.isArray(opts.rep.tags) ? opts.rep.tags : [],
        pile_count: opts.pile_count,
        base_fg: opts.base_fg,
    } as any;
}

export function make_entity_payload(
    kind: 'actor' | 'npc',
    id: string,
    name: string,
    tags: any[],
    opts?: { base_fg?: Rgb },
): DiscriminatedRenderPayload {
    return {
        kind,
        id,
        name,
        tags: Array.isArray(tags) ? tags : [],
        base_fg: opts?.base_fg,
    } as any;
}

export function make_ground_items_tile_payload(
    id: string,
    pile_count: number,
    single_qty: number | undefined,
    opts?: { base_fg?: Rgb },
): DiscriminatedRenderPayload {
    return {
        kind: 'tile',
        id,
        tile_kind: 'ground_items',
        pile_count,
        single_qty,
        base_fg: opts?.base_fg,
    } as any;
}

export function make_simple_tile_payload(opts: {
    id: string;
    char: string;
    base_fg?: Rgb;
    weight_index?: number;
    style?: any;
}): DiscriminatedRenderPayload {
    return {
        kind: 'tile',
        tile_kind: 'simple',
        id: opts.id,
        char: String(opts.char ?? ' ').charAt(0) || ' ',
        base_fg: opts.base_fg,
        weight_index: typeof opts.weight_index === 'number' ? opts.weight_index : undefined,
        style: opts.style,
    } as any;
}
