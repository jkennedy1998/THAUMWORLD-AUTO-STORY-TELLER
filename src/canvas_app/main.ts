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

// boot
start_window_feed_polling(1000);
runtime.start();

// TEMP: change scale with keys (0.5, 1, 1.5, 2)
window.addEventListener('keydown', (ev) => {
    if (ev.key === '1') runtime.set_scale(0.5);
    if (ev.key === '2') runtime.set_scale(1.0);
    if (ev.key === '3') runtime.set_scale(1.5);
    if (ev.key === '4') runtime.set_scale(2.0);
});
