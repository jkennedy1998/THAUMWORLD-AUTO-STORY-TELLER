import { create_canvas } from '../mono_ui/canvas.js';
import { compose_modules } from '../mono_ui/compose.js';
import { make_fill_module } from '../mono_ui/modules/fill_module.js';
import type { Canvas, Cell, Module, Rect, Rgb, PointerEvent, DragEvent, WheelEvent } from '../mono_ui/types.js';
import { make_button_module } from '../mono_ui/modules/button_module.js';
import { make_text_window_module } from '../mono_ui/modules/window_module.js';
import { make_input_module } from '../mono_ui/modules/input_module.js';



// ---------- renderer config (matches your Figma % intent) ----------
const FONT_FAMILY = 'Martian Mono';
const BASE_FONT_SIZE_PX = 10; // scale=1 => ~10px
const INTERPRETER_ENDPOINT = 'http://localhost:8787/api/input';
const INTERPRETER_LOG_ENDPOINT = 'http://localhost:8787/api/log';
const SELECTED_DATA_SLOT = 1;

// 0..7 -> css font-weight (Martian Mono supports 100..800)
const WEIGHT_INDEX_TO_CSS: readonly number[] = [100, 200, 300, 400, 500, 600, 700, 800] as const;
function clamp_weight_index(w: unknown): number {
    const v = typeof w === 'number' ? Math.trunc(w) : 3;
    if (!Number.isFinite(v)) return 3;
    return Math.max(0, Math.min(7, v));
}

const BASE_LINE_HEIGHT_MULT = 1.5; // 150%
const BASE_LETTER_SPACING_MULT = 0.08; // 8%
let scale = 1.0; // 0..2 => 0%..200%
// weight index 0..7 -> CSS font-weight

// ---------- canvas size (tile grid) ----------
const grid_width = 80;
const grid_height = 30;
let last_tile: { x: number; y: number } | null = null;
let focused_owner: Module | null = null;
let pending_single_click: {
    run_at_ms: number;
    target: Module;
    button: number;
    x: number;
    y: number;
    ev: MouseEvent;
} | null = null;


const DBLCLICK_MS = 180;
const DBLCLICK_TILE_RADIUS = 1;
let last_click_sig: {
    t_ms: number;
    module_id: string;
    button: number;
    x: number;
    y: number;
} | null = null;
let wheel_accum_dx = 0;
let wheel_accum_dy = 0;
let wheel_pending: { x: number; y: number; mods: any; delta_mode: number } | null = null;

function make_pointer_event(
    kind: PointerEvent['kind'],
    x: number,
    y: number,
    ev: MouseEvent,
    cell?: Cell,
    click_count?: 1 | 2,
): PointerEvent {
    const e: any = {
        pointer_id: 0,
        kind,
        x,
        y,

        buttons: ev.buttons,
        button: ev.button,

        shift: ev.shiftKey,
        ctrl: ev.ctrlKey,
        alt: ev.altKey,
        meta: ev.metaKey,
    };

    if (last_tile) {
        e.prev_x = last_tile.x;
        e.prev_y = last_tile.y;
    }

    if (cell !== undefined) e.cell = cell;
    if (click_count !== undefined) e.click_count = click_count;

    return e as PointerEvent;
}

function make_drag_event(
    kind: 'drag_start' | 'drag_move' | 'drag_end',
    x: number,
    y: number,
    buttons: number,
    cell?: Cell,
) {
    if (!down_tile) throw new Error('drag event without down_tile');

    const prev = last_tile ?? { x: down_tile.x, y: down_tile.y };

    const e: any = {
        pointer_id: 0,
        kind,
        x,
        y,
        start_x: down_tile.x,
        start_y: down_tile.y,
        dx: x - down_tile.x,
        dy: y - down_tile.y,
        step_dx: x - prev.x,
        step_dy: y - prev.y,
        buttons,
    };

    if (cell !== undefined) e.cell = cell;
    return e;
}

