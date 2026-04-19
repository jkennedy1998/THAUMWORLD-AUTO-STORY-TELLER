import type { Canvas, Module } from "./types.js";

export function compose_modules(
    canvas: Canvas,
    modules: readonly Module[],
    on_module_draw?: (module: Module, duration_ms: number) => void,
): void {
    // Clear whole canvas each frame (lofi, correct baseline)
    // This ensures a clean slate for all modules every frame
    canvas.fill_rect(
        { x0: 0, y0: 0, x1: canvas.width - 1, y1: canvas.height - 1 },
        { char: " " },
    );

    // Z-order = array order. Later modules overwrite earlier ones.
    for (const module of modules) {
        const started_at_ms = on_module_draw ? performance.now() : 0;
        module.Draw(canvas);
        if (on_module_draw) on_module_draw(module, Math.max(0, performance.now() - started_at_ms));
    }
}
