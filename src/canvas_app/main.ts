import { CanvasRuntime } from '../mono_ui/runtime/canvas_runtime.js';
import type { Module } from '../mono_ui/types.js';
import { compute_dom_viewport_for_rect } from '../mono_ui/runtime/dom_viewport.js';
import { clamp_ui_scale, compute_responsive_grid_size, get_ui_cell_metrics } from '../mono_ui/runtime/ui_metrics.js';
import { get_theme_font_primary_family, THAUMWORLD_RENDER_THEME } from '../mono_ui/runtime/render_theme.js';
import { APP_CONFIG, create_app_state } from './app_state.js';
import { PAINTER_CONFIG, create_painter_app_state } from './painter_app_state.js';

// Detect if we're in painter mode (set by preload script before page loads)
const IS_PAINTER_MODE = (window as any).electronAPI?.appMode === 'ascii_painter';

const el = document.getElementById('mono_canvas') as HTMLCanvasElement | null;
if (!el) throw new Error('mono_canvas element not found');
const canvasEl = el;

let modules: readonly Module[];
let module_registry: any;
let on_drag_end_outside: ((x: number, y: number) => void) | undefined;
let on_pointer_move_global: ((x: number, y: number, e: any) => void) | undefined;
let on_after_compose: ((canvas: any) => void) | undefined;

let painter_state: ReturnType<typeof create_painter_app_state> | null = null;
let game_state: ReturnType<typeof create_app_state> | null = null;

if (IS_PAINTER_MODE) {
    // PAINTER MODE
    console.log('🎨 Initializing ASCII Painter...');
    painter_state = create_painter_app_state();
    modules = painter_state.modules;
    module_registry = painter_state.module_registry;
    on_drag_end_outside = undefined;
    on_pointer_move_global = painter_state.on_pointer_move_global;

    // Initialize DOM renderer for voxel layers
    painter_state.init_dom_renderer();

    // Expose painter API globally
    (window as any).painter = {
        export: painter_state.export_grid,
        import: painter_state.import_grid,
        clear: painter_state.clear_canvas,
        save: painter_state.save_to_file,
        load: painter_state.load_from_file,
        new_canvas: painter_state.new_canvas,
        export_text: painter_state.export_as_text,
        filename: () => painter_state!.current_filename
    };
} else {
    // GAME MODE
    console.log('🎮 Initializing Game...');
    game_state = create_app_state();
    modules = game_state.modules;
    module_registry = game_state.module_registry;
    on_drag_end_outside = game_state.on_drag_end_outside;
    on_pointer_move_global = game_state.on_pointer_move_global;
    on_after_compose = game_state.on_after_compose;
}

const config = IS_PAINTER_MODE ? PAINTER_CONFIG : APP_CONFIG;
const layout_state = IS_PAINTER_MODE ? painter_state : game_state;

function compute_responsive_grid(scale: number): { width: number; height: number } | null {
    const viewport = canvasEl.parentElement;
    if (!viewport) return null;
    return compute_responsive_grid_size(viewport.clientWidth, viewport.clientHeight, scale);
}

function get_visible_modules(): readonly Module[] {
    if (!module_registry?.get_all) return modules;
    const all = module_registry.get_all() as readonly Module[];
    if (!module_registry.is_visible) return all;
    return all.filter((m: any) => {
        try {
            return module_registry.is_visible(m.id);
        } catch {
            return true;
        }
    });
}

const runtime = new CanvasRuntime({
    canvas: canvasEl,
    grid_width: config.grid_width,
    grid_height: config.grid_height,
    font_family: config.font_family,
    base_font_size_px: config.base_font_size_px,
    base_line_height_mult: config.base_line_height_mult,
    base_letter_spacing_mult: config.base_letter_spacing_mult,
    weight_index_to_css: config.weight_index_to_css,
    render_backend: config.render_backend,
    render_theme_id: config.render_theme_id,
    modules: get_visible_modules(),
    on_drag_end_outside,
    on_pointer_move_global,
    on_after_compose,
});

