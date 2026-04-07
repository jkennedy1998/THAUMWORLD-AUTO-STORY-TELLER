import type { RenderContext, RenderLayer, RenderOutput, UiWidgetPayload } from "../types.js";

function pick_widget_char(widget: UiWidgetPayload['widget']): string {
    if (widget === 'move') return '#';
    if (widget === 'close') return 'X';
    if (widget === 'save_position') return '$';
    if (widget === 'resize') return '╋';
    if (widget === 'seamless') return 'S';
    return '?';
}

export function shade_ui_widget_default(payload: UiWidgetPayload, _ctx: RenderContext): RenderOutput {
    const char = pick_widget_char(payload.widget);
    const active = payload.widget_state === 'active';
    const layer: RenderLayer = {
        char,
        fg: payload.base_fg,
        z: 0,
        style: 'regular',
        weight_index: active ? 2 : 2,
    };
    return { layers: [layer] };
}
