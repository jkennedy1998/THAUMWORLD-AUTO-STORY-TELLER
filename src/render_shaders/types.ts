import type { Rgb, StyleName } from "../mono_ui/types.js";
import type { TagInstance } from "../tag_system/registry.js";
import type { EntityRenderProfile, RenderShaderBindings } from "./definitions.js";
import type { CardinalDirection, GraphicsModel, GroupRenderContext, InlineMaterialAssignments, RenderGraphicRef, ViewDirection } from "./graphics_contract.js";

export type RenderKind = 'tile' | 'item' | 'pile' | 'actor' | 'npc' | 'particle' | 'ui';

export type RenderWhere =
    | 'place_tile'
    | 'pile_ui'
    | 'container_ui'
    | 'character_slot'
    | 'drag_ghost'
    | 'tooltip'
    | 'debug';

export type RenderSpace = 'screen' | 'place' | 'ui';

export type RenderPayloadBase = {
    kind: RenderKind;
    id?: string;
    name?: string;
    tags?: TagInstance[];
    // Optional base style inputs supplied by the compositor/module.
    base_fg?: Rgb;
    render_shader?: RenderShaderBindings;
    graphics?: GraphicsModel;
    materials?: InlineMaterialAssignments;
    state?: Record<string, unknown>;
    facing?: ViewDirection | string;
    group_context?: GroupRenderContext;
};

export type ItemPayload = RenderPayloadBase & {
    kind: 'item';
    def_id?: string;
    qty?: number;
    display_char?: string;
};

export type PilePayload = RenderPayloadBase & {
    kind: 'pile';
    pile_count: number;
    single_qty?: number;
    def_id?: string;
    qty?: number;
    display_char?: string;
};

export type TilePayload = RenderPayloadBase & {
    kind: 'tile';
    tile_kind?: 'ground_items' | 'simple';
    def_id?: string;
    pile_count?: number;
    single_qty?: number;
    // For simple tiles (walls/doors/ui grid lines).
    char?: string;
    weight_index?: number;
    style?: StyleName;
};

export type UiPayload = RenderPayloadBase & {
    kind: 'ui';
    ui_kind: 'slot' | 'widget';
};

export type EntityPayload = RenderPayloadBase & {
    kind: 'actor' | 'npc';
    kind_id?: string;
    entity_render?: EntityRenderProfile;
};

export type UiSlotPayload = UiPayload & {
    ui_kind: 'slot';
    slot_type?: 'tool' | 'armor' | 'garb' | 'neutral';
    is_placeholder?: boolean;
};

export type UiWidgetPayload = UiPayload & {
    ui_kind: 'widget';
    widget: 'close' | 'move' | 'save_position' | 'resize' | 'seamless';
    widget_state?: 'idle' | 'active' | 'disabled';
};

export type RenderPayload = ItemPayload | PilePayload | TilePayload | EntityPayload | UiPayload | RenderPayloadBase;

// NOTE: RenderPayloadBase.kind is a wide union, so it cannot act as a discriminator.
// Use this discriminated form when adding non-item kinds.
export type DiscriminatedRenderPayload =
    | ItemPayload
    | PilePayload
    | TilePayload
    | EntityPayload
    | UiSlotPayload
    | UiWidgetPayload
    | (RenderPayloadBase & { kind: Exclude<RenderKind, 'item' | 'pile' | 'tile' | 'actor' | 'npc'> });

export type RenderUiState = {
    hovered?: boolean;
    highlighted?: boolean;
    selected?: boolean;
    targeted?: boolean;
    dragging?: boolean;
    default_container?: boolean;
    tool_mismatch?: boolean;
};

export type RenderContext = {
    where: RenderWhere;
    space?: RenderSpace;
    // Grid-space coordinates in the chosen space.
    x?: number;
    y?: number;
    screen_x?: number;
    screen_y?: number;
    place_x?: number;
    place_y?: number;
    world_x?: number;
    world_y?: number;
    time_ms?: number;
    breath_index?: number;
    ui?: RenderUiState;

    // Optional additional context for multi-voxel rendering.
    // These are intentionally loose so modules can pass richer semantics
    // without expanding the discriminated payload surface.
    body_part?: string;
    facing?: ViewDirection | string;
    view_direction?: ViewDirection;
    light_mag?: number;
    world_z?: number;
    focus_world_z?: number;
    place_base_z?: number;
    group_context?: GroupRenderContext;
    tile_neighbors?: Partial<Record<CardinalDirection, string | null>>;
};

export type RenderBlendMode = 'normal' | 'add' | 'multiply';

export type RenderLayer = {
    char: string;
    graphic?: RenderGraphicRef;
    fg?: Rgb;
    bg?: Rgb;
    z: number;
    blend?: RenderBlendMode;
    style?: StyleName;
    weight_index?: number;
    flags?: string[];
    materials?: InlineMaterialAssignments;
};

export type RenderOutput = {
    layers: RenderLayer[];
};
