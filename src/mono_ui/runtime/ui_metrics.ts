import { THAUMWORLD_RENDER_THEME, type CellContract } from './render_theme.js';

export const UI_BASE_CELL_WIDTH_PX = THAUMWORLD_RENDER_THEME.cell.width_px;
export const UI_BASE_CELL_HEIGHT_PX = THAUMWORLD_RENDER_THEME.cell.height_px;

export type UiCellMetrics = {
  scale: number;
  cell_w_px: number;
  cell_h_px: number;
  font_size_px: number;
};

export type ScreenRectPx = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function clamp_ui_scale(scale: number): number {
  if (!Number.isFinite(scale)) return 1.0;
  return Math.max(0.25, Math.min(6.0, scale));
}

export function get_scaled_cell_contract(scale: number, cell: CellContract = THAUMWORLD_RENDER_THEME.cell): { cell_w_px: number; cell_h_px: number; scale: number } {
  const s = clamp_ui_scale(scale);
  return {
    scale: s,
    cell_w_px: cell.width_px * s,
    cell_h_px: cell.height_px * s,
  };
}

export function get_ui_cell_metrics(scale: number, base_font_size_px: number): UiCellMetrics {
  const scaled = get_scaled_cell_contract(scale);
  const base_font = Number.isFinite(base_font_size_px) && base_font_size_px > 0
    ? base_font_size_px
    : UI_BASE_CELL_HEIGHT_PX;
  return {
    scale: scaled.scale,
    cell_w_px: scaled.cell_w_px,
    cell_h_px: scaled.cell_h_px,
    font_size_px: base_font * scaled.scale,
  };
}

export function compute_responsive_grid_size(viewport_w_px: number, viewport_h_px: number, scale: number): { width: number; height: number } | null {
  if (!Number.isFinite(viewport_w_px) || viewport_w_px <= 0) return null;
  if (!Number.isFinite(viewport_h_px) || viewport_h_px <= 0) return null;
  const metrics = get_ui_cell_metrics(scale, UI_BASE_CELL_HEIGHT_PX);
  return {
    width: Math.max(1, Math.floor(viewport_w_px / metrics.cell_w_px)),
    height: Math.max(1, Math.floor(viewport_h_px / metrics.cell_h_px)),
  };
}

export function grid_rect_to_screen_rect(opts: {
  pan_x_px: number;
  pan_y_px: number;
  grid_height: number;
  rect: { x0: number; y0: number; x1: number; y1: number };
  cell_w_px: number;
  cell_h_px: number;
}): ScreenRectPx | null {
  const pan_x_px = Number(opts.pan_x_px);
  const pan_y_px = Number(opts.pan_y_px);
  const cell_w_px = Number(opts.cell_w_px);
  const cell_h_px = Number(opts.cell_h_px);
  const grid_h = Number(opts.grid_height);
  if (!Number.isFinite(pan_x_px) || !Number.isFinite(pan_y_px)) return null;
  if (!Number.isFinite(cell_w_px) || cell_w_px <= 0 || !Number.isFinite(cell_h_px) || cell_h_px <= 0) return null;
  if (!Number.isFinite(grid_h) || grid_h <= 0) return null;

  const rect = opts.rect;
  const w_tiles = rect.x1 - rect.x0 + 1;
  const h_tiles = rect.y1 - rect.y0 + 1;
  if (w_tiles <= 0 || h_tiles <= 0) return null;

  return {
    x: pan_x_px + rect.x0 * cell_w_px,
    y: pan_y_px + (grid_h - 1 - rect.y1) * cell_h_px,
    width: w_tiles * cell_w_px,
    height: h_tiles * cell_h_px,
  };
}

export function screen_px_to_grid_cell(opts: {
  client_x_px: number;
  client_y_px: number;
  rect_left_px: number;
  rect_top_px: number;
  grid_width: number;
  grid_height: number;
  cell_w_px: number;
  cell_h_px: number;
}): { x: number; y: number } | null {
  const cell_w_px = Number(opts.cell_w_px);
  const cell_h_px = Number(opts.cell_h_px);
  if (!Number.isFinite(cell_w_px) || cell_w_px <= 0 || !Number.isFinite(cell_h_px) || cell_h_px <= 0) return null;

  const mx = Number(opts.client_x_px) - Number(opts.rect_left_px);
  const my = Number(opts.client_y_px) - Number(opts.rect_top_px);
  if (!Number.isFinite(mx) || !Number.isFinite(my)) return null;

  const x = Math.floor(mx / cell_w_px);
  const y_canvas = Math.floor(my / cell_h_px);
  const y = Number(opts.grid_height) - 1 - y_canvas;
  const grid_width = Number(opts.grid_width);
  const grid_height = Number(opts.grid_height);
  if (x < 0 || x >= grid_width || y < 0 || y >= grid_height) return null;
  return { x, y };
}
