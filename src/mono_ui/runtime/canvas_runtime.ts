import { create_canvas } from '../canvas.js';
import { compose_modules } from '../compose.js';
import type { Canvas, Cell, Module, PointerEvent, DragEvent, WheelEvent } from '../types.js';
import { rect_contains } from '../types.js';
import { debug_warn } from '../../shared/debug.js';

export type CanvasRuntimeOptions = {
    canvas: HTMLCanvasElement;
    key_sink?: HTMLTextAreaElement;

    grid_width: number;
    grid_height: number;

    font_family: string;
    base_font_size_px: number;
    base_line_height_mult: number;
    base_letter_spacing_mult: number;
    weight_index_to_css?: readonly number[];

    modules: Module[];
};

const DEFAULT_WEIGHT_INDEX_TO_CSS: readonly number[] = [100, 200, 300, 400, 500, 600, 700, 800] as const;

function clamp_weight_index(w: unknown): number {
    const v = typeof w === 'number' ? Math.trunc(w) : 3;
    if (!Number.isFinite(v)) return 3;
    return Math.max(0, Math.min(7, v));
}

export class CanvasRuntime {
    private canvas_el: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private key_sink: HTMLTextAreaElement;
    private engine_canvas: Canvas;
    private modules: Module[];

    private grid_width: number;
    private grid_height: number;

    private font_family: string;
    private base_font_size_px: number;
    private base_line_height_mult: number;
    private base_letter_spacing_mult: number;
    private weight_index_to_css: readonly number[];

    private scale = 1.0;
    private raf_id: number | null = null;

    private last_tile: { x: number; y: number } | null = null;
    private focused_owner: Module | null = null;
    private pending_single_click: {
        run_at_ms: number;
        target: Module;
        button: number;
        x: number;
        y: number;
        ev: MouseEvent;
    } | null = null;

    private wheel_accum_dx = 0;
    private wheel_accum_dy = 0;
    private wheel_pending: { x: number; y: number; mods: any; delta_mode: number } | null = null;

    private hover_owner: Module | null = null;
    private capture_owner: Module | null = null;
    private down_owner: Module | null = null;
    private down_tile: { x: number; y: number } | null = null;
    private dragging = false;

    private readonly DBLCLICK_MS = 180;
    private readonly DBLCLICK_TILE_RADIUS = 1;
    private readonly DRAG_THRESHOLD_TILES = 1;

    constructor(opts: CanvasRuntimeOptions) {
        this.canvas_el = opts.canvas;
        const ctx = this.canvas_el.getContext('2d');
        if (!ctx) throw new Error('2d canvas context not available');
        this.ctx = ctx;

        this.grid_width = opts.grid_width;
        this.grid_height = opts.grid_height;
        this.font_family = opts.font_family;
        this.base_font_size_px = opts.base_font_size_px;
        this.base_line_height_mult = opts.base_line_height_mult;
        this.base_letter_spacing_mult = opts.base_letter_spacing_mult;
        this.weight_index_to_css = opts.weight_index_to_css ?? DEFAULT_WEIGHT_INDEX_TO_CSS;
        this.modules = opts.modules;

        this.engine_canvas = create_canvas(this.grid_width, this.grid_height);
        this.key_sink = opts.key_sink ?? this.ensure_key_sink();

        this.attach_events();
    }

    set_scale(scale: number): void {
        this.scale = scale;
        this.resize_to_grid();
    }

    get_scale(): number {
        return this.scale;
    }

    set_modules(modules: Module[]): void {
        this.modules = modules;
    }

    start(): void {
        this.resize_to_grid();
        this.tick();
    }

    stop(): void {
        if (this.raf_id !== null) cancelAnimationFrame(this.raf_id);
        this.raf_id = null;
    }

    private ensure_key_sink(): HTMLTextAreaElement {
        let ks = document.getElementById('key_sink') as HTMLTextAreaElement | null;

        if (!ks) {
            ks = document.createElement('textarea');
            ks.id = 'key_sink';

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
            debug_warn('[mono_ui] key_sink element was missing; created one automatically');
        }

        return ks;
    }

    private focus_key_sink(): void {
        this.key_sink.focus({ preventScroll: true });
    }

