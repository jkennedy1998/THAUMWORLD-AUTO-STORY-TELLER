import type { Canvas, Module, Rect, Rgb, PointerEvent } from '../types.js';

export type ButtonOptions = {
    id: string;
    rect: Rect;

    label: string;              // monospace text
    rgb: Rgb;                   // label color
    bg?: { char: string; rgb: Rgb }; // optional background fill

    // Optional dynamic styling
    get_rgb?: () => Rgb;
    get_bg?: () => { char: string; rgb: Rgb } | undefined;
    get_base_weight_index?: () => number;
    // baseline typographic weight for this button
    // 0..7, default = 3 (regular-ish)
    base_weight_index?: number;
    Focusable?: boolean;

    // called on click; you can branch on e.button and e.click_count
    OnPress?: (e: PointerEvent) => void;
};

export function make_button_module(opts: ButtonOptions): Module {
    const rect = opts.rect;
    let hovered = false;
    let pressed = false;

    // transient click animation
    let click_boost_frames = 0;
    const CLICK_BOOST_FRAMES = 20; // exaggerate so you can SEE it



    function clamp_wi(w: number): number {
        if (w < 0) return 0;
        if (w > 7) return 7;
        return w | 0;
    }

    function base_weight(): number {
        if (opts.get_base_weight_index) return clamp_wi(opts.get_base_weight_index());
        return clamp_wi(opts.base_weight_index ?? 3);
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

        return clamp_wi(base + delta);
    }




    function draw_label(c: Canvas) {
        const y = rect.y0 + Math.floor((rect.y1 - rect.y0) / 2);
        const label = opts.label;
        const start_x = rect.x0 + Math.max(0, Math.floor(((rect.x1 - rect.x0 + 1) - label.length) / 2));

        for (let i = 0; i < label.length; i++) {
            const x = start_x + i;
            if (x > rect.x1) break;

            const ch = label.charAt(i); // always a string ('' if out of range)
            if (!ch) continue;

            const rgb = opts.get_rgb ? opts.get_rgb() : opts.rgb;
            c.set(x, y, { char: ch, rgb, style: 'regular', weight_index: current_label_weight_index() });

        }

    }

    return {
        id: opts.id,
        rect,
        Focusable: opts.Focusable ?? true,

        Draw(c: Canvas): void {
            if (click_boost_frames > 0) click_boost_frames--;

            const bg = opts.get_bg ? opts.get_bg() : opts.bg;
            if (bg) c.fill_rect(rect, { char: bg.char, rgb: bg.rgb, style: 'regular' });

            // minimal state visibility (no real decor yet):
            // top-left marker: H = hovered, P = pressed
            const rgb = opts.get_rgb ? opts.get_rgb() : opts.rgb;
            if (hovered) c.set(rect.x0, rect.y1, { char: 'H', rgb, style: 'regular', weight_index: 5 });
            if (pressed) c.set(rect.x0 + 1, rect.y1, { char: 'P', rgb, style: 'regular', weight_index: 7 });


            draw_label(c);
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
            if (e.button === 0) pressed = true;

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

            // let right/middle/dblclick be handled by caller if they want
            opts.OnPress?.(e);
        },

    };
}
