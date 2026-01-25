import type { Canvas, Module, Rect, Rgb, WheelEvent } from "../types.js";
import { rect_width, rect_height } from "../types.js";
import { draw_border } from "../padding.js";

export type TextWindowSource = {
    messages: string[];
    rev: number; // increment when messages change
};

export type TextWindowOptions = {
    id: string;
    rect: Rect;

    // truth comes from outside; module stores only derived layout + view state
    get_source: () => TextWindowSource;

    // styling
    text_rgb?: Rgb;
    border_rgb?: Rgb;
    bg?: { char: string; rgb: Rgb };
    base_weight_index?: number; // 0..7
};

function clamp(n: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, n));
}
type BorderMarkers = {
    top?: string;
    bottom?: string;
    left?: string;
    right?: string;
};

function wrap_messages(messages: string[], width: number): string[] {
    const lines: string[] = [];
    if (width <= 0) return lines;

    const push_blank_between = true;

    // Codepoint helpers (better than naive string slicing; still not full grapheme-cluster safe)
    const to_cp = (s: string) => Array.from(s);
    const cp_len = (s: string) => to_cp(s).length;
    const cp_slice = (s: string, start: number, end?: number) => to_cp(s).slice(start, end).join("");

    const push_wrapped_paragraph = (paragraph: string) => {
        // Preserve truly empty lines
        if (paragraph.length === 0) {
            lines.push("");
            return;
        }

        // Collapse internal whitespace within a paragraph (but we already preserved newlines by splitting)
        const words = paragraph.split(/\s+/).filter(w => w.length > 0);

        let line = "";

        const flush_line = () => {
            lines.push(line);
            line = "";
        };

        const add_word = (w: string) => {
            const wlen = cp_len(w);

            // long word hyphenation by codepoints
            if (wlen > width) {
                if (line.length > 0) flush_line();

                let rest = w;
                while (cp_len(rest) > width) {
                    const take = Math.max(1, width - 1);
                    lines.push(cp_slice(rest, 0, take) + "-");
                    rest = cp_slice(rest, take);
                }
                line = rest;
                return;
            }

            if (line.length === 0) {
                line = w;
                return;
            }

            // +1 for space
            const next_len = cp_len(line) + 1 + wlen;
            if (next_len <= width) {
                line = line + " " + w;
            } else {
                flush_line();
                line = w;
            }
        };

        for (const w of words) add_word(w);

        if (words.length === 0) {
            lines.push("");
        } else if (line.length > 0) {
            lines.push(line);
        }
    };

    for (let mi = 0; mi < messages.length; mi++) {
        const msg = messages[mi] ?? "";

        // Preserve user newlines: wrap each paragraph independently.
        const paragraphs = msg.split("\n");

        for (let pi = 0; pi < paragraphs.length; pi++) {
            push_wrapped_paragraph(paragraphs[pi] ?? "");
        }

        if (push_blank_between && mi !== messages.length - 1) {
            lines.push("");
        }
    }

    return lines;
}


export function make_text_window_module(opts: TextWindowOptions): Module {

    let scroll_y = 0;

    // derived layout cache
    let cached_rev = -1;
    let cached_width = -1;
    let cached_lines: string[] = [];

    function base_weight(): number {
        const w = opts.base_weight_index ?? 3;
        return clamp((w | 0), 0, 7);
    }

    function ensure_layout(text_w: number) {
        const src = opts.get_source();
        if (src.rev === cached_rev && text_w === cached_width) return;

        const text_h = rect_height(inner_text_rect());
        const prev_max_scroll = Math.max(0, cached_lines.length - text_h);
        const was_at_bottom = cached_rev === -1 ? true : (scroll_y >= prev_max_scroll);

        cached_rev = src.rev;
        cached_width = text_w;
        cached_lines = wrap_messages(src.messages, text_w);

        // clamp scroll when content changes; keep bottom lock if already at bottom
        const max_scroll = Math.max(0, cached_lines.length - text_h);
        scroll_y = was_at_bottom ? max_scroll : clamp(scroll_y, 0, max_scroll);
    }

    function inner_text_rect(): Rect {
        // 1-char border/padding on all sides
        return { x0: opts.rect.x0 + 1, y0: opts.rect.y0 + 1, x1: opts.rect.x1 - 1, y1: opts.rect.y1 - 1 };
    }

    function scroll_by(dy_lines: number) {
        const text_r = inner_text_rect();
        const text_h = rect_height(text_r);
        const max_scroll = Math.max(0, cached_lines.length - text_h);
        scroll_y = clamp(scroll_y + dy_lines, 0, max_scroll);
    }

    return {
        id: opts.id,
        rect: opts.rect,
        Focusable: true,

        Draw(c: Canvas): void {
            const border_rgb = opts.border_rgb ?? { r: 180, g: 180, b: 180 };
            const text_rgb = opts.text_rgb ?? { r: 255, g: 255, b: 255 };
            const w_base = base_weight();

            // optional bg fill behind everything
            if (opts.bg) {
                c.fill_rect(opts.rect, { char: opts.bg.char, rgb: opts.bg.rgb, style: "regular", weight_index: w_base });
            }

            const text_r = inner_text_rect();
            const text_w = rect_width(text_r);
            const text_h = rect_height(text_r);

            // Degenerate: rect too small to display text area
            if (text_w <= 0 || text_h <= 0) {
                draw_border(c, opts.rect, border_rgb, w_base, { corner: "+", h: "-", v: "|" });
                return;
            }

            ensure_layout(text_w);

            const total = cached_lines.length;
            const has_up = scroll_y > 0;
            const has_down = scroll_y + text_h < total;

            // draw border with scroll markers
            const markers: BorderMarkers = {};

            if (has_up) markers.top = "^";
            if (has_down) markers.bottom = "v";

            draw_border(
                c,
                opts.rect,
                border_rgb,
                w_base,
                { corner: "+", h: "-", v: "|" },
                markers,
            );


            // clear text area so old chars don’t linger
            // If the module has a bg, clear to bg; otherwise clear to space (default canvas bg).
            if (opts.bg) {
                c.fill_rect(text_r, { char: opts.bg.char, rgb: opts.bg.rgb, style: "regular", weight_index: w_base });
            } else {
                c.fill_rect(text_r, { char: " ", style: "regular", weight_index: w_base });
            }


            // render visible lines
            for (let row = 0; row < text_h; row++) {
                const line_i = scroll_y + row;
                const line = cached_lines[line_i] ?? "";
                // Rect is bottom-left coordinates (y0 bottom, y1 top). We render top-down:
                const y_top = text_r.y1;
                const y = y_top - row;
                const cps = Array.from(line);
                for (let col = 0; col < text_w; col++) {
                    const ch = cps[col] ?? " ";

                    const x = text_r.x0 + col;

                    c.set(x, y, { char: ch, rgb: text_rgb, style: "regular", weight_index: w_base });
                }
            }
        },

        OnWheel(e: WheelEvent): void {
            // line scrolling (normalize: pixels -> 1 step, lines -> direct)
            const dy = e.delta_y;
            if (dy === 0) return;

            // prefer sign-based scroll for stability across devices
            const step = dy > 0 ? 1 : -1;
            scroll_by(step);
        },
    };
}
