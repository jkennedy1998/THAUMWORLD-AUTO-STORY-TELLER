import type { Rect } from "../types.js";
import { get_ui_cell_metrics, grid_rect_to_screen_rect } from "./ui_metrics.js";

export type DomViewportOpts = {
  // Global CSS pan applied to the mono canvas element.
  pan_x_px: number;
  pan_y_px: number;

  // Tile metrics in CSS pixels.
  tile_w_px: number;
  tile_h_px: number;

  // UI grid height (in tiles), used to flip bottom-left module rects to DOM top-left.
  grid_height: number;

  // Module rect in tile units (bottom-left origin).
  rect: Rect;

  base_font_size_px: number;
  ui_scale: number;
};

export type DomViewport = {
  x: number;
  y: number;
  width: number;
  height: number;
  tileW: number;
  tileH: number;
  fontSizePx: number;
};

export function compute_dom_viewport_for_rect(opts: DomViewportOpts): DomViewport | null {
  const base_font = Number(opts.base_font_size_px);
  const ui_scale = Number.isFinite(opts.ui_scale) ? opts.ui_scale : 1.0;
  if (!Number.isFinite(base_font) || base_font <= 0) return null;

  const metrics = get_ui_cell_metrics(ui_scale, base_font);
  const tile_w_px = Number(opts.tile_w_px);
  const tile_h_px = Number(opts.tile_h_px);
  const rect_px = grid_rect_to_screen_rect({
    pan_x_px: opts.pan_x_px,
    pan_y_px: opts.pan_y_px,
    grid_height: opts.grid_height,
    rect: opts.rect,
    cell_w_px: Number.isFinite(tile_w_px) && tile_w_px > 0 ? tile_w_px : metrics.cell_w_px,
    cell_h_px: Number.isFinite(tile_h_px) && tile_h_px > 0 ? tile_h_px : metrics.cell_h_px,
  });
  if (!rect_px) return null;

  return {
    x: rect_px.x,
    y: rect_px.y,
    width: rect_px.width,
    height: rect_px.height,
    tileW: rect_px.width / (opts.rect.x1 - opts.rect.x0 + 1),
    tileH: rect_px.height / (opts.rect.y1 - opts.rect.y0 + 1),
    fontSizePx: metrics.font_size_px,
  };
}
