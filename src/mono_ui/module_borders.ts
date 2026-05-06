import type { Canvas, Rect, Rgb } from "./types.js";
import { get_ui_semantic_rgb } from './runtime/ui_customization_store.js';

/**
 * Border style configuration
 */
export type BorderStyle = {
  corner_tl: string;  // Top-left corner
  corner_tr: string;  // Top-right corner
  corner_bl: string;  // Bottom-left corner
  corner_br: string;  // Bottom-right corner
  horizontal: string; // Horizontal line
  vertical: string;   // Vertical line
  junction_t: string; // T-junction from top
  junction_b: string; // T-junction from bottom
  junction_l: string; // T-junction from left
  junction_r: string; // T-junction from right
  junction_x: string; // Cross junction
};

/**
 * Predefined border styles
 */
export const BORDER_STYLES = {
  double: {
    corner_tl: "╔",
    corner_tr: "╗",
    corner_bl: "╚",
    corner_br: "╝",
    horizontal: "═",
    vertical: "║",
    junction_t: "╤",
    junction_b: "╧",
    junction_l: "╟",
    junction_r: "╢",
    junction_x: "┼",
  } as BorderStyle,

  single: {
    corner_tl: "┌",
    corner_tr: "┐",
    corner_bl: "└",
    corner_br: "┘",
    horizontal: "─",
    vertical: "│",
    junction_t: "┬",
    junction_b: "┴",
    junction_l: "├",
    junction_r: "┤",
    junction_x: "┼",
  } as BorderStyle,

  thick: {
    corner_tl: "┏",
    corner_tr: "┓",
    corner_bl: "┗",
    corner_br: "┛",
    horizontal: "━",
    vertical: "┃",
    junction_t: "┳",
    junction_b: "┻",
    junction_l: "┣",
    junction_r: "┫",
    junction_x: "╋",
  } as BorderStyle,
};

export const PANEL_BORDER_PRESETS = {
  default_double: {
    style: BORDER_STYLES.thick,
    weight_index: 2,
  },
  compact_double: {
    style: BORDER_STYLES.double,
    weight_index: 1,
  },
  single: {
    style: BORDER_STYLES.single,
    weight_index: 1,
  },
  thick: {
    style: BORDER_STYLES.thick,
    weight_index: 2,
  },
  standard_ux: {
    style: BORDER_STYLES.thick,
    weight_index: 2,
  },
} as const;

export const MODULE_BORDER_RENDER_INDEX = 6;
export const MODULE_CHROME_RENDER_INDEX = 7;

export type StandardUxChromeColors = {
  background_rgb: Rgb;
  border_rgb: Rgb;
  title_rgb: Rgb;
  text_rgb: Rgb;
  accent_rgb: Rgb;
  muted_rgb: Rgb;
};

export function get_standard_ux_chrome_colors(): StandardUxChromeColors {
  return {
    background_rgb: get_ui_semantic_rgb('background'),
    border_rgb: get_ui_semantic_rgb('dimmest'),
    title_rgb: get_ui_semantic_rgb('medium'),
    text_rgb: get_ui_semantic_rgb('bright'),
    accent_rgb: get_ui_semantic_rgb('vivid'),
    muted_rgb: get_ui_semantic_rgb('medium'),
  };
}

export function draw_standard_ux_border(c: Canvas, rect: Rect, overrides?: { border_rgb?: Rgb; weight_index?: number }): void {
  draw_module_border(c, {
    rect,
    style: PANEL_BORDER_PRESETS.standard_ux.style,
    border_rgb: overrides?.border_rgb ?? get_standard_ux_chrome_colors().border_rgb,
    weight_index: overrides?.weight_index ?? PANEL_BORDER_PRESETS.standard_ux.weight_index,
  });
}

/**
 * Configuration for drawing a module border
 */
