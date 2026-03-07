import type { RenderSpace } from "./types.js";

export type ShaderGlobals = {
    now_ms: number;
    // Sample a diagonal sine wave in grid space.
    diag_sine: (x: number, y: number, opts?: { space?: RenderSpace; speed?: number; wavelength?: number; phase?: number }) => number;
};

export function make_shader_globals(now_ms: number = Date.now()): ShaderGlobals {
    return {
        now_ms,
        diag_sine(x: number, y: number, opts?: { space?: RenderSpace; speed?: number; wavelength?: number; phase?: number }): number {
            // Screen-space by default.
            const speed = typeof opts?.speed === 'number' ? opts.speed : 1.0;
            const wavelength = typeof opts?.wavelength === 'number' ? opts.wavelength : 18.0;
            const phase = typeof opts?.phase === 'number' ? opts.phase : 0;
            const t = (now_ms / 1000) * speed;
            const u = (x + y) / wavelength;
            return Math.sin((u + t + phase) * Math.PI * 2);
        },
    };
}
