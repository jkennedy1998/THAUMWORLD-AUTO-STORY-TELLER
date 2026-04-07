import type { Canvas, Module, Rect, Rgb, PointerEvent } from '../types.js';
import { get_color_by_name } from '../colors.js';
import { draw_module_border, PANEL_BORDER_PRESETS } from '../module_borders.js';
import { play_sfx } from '../sfx/sfx_player.js';
import { clamp_weight_index, DEFAULT_WEIGHT_INDEX } from '../weight_system.js';

export type ButtonOptions = {
    id: string;
    rect: Rect;

    label: string;              // monospace text
    rgb: Rgb;                   // label color
    bg?: { char: string; rgb: Rgb }; // optional background fill

    // Standard chrome
    border_rgb?: Rgb;
    hover_border_rgb?: Rgb;
    press_border_rgb?: Rgb;

    // Optional dynamic styling
    get_rgb?: () => Rgb;
    get_bg?: () => { char: string; rgb: Rgb } | undefined;
    get_base_weight_index?: () => number;
    // baseline typographic weight for this button
    // 0..3, default = 1 (regular)
    base_weight_index?: number;
    Focusable?: boolean;

    // called on click; you can branch on e.button and e.click_count
    OnPress?: (e: PointerEvent) => void;

    // Optional UI SFX ids
    sfx_down_id?: string;
    sfx_up_id?: string;
};

export function make_button_module(opts: ButtonOptions): Module {
    const rect = opts.rect;
    let hovered = false;
    let pressed = false;

    // transient click animation
    let click_boost_frames = 0;
    const CLICK_BOOST_FRAMES = 20; // exaggerate so you can SEE it



    function base_weight(): number {
        if (opts.get_base_weight_index) return clamp_weight_index(opts.get_base_weight_index());
        return clamp_weight_index(opts.base_weight_index ?? DEFAULT_WEIGHT_INDEX);
    }

    // hover = +1 from base
    // hold  = -1 from base
    // click = +2 from base for a few frames
    function current_label_weight_index(): number {
        const base = base_weight();

        let delta = 0;

        // click overrides other states
        if (click_boost_frames > 0) delta = 2;
        else if (pressed) delta = -1;
        else if (hovered) delta = 1;

        return clamp_weight_index(base + delta);
    }




    function draw_label(c: Canvas, rgb: Rgb) {
        const y = rect.y0 + Math.floor((rect.y1 - rect.y0) / 2);
        const label = opts.label;
        const start_x = rect.x0 + Math.max(0, Math.floor(((rect.x1 - rect.x0 + 1) - label.length) / 2));

        for (let i = 0; i < label.length; i++) {
            const x = start_x + i;
            if (x > rect.x1) break;

            const ch = label.charAt(i); // always a string ('' if out of range)
            if (!ch) continue;

            c.set(x, y, { char: ch, rgb, style: 'regular', weight_index: current_label_weight_index() });

        }

    }

    function clamp_byte(n: number): number {
        if (!Number.isFinite(n)) return 0;
        return Math.max(0, Math.min(255, Math.round(n)));
    }

    function tweak_rgb(rgb: Rgb, delta: number): Rgb {
        return {
            r: clamp_byte(rgb.r + delta),
            g: clamp_byte(rgb.g + delta),
            b: clamp_byte(rgb.b + delta),
        };
    }

    return {
        id: opts.id,
        rect,
        Focusable: opts.Focusable ?? true,

        Draw(c: Canvas): void {
            if (click_boost_frames > 0) click_boost_frames--;

            const base_label_rgb = opts.get_rgb ? opts.get_rgb() : opts.rgb;

            const border_idle = opts.border_rgb ?? get_color_by_name('medium_gray').rgb;
            const border_hover = opts.hover_border_rgb ?? get_color_by_name('pale_yellow').rgb;
            const border_press = opts.press_border_rgb ?? get_color_by_name('vivid_cyan').rgb;
            const border_rgb = pressed ? border_press : (hovered ? border_hover : border_idle);

            const bg = opts.get_bg ? opts.get_bg() : opts.bg;
            if (bg) {
                const rgb = pressed ? tweak_rgb(bg.rgb, -20) : (hovered ? tweak_rgb(bg.rgb, 18) : bg.rgb);
                c.fill_rect(rect, { char: bg.char, rgb, style: 'regular', weight_index: 1 });
            }

            // Standard double-border chrome for all buttons.
            draw_module_border(c, {
                rect,
                style: PANEL_BORDER_PRESETS.default_double.style,
                border_rgb,
                weight_index: PANEL_BORDER_PRESETS.default_double.weight_index,
            });

            // Click feedback: temporarily tint label brighter.
            const label_rgb = click_boost_frames > 0
                ? get_color_by_name('off_white').rgb
                : base_label_rgb;

            draw_label(c, label_rgb);
        },

        OnPointerEnter(): void {
            hovered = true;
        },

        OnPointerLeave(): void {
            hovered = false;
            // if the user drags out while holding, keep pressed until up
            // (mouseup will clear pressed via OnPointerUp)
        },

        OnPointerDown(e: PointerEvent): void {
            // only treat left button as "press" by default
            if (e.button === 0) {
                pressed = true;
                play_sfx(opts.sfx_down_id ?? 'ui_press', { channel: 'ui', cooldown_ms: 0 });
            }

        },

        OnPointerUp(): void {
            pressed = false;
        },

        OnDragStart(): void {
            // dragging cancels click automatically in UI, but pressed state should still clear on up
        },

        OnClick(e: PointerEvent): void {
            // click feedback: +2 from base for a few frames
            click_boost_frames = CLICK_BOOST_FRAMES;

            // Release sound only when it's a real click (no drag-away).
            play_sfx(opts.sfx_up_id ?? 'ui_release', { channel: 'ui', cooldown_ms: 0 });

            // let right/middle/dblclick be handled by caller if they want
            opts.OnPress?.(e);
        },

    };
}
