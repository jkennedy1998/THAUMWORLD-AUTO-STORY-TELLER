import { create_canvas } from '../mono_ui/canvas.js';
import { compose_modules } from '../mono_ui/compose.js';
import { make_fill_module } from '../mono_ui/modules/fill_module.js';
import type { Canvas, Cell, Module, Rect, Rgb, TileEvent, PointerEvent } from '../mono_ui/types.js';


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
// ---------- helpers: ----------

let hover_owner_id: string | null = null;
let hover_tile: { x: number; y: number } | null = null;

let capture_owner_id: string | null = null;
let down_owner_id: string | null = null;
let down_tile: { x: number; y: number } | null = null;

let last_tile: { x: number; y: number } | null = null;

function make_pointer_event(
    kind: PointerEvent['kind'],
    x: number,
    y: number,
    buttons: number,
    cell?: Cell,
): PointerEvent {
    const e: any = {
        pointer_id: 0,
        kind,
        x,
        y,
        buttons,
    };

    if (last_tile) {
        e.prev_x = last_tile.x;
        e.prev_y = last_tile.y;
    }

    if (cell !== undefined) {
        e.cell = cell;
    }

    return e as PointerEvent;
}


function find_module_by_id(modules: Module[], id: string | null): Module | null {
    if (!id) return null;
    return modules.find((m) => m.id === id) ?? null;
}

function rect_contains(rect: Rect, x: number, y: number): boolean {
    return x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1;
}

function route_to_top_module(modules: Module[], x: number, y: number): Module | undefined {
    for (let i = modules.length - 1; i >= 0; i--) {
        const m = modules[i];
        if (!m) continue; // <- fixes TS 'possibly undefined'
        if (rect_contains(m.rect, x, y)) return m;
    }
    return undefined;
}


// ---------- canvas element ----------
//the ctx2 exists so that ctx2 is defined by default and links to our canvas element
const el = document.getElementById('mono_canvas') as HTMLCanvasElement;
const ctx = el.getContext('2d');
if (!ctx) throw new Error('2d canvas context not available');

const ctx2: CanvasRenderingContext2D = ctx;



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

            OnPointerEnter(e: PointerEvent): void {
                console.log('panel enter', e.x, e.y);
                hover = { x: e.x, y: e.y };
            },

            OnPointerMove(e: PointerEvent): void {
                hover = { x: e.x, y: e.y };
            },

            OnPointerLeave(e: PointerEvent): void {
                console.log('panel leave', e.x, e.y);
                hover = null;
            },

            OnPointerDown(e: PointerEvent): void {
                console.log('panel down', e.x, e.y);
            },

            OnPointerUp(e: PointerEvent): void {
                console.log('panel up', e.x, e.y);
            },

            OnClick(e: PointerEvent): void {
                console.log('panel click', e.x, e.y);
            },


        };
    })(),



    // animated cursor module (topmost)
    {
        id: 'cursor',
        rect: { x0: 0, y0: 0, x1: -1, y1: -1 },
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
    ctx2.font = `${font_size_px}px "${FONT_FAMILY}"`;
    const glyph_w = ctx2.measureText('M').width;

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
    ctx2.clearRect(0, 0, el.width, el.height);

    // preconfigure text
    ctx2.textAlign = 'center';
    ctx2.textBaseline = 'middle';

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
            ctx2.font = `${font_size_px}px "${FONT_FAMILY}"`;

            // rgb
            ctx2.fillStyle = `rgb(${cell.rgb.r},${cell.rgb.g},${cell.rgb.b})`;

            // center glyph in tile
            const cx = x * tile_w + tile_w / 2;
            const cy = canvas_y + tile_h / 2;

            ctx2.fillText(cell.char, cx, cy);
        }
    }
}

// ---------- input mapping ----------
let hovered: { x: number; y: number } | null = null;
let hovered_owner_module_id: string | null = null;
let hover_owner: Module | null = null;
let capture_owner: Module | null = null;
let down_owner: Module | null = null;


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

  // leaving grid area (but still on canvas element)
  if (!t) {
    if (!capture_owner && hover_owner?.OnPointerLeave && last_tile) {
        hover_owner.OnPointerLeave(
            make_pointer_event(
                'leave',
                last_tile.x,
                last_tile.y,
                ev.buttons,
                engine_canvas.get(last_tile.x, last_tile.y),
            )
        );
    }
    hover_owner = null;
    last_tile = null;
    return;
  }

  const top = route_to_top_module(modules, t.x, t.y) ?? null;

  // build event base
    const base = make_pointer_event(
        'move',
        t.x,
        t.y,
        ev.buttons,
        engine_canvas.get(t.x, t.y),
    );


  // if captured, route only to capture owner
  if (capture_owner) {
    capture_owner.OnPointerMove?.(base);
    last_tile = t;
    return;
  }

  // hover owner change => leave + enter
  if (top !== hover_owner) {
    hover_owner?.OnPointerLeave?.({ ...base, kind: 'leave' });
    top?.OnPointerEnter?.({ ...base, kind: 'enter' });
    hover_owner = top;
  }

  // always move on current hover owner
  top?.OnPointerMove?.(base);

  last_tile = t;
});



el.addEventListener('mouseleave', (ev) => {
    if (!capture_owner && hover_owner && last_tile) {
        hover_owner.OnPointerLeave?.(
            make_pointer_event(
                'leave',
                last_tile.x,
                last_tile.y,
                0,
                engine_canvas.get(last_tile.x, last_tile.y),
            )
        );
    }

    hover_owner = null;
    last_tile = null;
});



el.addEventListener('mousedown', (ev) => {
    const t = mouse_to_tile(ev);
    if (!t) return;

    const top = route_to_top_module(modules, t.x, t.y) ?? null;
    down_owner = top;
    capture_owner = top;

    top?.OnPointerDown?.(
        make_pointer_event('down', t.x, t.y, ev.buttons, engine_canvas.get(t.x, t.y))
    );

});

el.addEventListener('mouseup', (ev) => {
    const t = mouse_to_tile(ev);
    if (!t) {
        // release capture even if mouseup outside grid
        capture_owner = null;
        down_owner = null;
        return;
    }

    const top = route_to_top_module(modules, t.x, t.y) ?? null;
    const target = capture_owner ?? top;

    top?.OnPointerDown?.(
        make_pointer_event('down', t.x, t.y, ev.buttons, engine_canvas.get(t.x, t.y))
    );


    // click synthesis: down+up on same module AND mouseup inside rect
    if (down_owner && target && down_owner === target) {
        if (rect_contains(target.rect, t.x, t.y)) {
            target.OnClick?.(
                make_pointer_event('click', t.x, t.y, ev.buttons, engine_canvas.get(t.x, t.y))
            );

        }
    }

    capture_owner = null;
    down_owner = null;
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