    private make_pointer_event(
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

        if (this.last_tile) {
            e.prev_x = this.last_tile.x;
            e.prev_y = this.last_tile.y;
        }

        if (cell !== undefined) e.cell = cell;
        if (click_count !== undefined) e.click_count = click_count;

        return e as PointerEvent;
    }

    private make_drag_event(
        kind: 'drag_start' | 'drag_move' | 'drag_end',
        x: number,
        y: number,
        buttons: number,
        cell?: Cell,
    ): DragEvent {
        if (!this.down_tile) throw new Error('drag event without down_tile');

        const prev = this.last_tile ?? { x: this.down_tile.x, y: this.down_tile.y };

        const e: any = {
            pointer_id: 0,
            kind,
            x,
            y,
            start_x: this.down_tile.x,
            start_y: this.down_tile.y,
            dx: x - this.down_tile.x,
            dy: y - this.down_tile.y,
            step_dx: x - prev.x,
            step_dy: y - prev.y,
            buttons,
        };

        if (cell !== undefined) e.cell = cell;
        return e;
    }

    private drag_distance_tiles(x: number, y: number): number {
        if (!this.down_tile) return 0;
        return Math.max(Math.abs(x - this.down_tile.x), Math.abs(y - this.down_tile.y));
    }

    private route_to_top_module(x: number, y: number): Module | undefined {
        for (let i = this.modules.length - 1; i >= 0; i--) {
            const m = this.modules[i];
            if (!m) continue;
            if (rect_contains(m.rect, x, y)) return m;
        }
        return undefined;
    }

    private get_metrics() {
        const font_size_px = this.base_font_size_px * this.scale;
        const line_height_px = font_size_px * this.base_line_height_mult;
        const letter_spacing_px = font_size_px * this.base_letter_spacing_mult;

        this.ctx.font = `400 ${font_size_px}px "${this.font_family}"`;
        const glyph_w = this.ctx.measureText('M').width;

        const tile_w = glyph_w + letter_spacing_px;
        const tile_h = line_height_px;

        return { font_size_px, line_height_px, letter_spacing_px, tile_w, tile_h };
    }

    private resize_to_grid(): void {
        const { tile_w, tile_h } = this.get_metrics();

        this.canvas_el.width = Math.ceil(tile_w * this.grid_width);
        this.canvas_el.height = Math.ceil(tile_h * this.grid_height);

        this.canvas_el.style.width = `${this.canvas_el.width}px`;
        this.canvas_el.style.height = `${this.canvas_el.height}px`;
    }

    private draw_canvas(c: Canvas): void {
        const { font_size_px, tile_w, tile_h } = this.get_metrics();

        this.ctx.clearRect(0, 0, this.canvas_el.width, this.canvas_el.height);

        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';

        for (let y = 0; y < c.height; y++) {
            for (let x = 0; x < c.width; x++) {
                const cell = c.get(x, y);
                if (!cell) continue;

                const canvas_y = (c.height - 1 - y) * tile_h;

                const wi = clamp_weight_index((cell as any).weight_index);
                const css_w = this.weight_index_to_css[wi] ?? 400;
                this.ctx.font = `${css_w} ${font_size_px}px "${this.font_family}"`;

                this.ctx.fillStyle = `rgb(${cell.rgb.r},${cell.rgb.g},${cell.rgb.b})`;

                const cx = x * tile_w + tile_w / 2;
                const cy = canvas_y + tile_h / 2;

                this.ctx.fillText(cell.char, cx, cy);
            }
        }
    }

    private mouse_to_tile(ev: MouseEvent): { x: number; y: number } | null {
        const { tile_w, tile_h } = this.get_metrics();
        const rect = this.canvas_el.getBoundingClientRect();

        const mx = ev.clientX - rect.left;
        const my = ev.clientY - rect.top;

        const x = Math.floor(mx / tile_w);
        const y_canvas = Math.floor(my / tile_h);
        const y = this.grid_height - 1 - y_canvas;

        if (x < 0 || x >= this.grid_width || y < 0 || y >= this.grid_height) return null;
        return { x, y };
    }

