import { resolve_inline_item } from "./resolve.js";

type SpoilsConfig = {
    period_breaths: number;
    result_item_def_id: string | null;
};

function get_item_qty(item: any): number {
    const qty = Number(item?.qty ?? 1);
    return Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 1;
}

function get_spoils_config(item: any): SpoilsConfig | null {
    const def_id = String(item?.def_id ?? '').trim();
    if (!def_id) return null;
    const resolved = resolve_inline_item(def_id, item);
    const tags = Array.isArray(resolved?.effective_tags) ? resolved.effective_tags : [];
    const tag = tags.find((entry: any) => String(entry?.name ?? '').toUpperCase() === 'SPOILS');
    const info = Array.isArray(tag?.info) ? tag.info[0] : tag?.info;
    if (!info || typeof info !== 'object') return null;
    const any_info: any = info;
    const raw_period = Number(any_info.period_breaths ?? any_info.period_ticks ?? any_info.period);
    if (!Number.isFinite(raw_period) || raw_period <= 0) return null;
    const result_item_def_id_raw = any_info.result_item_def_id ?? any_info.result_def_id ?? any_info.def_id;
    const result_item_def_id = typeof result_item_def_id_raw === 'string' && result_item_def_id_raw.trim().length > 0
        ? result_item_def_id_raw.trim()
        : null;
    return {
        period_breaths: Math.max(1, Math.floor(raw_period)),
        result_item_def_id,
    };
}

function get_spoils_signature(item: any): string | null {
    const config = get_spoils_config(item);
    if (!config) return null;
    return JSON.stringify(config);
}

export function can_stack_items_with_spoil_policy(item_a: any, def_a: any, item_b: any, def_b: any): boolean {
    if (!item_a || !item_b || !def_a || !def_b) return false;
    if (String(item_a.def_id ?? '') !== String(item_b.def_id ?? '')) return false;
    if (String(def_a.id ?? '') !== String(def_b.id ?? '')) return false;
    if (!def_a.stackable || !def_b.stackable) return false;
    if (Array.isArray(item_a.contents) && item_a.contents.length > 0) return false;
    if (Array.isArray(item_b.contents) && item_b.contents.length > 0) return false;

    const max_stack = Number(def_a.max_stack_size ?? 1);
    const combined_qty = get_item_qty(item_a) + get_item_qty(item_b);
    if (!Number.isFinite(max_stack) || combined_qty > Math.max(1, Math.floor(max_stack))) return false;

    const tags_a = Array.isArray(item_a.tags) ? item_a.tags : [];
    const tags_b = Array.isArray(item_b.tags) ? item_b.tags : [];
    if (tags_a.length !== tags_b.length) return false;

    return get_spoils_signature(item_a) === get_spoils_signature(item_b);
}

export function merge_item_stack_into_target(target: any, source: any, moved_qty?: number): number {
    const target_qty = get_item_qty(target);
    const source_qty = get_item_qty(source);
    const qty_to_move_raw = typeof moved_qty === 'number' && Number.isFinite(moved_qty) ? Math.floor(moved_qty) : source_qty;
    const qty_to_move = Math.max(0, Math.min(source_qty, qty_to_move_raw));
    if (qty_to_move <= 0) return 0;

    const total_qty = target_qty + qty_to_move;
    const target_last = Number(target?.last_breath_processed);
    const source_last = Number(source?.last_breath_processed);
    if (Number.isFinite(target_last) && Number.isFinite(source_last)) {
        target.last_breath_processed = Math.floor(((target_qty * target_last) + (qty_to_move * source_last)) / total_qty);
    } else if (Number.isFinite(source_last)) {
        target.last_breath_processed = Math.floor(source_last);
    } else if (Number.isFinite(target_last)) {
        target.last_breath_processed = Math.floor(target_last);
    }

    target.qty = total_qty;
    source.qty = source_qty - qty_to_move;
    return qty_to_move;
}
