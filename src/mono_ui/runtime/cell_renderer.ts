import { THAUMWORLD_RENDER_THEME, resolve_render_backend, type RenderBackendKind } from './render_theme.js';
import { clamp_weight_index } from '../weight_system.js';
import { get_cached_resolved_atlas_frame, load_resolved_atlas_frame } from './atlas_runtime.js';
import type { AppearanceSlotAssignments, InlineMaterialAssignments, RenderGraphicRef } from '../../render_shaders/graphics_contract.js';
import { resolve_primary_cell_rgb } from './appearance_resolver.js';
import { diag_log } from '../../shared/diagnostics.js';

type RenderableCell = {
  char: string;
  rgb: { r: number; g: number; b: number };
  weight_index?: number;
  graphic?: RenderGraphicRef;
  appearance_slots?: AppearanceSlotAssignments;
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

type AtlasDrawResult = 'drawn' | 'pending' | 'not_applicable';

type FontDrawStateCache = {
  ctx: CanvasRenderingContext2D | null;
  font: string;
  fill_style: string;
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
const loggedAtlasOutcomes = new Set<string>();

function resolve_font_cell_rgb(cell: RenderableCell): { r: number; g: number; b: number } {
  return resolve_primary_cell_rgb({
    rgb: cell.rgb,
    appearance_slots: cell.appearance_slots,
    materials: cell.materials,
    light_mag: cell.light_mag,
    slot: 1,
    semantic_value: '2nd_lightest',
    rgb_policy: 'preserve',
  });
}

function draw_font_cell(opts: DrawCellOpts, cache?: FontDrawStateCache): void {
  const weight_index = clamp_weight_index(opts.cell.weight_index);
  const css_weight = opts.weight_index_to_css[weight_index] ?? 400;
  const next_font = `${css_weight} ${opts.font_size_px}px ${opts.font_family}`;
  const resolved_rgb = resolve_font_cell_rgb(opts.cell);
  const next_fill_style = `rgb(${resolved_rgb.r},${resolved_rgb.g},${resolved_rgb.b})`;
  if (!cache || cache.ctx !== opts.ctx) {
    opts.ctx.font = next_font;
    opts.ctx.fillStyle = next_fill_style;
    if (cache) {
      cache.ctx = opts.ctx;
      cache.font = next_font;
      cache.fill_style = next_fill_style;
    }
  } else {
    if (cache.font !== next_font) {
      opts.ctx.font = next_font;
      cache.font = next_font;
    }
    if (cache.fill_style !== next_fill_style) {
      opts.ctx.fillStyle = next_fill_style;
      cache.fill_style = next_fill_style;
    }
  }
  opts.ctx.fillText(opts.cell.char, opts.center_x_px, opts.center_y_px);
}

function draw_atlas_cell(opts: DrawCellOpts): AtlasDrawResult {
  const graphic = opts.cell.graphic;
  if (!graphic || graphic.graphic_id.startsWith('text_')) return 'not_applicable';
  if (!loggedAtlasGraphics.has(graphic.graphic_id)) {
    loggedAtlasGraphics.add(graphic.graphic_id);
    diag_log('renderer', 'trace', 'ATLAS_DEBUG', 'draw atlas cell attempt', {
      graphic_id: graphic.graphic_id,
      view_direction: graphic.view_direction,
      weight_index: graphic.weight_index,
      appearance_slots: opts.cell.appearance_slots ?? {},
      materials: opts.cell.materials ?? {},
    });
  }
  const materials = opts.cell.materials ?? {};
  const appearance_slots = opts.cell.appearance_slots;
  const cached = get_cached_resolved_atlas_frame(graphic, materials, appearance_slots, opts.cell.light_mag);
  if (cached) {
    const drawnKey = `drawn:${graphic.graphic_id}`;
    if (!loggedAtlasOutcomes.has(drawnKey)) {
      loggedAtlasOutcomes.add(drawnKey);
      console.log('[ATLAS_DRAW_DEBUG] atlas frame drawn ' + JSON.stringify({
        graphic_id: graphic.graphic_id,
        view_direction: graphic.view_direction,
        weight_index: graphic.weight_index,
      }));
    }
    opts.ctx.imageSmoothingEnabled = false;
    opts.ctx.drawImage(
      cached.image,
      Math.round(opts.center_x_px - (opts.cell_w_px / 2)),
      Math.round(opts.center_y_px - (opts.cell_h_px / 2)),
      opts.cell_w_px,
      opts.cell_h_px,
    );
    return 'drawn';
  }
  const key = JSON.stringify([graphic.graphic_id, graphic.weight_index, graphic.view_direction, graphic.facing, materials, appearance_slots ?? null, opts.cell.light_mag ?? null]);
  if (!pending_atlas_loads.has(key)) {
    const pendingKey = `pending:${graphic.graphic_id}`;
    if (!loggedAtlasOutcomes.has(pendingKey)) {
      loggedAtlasOutcomes.add(pendingKey);
      console.log('[ATLAS_DRAW_DEBUG] atlas frame pending ' + JSON.stringify({
        graphic_id: graphic.graphic_id,
        view_direction: graphic.view_direction,
        weight_index: graphic.weight_index,
        appearance_slots: appearance_slots ?? null,
        materials,
        light_mag: opts.cell.light_mag ?? null,
      }));
    }
    pending_atlas_loads.add(key);
    void load_resolved_atlas_frame(graphic, materials, appearance_slots, opts.cell.light_mag).finally(() => {
      pending_atlas_loads.delete(key);
      try {
        window.dispatchEvent(new CustomEvent('thaumworld_atlas_frame_ready', {
          detail: {
            graphic_id: graphic.graphic_id,
            view_direction: graphic.view_direction,
          },
        }));
      } catch {
        // ignore
      }
    });
  }
  return 'pending';
}

export function create_canvas_cell_renderer(opts: {
  backend: RenderBackendKind;
  theme_id: string;
}): CanvasCellRenderer {
  const resolved = resolve_render_backend(THAUMWORLD_RENDER_THEME, opts.backend);
  const font_draw_state_cache: FontDrawStateCache = {
    ctx: null,
    font: '',
    fill_style: '',
  };
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
        diag_log('renderer', 'important', 'ATLAS_DEBUG', 'cell renderer backend', {
          requested_backend: opts.backend,
          effective_backend: resolved.effective_backend,
          theme_id: opts.theme_id,
        });
      }
      switch (resolved.effective_backend) {
        case 'atlas':
          {
            const atlas_result = draw_atlas_cell(opts2);
            if (atlas_result === 'drawn') return;
            if (opts2.cell.graphic) {
              const key = `${resolved.effective_backend}:${atlas_result}:${opts2.cell.graphic.graphic_id}`;
              if (!loggedAtlasOutcomes.has(key)) {
                loggedAtlasOutcomes.add(key);
                console.log('[ATLAS_DRAW_DEBUG] atlas draw result ' + JSON.stringify({
                  requested_backend: opts.backend,
                  effective_backend: resolved.effective_backend,
                  result: atlas_result,
                  graphic_id: opts2.cell.graphic.graphic_id,
                  char: opts2.cell.char,
                }));
              }
            }
          }
          draw_font_cell(opts2, font_draw_state_cache);
          return;
        case 'font':
        default:
          if (opts2.cell.graphic) {
            const key = `font_fallback:${opts2.cell.graphic.graphic_id}`;
            if (!loggedAtlasOutcomes.has(key)) {
              loggedAtlasOutcomes.add(key);
              console.log('[ATLAS_DRAW_DEBUG] graphic cell reached font renderer ' + JSON.stringify({
                requested_backend: opts.backend,
                effective_backend: resolved.effective_backend,
                graphic_id: opts2.cell.graphic.graphic_id,
                char: opts2.cell.char,
              }));
            }
          }
          draw_font_cell(opts2, font_draw_state_cache);
      }
    },
  };
}
