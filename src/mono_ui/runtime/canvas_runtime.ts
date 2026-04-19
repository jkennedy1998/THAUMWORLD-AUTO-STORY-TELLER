import { create_canvas } from '../canvas.js';
import { compose_modules } from '../compose.js';
import type { Canvas, Cell, Module, PointerEvent, DragEvent, WheelEvent } from '../types.js';
import { rect_contains } from '../types.js';
import { debug_warn, DEBUG_LEVEL } from '../../shared/debug.js';
import { diag_log } from '../../shared/diagnostics.js';
// NOTE: debug overlays are toggled from UI buttons (not hotkeys).
import { unlock_sfx } from '../sfx/sfx_player.js';
import { get_action_for_code, handle_keydown, handle_keyup } from './input_actions.js';
import { is_tool_assisted_inputs_active } from './automation_runtime.js';
import { clamp_ui_scale, get_ui_cell_metrics, screen_px_to_grid_cell } from './ui_metrics.js';
import type { ToolAssistedInputsPointerActionName } from './automation_interfaces.js';
import type { RenderBackendKind } from './render_theme.js';
import { create_canvas_cell_renderer, type CanvasCellRenderer } from './cell_renderer.js';
import { clamp_weight_index, DEFAULT_WEIGHT_INDEX_TO_CSS } from '../weight_system.js';
import { create_electron_input_host, type ElectronInputHost } from './electron_input_host.js';
import { reset_all } from './input_actions.js';