function drag_distance_tiles(x: number, y: number): number {
    if (!down_tile) return 0;
    return Math.max(Math.abs(x - down_tile.x), Math.abs(y - down_tile.y));
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

function ensure_key_sink(): HTMLTextAreaElement {
    let ks = document.getElementById('key_sink') as HTMLTextAreaElement | null;


    if (!ks) {
        ks = document.createElement('textarea');
        ks.id = 'key_sink';

        // Make it focusable but invisible and out of the way
        ks.setAttribute('autocomplete', 'off');
        ks.setAttribute('autocorrect', 'off');
        ks.setAttribute('autocapitalize', 'off');
        ks.setAttribute('spellcheck', 'false');

        ks.style.position = 'fixed';
        ks.style.left = '-9999px';
        ks.style.top = '0px';
        ks.style.width = '1px';
        ks.style.height = '1px';
        ks.style.opacity = '0';

        document.body.appendChild(ks);
        console.warn('[mono_ui] key_sink element was missing; created one automatically');
    }

    return ks;
}

const key_sink = ensure_key_sink();

console.log("key_sink:", key_sink, "active:", document.activeElement);
focus_key_sink();

el.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
});
function focus_key_sink() {
    // keep keyboard lane alive
    key_sink.focus({ preventScroll: true });
}


// ---------- engine canvas ----------
const engine_canvas: Canvas = create_canvas(grid_width, grid_height);

// ---------- demo modules (z-order = array order) ----------
const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const CYAN: Rgb = { r: 120, g: 220, b: 255 };
const YELLOW: Rgb = { r: 255, g: 220, b: 120 };
const ui_state = {
    text_windows: new Map<string, { messages: string[]; rev: number }>(),
};

function set_text_window_messages(id: string, messages: string[]) {
    const cur = ui_state.text_windows.get(id);
    if (!cur) {
        ui_state.text_windows.set(id, { messages: [...messages], rev: 1 });
    } else {
        cur.messages = [...messages];
        cur.rev++;
    }
}
function append_text_window_message(id: string, message: string) {
    const cur = ui_state.text_windows.get(id);
    if (!cur) {
        ui_state.text_windows.set(id, { messages: [message], rev: 1 });
    } else {
        cur.messages.push(message);
        cur.rev++;
    }
}

type WindowFeed = {
    window_id: string;
    fetch_messages: () => Promise<string[]>;
};

const window_feeds: WindowFeed[] = [];

function register_window_feed(feed: WindowFeed): void {
    window_feeds.push(feed);
}

async function poll_window_feeds(): Promise<void> {
    const tasks = window_feeds.map(async (feed) => {
        try {
            const messages = await feed.fetch_messages();
            set_text_window_messages(feed.window_id, messages);
        } catch (err) {
            console.warn('[mono_ui] failed to refresh window feed', feed.window_id, err);
        }
    });

    await Promise.all(tasks);
}

function start_window_feed_polling(interval_ms: number): void {
    void poll_window_feeds();
    setInterval(() => {
        void poll_window_feeds();
    }, interval_ms);
}

async function send_to_interpreter(message: string): Promise<void> {
    try {
        const res = await fetch(INTERPRETER_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: message, sender: 'J' }),
        });

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
    } catch (err) {
        console.warn('[mono_ui] failed to send to interpreter', err);
        append_text_window_message('log', '[system] failed to reach interpreter');
    }
}

