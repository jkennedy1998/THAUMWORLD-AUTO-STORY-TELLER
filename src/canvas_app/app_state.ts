import { make_fill_module } from '../mono_ui/modules/fill_module.js';
import { make_button_module } from '../mono_ui/modules/button_module.js';
import { make_text_window_module, type TextWindowMessage } from '../mono_ui/modules/window_module.js';
import { make_input_module } from '../mono_ui/modules/input_module.js';
import { make_roller_module } from '../mono_ui/modules/roller_module.js';
import { make_place_module } from '../mono_ui/modules/place_module.js';
import type { SlotItem } from '../mono_ui/modules/container_module.js';
import { make_character_module, get_character_module_tag_row_at, type CharacterDropTarget } from '../mono_ui/modules/character_module.js';
import { make_owner_inventory_module } from '../mono_ui/modules/owner_inventory_module.js';
import { make_entity_editor_module } from '../mono_ui/modules/entity_editor_module.js';
import { make_tag_picker_module, type TagPickerDefinition, type TagPickerDraft, type TagPickerField } from '../mono_ui/modules/tag_picker_module.js';
import { make_actor_claim_module, type ActorClaimEntry } from '../mono_ui/modules/actor_claim_module.js';
import { make_character_creation_module, type CharacterCreationField } from '../mono_ui/modules/character_creation_module.js';
import { make_debug_commander_module, type DebugCommanderAction } from '../mono_ui/modules/debug_commander_module.js';
import { make_world_entry_module } from '../mono_ui/modules/world_entry_module.js';
import { make_world_join_module, type JoinableWorldEntry } from '../mono_ui/modules/world_join_module.js';
import { make_option_picker_module, type OptionPickerEntry } from '../mono_ui/modules/option_picker_module.js';
import { discover_joinable_worlds, fetch_local_host_status } from './world_discovery.js';
import { make_initiative_module } from '../mono_ui/modules/initiative_module.js';
import { make_toolbox_module } from '../mono_ui/modules/toolbox_module.js';
import { make_tool_properties_module, type ToolPropertyRow } from '../mono_ui/modules/tool_properties_module.js';
import { makeLayerPaletteModule } from '../ascii_painter/layer_palette_module.js';
import type { SlotType } from '../equipment/body_slot_resolver.js';
import type { Canvas, Module, PointerEvent, Rgb, Rect } from '../mono_ui/types.js';
import { create_module_registry, type ModuleRegistry } from '../mono_ui/module_registry.js';
import { handleEntityClick, set_current_actor_ref, set_session_token } from '../interface_program/frontend_api.js';
import type { Place, TilePosition } from '../types/place.js';
import { debug_warn, debug_log } from '../shared/debug.js';
import { resolve_char } from '../render_shaders/resolver.js';
import { can_place_volume } from '../place_storage/movement_legality.js';
import { set_command_handler_place } from '../mono_ui/modules/movement_command_handler.js';
import { get_color_by_name } from '../mono_ui/colors.js';
import type { ModuleGizmosConfig } from '../mono_ui/module_gizmos.js';
import { make_floating_panel_module } from '../mono_ui/modules/floating_panel_module.js';
import { make_program_nav_bar_module, type ProgramNavAction } from '../mono_ui/modules/program_nav_bar_module.js';
import { infer_action_verb_hint } from '../shared/intent_hint.js';
// NOTE: Do NOT import Node.js modules (load_actor, find_kind, etc.) here.
// This code runs in browser context and must use HTTP APIs instead.
import { calculate_grid_dimensions, get_container_grid } from '../container_storage/grid_calculator.js';
import { type ItemInstance } from '../item_instances/store.js';
import { type ItemDefinition } from '../item_storage/store.js';
import type { OwnerInventoryView, StorageSlot, StorageSurface } from '../inventory_surfaces/types.js';
import { get_container_id_from_target_id } from '../inventory_surfaces/target_ids.js';
import { tag_key } from '../tag_system/tag_key.js';
import type { TagInstance } from '../tag_system/registry.js';
import { resolve_grow_tag_configs } from '../mag/grow.js';
import { resolve_spoils_tag_config_from_states } from '../tag_system/index.js';
import { clamp_mag, normalize_signed_mag, project_container_max_slots, resolve_container_capacity_mag_from_states } from '../mag/index.js';
import { get_damage_dice_from_mag } from '../mag/damage.js';
import { is_tag_editor_visible } from '../tag_system/definitions.js';
import type { EquipmentSlots } from '../types/body_slots.js';
import { initWebSocketClient } from '../mono_ui/websocket_client.js';
import { DEBUG_VISION, set_debug_bundle_enabled, spawn_sense_broadcast_particles } from '../mono_ui/vision_debugger.js';
import { set_ui_debug_enabled, UI_DEBUG } from '../mono_ui/runtime/ui_debug.js';
import { get_senses_for_action } from '../action_system/sense_broadcast.js';
import { get_facing } from '../npc_ai/facing_system.js';
import { eval_body_model_voxels, get_body_model_def } from '../shared/body_model.js';
import { get_character_camera_focus_tile } from '../shared/character_camera_focus.js';
import { get_defined_place_world_zs as get_authored_place_world_zs, get_place_tile_kind_at_world_z as get_shared_place_tile_kind_at_world_z } from '../shared/place_layers.js';
import { get_flood_fill_points, get_line_points, get_rect_fill_points, get_rect_stroke_points, type PainterPoint } from '../shared/painter_tools.js';
import { play_sfx } from '../mono_ui/sfx/sfx_player.js';
import { format_interval_avg, format_interval_min, get_movement_debug_snapshot } from '../shared/movement_debug_state.js';
import { has_resolved_tag } from '../tag_system/canonical_readers.js';
import { get_character_id_from_ref } from '../shared/character_storage.js';
import { compute_adjacent_place_bounds, get_place_region_bounds, region_bounds_overlap, select_place_resize_face } from '../shared/place_adjacency.js';
import {
    api_transfer_inline,
} from './transfer_api.js';
import {
    THAUMWORLD_RENDER_THEME,
    get_theme_base_font_size_px,
    get_theme_font_family,
    get_theme_weight_index_to_css,
} from '../mono_ui/runtime/render_theme.js';
import { build_visible_plane_coordinates, get_principal_view_plane_axis, make_place_view_state, normalize_place_principal_view, normalize_place_view_roll_quarter_turn, rotate_place_view_roll, swing_place_view, type PlacePrincipalView, type PlaceViewRollQuarterTurn } from '../mono_ui/runtime/place_view_projection.js';

export const APP_CONFIG = {
    render_backend: THAUMWORLD_RENDER_THEME.backend,
    render_theme_id: THAUMWORLD_RENDER_THEME.id,
    font_family: get_theme_font_family(THAUMWORLD_RENDER_THEME),
    // Cell geometry is authoritative at 12x16. Font rendering fits inside that box.
    base_font_size_px: get_theme_base_font_size_px(THAUMWORLD_RENDER_THEME),
    base_line_height_mult: 1,
    base_letter_spacing_mult: 0,
    weight_index_to_css: get_theme_weight_index_to_css(THAUMWORLD_RENDER_THEME),

    grid_width: 200,  // Expanded: 160 for main UI + 40 for debug button column
    grid_height: 50,

    action_input_endpoint: 'http://localhost:8787/api/input',
    action_log_endpoint: 'http://localhost:8787/api/log',
    action_status_endpoint: 'http://localhost:8787/api/status',
    action_targets_endpoint: 'http://localhost:8787/api/targets',
    place_endpoint: 'http://localhost:8787/api/place',
    roller_status_endpoint: 'http://localhost:8787/api/roller_status',
    roller_roll_endpoint: 'http://localhost:8787/api/roll',
    selected_data_slot: 1,
    input_actor_id: '',
} as const;

const APP_PLACE_TIMING_VERSION = '2026-03-14-visible-pulse-v1';
const DEBUG_WINDOW_REFRESH_MS = 500;

type ItemMutationRefreshScope = 'place_render' | 'container_contents' | 'character_render';

type PlacePainterTool =
    | 'paint'
    | 'erase'
    | 'eyedropper'
    | 'line'
    | 'rect_stroke'
    | 'rect_fill'
    | 'bucket'
    | 'character'
    | 'move'
    | 'place_create'
    | 'place_delete'
    | 'place_resize'
    | 'region_tool';

type PlacePainterEraseTarget = 'tiles' | 'characters' | 'items';

function is_place_painter_shape_tool(tool: PlacePainterTool): tool is 'line' | 'rect_stroke' | 'rect_fill' {
    return tool === 'line' || tool === 'rect_stroke' || tool === 'rect_fill';
}

type ItemMutationRefreshIntent = {
    place_id?: string | null;
    actor_id?: string | null;
    npc_id?: string | null;
    scopes?: ItemMutationRefreshScope[];
    reasons?: string[];
};

type GroundItemMetaRecord = {
    id: string;
    def_id: string;
    name: string;
    qty: number;
    weight: number;
    tags: any[];
    display_char?: string;
    display_color?: string;
    elevation?: number;
    position_key?: string;
    voxel_key?: string;
    position?: { x: number; y: number };
};

type PlaceGroundItemCache = {
    by_id: Map<string, GroundItemMetaRecord>;
    by_voxel: Map<string, string[]>;
    by_position: Map<string, string[]>;
};

export type AppState = {
    modules: readonly Module[];
    update_layout: (grid_width: number, grid_height: number) => void;
    start_window_feed_polling: (interval_ms: number) => void;
    module_registry: ModuleRegistry;
    on_drag_end_outside: (x: number, y: number) => void;
    on_pointer_move_global: (x: number, y: number, e: any) => void;
    on_after_compose: (canvas: any) => void;
    set_current_place_pause_source: (source: string, paused: boolean) => Promise<boolean>;
    get_current_place_pause_state: () => { paused: boolean; time_scale: number; pause_sources: string[] };
    create_current_place_pause_controller: (source: string) => {
        source: string;
        is_active: () => boolean;
        activate: () => Promise<boolean>;
        deactivate: () => Promise<boolean>;
        toggle: () => Promise<boolean>;
    };
};

type WindowFeed = {
    window_id: string;
    fetch_messages: () => Promise<(string | TextWindowMessage)[]>;
};

/**
 * Check if an item definition represents a container type
 * Used for determining which equipped items appear in the container sidebar
 */
function is_container_item(definition: ItemDefinition): boolean {
    const container_tags = ['CONTAINER', 'BAG', 'SACK', 'POUCH', 'BACKPACK', 'WALLET', 'CHEST', 'BOX'];
    const tags = Array.isArray(definition.tags) ? definition.tags : [];
    return container_tags.some((tag) => tags.some((entry: any) => String(entry?.name ?? '').trim().toUpperCase() === tag));
}

function has_tag(tags: any[] | undefined | null, want: string): boolean {
    return Array.isArray(tags) && tags.some((entry: any) => String(entry?.name ?? '').trim().toUpperCase() === String(want ?? '').trim().toUpperCase());
}

export function create_app_state(): AppState {
    const reconnect_token_storage_key = 'thaumworld_reconnect_token';
    const controlled_actor_storage_key = 'thaumworld_controlled_actor_ref';
    let multiplayer_session_bootstrap_promise: Promise<void> | null = null;

    function get_or_create_reconnect_token(): string {
        const existing = String((APP_CONFIG as any).reconnect_token ?? '').trim();
        if (existing) return existing;
        let next = '';
        try {
            next = String(window.localStorage.getItem(reconnect_token_storage_key) ?? '').trim();
        } catch {
            next = '';
        }
        if (!next) {
            next = `reconnect_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
            try {
                window.localStorage.setItem(reconnect_token_storage_key, next);
            } catch {
                // ignore persistence failure; in-memory fallback still works for this run
            }
        }
        (APP_CONFIG as any).reconnect_token = next;
        return next;
    }

    async function ensure_multiplayer_session_bootstrap(force: boolean = false): Promise<void> {
        debug_log('[WORLD_BOOT]', `ensure_multiplayer_session_bootstrap force=${force} session_token=${String((APP_CONFIG as any).session_token ?? '').trim() ? 'present' : 'missing'}`);
        if (!force) {
            const existing_session_token = String((APP_CONFIG as any).session_token ?? '').trim();
            if (existing_session_token) return;
            if (multiplayer_session_bootstrap_promise) return multiplayer_session_bootstrap_promise;
        }
        const reconnect_token = get_or_create_reconnect_token();
        multiplayer_session_bootstrap_promise = fetch('http://localhost:8787/api/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                slot: APP_CONFIG.selected_data_slot,
                reconnect_token,
            }),
        }).then(async (res) => {
            const data = await res.json().catch(() => null) as any;
            if (!res.ok || !data?.ok) {
                debug_warn('[WORLD_BOOT]', 'multiplayer session bootstrap failed', { status: res.status, data });
                throw new Error(String(data?.error ?? `connect_failed:${res.status}`));
            }
            const next_session_token = String(data?.session_token ?? '').trim();
            const next_reconnect_token = String(data?.reconnect_token ?? reconnect_token).trim() || reconnect_token;
            if (!next_session_token) {
                throw new Error('connect_invalid_response');
            }
            (APP_CONFIG as any).session_token = next_session_token;
            (APP_CONFIG as any).connection_id = String(data?.connection_id ?? '').trim();
            (APP_CONFIG as any).reconnect_token = next_reconnect_token;
            set_session_token(next_session_token);
            debug_log('[WORLD_BOOT]', `multiplayer session ready connection=${String(data?.connection_id ?? 'unknown')}`);
            try {
                window.localStorage.setItem(reconnect_token_storage_key, next_reconnect_token);
            } catch {
                // ignore persistence failure
            }
            const wsClient = initWebSocketClient(undefined, { sessionToken: next_session_token, slot: APP_CONFIG.selected_data_slot });
            void wsClient;
        }).finally(() => {
            multiplayer_session_bootstrap_promise = null;
        });
        return multiplayer_session_bootstrap_promise;
    }

    async function refresh_joinable_worlds(): Promise<void> {
        ui_state.world_join.is_loading = true;
        try {
            const entries = await discover_joinable_worlds(APP_CONFIG.selected_data_slot);
            const previous_selected_world_id = ui_state.world_join.selected_world_id;
            ui_state.world_join.entries = entries;
            ui_state.world_join.selected_world_id = previous_selected_world_id && entries.some((entry) => entry.id === previous_selected_world_id)
                ? previous_selected_world_id
                : entries[0]?.id ?? null;
            ui_state.world_join.status_lines = entries.length > 0
                ? [
                    'local worlds detected',
                    String((entries.find((entry) => entry.id === ui_state.world_join.selected_world_id) ?? entries[0])?.description ?? 'join enabled'),
                  ]
                : ['no local world detected', 'launch a world first or start a local host'];
        } finally {
            ui_state.world_join.is_loading = false;
        }
    }

    function open_world_entry_module(): void {
        ui_state.world_entry.is_visible = true;
        ui_state.world_join.is_visible = false;
        ui_state.actor_claim.is_visible = false;
        ui_state.character_creation.is_visible = false;
        apply_runtime_module_visibility();
        void refresh_world_entry_status();
    }

    async function refresh_world_entry_status(): Promise<void> {
        const status = await fetch_local_host_status(APP_CONFIG.selected_data_slot);
        ui_state.world_entry.status_lines = status
            ? [
                `local host detected: ${String(status.world_label ?? `slot ${APP_CONFIG.selected_data_slot}`)}`,
                `join mode: ${String(status.join_mode ?? 'join enabled')}`,
                `services: ${(Array.isArray(status.services) ? status.services.length : 0).toString()}`,
              ]
            : [
                'no local host detected',
                'launch world will start or reuse a local host',
              ];
    }

    async function begin_world_session(): Promise<void> {
        ui_state.world_entry.status_lines = ['connecting to local host...', 'bootstrapping multiplayer session'];
        ui_state.world_join.status_lines = ['connecting to selected world...', 'bootstrapping multiplayer session'];
        debug_log('[WORLD_BOOT]', 'begin_world_session start');
        try {
            await ensure_multiplayer_session_bootstrap(true);
            debug_log('[WORLD_BOOT]', 'begin_world_session bootstrap ok');
            ui_state.world_entry.is_visible = false;
            ui_state.world_join.is_visible = false;
            apply_runtime_module_visibility();
            await refresh_controlled_actor_binding(true);
            debug_log('[WORLD_BOOT]', 'begin_world_session refresh_controlled_actor_binding complete');
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            debug_warn('[WORLD_BOOT]', 'begin_world_session failed', { message });
            ui_state.world_entry.is_visible = true;
            ui_state.world_join.is_visible = false;
            ui_state.world_entry.status_lines = [
                'failed to connect to local host',
                message,
                'restart with a host boot or launch again',
            ];
            apply_runtime_module_visibility();
            throw err;
        }
    }

    async function open_world_join_module(): Promise<void> {
        ui_state.world_entry.is_visible = false;
        ui_state.world_join.is_visible = true;
        ui_state.world_join.status_lines = ['searching for local worlds...'];
        apply_runtime_module_visibility();
        await refresh_joinable_worlds();
    }

    async function join_selected_world(): Promise<void> {
        if (!ui_state.world_join.selected_world_id) {
            ui_state.world_join.status_lines = ['select a world to join'];
            return;
        }
        try {
            await begin_world_session();
        } catch {
            ui_state.world_join.is_visible = true;
            ui_state.world_entry.is_visible = false;
            apply_runtime_module_visibility();
        }
    }

    function get_session_token(): string {
        return String((APP_CONFIG as any).session_token ?? '').trim();
    }

    function persist_controlled_actor_ref(actor_ref: string): void {
        const ref = String(actor_ref ?? '').trim();
        try {
            if (ref) window.localStorage.setItem(controlled_actor_storage_key, ref);
            else window.localStorage.removeItem(controlled_actor_storage_key);
        } catch {
            // ignore persistence failure
        }
    }

    function clear_controlled_actor_runtime_state(): void {
        (APP_CONFIG as any).input_actor_id = '';
        persist_controlled_actor_ref('');
        set_current_actor_ref('');
        ui_state.actor_claim.current_actor_ref = null;
        ui_state.actor_claim.selected_actor_ref = null;
        ui_state.actor_claim.game_ready = false;
        ui_state.controls.selected_target = null;
        ui_state.controls.targets = [];
        ui_state.controls.targets_ready = false;
        ui_state.container.owner_view = null;
        ui_state.container.open_containers.clear();
        ui_state.character.display_name = '';
        ui_state.character.equipped_items.clear();
        ui_state.character.body_slots = {} as EquipmentSlots;
        apply_runtime_module_visibility();
    }

    let unload_release_sent = false;
    function release_actor_claim_on_exit(): void {
        if (unload_release_sent) return;
        const session_token = String((APP_CONFIG as any).session_token ?? '').trim();
        if (!session_token || !get_controlled_actor_id()) {
            clear_controlled_actor_runtime_state();
            return;
        }
        unload_release_sent = true;
        try {
            const payload = JSON.stringify({
                slot: APP_CONFIG.selected_data_slot,
                session_token,
            });
            const url = 'http://localhost:8787/api/actors/release';
            if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
                const blob = new Blob([payload], { type: 'application/json' });
                navigator.sendBeacon(url, blob);
            } else {
                void fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: payload,
                    keepalive: true,
                }).catch(() => undefined);
            }
        } catch {
            // ignore exit-time release failures
        }
        clear_controlled_actor_runtime_state();
    }

    const WHITE: Rgb = get_color_by_name('off_white').rgb;
    const DEEP_RED: Rgb = get_color_by_name('deep_red').rgb;

    const ui_state = {
        text_windows: new Map<string, { messages: (string | TextWindowMessage)[]; rev: number }>(),
        status_override: { until_ms: 0, lines: [] as string[] },
        controls: {
            override_intent: null as string | null,
            override_cost: null as string | null,
            selected_target: null as string | null,
            volume: 'NORMAL' as 'WHISPER' | 'NORMAL' | 'SHOUT',
            move_mode: 'WALK' as 'WALK' | 'SNEAK' | 'SPRINT',
            last_sent_input_id: null as string | null,
            draft: "",
            suggested_intent: null as string | null,
            suggested_matched: null as string | null,
            last_infer_timer: null as number | null,
            targets: [] as Array<{ ref: string; label: string; type: string }>,
            region_label: null as string | null,
            targets_ready: false,
        },
        roller: {
            spinner: "|",
            last_roll: "",
            dice_label: "D20",
            disabled: true,
            roll_id: null as string | null,
        },
        timed_event_debug: {
            active: false,
            type: null as string | null,
            phase: null as string | null,
            trigger_kind: null as string | null,
            current_turn: null as number | null,
            current_round: null as number | null,
            active_actor_ref: null as string | null,
            turn_window_breaths: null as number | null,
            turn_breaths_remaining: null as number | null,
            timed_event_world_breath_index: null as number | null,
            pending_communication_opportunities: [] as Array<{
                opportunity_id: string;
                npc_ref: string;
                conversation_id: string | null;
                queue_entry_id: string | null;
                queue_stable_order: number | null;
                source_message_id: string;
                trigger_context: string | null;
                created_turn: number | null;
                created_round: number | null;
                status: string;
            }>,
            initiative_order: [] as Array<{
                actor_ref: string;
                initiative_roll: number;
                actions_remaining: number;
                partial_actions_remaining: number;
                movement_remaining: number;
                movement_budgets: { walk: number; climb: number; swim: number; fly: number } | null;
                status: string;
            }>,
        },
        place: {
            current_place_id: null as string | null,
            current_place: null as Place | null,
            current_region_id: null as string | null,
            current_region_bounds: null as null | { origin: { x: number; y: number; z: number }; size: { x: number; y: number; z: number } },
            actor_current_place_id: null as string | null,
            scene_selected_place_id: null as string | null,
            scene_places: [] as Place[],
            scene_visible_place_ids: [] as string[],
            scene_graph_version: 0,
            scene_connector_hops_visible: 1,
            npc_movement_active: false,
            camera_target: {
                mode: 'follow_actor' as 'follow_actor' | 'free',
                tile: null as { x: number; y: number } | null,
                region_pose: null as null | { x: number; y: number; z: number },
                last_follow_update_ms: 0,
            },
            // World focus layer for Place DOM renderer (0/1/2)
            focus_z: 0,
            principal_view: 'top' as PlacePrincipalView,
            view_roll_quarter_turn: 0 as PlaceViewRollQuarterTurn,
            use_focus_layer_opacity: true,
            // World-Z center for the 3-layer viewport window.
            // Interpreted as an absolute elevation value; layers represent [center-1, center, center+1].
            world_z_center: 0,
            // Mouse parallax normalized (-1..+1) centered on Place viewport
            mouse_parallax: { x: 0, y: 0 },
            pause_state: {
                paused: false,
                time_scale: 1,
                pause_sources: [] as string[],
            },
            // Ground item cache (inline ground_store) for richer interactions (pile/single/container detection)
            ground_items_by_id: new Map<string, GroundItemMetaRecord>(),
            // Map of voxel position keys: "x_y_z" -> [item ids]
            ground_items_by_voxel: new Map<string, string[]>(),
            // Convenience map: "x_y" -> [item ids across all z]
            ground_items_by_position: new Map<string, string[]>(),
            // Authoritative per-place ground item caches used by the renderer.
            ground_item_caches_by_place: new Map<string, PlaceGroundItemCache>(),
        },
    place_painter: {
        active: false,
        selected_tool: 'paint' as PlacePainterTool,
        left_click_tool: 'paint' as PlacePainterTool,
        right_click_tool: 'erase' as PlacePainterTool,
        entity_inspector_mode: 'replace' as 'replace' | 'duplicate',
        left_brush_size: 1,
        right_brush_size: 1,
        left_erase_targets: {
            tiles: true,
            characters: false,
            items: false,
        } as Record<PlacePainterEraseTarget, boolean>,
        right_erase_targets: {
            tiles: true,
            characters: false,
            items: false,
        } as Record<PlacePainterEraseTarget, boolean>,
        active_property_side: 'left' as 'left' | 'right',
        selected_palette_kind: 'tile' as 'tile' | 'item',
            selected_tile_palette_section: 'blocks' as 'blocks' | 'connectors' | 'all',
            selected_palette_entry_id: null as string | null,
            selected_item_palette_entry_id: null as string | null,
            tile_palette_entries: [] as Array<{
                id: string;
                name: string;
                display_char: string;
                display_color: string;
                section: 'blocks' | 'connectors';
                body_model?: { physical?: Array<{ dx: number; dy: number; dz: number }> } | null;
            }>,
            item_palette_entries: [] as Array<{
                id: string;
                name: string;
                display_char: string;
                display_color: string;
            }>,
            tile_palette_loaded: false,
            item_palette_loaded: false,
            last_primary_target: null as null | {
                place_id: string;
                x: number;
                y: number;
                z: number;
                entity_ref?: string;
                entity_type?: 'npc' | 'actor' | 'item' | 'pile' | 'structure';
            },
            move_pending_source: null as null | {
                place_id: string;
                x: number;
                y: number;
                z: number;
                entity_ref: string;
                entity_type: 'npc' | 'actor' | 'item' | 'pile' | 'structure';
            },
            move_drag_session: null as null | {
                place_id: string;
                source_x: number;
                source_y: number;
                source_z: number;
                entity_ref: string;
                entity_type: 'npc' | 'actor' | 'item' | 'pile' | 'structure';
                display_char: string;
                display_color: string;
                body_model?: { physical?: Array<{ dx: number; dy: number; dz: number }> } | null;
                body_model_id?: string;
                facing?: string | null;
                name?: string;
                tags?: any[];
                kind_id?: string;
                entity_render?: any;
                target_x: number;
                target_y: number;
                target_z: number;
                valid: boolean;
            },
            shape_session: null as null | {
                tool: 'line' | 'rect_stroke' | 'rect_fill';
                button: number;
                place_id: string;
                world_z: number;
                start_x: number;
                start_y: number;
                current_x: number;
                current_y: number;
            },
            resize_session: null as null | {
                active: boolean;
                place_id: string;
                face: 'x+' | 'x-' | 'y+' | 'y-' | 'z+' | 'z-';
                phase: 'targeting';
                start_bounds: { origin: { x: number; y: number; z: number }; size: { x: number; y: number; z: number } };
                proposed_bounds: { origin: { x: number; y: number; z: number }; size: { x: number; y: number; z: number } };
                valid: boolean;
                conflict_place_id?: string;
                target_coord: number;
            },
        },
        container: {
            is_visible: false,  // Toggle with 'i' key
            slot_items: [] as SlotItem[],
            owner_view: null as OwnerInventoryView | null,
            is_open: true,
            // Phase 7: Track open container modules for visual state
            open_containers: new Set<string>(), // Set of container_ids that are currently open
            // Phase 7: Track containers currently being opened (prevents double-clicks)
            opening_containers: new Set<string>(),
            // Phase 7: Track container_id -> module_id mapping for closing
            container_module_map: new Map<string, string>(), // container_id -> module_id
            // Redirect support: alias container ids (e.g. 2nd tile of a wide chest) -> canonical container id.
            canonical_by_alias: new Map<string, string>(),
            aliases_by_canonical: new Map<string, string[]>(),
            // Container window slots (1..5): stable positions by slot index
            container_slot_by_container_id: new Map<string, number>(),
            container_slots: [null, null, null, null, null] as Array<string | null>,
            // Track owner-view payloads for all open inventory windows.
            owner_view_by_container_id: new Map<string, OwnerInventoryView>(),
        },
        character: {
            is_visible: true,  // Always visible for now
            display_name: '',
            render_meta: {
                kind_id: null as string | null,
                body_model_id: null as string | null,
                entity_render: null as any,
                tags: [] as any[],
            },
            body_slots: {} as EquipmentSlots,
            equipped_items: new Map() as Map<string, { instance: ItemInstance; definition: ItemDefinition }>,
            weight: { current: 0, max: 100 },
            // Player-selected default container (body_slots path like "body_slots.leg_left.garb.0")
            default_container_id: null as string | null,
            highlighted_slots: [] as Array<{ slot_name: string; slot_type: SlotType; garb_index?: number }>,  // Slots highlighted when hovering compatible items
            hovered_item: null as { name: string; source: string } | null,  // Currently hovered item for debug display
            hovered_slot: null as string | null,  // Currently hovered body slot
            highlighted_items: [] as Array<{ container_id: string; slot_index: number }>,  // Items highlighted when hovering slot
        },
        character_editor: {
            character_ref: null as string | null,
            role: null as 'actor' | 'npc' | null,
            original: null as Record<string, unknown> | null,
            draft: {
                name: '',
                title: '',
                kind: '',
                sex: '',
                age: '',
            },
            status_lines: ['Place painter only'],
            dirty: false,
            saving: false,
        },
        tile_editor: {
            tile_ref: null as string | null,
            place_id: null as string | null,
            x: 0,
            y: 0,
            z: 0,
            original: null as Record<string, unknown> | null,
            status_lines: ['Place painter only'],
            saving: false,
        },
        item_editor: {
            item_ref: null as string | null,
            owner_kind: null as null | 'actor' | 'npc' | 'place',
            owner_id: null as string | null,
            original: null as Record<string, unknown> | null,
            status_lines: ['Place painter only'],
            saving: false,
        },
        entity_inspector: {
            is_visible: false,
            entity_ref: null as string | null,
            entity_kind: null as null | 'character' | 'tile' | 'item',
        },
        tag_picker: {
            is_visible: false,
            entity_ref: null as string | null,
            selected_tag_key: null as string | null,
            selected_field: 'name' as TagPickerField,
            original_name: '' as string,
            draft: null as TagPickerDraft | null,
            definition: null as TagPickerDefinition | null,
            meta_text: '' as string,
            status_lines: ['Place painter only'],
            applying: false,
        },
        option_picker: {
            is_visible: false,
            title: 'PICKER',
            target_kind: null as null | 'character_editor' | 'tag_picker' | 'character_creation',
            target_field: null as string | null,
            options: [] as OptionPickerEntry[],
            selected_value: null as string | null,
            status_lines: [] as string[],
        },
        character_creation: {
            is_visible: false,
            is_loading: false,
            is_submitting: false,
            selected_field: 'name' as string,
            draft: {
                kind: '',
                title: '',
                name: '',
                sex: 'female',
            },
            preview: {
                size_mag: 0,
                carry_capacity: 0,
                base_stats: { con: 0, str: 0, dex: 0, wis: 0, int: 0, cha: 0 },
                effective_stats: { con: 0, str: 0, dex: 0, wis: 0, int: 0, cha: 0 },
                kind_stat_changes: { con: 0, str: 0, dex: 0, wis: 0, int: 0, cha: 0 } as Record<string, number>,
            },
            bootstrap: {
                kinds: [] as OptionPickerEntry[],
                sex_options: [] as OptionPickerEntry[],
            },
            status_lines: ['choose a kind', 'type a name and title'],
            created_actor_ref: null as string | null,
        },
        world_entry: {
            is_visible: true,
            status_lines: ['choose how to connect', 'launch starts or reuses a local world host'],
        },
        world_join: {
            is_visible: false,
            is_loading: false,
            selected_world_id: null as string | null,
            entries: [] as JoinableWorldEntry[],
            status_lines: ['searching for local worlds...'],
        },
        actor_claim: {
            is_visible: false,
            is_blocking: false,
            is_loading: false,
            is_submitting: false,
            game_ready: false,
            title: 'CLAIM ACTOR',
            selected_actor_ref: null as string | null,
            current_actor_ref: null as string | null,
            actors: [] as ActorClaimEntry[],
            status_lines: [] as string[],
            error: null as string | null,
            open_reason: null as null | 'startup_required' | 'saved_actor_claimed' | 'manual_claim' | 'post_release' | 'pre_input_required' | 'claim_failed',
            guest_label: 'Guest session' as string,
        },
        debug_commander: {
            selected_action_id: null as string | null,
            status_lines: ['debug commands', 'click or press enter to run'],
        },
        // Module management (Phase 7.5)
        modules: {
            registry: null as ModuleRegistry | null,
            positions: new Map<string, Rect>(),
            visibility: new Map<string, boolean>(),
            open_npc_modules: new Set<string>(),
        },
        entity_tags_by_ref: new Map<string, TagInstance[]>(),
    };

    // Keep the current place "active" on the server so breath continues to tick
    // even when the UI is not polling /api/place.
    let place_touch_interval_id: number | null = null;
    let place_touch_place_id: string | null = null;
    const owned_current_place_pause_sources = new Set<string>();
    let poll_window_feeds_in_flight = false;
    let poll_window_feeds_interval_id: number | null = null;
    let poll_window_feeds_interval_ms: number | null = null;
    let refresh_character_data_in_flight = false;
    let last_transcript_poll_ms = 0;
    let last_targets_poll_ms = 0;
    let last_roller_poll_ms = 0;
    let last_character_refresh_ms = 0;
    let last_debug_window_refresh_ms = 0;
    let last_debug_window_signature = '';

    const renderer_debug = {
        render_count: 0,
        last_render_ms: 0,
        last_render_delta_ms: 0,
        last_render_fps: 0,
        render_window_started_ms: 0,
        render_window_samples: 0,
        render_window_dt_sum_ms: 0,
        render_window_dt_max_ms: 0,
        render_window_hitch_33_count: 0,
        render_window_hitch_50_count: 0,
        render_window_hitch_100_count: 0,
        render_window_avg_fps: 0,
        place_fetch_count: 0,
        last_place_fetch_started_ms: 0,
        last_place_fetch_completed_ms: 0,
        last_place_fetch_elapsed_ms: 0,
        last_place_fetch_place_id: null as string | null,
        last_place_fetch_breath_index: 0,
        breath_observed_count: 0,
        last_place_breath_index: 0,
        last_place_breath_changed_ms: 0,
        actor_pos_change_count: 0,
        last_actor_pos_key: null as string | null,
        last_actor_pos_changed_ms: 0,
    };

    function age_ms_string(ts: number): string {
        if (!Number.isFinite(ts) || ts <= 0) return '-';
        return `${Math.max(0, Math.round(Date.now() - ts))}ms ago`;
    }

    function avg_to_fps(avg_dt_ms: number): number {
        return avg_dt_ms > 0 ? Math.max(0, Math.round(1000 / avg_dt_ms)) : 0;
    }

    function interval_stats_string(stats: { count: number; last_ms: number; max_ms: number; sum_ms: number; min_ms: number }): string {
        const avg = format_interval_avg(stats as any);
        const min = format_interval_min(stats as any);
        return `last:${stats.last_ms} avg:${avg} min:${min} max:${stats.max_ms}`;
    }

    function intent_string(intent: { dx: number; dy: number } | null): string {
        if (!intent) return 'none';
        if (intent.dx === 1) return 'E';
        if (intent.dx === -1) return 'W';
        if (intent.dy === 1) return 'N';
        if (intent.dy === -1) return 'S';
        return `${intent.dx},${intent.dy}`;
    }

    function classify_movement_stage(snapshot: ReturnType<typeof get_movement_debug_snapshot>): string {
        const now = Date.now();
        const input_age = snapshot.last_input_changed_ms > 0 ? now - snapshot.last_input_changed_ms : Number.POSITIVE_INFINITY;
        const intent_age = snapshot.last_intent_observed_ms > 0 ? now - snapshot.last_intent_observed_ms : Number.POSITIVE_INFINITY;
        const post_age = snapshot.last_intent_post_ok_ms > 0 ? now - snapshot.last_intent_post_ok_ms : Number.POSITIVE_INFINITY;
        const breath_age = snapshot.last_breath_rx_ms > 0 ? now - snapshot.last_breath_rx_ms : Number.POSITIVE_INFINITY;
        const batch_age = snapshot.last_move_batch_rx_ms > 0 ? now - snapshot.last_move_batch_rx_ms : Number.POSITIVE_INFINITY;
        const step_age = snapshot.last_visible_step_ms > 0 ? now - snapshot.last_visible_step_ms : Number.POSITIVE_INFINITY;
        if (snapshot.last_intent_post_failed_ms > snapshot.last_intent_post_ok_ms) return 'intent_post_fail';
        if (snapshot.current_intent && input_age < 1000 && intent_age > 200) return 'intent_sample_gap';
        if (snapshot.current_intent && intent_age < 500 && post_age > 400) return 'intent_send_gap';
        if (snapshot.current_intent && post_age < 1000 && breath_age > 250) return 'server_breath_gap';
        if (snapshot.current_intent && breath_age < 250 && batch_age > 250) return 'bridge_move_gap';
        if (snapshot.current_intent && batch_age < 250 && step_age > 250) return 'visible_step_gap';
        if (!snapshot.current_intent) return 'idle';
        return 'flowing';
    }

    function is_movement_activity_high(): boolean {
        const snapshot = get_movement_debug_snapshot();
        const now = Date.now();
        if (snapshot.current_intent) return true;
        if (snapshot.last_visible_step_ms > 0 && (now - snapshot.last_visible_step_ms) < 1500) return true;
        if (snapshot.last_intent_changed_ms > 0 && (now - snapshot.last_intent_changed_ms) < 1500) return true;
        return false;
    }

    function stop_place_touch_heartbeat(): void {
        if (place_touch_interval_id !== null) {
            window.clearInterval(place_touch_interval_id);
            place_touch_interval_id = null;
        }
        place_touch_place_id = null;
    }

    async function send_place_touch_heartbeat(): Promise<void> {
        const place_id = ui_state.place.current_place_id;
        if (!place_id) return;

        const base_url = APP_CONFIG.place_endpoint.replace('/api/place', '');
        try {
            await fetch(`${base_url}/api/place/touch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    slot: APP_CONFIG.selected_data_slot,
                    place_id,
                }),
            });
        } catch {
            // Ignore transient failures; the next heartbeat will retry.
        }
    }

    function ensure_place_touch_heartbeat_running(): void {
        const place_id = ui_state.place.current_place_id;
        if (!place_id) {
            stop_place_touch_heartbeat();
            return;
        }

        if (place_touch_interval_id !== null && place_touch_place_id === place_id) {
            return;
        }

        stop_place_touch_heartbeat();
        place_touch_place_id = place_id;

        // Kick immediately, then keep alive every 2s.
        void send_place_touch_heartbeat();
        place_touch_interval_id = window.setInterval(() => {
            void send_place_touch_heartbeat();
        }, 2000);
    }

    function apply_place_pause_state(next: any): void {
        const paused = next?.paused === true;
        const time_scale_raw = Number(next?.time_scale);
        const pause_sources = Array.isArray(next?.pause_sources)
            ? next.pause_sources.map((entry: any) => String(entry)).filter((entry: string) => entry.length > 0)
            : [];
        ui_state.place.pause_state = {
            paused,
            time_scale: Number.isFinite(time_scale_raw) ? time_scale_raw : (paused ? 0 : 1),
            pause_sources,
        };
    }

    function is_current_place_paused_by(source: string): boolean {
        return ui_state.place.pause_state.pause_sources.includes(String(source));
    }

    async function release_owned_place_pause_sources(place_id: string | null): Promise<void> {
        if (!place_id || owned_current_place_pause_sources.size < 1) return;
        const sources = Array.from(owned_current_place_pause_sources);
        for (const source of sources) {
            await set_place_pause_source(place_id, source, false);
        }
    }

    async function set_place_pause_source(place_id: string, source: string, paused: boolean): Promise<boolean> {
        if (!place_id) return false;
        const base_url = APP_CONFIG.place_endpoint.replace('/api/place', '');
        try {
            debug_log('[PLACE_PAUSE_UI] toggle request', { place_id, source, paused });
            const res = await fetch(`${base_url}/api/place/pause`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    slot: APP_CONFIG.selected_data_slot,
                    place_id,
                    source,
                    paused,
                }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.ok) {
                debug_warn('[PLACE_PAUSE_UI] toggle request failed', { place_id, source, paused, status: res.status, data });
                return false;
            }
            apply_place_pause_state(data.pause_state);
            debug_log('[PLACE_PAUSE_UI] toggle response', { place_id, source, paused, pause_state: data.pause_state });
            return true;
        } catch {
            return false;
        }
    }

    async function fetch_current_place_pause_state(place_id: string): Promise<{ ok: boolean; pause_state?: { paused: boolean; time_scale: number; pause_sources: string[] } }> {
        if (!place_id) return { ok: false };
        const base_url = APP_CONFIG.place_endpoint.replace('/api/place', '');
        try {
            const params = new URLSearchParams({
                slot: String(APP_CONFIG.selected_data_slot),
                place_id,
            });
            const res = await fetch(`${base_url}/api/place/pause?${params.toString()}`);
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.ok || !data?.pause_state) {
                debug_warn('[PLACE_PAUSE_UI] state fetch failed', { place_id, status: res.status, data });
                return { ok: false };
            }
            apply_place_pause_state(data.pause_state);
            debug_log('[PLACE_PAUSE_UI] state fetch', { place_id, pause_state: data.pause_state });
            return { ok: true, pause_state: data.pause_state };
        } catch {
            return { ok: false };
        }
    }

    async function set_current_place_pause_source(source: string, paused: boolean): Promise<boolean> {
        const place_id = ui_state.place.current_place_id;
        if (!place_id) return false;
        const ok = await set_place_pause_source(place_id, source, paused);
        if (!ok) return false;
        if (paused) owned_current_place_pause_sources.add(String(source));
        else owned_current_place_pause_sources.delete(String(source));
        return true;
    }

    async function ensure_place_painter_tile_palette_loaded(): Promise<boolean> {
        if (ui_state.place_painter.tile_palette_loaded && ui_state.place_painter.tile_palette_entries.length > 0) {
            return true;
        }
        const base_url = APP_CONFIG.place_endpoint.replace('/api/place', '');
        try {
            const res = await fetch(`${base_url}/api/place_painter/tiles`);
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.ok || !Array.isArray(data.tiles)) {
                return false;
            }
            ui_state.place_painter.tile_palette_entries = data.tiles.map((entry: any) => ({
                id: String(entry?.id ?? ''),
                name: String(entry?.name ?? entry?.id ?? ''),
                display_char: String(entry?.display_char ?? '?'),
                display_color: String(entry?.display_color ?? '#888888'),
                section: String(entry?.section ?? (String(entry?.id ?? '') === 'place_connector' ? 'connectors' : 'blocks')) === 'connectors' ? 'connectors' : 'blocks',
                body_model: entry?.body_model ?? null,
            })).filter((entry: { id: string }) => entry.id.length > 0);
            ui_state.place_painter.tile_palette_loaded = true;
            if (!ui_state.place_painter.selected_palette_entry_id && ui_state.place_painter.tile_palette_entries.length > 0) {
                ui_state.place_painter.selected_palette_entry_id = ui_state.place_painter.tile_palette_entries[0]!.id;
            }
            return ui_state.place_painter.tile_palette_entries.length > 0;
        } catch {
            return false;
        }
    }

    async function ensure_place_painter_item_palette_loaded(): Promise<boolean> {
        if (ui_state.place_painter.item_palette_loaded && ui_state.place_painter.item_palette_entries.length > 0) {
            return true;
        }
        const base_url = APP_CONFIG.place_endpoint.replace('/api/place', '');
        try {
            const res = await fetch(`${base_url}/api/place_painter/items`);
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.ok || !Array.isArray(data.items)) {
                return false;
            }
            ui_state.place_painter.item_palette_entries = data.items.map((entry: any) => ({
                id: String(entry?.id ?? ''),
                name: String(entry?.name ?? entry?.id ?? ''),
                display_char: String(entry?.display_char ?? '·'),
                display_color: String(entry?.display_color ?? '#9da5ae'),
            })).filter((entry: { id: string }) => entry.id.length > 0);
            ui_state.place_painter.item_palette_loaded = true;
            if (!ui_state.place_painter.selected_item_palette_entry_id && ui_state.place_painter.item_palette_entries.length > 0) {
                ui_state.place_painter.selected_item_palette_entry_id = ui_state.place_painter.item_palette_entries[0]!.id;
            }
            return ui_state.place_painter.item_palette_entries.length > 0;
        } catch {
            return false;
        }
    }

    function get_selected_place_painter_tile_entry(): {
        id: string;
        name: string;
        display_char: string;
        display_color: string;
        section: 'blocks' | 'connectors';
        body_model?: { physical?: Array<{ dx: number; dy: number; dz: number }> } | null;
    } | null {
        const selected_id = ui_state.place_painter.selected_palette_entry_id;
        if (!selected_id) return null;
        return ui_state.place_painter.tile_palette_entries.find((entry) => entry.id === selected_id) ?? null;
    }

    function get_active_place_painter_tile_entries(): Array<{
        id: string;
        name: string;
        display_char: string;
        display_color: string;
        section: 'blocks' | 'connectors';
        body_model?: { physical?: Array<{ dx: number; dy: number; dz: number }> } | null;
    }> {
        const section = ui_state.place_painter.selected_tile_palette_section;
        const entries = ui_state.place_painter.tile_palette_entries;
        if (section === 'all') return entries;
        return entries.filter((entry) => entry.section === section);
    }

    function get_selected_place_painter_item_entry(): {
        id: string;
        name: string;
        display_char: string;
        display_color: string;
    } | null {
        const selected_id = ui_state.place_painter.selected_item_palette_entry_id;
        if (!selected_id) return null;
        return ui_state.place_painter.item_palette_entries.find((entry) => entry.id === selected_id) ?? null;
    }

    function get_place_painter_tool_for_button(button?: number): PlacePainterTool {
        return button === 2
            ? ui_state.place_painter.right_click_tool
            : ui_state.place_painter.left_click_tool;
    }

    function get_place_painter_tool_for_side(side: 'left' | 'right'): PlacePainterTool {
        return side === 'right'
            ? ui_state.place_painter.right_click_tool
            : ui_state.place_painter.left_click_tool;
    }

    function get_place_painter_brush_size_for_side(side: 'left' | 'right'): number {
        return side === 'right'
            ? ui_state.place_painter.right_brush_size
            : ui_state.place_painter.left_brush_size;
    }

    function set_place_painter_brush_size_for_side(side: 'left' | 'right', size: number): void {
        const next = Math.max(1, Math.min(5, Math.floor(size)));
        if (side === 'right') ui_state.place_painter.right_brush_size = next;
        else ui_state.place_painter.left_brush_size = next;
        ui_state.place_painter.active_property_side = side;
        save_place_painter_prefs_debounced();
    }

    function get_place_painter_side_for_button(button?: number): 'left' | 'right' {
        return button === 2 ? 'right' : 'left';
    }

    function get_place_painter_erase_targets_for_side(side: 'left' | 'right'): Record<PlacePainterEraseTarget, boolean> {
        return side === 'right'
            ? ui_state.place_painter.right_erase_targets
            : ui_state.place_painter.left_erase_targets;
    }

    function is_place_painter_erase_target_enabled(target: PlacePainterEraseTarget, side: 'left' | 'right'): boolean {
        return get_place_painter_erase_targets_for_side(side)[target] === true;
    }

    function toggle_place_painter_erase_target(target: PlacePainterEraseTarget, side: 'left' | 'right'): void {
        const targets = get_place_painter_erase_targets_for_side(side);
        targets[target] = !targets[target];
        ui_state.place_painter.active_property_side = side;
        save_place_painter_prefs_debounced();
    }

    function get_place_painter_erase_targets_summary_for_side(side: 'left' | 'right'): string {
        const enabled: string[] = [];
        if (is_place_painter_erase_target_enabled('tiles', side)) enabled.push('T');
        if (is_place_painter_erase_target_enabled('characters', side)) enabled.push('C');
        if (is_place_painter_erase_target_enabled('items', side)) enabled.push('I');
        return enabled.length > 0 ? enabled.join('') : 'none';
    }

    function get_place_painter_erase_targets_summary(): string {
        return `L:${get_place_painter_erase_targets_summary_for_side('left')} R:${get_place_painter_erase_targets_summary_for_side('right')}`;
    }

    function get_place_painter_brush_points(x: number, y: number, size: number): PainterPoint[] {
        const span = Math.max(1, Math.min(5, Math.floor(size)));
        const start_x = x - Math.floor(span / 2);
        const start_y = y - Math.floor(span / 2);
        return get_rect_fill_points(start_x, start_y, start_x + span - 1, start_y + span - 1);
    }

    function set_place_painter_selected_tile_by_id(id: string): boolean {
        const entry = ui_state.place_painter.tile_palette_entries.find((it) => it.id === id);
        if (!entry) return false;
        ui_state.place_painter.selected_palette_kind = 'tile';
        ui_state.place_painter.selected_palette_entry_id = entry.id;
        save_place_painter_prefs_debounced();
        return true;
    }

    function set_place_painter_selected_item_by_id(id: string): boolean {
        const entry = ui_state.place_painter.item_palette_entries.find((it) => it.id === id);
        if (!entry) return false;
        ui_state.place_painter.selected_palette_kind = 'item';
        ui_state.place_painter.selected_item_palette_entry_id = entry.id;
        save_place_painter_prefs_debounced();
        return true;
    }

    function toggle_place_painter_palette_kind(): void {
        ui_state.place_painter.selected_palette_kind = ui_state.place_painter.selected_palette_kind === 'tile' ? 'item' : 'tile';
        save_place_painter_prefs_debounced();
    }

    function cycle_place_painter_tile_palette_section(): void {
        const order: Array<'blocks' | 'connectors' | 'all'> = ['blocks', 'connectors', 'all'];
        const idx = order.indexOf(ui_state.place_painter.selected_tile_palette_section);
        const next = order[(idx + 1) % order.length] ?? 'blocks';
        ui_state.place_painter.selected_tile_palette_section = next;
        const active_entries = get_active_place_painter_tile_entries();
        if (!active_entries.some((entry) => entry.id === ui_state.place_painter.selected_palette_entry_id)) {
            ui_state.place_painter.selected_palette_entry_id = active_entries[0]?.id ?? ui_state.place_painter.tile_palette_entries[0]?.id ?? null;
        }
        save_place_painter_prefs_debounced();
    }

    function get_place_tile_kind_at(place: Place | null, x: number, y: number, z: number): string | null {
        return get_shared_place_tile_kind_at_world_z(place, x, y, z);
    }

    function get_place_painter_shape_preview_points(): PainterPoint[] {
        const session = ui_state.place_painter.shape_session;
        if (!session) return [];
        if (session.tool === 'line') return get_line_points(session.start_x, session.start_y, session.current_x, session.current_y);
        if (session.tool === 'rect_stroke') return get_rect_stroke_points(session.start_x, session.start_y, session.current_x, session.current_y);
        return get_rect_fill_points(session.start_x, session.start_y, session.current_x, session.current_y);
    }

    function clear_place_painter_shape_session(): void {
        ui_state.place_painter.shape_session = null;
    }

    function get_defined_place_world_zs(place: Place | null): number[] {
        const baseZ = Math.floor(Number((place as any)?.coordinates?.elevation ?? 0)) || 0;
        const out = new Set<number>(get_authored_place_world_zs(place));

        for (const actor of place?.contents?.actors_present ?? []) {
            const wz0 = get_entity_camera_anchor_world_z(actor as any, String((actor as any)?.actor_ref ?? ''), baseZ);
            out.add(wz0);
            const def = get_body_model_def((actor as any)?.body_model_id);
            const voxels = eval_body_model_voxels(def, { mode: 'render', facing: get_facing(String((actor as any)?.actor_ref ?? '')) });
            if (Array.isArray(voxels) && voxels.length > 0) {
                for (const v of voxels) out.add(wz0 + Math.floor(Number((v as any)?.dz ?? 0)));
            }
        }

        for (const npc of place?.contents?.npcs_present ?? []) {
            const wz0 = get_entity_camera_anchor_world_z(npc as any, String((npc as any)?.npc_ref ?? ''), baseZ);
            out.add(wz0);
            const def = get_body_model_def((npc as any)?.body_model_id);
            const voxels = eval_body_model_voxels(def, { mode: 'render', facing: get_facing(String((npc as any)?.npc_ref ?? '')) });
            if (Array.isArray(voxels) && voxels.length > 0) {
                for (const v of voxels) out.add(wz0 + Math.floor(Number((v as any)?.dz ?? 0)));
            }
        }

        for (const s of (place as any)?.structures ?? []) {
            const oz = Math.floor(Number((s as any)?.origin?.z ?? baseZ));
            const phys = Array.isArray((s as any)?.body_model?.physical)
                ? (s as any).body_model.physical
                : [{ dz: 0 }];
            for (const v of phys) out.add(oz + Math.floor(Number((v as any)?.dz ?? 0)));
        }

        if (out.size === 0) out.add(baseZ);
        return Array.from(out).sort((a, b) => a - b);
    }

    function set_place_focus_world_z(world_z: number): void {
        const place = get_current_place();
        const zs = get_defined_place_world_zs(place);
        const idx = zs.findIndex((z) => z === Math.floor(world_z));
        if (idx >= 0) {
            ui_state.place.focus_z = idx;
            ui_state.place.world_z_center = Math.floor(world_z);
            save_place_focus_z();
            return;
        }
        ui_state.place.world_z_center = Math.floor(world_z);
        ui_state.place.focus_z = 0;
        save_place_focus_z();
    }

    async function mutate_place_painter_layer(place_id: string, world_z: number, action: 'add' | 'delete' | 'reorder', new_order?: number[]): Promise<boolean> {
        const base_url = APP_CONFIG.place_endpoint.replace('/api/place', '');
        try {
            const res = await fetch(`${base_url}/api/place_painter/layer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ slot: APP_CONFIG.selected_data_slot, place_id, world_z, action, new_order }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.ok) {
                if (typeof data?.error === 'string') {
                    const extra = Array.isArray(data?.details?.mapped) ? ` (${String(data.details.target ?? 'multiblock')})` : '';
                    flash_status([`Layer change failed: ${data.error}${extra}`], 1800);
                }
                return false;
            }
            await refresh_selected_scene_place(place_id, { source: 'layer_mutation', preserve_place_painter: true });
            return true;
        } catch {
            return false;
        }
    }

    function detect_place_topology_face(place: Place, x: number, y: number, world_z: number): 'x+' | 'x-' | 'y+' | 'y-' | 'z+' | 'z-' | null {
        const bounds = get_place_region_bounds(place);
        const local_z = Math.floor(Number(world_z ?? bounds.origin.z ?? 0)) - (Math.floor(Number(bounds.origin.z ?? 0)) || 0);
        return select_place_resize_face(place, { x, y, z: local_z });
    }

    function get_connected_place_create_size(place: Place): { x: number; y: number; z: number } {
        const bounds = get_place_region_bounds(place);
        return {
            x: 3,
            y: 3,
            z: Math.max(1, Math.floor(Number(bounds.size?.z ?? 1)) || 1),
        };
    }

    function clone_bounds(bounds: { origin: { x: number; y: number; z: number }; size: { x: number; y: number; z: number } }) {
        return {
            origin: { ...bounds.origin },
            size: { ...bounds.size },
        };
    }

    function compute_resized_bounds(
        start_bounds: { origin: { x: number; y: number; z: number }; size: { x: number; y: number; z: number } },
        face: 'x+' | 'x-' | 'y+' | 'y-' | 'z+' | 'z-',
        target_coord: number,
    ): { origin: { x: number; y: number; z: number }; size: { x: number; y: number; z: number } } {
        const next = clone_bounds(start_bounds);
        const max_x = start_bounds.origin.x + start_bounds.size.x - 1;
        const max_y = start_bounds.origin.y + start_bounds.size.y - 1;
        const max_z = start_bounds.origin.z + start_bounds.size.z - 1;
        if (face === 'x+') {
            const clamped = Math.max(start_bounds.origin.x, Math.floor(target_coord));
            next.size.x = Math.max(1, clamped - start_bounds.origin.x + 1);
        } else if (face === 'x-') {
            const clamped = Math.min(max_x, Math.floor(target_coord));
            next.origin.x = clamped;
            next.size.x = Math.max(1, max_x - clamped + 1);
        } else if (face === 'y+') {
            const clamped = Math.max(start_bounds.origin.y, Math.floor(target_coord));
            next.size.y = Math.max(1, clamped - start_bounds.origin.y + 1);
        } else if (face === 'y-') {
            const clamped = Math.min(max_y, Math.floor(target_coord));
            next.origin.y = clamped;
            next.size.y = Math.max(1, max_y - clamped + 1);
        } else if (face === 'z+') {
            const clamped = Math.max(start_bounds.origin.z, Math.floor(target_coord));
            next.size.z = Math.max(1, clamped - start_bounds.origin.z + 1);
        } else if (face === 'z-') {
            const clamped = Math.min(max_z, Math.floor(target_coord));
            next.origin.z = clamped;
            next.size.z = Math.max(1, max_z - clamped + 1);
        }
        return next;
    }

    function compute_resize_session_validity(
        place_id: string,
        proposed_bounds: { origin: { x: number; y: number; z: number }; size: { x: number; y: number; z: number } },
    ): { valid: boolean; conflict_place_id?: string } {
        for (const scene_place of ui_state.place.scene_places) {
            if (!scene_place || scene_place.id === place_id) continue;
            if (region_bounds_overlap(get_place_region_bounds(scene_place), proposed_bounds as any)) {
                return { valid: false, conflict_place_id: scene_place.id };
            }
        }
        return { valid: true };
    }

    function clamp_resize_target_coord(
        start_bounds: { origin: { x: number; y: number; z: number }; size: { x: number; y: number; z: number } },
        face: 'x+' | 'x-' | 'y+' | 'y-' | 'z+' | 'z-',
        target_coord: number,
    ): number {
        const raw = Math.floor(Number(target_coord) || 0);
        if (face !== 'z+' && face !== 'z-') return raw;
        const min_allowed = Math.floor(Number(start_bounds.origin.z ?? 0)) - 8;
        const max_allowed = Math.floor(Number(start_bounds.origin.z ?? 0)) + Math.max(1, Math.floor(Number(start_bounds.size.z ?? 1)) || 1) - 1 + 8;
        return Math.max(min_allowed, Math.min(max_allowed, raw));
    }

    function is_world_z_inside_place(place: Place, world_z: number): boolean {
        const bounds = get_place_region_bounds(place);
        const z = Math.floor(Number(world_z));
        const min_z = Math.floor(Number(bounds.origin.z ?? 0)) || 0;
        const max_z = min_z + Math.max(1, Math.floor(Number(bounds.size.z ?? 1)) || 1) - 1;
        return z >= min_z && z <= max_z;
    }

    async function apply_place_resize(place_id: string, face: 'x+' | 'x-' | 'y+' | 'y-' | 'z+' | 'z-', proposed_bounds: { origin: { x: number; y: number; z: number }; size: { x: number; y: number; z: number } }): Promise<{ ok: true } | { ok: false; error: string }> {
        const base_url = APP_CONFIG.place_endpoint.replace('/api/place', '');
        try {
            debug_log(`[SEAM_TOOL] resize apply request ${JSON.stringify({ place_id, face, proposed_bounds })}`);
            const res = await fetch(`${base_url}/api/place/topology/resize`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    slot: APP_CONFIG.selected_data_slot,
                    place_id,
                    face,
                    proposed_bounds,
                }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.ok) {
                debug_warn(`[SEAM_TOOL] resize apply failed ${JSON.stringify({ place_id, face, proposed_bounds, status: res.status, data })}`);
                const error = String(data?.error ?? `http_${res.status}`);
                if (error === 'place_bounds_overlap') {
                    return { ok: false, error: `place_bounds_overlap (${String(data?.details?.place_id ?? 'unknown_place')})` };
                }
                return { ok: false, error };
            }
            debug_log(`[SEAM_TOOL] resize apply success ${JSON.stringify({ place_id, face, proposed_bounds })}`);
            return { ok: true };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : 'resize_failed' };
        }
    }

    function start_place_resize_session(target: { place_id: string; tile_position: { x: number; y: number }; world_z: number; region_position?: { x: number; y: number; z: number } }): void {
        const active_place = ui_state.place.scene_places.find((p) => p.id === target.place_id) ?? null;
        const selected_place_id = ui_state.place.scene_selected_place_id ?? ui_state.place.current_place_id;
        if (!active_place || active_place.id !== selected_place_id) return;
        const bounds = get_place_region_bounds(active_place);
        const local_z = Math.floor(Number(target.region_position?.z ?? target.world_z ?? 0)) - Math.floor(Number(bounds.origin.z ?? 0));
        const face = select_place_resize_face(active_place, { x: target.tile_position.x, y: target.tile_position.y, z: local_z });
        if (!face) return;
        const target_coord_raw = face === 'x+'
            ? bounds.origin.x + bounds.size.x - 1
            : face === 'x-'
                ? bounds.origin.x
                : face === 'y+'
                    ? bounds.origin.y + bounds.size.y - 1
                    : face === 'y-'
                        ? bounds.origin.y
                        : face === 'z+'
                            ? bounds.origin.z + bounds.size.z - 1
                            : bounds.origin.z;
        const target_coord = clamp_resize_target_coord(bounds as any, face, target_coord_raw);
        const proposed_bounds = clone_bounds(bounds as any);
        const validity = compute_resize_session_validity(active_place.id, proposed_bounds);
        ui_state.place_painter.resize_session = {
            active: true,
            place_id: active_place.id,
            face,
            phase: 'targeting',
            start_bounds: clone_bounds(bounds as any),
            proposed_bounds,
            valid: validity.valid,
            conflict_place_id: validity.conflict_place_id,
            target_coord,
        };
        debug_log(`[SEAM_TOOL] resize start ${JSON.stringify({ place_id: active_place.id, face, target_coord, proposed_bounds, valid: validity.valid, conflict_place_id: validity.conflict_place_id ?? null })}`);
        flash_status([`Resize face selected: ${face}`, 'Hover target, click to commit'], 1400);
    }

    function update_place_resize_session(target: { place_id: string; tile_position: { x: number; y: number }; world_z: number; region_position?: { x: number; y: number; z: number } }): void {
        const session = ui_state.place_painter.resize_session;
        if (!session?.active) return;
        if (target.place_id !== session.place_id) return;
        let target_coord = session.target_coord;
        if (session.face.startsWith('x')) target_coord = Math.floor(Number(target.region_position?.x ?? target_coord));
        else if (session.face.startsWith('y')) target_coord = Math.floor(Number(target.region_position?.y ?? target_coord));
        else if (session.face.startsWith('z')) target_coord = Math.floor(Number(target.region_position?.z ?? target_coord));
        target_coord = clamp_resize_target_coord(session.start_bounds, session.face, target_coord);
        const proposed_bounds = compute_resized_bounds(session.start_bounds, session.face, target_coord);
        const validity = compute_resize_session_validity(session.place_id, proposed_bounds);
        session.target_coord = target_coord;
        session.proposed_bounds = proposed_bounds;
        session.valid = validity.valid;
        session.conflict_place_id = validity.conflict_place_id;
        debug_log(`[SEAM_TOOL] resize update ${JSON.stringify({ place_id: session.place_id, face: session.face, target_coord, proposed_bounds, valid: validity.valid, conflict_place_id: validity.conflict_place_id ?? null })}`);
    }

    function adjust_place_resize_session_z(delta: number): void {
        const session = ui_state.place_painter.resize_session;
        if (!session?.active) return;
        if (!session.face.startsWith('z')) return;
        session.target_coord = clamp_resize_target_coord(session.start_bounds, session.face, session.target_coord + Math.floor(delta));
        const proposed_bounds = compute_resized_bounds(session.start_bounds, session.face, session.target_coord);
        const validity = compute_resize_session_validity(session.place_id, proposed_bounds);
        session.proposed_bounds = proposed_bounds;
        session.valid = validity.valid;
        session.conflict_place_id = validity.conflict_place_id;
        debug_log(`[SEAM_TOOL] resize z adjust ${JSON.stringify({ place_id: session.place_id, face: session.face, target_coord: session.target_coord, proposed_bounds, valid: validity.valid, conflict_place_id: validity.conflict_place_id ?? null })}`);
    }

    async function finish_place_resize_session(): Promise<void> {
        const session = ui_state.place_painter.resize_session;
        if (!session?.active) return;
        ui_state.place_painter.resize_session = null;
        const unchanged = JSON.stringify(session.start_bounds) === JSON.stringify(session.proposed_bounds);
        debug_log(`[SEAM_TOOL] resize finish ${JSON.stringify({ place_id: session.place_id, face: session.face, valid: session.valid, unchanged, proposed_bounds: session.proposed_bounds, conflict_place_id: session.conflict_place_id ?? null })}`);
        if (!session.valid || unchanged) return;
        const result = await apply_place_resize(session.place_id, session.face, session.proposed_bounds);
        if (!result.ok) {
            flash_status([`Resize failed: ${result.error}`], 1800);
            return;
        }
        const scene = await fetch_scene_topology(session.place_id);
        if (scene) {
            apply_scene_topology(scene, { selected_place_id: session.place_id, mirror_to_current_place: ui_state.place.current_place_id === session.place_id });
        } else {
            await refresh_single_scene_place(session.place_id);
        }
        flash_status([`Resized ${session.place_id}`, `${session.face}`], 1200);
    }

    async function create_connected_place_from_border(place: Place, x: number, y: number, z: number): Promise<{ ok: true; new_place_id: string } | { ok: false; error: string }> {
        const direction = detect_place_topology_face(place, x, y, z);
        if (!direction) return { ok: false, error: 'not_on_place_border' };
        const base_url = APP_CONFIG.place_endpoint.replace('/api/place', '');
        const new_place_id = `${place.id}_place_${Date.now().toString(36)}`;
        const bounds = get_place_region_bounds(place);
        const create_size = get_connected_place_create_size(place);
        const local_z = Math.floor(Number(z ?? bounds.origin.z ?? 0)) - Math.floor(Number(bounds.origin.z ?? 0));
        const pretty_direction = direction.replace('+', ' plus').replace('-', ' minus');
        const format_topology_error = (error: string, details: any): string => {
            if (error === 'place_bounds_overlap') {
                const place_id = String(details?.place_id ?? 'unknown_place');
                return `place_bounds_overlap (${place_id})`;
            }
            if (error !== 'invalid_connector_configuration') return error;
            const side = String(details?.side ?? 'unknown');
            const reason = String(details?.reason ?? details?.context?.reason ?? 'invalid');
            const tw = details?.context?.target_world;
            const tws = (tw && Number.isFinite(Number(tw.x)) && Number.isFinite(Number(tw.y)) && Number.isFinite(Number(tw.z)))
                ? ` @ ${Math.floor(Number(tw.x))},${Math.floor(Number(tw.y))},${Math.floor(Number(tw.z))}`
                : '';
            return `invalid_connector_configuration (${side}, ${reason}${tws})`;
        };
        try {
            debug_log(`[SEAM_TOOL] create preflight ${JSON.stringify({ place_id: place.id, border_tile: { x, y, z, local_z }, direction, new_place_id })}`);
            const preflight_res = await fetch(`${base_url}/api/place/topology/preflight_connected`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    slot: APP_CONFIG.selected_data_slot,
                    source_place_id: place.id,
                    new_place_id,
                    new_place_name: `New Place ${pretty_direction}`,
                    border_tile: { x, y, z: local_z },
                    direction,
                    size: create_size,
                }),
            });
            const preflight_data = await preflight_res.json().catch(() => null);
            if (!preflight_res.ok || !preflight_data?.ok) {
                return { ok: false, error: String(preflight_data?.error ?? `preflight_http_${preflight_res.status}`) };
            }
            if (preflight_data?.can_create !== true) {
                const pf_error = String(preflight_data?.error ?? 'preflight_failed');
                const pretty = format_topology_error(pf_error, preflight_data?.details ?? null);
                debug_log(`[PLACE_PAINTER] seam preflight blocked ${JSON.stringify({ place_id: place.id, border_tile: { x, y, z, local_z }, direction, error: pf_error, details: preflight_data?.details ?? null })}`);
                return { ok: false, error: `preflight:${pretty}` };
            }
            const res = await fetch(`${base_url}/api/place/topology/create_connected`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    slot: APP_CONFIG.selected_data_slot,
                    source_place_id: place.id,
                    new_place_id,
                    new_place_name: `New Place ${pretty_direction}`,
                    border_tile: { x, y, z: local_z },
                    direction,
                    size: create_size,
                }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.ok) {
                const error = String(data?.error ?? `http_${res.status}`);
                const pretty = format_topology_error(error, data?.details ?? null);
                debug_log(`[SEAM_TOOL] create failed ${JSON.stringify({ place_id: place.id, border_tile: { x, y, z, local_z }, direction, error, details: data?.details ?? null })}`);
                return { ok: false, error: pretty };
            }
            debug_log(`[SEAM_TOOL] create success ${JSON.stringify({ source_place_id: place.id, new_place_id, border_tile: { x, y, z, local_z }, direction })}`);
            return { ok: true, new_place_id };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : 'create_connected_failed' };
        }
    }

    async function delete_adjacent_place(place: Place, target_place_id: string): Promise<{ ok: true; target_place_id: string } | { ok: false; error: string }> {
        const resolved_target_place_id = String(target_place_id ?? '');
        if (!resolved_target_place_id || resolved_target_place_id === place.id) return { ok: false, error: 'no_adjacent_place_selected' };
        const base_url = APP_CONFIG.place_endpoint.replace('/api/place', '');
        try {
            debug_log(`[SEAM_TOOL] delete request ${JSON.stringify({ source_place_id: place.id, target_place_id: resolved_target_place_id })}`);
            const res = await fetch(`${base_url}/api/place/topology/delete_empty`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    slot: APP_CONFIG.selected_data_slot,
                    source_place_id: place.id,
                    target_place_id: resolved_target_place_id,
                }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.ok) return { ok: false, error: String(data?.error ?? `http_${res.status}`) };
            debug_log(`[SEAM_TOOL] delete success ${JSON.stringify({ source_place_id: place.id, target_place_id: resolved_target_place_id })}`);
            return { ok: true, target_place_id: resolved_target_place_id };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : 'delete_connected_failed' };
        }
    }

    function cycle_place_painter_tile_selection(direction: 1 | -1): void {
        const entries = get_active_place_painter_tile_entries();
        if (entries.length < 1) return;
        const current_id = ui_state.place_painter.selected_palette_entry_id;
        const current_index = Math.max(0, entries.findIndex((entry) => entry.id === current_id));
        const next_index = (current_index + direction + entries.length) % entries.length;
        const next = entries[next_index];
        if (!next) return;
        ui_state.place_painter.selected_palette_entry_id = next.id;
        flash_status([`Tile: ${next.id}`, `${next.display_char} ${next.name}`], 1200);
    }

    function cycle_place_painter_item_selection(direction: 1 | -1): void {
        const entries = ui_state.place_painter.item_palette_entries;
        if (entries.length < 1) return;
        const current_id = ui_state.place_painter.selected_item_palette_entry_id;
        const current_index = Math.max(0, entries.findIndex((entry) => entry.id === current_id));
        const next_index = (current_index + direction + entries.length) % entries.length;
        const next = entries[next_index];
        if (!next) return;
        ui_state.place_painter.selected_item_palette_entry_id = next.id;
        flash_status([`Item: ${next.id}`, `${next.display_char} ${next.name}`], 1200);
    }

    async function place_place_painter_item_at(place_id: string, x: number, y: number, z: number, def_id: string): Promise<boolean> {
        const base_url = APP_CONFIG.place_endpoint.replace('/api/place', '');
        try {
            debug_log(`[PLACE_PAINTER] place item request ${JSON.stringify({ place_id, x, y, z, def_id })}`);
            const res = await fetch(`${base_url}/api/place/debug/item`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    slot: APP_CONFIG.selected_data_slot,
                    place_id,
                    def_id,
                    qty: 1,
                    x,
                    y,
                    z,
                }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.ok) {
                debug_warn(`[PLACE_PAINTER] place item failed ${JSON.stringify({ place_id, x, y, z, def_id, status: res.status, data })}`);
                return false;
            }
            await refresh_selected_scene_place(place_id, { source: 'place_item_refresh', preserve_place_painter: true });
            debug_log(`[PLACE_PAINTER] place item success ${JSON.stringify({ place_id, x, y, z, def_id, item_id: data?.item_id ?? null })}`);
            return true;
        } catch {
            return false;
        }
    }

    function get_place_layer_key_for_world_z(place: Place | null, z: number): string {
        const baseZ = Math.floor(Number((place as any)?.coordinates?.elevation ?? 0)) || 0;
        const offset = Math.floor(Number(z) - Number(baseZ));
        if (offset === 0) return 'tiles';
        if (offset === -1) return 'tiles_z0';
        if (offset === 1) return 'tiles_z1';
        return `tiles_z${offset}`;
    }

    function apply_local_place_tile_mutation(place_id: string, x: number, y: number, z: number, kind: string | null): void {
        const apply_to_place = (place: any): void => {
            if (!place || String(place.id ?? '') !== place_id) return;
            const layerKey = get_place_layer_key_for_world_z(place, z);
            if (!place[layerKey]) {
                const width = Math.max(1, Math.floor(Number(place.tile_grid?.width ?? 1)));
                const height = Math.max(1, Math.floor(Number(place.tile_grid?.height ?? 1)));
                place[layerKey] = {
                    width,
                    height,
                    cells: Array.from({ length: height }, () => Array.from({ length: width }, () => null)),
                };
            }
            if (!Array.isArray(place[layerKey]?.cells?.[y])) return;
            if (kind == null) {
                place[layerKey].cells[y][x] = null;
                return;
            }
            const entry = ui_state.place_painter.tile_palette_entries.find((t) => t.id === kind);
            place[layerKey].cells[y][x] = {
                kind,
                display_char: entry?.display_char ?? '?',
                display_color: entry?.display_color ?? '#888888',
            };
        };
        apply_to_place(ui_state.place.current_place as any);
        const scene_place = get_scene_place(place_id) as any;
        if (scene_place && scene_place !== ui_state.place.current_place) apply_to_place(scene_place);
        debug_log(`[PLACE_PAINTER] local tile mutation mirrored ${JSON.stringify({ place_id, x, y, z, kind, current_place_id: ui_state.place.current_place_id, scene_selected_place_id: ui_state.place.scene_selected_place_id })}`);
    }

    function clear_local_structure_at_voxel(place_id: string, x: number, y: number, z: number): void {
        const apply_to_place = (place: any): void => {
            if (!place || String(place.id ?? '') !== place_id || !Array.isArray(place.structures)) return;
            place.structures = place.structures.filter((s: any) => {
                const origin = s?.origin;
                if (!origin) return true;
                const ox = Math.floor(Number(origin.x) || 0);
                const oy = Math.floor(Number(origin.y) || 0);
                const oz = Math.floor(Number(origin.z) || 0);
                const phys = Array.isArray(s?.body_model?.physical) ? s.body_model.physical : [{ dx: 0, dy: 0, dz: 0 }];
                return !phys.some((v: any) => ox + Math.floor(Number(v?.dx ?? 0)) === x && oy + Math.floor(Number(v?.dy ?? 0)) === y && oz + Math.floor(Number(v?.dz ?? 0)) === z);
            });
        };
        apply_to_place(ui_state.place.current_place as any);
        const scene_place = get_scene_place(place_id) as any;
        if (scene_place && scene_place !== ui_state.place.current_place) apply_to_place(scene_place);
    }

    function apply_local_place_structure_preview(place_id: string, x: number, y: number, z: number, entry: { id: string; display_char: string; display_color: string; body_model?: { physical?: Array<{ dx: number; dy: number; dz: number }> } | null }): void {
        clear_local_structure_at_voxel(place_id, x, y, z);
        const apply_to_place = (place: any): void => {
            if (!place || String(place.id ?? '') !== place_id) return;
            if (!Array.isArray(place.structures)) place.structures = [];
            place.structures.push({
                id: `preview_${entry.id}_${x}_${y}_${z}`,
                def_id: entry.id,
                origin: { x, y, z },
                display_char: entry.display_char,
                display_color: entry.display_color,
                body_model: entry.body_model ?? null,
                __derived_runtime: true,
            });
        };
        apply_to_place(ui_state.place.current_place as any);
        const scene_place = get_scene_place(place_id) as any;
        if (scene_place && scene_place !== ui_state.place.current_place) apply_to_place(scene_place);
    }

    function apply_local_place_entity_move(place_id: string, entity_ref: string, entity_type: 'npc' | 'actor' | 'item' | 'pile' | 'structure', target_x: number, target_y: number, target_z: number): void {
        const apply_to_place = (place: any): void => {
            if (!place || String(place.id ?? '') !== place_id) return;
            if (entity_type === 'actor') {
                const actor = Array.isArray(place?.contents?.actors_present) ? place.contents.actors_present.find((a: any) => String(a?.actor_ref ?? '') === entity_ref) : null;
                if (actor) {
                    actor.tile_position = { x: target_x, y: target_y };
                    actor.elevation = target_z;
                }
                return;
            }
            if (entity_type === 'npc') {
                const npc = Array.isArray(place?.contents?.npcs_present) ? place.contents.npcs_present.find((n: any) => String(n?.npc_ref ?? '') === entity_ref) : null;
                if (npc) {
                    npc.tile_position = { x: target_x, y: target_y };
                    npc.elevation = target_z;
                }
                return;
            }
            if (entity_type === 'structure') {
                const sid = String(entity_ref).replace(/^structure\./, '');
                const structure = Array.isArray(place?.structures) ? place.structures.find((s: any) => String(s?.id ?? '') === sid) : null;
                if (structure) {
                    if (!structure.origin) structure.origin = { x: target_x, y: target_y, z: target_z };
                    structure.origin.x = target_x;
                    structure.origin.y = target_y;
                    structure.origin.z = target_z;
                }
            }
        };
        apply_to_place(ui_state.place.current_place as any);
        const scene_place = get_scene_place(place_id) as any;
        if (scene_place && scene_place !== ui_state.place.current_place) apply_to_place(scene_place);
        debug_log(`[PLACE_PAINTER] local entity move mirrored ${JSON.stringify({ place_id, entity_ref, entity_type, target_x, target_y, target_z })}`);
    }

    function apply_local_place_entity_erase(place_id: string, entity_ref: string, entity_type: 'npc' | 'actor' | 'item' | 'pile' | 'structure', source_x: number, source_y: number, source_z: number): void {
        const apply_to_place = (place: any): void => {
            if (!place || String(place.id ?? '') !== place_id) return;
            if (entity_type === 'actor') {
                if (Array.isArray(place?.contents?.actors_present)) {
                    place.contents.actors_present = place.contents.actors_present.filter((a: any) => String(a?.actor_ref ?? '') !== entity_ref);
                }
                return;
            }
            if (entity_type === 'npc') {
                if (Array.isArray(place?.contents?.npcs_present)) {
                    place.contents.npcs_present = place.contents.npcs_present.filter((n: any) => String(n?.npc_ref ?? '') !== entity_ref);
                }
                return;
            }
            if (entity_type === 'structure') {
                const sid = String(entity_ref).replace(/^structure\./, '');
                if (Array.isArray(place?.structures)) {
                    place.structures = place.structures.filter((s: any) => String(s?.id ?? '') !== sid);
                }
                return;
            }
            if (entity_type === 'item') {
                const item_id = String(entity_ref).replace(/^item\./, '');
                if (Array.isArray(place?.contents?.items_on_ground)) {
                    place.contents.items_on_ground = place.contents.items_on_ground.filter((it: any) => String(it?.item_ref ?? '') !== item_id);
                }
                return;
            }
            if (entity_type === 'pile' && Array.isArray(place?.contents?.items_on_ground)) {
                place.contents.items_on_ground = place.contents.items_on_ground.filter((it: any) => {
                    const pos = it?.tile_position;
                    const z = typeof it?.elevation === 'number' ? Math.floor(it.elevation) : null;
                    return !(pos?.x === source_x && pos?.y === source_y && z === source_z);
                });
            }
        };
        apply_to_place(ui_state.place.current_place as any);
        const scene_place = get_scene_place(place_id) as any;
        if (scene_place && scene_place !== ui_state.place.current_place) apply_to_place(scene_place);

        if (entity_type === 'item') {
            const item_id = String(entity_ref).replace(/^item\./, '');
            if (item_id) {
                remove_ground_item_from_local_maps(item_id, place_id);
                ensure_ground_item_cache(place_id).by_id.delete(item_id);
                if (ui_state.place.current_place_id === place_id) sync_current_place_ground_item_cache_aliases();
            }
        } else if (entity_type === 'pile') {
            const voxel_key = `${source_x}_${source_y}_${Math.floor(source_z)}`;
            const cache = ensure_ground_item_cache(place_id);
            const item_ids = [...(cache.by_voxel.get(voxel_key) ?? [])];
            for (const item_id of item_ids) {
                remove_ground_item_from_local_maps(item_id, place_id);
                cache.by_id.delete(item_id);
            }
            cache.by_voxel.delete(voxel_key);
            if (ui_state.place.current_place_id === place_id) sync_current_place_ground_item_cache_aliases();
        }
        debug_log(`[PLACE_PAINTER] local entity erase mirrored ${JSON.stringify({ place_id, entity_ref, entity_type, source_x, source_y, source_z })}`);
    }

    function get_place_painter_move_source_preview(
        place_id: string,
        entity_ref: string,
        entity_type: 'npc' | 'actor' | 'item' | 'pile' | 'structure',
    ): {
        display_char: string;
        display_color: string;
        body_model?: { physical?: Array<{ dx: number; dy: number; dz: number }> } | null;
        body_model_id?: string;
        facing?: string | null;
        name?: string;
        tags?: any[];
        kind_id?: string;
        entity_render?: any;
    } | null {
        const place = (get_scene_place(place_id) ?? ui_state.place.current_place) as any;
        if (!place || String(place.id ?? '') !== place_id) return null;
        if (entity_type === 'actor' || entity_type === 'npc') {
            const list = entity_type === 'actor' ? (place?.contents?.actors_present ?? []) : (place?.contents?.npcs_present ?? []);
            const match = list.find((entry: any) => String(entity_type === 'actor' ? entry?.actor_ref ?? '' : entry?.npc_ref ?? '') === entity_ref) ?? null;
            return match ? {
                display_char: String(match?.display_char ?? (typeof match?.name === 'string' && String(match.name).trim().length > 0 ? String(match.name).trim().charAt(0).toUpperCase() : (entity_type === 'actor' ? '@' : 'N'))),
                display_color: String(match?.display_color ?? '#ffffff'),
                body_model: null,
                body_model_id: typeof match?.body_model_id === 'string' ? String(match.body_model_id) : undefined,
                facing: typeof match?.facing === 'string' ? String(match.facing) : get_facing(entity_ref),
                name: typeof match?.name === 'string' && String(match.name).trim().length > 0
                    ? String(match.name)
                    : (entity_type === 'actor' ? 'Unknown Actor' : 'Unknown NPC'),
                tags: Array.isArray(match?.tags) ? match.tags : [],
                kind_id: typeof match?.kind_id === 'string' ? String(match.kind_id) : undefined,
                entity_render: match?.entity_render,
            } : null;
        }
        if (entity_type === 'structure') {
            const sid = String(entity_ref).replace(/^structure\./, '');
            const match = Array.isArray(place?.structures) ? place.structures.find((entry: any) => String(entry?.id ?? '') === sid) : null;
            return match ? {
                display_char: String(match?.display_char ?? '#'),
                display_color: String(match?.display_color ?? '#ffffff'),
                body_model: match?.body_model ?? null,
                name: String(match?.name ?? sid),
            } : null;
        }
        if (entity_type === 'item') {
            const item_id = String(entity_ref).replace(/^item\./, '');
            const meta = ui_state.place.ground_items_by_id.get(item_id) as any;
            return meta ? {
                display_char: String(meta?.display_char ?? '*'),
                display_color: String(meta?.display_color ?? '#ffffff'),
                body_model: null,
                name: String(meta?.name ?? item_id),
                tags: Array.isArray(meta?.tags) ? meta.tags : [],
            } : null;
        }
        if (entity_type === 'pile') {
            return {
                display_char: '*',
                display_color: '#ffd37a',
                body_model: null,
                name: 'Item pile',
            };
        }
        return null;
    }

    function is_place_painter_move_target_valid(place_id: string, x: number, y: number, z: number): boolean {
        const place = (get_scene_place(place_id) ?? ui_state.place.current_place) as any;
        if (!place || String(place.id ?? '') !== place_id) return false;
        const bounds = get_place_region_bounds(place);
        const local_z = Math.floor(Number(z)) - Math.floor(Number(bounds.origin.z ?? 0));
        return x >= 0 && x < Math.max(1, Math.floor(Number(bounds.size.x ?? place.tile_grid?.width ?? 1)) || 1)
            && y >= 0 && y < Math.max(1, Math.floor(Number(bounds.size.y ?? place.tile_grid?.height ?? 1)) || 1)
            && local_z >= 0 && local_z < Math.max(1, Math.floor(Number(bounds.size.z ?? 1)) || 1);
    }

    function compute_place_painter_move_target_validity(
        place_id: string,
        entity_ref: string,
        entity_type: 'npc' | 'actor' | 'item' | 'pile' | 'structure',
        x: number,
        y: number,
        z: number,
    ): { valid: boolean; reason?: string } {
        const place = (get_scene_place(place_id) ?? ui_state.place.current_place) as any;
        if (!place || String(place.id ?? '') !== place_id) return { valid: false, reason: 'place_not_loaded' };
        if (!is_place_painter_move_target_valid(place_id, x, y, z)) return { valid: false, reason: 'out_of_bounds' };
        if (entity_type === 'actor' || entity_type === 'npc') {
            const owner = { kind: entity_type, id: entity_ref } as any;
            const check = can_place_volume(place as any, owner, { x, y, z }, 'WALK' as any, {
                exclude_owner: owner,
                allow_unsupported: true,
                support_policy: 'any_footprint' as any,
            });
            return check.ok ? { valid: true } : { valid: false, reason: String((check as any).reason ?? 'blocked') };
        }
        if (entity_type === 'structure') {
            const owner = { kind: 'structure', id: String(entity_ref).replace(/^structure\./, '') } as any;
            const check = can_place_volume(place as any, owner, { x, y, z }, 'WALK' as any, {
                exclude_owner: owner,
                support_policy: 'any_footprint' as any,
            });
            return check.ok ? { valid: true } : { valid: false, reason: String((check as any).reason ?? 'blocked') };
        }
        return { valid: true };
    }

    function start_place_move_drag(target: {
        place_id: string;
        tile_position: { x: number; y: number };
        world_z: number;
        entity_ref?: string;
        entity_type?: 'npc' | 'actor' | 'item' | 'pile' | 'structure';
    }): void {
        if (!target.entity_ref || !target.entity_type) return;
        const preview = get_place_painter_move_source_preview(target.place_id, target.entity_ref, target.entity_type);
        if (!preview) return;
        ui_state.place_painter.move_drag_session = {
            place_id: target.place_id,
            source_x: target.tile_position.x,
            source_y: target.tile_position.y,
            source_z: target.world_z,
            entity_ref: target.entity_ref,
            entity_type: target.entity_type,
            display_char: preview.display_char,
            display_color: preview.display_color,
            body_model: preview.body_model ?? null,
            body_model_id: preview.body_model_id,
            facing: preview.facing ?? null,
            name: preview.name,
            tags: Array.isArray(preview.tags) ? preview.tags : [],
            kind_id: preview.kind_id,
            entity_render: preview.entity_render,
            target_x: target.tile_position.x,
            target_y: target.tile_position.y,
            target_z: target.world_z,
            valid: false,
        };
        debug_log(`[SEAM_TOOL] move drag start ${JSON.stringify({ place_id: target.place_id, entity_ref: target.entity_ref, entity_type: target.entity_type, source: { x: target.tile_position.x, y: target.tile_position.y, z: target.world_z } })}`);
    }

    function update_place_move_drag(target: { place_id: string; tile_position: { x: number; y: number }; world_z: number }): void {
        const session = ui_state.place_painter.move_drag_session;
        if (!session) return;
        session.target_x = target.tile_position.x;
        session.target_y = target.tile_position.y;
        session.target_z = target.world_z;
        const validity = target.place_id === session.place_id
            ? compute_place_painter_move_target_validity(session.place_id, session.entity_ref, session.entity_type, session.target_x, session.target_y, session.target_z)
            : { valid: false, reason: 'wrong_place' };
        session.valid = validity.valid;
        debug_log(`[SEAM_TOOL] move drag update ${JSON.stringify({ entity_ref: session.entity_ref, target: { x: session.target_x, y: session.target_y, z: session.target_z }, valid: session.valid, reason: validity.reason ?? null })}`);
    }

    async function finish_place_move_drag(): Promise<void> {
        const session = ui_state.place_painter.move_drag_session;
        ui_state.place_painter.move_drag_session = null;
        if (!session) return;
        debug_log(`[SEAM_TOOL] move drag finish ${JSON.stringify({ entity_ref: session.entity_ref, source: { x: session.source_x, y: session.source_y, z: session.source_z }, target: { x: session.target_x, y: session.target_y, z: session.target_z }, valid: session.valid })}`);
        if (!session.valid) {
            flash_status(['Move canceled'], 900);
            return;
        }
        const unchanged = session.source_x === session.target_x && session.source_y === session.target_y && session.source_z === session.target_z;
        if (unchanged) return;
        const mv = await move_place_painter_entity({
            place_id: session.place_id,
            source_x: session.source_x,
            source_y: session.source_y,
            source_z: session.source_z,
            target_x: session.target_x,
            target_y: session.target_y,
            target_z: session.target_z,
            entity_ref: session.entity_ref,
            entity_type: session.entity_type,
        });
        if (!mv.ok) {
            flash_status([`Move failed: ${mv.error ?? 'unknown_error'}`], 1800);
            return;
        }
        apply_local_place_entity_move(session.place_id, session.entity_ref, session.entity_type, session.target_x, session.target_y, session.target_z);
        if (get_scene_place(session.place_id)) await refresh_single_scene_place(session.place_id);
        if (ui_state.place.current_place_id === session.place_id) {
            await update_current_place(session.place_id, { source: 'place_painter_move_drag', preserve_place_painter: true });
        }
        flash_status([`Moved ${session.entity_ref}`, `to ${session.target_x},${session.target_y},${session.target_z}`], 1200);
    }

    async function paint_place_tile_at(place_id: string, x: number, y: number, z: number, kind: string): Promise<boolean> {
        const base_url = APP_CONFIG.place_endpoint.replace('/api/place', '');
        try {
            debug_log(`[PLACE_PAINTER] paint tile request ${JSON.stringify({ place_id, x, y, z, kind })}`);
            const res = await fetch(`${base_url}/api/place/debug/tile`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    slot: APP_CONFIG.selected_data_slot,
                    place_id,
                    kind,
                    x,
                    y,
                    z,
                }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.ok) {
                debug_warn(`[PLACE_PAINTER] paint tile failed ${JSON.stringify({ place_id, x, y, z, kind, status: res.status, data })}`);
                return false;
            }
            const entry = get_selected_place_painter_tile_entry();
            const is_multiblock = !!(entry?.body_model && Array.isArray(entry.body_model.physical) && entry.body_model.physical.length > 1);
            if (entry && is_multiblock) {
                apply_local_place_structure_preview(place_id, x, y, z, entry);
            } else {
                apply_local_place_tile_mutation(place_id, x, y, z, kind);
            }
            if (get_scene_place(place_id)) await refresh_single_scene_place(place_id);
            const refreshed = (get_scene_place(place_id) ?? ui_state.place.current_place) as any;
            const layerKey = z === 0 ? 'tiles' : z === -1 ? 'tiles_z0' : z === 1 ? 'tiles_z1' : `tiles_z${z}`;
            const refreshedTile = refreshed?.[layerKey]?.cells?.[y]?.[x] ?? null;
            debug_log(`[PLACE_PAINTER] paint tile post-refresh ${JSON.stringify({ place_id, x, y, z, kind, layerKey, refreshed_kind: String(refreshedTile?.kind ?? ''), current_place_id: ui_state.place.current_place_id, scene_selected_place_id: ui_state.place.scene_selected_place_id })}`);
            debug_log(`[PLACE_PAINTER] paint tile success ${JSON.stringify({ place_id, x, y, z, kind })}`);
            return true;
        } catch {
            return false;
        }
    }

    async function erase_place_tile_at(place_id: string, x: number, y: number, z: number): Promise<boolean> {
        const base_url = APP_CONFIG.place_endpoint.replace('/api/place', '');
        try {
            debug_log(`[PLACE_PAINTER] erase tile request ${JSON.stringify({ place_id, x, y, z })}`);
            const res = await fetch(`${base_url}/api/place/debug/tile`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    slot: APP_CONFIG.selected_data_slot,
                    place_id,
                    erase: true,
                    x,
                    y,
                    z,
                }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.ok) {
                debug_warn(`[PLACE_PAINTER] erase tile failed ${JSON.stringify({ place_id, x, y, z, status: res.status, data })}`);
                return false;
            }
            clear_local_structure_at_voxel(place_id, x, y, z);
            apply_local_place_tile_mutation(place_id, x, y, z, null);
            if (get_scene_place(place_id)) await refresh_single_scene_place(place_id);
            const refreshed = (get_scene_place(place_id) ?? ui_state.place.current_place) as any;
            const layerKey = z === 0 ? 'tiles' : z === -1 ? 'tiles_z0' : z === 1 ? 'tiles_z1' : `tiles_z${z}`;
            const refreshedTile = refreshed?.[layerKey]?.cells?.[y]?.[x] ?? null;
            debug_log(`[PLACE_PAINTER] erase tile post-refresh ${JSON.stringify({ place_id, x, y, z, layerKey, refreshed_kind: String(refreshedTile?.kind ?? ''), current_place_id: ui_state.place.current_place_id, scene_selected_place_id: ui_state.place.scene_selected_place_id })}`);
            debug_log(`[PLACE_PAINTER] erase tile success ${JSON.stringify({ place_id, x, y, z })}`);
            return true;
        } catch {
            return false;
        }
    }

    async function mutate_place_tiles_batch(place_id: string, ops: Array<{ x: number; y: number; z: number; kind?: string | null; erase?: boolean }>): Promise<boolean> {
        if (ops.length < 1) return true;
        const base_url = APP_CONFIG.place_endpoint.replace('/api/place', '');
        try {
            const normalized_ops = ops.map((op) => ({
                x: Math.floor(Number(op.x)),
                y: Math.floor(Number(op.y)),
                z: Math.floor(Number(op.z)),
                erase: op.erase === true,
                kind: op.erase === true ? null : (typeof op.kind === 'string' ? op.kind : null),
            }));
            debug_log(`[PLACE_PAINTER] batch tile request ${JSON.stringify({ place_id, count: normalized_ops.length })}`);
            const res = await fetch(`${base_url}/api/place/debug/tiles`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    slot: APP_CONFIG.selected_data_slot,
                    place_id,
                    ops: normalized_ops,
                }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.ok) {
                debug_warn(`[PLACE_PAINTER] batch tile failed ${JSON.stringify({ place_id, count: normalized_ops.length, status: res.status, data })}`);
                return false;
            }
            for (const op of normalized_ops) {
                if (op.erase) {
                    clear_local_structure_at_voxel(place_id, op.x, op.y, op.z);
                    apply_local_place_tile_mutation(place_id, op.x, op.y, op.z, null);
                } else if (op.kind) {
                    const entry = ui_state.place_painter.tile_palette_entries.find((tile) => tile.id === op.kind);
                    const is_multiblock = !!(entry?.body_model && Array.isArray(entry.body_model.physical) && entry.body_model.physical.length > 1);
                    if (entry && is_multiblock) apply_local_place_structure_preview(place_id, op.x, op.y, op.z, entry);
                    else apply_local_place_tile_mutation(place_id, op.x, op.y, op.z, op.kind);
                }
            }
            await refresh_selected_scene_place(place_id, { source: 'place_tile_batch_refresh', preserve_place_painter: true });
            debug_log(`[PLACE_PAINTER] batch tile success ${JSON.stringify({ place_id, count: normalized_ops.length })}`);
            return true;
        } catch {
            return false;
        }
    }

    async function move_place_painter_entity(args: {
        place_id: string;
        source_x: number;
        source_y: number;
        source_z: number;
        target_x: number;
        target_y: number;
        target_z: number;
        entity_ref: string;
        entity_type: 'npc' | 'actor' | 'item' | 'pile' | 'structure';
    }): Promise<{ ok: boolean; error?: string }> {
        const base_url = APP_CONFIG.place_endpoint.replace('/api/place', '');
        try {
            debug_log(`[PLACE_PAINTER] move request ${JSON.stringify(args)}`);
            const res = await fetch(`${base_url}/api/place_painter/move`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    slot: APP_CONFIG.selected_data_slot,
                    place_id: args.place_id,
                    source: { x: args.source_x, y: args.source_y, z: args.source_z },
                    target: { x: args.target_x, y: args.target_y, z: args.target_z },
                    entity_ref: args.entity_ref,
                    entity_type: args.entity_type,
                }),
            });
            const data = await res.json().catch(() => null as any);
            if (!res.ok || !data?.ok) {
                debug_warn(`[PLACE_PAINTER] move failed ${JSON.stringify({ args, status: res.status, data })}`);
                return { ok: false, error: String(data?.error ?? `HTTP ${res.status}`) };
            }
            debug_log(`[PLACE_PAINTER] move success ${JSON.stringify({ args, data })}`);
            return { ok: true };
        } catch {
            return { ok: false, error: 'network_error' };
        }
    }

    function create_current_place_pause_controller(source: string) {
        const normalized_source = String(source);
        return {
            source: normalized_source,
            is_active: () => is_current_place_paused_by(normalized_source),
            activate: async () => await set_current_place_pause_source(normalized_source, true),
            deactivate: async () => await set_current_place_pause_source(normalized_source, false),
            toggle: async () => await set_current_place_pause_source(normalized_source, !is_current_place_paused_by(normalized_source)),
        };
    }

    async function toggle_current_place_pause_debug(): Promise<{ ok: boolean; mode: 'paused' | 'resumed' | 'blocked'; sources: string[] }> {
        const place_id = ui_state.place.current_place_id;
        if (!place_id) {
            return { ok: false, mode: 'blocked', sources: [] };
        }
        const fetched = await fetch_current_place_pause_state(place_id);
        const pause_state = fetched.pause_state ?? ui_state.place.pause_state;
        const debug_active = pause_state.pause_sources.includes(debug_pause_controller.source);
        debug_log('[PLACE_PAUSE_UI] toggle decision', { place_id, pause_state, debug_active });
        if (debug_active) {
            const ok = await debug_pause_controller.deactivate();
            return {
                ok,
                mode: ok ? 'resumed' : 'blocked',
                sources: [...ui_state.place.pause_state.pause_sources],
            };
        }
        if (pause_state.paused && pause_state.pause_sources.length > 0) {
            return {
                ok: false,
                mode: 'blocked',
                sources: [...pause_state.pause_sources],
            };
        }
        const ok = await debug_pause_controller.activate();
        return {
            ok,
            mode: ok ? 'paused' : 'blocked',
            sources: [...ui_state.place.pause_state.pause_sources],
        };
    }

    async function start_debug_timed_event(place_id: string, event_type: 'combat' | 'conversation' = 'combat'): Promise<{ ok: boolean; error?: string; participants?: string[] }> {
        try {
            debug_log('[TIMED_EVENT_DEBUG_UI] start request', { place_id, event_type, slot: APP_CONFIG.selected_data_slot });
            const res = await fetch(`http://localhost:8787/api/timed_event/debug/start?slot=${APP_CONFIG.selected_data_slot}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ place_id, event_type }),
            });
            const data = await res.json().catch(() => null as any);
            debug_log('[TIMED_EVENT_DEBUG_UI] start response', { status: res.status, ok: res.ok, data });
            if (!res.ok || !data?.ok) {
                return { ok: false, error: String(data?.error ?? `HTTP ${res.status}`) };
            }
            return { ok: true, participants: Array.isArray(data?.participants) ? data.participants : [] };
        } catch {
            return { ok: false, error: 'network_error' };
        }
    }

    async function fetch_timed_event_state(): Promise<any | null> {
        try {
            const res = await fetch(`http://localhost:8787/api/timed_event/state?slot=${APP_CONFIG.selected_data_slot}`);
            if (!res.ok) return null;
            const data = await res.json().catch(() => null as any);
            debug_log('[TIMED_EVENT_DEBUG_UI] state fetch', { status: res.status, ok: res.ok, data });
            return data?.ok ? data : null;
        } catch {
            return null;
        }
    }

    async function advance_timed_event_turn_for_controlled_actor(): Promise<{ ok: boolean; error?: string; active_actor?: string; new_turn?: number }> {
        try {
            const actor_ref = get_input_actor_ref();
            const session_token = get_session_token();
            if (!actor_ref) {
                return { ok: false, error: 'controlled_actor_binding_required' };
            }
            if (!session_token) {
                return { ok: false, error: 'invalid_session_token' };
            }
            const res = await fetch(`http://localhost:8787/api/timed_event/next_turn?slot=${APP_CONFIG.selected_data_slot}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_token,
                    actor_ref,
                }),
            });
            const data = await res.json().catch(() => null as any);
            if (!res.ok || !data?.ok) {
                return { ok: false, error: String(data?.error ?? `HTTP ${res.status}`) };
            }
            return { ok: true, active_actor: data.active_actor, new_turn: data.new_turn };
        } catch {
            return { ok: false, error: 'network_error' };
        }
    }

    async function debug_move_refresh(): Promise<{ ok: boolean; error?: string; actor_ref?: string }> {
        try {
            const action_cost = String(ui_state.controls.override_cost ?? 'FULL').toUpperCase();
            const res = await fetch(`http://localhost:8787/api/timed_event/debug/move?slot=${APP_CONFIG.selected_data_slot}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action_cost }),
            });
            const data = await res.json().catch(() => null as any);
            if (!res.ok || !data?.ok) {
                return { ok: false, error: String(data?.error ?? `HTTP ${res.status}`) };
            }
            return { ok: true, actor_ref: typeof data?.actor_ref === 'string' ? data.actor_ref : undefined };
        } catch {
            return { ok: false, error: 'network_error' };
        }
    }

    async function debug_end_timed_event(): Promise<{ ok: boolean; error?: string }> {
        try {
            debug_log('[TIMED_EVENT_DEBUG_UI] end request', { slot: APP_CONFIG.selected_data_slot });
            const res = await fetch(`http://localhost:8787/api/timed_event/debug/end?slot=${APP_CONFIG.selected_data_slot}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });
            const data = await res.json().catch(() => null as any);
            debug_log('[TIMED_EVENT_DEBUG_UI] end response', { status: res.status, ok: res.ok, data });
            if (!res.ok || !data?.ok) {
                return { ok: false, error: String(data?.error ?? `HTTP ${res.status}`) };
            }
            return { ok: true };
        } catch {
            return { ok: false, error: 'network_error' };
        }
    }

    async function refresh_timed_event_debug_state(): Promise<void> {
        const prev_timed_event_active = ui_state.timed_event_debug.active;
        const prev_active_actor_ref = ui_state.timed_event_debug.active_actor_ref;
        const data = await fetch_timed_event_state();
        ui_state.timed_event_debug.active = !!data?.timed_event_active;
        ui_state.timed_event_debug.type = data?.timed_event_type ?? null;
        ui_state.timed_event_debug.phase = typeof data?.timed_event_phase === 'string' ? data.timed_event_phase : null;
        ui_state.timed_event_debug.trigger_kind = data?.trigger?.kind ?? null;
        ui_state.timed_event_debug.current_turn = typeof data?.current_turn === 'number' ? data.current_turn : null;
        ui_state.timed_event_debug.current_round = typeof data?.current_round === 'number' ? data.current_round : null;
        ui_state.timed_event_debug.active_actor_ref = typeof data?.active_actor_ref === 'string' ? data.active_actor_ref : null;
        ui_state.timed_event_debug.turn_window_breaths = typeof data?.turn_window_breaths === 'number' ? data.turn_window_breaths : null;
        ui_state.timed_event_debug.turn_breaths_remaining = typeof data?.turn_breaths_remaining === 'number' ? data.turn_breaths_remaining : null;
        ui_state.timed_event_debug.timed_event_world_breath_index = typeof data?.timed_event_world_breath_index === 'number'
            ? data.timed_event_world_breath_index
            : null;
        ui_state.timed_event_debug.pending_communication_opportunities = Array.isArray(data?.pending_communication_opportunities)
            ? data.pending_communication_opportunities.map((opp: any) => ({
                opportunity_id: String(opp?.opportunity_id ?? ''),
                npc_ref: String(opp?.npc_ref ?? ''),
                conversation_id: typeof opp?.conversation_id === 'string' ? opp.conversation_id : null,
                queue_entry_id: typeof opp?.queue_entry_id === 'string' ? opp.queue_entry_id : null,
                queue_stable_order: typeof opp?.queue_stable_order === 'number' ? opp.queue_stable_order : null,
                source_message_id: String(opp?.source_message_id ?? ''),
                trigger_context: typeof opp?.trigger_context === 'string' ? opp.trigger_context : null,
                created_turn: typeof opp?.created_turn === 'number' ? opp.created_turn : null,
                created_round: typeof opp?.created_round === 'number' ? opp.created_round : null,
                status: String(opp?.status ?? 'unknown'),
            }))
            : [];
        ui_state.timed_event_debug.initiative_order = Array.isArray(data?.initiative_order)
            ? data.initiative_order.map((entry: any) => ({
                actor_ref: String(entry?.actor_ref ?? ''),
                initiative_roll: Number(entry?.initiative_roll ?? 0) || 0,
                actions_remaining: Number(entry?.actions_remaining ?? 0) || 0,
                partial_actions_remaining: Number(entry?.partial_actions_remaining ?? 0) || 0,
                movement_remaining: Number(entry?.movement_remaining ?? 0) || 0,
                movement_budgets: entry?.movement_budgets && typeof entry.movement_budgets === 'object'
                    ? {
                        walk: Number(entry.movement_budgets.walk ?? 0) || 0,
                        climb: Number(entry.movement_budgets.climb ?? 0) || 0,
                        swim: Number(entry.movement_budgets.swim ?? 0) || 0,
                        fly: Number(entry.movement_budgets.fly ?? 0) || 0,
                    }
                    : null,
                status: String(entry?.status ?? 'unknown'),
            }))
            : [];
        debug_log('[TIMED_EVENT_DEBUG_UI] state applied', {
            active: ui_state.timed_event_debug.active,
            type: ui_state.timed_event_debug.type,
            phase: ui_state.timed_event_debug.phase,
            trigger_kind: ui_state.timed_event_debug.trigger_kind,
            turn: ui_state.timed_event_debug.current_turn,
            round: ui_state.timed_event_debug.current_round,
            active_actor_ref: ui_state.timed_event_debug.active_actor_ref,
            world_breath_index: ui_state.timed_event_debug.timed_event_world_breath_index,
            initiative_count: ui_state.timed_event_debug.initiative_order.length,
        });
        const timed_event_toggled = prev_timed_event_active !== ui_state.timed_event_debug.active;
        const active_actor_changed = prev_active_actor_ref !== ui_state.timed_event_debug.active_actor_ref;
        if (!ui_state.place_painter.active && (timed_event_toggled || active_actor_changed)) {
            if (ui_state.timed_event_debug.phase === 'world_sim_interstitial' || (ui_state.timed_event_debug.active && !ui_state.timed_event_debug.active_actor_ref)) {
                center_camera_on_current_place();
            } else {
                const follow_place_id = resolve_follow_camera_entity_place_id(get_follow_camera_entity_ref());
                if (follow_place_id && follow_place_id !== ui_state.place.scene_selected_place_id) {
                    await set_scene_selected_place(follow_place_id, { refresh: false, center_camera: true });
                } else {
                    snap_place_camera_follow_to_actor();
                }
            }
        }
        refresh_debug_window_messages();
    }

    function get_input_actor_ref(): string {
        const actor_id = get_controlled_actor_id();
        return actor_id ? `actor.${actor_id}` : '';
    }

    function get_controlled_actor_id(): string {
        return String(APP_CONFIG.input_actor_id ?? '').trim();
    }

    function get_controlled_actor_snapshot(place: Place | null | undefined): any | null {
        if (!place) return null;
        const actor_ref = get_input_actor_ref();
        if (!actor_ref) return null;
        return Array.isArray(place.contents?.actors_present)
            ? place.contents.actors_present.find((actor: any) => String(actor?.actor_ref ?? '') === actor_ref) ?? null
            : null;
    }

    function get_follow_camera_entity_ref(): string {
        if (ui_state.timed_event_debug.active && ui_state.timed_event_debug.phase === 'world_sim_interstitial') {
            return '';
        }
        if (ui_state.timed_event_debug.active && typeof ui_state.timed_event_debug.active_actor_ref === 'string' && ui_state.timed_event_debug.active_actor_ref.length > 0) {
            return ui_state.timed_event_debug.active_actor_ref;
        }
        return get_input_actor_ref();
    }

    function find_entity_in_place(place: Place | null | undefined, entity_ref: string): any | null {
        if (!place || !entity_ref) return null;
        if (entity_ref.startsWith('actor.')) {
            return Array.isArray(place.contents?.actors_present)
                ? place.contents.actors_present.find((actor: any) => String(actor?.actor_ref ?? '') === entity_ref) ?? null
                : null;
        }
        if (entity_ref.startsWith('npc.')) {
            return Array.isArray(place.contents?.npcs_present)
                ? place.contents.npcs_present.find((npc: any) => String(npc?.npc_ref ?? '') === entity_ref) ?? null
                : null;
        }
        return null;
    }

    function get_entity_focus_tile_in_place(place: Place | null | undefined, entity_ref: string): { x: number; y: number; z: number } | null {
        const entity = find_entity_in_place(place, entity_ref);
        if (!entity || !place) return null;
        const base_z = Math.floor(Number((place as any)?.coordinates?.elevation ?? 0)) || 0;
        return get_character_camera_focus_tile({
            entity,
            entity_ref,
            fallback_world_z: base_z,
        });
    }

    function get_input_actor_timed_event_entry(): {
        actor_ref: string;
        actions_remaining: number;
        partial_actions_remaining: number;
        movement_remaining: number;
        movement_budgets: { walk: number; climb: number; swim: number; fly: number } | null;
        status: string;
    } | null {
        const actor_ref = get_input_actor_ref();
        return ui_state.timed_event_debug.initiative_order.find((entry) => entry.actor_ref === actor_ref) ?? null;
    }

    function get_default_action_cost_for_verb(verb: 'COMMUNICATE' | 'INSPECT'): 'FREE' | 'PARTIAL' | 'FULL' | 'EXTENDED' {
        if (ui_state.timed_event_debug.active) return 'PARTIAL';
        return 'FULL';
    }

    function get_effective_action_cost_for_verb(verb: 'COMMUNICATE' | 'INSPECT'): 'FREE' | 'PARTIAL' | 'FULL' | 'EXTENDED' {
        const raw = String(ui_state.controls.override_cost ?? '').toUpperCase();
        if (raw === 'FREE' || raw === 'PARTIAL' || raw === 'FULL' || raw === 'EXTENDED') return raw;
        return get_default_action_cost_for_verb(verb);
    }

    function get_timed_event_action_gate(verb: 'COMMUNICATE' | 'INSPECT'): {
        locked: boolean;
        reason: string | null;
        action_cost: 'FREE' | 'PARTIAL' | 'FULL' | 'EXTENDED';
    } {
        const action_cost = get_effective_action_cost_for_verb(verb);
        if (!ui_state.timed_event_debug.active) {
            return { locked: false, reason: null, action_cost };
        }

        const actor_ref = get_input_actor_ref();
        if (!ui_state.timed_event_debug.active_actor_ref) {
            return { locked: true, reason: 'no_timed_event_actor', action_cost };
        }
        if (ui_state.timed_event_debug.active_actor_ref !== actor_ref) {
            return { locked: true, reason: 'not_your_turn', action_cost };
        }

        const entry = get_input_actor_timed_event_entry();
        if (!entry) {
            return { locked: true, reason: 'no_timed_event_actor', action_cost };
        }

        switch (action_cost) {
            case 'FREE':
                return { locked: false, reason: null, action_cost };
            case 'PARTIAL':
                return entry.partial_actions_remaining > 0
                    ? { locked: false, reason: null, action_cost }
                    : { locked: true, reason: 'cannot_afford_partial', action_cost };
            case 'FULL':
                return entry.actions_remaining > 0
                    ? { locked: false, reason: null, action_cost }
                    : { locked: true, reason: 'cannot_afford_full', action_cost };
            case 'EXTENDED':
                return (entry.actions_remaining > 0 && entry.partial_actions_remaining > 0)
                    ? { locked: false, reason: null, action_cost }
                    : { locked: true, reason: 'cannot_afford_extended', action_cost };
        }
    }

    function format_action_gate_reason(reason: string | null, action_cost?: string): string {
        switch (reason) {
            case 'not_your_turn': return 'Waiting for your turn';
            case 'no_timed_event_actor': return 'No active timed-event actor';
            case 'cannot_afford_partial': return 'No PARTIAL actions left';
            case 'cannot_afford_full': return 'No FULL actions left';
            case 'cannot_afford_extended': return 'No EXT actions left';
            default: return action_cost ? `${action_cost} action unavailable` : 'Action unavailable';
        }
    }

    function get_submit_action_gate(): { locked: boolean; reason: string | null; action_cost: string | null } {
        const draft = String(ui_state.controls.draft ?? '');
        const hint = infer_action_verb_hint(draft);
        const verb_effective = ui_state.controls.override_intent ?? hint.verb;
        if (verb_effective === 'COMMUNICATE' || verb_effective === 'INSPECT') {
            const gate = get_timed_event_action_gate(verb_effective);
            return gate;
        }
        return { locked: false, reason: null, action_cost: null };
    }

    const debug_pause_controller = create_current_place_pause_controller('debug_pause');
    const place_painter_pause_controller = create_current_place_pause_controller('place_painter');

    async function set_place_painter_active(next_active: boolean): Promise<boolean> {
        if (next_active) {
            const tile_palette_ok = await ensure_place_painter_tile_palette_loaded();
            const item_palette_ok = await ensure_place_painter_item_palette_loaded();
            if (!tile_palette_ok && !item_palette_ok) return false;
            const ok = await place_painter_pause_controller.activate();
            if (!ok) return false;
            ui_state.place_painter.active = true;
            ui_state.place_painter.selected_tool = ui_state.place_painter.left_click_tool;
        if (tile_palette_ok) ui_state.place_painter.selected_palette_kind = 'tile';
        else if (item_palette_ok) ui_state.place_painter.selected_palette_kind = 'item';
            if (tile_palette_ok) {
                const active_entries = get_active_place_painter_tile_entries();
                if (!active_entries.some((entry) => entry.id === ui_state.place_painter.selected_palette_entry_id)) {
                    ui_state.place_painter.selected_palette_entry_id = active_entries[0]?.id ?? ui_state.place_painter.tile_palette_entries[0]?.id ?? null;
                }
            }
            const actor_tile = get_current_place()?.contents?.actors_present?.find((a: any) => a.actor_ref === get_input_actor_ref())?.tile_position;
            if (actor_tile) set_place_camera_target_position(actor_tile, 'free');
            set_place_painter_modules_visible(true);
            save_place_painter_prefs_debounced();
            return true;
        }
        const ok = await place_painter_pause_controller.deactivate();
        if (!ok) return false;
        ui_state.place_painter.active = false;
        ui_state.place_painter.last_primary_target = null;
        ui_state.place_painter.move_pending_source = null;
        ui_state.place_painter.move_drag_session = null;
        ui_state.place_painter.shape_session = null;
        snap_place_camera_follow_to_actor();
        set_place_painter_modules_visible(false);
        return true;
    }

    async function toggle_place_painter(): Promise<boolean> {
        return await set_place_painter_active(!ui_state.place_painter.active);
    }

    function start_place_shape_drag(target: {
        place_id: string;
        tile_position: { x: number; y: number };
        world_z: number;
        button?: number;
    }): void {
        const tool = get_place_painter_tool_for_button(target.button);
        if (!is_place_painter_shape_tool(tool)) return;
        ui_state.place_painter.selected_tool = tool;
        ui_state.place_painter.shape_session = {
            tool,
            button: target.button === 2 ? 2 : 0,
            place_id: target.place_id,
            world_z: Math.floor(target.world_z),
            start_x: Math.floor(target.tile_position.x),
            start_y: Math.floor(target.tile_position.y),
            current_x: Math.floor(target.tile_position.x),
            current_y: Math.floor(target.tile_position.y),
        };
    }

    function update_place_shape_drag(target: {
        place_id: string;
        tile_position: { x: number; y: number };
        world_z: number;
    }): void {
        const session = ui_state.place_painter.shape_session;
        if (!session || session.place_id !== target.place_id) return;
        if (Math.floor(target.world_z) !== session.world_z) return;
        session.current_x = Math.floor(target.tile_position.x);
        session.current_y = Math.floor(target.tile_position.y);
    }

    async function finish_place_shape_drag(): Promise<void> {
        const session = ui_state.place_painter.shape_session;
        clear_place_painter_shape_session();
        if (!session) return;

        const active_place = get_current_place();
        if (!active_place || active_place.id !== session.place_id) {
            flash_status(['Shape tools only work on the selected place'], 1200);
            return;
        }

        const points = get_place_painter_shape_preview_points_from_session(session);
        if (points.length < 1) return;

        if (ui_state.place_painter.selected_palette_kind !== 'tile') {
            flash_status(['Line/rect/fill are tile-only for now'], 1200);
            return;
        }

        const tool = session.button === 2 ? ui_state.place_painter.right_click_tool : ui_state.place_painter.left_click_tool;
        if (tool === 'erase') {
            const side = get_place_painter_side_for_button(session.button);
            if (!is_place_painter_erase_target_enabled('tiles', side)) {
                flash_status(['Shape erase is tile-only', 'Enable tile erase to use line/rect erase'], 1400);
                return;
            }
            const ok = await mutate_place_tiles_batch(session.place_id, points.map((point) => ({ x: point.x, y: point.y, z: session.world_z, erase: true })));
            flash_status([ok ? `Erased ${points.length} tiles` : 'Shape erase failed'], 1200);
            return;
        }

        const selected = get_selected_place_painter_tile_entry();
        if (!selected) {
            flash_status(['Place painter has no tile selected'], 1200);
            return;
        }
        const ok = await mutate_place_tiles_batch(session.place_id, points.map((point) => ({ x: point.x, y: point.y, z: session.world_z, kind: selected.id })));
        flash_status([ok ? `Painted ${selected.id} x${points.length}` : `Shape paint failed: ${selected.id}`], 1200);
    }

    function get_place_painter_shape_preview_points_from_session(session: NonNullable<typeof ui_state.place_painter.shape_session>): PainterPoint[] {
        if (session.tool === 'line') return get_line_points(session.start_x, session.start_y, session.current_x, session.current_y);
        if (session.tool === 'rect_stroke') return get_rect_stroke_points(session.start_x, session.start_y, session.current_x, session.current_y);
        return get_rect_fill_points(session.start_x, session.start_y, session.current_x, session.current_y);
    }

    function get_place_painter_character_targets_at(place_id: string, x: number, y: number, z: number): Array<{ entity_ref: string; entity_type: 'actor' | 'npc' }> {
        const place = (get_scene_place(place_id) ?? ui_state.place.current_place) as any;
        if (!place || String(place.id ?? '') !== place_id) return [];
        const out: Array<{ entity_ref: string; entity_type: 'actor' | 'npc' }> = [];
        const actors = Array.isArray(place?.contents?.actors_present) ? place.contents.actors_present : [];
        const npcs = Array.isArray(place?.contents?.npcs_present) ? place.contents.npcs_present : [];
        for (const actor of actors) {
            const pos = actor?.tile_position;
            const az = typeof actor?.elevation === 'number' ? Math.floor(actor.elevation) : null;
            if (pos?.x === x && pos?.y === y && az === z) out.push({ entity_ref: String(actor?.actor_ref ?? ''), entity_type: 'actor' });
        }
        for (const npc of npcs) {
            const pos = npc?.tile_position;
            const nz = typeof npc?.elevation === 'number' ? Math.floor(npc.elevation) : null;
            if (pos?.x === x && pos?.y === y && nz === z) out.push({ entity_ref: String(npc?.npc_ref ?? ''), entity_type: 'npc' });
        }
        return out.filter((entry) => entry.entity_ref.length > 0);
    }

    function get_place_painter_item_target_at(x: number, y: number, z: number): { entity_ref: string; entity_type: 'item' | 'pile'; count: number } | null {
        const voxel_key = `${x}_${y}_${Math.floor(z)}`;
        const item_ids = [...(ui_state.place.ground_items_by_voxel.get(voxel_key) ?? [])].filter((id) => typeof id === 'string' && id.length > 0);
        if (item_ids.length < 1) return null;
        if (item_ids.length === 1) {
            return { entity_ref: `item.${item_ids[0]}`, entity_type: 'item', count: 1 };
        }
        return { entity_ref: `pile:${x}_${y}_${Math.floor(z)}`, entity_type: 'pile', count: item_ids.length };
    }

    async function erase_place_painter_targets_at(place_id: string, x: number, y: number, z: number, button?: number): Promise<{ ok: boolean; messages: string[] }> {
        const messages: string[] = [];
        let attempted = false;
        let ok = true;
        const side = get_place_painter_side_for_button(button);
        const brush_size = get_place_painter_brush_size_for_side(side);
        ui_state.place_painter.active_property_side = side;

        if (is_place_painter_erase_target_enabled('characters', side)) {
            const chars = get_place_painter_character_targets_at(place_id, x, y, z);
            if (chars.length > 0) {
                attempted = true;
                messages.push('Character erase is stubbed');
                ok = false;
            }
        }

        if (is_place_painter_erase_target_enabled('items', side)) {
            const item_target = get_place_painter_item_target_at(x, y, z);
            if (item_target) {
                attempted = true;
                const result = await erase_place_painter_entity({
                    place_id,
                    entity_ref: item_target.entity_ref,
                    entity_type: item_target.entity_type,
                    source_x: x,
                    source_y: y,
                    source_z: z,
                });
                if (result.ok) messages.push(item_target.entity_type === 'pile' ? `Erased ${item_target.count} items` : 'Erased item');
                else {
                    messages.push(`Item erase failed: ${result.error ?? 'unknown_error'}`);
                    ok = false;
                }
            }
        }

        if (is_place_painter_erase_target_enabled('tiles', side)) {
            attempted = true;
            const erased = await erase_place_painter_tiles_brush_at(place_id, x, y, z, brush_size);
            if (erased.ok) messages.push(erased.count > 1 ? `Erased ${erased.count} tiles` : 'Erased tile');
            else {
                messages.push('Tile erase failed');
                ok = false;
            }
        }

        if (!attempted) {
            return { ok: false, messages: ['Erase has no targets enabled'] };
        }
        if (messages.length < 1) {
            return { ok: false, messages: ['Nothing to erase here'] };
        }
        return { ok, messages };
    }

    async function erase_place_painter_tiles_brush_at(place_id: string, x: number, y: number, z: number, brush_size: number): Promise<{ ok: boolean; count: number }> {
        const points = get_place_painter_brush_points(x, y, brush_size);
        if (points.length < 1) return { ok: false, count: 0 };
        if (points.length === 1) {
            const ok = await erase_place_tile_at(place_id, x, y, z);
            return { ok, count: ok ? 1 : 0 };
        }
        const ok = await mutate_place_tiles_batch(place_id, points.map((point) => ({ x: point.x, y: point.y, z, erase: true })));
        return { ok, count: ok ? points.length : 0 };
    }

    async function handle_place_painter_primary_action(target: {
        place_id: string;
        tile_position: { x: number; y: number };
        world_z: number;
        button?: number;
        entity_ref?: string;
        entity_type?: 'npc' | 'actor' | 'item' | 'pile' | 'structure';
    }): Promise<void> {
        ui_state.place_painter.last_primary_target = {
            place_id: target.place_id,
            x: target.tile_position.x,
            y: target.tile_position.y,
            z: target.world_z,
            entity_ref: target.entity_ref,
            entity_type: target.entity_type,
        };

        const tool = get_place_painter_tool_for_button(target.button);
        const side = get_place_painter_side_for_button(target.button);
        ui_state.place_painter.active_property_side = side;
        ui_state.place_painter.selected_tool = tool;
        const target_label = target.entity_ref
            ? `${get_entity_display_name(target.entity_ref)} @ ${target.tile_position.x},${target.tile_position.y},${target.world_z}`
            : `${target.tile_position.x},${target.tile_position.y},${target.world_z}`;
        debug_log(`[PLACE_PAINTER] primary action ${JSON.stringify({ tool, button: target.button ?? 0, palette_kind: ui_state.place_painter.selected_palette_kind, target_label })}`);

        const active_place = get_current_place();
        const is_selected_place = !!active_place && active_place.id === target.place_id;
        const z_sensitive_tool = tool === 'paint' || tool === 'erase' || tool === 'place_create' || tool === 'place_delete' || tool === 'place_resize';
        if (active_place && z_sensitive_tool && !is_world_z_inside_place(active_place, target.world_z)) {
            flash_status([`Target z ${target.world_z} is outside ${active_place.id}`], 1500);
            debug_warn(`[PLACE_PAINTER] rejected out-of-bounds z target ${JSON.stringify({ tool, place_id: active_place.id, target_place_id: target.place_id, target_world_z: target.world_z, bounds: get_place_region_bounds(active_place) })}`);
            return;
        }

        if (active_place && !is_selected_place) {
            if (tool === 'paint' || tool === 'erase' || tool === 'move' || tool === 'place_create' || tool === 'place_resize' || tool === 'region_tool') {
                const focused = await focus_scene_place_for_painter(target.place_id);
                if (!focused) {
                    flash_status([`Focus failed: ${target.place_id}`], 1200);
                }
                return;
            }
        }

        if (tool === 'paint') {
            if (!active_place || !is_selected_place) {
                flash_status(['Paint only works on the selected place'], 1200);
                return;
            }
            const border_direction = detect_place_topology_face(active_place, target.tile_position.x, target.tile_position.y, target.world_z);
            if (ui_state.place_painter.selected_palette_kind === 'item') {
                const selected = get_selected_place_painter_item_entry();
                if (!selected) {
                    flash_status(['Place painter has no item selected'], 1200);
                    return;
                }
                const ok = await place_place_painter_item_at(
                    target.place_id,
                    target.tile_position.x,
                    target.tile_position.y,
                    target.world_z,
                    selected.id,
                );
                if (!ok) {
                    flash_status([`Item place failed: ${selected.id}`], 1200);
                    return;
                }
                flash_status([
                    `Placed ${selected.id}`,
                    `tile: ${target_label}`,
                ], 1200);
                return;
            }
            const selected = get_selected_place_painter_tile_entry();
            if (!selected) {
                flash_status(['Place painter has no tile selected'], 1200);
                return;
            }
            if (selected.id === 'place_connector') {
                flash_status(['Same-region place_connector is obsolete; use place create instead'], 1800);
                return;
            }
            const brush_points = get_place_painter_brush_points(target.tile_position.x, target.tile_position.y, get_place_painter_brush_size_for_side(side));
            const ok = brush_points.length === 1
                ? await paint_place_tile_at(
                    target.place_id,
                    target.tile_position.x,
                    target.tile_position.y,
                    target.world_z,
                    selected.id,
                )
                : await mutate_place_tiles_batch(target.place_id, brush_points.map((point) => ({ x: point.x, y: point.y, z: target.world_z, kind: selected.id })));
            if (!ok) {
                flash_status([`Paint failed: ${selected.id}`], 1200);
                return;
            }
            flash_status([
                brush_points.length > 1 ? `Painted ${selected.id} x${brush_points.length}` : `Painted ${selected.id}`,
                `tile: ${target_label}`,
            ], 1200);
            return;
        }

        if (tool === 'eyedropper') {
            const sampled_place = get_scene_place(target.place_id) ?? active_place;
            if (target.entity_type === 'item' && target.entity_ref) {
                const itemId = target.entity_ref.replace(/^item\./, '');
                const meta: any = ui_state.place.ground_items_by_id.get(itemId) ?? null;
                const itemDefId = String(meta?.def_id ?? '').trim();
                if (itemDefId && set_place_painter_selected_item_by_id(itemDefId)) {
                    flash_status([`Item: ${itemDefId}`], 1200);
                    return;
                }
            }
            const sampledKind = get_place_tile_kind_at(sampled_place, target.tile_position.x, target.tile_position.y, target.world_z);
            if (sampledKind && set_place_painter_selected_tile_by_id(sampledKind)) {
                flash_status([`Tile: ${sampledKind}`], 1200);
                return;
            }
            flash_status(['Nothing to sample'], 1000);
            return;
        }

        if (tool === 'bucket') {
            if (!active_place || !is_selected_place) {
                flash_status(['Bucket only works on the selected place'], 1200);
                return;
            }
            if (ui_state.place_painter.selected_palette_kind !== 'tile') {
                flash_status(['Bucket is tile-only for now'], 1200);
                return;
            }
            const selected = get_selected_place_painter_tile_entry();
            if (!selected) {
                flash_status(['Place painter has no tile selected'], 1200);
                return;
            }
            const startKind = get_place_tile_kind_at(active_place, target.tile_position.x, target.tile_position.y, target.world_z);
            if (startKind === selected.id) {
                flash_status(['Bucket target already matches selection'], 1000);
                return;
            }
            const points = get_flood_fill_points(
                target.tile_position.x,
                target.tile_position.y,
                (x, y) => get_place_tile_kind_at(get_current_place(), x, y, target.world_z),
                (candidate, targetKind) => candidate === targetKind,
            );
            if (points.length < 1) {
                flash_status(['Nothing to fill'], 1000);
                return;
            }
            const ok = await mutate_place_tiles_batch(target.place_id, points.map((point) => ({ x: point.x, y: point.y, z: target.world_z, kind: selected.id })));
            flash_status([ok ? `Filled ${points.length} tiles` : `Bucket failed: ${selected.id}`], 1200);
            return;
        }

        if (tool === 'erase') {
            if (!active_place || !is_selected_place) {
                flash_status(['Erase only works on the selected place'], 1200);
                return;
            }
            const result = await erase_place_painter_targets_at(
                target.place_id,
                target.tile_position.x,
                target.tile_position.y,
                target.world_z,
                target.button,
            );
            if (!result.ok) {
                flash_status([...result.messages, `tile: ${target_label}`], 1400);
                return;
            }
            flash_status([...result.messages, `tile: ${target_label}`], 1200);
            return;
        }

        if (tool === 'move') {
            if (!active_place || !is_selected_place) {
                flash_status(['Move only works on the selected place'], 1200);
                return;
            }

            const pending = ui_state.place_painter.move_pending_source;
            if (!pending) {
                if (!target.entity_ref || !target.entity_type) {
                    flash_status(['Move source: click an entity, item, pile, or structure'], 1400);
                    return;
                }
                ui_state.place_painter.move_pending_source = {
                    place_id: target.place_id,
                    x: target.tile_position.x,
                    y: target.tile_position.y,
                    z: target.world_z,
                    entity_ref: target.entity_ref,
                    entity_type: target.entity_type,
                };
                flash_status([
                    `Move source: ${target.entity_ref}`,
                    `at ${target.tile_position.x},${target.tile_position.y},${target.world_z}`,
                    'Click destination tile',
                ], 1500);
                return;
            }

            if (
                pending.place_id === target.place_id
                && pending.x === target.tile_position.x
                && pending.y === target.tile_position.y
                && pending.z === target.world_z
            ) {
                ui_state.place_painter.move_pending_source = null;
                flash_status(['Move canceled'], 900);
                return;
            }

            const mv = await move_place_painter_entity({
                place_id: target.place_id,
                source_x: pending.x,
                source_y: pending.y,
                source_z: pending.z,
                target_x: target.tile_position.x,
                target_y: target.tile_position.y,
                target_z: target.world_z,
                entity_ref: pending.entity_ref,
                entity_type: pending.entity_type,
            });

            ui_state.place_painter.move_pending_source = null;
            if (!mv.ok) {
                flash_status([`Move failed: ${mv.error ?? 'unknown_error'}`], 1800);
                return;
            }

            await refresh_selected_scene_place(target.place_id, { source: 'place_painter_move', preserve_place_painter: true });
            flash_status([
                `Moved ${pending.entity_ref}`,
                `to ${target.tile_position.x},${target.tile_position.y},${target.world_z}`,
            ], 1200);
            return;
        }

        if (tool === 'character') {
            if (target.entity_ref && (target.entity_type === 'npc' || target.entity_type === 'actor')) {
                await open_character_editor_module(target.entity_ref);
                return;
            }
            if (target.entity_ref && target.entity_type === 'item') {
                select_item_for_entity_inspector({ item_ref: target.entity_ref, owner_kind: 'place', owner_id: target.place_id });
                return;
            }
            await open_tile_editor_module(target.place_id, target.tile_position.x, target.tile_position.y, target.world_z);
            return;
        }

        if (tool === 'place_create') {
            if (!active_place || !is_selected_place) {
                flash_status(['Place create only works from the selected place'], 1500);
                return;
            }
            const result = await create_connected_place_from_border(active_place, target.tile_position.x, target.tile_position.y, target.world_z);
            if (!result.ok) {
                flash_status([`Create place failed: ${result.error}`], 1800);
                return;
            }
            flash_status([`Created ${result.new_place_id}`], 1500);
            const scene = await fetch_scene_topology(active_place.id);
            if (scene) {
                apply_scene_topology(scene, { selected_place_id: active_place.id, mirror_to_current_place: true });
            } else {
                await refresh_single_scene_place(active_place.id);
            }
            return;
        }

        if (tool === 'place_delete') {
            if (!active_place) {
                flash_status(['Place delete requires a selected place'], 1500);
                return;
            }
            if (target.place_id === active_place.id) {
                flash_status(['Click the adjacent place you want to delete'], 1500);
                return;
            }
            const result = await delete_adjacent_place(active_place, target.place_id);
            if (!result.ok) {
                flash_status([`Delete place failed: ${result.error}`], 1800);
                return;
            }
            flash_status([`Deleted ${result.target_place_id}`], 1500);
            const scene = await fetch_scene_topology(active_place.id);
            if (scene) {
                apply_scene_topology(scene, { selected_place_id: active_place.id, mirror_to_current_place: true });
            } else {
                await refresh_single_scene_place(active_place.id);
            }
            return;
        }

        if (tool === 'place_resize') {
            debug_log(`[SEAM_TOOL] resize requested ${JSON.stringify({ place_id: active_place?.id ?? null, target_place_id: target.place_id, tile: target.tile_position, world_z: target.world_z, is_selected_place })}`);
            flash_status(['Resize: click a face of the selected place', 'For z faces, click target z to reanchor that face'], 1600);
            return;
        }

        if (tool === 'region_tool') {
            flash_status(['Region tool not implemented yet'], 1200);
            return;
        }

        flash_status([
            `Place painter ${tool}`,
            target.entity_ref ? `target: ${target_label}` : `tile: ${target_label}`,
        ], 1200);
    }

    function place_painter_module_ids(include_auxiliary: boolean = false): string[] {
        const ids = ['place_painter_tools', 'place_painter_palette', 'place_painter_layers', 'place_painter_tool_properties'];
        if (include_auxiliary) ids.push('entity_inspector_module', 'tag_picker_module', 'option_picker_module');
        return ids;
    }

    function set_place_painter_modules_visible(visible: boolean): void {
        for (const id of place_painter_module_ids()) {
            set_module_visible(id, visible);
        }
        if (!visible) {
            close_entity_inspector();
            close_tag_picker_module();
            close_option_picker();
        }
    }

    async function erase_place_painter_entity(args: {
        place_id: string;
        entity_ref: string;
        entity_type: 'npc' | 'actor' | 'item' | 'pile';
        source_x: number;
        source_y: number;
        source_z: number;
    }): Promise<{ ok: boolean; error?: string; deleted_count?: number }> {
        const base_url = APP_CONFIG.place_endpoint.replace('/api/place', '');
        try {
            debug_log(`[PLACE_PAINTER] erase entity request ${JSON.stringify(args)}`);
            const res = await fetch(`${base_url}/api/place_painter/erase`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    slot: APP_CONFIG.selected_data_slot,
                    place_id: args.place_id,
                    entity_ref: args.entity_ref,
                    entity_type: args.entity_type,
                    source: { x: args.source_x, y: args.source_y, z: args.source_z },
                }),
            });
            const data = await res.json().catch(() => null as any);
            if (!res.ok || !data?.ok) {
                debug_warn(`[PLACE_PAINTER] erase entity failed ${JSON.stringify({ args, status: res.status, data })}`);
                return { ok: false, error: String(data?.error ?? 'erase_failed') };
            }
            if (args.entity_type === 'item' || args.entity_type === 'pile') {
                apply_local_place_entity_erase(args.place_id, args.entity_ref, args.entity_type, args.source_x, args.source_y, args.source_z);
            }
            await update_current_place(args.place_id, { source: 'place_painter_erase_entity', preserve_place_painter: true });
            debug_log(`[PLACE_PAINTER] erase entity success ${JSON.stringify({ ...args, deleted_count: Number(data?.deleted ?? 0) })}`);
            return { ok: true, deleted_count: Number(data?.deleted ?? 0) || 0 };
        } catch {
            return { ok: false, error: 'network_error' };
        }
    }

    function persist_module_rect(module_id: string, rect: Rect): void {
        ui_state.modules.positions.set(module_id, rect);
        persist_module_layout_debounced();
    }

    function make_place_painter_window_module(opts: {
        id: string;
        rect: Rect;
        title: string;
        draw_content: (c: Canvas, rect: Rect) => void;
        on_pointer_down_content?: (e: PointerEvent, rect: Rect) => void;
    }): Module {
        const gizmo_config: ModuleGizmosConfig = {
            enabled: ['move', 'resize', 'close', 'seamless'],
            can_close: true,
            can_move: true,
            can_save_position: false,
            on_close: () => set_module_visible(opts.id, false),
            on_move: (new_rect) => persist_module_rect(opts.id, new_rect),
            on_resize: (new_rect) => persist_module_rect(opts.id, new_rect),
        };
        return make_floating_panel_module({
            id: opts.id,
            rect: opts.rect,
            title: opts.title,
            gizmos: gizmo_config,
            background: { rgb: get_color_by_name('off_black').rgb },
            resize: {
                min_width: 12,
                min_height: 6,
                max_width: 120,
                max_height: 40,
            },
            draw_content: opts.draw_content,
            on_pointer_down_content: opts.on_pointer_down_content,
        });
    }

    function place_painter_tool_defs(): Array<{ tool: PlacePainterTool; label: string; icon: string }> {
        return [
            { tool: 'paint', label: 'Paint', icon: '✎' },
            { tool: 'erase', label: 'Eraser', icon: '◫' },
            { tool: 'eyedropper', label: 'Dropper', icon: '◉' },
            { tool: 'line', label: 'Line', icon: '╱' },
            { tool: 'rect_stroke', label: 'Rect', icon: '□' },
            { tool: 'rect_fill', label: 'Fill', icon: '■' },
            { tool: 'bucket', label: 'Bucket', icon: '▧' },
            { tool: 'character', label: 'Entity', icon: '@' },
            { tool: 'move', label: 'Move', icon: '◎' },
            { tool: 'place_create', label: 'Create', icon: '+' },
            { tool: 'place_delete', label: 'Delete', icon: '-' },
            { tool: 'place_resize', label: 'Resize', icon: '<>' },
            { tool: 'region_tool', label: 'Region', icon: '[]' },
        ];
    }

    function make_place_painter_toolbar_module(rect: Rect): Module {
        const toggle = (id: string): void => set_module_visible(id, !module_registry.is_visible(id));
        const debug_items: ProgramNavAction[] = [
            { id: 'debug_text', label: () => `DEBUG:${module_registry.is_visible('debug') ? 'ON' : 'OFF'}`, width: 13, onPress: () => toggle('debug'), is_active: () => module_registry.is_visible('debug') },
            { id: 'debug_cmd', label: () => `COMMANDER:${module_registry.is_visible('debug_commander_module') ? 'ON' : 'OFF'}`, width: 17, onPress: () => toggle('debug_commander_module'), is_active: () => module_registry.is_visible('debug_commander_module') },
        ];
        const module_items: ProgramNavAction[] = [
            { id: 'status', label: () => `STATUS:${module_registry.is_visible('status') ? 'ON' : 'OFF'}`, width: 14, onPress: () => toggle('status'), is_active: () => module_registry.is_visible('status') },
            { id: 'transcript', label: () => `TRANSCRIPT:${module_registry.is_visible('transcript') ? 'ON' : 'OFF'}`, width: 18, onPress: () => toggle('transcript'), is_active: () => module_registry.is_visible('transcript') },
            { id: 'input', label: () => `INPUT:${module_registry.is_visible('input') ? 'ON' : 'OFF'}`, width: 13, onPress: () => toggle('input'), is_active: () => module_registry.is_visible('input') },
            { id: 'roller', label: () => `ROLLER:${module_registry.is_visible('roller') ? 'ON' : 'OFF'}`, width: 14, onPress: () => toggle('roller'), is_active: () => module_registry.is_visible('roller') },
            { id: 'character', label: () => `CHAR:${module_registry.is_visible('character_module') ? 'ON' : 'OFF'}`, width: 12, onPress: () => toggle('character_module'), is_active: () => module_registry.is_visible('character_module') },
        ];
        const system_items: ProgramNavAction[] = [
            { id: 'logout', label: 'LOGOUT', width: 8, onPress: () => { void logout_to_actor_claim(); } },
        ];
        const paint_items: ProgramNavAction[] = [
            { id: 'tools', label: () => `TOOLS:${module_registry.is_visible('place_painter_tools') ? 'ON' : 'OFF'}`, width: 14, onPress: () => toggle('place_painter_tools'), is_active: () => module_registry.is_visible('place_painter_tools') },
            { id: 'picker', label: () => `PICKER:${module_registry.is_visible('place_painter_palette') ? 'ON' : 'OFF'}`, width: 16, onPress: () => toggle('place_painter_palette'), is_active: () => module_registry.is_visible('place_painter_palette') },
            { id: 'layers', label: () => `LAYERS:${module_registry.is_visible('place_painter_layers') ? 'ON' : 'OFF'}`, width: 16, onPress: () => toggle('place_painter_layers'), is_active: () => module_registry.is_visible('place_painter_layers') },
            { id: 'props', label: () => `PROPS:${module_registry.is_visible('place_painter_tool_properties') ? 'ON' : 'OFF'}`, width: 15, onPress: () => toggle('place_painter_tool_properties'), is_active: () => module_registry.is_visible('place_painter_tool_properties') },
        ];
        return make_program_nav_bar_module({
            id: 'place_painter_toolbar',
            get_screen_size: () => ({ width: APP_CONFIG.grid_width, height: APP_CONFIG.grid_height }),
            get_is_visible: () => module_registry.is_visible('place_painter_toolbar'),
            default_expanded: true,
            expanded_height: 5,
            tabs: () => {
                const tabs = [
                    { id: 'debug', label: 'DEBUG', width: 7, items: debug_items },
                    { id: 'modules', label: 'MODULES', width: 9, items: module_items },
                    { id: 'system', label: 'SYSTEM', width: 8, items: system_items },
                ];
                if (ui_state.place_painter.active) {
                    tabs.splice(2, 0, { id: 'paint', label: 'PAINT', width: 7, items: paint_items });
                }
                return tabs;
            },
        });
    }

    function make_place_painter_tools_module(rect: Rect): Module {
        return make_toolbox_module({
            id: 'place_painter_tools',
            rect,
            title: 'TOOLS',
            tool_defs: place_painter_tool_defs().map((def) => ({
                tool: def.tool as any,
                label: def.label,
                icon: def.icon,
                shortcut: def.label[0]?.toUpperCase() || '?',
            })),
            get_current_tool: () => ui_state.place_painter.selected_tool as any,
            get_left_click_tool: () => ui_state.place_painter.left_click_tool as any,
            get_right_click_tool: () => ui_state.place_painter.right_click_tool as any,
            on_tool_select: (tool) => {
                ui_state.place_painter.selected_tool = tool as any;
                ui_state.place_painter.left_click_tool = tool as any;
                ui_state.place_painter.active_property_side = 'left';
                if (String(tool) !== 'move') {
                    ui_state.place_painter.move_pending_source = null;
                    ui_state.place_painter.move_drag_session = null;
                }
                ui_state.place_painter.shape_session = null;
                save_place_painter_prefs_debounced();
                flash_status([`Left tool: ${String(tool)}`], 900);
            },
            on_left_click_tool_change: (tool) => {
                ui_state.place_painter.left_click_tool = tool as any;
                ui_state.place_painter.selected_tool = tool as any;
                ui_state.place_painter.active_property_side = 'left';
                if (String(tool) !== 'move') {
                    ui_state.place_painter.move_pending_source = null;
                    ui_state.place_painter.move_drag_session = null;
                }
                ui_state.place_painter.shape_session = null;
                save_place_painter_prefs_debounced();
                flash_status([`Left tool: ${String(tool)}`], 900);
            },
            on_right_click_tool_change: (tool) => {
                ui_state.place_painter.right_click_tool = tool as any;
                ui_state.place_painter.active_property_side = 'right';
                ui_state.place_painter.shape_session = null;
                save_place_painter_prefs_debounced();
                flash_status([`Right tool: ${String(tool)}`], 900);
            },
            on_move: (new_rect) => persist_module_rect('place_painter_tools', new_rect),
            on_resize: (new_rect) => persist_module_rect('place_painter_tools', new_rect),
            on_close: () => set_module_visible('place_painter_tools', false),
        });
    }

    function make_place_painter_tool_properties_module(rect: Rect): Module {
        return make_tool_properties_module({
            id: 'place_painter_tool_properties',
            rect,
            title: 'PROPS',
            get_current_tool: () => get_place_painter_tool_for_side(ui_state.place_painter.active_property_side),
            get_brush_size: () => 1,
            on_brush_size_change: () => {},
            get_space_replace: () => false,
            on_space_replace_change: () => {},
            get_text_spacing: () => 0,
            on_text_spacing_change: () => {},
            get_text_charlead: () => 0,
            on_text_charlead_change: () => {},
            get_text_enterlead: () => 0,
            on_text_enterlead_change: () => {},
            get_text_enterspace: () => 0,
            on_text_enterspace_change: () => {},
            get_selection_mode: () => 'replace',
            on_selection_mode_change: () => {},
            get_paste_space_replace: () => false,
            on_paste_space_replace_change: () => {},
            get_paste_scale: () => 1,
            on_paste_scale_change: () => {},
            get_paste_ignore_space: () => false,
            on_paste_ignore_space_change: () => {},
            get_paste_ignore_black: () => false,
            on_paste_ignore_black_change: () => {},
            get_paste_ignore_white: () => false,
            on_paste_ignore_white_change: () => {},
            get_paste_ignore_color: () => false,
            on_paste_ignore_color_change: () => {},
            get_paste_ignore_color_rgb: () => ({ r: 255, g: 255, b: 255 }),
            on_paste_ignore_color_select: () => {},
            get_gradiator_state: () => ({ slots: ['  ', '  ', '  '], activeSlot: 0, isEditing: false, editSlot: null, editCursorX: 0 }),
            on_gradiator_slot_select: () => {},
            on_gradiator_char_select: () => {},
            on_gradiator_add_char: () => {},
            on_gradiator_remove_char: () => {},
            on_gradiator_char_set: () => {},
            property_rows: (): ToolPropertyRow[] => {
                const left_tool = get_place_painter_tool_for_side('left');
                const right_tool = get_place_painter_tool_for_side('right');
                const rows: ToolPropertyRow[] = [];
                const has_tool = (tool: PlacePainterTool): boolean => left_tool === tool || right_tool === tool;
                if (has_tool('paint') || has_tool('erase')) {
                    rows.push({
                        type: 'dual_slider',
                        id: 'brush_size',
                        label: 'Brush Size',
                        min: 1,
                        max: 5,
                        left_value: get_place_painter_brush_size_for_side('left'),
                        right_value: get_place_painter_brush_size_for_side('right'),
                        format_value: (value) => `${value}x${value}`,
                        on_change: (value, side) => {
                            set_place_painter_brush_size_for_side(side, value);
                            flash_status([`${side === 'left' ? 'Left' : 'Right'} brush: ${value}x${value}`], 900);
                        },
                    });
                }
                if (left_tool === 'erase' || right_tool === 'erase') {
                    rows.push({
                        type: 'dual_toggle',
                        id: 'erase_tiles',
                        label: 'Tiles',
                        left_value: is_place_painter_erase_target_enabled('tiles', 'left'),
                        right_value: is_place_painter_erase_target_enabled('tiles', 'right'),
                        left_enabled: left_tool === 'erase',
                        right_enabled: right_tool === 'erase',
                        on_toggle: (side) => {
                            ui_state.place_painter.active_property_side = side;
                            toggle_place_painter_erase_target('tiles', side);
                            flash_status([`${side === 'left' ? 'Left' : 'Right'} erase tiles: ${is_place_painter_erase_target_enabled('tiles', side) ? 'on' : 'off'}`, `Targets: ${get_place_painter_erase_targets_summary()}`], 1000);
                        },
                    });
                    rows.push({
                        type: 'dual_toggle',
                        id: 'erase_characters',
                        label: 'Characters',
                        note: '(stub)',
                        left_value: is_place_painter_erase_target_enabled('characters', 'left'),
                        right_value: is_place_painter_erase_target_enabled('characters', 'right'),
                        left_enabled: left_tool === 'erase',
                        right_enabled: right_tool === 'erase',
                        on_toggle: (side) => {
                            ui_state.place_painter.active_property_side = side;
                            toggle_place_painter_erase_target('characters', side);
                            flash_status([`${side === 'left' ? 'Left' : 'Right'} erase characters: ${is_place_painter_erase_target_enabled('characters', side) ? 'on' : 'off'}`, 'Character erase remains stubbed'], 1100);
                        },
                    });
                    rows.push({
                        type: 'dual_toggle',
                        id: 'erase_items',
                        label: 'Items',
                        left_value: is_place_painter_erase_target_enabled('items', 'left'),
                        right_value: is_place_painter_erase_target_enabled('items', 'right'),
                        left_enabled: left_tool === 'erase',
                        right_enabled: right_tool === 'erase',
                        on_toggle: (side) => {
                            ui_state.place_painter.active_property_side = side;
                            toggle_place_painter_erase_target('items', side);
                            flash_status([`${side === 'left' ? 'Left' : 'Right'} erase items: ${is_place_painter_erase_target_enabled('items', side) ? 'on' : 'off'}`, `Targets: ${get_place_painter_erase_targets_summary()}`], 1000);
                        },
                    });
                }
                if (has_tool('bucket')) {
                    rows.push({
                        type: 'info',
                        id: 'bucket_info',
                        text: 'Bucket fills matching tiles on current z',
                    });
                }
                if (has_tool('line') || has_tool('rect_stroke') || has_tool('rect_fill')) {
                    rows.push({
                        type: 'info',
                        id: 'shape_info',
                        text: 'Shape tools apply selected tile on current z',
                    });
                }
                if (has_tool('move')) {
                    const pending = ui_state.place_painter.move_pending_source;
                    rows.push({
                        type: 'info',
                        id: 'move_info',
                        text: pending
                            ? `Move src ${pending.x},${pending.y},${pending.z}`
                            : 'Move: click entity, then destination',
                    });
                }
                if (has_tool('character')) {
                    rows.push({
                        type: 'single_cycle',
                        id: 'entity_inspector_mode',
                        label: 'Entity Win',
                        value: get_entity_inspector_mode_label(),
                        options: ['replace'],
                        enabled: false,
                        on_cycle: () => {
                            flash_status([`Entity windows: ${get_entity_inspector_mode_label()}`], 1000);
                        },
                    });
                    rows.push({
                        type: 'info',
                        id: 'character_info',
                        text: 'Entity tool reuses the main inspector window',
                    });
                }
                if (has_tool('place_create')) {
                    rows.push({
                        type: 'info',
                        id: 'place_create_info',
                        text: 'Create: click border of selected place',
                    });
                }
                if (has_tool('place_delete')) {
                    rows.push({
                        type: 'info',
                        id: 'place_delete_info',
                        text: 'Delete: click adjacent place to remove',
                    });
                }
                if (has_tool('place_resize')) {
                    rows.push({
                        type: 'info',
                        id: 'place_resize_info',
                        text: 'Resize: click a face of selected place',
                    });
                }
                if (has_tool('region_tool')) {
                    rows.push({
                        type: 'info',
                        id: 'region_tool_info',
                        text: 'Region tool not implemented yet',
                    });
                }
                return rows;
            },
            on_move: (new_rect) => persist_module_rect('place_painter_tool_properties', new_rect),
            on_resize: (new_rect) => persist_module_rect('place_painter_tool_properties', new_rect),
            on_close: () => set_module_visible('place_painter_tool_properties', false),
        });
    }

    function make_place_painter_layers_module(rect: Rect): Module {
        const layerSpace: any = {
            layers: new Map<number, any>(),
            camera: { focus_plane: 0 },
        };
        const rebuild = () => {
            layerSpace.layers.clear();
            const place = ui_state.place.current_place;
            const zs = get_defined_place_world_zs(place);
            const focusWorldZ = get_focus_world_z_for_current_place();
            layerSpace.camera.focus_plane = focusWorldZ;
            for (const z of zs) {
                layerSpace.layers.set(z, {
                    z,
                    name: `Layer ${z}`,
                    visible: true,
                    locked: false,
                    cells: [],
                });
            }
        };
        rebuild();
        return makeLayerPaletteModule({
            id: 'place_painter_layers',
            rect,
            getSpace: () => {
                rebuild();
                return layerSpace;
            },
            onLayerSelect: (z) => {
                set_place_focus_world_z(z);
                flash_status([`Layer ${z}`], 1000);
            },
            onLayerVisibilityToggle: (_z) => {
                flash_status(['Layer visibility toggle not yet implemented'], 1000);
            },
            onLayerLockToggle: (_z) => {
                flash_status(['Layer lock not used for place painter'], 1000);
            },
            onLayerRename: (_z, _newName) => {
                // no-op for place layers
            },
            onAddLayer: async () => {
                const place = ui_state.place.current_place;
                if (!place?.id) return;
                const zs = get_defined_place_world_zs(place);
                const next = (zs.length > 0 ? Math.max(...zs) : get_focus_world_z_for_current_place()) + 1;
                const ok = await mutate_place_painter_layer(place.id, next, 'add');
                flash_status([ok ? `Added layer ${next}` : `Add layer failed ${next}`], 1200);
            },
            onDeleteLayer: async (z) => {
                const place = ui_state.place.current_place;
                if (!place?.id) return;
                const ok = await mutate_place_painter_layer(place.id, z, 'delete');
                flash_status([ok ? `Deleted layer ${z}` : `Delete layer failed ${z}`], 1200);
            },
            onDuplicateLayer: (_z) => {
                flash_status(['Layer duplicate not implemented for place painter'], 1000);
            },
            onMergeDown: (_z) => {
                flash_status(['Layer merge not implemented for place painter'], 1000);
            },
            onReorderLayers: async (_newZOrder) => {
                const place = ui_state.place.current_place;
                if (!place?.id) return;
                const ok = await mutate_place_painter_layer(place.id, get_focus_world_z_for_current_place(), 'reorder' as any, _newZOrder);
                flash_status([ok ? 'Reordered layers' : 'Layer reorder failed'], 1200);
            },
            onMove: (new_rect) => persist_module_rect('place_painter_layers', new_rect),
            onResize: (new_rect) => persist_module_rect('place_painter_layers', new_rect),
            onClose: () => set_module_visible('place_painter_layers', false),
        });
    }

    function make_place_painter_palette_module(rect: Rect): Module {
        return make_place_painter_window_module({
            id: 'place_painter_palette',
            rect,
            title: ui_state.place_painter.selected_palette_kind === 'item'
                ? 'ITEMS'
                : `TILES:${ui_state.place_painter.selected_tile_palette_section.toUpperCase()}`,
            draw_content(c, rect) {
                const activeLabel = ui_state.place_painter.selected_palette_kind === 'item' ? '[ITEMS]' : '[TILES]';
                const inactiveLabel = ui_state.place_painter.selected_palette_kind === 'item' ? ' tiles ' : ' items ';
                for (let i = 0; i < activeLabel.length && rect.x0 + 2 + i < rect.x1; i += 1) {
                    c.set(rect.x0 + 2 + i, rect.y1 - 2, { char: activeLabel[i]!, rgb: get_color_by_name('vivid_yellow').rgb, weight_index: 2, render_index: 6, style: 'regular' });
                }
                for (let i = 0; i < inactiveLabel.length && rect.x0 + 11 + i < rect.x1; i += 1) {
                    c.set(rect.x0 + 11 + i, rect.y1 - 2, { char: inactiveLabel[i]!, rgb: get_color_by_name('medium_gray').rgb, weight_index: 2, render_index: 6, style: 'regular' });
                }
                if (ui_state.place_painter.selected_palette_kind === 'tile') {
                    const sectionLabel = `[${ui_state.place_painter.selected_tile_palette_section.toUpperCase()}]`;
                    for (let i = 0; i < sectionLabel.length && rect.x0 + 20 + i < rect.x1; i += 1) {
                        c.set(rect.x0 + 20 + i, rect.y1 - 2, { char: sectionLabel[i]!, rgb: get_color_by_name('vivid_blue').rgb, weight_index: 2, render_index: 6, style: 'regular' });
                    }
                }
                const entries = ui_state.place_painter.selected_palette_kind === 'item'
                    ? ui_state.place_painter.item_palette_entries
                    : get_active_place_painter_tile_entries();
                const selectedId = ui_state.place_painter.selected_palette_kind === 'item'
                    ? ui_state.place_painter.selected_item_palette_entry_id
                    : ui_state.place_painter.selected_palette_entry_id;
                const cols = Math.max(2, Math.floor((rect.x1 - rect.x0 - 2) / 2));
                const rows = Math.max(1, rect.y1 - rect.y0 - 3);
                const selectedIndex = Math.max(0, entries.findIndex((entry) => entry.id === selectedId));
                const pageSize = cols * rows;
                const page = Math.floor(selectedIndex / pageSize);
                const start = page * pageSize;
                const visible = entries.slice(start, start + pageSize);
                for (let idx = 0; idx < visible.length; idx += 1) {
                    const entry = visible[idx]!;
                    const row = Math.floor(idx / cols);
                    const col = idx % cols;
                    const x = rect.x0 + 2 + (col * 2);
                    const y = rect.y1 - 3 - row;
                    if (y <= rect.y0 || x >= rect.x1) continue;
                    const isSelected = entry.id === selectedId;
                    c.set(x, y, { char: entry.display_char, rgb: isSelected ? get_color_by_name('off_white').rgb : get_color_by_name('off_white').rgb, weight_index: isSelected ? 3 : 2, render_index: 6, style: 'regular' });
                    if (isSelected && x - 1 > rect.x0) {
                        c.set(x - 1, y, { char: '>', rgb: get_color_by_name('vivid_yellow').rgb, weight_index: 3, render_index: 6, style: 'regular' });
                    }
                }
            },
            on_pointer_down_content(e, rect) {
                if (e.button !== 0 || !ui_state.place_painter.active) return;
                if (e.y === rect.y1 - 2 && e.x >= rect.x0 + 2 && e.x <= rect.x0 + 18) {
                    const next = ui_state.place_painter.selected_palette_kind === 'tile' ? 'item' : 'tile';
                    const load = next === 'tile'
                        ? ensure_place_painter_tile_palette_loaded
                        : ensure_place_painter_item_palette_loaded;
                    void load().then((ok) => {
                        if (!ok) {
                            flash_status([`${next} palette load failed`], 1200);
                            return;
                        }
                        toggle_place_painter_palette_kind();
                        flash_status([`Palette: ${ui_state.place_painter.selected_palette_kind}`], 1200);
                    });
                    return;
                }
                if (ui_state.place_painter.selected_palette_kind === 'tile' && e.y === rect.y1 - 2 && e.x >= rect.x0 + 20 && e.x <= rect.x0 + 33) {
                    cycle_place_painter_tile_palette_section();
                    flash_status([`Tile section: ${ui_state.place_painter.selected_tile_palette_section}`], 1200);
                    return;
                }
                const cols = Math.max(2, Math.floor((rect.x1 - rect.x0 - 2) / 2));
                const rows = Math.max(1, rect.y1 - rect.y0 - 3);
                const row = rect.y1 - 3 - e.y;
                const col = Math.floor((e.x - (rect.x0 + 2)) / 2);
                if (row < 0 || col < 0 || col >= cols || row >= rows) return;
                if (row < 0) return;
                const entries = ui_state.place_painter.selected_palette_kind === 'item'
                    ? ui_state.place_painter.item_palette_entries
                    : get_active_place_painter_tile_entries();
                const selectedId = ui_state.place_painter.selected_palette_kind === 'item'
                    ? ui_state.place_painter.selected_item_palette_entry_id
                    : ui_state.place_painter.selected_palette_entry_id;
                const selectedIndex = Math.max(0, entries.findIndex((entry) => entry.id === selectedId));
                const pageSize = cols * rows;
                const page = Math.floor(selectedIndex / pageSize);
                const start = page * pageSize;
                const entry = entries[start + (row * cols) + col];
                if (!entry) return;
                if (ui_state.place_painter.selected_palette_kind === 'item') {
                    ui_state.place_painter.selected_item_palette_entry_id = entry.id;
                    save_place_painter_prefs_debounced();
                    flash_status([`Item: ${entry.id}`, `${entry.display_char} ${entry.name}`], 1200);
                    return;
                }
                ui_state.place_painter.selected_palette_entry_id = entry.id;
                save_place_painter_prefs_debounced();
                flash_status([`Tile: ${entry.id}`, `${entry.display_char} ${entry.name}`], 1200);
            },
        });
    }

    const MODULE_LAYOUT_STORAGE_KEY = 'thaumworld:module_layout:v1';
    const PLACE_FOCUS_Z_STORAGE_KEY = 'thaumworld:place_focus_z:v1';
    const PLACE_PRINCIPAL_VIEW_STORAGE_KEY = 'thaumworld:place_principal_view:v1';
    const PLACE_MATRIX_VIEW_DIRECTION_STORAGE_KEY = 'thaumworld:place_matrix_view_direction:v1';
    const PLACE_VIEW_ROLL_STORAGE_KEY = 'thaumworld:place_view_roll_quarter_turn:v1';
    const PLACE_FOCUS_LAYER_OPACITY_STORAGE_KEY = 'thaumworld:place_focus_layer_opacity:v1';
    const PLACE_PAINTER_PREFS_STORAGE_KEY = 'thaumworld:place_painter_prefs:v1';
    const PLACE_VISIBLE_PLANE_RADIUS = 0;

    function is_rect(v: any): v is Rect {
        return !!v &&
            Number.isFinite(v.x0) && Number.isFinite(v.y0) && Number.isFinite(v.x1) && Number.isFinite(v.y1);
    }

    function load_persisted_module_layout(): void {
        try {
            const raw = window.localStorage?.getItem(MODULE_LAYOUT_STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            const pos = parsed?.positions && typeof parsed.positions === 'object' ? parsed.positions : null;
            const vis = parsed?.visibility && typeof parsed.visibility === 'object' ? parsed.visibility : null;

            if (pos) {
                for (const [id, r] of Object.entries(pos)) {
                    if (typeof id !== 'string' || id.length === 0) continue;
                    if (is_rect(r)) ui_state.modules.positions.set(id, r);
                }
            }
            if (vis) {
                for (const [id, v] of Object.entries(vis)) {
                    if (typeof id !== 'string' || id.length === 0) continue;
                    ui_state.modules.visibility.set(id, Boolean(v));
                }
            }
        } catch {
            // ignore
        }
    }

    function load_place_focus_z(): void {
        try {
            const raw = window.localStorage.getItem(PLACE_FOCUS_Z_STORAGE_KEY);
            if (!raw) return;
            const n = Number(raw);
            if (!Number.isFinite(n)) return;
            const z = Math.max(0, Math.floor(n));
            ui_state.place.focus_z = z;
        } catch {
            // ignore
        }
    }

    function save_place_focus_z(): void {
        try {
            window.localStorage.setItem(PLACE_FOCUS_Z_STORAGE_KEY, String(ui_state.place.focus_z));
        } catch {
            // ignore
        }
    }

    function load_place_principal_view(): void {
        try {
            const raw = window.localStorage.getItem(PLACE_PRINCIPAL_VIEW_STORAGE_KEY) ?? window.localStorage.getItem(PLACE_MATRIX_VIEW_DIRECTION_STORAGE_KEY);
            if (!raw) return;
            ui_state.place.principal_view = normalize_place_principal_view(raw === 'north' ? 'top' : raw);
        } catch {
            // ignore
        }
    }

    function load_place_view_roll_quarter_turn(): void {
        try {
            const raw = window.localStorage.getItem(PLACE_VIEW_ROLL_STORAGE_KEY);
            if (!raw) return;
            ui_state.place.view_roll_quarter_turn = normalize_place_view_roll_quarter_turn(raw);
        } catch {
            // ignore
        }
    }

    function load_place_focus_layer_opacity(): void {
        try {
            const raw = window.localStorage.getItem(PLACE_FOCUS_LAYER_OPACITY_STORAGE_KEY);
            if (!raw) return;
            ui_state.place.use_focus_layer_opacity = raw !== 'false';
        } catch {
            // ignore
        }
    }

    function save_place_principal_view(): void {
        try {
            window.localStorage.setItem(PLACE_PRINCIPAL_VIEW_STORAGE_KEY, ui_state.place.principal_view);
        } catch {
            // ignore
        }
    }

    function save_place_view_roll_quarter_turn(): void {
        try {
            window.localStorage.setItem(PLACE_VIEW_ROLL_STORAGE_KEY, String(ui_state.place.view_roll_quarter_turn));
        } catch {
            // ignore
        }
    }

    function save_place_focus_layer_opacity(): void {
        try {
            window.localStorage.setItem(PLACE_FOCUS_LAYER_OPACITY_STORAGE_KEY, ui_state.place.use_focus_layer_opacity ? 'true' : 'false');
        } catch {
            // ignore
        }
    }

    function set_place_principal_view(next: PlacePrincipalView): void {
        ui_state.place.principal_view = normalize_place_principal_view(next);
        save_place_principal_view();
    }

    function set_place_view_roll_quarter_turn(next: PlaceViewRollQuarterTurn): void {
        ui_state.place.view_roll_quarter_turn = normalize_place_view_roll_quarter_turn(next);
        save_place_view_roll_quarter_turn();
    }

    function set_place_focus_layer_opacity_enabled(enabled: boolean): void {
        ui_state.place.use_focus_layer_opacity = !!enabled;
        save_place_focus_layer_opacity();
    }

    function toggle_place_focus_layer_opacity(): boolean {
        set_place_focus_layer_opacity_enabled(!ui_state.place.use_focus_layer_opacity);
        return ui_state.place.use_focus_layer_opacity;
    }

    function swing_place_camera(direction: 'left' | 'right' | 'up' | 'down'): void {
        const next = swing_place_view(make_place_view_state(ui_state.place.principal_view, ui_state.place.view_roll_quarter_turn), direction);
        ui_state.place.principal_view = next.principal_view;
        ui_state.place.view_roll_quarter_turn = next.roll_quarter_turn;
        save_place_principal_view();
        save_place_view_roll_quarter_turn();
    }

    function roll_place_camera(direction: 'left' | 'right'): void {
        const next = rotate_place_view_roll(make_place_view_state(ui_state.place.principal_view, ui_state.place.view_roll_quarter_turn), direction);
        ui_state.place.principal_view = next.principal_view;
        ui_state.place.view_roll_quarter_turn = next.roll_quarter_turn;
        save_place_principal_view();
        save_place_view_roll_quarter_turn();
    }

    let persist_timer: number | null = null;
    function persist_module_layout_debounced(): void {
        if (persist_timer) clearTimeout(persist_timer);
        persist_timer = window.setTimeout(() => {
            persist_timer = null;
            try {
                const positions_obj: Record<string, Rect> = {};
                for (const [id, r] of ui_state.modules.positions.entries()) {
                    if (typeof id !== 'string' || !is_rect(r)) continue;
                    positions_obj[id] = r;
                }
                const visibility_obj: Record<string, boolean> = {};
                for (const [id, v] of ui_state.modules.visibility.entries()) {
                    if (typeof id !== 'string') continue;
                    visibility_obj[id] = Boolean(v);
                }
                window.localStorage?.setItem(
                    MODULE_LAYOUT_STORAGE_KEY,
                    JSON.stringify({ positions: positions_obj, visibility: visibility_obj }),
                );
            } catch {
                // ignore
            }
        }, 200);
    }

    function load_place_painter_prefs(): void {
        try {
            const raw = window.localStorage?.getItem(PLACE_PAINTER_PREFS_STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                if (typeof parsed.left_click_tool === 'string') ui_state.place_painter.left_click_tool = parsed.left_click_tool as PlacePainterTool;
                if (typeof parsed.right_click_tool === 'string') ui_state.place_painter.right_click_tool = parsed.right_click_tool as PlacePainterTool;
                if (typeof parsed.selected_tool === 'string') ui_state.place_painter.selected_tool = parsed.selected_tool as PlacePainterTool;
                if (parsed.entity_inspector_mode === 'replace' || parsed.entity_inspector_mode === 'duplicate') ui_state.place_painter.entity_inspector_mode = parsed.entity_inspector_mode;
                if (typeof parsed.active_property_side === 'string' && (parsed.active_property_side === 'left' || parsed.active_property_side === 'right')) {
                    ui_state.place_painter.active_property_side = parsed.active_property_side;
                }
                if (typeof parsed.left_brush_size === 'number') ui_state.place_painter.left_brush_size = Math.max(1, Math.min(5, Math.floor(parsed.left_brush_size)));
                if (typeof parsed.right_brush_size === 'number') ui_state.place_painter.right_brush_size = Math.max(1, Math.min(5, Math.floor(parsed.right_brush_size)));
                if (parsed.left_erase_targets && typeof parsed.left_erase_targets === 'object') {
                    ui_state.place_painter.left_erase_targets.tiles = Boolean(parsed.left_erase_targets.tiles);
                    ui_state.place_painter.left_erase_targets.characters = Boolean(parsed.left_erase_targets.characters);
                    ui_state.place_painter.left_erase_targets.items = Boolean(parsed.left_erase_targets.items);
                }
                if (parsed.right_erase_targets && typeof parsed.right_erase_targets === 'object') {
                    ui_state.place_painter.right_erase_targets.tiles = Boolean(parsed.right_erase_targets.tiles);
                    ui_state.place_painter.right_erase_targets.characters = Boolean(parsed.right_erase_targets.characters);
                    ui_state.place_painter.right_erase_targets.items = Boolean(parsed.right_erase_targets.items);
                }
                if (parsed.selected_palette_kind === 'tile' || parsed.selected_palette_kind === 'item') ui_state.place_painter.selected_palette_kind = parsed.selected_palette_kind;
                if (parsed.selected_tile_palette_section === 'blocks' || parsed.selected_tile_palette_section === 'connectors' || parsed.selected_tile_palette_section === 'all') {
                    ui_state.place_painter.selected_tile_palette_section = parsed.selected_tile_palette_section;
                }
                if (typeof parsed.selected_palette_entry_id === 'string' || parsed.selected_palette_entry_id === null) ui_state.place_painter.selected_palette_entry_id = parsed.selected_palette_entry_id;
                if (typeof parsed.selected_item_palette_entry_id === 'string' || parsed.selected_item_palette_entry_id === null) ui_state.place_painter.selected_item_palette_entry_id = parsed.selected_item_palette_entry_id;
            }
        } catch {
            // ignore
        }
    }

    function save_place_painter_prefs(): void {
        try {
            window.localStorage?.setItem(PLACE_PAINTER_PREFS_STORAGE_KEY, JSON.stringify({
                left_click_tool: ui_state.place_painter.left_click_tool,
                right_click_tool: ui_state.place_painter.right_click_tool,
                selected_tool: ui_state.place_painter.selected_tool,
                entity_inspector_mode: ui_state.place_painter.entity_inspector_mode,
                active_property_side: ui_state.place_painter.active_property_side,
                left_brush_size: ui_state.place_painter.left_brush_size,
                right_brush_size: ui_state.place_painter.right_brush_size,
                left_erase_targets: ui_state.place_painter.left_erase_targets,
                right_erase_targets: ui_state.place_painter.right_erase_targets,
                selected_palette_kind: ui_state.place_painter.selected_palette_kind,
                selected_tile_palette_section: ui_state.place_painter.selected_tile_palette_section,
                selected_palette_entry_id: ui_state.place_painter.selected_palette_entry_id,
                selected_item_palette_entry_id: ui_state.place_painter.selected_item_palette_entry_id,
            }));
        } catch {
            // ignore
        }
    }

    let place_painter_prefs_timer: number | null = null;
    function save_place_painter_prefs_debounced(): void {
        if (place_painter_prefs_timer) clearTimeout(place_painter_prefs_timer);
        place_painter_prefs_timer = window.setTimeout(() => {
            place_painter_prefs_timer = null;
            save_place_painter_prefs();
        }, 100);
    }

    function get_persisted_rect(module_id: string, fallback: Rect): Rect {
        return ui_state.modules.positions.get(module_id) ?? fallback;
    }

    function persist_entity_inspector_rect(rect: Rect): void {
        persist_module_rect('entity_inspector_module', rect);
    }

    function set_module_visible(module_id: string, visible: boolean): void {
        ui_state.modules.visibility.set(module_id, visible);
        apply_runtime_module_visibility(module_id);
        if (module_id === 'character_module') ui_state.character.is_visible = visible;
        if (module_id === 'inventory_container') ui_state.container.is_visible = visible;
        persist_module_layout_debounced();
    }

    const SHELL_MODULE_IDS = new Set(['bg', 'status', 'world_entry_module', 'world_join_module', 'actor_claim_module', 'character_creation_module']);

    function has_active_actor_claim(): boolean {
        return get_controlled_actor_id().length > 0;
    }

    function should_module_be_runtime_visible(module_id: string): boolean {
        if (module_id === 'actor_claim_module') return ui_state.actor_claim.is_visible;
        if (module_id === 'character_creation_module') return ui_state.character_creation.is_visible;
        if (module_id === 'world_entry_module') return ui_state.world_entry.is_visible;
        if (module_id === 'world_join_module') return ui_state.world_join.is_visible;
        if (module_id === 'place_painter_toolbar') return has_active_actor_claim() && ui_state.actor_claim.game_ready;
        if (SHELL_MODULE_IDS.has(module_id)) return true;
        const desired = ui_state.modules.visibility.has(module_id) ? Boolean(ui_state.modules.visibility.get(module_id)) : true;
        if (!has_active_actor_claim()) return false;
        if (!ui_state.actor_claim.game_ready) return false;
        return desired;
    }

    function apply_runtime_module_visibility(module_id?: string): void {
        const registry = ui_state.modules.registry;
        if (!registry?.set_visibility) return;
        if (module_id) {
            registry.set_visibility(module_id, should_module_be_runtime_visible(module_id));
            return;
        }
        for (const module of registry.get_all()) {
            registry.set_visibility(module.id, should_module_be_runtime_visible(module.id));
        }
    }

    // Load persisted module state early so it affects initial rects/visibility.
    load_persisted_module_layout();
    load_place_focus_z();
    load_place_principal_view();
    load_place_view_roll_quarter_turn();
    load_place_focus_layer_opacity();
    load_place_painter_prefs();

    // Shared drag state for cross-module drag-and-drop
    const drag_state = {
        is_dragging: false,
        source_module: null as string | null,
        item_instance_id: null as string | null,
        source_container_id: null as string | null,
        source_target_id: null as string | null,
        source_slot_index: null as number | null,
        item_definition: null as ItemDefinition | null,
        current_x: 0,
        current_y: 0,
        is_rejected: false,
        reject_start_time: 0,
        return_start_x: 0,
        return_start_y: 0,

        start_drag(source: string, item_id: string, container_id: string, def: ItemDefinition, slot_index?: number, target_id?: string) {
            this.is_dragging = true;
            this.is_rejected = false;
            this.source_module = source;
            this.item_instance_id = item_id;
            this.source_container_id = container_id;
            this.source_target_id = target_id ?? null;
            this.source_slot_index = slot_index ?? null;
            this.item_definition = def;
            debug_log(`[DragState] Started drag: ${def.name} from ${source}${slot_index !== undefined ? ` slot ${slot_index}` : ''}`);
        },

        /**
         * Centralized validation for whether an item can be dragged.
         * Used by all drag start handlers to prevent invalid drags.
         * Returns { can: true } if drag is allowed, or { can: false, reason: string } if blocked.
         */
        can_drag(item_id: string, definition: ItemDefinition): { can: boolean; reason?: string } {
            // Prevent dragging open containers
            if (is_container_item(definition)) {
                const actor_nested = `actor.item.${get_controlled_actor_id()}.${item_id}`;
                const open = ui_state.container.open_containers;
                const open_place_container = Array.from(open).some((cid) =>
                    cid.startsWith('place.item.') && cid.endsWith(`.${item_id}`)
                );
                if (open.has(actor_nested) || open_place_container) {
                    return { can: false, reason: 'Cannot drag open containers' };
                }
            }
            return { can: true };
        },

        update_position(x: number, y: number) {
            this.current_x = x;
            this.current_y = y;
        },

        get_display_char(): string {
            if (!this.item_definition) return "?";
            return resolve_char(
                {
                    kind: 'item',
                    def_id: this.item_definition.id,
                    name: this.item_definition.name,
                    qty: 1,
                    display_char: this.item_definition.display_char,
                    tags: (this.item_definition as any)?.tags ?? [],
                },
                {
                    where: 'drag_ghost',
                    space: 'screen',
                    x: this.current_x,
                    y: this.current_y,
                    time_ms: Date.now(),
                    ui: { dragging: true },
                },
            );
        },

        get_wiggle_weight(): number {
            // Wiggle weight (thickness) between 9-13 based on time (increased by 1 magnitude)
            const time = Date.now();
            const wiggle = Math.sin(time / 150);  // Oscillate between -1 and 1
            return Math.floor(11 + wiggle * 2);  // Range: 9-13
        },

        reject_drag() {
            // Called when drag is rejected (invalid drop location)
            this.is_rejected = true;
            this.reject_start_time = Date.now();
            this.return_start_x = this.current_x;
            this.return_start_y = this.current_y;
            debug_log(`[DragState] Drag rejected - flashing red and returning item`);
            
            // Clear highlights
            ui_state.character.highlighted_slots = [];
            ui_state.character.highlighted_items = [];
        },

        render_drag_ghost(c: any): void {
            if (!this.is_dragging || !this.item_definition) return;
            
            const char = this.get_display_char();
            const wiggle_weight = this.get_wiggle_weight();
            
            let x = this.current_x;
            let y = this.current_y;
            let rgb: { r: number; g: number; b: number };
            
            if (this.is_rejected) {
                // Handle rejected drag - flash red and animate return
                const elapsed = Date.now() - this.reject_start_time;
                const flash_duration = 800;  // Flash for 800ms
                const return_duration = 400;  // Return animation over 400ms
                
                if (elapsed < flash_duration) {
                    // Flash red with weight wiggle
                    const flash_cycle = Math.sin(elapsed / 80);  // Fast flashing
                    const is_red = flash_cycle > 0;
                    rgb = is_red ? { r: 255, g: 50, b: 50 } : { r: 200, g: 100, b: 100 };
                } else if (elapsed < flash_duration + return_duration) {
                    // Animate back to source position
                    const return_progress = (elapsed - flash_duration) / return_duration;
                    // Need to get source position - for now just fade out
                    rgb = { r: 255, g: 50, b: 50 };
                    const fade = 1 - return_progress;
                    rgb = { r: Math.floor(255 * fade), g: Math.floor(50 * fade), b: Math.floor(50 * fade) };
                } else {
                    // Animation complete - end drag
                    this.end_drag();
                    return;
                }
                
                // For rejected drags, clamp position to canvas bounds so animation is visible
                x = Math.max(0, Math.min(x, c.width - 1));
                y = Math.max(0, Math.min(y, c.height - 1));
            } else {
                // Normal drag - yellow/bright color
                rgb = { r: 255, g: 255, b: 200 };
                
                // Only render if within canvas bounds for normal drags
                if (x < 0 || y < 0 || x >= c.width || y >= c.height) {
                    return;
                }
            }
            
            c.set(x, y, {
                char: char,
                rgb: rgb,
                style: 'bold',
                weight_index: wiggle_weight  // Wiggling weight for visual effect
            });
        },

        end_drag() {
            this.is_dragging = false;
            this.is_rejected = false;
            this.source_module = null;
            this.item_instance_id = null;
            this.source_container_id = null;
            this.source_target_id = null;
            this.source_slot_index = null;
            this.item_definition = null;
            // Clear highlighted slots
            ui_state.character.highlighted_slots = [];
            ui_state.character.hovered_item = null;
            debug_log(`[DragState] Ended drag`);
        }
    };

    function create_empty_ground_item_cache(): PlaceGroundItemCache {
        return {
            by_id: new Map<string, GroundItemMetaRecord>(),
            by_voxel: new Map<string, string[]>(),
            by_position: new Map<string, string[]>(),
        };
    }

    function ensure_ground_item_cache(place_id: string): PlaceGroundItemCache {
        let cache = ui_state.place.ground_item_caches_by_place.get(place_id);
        if (!cache) {
            cache = create_empty_ground_item_cache();
            ui_state.place.ground_item_caches_by_place.set(place_id, cache);
        }
        return cache;
    }

    function sync_current_place_ground_item_cache_aliases(): void {
        const place_id = ui_state.place.current_place_id;
        const cache = place_id ? (ui_state.place.ground_item_caches_by_place.get(place_id) ?? create_empty_ground_item_cache()) : create_empty_ground_item_cache();
        if (place_id && !ui_state.place.ground_item_caches_by_place.has(place_id)) {
            ui_state.place.ground_item_caches_by_place.set(place_id, cache);
        }
        ui_state.place.ground_items_by_id = cache.by_id;
        ui_state.place.ground_items_by_voxel = cache.by_voxel;
        ui_state.place.ground_items_by_position = cache.by_position;
    }

    function remove_ground_item_from_local_maps(item_id: string, place_id?: string | null): void {
        const cache = place_id ? ensure_ground_item_cache(place_id) : null;
        const meta = (cache?.by_id ?? ui_state.place.ground_items_by_id).get(item_id);
        if (!meta) return;
        const old_voxel_key = meta.position && typeof meta.elevation === 'number'
            ? `${meta.position.x}_${meta.position.y}_${Math.floor(meta.elevation)}`
            : null;
        if (old_voxel_key) {
            const map = cache?.by_voxel ?? ui_state.place.ground_items_by_voxel;
            const arr = (map.get(old_voxel_key) ?? []).filter((id) => id !== item_id);
            if (arr.length > 0) map.set(old_voxel_key, arr);
            else map.delete(old_voxel_key);
        }
        if (meta.position) {
            const xy_key = `${meta.position.x}_${meta.position.y}`;
            const map = cache?.by_position ?? ui_state.place.ground_items_by_position;
            const arr = (map.get(xy_key) ?? []).filter((id) => id !== item_id);
            if (arr.length > 0) map.set(xy_key, arr);
            else map.delete(xy_key);
        }
    }

    function apply_local_ground_item_move(item_id: string, tile_x: number, tile_y: number, z: number, place_id?: string | null): void {
        const cache = place_id ? ensure_ground_item_cache(place_id) : null;
        const meta = (cache?.by_id ?? ui_state.place.ground_items_by_id).get(item_id);
        if (!meta) {
            debug_log('[GROUND_DRAG] local optimistic move skipped - item missing from cache', { item_id, tile_x, tile_y, z });
            return;
        }
        remove_ground_item_from_local_maps(item_id, place_id);
        meta.position = { x: tile_x, y: tile_y };
        meta.elevation = Math.floor(z);
        meta.position_key = `${tile_x}_${tile_y}_${Math.floor(z)}`;
        meta.voxel_key = meta.position_key;
        const by_id = cache?.by_id ?? ui_state.place.ground_items_by_id;
        const by_voxel = cache?.by_voxel ?? ui_state.place.ground_items_by_voxel;
        const by_position = cache?.by_position ?? ui_state.place.ground_items_by_position;
        by_id.set(item_id, meta);
        const voxel_key = `${tile_x}_${tile_y}_${Math.floor(z)}`;
        const voxel_arr = by_voxel.get(voxel_key) ?? [];
        if (!voxel_arr.includes(item_id)) voxel_arr.push(item_id);
        by_voxel.set(voxel_key, voxel_arr);
        const xy_key = `${tile_x}_${tile_y}`;
        const xy_arr = by_position.get(xy_key) ?? [];
        if (!xy_arr.includes(item_id)) xy_arr.push(item_id);
        by_position.set(xy_key, xy_arr);
        debug_log('[GROUND_DRAG] local optimistic move applied', { item_id, tile_x, tile_y, z, voxel_key });
    }

    function log_ground_item_cache_position(label: string, item_id: string, tile_x: number, tile_y: number, z: number, place_id?: string | null): void {
        const cache = place_id ? ensure_ground_item_cache(place_id) : null;
        const meta = (cache?.by_id ?? ui_state.place.ground_items_by_id).get(item_id) ?? null;
        const voxel_key = `${tile_x}_${tile_y}_${Math.floor(z)}`;
        const at_target = ((cache?.by_voxel ?? ui_state.place.ground_items_by_voxel).get(voxel_key) ?? []).includes(item_id);
        debug_log(`[GROUND_DRAG] ${label} ${JSON.stringify({
            item_id,
            expected: { tile_x, tile_y, z, voxel_key },
            meta,
            at_target,
        })}`);
    }



    // Helper function to determine slot types from item tags
    // Returns which slot types (armor/garb/tool) an item can be equipped to
    function get_item_slot_types(item_def: ItemDefinition): SlotType[] {
        const slot_types: SlotType[] = [];
        
        // All items can be held in tool slots (hand slots)
        slot_types.push('tool');
        
        if (item_def.tags) {
            for (const tag of item_def.tags) {
                if (tag.name === 'ARMOR') {
                    slot_types.push('armor');
                } else if (tag.name === 'GARB') {
                    slot_types.push('garb');
                }
            }
        }
        
        return slot_types;
    }

    // Helper function to determine compatible body slots for an item
    // Calls backend API for tag-based compatibility (single source of truth)
    async function get_compatible_slots(item_def: ItemDefinition): Promise<Array<{ slot_name: string; slot_type: SlotType; garb_index?: number }>> {
        try {
            const response = await fetch(`http://localhost:8787/api/item/compatible_slots?item_def_id=${item_def.id}&actor_id=${get_controlled_actor_id()}`);
            if (response.ok) {
                const data = await response.json();
                if (data.ok && data.compatible_slots) {
                    return data.compatible_slots;
                }
            }
        } catch (err) {
            debug_log('[get_compatible_slots] API call failed, falling back to local logic');
        }
        
        // Fallback to local logic if API fails (tag-based; snapshot prefers instance API)
        const compatible: Array<{ slot_name: string; slot_type: SlotType; garb_index?: number }> = [];

        function expand_meta(meta: unknown): string[] {
            const m = String(meta ?? '').trim();
            if (!m) return [];
            if (m === 'hand') return ['hand_left', 'hand_right'];
            if (m === 'leg') return ['leg_left', 'leg_right'];
            if (m === 'head') return ['head'];
            if (m === 'torso') return ['torso'];
            if (['hand_left', 'hand_right', 'leg_left', 'leg_right', 'head', 'torso'].includes(m)) return [m];
            return [];
        }

        // Tool slots: always
        compatible.push({ slot_name: 'hand_left', slot_type: 'tool' });
        compatible.push({ slot_name: 'hand_right', slot_type: 'tool' });

        const tags: any[] = (item_def as any)?.tags ?? [];
        const armor_tag = tags.find((t: any) => t?.name === 'ARMOR');
        const garb_tag = tags.find((t: any) => t?.name === 'GARB');

        if (armor_tag) {
            const meta = Array.isArray(armor_tag.meta) ? armor_tag.meta : [];
            for (const m of meta) {
                for (const slot_name of expand_meta(m)) {
                    compatible.push({ slot_name, slot_type: 'armor' });
                }
            }
        }

        if (garb_tag) {
            const meta = Array.isArray(garb_tag.meta) ? garb_tag.meta : [];
            for (const m of meta) {
                for (const slot_name of expand_meta(m)) {
                    for (let i = 0; i < 10; i++) {
                        compatible.push({ slot_name, slot_type: 'garb', garb_index: i });
                    }
                }
            }
        }

        return compatible;
    }

    // Snapshot-first compatibility: prefer inline instance tags when possible.
    async function get_compatible_slots_for_instance(
        item_instance_id: string,
        source_container_id: string | null,
        fallback_def?: ItemDefinition
    ): Promise<Array<{ slot_name: string; slot_type: SlotType; garb_index?: number }>> {
        try {
            if (source_container_id && source_container_id.startsWith('place.')) {
                const place = get_current_place();
                if (!place) return [];
                const res = await fetch(`http://localhost:8787/api/place_item/compatible_slots?place_id=${encodeURIComponent(place.id)}&item_id=${encodeURIComponent(item_instance_id)}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.ok && data.compatible_slots) return data.compatible_slots;
                }
            } else {
                const res = await fetch(`http://localhost:8787/api/item_instance/compatible_slots?actor_id=${encodeURIComponent(get_controlled_actor_id())}&item_id=${encodeURIComponent(item_instance_id)}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.ok && data.compatible_slots) return data.compatible_slots;
                }
            }
        } catch (err) {
            debug_log('[get_compatible_slots_for_instance] API call failed, falling back to def-based compatibility');
        }

        // Fallback: best effort using def-based compatibility
        if (fallback_def) return get_compatible_slots(fallback_def);
        return [];
    }

    async function apply_item_legality_highlight(
        item_instance_id: string,
        source_container_id: string | null,
        definition: ItemDefinition,
        source_label: string,
    ): Promise<void> {
        const compatible = await get_compatible_slots_for_instance(item_instance_id, source_container_id, definition);
        ui_state.character.highlighted_slots = compatible;
        ui_state.character.hovered_item = { name: definition.name, source: source_label };
    }

    function clear_item_legality_highlight(): void {
        ui_state.character.highlighted_slots = [];
        ui_state.character.hovered_item = null;
    }

    // Helper function to find items in open containers compatible with a body slot
    // Returns array of { container_id, slot_index } for items that can equip to slot_name
    function get_compatible_items_for_slot(slot_name: string): Array<{ container_id: string; slot_index: number }> {
        const compatible_items: Array<{ container_id: string; slot_index: number }> = [];
        
        debug_log(`[get_compatible_items_for_slot] Searching for items compatible with ${slot_name}`);
        debug_log(`[get_compatible_items_for_slot] Open containers: ${Array.from(ui_state.container.open_containers).join(', ')}`);
        
        // Search through all open containers
        for (const container_id of ui_state.container.open_containers) {
            const owner_view = ui_state.container.owner_view_by_container_id.get(container_id);
            if (!owner_view) {
                debug_log(`[get_compatible_items_for_slot] No owner view for container: ${container_id}`);
                continue;
            }

            let item_count = 0;
            for (const group of owner_view.groups) {
                for (const surface of group.surfaces) {
                    for (const slot of surface.slots) {
                        const item = slot.item;
                        if (!item) continue;
                        item_count += 1;
                        const item_name = item.name || item.def_id || 'unknown';
                        const tags: any[] = item.tags ?? [];
                        const item_ref = { tags, resolved_tag_states: (item as any).resolved_tag_states ?? [] };

                        function meta_matches(m: any, target: string): boolean {
                            const mm = String(m ?? '').trim();
                            if (!mm) return false;
                            if (mm === 'hand') return target === 'hand_left' || target === 'hand_right';
                            if (mm === 'leg') return target === 'leg_left' || target === 'leg_right';
                            return mm === target;
                        }

                        const armor_tag = has_resolved_tag(item_ref as any, 'ARMOR') ? tags.find((t: any) => t?.name === 'ARMOR') : null;
                        const garb_tag = has_resolved_tag(item_ref as any, 'GARB') ? tags.find((t: any) => t?.name === 'GARB') : null;
                        const armor_ok = armor_tag && Array.isArray(armor_tag.meta) && armor_tag.meta.some((m: any) => meta_matches(m, slot_name));
                        const garb_ok = garb_tag && Array.isArray(garb_tag.meta) && garb_tag.meta.some((m: any) => meta_matches(m, slot_name));

                        const tool_ok = slot_name === 'hand_left' || slot_name === 'hand_right';

                        if (tool_ok || armor_ok || garb_ok) {
                            compatible_items.push({ container_id, slot_index: slot.slot_index });
                            debug_log(`[get_compatible_items_for_slot] ✓ ${item_name} (${surface.id}:${slot.slot_index}) compatible with ${slot_name}`);
                        } else {
                            debug_log(`[get_compatible_items_for_slot] ✗ ${item_name} (${surface.id}:${slot.slot_index}) NOT compatible`);
                        }
                    }
                }
            }
            debug_log(`[get_compatible_items_for_slot] Checking container: ${container_id} with ${item_count} items`);
        }
        
        debug_log(`[get_compatible_items_for_slot] Found ${compatible_items.length} compatible items for ${slot_name}`);
        return compatible_items;
    }

    function get_character_weight_from_body_slots(body_slots: EquipmentSlots): number {
        let total_weight = 0;

        function add_weight(item: any): number {
            if (!item) return 0;
            const qty = typeof item.qty === 'number' ? item.qty : 1;
            const w = typeof item.weight === 'number' ? item.weight : 0;
            let sum = w * qty;
            if (Array.isArray(item.contents)) {
                for (const child of item.contents) {
                    sum += add_weight(child);
                }
            }
            return sum;
        }

        for (const slot_data of Object.values(body_slots ?? {})) {
            const s = slot_data as any;
            if (s?.armor) total_weight += add_weight(s.armor);
            if (s?.tool) total_weight += add_weight(s.tool);
            if (Array.isArray(s?.garb)) {
                for (const it of s.garb) total_weight += add_weight(it);
            }
        }

        return total_weight;
    }

    function get_character_equipped_items_from_body_slots(body_slots: EquipmentSlots): Map<string, { instance: ItemInstance; definition: ItemDefinition }> {
        const equipped = new Map<string, { instance: ItemInstance; definition: ItemDefinition }>();

        for (const [slot_name, slot_data] of Object.entries(body_slots ?? {})) {
            const s = slot_data as any;
            for (const [slot_type, value] of Object.entries({ armor: s.armor, tool: s.tool })) {
                if (value && typeof (value as any).id === 'string') {
                    const item = value as any;
                    equipped.set(item.id, {
                        instance: { id: item.id, def_id: item.def_id, qty: item.qty || 1, tags: item.tags || [], resolved_tag_states: item.resolved_tag_states || [], value_mag: item.value_mag || null } as any,
                        definition: {
                            id: item.def_id,
                            name: item.name,
                            weight: item.weight || 0,
                            tags: item.tags || [],
                            resolved_tag_states: item.resolved_tag_states || [],
                            value_mag: item.value_mag || null,
                            display_char: (typeof item.display_char === 'string' && item.display_char.length > 0) ? String(item.display_char).charAt(0) : '·',
                        } as unknown as ItemDefinition,
                    });
                    debug_log(`[LOAD_EQUIPPED] ${slot_name}.${slot_type}: ${item.name} (${item.id})`);
                }
            }
            if (Array.isArray(s.garb)) {
                for (let i = 0; i < s.garb.length; i++) {
                    const item = s.garb[i];
                    if (item && typeof item.id === 'string') {
                        equipped.set(item.id, {
                            instance: { id: item.id, def_id: item.def_id, qty: item.qty || 1, tags: item.tags || [], resolved_tag_states: item.resolved_tag_states || [], value_mag: item.value_mag || null } as any,
                            definition: {
                                id: item.def_id,
                                name: item.name,
                                weight: item.weight || 0,
                                tags: item.tags || [],
                                resolved_tag_states: item.resolved_tag_states || [],
                                value_mag: item.value_mag || null,
                                display_char: (typeof (item as any).display_char === 'string' && String((item as any).display_char).length > 0) ? String((item as any).display_char).charAt(0) : '·',
                            } as unknown as ItemDefinition,
                        });
                        debug_log(`[LOAD_EQUIPPED] ${slot_name}.garb.${i}: ${item.name} (${item.id})`);
                    }
                }
            }
        }

        return equipped;
    }

    async function load_character_module_data(character_ref: string): Promise<{
        character: any;
        body_slots: EquipmentSlots;
        equipped_items: Map<string, { instance: ItemInstance; definition: ItemDefinition }>;
        weight_data: { current: number; max: number };
        owner_view?: OwnerInventoryView | null;
    }> {
        const slot = APP_CONFIG.selected_data_slot;
        const url = character_ref.startsWith('actor.')
            ? `http://localhost:8787/api/actor/private_state?actor_ref=${encodeURIComponent(character_ref)}&slot=${slot}&session_token=${encodeURIComponent(get_session_token())}`
            : `http://localhost:8787/api/character?ref=${encodeURIComponent(character_ref)}&slot=${slot}`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`character_fetch_failed:${response.status}`);
        }

        const payload = await response.json();
        if (!payload?.ok || (!payload?.character && !payload?.actor)) {
            throw new Error(String(payload?.error ?? 'character_payload_invalid'));
        }

        const character = payload.actor ? payload.actor as any : payload.character as any;
        const body_slots = (character?.body_slots && typeof character.body_slots === 'object')
            ? character.body_slots as EquipmentSlots
            : {};
        const equipped_items = get_character_equipped_items_from_body_slots(body_slots);
        const strength = Number((character?.stats as Record<string, number> | undefined)?.str ?? 40);
        return {
            character,
            body_slots,
            equipped_items,
            weight_data: {
                current: get_character_weight_from_body_slots(body_slots),
                max: strength * 2.5,
            },
            owner_view: payload?.view ?? null,
        };
    }

    function get_entity_display_name(entity_ref: string, fallback?: string | null): string {
        const place = get_current_place();
        if (place) {
            if (entity_ref.startsWith('npc.')) {
                const npc = Array.isArray(place.contents?.npcs_present)
                    ? place.contents.npcs_present.find((entry: any) => String(entry?.npc_ref ?? '') === entity_ref) ?? null
                    : null;
                const name = typeof (npc as any)?.name === 'string' ? String((npc as any).name).trim() : '';
                if (name) return name;
            }
            if (entity_ref.startsWith('actor.')) {
                const actor = Array.isArray(place.contents?.actors_present)
                    ? place.contents.actors_present.find((entry: any) => String(entry?.actor_ref ?? '') === entity_ref) ?? null
                    : null;
                const name = typeof (actor as any)?.name === 'string' ? String((actor as any).name).trim() : '';
                if (name) return name;
            }
        }
        const target = ui_state.controls.targets.find((entry) => entry.ref === entity_ref);
        if (target?.label) return target.label;
        if (fallback && fallback.trim()) return fallback;
        if (entity_ref.startsWith('npc.')) return 'Unknown NPC';
        if (entity_ref.startsWith('actor.')) return 'Unknown Actor';
        return 'Unknown Target';
    }

    function get_npc_module_id(npc_ref: string): string {
        const npc_id = get_character_id_from_ref(npc_ref) ?? npc_ref.replace(/^npc\./, '');
        return `npc_character_${npc_id}`;
    }

    function get_character_editor_subject_label(character_ref: string | null): string {
        if (!character_ref) return 'no target';
        const id = get_character_id_from_ref(character_ref);
        return id ? `id: ${id}` : character_ref;
    }

    function build_tile_entity_ref(place_id: string, x: number, y: number, z: number): string {
        return `tile.${String(place_id)}.${Math.floor(x)}.${Math.floor(y)}.${Math.floor(z)}`;
    }

    function parse_tile_entity_ref(entity_ref: string | null): { place_id: string; x: number; y: number; z: number } | null {
        const ref = String(entity_ref ?? '').trim();
        if (!ref.startsWith('tile.')) return null;
        const parts = ref.split('.');
        if (parts.length < 5) return null;
        const z = Math.floor(Number(parts[parts.length - 1] ?? NaN));
        const y = Math.floor(Number(parts[parts.length - 2] ?? NaN));
        const x = Math.floor(Number(parts[parts.length - 3] ?? NaN));
        const place_id = parts.slice(1, parts.length - 3).join('.');
        if (!place_id || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
        return { place_id, x, y, z };
    }

    function get_entity_editor_subject_label(entity_ref: string | null): string {
        if (!entity_ref) return 'no target';
        const tile_ref = parse_tile_entity_ref(entity_ref);
        if (tile_ref) return `tile ${tile_ref.x},${tile_ref.y},${tile_ref.z}`;
        if (entity_ref.startsWith('item.')) {
            const original = ui_state.item_editor.original as any;
            if (ui_state.item_editor.item_ref === entity_ref && original) {
                const name = String(original?.name ?? entity_ref).trim();
                const qty = Math.max(1, Math.floor(Number(original?.qty ?? 1) || 1));
                return qty > 1 ? `${name} x${qty}` : name;
            }
            return entity_ref;
        }
        return get_character_editor_subject_label(entity_ref);
    }

    function get_entity_inspector_mode_label(): string {
        return 'replace';
    }

    function open_entity_inspector(kind: 'character' | 'tile' | 'item', entity_ref: string): void {
        ui_state.entity_inspector.is_visible = true;
        ui_state.entity_inspector.entity_kind = kind;
        ui_state.entity_inspector.entity_ref = entity_ref;
        set_module_visible('entity_inspector_module', true);
    }

    function close_entity_inspector(): void {
        ui_state.entity_inspector.is_visible = false;
        ui_state.entity_inspector.entity_kind = null;
        ui_state.entity_inspector.entity_ref = null;
        set_module_visible('entity_inspector_module', false);
    }

    function get_tile_editor_grow_summary(payload: Record<string, unknown> | null): { count: number; period?: number; slots?: number; yield_qty?: number; item_defs?: string[] } {
        const states = Array.isArray((payload as any)?.resolved_tag_states) ? (payload as any).resolved_tag_states : [];
        const grows = resolve_grow_tag_configs(states as any);
        const first = grows[0] ?? null;
        return {
            count: grows.length,
            period: first?.period_breaths,
            slots: first?.max_grow_slots,
            yield_qty: first?.yield_qty,
            item_defs: Array.isArray(first?.item_def_ids) ? first.item_def_ids : undefined,
        };
    }

    function get_container_capacity_summary(payload: Record<string, unknown> | null): { has_container: boolean; capacity_mag?: number; max_slots?: number } {
        const states = Array.isArray((payload as any)?.resolved_tag_states) ? (payload as any).resolved_tag_states : [];
        const capacity_mag = resolve_container_capacity_mag_from_states(states as any);
        if (capacity_mag === null) return { has_container: false };
        return {
            has_container: true,
            capacity_mag,
            max_slots: project_container_max_slots(capacity_mag),
        };
    }

    function get_item_editor_spoil_summary(payload: Record<string, unknown> | null): { has_spoils: boolean; period?: number; elapsed?: number; remaining?: number; result_item_def_id?: string | null } {
        const states = Array.isArray((payload as any)?.resolved_tag_states) ? (payload as any).resolved_tag_states : [];
        const config = resolve_spoils_tag_config_from_states(states as any);
        if (!config) return { has_spoils: false };
        const last = Number((payload as any)?.last_breath_processed);
        const current = Number((payload as any)?.current_breath_index);
        const elapsed = Number.isFinite(last) && Number.isFinite(current)
            ? Math.max(0, Math.floor(current) - Math.floor(last))
            : undefined;
        const remaining = elapsed === undefined ? undefined : Math.max(0, config.period_breaths - elapsed);
        return {
            has_spoils: true,
            period: config.period_breaths,
            elapsed,
            remaining,
            result_item_def_id: config.result_item_def_id,
        };
    }

    function get_item_editor_tool_summary(payload: Record<string, unknown> | null): { has_tool: boolean; tool_name?: string; potency_mag?: number; potency_dice?: string } {
        const states = Array.isArray((payload as any)?.resolved_tag_states) ? (payload as any).resolved_tag_states : [];
        const tool_state = states.find((state: any) => String(state?.name ?? '').trim().toUpperCase() === 'TOOL') ?? null;
        if (!tool_state) return { has_tool: false };
        const subtype = states.find((state: any) => {
            if (!state || String(state?.name ?? '').trim().toUpperCase() === 'TOOL') return false;
            const meta = Array.isArray(state?.definition?.meta) ? state.definition.meta.map((entry: unknown) => String(entry ?? '').trim().toLowerCase()) : [];
            const potency_mag = Number((state?.dim_mag ?? {})?.potency_roll_mag);
            return meta.includes('tool') || Number.isFinite(potency_mag);
        }) ?? null;
        if (!subtype) return { has_tool: true };
        const potency_mag = Number((subtype?.dim_mag ?? {})?.potency_roll_mag);
        const normalized_mag = Number.isFinite(potency_mag) ? Math.floor(potency_mag) : Math.floor(Number(subtype?.stored_mag ?? 0) || 0);
        return {
            has_tool: true,
            tool_name: String(subtype?.name ?? '').trim() || 'TOOL',
            potency_mag: normalized_mag,
            potency_dice: get_damage_dice_from_mag(normalized_mag),
        };
    }

    function format_legality_detail(detail: unknown): string {
        if (!detail || typeof detail !== 'object') return '';
        const any_detail = detail as Record<string, unknown>;
        const stack_reason = String(any_detail.stack_reason ?? '').trim();
        if (stack_reason.startsWith('tag_stack_pairing_failed')) {
            const tag_name = String(any_detail.tag_name ?? stack_reason.split(':')[1] ?? '').trim();
            if (tag_name === 'FROST!') return 'stack needs matching FROST! tags on both items';
            if (tag_name === 'GARB') return 'stack needs matching GARB tags on both items';
            if (tag_name === 'SPOILS') return 'stack needs matching SPOILS tags on both items';
            if (tag_name === 'FIRE!') return 'stack needs matching FIRE! tags on both items';
            return tag_name ? `stack needs matching ${tag_name} tags on both items` : 'stack tags do not pair cleanly';
        }
        if (stack_reason.startsWith('tag_stack_illegal')) {
            const tag_name = String(any_detail.tag_name ?? stack_reason.split(':')[1] ?? '').trim();
            const mismatch = String(any_detail.mismatch ?? '').trim();
            if (tag_name === 'FROST!') {
                if (mismatch === 'dimensions') return 'stack blocked: FROST! non-intensity values must match';
                if (mismatch === 'info') return 'stack blocked: FROST! info must match';
                return 'stack blocked by tag rule: FROST!';
            }
            if (tag_name === 'GARB') {
                if (mismatch === 'dimensions') return 'stack blocked: GARB dimensions must match exactly';
                if (mismatch === 'info') return 'stack blocked: GARB info must match exactly';
                return 'stack blocked: GARB must match exactly';
            }
            if (tag_name === 'SPOILS') {
                if (mismatch === 'dimensions') return 'stack blocked: SPOILS time values must match';
                if (mismatch === 'info') return 'stack blocked: SPOILS result data must match';
                return 'stack blocked: SPOILS must match exactly';
            }
            if (tag_name === 'FIRE!') {
                if (mismatch === 'dimensions') return 'stack blocked: FIRE! non-intensity values must match';
                if (mismatch === 'info') return 'stack blocked: FIRE! info must match';
                return 'stack blocked by tag rule: FIRE!';
            }
            return tag_name ? `stack blocked by tag rule: ${tag_name}` : 'stack blocked by tag rule';
        }
        if (stack_reason === 'max_stack_exceeded') {
            return `stack would exceed max size ${String(any_detail.max_stack ?? '?')}`;
        }
        if (stack_reason) return `stack blocked: ${stack_reason}`;
        return JSON.stringify(detail);
    }

    function maybe_focus_container_tag(entity_ref: string): void {
        if (ui_state.tag_picker.entity_ref === entity_ref) return;
        const container_tag = get_character_tags(entity_ref).find((tag) => String(tag?.name ?? '').trim().toUpperCase() === 'CONTAINER') ?? null;
        if (!container_tag) return;
        load_tag_picker_from_entity(entity_ref, container_tag);
    }

    function maybe_focus_grow_tag_for_tile(tile_ref: string): void {
        if (ui_state.tag_picker.entity_ref === tile_ref) return;
        const grow_tag = get_character_tags(tile_ref).find((tag) => String(tag?.name ?? '').trim().toUpperCase() === 'GROW') ?? null;
        if (!grow_tag) return;
        load_tag_picker_from_entity(tile_ref, grow_tag);
    }

    function get_transcript_speaker_name(sender: string): string {
        const ref = String(sender ?? '').trim();
        if (!ref) return 'Unknown';
        if (ref.startsWith('npc.') || ref.startsWith('actor.')) {
            return get_entity_display_name(ref);
        }
        return ref;
    }

    function sync_character_runtime_in_loaded_state(character_ref: string, character: Record<string, unknown>): void {
        const next_name = String(character?.name ?? '').trim();
        const next_initial = next_name.charAt(0).toUpperCase();

        for (const target of ui_state.controls.targets) {
            if (target.ref === character_ref && next_name) target.label = next_name;
        }

        const patch_place = (place: any): void => {
            if (!place?.contents) return;
            if (character_ref.startsWith('npc.') && Array.isArray(place.contents.npcs_present)) {
                for (const npc of place.contents.npcs_present) {
                    if (String(npc?.npc_ref ?? '') === character_ref) {
                        if (next_name) npc.name = next_name;
                        if (next_initial) (npc as any).display_char = next_initial;
                        (npc as any).sex = String(character?.sex ?? '');
                        (npc as any).title = String(character?.title ?? '');
                        (npc as any).kind = String((character as any)?.kind ?? (character as any)?.kind_id ?? '');
                        if (typeof (character as any)?.body_model_id === 'string') (npc as any).body_model_id = String((character as any).body_model_id);
                        if ((character as any)?.entity_render) (npc as any).entity_render = (character as any).entity_render;
                    }
                }
            }
            if (character_ref.startsWith('actor.') && Array.isArray(place.contents.actors_present)) {
                for (const actor of place.contents.actors_present) {
                    if (String(actor?.actor_ref ?? '') === character_ref) {
                        if (next_name) actor.name = next_name;
                        if (next_initial) (actor as any).display_char = next_initial;
                        (actor as any).sex = String(character?.sex ?? '');
                        (actor as any).title = String(character?.title ?? '');
                        (actor as any).kind = String((character as any)?.kind ?? (character as any)?.kind_id ?? '');
                        if (typeof (character as any)?.body_model_id === 'string') (actor as any).body_model_id = String((character as any).body_model_id);
                        if ((character as any)?.entity_render) (actor as any).entity_render = (character as any).entity_render;
                    }
                }
            }
        };

        patch_place(ui_state.place.current_place as any);
        for (const place of ui_state.place.scene_places) patch_place(place as any);
        set_command_handler_place(ui_state.place.current_place);

        if (character_ref === get_input_actor_ref()) {
            if (next_name) ui_state.character.display_name = next_name;
            ui_state.character.render_meta.kind_id = String((character as any)?.kind ?? (character as any)?.kind_id ?? '') || null;
            if (typeof (character as any)?.body_model_id === 'string') ui_state.character.render_meta.body_model_id = String((character as any).body_model_id);
            if ((character as any)?.entity_render) ui_state.character.render_meta.entity_render = (character as any).entity_render;
        }
    }

    function populate_character_editor_state(character_ref: string, character: Record<string, unknown>): void {
        ui_state.character_editor.character_ref = character_ref;
        ui_state.character_editor.role = character_ref.startsWith('npc.') ? 'npc' : 'actor';
        ui_state.character_editor.original = JSON.parse(JSON.stringify(character ?? {}));
        ui_state.character_editor.draft = {
            name: String(character?.name ?? ''),
            title: String(character?.title ?? ''),
            kind: String((character as any)?.kind ?? (character as any)?.kind_id ?? ''),
            sex: String(character?.sex ?? ''),
            age: String(character?.age ?? ''),
        };
        ui_state.character_editor.dirty = false;
        ui_state.character_editor.status_lines = [
            get_character_editor_subject_label(character_ref),
            typeof (character as any)?.stat_source === 'object' ? `stat source: ${String((character as any)?.stat_source?.kind_id ?? (character as any)?.kind ?? '-')}` : 'stat source: baked',
            'type to edit selected field',
            'ctrl+s save / esc unfocus',
        ];
    }

    async function open_character_editor_module(character_ref: string): Promise<void> {
        if (!ui_state.place_painter.active) {
            flash_status(['Character editor is place-painter only'], 1200);
            return;
        }
        try {
            const data = await load_character_module_data(character_ref);
            populate_character_editor_state(character_ref, data.character as Record<string, unknown>);
            open_entity_inspector('character', character_ref);
            flash_status([`Editing ${get_character_editor_subject_label(character_ref)}`], 1200);
        } catch (err) {
            debug_warn('[CharacterEditor] open failed', err);
            flash_status([`Character load failed`, String(character_ref)], 1500);
        }
    }

    function build_character_editor_patch(): Record<string, unknown> {
        const original = ui_state.character_editor.original ?? {};
        const draft = ui_state.character_editor.draft;
        const patch: Record<string, unknown> = {};
        if (draft.name !== String((original as any)?.name ?? '')) patch.name = draft.name;
        if (draft.title !== String((original as any)?.title ?? '')) patch.title = draft.title;
        const original_kind = String((original as any)?.kind ?? (original as any)?.kind_id ?? '');
        if (draft.kind !== original_kind) patch.kind = draft.kind;
        if (draft.sex !== String((original as any)?.sex ?? '')) patch.sex = draft.sex;
        const original_age = String((original as any)?.age ?? '');
        if (draft.age !== original_age) {
            const parsed = Number(draft.age);
            patch.age = Number.isFinite(parsed) ? parsed : draft.age;
        }
        return patch;
    }

    async function save_character_editor_module(): Promise<void> {
        const character_ref = ui_state.character_editor.character_ref;
        if (!character_ref) return;
        const patch = build_character_editor_patch();
        if (Object.keys(patch).length < 1) {
            ui_state.character_editor.status_lines = [get_character_editor_subject_label(character_ref), 'no changes to save'];
            ui_state.character_editor.dirty = false;
            return;
        }
        ui_state.character_editor.saving = true;
        ui_state.character_editor.status_lines = [get_character_editor_subject_label(character_ref), 'saving...'];
        try {
            const res = await fetch('http://localhost:8787/api/character/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    slot: APP_CONFIG.selected_data_slot,
                    ref: character_ref,
                    patch,
                }),
            });
            const data = await res.json().catch(() => null as any);
            if (!res.ok || !data?.ok || !data?.character) {
                throw new Error(String(data?.error ?? `HTTP ${res.status}`));
            }
            sync_character_runtime_in_loaded_state(character_ref, data.character as Record<string, unknown>);
            populate_character_editor_state(character_ref, data.character as Record<string, unknown>);
            ui_state.character_editor.status_lines = [
                get_character_editor_subject_label(character_ref),
                `saved: ${String((data.character as any)?.name ?? '(unnamed)')}`,
                Object.prototype.hasOwnProperty.call(patch, 'kind') ? 'stats rederived from stat source' : 'stat source preserved',
                `file: ${String(data?.path ?? 'unknown')}`,
            ];
            ui_state.controls.targets_ready = false;
            last_targets_poll_ms = 0;
            void poll_window_feeds();
            void refresh_character_data(true);
            const current_place_id = ui_state.place.scene_selected_place_id ?? ui_state.place.current_place_id;
            if (current_place_id) void refresh_selected_scene_place(current_place_id, { source: 'character_editor_save', preserve_place_painter: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            ui_state.character_editor.status_lines = [get_character_editor_subject_label(character_ref), `save failed: ${message}`];
            debug_warn('[CharacterEditor] save failed', err);
        } finally {
            ui_state.character_editor.saving = false;
        }
    }

    async function reload_character_editor_module(): Promise<void> {
        const character_ref = ui_state.character_editor.character_ref;
        if (!character_ref) return;
        try {
            const data = await load_character_module_data(character_ref);
            populate_character_editor_state(character_ref, data.character as Record<string, unknown>);
            ui_state.character_editor.status_lines = [get_character_editor_subject_label(character_ref), 'reloaded'];
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            ui_state.character_editor.status_lines = [get_character_editor_subject_label(character_ref), `reload failed: ${message}`];
        }
    }

    function close_character_editor_module(): void {
        close_option_picker();
        if (ui_state.entity_inspector.entity_kind === 'character') close_entity_inspector();
    }

    function populate_tile_editor_state(tile_ref: string, payload: Record<string, unknown>): void {
        const parsed = parse_tile_entity_ref(tile_ref);
        if (!parsed) return;
        const grow = get_tile_editor_grow_summary(payload);
        const container = get_container_capacity_summary(payload);
        ui_state.tile_editor.tile_ref = tile_ref;
        ui_state.tile_editor.place_id = parsed.place_id;
        ui_state.tile_editor.x = parsed.x;
        ui_state.tile_editor.y = parsed.y;
        ui_state.tile_editor.z = parsed.z;
        ui_state.tile_editor.original = JSON.parse(JSON.stringify(payload ?? {}));
        ui_state.tile_editor.status_lines = [
            get_entity_editor_subject_label(tile_ref),
            grow.count > 0
                ? `grow: ${grow.count} stream${grow.count === 1 ? '' : 's'} | select GROW to edit`
                : 'tags edit live through tag picker',
            grow.count > 0 && grow.period !== undefined
                ? `period:${grow.period} slots:${grow.slots ?? 0} yield:${grow.yield_qty ?? 0}`
                : container.has_container
                    ? `container cap:${container.capacity_mag ?? 1} slots:${container.max_slots ?? 1}`
                : 'reload to refresh resolved state',
            'reload to refresh resolved state',
        ].filter((line, index, all) => line && all.indexOf(line) === index);
        set_character_tags(tile_ref, (payload as any)?.tags);
    }

    async function load_tile_editor_data(place_id: string, x: number, y: number, z: number): Promise<Record<string, unknown>> {
        const res = await fetch(`http://localhost:8787/api/tile/editor?place_id=${encodeURIComponent(place_id)}&x=${Math.floor(x)}&y=${Math.floor(y)}&z=${Math.floor(z)}&slot=${APP_CONFIG.selected_data_slot}`);
        const data = await res.json().catch(() => null as any);
        if (!res.ok || !data?.ok || !data?.tile) {
            throw new Error(String(data?.error ?? `HTTP ${res.status}`));
        }
        return data.tile as Record<string, unknown>;
    }

    async function open_tile_editor_module(place_id: string, x: number, y: number, z: number): Promise<void> {
        if (!ui_state.place_painter.active) {
            flash_status(['Tile editor is place-painter only'], 1200);
            return;
        }
        const tile_ref = build_tile_entity_ref(place_id, x, y, z);
        try {
            const data = await load_tile_editor_data(place_id, x, y, z);
            populate_tile_editor_state(tile_ref, data);
            open_entity_inspector('tile', tile_ref);
            maybe_focus_grow_tag_for_tile(tile_ref);
            maybe_focus_container_tag(tile_ref);
            flash_status([`Editing ${get_entity_editor_subject_label(tile_ref)}`], 1200);
        } catch (err) {
            debug_warn('[TileEditor] open failed', err);
            flash_status(['Tile load failed', `${x},${y},${z}`], 1500);
        }
    }

    async function reload_tile_editor_module(): Promise<void> {
        const tile_ref = ui_state.tile_editor.tile_ref;
        const parsed = parse_tile_entity_ref(tile_ref);
        if (!parsed) return;
        try {
            const data = await load_tile_editor_data(parsed.place_id, parsed.x, parsed.y, parsed.z);
            populate_tile_editor_state(tile_ref!, data);
            ui_state.tile_editor.status_lines = [get_entity_editor_subject_label(tile_ref), 'reloaded'];
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            ui_state.tile_editor.status_lines = [get_entity_editor_subject_label(tile_ref), `reload failed: ${message}`];
        }
    }

    async function save_tile_editor_module(): Promise<void> {
        const tile_ref = ui_state.tile_editor.tile_ref;
        ui_state.tile_editor.status_lines = [get_entity_editor_subject_label(tile_ref), 'tile tag edits save live'];
    }

    function close_tile_editor_module(): void {
        ui_state.tile_editor.tile_ref = null;
        ui_state.tile_editor.place_id = null;
        ui_state.tile_editor.original = null;
        if (ui_state.entity_inspector.entity_kind === 'tile') close_entity_inspector();
    }

    function clamp_tag_mag(value: unknown, fallback: number = 0): number {
        return Math.max(0, Math.min(99, Math.floor(Number(value ?? fallback) || 0)));
    }

    function clamp_dimension_mag(value: unknown, definition?: TagPickerDefinition['dimensions'][number] | null, fallback?: number): number {
        return clamp_mag(value, definition?.min_mag ?? null, definition?.max_mag ?? null, fallback ?? definition?.default_mag ?? 0);
    }

    function normalize_dim_mag_for_ui(value: unknown): Record<string, number> | undefined {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
        const out: Record<string, number> = {};
        for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
            const next_key = String(key ?? '').trim();
            if (!next_key) continue;
            out[next_key] = normalize_signed_mag(raw, 0);
        }
        return Object.keys(out).length > 0 ? out : undefined;
    }

    function clone_tag_info_for_ui(value: unknown): unknown[] | undefined {
        return Array.isArray(value) ? JSON.parse(JSON.stringify(value)) : undefined;
    }

    function normalize_tag_instance_for_ui(tag: any): TagPickerDraft {
        const next_mag = clamp_tag_mag(tag?.mag ?? 1, 1);
        return {
            key: typeof tag?.key === 'string' ? String(tag.key) : undefined,
            name: String(tag?.name ?? '').trim().toUpperCase(),
            mag: next_mag,
            dim_mag: normalize_dim_mag_for_ui(tag?.dim_mag),
            meta: Array.isArray(tag?.meta) ? tag.meta.map((entry: unknown) => String(entry ?? '').trim().toUpperCase()).filter(Boolean) : [],
            info: clone_tag_info_for_ui(tag?.info),
            source: typeof tag?.source === 'string' ? String(tag.source) : undefined,
            expiry: Number.isFinite(Number(tag?.expiry)) ? Math.floor(Number(tag.expiry)) : undefined,
            scope: Array.isArray(tag?.scope)
                ? tag.scope.map((entry: unknown) => String(entry ?? '').trim().toUpperCase()).filter((entry: string) => entry === 'CHARACTER' || entry === 'ITEM' || entry === 'TILE' || entry === 'TAG') as Array<'CHARACTER' | 'ITEM' | 'TILE' | 'TAG'>
                : undefined,
        };
    }

    function merge_tag_with_definition(tag: TagPickerDraft, definition: TagPickerDefinition | null): TagPickerDraft {
        const quantity_mag = definition?.quantity_dimension_id ? (tag.dim_mag?.[definition.quantity_dimension_id] ?? tag.mag ?? 1) : 1;
        const next: TagPickerDraft = {
            ...tag,
            mag: clamp_tag_mag(quantity_mag, 1),
            meta: [...tag.meta],
            dim_mag: tag.dim_mag ? { ...tag.dim_mag } : undefined,
            info: clone_tag_info_for_ui(tag.info),
            scope: Array.isArray(tag.scope) ? [...tag.scope] : undefined,
        };
        if (!definition) return next;
        const next_dim_mag: Record<string, number> = { ...(next.dim_mag ?? {}) };
        for (const dimension of definition.dimensions) {
            const existing = next_dim_mag[dimension.id];
            next_dim_mag[dimension.id] = clamp_dimension_mag(existing ?? dimension.default_mag, dimension, dimension.default_mag);
        }
        next.dim_mag = Object.keys(next_dim_mag).length > 0 ? next_dim_mag : undefined;
        return next;
    }

    async function fetch_tag_definition_for_ui(name: string): Promise<TagPickerDefinition | null> {
        const tag_name = String(name ?? '').trim().toUpperCase();
        if (!tag_name) return null;
        const res = await fetch(`http://localhost:8787/api/tag/definition?name=${encodeURIComponent(tag_name)}`);
        const data = await res.json().catch(() => null as any);
        if (!res.ok || !data?.ok || !data?.definition) throw new Error(String(data?.error ?? `HTTP ${res.status}`));
        const definition = data.definition as any;
        return {
            name: String(definition?.name ?? tag_name),
            base_tag_value_mag: Number.isFinite(Number(definition?.base_tag_value_mag)) ? Math.floor(Number(definition.base_tag_value_mag)) : 0,
            quantity_dimension_id: typeof definition?.quantity_dimension_id === 'string' ? String(definition.quantity_dimension_id) : null,
            dimensions: Array.isArray(definition?.dimensions)
                ? definition.dimensions.map((dimension: any) => ({
                    id: String(dimension?.id ?? '').trim(),
                    label: String(dimension?.label ?? dimension?.id ?? '').trim(),
                    default_mag: normalize_signed_mag(dimension?.default_mag, 0),
                    min_mag: Number.isFinite(Number(dimension?.min_mag)) ? Math.floor(Number(dimension.min_mag)) : null,
                    max_mag: Number.isFinite(Number(dimension?.max_mag)) ? Math.floor(Number(dimension.max_mag)) : null,
                    description: typeof dimension?.description === 'string' ? String(dimension.description) : null,
                    value_up_per_mag: Number.isFinite(Number(dimension?.value_up_per_mag)) ? Number(dimension.value_up_per_mag) : undefined,
                    value_down_per_mag: Number.isFinite(Number(dimension?.value_down_per_mag)) ? Number(dimension.value_down_per_mag) : undefined,
                })).filter((dimension: TagPickerDefinition['dimensions'][number]) => dimension.id.length > 0)
                : [],
        };
    }

    async function sync_tag_picker_definition(name: string, opts?: { preserve_status?: boolean }): Promise<void> {
        const tag_name = String(name ?? '').trim().toUpperCase();
        if (!tag_name) {
            ui_state.tag_picker.definition = null;
            return;
        }
        try {
            const definition = await fetch_tag_definition_for_ui(tag_name);
            ui_state.tag_picker.definition = definition;
            if (ui_state.tag_picker.draft) {
                ui_state.tag_picker.draft = merge_tag_with_definition(ui_state.tag_picker.draft, definition);
            }
            if (!opts?.preserve_status) update_tag_picker_status(get_entity_editor_subject_label(ui_state.tag_picker.entity_ref), `tag: ${tag_name}`);
        } catch (err) {
            ui_state.tag_picker.definition = null;
            const message = err instanceof Error ? err.message : String(err);
            update_tag_picker_status(get_entity_editor_subject_label(ui_state.tag_picker.entity_ref), `definition load failed: ${message}`);
        }
    }

    function get_character_tags(entity_ref: string | null): TagInstance[] {
        if (!entity_ref) return [];
        return ui_state.entity_tags_by_ref.get(entity_ref) ?? [];
    }

    function set_character_tags(entity_ref: string, tags: unknown): void {
        const next = Array.isArray(tags)
            ? tags
                .map((tag) => normalize_tag_instance_for_ui(tag))
                .filter((tag) => is_tag_editor_visible(String(tag?.name ?? '')))
            : [];
        ui_state.entity_tags_by_ref.set(entity_ref, next);
        if (entity_ref === get_input_actor_ref()) {
            ui_state.character.render_meta.tags = next;
        }
    }

    function update_tag_picker_status(...lines: string[]): void {
        ui_state.tag_picker.status_lines = lines.filter((line) => String(line ?? '').trim().length > 0);
    }

    function find_best_matching_tag(tags: TagInstance[], tag: TagPickerDraft, previous_key?: string | null): TagInstance | null {
        const next_key = tag_key(tag as any);
        return tags.find((entry) => tag_key(entry as any) === next_key)
            ?? tags.find((entry) => previous_key && tag_key(entry as any) === previous_key)
            ?? tags.find((entry) => String(entry?.name ?? '').trim().toUpperCase() === String(tag.name ?? '').trim().toUpperCase())
            ?? null;
    }

    function load_tag_picker_from_entity(entity_ref: string, tag: TagInstance): void {
        const normalized = normalize_tag_instance_for_ui(tag);
        ui_state.tag_picker.is_visible = true;
        ui_state.tag_picker.entity_ref = entity_ref;
        ui_state.tag_picker.selected_tag_key = tag_key(normalized as any);
        ui_state.tag_picker.selected_field = 'name';
        ui_state.tag_picker.original_name = normalized.name;
        ui_state.tag_picker.draft = {
            ...normalized,
            meta: [...normalized.meta],
            dim_mag: normalized.dim_mag ? { ...normalized.dim_mag } : undefined,
            info: clone_tag_info_for_ui(normalized.info),
            scope: Array.isArray(normalized.scope) ? [...normalized.scope] : undefined,
        };
        ui_state.tag_picker.meta_text = normalized.meta.join(',');
        update_tag_picker_status(get_entity_editor_subject_label(entity_ref), `tag: ${normalized.name}`);
        set_module_visible('tag_picker_module', true);
        void sync_tag_picker_definition(normalized.name, { preserve_status: true });
    }

    function close_tag_picker_module(): void {
        ui_state.tag_picker.is_visible = false;
        ui_state.tag_picker.entity_ref = null;
        ui_state.tag_picker.selected_tag_key = null;
        ui_state.tag_picker.original_name = '';
        ui_state.tag_picker.draft = null;
        ui_state.tag_picker.definition = null;
        ui_state.tag_picker.meta_text = '';
        if (ui_state.option_picker.target_kind === 'tag_picker') close_option_picker();
        set_module_visible('tag_picker_module', false);
    }

    async function apply_tag_picker_draft(): Promise<void> {
        const entity_ref = ui_state.tag_picker.entity_ref;
        const draft = ui_state.tag_picker.draft;
        if (!entity_ref || !draft) return;
        if (ui_state.tag_picker.definition?.quantity_dimension_id) {
            const dim_id = ui_state.tag_picker.definition.quantity_dimension_id;
            draft.mag = clamp_tag_mag(draft.dim_mag?.[dim_id] ?? draft.mag, draft.mag);
        } else {
            draft.mag = 1;
        }
        ui_state.tag_picker.applying = true;
        const previous_key = ui_state.tag_picker.selected_tag_key;
        try {
            const is_tile = entity_ref.startsWith('tile.');
            const is_item = entity_ref.startsWith('item.');
            const tile_ref = parse_tile_entity_ref(entity_ref);
            const endpoint = is_tile
                ? 'http://localhost:8787/api/tile/tag/update'
                : is_item
                    ? 'http://localhost:8787/api/item/tag/update'
                    : 'http://localhost:8787/api/character/tag/update';
            const body = is_tile && tile_ref
                ? {
                    slot: APP_CONFIG.selected_data_slot,
                    place_id: tile_ref.place_id,
                    x: tile_ref.x,
                    y: tile_ref.y,
                    z: tile_ref.z,
                    mode: 'upsert',
                    previous_key,
                    previous_tag_name: ui_state.tag_picker.original_name,
                    tag: draft,
                }
                : is_item
                    ? {
                        slot: APP_CONFIG.selected_data_slot,
                        item_ref: entity_ref,
                        owner_kind: ui_state.item_editor.owner_kind,
                        owner_id: ui_state.item_editor.owner_id,
                        mode: 'upsert',
                        previous_key,
                        previous_tag_name: ui_state.tag_picker.original_name,
                        tag: draft,
                    }
                : {
                    slot: APP_CONFIG.selected_data_slot,
                    ref: entity_ref,
                    mode: 'upsert',
                    previous_key,
                    previous_tag_name: ui_state.tag_picker.original_name,
                    tag: draft,
                };
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json().catch(() => null as any);
            const payload = is_tile ? data?.tile : is_item ? data?.item : data?.character;
            if (!res.ok || !data?.ok || !payload) {
                throw new Error(String(data?.error ?? `HTTP ${res.status}`));
            }
            set_character_tags(entity_ref, (payload as any)?.tags);
            const next_tags = get_character_tags(entity_ref);
            const refreshed = find_best_matching_tag(next_tags, draft, previous_key) ?? normalize_tag_instance_for_ui(draft);
            load_tag_picker_from_entity(entity_ref, refreshed);
            if (is_tile && tile_ref) {
                populate_tile_editor_state(entity_ref, payload as Record<string, unknown>);
                const selected_place_id = ui_state.place.scene_selected_place_id ?? ui_state.place.current_place_id;
                if (selected_place_id === tile_ref.place_id) void refresh_selected_scene_place(tile_ref.place_id, { source: 'tile_tag_update', preserve_place_painter: true });
                else void refresh_single_scene_place(tile_ref.place_id);
            } else if (is_item && ui_state.item_editor.owner_kind && ui_state.item_editor.owner_id) {
                populate_item_editor_state({ item_ref: entity_ref, owner_kind: ui_state.item_editor.owner_kind, owner_id: ui_state.item_editor.owner_id }, payload as Record<string, unknown>);
                if (ui_state.item_editor.owner_kind === 'place') {
                    const selected_place_id = ui_state.place.scene_selected_place_id ?? ui_state.place.current_place_id;
                    if (selected_place_id === ui_state.item_editor.owner_id) void refresh_selected_scene_place(ui_state.item_editor.owner_id, { source: 'item_tag_update', preserve_place_painter: true });
                    else void refresh_single_scene_place(ui_state.item_editor.owner_id);
                } else {
                    void refresh_actor_owner_inventory_view();
                }
            } else if (entity_ref === get_input_actor_ref()) {
                void refresh_character_data(true);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            update_tag_picker_status(get_entity_editor_subject_label(entity_ref), `tag save failed: ${message}`);
        } finally {
            ui_state.tag_picker.applying = false;
        }
    }

    async function remove_tag_picker_selected(): Promise<void> {
        const entity_ref = ui_state.tag_picker.entity_ref;
        const draft = ui_state.tag_picker.draft;
        const tag_name = draft?.name || ui_state.tag_picker.original_name;
        const previous_key = ui_state.tag_picker.selected_tag_key;
        if (!entity_ref || (!tag_name && !previous_key)) return;
        ui_state.tag_picker.applying = true;
        try {
            const is_tile = entity_ref.startsWith('tile.');
            const is_item = entity_ref.startsWith('item.');
            const tile_ref = parse_tile_entity_ref(entity_ref);
            const endpoint = is_tile
                ? 'http://localhost:8787/api/tile/tag/update'
                : is_item
                    ? 'http://localhost:8787/api/item/tag/update'
                    : 'http://localhost:8787/api/character/tag/update';
            const body = is_tile && tile_ref
                ? {
                    slot: APP_CONFIG.selected_data_slot,
                    place_id: tile_ref.place_id,
                    x: tile_ref.x,
                    y: tile_ref.y,
                    z: tile_ref.z,
                    mode: 'remove',
                    previous_key,
                    tag_name,
                }
                : is_item
                    ? {
                        slot: APP_CONFIG.selected_data_slot,
                        item_ref: entity_ref,
                        owner_kind: ui_state.item_editor.owner_kind,
                        owner_id: ui_state.item_editor.owner_id,
                        mode: 'remove',
                        previous_key,
                        tag_name,
                    }
                : {
                    slot: APP_CONFIG.selected_data_slot,
                    ref: entity_ref,
                    mode: 'remove',
                    previous_key,
                    tag_name,
                };
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json().catch(() => null as any);
            const payload = is_tile ? data?.tile : is_item ? data?.item : data?.character;
            if (!res.ok || !data?.ok || !payload) {
                throw new Error(String(data?.error ?? `HTTP ${res.status}`));
            }
            set_character_tags(entity_ref, (payload as any)?.tags);
            update_tag_picker_status(get_entity_editor_subject_label(entity_ref), `removed ${tag_name}`);
            close_tag_picker_module();
            if (is_tile && tile_ref) {
                populate_tile_editor_state(entity_ref, payload as Record<string, unknown>);
                const selected_place_id = ui_state.place.scene_selected_place_id ?? ui_state.place.current_place_id;
                if (selected_place_id === tile_ref.place_id) void refresh_selected_scene_place(tile_ref.place_id, { source: 'tile_tag_remove', preserve_place_painter: true });
                else void refresh_single_scene_place(tile_ref.place_id);
            } else if (is_item && ui_state.item_editor.owner_kind && ui_state.item_editor.owner_id) {
                populate_item_editor_state({ item_ref: entity_ref, owner_kind: ui_state.item_editor.owner_kind, owner_id: ui_state.item_editor.owner_id }, payload as Record<string, unknown>);
                if (ui_state.item_editor.owner_kind === 'place') {
                    const selected_place_id = ui_state.place.scene_selected_place_id ?? ui_state.place.current_place_id;
                    if (selected_place_id === ui_state.item_editor.owner_id) void refresh_selected_scene_place(ui_state.item_editor.owner_id, { source: 'item_tag_remove', preserve_place_painter: true });
                    else void refresh_single_scene_place(ui_state.item_editor.owner_id);
                } else {
                    void refresh_actor_owner_inventory_view();
                }
            } else if (entity_ref === get_input_actor_ref()) {
                void refresh_character_data(true);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            update_tag_picker_status(get_entity_editor_subject_label(entity_ref), `tag remove failed: ${message}`);
        } finally {
            ui_state.tag_picker.applying = false;
        }
    }

    async function seed_default_entity_tag(entity_ref: string): Promise<void> {
        ui_state.tag_picker.entity_ref = entity_ref;
        ui_state.tag_picker.selected_tag_key = null;
        ui_state.tag_picker.original_name = '';
        ui_state.tag_picker.draft = { name: 'CONTAINER', mag: 1, meta: [], dim_mag: undefined, info: undefined, scope: undefined, source: undefined, expiry: undefined };
        await sync_tag_picker_definition('CONTAINER', { preserve_status: true });
        await apply_tag_picker_draft();
    }

    function get_character_ref_for_module_id(module_id: string): string | null {
        if (module_id === 'character_module') return get_input_actor_ref();
        if (module_id.startsWith('npc_character_')) return `npc.${module_id.slice('npc_character_'.length)}`;
        return null;
    }

    function get_tag_scope_for_entity_ref(entity_ref: string | null): 'CHARACTER' | 'TILE' | 'ITEM' | null {
        const ref = String(entity_ref ?? '').trim();
        if (!ref) return null;
        if (ref.startsWith('actor.') || ref.startsWith('npc.')) return 'CHARACTER';
        if (ref.startsWith('tile.')) return 'TILE';
        if (ref.startsWith('item.')) return 'ITEM';
        return null;
    }

    type ItemInspectorSelection = {
        item_ref: string;
        owner_kind: 'actor' | 'npc' | 'place';
        owner_id: string;
    };

    function build_item_selection_from_surface(surface: StorageSurface, slot: StorageSlot): ItemInspectorSelection | null {
        const item_ref = slot.item?.id ? `item.${slot.item.id}` : null;
        if (!item_ref) return null;
        if (surface.owner.kind === 'actor') return { item_ref, owner_kind: 'actor', owner_id: surface.owner.id };
        if (surface.owner.kind === 'npc') return { item_ref, owner_kind: 'npc', owner_id: surface.owner.id };
        if (surface.owner.kind === 'tile') return { item_ref, owner_kind: 'place', owner_id: surface.owner.place_id };
        if (surface.owner.kind === 'structure') return { item_ref, owner_kind: 'place', owner_id: surface.owner.place_id };
        if (surface.owner.kind === 'item') return { item_ref, owner_kind: surface.owner.owner_kind === 'place' ? 'place' : surface.owner.owner_kind, owner_id: surface.owner.owner_id };
        return null;
    }

    function populate_item_editor_state(selection: ItemInspectorSelection, payload: Record<string, unknown>): void {
        ui_state.item_editor.item_ref = selection.item_ref;
        ui_state.item_editor.owner_kind = selection.owner_kind;
        ui_state.item_editor.owner_id = selection.owner_id;
        ui_state.item_editor.original = JSON.parse(JSON.stringify(payload ?? {}));
        const container = get_container_capacity_summary(payload);
        const spoils = get_item_editor_spoil_summary(payload);
        const tool = get_item_editor_tool_summary(payload);
        ui_state.item_editor.status_lines = [
            get_entity_editor_subject_label(selection.item_ref),
            tool.has_tool
                ? `tool: ${String(tool.tool_name ?? 'TOOL').toLowerCase()} potency:${tool.potency_dice ?? '-'}`
                : spoils.has_spoils
                ? `spoils in ${spoils.period ?? 0} breaths${spoils.result_item_def_id ? ` -> ${spoils.result_item_def_id}` : ' -> delete'}`
                : container.has_container
                ? `container cap:${container.capacity_mag ?? 1} slots:${container.max_slots ?? 1}`
                : 'single-click items to inspect',
            spoils.has_spoils
                ? `elapsed:${spoils.elapsed ?? 0} remaining:${spoils.remaining ?? spoils.period ?? 0}`
                : tool.has_tool
                ? `potency mag:${tool.potency_mag ?? 0} dice:${tool.potency_dice ?? '-'}`
                : 'tags edit live through tag picker',
            'tags edit live through tag picker',
        ];
        set_character_tags(selection.item_ref, (payload as any)?.tags);
    }

    async function load_item_editor_data(selection: ItemInspectorSelection): Promise<Record<string, unknown>> {
        const res = await fetch('http://localhost:8787/api/item/editor', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slot: APP_CONFIG.selected_data_slot, ...selection }),
        });
        const data = await res.json().catch(() => null as any);
        if (!res.ok || !data?.ok || !data?.item) throw new Error(String(data?.error ?? `HTTP ${res.status}`));
        return data.item as Record<string, unknown>;
    }

    async function open_item_editor_module(selection: ItemInspectorSelection): Promise<void> {
        try {
            const data = await load_item_editor_data(selection);
            populate_item_editor_state(selection, data);
            open_entity_inspector('item', selection.item_ref);
            maybe_focus_container_tag(selection.item_ref);
            flash_status([`Inspecting ${String((data as any)?.name ?? selection.item_ref)}`], 1200);
        } catch (err) {
            debug_warn('[ItemEditor] open failed', err);
            flash_status([`Item load failed`, selection.item_ref], 1500);
        }
    }

    function select_item_for_entity_inspector(selection: ItemInspectorSelection): void {
        void open_item_editor_module(selection);
    }

    async function reload_item_editor_module(): Promise<void> {
        const item_ref = ui_state.item_editor.item_ref;
        const owner_kind = ui_state.item_editor.owner_kind;
        const owner_id = ui_state.item_editor.owner_id;
        if (!item_ref || !owner_kind || !owner_id) return;
        try {
            const data = await load_item_editor_data({ item_ref, owner_kind, owner_id });
            populate_item_editor_state({ item_ref, owner_kind, owner_id }, data);
            ui_state.item_editor.status_lines = [get_entity_editor_subject_label(item_ref), 'reloaded'];
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            ui_state.item_editor.status_lines = [get_entity_editor_subject_label(item_ref), `reload failed: ${message}`];
        }
    }

    async function save_item_editor_module(): Promise<void> {
        const item_ref = ui_state.item_editor.item_ref;
        ui_state.item_editor.status_lines = [get_entity_editor_subject_label(item_ref), 'item tag edits save live'];
    }

    async function apply_tag_picker_drop(x: number, y: number): Promise<void> {
        const draft = ui_state.tag_picker.draft;
        if (!draft || !ui_state.modules.registry) return;
        const modules = ui_state.modules.registry.get_all();
        for (let i = modules.length - 1; i >= 0; i -= 1) {
            const module = modules[i]!;
            const entity_ref = get_character_ref_for_module_id(module.id);
            if (!entity_ref) continue;
            const hit = get_character_module_tag_row_at(module.rect, x, y, get_character_tags(entity_ref).length);
            if (!hit) continue;
            if (hit.kind === 'add') {
                ui_state.tag_picker.entity_ref = entity_ref;
                ui_state.tag_picker.original_name = draft.name;
                await apply_tag_picker_draft();
                return;
            }
            const existing = get_character_tags(entity_ref)[hit.index] ?? null;
            ui_state.tag_picker.entity_ref = entity_ref;
            ui_state.tag_picker.original_name = String(existing?.name ?? draft.name).trim().toUpperCase();
            await apply_tag_picker_draft();
            return;
        }
    }

    async function open_option_picker(args: {
        title: string;
        target_kind: 'character_editor' | 'tag_picker' | 'character_creation';
        target_field: string;
        selected_value?: string | null;
        options?: OptionPickerEntry[];
        fetch_url?: string;
    }): Promise<void> {
        try {
            let options = args.options ?? [];
            let selected_value = args.selected_value ?? null;
            if (args.fetch_url) {
                const res = await fetch(args.fetch_url);
                const data = await res.json().catch(() => null as any);
                if (!res.ok || !data?.ok || !Array.isArray(data?.options)) {
                    throw new Error(String(data?.error ?? `HTTP ${res.status}`));
                }
                options = data.options.map((option: any) => ({
                    value: String(option?.value ?? ''),
                    label: String(option?.label ?? option?.value ?? ''),
                    description: typeof option?.description === 'string' ? option.description : undefined,
                }));
                selected_value = typeof data?.selected_value === 'string' ? data.selected_value : selected_value;
            }
            ui_state.option_picker.is_visible = true;
            ui_state.option_picker.title = args.title;
            ui_state.option_picker.target_kind = args.target_kind;
            ui_state.option_picker.target_field = args.target_field;
            ui_state.option_picker.options = options;
            ui_state.option_picker.selected_value = selected_value;
            ui_state.option_picker.status_lines = ['enter/select to apply', 'esc to close'];
            set_module_visible('option_picker_module', true);
        } catch (err) {
            debug_warn('[OptionPicker] open failed', err);
            flash_status([`Picker failed`, args.title], 1400);
        }
    }

    function apply_character_creation_preview(preview: any): void {
        ui_state.character_creation.preview = {
            size_mag: Number(preview?.size_mag ?? 0) || 0,
            carry_capacity: Number(preview?.carry_capacity ?? 0) || 0,
            base_stats: {
                con: Number(preview?.base_stats?.con ?? 0) || 0,
                str: Number(preview?.base_stats?.str ?? 0) || 0,
                dex: Number(preview?.base_stats?.dex ?? 0) || 0,
                wis: Number(preview?.base_stats?.wis ?? 0) || 0,
                int: Number(preview?.base_stats?.int ?? 0) || 0,
                cha: Number(preview?.base_stats?.cha ?? 0) || 0,
            },
            effective_stats: {
                con: Number(preview?.effective_stats?.con ?? 0) || 0,
                str: Number(preview?.effective_stats?.str ?? 0) || 0,
                dex: Number(preview?.effective_stats?.dex ?? 0) || 0,
                wis: Number(preview?.effective_stats?.wis ?? 0) || 0,
                int: Number(preview?.effective_stats?.int ?? 0) || 0,
                cha: Number(preview?.effective_stats?.cha ?? 0) || 0,
            },
            kind_stat_changes: { ...((preview?.kind_stat_changes as Record<string, number> | undefined) ?? {}) },
        };
    }

    async function refresh_character_creation_bootstrap(kind_id?: string): Promise<void> {
        ui_state.character_creation.is_loading = true;
        try {
            const query = kind_id ? `?kind_id=${encodeURIComponent(kind_id)}` : '';
            const res = await fetch(`http://localhost:8787/api/character/create/bootstrap${query}`);
            const data = await res.json().catch(() => null) as any;
            if (!res.ok || !data?.ok) {
                throw new Error(String(data?.error ?? `character_create_bootstrap_failed:${res.status}`));
            }
            ui_state.character_creation.bootstrap.kinds = Array.isArray(data.kinds)
                ? data.kinds.map((kind: any) => ({ value: String(kind.value ?? ''), label: String(kind.label ?? kind.value ?? ''), description: typeof kind.description === 'string' ? kind.description : undefined }))
                : [];
            ui_state.character_creation.bootstrap.sex_options = Array.isArray(data.sex_options)
                ? data.sex_options.map((entry: any) => ({ value: String(entry.value ?? ''), label: String(entry.label ?? entry.value ?? '') }))
                : [];
            const selected_kind = String(data.selected_value ?? ui_state.character_creation.bootstrap.kinds[0]?.value ?? '').trim();
            if (selected_kind) ui_state.character_creation.draft.kind = selected_kind;
            if (!ui_state.character_creation.draft.sex) {
                ui_state.character_creation.draft.sex = String(ui_state.character_creation.bootstrap.sex_options[0]?.value ?? 'female');
            }
            apply_character_creation_preview(data.preview);
        } finally {
            ui_state.character_creation.is_loading = false;
        }
    }

    async function open_character_creation_module(): Promise<void> {
        ui_state.actor_claim.is_visible = false;
        ui_state.character_creation.is_visible = true;
        ui_state.character_creation.selected_field = 'name';
        ui_state.character_creation.status_lines = ['choose a kind', 'type a name and title'];
        apply_runtime_module_visibility();
        await refresh_character_creation_bootstrap(ui_state.character_creation.draft.kind || undefined);
    }

    function close_character_creation_module(): void {
        ui_state.character_creation.is_visible = false;
        ui_state.actor_claim.is_visible = true;
        apply_runtime_module_visibility();
    }

    async function reset_character_creation_draft(): Promise<void> {
        ui_state.character_creation.draft = { kind: '', title: '', name: '', sex: 'female' };
        ui_state.character_creation.created_actor_ref = null;
        await refresh_character_creation_bootstrap();
        ui_state.character_creation.status_lines = ['draft reset', 'choose a kind'];
    }

    function update_character_creation_field(key: string, value: string): void {
        if (key === 'size' || key === 'carry' || key.startsWith('stat_')) return;
        (ui_state.character_creation.draft as any)[key] = value;
    }

    async function open_character_creation_field_picker(field_key: string): Promise<void> {
        ui_state.character_creation.selected_field = field_key;
        if (field_key === 'kind') {
            await open_option_picker({
                title: 'PICK KIND',
                target_kind: 'character_creation',
                target_field: 'kind',
                selected_value: ui_state.character_creation.draft.kind,
                options: ui_state.character_creation.bootstrap.kinds,
            });
            return;
        }
        if (field_key === 'sex') {
            await open_option_picker({
                title: 'PICK SEX',
                target_kind: 'character_creation',
                target_field: 'sex',
                selected_value: ui_state.character_creation.draft.sex,
                options: ui_state.character_creation.bootstrap.sex_options,
            });
        }
    }

    function get_character_creation_fields(): CharacterCreationField[] {
        const preview = ui_state.character_creation.preview;
        return [
            { key: 'kind', label: 'kind', value: ui_state.character_creation.draft.kind || '(pick kind)' },
            { key: 'title', label: 'title', value: ui_state.character_creation.draft.title || '' },
            { key: 'name', label: 'name', value: ui_state.character_creation.draft.name || '' },
            { key: 'sex', label: 'sex', value: ui_state.character_creation.draft.sex || '(pick sex)' },
            { key: 'size', label: 'size', value: String(preview.size_mag), editable: false },
            { key: 'carry', label: 'carry', value: String(preview.carry_capacity), editable: false },
            { key: 'base_con', label: 'base con', value: String(preview.base_stats.con), editable: false },
            { key: 'base_str', label: 'base str', value: String(preview.base_stats.str), editable: false },
            { key: 'base_dex', label: 'base dex', value: String(preview.base_stats.dex), editable: false },
            { key: 'base_wis', label: 'base wis', value: String(preview.base_stats.wis), editable: false },
            { key: 'base_int', label: 'base int', value: String(preview.base_stats.int), editable: false },
            { key: 'base_cha', label: 'base cha', value: String(preview.base_stats.cha), editable: false },
            { key: 'stat_con', label: 'eff con', value: String(preview.effective_stats.con), editable: false },
            { key: 'stat_str', label: 'eff str', value: String(preview.effective_stats.str), editable: false },
            { key: 'stat_dex', label: 'eff dex', value: String(preview.effective_stats.dex), editable: false },
            { key: 'stat_wis', label: 'eff wis', value: String(preview.effective_stats.wis), editable: false },
            { key: 'stat_int', label: 'eff int', value: String(preview.effective_stats.int), editable: false },
            { key: 'stat_cha', label: 'eff cha', value: String(preview.effective_stats.cha), editable: false },
        ];
    }

    async function submit_character_creation(): Promise<void> {
        await ensure_multiplayer_session_bootstrap();
        const draft = ui_state.character_creation.draft;
        if (!draft.kind) {
            ui_state.character_creation.status_lines = ['pick a kind first'];
            return;
        }
        if (!draft.name.trim()) {
            ui_state.character_creation.status_lines = ['type a character name'];
            return;
        }
        ui_state.character_creation.is_submitting = true;
        try {
            const res = await fetch('http://localhost:8787/api/character/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    slot: APP_CONFIG.selected_data_slot,
                    session_token: get_session_token(),
                    kind_id: draft.kind,
                    title: draft.title,
                    name: draft.name,
                    sex: draft.sex,
                }),
            });
            const data = await res.json().catch(() => null) as any;
            if (!res.ok || !data?.ok || typeof data?.actor_ref !== 'string') {
                throw new Error(String(data?.error ?? `character_create_failed:${res.status}`));
            }
            ui_state.character_creation.created_actor_ref = String(data.actor_ref).trim();
            ui_state.character_creation.status_lines = [`created ${String(data.actor_name ?? draft.name).trim() || draft.name}`, 'returning to claim module'];
            close_character_creation_module();
            ui_state.actor_claim.is_visible = true;
            ui_state.actor_claim.selected_actor_ref = ui_state.character_creation.created_actor_ref;
            await refresh_actor_claim_state(['actor created', 'select claim to enter the world']);
        } finally {
            ui_state.character_creation.is_submitting = false;
        }
    }

    async function refresh_actor_claim_state(status_lines?: string[]): Promise<void> {
        await ensure_multiplayer_session_bootstrap();
        const session_token = get_session_token();
        const url = `http://localhost:8787/api/actors/claimable?slot=${encodeURIComponent(String(APP_CONFIG.selected_data_slot))}&session_token=${encodeURIComponent(session_token)}`;
        ui_state.actor_claim.is_loading = true;
        ui_state.actor_claim.error = null;
        try {
            const res = await fetch(url);
            const data = await res.json().catch(() => null) as {
                ok?: boolean;
                error?: string;
                current_actor_ref?: string | null;
                actors?: Array<{
                    actor_ref: string;
                    actor_id: string;
                    actor_name: string;
                    claimed_by_self: boolean;
                    claimed_by_other: boolean;
                }>;
            } | null;
            if (!res.ok || !data?.ok || !Array.isArray(data?.actors)) {
                throw new Error(String(data?.error ?? `claimable_fetch_failed:${res.status}`));
            }
            ui_state.actor_claim.actors = data.actors.map((actor) => ({
                actor_ref: String(actor.actor_ref ?? '').trim(),
                actor_id: String(actor.actor_id ?? '').trim(),
                actor_name: String(actor.actor_name ?? actor.actor_id ?? actor.actor_ref ?? '').trim(),
                claimed_by_self: Boolean(actor.claimed_by_self),
                claimed_by_other: Boolean(actor.claimed_by_other),
                claimed_by_client_session_id: null,
                can_claim: !actor.claimed_by_other,
            }));
            ui_state.actor_claim.current_actor_ref = typeof data.current_actor_ref === 'string' ? data.current_actor_ref : null;
            if (!ui_state.actor_claim.selected_actor_ref || !ui_state.actor_claim.actors.some((actor) => actor.actor_ref === ui_state.actor_claim.selected_actor_ref)) {
                const preferred = ui_state.actor_claim.current_actor_ref
                    ?? ui_state.actor_claim.actors.find((actor) => actor.can_claim)?.actor_ref
                    ?? ui_state.actor_claim.actors[0]?.actor_ref
                    ?? null;
                ui_state.actor_claim.selected_actor_ref = preferred;
            }
            ui_state.actor_claim.status_lines = status_lines ?? [
                ui_state.actor_claim.current_actor_ref ? 'release before switching actors' : 'select an actor to enter the world',
                'guest mode: one claim at a time',
            ];
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            ui_state.actor_claim.error = message;
            ui_state.actor_claim.status_lines = status_lines ?? ['claim list failed', message];
            throw err;
        } finally {
            ui_state.actor_claim.is_loading = false;
            apply_runtime_module_visibility('actor_claim_module');
        }
    }

    async function claim_actor(actor_ref: string): Promise<void> {
        await ensure_multiplayer_session_bootstrap();
        ui_state.actor_claim.is_submitting = true;
        ui_state.actor_claim.error = null;
        try {
            const res = await fetch('http://localhost:8787/api/actors/claim', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    slot: APP_CONFIG.selected_data_slot,
                    session_token: get_session_token(),
                    actor_ref,
                }),
            });
            const data = await res.json().catch(() => null) as any;
            if (!res.ok || !data?.ok || typeof data?.controlled_actor_ref !== 'string') {
                throw new Error(String(data?.error ?? `actor_claim_failed:${res.status}`));
            }
            const controlled_actor_ref = String(data.controlled_actor_ref).trim();
            const actor_id = get_character_id_from_ref(controlled_actor_ref);
            if (!actor_id) throw new Error('actor_claim_missing_actor_id');
            (APP_CONFIG as any).input_actor_id = actor_id;
            persist_controlled_actor_ref(controlled_actor_ref);
            set_current_actor_ref(controlled_actor_ref);
            ui_state.actor_claim.current_actor_ref = controlled_actor_ref;
            ui_state.actor_claim.selected_actor_ref = controlled_actor_ref;
            ui_state.character.display_name = typeof data?.controlled_actor_name === 'string' && data.controlled_actor_name.trim().length > 0
                ? data.controlled_actor_name.trim()
                : ui_state.character.display_name;
            ui_state.actor_claim.status_lines = [`claimed ${ui_state.character.display_name || actor_id}`, 'loading world state...'];
            ui_state.actor_claim.is_visible = false;
            ui_state.actor_claim.is_blocking = false;
            ui_state.actor_claim.game_ready = false;
            await load_claimed_actor_runtime(actor_id, controlled_actor_ref, 'actor_claim_sync');
            flash_status([`Claimed ${ui_state.character.display_name || actor_id}`], 1400);
            apply_runtime_module_visibility();
            void poll_window_feeds();
        } finally {
            ui_state.actor_claim.is_submitting = false;
            apply_runtime_module_visibility('actor_claim_module');
        }
    }

    async function release_claimed_actor(): Promise<void> {
        await ensure_multiplayer_session_bootstrap();
        ui_state.actor_claim.is_submitting = true;
        try {
            const res = await fetch('http://localhost:8787/api/actors/release', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    slot: APP_CONFIG.selected_data_slot,
                    session_token: get_session_token(),
                }),
            });
            const data = await res.json().catch(() => null) as any;
            if (!res.ok || !data?.ok) {
                throw new Error(String(data?.error ?? `actor_release_failed:${res.status}`));
            }
            clear_controlled_actor_runtime_state();
            await update_current_place(null, { source: 'actor_release' });
        } finally {
            ui_state.actor_claim.is_submitting = false;
        }
    }

    async function open_actor_claim_module(open_reason: typeof ui_state.actor_claim.open_reason, status_lines?: string[]): Promise<void> {
        ui_state.actor_claim.is_visible = true;
        ui_state.actor_claim.is_blocking = !has_active_actor_claim();
        ui_state.actor_claim.open_reason = open_reason;
        ui_state.actor_claim.status_lines = status_lines ?? ui_state.actor_claim.status_lines;
        apply_runtime_module_visibility();
        await refresh_actor_claim_state(status_lines);
    }

    function close_actor_claim_module(): void {
        if (ui_state.actor_claim.is_blocking) return;
        ui_state.actor_claim.is_visible = false;
        ui_state.actor_claim.open_reason = null;
        apply_runtime_module_visibility();
    }

    function select_actor_claim_entry(actor_ref: string): void {
        ui_state.actor_claim.selected_actor_ref = actor_ref;
    }

    async function claim_selected_actor(): Promise<void> {
        const actor_ref = String(ui_state.actor_claim.selected_actor_ref ?? '').trim();
        if (!actor_ref) {
            ui_state.actor_claim.status_lines = ['select an actor to claim'];
            return;
        }
        if (ui_state.actor_claim.current_actor_ref && ui_state.actor_claim.current_actor_ref !== actor_ref) {
            ui_state.actor_claim.status_lines = ['release your current actor first', 'one actor claimed at a time'];
            return;
        }
        try {
            await claim_actor(actor_ref);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            ui_state.actor_claim.error = message;
            ui_state.actor_claim.is_visible = true;
            ui_state.actor_claim.is_blocking = !has_active_actor_claim();
            ui_state.actor_claim.status_lines = ['claim failed', message];
            apply_runtime_module_visibility();
        }
    }

    async function release_actor_claim_and_reopen(): Promise<void> {
        try {
            await release_claimed_actor();
            ui_state.actor_claim.is_visible = true;
            ui_state.actor_claim.is_blocking = true;
            await refresh_actor_claim_state(['actor released', 'select another actor']);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            ui_state.actor_claim.error = message;
            ui_state.actor_claim.is_visible = true;
            ui_state.actor_claim.is_blocking = !has_active_actor_claim();
            ui_state.actor_claim.status_lines = ['release failed', message];
            apply_runtime_module_visibility();
            throw err;
        }
    }

    async function logout_to_actor_claim(): Promise<void> {
        await release_actor_claim_and_reopen();
        set_module_visible('debug_commander_module', false);
        flash_status(['Logged out', 'select an actor to continue'], 1400);
    }

    function set_debug_commander_selected_action(action_id: string): void {
        ui_state.debug_commander.selected_action_id = action_id;
    }

    function build_debug_commander_actions(): DebugCommanderAction[] {
        return [
            {
                id: 'place_view_swing_left',
                label: 'SWING LEFT',
                description: 'swing camera left 90 degrees',
                rgb: get_color_by_name('vivid_cyan').rgb,
                on_trigger: () => {
                    swing_place_camera('left');
                    flash_status([`View: ${ui_state.place.principal_view} r${ui_state.place.view_roll_quarter_turn}`], 900);
                },
            },
            {
                id: 'place_view_swing_right',
                label: 'SWING RIGHT',
                description: 'swing camera right 90 degrees',
                rgb: get_color_by_name('vivid_cyan').rgb,
                on_trigger: () => {
                    swing_place_camera('right');
                    flash_status([`View: ${ui_state.place.principal_view} r${ui_state.place.view_roll_quarter_turn}`], 900);
                },
            },
            {
                id: 'place_view_swing_up',
                label: 'SWING UP',
                description: 'swing camera up 90 degrees',
                rgb: get_color_by_name('vivid_cyan').rgb,
                on_trigger: () => {
                    swing_place_camera('up');
                    flash_status([`View: ${ui_state.place.principal_view} r${ui_state.place.view_roll_quarter_turn}`], 900);
                },
            },
            {
                id: 'place_view_swing_down',
                label: 'SWING DOWN',
                description: 'swing camera down 90 degrees',
                rgb: get_color_by_name('vivid_cyan').rgb,
                on_trigger: () => {
                    swing_place_camera('down');
                    flash_status([`View: ${ui_state.place.principal_view} r${ui_state.place.view_roll_quarter_turn}`], 900);
                },
            },
            {
                id: 'place_view_roll_left',
                label: 'ROLL LEFT',
                description: 'roll camera left 90 degrees',
                rgb: get_color_by_name('vivid_blue').rgb,
                on_trigger: () => {
                    roll_place_camera('left');
                    flash_status([`View: ${ui_state.place.principal_view} r${ui_state.place.view_roll_quarter_turn}`], 900);
                },
            },
            {
                id: 'place_view_roll_right',
                label: 'ROLL RIGHT',
                description: 'roll camera right 90 degrees',
                rgb: get_color_by_name('vivid_blue').rgb,
                on_trigger: () => {
                    roll_place_camera('right');
                    flash_status([`View: ${ui_state.place.principal_view} r${ui_state.place.view_roll_quarter_turn}`], 900);
                },
            },
            {
                id: 'place_focus_layer_opacity_toggle',
                label: ui_state.place.use_focus_layer_opacity ? 'FOCUS OPACITY: ON' : 'FOCUS OPACITY: OFF',
                description: 'toggle opacity fade on unfocused place layers',
                rgb: get_color_by_name('light_orange').rgb,
                on_trigger: () => {
                    const enabled = toggle_place_focus_layer_opacity();
                    flash_status([`Focus opacity: ${enabled ? 'on' : 'off'}`], 900);
                },
            },
            {
                id: 'place_view_top',
                label: ui_state.place.principal_view === 'top' ? 'VIEW TOP*' : 'VIEW TOP',
                description: 'set place view top',
                rgb: get_color_by_name('vivid_cyan').rgb,
                on_trigger: () => {
                    set_place_principal_view('top');
                    set_place_view_roll_quarter_turn(0);
                    flash_status(['Place view: top'], 900);
                },
            },
            {
                id: 'place_view_bottom',
                label: ui_state.place.principal_view === 'bottom' ? 'VIEW BOTTOM*' : 'VIEW BOTTOM',
                description: 'set place view bottom',
                rgb: get_color_by_name('vivid_cyan').rgb,
                on_trigger: () => {
                    set_place_principal_view('bottom');
                    set_place_view_roll_quarter_turn(0);
                    flash_status(['Place view: bottom'], 900);
                },
            },
            {
                id: 'place_view_north',
                label: ui_state.place.principal_view === 'north' ? 'VIEW NORTH*' : 'VIEW NORTH',
                description: 'set place view north',
                rgb: get_color_by_name('vivid_blue').rgb,
                on_trigger: () => {
                    set_place_principal_view('north');
                    set_place_view_roll_quarter_turn(0);
                    flash_status(['Place view: north'], 900);
                },
            },
            {
                id: 'place_view_east',
                label: ui_state.place.principal_view === 'east' ? 'VIEW EAST*' : 'VIEW EAST',
                description: 'set place view east',
                rgb: get_color_by_name('vivid_blue').rgb,
                on_trigger: () => {
                    set_place_principal_view('east');
                    set_place_view_roll_quarter_turn(0);
                    flash_status(['Place view: east'], 900);
                },
            },
            {
                id: 'place_view_south',
                label: ui_state.place.principal_view === 'south' ? 'VIEW SOUTH*' : 'VIEW SOUTH',
                description: 'set place view south',
                rgb: get_color_by_name('vivid_blue').rgb,
                on_trigger: () => {
                    set_place_principal_view('south');
                    set_place_view_roll_quarter_turn(0);
                    flash_status(['Place view: south'], 900);
                },
            },
            {
                id: 'place_view_west',
                label: ui_state.place.principal_view === 'west' ? 'VIEW WEST*' : 'VIEW WEST',
                description: 'set place view west',
                rgb: get_color_by_name('vivid_blue').rgb,
                on_trigger: () => {
                    set_place_principal_view('west');
                    set_place_view_roll_quarter_turn(0);
                    flash_status(['Place view: west'], 900);
                },
            },
            {
                id: 'debug_add_fire',
                label: 'FIRE',
                description: 'add FIRE! tag to controlled actor',
                rgb: get_color_by_name('vivid_red').rgb,
                on_trigger: async () => {
                    const response = await fetch('http://localhost:8787/api/tag/add', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            entity_ref: get_input_actor_ref() || 'actor.player',
                            tag_name: 'FIRE!',
                            mag: 5,
                            dim_mag: { fire_intensity_mag: 5, disperse_time_mag: 0 }
                        })
                    });
                    flash_status([response.ok ? 'FIRE! tag added to actor' : 'Failed to add FIRE! tag'], 1500);
                },
            },
            {
                id: 'debug_show_inventory',
                label: 'INV',
                description: 'dump actor inventory to status',
                rgb: get_color_by_name('pale_green').rgb,
                on_trigger: async () => {
                    const actor_id = get_controlled_actor_id();
                    const items_res = await fetch(`http://localhost:8787/api/actor/items?actor_id=${actor_id}`);
                    const items_data = await items_res.json();
                    if (!items_data.ok) {
                        flash_status(['Failed to load inventory'], 1500);
                        return;
                    }
                    if (items_data.items && items_data.items.length > 0) {
                        const items = items_data.items.map((entry: any) => `${entry.item.qty}x ${entry.item.name} (${entry.item.weight}kg) @ ${entry.slot_name}.${entry.slot_type}`);
                        flash_status(['Inventory:', ...items.slice(0, 6)], 3000);
                    } else {
                        flash_status(['Inventory: (empty)'], 1500);
                    }
                },
            },
            {
                id: 'ui_toggle_character',
                label: module_registry.is_visible('character_module') ? 'CHAR HIDE' : 'CHAR SHOW',
                description: 'toggle character module',
                rgb: get_color_by_name('pale_yellow').rgb,
                on_trigger: () => {
                    const next = !module_registry.is_visible('character_module');
                    set_module_visible('character_module', next);
                    flash_status([next ? 'Character shown' : 'Character hidden'], 900);
                },
            },
            {
                id: 'ui_toggle_debug',
                label: module_registry.is_visible('debug') ? 'DEBUG HIDE' : 'DEBUG SHOW',
                description: 'toggle debug reader window',
                rgb: get_color_by_name('pale_yellow').rgb,
                on_trigger: () => {
                    const next = !module_registry.is_visible('debug');
                    set_module_visible('debug', next);
                    flash_status([next ? 'Debug shown' : 'Debug hidden'], 900);
                },
            },
            {
                id: 'cost_free',
                label: ui_state.controls.override_cost === 'FREE' ? 'COST FREE*' : 'COST FREE',
                description: 'override action cost to FREE',
                rgb: get_color_by_name('pale_orange').rgb,
                on_trigger: () => {
                    ui_state.controls.override_cost = 'FREE';
                    flash_status(['action cost: FREE'], 800);
                },
            },
            {
                id: 'cost_part',
                label: ui_state.controls.override_cost === 'PARTIAL' ? 'COST PART*' : 'COST PART',
                description: 'override action cost to PARTIAL',
                rgb: get_color_by_name('pale_orange').rgb,
                on_trigger: () => {
                    ui_state.controls.override_cost = 'PARTIAL';
                    flash_status(['action cost: PARTIAL'], 800);
                },
            },
            {
                id: 'cost_full',
                label: ui_state.controls.override_cost === 'FULL' ? 'COST FULL*' : 'COST FULL',
                description: 'override action cost to FULL',
                rgb: get_color_by_name('pale_orange').rgb,
                on_trigger: () => {
                    ui_state.controls.override_cost = 'FULL';
                    flash_status(['action cost: FULL'], 800);
                },
            },
            {
                id: 'cost_ext',
                label: ui_state.controls.override_cost === 'EXTENDED' ? 'COST EXT*' : 'COST EXT',
                description: 'override action cost to EXTENDED',
                rgb: get_color_by_name('pale_orange').rgb,
                on_trigger: () => {
                    ui_state.controls.override_cost = 'EXTENDED';
                    flash_status(['action cost: EXTENDED'], 800);
                },
            },
            {
                id: 'debug_open_nearest_npc',
                label: 'NPCINV',
                description: 'open nearest npc inventory module',
                rgb: get_color_by_name('vivid_cyan').rgb,
                on_trigger: async () => {
                    const place = get_current_place();
                    if (!place) {
                        flash_status(['No place loaded'], 1500);
                        return;
                    }
                    const actor_ref = get_input_actor_ref();
                    const actor = place.contents.actors_present.find((a: any) => a.actor_ref === actor_ref);
                    if (!actor) {
                        flash_status(['Actor not found in place'], 1500);
                        return;
                    }
                    const npcs = place.contents.npcs_present;
                    if (!npcs || npcs.length === 0) {
                        flash_status(['No NPCs in this place'], 1500);
                        return;
                    }
                    let nearest_npc: any = null;
                    let min_distance = Infinity;
                    for (const npc of npcs) {
                        const dx = npc.tile_position.x - actor.tile_position.x;
                        const dy = npc.tile_position.y - actor.tile_position.y;
                        const distance = Math.sqrt(dx * dx + dy * dy);
                        if (distance < min_distance) {
                            min_distance = distance;
                            nearest_npc = npc;
                        }
                    }
                    if (!nearest_npc) {
                        flash_status(['Could not find nearest NPC'], 1500);
                        return;
                    }
                    const npc_name = get_entity_display_name(nearest_npc.npc_ref);
                    flash_status([`Opening ${npc_name}'s inventory (${min_distance.toFixed(0)} tiles)`], 1500);
                    await open_npc_character_module(nearest_npc.npc_ref, npc_name);
                },
            },
            {
                id: 'debug_dump_body_slots',
                label: 'SLOTS',
                description: 'dump body slot state to console',
                rgb: get_color_by_name('vivid_yellow').rgb,
                on_trigger: async () => {
                    const actor_id = get_controlled_actor_id();
                    const actor_res = await fetch(`http://localhost:8787/api/actor?id=${actor_id}`);
                    if (!actor_res.ok) {
                        flash_status(['Failed to fetch actor'], 1500);
                        return;
                    }
                    const actor_data = await actor_res.json();
                    if (!actor_data.ok) {
                        flash_status(['Actor data error'], 1500);
                        return;
                    }
                    const body_slots = actor_data.body_slots || {};
                    debug_log('[DEBUG COMMANDER] Raw body_slots from API:');
                    for (const [slot_name, slot_data] of Object.entries(body_slots)) {
                        const slot = slot_data as any;
                        debug_log(`[DEBUG COMMANDER] ${slot_name}: tool=${slot.tool || 'null'} armor=${slot.armor || 'null'} garb=[${slot.garb?.join(', ') || 'empty'}]`);
                    }
                    ui_state.character.equipped_items.forEach((item, slot) => {
                        debug_log(`[DEBUG COMMANDER] equipped ${slot}: ${item.definition.name} (${item.instance.id})`);
                    });
                    flash_status(['Body slots dumped to console'], 2000);
                },
            },
            {
                id: 'debug_place_painter',
                label: ui_state.place_painter.active ? 'PAINT OFF' : 'PAINT ON',
                description: 'toggle place painter mode',
                rgb: ui_state.place_painter.active ? get_color_by_name('vivid_green').rgb : WHITE,
                on_trigger: async () => {
                    const place = get_current_place();
                    if (!place?.id) {
                        flash_status(['No place loaded'], 1200);
                        return;
                    }
                    const ok = await toggle_place_painter();
                    if (!ok) {
                        flash_status(['Place painter toggle failed'], 1500);
                        return;
                    }
                    flash_status([
                        ui_state.place_painter.active ? 'Place painter ON' : 'Place painter off',
                        `pause:${ui_state.place.pause_state.paused ? 'paused' : 'running'}`,
                    ], 1500);
                },
            },
            {
                id: 'debug_pause_place',
                label: debug_pause_controller.is_active() ? 'PAUSE OFF' : 'PAUSE ON',
                description: 'pause or resume current place',
                rgb: debug_pause_controller.is_active() ? get_color_by_name('vivid_red').rgb : WHITE,
                on_trigger: async () => {
                    const place = get_current_place();
                    if (!place?.id) {
                        flash_status(['No place loaded'], 1200);
                        return;
                    }
                    const result = await toggle_current_place_pause_debug();
                    if (!result.ok) {
                        if (result.mode === 'blocked' && result.sources.length > 0) {
                            flash_status(['Pause held by other source', `sources: ${result.sources.join(',')}`], 1800);
                            return;
                        }
                        flash_status(['Pause toggle failed'], 1500);
                        return;
                    }
                    flash_status([
                        result.mode === 'paused' ? 'Place paused' : 'Place resumed',
                        ui_state.place.pause_state.pause_sources.length > 0 ? `sources: ${ui_state.place.pause_state.pause_sources.join(',')}` : 'sources: none',
                    ], 1500);
                },
            },
            {
                id: 'debug_start_timed_event',
                label: 'TEVT',
                description: 'start timed event in current place',
                rgb: get_color_by_name('pale_orange').rgb,
                on_trigger: async () => {
                    const place = get_current_place();
                    if (!place?.id) {
                        flash_status(['No place loaded'], 1200);
                        return;
                    }
                    const result = await start_debug_timed_event(place.id, 'combat');
                    if (!result.ok) {
                        flash_status([`Timed event failed: ${result.error ?? 'unknown'}`], 1800);
                        return;
                    }
                    flash_status(['Timed event queued', `participants: ${result.participants?.length ?? 0}`], 1500);
                    void refresh_timed_event_debug_state();
                },
            },
            {
                id: 'debug_body',
                label: 'BOD',
                description: 'toggle debug body model',
                rgb: get_color_by_name('vivid_yellow').rgb,
                on_trigger: async () => {
                    const place = get_current_place();
                    if (!place) return;
                    const actor_id = get_controlled_actor_id();
                    const actor_ref = `actor.${actor_id}`;
                    const actor = place.contents.actors_present.find((a: any) => a.actor_ref === actor_ref) as any;
                    if (!actor) return;
                    const cur = String(actor.body_model_id ?? '');
                    const next = cur === 'test.self_exclusion_y2' ? 'character.biped_2z' : 'test.self_exclusion_y2';
                    const base_url = APP_CONFIG.place_endpoint.replace('/api/place', '');
                    await fetch(`${base_url}/api/actor/debug/body_model`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ slot: APP_CONFIG.selected_data_slot, actor_id, body_model_id: next }),
                    });
                    flash_status([`Body model: ${next}`], 1500);
                    await update_current_place(place.id, { source: 'debug_body_model_toggle' });
                },
            },
            {
                id: 'debug_move_refresh',
                label: 'MOVE',
                description: 'force movement refresh helper',
                rgb: get_color_by_name('pale_orange').rgb,
                on_trigger: async () => {
                    const result = await debug_move_refresh();
                    if (!result.ok) {
                        flash_status([`MOVE failed: ${result.error ?? 'unknown'}`], 1800);
                        return;
                    }
                    flash_status(['MOVE refresh used', `${result.actor_ref ?? '(active actor)'}`], 1500);
                    void refresh_timed_event_debug_state();
                },
            },
            {
                id: 'debug_end_timed_event',
                label: 'END',
                description: 'force-end current timed event',
                rgb: get_color_by_name('pale_orange').rgb,
                on_trigger: async () => {
                    const result = await debug_end_timed_event();
                    if (!result.ok) {
                        flash_status([`END failed: ${result.error ?? 'unknown'}`], 1800);
                        return;
                    }
                    flash_status(['Timed event ended'], 1500);
                    void refresh_timed_event_debug_state();
                },
            },
            {
                id: 'debug_toggle_overlays',
                label: DEBUG_VISION.enabled ? 'OVR OFF' : 'OVR ON',
                description: 'toggle debug overlays bundle',
                rgb: get_color_by_name('pale_yellow').rgb,
                on_trigger: () => {
                    const next = !DEBUG_VISION.enabled;
                    set_ui_debug_enabled(next);
                    set_debug_bundle_enabled(next);
                    flash_status([next ? 'Debug overlays ON' : 'Debug overlays off'], 900);
                },
            },
            {
                id: 'logout_actor',
                label: 'LOGOUT',
                description: 'release actor and return to claim screen',
                rgb: get_color_by_name('pumpkin').rgb,
                on_trigger: async () => {
                    await logout_to_actor_claim();
                },
            },
        ];
    }

    function trigger_debug_commander_action(action_id: string): void {
        const action = build_debug_commander_actions().find((entry) => entry.id === action_id);
        if (!action || action.disabled) return;
        ui_state.debug_commander.status_lines = ['running...', action.label];
        void Promise.resolve(action.on_trigger())
            .then(() => {
                ui_state.debug_commander.status_lines = [action.label, action.description ?? 'command complete'];
            })
            .catch((err) => {
                const message = err instanceof Error ? err.message : String(err);
                ui_state.debug_commander.status_lines = ['command failed', message];
                flash_status([`Debug command failed`, message], 1800);
            });
    }

    async function load_claimed_actor_runtime(actor_id: string, actor_ref: string, source: string): Promise<void> {
        ui_state.actor_claim.game_ready = false;
        apply_runtime_module_visibility();
        await refresh_character_data(true);
        let resolved_place_id: string | null = null;
        try {
            const url = `${APP_CONFIG.action_targets_endpoint}?slot=${APP_CONFIG.selected_data_slot}&actor_id=${encodeURIComponent(actor_id)}`;
            const res = await fetch(url);
            const data = await res.json().catch(() => null) as {
                ok?: boolean;
                region?: string | null;
                place_id?: string | null;
                targets?: Array<{ ref: string; label: string; type: string }>;
            } | null;
            if (res.ok && data?.ok) {
                ui_state.controls.targets = Array.isArray(data.targets) ? data.targets : [];
                ui_state.controls.region_label = typeof data.region === 'string' ? data.region : null;
                ui_state.controls.targets_ready = true;
                resolved_place_id = typeof data.place_id === 'string' && data.place_id.trim().length > 0 ? data.place_id.trim() : null;
            }
        } catch (err) {
            debug_warn('[ActorClaim]', 'Failed to load claimed actor runtime targets', err);
        }
        if (!resolved_place_id) {
            resolved_place_id = await resolve_private_actor_place_id(actor_ref);
        }
        await update_current_place(resolved_place_id ?? ui_state.place.actor_current_place_id ?? ui_state.place.current_place_id, { source });
        const place = get_current_place();
        if (place?.id) ui_state.place.actor_current_place_id = place.id;
        set_current_actor_ref(actor_ref);
        ui_state.actor_claim.game_ready = !!get_current_place();
        apply_runtime_module_visibility();
    }

    function close_option_picker(): void {
        ui_state.option_picker.is_visible = false;
        ui_state.option_picker.target_kind = null;
        ui_state.option_picker.target_field = null;
        ui_state.option_picker.options = [];
        set_module_visible('option_picker_module', false);
    }

    async function open_character_editor_field_picker(field_key: string): Promise<void> {
        const character_ref = ui_state.character_editor.character_ref;
        if (!character_ref) return;
        if (field_key === 'kind') {
            await open_option_picker({
                title: 'PICK KIND',
                target_kind: 'character_editor',
                target_field: 'kind',
                selected_value: ui_state.character_editor.draft.kind,
                fetch_url: `http://localhost:8787/api/character/editor/options?field=kind&ref=${encodeURIComponent(character_ref)}&slot=${APP_CONFIG.selected_data_slot}`,
            });
            return;
        }
        if (field_key === 'sex') {
            await open_option_picker({
                title: 'PICK SEX',
                target_kind: 'character_editor',
                target_field: 'sex',
                selected_value: ui_state.character_editor.draft.sex,
                fetch_url: `http://localhost:8787/api/character/editor/options?field=sex&ref=${encodeURIComponent(character_ref)}&slot=${APP_CONFIG.selected_data_slot}`,
            });
        }
    }

    async function open_tag_picker_name_picker(): Promise<void> {
        const entity_ref = ui_state.tag_picker.entity_ref;
        if (!entity_ref) return;
        const scope = get_tag_scope_for_entity_ref(entity_ref);
        await open_option_picker({
            title: 'PICK TAG',
            target_kind: 'tag_picker',
            target_field: 'name',
            selected_value: ui_state.tag_picker.draft?.name ?? null,
            fetch_url: `http://localhost:8787/api/tag/options?scope=${encodeURIComponent(scope ?? 'CHARACTER')}&ref=${encodeURIComponent(entity_ref)}&slot=${APP_CONFIG.selected_data_slot}`,
        });
    }

    function apply_option_picker_selection(value: string): void {
        if (ui_state.option_picker.target_kind === 'character_editor' && ui_state.option_picker.target_field) {
            const key = ui_state.option_picker.target_field;
            if (key in ui_state.character_editor.draft) {
                (ui_state.character_editor.draft as any)[key] = value;
                ui_state.character_editor.dirty = true;
                ui_state.character_editor.status_lines = [
                    get_character_editor_subject_label(ui_state.character_editor.character_ref),
                    `picked ${key}: ${value}`,
                ];
            }
        }
        if (ui_state.option_picker.target_kind === 'tag_picker' && ui_state.option_picker.target_field === 'name' && ui_state.tag_picker.draft) {
            ui_state.tag_picker.draft.name = String(value ?? '').trim().toUpperCase();
            ui_state.tag_picker.original_name = ui_state.tag_picker.original_name || ui_state.tag_picker.draft.name;
            ui_state.tag_picker.status_lines = [
                get_entity_editor_subject_label(ui_state.tag_picker.entity_ref),
                `picked tag: ${ui_state.tag_picker.draft.name}`,
            ];
            void (async () => {
                await sync_tag_picker_definition(ui_state.tag_picker.draft?.name ?? '', { preserve_status: true });
                await apply_tag_picker_draft();
            })();
        }
        if (ui_state.option_picker.target_kind === 'character_creation' && ui_state.option_picker.target_field) {
            const key = ui_state.option_picker.target_field;
            update_character_creation_field(key, value);
            if (key === 'kind') {
                void refresh_character_creation_bootstrap(value);
            }
            if (key === 'sex') {
                ui_state.character_creation.status_lines = [`sex: ${value}`, 'create to add actor to claim list'];
            }
        }
        ui_state.option_picker.selected_value = value;
        close_option_picker();
    }

    // Load character data (body slots, equipped items, weight) - Phase 5 Inline System
    async function refresh_character_data(force: boolean = false): Promise<void> {
        if (refresh_character_data_in_flight) return;
        const now = Date.now();
        if (!force && is_movement_activity_high() && (now - last_character_refresh_ms) < 15000) {
            return;
        }
        refresh_character_data_in_flight = true;
        try {
            const actor_id = get_controlled_actor_id();
            if (!actor_id) return;
            const actor_data = await load_character_module_data(`actor.${actor_id}`);
            const actor = actor_data.character;
            ui_state.character.display_name = String(actor?.name ?? actor_id);
            ui_state.character.render_meta.kind_id = typeof (actor as any)?.kind === 'string'
                ? String((actor as any).kind)
                : (typeof (actor as any)?.kind_id === 'string' ? String((actor as any).kind_id) : null);
            ui_state.character.render_meta.body_model_id = typeof (actor as any)?.body_model_id === 'string'
                ? String((actor as any).body_model_id)
                : null;
            ui_state.character.render_meta.entity_render = (actor as any)?.entity_render ?? null;
            ui_state.character.render_meta.tags = Array.isArray((actor as any)?.tags) ? (actor as any).tags : [];
            set_character_tags(`actor.${actor_id}`, (actor as any)?.tags);

            // View centering is derived from the loaded place (not actor elevation).

            // Phase 5: Inline body_slots are authoritative
            const body_slots = actor_data.body_slots;
            ui_state.character.body_slots = body_slots;

            // Rebuild equipped_items directly from body_slots inline objects
            ui_state.character.equipped_items = actor_data.equipped_items;
            debug_log(`[LOAD_EQUIPPED] === REBUILD FROM INLINE BODY_SLOTS ===`);
            ui_state.character.weight.current = actor_data.weight_data.current;
            ui_state.character.weight.max = actor_data.weight_data.max;

            debug_log(`[LOAD_EQUIPPED] Equipped rebuilt: ${ui_state.character.equipped_items.size} items, weight=${actor_data.weight_data.current}`);
            debug_log(`[LOAD_EQUIPPED] === END REBUILD ===`);
            
            // Helper to find item by ID across all containers (including nested) - DEPRECATED
            function find_item_in_containers(containers: any[], item_id: string): { instance: ItemInstance; definition: ItemDefinition } | null {
                debug_log(`[LOAD_EQUIPPED] Searching for item ${item_id}...`);
                for (const container of containers) {
                    // Check direct contents
                    for (const content of container.contents || []) {
                        if (content.instance?.id === item_id) {
                            debug_log(`[LOAD_EQUIPPED] FOUND ${item_id} in container ${container.id}`);
                            return { instance: content.instance, definition: content.definition };
                        }
                        // Check nested containers (sacks, bags)
                        if (content.instance?.container_data?.contents) {
                            for (const nested of content.instance.container_data.contents) {
                                if (nested.instance?.id === item_id) {
                                    debug_log(`[LOAD_EQUIPPED] FOUND ${item_id} in nested container ${content.instance.id}`);
                                    return { instance: nested.instance, definition: nested.definition };
                                }
                            }
                        }
                    }
                }
                debug_log(`[LOAD_EQUIPPED] Item ${item_id} NOT FOUND in any container`);
                return null;
            }
            
            debug_log(`[Character] Total equipped items loaded: ${ui_state.character.equipped_items.size}`);
            debug_log(`[LOAD_EQUIPPED] === END LOADING INLINE ITEMS ===`);
            last_character_refresh_ms = Date.now();
            if (ui_state.container.is_visible) {
                ui_state.container.owner_view = actor_data.owner_view ?? ui_state.container.owner_view;
                if (!actor_data.owner_view) void refresh_actor_owner_inventory_view();
            }
            
        } catch (err) {
            console.error('[Character] Error refreshing character data:', err);
        } finally {
            refresh_character_data_in_flight = false;
        }
    }

    async function load_actor_owner_inventory_view(actor_id: string): Promise<OwnerInventoryView | null> {
        if (!actor_id) return null;
        try {
            const resp = await fetch(`http://localhost:8787/api/actor/private_state?actor_ref=${encodeURIComponent(`actor.${actor_id}`)}&slot=${APP_CONFIG.selected_data_slot}&session_token=${encodeURIComponent(get_session_token())}`);
            const data = await resp.json();
            if (!resp.ok || !data?.ok || !data?.view) {
                debug_log(`[InventoryOwnerView] Failed to load actor inventory view for ${actor_id}: ${JSON.stringify(data)}`);
                return null;
            }
            return data.view as OwnerInventoryView;
        } catch (err) {
            console.error('[InventoryOwnerView] Error loading actor inventory view:', err);
            return null;
        }
    }

    async function resolve_private_actor_place_id(actor_ref: string): Promise<string | null> {
        const normalized_actor_ref = String(actor_ref ?? '').trim();
        if (!normalized_actor_ref.startsWith('actor.')) return null;
        try {
            const resp = await fetch(`http://localhost:8787/api/actor/private_state?actor_ref=${encodeURIComponent(normalized_actor_ref)}&slot=${APP_CONFIG.selected_data_slot}&session_token=${encodeURIComponent(get_session_token())}`);
            const data = await resp.json().catch(() => null) as any;
            if (!resp.ok || !data?.ok || !data?.actor) return null;
            const place_id = String(data.actor?.location?.place_id ?? '').trim();
            return place_id || null;
        } catch {
            return null;
        }
    }

    async function load_actor_item_owner_inventory_view(actor_id: string, item_id: string): Promise<OwnerInventoryView | null> {
        if (!actor_id || !item_id) return null;
        const base_url = APP_CONFIG.place_endpoint.replace('/api/place', '');
        try {
            const resp = await fetch(`${base_url}/api/inventory/actor_item_view?actor_id=${encodeURIComponent(actor_id)}&item_id=${encodeURIComponent(item_id)}`);
            const data = await resp.json();
            if (!resp.ok || !data?.ok || !data?.view) {
                debug_log(`[InventoryOwnerView] Failed to load actor item inventory view for ${actor_id}.${item_id}: ${JSON.stringify(data)}`);
                return null;
            }
            return data.view as OwnerInventoryView;
        } catch (err) {
            console.error('[InventoryOwnerView] Error loading actor item inventory view:', err);
            return null;
        }
    }

    async function load_body_slot_owner_inventory_view(actor_id: string, path: string): Promise<OwnerInventoryView | null> {
        if (!actor_id || !path) return null;
        const base_url = APP_CONFIG.place_endpoint.replace('/api/place', '');
        try {
            const resp = await fetch(`${base_url}/api/inventory/body_slot_view?actor_id=${encodeURIComponent(actor_id)}&path=${encodeURIComponent(path)}`);
            const data = await resp.json();
            if (!resp.ok || !data?.ok || !data?.view) return null;
            return data.view as OwnerInventoryView;
        } catch {
            return null;
        }
    }

    async function load_tile_owner_inventory_view(place_id: string, x: number, y: number, z: number): Promise<{ view: OwnerInventoryView; redirect?: any } | null> {
        const base_url = APP_CONFIG.place_endpoint.replace('/api/place', '');
        try {
            const resp = await fetch(`${base_url}/api/inventory/tile_view?place_id=${encodeURIComponent(place_id)}&x=${x}&y=${y}&z=${z}`);
            const data = await resp.json();
            if (!resp.ok || !data?.ok || !data?.view) return null;
            return { view: data.view as OwnerInventoryView, redirect: data.redirect ?? undefined };
        } catch {
            return null;
        }
    }

    async function load_place_item_owner_inventory_view(place_id: string, item_id: string): Promise<OwnerInventoryView | null> {
        const base_url = APP_CONFIG.place_endpoint.replace('/api/place', '');
        try {
            const resp = await fetch(`${base_url}/api/inventory/place_item_view?place_id=${encodeURIComponent(place_id)}&item_id=${encodeURIComponent(item_id)}`);
            const data = await resp.json();
            if (!resp.ok || !data?.ok || !data?.view) return null;
            return data.view as OwnerInventoryView;
        } catch {
            return null;
        }
    }

    async function load_pile_owner_inventory_view(place_id: string, position_key: string): Promise<OwnerInventoryView | null> {
        const base_url = APP_CONFIG.place_endpoint.replace('/api/place', '');
        try {
            const resp = await fetch(`${base_url}/api/inventory/pile_view?place_id=${encodeURIComponent(place_id)}&position_key=${encodeURIComponent(position_key)}`);
            const data = await resp.json();
            if (!resp.ok || !data?.ok || !data?.view) return null;
            return data.view as OwnerInventoryView;
        } catch {
            return null;
        }
    }

    async function refresh_actor_owner_inventory_view(): Promise<void> {
        const actor_id = get_controlled_actor_id();
        ui_state.container.owner_view = actor_id ? await load_actor_owner_inventory_view(actor_id) : null;
    }

    /**
     * Get pickup destination (default container if set, else first equipped container, else dominant hand tool).
     * Returns a body_slots.* path or null.
     */
    async function get_default_pickup_target_container_id(): Promise<string | null> {
        const body_slots = ui_state.character.body_slots as any;

        function get_item_at_body_slots_path(container_id: string): any | null {
            const parts = container_id.split('.');
            if (parts[0] !== 'body_slots') return null;
            const slot_name = parts[1];
            const slot_type = parts[2];
            const idx = parts[3] !== undefined ? Number(parts[3]) : null;
            if (!slot_name || !slot_type) return null;
            const slot = body_slots && typeof body_slots === 'object' ? body_slots[slot_name] : null;
            if (!slot) return null;
            if (slot_type === 'armor') return slot.armor ?? null;
            if (slot_type === 'tool') return slot.tool ?? null;
            if (slot_type === 'garb') {
                if (!Array.isArray(slot.garb) || idx === null || Number.isNaN(idx)) return null;
                return slot.garb[idx] ?? null;
            }
            return null;
        }

        // 1) User-selected default container
        if (ui_state.character.default_container_id) {
            const it = get_item_at_body_slots_path(ui_state.character.default_container_id);
            if (has_tag(it?.tags, 'CONTAINER')) {
                return ui_state.character.default_container_id;
            }
            // Stale default (item moved/removed)
            ui_state.character.default_container_id = null;
        }

        // 2) First equipped container (scan body slots)
        const slot_priority = ['leg_left', 'leg_right', 'torso', 'head', 'hand_left', 'hand_right'];
        for (const slot_name of slot_priority) {
            const slot = body_slots?.[slot_name];
            if (!slot) continue;

            // armor/tool containers
            for (const [stype, it] of [['armor', slot.armor], ['tool', slot.tool]] as const) {
                if (has_tag(it?.tags, 'CONTAINER')) {
                    const cid = `body_slots.${slot_name}.${stype}`;
                    ui_state.character.default_container_id = cid;
                    return cid;
                }
            }

            // garb containers
            if (Array.isArray(slot.garb)) {
                for (let i = 0; i < slot.garb.length; i++) {
                    const it = slot.garb[i];
                    if (has_tag(it?.tags, 'CONTAINER')) {
                        const cid = `body_slots.${slot_name}.garb.${i}`;
                        ui_state.character.default_container_id = cid;
                        return cid;
                    }
                }
            }
        }

        // 3) Dominant hand tool slot (right hand) if empty
        const right = body_slots?.hand_right;
        if (right && !right.tool) {
            return 'body_slots.hand_right.tool';
        }

        return null;
    }

    async function get_inventory_panel_drop_target_container_id(): Promise<string | null> {
        const owner_view = ui_state.container.owner_view;
        if (owner_view) {
            for (const group of owner_view.groups) {
                for (const surface of group.surfaces) {
                    if (!surface.accepts_player_insert) continue;
                    if (surface.surface_kind !== 'container') continue;
                    const container_id = get_container_id_from_target_id(surface.surface_target_id);
                    if (container_id) return container_id;
                }
            }
        }
        return await get_default_pickup_target_container_id();
    }

    function get_open_owner_inventory_container_id_for_item(surface: StorageSurface, slot: StorageSlot): string | null {
        const item_id = String(slot.item?.id ?? '');
        if (!item_id) return null;
        const owner = surface.owner as any;
        if (owner?.kind === 'actor' && owner?.id) {
            return `actor.item.${String(owner.id)}.${item_id}`;
        }
        if (owner?.kind === 'item' && owner?.owner_kind === 'actor' && owner?.owner_id) {
            return `actor.item.${String(owner.owner_id)}.${item_id}`;
        }
        if (owner?.kind === 'item' && owner?.owner_kind === 'place' && owner?.owner_id) {
            return `place.item.${String(owner.owner_id)}.${item_id}`;
        }
        if (owner?.kind === 'tile') {
            return null;
        }
        return null;
    }

    function get_refresh_owner_keys_for_container_id(container_id: string | null | undefined): Set<string> {
        const raw = String(container_id ?? '').trim();
        const out = new Set<string>();
        if (!raw) return out;
        if (raw.startsWith('body_slots.') || raw.startsWith('actor.item.')) {
            out.add(`actor:${get_controlled_actor_id()}`);
            return out;
        }
        if (raw.startsWith('place.tile.')) {
            const parsed = parse_place_tile_container_id(raw);
            if (parsed) out.add(`tile:${parsed.place_id}:${parsed.x}:${parsed.y}:${parsed.z}`);
            return out;
        }
        if (raw.startsWith('place.grow.')) {
            const parts = raw.split('.');
            if (parts.length >= 5) {
                const place_id = parts[2];
                const [xs, ys, zs] = String(parts[3] ?? '').split('_');
                const x = Number(xs), y = Number(ys), z = Number(zs);
                if (place_id && Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
                    out.add(`tile:${place_id}:${Math.floor(x)}:${Math.floor(y)}:${Math.floor(z)}`);
                }
            }
            return out;
        }
        if (raw.startsWith('place.item.')) {
            const parts = raw.split('.');
            if (parts.length >= 4) out.add(`place_item:${parts[2]}:${parts[3]}`);
            return out;
        }
        if (raw.startsWith('place.pile.')) {
            const parts = raw.split('.');
            if (parts.length >= 4) out.add(`pile:${parts[2]}:${parts[3]}`);
            return out;
        }
        return out;
    }

    async function reload_open_owner_view_for_container_id(container_id: string): Promise<void> {
        const canonical = ui_state.container.canonical_by_alias.get(container_id) ?? container_id;
        if (canonical === 'inventory_container') return;
        let next_view: OwnerInventoryView | null = null;
        if (canonical.startsWith('actor.item.')) {
            const parts = canonical.split('.');
            next_view = await load_actor_item_owner_inventory_view(String(parts[2] ?? ''), String(parts[3] ?? ''));
        } else if (canonical.startsWith('body_slots.')) {
            const actor_id = get_controlled_actor_id();
            if (actor_id) next_view = await load_body_slot_owner_inventory_view(actor_id, canonical.slice('body_slots.'.length));
        } else if (canonical.startsWith('place.tile.')) {
            const parsed = parse_place_tile_container_id(canonical);
            if (parsed) next_view = (await load_tile_owner_inventory_view(parsed.place_id, parsed.x, parsed.y, parsed.z))?.view ?? null;
        } else if (canonical.startsWith('place.item.')) {
            const parts = canonical.split('.');
            next_view = await load_place_item_owner_inventory_view(String(parts[2] ?? ''), String(parts[3] ?? ''));
        } else if (canonical.startsWith('place.pile.')) {
            const parts = canonical.split('.');
            next_view = await load_pile_owner_inventory_view(String(parts[2] ?? ''), String(parts[3] ?? ''));
        }
        if (!next_view) return;
        const aliases = ui_state.container.aliases_by_canonical.get(canonical) ?? [canonical];
        for (const alias of aliases) {
            ui_state.container.owner_view_by_container_id.set(alias, next_view);
        }
    }

    async function refresh_after_transfer(from_container_id: string, to_container_id: string): Promise<void> {
        const source = String(from_container_id ?? '');
        const target = String(to_container_id ?? '');
        const place_involved = source.startsWith('place.') || target.startsWith('place.');
        const actor_involved = source.startsWith('actor.') || source.startsWith('body_slots.') || target.startsWith('actor.') || target.startsWith('body_slots.');
        const source_keys = get_refresh_owner_keys_for_container_id(source);
        const target_keys = get_refresh_owner_keys_for_container_id(target);
        const affected_keys = new Set<string>([...source_keys, ...target_keys]);

        if (place_involved) {
            const place = get_current_place();
            if (place) {
                const place_to_place = source.startsWith('place.') && target.startsWith('place.');
                await refresh_place_visual_state(place.id);
            }
        }

        if (actor_involved) {
            await refresh_character_data();
            await refresh_actor_owner_inventory_view();
        }

        const reloads: Promise<void>[] = [];
        for (const open_id of ui_state.container.open_containers) {
            const open_keys = get_refresh_owner_keys_for_container_id(open_id);
            const intersects = [...open_keys].some((key) => affected_keys.has(key));
            if (intersects) reloads.push(reload_open_owner_view_for_container_id(open_id));
        }
        await Promise.all(reloads);
    }

    function get_best_known_actor_presence_seed(actor_ref: string): {
        name?: string;
        kind_id?: string;
        body_model_id?: string;
        entity_render?: any;
        tags?: any[];
        facing?: string | null;
    } {
        const normalized_ref = String(actor_ref ?? '').trim();
        const sources: any[] = [];
        if (ui_state.place.current_place) sources.push(ui_state.place.current_place);
        for (const place of ui_state.place.scene_places) {
            if (place && place !== ui_state.place.current_place) sources.push(place);
        }
        for (const place of sources) {
            const actors = Array.isArray((place as any)?.contents?.actors_present) ? (place as any).contents.actors_present : [];
            const match = actors.find((entry: any) => String(entry?.actor_ref ?? '') === normalized_ref) ?? null;
            if (!match) continue;
            return {
                name: typeof match?.name === 'string' && match.name.trim().length > 0 ? String(match.name) : undefined,
                kind_id: typeof match?.kind_id === 'string' ? String(match.kind_id) : undefined,
                body_model_id: typeof match?.body_model_id === 'string' ? String(match.body_model_id) : undefined,
                entity_render: match?.entity_render,
                tags: Array.isArray(match?.tags) ? match.tags : undefined,
                facing: typeof match?.facing === 'string' ? String(match.facing) : undefined,
            };
        }

        if (normalized_ref === get_input_actor_ref()) {
            return {
                name: ui_state.character.display_name || undefined,
                kind_id: ui_state.character.render_meta.kind_id ?? undefined,
                body_model_id: ui_state.character.render_meta.body_model_id ?? undefined,
                entity_render: ui_state.character.render_meta.entity_render ?? undefined,
                tags: ui_state.character.render_meta.tags,
                facing: get_facing(normalized_ref),
            };
        }

        return {
            facing: get_facing(normalized_ref),
        };
    }

    // Refresh legacy container state. This should normally be empty after owner-view cutover.
    async function refresh_container_data(): Promise<void> {
        const legacy_open = Array.from(ui_state.container.owner_view_by_container_id.keys()).filter((container_id) => !ui_state.container.open_containers.has(container_id));
        if (legacy_open.length === 0) return;

        debug_log(`[ContainerRefresh] Retiring ${legacy_open.length} legacy container window(s)`);
        for (const container_id of legacy_open) {
            close_owner_inventory_view(String(container_id));
        }
    }

    // SFX should correlate with UI updates.
    const sfx_played_log_ids = new Set<string>();
    let pending_speech_sfx: { id: string; loudness: 'NORMAL' | 'SHOUT'; expires_at_ms: number } | null = null;
    let last_sfx_at_ms = 0;
    let last_sfx_label: string | null = null;

    function set_text_window_messages(id: string, messages: (string | TextWindowMessage)[]) {
        const cur = ui_state.text_windows.get(id);
        const npcCount = messages.filter(m => typeof m === 'object' && m.sender === 'npc').length;
        if (npcCount > 0) {
            console.log(`[set_text_window_messages] Setting ${messages.length} messages for '${id}' (${npcCount} NPC)`);
        }
        if (!cur) {
            ui_state.text_windows.set(id, { messages: [...messages], rev: 1 });
        } else {
            cur.messages = [...messages];
            cur.rev++;
        }

        // Speech SFX: fire when lines actually show up in the transcript.
        if (id === 'transcript' && pending_speech_sfx) {
            if (Date.now() > pending_speech_sfx.expires_at_ms) {
                pending_speech_sfx = null;
            } else {
                const hit = messages.some((m) => typeof m === 'object' && (m as any).sender === 'user' && String((m as any).id ?? '') === pending_speech_sfx!.id);
                if (hit) {
                    play_sfx('speech_blip', { loudness: pending_speech_sfx.loudness, cooldown_ms: 0 });
                    last_sfx_at_ms = Date.now();
                    last_sfx_label = `speech_blip.${pending_speech_sfx.loudness}`;
                    sfx_played_log_ids.add(pending_speech_sfx.id);
                    pending_speech_sfx = null;
                }
            }
        }

        if (id === 'transcript') {
            // NPC talk: play the same speech blip when new NPC lines appear.
            for (const m of messages) {
                if (typeof m !== 'object') continue;
                if (m.sender !== 'npc') continue;
                const mid = String((m as any).id ?? '');
                if (!mid || sfx_played_log_ids.has(mid)) continue;
                sfx_played_log_ids.add(mid);
                play_sfx('speech_blip', { loudness: 'NORMAL', cooldown_ms: 60 });
                last_sfx_at_ms = Date.now();
                last_sfx_label = 'speech_blip.NORMAL';
            }

            // Cap to avoid unbounded growth.
            if (sfx_played_log_ids.size > 500) {
                const keep = new Set(Array.from(sfx_played_log_ids).slice(-250));
                sfx_played_log_ids.clear();
                for (const k of keep) sfx_played_log_ids.add(k);
            }
        }
    }

    function get_current_place(): Place | null {
        return ui_state.place.current_place;
    }

    function get_render_place(): Place | null {
        return get_scene_place(ui_state.place.scene_selected_place_id)
            ?? ui_state.place.current_place;
    }

    function get_scene_place(place_id: string | null): Place | null {
        if (!place_id) return null;
        return ui_state.place.scene_places.find((p) => p.id === place_id) ?? null;
    }

    function merge_place_into_scene(place: Place): void {
        const idx = ui_state.place.scene_places.findIndex((p) => p.id === place.id);
        if (idx >= 0) {
            ui_state.place.scene_places = [
                ...ui_state.place.scene_places.slice(0, idx),
                place,
                ...ui_state.place.scene_places.slice(idx + 1),
            ];
        } else {
            ui_state.place.scene_places = [...ui_state.place.scene_places, place];
        }
        if (ui_state.place.current_place_id === place.id) {
            ui_state.place.current_place = place;
            ui_state.place.current_place_id = place.id;
            set_command_handler_place(place);
        }
    }

    function remove_actor_from_non_target_scene_places(actor_ref: string, target_place_id: string): void {
        const clean_place = (place: Place): Place => {
            const actors = Array.isArray(place.contents?.actors_present) ? place.contents.actors_present : [];
            const filtered = actors.filter((a: any) => String(a?.actor_ref ?? '') !== actor_ref);
            if (filtered.length === actors.length) return place;
            return {
                ...place,
                contents: {
                    ...place.contents,
                    actors_present: filtered,
                },
            };
        };

        ui_state.place.scene_places = ui_state.place.scene_places.map((place) => {
            if (!place || place.id === target_place_id) return place;
            return clean_place(place);
        });

        if (ui_state.place.current_place && ui_state.place.current_place.id !== target_place_id) {
            ui_state.place.current_place = clean_place(ui_state.place.current_place);
        }
    }

    function is_place_visible_in_scene(place_id: string | null | undefined): boolean {
        const normalized = String(place_id ?? '').trim();
        if (!normalized) return false;
        if (ui_state.place.current_place?.id === normalized) return true;
        return ui_state.place.scene_visible_place_ids.includes(normalized)
            || ui_state.place.scene_places.some((place) => place.id === normalized);
    }

    async function refresh_single_scene_place(place_id: string): Promise<Place | null> {
        const refreshed = await fetch_place_snapshot(place_id);
        if (!refreshed) return null;
        merge_place_into_scene(refreshed);
        await refresh_ground_item_cache_for_place(place_id);
        debug_log(`[PLACE_SCENE] single place refresh ${JSON.stringify({ place_id, scene_places: ui_state.place.scene_places.map((p) => p.id) })}`);
        return refreshed;
    }

    async function refresh_ground_item_cache_for_place(place_id: string): Promise<void> {
        try {
            const base_url = APP_CONFIG.place_endpoint.replace('/api/place', '');
            const items_res = await fetch(`${base_url}/api/place/items?place_id=${encodeURIComponent(place_id)}`);
            if (!items_res.ok) return;
            const items_data = await items_res.json();
            if (!items_data.ok || !Array.isArray(items_data.items)) return;
            const cache = create_empty_ground_item_cache();
            for (const it of items_data.items) {
                const rec: GroundItemMetaRecord = {
                    id: String(it.id),
                    def_id: String(it.def_id ?? ''),
                    name: String(it.name ?? it.def_id ?? it.id),
                    qty: Number(it.qty ?? 1),
                    weight: Number(it.weight ?? 0),
                    display_char: typeof it.display_char === 'string' ? String(it.display_char).charAt(0) : undefined,
                    display_color: typeof it.display_color === 'string' ? it.display_color : undefined,
                    tags: Array.isArray(it.tags) ? it.tags : [],
                    elevation: (typeof it.elevation === 'number' && Number.isFinite(it.elevation)) ? Math.floor(it.elevation) : undefined,
                    position: it.position && typeof it.position.x === 'number' && typeof it.position.y === 'number'
                        ? { x: it.position.x, y: it.position.y }
                        : undefined,
                };

                const voxel_key = (rec.position && typeof rec.elevation === 'number' && Number.isFinite(rec.elevation))
                    ? `${rec.position.x}_${rec.position.y}_${Math.floor(rec.elevation)}`
                    : null;
                rec.voxel_key = voxel_key ?? undefined;
                rec.position_key = voxel_key ?? undefined;

                if (!rec.position || !voxel_key) {
                    debug_warn('[mono_ui]', 'ground item missing coordinates from /api/place/items', { place_id, item_id: rec.id, item: it });
                    continue;
                }

                cache.by_id.set(rec.id, rec);
                const voxel_arr = cache.by_voxel.get(voxel_key) ?? [];
                voxel_arr.push(rec.id);
                cache.by_voxel.set(voxel_key, voxel_arr);
                const xy_key = `${rec.position.x}_${rec.position.y}`;
                const xy_arr = cache.by_position.get(xy_key) ?? [];
                xy_arr.push(rec.id);
                cache.by_position.set(xy_key, xy_arr);
            }
            ui_state.place.ground_item_caches_by_place.set(place_id, cache);
            if (ui_state.place.current_place_id === place_id) sync_current_place_ground_item_cache_aliases();

            try {
                const next_place = get_scene_place(place_id) ?? (ui_state.place.current_place_id === place_id ? ui_state.place.current_place : null);
                if (next_place?.id === 'eden_crossroads_tavern') {
                    const base_z = Math.floor(Number((next_place as any)?.coordinates?.elevation ?? 0)) || 0;
                    const want_z = base_z + 1;
                    const elevated = Array.from(cache.by_id.values()).filter((r: any) => Math.floor(Number(r?.elevation ?? base_z)) === want_z);
                    if (elevated.length > 0) {
                        debug_log('3DIFICATION_TEST', `PASS ground item cache includes elevated item(s) (place=${next_place.id} z=${want_z} count=${elevated.length})`);
                    } else {
                        debug_warn('3DIFICATION_TEST', `FAIL ground item cache missing elevated items (place=${next_place.id} z=${want_z})`);
                    }

                }
            } catch {
                // ignore
            }

            const open = Array.from(ui_state.container.open_containers);
            for (const cid of open) {
                if (cid.startsWith('place.pile.')) {
                    const parts = cid.split('.');
                    const cache_place_id = parts[2];
                    const position_key = parts[3];
                    if (!cache_place_id || !position_key) continue;
                    const open_cache = ui_state.place.ground_item_caches_by_place.get(cache_place_id);
                    const ids = open_cache?.by_voxel.get(position_key) ?? [];
                    if (ids.length <= 1) {
                        close_owner_inventory_view(cid);
                    }
                }
            }
        } catch (err) {
            debug_warn('[mono_ui]', 'failed to refresh ground item cache', err);
        }
    }

    async function refresh_place_visual_state(place_id: string): Promise<void> {
        const is_scene_place = !!get_scene_place(place_id);
        const is_current_place = ui_state.place.current_place_id === place_id;
        if (is_scene_place || is_current_place) {
            await refresh_single_scene_place(place_id);
        }
    }

    async function handle_item_mutations_event(payload: any): Promise<void> {
        const intents = Array.isArray(payload?.intents) ? payload.intents as ItemMutationRefreshIntent[] : [];
        if (intents.length === 0) return;
        const place_ids = new Set<string>();
        let refresh_containers = false;
        let refresh_character = false;
        for (const intent of intents) {
            const scopes = Array.isArray(intent?.scopes) ? intent.scopes : [];
            const place_id = String(intent?.place_id ?? '').trim();
            if (scopes.includes('place_render') && place_id) place_ids.add(place_id);
            if (scopes.includes('container_contents')) refresh_containers = true;
            if (scopes.includes('character_render')) {
                const actor_id = String(intent?.actor_id ?? '').trim();
                if (!actor_id || actor_id === get_controlled_actor_id()) refresh_character = true;
            }
        }
        for (const place_id of place_ids) {
            await refresh_place_visual_state(place_id);
        }
        if (refresh_containers) await refresh_container_data();
        if (refresh_character) await refresh_character_data(true);
    }

    function get_place_region_id(place_id: string | null): string | null {
        const place = get_scene_place(place_id) ?? (ui_state.place.current_place_id === place_id ? ui_state.place.current_place : null);
        return place?.region_id ?? ui_state.place.current_region_id ?? null;
    }

    function build_place_ref_from_place_id(place_id: string | null): string | null {
        if (!place_id) return null;
        return `place.${String(place_id)}`;
    }

    function build_place_tile_ref(place_id: string | null, tile_x: number, tile_y: number): string | null {
        if (!Number.isFinite(tile_x) || !Number.isFinite(tile_y)) return null;
        if (!place_id) return null;
        return `place_tile.${String(place_id)}.${Math.floor(tile_x)}.${Math.floor(tile_y)}`;
    }

    function normalize_inspect_target(target: {
        type: "npc" | "actor" | "structure" | "item" | "item_pile" | "tile" | "place" | "adjacent_place";
        ref?: string;
        place_id?: string;
        tile_position: TilePosition;
    }): { target_ref: string | null; target_desc: string; ui_target_tile?: { x: number; y: number; z?: number } } {
        const place = get_current_place();
        const place_id = target.place_id ?? place?.id ?? null;
        const tile_x = Math.floor(Number(target.tile_position?.x ?? 0));
        const tile_y = Math.floor(Number(target.tile_position?.y ?? 0));
        const tile_z = Number.isFinite(Number((target.tile_position as any)?.z))
            ? Math.floor(Number((target.tile_position as any)?.z))
            : (Number.isFinite(Number((target as any)?.world_z)) ? Math.floor(Number((target as any).world_z)) : undefined);
        const ui_target_tile = Number.isFinite(tile_x) && Number.isFinite(tile_y)
            ? { x: tile_x, y: tile_y, z: tile_z }
            : undefined;

        if (target.type === 'npc' || target.type === 'actor' || target.type === 'structure' || target.type === 'item') {
            const target_ref = String(target.ref ?? '').trim() || null;
            return {
                target_ref,
                target_desc: target_ref ? get_entity_display_name(target_ref, target.type) : target.type,
                ui_target_tile,
            };
        }

        if (target.type === 'tile' || target.type === 'item_pile') {
            const target_ref = build_place_tile_ref(place_id, tile_x, tile_y);
            return {
                target_ref,
                target_desc: `${target.type === 'item_pile' ? 'pile' : 'tile'} ${tile_x},${tile_y}`,
                ui_target_tile,
            };
        }

        if (target.type === 'place' || target.type === 'adjacent_place') {
            const explicit_ref = String(target.ref ?? '').trim();
            const normalized_place_id = explicit_ref && !explicit_ref.startsWith('place.') ? explicit_ref : (explicit_ref.startsWith('place.') ? explicit_ref.replace(/^place\./, '') : place_id);
            const target_ref = explicit_ref.startsWith('place.')
                ? explicit_ref
                : build_place_ref_from_place_id(normalized_place_id ?? null);
            return {
                target_ref,
                target_desc: target.type === 'adjacent_place' ? 'adjacent place' : 'place',
                ui_target_tile,
            };
        }

        return {
            target_ref: null,
            target_desc: target.type,
            ui_target_tile,
        };
    }

    async function fetch_place_snapshot(place_id: string): Promise<Place | null> {
        try {
            const url = `${APP_CONFIG.place_endpoint}?slot=${APP_CONFIG.selected_data_slot}&place_id=${encodeURIComponent(place_id)}`;
            const res = await fetch(url);
            if (!res.ok) return null;
            const data = await res.json().catch(() => null);
            if (!data?.ok || !data?.place) return null;
            return data.place as Place;
        } catch {
            return null;
        }
    }

    type SceneTopologyPayload = {
        selected_place_id: string;
        actor_current_place_id: string;
        region_id: string | null;
        region_bounds: { origin: { x: number; y: number; z: number }; size: { x: number; y: number; z: number } } | null;
        graph_version: number;
        visible_place_ids: string[];
        places: Place[];
    };

    type SceneTopologyMeta = Omit<SceneTopologyPayload, 'places'>;

    function same_string_array(a: string[], b: string[]): boolean {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i += 1) {
            if (a[i] !== b[i]) return false;
        }
        return true;
    }

    function apply_scene_topology(scene: SceneTopologyPayload, opts?: { selected_place_id?: string; mirror_to_current_place?: boolean }): void {
        ui_state.place.current_region_id = scene.region_id;
        ui_state.place.current_region_bounds = scene.region_bounds;
        ui_state.place.actor_current_place_id = scene.actor_current_place_id;
        ui_state.place.scene_graph_version = Math.max(0, Math.floor(Number(scene.graph_version) || 0));
        ui_state.place.scene_visible_place_ids = Array.isArray(scene.visible_place_ids) ? [...scene.visible_place_ids] : scene.places.map((p) => p.id);
        ui_state.place.scene_places = scene.places;
        const selected_place_id = opts?.selected_place_id ?? scene.selected_place_id;
        ui_state.place.scene_selected_place_id = selected_place_id;
        const actor_place = scene.places.find((p) => p.id === scene.actor_current_place_id) ?? null;
        if (opts?.mirror_to_current_place !== false) {
            ui_state.place.current_place_id = scene.actor_current_place_id;
            ui_state.place.current_place = actor_place;
            if (actor_place) set_command_handler_place(actor_place);
        }
    }

    function apply_scene_topology_meta(scene: SceneTopologyMeta, opts?: { selected_place_id?: string; mirror_to_current_place?: boolean }): void {
        ui_state.place.current_region_id = scene.region_id;
        ui_state.place.current_region_bounds = scene.region_bounds;
        ui_state.place.actor_current_place_id = scene.actor_current_place_id;
        ui_state.place.scene_graph_version = Math.max(0, Math.floor(Number(scene.graph_version) || 0));
        ui_state.place.scene_visible_place_ids = Array.isArray(scene.visible_place_ids) ? [...scene.visible_place_ids] : [];
        ui_state.place.scene_places = ui_state.place.scene_places.filter((p) => ui_state.place.scene_visible_place_ids.includes(p.id));
        const selected_place_id = opts?.selected_place_id ?? scene.selected_place_id;
        ui_state.place.scene_selected_place_id = selected_place_id;
        const actor_place = ui_state.place.scene_places.find((p) => p.id === scene.actor_current_place_id) ?? null;
        if (opts?.mirror_to_current_place !== false) {
            ui_state.place.current_place_id = scene.actor_current_place_id;
            ui_state.place.current_place = actor_place;
            if (actor_place) set_command_handler_place(actor_place);
        }
    }

    async function fetch_scene_topology_meta(place_id: string): Promise<SceneTopologyMeta | null> {
        const started_ms = Date.now();
        try {
            const base_url = APP_CONFIG.place_endpoint.replace('/api/place', '');
            const selected_place_id = ui_state.place.scene_selected_place_id ?? place_id;
            const hops_visible = Math.max(0, Math.floor(Number(ui_state.place.scene_connector_hops_visible ?? 1)) || 0);
            const scene_res = await fetch(`${base_url}/api/region/scene/topology?slot=${APP_CONFIG.selected_data_slot}&place_id=${encodeURIComponent(place_id)}&selected_place_id=${encodeURIComponent(selected_place_id)}&hops_visible=${hops_visible}`);
            if (!scene_res.ok) return null;
            const scene_data = await scene_res.json().catch(() => null);
            if (!scene_data?.ok) return null;
            const meta = {
                selected_place_id: String(scene_data.selected_place_id ?? place_id),
                actor_current_place_id: String(scene_data.actor_current_place_id ?? place_id),
                region_id: typeof scene_data?.region?.id === 'string' ? scene_data.region.id : null,
                region_bounds: scene_data?.region?.region_bounds ?? null,
                graph_version: Math.max(0, Math.floor(Number(scene_data.graph_version) || 0)),
                visible_place_ids: Array.isArray(scene_data.visible_place_ids) ? scene_data.visible_place_ids.map((id: any) => String(id ?? '')).filter((id: string) => id.length > 0) : [],
            };
            debug_log(`[PLACE_SCENE] topology meta fetched ${JSON.stringify({ place_id, selected_place_id: meta.selected_place_id, actor_current_place_id: meta.actor_current_place_id, graph_version: meta.graph_version, visible_place_ids: meta.visible_place_ids, elapsed_ms: Math.max(0, Date.now() - started_ms) })}`);
            return meta;
        } catch {
            return null;
        }
    }

    async function hydrate_scene_places(visible_place_ids: string[], opts?: { preserve_existing?: boolean }): Promise<Place[]> {
        const started_ms = Date.now();
        const ids = Array.from(new Set((visible_place_ids ?? []).map((id) => String(id ?? '').trim()).filter((id) => id.length > 0)));
        if (ids.length === 0) return [];
        const preserve_existing = opts?.preserve_existing !== false;
        const existing = new Map<string, Place>();
        if (preserve_existing) {
            for (const place of ui_state.place.scene_places) {
                if (place && typeof place.id === 'string') existing.set(place.id, place);
            }
            if (ui_state.place.current_place?.id) existing.set(ui_state.place.current_place.id, ui_state.place.current_place);
        }
        const missing = ids.filter((id) => !existing.has(id));
        if (missing.length > 0) {
            const fetched = await Promise.all(missing.map((id) => fetch_place_snapshot(id)));
            for (let i = 0; i < missing.length; i += 1) {
                const place = fetched[i];
                if (place) existing.set(missing[i]!, place);
            }
        }
        const places = ids.map((id) => existing.get(id) ?? null).filter((p): p is Place => !!p);
        debug_log(`[PLACE_SCENE] topology hydrate ${JSON.stringify({ visible_place_ids: ids, reused_count: ids.length - missing.length, missing_count: missing.length, resolved_count: places.length, elapsed_ms: Math.max(0, Date.now() - started_ms) })}`);
        return places;
    }

    async function fetch_scene_topology(place_id: string): Promise<SceneTopologyPayload | null> {
        const meta = await fetch_scene_topology_meta(place_id);
        if (!meta) return null;
        const places = await hydrate_scene_places(meta.visible_place_ids, { preserve_existing: true });
        return { ...meta, places };
    }

    async function refresh_scene_topology_preserving_selection(seed_place_id: string, opts?: { preferred_selected_place_id?: string; mirror_to_current_place?: boolean }): Promise<boolean> {
        const started_ms = Date.now();
        const meta = await fetch_scene_topology_meta(seed_place_id);
        if (!meta) return false;
        const selected_place_id = opts?.preferred_selected_place_id
            ?? ui_state.place.scene_selected_place_id
            ?? meta.selected_place_id
            ?? seed_place_id;
        const topology_unchanged = meta.graph_version === ui_state.place.scene_graph_version
            && same_string_array(meta.visible_place_ids, ui_state.place.scene_visible_place_ids)
            && meta.actor_current_place_id === ui_state.place.actor_current_place_id;
        const missing_visible_ids = meta.visible_place_ids.filter((id) => !(get_scene_place(id) ?? (ui_state.place.current_place?.id === id ? ui_state.place.current_place : null)));
        apply_scene_topology_meta(meta, {
            selected_place_id,
            mirror_to_current_place: opts?.mirror_to_current_place ?? true,
        });
        if (topology_unchanged && missing_visible_ids.length === 0) {
            debug_log(`[PLACE_SCENE] refresh preserve selection fast-path ${JSON.stringify({ seed_place_id, selected_place_id, actor_current_place_id: meta.actor_current_place_id, graph_version: meta.graph_version, visible_place_ids: meta.visible_place_ids, elapsed_ms: Math.max(0, Date.now() - started_ms) })}`);
            return true;
        }
        const places = await hydrate_scene_places(meta.visible_place_ids, { preserve_existing: true });
        apply_scene_topology({ ...meta, places }, {
            selected_place_id,
            mirror_to_current_place: opts?.mirror_to_current_place ?? true,
        });
        debug_log(`[PLACE_SCENE] refresh preserve selection ${JSON.stringify({ seed_place_id, selected_place_id, actor_current_place_id: meta.actor_current_place_id, graph_version: meta.graph_version, visible_place_ids: meta.visible_place_ids, missing_visible_ids, scene_places: places.map((p) => p.id), elapsed_ms: Math.max(0, Date.now() - started_ms) })}`);
        return true;
    }

    async function set_scene_selected_place(place_id: string, opts?: { refresh?: boolean; center_camera?: boolean }): Promise<boolean> {
        const had_painter = ui_state.place_painter.active;
        let selected = get_scene_place(place_id);
        debug_log(`[PLACE_SCENE] select request ${JSON.stringify({ place_id, refresh: !!opts?.refresh, center_camera: !!opts?.center_camera, had_painter, scene_places: ui_state.place.scene_places.map((p) => p.id) })}`);
        if (opts?.refresh) {
            const same_region = get_place_region_id(place_id) !== null && get_place_region_id(place_id) === ui_state.place.current_region_id;
            if (selected && same_region) {
                const refreshed = await refresh_single_scene_place(place_id);
                if (refreshed) selected = refreshed;
            } else {
                const scene = await fetch_scene_topology(place_id);
                if (scene && scene.places.length > 0) {
                    apply_scene_topology(scene, { selected_place_id: place_id, mirror_to_current_place: false });
                    selected = scene.places.find((p) => p.id === place_id) ?? scene.places.find((p) => p.id === scene.selected_place_id) ?? selected;
                    debug_log(`[PLACE_SCENE] topology refresh applied ${JSON.stringify({ place_id, selected_place_id: scene.selected_place_id, actor_current_place_id: scene.actor_current_place_id, region_id: scene.region_id, graph_version: scene.graph_version, visible_place_ids: scene.visible_place_ids, scene_places: scene.places.map((p) => p.id) })}`);
                } else if (!selected) {
                    const fetched = await fetch_place_snapshot(place_id);
                    if (fetched) {
                        merge_place_into_scene(fetched);
                        selected = fetched;
                    }
                }
            }
        }
        if (!selected) {
            debug_warn('[PLACE_SCENE] select failed missing place in scene', { place_id, scene_places: ui_state.place.scene_places.map((p) => p.id) });
            return false;
        }
        ui_state.place.scene_selected_place_id = place_id;
        if (had_painter) {
            ui_state.place_painter.active = true;
            set_place_painter_modules_visible(true);
            if (!is_current_place_paused_by('place_painter')) {
                await set_current_place_pause_source('place_painter', true);
            }
        }
        if (opts?.center_camera) {
            const actor_tile = selected.contents?.actors_present?.find((a: any) => a.actor_ref === get_input_actor_ref())?.tile_position;
            if (had_painter && actor_tile) set_place_camera_target_position(actor_tile, 'free');
            else if (!had_painter) snap_place_camera_follow_to_actor();
        }
        debug_log(`[PLACE_SCENE] select applied ${JSON.stringify({ place_id, had_painter, pause_sources: ui_state.place.pause_state.pause_sources, current_place_id: ui_state.place.current_place_id, selected_scene_place_id: ui_state.place.scene_selected_place_id })}`);
        return true;
    }

    async function refresh_selected_scene_place(place_id: string | null, opts?: { preserve_place_painter?: boolean; source?: string; center_camera?: boolean }): Promise<void> {
        if (!place_id) return;
        const preserve_place_painter = opts?.preserve_place_painter === true && ui_state.place_painter.active;
        const source = String(opts?.source ?? 'unspecified');
        debug_log(`[PLACE_SCENE] selected place refresh start ${JSON.stringify({ source, place_id, preserve_place_painter, current_place_id: ui_state.place.current_place_id, scene_selected_place_id: ui_state.place.scene_selected_place_id, scene_places: ui_state.place.scene_places.map((p) => p.id) })}`);
        const ok = await set_scene_selected_place(place_id, { refresh: true, center_camera: opts?.center_camera });
        if (!ok) return;
        await refresh_ground_item_cache_for_place(place_id);
        if (preserve_place_painter) {
            ui_state.place_painter.active = true;
            set_place_painter_modules_visible(true);
            if (!is_current_place_paused_by('place_painter')) {
                await set_current_place_pause_source('place_painter', true);
            }
        }
        debug_log(`[PLACE_SCENE] selected place refresh applied ${JSON.stringify({ source, place_id, current_place_id: ui_state.place.current_place_id, scene_selected_place_id: ui_state.place.scene_selected_place_id, scene_places: ui_state.place.scene_places.map((p) => p.id) })}`);
    }

    async function focus_scene_place_for_painter(place_id: string): Promise<boolean> {
        const ok = await set_scene_selected_place(place_id, { refresh: true, center_camera: true });
        if (!ok) return false;
        flash_status([`Editing focus: ${place_id}`], 1200);
        return true;
    }

    function refresh_debug_window_messages(): void {
        try {
            if (typeof document !== 'undefined' && document.hidden) return;
            const dbg: string[] = [];
            const movement_debug = get_movement_debug_snapshot();
            const current_place = get_current_place();
            const current_actor = current_place?.contents?.actors_present?.[0] ?? null;
            const current_actor_tile = current_actor?.tile_position ?? null;
            const current_actor_z = (typeof current_actor?.elevation === 'number' && Number.isFinite(current_actor.elevation))
                ? Math.floor(current_actor.elevation)
                : Math.floor(Number((current_place as any)?.coordinates?.elevation ?? 0)) || 0;
            const current_breath_index = Math.floor(Number((current_place as any)?.breath_index ?? 0)) || 0;
            const breath_age = age_ms_string(renderer_debug.last_place_breath_changed_ms);
            const fetch_age = age_ms_string(renderer_debug.last_place_fetch_completed_ms);
            const actor_age = age_ms_string(renderer_debug.last_actor_pos_changed_ms);
            const input_age = age_ms_string(movement_debug.last_input_changed_ms);
            const intent_age = age_ms_string(movement_debug.last_intent_changed_ms || movement_debug.last_intent_observed_ms);
            const post_ok_age = age_ms_string(movement_debug.last_intent_post_ok_ms);
            const breath_rx_age = age_ms_string(movement_debug.last_breath_rx_ms);
            const batch_age = age_ms_string(movement_debug.last_move_batch_rx_ms);
            const step_age = age_ms_string(movement_debug.last_visible_step_ms);
            const breaths_since_step = (movement_debug.last_visible_step_breath_index > 0 && current_breath_index >= movement_debug.last_visible_step_breath_index)
                ? (current_breath_index - movement_debug.last_visible_step_breath_index)
                : 0;
            dbg.push(`[debug] ${UI_DEBUG.enabled ? 'ON' : 'off'} | overlays:${DEBUG_VISION.enabled ? 'ON' : 'off'}`);
            dbg.push(`[place] ${current_place?.id ?? '(none)'} | region:${ui_state.controls.region_label ?? 'unknown'}`);
            dbg.push(`[pause] ${ui_state.place.pause_state.paused ? 'PAUSED' : 'running'} | ts:${ui_state.place.pause_state.time_scale} | sources:${ui_state.place.pause_state.pause_sources.join(',') || 'none'}`);
            const selected_tile = get_selected_place_painter_tile_entry();
            const selected_item = get_selected_place_painter_item_entry();
            const palette_label = ui_state.place_painter.selected_palette_kind === 'item'
                ? selected_item?.id ?? 'none'
                : selected_tile?.id ?? 'none';
            dbg.push(`[place_painter] ${ui_state.place_painter.active ? 'ON' : 'off'} | tool:${ui_state.place_painter.selected_tool} | kind:${ui_state.place_painter.selected_palette_kind} | palette:${palette_label} | tiles:${ui_state.place_painter.tile_palette_entries.length} | items:${ui_state.place_painter.item_palette_entries.length}`);
            if (selected_tile) {
                dbg.push(`[paint_tile] ${selected_tile.display_char} ${selected_tile.id} | ${selected_tile.name}`);
            }
            if (ui_state.place_painter.last_primary_target) {
                const last = ui_state.place_painter.last_primary_target;
                dbg.push(`[paint_target] ${last.entity_ref ?? 'tile'} @ ${last.x},${last.y},${last.z}`);
            }
            dbg.push(`[render] fps:${renderer_debug.render_window_avg_fps}/${renderer_debug.last_render_fps} dt:${renderer_debug.last_render_delta_ms}ms max:${renderer_debug.render_window_dt_max_ms} h33:${renderer_debug.render_window_hitch_33_count} h50:${renderer_debug.render_window_hitch_50_count} h100:${renderer_debug.render_window_hitch_100_count}`);
            dbg.push(`[breath] now:${current_breath_index} fetch:${renderer_debug.last_place_fetch_breath_index} local_age:${breath_age} rx_age:${breath_rx_age} ${interval_stats_string(movement_debug.breath_rx)}`);
            dbg.push(`[fetch] count:${renderer_debug.place_fetch_count} last:${renderer_debug.last_place_fetch_elapsed_ms}ms age:${fetch_age}`);
            dbg.push(`[visible_step] age:${step_age} breaths_since:${breaths_since_step} ${interval_stats_string(movement_debug.visible_step)}`);
            dbg.push(`[intent] ${intent_string(movement_debug.current_intent)} mode:${movement_debug.current_intent_mode ?? '-'} input:${input_age} intent:${intent_age} post_ok:${post_ok_age} reason:${movement_debug.last_intent_post_reason ?? '-'}`);
            dbg.push(`[pipeline] stage:${classify_movement_stage(movement_debug)} batch_age:${batch_age} actor_age:${actor_age} posts:${movement_debug.intent_posts_ok}/${movement_debug.intent_posts_failed} resend:${movement_debug.intent_post_resend_count}`);
            dbg.push(`[bridge] breath_latency:${movement_debug.last_breath_bridge_latency_ms}ms move_latency:${movement_debug.last_move_batch_bridge_latency_ms}ms move_batch:${interval_stats_string(movement_debug.move_batch_rx)}`);
            dbg.push(`[actor_updates] draw:${renderer_debug.actor_pos_change_count} applied:${movement_debug.last_move_batch_local_actor_updates} seq:${movement_debug.last_visible_step_seq ?? '-'} step_at:${movement_debug.last_visible_step_position ? `${movement_debug.last_visible_step_position.x},${movement_debug.last_visible_step_position.y},${movement_debug.last_visible_step_position.z ?? current_actor_z}` : '-'}`);
            if (current_actor_tile) {
                dbg.push(`[actor] ${current_actor?.actor_ref ?? '(none)'} @ ${current_actor_tile.x},${current_actor_tile.y},${current_actor_z} age:${actor_age}`);
            } else {
                dbg.push('[actor] (none)');
            }
            dbg.push(`[volume] ${ui_state.controls.volume}`);
            dbg.push(`[move] ${ui_state.controls.move_mode}`);
            dbg.push(`[intent] ${ui_state.controls.override_intent ?? ui_state.controls.suggested_intent ?? '(none)'}`);
            dbg.push(`[cost] ${ui_state.controls.override_cost ?? '(auto)'}`);
            dbg.push(`[target] ${ui_state.controls.selected_target ? get_entity_display_name(ui_state.controls.selected_target) : '(none)'}`);
            const com_gate = get_timed_event_action_gate('COMMUNICATE');
            const ins_gate = get_timed_event_action_gate('INSPECT');
            dbg.push(`[gate talk] ${com_gate.locked ? format_action_gate_reason(com_gate.reason, com_gate.action_cost) : `ok (${com_gate.action_cost})`}`);
            dbg.push(`[gate look] ${ins_gate.locked ? format_action_gate_reason(ins_gate.reason, ins_gate.action_cost) : `ok (${ins_gate.action_cost})`}`);
            const timed_event = ui_state.timed_event_debug;
            if (timed_event.active) {
                dbg.push(`[timed_event] ${timed_event.type ?? 'active'} phase:${timed_event.phase ?? 'initiative_turn'} turn:${timed_event.current_turn ?? '?'} round:${timed_event.current_round ?? '?'} active:${timed_event.active_actor_ref ?? '(none)'}`);
                dbg.push(`[turn_window] breaths:${timed_event.turn_breaths_remaining ?? '?'} / ${timed_event.turn_window_breaths ?? '?'}`);
                if (timed_event.phase === 'world_sim_interstitial') {
                    dbg.push(`[world_turn] breath:${timed_event.timed_event_world_breath_index ?? 0}`);
                }
                const pending = Array.isArray(timed_event.pending_communication_opportunities)
                    ? timed_event.pending_communication_opportunities
                    : [];
                dbg.push(`[comm_transport] ${pending.length} pending transport item(s)`);
                for (const opp of pending.slice(0, 4)) {
                    const queue_label = opp.queue_entry_id ? `${opp.queue_entry_id.slice(0, 12)}@${opp.queue_stable_order ?? '?'}` : 'no_queue_entry';
                    dbg.push(`[comm_transport] ${opp.npc_ref} ${opp.status} t${opp.created_turn ?? '?'} ${queue_label} src:${opp.source_message_id.slice(0, 12)}`);
                }
            } else {
                dbg.push('[timed_event] inactive');
            }
            if (ui_state.controls.last_sent_input_id) dbg.push(`[last_input] ${ui_state.controls.last_sent_input_id}`);
            if (ui_state.character.hovered_item) {
                dbg.push(`[hover] ${ui_state.character.hovered_item.name} (${ui_state.character.hovered_item.source})`);
            }
            const signature = dbg.join('\n');
            if (signature === last_debug_window_signature) return;
            last_debug_window_signature = signature;
            last_debug_window_refresh_ms = Date.now();
            set_text_window_messages('debug', dbg);
        } catch {
            // ignore
        }
    }

    function maybe_refresh_debug_window_messages(force = false): void {
        const now = Date.now();
        if (!force && (now - last_debug_window_refresh_ms) < DEBUG_WINDOW_REFRESH_MS) return;
        void refresh_timed_event_debug_state();
        refresh_debug_window_messages();
    }

    async function update_current_place(place_id: string | null, opts?: { preserve_place_painter?: boolean; source?: string }): Promise<void> {
        const preserve_place_painter = opts?.preserve_place_painter === true && ui_state.place_painter.active;
        const source = String(opts?.source ?? 'unspecified');
        debug_log(`[PLACE_SCENE] full place load start ${JSON.stringify({ source, place_id, preserve_place_painter, current_place_id: ui_state.place.current_place_id, scene_selected_place_id: ui_state.place.scene_selected_place_id, scene_places: ui_state.place.scene_places.map((p) => p.id) })}`);
        if (!place_id) {
            const old_place_id = ui_state.place.current_place_id;
            await release_owned_place_pause_sources(old_place_id);
            ui_state.place_painter.active = false;
            ui_state.place_painter.last_primary_target = null;
            ui_state.place_painter.move_pending_source = null;
            ui_state.place_painter.move_drag_session = null;
            ui_state.place.current_place_id = null;
            ui_state.place.current_place = null;
            ui_state.place.current_region_id = null;
            ui_state.place.current_region_bounds = null;
            ui_state.place.actor_current_place_id = null;
            ui_state.place.scene_selected_place_id = null;
            ui_state.place.scene_places = [];
            ui_state.place.scene_visible_place_ids = [];
            ui_state.place.scene_graph_version = 0;
            ui_state.place.camera_target.region_pose = null;
            ui_state.place.camera_target.last_follow_update_ms = 0;
            sync_current_place_ground_item_cache_aliases();
            apply_place_pause_state(null);
            stop_place_touch_heartbeat();
            return;
        }

        // Only update ID if it's different (triggers re-center)
        const is_new_place = place_id !== ui_state.place.current_place_id;
        if (is_new_place) {
            const old_place_id = ui_state.place.current_place_id;
            await release_owned_place_pause_sources(old_place_id);
            ui_state.place.current_place_id = place_id;
            // Reset view state for new place
            ui_state.place.current_place = null;
            ui_state.place.actor_current_place_id = place_id;
            ui_state.place.scene_selected_place_id = place_id;
            ui_state.place.scene_places = [];
            ui_state.place.scene_visible_place_ids = [];
            ui_state.place.scene_graph_version = 0;
            ui_state.place.camera_target.region_pose = null;
            ui_state.place.camera_target.last_follow_update_ms = 0;
            sync_current_place_ground_item_cache_aliases();
            if (!preserve_place_painter) {
                ui_state.place_painter.active = false;
                ui_state.place_painter.last_primary_target = null;
                ui_state.place_painter.move_pending_source = null;
                ui_state.place_painter.move_drag_session = null;
                apply_place_pause_state(null);
            }
        }

        // Keep server breath ticking for the current place while the player is in it.
        // (This prevents movement reverting to "one step per click" when /api/place polling stops.)
        ensure_place_touch_heartbeat_running();

        // Fetch place data from API
        try {
            const url = `${APP_CONFIG.place_endpoint}?slot=${APP_CONFIG.selected_data_slot}&place_id=${encodeURIComponent(place_id)}`;
            const fetch_started_ms = Date.now();
            renderer_debug.last_place_fetch_started_ms = fetch_started_ms;
            renderer_debug.last_place_fetch_place_id = place_id;
            const res = await fetch(url);
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const data = (await res.json()) as {
                ok: boolean;
                place?: Place;
                pause_state?: { paused?: boolean; time_scale?: number; pause_sources?: string[] };
            };
            const fetch_elapsed_ms = Math.max(0, Date.now() - fetch_started_ms);
            renderer_debug.place_fetch_count += 1;
            renderer_debug.last_place_fetch_completed_ms = Date.now();
            renderer_debug.last_place_fetch_elapsed_ms = fetch_elapsed_ms;
            if (fetch_elapsed_ms > 150) {
                debug_log(`[MOVE_VEL_TEST] current place fetch slow ${JSON.stringify({ place_id, fetch_elapsed_ms })}`);
            }
            if (data.ok && data.place) {
                apply_place_pause_state(data.pause_state);
                renderer_debug.last_place_fetch_breath_index = Math.floor(Number((data.place as any)?.breath_index ?? 0)) || 0;
                // Preserve current entity positions if they're moving
                // This prevents snap-back when place data is refreshed during movement
                const current_place = ui_state.place.current_place;
                if (current_place && current_place.id === data.place.id) {
                    // Sync NPC positions and status from current place to new place data
                    for (const npc of data.place.contents.npcs_present) {
                        const current_npc = current_place.contents.npcs_present.find(n => n.npc_ref === npc.npc_ref);
                        if (current_npc) {
                            // Preserve renderer-updated status between place refreshes
                            npc.status = current_npc.status;
                        }
                    }
                    // Sync actor positions
                    for (const actor of data.place.contents.actors_present) {
                        const current_actor = current_place.contents.actors_present.find(a => a.actor_ref === actor.actor_ref);
                        if (current_actor) {
                            // Preserve current actor position
                            actor.tile_position = { ...current_actor.tile_position };
                        }
                    }
                }
                
                const next_place = data.place;
                ui_state.place.scene_selected_place_id = next_place.id;

                // Keep existing camera z focus stable across place refreshes.
                // Initial/default z is already set via persisted focus / follow updates.
                
                // DEBUG: Log tile information when place is loaded
                if (data.place?.tiles?.cells) {
                    const tiles = data.place.tiles;
                    const rows = tiles.cells.length;
                    const cols = rows > 0 && tiles.cells[0] ? tiles.cells[0].length : 0;
                    let nullTiles = 0;
                    let tilesWithDisplayChar = 0;
                    let tilesWithoutDisplayChar = 0;
                    const tileKinds = new Set<string>();
                    
                    for (const row of tiles.cells) {
                        if (!row) continue;
                        for (const tile of row) {
                            if (!tile) {
                                nullTiles++;
                            } else {
                                tileKinds.add(tile.kind);
                                if ((tile as any).display_char) {
                                    tilesWithDisplayChar++;
                                } else {
                                    tilesWithoutDisplayChar++;
                                }
                            }
                        }
                    }
                    
                    console.log('[PLACE_LOAD_DEBUG]', {
                        place_id: data.place.id,
                        dimensions: `${cols}x${rows}`,
                        null_tiles: nullTiles,
                        with_display_char: tilesWithDisplayChar,
                        without_display_char: tilesWithoutDisplayChar,
                        tile_kinds: Array.from(tileKinds)
                    });
                }
                
                // IMPORTANT: Re-register place with movement engine to ensure it uses updated data
                // This prevents stale cached place data from affecting rendering
                // (e.g., items that were picked up still appearing due to old cache)
                // Phase 8: Unified Movement Authority
                // Frontend NO LONGER initializes place movement
                // NPC_AI backend is the sole authority for movement decisions
                // The backend will send movement commands via outbox
                // Frontend just visualizes movement updates from the callback
                
                // Update movement command handler with new place
                // Refresh ground item cache for pile/single interactions.
                // Keep this atomic with the place swap so the PlaceModule doesn't render from a stale snapshot
                // while interactions use the ground cache.
                try {
                    const base_url = APP_CONFIG.place_endpoint.replace('/api/place', '');
                    try {
                        const scene = await fetch_scene_topology(next_place.id);
                        if (scene) {
                            apply_scene_topology(scene, { selected_place_id: next_place.id, mirror_to_current_place: false });
                        }
                    } catch {
                        // ignore scene topology fetch failures for now
                    }
                    const items_res = await fetch(`${base_url}/api/place/items?place_id=${encodeURIComponent(next_place.id)}`);
                    if (items_res.ok) {
                        const items_data = await items_res.json();
                        if (items_data.ok && Array.isArray(items_data.items)) {
                            ui_state.place.ground_items_by_id.clear();
                            ui_state.place.ground_items_by_voxel.clear();
                            ui_state.place.ground_items_by_position.clear();
                            for (const it of items_data.items) {
                                const rec = {
                                    id: String(it.id),
                                    def_id: String(it.def_id ?? ''),
                                    name: String(it.name ?? it.def_id ?? it.id),
                                    qty: Number(it.qty ?? 1),
                                    weight: Number(it.weight ?? 0),
                                    display_char: typeof it.display_char === 'string' ? String(it.display_char).charAt(0) : undefined,
                                    display_color: typeof it.display_color === 'string' ? it.display_color : undefined,
                                    tags: Array.isArray(it.tags) ? it.tags : [],
                                    elevation: (typeof it.elevation === 'number' && Number.isFinite(it.elevation)) ? Math.floor(it.elevation) : undefined,
                                    position_key: typeof it.position_key === 'string' ? it.position_key : undefined,
                                    position: it.position && typeof it.position.x === 'number' && typeof it.position.y === 'number'
                                        ? { x: it.position.x, y: it.position.y }
                                        : undefined,
                                };

                                const key = rec.position_key || (rec.position ? `${rec.position.x}_${rec.position.y}` : null);
                                if (key) {
                                    rec.position_key = key;
                                }

                                // xy+z voxel key for 3D piles
                                const voxel_key = (rec.position && typeof rec.elevation === 'number' && Number.isFinite(rec.elevation))
                                    ? `${rec.position.x}_${rec.position.y}_${Math.floor(rec.elevation)}`
                                    : null;

                                ui_state.place.ground_items_by_id.set(rec.id, rec);
                                // By-voxel
                                if (voxel_key) {
                                    const arr = ui_state.place.ground_items_by_voxel.get(voxel_key) ?? [];
                                    arr.push(rec.id);
                                    ui_state.place.ground_items_by_voxel.set(voxel_key, arr);
                                }
                                // By-xy (legacy convenience)
                                if (rec.position) {
                                    const xy_key = `${rec.position.x}_${rec.position.y}`;
                                    const arr = ui_state.place.ground_items_by_position.get(xy_key) ?? [];
                                    arr.push(rec.id);
                                    ui_state.place.ground_items_by_position.set(xy_key, arr);
                                }
                            }

                            // Devlog test: elevated ground items are present in cache for tavern.
                            try {
                                if (next_place.id === 'eden_crossroads_tavern') {
                                    const base_z = Math.floor(Number((next_place as any)?.coordinates?.elevation ?? 0)) || 0;
                                    const want_z = base_z + 1;
                                    const elevated = Array.from(ui_state.place.ground_items_by_id.values()).filter((r: any) => Math.floor(Number(r?.elevation ?? base_z)) === want_z);
                                    if (elevated.length > 0) {
                                        debug_log('3DIFICATION_TEST', `PASS ground item cache includes elevated item(s) (place=${next_place.id} z=${want_z} count=${elevated.length})`);
                                    } else {
                                        debug_warn('3DIFICATION_TEST', `FAIL ground item cache missing elevated items (place=${next_place.id} z=${want_z})`);
                                    }

                                }
                            } catch {
                                // ignore
                            }

                            // Auto-close pile UIs that no longer exist (or revert to single-item state)
                            const open = Array.from(ui_state.container.open_containers);
                            for (const cid of open) {
                                if (cid.startsWith('place.pile.')) {
                                    const parts = cid.split('.');
                                    const position_key = parts[3];
                                    if (!position_key) continue;
                                    const ids = ui_state.place.ground_items_by_voxel.get(position_key) ?? [];
                                    if (ids.length <= 1) {
                                        close_owner_inventory_view(cid);
                                    }
                                }
                            }
                        }
                    }
                } catch (err) {
                    // Non-fatal
                    debug_warn('[mono_ui]', 'failed to refresh ground item cache', err);
                }

                // Commit the place swap only after caches are refreshed.
                ui_state.place.current_place = next_place;
                set_command_handler_place(next_place);
                if (preserve_place_painter) {
                    ui_state.place_painter.active = true;
                    set_place_painter_modules_visible(true);
                    if (!is_current_place_paused_by('place_painter')) {
                        await set_current_place_pause_source('place_painter', true);
                    }
                } else {
                    snap_place_camera_follow_to_actor();
                }
                debug_log(`[PLACE_SCENE] full place load applied ${JSON.stringify({ source, place_id: next_place.id, preserve_place_painter, current_place_id: ui_state.place.current_place_id, scene_selected_place_id: ui_state.place.scene_selected_place_id, scene_places: ui_state.place.scene_places.map((p) => p.id), pause_sources: ui_state.place.pause_state.pause_sources })}`);
            } else {
                ui_state.place.current_place = null;
                ui_state.place.camera_target.region_pose = null;
            }
        } catch (err) {
            debug_warn('[mono_ui] failed to load place', place_id, err);
            ui_state.place.current_place = null;
            ui_state.place.camera_target.region_pose = null;
        }
    }

    function append_text_window_message(id: string, message: string | TextWindowMessage) {
        const cur = ui_state.text_windows.get(id);
        if (!cur) {
            ui_state.text_windows.set(id, { messages: [message], rev: 1 });
        } else {
            cur.messages.push(message);
            cur.rev++;
        }
    }

    const window_feeds: WindowFeed[] = [];

    function flash_status(lines: string[], ms: number): void {
        ui_state.status_override.until_ms = Date.now() + ms;
        ui_state.status_override.lines = [...lines];
        // Update the status window immediately (window feeds are polled separately).
        // Status window is 1-line tall; collapse into a single line.
        try {
            set_text_window_messages('status', [ui_state.status_override.lines.join(' | ')]);
        } catch {
            // ignore
        }
    }

    function register_window_feed(feed: WindowFeed): void {
        window_feeds.push(feed);
    }

    async function refresh_controlled_actor_binding(force: boolean = false): Promise<void> {
        if (ui_state.world_entry.is_visible || ui_state.world_join.is_visible) return;
        const current_actor_id = get_controlled_actor_id();
        if (!force && current_actor_id) return;
        await ensure_multiplayer_session_bootstrap();
        const session_token = get_session_token();
        const query = [`slot=${encodeURIComponent(String(APP_CONFIG.selected_data_slot))}`, `session_token=${encodeURIComponent(session_token)}`];
        const res = await fetch(`http://localhost:8787/api/session/control?${query.join('&')}`);
        const data = await res.json().catch(() => null) as any;
        if (res.ok && String(data?.binding_state ?? '') === 'unbound') {
            clear_controlled_actor_runtime_state();
            if (ui_state.actor_claim.is_visible) {
                apply_runtime_module_visibility('actor_claim_module');
                return;
            }
            await open_actor_claim_module('startup_required', ['select an actor to begin', 'one actor claimed at a time']);
            return;
        }
        if (!res.ok) {
            const error = String(data?.error ?? `session_control_fetch_failed:${res.status}`);
            if (error === 'controlled_actor_release_required') {
                clear_controlled_actor_runtime_state();
                await refresh_controlled_actor_binding(force);
                return;
            }
            if (error === 'controlled_actor_binding_required' || error === 'controlled_actor_already_claimed') {
                clear_controlled_actor_runtime_state();
                await open_actor_claim_module(error === 'controlled_actor_already_claimed' ? 'saved_actor_claimed' : 'startup_required', error === 'controlled_actor_already_claimed'
                    ? ['saved actor is already claimed', 'pick another actor to continue']
                    : ['select an actor to begin', 'one actor claimed at a time']);
                return;
            }
            throw new Error(error);
        }
        if (!data?.ok || typeof data?.controlled_actor_ref !== 'string') {
            throw new Error(String(data?.error ?? 'session_control_invalid'));
        }
        const actor_ref = String(data.controlled_actor_ref).trim();
        const actor_id = get_character_id_from_ref(actor_ref);
        if (!actor_id) throw new Error('session_control_missing_actor_id');
        const changed = actor_id !== current_actor_id;
        (APP_CONFIG as any).input_actor_id = actor_id;
        persist_controlled_actor_ref(actor_ref);
        set_current_actor_ref(actor_ref);
        ui_state.actor_claim.current_actor_ref = actor_ref;
        ui_state.actor_claim.selected_actor_ref = actor_ref;
        ui_state.actor_claim.is_visible = false;
        ui_state.actor_claim.is_blocking = false;
        ui_state.actor_claim.game_ready = false;
        apply_runtime_module_visibility();
        if (changed) {
            ui_state.character.display_name = typeof data?.controlled_actor_name === 'string' && data.controlled_actor_name.trim().length > 0
                ? data.controlled_actor_name.trim()
                : ui_state.character.display_name;
            void load_claimed_actor_runtime(actor_id, actor_ref, 'session_control_binding');
        } else if (!ui_state.place.current_place_id) {
            void load_claimed_actor_runtime(actor_id, actor_ref, 'session_control_resume');
        }
    }

    async function poll_window_feeds(): Promise<void> {
        if (poll_window_feeds_in_flight) return;
        poll_window_feeds_in_flight = true;
        const now = Date.now();
        const movement_active = is_movement_activity_high();
                const tasks = window_feeds.map(async (feed) => {
            try {
                if (feed.window_id === 'status' && ui_state.status_override.until_ms > Date.now()) {
                    set_text_window_messages('status', [ui_state.status_override.lines.join(' | ')]);
                    return;
                }
                if (movement_active && feed.window_id === 'transcript' && (now - last_transcript_poll_ms) < 2400) {
                    return;
                }
                const messages = await feed.fetch_messages();
                set_text_window_messages(feed.window_id, messages);
                if (feed.window_id === 'transcript') {
                    last_transcript_poll_ms = Date.now();
                }
            } catch (err) {
                debug_warn('[mono_ui] failed to refresh window feed', feed.window_id, err);
            }
        });

        tasks.push((async () => {
            try {
                if (movement_active && (now - last_roller_poll_ms) < 2400) return;
                const res = await fetch(APP_CONFIG.roller_status_endpoint);
                if (!res.ok) return;
                const data = (await res.json()) as { ok: boolean; status?: any };
                if (!data.ok || !data.status) return;
                ui_state.roller.spinner = String(data.status.spinner ?? "|");
                ui_state.roller.last_roll = String(data.status.last_player_roll ?? "");
                ui_state.roller.dice_label = String(data.status.dice_label ?? "D20");
                ui_state.roller.disabled = Boolean(data.status.disabled ?? true);
                ui_state.roller.roll_id = data.status.roll_id ?? null;
                last_roller_poll_ms = Date.now();
            } catch {
                // ignore
            }
        })());

        // Fetch target list (nearby NPCs / region)
        tasks.push((async () => {
            try {
                await refresh_controlled_actor_binding();
                if (!get_controlled_actor_id()) return;
                if (movement_active && (now - last_targets_poll_ms) < 2400) {
                    maybe_refresh_debug_window_messages();
                    return;
                }
                const url = `${APP_CONFIG.action_targets_endpoint}?slot=${APP_CONFIG.selected_data_slot}&actor_id=${get_controlled_actor_id()}`;
                const res = await fetch(url);
                if (!res.ok) return;
                const data = (await res.json()) as {
                    ok: boolean;
                    region?: string | null;
                    place?: string | null;
                    place_id?: string | null;
                    world_coords?: { x: number; y: number };
                    region_coords?: { x: number; y: number };
                    places?: Array<{ ref: string; label: string; id: string }>;
                    targets?: Array<{ ref: string; label: string; type: string }>;
                };
                if (!data.ok) return;
                ui_state.controls.targets = Array.isArray(data.targets) ? data.targets : [];
                ui_state.controls.region_label = typeof data.region === 'string' ? data.region : null;
                ui_state.controls.targets_ready = true;
                last_targets_poll_ms = Date.now();

                // Update actor-place tracking without tearing down the selected scene place.
                // Movement is now streamed via websocket; frequent /api/place polling can reintroduce stale snapshots.
                const place_id = data.place_id ?? null;
                if (place_id && get_scene_place(place_id) && ui_state.place.current_region_id && get_place_region_id(place_id) === ui_state.place.current_region_id) {
                    if (place_id !== ui_state.place.actor_current_place_id) {
                        const prev_actor_place_id = ui_state.place.actor_current_place_id;
                        const prev_selected_place_id = ui_state.place.scene_selected_place_id;
                        const painter_lock_selection = ui_state.place_painter.active && !!prev_selected_place_id;
                        const follow_actor_selection = !painter_lock_selection && (!prev_selected_place_id || prev_selected_place_id === prev_actor_place_id);
                        ui_state.place.actor_current_place_id = place_id;
                        debug_log(`[PLACE_SCENE] actor place updated in-scene ${JSON.stringify({ actor_current_place_id: place_id, prev_actor_place_id, prev_selected_place_id, painter_lock_selection, follow_actor_selection, scene_places: ui_state.place.scene_places.map((p) => p.id) })}`);
                        void refresh_scene_topology_preserving_selection(place_id, {
                            preferred_selected_place_id: follow_actor_selection ? place_id : (prev_selected_place_id ?? place_id),
                            mirror_to_current_place: !painter_lock_selection,
                        });
                    }
                } else if (place_id && !ui_state.place.current_place) {
                    const bootstrapped = await refresh_scene_topology_preserving_selection(place_id, {
                        preferred_selected_place_id: place_id,
                        mirror_to_current_place: true,
                    });
                    if (!bootstrapped) {
                        await update_current_place(place_id, { source: 'targets_poll_missing_current' });
                    }
                } else if (place_id && place_id !== ui_state.place.current_place_id) {
                    const refreshed = await refresh_scene_topology_preserving_selection(place_id, {
                        preferred_selected_place_id: ui_state.place.scene_selected_place_id ?? place_id,
                        mirror_to_current_place: true,
                    });
                    if (!refreshed) {
                        await update_current_place(place_id, { source: 'targets_poll_place_change' });
                    }
                }

                const actor_place_id = ui_state.place.actor_current_place_id;
                const selected_place_id = ui_state.place.scene_selected_place_id;
                const follow_entity_ref = get_follow_camera_entity_ref();
                const desired_follow_place_id = ui_state.timed_event_debug.active
                    ? resolve_follow_camera_entity_place_id(follow_entity_ref)
                    : actor_place_id;
                if (
                    desired_follow_place_id
                    && desired_follow_place_id !== selected_place_id
                    && !!get_scene_place(desired_follow_place_id)
                    && !ui_state.place_painter.active
                ) {
                    const switched = await set_scene_selected_place(desired_follow_place_id, { refresh: false, center_camera: true });
                    if (switched) {
                        debug_log(`[PLACE_SCENE] auto-follow actor place applied ${JSON.stringify({ actor_current_place_id: actor_place_id, follow_entity_ref, desired_follow_place_id, previous_selected_place_id: selected_place_id })}`);
                    }
                }

                // Validate persistent selected target
                if (ui_state.controls.selected_target) {
                    const valid = ui_state.controls.targets.some(t => t.ref.toLowerCase() === ui_state.controls.selected_target!.toLowerCase());
                    if (!valid) {
                        ui_state.controls.selected_target = null;
                        flash_status(['target no longer valid (choose again)'], 1200);
                    }
                }

                // Debug reader text (always visible)
                maybe_refresh_debug_window_messages(true);
            } catch {
                // ignore
            }
        })());

        try {
            await Promise.all(tasks);
        } finally {
            poll_window_feeds_in_flight = false;
        }
    }

    function start_window_feed_polling(interval_ms: number): void {
        if (poll_window_feeds_interval_id !== null) {
            if (poll_window_feeds_interval_ms === interval_ms) return;
            window.clearInterval(poll_window_feeds_interval_id);
            poll_window_feeds_interval_id = null;
        }
        poll_window_feeds_interval_ms = interval_ms;
        debug_log(`[MOVE_VEL_TEST] app place timing version ${JSON.stringify({ version: APP_PLACE_TIMING_VERSION, poll_interval_ms: interval_ms })}`);
        void poll_window_feeds();
        poll_window_feeds_interval_id = window.setInterval(() => {
            void poll_window_feeds();
        }, interval_ms);
    }

    async function send_action_input(message: string): Promise<void> {
        try {
            // Ensure targets are loaded at least once before sending so targeting is reliable.
            if (!ui_state.controls.targets_ready) {
                flash_status(['loading targets...'], 800);
                await new Promise((r) => setTimeout(r, 250));
            }

            // Local targeting commands (do not send to backend)
            const trimmed = message.trim();
            if (trimmed.toLowerCase().startsWith('/target ')) {
                const name = trimmed.slice('/target '.length).trim().toLowerCase();
                const npc = ui_state.controls.targets.find(t => t.type === 'npc' && (t.label.toLowerCase() === name || t.ref.toLowerCase() === `npc.${name}`));
                ui_state.controls.selected_target = npc ? npc.ref : null;
                flash_status([`target set: ${npc ? npc.label : '(cleared)'}`], 1200);
                return;
            }
            if (trimmed.toLowerCase() === '/target') {
                ui_state.controls.selected_target = null;
                flash_status([`target cleared`], 1200);
                return;
            }
            if (trimmed.toLowerCase() === '/claim') {
                if (get_controlled_actor_id()) {
                    await open_actor_claim_module('manual_claim', ['release current actor to switch', 'one actor claimed at a time']);
                    return;
                }
                await open_actor_claim_module('manual_claim', ['select an actor to claim', 'use /unclaim before switching']);
                return;
            }
            if (trimmed.toLowerCase() === '/unclaim') {
                await release_actor_claim_and_reopen();
                flash_status(['Actor released', 'select another actor to continue'], 1400);
                return;
            }
            if (trimmed.toLowerCase() === '/debugcommander') {
                const next = !module_registry.is_visible('debug_commander_module');
                set_module_visible('debug_commander_module', next);
                flash_status([next ? 'Debug commander shown' : 'Debug commander hidden'], 900);
                return;
            }
            if (trimmed.toLowerCase() === '/status') {
                const next = !module_registry.is_visible('status');
                set_module_visible('status', next);
                flash_status([next ? 'Status shown' : 'Status hidden'], 900);
                return;
            }
            if (trimmed.toLowerCase() === '/transcript') {
                const next = !module_registry.is_visible('transcript');
                set_module_visible('transcript', next);
                flash_status([next ? 'Transcript shown' : 'Transcript hidden'], 900);
                return;
            }
            if (trimmed.toLowerCase() === '/input') {
                const next = !module_registry.is_visible('input');
                set_module_visible('input', next);
                flash_status([next ? 'Input shown' : 'Input hidden'], 900);
                return;
            }
            if (trimmed.toLowerCase() === '/logout') {
                await logout_to_actor_claim();
                return;
            }
            if (!get_controlled_actor_id()) {
                await open_actor_claim_module('pre_input_required', ['select an actor before sending input', 'one actor claimed at a time']);
                return;
            }

            // Mention-based targeting: detect @Name anywhere in the message.
            // If valid, strip the '@' marker from outgoing text to avoid parser errors and keep the text natural.
            let target_ref: string | null = ui_state.controls.selected_target;
            let outgoing = message;

            const words = trimmed.split(/\s+/).filter(w => w.length > 0);
            const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

            const targets_npc = ui_state.controls.targets.filter(t => t.type === 'npc');

            const findTargetByName = (name: string): { ref: string; label: string } | null => {
                const n = norm(name);
                if (!n) return null;
                const hit = targets_npc.find(t => {
                    const labelN = norm(t.label);
                    const refN = norm(t.ref.replace(/^npc\./i, ""));
                    return labelN === n || refN === n;
                });
                return hit ? { ref: hit.ref, label: hit.label } : null;
            };

            const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const findMentionedTargetInText = (text: string): { ref: string; label: string } | null => {
                const lowered = text.toLowerCase();
                const candidates = targets_npc
                    .map(t => ({
                        ref: t.ref,
                        label: t.label,
                        names: [t.label, t.ref.replace(/^npc\./i, '')]
                            .map(name => name.trim())
                            .filter(name => name.length > 0),
                    }))
                    .sort((a, b) => Math.max(...b.names.map(n => n.length)) - Math.max(...a.names.map(n => n.length)));

                for (const candidate of candidates) {
                    for (const name of candidate.names) {
                        const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegex(name.toLowerCase())}([^a-z0-9]|$)`, 'i');
                        if (pattern.test(lowered)) {
                            return { ref: candidate.ref, label: candidate.label };
                        }
                    }
                }
                return null;
            };

            // Scan tokens for @ mentions; support multi-word like "@Old Moss".
            for (let i = 0; i < words.length; i++) {
                const w = words[i] ?? "";
                if (!w.startsWith('@') || w.length < 2) continue;

                const first = w.slice(1);
                const second = words[i + 1];
                const third = words[i + 2];

                const candidates: string[] = [];
                candidates.push(first);
                if (second) candidates.push(`${first} ${second}`);
                if (second && third) candidates.push(`${first} ${second} ${third}`);

                let matched: { ref: string; label: string } | null = null;
                for (const c of candidates) {
                    matched = findTargetByName(c);
                    if (matched) break;
                }

                if (matched) {
                    target_ref = matched.ref;
                    // Persist selection so the UI reflects targeting for subsequent actions.
                    ui_state.controls.selected_target = matched.ref;
                    // strip '@' from the first token only; keep the name readable
                    words[i] = first;
                    outgoing = words.join(' ');
                    flash_status([`target: ${matched.label}`], 800);
                } else {
                    flash_status([`unknown target: ${first} (pick from targets panel)`], 1200);
                }

                break; // one target per message for now
            }

            if (!target_ref) {
                const matched = findMentionedTargetInText(outgoing);
                if (matched) {
                    target_ref = matched.ref;
                    ui_state.controls.selected_target = matched.ref;
                    flash_status([`target: ${matched.label}`], 800);
                }
            }

            // Validate target immediately before sending
            if (target_ref) {
                const valid = ui_state.controls.targets.some(t => t.ref.toLowerCase() === target_ref!.toLowerCase());
                if (!valid) {
                    ui_state.controls.selected_target = null;
                    target_ref = null;
                    flash_status(['target no longer valid (choose again)'], 1200);
                }
            }

            // INSPECT is handled by backend now (so findings are canonical + renderer-safe).

            // Local debug visualization: show outgoing COMMUNICATE broadcast at the actor.
            // (ActionPipeline runs in the backend, so renderer-only particles must be spawned here.)
            if (DEBUG_VISION.enabled && DEBUG_VISION.show_sense_broadcasts) {
                const place = get_current_place();
                const actor_ref = get_input_actor_ref();
                const actor = place?.contents?.actors_present?.find(a => a.actor_ref === actor_ref);
                const pos = actor?.tile_position;

                if (pos) {
                    const trimmed_out = outgoing.trim();
                    const is_local_cmd = trimmed_out.startsWith('/');
                    if (!is_local_cmd) {
                        const hint = infer_action_verb_hint(trimmed_out);
                        const verb = hint.verb ?? 'COMMUNICATE';
                        const subtype = verb === 'COMMUNICATE' ? 'NORMAL' : (verb === 'MOVE' ? 'WALK' : undefined);
                        const broadcasts = get_senses_for_action(verb, subtype);
                        for (const b of broadcasts) {
                            const actor_z = Number((actor as any)?.elevation);
                            const origin_z = Number.isFinite(actor_z) ? Math.floor(actor_z) : ui_state.place.world_z_center;
                            const c = ui_state.place.world_z_center;
                            const visible_planes_z = [c - 1, c, c + 1] as const;
                            spawn_sense_broadcast_particles({
                                origin: { x: pos.x, y: pos.y, z: origin_z },
                                sense: b.sense,
                                range: b.range_tiles,
                                visible_planes_z,
                                source_ref: actor_ref,
                            });
                        }
                    }
                }
            }

            // Warn once if there is no intent hint and no override.
            // Show warning briefly BEFORE sending, then return to normal status.
            const hint = infer_action_verb_hint(outgoing);
            if (!ui_state.controls.override_intent && !hint.verb) {
                flash_status(['your message does not contain an action type hint'], 900);
                await new Promise((r) => setTimeout(r, 900));
            }

            const verb_effective = ui_state.controls.override_intent ?? hint.verb;
            if (verb_effective === 'COMMUNICATE' || verb_effective === 'INSPECT') {
                const gate = get_timed_event_action_gate(verb_effective);
                if (gate.locked) {
                    flash_status([format_action_gate_reason(gate.reason, gate.action_cost)], 1200);
                    return;
                }
            }
            const intent_subtype = (
                verb_effective === 'COMMUNICATE' ||
                (!verb_effective && !!target_ref)
            ) ? ui_state.controls.volume : undefined;

            debug_log('[mono_ui] action input targeting resolved', {
                text_preview: outgoing.slice(0, 80),
                selected_target: ui_state.controls.selected_target,
                final_target_ref: target_ref,
                inferred_intent: verb_effective ?? null,
                intent_subtype: intent_subtype ?? null,
            });

            // arm pending speech SFX once we have an input id from backend

            const res = await fetch(APP_CONFIG.action_input_endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_token: get_session_token(),
                    text: outgoing,
                    sender: get_controlled_actor_id(),
                    // Send inferred verb when available (not just explicit override).
                    intent_verb: verb_effective ?? undefined,
                    intent_subtype,
                    action_cost: ui_state.controls.override_cost ?? undefined,
                    target_ref: target_ref ?? undefined,
                }),
            });

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }

            const data = (await res.json()) as { ok: boolean; id?: string };
            if (data.ok) {
                if (typeof data.id === 'string') {
                    ui_state.controls.last_sent_input_id = data.id;

                    const verb_for_sfx = (ui_state.controls.override_intent ?? hint.verb ?? 'COMMUNICATE').toUpperCase();
                    const v = String(ui_state.controls.volume ?? '').toUpperCase();
                    if (verb_for_sfx === 'COMMUNICATE' && (v === 'NORMAL' || v === 'SHOUT')) {
                        pending_speech_sfx = { id: data.id, loudness: v, expires_at_ms: Date.now() + 8000 };
                    } else {
                        pending_speech_sfx = null;
                    }
                }
                void poll_window_feeds();
            }

            // Return status line to neutral
            flash_status(['waiting for actor response'], 900);
        } catch (err) {
            debug_warn('[mono_ui] failed to send text input to action backend', err);
            append_text_window_message('transcript', '[system] failed to reach action backend');
        }
    }

    async function fetch_log_messages(slot: number): Promise<(string | TextWindowMessage)[]> {
    const res = await fetch(`${APP_CONFIG.action_log_endpoint}?slot=${slot}`);
    if (!res.ok) {
        debug_warn(`[fetch_log_messages] HTTP error: ${res.status}`);
        throw new Error(`HTTP ${res.status}`);
    }

    const data = (await res.json()) as {
        ok: boolean;
        messages?: {
            id: string;
            sender: string;
            content: string;
            type?: string;
            correlation_id?: string;
            status?: string;
            stage?: string;
            meta?: Record<string, unknown>;
        }[];
    };
    if (!data.ok || !Array.isArray(data.messages)) return [];

     // Limit message count to keep UI readable.
     // Note: log.jsonc is newest-first; we keep the most recent window and then sort chronologically.
     const MAX_MESSAGES = 80;
     const recentMessages = data.messages.length > MAX_MESSAGES
         ? data.messages.slice(0, MAX_MESSAGES)
         : data.messages;

    // Sort by timestamp extracted from id (format: "ISO : index : random") for chronological order
    const sorted = [...recentMessages].sort((a, b) => {
        const getTime = (m: { id: string }) => {
            const idParts = m.id?.split(' : ');
            if (idParts && idParts[0]) return new Date(idParts[0]).getTime();
            return 0;
        };
        return getTime(a) - getTime(b);
    });
    
    const seen_ids = new Set<string>();
     const last_renderer_text_by_correlation = new Map<string, string>();
     const latest_renderer_by_reply_to = new Map<string, any>();

    // Filter out messages older than 30 minutes to prevent old session data from showing
    const CUTOFF_TIME = Date.now() - (30 * 60 * 1000); // 30 minutes ago
    
        const filtered = sorted.filter((m: { id: string; sender: string; content: string; type?: string; correlation_id?: string; reply_to?: string; status?: string; stage?: string; meta?: Record<string, unknown> }) => {
        if (!m?.id) return false;
        if (seen_ids.has(m.id)) return false;
        seen_ids.add(m.id);

        const sender = (m.sender ?? '').toLowerCase();
        const content = (m.content ?? '').trim();
        
        // Filter out empty messages
        if (!content) return false;
        
        // Filter out messages older than 30 minutes (prevents old session data)
        const idParts = m.id?.split(' : ');
        if (idParts && idParts[0]) {
            const msgTime = new Date(idParts[0]).getTime();
            if (msgTime < CUTOFF_TIME) return false;
        }
        
        // Allow NPC messages through (ID-based dedup above is sufficient)
        if (sender.startsWith('npc.')) return true;

        // User input sender can be "j" or the configured actor id ("henry_actor").
        if (sender === 'j' || sender === get_controlled_actor_id().toLowerCase()) return true;
        if (sender === 'renderer_ai') {
            // Prefer dedup by reply_to (one narration per applied message).
            const replyKey = (m as any).reply_to ?? '';
            if (replyKey) {
                latest_renderer_by_reply_to.set(replyKey, m);
            }

            // Secondary dedup: identical text within a correlation.
            const correlation = m.correlation_id ?? 'none';
            const last = last_renderer_text_by_correlation.get(correlation);
            last_renderer_text_by_correlation.set(correlation, content);
            if (last !== undefined && last === content) return false;
            return true;
        }
        if (sender === 'inspection' || m.stage === 'inspection_result') return true;
        if (sender === 'hint') return true;
        if (m.type === 'user_input') return true;
        if (sender === 'state_applier') return UI_DEBUG.enabled;
        return false;
    });

     // Final renderer dedup pass: keep only the latest renderer message for each reply_to.
     const renderer_reply_to_allow = new Set<string>();
     for (const m of latest_renderer_by_reply_to.values()) {
         const k = (m as any).reply_to;
         if (typeof k === 'string' && k.length > 0) renderer_reply_to_allow.add(k);
     }
     const filtered_final = filtered.filter((m: any) => {
         const sender = (m.sender ?? '').toLowerCase();
         if (sender !== 'renderer_ai') return true;
         const replyKey = m.reply_to;
         if (!replyKey) return true;
         // If we saw multiple narrations for the same reply_to, only keep the selected latest one.
         const chosen = latest_renderer_by_reply_to.get(replyKey);
         return chosen ? chosen.id === m.id : renderer_reply_to_allow.has(replyKey);
     });

     // Group by correlation_id when present, otherwise keep messages as standalone groups.
     const group_order: string[] = [];
     const groups = new Map<string, any[]>();
     for (const m of filtered_final as any[]) {
         const key = (m.correlation_id ?? '') || m.id;
         if (!groups.has(key)) {
             groups.set(key, []);
             group_order.push(key);
         }
         groups.get(key)!.push(m);
     }

     const out: (string | TextWindowMessage)[] = [];
      for (const key of group_order) {
         const msgs = groups.get(key) ?? [];
         const user = msgs.filter(m => {
             const s = (m.sender ?? '').toLowerCase();
             return s === 'j' || s === get_controlled_actor_id().toLowerCase();
         });
         const narr = msgs.filter(m => (m.sender ?? '').toLowerCase() === 'renderer_ai');
          const npcs = msgs.filter(m => (m.sender ?? '').toLowerCase().startsWith('npc.'));
          const inspections = msgs.filter(m => (m.sender ?? '').toLowerCase() === 'inspection' || m.stage === 'inspection_result');

          const push_msg = (sender: string, content: string, kind: string, id?: string) => {
              const mid = typeof id === 'string' ? id : undefined;
              if (kind === 'user') out.push({ content, sender: 'user', id: mid });
              else if (kind === 'assistant') out.push({ content, sender: 'assistant', id: mid });
              else if (kind === 'npc') {
                  const npcName = get_transcript_speaker_name(sender);
                  out.push({ content: `${npcName}: ${content}`, sender: 'npc', id: mid });
              } else if (kind === 'inspection') {
                  out.push({ content, sender: 'inspection', id: mid });
              } else if (kind === 'hint') {
                  out.push({ content: `💡 ${content}`, sender: 'hint', id: mid });
              } else if (kind === 'state') {
                  out.push({ content: `[STATE] ${content}`, sender: 'state', id: mid });
              }
          };

          if (user.length > 0) {
              const last = user[user.length - 1];
              push_msg(last.sender, last.content, 'user', last.id);
          }

          if (narr.length > 0) {
              const last = narr[narr.length - 1];
              push_msg(last.sender, last.content, 'assistant', last.id);
          }

          for (const n of npcs) {
              push_msg(n.sender, n.content, 'npc', n.id);
          }

          for (const ins of inspections) {
              push_msg(ins.sender, ins.content, 'inspection', ins.id);
          }

         // Optional system/state/hint visibility (debug-only)
         if (UI_DEBUG.enabled) {
             for (const m of msgs) {
                  const sender = (m.sender ?? '').toLowerCase();
                  if (sender === 'hint') push_msg(m.sender, m.content, 'hint', m.id);
                  if (sender === 'state_applier') push_msg(m.sender, m.content, 'state', m.id);
              }
          }
     }

     return out;
    }

    async function fetch_status_line(slot: number): Promise<string[]> {
        // Client-side temporary status override
        if (ui_state.status_override.until_ms > Date.now() && ui_state.status_override.lines.length > 0) {
            // Status window is 1-line tall; collapse overrides into a single line.
            return [ui_state.status_override.lines.join(' | ')];
        }
        const res = await fetch(`${APP_CONFIG.action_status_endpoint}?slot=${slot}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = (await res.json()) as { ok: boolean; status?: { line?: string }; time_short?: string | null; day?: number | null };
        if (!data.ok) return [""];
        const status_line = data.status?.line ?? "";
        const time_short = typeof data.time_short === "string" ? data.time_short : null;
        const day = typeof data.day === "number" ? data.day : null;
        const time_prefix = time_short && day ? `Day ${day} ${time_short}` : null;
        if (time_prefix && status_line) return [`${time_prefix} | ${status_line}`];
        if (time_prefix) return [time_prefix];
        return [status_line];
    }

    (window as any).THAUM_UI = {
        set_text_window_messages,
        append_text_window_message,
    };

    // Layout (grid: 0..grid_width-1, 0..grid_height-1). y grows upward.
    // This roughly matches the UI mock:
    // - Top: status bar
    // - Upper left: place
    // - Upper right: debug reader
    // - Mid left: incoming log
    // - Bottom: input + buttons
    // Layout blocks (see UI mock):
    // 1 input, 2 transcript, 3 place, 4 system info, 5 free, 6 debug, 7 buttons, 8 roller.
    // Layout: Left panel (1-96) | Gap | Right panel (98-158) | Gap | Debug buttons (185-198)
    const L_X0 = 1;
    const L_X1 = 96;
    const R_X0 = 98;
    const R_X1 = 158;  // Stop before debug button area (185-198)

    const Y_INPUT0 = 1;
    const Y_INPUT1 = 5;

    const Y_TRANSCRIPT0 = 7;
    const Y_TRANSCRIPT1 = 17;

    const Y_PLACE0 = 19;
    const Y_PLACE1 = 43;

    // Status/system info window: give it enough height to show text, not just borders.
    const Y_SYS0 = APP_CONFIG.grid_height - 6;
    const Y_SYS1 = APP_CONFIG.grid_height - 2;

    const BTN_X0 = R_X0;
    const BTN_X1 = R_X1 - 26;
    const ROLL_X0 = R_X1 - 24;
    const ROLL_X1 = R_X1;
    const BTN_Y0 = Y_INPUT0;
    const BTN_Y1 = Y_TRANSCRIPT1;

    // Do not seed the log window with placeholder text.

    // Create module registry for dynamic module management (Phase 7.5)
    const module_registry = create_module_registry();
    ui_state.modules.registry = module_registry;

    // Apply persisted visibility defaults before modules are used.
    // (ModuleRegistry defaults visibility to true on register.)
    {
        const v_char = ui_state.modules.visibility.get('character_module');
        if (typeof v_char === 'boolean') ui_state.character.is_visible = v_char;
        const v_inventory = ui_state.modules.visibility.get('inventory_container');
        if (typeof v_inventory === 'boolean') ui_state.container.is_visible = v_inventory;
    }

    function get_focus_world_z_for_current_place(): number {
        const place = get_render_place();
        if (!place) return ui_state.place.world_z_center;
        if (get_principal_view_plane_axis(ui_state.place.principal_view) !== 'z') {
            return Math.floor(ui_state.place.world_z_center);
        }
        const base_z = Math.floor(Number((place as any)?.coordinates?.elevation ?? 0)) || 0;
        const planes = get_active_place_focus_planes(place);
        const slot = Math.max(0, Math.min(planes.length - 1, Math.floor(ui_state.place.focus_z)));
        const wz = Math.floor(Number(planes[slot] ?? ui_state.place.world_z_center));
        return Number.isFinite(wz) ? wz : base_z;
    }

    function get_active_place_focus_planes(place: Place | null | undefined): number[] {
        if (!place) return [Math.floor(ui_state.place.world_z_center) || 0];
        const bounds = get_place_region_bounds(place);
        const origin = bounds.origin;
        const size = bounds.size;
        return build_visible_plane_coordinates({
            min_x: Math.floor(Number(origin.x) || 0),
            min_y: Math.floor(Number(origin.y) || 0),
            min_z: Math.floor(Number(origin.z) || 0),
            width: Math.max(1, Math.floor(Number(size.x) || 1)),
            height: Math.max(1, Math.floor(Number(size.y) || 1)),
            depth: Math.max(1, Math.floor(Number(size.z) || 1)),
        }, get_defined_place_world_zs(place), ui_state.place.principal_view);
    }

    function get_focus_anchor_plane_value(anchor: { x?: number; y?: number; z?: number } | null | undefined): number {
        const plane_axis = get_principal_view_plane_axis(ui_state.place.principal_view);
        if (plane_axis === 'x') return Math.floor(Number(anchor?.x) || 0);
        if (plane_axis === 'y') return Math.floor(Number(anchor?.y) || 0);
        return Math.floor(Number(anchor?.z) || 0);
    }

    function sync_place_focus_plane_from_anchor(anchor: { x?: number; y?: number; z?: number } | null | undefined): void {
        const place = get_render_place();
        const planes = get_active_place_focus_planes(place);
        const target_plane = get_focus_anchor_plane_value(anchor);
        if (planes.length < 1) {
            ui_state.place.focus_z = 0;
            return;
        }
        let best_i = 0;
        let best_d = Math.abs(Math.floor(Number(planes[0] ?? 0)) - target_plane);
        for (let i = 1; i < planes.length; i += 1) {
            const d = Math.abs(Math.floor(Number(planes[i] ?? 0)) - target_plane);
            if (d < best_d) {
                best_d = d;
                best_i = i;
            }
        }
        ui_state.place.focus_z = best_i;
    }

    function get_place_region_origin(place: Place | null | undefined): { x: number; y: number; z: number } | null {
        const origin = place?.region_bounds?.origin;
        if (!origin) return null;
        const x = Math.floor(Number(origin.x));
        const y = Math.floor(Number(origin.y));
        const z = Math.floor(Number(origin.z));
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
        return { x, y, z };
    }

    function sync_place_camera_focus_z(world_z: number): void {
        const place = get_render_place();
        const next_world_z = Math.floor(Number(world_z));
        if (!Number.isFinite(next_world_z)) return;
        ui_state.place.world_z_center = next_world_z;
        sync_place_focus_plane_from_anchor(place ? { x: undefined, y: undefined, z: next_world_z } : { z: next_world_z });
    }

    function get_candidate_follow_camera_places(): Place[] {
        const candidate_place_ids = [
            ui_state.place.actor_current_place_id,
            ui_state.place.current_place_id,
            ui_state.place.scene_selected_place_id,
        ].filter((id): id is string => typeof id === 'string' && id.length > 0);
        const visited = new Set<string>();
        const ordered_places: Place[] = [];
        for (const place_id of candidate_place_ids) {
            if (visited.has(place_id)) continue;
            const place = get_scene_place(place_id) ?? (ui_state.place.current_place?.id === place_id ? ui_state.place.current_place : null);
            if (!place) continue;
            visited.add(place_id);
            ordered_places.push(place);
        }
        for (const place of ui_state.place.scene_places) {
            if (!place?.id || visited.has(place.id)) continue;
            visited.add(place.id);
            ordered_places.push(place);
        }
        if (ui_state.place.current_place?.id && !visited.has(ui_state.place.current_place.id)) ordered_places.push(ui_state.place.current_place);

        return ordered_places;
    }

    function resolve_follow_camera_entity_place_id(entity_ref: string): string | null {
        if (!entity_ref) return null;
        for (const place of get_candidate_follow_camera_places()) {
            if (find_entity_in_place(place, entity_ref)) return place.id;
        }
        return null;
    }

    function get_place_center_tile(place: Place | null | undefined): { x: number; y: number } | null {
        if (!place) return null;
        const origin = get_place_region_origin(place);
        const size_x = Math.max(1, Math.floor(Number((place as any)?.region_bounds?.size?.x ?? (place as any)?.tile_grid?.width ?? 1)) || 1);
        const size_y = Math.max(1, Math.floor(Number((place as any)?.region_bounds?.size?.y ?? (place as any)?.tile_grid?.height ?? 1)) || 1);
        if (origin) {
            return {
                x: origin.x + Math.floor((size_x - 1) / 2),
                y: origin.y + Math.floor((size_y - 1) / 2),
            };
        }
        return {
            x: Math.floor((size_x - 1) / 2),
            y: Math.floor((size_y - 1) / 2),
        };
    }

    function center_camera_on_current_place(): void {
        const center = get_place_center_tile(get_render_place());
        if (!center) return;
        set_place_camera_target_position(center, 'free');
    }

    function resolve_follow_actor_camera_focus_region(): { place_id: string; region_x: number; region_y: number; world_z: number; local_x: number; local_y: number } | null {
        const actor_ref = get_follow_camera_entity_ref();
        if (!actor_ref) return null;

        for (const place of get_candidate_follow_camera_places()) {
            const focus = get_entity_focus_tile_in_place(place, actor_ref);
            if (!focus) continue;
            const origin = get_place_region_origin(place);
            if (!origin) {
                return {
                    place_id: place.id,
                    region_x: focus.x,
                    region_y: focus.y,
                    world_z: focus.z,
                    local_x: focus.x,
                    local_y: focus.y,
                };
            }
            return {
                place_id: place.id,
                region_x: origin.x + focus.x,
                region_y: origin.y + focus.y,
                world_z: focus.z,
                local_x: focus.x,
                local_y: focus.y,
            };
        }
        return null;
    }

    function snap_place_camera_follow_to_actor(): void {
        ui_state.place.camera_target.mode = 'follow_actor';
        ui_state.place.camera_target.tile = null;
        const target = resolve_follow_actor_camera_focus_region();
        if (!target) return;
        ui_state.place.camera_target.region_pose = {
            x: target.region_x,
            y: target.region_y,
            z: target.world_z,
        };
        ui_state.place.camera_target.last_follow_update_ms = Date.now();
        sync_place_focus_plane_from_anchor({ x: target.region_x, y: target.region_y, z: target.world_z });
        ui_state.place.world_z_center = Math.floor(target.world_z);
    }

    function update_place_camera_follow(now_ms: number): void {
        if (ui_state.place.camera_target.mode === 'free') return;
        const target = resolve_follow_actor_camera_focus_region();
        if (!target) return;
        const last_ms = Math.max(0, Math.floor(Number(ui_state.place.camera_target.last_follow_update_ms) || 0));
        const dt_ms = last_ms > 0 ? Math.max(1, now_ms - last_ms) : 16;
        ui_state.place.camera_target.last_follow_update_ms = now_ms;
        const dt = Math.max(0.001, Math.min(0.05, dt_ms / 1000));
        const pose = ui_state.place.camera_target.region_pose;
        if (!pose) {
            ui_state.place.camera_target.region_pose = { x: target.region_x, y: target.region_y, z: target.world_z };
            sync_place_focus_plane_from_anchor({ x: target.region_x, y: target.region_y, z: target.world_z });
            ui_state.place.world_z_center = Math.floor(target.world_z);
            return;
        }
        const follow_tau_xy = 0.10;
        const follow_tau_z = 0.14;
        const alpha_xy = 1 - Math.exp(-dt / follow_tau_xy);
        const alpha_z = 1 - Math.exp(-dt / follow_tau_z);
        pose.x += (target.region_x - pose.x) * alpha_xy;
        pose.y += (target.region_y - pose.y) * alpha_xy;
        pose.z += (target.world_z - pose.z) * alpha_z;
        ui_state.place.world_z_center = Math.floor(pose.z);
        sync_place_focus_plane_from_anchor({ x: pose.x, y: pose.y, z: pose.z });
    }

    function get_place_camera_target_position(): { x: number; y: number } | null {
        if (ui_state.place.camera_target.mode === 'free' && ui_state.place.camera_target.tile) {
            return { ...ui_state.place.camera_target.tile };
        }

        const pose = ui_state.place.camera_target.region_pose;
        const place = get_render_place();
        const origin = get_place_region_origin(place);
        if (pose && origin) {
            return {
                x: pose.x - origin.x,
                y: pose.y - origin.y,
            };
        }

        const focus = get_entity_focus_tile_in_place(place, get_follow_camera_entity_ref());
        if (!focus) return null;
        return { x: focus.x, y: focus.y };
    }

    function set_place_camera_target_position(tile: { x: number; y: number }, mode: 'follow_actor' | 'free' = 'free'): void {
        if (mode === 'free') {
            ui_state.place.camera_target.mode = 'free';
            ui_state.place.camera_target.tile = { x: Math.floor(tile.x), y: Math.floor(tile.y) };
            return;
        }
        snap_place_camera_follow_to_actor();
    }

    function get_entity_camera_anchor_world_z(entity: any, entity_ref: string, fallback_z: number): number {
        const focus = get_character_camera_focus_tile({
            entity,
            entity_ref,
            fallback_world_z: fallback_z,
        });
        return focus.z;
    }

    function get_drag_source_ground_elevation(): number | null {
        const src = String(drag_state.source_container_id ?? '');
        if (!src.startsWith('place.ground.')) return null;
        const parts = src.split('.');
        const pos = String(parts[3] ?? '');
        const [,, zs] = pos.split('_');
        const z = Number(zs);
        return Number.isFinite(z) ? Math.floor(z) : null;
    }

    function build_place_tile_container_id(place_id: string, tile_x: number, tile_y: number, world_z: number): string {
        return `place.tile.${place_id}.${Math.floor(tile_x)}_${Math.floor(tile_y)}_${Math.floor(world_z)}`;
    }

    function parse_place_tile_container_id(container_id: string): { place_id: string; x: number; y: number; z: number } | null {
        const parts = String(container_id ?? '').split('.');
        if (parts[0] !== 'place' || parts[1] !== 'tile' || !parts[2] || !parts[3]) return null;
        const [xs, ys, zs] = String(parts[3]).split('_');
        const x = Number(xs);
        const y = Number(ys);
        const z = Number(zs);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
        return { place_id: parts[2], x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) };
    }

    function is_tile_or_structure_container_at(place: Place, tile_x: number, tile_y: number, world_z: number): boolean {
        try {
            const base_z = Math.floor(Number((place as any)?.coordinates?.elevation ?? 0)) || 0;
            const target_z = Math.floor(world_z);
            const layer_offset = target_z - base_z;
            const tile_layer_key = layer_offset === 0 ? 'tiles' : `tiles_z${layer_offset}`;
            const t: any = (place as any)?.[tile_layer_key]?.cells?.[tile_y]?.[tile_x] ?? null;
            const is_tile_container = Array.isArray(t?.contents) || !!t?.container_capacity || !!t?.container_glyphs;
            if (is_tile_container) return true;

            const structs: any[] = Array.isArray((place as any)?.structures) ? (place as any).structures : [];
            for (const s of structs) {
                const origin = (s as any)?.origin;
                const ox = Number(origin?.x);
                const oy = Number(origin?.y);
                const oz0 = Number(origin?.z);
                if (!Number.isFinite(ox) || !Number.isFinite(oy)) continue;
                const oz = Number.isFinite(oz0) ? Math.floor(oz0) : base_z;

                const phys = Array.isArray((s as any)?.body_model?.physical)
                    ? (s as any).body_model.physical
                    : [{ dx: 0, dy: 0, dz: 0 }];
                let occupies = false;
                for (const v of phys) {
                    const vx = Math.floor(ox) + Math.floor(Number((v as any)?.dx ?? 0));
                    const vy = Math.floor(oy) + Math.floor(Number((v as any)?.dy ?? 0));
                    const vz = oz + Math.floor(Number((v as any)?.dz ?? 0));
                    if (vx === tile_x && vy === tile_y && vz === target_z) { occupies = true; break; }
                }
                if (!occupies) continue;

                if (Array.isArray((s as any).contents) || !!(s as any).container_capacity) return true;
                if (has_tag((s as any).tags, 'CONTAINER')) return true;
            }
            return false;
        } catch {
            return false;
        }
    }

    async function perform_drag_drop_into_tile_container(args: {
        place: Place;
        tile_x: number;
        tile_y: number;
        world_z: number;
        grid_x?: number;
        grid_y?: number;
    }): Promise<boolean> {
        if (!drag_state.is_dragging) return false;
        const place = args.place;
        const dest_container_id = build_place_tile_container_id(place.id, args.tile_x, args.tile_y, args.world_z);
        const src = String(drag_state.source_container_id ?? '');

        // One endpoint for everything: route through /api/transfer.
        const tx = await api_transfer_inline({
            actor_id: get_controlled_actor_id(),
            item_instance_id: String(drag_state.item_instance_id ?? ''),
            from_container: src,
            to_container: dest_container_id,
            target_grid_x: typeof args.grid_x === 'number' ? args.grid_x : undefined,
            target_grid_y: typeof args.grid_y === 'number' ? args.grid_y : undefined,
        });

        if (tx.ok) {
            flash_status(['Moved'], 900);
            drag_state.end_drag();
            await refresh_place_visual_state(place.id);
            void refresh_container_data();
            void refresh_character_data();
            return true;
        }

        flash_status([`Move failed: ${tx.error || 'unknown'}`], 1500);
        drag_state.reject_drag();
        return false;
    }

    const modules: Module[] = [
        // Action lock helpers for communicate/inspect during timed events.
        make_fill_module({
            id: 'bg',
            rect: { x0: 0, y0: 0, x1: APP_CONFIG.grid_width - 1, y1: APP_CONFIG.grid_height - 1 },
            char: '.',
            rgb: DEEP_RED,
            style: 'regular',
        }),

        make_place_module({
            id: 'place',
            rect: get_persisted_rect('place', { x0: L_X0, y0: Y_PLACE0, x1: L_X1, y1: Y_PLACE1 }),
            on_move: (new_rect) => persist_module_rect('place', new_rect),
            on_resize: (new_rect) => persist_module_rect('place', new_rect),
            on_move_end: (final_rect) => persist_module_rect('place', final_rect),
            on_resize_end: (final_rect) => persist_module_rect('place', final_rect),
            get_place: get_render_place,
            get_scene_places: () => ui_state.place.scene_places,
            get_scene_selected_place_id: () => ui_state.place.scene_selected_place_id,
            get_actor_current_place_id: () => ui_state.place.actor_current_place_id,
            get_scene_connector_hops_visible: () => ui_state.place.scene_connector_hops_visible,
            grid_height: APP_CONFIG.grid_height,
            get_grid_height: () => APP_CONFIG.grid_height,
            render_backend: APP_CONFIG.render_backend,
            render_theme_id: APP_CONFIG.render_theme_id,
            font_family: APP_CONFIG.font_family,
            base_font_size_px: APP_CONFIG.base_font_size_px,
            weight_index_to_css: APP_CONFIG.weight_index_to_css,
            get_focus_z: () => ui_state.place.focus_z,
            set_focus_z: (z) => { ui_state.place.focus_z = z; save_place_focus_z(); },
            get_principal_view: () => ui_state.place.principal_view,
            get_view_roll_quarter_turn: () => ui_state.place.view_roll_quarter_turn,
            get_use_focus_layer_opacity: () => ui_state.place.use_focus_layer_opacity,
            get_world_z_center: () => ui_state.place.world_z_center,
            get_mouse_parallax: () => ui_state.place.mouse_parallax,
            get_move_mode: () => ui_state.controls.move_mode,
            set_move_mode: (mode) => { ui_state.controls.move_mode = mode; },
            is_place_painter_active: () => ui_state.place_painter.active,
            get_place_painter_tool: () => ui_state.place_painter.selected_tool,
            get_place_painter_tool_for_button: (button) => get_place_painter_tool_for_button(button),
            get_place_painter_shape_preview: () => get_place_painter_shape_preview_points(),
            get_place_painter_resize_preview: () => ui_state.place_painter.resize_session ? {
                place_id: ui_state.place_painter.resize_session.place_id,
                face: ui_state.place_painter.resize_session.face,
                interaction: ui_state.place_painter.resize_session.phase,
                proposed_bounds: ui_state.place_painter.resize_session.proposed_bounds,
                valid: ui_state.place_painter.resize_session.valid,
                conflict_place_id: ui_state.place_painter.resize_session.conflict_place_id ?? null,
            } : null,
            get_place_painter_move_preview: () => ui_state.place_painter.move_drag_session ? {
                place_id: ui_state.place_painter.move_drag_session.place_id,
                entity_ref: ui_state.place_painter.move_drag_session.entity_ref,
                entity_type: ui_state.place_painter.move_drag_session.entity_type,
                display_char: ui_state.place_painter.move_drag_session.display_char,
                display_color: ui_state.place_painter.move_drag_session.display_color,
                body_model: ui_state.place_painter.move_drag_session.body_model ?? null,
                body_model_id: ui_state.place_painter.move_drag_session.body_model_id,
                facing: ui_state.place_painter.move_drag_session.facing ?? null,
                name: ui_state.place_painter.move_drag_session.name,
                tags: ui_state.place_painter.move_drag_session.tags ?? [],
                kind_id: ui_state.place_painter.move_drag_session.kind_id,
                entity_render: ui_state.place_painter.move_drag_session.entity_render,
                source: { x: ui_state.place_painter.move_drag_session.source_x, y: ui_state.place_painter.move_drag_session.source_y, z: ui_state.place_painter.move_drag_session.source_z },
                target: { x: ui_state.place_painter.move_drag_session.target_x, y: ui_state.place_painter.move_drag_session.target_y, z: ui_state.place_painter.move_drag_session.target_z },
                valid: ui_state.place_painter.move_drag_session.valid,
            } : null,
            get_place_painter_preview: () => {
                if (!ui_state.place_painter.active) return null;
                if (ui_state.place_painter.selected_palette_kind === 'item') {
                    const item = get_selected_place_painter_item_entry();
                    if (!item) return null;
                    return {
                        kind: 'item' as const,
                        id: item.id,
                        display_char: item.display_char,
                        display_color: item.display_color,
                    };
                }
                const tile = get_selected_place_painter_tile_entry();
                if (!tile) return null;
                return {
                    kind: 'tile' as const,
                    id: tile.id,
                    display_char: tile.display_char,
                    display_color: tile.display_color,
                    body_model: tile.body_model ?? null,
                };
            },
            on_place_painter_primary_action: handle_place_painter_primary_action,
            on_place_painter_shape_start: start_place_shape_drag,
            on_place_painter_shape_update: update_place_shape_drag,
            on_place_painter_shape_end: finish_place_shape_drag,
            on_place_painter_move_start: start_place_move_drag,
            on_place_painter_move_update: update_place_move_drag,
            on_place_painter_move_end: () => { void finish_place_move_drag(); },
            on_place_painter_resize_start: start_place_resize_session,
            on_place_painter_resize_update: update_place_resize_session,
            on_place_painter_resize_end: () => { void finish_place_resize_session(); },
            on_place_painter_resize_adjust_z: adjust_place_resize_session_z,
            get_camera_target_position: get_place_camera_target_position,
            get_camera_target_mode: () => ui_state.place.camera_target.mode,
            set_camera_target_position: set_place_camera_target_position,
            get_display_name_for_ref: (entity_ref: string) => get_entity_display_name(entity_ref),
            on_select_target: (target_ref: string): boolean => {
                // Check if this target exists in the available targets list
                const target = ui_state.controls.targets.find(t => 
                    t.ref.toLowerCase() === target_ref.toLowerCase()
                );
                
                if (target) {
                    ui_state.controls.selected_target = target.ref;
                    flash_status([`Target: ${get_entity_display_name(target.ref, target.label)}`], 1200);
                    
                    // Wire to backend communication system
                    // Determine entity type from ref
                    const entity_type = target_ref.startsWith('npc.') ? 'npc' : 
                                       target_ref.startsWith('actor.') ? 'actor' : 'item';
                    
                    // Call backend handler to set target for communication
                    try {
                        handleEntityClick(target_ref, entity_type as "npc" | "actor" | "item");
                        console.log(`[AppState] Wired target to backend: ${target_ref}`);
                    } catch (err) {
                        console.error(`[AppState] Failed to wire target: ${err}`);
                    }
                    
                    return true;
                }
                
                // Target not in available list - could be out of range or not visible
                return false;
            },
            // Server-authoritative movement: renderer does not persist actor position.
            // (Movement intent/goal is sent via /api/movement/* and stepping is server-side.)
            on_actor_move: async () => {
                return;
            },
            on_inspect: async (target): Promise<void> => {
                // Inspection from place module (right-click) routes through backend.
                const place = get_current_place();
                if (!place) {
                    flash_status(['No place loaded'], 1200);
                    return;
                }

                const normalized = normalize_inspect_target(target);
                const target_ref = normalized.target_ref;

                if (!target_ref) {
                    flash_status(['Cannot inspect - no target'], 1200);
                    return;
                }

                const target_desc = normalized.target_desc;

                const gate = get_timed_event_action_gate('INSPECT');
                if (gate.locked) {
                    flash_status([format_action_gate_reason(gate.reason, gate.action_cost)], 1200);
                    return;
                }

                flash_status([`Inspecting ${target_desc}...`], 1200);

                try {
                    const res = await fetch(APP_CONFIG.action_input_endpoint, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            session_token: get_session_token(),
                            text: 'inspect',
                            sender: get_controlled_actor_id(),
                            intent_verb: 'INSPECT',
                            target_ref,
                            ui_target_tile: normalized.ui_target_tile,
                            action_cost: ui_state.controls.override_cost ?? undefined,
                        }),
                    });

                    if (!res.ok) {
                        flash_status([`Inspect failed (HTTP ${res.status})`], 2000);
                        return;
                    }

                    const data = (await res.json()) as { ok: boolean; id?: string };
                    if (data.ok && typeof data.id === 'string') {
                        ui_state.controls.last_sent_input_id = data.id;
                        void poll_window_feeds();
                    }
                } catch (err) {
                    debug_warn('[app_state]', 'Inspection request failed:', err);
                    flash_status(['Inspect failed - check console'], 2000);
                }
            },
            on_open_tile_container: (tile_x: number, tile_y: number, world_z: number): void => {
                const place = get_current_place();
                if (!place) return;
                const cid = build_place_tile_container_id(place.id, tile_x, tile_y, world_z);
                void open_owner_inventory_view(cid);
            },
            border_rgb: get_color_by_name('light_gray').rgb,
            bg_rgb: get_color_by_name('off_black').rgb,
            npc_rgb: get_color_by_name('vivid_yellow').rgb,  // Brighter yellow for visibility
            actor_rgb: get_color_by_name('vivid_green').rgb,
            grid_rgb: get_color_by_name('medium_gray').rgb,
            initial_scale: 1,
            
            // Phase 2: Double-click callbacks
            get_actor_position: () => {
                const place = get_current_place();
                if (!place) return null;
                const player = get_controlled_actor_snapshot(place);
                return player ? { x: player.tile_position.x, y: player.tile_position.y } : null;
            },
            get_controlled_actor_ref: () => get_input_actor_ref() || null,
            get_session_token: () => get_session_token() || null,
            request_scene_place_refresh: (place_id: string) => { void refresh_single_scene_place(place_id); },
            on_double_click_npc: (npc_ref: string) => {
                debug_log(`[PlaceModule] Double-click on NPC: ${npc_ref}`);
                // Look up NPC to get name
                const place = get_current_place();
                if (!place) return;
                const npc = place.contents.npcs_present.find((n: any) => n.npc_ref === npc_ref);
                if (!npc) return;
                const npc_name = get_entity_display_name(npc_ref);
                // Open NPC character module
                void open_npc_character_module(npc_ref, npc_name);
            },
            on_double_click_ground: (tile_x: number, tile_y: number) => {
                debug_log(`[PlaceModule] === DOUBLE-CLICK ON GROUND at (${tile_x}, ${tile_y}) ===`);
                const place = get_current_place();
                if (!place) return;

                 const focus_wz = get_focus_world_z_for_current_place();
                 const base_z = Math.floor(Number((place as any)?.coordinates?.elevation ?? 0)) || 0;

                 const voxel_key = `${tile_x}_${tile_y}_${focus_wz}`;
                 const item_ids = ui_state.place.ground_items_by_voxel.get(voxel_key) ?? [];

                // Multiple items => open pile UI
                 if (item_ids.length >= 2) {
                     const pile_id = `place.pile.${place.id}.${voxel_key}`;
                     void open_owner_inventory_view(pile_id);
                     return;
                 }

                // Single item => open if container-item; otherwise attempt pickup into default.
                if (item_ids.length === 1) {
                    const item_id = item_ids[0]!;
                    const meta = ui_state.place.ground_items_by_id.get(item_id);
                    if (!meta) return;

                    const def: ItemDefinition = {
                        id: meta.def_id,
                        name: meta.name,
                        description: '',
                        weight: meta.weight,
                        weight_mag: 0,
                        mag: 1,
                        size_mag: 0,
                        hardness_mag: 0,
                        conductivity_mag: 0,
                        tags: meta.tags as any,
                        max_stack_size: 1,
                        display_char: '·',
                        occupies_slots: [],
                        slot_shape: [[1]],
                        fits_actor_kind: ['*'],
                    };

                     if (is_container_item(def)) {
                         const cid = `place.item.${place.id}.${item_id}`;
                         void open_owner_inventory_view(cid);
                         return;
                     }

                    void (async () => {
                        const target = await get_default_pickup_target_container_id();
                        if (!target) {
                            flash_status(['No free hands and no equipped container'], 2000);
                            return;
                        }

                        const from_container = `place.ground.${place.id}.${voxel_key}`;
                        const data = await api_transfer_inline({
                            actor_id: get_controlled_actor_id(),
                            item_instance_id: String(item_id),
                            from_container,
                            to_container: target,
                        });

                        if (!data.ok) {
                            const err = data.error ? String(data.error) : 'unknown error';
                            flash_status([`Cannot pick up: ${err}`], 2200);
                            return;
                        }

                        flash_status([`Picked up ${meta.name}`], 1500);
                        await refresh_place_visual_state(place.id);
                        void refresh_character_data();
                        void refresh_container_data();
                    })();
                    return;
                }
            },

            on_drag_start_ground_item: (tile_x: number, tile_y: number) => {
                const place = get_current_place();
                if (!place) return;
                const focus_wz = get_focus_world_z_for_current_place();
                const voxel_key = `${tile_x}_${tile_y}_${focus_wz}`;
                const item_ids = ui_state.place.ground_items_by_voxel.get(voxel_key) ?? [];
                if (item_ids.length < 1) return;

                // 2+ items on a tile: drag the whole pile (sweep).
                if (item_ids.length >= 2) {
                    const pile_def: ItemDefinition = {
                        id: 'pile',
                        name: `Pile (${item_ids.length})`,
                        description: '',
                        weight: 0,
                        weight_mag: 0,
                        mag: 1,
                        size_mag: 0,
                        hardness_mag: 0,
                        conductivity_mag: 0,
                        tags: [],
                        max_stack_size: 1,
                        display_char: item_ids.length > 10 ? '#' : '*',
                        occupies_slots: [],
                        slot_shape: [[1]],
                        fits_actor_kind: ['*'],
                    };
                    drag_state.start_drag('ground', `pile:${place.id}:${voxel_key}`, `place.pile.${place.id}.${voxel_key}`, pile_def);
                    ui_state.character.highlighted_slots = [];
                    return;
                }

                // Single item: drag that item.
                const item_id = item_ids[0]!;
                const meta: any = ui_state.place.ground_items_by_id.get(item_id);
                if (!meta) return;
                const meta_voxel_key = (meta.position && typeof meta.elevation === 'number')
                    ? `${meta.position.x}_${meta.position.y}_${Math.floor(meta.elevation)}`
                    : voxel_key;
                if (meta_voxel_key !== voxel_key) {
                    debug_log(`[GROUND_DRAG] drag source voxel corrected ${JSON.stringify({ item_id, clicked_voxel_key: voxel_key, meta_voxel_key })}`);
                }

                const def: ItemDefinition = {
                    id: meta.def_id,
                    name: meta.name,
                    description: '',
                    weight: meta.weight,
                    weight_mag: 0,
                    mag: 1,
                    size_mag: 0,
                    hardness_mag: 0,
                    conductivity_mag: 0,
                    tags: meta.tags as any,
                    max_stack_size: 1,
                    display_char: (typeof meta.display_char === 'string' && meta.display_char.length > 0) ? meta.display_char : '·',
                    occupies_slots: [],
                    slot_shape: [[1]],
                    fits_actor_kind: ['*'],
                };

                drag_state.start_drag('ground', item_id, `place.ground.${place.id}.${meta_voxel_key}`, def);
                void (async () => {
                    await apply_item_legality_highlight(item_id, `place.ground.${place.id}.${meta_voxel_key}`, def, `place.ground.${place.id}.${meta_voxel_key}`);
                })();
            },

            on_hover_ground_item: (_tile_x: number, _tile_y: number, item_id: string | null) => {
                if (!item_id) {
                    ui_state.character.highlighted_slots = [];
                    return;
                }
                const meta = ui_state.place.ground_items_by_id.get(item_id);
                if (!meta) {
                    ui_state.character.highlighted_slots = [];
                    return;
                }

                const def: ItemDefinition = {
                    id: meta.def_id,
                    name: meta.name,
                    description: '',
                    weight: meta.weight,
                    weight_mag: 0,
                    mag: 1,
                    size_mag: 0,
                    hardness_mag: 0,
                    conductivity_mag: 0,
                    tags: meta.tags as any,
                    max_stack_size: 1,
                    display_char: '·',
                    occupies_slots: [],
                    slot_shape: [[1]],
                    fits_actor_kind: ['*'],
                };

                void (async () => {
                    const place = get_current_place();
                    const source = place ? `place.ground.${place.id}` : 'place.ground';
                    await apply_item_legality_highlight(item_id, source, def, source);
                })();
            },

            // Single source of truth for ground items in the PlaceModule.
            // Rendering + interaction should use the same cache (ui_state.place.ground_items_by_*).
            get_ground_item_position_keys: (place_id: string): string[] => {
                return Array.from((ui_state.place.ground_item_caches_by_place.get(place_id)?.by_voxel ?? new Map()).keys());
            },

            get_ground_item_ids_at: (place_id: string, tile_x: number, tile_y: number): string[] => {
                return ui_state.place.ground_item_caches_by_place.get(place_id)?.by_position.get(`${tile_x}_${tile_y}`) ?? [];
            },
            get_ground_item_meta: (place_id: string, item_instance_id: string): any | null => {
                return ui_state.place.ground_item_caches_by_place.get(place_id)?.by_id.get(item_instance_id) ?? null;
            },

            get_open_containers: () => ui_state.container.open_containers,

            // Drag and drop callbacks for dropping items onto ground
            is_dragging: () => {
                const dragging = drag_state.is_dragging;
                debug_log(`[PlaceModule] is_dragging() called: ${dragging}`);
                return dragging;
            },

            get_drag_source: () => {
                debug_log(`[PlaceModule] get_drag_source() called`);
                if (!drag_state.is_dragging) {
                    debug_log(`[PlaceModule] get_drag_source: not dragging, returning null`);
                    return null;
                }
                if (!drag_state.item_instance_id || !drag_state.source_container_id) {
                    debug_log(`[PlaceModule] get_drag_source: missing item or container id, returning null`);
                    return null;
                }
                const source = {
                    item_instance_id: drag_state.item_instance_id,
                    source_container_id: drag_state.source_container_id
                };
                debug_log(`[PlaceModule] get_drag_source: ${JSON.stringify(source)}`);
                return source;
            },

            on_drop: async (tile_x: number, tile_y: number): Promise<boolean> => {
                debug_log(`[PlaceModule] ========== on_drop called ==========`);
                debug_log(`[PlaceModule] Target tile: (${tile_x}, ${tile_y})`);
                debug_log(`[PlaceModule] Drag state: is_dragging=${drag_state.is_dragging}, source_module=${drag_state.source_module}`);
                debug_log(`[PlaceModule] Item: ${drag_state.item_instance_id} from ${drag_state.source_container_id}`);

                if (!drag_state.is_dragging) {
                    debug_log(`[PlaceModule] on_drop: Not dragging - rejecting`);
                    return false;
                }

                // Priority: dropping onto a tile/structure container should deposit into it.
                // This must happen before any ground-drag handling (which otherwise interprets the drop as a ground move).
                try {
                    const place0 = get_current_place();
                    if (place0) {
                        const focus_wz0 = get_focus_world_z_for_current_place();
                        if (is_tile_or_structure_container_at(place0, tile_x, tile_y, focus_wz0)) {
                            return await perform_drag_drop_into_tile_container({ place: place0, tile_x, tile_y, world_z: focus_wz0 });
                        }
                    }
                } catch (err) {
                    debug_warn('[PlaceModule]', 'perform_drag_drop_into_tile_container failed', err);
                    drag_state.reject_drag();
                    return false;
                }

                // If the drag source is a pile UI (ContainerModule), treat it as a place-sourced single-item move.
                // This prevents actor-only /api/place/items/drop from being called for ground items.
                const src_container_id = String(drag_state.source_container_id ?? '');
                if ((src_container_id.startsWith('place.pile.') || src_container_id.startsWith('place.ground.')) && !String(drag_state.item_instance_id ?? '').startsWith('pile:')) {
                    const parts = src_container_id.split('.');
                    const place_id = parts.length >= 4 ? parts[2] : null;
                    const position_key = parts.length >= 4 ? parts[3] : null;
                    const source_z = get_drag_source_ground_elevation() ?? get_focus_world_z_for_current_place();
                    const focus_z = get_focus_world_z_for_current_place();
                    const target_z = focus_z !== source_z ? focus_z : source_z;
                    if (!place_id || !position_key) {
                        drag_state.reject_drag();
                        return false;
                    }
                    const dest_key = `${tile_x}_${tile_y}_${target_z}`;
                    if (position_key === dest_key) {
                        drag_state.end_drag();
                        return true;
                    }
                    try {
                        const to_key = `${tile_x}_${tile_y}_${target_z}`;
                        const mv = await api_transfer_inline({
                            actor_id: get_controlled_actor_id(),
                            item_instance_id: String(drag_state.item_instance_id ?? ''),
                            from_container: src_container_id,
                            to_container: `place.ground.${place_id}.${to_key}`,
                        });
                        if (mv.ok) {
                            const moved_item_id = String(drag_state.item_instance_id ?? '');
                            apply_local_ground_item_move(moved_item_id, tile_x, tile_y, target_z, place_id);
                            log_ground_item_cache_position('pre-refresh optimistic check', moved_item_id, tile_x, tile_y, target_z, place_id);
                            flash_status(['Dragged'], 900);
                            drag_state.end_drag();
                            await refresh_place_visual_state(place_id);
                            log_ground_item_cache_position('post-refresh authoritative check', moved_item_id, tile_x, tile_y, target_z, place_id);
                            void refresh_container_data();
                            return true;
                        }
                        flash_status([`Cannot drag: ${mv.error}`, format_legality_detail(mv.detail)], 2500);
                        drag_state.reject_drag();
                        return false;
                    } catch {
                        flash_status(['Cannot drag'], 2000);
                        drag_state.reject_drag();
                        return false;
                    }
                }

                // Ground-item drags are pickup-only; dropping back on the origin cancels.
                if (drag_state.source_module === 'ground') {
                    const src = String(drag_state.source_container_id ?? '');
                    const parts = src.split('.');
                    const kind = parts[1];
                    const source_z = get_drag_source_ground_elevation() ?? get_focus_world_z_for_current_place();
                    const focus_z = get_focus_world_z_for_current_place();
                    const target_z = focus_z !== source_z ? focus_z : source_z;
                    // place.ground.<place_id>.<x_y> OR place.pile.<place_id>.<x_y>
                    const place_id = parts.length >= 4 ? parts[2] : null;
                    const position_key = parts.length >= 4 ? parts[3] : null;
                    if (!place_id || !position_key) {
                        drag_state.reject_drag();
                        return false;
                    }

                    const dest_key = `${tile_x}_${tile_y}_${target_z}`;
                    if (position_key === dest_key) {
                        drag_state.end_drag();
                        return true;
                    }

                    // Dragging a pile/item within the place: use /api/transfer.
                    try {
                        const to_key = `${tile_x}_${tile_y}_${target_z}`;
                        const mv = await api_transfer_inline({
                            actor_id: get_controlled_actor_id(),
                            item_instance_id: String(drag_state.item_instance_id ?? ''),
                            from_container: src,
                            to_container: `place.ground.${place_id}.${to_key}`,
                        });
                        if (mv.ok) {
                            const moved_item_id = String(drag_state.item_instance_id ?? '');
                            apply_local_ground_item_move(moved_item_id, tile_x, tile_y, target_z, place_id);
                            log_ground_item_cache_position('pre-refresh optimistic check', moved_item_id, tile_x, tile_y, target_z, place_id);
                            flash_status(['Dragged'], 900);
                            drag_state.end_drag();
                            await refresh_place_visual_state(place_id);
                            log_ground_item_cache_position('post-refresh authoritative check', moved_item_id, tile_x, tile_y, target_z, place_id);
                            void refresh_container_data();
                            return true;
                        }
                        flash_status([`Cannot drag: ${mv.error}`, format_legality_detail(mv.detail)], 2500);
                        drag_state.reject_drag();
                        return false;
                    } catch {
                        flash_status(['Cannot drag'], 2000);
                        drag_state.reject_drag();
                        return false;
                    }
                }

                const place = get_current_place();
                if (!place) {
                    debug_log(`[PlaceModule] on_drop: No place loaded - rejecting`);
                    return false;
                }
                debug_log(`[PlaceModule] on_drop: Place is ${place.id}`);

                // Shortcut: dropping an item onto a ground container-item deposits into it.
                // Only when exactly one ground item exists on that tile and it is a container.
                const focus_wz = get_focus_world_z_for_current_place();
                const position_key = `${tile_x}_${tile_y}_${focus_wz}`;
                    const ground_ids = ui_state.place.ground_items_by_voxel.get(position_key) ?? [];
                    if (ground_ids.length === 1) {
                        const ground_item_id = ground_ids[0]!;
                        const meta = ui_state.place.ground_items_by_id.get(ground_item_id);
                        const is_container = has_tag(meta?.tags, 'CONTAINER');
                        if (is_container) {
                        // Prevent depositing a container into itself.
                        if (drag_state.item_instance_id === ground_item_id) {
                            flash_status(['Cannot deposit a container into itself'], 1500);
                            drag_state.reject_drag();
                            return false;
                        }

                        try {
                            const src = String(drag_state.source_container_id ?? '');

                            if (src.startsWith('place.pile.') && String(drag_state.item_instance_id ?? '').startsWith('pile:')) {
                                flash_status(['Open the pile and drag a specific item out'], 2000);
                                drag_state.reject_drag();
                                return false;
                            }

                            // One endpoint for everything: route through /api/transfer.
                            const dest = `place.item.${place.id}.${ground_item_id}`;
                            const tx = await api_transfer_inline({
                                actor_id: get_controlled_actor_id(),
                                item_instance_id: String(drag_state.item_instance_id ?? ''),
                                from_container: src,
                                to_container: dest,
                            });

                            if (tx.ok) {
                                flash_status([`Moved into ${meta?.name ?? 'container'}`], 1500);
                                drag_state.end_drag();
                                await refresh_place_visual_state(place.id);
                                void refresh_container_data();
                                void refresh_character_data();
                                return true;
                            }

                            flash_status([`Cannot deposit: ${tx.error || 'unknown error'}`], 2000);
                            drag_state.reject_drag();
                            return false;
                        } catch (err) {
                            debug_warn('[PlaceModule]', 'deposit_to_container_item failed', err);
                            flash_status(['Cannot deposit'], 2000);
                            drag_state.reject_drag();
                            return false;
                        }
                    }
                }

                // Place container (ground container-item / tile container) -> ground tile: spill to ground.
                const spill_src = String(drag_state.source_container_id ?? '');
                if (spill_src.startsWith('place.item.')) {
                    try {
                        const to_z = get_drag_source_ground_elevation() ?? get_focus_world_z_for_current_place();
                        const to_container = `place.ground.${place.id}.${tile_x}_${tile_y}_${to_z}`;
                        const sp = await api_transfer_inline({
                            actor_id: get_controlled_actor_id(),
                            item_instance_id: String(drag_state.item_instance_id ?? ''),
                            from_container: spill_src,
                            to_container,
                        });
                        if (sp.ok) {
                            flash_status(['Dropped'], 1200);
                            drag_state.end_drag();
                            await refresh_place_visual_state(place.id);
                            void refresh_container_data();
                            void refresh_character_data();
                            return true;
                        }
                        flash_status([`Cannot drop: ${sp.error}`], 2000);
                        drag_state.reject_drag();
                        return false;
                    } catch {
                        flash_status(['Cannot drop'], 2000);
                        drag_state.reject_drag();
                        return false;
                    }
                }

                if (spill_src.startsWith('place.tile.')) {
                    try {
                        const to_z = get_focus_world_z_for_current_place();
                        const to_container = `place.ground.${place.id}.${tile_x}_${tile_y}_${to_z}`;
                        const sp = await api_transfer_inline({
                            actor_id: get_controlled_actor_id(),
                            item_instance_id: String(drag_state.item_instance_id ?? ''),
                            from_container: spill_src,
                            to_container,
                        });

                        if (sp.ok) {
                            flash_status(['Dropped'], 1200);
                            drag_state.end_drag();
                            await refresh_place_visual_state(place.id);
                            void refresh_container_data();
                            void refresh_character_data();
                            return true;
                        }
                        flash_status([`Cannot drop: ${sp.error || 'unknown'}`], 2000);
                        drag_state.reject_drag();
                        return false;
                    } catch {
                        flash_status(['Cannot drop'], 2000);
                        drag_state.reject_drag();
                        return false;
                    }
                }

                // Get actor position for distance check
                const actor = get_controlled_actor_snapshot(place);
                if (!actor) {
                    debug_log(`[PlaceModule] on_drop: No actor present - rejecting`);
                    return false;
                }

                // Distance validation is now handled by backend (cardinal adjacency check)
                // Frontend accepts drops anywhere and lets backend validate

                try {
                    const actor_id = get_controlled_actor_id();
                    const to_z = get_drag_source_ground_elevation() ?? get_focus_world_z_for_current_place();
                    const to_container = `place.ground.${place.id}.${tile_x}_${tile_y}_${to_z}`;
                    const drop_res = await api_transfer_inline({
                        actor_id,
                        item_instance_id: String(drag_state.item_instance_id ?? ''),
                        from_container: String(drag_state.source_container_id ?? ''),
                        to_container,
                    });

                    debug_log(`[PlaceModule] on_drop: Response data: ${JSON.stringify(drop_res)}`);

                    if (drop_res.ok) {
                        debug_log(`[PlaceModule] on_drop: SUCCESS!`);
                        flash_status([`Dropped item at (${tile_x}, ${tile_y})`], 1500);
                        // Refresh place view to show dropped item
                        await refresh_place_visual_state(place.id);
                        // BUG FIX: Refresh source container to remove item from inventory display
                        void refresh_container_data();
                        // Clear drag state
                        drag_state.is_dragging = false;
                        drag_state.item_instance_id = null;
                        drag_state.source_container_id = null;
                        drag_state.item_definition = null;
                        drag_state.source_module = null;
                        return true;
                    } else {
                        debug_log(`[PlaceModule] on_drop: API returned error: ${drop_res.error}`);
                        if (drop_res.detail) {
                            debug_log(`[PlaceModule] on_drop: API returned detail: ${JSON.stringify(drop_res.detail)}`);
                        }
                        drag_state.reject_drag();
                        flash_status([`Cannot drop: ${drop_res.error}`, format_legality_detail(drop_res.detail)], 2500);
                        return false;
                    }
                } catch (err) {
                    debug_log(`[PlaceModule] on_drop: Exception: ${err}`);
                    drag_state.reject_drag();
                    flash_status([`Drop failed: ${err}`], 2500);
                    return false;
                }
            },

            on_throw: async (tile_x: number, tile_y: number): Promise<boolean> => {
                debug_log(`[PlaceModule] ========== on_throw called ==========`);
                debug_log(`[PlaceModule] Target tile: (${tile_x}, ${tile_y})`);
                debug_log(`[PlaceModule] Drag state: is_dragging=${drag_state.is_dragging}, source_module=${drag_state.source_module}`);
                debug_log(`[PlaceModule] Item: ${drag_state.item_instance_id} from ${drag_state.source_container_id}`);

                if (!drag_state.is_dragging) {
                    debug_log(`[PlaceModule] on_throw: Not dragging - rejecting`);
                    return false;
                }

                const place = get_current_place();
                if (!place) {
                    debug_log(`[PlaceModule] on_throw: No place loaded - rejecting`);
                    return false;
                }
                debug_log(`[PlaceModule] on_throw: Place is ${place.id}`);

                // Get actor
                const actor = get_controlled_actor_snapshot(place);
                if (!actor) {
                    debug_log(`[PlaceModule] on_throw: No actor present - rejecting`);
                    return false;
                }

                // Only allow throwing from a hand tool slot.
                // source_container_id format: body_slots.<slot_name>.<slot_type>[.<index>]
                const from_container = String(drag_state.source_container_id ?? '');
                const parts = from_container.split('.');
                const slot_name = parts[0] === 'body_slots' ? String(parts[1] ?? '') : '';
                const slot_type = parts[0] === 'body_slots' ? String(parts[2] ?? '') : '';

                if (slot_type !== 'tool' || (slot_name !== 'hand_left' && slot_name !== 'hand_right')) {
                    debug_log(`[PlaceModule] on_throw: Invalid throw source ${from_container}`);
                    drag_state.reject_drag();
                    flash_status([`Cannot throw: must be holding item in hand`], 2000);
                    return false;
                }

                const actor_id = get_controlled_actor_id();
                const to_z = get_focus_world_z_for_current_place();
                const to_container = `place.ground.${place.id}.${tile_x}_${tile_y}_${to_z}`;

                try {
                    const throw_res = await api_transfer_inline({
                        transfer_mode: 'throw',
                        actor_id,
                        item_instance_id: String(drag_state.item_instance_id ?? ''),
                        from_container,
                        to_container,
                    });

                    debug_log(`[PlaceModule] on_throw: Response data: ${JSON.stringify(throw_res)}`);

                    if (throw_res.ok) {
                        debug_log(`[PlaceModule] on_throw: SUCCESS!`);
                        flash_status([`Threw item to (${tile_x}, ${tile_y})`], 1500);
                        await refresh_place_visual_state(place.id);
                        void refresh_character_data();
                        drag_state.end_drag();
                        return true;
                    }

                    debug_log(`[PlaceModule] on_throw: API returned error: ${throw_res.error}`);
                    drag_state.reject_drag();
                    flash_status([`Cannot throw: ${throw_res.error}`], 2000);
                    return false;
                } catch (err) {
                    debug_log(`[PlaceModule] on_throw: Exception: ${err}`);
                    drag_state.reject_drag();
                    flash_status([`Throw failed: ${err}`], 2000);
                    return false;
                }
            },
        }),

        // System status bar (includes time prefix)
        make_text_window_module({
            id: 'status',
            rect: get_persisted_rect('status', { x0: L_X0, y0: Y_SYS0, x1: L_X1, y1: Y_SYS1 }),
            get_source: () => ui_state.text_windows.get('status') ?? { messages: [], rev: 0 },
            border_rgb: get_color_by_name('medium_gray').rgb,
            text_rgb: get_color_by_name('pale_gray').rgb,
            bg: { char: ' ', rgb: get_color_by_name('off_black').rgb },
            base_weight_index: 0,
            title: 'STATUS',
            gizmos: {
                enabled: ['move', 'resize', 'close', 'seamless'],
                can_close: true,
                can_move: true,
                can_save_position: false,
                on_close: () => set_module_visible('status', false),
                on_move: (new_rect) => persist_module_rect('status', new_rect),
                on_move_end: (final_rect) => persist_module_rect('status', final_rect),
                on_resize: (new_rect) => persist_module_rect('status', new_rect),
                on_resize_end: (final_rect) => persist_module_rect('status', final_rect),
            },
        }),

        make_text_window_module({
            id: 'transcript',
            rect: get_persisted_rect('transcript', { x0: L_X0, y0: Y_TRANSCRIPT0, x1: L_X1, y1: Y_TRANSCRIPT1 }),
            get_source: () => ui_state.text_windows.get('transcript') ?? { messages: [], rev: 0 },
            border_rgb: get_color_by_name('light_gray').rgb,
            text_rgb: get_color_by_name('off_white').rgb,
            bg: { char: ' ', rgb: get_color_by_name('off_black').rgb },
            base_weight_index: 0,
            hint_rgb: get_color_by_name('pale_yellow').rgb,
            npc_rgb: get_color_by_name('pumpkin').rgb,
            state_rgb: get_color_by_name('dark_gray').rgb,
            title: 'TRANSCRIPT',
            gizmos: {
                enabled: ['move', 'resize', 'close', 'seamless'],
                can_close: true,
                can_move: true,
                can_save_position: false,
                on_close: () => set_module_visible('transcript', false),
                on_move: (new_rect) => persist_module_rect('transcript', new_rect),
                on_move_end: (final_rect) => persist_module_rect('transcript', final_rect),
                on_resize: (new_rect) => persist_module_rect('transcript', new_rect),
                on_resize_end: (final_rect) => persist_module_rect('transcript', final_rect),
            },
        }),

        make_input_module({
            id: 'input',
            rect: get_persisted_rect('input', { x0: L_X0, y0: Y_INPUT0, x1: L_X1, y1: Y_INPUT1 }),
            target_id: 'transcript',
            on_submit: (target_id, message) => {
                void send_action_input(message);
            },
            on_change: (message) => {
                ui_state.controls.draft = message;
                // Debounce inference (1s after user stops typing)
                if (ui_state.controls.last_infer_timer) {
                    clearTimeout(ui_state.controls.last_infer_timer);
                }
                ui_state.controls.last_infer_timer = window.setTimeout(() => {
                    const hint = infer_action_verb_hint(ui_state.controls.draft);
                    ui_state.controls.suggested_intent = hint.verb ? hint.verb : null;
                    ui_state.controls.suggested_matched = hint.matched_keyword ?? null;
                }, 1000);
            },
            border_rgb: get_color_by_name('light_gray').rgb,
            text_rgb: get_color_by_name('off_white').rgb,
            cursor_rgb: get_color_by_name('off_white').rgb,
            bg: { char: ' ', rgb: get_color_by_name('off_black').rgb },
            base_weight_index: 0,
            placeholder: 'Type… (Enter=send, Shift+Enter=new line, Backspace=delete)',
            header_buttons: [
                { id: 'vol_whisper', label: 'WSP', width: 5, on_press: () => { ui_state.controls.volume = 'WHISPER'; flash_status(['volume: WHISPER'], 800); }, is_active: () => ui_state.controls.volume === 'WHISPER' },
                { id: 'vol_normal', label: 'NRM', width: 5, on_press: () => { ui_state.controls.volume = 'NORMAL'; flash_status(['volume: NORMAL'], 800); }, is_active: () => ui_state.controls.volume === 'NORMAL' },
                { id: 'vol_shout', label: 'SHT', width: 5, on_press: () => { ui_state.controls.volume = 'SHOUT'; flash_status(['volume: SHOUT'], 800); }, is_active: () => ui_state.controls.volume === 'SHOUT' },
            ],
            gizmos: {
                enabled: ['move', 'resize', 'close', 'seamless'],
                can_close: true,
                can_move: true,
                can_save_position: false,
                on_close: () => set_module_visible('input', false),
                on_move: (new_rect) => persist_module_rect('input', new_rect),
                on_move_end: (final_rect) => persist_module_rect('input', final_rect),
                on_resize: (new_rect) => persist_module_rect('input', new_rect),
                on_resize_end: (final_rect) => persist_module_rect('input', final_rect),
            },
        }),

        // Debug reader window (always visible)
        make_text_window_module({
            id: 'debug',
            rect: get_persisted_rect('debug', { x0: R_X0, y0: Y_PLACE0, x1: R_X1, y1: Y_PLACE1 }),
            get_source: () => ui_state.text_windows.get('debug') ?? { messages: [], rev: 0 },
            border_rgb: get_color_by_name('light_gray').rgb,
            text_rgb: get_color_by_name('off_white').rgb,
            bg: { char: ' ', rgb: get_color_by_name('off_black').rgb },
            base_weight_index: 0,
            hint_rgb: get_color_by_name('pale_yellow').rgb,
            npc_rgb: get_color_by_name('pumpkin').rgb,
            state_rgb: get_color_by_name('dark_gray').rgb,
            title: 'DEBUG',
            gizmos: {
                enabled: ['close', 'move', 'resize', 'seamless'],
                can_close: true,
                can_move: true,
                can_save_position: false,
                on_close: () => {
                    set_module_visible('debug', false);
                    flash_status(['Debug hidden'], 800);
                },
                on_move: (new_rect) => {
                    ui_state.modules.positions.set('debug', new_rect);
                    persist_module_layout_debounced();
                },
                on_move_end: (final_rect) => {
                    ui_state.modules.positions.set('debug', final_rect);
                    persist_module_layout_debounced();
                },
                on_resize: (new_rect) => {
                    ui_state.modules.positions.set('debug', new_rect);
                    persist_module_layout_debounced();
                },
                on_resize_end: (final_rect) => {
                    ui_state.modules.positions.set('debug', final_rect);
                    persist_module_layout_debounced();
                },
            },
        }),

        make_initiative_module({
            id: 'initiative',
            rect: get_persisted_rect('initiative', { x0: R_X0 + 4, y0: Y_PLACE0 + 8, x1: R_X1, y1: Y_PLACE1 }),
            get_state: () => ({
                active: ui_state.timed_event_debug.active,
                type: ui_state.timed_event_debug.type,
                phase: ui_state.timed_event_debug.phase,
                current_turn: ui_state.timed_event_debug.current_turn,
                current_round: ui_state.timed_event_debug.current_round,
                active_actor_ref: ui_state.timed_event_debug.active_actor_ref,
                controlled_actor_ref: get_input_actor_ref(),
                turn_window_breaths: ui_state.timed_event_debug.turn_window_breaths,
                turn_breaths_remaining: ui_state.timed_event_debug.turn_breaths_remaining,
                timed_event_world_breath_index: ui_state.timed_event_debug.timed_event_world_breath_index,
                initiative_order: ui_state.timed_event_debug.initiative_order.map((entry) => ({
                    actor_ref: entry.actor_ref,
                    initiative_roll: entry.initiative_roll,
                    status: entry.status,
                })),
            }),
            on_close: () => {
                set_module_visible('initiative', false);
                flash_status(['Initiative hidden'], 800);
            },
            on_end_turn: () => {
                void (async () => {
                    const result = await advance_timed_event_turn_for_controlled_actor();
                    if (!result.ok) {
                        flash_status([`End turn failed: ${result.error ?? 'unknown'}`], 1800);
                        return;
                    }
                    flash_status([`Turn ${result.new_turn ?? '?'}`, `active: ${result.active_actor ?? '(none)'}`], 1500);
                    void refresh_timed_event_debug_state();
                })();
            },
            on_move: (new_rect) => {
                ui_state.modules.positions.set('initiative', new_rect);
                persist_module_layout_debounced();
            },
            on_resize: (new_rect) => {
                ui_state.modules.positions.set('initiative', new_rect);
                persist_module_layout_debounced();
            },
        }),

        make_debug_commander_module({
            id: 'debug_commander_module',
            rect: get_persisted_rect('debug_commander_module', { x0: 138, y0: 18, x1: 198, y1: 43 }),
            get_is_visible: () => Boolean(ui_state.modules.visibility.get('debug_commander_module')),
            get_actions: () => build_debug_commander_actions(),
            get_selected_action_id: () => {
                const actions = build_debug_commander_actions();
                if (actions.length < 1) return null;
                const selected = ui_state.debug_commander.selected_action_id;
                return actions.some((action) => action.id === selected) ? selected : actions[0]!.id;
            },
            get_status_lines: () => ui_state.debug_commander.status_lines,
            on_select_action: (action_id) => set_debug_commander_selected_action(action_id),
            on_trigger_action: (action_id) => trigger_debug_commander_action(action_id),
            on_close: () => {
                set_module_visible('debug_commander_module', false);
                flash_status(['Debug commander hidden'], 900);
            },
            on_move: (new_rect) => persist_module_rect('debug_commander_module', new_rect),
            on_resize: (new_rect) => persist_module_rect('debug_commander_module', new_rect),
        }),

        make_roller_module({
            id: 'roller',
            rect: get_persisted_rect('roller', { x0: ROLL_X0, y0: BTN_Y0, x1: ROLL_X1, y1: BTN_Y1 }),
            get_is_visible: () => Boolean(ui_state.modules.visibility.get('roller')),
            get_state: () => ui_state.roller,
            on_roll: async (roll_id) => {
                await fetch(APP_CONFIG.roller_roll_endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ roll_id }),
                });
            },
            text_rgb: get_color_by_name('pale_orange').rgb,
            dim_rgb: get_color_by_name('medium_gray').rgb,
            border_rgb: get_color_by_name('dark_gray').rgb,
            bg: { char: ' ', rgb: get_color_by_name('off_black').rgb },
            base_weight_index: 0,
            gizmos: {
                enabled: ['move', 'resize', 'close', 'seamless'],
                can_close: true,
                can_move: true,
                can_save_position: false,
                on_close: () => set_module_visible('roller', false),
                on_move: (new_rect) => persist_module_rect('roller', new_rect),
                on_move_end: (final_rect) => persist_module_rect('roller', final_rect),
                on_resize: (new_rect) => persist_module_rect('roller', new_rect),
                on_resize_end: (final_rect) => persist_module_rect('roller', final_rect),
            },
        }),

        // Character Module (body slots) - TOP
        // Shows equipped items and weight
        make_character_module({
            id: 'character_module',
            rect: get_persisted_rect('character_module', { x0: 160, y0: 2, x1: 198, y1: 17 }),
            get_actor_name: () => ui_state.character.display_name || get_entity_display_name(get_input_actor_ref()),
            get_actor_id: () => get_controlled_actor_id(),
            get_body_slots: () => ui_state.character.body_slots,
            get_equipped_items: () => ui_state.character.equipped_items,
            get_tags: () => get_character_tags(get_input_actor_ref()),
            get_selected_tag_key: () => ui_state.tag_picker.entity_ref === get_input_actor_ref() ? ui_state.tag_picker.selected_tag_key : null,
            get_weight_data: () => ui_state.character.weight,
            get_is_visible: () => ui_state.character.is_visible,
            on_select_tag: (tag: TagInstance) => load_tag_picker_from_entity(get_input_actor_ref(), tag),
            on_add_tag: () => { void seed_default_entity_tag(get_input_actor_ref()); },
            on_slot_click: (slot_name: string, slot_type: SlotType, garb_index: number | null) => {
                console.log(`[Character] Clicked body slot: ${slot_name}.${slot_type}${garb_index !== null ? `.${garb_index}` : ''}`);
            },
            on_select_item: (_slot_name: string, _slot_type: SlotType, _garb_index: number | null, item) => {
                const actor_id = get_controlled_actor_id();
                if (!actor_id) return;
                select_item_for_entity_inspector({ item_ref: `item.${item.id}`, owner_kind: 'actor', owner_id: actor_id });
            },
            on_slot_hover: (slot_name: string | null, slot_type: SlotType | null, garb_index: number | null, equipped_item: { instance: ItemInstance; definition: ItemDefinition } | null) => {
                if (equipped_item) {
                    ui_state.character.hovered_item = { name: equipped_item.definition.name, source: slot_name || 'character' };
                } else if (slot_name) {
                    ui_state.character.hovered_item = { name: '(empty slot)', source: slot_name };
                } else {
                    ui_state.character.hovered_item = null;
                }
                
                // Track hovered slot for bidirectional highlighting
                ui_state.character.hovered_slot = slot_name;
                
                // Find and highlight compatible items in open containers
                if (slot_name) {
                    const compatible_items = get_compatible_items_for_slot(slot_name);
                    ui_state.character.highlighted_items = compatible_items;
                    debug_log(`[Character] Hovered slot ${slot_name}.${slot_type}${garb_index !== null ? `.${garb_index}` : ''} - highlighting ${compatible_items.length} compatible items`);
                } else {
                    ui_state.character.highlighted_items = [];
                }
            },
            on_drag_start: async (slot_name: string, slot_type: SlotType, garb_index: number | null, item: ItemInstance, definition: ItemDefinition, container_id: string) => {
                // Validate drag using centralized drag_state.can_drag()
                const validation = drag_state.can_drag(item.id, definition);
                if (!validation.can) {
                    flash_status([validation.reason!], 1500);
                    console.log(`[Character] Drag rejected: ${validation.reason}`);
                    return;
                }
                
                // Store in shared drag state
                drag_state.start_drag('character', item.id, container_id, definition);
                // Highlight compatible slots (call API for tag-based compatibility)
                await apply_item_legality_highlight(item.id, container_id, definition, container_id);
                console.log(`[Character] Drag started from ${slot_name}.${slot_type}${garb_index !== null ? `.${garb_index}` : ''} - legality highlight applied`);
            },
            on_invalid_drop: (message: string) => {
                flash_status([message], 1800);
            },
            on_drop: async (slot_name: string, slot_type: SlotType, garb_index: number | null, target?: CharacterDropTarget): Promise<boolean> => {
                // Check if there's an active drag
                if (!drag_state.is_dragging) return false;

                const actor_id = get_controlled_actor_id();
                const resolved_target = target ?? {
                    kind: 'body_slot',
                    slot_name,
                    slot_type,
                    garb_index,
                    item_instance_id: null,
                    container_id: null,
                };

                let target_container_id = `body_slots.${slot_name}.${slot_type}`;
                if (slot_type === 'garb' && garb_index !== null) {
                    target_container_id += `.${garb_index}`;
                }
                if (resolved_target.kind === 'sidebar_container' && resolved_target.container_id) {
                    target_container_id = resolved_target.container_id;
                }

                debug_log(`[Character] Drop resolve ${JSON.stringify({
                    kind: resolved_target.kind,
                    slot_name,
                    slot_type,
                    garb_index,
                    target_container_id,
                    target_item_instance_id: resolved_target.item_instance_id,
                })}`);

                // Shortcut: if dropping onto an occupied container-item in a body slot, deposit into it.
                try {
                    let existing: any = null;
                    if (resolved_target.kind === 'sidebar_container') {
                        existing = resolved_target.item_instance_id
                            ? ui_state.character.equipped_items.get(resolved_target.item_instance_id)?.instance ?? null
                            : null;
                    } else {
                        const body_slots_any: any = ui_state.character.body_slots as any;
                        const slot = body_slots_any?.[slot_name];
                        if (slot) {
                            if (slot_type === 'armor') existing = slot.armor;
                            else if (slot_type === 'tool') existing = slot.tool;
                            else if (slot_type === 'garb' && garb_index !== null) existing = slot.garb?.[garb_index] ?? null;
                        }
                    }

                    const is_container = has_tag(existing?.tags, 'CONTAINER');
                    if (is_container && existing?.id) {
                        if (drag_state.item_instance_id === existing.id) {
                            flash_status(['Cannot deposit a container into itself'], 1500);
                            drag_state.reject_drag();
                            return false;
                        }

                        const nested_dest = resolved_target.kind === 'sidebar_container' && resolved_target.container_id
                            ? resolved_target.container_id
                            : `actor.item.${actor_id}.${existing.id}`;

                        const src = String(drag_state.source_container_id ?? '');

                        if (src.startsWith('place.pile.') && String(drag_state.item_instance_id ?? '').startsWith('pile:')) {
                            flash_status(['Open the pile and drag a specific item out'], 2000);
                            drag_state.reject_drag();
                            return false;
                        }

                        // One endpoint for everything: place or inventory -> nested container.
                        if (src.startsWith('place.ground.') || src.startsWith('place.pile.') || src.startsWith('place.item.')) {
                            const tx = await api_transfer_inline({
                                actor_id,
                                item_instance_id: String(drag_state.item_instance_id ?? ''),
                                from_container: src,
                                to_container: nested_dest,
                            });
                            if (tx.ok) {
                                flash_status([`Moved into ${existing.name || 'container'}`], 1500);
                                drag_state.end_drag();
                                const place = get_current_place();
                                if (place) await refresh_place_visual_state(place.id);
                                void refresh_container_data();
                                void refresh_character_data();
                                return true;
                            }
                            flash_status([`Failed to move: ${tx.error || 'unknown error'}`], 1500);
                            drag_state.reject_drag();
                            return false;
                        }

                        // Inventory/container/character -> nested container uses transfer
                        const transfer_data = await api_transfer_inline({
                            actor_id,
                            item_instance_id: String(drag_state.item_instance_id ?? ''),
                            from_container: String(drag_state.source_container_id ?? ''),
                            to_container: nested_dest,
                        });
                        if (transfer_data.ok) {
                            flash_status([`Moved into ${existing.name || 'container'}`], 1500);
                            void refresh_container_data();
                            void refresh_character_data();
                            drag_state.end_drag();
                            return true;
                        }
                        flash_status([`Failed to move: ${transfer_data.error || 'unknown error'}`], 1500);
                        drag_state.reject_drag();
                        return false;
                    }
                } catch {
                    // ignore
                }

                // If dragging from ground (single), route through pickup_to.
                // Pile drags are sweep-only (place->place).
                const src = String(drag_state.source_container_id ?? '');
                if (src.startsWith('place.pile.') && String(drag_state.item_instance_id ?? '').startsWith('pile:')) {
                    flash_status(['Open the pile and drag a specific item out'], 2000);
                    drag_state.reject_drag();
                    return false;
                }

                if (src.startsWith('place.ground.') || src.startsWith('place.pile.')) {
                    // Validate compatibility using backend API (same as inventory->character)
                    const item_def = drag_state.item_definition;
                    const allow_nested_container = resolved_target.kind === 'sidebar_container' || (has_tag((ui_state.character.equipped_items.get(resolved_target.item_instance_id ?? '')?.instance as any)?.tags, 'CONTAINER'));
                    if (item_def && !allow_nested_container) {
                        const compatible_slots = await get_compatible_slots_for_instance(drag_state.item_instance_id!, drag_state.source_container_id, item_def);
                        const is_compatible = compatible_slots.some((slot: { slot_name: string; slot_type: string; garb_index?: number }) =>
                            slot.slot_name === slot_name && slot.slot_type === slot_type
                        );
                        if (!is_compatible) {
                            flash_status([`${item_def.name} cannot be equipped to ${slot_name}.${slot_type}`], 1500);
                            drag_state.reject_drag();
                            return false;
                        }
                    }

                    try {
                        const pickup_data = await api_transfer_inline({
                            actor_id,
                            item_instance_id: String(drag_state.item_instance_id ?? ''),
                            from_container: src,
                            to_container: target_container_id,
                        });

                        if (pickup_data.ok) {
                            const place = get_current_place();
                            flash_status([`${drag_state.item_definition?.name} picked up`], 1500);
                            drag_state.end_drag();
                            if (place) await refresh_place_visual_state(place.id);
                            void refresh_container_data();
                            void refresh_character_data();
                            return true;
                        }
                        flash_status([`Failed to pick up: ${pickup_data.error || 'unknown error'}`], 1500);
                        drag_state.reject_drag();
                        return false;
                    } catch (err) {
                        console.error('[Character] transfer error:', err);
                        flash_status(['Error moving item'], 1500);
                        drag_state.reject_drag();
                        return false;
                    }
                }

                // Dragging from a ground container-item window -> body slot: withdraw.
                if (src.startsWith('place.item.')) {
                    try {
                        const wd = await api_transfer_inline({
                            actor_id,
                            item_instance_id: String(drag_state.item_instance_id ?? ''),
                            from_container: src,
                            to_container: target_container_id,
                        });

                        if (wd.ok) {
                            flash_status([`${drag_state.item_definition?.name || 'Item'} withdrawn`], 1500);
                            drag_state.end_drag();
                            const place = get_current_place();
                            if (place) await refresh_place_visual_state(place.id);
                            void refresh_container_data();
                            void refresh_character_data();
                            return true;
                        }
                        const detail = wd.detail ? ` (${JSON.stringify(wd.detail)})` : '';
                        flash_status([`Withdraw failed: ${wd.error}${detail}`], 1800);
                        drag_state.reject_drag();
                        return false;
                    } catch {
                        flash_status(['Withdraw failed'], 1500);
                        drag_state.reject_drag();
                        return false;
                    }
                }
                
                // Handle drag from container (inventory) to character slot
                if (drag_state.source_module === 'container') {
                    // Validate body slot compatibility using backend API (single source of truth)
                    const item_def = drag_state.item_definition;
                    if (item_def) {
                        const compatible_slots = await get_compatible_slots_for_instance(drag_state.item_instance_id!, drag_state.source_container_id, item_def);
                        const is_compatible = compatible_slots.some((slot: { slot_name: string; slot_type: string; garb_index?: number }) => 
                            slot.slot_name === slot_name && slot.slot_type === slot_type
                        );
                        if (!is_compatible) {
                            flash_status([`${item_def.name} cannot be equipped to ${slot_name}.${slot_type}`], 1500);
                            drag_state.reject_drag();
                            return false;
                        }
                    }
                    
                    try {
                        const transfer_data = await api_transfer_inline({
                            actor_id,
                            item_instance_id: String(drag_state.item_instance_id ?? ''),
                            from_container: String(drag_state.source_container_id ?? ''),
                            to_container: target_container_id,
                        });

                        if (transfer_data.ok) {
                            flash_status([`${drag_state.item_definition?.name} equipped to ${slot_name}.${slot_type}${garb_index !== null ? `.${garb_index}` : ''}`], 1500);
                            void refresh_container_data();
                            void refresh_character_data();
                            drag_state.end_drag();
                            return true;
                        } else {
                            flash_status([`Failed to equip: ${transfer_data.error || 'unknown error'}`], 1500);
                            drag_state.reject_drag();
                            return false;
                        }
                    } catch (err) {
                        console.error(`[Character] Error during equip:`, err);
                        flash_status([`Error equipping item`], 1500);
                        drag_state.reject_drag();
                        return false;
                    }
                }
                
                // Handle drag from character slot to character slot (swap)
                if (drag_state.source_module === 'character') {
                    // Validate body slot compatibility using backend API (single source of truth)
                    const item_def = drag_state.item_definition;
                    if (item_def) {
                        const compatible_slots = await get_compatible_slots_for_instance(drag_state.item_instance_id!, drag_state.source_container_id, item_def);
                        const is_compatible = compatible_slots.some((slot: { slot_name: string; slot_type: string; garb_index?: number }) =>
                            slot.slot_name === slot_name && slot.slot_type === slot_type
                        );
                        if (!is_compatible) {
                            flash_status([`${item_def.name} cannot be equipped to ${slot_name}.${slot_type}`], 1500);
                            drag_state.reject_drag();
                            return false;
                        }
                    }

                    try {
                        const transfer_data = await api_transfer_inline({
                            actor_id,
                            item_instance_id: String(drag_state.item_instance_id ?? ''),
                            from_container: String(drag_state.source_container_id ?? ''),
                            to_container: target_container_id,
                        });

                        if (transfer_data.ok) {
                            flash_status([`${drag_state.item_definition?.name} moved to ${slot_name}.${slot_type}${garb_index !== null ? `.${garb_index}` : ''}`], 1500);
                            void refresh_container_data();
                            void refresh_character_data();
                            drag_state.end_drag();
                            return true;
                        } else {
                            flash_status([`Failed to move: ${transfer_data.error || 'unknown error'}`], 1500);
                            drag_state.reject_drag();
                            return false;
                        }
                    } catch (err) {
                        console.error(`[Character] Error during swap:`, err);
                        flash_status([`Error moving item`], 1500);
                        drag_state.reject_drag();
                        return false;
                    }
                }
                
                return false;
            },
            get_highlighted_slots: (): Array<{ slot_name: string; slot_type: SlotType; garb_index?: number }> => {
                // Return highlighted slots with their types
                return ui_state.character.highlighted_slots;
            },
            on_drag_rejected: () => drag_state.reject_drag(),
            on_cross_module_drop: async (x: number, y: number): Promise<boolean> => {
                // Check if there's an active drag from this character module
                if (!drag_state.is_dragging) return false;
                if (drag_state.source_module !== 'character') return false;

                // Check if drop is on container module (inventory)
                // Container module rect: { x0: 160, y0: 18, x1: 198, y1: 35 }
                if (x >= 160 && x <= 198 && y >= 18 && y <= 35) {
                    const target_container_id = await get_inventory_panel_drop_target_container_id();
                    if (!target_container_id) {
                        drag_state.end_drag();
                        return false;
                    }

                    try {
                        const transfer_data = await api_transfer_inline({
                            actor_id: get_controlled_actor_id(),
                            item_instance_id: String(drag_state.item_instance_id ?? ''),
                            from_container: String(drag_state.source_container_id ?? ''),
                            to_container: target_container_id,
                        });

                        if (transfer_data.ok) {
                            flash_status([`${drag_state.item_definition?.name} unequipped`], 1500);

                            // Refresh data
                            void refresh_container_data();
                            void refresh_character_data();

                            drag_state.end_drag();
                            return true;
                        } else {
                            flash_status([`Failed to unequip: ${transfer_data.error || 'unknown error'}`], 1500);
                            drag_state.reject_drag();
                            return false;
                        }
                    } catch (err) {
                        console.error(`[Character] Error during unequip:`, err);
                        flash_status([`Error unequipping item`], 1500);
                        drag_state.reject_drag();
                        return false;
                    }
                }

                drag_state.reject_drag();
                return false;
            },
            border_rgb: get_color_by_name('light_gray').rgb,
            // Player character module: standard widgets
            gizmos: {
                enabled: ['close', 'move', 'resize', 'seamless'],
                can_close: true,
                can_move: true,
                can_save_position: false,
                on_close: () => {
                    set_module_visible('character_module', false);
                    flash_status(['Character hidden'], 800);
                },
                on_move_start: () => {
                    debug_log('[CharacterModule] Move mode started');
                },
                on_move: (new_rect) => {
                    ui_state.modules.positions.set('character_module', new_rect);
                    debug_log(`[CharacterModule] Moving to (${new_rect.x0},${new_rect.y0})`);
                    persist_module_layout_debounced();
                },
                on_move_end: (final_rect) => {
                    ui_state.modules.positions.set('character_module', final_rect);
                    flash_status([`Character panel moved`], 1000);
                    persist_module_layout_debounced();
                },
                on_resize: (new_rect) => {
                    ui_state.modules.positions.set('character_module', new_rect);
                    persist_module_layout_debounced();
                },
                on_resize_end: (final_rect) => {
                    ui_state.modules.positions.set('character_module', final_rect);
                    persist_module_layout_debounced();
                },
            },
            // Container sidebar: Show equipped containers only (NEW INLINE SYSTEM)
            get_equipped_containers: (() => {
                let last_body_slots_ref: any = null;
                let last_result: Array<{
                    slot_name: string;
                    item_instance: ItemInstance;
                    item_definition: ItemDefinition;
                    container_id: string;
                }> = [];

                return () => {
                const containers: Array<{
                    slot_name: string;
                    item_instance: ItemInstance;
                    item_definition: ItemDefinition;
                    container_id: string;
                }> = [];

                // Walk body_slots directly to find containers (inline system)
                const body_slots = ui_state.character.body_slots as any;
                if (!body_slots) {
                    last_body_slots_ref = body_slots;
                    last_result = containers;
                    return containers;
                }
                if (body_slots === last_body_slots_ref) return last_result;
                
                for (const [slot_name, slot_data] of Object.entries(body_slots)) {
                    const slot = slot_data as any;
                    if (!slot) continue;
                    
                    // Check armor slot
                    if (slot.armor) {
                        const is_container = has_tag(slot.armor.tags, 'CONTAINER');
                        if (is_container) {
                            containers.push({
                                slot_name: `${slot_name}.armor`,
                                item_instance: slot.armor as ItemInstance,
                                item_definition: { name: slot.armor.name, tags: slot.armor.tags } as ItemDefinition,
                                container_id: `body_slots.${slot_name}.armor`,
                            });
                        }
                    }
                    
                    // Check tool slot  
                    if (slot.tool) {
                        const is_container = has_tag(slot.tool.tags, 'CONTAINER');
                        if (is_container) {
                            containers.push({
                                slot_name: `${slot_name}.tool`,
                                item_instance: slot.tool as ItemInstance,
                                item_definition: { name: slot.tool.name, tags: slot.tool.tags } as ItemDefinition,
                                container_id: `body_slots.${slot_name}.tool`,
                            });
                        }
                    }
                    
                    // Check garb slots
                    if (slot.garb && Array.isArray(slot.garb)) {
                        slot.garb.forEach((item: any, index: number) => {
                            const is_container = has_tag(item.tags, 'CONTAINER');
                            if (is_container) {
                                containers.push({
                                    slot_name: `${slot_name}.garb.${index}`,
                                    item_instance: item as ItemInstance,
                                    item_definition: { name: item.name, tags: item.tags } as ItemDefinition,
                                    container_id: `body_slots.${slot_name}.garb.${index}`,
                                });
                            }
                        });
                    }
                }

                last_body_slots_ref = body_slots;
                last_result = containers;
                return containers;
                };
            })(),
            get_default_container_id: () => ui_state.character.default_container_id,
            on_set_default_container: (container_id: string) => {
                ui_state.character.default_container_id = container_id;
                flash_status([`Default container set`], 1200);
            },
            on_container_click: (container_id: string) => {
                debug_log(`[Character] Container clicked: ${container_id}`);
                // Phase 7: Open container in new ContainerModule
                void open_owner_inventory_view(container_id, 'your container');
            },
            // Phase 7: Right-click container opening
            on_open_container: async (container_id: string, slot_name: string) => {
                debug_log(`[Character] Opening container via right-click: ${container_id}`);
                await open_owner_inventory_view(container_id, slot_name);
            },
            get_open_containers: () => ui_state.container.open_containers,
        }),

        make_entity_editor_module({
            id: 'entity_inspector_module',
            rect: get_persisted_rect('entity_inspector_module', { x0: 126, y0: 4, x1: 158, y1: 20 }),
            get_is_visible: () => ui_state.place_painter.active && ui_state.entity_inspector.is_visible,
            get_title: () => ui_state.entity_inspector.entity_kind === 'tile' ? 'TILE' : ui_state.entity_inspector.entity_kind === 'item' ? 'ITEM' : 'ENTITY',
            get_subtitle: () => get_entity_editor_subject_label(ui_state.entity_inspector.entity_ref),
            get_fields: () => {
                if (ui_state.entity_inspector.entity_kind === 'character') {
                    return [
                        { key: 'name', label: 'name', value: ui_state.character_editor.draft.name },
                        { key: 'title', label: 'title', value: ui_state.character_editor.draft.title },
                        { key: 'kind', label: 'kind', value: ui_state.character_editor.draft.kind },
                        { key: 'sex', label: 'sex', value: ui_state.character_editor.draft.sex },
                        { key: 'age', label: 'age', value: ui_state.character_editor.draft.age },
                    ];
                }
                if (ui_state.entity_inspector.entity_kind === 'item') {
                    const original = ui_state.item_editor.original as any;
                    const container = get_container_capacity_summary(original as any);
                    const qty = Number(original?.qty ?? 1);
                    const singleValue = Number(original?.single_value_mag ?? original?.value_mag?.total_value_mag ?? 0);
                    const stackValue = Number(original?.stack_value_mag ?? (singleValue * qty));
                    const singleWeight = Number(original?.single_weight ?? 0);
                    const stackWeight = Number(original?.stack_weight ?? (singleWeight * qty));
                    const fields = [
                        { key: 'name', label: 'name', value: String(original?.name ?? ''), editable: false },
                        { key: 'size', label: 'size', value: String(original?.size_mag ?? 0), editable: false },
                        { key: 'qty', label: 'qty', value: String(qty), editable: false },
                        { key: 'value', label: 'value', value: `${singleValue}/${stackValue}`, editable: false },
                        { key: 'weight', label: 'weight', value: `${singleWeight}/${stackWeight}`, editable: false },
                    ];
                    if (container.has_container) {
                        fields.push(
                            { key: 'cont_mag', label: 'cont mag', value: String(container.capacity_mag ?? 1), editable: false },
                            { key: 'cont_slots', label: 'slots', value: String(container.max_slots ?? 1), editable: false },
                        );
                    }
                    return fields;
                }
                const original = ui_state.tile_editor.original as any;
                const tags = get_character_tags(ui_state.tile_editor.tile_ref);
                const value_mag = Number(original?.value_mag?.total_value_mag ?? original?.total_value_mag ?? 0);
                const grow = get_tile_editor_grow_summary(original as any);
                const container = get_container_capacity_summary(original as any);
                const fields: Array<{ key: string; label: string; value: string; editable: boolean }> = [
                    { key: 'kind', label: 'kind', value: String(original?.kind ?? ''), editable: false },
                    { key: 'place', label: 'place', value: String(ui_state.tile_editor.place_id ?? ''), editable: false },
                    { key: 'pos', label: 'pos', value: `${ui_state.tile_editor.x},${ui_state.tile_editor.y},${ui_state.tile_editor.z}`, editable: false },
                    { key: 'tags', label: 'tag ct', value: String(tags.length), editable: false },
                    { key: 'value', label: 'value', value: String(value_mag), editable: false },
                ];
                if (container.has_container) {
                    fields.push(
                        { key: 'cont_mag', label: 'cont mag', value: String(container.capacity_mag ?? 1), editable: false },
                        { key: 'cont_slots', label: 'slots', value: String(container.max_slots ?? 1), editable: false },
                    );
                }
                if (grow.count > 0) {
                    fields.push(
                        { key: 'grow_ct', label: 'grow ct', value: String(grow.count), editable: false },
                        { key: 'grow_period', label: 'grow t', value: String(grow.period ?? '-'), editable: false },
                        { key: 'grow_slots', label: 'grow s', value: String(grow.slots ?? '-'), editable: false },
                        { key: 'grow_yield', label: 'grow y', value: String(grow.yield_qty ?? '-'), editable: false },
                    );
                }
                return fields;
            },
            get_tags: () => get_character_tags(ui_state.entity_inspector.entity_kind === 'character' ? ui_state.character_editor.character_ref : ui_state.entity_inspector.entity_kind === 'item' ? ui_state.item_editor.item_ref : ui_state.tile_editor.tile_ref),
            get_selected_tag_key: () => ui_state.tag_picker.entity_ref === ui_state.entity_inspector.entity_ref ? ui_state.tag_picker.selected_tag_key : null,
            get_status_lines: () => {
                const lines: string[] = ui_state.entity_inspector.entity_kind === 'character'
                    ? [...ui_state.character_editor.status_lines]
                    : ui_state.entity_inspector.entity_kind === 'item'
                        ? [...ui_state.item_editor.status_lines]
                    : [...ui_state.tile_editor.status_lines];
                if (ui_state.entity_inspector.entity_kind === 'character' && ui_state.character_editor.dirty) lines.push('unsaved changes');
                if (ui_state.entity_inspector.entity_kind === 'character' && ui_state.character_editor.saving) lines.push('saving in progress');
                if (ui_state.entity_inspector.entity_kind === 'item' && ui_state.item_editor.saving) lines.push('saving in progress');
                if (ui_state.entity_inspector.entity_kind === 'tile' && ui_state.tile_editor.saving) lines.push('saving in progress');
                return lines;
            },
            on_update_field: (key, value) => {
                if (ui_state.entity_inspector.entity_kind !== 'character') return;
                if (!(key in ui_state.character_editor.draft)) return;
                (ui_state.character_editor.draft as any)[key] = value;
                ui_state.character_editor.dirty = true;
                ui_state.character_editor.status_lines = [get_character_editor_subject_label(ui_state.character_editor.character_ref), `editing ${key}`];
            },
            on_select_field: (key: string) => {
                if (ui_state.entity_inspector.entity_kind !== 'character') return;
                if (key === 'kind' || key === 'sex') void open_character_editor_field_picker(key);
            },
            on_select_tag: (tag) => {
                const ref = ui_state.entity_inspector.entity_kind === 'character' ? ui_state.character_editor.character_ref : ui_state.entity_inspector.entity_kind === 'item' ? ui_state.item_editor.item_ref : ui_state.tile_editor.tile_ref;
                if (ref) load_tag_picker_from_entity(ref, tag);
            },
            on_add_tag: () => {
                const ref = ui_state.entity_inspector.entity_kind === 'character' ? ui_state.character_editor.character_ref : ui_state.entity_inspector.entity_kind === 'item' ? ui_state.item_editor.item_ref : ui_state.tile_editor.tile_ref;
                if (ref) void seed_default_entity_tag(ref);
            },
            on_save: async () => {
                if (ui_state.entity_inspector.entity_kind === 'character') await save_character_editor_module();
                else if (ui_state.entity_inspector.entity_kind === 'item') await save_item_editor_module();
                else await save_tile_editor_module();
            },
            on_reload: async () => {
                if (ui_state.entity_inspector.entity_kind === 'character') await reload_character_editor_module();
                else if (ui_state.entity_inspector.entity_kind === 'item') await reload_item_editor_module();
                else await reload_tile_editor_module();
            },
            on_close: () => close_entity_inspector(),
            on_move: (new_rect) => persist_entity_inspector_rect(new_rect),
        }),

        make_tag_picker_module({
            id: 'tag_picker_module',
            rect: get_persisted_rect('tag_picker_module', { x0: 96, y0: 4, x1: 125, y1: 17 }),
            get_is_visible: () => ui_state.place_painter.active && ui_state.tag_picker.is_visible,
            get_title: () => 'TAG PICK',
            get_subtitle: () => get_entity_editor_subject_label(ui_state.tag_picker.entity_ref),
            get_tag: () => ui_state.tag_picker.draft,
            get_definition: () => ui_state.tag_picker.definition,
            get_selected_field: () => ui_state.tag_picker.selected_field,
            get_status_lines: () => {
                const lines: string[] = [...ui_state.tag_picker.status_lines];
                if (ui_state.tag_picker.applying) lines.push('applying...');
                lines.push('enter commits text / arrows adjust values');
                return lines;
            },
            on_select_field: (field) => {
                ui_state.tag_picker.selected_field = field;
            },
            on_open_name_picker: () => { void open_tag_picker_name_picker(); },
            on_adjust_mag: (delta) => {
                if (!ui_state.tag_picker.draft) return;
                ui_state.tag_picker.selected_field = 'mag';
                ui_state.tag_picker.draft.mag = clamp_tag_mag(ui_state.tag_picker.draft.mag + delta, ui_state.tag_picker.draft.mag);
                update_tag_picker_status(get_entity_editor_subject_label(ui_state.tag_picker.entity_ref), `mag: ${ui_state.tag_picker.draft.mag}`);
                void apply_tag_picker_draft();
            },
            on_adjust_dimension: (dimension_id, delta) => {
                if (!ui_state.tag_picker.draft) return;
                const definition = ui_state.tag_picker.definition?.dimensions.find((entry) => entry.id === dimension_id) ?? null;
                const current = ui_state.tag_picker.draft.dim_mag?.[dimension_id] ?? definition?.default_mag ?? 0;
                const next = clamp_dimension_mag(current + delta, definition, current);
                ui_state.tag_picker.selected_field = `dim:${dimension_id}`;
                if (!ui_state.tag_picker.draft.dim_mag) ui_state.tag_picker.draft.dim_mag = {};
                ui_state.tag_picker.draft.dim_mag[dimension_id] = next;
                if (ui_state.tag_picker.definition?.quantity_dimension_id === dimension_id) {
                    ui_state.tag_picker.draft.mag = clamp_tag_mag(next, ui_state.tag_picker.draft.mag);
                }
                update_tag_picker_status(get_entity_editor_subject_label(ui_state.tag_picker.entity_ref), `${dimension_id}: ${next}`);
                void apply_tag_picker_draft();
            },
            on_update_meta_text: (value) => {
                ui_state.tag_picker.selected_field = 'meta';
                ui_state.tag_picker.meta_text = value;
                if (ui_state.tag_picker.draft) {
                    ui_state.tag_picker.draft.meta = value.split(',').map((entry) => entry.trim().toUpperCase()).filter(Boolean);
                }
            },
            on_commit_meta: () => {
                if (!ui_state.tag_picker.draft) return;
                ui_state.tag_picker.draft.meta = ui_state.tag_picker.meta_text.split(',').map((entry) => entry.trim().toUpperCase()).filter(Boolean);
                update_tag_picker_status(get_entity_editor_subject_label(ui_state.tag_picker.entity_ref), `meta: ${ui_state.tag_picker.meta_text || '-'}`);
                void apply_tag_picker_draft();
            },
            on_remove_tag: () => { void remove_tag_picker_selected(); },
            on_drag_apply: (x, y) => { void apply_tag_picker_drop(x, y); },
            on_close: () => close_tag_picker_module(),
            on_move: (new_rect) => persist_module_rect('tag_picker_module', new_rect),
        }),

        make_world_entry_module({
            id: 'world_entry_module',
            rect: get_persisted_rect('world_entry_module', { x0: 76, y0: 10, x1: 126, y1: 24 }),
            get_is_visible: () => ui_state.world_entry.is_visible,
            get_status_lines: () => ui_state.world_entry.status_lines,
            on_launch_world: () => { void begin_world_session(); },
            on_join_world: () => { void open_world_join_module(); },
            on_move: (new_rect) => persist_module_rect('world_entry_module', new_rect),
        }),

        make_world_join_module({
            id: 'world_join_module',
            rect: get_persisted_rect('world_join_module', { x0: 72, y0: 8, x1: 132, y1: 28 }),
            get_is_visible: () => ui_state.world_join.is_visible,
            get_entries: () => ui_state.world_join.entries,
            get_selected_world_id: () => ui_state.world_join.selected_world_id,
            get_status_lines: () => ui_state.world_join.status_lines,
            on_select_world: (world_id) => { ui_state.world_join.selected_world_id = world_id; },
            on_join_selected: () => { void join_selected_world(); },
            on_back: () => open_world_entry_module(),
            on_refresh: () => { void refresh_joinable_worlds(); },
            on_move: (new_rect) => persist_module_rect('world_join_module', new_rect),
        }),

        make_actor_claim_module({
            id: 'actor_claim_module',
            rect: get_persisted_rect('actor_claim_module', { x0: 68, y0: 8, x1: 132, y1: 28 }),
            get_is_visible: () => ui_state.actor_claim.is_visible,
            get_is_blocking: () => ui_state.actor_claim.is_blocking,
            get_title: () => ui_state.actor_claim.title,
            get_guest_label: () => ui_state.actor_claim.guest_label,
            get_entries: () => ui_state.actor_claim.actors,
            get_selected_actor_ref: () => ui_state.actor_claim.selected_actor_ref,
            get_current_actor_ref: () => ui_state.actor_claim.current_actor_ref,
            get_status_lines: () => {
                const lines = [...ui_state.actor_claim.status_lines];
                if (ui_state.actor_claim.error) lines.unshift(`error: ${ui_state.actor_claim.error}`);
                if (ui_state.actor_claim.is_loading) lines.unshift('loading actors...');
                if (ui_state.actor_claim.is_submitting) lines.unshift('updating claim...');
                return lines;
            },
            get_is_loading: () => ui_state.actor_claim.is_loading,
            get_is_submitting: () => ui_state.actor_claim.is_submitting,
            on_select: (actor_ref) => select_actor_claim_entry(actor_ref),
            on_claim_selected: () => { void claim_selected_actor(); },
            on_create_actor: () => { void open_character_creation_module(); },
            on_release_current: () => { void release_actor_claim_and_reopen(); },
            on_refresh: () => { void refresh_actor_claim_state(); },
            on_close: () => close_actor_claim_module(),
            on_move: (new_rect) => persist_module_rect('actor_claim_module', new_rect),
        }),

        make_character_creation_module({
            id: 'character_creation_module',
            rect: get_persisted_rect('character_creation_module', { x0: 74, y0: 6, x1: 132, y1: 28 }),
            get_is_visible: () => ui_state.character_creation.is_visible,
            get_title: () => 'CREATE ACTOR',
            get_subtitle: () => 'public actor - returns to claim list',
            get_fields: () => get_character_creation_fields(),
            get_status_lines: () => {
                const lines = [...ui_state.character_creation.status_lines];
                if (ui_state.character_creation.is_loading) lines.unshift('loading creation options...');
                if (ui_state.character_creation.is_submitting) lines.unshift('creating actor...');
                return lines;
            },
            on_update_field: (key, value) => update_character_creation_field(key, value),
            on_select_field: (key) => {
                ui_state.character_creation.selected_field = key;
                if (key === 'kind' || key === 'sex') void open_character_creation_field_picker(key);
            },
            on_create: async () => { await submit_character_creation(); },
            on_reset: async () => { await reset_character_creation_draft(); },
            on_close: () => close_character_creation_module(),
            on_move: (new_rect) => persist_module_rect('character_creation_module', new_rect),
        }),

        make_option_picker_module({
            id: 'option_picker_module',
            rect: get_persisted_rect('option_picker_module', { x0: 94, y0: 4, x1: 124, y1: 20 }),
            get_is_visible: () => ui_state.option_picker.is_visible && (ui_state.place_painter.active || ui_state.character_creation.is_visible),
            get_title: () => ui_state.option_picker.title,
            get_options: () => ui_state.option_picker.options,
            get_selected_value: () => ui_state.option_picker.selected_value,
            get_status_lines: () => ui_state.option_picker.status_lines,
            on_select: (value) => apply_option_picker_selection(value),
            on_close: () => close_option_picker(),
            on_move: (new_rect) => persist_module_rect('option_picker_module', new_rect),
        }),

        // Inventory Owner Module - BOTTOM
        // Shows actor body surfaces plus first-layer attached storage surfaces.
        make_owner_inventory_module({
            id: 'inventory_container',
            rect: get_persisted_rect('inventory_container', { x0: 160, y0: 18, x1: 198, y1: 35 }),
            get_view: () => ui_state.container.owner_view,
            get_is_visible: () => ui_state.container.is_visible,
            set_is_visible: async (visible: boolean) => {
                debug_log(`[InventoryOwner] set_is_visible called with: ${visible}`);
                set_module_visible('inventory_container', visible);
                ui_state.container.is_visible = visible;
                if (visible) {
                    const actor_id = get_controlled_actor_id();
                    const view = actor_id ? await load_actor_owner_inventory_view(actor_id) : null;
                    ui_state.container.owner_view = view;
                    if (view) {
                        flash_status(['Inventory opened (press i to close)'], 1000);
                    } else {
                        flash_status(['No inventory view available'], 1500);
                    }
                    const refresh_interval = window.setInterval(() => {
                        if (ui_state.container.is_visible) {
                            const current_actor_id = get_controlled_actor_id();
                            if (!current_actor_id) return;
                            void refresh_actor_owner_inventory_view();
                        } else {
                            window.clearInterval(refresh_interval);
                        }
                    }, 2000);
                } else {
                    flash_status(['Inventory closed'], 800);
                }
            },
            on_open_nested_container: (item_id: string, item_name: string) => {
                const actor_id = get_controlled_actor_id();
                if (!actor_id) return;
                void open_owner_inventory_view(`actor.item.${actor_id}.${item_id}`, item_name);
            },
            on_select_item: (surface, slot) => {
                const selection = build_item_selection_from_surface(surface, slot);
                if (!selection) return;
                select_item_for_entity_inspector(selection);
            },
            on_slot_hover: async (_surface, slot) => {
                if (slot?.item) {
                    const source_container_id = get_container_id_from_target_id(slot.slot_target_id);
                    if (!source_container_id) {
                        clear_item_legality_highlight();
                        return;
                    }
                    const definition = {
                        id: slot.item.def_id,
                        name: slot.item.name,
                        display_char: slot.item.display_char,
                        tags: slot.item.tags,
                    } as ItemDefinition;
                    await apply_item_legality_highlight(slot.item.id, source_container_id, definition, source_container_id);
                } else {
                    clear_item_legality_highlight();
                }
            },
            on_drag_start: (surface, slot, definition) => {
                if (!slot.item) return;
                const validation = drag_state.can_drag(slot.item.id, definition);
                if (!validation.can) {
                    flash_status([validation.reason!], 1500);
                    return;
                }
                const source_container_id = get_container_id_from_target_id(slot.slot_target_id) ?? get_container_id_from_target_id(surface.surface_target_id);
                if (!source_container_id) {
                    flash_status(['Missing source target for inventory slot'], 1500);
                    return;
                }
                // Reuse the legacy 'container' drag lane for now so existing cross-module
                // transfer and world-drop behavior keeps working during the surface migration.
                drag_state.start_drag('container', slot.item.id, source_container_id, definition, slot.slot_index, slot.slot_target_id);
                void apply_item_legality_highlight(slot.item.id, source_container_id, definition, source_container_id);
            },
            on_drop: async (surface, slot): Promise<boolean> => {
                if (!drag_state.is_dragging) return false;
                if (!surface.accepts_player_insert) return false;
                const actor_id = get_controlled_actor_id();
                if (!actor_id) return false;

                const target_container_id = get_container_id_from_target_id(slot.slot_target_id) ?? get_container_id_from_target_id(surface.surface_target_id);
                if (!target_container_id) return false;

                if (drag_state.source_container_id === target_container_id && surface.surface_kind !== 'container') {
                    return false;
                }

                const transfer_res = await api_transfer_inline({
                    actor_id,
                    item_instance_id: String(drag_state.item_instance_id ?? ''),
                    from_container: String(drag_state.source_container_id ?? ''),
                    to_container: target_container_id,
                    from_target_id: drag_state.source_target_id ?? undefined,
                    to_target_id: slot.slot_target_id,
                    target_grid_x: surface.surface_kind === 'container' ? slot.grid_x : undefined,
                    target_grid_y: surface.surface_kind === 'container' ? slot.grid_y : undefined,
                });

                if (!transfer_res.ok) {
                    const detail_text = format_legality_detail(transfer_res.detail);
                    const detail = detail_text ? ` (${detail_text})` : '';
                    flash_status([`Failed to move: ${transfer_res.error}${detail}`], 1800);
                    return false;
                }

                const source = String(drag_state.source_container_id ?? '');
                await refresh_after_transfer(source, target_container_id);

                flash_status([`${drag_state.item_definition?.name ?? 'Item'} moved`], 1200);
                drag_state.end_drag();
                void refresh_container_data();
                return true;
            },
            on_drag_rejected: () => drag_state.reject_drag(),
            get_highlighted_items: () => ui_state.character.highlighted_items,
            get_open_container_ids: () => ui_state.container.open_containers,
            get_open_container_id_for_item: (surface, slot) => get_open_owner_inventory_container_id_for_item(surface, slot),
        }),

        make_place_painter_toolbar_module(get_persisted_rect('place_painter_toolbar', { x0: 0, y0: 0, x1: 120, y1: 2 })),
        make_place_painter_tools_module(get_persisted_rect('place_painter_tools', { x0: 0, y0: 8, x1: 24, y1: 22 })),
        make_place_painter_palette_module(get_persisted_rect('place_painter_palette', { x0: 25, y0: 8, x1: 45, y1: 26 })),
        make_place_painter_layers_module(get_persisted_rect('place_painter_layers', { x0: 0, y0: 23, x1: 28, y1: 40 })),
        make_place_painter_tool_properties_module(get_persisted_rect('place_painter_tool_properties', { x0: 46, y0: 19, x1: 78, y1: 29 })),
        
        // Global 'I' key handler - toggles the unified owner inventory module
        {
            id: 'global_key_handler',
            rect: { x0: 0, y0: 0, x1: 0, y1: 0 }, // Invisible module
            Focusable: false,
            Draw() {}, // No rendering
            OnGlobalKeyDown(e: KeyboardEvent) {
                if (e.key === 'i' || e.key === 'I') {
                    debug_log('[GlobalKeyHandler] I key detected, handling...');
                    e.preventDefault();
                    e.stopPropagation();
                    
                    void (async () => {
                        const inventory_visible = ui_state.container.is_visible;
                        if (inventory_visible) {
                            set_module_visible('inventory_container', false);
                            ui_state.container.is_visible = false;
                            flash_status(['Inventory closed'], 800);
                        } else {
                            const inventory_module = module_registry.get('inventory_container');
                            if (inventory_module) {
                                set_module_visible('inventory_container', true);
                                ui_state.container.is_visible = true;
                                const actor_id = get_controlled_actor_id();
                                ui_state.container.owner_view = actor_id ? await load_actor_owner_inventory_view(actor_id) : null;
                                flash_status(['Inventory opened (press i to close)'], 1000);
                            }
                        }
                    })();
                    
                    return true; // Stop propagation to other handlers
                }
                return false;
            },
        },
    ];

    function update_layout(grid_width: number, grid_height: number): void {
        const next_width = Math.max(1, Math.floor(Number(grid_width) || APP_CONFIG.grid_width));
        const next_height = Math.max(1, Math.floor(Number(grid_height) || APP_CONFIG.grid_height));
        (APP_CONFIG as any).grid_width = next_width;
        (APP_CONFIG as any).grid_height = next_height;

        const bg_module = module_registry.get?.('bg') ?? modules.find((entry) => entry.id === 'bg');
        if (bg_module) {
            bg_module.rect = { x0: 0, y0: 0, x1: next_width - 1, y1: next_height - 1 };
        }
    }

    // Register all static modules to the registry (Phase 7.5)
    for (const module of modules) {
        module_registry.register(module);
    }
    ui_state.modules.registry = module_registry;

    // Apply persisted visibility for registered modules.
    for (const [id, visible] of ui_state.modules.visibility.entries()) {
        module_registry.set_visibility(id, visible);
    }
    // Ensure visibility defaults are persisted for key closable modules.
    if (!ui_state.modules.visibility.has('character_module')) {
        ui_state.modules.visibility.set('character_module', ui_state.character.is_visible);
    }
    if (!ui_state.modules.visibility.has('inventory_container')) {
        ui_state.modules.visibility.set('inventory_container', ui_state.container.is_visible);
        module_registry.set_visibility('inventory_container', ui_state.container.is_visible);
    }
    if (!ui_state.modules.visibility.has('debug')) {
        ui_state.modules.visibility.set('debug', module_registry.is_visible('debug'));
    }
    ui_state.modules.visibility.set('place_painter_toolbar', true);
    module_registry.set_visibility('place_painter_toolbar', has_active_actor_claim() && ui_state.actor_claim.game_ready);
    if (!ui_state.modules.visibility.has('status')) {
        ui_state.modules.visibility.set('status', true);
        module_registry.set_visibility('status', true);
    }
    if (!ui_state.modules.visibility.has('transcript')) {
        ui_state.modules.visibility.set('transcript', true);
        module_registry.set_visibility('transcript', true);
    }
    if (!ui_state.modules.visibility.has('input')) {
        ui_state.modules.visibility.set('input', true);
        module_registry.set_visibility('input', true);
    }
    if (!ui_state.modules.visibility.has('roller')) {
        ui_state.modules.visibility.set('roller', true);
        module_registry.set_visibility('roller', true);
    }
    if (!ui_state.modules.visibility.has('debug_commander_module')) {
        ui_state.modules.visibility.set('debug_commander_module', true);
        module_registry.set_visibility('debug_commander_module', true);
    }
    if (!ui_state.modules.visibility.has('initiative')) {
        ui_state.modules.visibility.set('initiative', module_registry.is_visible('initiative'));
    }
    for (const id of place_painter_module_ids(true)) {
        ui_state.modules.visibility.set(id, false);
        module_registry.set_visibility(id, false);
    }
    apply_runtime_module_visibility();
    persist_module_layout_debounced();
    
    // Seed default positions if not persisted yet (used by NPC module positioning).
    if (!ui_state.modules.positions.has('character_module')) {
        ui_state.modules.positions.set('character_module', { x0: 160, y0: 2, x1: 198, y1: 17 });
    }
    if (!ui_state.modules.positions.has('inventory_container')) {
        ui_state.modules.positions.set('inventory_container', { x0: 160, y0: 18, x1: 198, y1: 35 });
    }

    register_window_feed({
        window_id: 'transcript',
        fetch_messages: () => fetch_log_messages(APP_CONFIG.selected_data_slot),
    });

    register_window_feed({
        window_id: 'status',
        fetch_messages: () => fetch_status_line(APP_CONFIG.selected_data_slot),
    });

    // Keep transcript + status fresh, and ensure flash_status is visible even when
    // the player isn't sending interpreter messages.
    start_window_feed_polling(800);

    // Seed debug window
    set_text_window_messages('debug', ['[debug] off | overlays:off', '[render] fps:- dt:- max:-', '[breath] now:0 rx_age:-', '[visible_step] age:-', '[intent] none', '[pipeline] stage:idle']);
    last_debug_window_signature = ['[debug] off | overlays:off', '[render] fps:- dt:- max:-', '[breath] now:0 rx_age:-', '[visible_step] age:-', '[intent] none', '[pipeline] stage:idle'].join('\n');
    window.setInterval(() => {
        maybe_refresh_debug_window_messages();
    }, DEBUG_WINDOW_REFRESH_MS);

    // Server-authoritative movement: disable legacy NPC movement loops.
    // NPC wandering and movement are now driven by the interface server breath+brain ticks.
    ui_state.place.npc_movement_active = false;

    const wsClient = initWebSocketClient();
    open_world_entry_module();
    wsClient.on('ENTITY_PLACE_TRANSITION', (payload: any) => {
        try {
            const entity_ref = String(payload?.entity_ref ?? '');
            const from_place_id = String(payload?.from_place_id ?? '').trim();
            const target_place_id = String(payload?.to_place_id ?? '').trim();
            if (!target_place_id) return;
            if (entity_ref !== get_input_actor_ref()) {
                const should_refresh_target = is_place_visible_in_scene(target_place_id);
                const should_refresh_source = is_place_visible_in_scene(from_place_id);
                if (should_refresh_source && from_place_id) void refresh_single_scene_place(from_place_id);
                if (should_refresh_target) void refresh_single_scene_place(target_place_id);
                return;
            }
            remove_actor_from_non_target_scene_places(entity_ref, target_place_id);
            const prev_actor_place_id = ui_state.place.actor_current_place_id;
            const prev_selected_place_id = ui_state.place.scene_selected_place_id;
            const painter_lock_selection = ui_state.place_painter.active && !!prev_selected_place_id;
            const follow_actor_selection = !painter_lock_selection && (!prev_selected_place_id || prev_selected_place_id === prev_actor_place_id);
            const transition_bridge_latency_ms = (typeof payload?.sent_at_ms === 'number' && Number.isFinite(payload.sent_at_ms))
                ? Math.max(0, Date.now() - Math.floor(payload.sent_at_ms))
                : null;
            debug_log(`[PLACE_SCENE] actor place transition event ${JSON.stringify({ entity_ref, from_place_id: payload?.from_place_id ?? null, to_place_id: target_place_id, prev_actor_place_id, prev_selected_place_id, painter_lock_selection, follow_actor_selection, graph_version: ui_state.place.scene_graph_version, visible_place_ids: ui_state.place.scene_visible_place_ids, transition_bridge_latency_ms, breath_index: payload?.breath_index ?? null, seq: payload?.seq ?? null })}`);
            ui_state.place.actor_current_place_id = target_place_id;
            ui_state.place.current_place_id = target_place_id;
            const cached_target_place = get_scene_place(target_place_id);
            if (cached_target_place) {
                const actor_ref = get_input_actor_ref();
                const actor_x = Math.floor(Number(payload?.x));
                const actor_y = Math.floor(Number(payload?.y));
                const actor_z = (typeof payload?.z === 'number' && Number.isFinite(payload.z)) ? Math.floor(payload.z) : null;
                const actor_seed = get_best_known_actor_presence_seed(actor_ref);
                if (Number.isFinite(actor_x) && Number.isFinite(actor_y)) {
                    const actors = Array.isArray(cached_target_place.contents?.actors_present) ? cached_target_place.contents.actors_present : [];
                    const actor_entry: any = actors.find((a: any) => a.actor_ref === actor_ref) ?? null;
                    if (actor_entry) {
                        actor_entry.tile_position = { x: actor_x, y: actor_y };
                        if (actor_z !== null) actor_entry.elevation = actor_z;
                        if (typeof actor_seed.name === 'string' && actor_seed.name.length > 0 && (typeof actor_entry.name !== 'string' || actor_entry.name.trim().length <= 0)) actor_entry.name = actor_seed.name;
                        if (typeof actor_seed.kind_id === 'string' && actor_seed.kind_id.length > 0 && typeof actor_entry.kind_id !== 'string') actor_entry.kind_id = actor_seed.kind_id;
                        if (typeof actor_seed.body_model_id === 'string' && actor_seed.body_model_id.length > 0 && typeof actor_entry.body_model_id !== 'string') actor_entry.body_model_id = actor_seed.body_model_id;
                        if (actor_seed.entity_render && !actor_entry.entity_render) actor_entry.entity_render = actor_seed.entity_render;
                        if (Array.isArray(actor_seed.tags) && actor_seed.tags.length > 0 && !Array.isArray(actor_entry.tags)) actor_entry.tags = actor_seed.tags;
                        if (typeof actor_seed.facing === 'string' && actor_seed.facing.length > 0 && typeof actor_entry.facing !== 'string') actor_entry.facing = actor_seed.facing;
                    } else {
                        actors.push({
                            actor_ref,
                            name: actor_seed.name ?? ui_state.character.display_name ?? 'Unknown Actor',
                            tile_position: { x: actor_x, y: actor_y },
                            elevation: actor_z ?? undefined,
                            facing: actor_seed.facing ?? undefined,
                            kind_id: actor_seed.kind_id ?? undefined,
                            body_model_id: actor_seed.body_model_id ?? undefined,
                            entity_render: actor_seed.entity_render ?? undefined,
                            tags: Array.isArray(actor_seed.tags) ? actor_seed.tags : [],
                            status: 'present'
                        });
                        if (!cached_target_place.contents) cached_target_place.contents = { npcs_present: [], actors_present: [], items_on_ground: [], features: [] } as any;
                        cached_target_place.contents.actors_present = actors;
                    }
                }
                const next_selected_place_id = follow_actor_selection ? target_place_id : (prev_selected_place_id ?? target_place_id);
                ui_state.place.scene_selected_place_id = next_selected_place_id;
                ui_state.place.current_place = cached_target_place;
                set_command_handler_place(cached_target_place);
                if (!painter_lock_selection) {
                    const actor_tile = cached_target_place.contents?.actors_present?.find((a: any) => a.actor_ref === get_input_actor_ref())?.tile_position;
                    if (actor_tile) snap_place_camera_follow_to_actor();
                }
                debug_log(`[PLACE_SCENE] actor place transition local handoff ${JSON.stringify({ target_place_id, used_cached_scene_place: true, next_selected_place_id, mirror_to_current_place: !painter_lock_selection, scene_places: ui_state.place.scene_places.map((p) => p.id) })}`);
            } else {
                ui_state.place.current_place = null;
                debug_log(`[PLACE_SCENE] actor place transition local handoff ${JSON.stringify({ target_place_id, used_cached_scene_place: false, visible_place_ids: ui_state.place.scene_visible_place_ids, scene_places: ui_state.place.scene_places.map((p) => p.id) })}`);
            }
            void refresh_scene_topology_preserving_selection(target_place_id, {
                preferred_selected_place_id: follow_actor_selection ? target_place_id : (prev_selected_place_id ?? target_place_id),
                mirror_to_current_place: !painter_lock_selection,
            });
        } catch {
            // ignore
        }
    });
    wsClient.on('ITEM_MUTATIONS_APPLIED', (payload: any) => {
        void handle_item_mutations_event(payload);
    });
    wsClient.on('PLACE_PRESENCE_CHANGED', (payload: any) => {
        const place_id = String(payload?.place_id ?? '').trim();
        if (!place_id || !is_place_visible_in_scene(place_id)) return;
        void refresh_single_scene_place(place_id);
    });
    wsClient.on('ACTOR_PRIVATE_STATE_CHANGED', (payload: any) => {
        const actor_ref = String(payload?.actor_ref ?? '').trim();
        if (actor_ref && actor_ref !== get_input_actor_ref()) return;
        void refresh_character_data(true);
    });
    wsClient.on('SESSION_INVALIDATED', (_payload: any) => {
        void (async () => {
            try {
                await ensure_multiplayer_session_bootstrap(true);
                await refresh_controlled_actor_binding(true);
            } catch (err) {
                debug_warn('[MultiplayerSession] session invalidation recovery failed', err);
                clear_controlled_actor_runtime_state();
                await open_actor_claim_module('startup_required', ['session expired', 'select an actor to continue']);
            }
        })();
    });
    wsClient.on('CLAIM_INVALIDATED', (_payload: any) => {
        void (async () => {
            clear_controlled_actor_runtime_state();
            await update_current_place(null, { source: 'claim_invalidated' });
            await open_actor_claim_module('startup_required', ['connection lost long enough to release actor', 'select an actor to continue']);
        })();
    });

    // Initial load of character data
    void refresh_character_data();
    
    // Refresh character data periodically (every 5 seconds)
    window.setInterval(() => {
        void refresh_character_data();
    }, 5000);

    // ============================================================
    // Phase 7.5: Dynamic Module Management - NPC Module Functions
    // ============================================================

    
    
    /**
     * Helper function to flash a module's border (visual feedback)
     */
    function flash_module_border(module_id: string, color: 'yellow' | 'red' | 'green', duration_ms: number): void {
        // TODO: Implement visual flash effect
        debug_log(`[ModuleFlash] Flashing ${module_id} with ${color} for ${duration_ms}ms`);
    }

    async function load_npc_character_data(npc_ref: string): Promise<{
        character: any;
        body_slots: EquipmentSlots;
        equipped_items: Map<string, { instance: ItemInstance; definition: ItemDefinition }>;
        weight_data: { current: number; max: number };
    }> {
        return load_character_module_data(npc_ref);
    }

     /**
      * Phase 7: Open a container in a new ContainerModule instance.
      *
      * Supports inline container paths (`body_slots.*`, `actor.item.*`, `place.item.*`)
      * and special UI containers like piles.
      */
    async function open_owner_inventory_view(container_id: string, source_name?: string): Promise<void> {
        debug_log(`[ContainerOpener] === OPENING CONTAINER: ${container_id} ===`);
        debug_log(`[ContainerOpener] Source name: ${source_name || '(none)'}`);

        const opening_lock_id = container_id;

        // Redirect support: if this id is an alias for a canonical open container, treat as already open.
        try {
            const canonical = ui_state.container.canonical_by_alias.get(container_id);
            if (canonical && ui_state.container.open_containers.has(canonical)) {
                ui_state.container.open_containers.add(container_id);
                const mid = ui_state.container.container_module_map.get(canonical);
                if (mid) ui_state.container.container_module_map.set(container_id, mid);
                flash_status([`Container already open`], 800);
                return;
            }
        } catch {
            // ignore
        }
        
        // Check if already open
        if (ui_state.container.open_containers.has(container_id)) {
            debug_log(`[ContainerOpener] Container ${container_id} already open, skipping`);
            flash_status([`Container already open`], 800);
            return;
        }
        
        // Check if currently being opened (prevents double-clicks)
        if (ui_state.container.opening_containers.has(opening_lock_id)) {
            debug_log(`[ContainerOpener] Container ${container_id} is already being opened, ignoring click`);
            return;
        }
        
        // Mark as opening (acquire lock)
        ui_state.container.opening_containers.add(opening_lock_id);
        debug_log(`[ContainerOpener] Acquired opening lock for ${opening_lock_id}`);
        
        try {
            let container: any;
            let container_data: any;
            let owner_view_data: OwnerInventoryView | null = null;
            let use_owner_inventory_module = false;
            let reload_owner_view: (() => Promise<OwnerInventoryView | null>) | null = null;

            // Pile UI (virtual container representing a ground tile with 2+ items)
            if (container_id.startsWith('place.pile.')) {
                const parts = container_id.split('.');
                const place_id = parts[2];
                const position_key = parts[3];
                if (!place_id || !position_key) {
                    flash_status(['Invalid pile id'], 1500);
                    return;
                }

                const item_ids = ui_state.place.ground_items_by_voxel.get(position_key) ?? [];
                if (item_ids.length <= 1) {
                    // Auto-revert: no pile.
                    return;
                }
                owner_view_data = await load_pile_owner_inventory_view(place_id, position_key);
                reload_owner_view = () => load_pile_owner_inventory_view(place_id, position_key);
                if (!owner_view_data) return;
                use_owner_inventory_module = true;
            }

            // Open a container-item on the ground by item id
            else if (container_id.startsWith('place.item.')) {
                const parts = container_id.split('.');
                const place_id = parts[2];
                const item_id = parts[3];
                if (!place_id || !item_id) {
                    flash_status(['Invalid container id'], 1500);
                    return;
                }

                owner_view_data = await load_place_item_owner_inventory_view(place_id, item_id);
                reload_owner_view = () => load_place_item_owner_inventory_view(place_id, item_id);
                if (!owner_view_data) {
                    flash_status(['Container not found'], 1500);
                    return;
                }
                use_owner_inventory_module = true;
            }

            // Open a tile container (inline tile contents)
            else if (container_id.startsWith('place.tile.')) {
                // place.tile.<place_id>.<x>_<y>_<z>
                const parsed = parse_place_tile_container_id(container_id);
                if (!parsed) {
                    flash_status(['Invalid tile container id'], 1500);
                    return;
                }

                const tile_owner_res = await load_tile_owner_inventory_view(parsed.place_id, parsed.x, parsed.y, parsed.z);
                if (!tile_owner_res?.view) {
                    flash_status(['Tile container not found'], 1500);
                    return;
                }
                owner_view_data = tile_owner_res.view;
                reload_owner_view = async () => (await load_tile_owner_inventory_view(parsed.place_id, parsed.x, parsed.y, parsed.z))?.view ?? null;
                use_owner_inventory_module = true;

                const canonical_id = typeof tile_owner_res.redirect?.canonical_id === 'string' && tile_owner_res.redirect.canonical_id.length > 0
                    ? String(tile_owner_res.redirect.canonical_id)
                    : container_id;
                const alias_ids: string[] = Array.isArray(tile_owner_res.redirect?.alias_ids)
                    ? tile_owner_res.redirect.alias_ids.map((s: any) => String(s)).filter((s: string) => s.length > 0)
                    : [];
                if (canonical_id !== container_id && ui_state.container.open_containers.has(canonical_id)) {
                    const all_aliases = Array.from(new Set([container_id, canonical_id, ...alias_ids]));
                    ui_state.container.aliases_by_canonical.set(canonical_id, all_aliases);
                    for (const a of all_aliases) ui_state.container.canonical_by_alias.set(a, canonical_id);
                    for (const a of all_aliases) ui_state.container.open_containers.add(a);
                    flash_status([`Container already open`], 800);
                    return;
                }
                const all_aliases = Array.from(new Set([container_id, canonical_id, ...alias_ids]));
                if (tile_owner_res.redirect && all_aliases.length > 0) {
                    ui_state.container.aliases_by_canonical.set(canonical_id, all_aliases);
                    for (const a of all_aliases) ui_state.container.canonical_by_alias.set(a, canonical_id);
                }
                if (canonical_id !== container_id) {
                    container_id = canonical_id;
                }
            }

            // Open an arbitrary actor-owned container-item (nested/equipped) by item id
            else if (container_id.startsWith('actor.item.')) {
                const parts = container_id.split('.');
                const actor_id = parts[2];
                const item_id = parts[3];
                if (!actor_id || !item_id) {
                    flash_status(['Invalid container id'], 1500);
                    return;
                }

                owner_view_data = await load_actor_item_owner_inventory_view(actor_id, item_id);
                reload_owner_view = () => load_actor_item_owner_inventory_view(actor_id, item_id);
                if (!owner_view_data) {
                    flash_status(['Container not found'], 1500);
                    return;
                }
                use_owner_inventory_module = true;
            }
            
            // NEW INLINE SYSTEM: Handle body_slots paths
            else if (container_id.startsWith('body_slots.')) {
                debug_log(`[ContainerOpener] NEW INLINE SYSTEM: Opening body_slots container: ${container_id}`);
                
                const actor_id = get_controlled_actor_id();
                if (!actor_id) {
                    debug_log(`[ContainerOpener] ERROR: No actor selected`);
                    flash_status([`No actor selected`], 1500);
                    return;
                }
                
                // Parse the path: body_slots.{slot_name}.{slot_type}.{index?}
                const path_parts = container_id.split('.');
                if (path_parts.length < 3) {
                    debug_log(`[ContainerOpener] ERROR: Invalid body_slots path format: ${container_id}`);
                    flash_status([`Invalid container path`], 1500);
                    return;
                }
                
                // Reconstruct the path without the 'body_slots.' prefix
                const container_path = path_parts.slice(1).join('.');
                owner_view_data = await load_body_slot_owner_inventory_view(actor_id, container_path);
                reload_owner_view = () => load_body_slot_owner_inventory_view(actor_id, container_path);
                if (!owner_view_data) {
                    flash_status([`Container not found`], 1500);
                    return;
                }
                use_owner_inventory_module = true;
                
                debug_log(`[ContainerOpener] Successfully loaded body-slot owner view: ${container_path}`);
            }
            // NEW INLINE SYSTEM: Handle ground containers
            else if (container_id.startsWith('place.ground.')) {
                debug_log(`[ContainerOpener] Redirecting legacy ground container: ${container_id}`);

                // Legacy form: place.ground.{place_id}.{position_key}.{index}
                // Final inventory model uses place.item for single container-items and
                // place.pile for voxel piles, so resolve the concrete item id and reopen there.
                const path_parts = container_id.split('.');
                if (path_parts.length < 5) {
                    debug_log(`[ContainerOpener] ERROR: Invalid place.ground path format: ${container_id}`);
                    flash_status([`Invalid container path`], 1500);
                    return;
                }

                const place_id = path_parts[2]!;
                const position_key = path_parts[3]!;
                const item_index = parseInt(path_parts[4]!, 10);
                if (!Number.isFinite(item_index) || item_index < 0) {
                    flash_status([`Invalid ground container index`], 1500);
                    return;
                }

                const item_ids = ui_state.place.ground_items_by_voxel.get(position_key) ?? [];
                const item_id = item_ids[item_index] ?? null;
                if (!item_id) {
                    flash_status([`Ground container not found`], 1500);
                    return;
                }

                void open_owner_inventory_view(`place.item.${place_id}.${item_id}`, source_name);
                return;
            }
            // OLD SYSTEM: Handle regular container IDs (container.xxx format) - DEPRECATED but kept for transition
            else {
                flash_status([`Unsupported container id`], 1500);
                return;
            }
            
            // Assign a stable window slot (1..5) so positions persist per "version".
            const MAX_SLOTS = 5;
            let slot_index = -1;
            for (let i = 0; i < MAX_SLOTS; i++) {
                if (!ui_state.container.container_slots[i]) { slot_index = i; break; }
            }
            if (slot_index === -1) {
                flash_status([`Too many containers open (max ${MAX_SLOTS})`], 1500);
                return;
            }

            ui_state.container.container_slots[slot_index] = container_id;
            ui_state.container.container_slot_by_container_id.set(container_id, slot_index + 1);

            const instance_id = `container_slot_${slot_index + 1}`;

            const grid_w = APP_CONFIG.grid_width;
            const grid_h = APP_CONFIG.grid_height;
            const module_w = 39;
            const module_h = 18;

            // Prefer persisted position for this slot.
            const persisted = ui_state.modules.positions.get(instance_id);
            const offset_x = slot_index * 4;
            const offset_y = slot_index * 2;
            const container_rect = persisted ?? {
                x0: Math.floor((grid_w - module_w) / 2) + offset_x,
                y0: Math.floor((grid_h - module_h) / 2) + offset_y,
                x1: Math.floor((grid_w + module_w) / 2) + offset_x,
                y1: Math.floor((grid_h + module_h) / 2) + offset_y,
            };
            
            if (!use_owner_inventory_module || !owner_view_data) {
                flash_status([`Unsupported container id`], 1500);
                return;
            }

            const container_module = make_owner_inventory_module({
                id: instance_id,
                rect: container_rect,
                get_view: () => owner_view_data,
                get_is_visible: () => true,
                set_is_visible: (visible: boolean) => {
                    if (!visible) close_owner_inventory_view(container_id);
                },
                on_open_nested_container: (item_id: string, item_name: string) => {
                    if (container_id.startsWith('place.pile.')) {
                        const place = get_current_place();
                        if (place) void open_owner_inventory_view(`place.item.${place.id}.${item_id}`, item_name);
                    } else if (container_id.startsWith('place.tile.')) {
                        flash_status(['Nested tile containers not supported yet'], 1500);
                    } else if (container_id.startsWith('place.item.')) {
                        flash_status(['Nested ground containers not supported yet'], 1500);
                    } else {
                        void open_owner_inventory_view(`actor.item.${get_controlled_actor_id()}.${item_id}`, item_name);
                    }
                },
                on_select_item: (surface, slot) => {
                    const selection = build_item_selection_from_surface(surface, slot);
                    if (!selection) return;
                    select_item_for_entity_inspector(selection);
                },
                on_slot_hover: async (_surface, slot) => {
                    if (slot?.item) {
                        const source_container_id = get_container_id_from_target_id(slot.slot_target_id);
                        if (!source_container_id) {
                            clear_item_legality_highlight();
                            return;
                        }
                        const definition = {
                            id: slot.item.def_id,
                            name: slot.item.name,
                            display_char: slot.item.display_char,
                            tags: slot.item.tags,
                        } as ItemDefinition;
                        await apply_item_legality_highlight(slot.item.id, source_container_id, definition, source_container_id);
                    } else {
                        clear_item_legality_highlight();
                    }
                },
                on_drag_start: (surface, slot, definition) => {
                    if (!slot.item) return;
                    const validation = drag_state.can_drag(slot.item.id, definition);
                    if (!validation.can) {
                        flash_status([validation.reason!], 1500);
                        return;
                    }
                    const source_container_id = get_container_id_from_target_id(slot.slot_target_id) ?? get_container_id_from_target_id(surface.surface_target_id);
                    if (!source_container_id) return;
                    drag_state.start_drag('container', slot.item.id, source_container_id, definition, slot.slot_index, slot.slot_target_id);
                    void apply_item_legality_highlight(slot.item.id, source_container_id, definition, source_container_id);
                },
                on_drop: async (surface, slot): Promise<boolean> => {
                    if (!drag_state.is_dragging) return false;
                    if (!surface.accepts_player_insert) return false;
                    const target_container_id = get_container_id_from_target_id(slot.slot_target_id) ?? get_container_id_from_target_id(surface.surface_target_id);
                    if (!target_container_id) return false;

                    const transfer_res = await api_transfer_inline({
                        actor_id: get_controlled_actor_id(),
                        item_instance_id: String(drag_state.item_instance_id ?? ''),
                        from_container: String(drag_state.source_container_id ?? ''),
                        to_container: target_container_id,
                        from_target_id: drag_state.source_target_id ?? undefined,
                        to_target_id: slot.slot_target_id,
                        target_grid_x: slot.grid_x,
                        target_grid_y: slot.grid_y,
                    });

                if (!transfer_res.ok) {
                    flash_status([`Transfer failed: ${transfer_res.error}`], 1500);
                    return false;
                }

                owner_view_data = reload_owner_view ? await reload_owner_view() : owner_view_data;
                if (owner_view_data) {
                    const aliases = ui_state.container.aliases_by_canonical.get(container_id) ?? [container_id];
                    for (const a of aliases) ui_state.container.owner_view_by_container_id.set(a, owner_view_data);
                }
                const source_container_id = String(drag_state.source_container_id ?? '');
                await refresh_after_transfer(source_container_id, target_container_id);
                owner_view_data = ui_state.container.owner_view_by_container_id.get(container_id) ?? owner_view_data;
                void refresh_container_data();
                flash_status([`${drag_state.item_definition?.name ?? 'Item'} moved`], 1200);
                drag_state.end_drag();
                return true;
                },
                on_drag_rejected: () => drag_state.reject_drag(),
                get_highlighted_items: () => ui_state.character.highlighted_items,
                get_open_container_ids: () => ui_state.container.open_containers,
                get_open_container_id_for_item: (surface, slot) => get_open_owner_inventory_container_id_for_item(surface, slot),
            });
            
            // Register module
            module_registry.register(container_module);

            const aliases = ui_state.container.aliases_by_canonical.get(container_id) ?? [container_id];
            for (const a of aliases) {
                ui_state.container.open_containers.add(a);
                ui_state.container.container_module_map.set(a, instance_id);
                ui_state.container.owner_view_by_container_id.set(a, owner_view_data);
            }
            
            const display_name = source_name || (owner_view_data?.owner_name ?? null) || container_id.split('.').pop() || 'container';
            flash_status([`Opened ${display_name}`], 1000);
            debug_log(`[ContainerOpener] Opened ${container_id} as ${instance_id}`);
            
        } catch (err) {
            debug_log(`[ContainerOpener] Error opening container:`, err);
            flash_status([`Failed to open container`], 1500);
        } finally {
            // Release the opening lock
            ui_state.container.opening_containers.delete(opening_lock_id);
            ui_state.container.opening_containers.delete(container_id);
        }
    }
    
    /**
     * Phase 7: Close a container module
     */
    function close_owner_inventory_view(container_id: string): void {
        debug_log(`[ContainerOpener] Closing container: ${container_id}`);

        // Canonicalize so closing an alias closes the canonical module.
        const canonical = ui_state.container.canonical_by_alias.get(container_id);
        if (canonical) container_id = canonical;
        
        // Get the module_id from our tracking map
        const module_id = ui_state.container.container_module_map.get(container_id);
        
        if (module_id) {
            // Unregister the module from the registry
            module_registry.unregister(module_id);
            debug_log(`[ContainerOpener] Unregistered module: ${module_id}`);
        } else {
            debug_log(`[ContainerOpener] Warning: No module found for ${container_id}`);
        }
        
        // Free the stable slot assignment (canonical id only).
        const slot = ui_state.container.container_slot_by_container_id.get(container_id);

        // Clean up tracking (canonical + aliases)
        const aliases = ui_state.container.aliases_by_canonical.get(container_id) ?? [container_id];
        for (const a of aliases) {
            ui_state.container.open_containers.delete(a);
            ui_state.container.container_module_map.delete(a);
            ui_state.container.canonical_by_alias.delete(a);
            ui_state.container.owner_view_by_container_id.delete(a);
        }
        ui_state.container.aliases_by_canonical.delete(container_id);
        ui_state.container.owner_view_by_container_id.delete(container_id);
        if (typeof slot === 'number' && slot >= 1 && slot <= ui_state.container.container_slots.length) {
            ui_state.container.container_slots[slot - 1] = null;
        }
        ui_state.container.container_slot_by_container_id.delete(container_id);

        
        flash_status([`Container closed`], 800);
    }

    /**
     * Open an NPC character module
     */
    async function open_npc_character_module(npc_ref: string, npc_name?: string): Promise<void> {
        const npc_id = get_character_id_from_ref(npc_ref);
        if (!npc_id) {
            debug_log(`[NPC Module] Error: Invalid NPC ref ${npc_ref}`);
            flash_status(['Error: Invalid NPC ref'], 1500);
            return;
        }
        const display_name = npc_name || get_entity_display_name(npc_ref);
        debug_log(`[NPC Module] Starting to open ${display_name} (${npc_ref})`);
        
        if (!module_registry) {
            debug_log('[NPC Module] Error: Module registry not initialized');
            flash_status(['Error: Module system not ready'], 1500);
            return;
        }
        
        const module_id = get_npc_module_id(npc_ref);
        
        // Check if already open
        if (ui_state.modules.open_npc_modules.has(npc_ref)) {
            debug_log(`[NPC Module] ${display_name} already open, flashing existing module`);
            flash_module_border(module_id, 'yellow', 500);
            flash_status([`${display_name}'s inventory already open`], 1500);
            return;
        }
        
        // Calculate position (cascade from player module)
        const player_rect = ui_state.modules.positions.get('character_module');
        if (!player_rect) {
            debug_log('[NPC Module] Error: Player character module position not found');
            flash_status(['Error: Player position unknown'], 1500);
            return;
        }
        
        const open_count = ui_state.modules.open_npc_modules.size;
        const npc_rect_default = {
            x0: player_rect.x0 - 28 - (open_count * 3),
            y0: player_rect.y0 + (open_count * 2),
            x1: player_rect.x0 - 3 - (open_count * 3),
            y1: player_rect.y1 + (open_count * 2)
        };

        const npc_rect = get_persisted_rect(module_id, npc_rect_default);
        
        debug_log(`[NPC Module] Calculated position for ${display_name}: x0=${npc_rect.x0}, y0=${npc_rect.y0} (player at x0=${player_rect.x0})`);
        
        // Load NPC data
        debug_log(`[NPC Module] Loading data for ${display_name}...`);
        let body_slots: EquipmentSlots = {};
        let equipped_items = new Map<string, { instance: ItemInstance; definition: ItemDefinition }>();
        let weight_data = { current: 0, max: 100 };

        async function refresh_npc_module_data(): Promise<void> {
            const npc_data = await load_npc_character_data(npc_ref);
            body_slots = npc_data.body_slots;
            equipped_items = npc_data.equipped_items;
            weight_data = npc_data.weight_data;
            set_character_tags(npc_ref, (npc_data.character as any)?.tags);
            const live_name = String((npc_data.character as any)?.name ?? '').trim();
            if (live_name) {
                if (module_registry.has(module_id)) {
                    // title callback reads latest closure value
                }
            }
        }

        try {
            await refresh_npc_module_data();
            debug_log(`[NPC Module] Loaded data for ${display_name}: ${Object.keys(body_slots).length} body slots, ${equipped_items.size} equipped items`);
        } catch (err) {
            debug_log(`[NPC Module] Error loading data for ${display_name}:`, err);
            flash_status([`Error loading ${display_name}'s data`], 1500);
            return;
        }
        
        // Create NPC character module
        const npc_module = make_character_module({
            id: module_id,
            rect: npc_rect,
            get_actor_name: () => get_entity_display_name(npc_ref, display_name),
            get_actor_id: () => npc_id,
            get_body_slots: () => body_slots,
            get_equipped_items: () => equipped_items,
            get_tags: () => get_character_tags(npc_ref),
            get_selected_tag_key: () => ui_state.tag_picker.entity_ref === npc_ref ? ui_state.tag_picker.selected_tag_key : null,
            get_weight_data: () => weight_data,
            get_is_visible: () => true,
            on_select_tag: (tag: TagInstance) => load_tag_picker_from_entity(npc_ref, tag),
            on_add_tag: () => { void seed_default_entity_tag(npc_ref); },
            on_slot_click: (slot_name: string, slot_type: SlotType, garb_index: number | null) => {
                debug_log(`[NPC Module] Clicked body slot: ${slot_name}.${slot_type}${garb_index !== null ? `.${garb_index}` : ''}`);
            },
            on_drag_start: (slot_name: string, slot_type: SlotType, garb_index: number | null, item: ItemInstance, definition: ItemDefinition, container_id: string) => {
                // Validate drag using centralized drag_state.can_drag()
                const validation = drag_state.can_drag(item.id, definition);
                if (!validation.can) {
                    flash_status([validation.reason!], 1500);
                    debug_log(`[NPC] Drag rejected: ${validation.reason}`);
                    return;
                }
                
                drag_state.start_drag('npc_character', item.id, container_id, definition);
            },
            on_drag_rejected: () => drag_state.reject_drag(),
            on_drop: async (slot_name: string, slot_type: SlotType, garb_index: number | null): Promise<boolean> => {
                // Handle equipping from player to NPC
                if (!drag_state.is_dragging || drag_state.source_module !== 'container') return false;
                
                let target_container_id = `container.${npc_id}.${slot_name}.${slot_type}`;
                if (garb_index !== null) {
                    target_container_id += `.${garb_index}`;
                }
                
                try {
                    const transfer_data = await api_transfer_inline({
                        actor_id: get_controlled_actor_id(),
                        item_instance_id: String(drag_state.item_instance_id ?? ''),
                        from_container: String(drag_state.source_container_id ?? ''),
                        to_container: target_container_id,
                    });
                    
                    if (transfer_data.ok) {
                        await refresh_npc_module_data();
                        flash_status([`${drag_state.item_definition?.name} given to ${get_entity_display_name(npc_ref, display_name)}`], 1500);
                        drag_state.end_drag();
                        return true;
                    } else {
                        flash_status([`Failed to give item: ${transfer_data.error}`], 1500);
                        drag_state.end_drag();
                        return false;
                    }
                } catch (err) {
                    flash_status([`Error transferring item`], 1500);
                    drag_state.end_drag();
                    return false;
                }
            },
            on_cross_module_drop: async (x: number, y: number): Promise<boolean> => {
                // Handle unequipping from NPC to player/container
                if (!drag_state.is_dragging || drag_state.source_module !== 'npc_character') return false;
                
                // Check if drop is on container module
                const container_module = module_registry.get('inventory_container');
                if (container_module && 
                    x >= container_module.rect.x0 && x <= container_module.rect.x1 &&
                    y >= container_module.rect.y0 && y <= container_module.rect.y1) {
                    
                    const target_container_id = await get_inventory_panel_drop_target_container_id();
                    if (!target_container_id) {
                        drag_state.end_drag();
                        return false;
                    }
                    
                    try {
                        const transfer_data = await api_transfer_inline({
                            actor_id: get_controlled_actor_id(),
                            item_instance_id: String(drag_state.item_instance_id ?? ''),
                            from_container: String(drag_state.source_container_id ?? ''),
                            to_container: target_container_id,
                        });
                        
                        if (transfer_data.ok) {
                            await refresh_npc_module_data();
                            flash_status([`${drag_state.item_definition?.name} taken from ${get_entity_display_name(npc_ref, display_name)}`], 1500);
                            drag_state.end_drag();
                            return true;
                        } else {
                            flash_status([`Failed to take item: ${transfer_data.error}`], 1500);
                            drag_state.end_drag();
                            return false;
                        }
                    } catch (err) {
                        flash_status([`Error transferring item`], 1500);
                        drag_state.end_drag();
                        return false;
                    }
                }
                
                drag_state.end_drag();
                return false;
            },
            // NPC character module: can close and move
            gizmos: {
                enabled: ['close', 'move', 'seamless'],
                can_close: true,
                can_move: true,
                can_save_position: false,
                on_close: () => {
                    debug_log(`[NPC Module] Close gizmo clicked - closing ${display_name}`);
                    close_npc_module(npc_ref);
                    flash_status([`${get_entity_display_name(npc_ref, display_name)}'s inventory closed`], 1000);
                },
                on_move_start: () => {
                    debug_log(`[NPC Module] Move mode started for ${display_name}`);
                },
                on_move: (new_rect) => {
                    ui_state.modules.positions.set(module_id, new_rect);
                    debug_log(`[NPC Module] Moving ${display_name} to (${new_rect.x0},${new_rect.y0})`);
                    persist_module_layout_debounced();
                },
                on_move_end: (final_rect) => {
                    ui_state.modules.positions.set(module_id, final_rect);
                    flash_status([`${get_entity_display_name(npc_ref, display_name)}'s panel moved`], 1000);
                    persist_module_layout_debounced();
                },
            },
            // Container sidebar: Show equipped containers only (NEW INLINE SYSTEM)
            get_equipped_containers: (() => {
                let last_body_slots_ref: any = null;
                let last_result: Array<{
                    slot_name: string;
                    item_instance: ItemInstance;
                    item_definition: ItemDefinition;
                    container_id: string;
                }> = [];

                return () => {
                const containers: Array<{
                    slot_name: string;
                    item_instance: ItemInstance;
                    item_definition: ItemDefinition;
                    container_id: string;
                }> = [];
                if (!body_slots) {
                    last_body_slots_ref = body_slots;
                    last_result = containers;
                    return containers;
                }
                if (body_slots === last_body_slots_ref) return last_result;
                
                // NEW INLINE SYSTEM: Walk body_slots directly to find containers
                for (const [slot_name, slot_data] of Object.entries(body_slots)) {
                    const slot = slot_data as any;
                    if (!slot) continue;
                    
                    // Check armor slot for CONTAINER tag
                    if (slot.armor) {
                        const is_container = has_tag(slot.armor.tags, 'CONTAINER');
                        if (is_container) {
                            containers.push({
                                slot_name: `${slot_name}.armor`,
                                item_instance: slot.armor as ItemInstance,
                                item_definition: { name: slot.armor.name, tags: slot.armor.tags } as ItemDefinition,
                                container_id: `body_slots.${slot_name}.armor`,
                            });
                        }
                    }
                    
                    // Check tool slot for CONTAINER tag
                    if (slot.tool) {
                        const is_container = has_tag(slot.tool.tags, 'CONTAINER');
                        if (is_container) {
                            containers.push({
                                slot_name: `${slot_name}.tool`,
                                item_instance: slot.tool as ItemInstance,
                                item_definition: { name: slot.tool.name, tags: slot.tool.tags } as ItemDefinition,
                                container_id: `body_slots.${slot_name}.tool`,
                            });
                        }
                    }
                    
                    // Check garb slots for CONTAINER tag
                    if (slot.garb && Array.isArray(slot.garb)) {
                        for (let i = 0; i < slot.garb.length; i++) {
                            const garb_item = slot.garb[i];
                            const is_container = has_tag(garb_item.tags, 'CONTAINER');
                            if (is_container) {
                                containers.push({
                                    slot_name: `${slot_name}.garb.${i}`,
                                    item_instance: garb_item as ItemInstance,
                                    item_definition: { name: garb_item.name, tags: garb_item.tags } as ItemDefinition,
                                    container_id: `body_slots.${slot_name}.garb.${i}`,
                                });
                            }
                        }
                    }
                }

                last_body_slots_ref = body_slots;
                last_result = containers;
                return containers;
                };
            })(),
            on_container_click: (container_id: string) => {
                debug_log(`[NPC Module] Container clicked: ${container_id}`);
                // Phase 7: Open container in new ContainerModule
                void open_owner_inventory_view(container_id, `${get_entity_display_name(npc_ref, display_name)}'s container`);
            },
            // Phase 7: Right-click container opening
            on_open_container: async (container_id: string, slot_name: string) => {
                debug_log(`[NPC Module] Opening container via right-click: ${container_id}`);
                await open_owner_inventory_view(container_id, `${get_entity_display_name(npc_ref, display_name)}'s ${slot_name}`);
            },
            get_open_containers: () => ui_state.container.open_containers,
        });
        
        // Register the module
        module_registry.register(npc_module);
        ui_state.modules.positions.set(module_id, npc_rect);
        ui_state.modules.open_npc_modules.add(npc_ref);
        
        const total_modules = module_registry.get_all().length;
        debug_log(`[NPC Module] Successfully opened ${display_name} (${module_id}) at position (${npc_rect.x0},${npc_rect.y0})`);
        debug_log(`[NPC Module] Total modules in registry: ${total_modules}`);
        flash_status([`Opened ${get_entity_display_name(npc_ref, display_name)}'s inventory`], 1500);
    }

    /**
     * Close an NPC character module
     */
    function close_npc_module(npc_ref: string): void {
        if (!module_registry) return;
        const module_id = get_npc_module_id(npc_ref);
        
        module_registry.unregister(module_id);
        ui_state.modules.open_npc_modules.delete(npc_ref);
        // Keep last rect persisted so reopening restores it.
        persist_module_layout_debounced();
        
        debug_log(`[NPC Module] Closed ${module_id}`);
    }

    /**
     * Test function for dynamic module system
     */
    function test_dynamic_modules(): void {
        debug_log('[ModuleRegistry] Testing dynamic module system...');
        
        // Test 1: Register a temporary module
        const test_module = make_fill_module({
            id: 'test_dynamic_module',
            rect: { x0: 50, y0: 25, x1: 60, y1: 30 },
            char: 'T',
            rgb: { r: 255, g: 255, b: 0 },
            style: 'regular'
        });
        
        module_registry.register(test_module);
        debug_log(`[ModuleRegistry] Registered test module, total: ${module_registry.get_all().length}`);
        
        // Test 2: Unregister after 3 seconds
        window.setTimeout(() => {
            module_registry.unregister('test_dynamic_module');
            debug_log(`[ModuleRegistry] Unregistered test module, total: ${module_registry.get_all().length}`);
        }, 3000);
    }

    // Expose NPC module functions for testing
    (window as any).open_npc_module = open_npc_character_module;
    (window as any).close_npc_module = close_npc_module;
    (window as any).test_dynamic_modules = test_dynamic_modules;

    window.addEventListener('beforeunload', () => {
        release_actor_claim_on_exit();
    });

    return {
        modules: module_registry.get_all(),
        update_layout,
        start_window_feed_polling,
        module_registry,  // Expose for subscription
        // Called when drag ends outside any module - triggers rejection animation
        on_drag_end_outside: (x: number, y: number) => {
            if (drag_state.is_dragging) {
                drag_state.reject_drag();
            }
        },
        // Global pointer move hook used by CanvasRuntime.
        on_pointer_move_global: (x: number, y: number) => {
            drag_state.update_position(x, y);

            // Update Place DOM parallax (centered on place module inner rect, clamped).
            try {
                const place_mod = module_registry.get('place');
                if (place_mod) {
                    const r = place_mod.rect;
                    const inner = { x0: r.x0 + 1, y0: r.y0 + 1, x1: r.x1 - 1, y1: r.y1 - 1 };
                    const cx = (inner.x0 + inner.x1) / 2;
                    const cy = (inner.y0 + inner.y1) / 2;
                    const max_dx = (inner.x1 - inner.x0) / 2;
                    const max_dy = (inner.y1 - inner.y0) / 2;
                    const clamped_x = Math.max(inner.x0, Math.min(inner.x1, x));
                    const clamped_y = Math.max(inner.y0, Math.min(inner.y1, y));
                    const ox = max_dx > 0 ? (clamped_x - cx) / max_dx : 0;
                    const oy = max_dy > 0 ? (clamped_y - cy) / max_dy : 0;
                    ui_state.place.mouse_parallax = { x: ox, y: oy };
                }
            } catch {
                // ignore
            }
        },
        set_current_place_pause_source,
        create_current_place_pause_controller,
        get_current_place_pause_state: () => ({
            paused: ui_state.place.pause_state.paused,
            time_scale: ui_state.place.pause_state.time_scale,
            pause_sources: [...ui_state.place.pause_state.pause_sources],
        }),
        // Overlay hook (after compose) used by CanvasRuntime.
        on_after_compose: (canvas: any) => {
            drag_state.render_drag_ghost(canvas);

            try {
                const now_wall = Date.now();
                const now = performance.now();
                renderer_debug.render_count += 1;
                if (renderer_debug.last_render_ms > 0) {
                    renderer_debug.last_render_delta_ms = Math.max(0, now - renderer_debug.last_render_ms);
                    renderer_debug.last_render_fps = renderer_debug.last_render_delta_ms > 0
                        ? Math.max(0, Math.round(1000 / renderer_debug.last_render_delta_ms))
                        : 0;

                    if (renderer_debug.render_window_started_ms <= 0) {
                        renderer_debug.render_window_started_ms = now;
                    }
                    renderer_debug.render_window_samples += 1;
                    renderer_debug.render_window_dt_sum_ms += renderer_debug.last_render_delta_ms;
                    renderer_debug.render_window_dt_max_ms = Math.max(renderer_debug.render_window_dt_max_ms, renderer_debug.last_render_delta_ms);
                    if (renderer_debug.last_render_delta_ms >= 33) renderer_debug.render_window_hitch_33_count += 1;
                    if (renderer_debug.last_render_delta_ms >= 50) renderer_debug.render_window_hitch_50_count += 1;
                    if (renderer_debug.last_render_delta_ms >= 100) renderer_debug.render_window_hitch_100_count += 1;
                    renderer_debug.render_window_avg_fps = avg_to_fps(
                        renderer_debug.render_window_samples > 0
                            ? (renderer_debug.render_window_dt_sum_ms / renderer_debug.render_window_samples)
                            : 0,
                    );

                    const window_elapsed_ms = Math.max(0, now - renderer_debug.render_window_started_ms);
                    if (window_elapsed_ms >= 1500) {
                        const avg_dt = renderer_debug.render_window_samples > 0
                            ? renderer_debug.render_window_dt_sum_ms / renderer_debug.render_window_samples
                            : 0;
                        renderer_debug.render_window_avg_fps = avg_to_fps(avg_dt);
                        renderer_debug.render_window_started_ms = now;
                        renderer_debug.render_window_samples = 0;
                        renderer_debug.render_window_dt_sum_ms = 0;
                        renderer_debug.render_window_dt_max_ms = 0;
                        renderer_debug.render_window_hitch_33_count = 0;
                        renderer_debug.render_window_hitch_50_count = 0;
                        renderer_debug.render_window_hitch_100_count = 0;
                    }
                }
                renderer_debug.last_render_ms = now;

                const place = get_current_place();
                const breath_index = Math.floor(Number((place as any)?.breath_index ?? 0)) || 0;
                if (breath_index > 0 && breath_index !== renderer_debug.last_place_breath_index) {
                    renderer_debug.last_place_breath_index = breath_index;
                    renderer_debug.breath_observed_count += 1;
                    renderer_debug.last_place_breath_changed_ms = now_wall;
                }

                const follow_target = resolve_follow_actor_camera_focus_region();
                const actor_key = follow_target
                    ? `${get_follow_camera_entity_ref() ?? 'unknown'}:${follow_target.place_id}:${follow_target.local_x},${follow_target.local_y},${follow_target.world_z}`
                    : null;
                if (actor_key && actor_key !== renderer_debug.last_actor_pos_key) {
                    renderer_debug.last_actor_pos_key = actor_key;
                    renderer_debug.actor_pos_change_count += 1;
                    renderer_debug.last_actor_pos_changed_ms = now_wall;
                }
                update_place_camera_follow(now_wall);
            } catch {
                // ignore
            }

            // Place DOM world layers live outside the mono canvas.
            // CanvasRuntime stops drawing invisible modules, so we must hide/show the DOM layers
            // in sync with module visibility to avoid "stale" world layers floating on screen.
            try {
                const container = document.getElementById('voxel_layers_container');
                if (!container) return;
                const place_visible = module_registry?.is_visible ? module_registry.is_visible('place') : true;
                const nodes = container.querySelectorAll('[data-place-world-layers]');
                for (const el of Array.from(nodes)) {
                    (el as HTMLElement).style.display = place_visible ? '' : 'none';
                }
            } catch {
                // ignore
            }
        },
    };
}