function is_directional_action(action: string | null): action is 'move_up' | 'move_down' | 'move_left' | 'move_right' {
    return action === 'move_up' || action === 'move_down' || action === 'move_left' || action === 'move_right';
}

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
    render_backend?: RenderBackendKind;
    render_theme_id?: string;

    modules: readonly Module[];
    
    // Called when a drag ends outside any module (for rejection feedback)
    on_drag_end_outside?: (x: number, y: number) => void;

    // Called on every pointer move (global hook; does not affect routing)
    on_pointer_move_global?: (x: number, y: number, e: PointerEvent) => void;

    // Called after modules compose each frame (for overlays)
    on_after_compose?: (canvas: Canvas) => void;
};

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
    private render_backend: RenderBackendKind;
    private render_theme_id: string;
    private cell_renderer: CanvasCellRenderer;

    private scale = 1.0;
    private raf_id: number | null = null;
    private frame_perf_index = 0;
    private frame_perf_previous_raf_start_ms = 0;
    private frame_perf_previous_tick_end_ms = 0;
    private frame_perf_summary = {
        frames: 0,
        slow_frames: 0,
        very_slow_frames: 0,
        max_tick_total_js_ms: 0,
        max_post_js_to_next_raf_ms: 0,
        summed_tick_total_js_ms: 0,
        summed_compose_ms: 0,
        summed_draw_canvas_ms: 0,
        summed_draw_canvas_clear_ms: 0,
        summed_draw_canvas_scan_ms: 0,
        summed_draw_canvas_draw_cell_ms: 0,
        summed_draw_canvas_cells_scanned: 0,
        summed_draw_canvas_non_empty_cells: 0,
        summed_draw_canvas_graphic_cells: 0,
        summed_post_js_to_next_raf_ms: 0,
        summed_raf_delta_ms: 0,
    };
    private frame_perf_module_summary = new Map<string, { summed_ms: number; max_ms: number }>();
    private long_task_observer: PerformanceObserver | null = null;
    private long_task_total_count = 0;
    private long_task_window_count = 0;
    private long_task_window_max_ms = 0;

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
    private shift_down = false;
    private ctrl_down = false;
    private alt_down = false;
    private meta_down = false;
    private last_published_ui_context_key = '';
    private gameplay_bridge_down_codes = new Set<string>();

    private sync_modifier_state(ev: Pick<KeyboardEvent, 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey'>): void {
        this.shift_down = Boolean(ev.shiftKey);
        this.ctrl_down = Boolean(ev.ctrlKey);
        this.alt_down = Boolean(ev.altKey);
        this.meta_down = Boolean(ev.metaKey);
    }

    private clear_modifier_state(): void {
        this.shift_down = false;
        this.ctrl_down = false;
        this.alt_down = false;
        this.meta_down = false;
    }

    private clear_transient_input_state(): void {
        this.gameplay_bridge_down_codes.clear();
        this.space_down = false;
        this.clear_modifier_state();
    }

    public inject_tool_assisted_gameplay_key(type: 'keydown' | 'keyup', payload: { code: string; key?: string; repeat?: boolean }): void {
        if (this.input_host.source_kind !== 'electron_bridge') return;
        const code = String(payload.code ?? '').trim();
        if (!code) return;
        const key = String(payload.key ?? '').trim();
        const action = get_action_for_code(code);
        if (!this.is_bridge_owned_gameplay_action(action)) return;
        const typing = this.focused_owner_wants_text_capture();
        this.publish_gameplay_input_context(typing);
        if (code === 'Space') {
            this.space_down = type === 'keydown';
        }
        if (type === 'keydown') {
            if (!payload.repeat && !this.gameplay_bridge_down_codes.has(code)) {
                this.gameplay_bridge_down_codes.add(code);
                this.forward_bridge_gameplay_event({ code, key, repeat: Boolean(payload.repeat) } as KeyboardEvent, 'keydown');
            }
            return;
        }
        if (this.gameplay_bridge_down_codes.has(code)) {
            this.gameplay_bridge_down_codes.delete(code);
            this.forward_bridge_gameplay_event({ code, key, repeat: Boolean(payload.repeat) } as KeyboardEvent, 'keyup');
        }
    }

    public inject_tool_assisted_ui_key(type: 'keydown' | 'keyup', payload: { code: string; key?: string; repeat?: boolean; shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean }): void {
        const code = String(payload.code ?? '').trim();
        if (!code) return;
        const key = String(payload.key ?? '').trim() || code;
        const ev = new KeyboardEvent(type, {
            code,
            key,
            repeat: Boolean(payload.repeat),
            shiftKey: Boolean(payload.shift),
            ctrlKey: Boolean(payload.ctrl),
            altKey: Boolean(payload.alt),
            metaKey: Boolean(payload.meta),
            bubbles: false,
            cancelable: true,
        });
        for (const [name, value] of Object.entries({
            ctrlKey: Boolean(payload.ctrl),
            shiftKey: Boolean(payload.shift),
            altKey: Boolean(payload.alt),
            metaKey: Boolean(payload.meta),
        })) {
            try {
                Object.defineProperty(ev, name, { configurable: true, get: () => value });
            } catch {
                // ignore readonly override failures
            }
        }
        if (type === 'keydown') {
            this.handle_runtime_keydown(ev);
            return;
        }
        this.handle_runtime_keyup(ev);
    }

    public inject_tool_assisted_text_input(payload: { text: string }): void {
        const text = typeof payload?.text === 'string' ? payload.text : '';
        if (!text || !this.focused_owner?.OnTextInput || !this.focused_owner_wants_text_capture()) return;
        this.sync_text_input_focus_for_owner();
        this.focused_owner.OnTextInput(text);
    }

    public focus_module_by_id(module_id: string): boolean {
        const target = this.modules.find((module) => module?.id === module_id) ?? null;
        if (!target?.Focusable) return false;
        this.update_focused_owner(target);
        return true;
    }

    // Allow panning beyond strict canvas bounds (gives breathing room / "free space").
    private readonly PAN_MARGIN_TILES = 10;

    // Base translate (centered/snap-to-grid) computed from viewport + canvas size.
    private base_pan_px_x = 0;
    private base_pan_px_y = 0;
    private readonly runtime_instance_id = `canvas_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    private readonly input_host: ElectronInputHost;

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
        this.render_backend = opts.render_backend ?? 'font';
        this.render_theme_id = opts.render_theme_id ?? 'default';
        this.cell_renderer = create_canvas_cell_renderer({
            backend: this.render_backend,
            theme_id: this.render_theme_id,
        });
        this.modules = opts.modules;
        this.on_drag_end_outside = opts.on_drag_end_outside ?? null;
        this.on_pointer_move_global = opts.on_pointer_move_global ?? null;
        this.on_after_compose = opts.on_after_compose ?? null;

        this.engine_canvas = create_canvas(this.grid_width, this.grid_height);
        this.key_sink = opts.key_sink ?? this.ensure_key_sink();
        this.input_host = create_electron_input_host({
            on_keydown: this.handle_runtime_keydown,
            on_keyup: this.handle_runtime_keyup,
            on_window_focus: () => {
                this.publish_gameplay_input_context(this.focused_owner_wants_text_capture());
                this.log_input_debug('window focus observed', {
                    runtime_instance_id: this.runtime_instance_id,
                    active_element_id: (document.activeElement as HTMLElement | null)?.id ?? null,
                    focused_owner_id: this.focused_owner?.id ?? null,
                });
            },
            on_window_blur: () => {
                this.clear_transient_input_state();
                this.publish_gameplay_input_context(this.focused_owner_wants_text_capture());
                this.log_input_debug('window blur observed', {
                    runtime_instance_id: this.runtime_instance_id,
                    active_element_id: (document.activeElement as HTMLElement | null)?.id ?? null,
                    focused_owner_id: this.focused_owner?.id ?? null,
                });
            },
        });

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

    reset_keyboard_state(): void {
        reset_all();
        this.space_down = false;
        this.clear_modifier_state();
        this.gameplay_bridge_down_codes.clear();
    }

    set_grid_size(grid_width: number, grid_height: number): void {
        const next_width = Math.max(1, Math.floor(Number(grid_width) || 1));
        const next_height = Math.max(1, Math.floor(Number(grid_height) || 1));
        const size_changed = next_width !== this.grid_width || next_height !== this.grid_height;
        this.grid_width = next_width;
        this.grid_height = next_height;
        if (size_changed) {
            this.engine_canvas = create_canvas(this.grid_width, this.grid_height);
        }
        this.resize_to_grid();
    }

    private clamp_scale(scale: number): number {
        return clamp_ui_scale(scale);
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

    private is_frame_perf_enabled(): boolean {
        try {
            const raw = window.localStorage.getItem('canvas_frame_perf_enabled');
            if (raw === null) return true;
            return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
        } catch {
            return true;
        }
    }

    private read_frame_perf_number(key: string, fallback: number): number {
        try {
            const raw = window.localStorage.getItem(key);
            const parsed = Number(raw);
            if (Number.isFinite(parsed) && parsed > 0) return parsed;
        } catch {
            // ignore
        }
        return fallback;
    }

    private round_perf_ms(value: number): number {
        return Math.round(value * 100) / 100;
    }

    private record_frame_perf_module(module_id: string, duration_ms: number): void {
        const current = this.frame_perf_module_summary.get(module_id) ?? { summed_ms: 0, max_ms: 0 };
        current.summed_ms += duration_ms;
        current.max_ms = Math.max(current.max_ms, duration_ms);
        this.frame_perf_module_summary.set(module_id, current);
    }

    private reset_frame_perf_summary(): void {
        this.frame_perf_summary = {
            frames: 0,
            slow_frames: 0,
            very_slow_frames: 0,
            max_tick_total_js_ms: 0,
            max_post_js_to_next_raf_ms: 0,
            summed_tick_total_js_ms: 0,
            summed_compose_ms: 0,
            summed_draw_canvas_ms: 0,
            summed_draw_canvas_clear_ms: 0,
            summed_draw_canvas_scan_ms: 0,
            summed_draw_canvas_draw_cell_ms: 0,
            summed_draw_canvas_cells_scanned: 0,
            summed_draw_canvas_non_empty_cells: 0,
            summed_draw_canvas_graphic_cells: 0,
            summed_post_js_to_next_raf_ms: 0,
            summed_raf_delta_ms: 0,
        };
        this.frame_perf_module_summary.clear();
    }

    private start_long_task_observer(): void {
        if (!this.is_frame_perf_enabled() || this.long_task_observer || typeof PerformanceObserver === 'undefined') return;
        try {
            const observer = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    const duration_ms = Number(entry.duration) || 0;
                    this.long_task_total_count += 1;
                    this.long_task_window_count += 1;
                    this.long_task_window_max_ms = Math.max(this.long_task_window_max_ms, duration_ms);
                    if (duration_ms >= 100) {
                        diag_log('performance_metrics', 'important', 'CANVAS_FRAME_PERF', 'longtask', {
                            frame_index: this.frame_perf_index,
                            start_time_ms: this.round_perf_ms(entry.startTime),
                            duration_ms: this.round_perf_ms(duration_ms),
                        });
                    }
                }
            });
            observer.observe({ entryTypes: ['longtask'] });
            this.long_task_observer = observer;
        } catch {
            this.long_task_observer = null;
        }
    }

    private stop_long_task_observer(): void {
        try {
            this.long_task_observer?.disconnect();
        } catch {
            // ignore
        }
        this.long_task_observer = null;
    }

    start(): void {
        this.resize_to_grid();
        this.start_long_task_observer();
        this.tick();
    }

    stop(): void {
        if (this.raf_id !== null) cancelAnimationFrame(this.raf_id);
        this.raf_id = null;
        this.stop_long_task_observer();
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
        this.log_input_debug('focus_key_sink called', {
            runtime_instance_id: this.runtime_instance_id,
            active_element_id: (document.activeElement as HTMLElement | null)?.id ?? null,
            focused_owner_id: this.focused_owner?.id ?? null,
        });
    }

    private focused_owner_wants_text_capture(): boolean {
        return this.focused_owner?.WantsTextCapture?.() === true;
    }

    private sync_text_input_focus_for_owner(): void {
        if (this.focused_owner_wants_text_capture()) {
            this.focus_key_sink();
            return;
        }

        if (document.activeElement === this.key_sink) {
            try {
                this.key_sink.blur();
            } catch {
                // ignore
            }
        }
    }

    private update_focused_owner(next_owner: Module | null): void {
        if (next_owner === this.focused_owner) return;
        this.log_input_debug('focused owner changed', {
            runtime_instance_id: this.runtime_instance_id,
            previous_owner_id: this.focused_owner?.id ?? null,
            next_owner_id: next_owner?.id ?? null,
            next_owner_wants_text_capture: next_owner?.WantsTextCapture?.() === true,
            active_element_id: (document.activeElement as HTMLElement | null)?.id ?? null,
        });
        this.focused_owner?.OnBlur?.();
        this.focused_owner = next_owner;
        this.focused_owner?.OnFocus?.();
        this.sync_text_input_focus_for_owner();
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

            shift: Boolean(ev?.shiftKey) || this.shift_down,
            ctrl: Boolean(ev?.ctrlKey) || this.ctrl_down,
            alt: Boolean(ev?.altKey) || this.alt_down,
            meta: Boolean(ev?.metaKey) || this.meta_down,
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

    private resolve_tool_assisted_pointer_button(pointer_action?: ToolAssistedInputsPointerActionName, button?: number): { button: number; buttons: number } {
        if (Number.isFinite(button)) {
            const resolved = Math.max(0, Math.floor(Number(button)));
            return { button: resolved, buttons: resolved === 2 ? 2 : resolved === 1 ? 4 : 1 };
        }
        if (pointer_action === 'secondary') return { button: 2, buttons: 2 };
        if (pointer_action === 'auxiliary') return { button: 1, buttons: 4 };
        return { button: 0, buttons: 1 };
    }

    private make_tool_assisted_pointer_like(kind: string, action: { x: number; y: number; pointer_action?: ToolAssistedInputsPointerActionName; button?: number; pointer_type?: string; pressure?: number; shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean; buttons?: number }): any {
        const resolved = this.resolve_tool_assisted_pointer_button(action.pointer_action, action.button);
        return {
            type: kind,
            clientX: action.x,
            clientY: action.y,
            pointerId: 0,
            pointerType: action.pointer_type ?? 'mouse',
            pressure: typeof action.pressure === 'number' ? action.pressure : ((action.pointer_type ?? 'mouse') === 'mouse' ? 0.5 : 0.5),
            button: resolved.button,
            buttons: typeof action.buttons === 'number' ? action.buttons : resolved.buttons,
            shiftKey: Boolean(action.shift),
            ctrlKey: Boolean(action.ctrl),
            altKey: Boolean(action.alt),
            metaKey: Boolean(action.meta),
            preventDefault() { /* noop */ },
        };
    }

    private route_tool_assisted_pointer_move(ev: any): void {
        const t = { x: Math.floor(ev.clientX), y: Math.floor(ev.clientY) };
        const top = this.route_to_top_module(t.x, t.y) ?? null;
        const base: any = this.make_pointer_event('move', t.x, t.y, ev, this.engine_canvas.get(t.x, t.y));
        if (typeof ev?.pointerType === 'string') base.pointer_type = ev.pointerType;
        if (typeof ev?.pressure === 'number') base.pressure = ev.pressure;
        if (this.on_pointer_move_global) {
            try { this.on_pointer_move_global(base.x, base.y, base as PointerEvent); } catch { /* ignore */ }
        }
        if (this.capture_owner) {
            this.capture_owner.OnPointerMove?.(base);
            if (this.down_tile) {
                const dist = this.drag_distance_tiles(t.x, t.y);
                if (!this.dragging && dist >= this.DRAG_THRESHOLD_TILES) {
                    this.dragging = true;
                    const de: any = this.make_drag_event('drag_start', t.x, t.y, ev.buttons, this.engine_canvas.get(t.x, t.y));
                    de.pointer_type = ev.pointerType;
                    de.pressure = ev.pressure;
                    this.capture_owner.OnDragStart?.(de);
                }
                if (this.dragging) {
                    const de: any = this.make_drag_event('drag_move', t.x, t.y, ev.buttons, this.engine_canvas.get(t.x, t.y));
                    de.pointer_type = ev.pointerType;
                    de.pressure = ev.pressure;
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
    }

    public inject_tool_assisted_pointer_move(action: { x: number; y: number; pointer_action?: ToolAssistedInputsPointerActionName; button?: number; pointer_type?: string; pressure?: number; shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean }): void {
        this.route_tool_assisted_pointer_move(this.make_tool_assisted_pointer_like('pointermove', action));
    }

    public inject_tool_assisted_pointer_down(action: { x: number; y: number; pointer_action?: ToolAssistedInputsPointerActionName; button?: number; pointer_type?: string; pressure?: number; shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean }): void {
        const ev = this.make_tool_assisted_pointer_like('pointerdown', action);
        const t = { x: Math.floor(action.x), y: Math.floor(action.y) };
        let top = this.route_to_top_module(t.x, t.y) ?? null;
        this.down_owner = top;
        this.down_tile = t;
        this.dragging = false;
        this.capture_owner = top;
        if (top?.Focusable) this.update_focused_owner(top);
        else if (this.focused_owner?.id === 'painter_canvas') this.update_focused_owner(null);
        const pe: any = this.make_pointer_event('down', t.x, t.y, ev, this.engine_canvas.get(t.x, t.y));
        pe.pointer_type = ev.pointerType;
        pe.pressure = ev.pressure;
        for (const m of this.modules) {
            try { m?.OnGlobalPointerDown?.(pe as PointerEvent); } catch { /* ignore */ }
        }
        top?.OnPointerDown?.(pe);
        this.sync_text_input_focus_for_owner();
        this.last_tile = t;
    }

    public inject_tool_assisted_pointer_up(action: { x: number; y: number; pointer_action?: ToolAssistedInputsPointerActionName; button?: number; pointer_type?: string; pressure?: number; shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean }, click_count?: 1 | 2): void {
        const ev = this.make_tool_assisted_pointer_like('pointerup', action, );
        const t = { x: Math.floor(action.x), y: Math.floor(action.y) };
        const top = this.route_to_top_module(t.x, t.y) ?? null;
        const target = this.capture_owner ?? top;
        const pe: any = this.make_pointer_event('up', t.x, t.y, ev, this.engine_canvas.get(t.x, t.y));
        pe.pointer_type = ev.pointerType;
        pe.pressure = ev.pressure;
        target?.OnPointerUp?.(pe);
        if (this.dragging && top) {
            const de: any = this.make_drag_event('drag_end', t.x, t.y, ev.buttons, this.engine_canvas.get(t.x, t.y));
            de.pointer_type = ev.pointerType;
            de.pressure = ev.pressure;
            top.OnDragEnd?.(de);
        }
        if (!this.dragging && this.down_owner && target && this.down_owner === target && rect_contains(target.rect, t.x, t.y)) {
            target.OnClick?.(this.make_pointer_event('click', t.x, t.y, ev, this.engine_canvas.get(t.x, t.y), click_count ?? 1));
            this.sync_text_input_focus_for_owner();
        }
        this.capture_owner = null;
        this.down_owner = null;
        this.down_tile = null;
        this.dragging = false;
        this.last_tile = t;
    }

    public inject_tool_assisted_pointer_click(action: { x: number; y: number; pointer_action?: ToolAssistedInputsPointerActionName; button?: number; pointer_type?: string; pressure?: number; shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean }, click_count: 1 | 2): void {
        this.inject_tool_assisted_pointer_move(action);
        this.inject_tool_assisted_pointer_down(action);
        this.inject_tool_assisted_pointer_up(action, click_count);
    }

    public inject_tool_assisted_context_menu(action: { x: number; y: number; pointer_action?: ToolAssistedInputsPointerActionName; button?: number; pointer_type?: string; pressure?: number; shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean }): void {
        const ev = this.make_tool_assisted_pointer_like('contextmenu', { ...action, pointer_action: action.pointer_action ?? 'secondary', button: action.button ?? 2 });
        const t = { x: Math.floor(action.x), y: Math.floor(action.y) };
        const top = this.route_to_top_module(t.x, t.y) ?? null;
        if (top) {
            const pe: any = this.make_pointer_event('click', t.x, t.y, ev, this.engine_canvas.get(t.x, t.y), 1);
            pe.pointer_type = ev.pointerType;
            pe.pressure = ev.pressure;
            top.OnContextMenu?.(pe);
        }
        this.last_tile = t;
    }

    public inject_tool_assisted_pointer_drag(action: { from_x: number; from_y: number; to_x: number; to_y: number; steps?: number; pointer_action?: ToolAssistedInputsPointerActionName; button?: number; pointer_type?: string; pressure?: number; shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean }): void {
        const steps = Math.max(1, Math.floor(Number(action.steps) || 1));
        this.inject_tool_assisted_pointer_move({ ...action, x: action.from_x, y: action.from_y });
        this.inject_tool_assisted_pointer_down({ ...action, x: action.from_x, y: action.from_y });
        for (let i = 1; i <= steps; i += 1) {
            const x = action.from_x + ((action.to_x - action.from_x) * i) / steps;
            const y = action.from_y + ((action.to_y - action.from_y) * i) / steps;
            this.inject_tool_assisted_pointer_move({ ...action, x, y });
        }
        this.inject_tool_assisted_pointer_up({ ...action, x: action.to_x, y: action.to_y });
    }

    public inject_tool_assisted_wheel(action: { x: number; y: number; delta_x: number; delta_y: number; shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean }): void {
        const t = { x: Math.floor(action.x), y: Math.floor(action.y) };
        const top = this.route_to_top_module(t.x, t.y);
        top?.OnWheel?.({
            x: t.x,
            y: t.y,
            delta_x: action.delta_x,
            delta_y: action.delta_y,
            delta_mode: 0,
            shift: Boolean(action.shift),
            ctrl: Boolean(action.ctrl),
            alt: Boolean(action.alt),
            meta: Boolean(action.meta),
        });
        this.last_tile = t;
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
        const metrics = get_ui_cell_metrics(this.scale, this.base_font_size_px);
        const font_size_px = metrics.font_size_px;
        const line_height_px = metrics.cell_h_px;
        const letter_spacing_px = 0;
        const tile_w = metrics.cell_w_px;
        const tile_h = metrics.cell_h_px;
        return { font_size_px, line_height_px, letter_spacing_px, tile_w, tile_h };
    }

    get_tile_metrics(): { tile_w: number; tile_h: number; font_size_px: number } {
        const { tile_w, tile_h, font_size_px } = this.get_metrics();
        return { tile_w, tile_h, font_size_px };
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
                        render_backend: this.render_backend,
                        render_theme_id: this.render_theme_id,
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

    private draw_canvas(c: Canvas): {
        clear_ms: number;
        scan_ms: number;
        draw_cell_ms: number;
        cells_scanned: number;
        non_empty_cells: number;
        graphic_cells: number;
    } {
        const { font_size_px, tile_w, tile_h } = this.get_metrics();
        const clear_started_at_ms = performance.now();

        this.ctx.clearRect(0, 0, this.canvas_el.width, this.canvas_el.height);
        const clear_ms = Math.max(0, performance.now() - clear_started_at_ms);

        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';

        const scan_started_at_ms = performance.now();
        let draw_cell_ms = 0;
        let cells_scanned = 0;
        let non_empty_cells = 0;
        let graphic_cells = 0;

        for (let y = 0; y < c.height; y++) {
            for (let x = 0; x < c.width; x++) {
                cells_scanned += 1;
                const cell = c.get(x, y);
                if (!cell) continue;
                if (cell.char === ' ') continue;
                non_empty_cells += 1;
                if ((cell as any).graphic) graphic_cells += 1;

                const canvas_y = (c.height - 1 - y) * tile_h;

                const original_weight_index = (cell as any).weight_index;
                const wi = clamp_weight_index(original_weight_index);
                const cx = x * tile_w + tile_w / 2;
                const cy = canvas_y + tile_h / 2;
                const draw_cell_started_at_ms = performance.now();
                this.cell_renderer.draw_cell({
                    ctx: this.ctx,
                    cell: original_weight_index === wi ? cell : { ...cell, weight_index: wi },
                    center_x_px: cx,
                    center_y_px: cy,
                    cell_w_px: tile_w,
                    cell_h_px: tile_h,
                    font_family: this.font_family,
                    font_size_px,
                    weight_index_to_css: this.weight_index_to_css,
                });
                draw_cell_ms += Math.max(0, performance.now() - draw_cell_started_at_ms);
            }
        }

        return {
            clear_ms,
            scan_ms: Math.max(0, performance.now() - scan_started_at_ms),
            draw_cell_ms,
            cells_scanned,
            non_empty_cells,
            graphic_cells,
        };
    }

    private mouse_to_tile(ev: MouseEvent): { x: number; y: number } | null {
        const { tile_w, tile_h } = this.get_metrics();
        const rect = this.canvas_el.getBoundingClientRect();
        return screen_px_to_grid_cell({
            client_x_px: ev.clientX,
            client_y_px: ev.clientY,
            rect_left_px: rect.left,
            rect_top_px: rect.top,
            grid_width: this.grid_width,
            grid_height: this.grid_height,
            cell_w_px: tile_w,
            cell_h_px: tile_h,
        });
    }

    private dispatch_global_keydown(ev: KeyboardEvent): boolean {
        // Global UI scale (1% steps).
        // Avoid eating '-' / '+' while typing in the input, but allow Ctrl-based override.
        const typing = this.focused_owner_wants_text_capture();
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
            ev.preventDefault();
            return true;
        }
        return false;
    }

    private build_input_context(typing: boolean) {
        return {
            typing,
            window_focused: document.hasFocus(),
            active_element_id: (document.activeElement as HTMLElement | null)?.id ?? null,
            focused_owner_id: this.focused_owner?.id ?? null,
        };
    }

    private log_input_debug(message: string, payload: Record<string, unknown>): void {
        if (this.input_host.source_kind === 'electron_bridge') return;
        try {
            diag_log('input', 'verbose', 'INPUT_DEBUG', message, payload);
        } catch {
            // ignore
        }
    }

    private publish_gameplay_input_context(typing: boolean): void {
        try {
            const payload = {
                source: 'ui_runtime',
                typing,
                window_focused: document.hasFocus(),
                active_element_id: (document.activeElement as HTMLElement | null)?.id ?? null,
                focused_owner_id: this.focused_owner?.id ?? null,
            };
            const next_key = JSON.stringify(payload);
            if (next_key === this.last_published_ui_context_key) return;
            this.last_published_ui_context_key = next_key;
            (window as Window).electronAPI?.gameplayInputPublishContext?.(payload);
        } catch {
            // ignore
        }
    }

    private is_bridge_owned_gameplay_action(action: string | null): action is 'move_up' | 'move_down' | 'move_left' | 'move_right' | 'jump' {
        return action === 'jump' || is_directional_action(action);
    }

    private forward_bridge_gameplay_event(ev: KeyboardEvent, type: 'keydown' | 'keyup'): void {
        try {
            (window as Window).electronAPI?.gameplayInputSendEvent?.({
                source: 'ui_runtime',
                type,
                code: ev.code,
                key: ev.key,
                repeat: ev.repeat,
            });
        } catch {
            // ignore
        }
    }

    private handle_gameplay_capture_keydown = (ev: KeyboardEvent): void => {
        if (this.input_host.source_kind !== 'electron_bridge') return;
        const typing = this.focused_owner_wants_text_capture();
        const action = get_action_for_code(ev.code);
        if (is_tool_assisted_inputs_active() && ev.isTrusted && this.is_bridge_owned_gameplay_action(action)) {
            ev.preventDefault();
            ev.stopImmediatePropagation();
            return;
        }
        if (!this.is_bridge_owned_gameplay_action(action) || typing) return;
        this.publish_gameplay_input_context(typing);
        if (ev.code === 'Space') {
            this.space_down = true;
        }
        this.sync_modifier_state(ev);
        if (!ev.repeat && !this.gameplay_bridge_down_codes.has(ev.code)) {
            this.gameplay_bridge_down_codes.add(ev.code);
            this.forward_bridge_gameplay_event(ev, 'keydown');
        }
        ev.preventDefault();
        ev.stopImmediatePropagation();
    };

    private handle_gameplay_capture_keyup = (ev: KeyboardEvent): void => {
        if (this.input_host.source_kind !== 'electron_bridge') return;
        const typing = this.focused_owner_wants_text_capture();
        const action = get_action_for_code(ev.code);
        if (is_tool_assisted_inputs_active() && ev.isTrusted && this.is_bridge_owned_gameplay_action(action)) {
            ev.preventDefault();
            ev.stopImmediatePropagation();
            return;
        }
        if (!this.is_bridge_owned_gameplay_action(action) || typing) return;
        this.publish_gameplay_input_context(typing);
        if (ev.code === 'Space') {
            this.space_down = false;
        }
        this.sync_modifier_state(ev);
        if (this.gameplay_bridge_down_codes.has(ev.code)) {
            this.gameplay_bridge_down_codes.delete(ev.code);
            this.forward_bridge_gameplay_event(ev, 'keyup');
        }
        ev.preventDefault();
        ev.stopImmediatePropagation();
    };

    private handle_runtime_keydown = (ev: KeyboardEvent): void => {
        const typing = this.focused_owner_wants_text_capture();
        const action = get_action_for_code(ev.code);
        if (is_tool_assisted_inputs_active() && ev.isTrusted && !typing && this.is_bridge_owned_gameplay_action(action)) {
            ev.preventDefault();
            ev.stopImmediatePropagation();
            return;
        }
        this.publish_gameplay_input_context(typing);
        if (this.input_host.source_kind !== 'electron_bridge' && ev.code === 'Space' && !typing) {
            this.space_down = true;
        }
        this.sync_modifier_state(ev);
        if (ev.repeat && is_directional_action(action)) {
            if (!typing) {
                ev.preventDefault();
            }
            return;
        }
        unlock_sfx();
        const input_context = this.build_input_context(typing);
        if (!(this.input_host.source_kind === 'electron_bridge' && ev.repeat && action === 'jump')) {
        this.log_input_debug('window keydown received', {
            runtime_instance_id: this.runtime_instance_id,
            code: ev.code,
            key: ev.key,
            ctrl: ev.ctrlKey,
            shift: ev.shiftKey,
            alt: ev.altKey,
            meta: ev.metaKey,
            repeat: ev.repeat,
            is_trusted: ev.isTrusted,
            target_tag: (ev.target as HTMLElement | null)?.tagName ?? null,
            target_id: (ev.target as HTMLElement | null)?.id ?? null,
            active_element_id: input_context.active_element_id,
            focused_owner_id: input_context.focused_owner_id,
            typing,
            action,
            default_prevented_before: ev.defaultPrevented,
        });
        }

        if (ev.key === 'Escape') {
            this.focused_owner?.OnKeyDown?.(ev);
            if (ev.defaultPrevented) return;
            if (action) {
                handle_keydown(ev, input_context);
            }
            if (this.dispatch_global_keydown(ev)) return;
            return;
        }

        if (action) {
            handle_keydown(ev, input_context);
            if (!typing || action === 'cancel') {
                ev.preventDefault();
            }
        }

        if (!typing) {
            for (let i = this.modules.length - 1; i >= 0; i--) {
                const m = this.modules[i];
                if (!m) continue;
                if (m.OnGlobalKeyDown) {
                    m.OnGlobalKeyDown(ev);
                    if (ev.defaultPrevented) return;
                }
            }
        }

        if (!typing && this.dispatch_global_keydown(ev)) return;
        this.focused_owner?.OnKeyDown?.(ev);
    };

    private handle_runtime_keyup = (ev: KeyboardEvent): void => {
        const typing = this.focused_owner_wants_text_capture();
        const action = get_action_for_code(ev.code);
        if (is_tool_assisted_inputs_active() && ev.isTrusted && !typing && this.is_bridge_owned_gameplay_action(action)) {
            ev.preventDefault();
            ev.stopImmediatePropagation();
            return;
        }
        this.publish_gameplay_input_context(typing);
        if (this.input_host.source_kind !== 'electron_bridge' && ev.code === 'Space') {
            this.space_down = false;
        }
        this.sync_modifier_state(ev);
        const input_context = this.build_input_context(typing);
        this.log_input_debug('window keyup received', {
            runtime_instance_id: this.runtime_instance_id,
            code: ev.code,
            key: ev.key,
            ctrl: ev.ctrlKey,
            shift: ev.shiftKey,
            alt: ev.altKey,
            meta: ev.metaKey,
            repeat: ev.repeat,
            is_trusted: ev.isTrusted,
            target_tag: (ev.target as HTMLElement | null)?.tagName ?? null,
            target_id: (ev.target as HTMLElement | null)?.id ?? null,
            active_element_id: input_context.active_element_id,
            focused_owner_id: input_context.focused_owner_id,
            typing,
            action,
            default_prevented_before: ev.defaultPrevented,
        });
        if (action) {
            handle_keyup(ev, input_context);
            if (!typing || action === 'cancel') {
                ev.preventDefault();
            }
        }

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
    };

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
        this.log_input_debug('attaching canvas runtime input listeners', {
            runtime_instance_id: this.runtime_instance_id,
        });
        document.addEventListener('keydown', this.handle_gameplay_capture_keydown, true);
        document.addEventListener('keyup', this.handle_gameplay_capture_keyup, true);
        this.input_host.attach();
        document.addEventListener('visibilitychange', () => {
            this.log_input_debug('document visibilitychange observed', {
                runtime_instance_id: this.runtime_instance_id,
                visibility_state: document.visibilityState,
            });
            if (document.visibilityState === 'hidden') {
                this.clear_transient_input_state();
            }
        });

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

            const t = this.mouse_to_tile(ev);
            if (!t) return;

            const nb = normalize_buttons(ev);
            // Mark that we should ignore mouse compatibility events for a moment.
            this.suppress_mouse_until_ms = now_ms() + 500;

            let top = this.route_to_top_module(t.x, t.y) ?? null;

            const typing = this.focused_owner_wants_text_capture();
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

            if (top?.Focusable) {
                this.update_focused_owner(top);
            } else if (this.focused_owner?.id === 'painter_canvas') {
                this.update_focused_owner(null);
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
            this.sync_text_input_focus_for_owner();
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
                        this.sync_text_input_focus_for_owner();
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

            const t = this.mouse_to_tile(ev);
            if (!t) return;

            let top = this.route_to_top_module(t.x, t.y) ?? null;
            
            // Global UI pan gesture (GAME MODE ONLY):
            // - Hold Space + drag anywhere (except while actively typing in input or on canvas module)
            // - Or drag on background/free space
            // NOTE: In painter mode, we use camera-based panning via the canvas module instead
            const typing = this.focused_owner_wants_text_capture();
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
            if (top?.Focusable) {
                this.update_focused_owner(top);
            } else if (this.focused_owner?.id === 'painter_canvas') {
                this.update_focused_owner(null);
            }
            top?.OnPointerDown?.(
                this.make_pointer_event('down', t.x, t.y, ev, this.engine_canvas.get(t.x, t.y)),
            );
            this.sync_text_input_focus_for_owner();
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
                        this.sync_text_input_focus_for_owner();
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

        this.key_sink.addEventListener('beforeinput', (ev: InputEvent) => {
            if (!this.focused_owner?.OnTextInput) return;

            ev.preventDefault();
            const data = (ev as any).data;

            if (typeof data === 'string' && data.length > 0) {
                this.focused_owner.OnTextInput(data);
            }
        });
        this.key_sink.addEventListener('paste', (ev: ClipboardEvent) => {
            if (!this.focused_owner?.OnTextInput) return;

            ev.preventDefault();
            const text = ev.clipboardData?.getData('text/plain') ?? '';
            if (text.length > 0) {
                this.focused_owner.OnTextInput(text);
            }
        });
        this.key_sink.addEventListener('focus', () => {
            this.log_input_debug('key_sink focus observed', {
                runtime_instance_id: this.runtime_instance_id,
                active_element_id: (document.activeElement as HTMLElement | null)?.id ?? null,
                focused_owner_id: this.focused_owner?.id ?? null,
            });
        });
        this.key_sink.addEventListener('blur', () => {
            this.log_input_debug('key_sink blur observed', {
                runtime_instance_id: this.runtime_instance_id,
                active_element_id: (document.activeElement as HTMLElement | null)?.id ?? null,
                focused_owner_id: this.focused_owner?.id ?? null,
            });
            this.clear_transient_input_state();
        });

    }

    private tick(): void {
        const frame_started_at_ms = performance.now();
        const now = frame_started_at_ms;
        const raf_delta_ms = this.frame_perf_previous_raf_start_ms > 0 ? Math.max(0, frame_started_at_ms - this.frame_perf_previous_raf_start_ms) : 0;
        const post_js_to_next_raf_ms = this.frame_perf_previous_tick_end_ms > 0 ? Math.max(0, frame_started_at_ms - this.frame_perf_previous_tick_end_ms) : 0;
        this.frame_perf_previous_raf_start_ms = frame_started_at_ms;
        const module_draws: Array<{ module_id: string; draw_ms: number }> = [];
        if (this.pending_single_click && now >= this.pending_single_click.run_at_ms) {
            const p = this.pending_single_click;
            this.pending_single_click = null;

            p.target.OnClick?.(
                this.make_pointer_event('click', p.x, p.y, p.ev, this.engine_canvas.get(p.x, p.y), 1),
            );
            this.sync_text_input_focus_for_owner();
        }

        const compose_started_at_ms = performance.now();
        compose_modules(this.engine_canvas, this.modules, (module, duration_ms) => {
            const module_id = String(module?.id ?? 'unknown');
            module_draws.push({ module_id, draw_ms: duration_ms });
            this.record_frame_perf_module(module_id, duration_ms);
        });
        const compose_ms = Math.max(0, performance.now() - compose_started_at_ms);

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

        const draw_canvas_started_at_ms = performance.now();
        const draw_canvas_stats = this.draw_canvas(this.engine_canvas);
        const draw_canvas_ms = Math.max(0, performance.now() - draw_canvas_started_at_ms);
        const tick_total_js_ms = Math.max(0, performance.now() - frame_started_at_ms);
        this.frame_perf_previous_tick_end_ms = performance.now();

        if (this.is_frame_perf_enabled()) {
            this.frame_perf_index += 1;
            const slow_frame_ms = this.read_frame_perf_number('canvas_frame_perf_slow_frame_ms', 16.7);
            const very_slow_frame_ms = this.read_frame_perf_number('canvas_frame_perf_very_slow_frame_ms', 33.3);
            const sample_every = Math.max(1, Math.floor(this.read_frame_perf_number('canvas_frame_perf_sample_every', 30)));
            const summary_every = Math.max(1, Math.floor(this.read_frame_perf_number('canvas_frame_perf_summary_every', 120)));
            this.frame_perf_summary.frames += 1;
            this.frame_perf_summary.summed_tick_total_js_ms += tick_total_js_ms;
            this.frame_perf_summary.summed_compose_ms += compose_ms;
            this.frame_perf_summary.summed_draw_canvas_ms += draw_canvas_ms;
            this.frame_perf_summary.summed_draw_canvas_clear_ms += draw_canvas_stats.clear_ms;
            this.frame_perf_summary.summed_draw_canvas_scan_ms += draw_canvas_stats.scan_ms;
            this.frame_perf_summary.summed_draw_canvas_draw_cell_ms += draw_canvas_stats.draw_cell_ms;
            this.frame_perf_summary.summed_draw_canvas_cells_scanned += draw_canvas_stats.cells_scanned;
            this.frame_perf_summary.summed_draw_canvas_non_empty_cells += draw_canvas_stats.non_empty_cells;
            this.frame_perf_summary.summed_draw_canvas_graphic_cells += draw_canvas_stats.graphic_cells;
            this.frame_perf_summary.summed_post_js_to_next_raf_ms += post_js_to_next_raf_ms;
            this.frame_perf_summary.summed_raf_delta_ms += raf_delta_ms;
            this.frame_perf_summary.max_tick_total_js_ms = Math.max(this.frame_perf_summary.max_tick_total_js_ms, tick_total_js_ms);
            this.frame_perf_summary.max_post_js_to_next_raf_ms = Math.max(this.frame_perf_summary.max_post_js_to_next_raf_ms, post_js_to_next_raf_ms);
            if (tick_total_js_ms >= slow_frame_ms) this.frame_perf_summary.slow_frames += 1;
            if (tick_total_js_ms >= very_slow_frame_ms) this.frame_perf_summary.very_slow_frames += 1;

            const should_log_frame = tick_total_js_ms >= slow_frame_ms
                || post_js_to_next_raf_ms >= slow_frame_ms
                || this.long_task_window_count > 0
                || this.frame_perf_index % sample_every === 0;
            if (should_log_frame) {
                diag_log('performance_metrics', 'important', 'CANVAS_FRAME_PERF', 'frame', {
                    frame_index: this.frame_perf_index,
                    raf_delta_ms: this.round_perf_ms(raf_delta_ms),
                    compose_ms: this.round_perf_ms(compose_ms),
                    draw_canvas_ms: this.round_perf_ms(draw_canvas_ms),
                    draw_canvas_clear_ms: this.round_perf_ms(draw_canvas_stats.clear_ms),
                    draw_canvas_scan_ms: this.round_perf_ms(draw_canvas_stats.scan_ms),
                    draw_canvas_draw_cell_ms: this.round_perf_ms(draw_canvas_stats.draw_cell_ms),
                    draw_canvas_cells_scanned: draw_canvas_stats.cells_scanned,
                    draw_canvas_non_empty_cells: draw_canvas_stats.non_empty_cells,
                    draw_canvas_graphic_cells: draw_canvas_stats.graphic_cells,
                    tick_total_js_ms: this.round_perf_ms(tick_total_js_ms),
                    post_js_to_next_raf_ms: this.round_perf_ms(post_js_to_next_raf_ms),
                    longtask_count: this.long_task_window_count,
                    longtask_max_ms: this.round_perf_ms(this.long_task_window_max_ms),
                    module_draws: module_draws.map((entry) => ({ module_id: entry.module_id, draw_ms: this.round_perf_ms(entry.draw_ms) })),
                });
            }

            if (this.frame_perf_index % summary_every === 0) {
                const frames = Math.max(1, this.frame_perf_summary.frames);
                diag_log('performance_metrics', 'verbose', 'CANVAS_FRAME_PERF', 'summary', {
                    frame_index: this.frame_perf_index,
                    frames: this.frame_perf_summary.frames,
                    slow_frames: this.frame_perf_summary.slow_frames,
                    very_slow_frames: this.frame_perf_summary.very_slow_frames,
                    avg_tick_total_js_ms: this.round_perf_ms(this.frame_perf_summary.summed_tick_total_js_ms / frames),
                    avg_compose_ms: this.round_perf_ms(this.frame_perf_summary.summed_compose_ms / frames),
                    avg_draw_canvas_ms: this.round_perf_ms(this.frame_perf_summary.summed_draw_canvas_ms / frames),
                    avg_draw_canvas_clear_ms: this.round_perf_ms(this.frame_perf_summary.summed_draw_canvas_clear_ms / frames),
                    avg_draw_canvas_scan_ms: this.round_perf_ms(this.frame_perf_summary.summed_draw_canvas_scan_ms / frames),
                    avg_draw_canvas_draw_cell_ms: this.round_perf_ms(this.frame_perf_summary.summed_draw_canvas_draw_cell_ms / frames),
                    avg_draw_canvas_cells_scanned: this.round_perf_ms(this.frame_perf_summary.summed_draw_canvas_cells_scanned / frames),
                    avg_draw_canvas_non_empty_cells: this.round_perf_ms(this.frame_perf_summary.summed_draw_canvas_non_empty_cells / frames),
                    avg_draw_canvas_graphic_cells: this.round_perf_ms(this.frame_perf_summary.summed_draw_canvas_graphic_cells / frames),
                    avg_post_js_to_next_raf_ms: this.round_perf_ms(this.frame_perf_summary.summed_post_js_to_next_raf_ms / frames),
                    avg_raf_delta_ms: this.round_perf_ms(this.frame_perf_summary.summed_raf_delta_ms / frames),
                    max_tick_total_js_ms: this.round_perf_ms(this.frame_perf_summary.max_tick_total_js_ms),
                    max_post_js_to_next_raf_ms: this.round_perf_ms(this.frame_perf_summary.max_post_js_to_next_raf_ms),
                    longtask_total_count: this.long_task_total_count,
                    longtask_window_count: this.long_task_window_count,
                    longtask_window_max_ms: this.round_perf_ms(this.long_task_window_max_ms),
                    module_avg_ms: Object.fromEntries(Array.from(this.frame_perf_module_summary.entries()).map(([module_id, summary]) => [module_id, this.round_perf_ms(summary.summed_ms / frames)])),
                    module_max_ms: Object.fromEntries(Array.from(this.frame_perf_module_summary.entries()).map(([module_id, summary]) => [module_id, this.round_perf_ms(summary.max_ms)])),
                });
                this.reset_frame_perf_summary();
            }
            this.long_task_window_count = 0;
            this.long_task_window_max_ms = 0;
        }
        this.raf_id = requestAnimationFrame(() => this.tick());
    }
}
