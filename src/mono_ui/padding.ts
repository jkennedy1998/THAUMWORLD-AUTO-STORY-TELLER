import type { Canvas, Rect, Rgb } from "./types.js";

export type BorderStyle = {
    corner?: string; // default '+'
    h?: string;      // default '-'
    v?: string;      // default '|'
};

export type BorderMarkers = {
    top?: string;    // e.g. '^'
    bottom?: string; // e.g. 'v'
};

export function inner_rect(rect: Rect, pad: number): Rect {
    return {
        x0: rect.x0 + pad,
        y0: rect.y0 + pad,
        x1: rect.x1 - pad,
        y1: rect.y1 - pad,
    };
}

export function draw_border(
    c: Canvas,
    rect: Rect,
    rgb: Rgb,
    weight_index = 3,
    style: BorderStyle = {},
    markers: BorderMarkers = {},
): Rect {
    const corner = style.corner ?? "+";
    const h = style.h ?? "-";
    const v = style.v ?? "|";

    // top/bottom
    for (let x = rect.x0; x <= rect.x1; x++) {
        c.set(x, rect.y1, { char: h, rgb, style: "regular", weight_index });
        c.set(x, rect.y0, { char: h, rgb, style: "regular", weight_index });
    }

    // left/right
    for (let y = rect.y0; y <= rect.y1; y++) {
        c.set(rect.x0, y, { char: v, rgb, style: "regular", weight_index });
        c.set(rect.x1, y, { char: v, rgb, style: "regular", weight_index });
    }

    // corners
    c.set(rect.x0, rect.y0, { char: corner, rgb, style: "regular", weight_index });
    c.set(rect.x1, rect.y0, { char: corner, rgb, style: "regular", weight_index });
    c.set(rect.x0, rect.y1, { char: corner, rgb, style: "regular", weight_index });
    c.set(rect.x1, rect.y1, { char: corner, rgb, style: "regular", weight_index });

    // markers overwrite border if present
    const cx = Math.floor((rect.x0 + rect.x1) / 2);
    if (markers.top) c.set(cx, rect.y1, { char: markers.top, rgb, style: "regular", weight_index: Math.min(7, weight_index + 2) });
    if (markers.bottom) c.set(cx, rect.y0, { char: markers.bottom, rgb, style: "regular", weight_index: Math.min(7, weight_index + 2) });

    return inner_rect(rect, 1);
}
