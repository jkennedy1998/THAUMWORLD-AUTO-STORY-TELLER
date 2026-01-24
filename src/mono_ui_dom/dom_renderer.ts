import type { Canvas, Cell } from "../mono_ui/types.js";

export type DomRendererConfig = {
    scale: number; // 1.0 = 100%
    font_family: string;
};

export class DomRenderer {
    private config: DomRendererConfig;

    constructor(config: DomRendererConfig) {
        this.config = config;
    }

    /**
     * Later: attach to a real DOM root
     */
    attach(root: HTMLElement): void {
        // TODO: create grid container, store root
    }

    /**
     * Pure adapter: Canvas -> DOM
     */
    render(canvas: Canvas): void {
        // TODO:
        // - iterate canvas
        // - map each Cell to a DOM tile
        // - apply font, scale, color
    }

    /**
     * Later: tile click mapping
     */
    on_tile_click(handler: (x: number, y: number, cell: Cell) => void): void {
        // TODO
    }
}