async function fetch_log_messages(slot: number): Promise<string[]> {
    const res = await fetch(`${INTERPRETER_LOG_ENDPOINT}?slot=${slot}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = (await res.json()) as { ok: boolean; messages?: { sender: string; content: string }[] };
    if (!data.ok || !Array.isArray(data.messages)) return [];

    const ordered = [...data.messages].reverse();
    return ordered.map((m) => `${m.sender}: ${m.content}`);
}


// expose for external programs (dev hook)
(window as any).THAUM_UI = {
    set_text_window_messages,
    append_text_window_message,
};


set_text_window_messages("log", [
    "This is a text window. It wraps words onto new lines.",
    "If a word is tooooooooolongtobefitononeline it will hyphenate-and-continue.",
    "Scroll with the mouse wheel if there is more text.",
    "Scroll with the mouse wheel if there is more text.",
    "Scroll with the mouse wheel if there is more text.",
    "Scroll with the mouse wheel if there is more text.",
    "Scroll with the mouse wheel if there is more text.",
    "Scroll with the mouse wheel if there is more text.",
    "Scroll with the mouse wheel if there is more text.",
    "Scroll with the mouse wheel if there is more text.",
    "hey! :3",
]);
//LIST OF MODULES WITHIN THE BOOTED WINDOW
const modules: Module[] = [

    make_fill_module({
        id: 'bg',
        rect: { x0: 0, y0: 0, x1: grid_width - 1, y1: grid_height - 1 },
        char: '.',
        rgb: WHITE,
        style: 'regular',
    }),

    make_text_window_module({
        id: "log",
        rect: { x0: 2, y0: 14, x1: 60, y1: 28 },
        get_source: () => ui_state.text_windows.get("log") ?? { messages: [], rev: 0 },
        border_rgb: { r: 160, g: 160, b: 160 },
        text_rgb: { r: 255, g: 255, b: 255 },
        bg: { char: " ", rgb: { r: 20, g: 20, b: 20 } },
        base_weight_index: 3,
    }),

    //make_button_module({
    //    id: 'btn_test',
    //    rect: { x0: 45, y0: 2, x1: 75, y1: 6 },
    //    label: '[ TEST BUTTON ]',
    //    rgb: { r: 255, g: 220, b: 120 },
    //    bg: { char: '-', rgb: { r: 80, g: 80, b: 80 } },
    //    OnPress(e) {
    //        console.log('btn press', { button: e.button, count: e.click_count ?? 1 });
    //    },
    //}),
    make_input_module({
        id: "input",
        rect: { x0: 2, y0: 2, x1: 60, y1: 12 }, // sits above the log window
        target_id: "log",
        on_submit: (target_id, message) => {
            append_text_window_message(target_id, message);
            void send_to_interpreter(message);
        },
        border_rgb: { r: 160, g: 160, b: 160 },
        text_rgb: { r: 255, g: 255, b: 255 },
        cursor_rgb: { r: 255, g: 255, b: 255 },
        bg: { char: " ", rgb: { r: 20, g: 20, b: 20 } },
        base_weight_index: 3,
        placeholder: "Type… (Enter=send, Shift+Enter=new line, Backspace=delete)",
    }),


    //seting a fill module with the event listeners
    //((): Module => {
    //    const rect: Rect = { x0: 2, y0: 2, x1: 40, y1: 12 };
    //    let hover: { x: number; y: number } | null = null;

    //    return {
    //        id: 'panel',
    //        rect,

    //        Draw(c: Canvas): void {
    //            c.fill_rect(rect, { char: '#', rgb: CYAN, style: 'regular' });

    //            if (hover) {
    //                c.set(hover.x, hover.y, {
    //                    char: '+',
    //                    rgb: { r: 120, g: 255, b: 120 },
    //                    style: 'regular',
    //                });
    //            }
    //        },

    //        OnPointerEnter(e: PointerEvent): void {
    //            console.log('panel enter', e.x, e.y);
    //            hover = { x: e.x, y: e.y };
    //        },

    //        OnPointerMove(e: PointerEvent): void {hover = { x: e.x, y: e.y };},

    //        OnPointerLeave(e: PointerEvent): void {
    //            console.log('panel leave', e.x, e.y);
    //            hover = null;},

    //        OnPointerDown(e: PointerEvent): void {console.log('panel down', e.x, e.y);},

    //        OnPointerUp(e: PointerEvent): void {console.log('panel up', e.x, e.y);},

    //        OnDragStart(e) { console.log('panel drag start', e.start_x, e.start_y, '->', e.x, e.y); },
    //        OnDragMove(e) { /* optional log spam */ },
    //        OnDragEnd(e) { console.log('panel drag end', e.start_x, e.start_y, '->', e.x, e.y); },
    //        Focusable: true,
    //        OnFocus() { console.log('panel focus'); },
    //        OnBlur() { console.log('panel blur'); },
    //        OnClick(e) { console.log('panel click', { button: e.button, count: e.click_count ?? 1 }); },
    //        OnWheel(e) { console.log('panel wheel', e.delta_y); },
    //        OnKeyDown(e) { console.log('panel key', e.key); },
    //        OnTextInput(s) { console.log('panel text', JSON.stringify(s)); },

    //    };
    //})(),

    //// animated cursor module (topmost)
    //{
    //    id: 'cursor',
    //    rect: { x0: 0, y0: 0, x1: -1, y1: -1 },
    //    Draw(c: Canvas): void {
    //        const t = performance.now() * 0.002;
    //        const x = Math.floor((Math.sin(t) * 0.5 + 0.5) * (grid_width - 1));
    //        const y = Math.floor((Math.cos(t) * 0.5 + 0.5) * (grid_height - 1));
    //        c.set(x, y, { char: '@', rgb: YELLOW, style: 'regular' });
    //    },
    //},
];

register_window_feed({
    window_id: 'log',
    fetch_messages: () => fetch_log_messages(SELECTED_DATA_SLOT),
});

// ---------- font/tile metrics ----------
function get_metrics() {
    const font_size_px = BASE_FONT_SIZE_PX * scale;
    const line_height_px = font_size_px * BASE_LINE_HEIGHT_MULT;
    const letter_spacing_px = font_size_px * BASE_LETTER_SPACING_MULT;

    // measure monospace glyph width
    ctx2.font = `400 ${font_size_px}px "${FONT_FAMILY}"`;

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

            // weight (temporary: read weight_index even before the shared Cell type is updated)
            const weight_index_raw = (cell as any).weight_index;
            const weight_index = clamp_weight_index(
                typeof weight_index_raw === 'number' ? weight_index_raw : 3 // default = "regular-ish"
            );
            const css_weight = WEIGHT_INDEX_TO_CSS[weight_index];

            // include weight directly in the font string
            const wi = clamp_weight_index((cell as any).weight_index);
            const css_w = WEIGHT_INDEX_TO_CSS[wi];
            ctx2.font = `${css_w} ${font_size_px}px "${FONT_FAMILY}"`;



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
let last_click: { x: number; y: number } | null = null;
let down_tile: { x: number; y: number } | null = null;
let dragging = false;

const DRAG_THRESHOLD_TILES = 1;


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
                ev,
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
        ev,
        engine_canvas.get(t.x, t.y),
    );


  // if captured, ...
    if (capture_owner) {
        capture_owner.OnPointerMove?.(base);

        if (down_tile) {
            const dist = drag_distance_tiles(t.x, t.y);

            if (!dragging && dist >= DRAG_THRESHOLD_TILES) {
                dragging = true;
                capture_owner.OnDragStart?.(
                    make_drag_event('drag_start', t.x, t.y, ev.buttons, engine_canvas.get(t.x, t.y))
                );
            }

            if (dragging) {
                capture_owner.OnDragMove?.(
                    make_drag_event('drag_move', t.x, t.y, ev.buttons, engine_canvas.get(t.x, t.y))
                );
            }
        }

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
            make_pointer_event('leave', last_tile.x, last_tile.y, ev as unknown as MouseEvent, engine_canvas.get(last_tile.x, last_tile.y))
        );

    }

    hover_owner = null;
    last_tile = null;
});



el.addEventListener('mousedown', (ev) => {
    ev.preventDefault();
    focus_key_sink();
    key_sink.focus();
    console.log("after click, activeElement =", document.activeElement?.id);

    const t = mouse_to_tile(ev);
    if (!t) return;

    const top = route_to_top_module(modules, t.x, t.y) ?? null;
    down_owner = top;
    down_tile = t;
    dragging = false;
    capture_owner = top;
    if (top?.Focusable && top !== focused_owner) {
        focused_owner?.OnBlur?.();
        focused_owner = top;
        focused_owner?.OnFocus?.();
    }
    top?.OnPointerDown?.(
        make_pointer_event('down', t.x, t.y, ev, engine_canvas.get(t.x, t.y))
    );


});

//mousewheel listener ---------------------------
el.addEventListener('wheel', (ev) => {
    ev.preventDefault();

    const t = mouse_to_tile(ev as any);
    if (!t) return;

    wheel_accum_dx += ev.deltaX;
    wheel_accum_dy += ev.deltaY;
    wheel_pending = {
        x: t.x,
        y: t.y,
        delta_mode: ev.deltaMode,
        mods: { shift: ev.shiftKey, ctrl: ev.ctrlKey, alt: ev.altKey, meta: ev.metaKey },
    };
}, { passive: false });

el.addEventListener('mouseup', (ev) => {
    const t = mouse_to_tile(ev);
    if (!t) {
        // release capture even if mouseup outside grid
        capture_owner = null;
        down_owner = null;
        down_tile = null;
        dragging = false;
        return;

    }

    const top = route_to_top_module(modules, t.x, t.y) ?? null;
    const target = capture_owner ?? top;

    target?.OnPointerUp?.(
        make_pointer_event('up', t.x, t.y, ev, engine_canvas.get(t.x, t.y))
    );

    if (dragging && target) {
        target.OnDragEnd?.(
            make_drag_event('drag_end', t.x, t.y, ev.buttons, engine_canvas.get(t.x, t.y))
        );
    }



    // click synthesis: down+up on same module AND mouseup inside rect
    if (!dragging && down_owner && target && down_owner === target) {
        if (rect_contains(target.rect, t.x, t.y)) {
            const now = performance.now();
            const button = ev.button;

            // if we already have a pending single-click, a 2nd click within the window becomes dblclick
            const p = pending_single_click;

            const is_double =
                !!p &&
                now <= p.run_at_ms &&
                p.target.id === target.id &&
                p.button === button &&
                Math.max(Math.abs(t.x - p.x), Math.abs(t.y - p.y)) <= DBLCLICK_TILE_RADIUS;

            if (is_double) {
                // cancel the queued single
                pending_single_click = null;

                // emit ONLY double
                target.OnClick?.(
                    make_pointer_event('click', t.x, t.y, ev, engine_canvas.get(t.x, t.y), 2)
                );
            } else {
                // queue single click (fires after window if not upgraded to double)
                pending_single_click = {
                    run_at_ms: now + DBLCLICK_MS,
                    target,
                    button,
                    x: t.x,
                    y: t.y,
                    ev,
                };
            }

        }
    }

    capture_owner = null;
    down_owner = null;
    down_tile = null;
    dragging = false;

});

function dispatch_global_keydown(ev: KeyboardEvent): boolean {
    // Example global: Esc clears focus
    if (ev.key === 'Escape') {
        focused_owner?.OnBlur?.();
        focused_owner = null;
        return true;
    }
    console.log("keydown fired:", ev.key);

    return false;
}

key_sink?.addEventListener('keydown', (ev) => {
    // Optional: allow a root module style global hook
    for (let i = modules.length - 1; i >= 0; i--) {
        const m = modules[i];
        if (!m) continue;
        if (m.OnGlobalKeyDown) {
            m.OnGlobalKeyDown(ev);
            // if you want “handled”, add a boolean return later
            break;
        }
    }

    if (dispatch_global_keydown(ev)) return;
    focused_owner?.OnKeyDown?.(ev);
});

key_sink?.addEventListener('keyup', (ev) => {
    focused_owner?.OnKeyUp?.(ev);
});

key_sink?.addEventListener('beforeinput', (ev: InputEvent) => {
    if (!focused_owner?.OnTextInput) return;
    console.log("beforeinput fired:", ev.inputType, (ev as any).data);

    // prevent the textarea from filling up; we are the text engine
    ev.preventDefault();

    // @ts-ignore
    const data = ev.data;

    if (typeof data === 'string' && data.length > 0) {
        focused_owner.OnTextInput(data);
    }
});



// ---------- TICK / MAIN LOOP OF PROGRAM HERE ----------
function tick() {
    // compose modules -> engine canvas (later modules overwrite earlier)
    const now = performance.now();
    if (pending_single_click && now >= pending_single_click.run_at_ms) {
        const p = pending_single_click;
        pending_single_click = null;

        p.target.OnClick?.(
            make_pointer_event('click', p.x, p.y, p.ev, engine_canvas.get(p.x, p.y), 1)
        );
    }


    compose_modules(engine_canvas, modules);
    if (last_click) {
        engine_canvas.set(last_click.x, last_click.y, {
            char: '!',
            rgb: { r: 255, g: 120, b: 120 },
            style: 'regular',
        });
    }

    if (wheel_pending) {
        const { x, y, delta_mode, mods } = wheel_pending;
        const top = route_to_top_module(modules, x, y);
        top?.OnWheel?.({
            x, y,
            delta_x: wheel_accum_dx,
            delta_y: wheel_accum_dy,
            delta_mode,
            ...mods,
        });

        wheel_accum_dx = 0;
        wheel_accum_dy = 0;
        wheel_pending = null;
    }

    draw_canvas(engine_canvas);
    requestAnimationFrame(tick);
}

// boot
resize_to_grid();
start_window_feed_polling(1000);
tick();

// TEMP: change scale with keys (0.5, 1, 1.5, 2)
window.addEventListener('keydown', (ev) => {
    if (ev.key === '1') scale = 0.5;
    if (ev.key === '2') scale = 1.0;
    if (ev.key === '3') scale = 1.5;
    if (ev.key === '4') scale = 2.0;
    resize_to_grid();
});


