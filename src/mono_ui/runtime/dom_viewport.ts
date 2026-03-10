import type { Rect } from "../types.js";

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
  const pan_x_px = Number(opts.pan_x_px);
  const pan_y_px = Number(opts.pan_y_px);
  const tile_w_px = Number(opts.tile_w_px);
  const tile_h_px = Number(opts.tile_h_px);
  const grid_h = Number(opts.grid_height);
  const base_font = Number(opts.base_font_size_px);
  const ui_scale = Number.isFinite(opts.ui_scale) ? opts.ui_scale : 1.0;

  if (!Number.isFinite(pan_x_px) || !Number.isFinite(pan_y_px)) return null;
  if (!Number.isFinite(tile_w_px) || !Number.isFinite(tile_h_px) || tile_w_px <= 0 || tile_h_px <= 0) return null;
  if (!Number.isFinite(grid_h) || grid_h <= 0) return null;
  if (!Number.isFinite(base_font) || base_font <= 0) return null;

  const rect = opts.rect;
  const w_tiles = rect.x1 - rect.x0 + 1;
  const h_tiles = rect.y1 - rect.y0 + 1;
  if (w_tiles <= 0 || h_tiles <= 0) return null;

  // Module rects are bottom-left origin.
  // DOM pixel space is top-left origin.
  const x = pan_x_px + rect.x0 * tile_w_px;
  const y = pan_y_px + (grid_h - 1 - rect.y1) * tile_h_px;

  return {
    x,
    y,
    width: w_tiles * tile_w_px,
    height: h_tiles * tile_h_px,
    tileW: tile_w_px,
    tileH: tile_h_px,
    fontSizePx: base_font * (Number.isFinite(ui_scale) ? ui_scale : 1.0),
  };
}
