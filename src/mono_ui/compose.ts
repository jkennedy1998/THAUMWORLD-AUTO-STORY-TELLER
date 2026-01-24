import type { Canvas, Module } from "./types.js";

export function compose_modules(canvas: Canvas, modules: Module[]): void {
    // Clear whole canvas each frame (lofi, correct baseline)
    canvas.fill_rect(
        { x0: 0, y0: 0, x1: canvas.width - 1, y1: canvas.height - 1 },
        { char: " " },
    );

    // Z-order = array order. Later modules overwrite earlier ones.
    for (const module of modules) {
        module.Draw(canvas);
    }
}
