import type { Canvas, Module, Rect, Rgb, WheelEvent, DragEvent } from "../types.js";
import { rect_width, rect_height } from "../types.js";
import { get_color_by_name } from "../colors.js";
import { draw_module_border, BORDER_STYLES } from "../module_borders.js";
import type { ModuleGizmosConfig, GizmoState } from "../module_gizmos.js";
import { create_gizmo_state, draw_module_gizmos, get_resize_edge, handle_gizmo_click, handle_resize_drag, is_in_gizmo_area, handle_global_pointer_down_for_gizmos } from "../module_gizmos.js";

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
    base_weight_index?: number; // 0..7
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
    // Mutable rect for move/resize.
    let rect = opts.rect;

    const gizmo_config: ModuleGizmosConfig | undefined = opts.gizmos;
    const gizmo_state: GizmoState = create_gizmo_state();

    let scroll_y = 0;

    // Drag-to-pan (UI traversal): same feel as place module panning.
    // Uses drag events so small pointer jitter doesn't scroll.
    let is_drag_panning = false;

    // derived layout cache
    let cached_rev = -1;
    let cached_width = -1;
    let cached_lines: LineInfo[] = [];

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
        // 1-char border/padding; reserve one extra row for header widgets/title.
        return { x0: rect.x0 + 1, y0: rect.y0 + 1, x1: rect.x1 - 1, y1: rect.y1 - 2 };
    }

    function scroll_by(dy_lines: number) {
        const text_r = inner_text_rect();
        const text_h = rect_height(text_r);
        const max_scroll = Math.max(0, cached_lines.length - text_h);
        scroll_y = clamp(scroll_y + dy_lines, 0, max_scroll);
    }

    return {
        id: opts.id,
        get rect() { return rect; },
        Focusable: true,

        Draw(c: Canvas): void {
            const border_rgb = opts.border_rgb ?? get_color_by_name("light_gray").rgb;
            const text_rgb = opts.text_rgb ?? get_color_by_name("off_white").rgb;
            const hint_rgb = opts.hint_rgb ?? get_color_by_name("pale_yellow").rgb;
            const w_base = base_weight();

            // optional bg fill behind everything
            if (opts.bg) {
                c.fill_rect(rect, { char: opts.bg.char, rgb: opts.bg.rgb, style: "regular", weight_index: w_base });
            }

            const text_r = inner_text_rect();
            const text_w = rect_width(text_r);
            const text_h = rect_height(text_r);

            // Degenerate: rect too small to display text area
            if (text_w <= 0 || text_h <= 0) {
                draw_module_border(c, {
                    rect,
                    style: BORDER_STYLES.double,
                    border_rgb,
                    weight_index: w_base,
                });
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

            draw_module_border(c, {
                rect,
                style: BORDER_STYLES.double,
                border_rgb,
                weight_index: w_base,
                markers: { top: markers.top, bottom: markers.bottom },
                header: {
                    text: (opts.title ?? opts.id).toUpperCase(),
                    reserve_left_cols: 2 + ((gizmo_config?.enabled?.length ?? 0) * 2),
                },
            });


            // clear text area so old chars don't linger
            // If the module has a bg, clear to bg; otherwise clear to space (default canvas bg).
            if (opts.bg) {
                c.fill_rect(text_r, { char: opts.bg.char, rgb: opts.bg.rgb, style: "regular", weight_index: w_base });
            } else {
                c.fill_rect(text_r, { char: " ", style: "regular", weight_index: w_base });
            }


            // render visible lines
            let npcLinesRendered = 0;
            for (let row = 0; row < text_h; row++) {
                const line_i = scroll_y + row;
                const line_info = cached_lines[line_i];
                const line_text = line_info?.text ?? "";
                const line_sender = line_info?.sender;
                // Determine color based on sender type
                let line_rgb = text_rgb;
                if (line_sender === "hint" || line_sender === "inspection") line_rgb = hint_rgb;
                else if (line_sender === "npc") {
                    line_rgb = opts.npc_rgb ?? text_rgb;
                    npcLinesRendered++;
                }
                else if (line_sender === "state") line_rgb = opts.state_rgb ?? text_rgb;
                // Rect is bottom-left coordinates (y0 bottom, y1 top). We render top-down:
                const y_top = text_r.y1;
                const y = y_top - row;
                const cps = Array.from(line_text);
                for (let col = 0; col < text_w; col++) {
                    const ch = cps[col] ?? " ";

                    const x = text_r.x0 + col;

                    c.set(x, y, { char: ch, rgb: line_rgb, style: "regular", weight_index: w_base });
                }
            }
            
            // Debug logging
            if (npcLinesRendered > 0) {
                console.log(`[window_module:${opts.id}] Rendered ${text_h} lines, ${npcLinesRendered} NPC lines visible (scroll: ${scroll_y}/${cached_lines.length})`);
            }

            // Draw widgets last.
            if (gizmo_config) {
                draw_module_gizmos(c, rect, gizmo_config, gizmo_state);
            }
        },

        OnGlobalPointerDown(e: any): void {
            if (gizmo_config) {
                handle_global_pointer_down_for_gizmos(e, rect, gizmo_config, gizmo_state);
            }
        },

        OnPointerMove(e: any): void {
            if (gizmo_state.is_resize_mode && !gizmo_state.is_dragging_resize) {
                gizmo_state.resize_edge = get_resize_edge(e.x, e.y, rect);
            }
        },

        OnPointerDown(e: any): void {
            if (gizmo_config && is_in_gizmo_area(e.x, e.y, rect)) {
                const gizmo = handle_gizmo_click(e.x, e.y, rect, gizmo_config, gizmo_state);
                if (gizmo === 'move' || gizmo === 'resize') {
                    gizmo_state.move_start_x = e.x;
                    gizmo_state.move_start_y = e.y;
                    gizmo_state.original_rect = { ...rect };
                }
                return;
            }

            if (gizmo_state.is_resize_mode) {
                const edge = get_resize_edge(e.x, e.y, rect);
                if (edge) {
                    gizmo_state.resize_edge = edge;
                    gizmo_state.is_dragging_resize = true;
                    gizmo_state.move_start_x = e.x;
                    gizmo_state.move_start_y = e.y;
                    gizmo_state.original_rect = { ...rect };
                }
            }
        },

        OnDragStart(e: DragEvent): void {
            if (gizmo_state.is_move_mode || gizmo_state.is_resize_mode) {
                gizmo_state.move_start_x = e.start_x;
                gizmo_state.move_start_y = e.start_y;
                if (!gizmo_state.original_rect) gizmo_state.original_rect = { ...rect };
                return;
            }

            // Drag-to-scroll (when not in widget modes)
            if (e.buttons & 1) {
                is_drag_panning = true;
            }
        },

        OnDragMove(e: DragEvent): void {
            if (gizmo_state.is_move_mode && gizmo_state.original_rect) {
                const dx = e.x - gizmo_state.move_start_x;
                const dy = e.y - gizmo_state.move_start_y;
                const next: Rect = {
                    x0: gizmo_state.original_rect.x0 + dx,
                    y0: gizmo_state.original_rect.y0 + dy,
                    x1: gizmo_state.original_rect.x1 + dx,
                    y1: gizmo_state.original_rect.y1 + dy,
                };
                rect = next;
                if (gizmo_config?.on_resize) gizmo_config.on_resize(rect);
                else gizmo_config?.on_move?.(rect);
                return;
            }

            if (gizmo_state.is_resize_mode && gizmo_state.is_dragging_resize && gizmo_state.original_rect) {
                const min_width = 20;
                const min_height = 6;
                const max_width = 200;
                const max_height = 80;
                const next = handle_resize_drag(
                    e.x,
                    e.y,
                    gizmo_state,
                    gizmo_state.original_rect,
                    min_width,
                    min_height,
                    max_width,
                    max_height,
                    (r) => {
                        rect = r;
                        if (gizmo_config?.on_resize) gizmo_config.on_resize(rect);
                        else gizmo_config?.on_move?.(rect);
                    },
                );
                if (next) rect = next;
                return;
            }

            // Drag-to-scroll (when not in widget modes)
            if (!is_drag_panning) return;
            if (!(e.buttons & 1)) return;
            // Drag up (positive step_dy) scrolls down to newer lines.
            scroll_by(e.step_dy);
        },

        OnDragEnd(_e: DragEvent): void {
            if (gizmo_state.is_resize_mode && gizmo_state.is_dragging_resize) {
                gizmo_state.is_dragging_resize = false;
                gizmo_state.resize_edge = null;
                if (gizmo_config?.on_resize_end) gizmo_config.on_resize_end(rect);
                else gizmo_config?.on_move_end?.(rect);
            }

            if (gizmo_state.is_move_mode && gizmo_state.original_rect) {
                gizmo_config?.on_move_end?.(rect);
            }

            is_drag_panning = false;
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
