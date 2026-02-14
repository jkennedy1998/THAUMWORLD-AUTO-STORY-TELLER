import { CanvasRuntime } from '../mono_ui/runtime/canvas_runtime.js';
import { APP_CONFIG, create_app_state } from './app_state.js';

const el = document.getElementById('mono_canvas') as HTMLCanvasElement | null;
if (!el) throw new Error('mono_canvas element not found');

const { modules, start_window_feed_polling } = create_app_state();

const runtime = new CanvasRuntime({
    canvas: el,
    grid_width: APP_CONFIG.grid_width,
    grid_height: APP_CONFIG.grid_height,
    font_family: APP_CONFIG.font_family,
    base_font_size_px: APP_CONFIG.base_font_size_px,
    base_line_height_mult: APP_CONFIG.base_line_height_mult,
    base_letter_spacing_mult: APP_CONFIG.base_letter_spacing_mult,
    weight_index_to_css: APP_CONFIG.weight_index_to_css,
    modules,
});

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

    // Keep deformation readable at larger UI scales by scaling amplitude up
    // while scaling frequencies down (larger kernels).
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
    // Ensure the font is loaded before the first `resize_to_grid()`.
    // Otherwise we measure fallback glyph widths and the grid geometry is wrong.
    const saved_scale = load_saved_ui_scale();
    if ((document as any).fonts?.load) {
        try {
            await (document as any).fonts.load(`${APP_CONFIG.base_font_size_px * saved_scale}px "${APP_CONFIG.font_family}"`);
            await (document as any).fonts.ready;
        } catch {
            // best-effort
        }
    }

    runtime.set_scale(saved_scale);
    update_texture_filter_for_scale(saved_scale);
    update_background_for_scale(saved_scale);

    // When UI scale changes (hotkeys), keep the SVG deformation tuned.
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

    // Keep the background dot grid locked to the canvas.
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

    start_window_feed_polling(1000);
    runtime.start();

    // Texture deformation animation (12fps feel).
    // NOTE: do NOT change turbulence seeds per-frame (reads like static).
    // Instead, keep seeds stable and animate the noise field via offset.
    const wobble = document.getElementById('uiOffsetWobble');
    const texture = document.getElementById('uiOffsetTexture');
    if (wobble && texture) {
        let ui_scale = saved_scale;
        let wx = 0;
        let wy = 0;
        let tx = 0;
        let ty = 0;

        // Bounded random-walk -> "paper breathing" rather than drifting forever.
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

            // Wobble: gentle, mostly vertical.
            wx = clamp(wx + step(0.6 * s), -wobble_bound, wobble_bound);
            wy = clamp(wy + step(1.2 * s), -wobble_bound, wobble_bound);

            // Texture: slightly more active.
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
