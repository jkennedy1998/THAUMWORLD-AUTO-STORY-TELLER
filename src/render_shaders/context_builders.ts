import type { RenderContext, RenderSpace, RenderUiState, RenderWhere } from "./types.js";

export function make_render_ctx(where: RenderWhere, space: RenderSpace, ui?: RenderUiState): RenderContext {
    return { where, space, ui };
}

export function ctx_place_tile(ui?: RenderUiState): RenderContext {
    return { where: 'place_tile', space: 'screen', ui };
}

export function ctx_container_ui(ui?: RenderUiState): RenderContext {
    return { where: 'container_ui', space: 'ui', ui };
}

export function ctx_character_slot(ui?: RenderUiState): RenderContext {
    return { where: 'character_slot', space: 'ui', ui };
}
