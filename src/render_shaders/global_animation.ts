import type { RenderContext, TilePayload } from "./types.js";

export type CheckerDriverResult = {
    on: boolean;
    world_x: number;
    world_y: number;
    resolved_z: number;
    breath_index: number;
};

export function resolve_breath_phase(ctx: RenderContext, breaths_per_step: number = 1): number {
    const raw = finite_int(ctx.breath_index, 0);
    const per = Math.max(1, Math.floor(Number.isFinite(breaths_per_step) ? breaths_per_step : 1));
    return Math.floor(raw / per);
}

function finite_int(value: unknown, fallback: number): number {
    const n = Number(value);
    return Number.isFinite(n) ? Math.floor(n) : fallback;
}

export function resolve_global_focus_z(ctx: RenderContext): number {
    return finite_int(ctx.world_z, 0) - finite_int(ctx.focus_world_z, finite_int(ctx.world_z, 0));
}

export function resolve_place_centered_z(ctx: RenderContext): number {
    return finite_int(ctx.world_z, 0) - finite_int(ctx.place_base_z, finite_int(ctx.world_z, 0));
}

export function resolve_world_animation_coords(ctx: RenderContext): { x: number; y: number } {
    const x = finite_int(ctx.world_x, finite_int(ctx.place_x, finite_int(ctx.x, 0)));
    const y = finite_int(ctx.world_y, finite_int(ctx.place_y, finite_int(ctx.y, 0)));
    return { x, y };
}

export function resolve_checker_driver(ctx: RenderContext, opts?: { z_mode?: 'global' | 'place'; breaths_per_swap?: number }): CheckerDriverResult {
    const coords = resolve_world_animation_coords(ctx);
    const breaths_per_swap = Math.max(1, finite_int(opts?.breaths_per_swap, 1));
    const breath_index = resolve_breath_phase(ctx, breaths_per_swap);
    const resolved_z = opts?.z_mode === 'global'
        ? resolve_global_focus_z(ctx)
        : resolve_place_centered_z(ctx);
    const parity = coords.x + coords.y + resolved_z + breath_index;
    return {
        on: (parity & 1) === 0,
        world_x: coords.x,
        world_y: coords.y,
        resolved_z,
        breath_index,
    };
}

export function resolve_sine_driver(ctx: RenderContext, opts?: {
    wavelength?: number;
    breaths_per_cycle?: number;
    phase?: number;
}): number {
    const coords = resolve_world_animation_coords(ctx);
    const wavelength = Math.max(1, Number.isFinite(opts?.wavelength) ? Number(opts?.wavelength) : 18);
    const breaths_per_cycle = Math.max(1, Number.isFinite(opts?.breaths_per_cycle) ? Number(opts?.breaths_per_cycle) : 6);
    const phase = Number.isFinite(opts?.phase) ? Number(opts?.phase) : 0;
    const t = finite_int(ctx.breath_index, 0) / breaths_per_cycle;
    const u = (coords.x + coords.y) / wavelength;
    return Math.sin((u + t + phase) * Math.PI * 2);
}

export function is_bush_tile(payload: TilePayload): boolean {
    const def_id = String((payload as any)?.def_id ?? '').toLowerCase();
    if (def_id.includes('bush')) return true;
    const tags = Array.isArray((payload as any)?.tags) ? (payload as any).tags : [];
    const has_flora = tags.some((tag: any) => String(tag?.name ?? '').toUpperCase() === 'FLORA');
    const ch = String((payload as any)?.char ?? ' ').charAt(0);
    return has_flora && ch === '&';
}
