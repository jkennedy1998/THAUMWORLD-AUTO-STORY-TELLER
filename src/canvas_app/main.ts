import { create_canvas } from '../mono_ui/canvas.js';
import { compose_modules } from '../mono_ui/compose.js';
import { make_fill_module } from '../mono_ui/modules/fill_module.js';
import type { Canvas, Cell, Module, Rect, Rgb, TileEvent } from '../mono_ui/types.js';


// ---------- renderer config (matches your Figma % intent) ----------
const FONT_FAMILY = 'Martian Mono';
const BASE_FONT_SIZE_PX = 10; // scale=1 => ~10px
const BASE_LINE_HEIGHT_MULT = 1.5; // 150%
const BASE_LETTER_SPACING_MULT = 0.08; // 8%
let scale = 1.0; // 0..2 => 0%..200%
let last_click: { x: number; y: number } | null = null;
let last_hover: { x: number; y: number } | null = null;


// ---------- canvas size (tile grid) ----------
const grid_width = 80;
const grid_height = 30;

// ---------- helper: rect contains (inclusive) ----------
function rect_contains(rect: Rect, x: number, y: number): boolean {
    return x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1;
}

function route_to_top_module(modules: Module[], x: number, y: number): Module | undefined {
    for (let i = modules.length - 1; i >= 0; i--) {
        const m = modules[i];
        if (rect_contains(m.rect, x, y)) return m;
    }
    return undefined;
}

// ---------- canvas element ----------
const el = document.getElementById('mono_canvas') as HTMLCanvasElement;
const ctx = el.getContext('2d');
if (!ctx) throw new Error('2d canvas context not available');

// ---------- engine canvas ----------
const engine_canvas: Canvas = create_canvas(grid_width, grid_height);

// ---------- demo modules (z-order = array order) ----------
const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const CYAN: Rgb = { r: 120, g: 220, b: 255 };
const YELLOW: Rgb = { r: 255, g: 220, b: 120 };

const modules: Module[] = [
    make_fill_module({
        id: 'bg',
        rect: { x0: 0, y0: 0, x1: grid_width - 1, y1: grid_height - 1 },
        char: '.',
        rgb: WHITE,
        style: 'regular',
    }),
    ((): Module => {
        const rect: Rect = { x0: 2, y0: 2, x1: 40, y1: 12 };
        let hover: { x: number; y: number } | null = null;

        return {
            id: 'panel',
            rect,

            Draw(c: Canvas): void {
                c.fill_rect(rect, { char: '#', rgb: CYAN, style: 'regular' });

                if (hover) {
                    c.set(hover.x, hover.y, {
                        char: '+',
                        rgb: { r: 120, g: 255, b: 120 },
                        style: 'regular',
                    });
                }
            },

            OnTileHover(event: TileEvent): void {
                hover = { x: event.x, y: event.y };
            },

            OnTileClick(event: TileEvent): void {
                console.log('click panel', event.x, event.y);
            },
        };
    })(),



    // animated cursor module (topmost)
    {
        id: 'cursor',
        rect: { x0: 0, y0: 0, x1: grid_width - 1, y1: grid_height - 1 },
        Draw(c: Canvas): void {
            const t = performance.now() * 0.002;
            const x = Math.floor((Math.sin(t) * 0.5 + 0.5) * (grid_width - 1));
            const y = Math.floor((Math.cos(t) * 0.5 + 0.5) * (grid_height - 1));
            c.set(x, y, { char: '@', rgb: YELLOW, style: 'regular' });
        },
    },
];

// ---------- font/tile metrics ----------
function get_metrics() {
    const font_size_px = BASE_FONT_SIZE_PX * scale;
    const line_height_px = font_size_px * BASE_LINE_HEIGHT_MULT;
    const letter_spacing_px = font_size_px * BASE_LETTER_SPACING_MULT;

    // measure monospace glyph width
    ctx.font = `${font_size_px}px "${FONT_FAMILY}"`;
    const glyph_w = ctx.measureText('M').width;

    const tile_w = glyph_w + letter_spacing_px;
    const tile_h = line_height_px;

    return { font_size_px, line_height_px, letter_spacing_px, tile_w, tile_h };
}

