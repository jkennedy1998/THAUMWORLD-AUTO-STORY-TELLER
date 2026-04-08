import { THAUMWORLD_RENDER_THEME, resolve_render_backend, type RenderBackendKind } from './render_theme.js';
import { clamp_weight_index } from '../weight_system.js';
import { get_cached_resolved_atlas_frame, load_resolved_atlas_frame } from './atlas_runtime.js';
import type { InlineMaterialAssignments, RenderGraphicRef } from '../../render_shaders/graphics_contract.js';

type RenderableCell = {
  char: string;
  rgb: { r: number; g: number; b: number };
  weight_index?: number;
  graphic?: RenderGraphicRef;
  materials?: InlineMaterialAssignments;
  light_mag?: number;
};

type DrawCellOpts = {
  ctx: CanvasRenderingContext2D;
  cell: RenderableCell;
  center_x_px: number;
  center_y_px: number;
  cell_w_px: number;
  cell_h_px: number;
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
const pending_atlas_loads = new Set<string>();
let loggedAtlasBackend = false;
const loggedAtlasGraphics = new Set<string>();

function draw_font_cell(opts: DrawCellOpts): void {
  const weight_index = clamp_weight_index(opts.cell.weight_index);
  const css_weight = opts.weight_index_to_css[weight_index] ?? 400;
  opts.ctx.font = `${css_weight} ${opts.font_size_px}px ${opts.font_family}`;
  opts.ctx.fillStyle = `rgb(${opts.cell.rgb.r},${opts.cell.rgb.g},${opts.cell.rgb.b})`;
  opts.ctx.fillText(opts.cell.char, opts.center_x_px, opts.center_y_px);
}

function draw_atlas_cell(opts: DrawCellOpts): boolean {
  const graphic = opts.cell.graphic;
  if (!graphic || graphic.graphic_id.startsWith('text_')) return false;
  if (!loggedAtlasGraphics.has(graphic.graphic_id)) {
    loggedAtlasGraphics.add(graphic.graphic_id);
    console.log('[atlas debug] draw_atlas_cell attempt', {
      graphic_id: graphic.graphic_id,
      view_direction: graphic.view_direction,
      weight_index: graphic.weight_index,
      materials: opts.cell.materials ?? {},
    });
  }
  const materials = opts.cell.materials ?? {};
  const cached = get_cached_resolved_atlas_frame(graphic, materials, opts.cell.light_mag);
  if (cached) {
    opts.ctx.imageSmoothingEnabled = false;
    opts.ctx.drawImage(
      cached.image,
      Math.round(opts.center_x_px - (opts.cell_w_px / 2)),
      Math.round(opts.center_y_px - (opts.cell_h_px / 2)),
      opts.cell_w_px,
      opts.cell_h_px,
    );
    return true;
  }
  const key = JSON.stringify([graphic.graphic_id, graphic.weight_index, graphic.view_direction, graphic.facing, materials, opts.cell.light_mag ?? null]);
  if (!pending_atlas_loads.has(key)) {
    pending_atlas_loads.add(key);
    void load_resolved_atlas_frame(graphic, materials, opts.cell.light_mag).finally(() => {
      pending_atlas_loads.delete(key);
    });
  }
  return false;
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
      if (!loggedAtlasBackend) {
        loggedAtlasBackend = true;
        console.log('[atlas debug] cell renderer backend', {
          requested_backend: opts.backend,
          effective_backend: resolved.effective_backend,
          theme_id: opts.theme_id,
        });
      }
      switch (resolved.effective_backend) {
        case 'atlas':
          if (draw_atlas_cell(opts2)) return;
          draw_font_cell(opts2);
          return;
        case 'font':
        default:
          draw_font_cell(opts2);
      }
    },
  };
}
