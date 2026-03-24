import { create_canvas } from '../canvas.js';
import { compose_modules } from '../compose.js';
import type { Canvas, Cell, Module, PointerEvent, DragEvent, WheelEvent } from '../types.js';
import { rect_contains } from '../types.js';
import { debug_warn, debug_log, DEBUG_LEVEL } from '../../shared/debug.js';
// NOTE: debug overlays are toggled from UI buttons (not hotkeys).
import { unlock_sfx } from '../sfx/sfx_player.js';
import { handle_keydown, handle_keyup, reset_all } from './input_actions.js';

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

    modules: readonly Module[];
    
    // Called when a drag ends outside any module (for rejection feedback)
    on_drag_end_outside?: (x: number, y: number) => void;

    // Called on every pointer move (global hook; does not affect routing)
    on_pointer_move_global?: (x: number, y: number, e: PointerEvent) => void;

    // Called after modules compose each frame (for overlays)
    on_after_compose?: (canvas: Canvas) => void;
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
    private modules: readonly Module[];

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

    // Pointer (pen/touch) state tracking
    private active_pointer_id: number | null = null;
    private active_pointer_buttons: number = 0;
    private active_pointer_button: number = 0;
    private suppress_mouse_until_ms: number = 0;

    private hover_owner: Module | null = null;
    private capture_owner: Module | null = null;
    private down_owner: Module | null = null;
    private down_tile: { x: number; y: number } | null = null;
    private dragging = false;
    
    private on_drag_end_outside: ((x: number, y: number) => void) | null = null;
    private on_pointer_move_global: ((x: number, y: number, e: PointerEvent) => void) | null = null;
    private on_after_compose: ((canvas: Canvas) => void) | null = null;

    private readonly DBLCLICK_MS = 180;
    private readonly DBLCLICK_TILE_RADIUS = 1;
    private readonly DRAG_THRESHOLD_TILES = 1;

    // Global UI pan (moves the entire canvas within the viewport).
    // This replaces browser scrollbars for traversing the UI when the canvas is larger than the window.
    // Global UI pan (moves the entire canvas within the viewport).
    // Tile-locked: pans only in whole character-cell increments.
    private pan_tiles_x = 0;
    private pan_tiles_y = 0;
    private pan_accum_px_x = 0;
    private pan_accum_px_y = 0;
    private pan_dirty = false;
    private global_pan_active = false;
    private last_pan_client_x = 0;
    private last_pan_client_y = 0;
    private space_down = false;

    // Allow panning beyond strict canvas bounds (gives breathing room / "free space").
    private readonly PAN_MARGIN_TILES = 10;

    // Base translate (centered/snap-to-grid) computed from viewport + canvas size.
    private base_pan_px_x = 0;
    private base_pan_px_y = 0;

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
        this.on_drag_end_outside = opts.on_drag_end_outside ?? null;
        this.on_pointer_move_global = opts.on_pointer_move_global ?? null;
        this.on_after_compose = opts.on_after_compose ?? null;

        this.engine_canvas = create_canvas(this.grid_width, this.grid_height);
        this.key_sink = opts.key_sink ?? this.ensure_key_sink();

        this.attach_events();
    }

    set_scale(scale: number): void {
        this.scale = scale;
        this.resize_to_grid();

        // Best-effort notification so the app shell can retune post-processing.
        try {
            window.dispatchEvent(new CustomEvent('thaumworld_ui_scale', { detail: { scale: this.scale } }));
        } catch {
            // ignore
        }
    }

    get_scale(): number {
        return this.scale;
    }

    private clamp_scale(scale: number): number {
        if (!Number.isFinite(scale)) return 1.0;
        // Conservative clamp; this is UI-only and can be tuned later.
        return Math.max(0.25, Math.min(6.0, scale));
    }

    private persist_scale_best_effort(scale: number): void {
        try {
            window.localStorage.setItem('thaumworld_ui_scale', String(scale));
        } catch {
            // ignore
        }
    }

    set_modules(modules: readonly Module[]): void {
        this.modules = modules as Module[];
        this.sync_runtime_pan_to_modules();
    }

    private sync_runtime_pan_to_modules(): void {
        for (const module of this.modules) {
            try {
                module?.setRuntimePanOffset?.(this.pan_tiles_x, this.pan_tiles_y);
            } catch {
                // ignore
            }
        }
    }

    private get_screen_locked_pan_bounds(): { min_x: number; max_x: number; min_y: number; max_y: number } | null {
        let found = false;
        let min_x = Number.NEGATIVE_INFINITY;
        let max_x = Number.POSITIVE_INFINITY;
        let min_y = Number.NEGATIVE_INFINITY;
        let max_y = Number.POSITIVE_INFINITY;

        for (const module of this.modules) {
            if (!module?.isScreenLocked || !module.getScreenLockedPanBounds) continue;
            const bounds = module.getScreenLockedPanBounds();
            min_x = Math.max(min_x, bounds.min_x);
            max_x = Math.min(max_x, bounds.max_x);
            min_y = Math.max(min_y, bounds.min_y);
            max_y = Math.min(max_y, bounds.max_y);
            found = true;
        }

        if (!found) return null;
        return {
            min_x: Number.isFinite(min_x) ? min_x : 0,
            max_x: Number.isFinite(max_x) ? max_x : 0,
            min_y: Number.isFinite(min_y) ? min_y : 0,
            max_y: Number.isFinite(max_y) ? max_y : 0,
        };
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
        ev: any,
        cell?: Cell,
        click_count?: 1 | 2,
    ): PointerEvent {
        const e: any = {
            pointer_id: typeof ev?.pointerId === 'number' ? ev.pointerId : 0,
            kind,
            x,
            y,

            buttons: typeof ev?.buttons === 'number' ? ev.buttons : 0,
            button: typeof ev?.button === 'number' ? ev.button : 0,

            shift: ev.shiftKey,
            ctrl: ev.ctrlKey,
            alt: ev.altKey,
            meta: ev.metaKey,
        };

        // Capture keyboard state for gesture routing.
        e.space = this.space_down;

        if (typeof ev?.pointerType === 'string') e.pointer_type = ev.pointerType;
        if (typeof ev?.pressure === 'number') e.pressure = ev.pressure;

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

        // Capture keyboard state for gesture routing.
        e.space = this.space_down;

        // caller may attach pointer metadata later

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

    private get_canvas_module(): Module | undefined {
        // Find the painter_canvas module to use as fallback for events
        return this.modules.find(m => m?.id === 'painter_canvas');
    }

    private get_metrics() {
        const font_size_px = this.base_font_size_px * this.scale;
        const line_height_px = font_size_px * this.base_line_height_mult;
        const letter_spacing_px = font_size_px * this.base_letter_spacing_mult;

        this.ctx.font = `400 ${font_size_px}px ${this.font_family}`;
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

        this.recenter_or_clamp_pan();
    }

    private recenter_or_clamp_pan(): void {
        const viewport = this.canvas_el.parentElement;
        if (!viewport) return;

        const vw = viewport.clientWidth;
        const vh = viewport.clientHeight;
        const cw = this.canvas_el.width;
        const ch = this.canvas_el.height;

        const { tile_w, tile_h } = this.get_metrics();

        // Center baseline and snap to the tile grid.
        const centered_x_raw = (vw - cw) / 2;
        const centered_y_raw = (vh - ch) / 2;

        const centered_x = Math.round(centered_x_raw / tile_w) * tile_w;
        const centered_y = Math.round(centered_y_raw / tile_h) * tile_h;

        this.base_pan_px_x = centered_x;
        this.base_pan_px_y = centered_y;

        if (!this.pan_dirty) {
            this.pan_tiles_x = 0;
            this.pan_tiles_y = 0;
            this.pan_accum_px_x = 0;
            this.pan_accum_px_y = 0;
        }

        const screen_locked_pan_bounds = this.get_screen_locked_pan_bounds();

        const mx = this.PAN_MARGIN_TILES * tile_w;
        const my = this.PAN_MARGIN_TILES * tile_h;

        const desired_x = this.base_pan_px_x + this.pan_tiles_x * tile_w;
        const desired_y = this.base_pan_px_y + this.pan_tiles_y * tile_h;

        const min_x = Math.min(this.base_pan_px_x - mx, vw - cw - mx);
        const max_x = Math.max(this.base_pan_px_x + mx, 0 + mx);
        const min_y = Math.min(this.base_pan_px_y - my, vh - ch - my);
        const max_y = Math.max(this.base_pan_px_y + my, 0 + my);

        const clamped_x = Math.max(min_x, Math.min(max_x, desired_x));
        const clamped_y = Math.max(min_y, Math.min(max_y, desired_y));

        // Convert clamped px back to tile offsets (keeps tile-locked).
        this.pan_tiles_x = Math.round((clamped_x - this.base_pan_px_x) / tile_w);
        this.pan_tiles_y = Math.round((clamped_y - this.base_pan_px_y) / tile_h);

        if (screen_locked_pan_bounds) {
            const next_pan_x = Math.max(screen_locked_pan_bounds.min_x, Math.min(screen_locked_pan_bounds.max_x, this.pan_tiles_x));
            const next_pan_y = Math.max(screen_locked_pan_bounds.min_y, Math.min(screen_locked_pan_bounds.max_y, this.pan_tiles_y));
            if (next_pan_x !== this.pan_tiles_x) {
                this.pan_accum_px_x = 0;
                this.pan_tiles_x = next_pan_x;
            }
            if (next_pan_y !== this.pan_tiles_y) {
                this.pan_accum_px_y = 0;
                this.pan_tiles_y = next_pan_y;
            }
        }

        const final_x = this.base_pan_px_x + this.pan_tiles_x * tile_w;
        const final_y = this.base_pan_px_y + this.pan_tiles_y * tile_h;

        // Apply CSS transform to move the entire canvas
        this.canvas_el.style.transform = `translate(${final_x}px, ${final_y}px)`;
        this.sync_runtime_pan_to_modules();

        // Best-effort notification so the app shell can keep background patterns aligned.
        try {
            window.dispatchEvent(
                new CustomEvent('thaumworld_ui_pan', {
                    detail: {
                        pan_x_px: final_x,
                        pan_y_px: final_y,
                        tile_w_px: tile_w,
                        tile_h_px: tile_h,
                        scale: this.scale,
                    },
                }),
            );
        } catch {
            // ignore
        }
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
                this.ctx.font = `${css_w} ${font_size_px}px ${this.font_family}`;

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
        // Global UI scale (1% steps).
        // Avoid eating '-' / '+' while typing in the input, but allow Ctrl-based override.
        const typing = this.focused_owner?.id === 'input';
        const allow_while_typing = ev.ctrlKey;

        if (!typing || allow_while_typing) {
            if (ev.key === '+' || ev.key === '=') {
                const next = this.clamp_scale(Number((this.scale * 1.01).toFixed(4)));
                this.set_scale(next);
                this.persist_scale_best_effort(next);
                ev.preventDefault();
                return true;
            }
            if (ev.key === '-' || ev.key === '_') {
                const next = this.clamp_scale(Number((this.scale / 1.01).toFixed(4)));
                this.set_scale(next);
                this.persist_scale_best_effort(next);
                ev.preventDefault();
                return true;
            }
        }

        // Debug overlays are toggled from UI buttons (not hotkeys).
        // Renderer snapshot: dumps the current composed ASCII grid to disk.
        // This is used for debugging visual state in a way LLMs can ingest.
        //
        // Hotkeys:
        // - Ctrl + .
        // - Ctrl + /
        // - . or / when nothing is focused
        const is_snapshot_key = ev.key === '.' || ev.key === '/';
        if (is_snapshot_key && (ev.ctrlKey || this.focused_owner === null)) {
            void this.write_ascii_snapshot();
            return true;
        }
        if (ev.key === 'Escape') {
            this.focused_owner?.OnBlur?.();
            this.focused_owner = null;
            return true;
        }
        return false;
    }

    private grid_to_ascii(): string {
        // NOTE: y=0 is bottom in our grid space, so we print from top -> bottom.
        const lines: string[] = [];
        for (let y = this.grid_height - 1; y >= 0; y--) {
            let row = '';
            for (let x = 0; x < this.grid_width; x++) {
                const cell = this.engine_canvas.get(x, y);
                row += cell?.char ?? ' ';
            }
            lines.push(row);
        }
        return lines.join('\n');
    }

    private async read_session_id_best_effort(): Promise<string> {
        const api = (window as any).electronAPI;
        if (!api?.readFile) return 'no_session';

        try {
            const res = await api.readFile('.session_id');
            if (!res?.success || typeof res.content !== 'string') return 'no_session';
            const parsed = JSON.parse(res.content);
            const sid = parsed?.session_id;
            if (typeof sid === 'string' && sid.length > 0) return sid;
            return 'no_session';
        } catch {
            return 'no_session';
        }
    }

    private async write_ascii_snapshot(): Promise<void> {
        const api = (window as any).electronAPI;
        if (!api?.writeFile || !api?.getDataSlotDir) {
            console.warn('[ui_snapshot] electronAPI missing; cannot write snapshot');
            return;
        }

        const session_id = await this.read_session_id_best_effort();
        const now = new Date();
        const iso = now.toISOString();
        const stamp = iso.replace(/[:.]/g, '-');

        // Current workflow uses slot 1 for testing.
        const dataSlotDir = await api.getDataSlotDir(1);
        const filename = `ui_snapshot_${session_id}_${stamp}.txt`;
        const filePath = `${dataSlotDir}/logs/${filename}`;

        const header = [
            '# UI ASCII Snapshot',
            `timestamp: ${iso}`,
            `session_id: ${session_id}`,
            `grid: ${this.grid_width}x${this.grid_height}`,
            'hotkey: Ctrl+. / Ctrl+/',
            '',
        ].join('\n');

        const payload = `${header}${this.grid_to_ascii()}\n`;
        const result = await api.writeFile(filePath, payload);
        if (!result?.success) {
            console.warn('[ui_snapshot] write failed', { filePath, error: result?.error });
            return;
        }

        console.log('[ui_snapshot] saved', { filePath });
    }

    private attach_events(): void {
        // Help pen/touch input behave consistently.
        // (Prevents browser gesture handling from stealing pointer events.)
        try {
            (this.canvas_el.style as any).touchAction = 'none';
        } catch {
            // ignore
        }

        // Debug logging for pen/stylus input was used during development.
        // Keep runtime free of noisy event logs in normal operation.

        const now_ms = () => performance.now();

        const normalize_buttons = (ev: any): { buttons: number; button: number } => {
            // PointerEvent move often has button=-1; keep last known.
            let buttons = typeof ev?.buttons === 'number' ? ev.buttons : 0;
            let button = typeof ev?.button === 'number' ? ev.button : 0;

            if (typeof ev?.pointerId === 'number') {
                if (ev.type === 'pointerdown') {
                    // Some pen drivers report button=0 even for barrel buttons.
                    if (button === 0 && buttons) {
                        if (buttons & 2) button = 2;      // secondary
                        else if (buttons & 4) button = 1; // auxiliary/middle
                        else if (buttons & 8) button = 2; // back -> treat as secondary
                        else if (buttons & 16) button = 2; // forward -> treat as secondary
                        else if (buttons & 32) {
                            // "Eraser" / pen barrel often maps to buttons=32.
                            // Treat it as secondary for tool routing.
                            button = 2;
                            buttons = buttons | 2;
                        }
                    }

                    this.active_pointer_id = ev.pointerId;
                    this.active_pointer_buttons = buttons || 1;
                    this.active_pointer_button = button;
                }

                const is_active = this.active_pointer_id === ev.pointerId;
                if (is_active) {
                    // Some tablet drivers drop buttons to 0 during pen drag.
                    const pressure = typeof ev?.pressure === 'number' ? ev.pressure : 0;
                    const pointerType = typeof ev?.pointerType === 'string' ? ev.pointerType : '';
                    const pen_like = pointerType === 'pen' || pointerType === 'touch';
                    const is_move = ev.type === 'pointermove';
                    if (is_move && buttons === 0 && (pressure > 0 || pen_like) && this.active_pointer_buttons) {
                        buttons = this.active_pointer_buttons;
                    }
                    if (is_move && (button === -1 || button === 0) && this.active_pointer_button) {
                        // Preserve which button initiated the stroke.
                        button = this.active_pointer_button;
                    }

                    // If this pointer is in "eraser" mode, ensure secondary bit stays present.
                    if (is_move && (buttons & 32) && !(buttons & 2)) {
                        buttons = buttons | 2;
                    }

                    if (ev.type === 'pointerup' || ev.type === 'pointercancel') {
                        this.active_pointer_id = null;
                        this.active_pointer_buttons = 0;
                        this.active_pointer_button = 0;
                    }
                }
            }

            return { buttons, button };
        };

        const attach_pointer_meta = (out: any, ev: any) => {
            if (!out) return;
            if (typeof ev?.pointerType === 'string') out.pointer_type = ev.pointerType;
            if (typeof ev?.pressure === 'number') out.pressure = ev.pressure;
        };

        const route_move = (ev: any) => {
            const t = this.mouse_to_tile(ev);

            if (!t) {
                if (!this.capture_owner && this.hover_owner?.OnPointerLeave && this.last_tile) {
                    const leave_ev: any = this.make_pointer_event(
                        'leave',
                        this.last_tile.x,
                        this.last_tile.y,
                        ev,
                        this.engine_canvas.get(this.last_tile.x, this.last_tile.y),
                    );
                    attach_pointer_meta(leave_ev, ev);
                    this.hover_owner.OnPointerLeave(leave_ev);
                }
                this.hover_owner = null;
                this.last_tile = null;
                return;
            }

            const top = this.route_to_top_module(t.x, t.y) ?? null;

            const nb = normalize_buttons(ev);
            const base: any = this.make_pointer_event(
                'move',
                t.x,
                t.y,
                { ...ev, buttons: nb.buttons, button: nb.button },
                this.engine_canvas.get(t.x, t.y),
            );
            attach_pointer_meta(base, ev);

            // Global pointer move hook (does not participate in routing).
            // Useful for cross-module drag visuals/state.
            if (this.on_pointer_move_global) {
                try {
                    this.on_pointer_move_global(base.x, base.y, base as PointerEvent);
                } catch {
                    // ignore
                }
            }

            // Global pan: Check at top level so it works even with no capture_owner (blank space)
            if (this.global_pan_active && (nb.buttons & 1)) {
                const should_global_pan = !this.capture_owner ||
                    !(this.capture_owner.id === 'painter_canvas' || this.capture_owner.id?.startsWith('canvas') || this.capture_owner.id === 'place');

                if (should_global_pan) {
                    const dx = ev.clientX - this.last_pan_client_x;
                    const dy = ev.clientY - this.last_pan_client_y;
                    this.last_pan_client_x = ev.clientX;
                    this.last_pan_client_y = ev.clientY;

                    const { tile_w, tile_h } = this.get_metrics();
                    this.pan_accum_px_x += dx;
                    this.pan_accum_px_y += dy;

                    const step_x = tile_w > 0 ? Math.trunc(this.pan_accum_px_x / tile_w) : 0;
                    const step_y = tile_h > 0 ? Math.trunc(this.pan_accum_px_y / tile_h) : 0;

                    if (step_x !== 0) {
                        this.pan_tiles_x += step_x;
                        this.pan_accum_px_x -= step_x * tile_w;
                    }
                    if (step_y !== 0) {
                        this.pan_tiles_y += step_y;
                        this.pan_accum_px_y -= step_y * tile_h;
                    }

                    this.pan_dirty = true;

                    const canvas_module = this.get_canvas_module();
                    if (canvas_module && (canvas_module as any).setGlobalPanOffset) {
                        (canvas_module as any).setGlobalPanOffset(this.pan_tiles_x, -this.pan_tiles_y);
                    }

                    this.recenter_or_clamp_pan();
                    this.last_tile = t;
                    return;
                }
            }

            if (this.capture_owner) {
                this.capture_owner.OnPointerMove?.(base);

                if (this.down_tile) {
                    const dist = this.drag_distance_tiles(t.x, t.y);
                    if (!this.dragging && dist >= this.DRAG_THRESHOLD_TILES) {
                        this.dragging = true;
                        const de: any = this.make_drag_event('drag_start', t.x, t.y, nb.buttons, this.engine_canvas.get(t.x, t.y));
                        attach_pointer_meta(de, ev);
                        de.pointer_id = typeof ev?.pointerId === 'number' ? ev.pointerId : 0;
                        this.capture_owner.OnDragStart?.(de);
                    }

                    if (this.dragging) {
                        const de: any = this.make_drag_event('drag_move', t.x, t.y, nb.buttons, this.engine_canvas.get(t.x, t.y));
                        attach_pointer_meta(de, ev);
                        de.pointer_id = typeof ev?.pointerId === 'number' ? ev.pointerId : 0;
                        this.capture_owner.OnDragMove?.(de);
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
        };

        const route_down = (ev: any) => {
            ev.preventDefault?.();
            this.focus_key_sink();

            const t = this.mouse_to_tile(ev);
            if (!t) return;

            const nb = normalize_buttons(ev);
            // Mark that we should ignore mouse compatibility events for a moment.
            this.suppress_mouse_until_ms = now_ms() + 500;

            let top = this.route_to_top_module(t.x, t.y) ?? null;

            const typing = this.focused_owner?.id === 'input';
            const is_canvas_module = top?.id === 'painter_canvas' || top?.id?.startsWith('canvas');
            const is_painter_mode2 = (window as any).electronAPI?.appMode === 'ascii_painter';

            if (is_painter_mode2) {
                if (!typing && this.space_down) {
                    if (is_canvas_module) {
                        this.global_pan_active = false;
                        const canvas_module = this.get_canvas_module();
                        if (canvas_module && (canvas_module as any).setGlobalPanOffset) {
                            (canvas_module as any).setGlobalPanOffset(0, 0);
                        }
                    } else if (!top) {
                        this.global_pan_active = true;
                    } else {
                        this.global_pan_active = !top.OnDragMove;
                    }
                } else {
                    this.global_pan_active = false;
                }
             } else {
                 // Game mode: route Space+Drag to modules that handle dragging (e.g. Place view pan).
                 // Only use global UI pan when dragging blank space, or when the module does not implement drag.
                 if (!typing && this.space_down) {
                     if (is_canvas_module || top?.id === 'place') {
                         this.global_pan_active = false;
                     } else if (!top) {
                         this.global_pan_active = true;
                     } else {
                         this.global_pan_active = !top.OnDragMove;
                     }
                 } else {
                     this.global_pan_active = (!top && !typing);
                 }
             }

            if (this.global_pan_active) {
                this.last_pan_client_x = ev.clientX;
                this.last_pan_client_y = ev.clientY;
            }

            this.down_owner = top;
            this.down_tile = t;
            this.dragging = false;
            this.capture_owner = top;

            if (top?.Focusable && top !== this.focused_owner) {
                this.focused_owner?.OnBlur?.();
                this.focused_owner = top;
                this.focused_owner?.OnFocus?.();
            }

            const pe: any = this.make_pointer_event('down', t.x, t.y, { ...ev, buttons: nb.buttons, button: nb.button }, this.engine_canvas.get(t.x, t.y));
            attach_pointer_meta(pe, ev);

            // Global pointer-down lane: lets modules cancel modes (e.g. resize) on outside clicks.
            for (const m of this.modules) {
                try {
                    m?.OnGlobalPointerDown?.(pe as PointerEvent);
                } catch {
                    // ignore
                }
            }
            top?.OnPointerDown?.(pe);
        };

        const route_up = (ev: any) => {
            const t = this.mouse_to_tile(ev);
            const nb = normalize_buttons(ev);

            if (!t) {
                if (this.dragging && this.on_drag_end_outside) {
                    this.on_drag_end_outside(-1, -1);
                }
                this.capture_owner = null;
                this.down_owner = null;
                this.down_tile = null;
                this.dragging = false;
                this.global_pan_active = false;
                return;
            }

            const top = this.route_to_top_module(t.x, t.y) ?? null;
            const target = this.capture_owner ?? top;

            const pe: any = this.make_pointer_event('up', t.x, t.y, { ...ev, buttons: nb.buttons, button: nb.button }, this.engine_canvas.get(t.x, t.y));
            attach_pointer_meta(pe, ev);
            target?.OnPointerUp?.(pe);

            this.global_pan_active = false;

            if (this.dragging && top) {
                const de: any = this.make_drag_event('drag_end', t.x, t.y, nb.buttons, this.engine_canvas.get(t.x, t.y));
                attach_pointer_meta(de, ev);
                de.pointer_id = typeof ev?.pointerId === 'number' ? ev.pointerId : 0;
                top.OnDragEnd?.(de);
            } else if (this.dragging && !top && this.on_drag_end_outside) {
                this.on_drag_end_outside(t.x, t.y);
            }

            if (!this.dragging && this.down_owner && target && this.down_owner === target) {
                if (rect_contains(target.rect, t.x, t.y)) {
                    const now = performance.now();
                    const button = nb.button;

                    const p = this.pending_single_click;
                    const is_double =
                        !!p &&
                        now <= p.run_at_ms &&
                        p.target.id === target.id &&
                        p.button === button &&
                        Math.max(Math.abs(t.x - p.x), Math.abs(t.y - p.y)) <= this.DBLCLICK_TILE_RADIUS;

                    if (is_double) {
                        this.pending_single_click = null;
                        const ce: any = this.make_pointer_event('click', t.x, t.y, { ...ev, buttons: nb.buttons, button: nb.button }, this.engine_canvas.get(t.x, t.y), 2);
                        attach_pointer_meta(ce, ev);
                        target.OnClick?.(ce);
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
        };

        // Stylus/tablet: route PointerEvents for real pen/touch support.
        this.canvas_el.addEventListener('pointerdown', (ev: any) => {
            try { (ev.target as HTMLElement | null)?.setPointerCapture?.(ev.pointerId); } catch { /* ignore */ }
            route_down(ev);
        }, { passive: false } as any);
        this.canvas_el.addEventListener('pointermove', (ev: any) => {
            route_move(ev);
        }, { passive: false } as any);
        this.canvas_el.addEventListener('pointerup', (ev: any) => {
            try { (ev.target as HTMLElement | null)?.releasePointerCapture?.(ev.pointerId); } catch { /* ignore */ }
            route_up(ev);
        }, { passive: false } as any);
        this.canvas_el.addEventListener('pointercancel', (ev: any) => {
            try { (ev.target as HTMLElement | null)?.releasePointerCapture?.(ev.pointerId); } catch { /* ignore */ }
            route_up({ ...ev, type: 'pointercancel' });
        }, { passive: false } as any);

        this.canvas_el.addEventListener('contextmenu', (ev) => {
            ev.preventDefault();
        });

        // Some drivers / browsers emit auxclick for middle/right.
        // Route it as a regular click so pen/mouse middle/right clicks are usable.
        this.canvas_el.addEventListener('auxclick', (ev: any) => {
            if (now_ms() < this.suppress_mouse_until_ms) {
                if (ev?.button === 0) return;
            }
            ev.preventDefault?.();

            const t = this.mouse_to_tile(ev);
            if (!t) return;
            const top = this.route_to_top_module(t.x, t.y) ?? null;

            const nb = { buttons: typeof ev?.buttons === 'number' ? ev.buttons : 0, button: typeof ev?.button === 'number' ? ev.button : 0 };
            top?.OnClick?.(
                this.make_pointer_event('click', t.x, t.y, { ...ev, buttons: nb.buttons, button: nb.button }, this.engine_canvas.get(t.x, t.y), 1),
            );
        }, { passive: false } as any);

        // Unlock WebAudio on first user gesture.
        this.canvas_el.addEventListener('mousedown', () => {
            unlock_sfx();
        });

        this.canvas_el.addEventListener('mousemove', (ev) => {
            if (now_ms() < this.suppress_mouse_until_ms) {
                // Allow non-left mouse streams through during suppression. Some tablet drivers
                // emit real mouse right/middle events for barrel buttons.
                const buttons = typeof (ev as any).buttons === 'number' ? (ev as any).buttons : 0;
                const has_non_left = (buttons & ~1) !== 0;
                if (!has_non_left) return;
            }
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

            // Global pan: Check at top level so it works even with no capture_owner (blank space)
            // This must come before the capture_owner check
            if (this.global_pan_active && (ev.buttons & 1)) {
                // When dragging, use capture_owner to determine if we should pan globally
                // If no capture_owner (blank space), always pan globally
                // If capture_owner exists, only pan globally if it's not the canvas module
                 const should_global_pan = !this.capture_owner || 
                     !(this.capture_owner.id === 'painter_canvas' || this.capture_owner.id?.startsWith('canvas') || this.capture_owner.id === 'place');
                
                if (should_global_pan) {
                    const dx = ev.clientX - this.last_pan_client_x;
                    const dy = ev.clientY - this.last_pan_client_y;
                    this.last_pan_client_x = ev.clientX;
                    this.last_pan_client_y = ev.clientY;

                    const { tile_w, tile_h } = this.get_metrics();
                    this.pan_accum_px_x += dx;
                    this.pan_accum_px_y += dy;

                    const step_x = tile_w > 0 ? Math.trunc(this.pan_accum_px_x / tile_w) : 0;
                    const step_y = tile_h > 0 ? Math.trunc(this.pan_accum_px_y / tile_h) : 0;

                    if (step_x !== 0) {
                        this.pan_tiles_x += step_x;
                        this.pan_accum_px_x -= step_x * tile_w;
                    }
                    if (step_y !== 0) {
                        this.pan_tiles_y += step_y;
                        this.pan_accum_px_y -= step_y * tile_h;
                    }

                    this.pan_dirty = true;
                    console.log('[GLOBAL-PAN] Moving:', JSON.stringify({ capture_owner: this.capture_owner?.id ?? 'null', pan_tiles_x: this.pan_tiles_x, pan_tiles_y: this.pan_tiles_y, step_x, step_y }));
                    
                    // Notify canvas module of global pan offset (convert tile offset to grid cells)
                    const canvas_module = this.get_canvas_module();
                    if (canvas_module && (canvas_module as any).setGlobalPanOffset) {
                        (canvas_module as any).setGlobalPanOffset(this.pan_tiles_x, -this.pan_tiles_y); // Y is inverted
                    }
                    
                    this.recenter_or_clamp_pan();

                    this.last_tile = t;
                    return;
                }
            }

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
            if (now_ms() < this.suppress_mouse_until_ms) {
                // Allow right/middle mouse downs (pen barrel) through.
                if (ev.button === 0) return;
            }
            ev.preventDefault();
            this.focus_key_sink();

            const t = this.mouse_to_tile(ev);
            if (!t) return;

            let top = this.route_to_top_module(t.x, t.y) ?? null;
            
            // Global UI pan gesture (GAME MODE ONLY):
            // - Hold Space + drag anywhere (except while actively typing in input or on canvas module)
            // - Or drag on background/free space
            // NOTE: In painter mode, we use camera-based panning via the canvas module instead
            const typing = this.focused_owner?.id === 'input';
            const is_canvas_module = top?.id === 'painter_canvas' || top?.id?.startsWith('canvas');
            const is_painter_mode = (window as any).electronAPI?.appMode === 'ascii_painter';
            
            if (is_painter_mode) {
                // Painter mode: Smart panning routing
                // - On canvas module: Camera pan (routes to canvas)
                // - On blank space: Global UI pan (move entire mono_canvas)
                // - On other modules: If module has OnDragMove, it handles it; otherwise global pan
                if (!typing && this.space_down) {
                    if (is_canvas_module) {
                        // On canvas: Route to canvas module for camera pan
                        this.global_pan_active = false;
                        console.log('[PAN-ROUTING] Canvas module: camera pan (global_pan_active=false)');
                        // Reset global pan offset on canvas module
                        const canvas_module = this.get_canvas_module();
                        if (canvas_module && (canvas_module as any).setGlobalPanOffset) {
                            (canvas_module as any).setGlobalPanOffset(0, 0);
                        }
                    } else if (!top) {
                        // On blank space: Enable global UI pan
                        this.global_pan_active = true;
                        console.log('[PAN-ROUTING] Blank space: global UI pan (global_pan_active=true)');
                    } else {
                        // On other module: Check if it has OnDragMove
                        // If yes, let module handle it; if no, use global pan
                        this.global_pan_active = !top.OnDragMove;
                        console.log(`[PAN-ROUTING] Module ${top.id}: ${top.OnDragMove ? 'module handles pan' : 'global UI pan'} (global_pan_active=${this.global_pan_active})`);
                    }
                } else {
                    this.global_pan_active = false;
                }
             } else {
                 // Game mode: route Space+Drag to modules that handle dragging (e.g. Place view pan).
                 // Only use global UI pan when dragging blank space, or when the module does not implement drag.
                 if (!typing && this.space_down) {
                     if (is_canvas_module || top?.id === 'place') {
                         this.global_pan_active = false;
                     } else if (!top) {
                         this.global_pan_active = true;
                     } else {
                         this.global_pan_active = !top.OnDragMove;
                     }
                 } else {
                     this.global_pan_active = (!top && !typing);
                 }
             }
            
            if (this.global_pan_active) {
                this.last_pan_client_x = ev.clientX;
                this.last_pan_client_y = ev.clientY;
            }

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
            if (now_ms() < this.suppress_mouse_until_ms) {
                if (ev.button === 0) return;
            }
            const t = this.mouse_to_tile(ev);
            if (!t) {
                // Drag ended outside canvas - notify for rejection feedback
                if (this.dragging && this.on_drag_end_outside) {
                    this.on_drag_end_outside(-1, -1);
                }
                this.capture_owner = null;
                this.down_owner = null;
                this.down_tile = null;
                this.dragging = false;
                this.global_pan_active = false;
                return;
            }

            const top = this.route_to_top_module(t.x, t.y) ?? null;
            const target = this.capture_owner ?? top;

            target?.OnPointerUp?.(
                this.make_pointer_event('up', t.x, t.y, ev, this.engine_canvas.get(t.x, t.y)),
            );

            this.global_pan_active = false;

            // Phase 8: Route OnDragEnd to module under cursor (target), not source module
            // This enables drag-and-drop between modules (e.g., CharacterModule to ContainerModule)
            if (this.dragging && top) {
                top.OnDragEnd?.(
                    this.make_drag_event('drag_end', t.x, t.y, ev.buttons, this.engine_canvas.get(t.x, t.y)),
                );
            } else if (this.dragging && !top && this.on_drag_end_outside) {
                // Drag ended outside any module - notify for rejection feedback
                this.on_drag_end_outside(t.x, t.y);
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
            unlock_sfx();

            // Update authoritative action state (so movement can poll it)
            handle_keydown(ev, { typing: this.focused_owner?.id === 'input' });

            if (ev.code === 'Space') {
                // Space is reserved for global UI pan gesture when not typing into input.
                const typing = this.focused_owner?.id === 'input';
                if (DEBUG_LEVEL >= 4 && !ev.repeat) {
                    debug_log('[RUNTIME-DEBUG] Space keydown - typing:', typing, 'focused_owner:', this.focused_owner?.id);
                }
                if (!typing) {
                    this.space_down = true;
                    ev.preventDefault();
                }
            }
            for (let i = this.modules.length - 1; i >= 0; i--) {
                const m = this.modules[i];
                if (!m) continue;
                if (m.OnGlobalKeyDown) {
                    m.OnGlobalKeyDown(ev);
                    break;
                }
            }

            if (this.dispatch_global_keydown(ev)) return;
            if (DEBUG_LEVEL >= 4 && !ev.repeat) {
                debug_log('[RUNTIME-DEBUG] Calling OnKeyDown on focused_owner:', this.focused_owner?.id, 'key:', ev.code);
            }
            this.focused_owner?.OnKeyDown?.(ev);
        });

        this.key_sink.addEventListener('keyup', (ev) => {
            // Update authoritative action state (clears action on keyup)
            handle_keyup(ev, { typing: this.focused_owner?.id === 'input' });

            if (ev.code === 'Space') {
                this.space_down = false;
            }
            // Key-up is broadcast as a global lane so held-input systems (eg movement)
            // can release even if focus changes mid-press.
            for (let i = this.modules.length - 1; i >= 0; i--) {
                const m = this.modules[i];
                if (!m) continue;
                try {
                    m.OnGlobalKeyUp?.(ev);
                } catch {
                    // ignore
                }
            }
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

        // Reset action states on blur/visibility change to prevent stuck keys
        window.addEventListener('blur', () => {
            if (DEBUG_LEVEL >= 3) {
                try {
                    debug_log('MOVE_UNIFY_TEST', 'window blur -> input reset_all');
                } catch {
                    // ignore
                }
            }
            reset_all();
        });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                if (DEBUG_LEVEL >= 3) {
                    try {
                        debug_log('MOVE_UNIFY_TEST', 'document hidden -> input reset_all');
                    } catch {
                        // ignore
                    }
                }
                reset_all();
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

        if (this.on_after_compose) {
            try {
                this.on_after_compose(this.engine_canvas);
            } catch {
                // ignore
            }
        }

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