(window as any).TOOL_ASSISTED_INPUTS_RUNTIME = {
    inject_gameplay_key: (type: 'keydown' | 'keyup', payload: { code: string; key?: string; repeat?: boolean }) => {
        runtime.inject_tool_assisted_gameplay_key(type, payload);
    },
    inject_pointer_move: (payload: any) => {
        runtime.inject_tool_assisted_pointer_move(payload);
    },
    inject_pointer_down: (payload: any) => {
        runtime.inject_tool_assisted_pointer_down(payload);
    },
    inject_pointer_up: (payload: any) => {
        runtime.inject_tool_assisted_pointer_up(payload);
    },
    inject_pointer_click: (payload: any, click_count: 1 | 2) => {
        runtime.inject_tool_assisted_pointer_click(payload, click_count);
    },
    inject_context_menu: (payload: any) => {
        runtime.inject_tool_assisted_context_menu(payload);
    },
    inject_pointer_drag: (payload: any) => {
        runtime.inject_tool_assisted_pointer_drag(payload);
    },
    inject_wheel: (payload: any) => {
        runtime.inject_tool_assisted_wheel(payload);
    },
};

function apply_responsive_layout(scale: number): void {
    const next = compute_responsive_grid(scale);
    if (!next) return;
    runtime.set_grid_size(next.width, next.height);
    layout_state?.update_layout(next.width, next.height);
}

// Subscribe to module registry changes
if (module_registry) {
    module_registry.subscribe(() => {
        runtime.set_modules(get_visible_modules());
    });
}

// Hook DOM renderer into render loop for painter mode
if (IS_PAINTER_MODE && painter_state) {
    const painterRef = painter_state;
    const originalTick = (runtime as any)['tick'].bind(runtime);
    
    // Track tile size and global pan offset for viewport calculations
    let tileSize = { w: 0, h: 0 };
    let globalPan = { x: 0, y: 0 };
    let uiScale = 1.0;
    let gotPanEvent = false;
    let boot_frames_left = 10;
    let boot_recentering_done = false;

    function computeTileMetrics(scale: number): { tileW: number; tileH: number; fontSizePx: number } | null {
        const metrics = get_ui_cell_metrics(scale, config.base_font_size_px);
        return {
            tileW: metrics.cell_w_px,
            tileH: metrics.cell_h_px,
            fontSizePx: metrics.font_size_px,
        };
    }
    
    // Listen to canvas pan events for tile size and global pan updates
    window.addEventListener('thaumworld_ui_pan', ((ev: CustomEvent) => {
        tileSize.w = ev.detail?.tile_w_px ?? 0;
        tileSize.h = ev.detail?.tile_h_px ?? 0;
        // Track global pan offset from mono_canvas CSS transform
        globalPan.x = ev.detail?.pan_x_px ?? 0;
        globalPan.y = ev.detail?.pan_y_px ?? 0;
        uiScale = ev.detail?.scale ?? uiScale;
        gotPanEvent = true;
        
        // (debug logging removed)
    }) as EventListener);
    
    let lastViewportLogKey = '';

    (runtime as any)['tick'] = () => {
        // During the first few frames after boot the DOM/layout/font metrics can settle.
        // We re-sample metrics and canvas position to avoid a "snap" that only corrects
        // itself after the first manual global pan.
        const bootWarmup = boot_frames_left > 0;

        // Ensure we have sane initial metrics even before the first pan event.
        // On some boots the first recenter can run before the window layout is stable,
        // so we fall back to DOM + derived font metrics until events arrive.
        if (tileSize.w <= 0 || tileSize.h <= 0 || bootWarmup) {
            const m = computeTileMetrics(runtime.get_scale());
            if (m) {
                tileSize.w = m.tileW;
                tileSize.h = m.tileH;
                uiScale = runtime.get_scale();
            }
        }

        if (!gotPanEvent || bootWarmup) {
            const r = canvasEl.getBoundingClientRect();
            if (Number.isFinite(r.left) && Number.isFinite(r.top)) {
                globalPan.x = r.left;
                globalPan.y = r.top;
            }
        }

        // Force a single recenter pass once the first couple frames have rendered.
        // This mimics the "first manual pan" correction, but happens automatically.
        if (!gotPanEvent && bootWarmup && !boot_recentering_done && boot_frames_left <= 8) {
            boot_recentering_done = true;
            const s = runtime.get_scale();
            runtime.set_scale(s);
        }

        // IMPORTANT: Set viewport FIRST, then render DOM layers
        // This ensures the DOM renderer uses the current viewport position
        const currentModules: readonly Module[] = module_registry?.get_all ? module_registry.get_all() : modules;
        const canvasModule = currentModules.find(m => m.id === 'painter_canvas');
        if (canvasModule && tileSize.w > 0 && tileSize.h > 0) {
            const rect = canvasModule.rect;

            // Viewport in screen CSS pixels.
            // Keep painter + game-place aligned by reusing the shared helper.
            const vp = compute_dom_viewport_for_rect({
                pan_x_px: globalPan.x,
                pan_y_px: globalPan.y,
                tile_w_px: tileSize.w,
                tile_h_px: tileSize.h,
                grid_height: config.grid_height,
                rect,
                base_font_size_px: config.base_font_size_px,
                ui_scale: uiScale,
            });
            if (vp) {
                const logKey = `${vp.x.toFixed(2)},${vp.y.toFixed(2)},${vp.width.toFixed(2)},${vp.height.toFixed(2)}|${vp.tileW.toFixed(3)},${vp.tileH.toFixed(3)}|${vp.fontSizePx.toFixed(2)}`;
                lastViewportLogKey = logKey;

                painterRef.set_dom_viewport({
                    x: vp.x,
                    y: vp.y,
                    width: vp.width,
                    height: vp.height,
                    tileW: vp.tileW,
                    tileH: vp.tileH,
                    fontSizePx: vp.fontSizePx,
                    offsetX: 0,
                    offsetY: 0
                });
            }
        }

        if (boot_frames_left > 0) boot_frames_left -= 1;
        
        // Render DOM layers with updated viewport
        painterRef.render_dom_layers();
        
        // Render mono_canvas last (on top)
        originalTick();
    };
}

