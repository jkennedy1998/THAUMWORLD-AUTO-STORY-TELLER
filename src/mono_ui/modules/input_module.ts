import type { Canvas, Module, Rect, Rgb, PointerEvent } from "../types.js";
import { rect_width, rect_height } from "../types.js";
import { draw_border } from "../padding.js";
import { get_color_by_name } from "../colors.js";

export type InputModuleOptions = {
    id: string;
    rect: Rect;

    // where to send on Enter (without Shift)
    target_id: string;

    // called on submit
    on_submit: (target_id: string, message: string) => void;

    // optional: expose a submit trigger to external modules
    bind_submit?: (submit: () => void) => void;

    // styling
    text_rgb?: Rgb;
    border_rgb?: Rgb;
    bg?: { char: string; rgb: Rgb };
    cursor_rgb?: Rgb;
    base_weight_index?: number; // 0..7
    placeholder?: string;
};

function clamp(n: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, n));
}

// Wrap text preserving newlines. Uses codepoints (Array.from) so emojis don’t slice mid-unit.
// (Not full grapheme-cluster safe; good enough for now.)
function wrap_preserve_newlines(text: string, width: number): string[] {
    const lines: string[] = [];
    if (width <= 0) return lines;

    const to_cp = (s: string) => Array.from(s);
    const cp_len = (s: string) => to_cp(s).length;
    const cp_slice = (s: string, start: number, end?: number) => to_cp(s).slice(start, end).join("");

    const push_wrapped_paragraph = (paragraph: string) => {
        if (paragraph.length === 0) {
            lines.push("");
            return;
        }

        const words = paragraph.split(/\s+/).filter(w => w.length > 0);

        let line = "";
        const flush = () => { lines.push(line); line = ""; };

        const add_word = (w: string) => {
            const wlen = cp_len(w);

            // hyphenate very long “word”
            if (wlen > width) {
                if (line.length > 0) flush();

                let rest = w;
                while (cp_len(rest) > width) {
                    const take = Math.max(1, width - 1);
                    lines.push(cp_slice(rest, 0, take) + "-");
                    rest = cp_slice(rest, take);
                }
                line = rest;
                return;
            }

            if (line.length === 0) { line = w; return; }

            const next_len = cp_len(line) + 1 + wlen;
            if (next_len <= width) {
                line = line + " " + w;
            } else {
                flush();
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

    const paragraphs = text.split("\n");
    for (const p of paragraphs) push_wrapped_paragraph(p ?? "");

    return lines;
}

export function make_input_module(opts: InputModuleOptions): Module {
    const text_rgb: Rgb = opts.text_rgb ?? get_color_by_name("off_white").rgb;
    const border_rgb: Rgb = opts.border_rgb ?? get_color_by_name("light_gray").rgb;
    const cursor_rgb: Rgb = opts.cursor_rgb ?? get_color_by_name("off_white").rgb;
    const w_base = typeof opts.base_weight_index === "number" ? clamp(Math.trunc(opts.base_weight_index), 0, 7) : 3;

    let focused = false;
    let buffer = ""; // raw text (can include \n)

    function backspace_one_codepoint() {
        const cps = Array.from(buffer);
        if (cps.length === 0) return;
        cps.pop();
        buffer = cps.join("");
    }

    function insert_text(t: string) {
        // treat tab as spaces to keep tile-grid clean
        const cleaned = t.replace(/\t/g, "    ");
        buffer = buffer + cleaned;
    }

    function submit() {
        const msg = buffer;
        if (msg.length === 0) return;
        opts.on_submit(opts.target_id, msg);
        buffer = "";
    }

    function draw_cursor(c: Canvas, x: number, y: number) {
        c.set(x, y, {
            char: "▌",
            rgb: cursor_rgb,
            style: "regular",
            weight_index: w_base,
        });
    }

    opts.bind_submit?.(submit);

    return {
        id: opts.id,
        rect: opts.rect,
        Focusable: true,

        OnFocus() { focused = true; },
        OnBlur() { focused = false; },

        OnPointerDown(_e: PointerEvent) {
            // focus is handled by main.ts (Focusable). No caret positioning yet.
        },

        OnTextInput(text: string) {
            if (!focused) return;
            if (!text) return;
            insert_text(text);
        },

        OnKeyDown(e: KeyboardEvent) {
            if (!focused) return;

            // Backspace
            if (e.key === "Backspace") {
                e.preventDefault();
                e.stopPropagation();
                backspace_one_codepoint();
                return;
            }

            // Enter: Shift+Enter inserts newline, Enter submits
            if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                if (e.shiftKey) insert_text("\n");
                else submit();
                return;
            }
        },

        Draw(c: Canvas) {
            const r = opts.rect;
            const inner: Rect = { x0: r.x0 + 1, y0: r.y0 + 1, x1: r.x1 - 1, y1: r.y1 - 1 };

            if (opts.bg) {
                c.fill_rect(r, { char: opts.bg.char, rgb: opts.bg.rgb, style: "regular", weight_index: w_base });
            }

            // border
            draw_border(c, r, border_rgb);

            const w = rect_width(inner);
            const h = rect_height(inner);

            const text_to_show = buffer.length > 0 ? buffer : (opts.placeholder ?? "");
            const lines = wrap_preserve_newlines(text_to_show, w);

            // show the *bottom* h lines (like a chat input area)
            const start = Math.max(0, lines.length - h);

            // clear inner area
            if (opts.bg) {
                c.fill_rect(inner, { char: opts.bg.char, rgb: opts.bg.rgb, style: "regular", weight_index: w_base });
            } else {
                c.fill_rect(inner, { char: " ", style: "regular", weight_index: w_base });
            }

            for (let row = 0; row < h; row++) {
                const line = lines[start + row] ?? "";
                const cps = Array.from(line);

                // top-down render inside inner rect
                const y = inner.y1 - row;

                for (let col = 0; col < w; col++) {
                    const ch = cps[col] ?? " ";
                    const is_placeholder = buffer.length === 0 && (opts.placeholder ?? "").length > 0;
                    c.set(inner.x0 + col, y, {
                        char: ch,
                        rgb: is_placeholder ? get_color_by_name("medium_gray").rgb : text_rgb,
                        style: "regular",
                        weight_index: w_base,
                    });
                }
            }

            // cursor at end (no mid-buffer editing yet)
            if (focused) {
                const content_lines = wrap_preserve_newlines(buffer, w);

                // same "show bottom h lines" logic as the renderer
                const start = Math.max(0, content_lines.length - h);

                const last_index = Math.max(0, content_lines.length - 1);
                const cursor_row_visible = clamp(last_index - start, 0, h - 1); // 0=top row

                const last_line = content_lines[last_index] ?? "";

                // match draw loop: y = inner.y1 - row
                const cursor_y = inner.y1 - cursor_row_visible;

                const cursor_x = inner.x0 + clamp(Array.from(last_line).length, 0, w - 1);

                draw_cursor(c, cursor_x, cursor_y);
            }

        },
    };
}
