import type { Canvas, Module, PointerEvent, Rect, Rgb } from "../types.js";
import { rect_height, rect_width } from "../types.js";

export type RollerState = {
    spinner: string;
    last_roll: string;
    dice_label: string;
    disabled: boolean;
    roll_id: string | null;
};

export type RollerModuleOptions = {
    id: string;
    rect: Rect;
    get_state: () => RollerState;
    on_roll: (roll_id: string) => void;
    text_rgb: Rgb;
    dim_rgb: Rgb;
    border_rgb: Rgb;
    bg?: { char: string; rgb: Rgb };
    base_weight_index?: number;
};

function clamp(n: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, n));
}

export function make_roller_module(opts: RollerModuleOptions): Module {
    let hovered = false;
    let pressed = false;

    function base_weight(): number {
        const w = opts.base_weight_index ?? 3;
        return clamp((w | 0), 0, 7);
    }

    function draw_text(c: Canvas, x: number, y: number, text: string, rgb: Rgb, weight_index: number): void {
        const cps = Array.from(text);
        for (let i = 0; i < cps.length; i++) {
            const ch = cps[i] ?? " ";
            c.set(x + i, y, { char: ch, rgb, style: "regular", weight_index });
        }
    }

    function button_rect(): Rect {
        return { x0: opts.rect.x0 + 1, y0: opts.rect.y0 + 1, x1: opts.rect.x1 - 1, y1: opts.rect.y0 + 3 };
    }

    function is_in_rect(r: Rect, x: number, y: number): boolean {
        return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
    }

    return {
        id: opts.id,
        rect: opts.rect,
        Focusable: true,

        Draw(c: Canvas): void {
            const state = opts.get_state();
            const w_base = base_weight();
            const rect = opts.rect;

            if (opts.bg) {
                c.fill_rect(rect, { char: opts.bg.char, rgb: opts.bg.rgb, style: "regular", weight_index: w_base });
            }

            const text_rgb = state.disabled ? opts.dim_rgb : opts.text_rgb;
            const label = state.disabled ? ":3" : state.dice_label;
            const roll_line = state.last_roll.length > 0 ? state.last_roll : "no roll";
            const spinner = state.spinner || "|";

            // header
            draw_text(c, rect.x0 + 1, rect.y1 - 1, `roll ${spinner}`, text_rgb, w_base + 1);
            // last roll line (truncate)
            const max_w = rect_width(rect) - 2;
            const roll_text = roll_line.length > max_w ? roll_line.slice(0, max_w) : roll_line;
            draw_text(c, rect.x0 + 1, rect.y1 - 2, roll_text, text_rgb, w_base);

            // button area
            const btn = button_rect();
            const btn_rgb = state.disabled ? opts.dim_rgb : opts.text_rgb;
            c.fill_rect(btn, { char: "-", rgb: opts.border_rgb, style: "regular", weight_index: w_base });

            const btn_label = label;
            const start_x = btn.x0 + Math.max(0, Math.floor((rect_width(btn) - btn_label.length) / 2));
            const y = btn.y0 + Math.floor(rect_height(btn) / 2);
            draw_text(c, start_x, y, btn_label, btn_rgb, w_base + (hovered ? 1 : 0));

            if (pressed) {
                c.set(btn.x0, btn.y1, { char: "P", rgb: btn_rgb, style: "regular", weight_index: w_base + 2 });
            }
        },

        OnPointerEnter(): void {
            hovered = true;
        },

        OnPointerLeave(): void {
            hovered = false;
            pressed = false;
        },

        OnPointerDown(e: PointerEvent): void {
            if (e.button !== 0) return;
            if (is_in_rect(button_rect(), e.x, e.y)) pressed = true;
        },

        OnPointerUp(): void {
            pressed = false;
        },

        OnClick(e: PointerEvent): void {
            if (e.button !== 0) return;
            const state = opts.get_state();
            if (state.disabled || !state.roll_id) return;
            if (!is_in_rect(button_rect(), e.x, e.y)) return;
            opts.on_roll(state.roll_id);
        },
    };
}
