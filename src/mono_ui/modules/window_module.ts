import type { Canvas, Module, Rect, Rgb, WheelEvent, DragEvent } from "../types.js";
import { rect_width, rect_height } from "../types.js";
import { PANEL_BORDER_PRESETS } from "../module_borders.js";
import type { ModuleGizmosConfig } from "../module_gizmos.js";
import { get_ui_semantic_rgb } from "../runtime/ui_customization_store.js";
import { make_floating_panel_module } from "./floating_panel_module.js";
import { clamp_weight_index, DEFAULT_WEIGHT_INDEX } from "../weight_system.js";
import { create_vertical_scroll_pan_adapter } from './adapters/vertical_scroll_pan_adapter.js';

export type TextWindowMessage = {
    content: string;
    sender?: string;
    // Optional backing log id (lets the app correlate UI updates with source events).
    id?: string;
};

export type TextWindowSource = {
    messages: (string | TextWindowMessage)[];
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
    base_weight_index?: number; // 0..3
    hint_rgb?: Rgb; // color for 'hint' sender messages
    npc_rgb?: Rgb; // color for NPC messages
    state_rgb?: Rgb; // color for state applier messages

    // Standard widgets (move/resize/close)
    gizmos?: ModuleGizmosConfig;
    title?: string;
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

type LineInfo = { text: string; sender: string | undefined };

function wrap_messages(messages: (string | TextWindowMessage)[], width: number): LineInfo[] {
    const lines: LineInfo[] = [];
    if (width <= 0) return lines;
    if (!Array.isArray(messages)) return lines;  // Safety check for undefined/non-array

    const push_blank_between = true;

    // Codepoint helpers (better than naive string slicing; still not full grapheme-cluster safe)
    const to_cp = (s: string) => Array.from(s);
    const cp_len = (s: string) => to_cp(s).length;
    const cp_slice = (s: string, start: number, end?: number) => to_cp(s).slice(start, end).join("");

    const badge_for_sender = (sender: string | undefined): { badge: string; indent: string; width: number } | null => {
        if (!sender) return null;
        const s = sender.toLowerCase();
        // Fixed-width 3-char badges (keeps wrapping predictable)
        const badge = s === "user" ? "U: "
            : s === "assistant" ? "R: "
            : s === "npc" ? "N: "
            : s === "inspection" ? "I: "
            : s === "hint" ? "!: "
            : s === "state" ? "S: "
            : s === "system" ? "?: "
            : "?: ";
        return { badge, indent: "   ", width: 3 };
    };

    const push_wrapped_paragraph = (
        paragraph: string,
        sender: string | undefined,
        prefix: { badge: string; indent: string; width: number } | null,
        first_line_ref: { first: boolean },
    ) => {
        // Preserve truly empty lines
        if (paragraph.length === 0) {
            lines.push({ text: "", sender });
            return;
        }

        // Collapse internal whitespace within a paragraph (but we already preserved newlines by splitting)
        const words = paragraph.split(/\s+/).filter(w => w.length > 0);

        let line = "";

        const emit = (raw: string) => {
            if (!prefix) {
                lines.push({ text: raw, sender });
                return;
            }
            if (first_line_ref.first) {
                lines.push({ text: prefix.badge + raw, sender });
                first_line_ref.first = false;
            } else {
                lines.push({ text: prefix.indent + raw, sender });
            }
        };

        const flush_line = () => {
            emit(line);
            line = "";
        };

        const add_word = (w: string) => {
            const wlen = cp_len(w);

            const avail = prefix ? Math.max(1, width - prefix.width) : width;

            // long word hyphenation by codepoints
            if (wlen > avail) {
                if (line.length > 0) flush_line();

                let rest = w;
                while (cp_len(rest) > avail) {
                    const take = Math.max(1, avail - 1);
                    emit(cp_slice(rest, 0, take) + "-");
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
            if (next_len <= avail) {
                line = line + " " + w;
            } else {
                flush_line();
                line = w;
            }
        };

        for (const w of words) add_word(w);

        if (words.length === 0) {
            emit("");
        } else if (line.length > 0) {
            emit(line);
        }
    };

    for (let mi = 0; mi < messages.length; mi++) {
        const msg = messages[mi] ?? "";
        const content = typeof msg === "string" ? msg : msg.content;
        const sender = typeof msg === "string" ? undefined : msg.sender;

        const prefix = typeof msg === "string" ? null : badge_for_sender(sender);
        const first_line_ref = { first: true };

        // Preserve user newlines: wrap each paragraph independently.
        const paragraphs = content.split("\n");

        for (let pi = 0; pi < paragraphs.length; pi++) {
            push_wrapped_paragraph(paragraphs[pi] ?? "", sender, prefix, first_line_ref);
        }

        if (push_blank_between && mi !== messages.length - 1) {
            lines.push({ text: "", sender });
        }
    }

    // Debug logging for NPC messages
    const npcLines = lines.filter(l => l.sender === 'npc');
    if (npcLines.length > 0) {
        console.log(`[wrap_messages] Wrapped ${messages.length} messages into ${lines.length} lines (${npcLines.length} NPC lines)`);
    }

    return lines;
}


export function make_text_window_module(opts: TextWindowOptions): Module {
    const gizmo_config: ModuleGizmosConfig | undefined = opts.gizmos;
    let rect = opts.rect;

    let scroll_y = 0;

    const scroll_pan_adapter = create_vertical_scroll_pan_adapter({
        get_scroll_y: () => scroll_y,
        set_scroll_y: (y: number) => {
            scroll_y = y;
        },
        clamp: (y: number) => {
            const text_r = inner_text_rect();
            const text_h = rect_height(text_r);
            const max_scroll = Math.max(0, cached_lines.length - text_h);
            return clamp(y, 0, max_scroll);
        },
    });

    // Drag-to-pan (UI traversal): same feel as place module panning.
    // Uses drag events so small pointer jitter doesn't scroll.
    let is_drag_panning = false;

    // derived layout cache
    let cached_rev = -1;
    let cached_width = -1;
    let cached_lines: LineInfo[] = [];

    function base_weight(): number {
        return clamp_weight_index(opts.base_weight_index ?? DEFAULT_WEIGHT_INDEX);
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
        // 1-char border/padding; reserve one extra row for header widgets/title.
        return { x0: rect.x0 + 1, y0: rect.y0 + 1, x1: rect.x1 - 1, y1: rect.y1 - 2 };
    }

    function get_border_markers(current_rect: Rect): BorderMarkers {
        const text_h = rect_height({ x0: current_rect.x0 + 1, y0: current_rect.y0 + 1, x1: current_rect.x1 - 1, y1: current_rect.y1 - 2 });
        const total = cached_lines.length;
        return {
            top: scroll_y > 0 ? "^" : undefined,
            bottom: scroll_y + text_h < total ? "v" : undefined,
        };
    }

    return make_floating_panel_module({
        id: opts.id,
        rect: opts.rect,
        title: (opts.title ?? opts.id).toUpperCase(),
        gizmos: gizmo_config,
        background: opts.bg,
        border: {
            border_rgb: opts.border_rgb,
            weight_index: PANEL_BORDER_PRESETS.default_double.weight_index,
            style: PANEL_BORDER_PRESETS.default_double.style,
            markers: (current_rect: Rect) => get_border_markers(current_rect),
        },
        resize: gizmo_config ? {
            min_width: 20,
            min_height: 6,
            max_width: 200,
            max_height: 80,
        } : undefined,
        get_pan_target_adapter: () => scroll_pan_adapter,
        draw_content(c: Canvas, next_rect: Rect): void {
            rect = next_rect;
            const text_rgb = opts.text_rgb ?? get_ui_semantic_rgb('bright');
            const hint_rgb = opts.hint_rgb ?? get_ui_semantic_rgb('vivid');
            const w_base = base_weight();
            const text_r = inner_text_rect();
            const text_w = rect_width(text_r);
            const text_h = rect_height(text_r);

            if (text_w <= 0 || text_h <= 0) {
                return;
            }

            ensure_layout(text_w);

            const bg_char = opts.bg?.char ?? ' ';
            const bg_rgb = opts.bg?.rgb ?? get_ui_semantic_rgb('background');
            c.fill_rect(text_r, { char: bg_char, rgb: bg_rgb, style: "regular", weight_index: w_base });

            let npcLinesRendered = 0;
            for (let row = 0; row < text_h; row++) {
                const line_i = scroll_y + row;
                const line_info = cached_lines[line_i];
                const line_text = line_info?.text ?? "";
                const line_sender = line_info?.sender;
                let line_rgb = text_rgb;
                if (line_sender === "hint" || line_sender === "inspection") line_rgb = hint_rgb;
                else if (line_sender === "npc") {
                    line_rgb = opts.npc_rgb ?? get_ui_semantic_rgb('vivid');
                    npcLinesRendered++;
                } else if (line_sender === "state") line_rgb = opts.state_rgb ?? get_ui_semantic_rgb('medium');
                const y = text_r.y1 - row;
                const cps = Array.from(line_text);
                for (let col = 0; col < text_w; col++) {
                    const ch = cps[col] ?? " ";
                    c.set(text_r.x0 + col, y, { char: ch, rgb: line_rgb, style: "regular", weight_index: w_base });
                }
            }

            if (npcLinesRendered > 0) {
                console.log(`[window_module:${opts.id}] Rendered ${text_h} lines, ${npcLinesRendered} NPC lines visible (scroll: ${scroll_y}/${cached_lines.length})`);
            }
        },
        on_drag_start_content(e: DragEvent): void {
            if (e.buttons & 1) {
                is_drag_panning = true;
            }
        },
        on_drag_move_content(e: DragEvent): void {
            if (!is_drag_panning) return;
            if (!(e.buttons & 1)) return;
            scroll_pan_adapter.applyAxisDelta?.({ y: e.step_dy });
        },
        on_drag_end_content(): void {
            is_drag_panning = false;
        },
        on_wheel_content(e: WheelEvent): void {
            const dy = e.delta_y;
            if (dy === 0) return;
            scroll_pan_adapter.applyAxisDelta?.({ y: dy > 0 ? 1 : -1 });
        },
    });
}
