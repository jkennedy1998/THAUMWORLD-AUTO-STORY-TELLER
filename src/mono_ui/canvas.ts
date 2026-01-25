import type { Canvas, Cell, Rect, Rgb, StyleName } from "./types.js";
import { get_color_by_name } from "./colors.js";

const DEFAULT_RGB: Rgb = get_color_by_name("off_white").rgb;
const DEFAULT_STYLE: StyleName = "regular";
const DEFAULT_CHAR = " ";

// 0..7 => 8 weights. default 3 ≈ "regular"
const DEFAULT_WEIGHT_INDEX = 3;

function clamp_weight_index(n: unknown): number {
    const v = typeof n === "number" ? Math.trunc(n) : DEFAULT_WEIGHT_INDEX;
    if (!Number.isFinite(v)) return DEFAULT_WEIGHT_INDEX;
    return Math.max(0, Math.min(7, v));
}


function clamp_byte(n: number): number {
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(255, Math.round(n)));
}

function normalize_cell(partial: Partial<Cell> & { char: string }): Cell {
    const first = partial.char.charAt(0);
    const char = first !== "" ? first : DEFAULT_CHAR;


    const rgb = partial.rgb
        ? { r: clamp_byte(partial.rgb.r), g: clamp_byte(partial.rgb.g), b: clamp_byte(partial.rgb.b) }
        : DEFAULT_RGB;

    const style = partial.style ?? DEFAULT_STYLE;
    const weight_index = clamp_weight_index((partial as any).weight_index);

    return { char, rgb, style, weight_index };

}

// Bottom-left coords (x,y) map to internal row-major storage (row 0 = top row)
function to_index(width: number, height: number, x: number, y: number): number | null {
    if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
    if (x < 0 || x >= width) return null;
    if (y < 0 || y >= height) return null;

    const row = height - 1 - y; // invert y (bottom-left origin)
    return row * width + x;
}

export function create_canvas(width: number, height: number, fill?: Partial<Cell> & { char: string }): Canvas {
    if (!Number.isInteger(width) || width <= 0) throw new Error("Canvas width must be a positive integer");
    if (!Number.isInteger(height) || height <= 0) throw new Error("Canvas height must be a positive integer");

    const base = normalize_cell(fill ?? { char: DEFAULT_CHAR });
    const cells: Cell[] = Array.from({ length: width * height }, () => ({ ...base }));

    const api: Canvas = {
        width,
        height,

        get(x: number, y: number): Cell | undefined {
            const idx = to_index(width, height, x, y);
            if (idx === null) return undefined;
            return cells[idx];
        },

        set(x: number, y: number, cell: Partial<Cell> & { char: string }): void {
            const idx = to_index(width, height, x, y);
            if (idx === null) return;
            const next = normalize_cell({ ...cells[idx], ...cell });
            cells[idx] = next;
        },

        clear_rect(rect: Rect): void {
            api.fill_rect(rect, { char: " " });
        },

        fill_rect(rect: Rect, cell: Partial<Cell> & { char: string }): void {
            const norm = normalize_cell(cell);

            const x0 = Math.min(rect.x0, rect.x1);
            const x1 = Math.max(rect.x0, rect.x1);
            const y0 = Math.min(rect.y0, rect.y1);
            const y1 = Math.max(rect.y0, rect.y1);

            for (let y = y0; y <= y1; y++) {
                for (let x = x0; x <= x1; x++) {
                    const idx = to_index(width, height, x, y);
                    if (idx === null) continue;
                    cells[idx] = { ...norm };
                }
            }
        },

        // Bresenham line, inclusive endpoints
        draw_line(x0: number, y0: number, x1: number, y1: number, cell: Partial<Cell> & { char: string }): void {
            const norm = normalize_cell(cell);

            let x = Math.trunc(x0);
            let y = Math.trunc(y0);
            const tx = Math.trunc(x1);
            const ty = Math.trunc(y1);

            const dx = Math.abs(tx - x);
            const dy = Math.abs(ty - y);

            const sx = x < tx ? 1 : -1;
            const sy = y < ty ? 1 : -1;

            let err = dx - dy;

            while (true) {
                const idx = to_index(width, height, x, y);
                if (idx !== null) cells[idx] = { ...norm };

                if (x === tx && y === ty) break;

                const e2 = 2 * err;
                if (e2 > -dy) {
                    err -= dy;
                    x += sx;
                }
                if (e2 < dx) {
                    err += dx;
                    y += sy;
                }
            }
        },
    };

    return api;
}
