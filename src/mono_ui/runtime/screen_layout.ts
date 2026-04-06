import type { Rect } from "../types.js";

export type ScreenLayout = {
  full_rect: Rect;
  content_rect: Rect;
  nav_rect: Rect;
  main_rect: Rect;
  padding_tiles: number;
  nav_height_tiles: number;
  gap_tiles: number;
};

export type ScreenLayoutOptions = {
  padding_tiles?: number;
  nav_height_tiles?: number;
  gap_tiles?: number;
};

function make_rect(x0: number, y0: number, x1: number, y1: number): Rect {
  return { x0, y0, x1, y1 };
}

export function compute_screen_layout(
  grid_width: number,
  grid_height: number,
  opts?: ScreenLayoutOptions,
): ScreenLayout {
  const width = Math.max(1, Math.floor(Number(grid_width) || 1));
  const height = Math.max(1, Math.floor(Number(grid_height) || 1));
  const padding_tiles = Math.max(0, Math.floor(Number(opts?.padding_tiles) || 7));
  const nav_height_tiles = Math.max(1, Math.floor(Number(opts?.nav_height_tiles) || 3));
  const gap_tiles = Math.max(1, Math.floor(Number(opts?.gap_tiles) || 1));

  const full_rect = make_rect(0, 0, width - 1, height - 1);

  const inset_x = Math.min(padding_tiles, Math.max(0, Math.floor((width - 8) / 2)));
  const inset_y = Math.min(padding_tiles, Math.max(0, Math.floor((height - 8) / 2)));
  const content_rect = make_rect(
    inset_x,
    inset_y,
    Math.max(inset_x, width - inset_x - 1),
    Math.max(inset_y, height - inset_y - 1),
  );

  const content_height = content_rect.y1 - content_rect.y0 + 1;
  const nav_height = Math.min(nav_height_tiles, Math.max(1, content_height));
  const nav_rect = make_rect(
    content_rect.x0,
    content_rect.y0,
    content_rect.x1,
    Math.min(content_rect.y1, content_rect.y0 + nav_height - 1),
  );

  const main_y0 = Math.min(content_rect.y1, nav_rect.y1 + gap_tiles + 1);
  const main_rect = make_rect(
    content_rect.x0,
    main_y0,
    content_rect.x1,
    content_rect.y1,
  );

  return {
    full_rect,
    content_rect,
    nav_rect,
    main_rect,
    padding_tiles,
    nav_height_tiles: nav_height,
    gap_tiles,
  };
}