type TextureFilterEls = {
    disp_wobble: HTMLElement;
    disp_texture: HTMLElement;
    noise_wobble: HTMLElement;
    noise_texture: HTMLElement;
};

function get_texture_filter_els(): TextureFilterEls | null {
    const disp_wobble = document.getElementById('uiDispWobble');
    const disp_texture = document.getElementById('uiDispTexture');
    const noise_wobble = document.getElementById('uiNoiseWobble');
    const noise_texture = document.getElementById('uiNoiseTexture');
    if (!disp_wobble || !disp_texture || !noise_wobble || !noise_texture) return null;
    return { disp_wobble, disp_texture, noise_wobble, noise_texture };
}

function update_texture_filter_for_scale(scale: number): void {
    const els = get_texture_filter_els();
    if (!els) return;

    const s = Number.isFinite(scale) ? Math.max(0.25, Math.min(6.0, scale)) : 1.0;
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

    const wobble_scale = clamp(7.5 * s, 5.0, 24.0);
    const texture_scale = clamp(4.0 * s, 2.5, 18.0);
    const wobble_freq = clamp(0.0065 / s, 0.002, 0.02);
    const texture_freq = clamp(0.11 / s, 0.025, 0.22);

    try {
        els.disp_wobble.setAttribute('scale', wobble_scale.toFixed(2));
        els.disp_texture.setAttribute('scale', texture_scale.toFixed(2));
        els.noise_wobble.setAttribute('baseFrequency', wobble_freq.toFixed(4));
        els.noise_texture.setAttribute('baseFrequency', texture_freq.toFixed(4));
    } catch {
        // ignore
    }
}

function update_background_for_scale(scale: number): void {
    const s = clamp_ui_scale(scale);
    try {
        document.documentElement.style.setProperty('--ui-scale', String(s));
    } catch {
        // ignore
    }
}