export type ModuleBorderConfig = {
  rect: Rect;
  style?: BorderStyle;
  border_rgb?: Rgb;
  bg_rgb?: Rgb;
  weight_index?: number;

  // Optional scroll markers (used by text windows).
  markers?: {
    top?: string;
    bottom?: string;
    left?: string;
    right?: string;
    top_x?: number;
    bottom_x?: number;
    left_y?: number;
    right_y?: number;
  };
  
  // Optional header configuration
  header?: {
    text: string;
    text_rgb?: Rgb;
    align?: "left" | "center" | "right";
    // Reserve N columns from the left edge (x0) before header text starts.
    // This is intended for gizmo icons, padding, etc. It does not draw any divider.
    reserve_left_cols?: number;

    // Column index for a divider measured from x0 (e.g., 5 puts divider at x0+5).
    // Back-compat: when set and divider_mode is omitted, defaults to "full_height".
    divider_at_col?: number;
    divider_mode?: 'none' | 'header_only' | 'full_height';
    divider_style?: BorderStyle;
  };
};

export type HorizontalDividerConfig = {
  y: number;
  rect: Rect;
  style?: BorderStyle;
  rgb?: Rgb;
  weight_index?: number;
  inset_left?: number;
  inset_right?: number;
};

export type VerticalDividerConfig = {
  x: number;
  rect: Rect;
  style?: BorderStyle;
  rgb?: Rgb;
  weight_index?: number;
  inset_top?: number;
  inset_bottom?: number;
};

/**
 * Draw a border around a module with optional header
 * 
 * Example usage:
 * ```typescript
 * draw_module_border(c, {
 *   rect: { x0: 0, y0: 0, x1: 39, y1: 29 },
 *   style: BORDER_STYLES.double,
 *   border_rgb: { r: 150, g: 150, b: 150 },
 *   header: {
 *     text: "Gunther",
 *     divider_at_col: 5, // Divider after gizmo area
 *   }
 * });
 * ```
 */
