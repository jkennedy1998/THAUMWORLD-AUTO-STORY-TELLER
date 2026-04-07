import { THAUMWORLD_RENDER_THEME, resolve_render_backend, type RenderBackendKind } from './render_theme.js';
import { clamp_weight_index } from '../weight_system.js';

type RenderableCell = {
  char: string;
  rgb: { r: number; g: number; b: number };
  weight_index?: number;
};

type DrawCellOpts = {
  ctx: CanvasRenderingContext2D;
  cell: RenderableCell;
  center_x_px: number;
  center_y_px: number;
  font_family: string;
  font_size_px: number;
  weight_index_to_css: readonly number[];
};

export type CanvasCellRenderer = {
  backend: RenderBackendKind;
  effective_backend: RenderBackendKind;
  draw_cell: (opts: DrawCellOpts) => void;
};

const warned_fallbacks = new Set<string>();

function draw_font_cell(opts: DrawCellOpts): void {
  const weight_index = clamp_weight_index(opts.cell.weight_index);
  const css_weight = opts.weight_index_to_css[weight_index] ?? 400;
  opts.ctx.font = `${css_weight} ${opts.font_size_px}px ${opts.font_family}`;
  opts.ctx.fillStyle = `rgb(${opts.cell.rgb.r},${opts.cell.rgb.g},${opts.cell.rgb.b})`;
  opts.ctx.fillText(opts.cell.char, opts.center_x_px, opts.center_y_px);
}

export function create_canvas_cell_renderer(opts: {
  backend: RenderBackendKind;
  theme_id: string;
}): CanvasCellRenderer {
  const resolved = resolve_render_backend(THAUMWORLD_RENDER_THEME, opts.backend);
  if (resolved.fallback_reason) {
    const key = `${opts.theme_id}:${opts.backend}:${resolved.effective_backend}`;
    if (!warned_fallbacks.has(key)) {
      warned_fallbacks.add(key);
      console.warn(`[render_backend] ${opts.backend} requested for ${opts.theme_id}; using ${resolved.effective_backend} because ${resolved.fallback_reason}`);
    }
  }

  return {
    backend: opts.backend,
    effective_backend: resolved.effective_backend,
    draw_cell(opts2: DrawCellOpts): void {
      switch (resolved.effective_backend) {
        case 'atlas':
          draw_font_cell(opts2);
          return;
        case 'font':
        default:
          draw_font_cell(opts2);
      }
    },
  };
}