    private dispatch_global_keydown(ev: KeyboardEvent): boolean {
        if (ev.key === 'Escape') {
            this.focused_owner?.OnBlur?.();
            this.focused_owner = null;
            return true;
        }
        return false;
    }

    private attach_events(): void {
        this.canvas_el.addEventListener('contextmenu', (ev) => {
            ev.preventDefault();
        });

        this.canvas_el.addEventListener('mousemove', (ev) => {
            const t = this.mouse_to_tile(ev);

            if (!t) {
                if (!this.capture_owner && this.hover_owner?.OnPointerLeave && this.last_tile) {
                    this.hover_owner.OnPointerLeave(
                        this.make_pointer_event(
                            'leave',
                            this.last_tile.x,
                            this.last_tile.y,
                            ev,
                            this.engine_canvas.get(this.last_tile.x, this.last_tile.y),
                        ),
                    );
                }
                this.hover_owner = null;
                this.last_tile = null;
                return;
            }

            const top = this.route_to_top_module(t.x, t.y) ?? null;

            const base = this.make_pointer_event(
                'move',
                t.x,
                t.y,
                ev,
                this.engine_canvas.get(t.x, t.y),
            );

            if (this.capture_owner) {
                this.capture_owner.OnPointerMove?.(base);

                if (this.down_tile) {
                    const dist = this.drag_distance_tiles(t.x, t.y);

                    if (!this.dragging && dist >= this.DRAG_THRESHOLD_TILES) {
                        this.dragging = true;
                        this.capture_owner.OnDragStart?.(
                            this.make_drag_event('drag_start', t.x, t.y, ev.buttons, this.engine_canvas.get(t.x, t.y)),
                        );
                    }

                    if (this.dragging) {
                        this.capture_owner.OnDragMove?.(
                            this.make_drag_event('drag_move', t.x, t.y, ev.buttons, this.engine_canvas.get(t.x, t.y)),
                        );
                    }
                }

                this.last_tile = t;
                return;
            }

            if (top !== this.hover_owner) {
                this.hover_owner?.OnPointerLeave?.({ ...base, kind: 'leave' });
                top?.OnPointerEnter?.({ ...base, kind: 'enter' });
                this.hover_owner = top;
            }

            top?.OnPointerMove?.(base);

            this.last_tile = t;
        });

        this.canvas_el.addEventListener('mouseleave', (ev) => {
            if (!this.capture_owner && this.hover_owner && this.last_tile) {
                this.hover_owner.OnPointerLeave?.(
                    this.make_pointer_event(
                        'leave',
                        this.last_tile.x,
                        this.last_tile.y,
                        ev as unknown as MouseEvent,
                        this.engine_canvas.get(this.last_tile.x, this.last_tile.y),
                    ),
                );
            }

            this.hover_owner = null;
            this.last_tile = null;
        });

        this.canvas_el.addEventListener('mousedown', (ev) => {
            ev.preventDefault();
            this.focus_key_sink();

            const t = this.mouse_to_tile(ev);
            if (!t) return;

            const top = this.route_to_top_module(t.x, t.y) ?? null;
            this.down_owner = top;
            this.down_tile = t;
            this.dragging = false;
            this.capture_owner = top;
            if (top?.Focusable && top !== this.focused_owner) {
                this.focused_owner?.OnBlur?.();
                this.focused_owner = top;
                this.focused_owner?.OnFocus?.();
            }
            top?.OnPointerDown?.(
                this.make_pointer_event('down', t.x, t.y, ev, this.engine_canvas.get(t.x, t.y)),
            );
        });

        this.canvas_el.addEventListener('wheel', (ev) => {
            ev.preventDefault();

            const t = this.mouse_to_tile(ev as any);
            if (!t) return;

            this.wheel_accum_dx += ev.deltaX;
            this.wheel_accum_dy += ev.deltaY;
            this.wheel_pending = {
                x: t.x,
                y: t.y,
                delta_mode: ev.deltaMode,
                mods: { shift: ev.shiftKey, ctrl: ev.ctrlKey, alt: ev.altKey, meta: ev.metaKey },
            };
        }, { passive: false });

        this.canvas_el.addEventListener('contextmenu', (ev) => {
            ev.preventDefault();

            const t = this.mouse_to_tile(ev);
            if (!t) return;

            const top = this.route_to_top_module(t.x, t.y) ?? null;
            if (top) {
                top.OnContextMenu?.(
                    this.make_pointer_event('click', t.x, t.y, ev, this.engine_canvas.get(t.x, t.y), 1),
                );
            }
        });

        this.canvas_el.addEventListener('mouseup', (ev) => {
            const t = this.mouse_to_tile(ev);
            if (!t) {
                this.capture_owner = null;
                this.down_owner = null;
                this.down_tile = null;
                this.dragging = false;
                return;
            }

            const top = this.route_to_top_module(t.x, t.y) ?? null;
            const target = this.capture_owner ?? top;

            target?.OnPointerUp?.(
                this.make_pointer_event('up', t.x, t.y, ev, this.engine_canvas.get(t.x, t.y)),
            );

            if (this.dragging && target) {
                target.OnDragEnd?.(
                    this.make_drag_event('drag_end', t.x, t.y, ev.buttons, this.engine_canvas.get(t.x, t.y)),
                );
            }

            if (!this.dragging && this.down_owner && target && this.down_owner === target) {
                if (rect_contains(target.rect, t.x, t.y)) {
                    const now = performance.now();
                    const button = ev.button;

                    const p = this.pending_single_click;

                    const is_double =
                        !!p &&
                        now <= p.run_at_ms &&
                        p.target.id === target.id &&
                        p.button === button &&
                        Math.max(Math.abs(t.x - p.x), Math.abs(t.y - p.y)) <= this.DBLCLICK_TILE_RADIUS;

                    if (is_double) {
                        this.pending_single_click = null;

                        target.OnClick?.(
                            this.make_pointer_event('click', t.x, t.y, ev, this.engine_canvas.get(t.x, t.y), 2),
                        );
                    } else {
                        this.pending_single_click = {
                            run_at_ms: now + this.DBLCLICK_MS,
                            target,
                            button,
                            x: t.x,
                            y: t.y,
                            ev,
                        };
                    }
                }
            }

            this.capture_owner = null;
            this.down_owner = null;
            this.down_tile = null;
            this.dragging = false;
        });

        this.key_sink.addEventListener('keydown', (ev) => {
            for (let i = this.modules.length - 1; i >= 0; i--) {
                const m = this.modules[i];
                if (!m) continue;
                if (m.OnGlobalKeyDown) {
                    m.OnGlobalKeyDown(ev);
                    break;
                }
            }

            if (this.dispatch_global_keydown(ev)) return;
            this.focused_owner?.OnKeyDown?.(ev);
        });

        this.key_sink.addEventListener('keyup', (ev) => {
            this.focused_owner?.OnKeyUp?.(ev);
        });

        this.key_sink.addEventListener('beforeinput', (ev: InputEvent) => {
            if (!this.focused_owner?.OnTextInput) return;

            ev.preventDefault();
            const data = (ev as any).data;

            if (typeof data === 'string' && data.length > 0) {
                this.focused_owner.OnTextInput(data);
            }
        });
    }

    private tick(): void {
        const now = performance.now();
        if (this.pending_single_click && now >= this.pending_single_click.run_at_ms) {
            const p = this.pending_single_click;
            this.pending_single_click = null;

            p.target.OnClick?.(
                this.make_pointer_event('click', p.x, p.y, p.ev, this.engine_canvas.get(p.x, p.y), 1),
            );
        }

        compose_modules(this.engine_canvas, this.modules);

        if (this.wheel_pending) {
            const { x, y, delta_mode, mods } = this.wheel_pending;
            const top = this.route_to_top_module(x, y);
            top?.OnWheel?.({
                x, y,
                delta_x: this.wheel_accum_dx,
                delta_y: this.wheel_accum_dy,
                delta_mode,
                ...mods,
            });

            this.wheel_accum_dx = 0;
            this.wheel_accum_dy = 0;
            this.wheel_pending = null;
        }

        this.draw_canvas(this.engine_canvas);
        this.raf_id = requestAnimationFrame(() => this.tick());
    }
}
