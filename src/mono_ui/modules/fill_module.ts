import type { Module, Rect, StyleName, Rgb, Canvas } from "../types.js";

export type FillModuleConfig = {
    id: string;
    rect: Rect;

    char: string;
    style?: StyleName;
    rgb?: Rgb;

    // optional; if omitted, canvas normalization defaults to 3
    weight_index?: number;
};


export function make_fill_module(config: FillModuleConfig): Module {
    return {
        id: config.id,
        rect: config.rect,

        Draw(canvas: Canvas): void {
            const cell = {
                char: config.char,
                ...(config.style !== undefined ? { style: config.style } : {}),
                ...(config.rgb !== undefined ? { rgb: config.rgb } : {}),
                ...(config.weight_index !== undefined ? { weight_index: config.weight_index } : {}),
            };

            canvas.fill_rect(config.rect, cell);
        },
    };
}
