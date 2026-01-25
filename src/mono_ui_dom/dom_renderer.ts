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
        // TODO: map DOM items + inventories into tiles
    }

    /**
     * Pure adapter: Canvas -> DOM
     */
    render(canvas: Canvas): void {
        //
    }

    /**
     * Later: tile click mapping
     */
    on_tile_click(handler: (x: number, y: number, cell: Cell) => void): void {
        //
    }
}
