import { CanvasRuntime } from '../mono_ui/runtime/canvas_runtime.js';
import type { Module } from '../mono_ui/types.js';
import { APP_CONFIG, create_app_state } from './app_state.js';
import { PAINTER_CONFIG, create_painter_app_state } from './painter_app_state.js';

// Detect if we're in painter mode (set by preload script before page loads)
const IS_PAINTER_MODE = (window as any).electronAPI?.appMode === 'ascii_painter';

const el = document.getElementById('mono_canvas') as HTMLCanvasElement | null;
if (!el) throw new Error('mono_canvas element not found');

let modules: readonly Module[];
let start_window_feed_polling: (interval_ms: number) => void;
let module_registry: any;
let on_drag_end_outside: ((x: number, y: number) => void) | undefined;

if (IS_PAINTER_MODE) {
    // PAINTER MODE
    console.log('🎨 Initializing ASCII Painter...');
    const painter_state = create_painter_app_state();
    modules = painter_state.modules;
    module_registry = painter_state.module_registry;
    start_window_feed_polling = () => {}; // No polling needed for painter
    on_drag_end_outside = undefined;
    
    // Expose painter API globally
    (window as any).painter = {
        export: painter_state.export_grid,
        import: painter_state.import_grid,
        clear: painter_state.clear_canvas,
        save: painter_state.save_to_file,
        load: painter_state.load_from_file,
        new_canvas: painter_state.new_canvas,
        export_text: painter_state.export_as_text,
        filename: () => painter_state.current_filename
    };
} else {
    // GAME MODE
    console.log('🎮 Initializing Game...');
    const game_state = create_app_state();
    modules = game_state.modules;
    start_window_feed_polling = game_state.start_window_feed_polling;
    module_registry = game_state.module_registry;
    on_drag_end_outside = game_state.on_drag_end_outside;
}

const config = IS_PAINTER_MODE ? PAINTER_CONFIG : APP_CONFIG;

const runtime = new CanvasRuntime({
    canvas: el,
    grid_width: config.grid_width,
    grid_height: config.grid_height,
    font_family: config.font_family,
    base_font_size_px: config.base_font_size_px,
    base_line_height_mult: config.base_line_height_mult,
    base_letter_spacing_mult: config.base_letter_spacing_mult,
    weight_index_to_css: config.weight_index_to_css,
    modules,
    on_drag_end_outside,
});

// Subscribe to module registry changes
if (module_registry) {
    module_registry.subscribe(() => {
        runtime.set_modules(module_registry.get_all());
    });
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
    const s = Number.isFinite(scale) ? Math.max(0.25, Math.min(6.0, scale)) : 1.0;
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
        return Math.max(0.5, Math.min(3.0, v));
    } catch {
        return 1.0;
    }
}

async function boot() {
    const saved_scale = load_saved_ui_scale();
    if ((document as any).fonts?.load) {
        try {
            await (document as any).fonts.load(`${config.base_font_size_px * saved_scale}px "${config.font_family}"`);
            await (document as any).fonts.ready;
        } catch {
            // best-effort
        }
    }

    runtime.set_scale(saved_scale);
    update_texture_filter_for_scale(saved_scale);
    update_background_for_scale(saved_scale);

    try {
        window.addEventListener('thaumworld_ui_scale', (ev: any) => {
            const next = Number(ev?.detail?.scale);
            if (!Number.isFinite(next)) return;
            update_texture_filter_for_scale(next);
            update_background_for_scale(next);
        });
    } catch {
        // ignore
    }

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

    if (!IS_PAINTER_MODE) {
        start_window_feed_polling(1000);
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
