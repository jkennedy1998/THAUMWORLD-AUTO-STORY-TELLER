import type { Canvas, Rect, Rgb, PointerEvent } from "../types.js";
import { rect_width, rect_height } from "../types.js";
import { get_ui_semantic_rgb } from "../runtime/ui_customization_store.js";
import type { ModuleGizmosConfig } from "../module_gizmos.js";
import { clamp_weight_index, DEFAULT_WEIGHT_INDEX } from "../weight_system.js";
import { make_floating_panel_module } from "./floating_panel_module.js";

export type InputModuleOptions = {
    id: string;
    rect: Rect;

    // where to send on Enter (without Shift)
    target_id: string;

    // called on submit
    on_submit: (target_id: string, message: string) => void;

    // called whenever the input buffer changes
    on_change?: (message: string) => void;

    // optional: expose a submit trigger to external modules
    bind_submit?: (submit: () => void) => void;

    // styling
    text_rgb?: Rgb;
    border_rgb?: Rgb;
    bg?: { char: string; rgb: Rgb };
    cursor_rgb?: Rgb;
    base_weight_index?: number; // 0..3
    placeholder?: string;
    gizmos?: ModuleGizmosConfig;
    header_buttons?: Array<{
        id: string;
        label: string | (() => string);
        width?: number;
        on_press: () => void;
        is_active?: () => boolean;
    }>;
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

export function make_input_module(opts: InputModuleOptions) {
    const w_base = typeof opts.base_weight_index === "number" ? clamp_weight_index(opts.base_weight_index) : DEFAULT_WEIGHT_INDEX;

    let focused = false;
    let buffer = ""; // raw text (can include \n)

    function backspace_one_codepoint() {
        const cps = Array.from(buffer);
        if (cps.length === 0) return;
        cps.pop();
        buffer = cps.join("");
        opts.on_change?.(buffer);
    }

    function insert_text(t: string) {
        const cleaned = t.replace(/\t/g, "    ");
        buffer = buffer + cleaned;
        opts.on_change?.(buffer);
    }

    function submit() {
        const msg = buffer;
        if (msg.length === 0) return;
        opts.on_submit(opts.target_id, msg);
        buffer = "";
        opts.on_change?.(buffer);
    }

    function draw_cursor(c: Canvas, x: number, y: number) {
        c.set(x, y, {
            char: "▌",
            rgb: opts.cursor_rgb ?? get_ui_semantic_rgb('vivid'),
            style: "regular",
            weight_index: w_base,
        });
    }

    opts.bind_submit?.(submit);

    function resolve_label(label: string | (() => string)): string {
        return typeof label === "function" ? label() : label;
    }

    function header_button_row_y(rect: Rect): number {
        return rect.y1 - 1;
    }

    function get_header_buttons() {
        return opts.header_buttons ?? [];
    }

    function get_header_button_layout(rect: Rect): Array<{ id: string; label: string; x0: number; x1: number; on_press: () => void; is_active?: () => boolean }> {
        const layout: Array<{ id: string; label: string; x0: number; x1: number; on_press: () => void; is_active?: () => boolean }> = [];
        let x = rect.x0 + 2;
        for (const button of get_header_buttons()) {
            const label = resolve_label(button.label);
            const width = button.width ?? Math.max(4, label.length);
            if (x + width > rect.x1 - 1) break;
            layout.push({ id: button.id, label, x0: x, x1: x + width - 1, on_press: button.on_press, is_active: button.is_active });
            x += width + 2;
        }
        return layout;
    }

    return make_floating_panel_module({
        id: opts.id,
        rect: opts.rect,
        title: 'INPUT',
        focusable: true,
        gizmos: opts.gizmos,
        background: opts.bg,
        border: {
            border_rgb: opts.border_rgb,
        },
        resize: opts.gizmos ? {
            min_width: 12,
            min_height: 4,
            max_width: Number.MAX_SAFE_INTEGER,
            max_height: Number.MAX_SAFE_INTEGER,
        } : undefined,
        wants_text_capture: () => focused,
        on_focus: () => { focused = true; },
        on_blur: () => { focused = false; },
        on_pointer_down_content: (e: PointerEvent, rect: Rect) => {
            if (e.y !== header_button_row_y(rect)) return;
            for (const button of get_header_button_layout(rect)) {
                if (e.x >= button.x0 && e.x <= button.x1) {
                    button.on_press();
                    return;
                }
            }
        },
        on_text_input: (text: string) => {
            if (!focused) return;
            if (!text) return;
            insert_text(text);
        },
        on_key_down: (e: KeyboardEvent) => {
            if (!focused) return;

            if (e.key === "Backspace") {
                e.preventDefault();
                e.stopPropagation();
                backspace_one_codepoint();
                return;
            }

            if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                if (e.shiftKey) insert_text("\n");
                else submit();
            }
        },
        draw_content(c: Canvas, rect: Rect) {
            const inner: Rect = { x0: rect.x0 + 1, y0: rect.y0 + 1, x1: rect.x1 - 1, y1: rect.y1 - 1 };
            const bg_char = opts.bg?.char ?? ' ';
            const bg_rgb = opts.bg?.rgb ?? get_ui_semantic_rgb('background');
            const w = rect_width(inner);
            const h = rect_height(inner);

            c.fill_rect(inner, { char: bg_char, rgb: bg_rgb, style: "regular", weight_index: w_base });

            const text_to_show = buffer.length > 0 ? buffer : (opts.placeholder ?? "");
            const lines = wrap_preserve_newlines(text_to_show, w);
            const start = Math.max(0, lines.length - h);

            for (let row = 0; row < h; row++) {
                const line = lines[start + row] ?? "";
                const cps = Array.from(line);
                const y = inner.y1 - row;

                for (let col = 0; col < w; col++) {
                    const ch = cps[col] ?? " ";
                    const is_placeholder = buffer.length === 0 && (opts.placeholder ?? "").length > 0;
                    c.set(inner.x0 + col, y, {
                        char: ch,
                        rgb: is_placeholder ? get_ui_semantic_rgb('medium') : (opts.text_rgb ?? get_ui_semantic_rgb('bright')),
                        style: "regular",
                        weight_index: w_base,
                    });
                }
            }

            if (focused) {
                const content_lines = wrap_preserve_newlines(buffer, w);
                const visible_start = Math.max(0, content_lines.length - h);
                const last_index = Math.max(0, content_lines.length - 1);
                const cursor_row_visible = clamp(last_index - visible_start, 0, h - 1);
                const last_line = content_lines[last_index] ?? "";
                const cursor_y = inner.y1 - cursor_row_visible;
                const cursor_x = inner.x0 + clamp(Array.from(last_line).length, 0, w - 1);
                draw_cursor(c, cursor_x, cursor_y);
            }
        },
        draw_overlay(c: Canvas, rect: Rect): void {
            for (const button of get_header_button_layout(rect)) {
                const active = button.is_active?.() ?? false;
                const rgb = active ? get_ui_semantic_rgb('vivid') : get_ui_semantic_rgb('medium');
                for (let i = 0; i < button.label.length && button.x0 + i <= button.x1; i++) {
                    c.set(button.x0 + i, header_button_row_y(rect), {
                        char: button.label[i]!,
                        rgb,
                        style: "regular",
                        weight_index: active ? Math.min(3, w_base + 1) : w_base,
                    });
                }
            }
        },
    });
}