function update_background_for_pan(pan_x_px: number, pan_y_px: number, tile_w_px: number, tile_h_px: number): void {
    if (!Number.isFinite(pan_x_px) || !Number.isFinite(pan_y_px)) return;
    if (!Number.isFinite(tile_w_px) || !Number.isFinite(tile_h_px)) return;
    try {
        document.documentElement.style.setProperty('--pan-x', `${pan_x_px.toFixed(2)}px`);
        document.documentElement.style.setProperty('--pan-y', `${pan_y_px.toFixed(2)}px`);
        document.documentElement.style.setProperty('--tile-w', `${tile_w_px.toFixed(2)}px`);
        document.documentElement.style.setProperty('--tile-h', `${tile_h_px.toFixed(2)}px`);
    } catch {
        // ignore
    }
}

function load_saved_ui_scale(): number {
    try {
        const raw = window.localStorage.getItem('thaumworld_ui_scale');
        if (!raw) return 1.0;
        const v = Number(raw);
        if (!Number.isFinite(v)) return 1.0;
        return clamp_ui_scale(v);
    } catch {
        return 1.0;
    }
}

async function boot() {
    const saved_scale = load_saved_ui_scale();
    if ((document as any).fonts?.load) {
        try {
            await (document as any).fonts.load(`${config.base_font_size_px * saved_scale}px "${config.font_family}"`);
            await (document as any).fonts.load(`${config.base_font_size_px * saved_scale}px "${get_theme_font_primary_family(THAUMWORLD_RENDER_THEME)}"`);
            await (document as any).fonts.ready;
        } catch {
            // best-effort
        }
    }

    runtime.set_scale(saved_scale);
    apply_responsive_layout(saved_scale);
    update_texture_filter_for_scale(saved_scale);
    update_background_for_scale(saved_scale);

    try {
        window.addEventListener('thaumworld_ui_scale', (ev: any) => {
            const next = Number(ev?.detail?.scale);
            if (!Number.isFinite(next)) return;
            apply_responsive_layout(next);
            update_texture_filter_for_scale(next);
            update_background_for_scale(next);
        });
    } catch {
        // ignore
    }

    // Background pan tracking (game mode only - in painter mode canvas doesn't move)
    if (!IS_PAINTER_MODE) {
        try {
            window.addEventListener('thaumworld_ui_pan', (ev: any) => {
                const pan_x_px = Number(ev?.detail?.pan_x_px);
                const pan_y_px = Number(ev?.detail?.pan_y_px);
                const tile_w_px = Number(ev?.detail?.tile_w_px);
                const tile_h_px = Number(ev?.detail?.tile_h_px);
                update_background_for_pan(pan_x_px, pan_y_px, tile_w_px, tile_h_px);
            });
        } catch {
            // ignore
        }
    }

    try {
        window.addEventListener('resize', () => {
            apply_responsive_layout(runtime.get_scale());
        });
    } catch {
        // ignore
    }

    runtime.start();

    // Texture deformation animation
    const wobble = document.getElementById('uiOffsetWobble');
    const texture = document.getElementById('uiOffsetTexture');
    if (wobble && texture) {
        let ui_scale = saved_scale;
        let wx = 0;
        let wy = 0;
        let tx = 0;
        let ty = 0;

        const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
        const step = (max_step: number) => (Math.random() * 2 - 1) * max_step;

        try {
            window.addEventListener('thaumworld_ui_scale', (ev: any) => {
                const next = Number(ev?.detail?.scale);
                if (Number.isFinite(next)) ui_scale = next;
            });
        } catch {
            // ignore
        }

        setInterval(() => {
            const s = Number.isFinite(ui_scale) ? Math.max(0.25, Math.min(6.0, ui_scale)) : 1.0;
            const wobble_bound = 9 * s;
            const texture_bound = 20 * s;

            wx = clamp(wx + step(0.6 * s), -wobble_bound, wobble_bound);
            wy = clamp(wy + step(1.2 * s), -wobble_bound, wobble_bound);
            tx = clamp(tx + step(1.4 * s), -texture_bound, texture_bound);
            ty = clamp(ty + step(1.4 * s), -texture_bound, texture_bound);

            try {
                wobble.setAttribute('dx', wx.toFixed(2));
                wobble.setAttribute('dy', wy.toFixed(2));
                texture.setAttribute('dx', tx.toFixed(2));
                texture.setAttribute('dy', ty.toFixed(2));
            } catch {
                // ignore
            }
        }, 1000 / 12);
    }
}

void boot();