export function draw_module_border(
  c: Canvas,
  config: ModuleBorderConfig
): void {
  const {
    rect,
    style = BORDER_STYLES.double,
    border_rgb = { r: 150, g: 150, b: 150 },
    bg_rgb,
    weight_index = 1,
    header,
    markers,
  } = config;

  const { x0, y0, x1, y1 } = rect;
  const divider_style = header?.divider_style ?? BORDER_STYLES.single;
  const width = x1 - x0;
  const height = y1 - y0;

  // Fill background if specified
  if (bg_rgb) {
    for (let x = x0 + 1; x < x1; x++) {
      for (let y = y0 + 1; y < y1; y++) {
        c.set(x, y, { char: " ", rgb: bg_rgb, style: "regular", weight_index });
      }
    }
  }

  // Draw top border with header
  for (let x = x0; x <= x1; x++) {
    let char = style.horizontal;
    let is_junction = false;

    // Determine character based on position
    if (x === x0) {
      char = style.corner_tl;
    } else if (x === x1) {
      char = style.corner_tr;
    } else if (header?.divider_at_col && x === x0 + header.divider_at_col) {
      const mode = header.divider_mode ?? 'full_height';
      if (mode !== 'none') {
        char = divider_style.junction_t;
        is_junction = true;
      }
    }

    c.set(x, y1, { char, rgb: border_rgb, style: "regular", weight_index, render_index: MODULE_BORDER_RENDER_INDEX });
  }

  // Optional scroll marker overwrites top border.
  if (markers?.top) {
    const cx = typeof markers.top_x === 'number'
      ? Math.max(x0 + 1, Math.min(x1 - 1, markers.top_x))
      : Math.floor((x0 + x1) / 2);
    c.set(cx, y1, {
      char: String(markers.top).charAt(0) || style.horizontal,
      rgb: border_rgb,
      style: 'regular',
      weight_index: Math.min(3, weight_index + 1),
      render_index: MODULE_CHROME_RENDER_INDEX,
    });
  }

  // Draw header text if provided
  if (header) {
    const header_y = y1 - 1; // Top row (inverted Y)
    const text_start = typeof header.reserve_left_cols === 'number'
      ? x0 + header.reserve_left_cols
      : (header.divider_at_col ? x0 + header.divider_at_col + 2 : x0 + 2);
    const text_end = x1 - 1;
    const available_width = text_end - text_start + 1;

    // Truncate text if too long
    let display_text = header.text;
    if (display_text.length > available_width) {
      display_text = display_text.slice(0, available_width - 3) + "...";
    }

    // Center align by default, or use specified alignment
    let start_x = text_start;
    if (header.align === "center") {
      start_x = text_start + Math.floor((available_width - display_text.length) / 2);
    } else if (header.align === "right") {
      start_x = text_end - display_text.length + 1;
    }

    // Draw the text
    const text_rgb = header.text_rgb ?? { r: 200, g: 200, b: 200 };
    for (let i = 0; i < display_text.length; i++) {
      const x = start_x + i;
      const char = display_text[i];
      if (x <= text_end && char) {
        c.set(x, header_y, {
          char,
          rgb: text_rgb,
          style: "regular",
          weight_index,
          render_index: MODULE_CHROME_RENDER_INDEX,
        });
      }
    }

    // Draw vertical divider if specified
    if (header.divider_at_col) {
      const mode = header.divider_mode ?? 'full_height';
      if (mode === 'full_height') {
        const divider_x = x0 + header.divider_at_col;
        // Top junction already drawn above
        // Draw vertical line down
        for (let y = y1 - 2; y >= y0; y--) {
          c.set(divider_x, y, {
            char: divider_style.vertical,
            rgb: border_rgb,
            style: "regular",
            weight_index,
            render_index: MODULE_BORDER_RENDER_INDEX,
          });
        }
        // Bottom junction
        c.set(divider_x, y0, {
          char: divider_style.junction_b,
          rgb: border_rgb,
          style: "regular",
          weight_index,
          render_index: MODULE_BORDER_RENDER_INDEX,
        });
      }
    }
  }

  // Draw bottom border
  for (let x = x0; x <= x1; x++) {
    let char = style.horizontal;
    if (x === x0) {
      char = style.corner_bl;
    } else if (x === x1) {
      char = style.corner_br;
    } else if (header?.divider_at_col && x === x0 + header.divider_at_col) {
      const mode = header.divider_mode ?? 'full_height';
      if (mode === 'full_height') {
        char = divider_style.junction_b;
      }
    }
    c.set(x, y0, { char, rgb: border_rgb, style: "regular", weight_index, render_index: MODULE_BORDER_RENDER_INDEX });
  }

  // Optional scroll marker overwrites bottom border.
  if (markers?.bottom) {
    const cx = typeof markers.bottom_x === 'number'
      ? Math.max(x0 + 1, Math.min(x1 - 1, markers.bottom_x))
      : Math.floor((x0 + x1) / 2);
    c.set(cx, y0, {
      char: String(markers.bottom).charAt(0) || style.horizontal,
      rgb: border_rgb,
      style: 'regular',
      weight_index: Math.min(3, weight_index + 1),
      render_index: MODULE_CHROME_RENDER_INDEX,
    });
  }

  if (markers?.left) {
    const cy = typeof markers.left_y === 'number'
      ? Math.max(y0 + 1, Math.min(y1 - 1, markers.left_y))
      : Math.floor((y0 + y1) / 2);
    c.set(x0, cy, {
      char: String(markers.left).charAt(0) || style.vertical,
      rgb: border_rgb,
      style: 'regular',
      weight_index: Math.min(3, weight_index + 1),
      render_index: MODULE_CHROME_RENDER_INDEX,
    });
  }

  if (markers?.right) {
    const cy = typeof markers.right_y === 'number'
      ? Math.max(y0 + 1, Math.min(y1 - 1, markers.right_y))
      : Math.floor((y0 + y1) / 2);
    c.set(x1, cy, {
      char: String(markers.right).charAt(0) || style.vertical,
      rgb: border_rgb,
      style: 'regular',
      weight_index: Math.min(3, weight_index + 1),
      render_index: MODULE_CHROME_RENDER_INDEX,
    });
  }

  // Draw left and right borders (excluding corners)
  for (let y = y1 - 1; y > y0; y--) {
    c.set(x0, y, { char: style.vertical, rgb: border_rgb, style: "regular", weight_index, render_index: MODULE_BORDER_RENDER_INDEX });
    c.set(x1, y, { char: style.vertical, rgb: border_rgb, style: "regular", weight_index, render_index: MODULE_BORDER_RENDER_INDEX });
  }
}

/**
 * Draw a simple 3x3 container box
 * 
 * Example:
 * ```typescript
 * draw_container_box(c, { x0: 2, y0: 25, x1: 4, y1: 27 }, 'C', { r: 255, g: 200, b: 100 });
 * ```
 */
