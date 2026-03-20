import type { RenderContext } from "./types.js";

function finite_number(value: unknown, fallback: number): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

function hash3(x: number, y: number, z: number, seed: number): number {
    let h = Math.imul((x | 0) ^ (seed | 0), 0x45d9f3b);
    h = Math.imul(h ^ (y | 0), 0x45d9f3b);
    h = Math.imul(h ^ (z | 0), 0x45d9f3b);
    return h ^ (h >>> 16);
}

function grad(hash: number, x: number, y: number, z: number): number {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
    return (((h & 1) === 0) ? u : -u) + (((h & 2) === 0) ? v : -v);
}

export function sample_perlin3(x: number, y: number, z: number, seed: number = 0): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const xf = x - xi;
    const yf = y - yi;
    const zf = z - zi;
    const u = fade(xf);
    const v = fade(yf);
    const w = fade(zf);

    const n000 = grad(hash3(xi, yi, zi, seed), xf, yf, zf);
    const n100 = grad(hash3(xi + 1, yi, zi, seed), xf - 1, yf, zf);
    const n010 = grad(hash3(xi, yi + 1, zi, seed), xf, yf - 1, zf);
    const n110 = grad(hash3(xi + 1, yi + 1, zi, seed), xf - 1, yf - 1, zf);
    const n001 = grad(hash3(xi, yi, zi + 1, seed), xf, yf, zf - 1);
    const n101 = grad(hash3(xi + 1, yi, zi + 1, seed), xf - 1, yf, zf - 1);
    const n011 = grad(hash3(xi, yi + 1, zi + 1, seed), xf, yf - 1, zf - 1);
    const n111 = grad(hash3(xi + 1, yi + 1, zi + 1, seed), xf - 1, yf - 1, zf - 1);

    const x00 = lerp(n000, n100, u);
    const x10 = lerp(n010, n110, u);
    const x01 = lerp(n001, n101, u);
    const x11 = lerp(n011, n111, u);
    const y0 = lerp(x00, x10, v);
    const y1 = lerp(x01, x11, v);
    return lerp(y0, y1, w) / 1.5;
}

export function resolve_perlin_sample(ctx: RenderContext, opts?: {
    scale_x?: number;
    scale_y?: number;
    scale_z?: number;
    z_offset?: number;
    animated?: boolean;
    animation_speed?: number;
    seed?: number;
}): number {
    const world_x = finite_number(ctx.world_x, finite_number(ctx.place_x, finite_number(ctx.x, 0)));
    const world_y = finite_number(ctx.world_y, finite_number(ctx.place_y, finite_number(ctx.y, 0)));
    const world_z = finite_number(ctx.world_z, 0);
    const scale_x = finite_number(opts?.scale_x, 0.18);
    const scale_y = finite_number(opts?.scale_y, scale_x);
    const scale_z = finite_number(opts?.scale_z, scale_x);
    const z_offset = finite_number(opts?.z_offset, 0);
    const seed = Math.floor(finite_number(opts?.seed, 0));
    const animated = Boolean(opts?.animated);
    const animation_speed = finite_number(opts?.animation_speed, 0.1);
    const breath_phase = finite_number(ctx.breath_index, 0) * animation_speed;
    const nz = (world_z + z_offset) * scale_z + (animated ? breath_phase : 0);
    return sample_perlin3(world_x * scale_x, world_y * scale_y, nz, seed);
}
