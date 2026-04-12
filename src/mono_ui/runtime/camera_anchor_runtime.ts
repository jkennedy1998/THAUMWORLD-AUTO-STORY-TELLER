export type CameraAnchorKind = 'pointer' | 'text_cursor' | 'selection' | 'manual' | 'viewport_center' | 'none';

export type CameraAnchor = {
  kind: CameraAnchorKind;
  screen?: { x: number; y: number } | null;
  world?: { x: number; y: number; z: number } | null;
};

export type CameraAnchorViewportRect = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export function clamp_anchor_to_viewport_px(anchor: { x: number; y: number } | null | undefined, viewport: { width: number; height: number }): { x: number; y: number } {
  const fallback = { x: viewport.width / 2, y: viewport.height / 2 };
  if (!anchor) return fallback;
  return {
    x: Number.isFinite(anchor.x) ? Math.max(0, Math.min(viewport.width, anchor.x)) : fallback.x,
    y: Number.isFinite(anchor.y) ? Math.max(0, Math.min(viewport.height, anchor.y)) : fallback.y,
  };
}

export function compute_anchor_relative_mouse_parallax(opts: {
  viewport: CameraAnchorViewportRect;
  anchor_screen_x: number;
  anchor_screen_y: number;
  pointer_x: number;
  pointer_y: number;
}): { x: number; y: number } {
  const viewport = opts.viewport;
  const max_dx = (viewport.x1 - viewport.x0) / 2;
  const max_dy = (viewport.y1 - viewport.y0) / 2;
  const px = Math.max(viewport.x0, Math.min(viewport.x1, opts.pointer_x));
  const py = Math.max(viewport.y0, Math.min(viewport.y1, opts.pointer_y));
  const ox = max_dx > 0 ? (px - opts.anchor_screen_x) / max_dx : 0;
  const oy = max_dy > 0 ? (py - opts.anchor_screen_y) / max_dy : 0;
  return {
    x: Math.max(-1, Math.min(1, ox)),
    y: Math.max(-1, Math.min(1, oy)),
  };
}