export function draw_container_box(
  c: Canvas,
  rect: Rect,
  center_char: string | undefined,
  char_rgb: Rgb,
  border_rgb: Rgb = { r: 150, g: 150, b: 150 },
  weight_index: number = 1
): void {
  const { x0, y0, x1, y1 } = rect;

  // Draw box border
  const style = BORDER_STYLES.single;

  // Corners
  c.set(x0, y1, { char: style.corner_tl, rgb: border_rgb, style: "regular", weight_index });
  c.set(x1, y1, { char: style.corner_tr, rgb: border_rgb, style: "regular", weight_index });
  c.set(x0, y0, { char: style.corner_bl, rgb: border_rgb, style: "regular", weight_index });
  c.set(x1, y0, { char: style.corner_br, rgb: border_rgb, style: "regular", weight_index });

  // Horizontal lines
  for (let x = x0 + 1; x < x1; x++) {
    c.set(x, y1, { char: style.horizontal, rgb: border_rgb, style: "regular", weight_index });
    c.set(x, y0, { char: style.horizontal, rgb: border_rgb, style: "regular", weight_index });
  }

  // Vertical lines
  for (let y = y1 - 1; y > y0; y--) {
    c.set(x0, y, { char: style.vertical, rgb: border_rgb, style: "regular", weight_index });
    c.set(x1, y, { char: style.vertical, rgb: border_rgb, style: "regular", weight_index });
  }

  // Center character
  const center_x = Math.floor((x0 + x1) / 2);
  const center_y = Math.floor((y0 + y1) / 2);
  c.set(center_x, center_y, {
    char: center_char || "C",
    rgb: char_rgb,
    style: "regular",
    weight_index: Math.min(3, weight_index + 1),
  });
}

/**
 * Draw a horizontal divider line within a module
 */
export function draw_horizontal_divider(
  c: Canvas,
  y: number,
  x0: number,
  x1: number,
  style: BorderStyle = BORDER_STYLES.double,
  rgb: Rgb = { r: 150, g: 150, b: 150 },
  weight_index: number = 1
): void {
  for (let x = x0; x <= x1; x++) {
    let char = style.horizontal;
    if (x === x0) char = style.junction_l;
    else if (x === x1) char = style.junction_r;
    c.set(x, y, { char, rgb, style: "regular", weight_index, render_index: MODULE_BORDER_RENDER_INDEX });
  }
}

export function draw_panel_horizontal_divider(
  c: Canvas,
  config: HorizontalDividerConfig
): void {
  const {
    y,
    rect,
    style = BORDER_STYLES.double,
    rgb = { r: 150, g: 150, b: 150 },
    weight_index = 1,
    inset_left = 0,
    inset_right = 0,
  } = config;

  const x0 = rect.x0 + inset_left;
  const x1 = rect.x1 - inset_right;
  draw_horizontal_divider(c, y, x0, x1, style, rgb, weight_index);
}

/**
 * Draw a vertical divider line within a module
 */
export function draw_vertical_divider(
  c: Canvas,
  x: number,
  y0: number,
  y1: number,
  style: BorderStyle = BORDER_STYLES.double,
  rgb: Rgb = { r: 150, g: 150, b: 150 },
  weight_index: number = 1
): void {
  for (let y = y1; y >= y0; y--) {
    let char = style.vertical;
    if (y === y1) char = style.junction_t;
    else if (y === y0) char = style.junction_b;
    c.set(x, y, { char, rgb, style: "regular", weight_index, render_index: MODULE_BORDER_RENDER_INDEX });
  }
}

export function draw_panel_vertical_divider(
  c: Canvas,
  config: VerticalDividerConfig
): void {
  const {
    x,
    rect,
    style = BORDER_STYLES.double,
    rgb = { r: 150, g: 150, b: 150 },
    weight_index = 1,
    inset_top = 0,
    inset_bottom = 0,
  } = config;

  const y0 = rect.y0 + inset_bottom;
  const y1 = rect.y1 - inset_top;
  draw_vertical_divider(c, x, y0, y1, style, rgb, weight_index);
}
