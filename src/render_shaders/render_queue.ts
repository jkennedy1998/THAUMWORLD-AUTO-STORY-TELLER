import type { Cell } from "../mono_ui/types.js";
import { resolve_cell } from "./resolver.js";
import type { DiscriminatedRenderPayload, RenderContext } from "./types.js";

export type RenderPass = 'tile' | 'item' | 'character' | 'particle' | 'ui';

export const DEFAULT_RENDER_PASS_ORDER: readonly RenderPass[] = [
    'tile',
    'item',
    'character',
    'particle',
    'ui',
];

export type RenderRequest = {
    pass: RenderPass;
    x: number;
    y: number;
    // Deterministic tie-break when multiple requests collide.
    // Smaller draws first; larger draws last (on top).
    order?: number;
    // Used for stable sort + flashing selection.
    key?: string;
} & (
    | { cell: Cell; op?: 'set' | 'tint_fg'; payload?: never; ctx?: never }
    | { payload: DiscriminatedRenderPayload; ctx: RenderContext; cell?: never }
);

export type RenderQueueOptions = {
    now_ms?: number;
    pass_order?: readonly RenderPass[];
    // When multiple characters share a tile, flash between them.
    character_flash_period_ms?: number;
};

export type CanvasLike = {
    set: (x: number, y: number, cell: Cell) => void;
    get?: (x: number, y: number) => Cell | undefined;
};

function default_render_index_for_pass(pass: RenderPass): number {
    // Keep this aligned with src/mono_ui/types.ts Cell.render_index comment.
    if (pass === 'tile') return 1;
    if (pass === 'item') return 2;
    if (pass === 'particle') return 3;
    if (pass === 'character') return 4;
    return 6; // ui
}

function cell_key(x: number, y: number): string {
    return `${x},${y}`;
}

function req_sort_key(r: RenderRequest): { order: number; key: string } {
    const order = typeof r.order === 'number' ? r.order : 0;
    const key = typeof r.key === 'string' && r.key.length > 0
        ? r.key
        : (typeof (r as any)?.payload?.id === 'string' ? String((r as any).payload.id) : '');
    return { order, key };
}

export function select_flash_index(now_ms: number, n: number, period_ms: number): number {
    if (!Number.isFinite(now_ms)) now_ms = 0;
    if (!Number.isFinite(period_ms) || period_ms <= 0) period_ms = 240;
    if (!Number.isFinite(n) || n <= 0) return 0;
    const phase = Math.floor(now_ms / period_ms);
    return Math.abs(phase) % n;
}

function resolve_request_to_cell(r: RenderRequest, now_ms: number): Cell {
    if ((r as any).cell) return (r as any).cell as Cell;
    const payload = (r as any).payload as DiscriminatedRenderPayload;
    const ctx0 = (r as any).ctx as RenderContext;
    const ctx: RenderContext = {
        ...ctx0,
        x: r.x,
        y: r.y,
        time_ms: typeof ctx0?.time_ms === 'number' ? ctx0.time_ms : now_ms,
    };
    return resolve_cell(payload, ctx);
}

export function draw_render_queue(canvas: CanvasLike, queue: readonly RenderRequest[], opts?: RenderQueueOptions): void {
    if (!queue || queue.length === 0) return;
    const now_ms = typeof opts?.now_ms === 'number' ? opts.now_ms : Date.now();
    const pass_order = (opts?.pass_order && opts.pass_order.length > 0)
        ? opts.pass_order
        : DEFAULT_RENDER_PASS_ORDER;
    const flash_period = typeof opts?.character_flash_period_ms === 'number' ? opts.character_flash_period_ms : 240;

    // Bucket by pass, then by cell.
    const by_pass = new Map<RenderPass, Map<string, RenderRequest[]>>();
    for (const r of queue) {
        const p = r.pass;
        let by_cell = by_pass.get(p);
        if (!by_cell) {
            by_cell = new Map();
            by_pass.set(p, by_cell);
        }
        const k = cell_key(r.x, r.y);
        const arr = by_cell.get(k);
        if (arr) arr.push(r);
        else by_cell.set(k, [r]);
    }

    for (const pass of pass_order) {
        const by_cell = by_pass.get(pass);
        if (!by_cell) continue;

        for (const [, requests] of by_cell.entries()) {
            if (!requests || requests.length === 0) continue;

            // Stable deterministic order.
            requests.sort((a, b) => {
                const ak = req_sort_key(a);
                const bk = req_sort_key(b);
                if (ak.order !== bk.order) return ak.order - bk.order;
                return ak.key.localeCompare(bk.key);
            });

            // Special composition rule: flashing for character collisions.
            if (pass === 'character' && requests.length >= 2) {
                const idx = select_flash_index(now_ms, requests.length, flash_period);
                const chosen = requests[idx]!;
                const cell0 = resolve_request_to_cell(chosen, now_ms);
                const cell = { ...cell0, render_index: default_render_index_for_pass(pass) };
                canvas.set(chosen.x, chosen.y, cell);
                continue;
            }

            // Default: draw sequentially, last one wins.
            for (const r of requests) {
                const op = (r as any).op ?? 'set';
                if ((r as any).cell && op === 'tint_fg') {
                    const tint = (r as any).cell as Cell;
                    const existing = canvas.get?.(r.x, r.y);
                    if (existing) {
                        // Do not tint characters (keeps entities readable).
                        if (typeof existing.render_index === 'number' && existing.render_index >= 4) {
                            continue;
                        }
                        const fallback_char = (typeof tint.char === 'string' && tint.char.length > 0) ? tint.char : existing.char;
                        const next_char = (existing.char === ' ' || existing.char === '') ? fallback_char : existing.char;
                        canvas.set(r.x, r.y, {
                            char: next_char,
                            rgb: tint.rgb ?? existing.rgb,
                            style: tint.style ?? existing.style,
                            weight_index: typeof tint.weight_index === 'number' ? tint.weight_index : existing.weight_index,
                            render_index: Math.max(existing.render_index ?? 0, default_render_index_for_pass(pass)),
                        } as any);
                    } else {
                        const ri = typeof tint.render_index === 'number' ? tint.render_index : default_render_index_for_pass(pass);
                        canvas.set(r.x, r.y, { ...tint, render_index: ri });
                    }
                    continue;
                }

                const cell0 = resolve_request_to_cell(r, now_ms);
                const ri = typeof cell0.render_index === 'number' && cell0.render_index !== 0
                    ? cell0.render_index
                    : default_render_index_for_pass(pass);
                const cell = { ...cell0, render_index: ri };
                canvas.set(r.x, r.y, cell);
            }
        }
    }
}