// ---------- resize canvas to fit grid ----------
function resize_to_grid() {
    const { tile_w, tile_h } = get_metrics();

    el.width = Math.ceil(tile_w * grid_width);
    el.height = Math.ceil(tile_h * grid_height);

    // css size = backing size (simple for now)
    el.style.width = `${el.width}px`;
    el.style.height = `${el.height}px`;
}

// ---------- draw (grouped by style for fewer ctx.font flips) ----------
function draw_canvas(c: Canvas) {
    const { font_size_px, tile_w, tile_h } = get_metrics();

    // background clear
    ctx.clearRect(0, 0, el.width, el.height);

    // preconfigure text
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // naive draw: per cell (we’ll optimize later with dirty cells + style buckets)
    for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
            const cell = c.get(x, y);
            if (!cell) continue;

            // map bottom-left y to canvas y (canvas origin is top-left)
            const canvas_y = (c.height - 1 - y) * tile_h;

            // style -> font
            // (for now: just "regular" maps to 400 weight, non-italic)
            // later: map style string to weight/italic.
            ctx.font = `${font_size_px}px "${FONT_FAMILY}"`;

            // rgb
            ctx.fillStyle = `rgb(${cell.rgb.r},${cell.rgb.g},${cell.rgb.b})`;

            // center glyph in tile
            const cx = x * tile_w + tile_w / 2;
            const cy = canvas_y + tile_h / 2;

            ctx.fillText(cell.char, cx, cy);
        }
    }
}

// ---------- input mapping ----------
let hovered: { x: number; y: number } | null = null;
let hovered_owner_module_id: string | null = null;

function mouse_to_tile(ev: MouseEvent): { x: number; y: number } | null {
    const { tile_w, tile_h } = get_metrics();
    const rect = el.getBoundingClientRect();

    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;

    const x = Math.floor(mx / tile_w);
    const y_canvas = Math.floor(my / tile_h);
    const y = grid_height - 1 - y_canvas;

    if (x < 0 || x >= grid_width || y < 0 || y >= grid_height) return null;
    return { x, y };
}

el.addEventListener('mousemove', (ev) => {


    const t = mouse_to_tile(ev);
    hovered = t;

    if (!t) {
        hovered_owner_module_id = null;
        return;
    }

    const top = route_to_top_module(modules, t.x, t.y);
    const top_id = top?.id ?? null;
    if (top_id !== hovered_owner_module_id) {
        // clear previous module hover
        const prev = modules.find(m => m.id === hovered_owner_module_id);
        if (prev && prev.OnTileHover) {
            prev.OnTileHover({ x: -1, y: -1, cell: undefined });
        }
    }

    last_hover = t ? { x: t.x, y: t.y } : null;

    // Only notify when the owning top-module changes
    if (top_id !== hovered_owner_module_id) {
        hovered_owner_module_id = top_id;

        if (top && top.OnTileHover) {
            const event: TileEvent = { x: t.x, y: t.y, cell: engine_canvas.get(t.x, t.y) };
            top.OnTileHover(event);
        }
    }
});


el.addEventListener('mouseleave', () => {
    hovered = null;
    hovered_owner_module_id = null;
});


el.addEventListener('click', (ev) => {
    const t = mouse_to_tile(ev);
    if (!t) return;

    const top = route_to_top_module(modules, t.x, t.y);
    if (!top) return;

    const event: TileEvent = { x: t.x, y: t.y, cell: engine_canvas.get(t.x, t.y) };
    last_click = { x: t.x, y: t.y };

    if (top.OnTileClick) {
        top.OnTileClick(event);
    } else {
        // TEMP fallback log if no click hook
        console.log('tile_click (no handler)', { module_id: top.id, ...event });
    }
});


// ---------- main loop ----------
function tick() {
    // compose modules -> engine canvas (later modules overwrite earlier)
    compose_modules(engine_canvas, modules);

    if (last_click) {
        engine_canvas.set(last_click.x, last_click.y, {
            char: '!',
            rgb: { r: 255, g: 120, b: 120 },
            style: 'regular',
        });
    }

    draw_canvas(engine_canvas);
    requestAnimationFrame(tick);
}

// boot
resize_to_grid();
tick();

// TEMP: change scale with keys (0.5, 1, 1.5, 2)
window.addEventListener('keydown', (ev) => {
    if (ev.key === '1') scale = 0.5;
    if (ev.key === '2') scale = 1.0;
    if (ev.key === '3') scale = 1.5;
    if (ev.key === '4') scale = 2.0;
    resize_to_grid();
});


