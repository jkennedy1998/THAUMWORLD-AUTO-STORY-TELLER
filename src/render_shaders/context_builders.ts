import type { RenderContext, RenderSpace, RenderUiState, RenderWhere } from "./types.js";
import type { CardinalDirection, ViewDirection } from "./graphics_contract.js";

export function make_render_ctx(where: RenderWhere, space: RenderSpace, ui?: RenderUiState): RenderContext {
    return { where, space, ui };
}

type PlaceTileCtxOpts = {
    ui?: RenderUiState;
    screen_x?: number;
    screen_y?: number;
    place_x?: number;
    place_y?: number;
    world_x?: number;
    world_y?: number;
    world_z?: number;
    focus_world_z?: number;
    place_base_z?: number;
    breath_index?: number;
    view_direction?: ViewDirection;
    light_mag?: number;
    tile_neighbors?: Partial<Record<CardinalDirection, string | null>>;
};

export function ctx_place_tile(ui?: RenderUiState): RenderContext;
export function ctx_place_tile(opts?: PlaceTileCtxOpts): RenderContext;
export function ctx_place_tile(arg?: RenderUiState | PlaceTileCtxOpts): RenderContext {
    const opts = (arg && ('ui' in arg || 'screen_x' in arg || 'screen_y' in arg || 'place_x' in arg || 'place_y' in arg || 'world_x' in arg || 'world_y' in arg || 'world_z' in arg || 'focus_world_z' in arg || 'place_base_z' in arg || 'breath_index' in arg || 'view_direction' in arg || 'light_mag' in arg || 'tile_neighbors' in arg))
        ? arg as PlaceTileCtxOpts
        : { ui: arg as RenderUiState | undefined };
    return {
        where: 'place_tile',
        space: 'place',
        ui: opts?.ui,
        screen_x: opts?.screen_x,
        screen_y: opts?.screen_y,
        place_x: opts?.place_x,
        place_y: opts?.place_y,
        world_x: opts?.world_x,
        world_y: opts?.world_y,
        world_z: opts?.world_z,
        focus_world_z: opts?.focus_world_z,
        place_base_z: opts?.place_base_z,
        breath_index: opts?.breath_index,
        view_direction: opts?.view_direction,
        light_mag: opts?.light_mag,
        tile_neighbors: opts?.tile_neighbors,
    };
}

export function ctx_container_ui(ui?: RenderUiState): RenderContext {
    return { where: 'container_ui', space: 'ui', ui };
}

export function ctx_character_slot(ui?: RenderUiState): RenderContext {
    return { where: 'character_slot', space: 'ui', ui };
}
