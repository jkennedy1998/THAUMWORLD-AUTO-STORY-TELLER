import type { Canvas, Module, Rect, Rgb, PointerEvent } from '../types.js';

export type ButtonOptions = {
    id: string;
    rect: Rect;

    label: string;              // monospace text
    rgb: Rgb;                   // label color
    bg?: { char: string; rgb: Rgb }; // optional background fill

    Focusable?: boolean;

    // called on click; you can branch on e.button and e.click_count
    OnPress?: (e: PointerEvent) => void;
};

export function make_button_module(opts: ButtonOptions): Module {
    const rect = opts.rect;
    let hovered = false;
    let pressed = false;

    function draw_label(c: Canvas) {
        const y = rect.y0 + Math.floor((rect.y1 - rect.y0) / 2);
        const label = opts.label;
        const start_x = rect.x0 + Math.max(0, Math.floor(((rect.x1 - rect.x0 + 1) - label.length) / 2));

        for (let i = 0; i < label.length; i++) {
            const x = start_x + i;
            if (x > rect.x1) break;

            const ch = label.charAt(i); // always a string ('' if out of range)
            if (!ch) continue;

            c.set(x, y, { char: ch, rgb: opts.rgb, style: 'regular' });
        }

    }

    return {
        id: opts.id,
        rect,
        Focusable: opts.Focusable ?? true,

        Draw(c: Canvas): void {
            if (opts.bg) {
                c.fill_rect(rect, { char: opts.bg.char, rgb: opts.bg.rgb, style: 'regular' });
            }

            // minimal state visibility (no real decor yet):
            // top-left marker: H = hovered, P = pressed
            if (hovered) c.set(rect.x0, rect.y1, { char: 'H', rgb: opts.rgb, style: 'regular' });
            if (pressed) c.set(rect.x0 + 1, rect.y1, { char: 'P', rgb: opts.rgb, style: 'regular' });

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
            // let right/middle/dblclick be handled by caller if they want
            opts.OnPress?.(e);
        },
    };
}
