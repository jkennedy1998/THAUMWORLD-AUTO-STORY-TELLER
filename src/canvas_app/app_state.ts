import { make_fill_module } from '../mono_ui/modules/fill_module.js';
import { make_button_module } from '../mono_ui/modules/button_module.js';
import { make_text_window_module, type TextWindowMessage } from '../mono_ui/modules/window_module.js';
import { make_input_module } from '../mono_ui/modules/input_module.js';
import { make_roller_module } from '../mono_ui/modules/roller_module.js';
import { make_place_module } from '../mono_ui/modules/place_module.js';
import { make_container_module, type SlotItem } from '../mono_ui/modules/container_module.js';
import { make_character_module } from '../mono_ui/modules/character_module.js';
import type { SlotType } from '../equipment/body_slot_resolver.js';
import type { Module, Rgb, Rect } from '../mono_ui/types.js';
import { create_module_registry, type ModuleRegistry } from '../mono_ui/module_registry.js';
import { handleEntityClick } from '../interface_program/frontend_api.js';
import type { Place } from '../types/place.js';
import { debug_warn, debug_log } from '../shared/debug.js';
import { resolve_char } from '../render_shaders/resolver.js';
import { init_npc_movement, stop_place_movement, is_npc_moving } from '../npc_ai/movement_loop.js';
import { debug_peek_next_step } from '../shared/movement_engine.js';
import { can_place_volume } from '../place_storage/movement_legality.js';
import { start_movement_command_handler, set_command_handler_place } from '../mono_ui/modules/movement_command_handler.js';
import { get_color_by_name } from '../mono_ui/colors.js';
import { infer_action_verb_hint } from '../shared/intent_hint.js';
// NOTE: Do NOT import Node.js modules (load_actor, find_kind, etc.) here.
// This code runs in browser context and must use HTTP APIs instead.
import type { Container } from '../types/container.js';
import { calculate_grid_dimensions, get_container_grid } from '../container_storage/grid_calculator.js';
import { type ItemInstance } from '../item_instances/store.js';
import { type ItemDefinition } from '../item_storage/store.js';
import { type BodySlots, get_slot_item_id } from '../types/body_slots.js';
import { DEBUG_VISION, set_debug_bundle_enabled, spawn_sense_broadcast_particles } from '../mono_ui/vision_debugger.js';
import { set_ui_debug_enabled, UI_DEBUG } from '../mono_ui/runtime/ui_debug.js';
import { get_senses_for_action } from '../action_system/sense_broadcast.js';
import { get_facing } from '../npc_ai/facing_system.js';
import { play_sfx } from '../mono_ui/sfx/sfx_player.js';
import {
    api_transfer_inline,
} from './transfer_api.js';

export const APP_CONFIG = {
    font_family: 'Martian Mono',
    // Typography tuned to match the design reference:
    // - size: 32.23px
    // - line height: 29.8px (29.8 / 32.23 ≈ 0.925)
    // - letter spacing: -18% (of font size)
    base_font_size_px: 32.23,
    base_line_height_mult: 29.8 / 32.23,
    base_letter_spacing_mult: -0.10,
    weight_index_to_css: [100, 200, 300, 400, 500, 600, 700, 800] as const,

    grid_width: 200,  // Expanded: 160 for main UI + 40 for debug button column
    grid_height: 50,

    interpreter_endpoint: 'http://localhost:8787/api/input',
    interpreter_log_endpoint: 'http://localhost:8787/api/log',
    interpreter_status_endpoint: 'http://localhost:8787/api/status',
    interpreter_targets_endpoint: 'http://localhost:8787/api/targets',
    place_endpoint: 'http://localhost:8787/api/place',
    roller_status_endpoint: 'http://localhost:8787/api/roller_status',
    roller_roll_endpoint: 'http://localhost:8787/api/roll',
    selected_data_slot: 1,
    input_actor_id: 'henry_actor',
} as const;

export type AppState = {
    modules: readonly Module[];
    start_window_feed_polling: (interval_ms: number) => void;
    module_registry: ModuleRegistry;
    on_drag_end_outside: (x: number, y: number) => void;
    on_pointer_move_global: (x: number, y: number, e: any) => void;
    on_after_compose: (canvas: any) => void;
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
    if (!definition.tags) return false;
    
    const container_tags = ['CONTAINER', 'BAG', 'SACK', 'POUCH', 'BACKPACK', 'WALLET', 'CHEST', 'BOX'];
    
    for (const tag of definition.tags) {
        if (container_tags.includes(tag.name.toUpperCase())) {
            return true;
        }
    }
    
    return false;
}

function has_tag(tags: any[] | undefined | null, want: string): boolean {
    const up = String(want ?? '').toUpperCase();
    if (!up) return false;
    return Array.isArray(tags) && tags.some((t: any) => String(t?.name ?? '').toUpperCase() === up);
}

export function create_app_state(): AppState {
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
        place: {
            current_place_id: null as string | null,
            current_place: null as Place | null,
            npc_movement_active: false,
            // World focus layer for Place DOM renderer (0/1/2)
            focus_z: 1 as 0 | 1 | 2,
            // World-Z center for the 3-layer viewport window.
            // Interpreted as an absolute elevation value; layers represent [center-1, center, center+1].
            world_z_center: 0,
            // Mouse parallax normalized (-1..+1) centered on Place viewport
            mouse_parallax: { x: 0, y: 0 },
            // Ground item cache (inline ground_store) for richer interactions (pile/single/container detection)
            ground_items_by_id: new Map<string, {
                id: string;
                def_id: string;
                name: string;
                qty: number;
                weight: number;
                tags: any[];
                elevation?: number;
                position_key?: string;
                position?: { x: number; y: number };
            }>(),
            // Map of voxel position keys: "x_y_z" -> [item ids]
            ground_items_by_voxel: new Map<string, string[]>(),
            // Convenience map: "x_y" -> [item ids across all z]
            ground_items_by_position: new Map<string, string[]>(),
        },
        container: {
            is_visible: false,  // Toggle with 'i' key
            current_container: null as Container | null,
            slot_items: [] as SlotItem[],
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
            // Track container data for all open containers (shared state for refreshing)
            container_data_map: new Map<string, { container: Container; contents: any[] }>(),
        },
        character: {
            is_visible: true,  // Always visible for now
            body_slots: {} as BodySlots,
            equipped_items: new Map() as Map<string, { instance: ItemInstance; definition: ItemDefinition }>,
            weight: { current: 0, max: 100 },
            // Player-selected default container (body_slots path like "body_slots.leg_left.garb.0")
            default_container_id: null as string | null,
            highlighted_slots: [] as Array<{ slot_name: string; slot_type: SlotType; garb_index?: number }>,  // Slots highlighted when hovering compatible items
            hovered_item: null as { name: string; source: string } | null,  // Currently hovered item for debug display
            hovered_slot: null as string | null,  // Currently hovered body slot
            highlighted_items: [] as Array<{ container_id: string; slot_index: number }>,  // Items highlighted when hovering slot
        },
        // Module management (Phase 7.5)
        modules: {
            registry: null as ModuleRegistry | null,
            positions: new Map<string, Rect>(),
            visibility: new Map<string, boolean>(),
            open_npc_modules: new Set<string>(),
        },
    };

    // Keep the current place "active" on the server so breath continues to tick
    // even when the UI is not polling /api/place.
    let place_touch_interval_id: number | null = null;
    let place_touch_place_id: string | null = null;

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

    const MODULE_LAYOUT_STORAGE_KEY = 'thaumworld:module_layout:v1';
    const PLACE_FOCUS_Z_STORAGE_KEY = 'thaumworld:place_focus_z:v1';

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
            const z = Math.max(0, Math.min(2, Math.floor(n))) as 0 | 1 | 2;
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

    function get_persisted_rect(module_id: string, fallback: Rect): Rect {
        return ui_state.modules.positions.get(module_id) ?? fallback;
    }

    function set_module_visible(module_id: string, visible: boolean): void {
        ui_state.modules.visibility.set(module_id, visible);
        ui_state.modules.registry?.set_visibility(module_id, visible);
        if (module_id === 'character_module') ui_state.character.is_visible = visible;
        persist_module_layout_debounced();
    }

    // Load persisted module state early so it affects initial rects/visibility.
    load_persisted_module_layout();
    load_place_focus_z();

    // Shared drag state for cross-module drag-and-drop
    const drag_state = {
        is_dragging: false,
        source_module: null as string | null,
        item_instance_id: null as string | null,
        source_container_id: null as string | null,
        source_slot_index: null as number | null,
        item_definition: null as ItemDefinition | null,
        current_x: 0,
        current_y: 0,
        is_rejected: false,
        reject_start_time: 0,
        return_start_x: 0,
        return_start_y: 0,

        start_drag(source: string, item_id: string, container_id: string, def: ItemDefinition, slot_index?: number) {
            this.is_dragging = true;
            this.is_rejected = false;
            this.source_module = source;
            this.item_instance_id = item_id;
            this.source_container_id = container_id;
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
                const actor_nested = `actor.item.${APP_CONFIG.input_actor_id}.${item_id}`;
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
            this.source_slot_index = null;
            this.item_definition = null;
            // Clear highlighted slots
            ui_state.character.highlighted_slots = [];
            ui_state.character.hovered_item = null;
            debug_log(`[DragState] Ended drag`);
        }
    };



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
            const response = await fetch(`http://localhost:8787/api/item/compatible_slots?item_def_id=${item_def.id}&actor_id=${APP_CONFIG.input_actor_id}`);
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
                const res = await fetch(`http://localhost:8787/api/item_instance/compatible_slots?actor_id=${encodeURIComponent(APP_CONFIG.input_actor_id)}&item_id=${encodeURIComponent(item_instance_id)}`);
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

    // Helper function to find items in open containers compatible with a body slot
    // Returns array of { container_id, slot_index } for items that can equip to slot_name
    function get_compatible_items_for_slot(slot_name: string): Array<{ container_id: string; slot_index: number }> {
        const compatible_items: Array<{ container_id: string; slot_index: number }> = [];
        
        debug_log(`[get_compatible_items_for_slot] Searching for items compatible with ${slot_name}`);
        debug_log(`[get_compatible_items_for_slot] Open containers: ${Array.from(ui_state.container.open_containers).join(', ')}`);
        
        // Search through all open containers
        for (const container_id of ui_state.container.open_containers) {
            const container_data = ui_state.container.container_data_map.get(container_id);
            if (!container_data) {
                debug_log(`[get_compatible_items_for_slot] No data for container: ${container_id}`);
                continue;
            }
            
            debug_log(`[get_compatible_items_for_slot] Checking container: ${container_id} with ${container_data.contents.length} items`);
            
            const contents = container_data.contents;
            for (let i = 0; i < contents.length; i++) {
                const entry = contents[i];
                if (!entry?.definition) {
                    debug_log(`[get_compatible_items_for_slot] Item ${i} in ${container_id} missing definition`);
                    continue;
                }
                
                const item_name = entry.definition.name || entry.instance?.def_id || 'unknown';
                // defs+deltas migration: treat instance.tags as non-authoritative; prefer definition/effective tags.
                const tags: any[] = entry.definition?.tags ?? [];

                function meta_matches(m: any, target: string): boolean {
                    const mm = String(m ?? '').trim();
                    if (!mm) return false;
                    if (mm === 'hand') return target === 'hand_left' || target === 'hand_right';
                    if (mm === 'leg') return target === 'leg_left' || target === 'leg_right';
                    return mm === target;
                }

                const armor_tag = tags.find((t: any) => t?.name === 'ARMOR');
                const garb_tag = tags.find((t: any) => t?.name === 'GARB');
                const armor_ok = armor_tag && Array.isArray(armor_tag.meta) && armor_tag.meta.some((m: any) => meta_matches(m, slot_name));
                const garb_ok = garb_tag && Array.isArray(garb_tag.meta) && garb_tag.meta.some((m: any) => meta_matches(m, slot_name));

                // Hand tool slots: any item can be held.
                const tool_ok = slot_name === 'hand_left' || slot_name === 'hand_right';

                if (tool_ok || armor_ok || garb_ok) {
                    compatible_items.push({ container_id, slot_index: i });
                    debug_log(`[get_compatible_items_for_slot] ✓ ${item_name} (slot ${i}) compatible with ${slot_name}`);
                } else {
                    debug_log(`[get_compatible_items_for_slot] ✗ ${item_name} (slot ${i}) NOT compatible`);
                }
            }
        }
        
        debug_log(`[get_compatible_items_for_slot] Found ${compatible_items.length} compatible items for ${slot_name}`);
        return compatible_items;
    }

    // Load character data (body slots, equipped items, weight) - Phase 5 Inline System
    async function refresh_character_data(): Promise<void> {
        try {
            const actor_id = APP_CONFIG.input_actor_id;
            const slot = APP_CONFIG.selected_data_slot;
            
            // Load actor via API
            const actor_res = await fetch(`http://localhost:8787/api/actor?id=${actor_id}&slot=${slot}`);
            if (!actor_res.ok) return;
            
            const actor_data = await actor_res.json();
            if (!actor_data.ok || !actor_data.actor) return;
            
            const actor = actor_data.actor;

            // View centering is derived from the loaded place (not actor elevation).

            // Phase 5: Inline body_slots are authoritative
            const body_slots = (actor.body_slots as any) || {};
            ui_state.character.body_slots = body_slots;

            // Rebuild equipped_items directly from body_slots inline objects
            ui_state.character.equipped_items.clear();
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

            debug_log(`[LOAD_EQUIPPED] === REBUILD FROM INLINE BODY_SLOTS ===`);
            for (const [slot_name, slot_data] of Object.entries(body_slots)) {
                const s = slot_data as any;
                for (const [slot_type, value] of Object.entries({ armor: s.armor, tool: s.tool })) {
                    if (value && typeof (value as any).id === 'string') {
                        const item = value as any;
                        ui_state.character.equipped_items.set(item.id, {
                            instance: { id: item.id, def_id: item.def_id, qty: item.qty || 1, tags: item.tags || [] } as ItemInstance,
                            definition: {
                                id: item.def_id,
                                name: item.name,
                                weight: item.weight || 0,
                                tags: item.tags || [],
                                display_char: (typeof item.display_char === 'string' && item.display_char.length > 0) ? String(item.display_char).charAt(0) : '·',
                            } as ItemDefinition,
                        });
                        total_weight += add_weight(item);
                        debug_log(`[LOAD_EQUIPPED] ${slot_name}.${slot_type}: ${item.name} (${item.id})`);
                    }
                }
                if (Array.isArray(s.garb)) {
                    for (let i = 0; i < s.garb.length; i++) {
                        const item = s.garb[i];
                        if (item && typeof item.id === 'string') {
                            ui_state.character.equipped_items.set(item.id, {
                                instance: { id: item.id, def_id: item.def_id, qty: item.qty || 1, tags: item.tags || [] } as ItemInstance,
                                definition: {
                                    id: item.def_id,
                                    name: item.name,
                                    weight: item.weight || 0,
                                    tags: item.tags || [],
                                    display_char: (typeof (item as any).display_char === 'string' && String((item as any).display_char).length > 0) ? String((item as any).display_char).charAt(0) : '·',
                                } as ItemDefinition,
                            });
                            total_weight += add_weight(item);
                            debug_log(`[LOAD_EQUIPPED] ${slot_name}.garb.${i}: ${item.name} (${item.id})`);
                        }
                    }
                }
            }

            ui_state.character.weight.current = total_weight;
            const strength = (actor.stats as Record<string, number>)?.str || 50;
            ui_state.character.weight.max = strength * 2.5;

            debug_log(`[LOAD_EQUIPPED] Equipped rebuilt: ${ui_state.character.equipped_items.size} items, weight=${total_weight}`);
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
            
        } catch (err) {
            console.error('[Character] Error refreshing character data:', err);
        }
    }

    // Phase 1: Get main inventory container (equipped sack)
    // MIGRATED: Now uses new inline system with body_slots paths
    async function get_main_inventory_container(): Promise<{ container_id: string; container_data: any } | null> {
        const actor_id = APP_CONFIG.input_actor_id;
        const slot = APP_CONFIG.selected_data_slot;
        
        debug_log(`[MainInventory] === LOOKING FOR MAIN INVENTORY (INLINE SYSTEM) ===`);
        debug_log(`[MainInventory] Actor: ${actor_id}, Slot: ${slot}`);
        
        if (!actor_id) {
            flash_status(['No actor selected'], 1500);
            debug_log('[MainInventory] ERROR: No actor_id in APP_CONFIG');
            return null;
        }
        
        try {
            // Load actor to check body slots (inline system)
            const actor_res = await fetch(`http://localhost:8787/api/actor?id=${actor_id}&slot=${slot}`);
            debug_log(`[MainInventory] Actor API response: ${actor_res.status}`);
            if (!actor_res.ok) {
                debug_log(`[MainInventory] ERROR: Actor API returned ${actor_res.status}`);
                return null;
            }
            
            const actor_data = await actor_res.json();
            if (!actor_data.ok || !actor_data.actor) {
                debug_log(`[MainInventory] ERROR: Actor data invalid - ok: ${actor_data.ok}, has actor: ${!!actor_data.actor}`);
                return null;
            }
            
            const actor = actor_data.actor;
            const body_slots = actor.body_slots || {};
            debug_log(`[MainInventory] Actor loaded. Body slots: ${Object.keys(body_slots).join(', ')}`);
            
            // Priority order: leg_left, leg_right, torso, head
            // NEW INLINE SYSTEM: Look for CONTAINER tag in body_slots directly
            const slot_priority = ['leg_left', 'leg_right', 'torso', 'head'];
            
            for (const slot_name of slot_priority) {
                const body_slot = body_slots[slot_name];
                debug_log(`[MainInventory] Checking ${slot_name}`);
                
                if (!body_slot) {
                    debug_log(`[MainInventory]   ${slot_name} is empty`);
                    continue;
                }
                
                // Check armor slot for CONTAINER tag
                if (body_slot.armor) {
                    const is_container = has_tag(body_slot.armor.tags, 'CONTAINER');
                    debug_log(`[MainInventory]   ${slot_name}.armor: ${body_slot.armor.name}, is_container=${is_container}`);
                    if (is_container) {
                        const container_id = `body_slots.${slot_name}.armor`;
                        debug_log(`[MainInventory] SUCCESS: Found container at ${container_id}`);
                        return {
                            container_id,
                            container_data: {
                                id: container_id,
                                kind: 'inline_body_slot',
                                name: body_slot.armor.name,
                                path: `${slot_name}.armor`,
                                contents: body_slot.armor.contents || []
                            }
                        };
                    }
                }
                
                // Check tool slot for CONTAINER tag
                if (body_slot.tool) {
                    const is_container = has_tag(body_slot.tool.tags, 'CONTAINER');
                    debug_log(`[MainInventory]   ${slot_name}.tool: ${body_slot.tool.name}, is_container=${is_container}`);
                    if (is_container) {
                        const container_id = `body_slots.${slot_name}.tool`;
                        debug_log(`[MainInventory] SUCCESS: Found container at ${container_id}`);
                        return {
                            container_id,
                            container_data: {
                                id: container_id,
                                kind: 'inline_body_slot',
                                name: body_slot.tool.name,
                                path: `${slot_name}.tool`,
                                contents: body_slot.tool.contents || []
                            }
                        };
                    }
                }
                
                // Check garb slots for CONTAINER tag
                if (body_slot.garb && Array.isArray(body_slot.garb)) {
                    for (let i = 0; i < body_slot.garb.length; i++) {
                        const garb_item = body_slot.garb[i];
                        const is_container = has_tag(garb_item.tags, 'CONTAINER');
                        debug_log(`[MainInventory]   ${slot_name}.garb.${i}: ${garb_item.name}, is_container=${is_container}`);
                        if (is_container) {
                            const container_id = `body_slots.${slot_name}.garb.${i}`;
                            debug_log(`[MainInventory] SUCCESS: Found container at ${container_id}`);
                            return {
                                container_id,
                                container_data: {
                                    id: container_id,
                                    kind: 'inline_body_slot',
                                    name: garb_item.name,
                                    path: `${slot_name}.garb.${i}`,
                                    contents: garb_item.contents || []
                                }
                            };
                        }
                    }
                }
            }
            
            debug_log('[MainInventory] WARNING: No equipped container found in any body slot');
            flash_status(['No equipped container found'], 1500);
            return null;
        } catch (err) {
            console.error('[MainInventory] Error getting main inventory:', err);
            debug_log(`[MainInventory] EXCEPTION: ${err instanceof Error ? err.message : String(err)}`);
            return null;
        }
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

    // Refresh ALL open containers by iterating through the canonical container_data_map keys.
    async function refresh_container_data(): Promise<void> {
        const open_containers = Array.from(ui_state.container.container_data_map.keys());
        if (open_containers.length === 0) return;
        
        debug_log(`[ContainerRefresh] Refreshing ${open_containers.length} open container(s)`);
        
        for (const container_id of open_containers) {
            try {
                const slot = APP_CONFIG.selected_data_slot;
                let container: Container | null = null;
                let contents: any[] = [];

                // Virtual pile container (rebuild from cached ground items)
                if (container_id.startsWith('place.pile.')) {
                    const parts = container_id.split('.');
                    const place_id = parts[2];
                    const position_key = parts[3];
                    const item_ids = position_key ? (ui_state.place.ground_items_by_voxel.get(position_key) ?? []) : [];
                    if (item_ids.length <= 1) {
                        close_container_module(container_id);
                        continue;
                    }

                    if (!place_id || !position_key) {
                        close_container_module(container_id);
                        continue;
                    }

                    // Use canonical server payload so piles behave like all other containers.
                    const base_url = APP_CONFIG.place_endpoint.replace('/api/place', '');
                    const api_res = await fetch(`${base_url}/api/place/pile_container?place_id=${encodeURIComponent(place_id)}&position_key=${encodeURIComponent(position_key)}`);
                    if (!api_res.ok) {
                        close_container_module(container_id);
                        continue;
                    }
                    const api_data = await api_res.json();
                    if (!api_data.ok || !api_data.container) {
                        close_container_module(container_id);
                        continue;
                    }
                    contents = api_data.container.contents || [];
                    container = {
                        id: container_id,
                        kind: 'inline_pile' as any,
                        name: api_data.container.name,
                        def_id: api_data.container.def_id,
                        capacity: api_data.container.capacity,
                        contents,
                    } as any;
                }

                // Inline body_slots container
                else if (container_id.startsWith('body_slots.')) {
                    const actor_id = APP_CONFIG.input_actor_id;
                    const path = container_id.split('.').slice(1).join('.');
                    const api_res = await fetch(`http://localhost:8787/api/body_slot/container?actor_id=${encodeURIComponent(actor_id)}&path=${encodeURIComponent(path)}`);
                    if (!api_res.ok) {
                        close_container_module(container_id);
                        continue;
                    }
                    const api_data = await api_res.json();
                    if (!api_data.ok || !api_data.container) {
                        close_container_module(container_id);
                        continue;
                    }
                    contents = api_data.container.contents || [];
                    container = {
                        id: container_id,
                        kind: 'inline_body_slot' as any,
                        name: api_data.container.name,
                        def_id: api_data.container.def_id,
                        path: api_data.container.path,
                        capacity: api_data.container.capacity,
                        contents,
                    } as any;
                }

                // Inline container-item on ground
                else if (container_id.startsWith('place.item.')) {
                    const parts = container_id.split('.');
                    const place_id = parts[2];
                    const item_id = parts[3];
                    if (!place_id || !item_id) {
                        close_container_module(container_id);
                        continue;
                    }
                    const api_res = await fetch(`http://localhost:8787/api/place/container_item?place_id=${encodeURIComponent(place_id)}&item_id=${encodeURIComponent(item_id)}`);
                    if (!api_res.ok) {
                        close_container_module(container_id);
                        continue;
                    }
                    const api_data = await api_res.json();
                    if (!api_data.ok || !api_data.container) {
                        close_container_module(container_id);
                        continue;
                    }
                    contents = api_data.container.contents || [];
                    container = {
                        id: container_id,
                        kind: 'inline_ground_container_item' as any,
                        name: api_data.container.name,
                        def_id: api_data.container.def_id,
                        capacity: api_data.container.capacity,
                        contents,
                    } as any;
                }

                // Inline tile container
                else if (container_id.startsWith('place.tile.')) {
                    const parts = container_id.split('.');
                    const place_id = parts[2];
                    const pos_key = parts[3];
                    if (!place_id || !pos_key) {
                        close_container_module(container_id);
                        continue;
                    }
                    const [xs, ys] = pos_key.split('_');
                    const x = Number(xs);
                    const y = Number(ys);
                    if (!Number.isFinite(x) || !Number.isFinite(y)) {
                        close_container_module(container_id);
                        continue;
                    }
                    const api_res = await fetch(`http://localhost:8787/api/place/tile_container?place_id=${encodeURIComponent(place_id)}&x=${encodeURIComponent(String(x))}&y=${encodeURIComponent(String(y))}`);
                    if (!api_res.ok) {
                        close_container_module(container_id);
                        continue;
                    }
                    const api_data = await api_res.json();
                    if (!api_data.ok || !api_data.container) {
                        close_container_module(container_id);
                        continue;
                    }
                    contents = api_data.container.contents || [];
                    container = {
                        id: container_id,
                        kind: 'inline_tile_container' as any,
                        name: api_data.container.name,
                        def_id: api_data.container.def_id,
                        capacity: api_data.container.capacity,
                        contents,
                    } as any;
                }

                // Inline actor-owned container-item by id
                else if (container_id.startsWith('actor.item.')) {
                    const parts = container_id.split('.');
                    const actor_id = parts[2];
                    const item_id = parts[3];
                    if (!actor_id || !item_id) {
                        close_container_module(container_id);
                        continue;
                    }
                    const api_res = await fetch(`http://localhost:8787/api/actor/container_item?actor_id=${encodeURIComponent(actor_id)}&item_id=${encodeURIComponent(item_id)}`);
                    if (!api_res.ok) {
                        close_container_module(container_id);
                        continue;
                    }
                    const api_data = await api_res.json();
                    if (!api_data.ok || !api_data.container) {
                        close_container_module(container_id);
                        continue;
                    }
                    contents = api_data.container.contents || [];
                    container = {
                        id: container_id,
                        kind: 'inline_actor_container_item' as any,
                        name: api_data.container.name,
                        def_id: api_data.container.def_id,
                        capacity: api_data.container.capacity,
                        contents,
                    } as any;
                }

                else {
                    // No legacy container ids supported.
                    close_container_module(container_id);
                    continue;
                }
                
                if (container) {
                    // Update the shared state map
                    ui_state.container.container_data_map.set(container_id, { container, contents });
                    debug_log(`[ContainerRefresh] Updated ${container_id} with ${contents.length} items`);
                } else {
                    debug_log(`[ContainerRefresh] Warning: Could not refresh ${container_id}`);
                }
            } catch (err) {
                debug_log(`[ContainerRefresh] Error refreshing ${container_id}:`, err);
            }
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

    async function update_current_place(place_id: string | null): Promise<void> {
        // Stop movement for previous place if leaving
        if (place_id !== ui_state.place.current_place_id && ui_state.place.current_place_id) {
            stop_place_movement(ui_state.place.current_place_id);
            ui_state.place.npc_movement_active = false;
        }

        if (!place_id) {
            ui_state.place.current_place_id = null;
            ui_state.place.current_place = null;
            stop_place_touch_heartbeat();
            return;
        }

        // Only update ID if it's different (triggers re-center)
        const is_new_place = place_id !== ui_state.place.current_place_id;
        if (is_new_place) {
            ui_state.place.current_place_id = place_id;
            // Reset view state for new place
            ui_state.place.current_place = null;
        }

        // Keep server breath ticking for the current place while the player is in it.
        // (This prevents movement reverting to "one step per click" when /api/place polling stops.)
        ensure_place_touch_heartbeat_running();

        // Fetch place data from API
        try {
            const url = `${APP_CONFIG.place_endpoint}?slot=${APP_CONFIG.selected_data_slot}&place_id=${encodeURIComponent(place_id)}`;
            const res = await fetch(url);
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const data = (await res.json()) as { ok: boolean; place?: Place };
            if (data.ok && data.place) {
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
                            // NPC is moving, preserve current position
                            if (is_npc_moving(npc.npc_ref)) {
                                npc.tile_position = { ...current_npc.tile_position };
                            }
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

                // View centering: keep the 3-plane window anchored to the place base elevation
                // so the support plane (base_z-1) never "disappears" when the actor stands on z+1.
                try {
                    const base_z = Math.floor(Number((next_place as any)?.coordinates?.elevation ?? 0)) || 0;
                    ui_state.place.world_z_center = base_z;
                    debug_log(`[PlaceZ] world_z_center=${ui_state.place.world_z_center} (from place.coordinates.elevation)`);
                } catch {
                    // ignore
                }
                
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

                                    // Verify voxelized piles: same (x,y) can hold items at multiple z.
                                    const by_xy = new Map<string, Set<number>>();
                                    for (const [xy, ids] of ui_state.place.ground_items_by_position.entries()) {
                                        const s = by_xy.get(xy) ?? new Set<number>();
                                        for (const id of ids) {
                                            const meta: any = ui_state.place.ground_items_by_id.get(id) ?? null;
                                            const iz = (typeof meta?.elevation === 'number' && Number.isFinite(meta.elevation)) ? Math.floor(meta.elevation) : base_z;
                                            s.add(iz);
                                        }
                                        by_xy.set(xy, s);
                                    }
                                    const multi = Array.from(by_xy.values()).some((s) => s.size >= 2);
                                    if (multi) {
                                        debug_log('3DIFICATION_TEST', `PASS ground item cache supports multi-z piles (place=${next_place.id})`);
                                    } else {
                                        debug_warn('3DIFICATION_TEST', `FAIL ground item cache missing multi-z pile scenario (place=${next_place.id})`);
                                    }

                                    // Verify stacked piles: same (x,y) has 2+ items at two distinct z.
                                    const by_xy_z_count = new Map<string, Map<number, number>>();
                                    for (const [voxel_key, ids] of ui_state.place.ground_items_by_voxel.entries()) {
                                        const parts = String(voxel_key).split('_');
                                        if (parts.length !== 3) continue;
                                        const x = Number(parts[0]);
                                        const y = Number(parts[1]);
                                        const z = Number(parts[2]);
                                        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
                                        const xy = `${x}_${y}`;
                                        const mz = by_xy_z_count.get(xy) ?? new Map<number, number>();
                                        mz.set(Math.floor(z), (mz.get(Math.floor(z)) ?? 0) + ids.length);
                                        by_xy_z_count.set(xy, mz);
                                    }
                                    const stacked_piles = Array.from(by_xy_z_count.values()).some((mz) => {
                                        let pile_layers = 0;
                                        for (const c of mz.values()) {
                                            if (c >= 2) pile_layers++;
                                            if (pile_layers >= 2) return true;
                                        }
                                        return false;
                                    });
                                    if (stacked_piles) {
                                        debug_log('3DIFICATION_TEST', `PASS ground item cache supports stacked piles (place=${next_place.id})`);
                                    } else {
                                        debug_warn('3DIFICATION_TEST', `FAIL ground item cache missing stacked piles (place=${next_place.id})`);
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
                                        close_container_module(cid);
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
            } else {
                ui_state.place.current_place = null;
            }
        } catch (err) {
            debug_warn('[mono_ui] failed to load place', place_id, err);
            ui_state.place.current_place = null;
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

    async function poll_window_feeds(): Promise<void> {
        const tasks = window_feeds.map(async (feed) => {
            try {
                const messages = await feed.fetch_messages();
                set_text_window_messages(feed.window_id, messages);
            } catch (err) {
                debug_warn('[mono_ui] failed to refresh window feed', feed.window_id, err);
            }
        });

        tasks.push((async () => {
            try {
                const res = await fetch(APP_CONFIG.roller_status_endpoint);
                if (!res.ok) return;
                const data = (await res.json()) as { ok: boolean; status?: any };
                if (!data.ok || !data.status) return;
                ui_state.roller.spinner = String(data.status.spinner ?? "|");
                ui_state.roller.last_roll = String(data.status.last_player_roll ?? "");
                ui_state.roller.dice_label = String(data.status.dice_label ?? "D20");
                ui_state.roller.disabled = Boolean(data.status.disabled ?? true);
                ui_state.roller.roll_id = data.status.roll_id ?? null;
            } catch {
                // ignore
            }
        })());

        // Fetch target list (nearby NPCs / region)
        tasks.push((async () => {
            try {
                const url = `${APP_CONFIG.interpreter_targets_endpoint}?slot=${APP_CONFIG.selected_data_slot}&actor_id=${APP_CONFIG.input_actor_id}`;
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

                // Update current place view only when the place changes.
                // Movement is now streamed via websocket; frequent /api/place polling can reintroduce stale snapshots.
                const place_id = data.place_id ?? null;
                if (place_id !== ui_state.place.current_place_id) {
                    await update_current_place(place_id);
                } else if (!ui_state.place.current_place && place_id) {
                    await update_current_place(place_id);
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
                const targets_lines: string[] = [];
                const placeName = data.place ?? 'Wilderness';
                const worldX = data.world_coords?.x ?? 0;
                const worldY = data.world_coords?.y ?? 0;
                targets_lines.push(`[place] ${placeName}`);
                targets_lines.push(`[world] ${worldX}, ${worldY}`);
                targets_lines.push(`[region] ${ui_state.controls.region_label ?? 'unknown'}`);
                const verb = ui_state.controls.override_intent ?? ui_state.controls.suggested_intent;
                if (verb) {
                    targets_lines.push(`[intent] ${verb}`);
                } else {
                    targets_lines.push(`[intent] (none)`);
                }
                const cost = ui_state.controls.override_cost;
                targets_lines.push(`[cost] ${cost ?? '(auto)'}`);

                if (ui_state.controls.selected_target) {
                    targets_lines.push(`[target] ${ui_state.controls.selected_target}`);
                } else {
                    targets_lines.push(`[target] (none)`);
                }
                targets_lines.push('');
                targets_lines.push('Places in region (type /target name):');
                const places = data.places ?? [];
                if (places.length === 0) {
                    targets_lines.push('- (none nearby)');
                } else {
                    for (const p of places) {
                        const is_current = p.id === data.place_id ? ' [here]' : '';
                        targets_lines.push(`- ${p.label}${is_current}`);
                    }
                }
                targets_lines.push('');
                targets_lines.push('Targets (type @name or /target name):');
                const npc_targets = ui_state.controls.targets.filter(t => t.type === 'npc');
                if (npc_targets.length === 0) {
                    targets_lines.push('- (none visible)');
                } else {
                    for (const t of npc_targets) {
                        targets_lines.push(`- ${t.label} (${t.ref})`);
                    }
                }
                const dbg: string[] = [];
                dbg.push(`[debug] ${UI_DEBUG.enabled ? 'ON' : 'off'} | overlays:${DEBUG_VISION.enabled ? 'ON' : 'off'}`);
                dbg.push(`[volume] ${ui_state.controls.volume}`);
                dbg.push(`[move] ${ui_state.controls.move_mode}`);
                if (ui_state.character.hovered_item) {
                    dbg.push(`[hover] ${ui_state.character.hovered_item.name} (${ui_state.character.hovered_item.source})`);
                } else {
                    dbg.push(`[hover] (none)`);
                }
                if (last_sfx_label) {
                    const age_ms = Math.max(0, Date.now() - last_sfx_at_ms);
                    dbg.push(`[sfx] ${last_sfx_label} (${Math.round(age_ms)}ms ago)`);
                }
                if (pending_speech_sfx) {
                    const left_ms = Math.max(0, pending_speech_sfx.expires_at_ms - Date.now());
                    dbg.push(`[sfx_pending] speech_blip.${pending_speech_sfx.loudness} ${Math.round(left_ms)}ms id=${pending_speech_sfx.id}`);
                }
                if (ui_state.controls.last_sent_input_id) dbg.push(`[last_input] ${ui_state.controls.last_sent_input_id}`);
                // Keep target line near the top for quick trust checks.
                const target_line_index = targets_lines.findIndex(l => l.startsWith('[target] '));
                const target_line = target_line_index >= 0 ? targets_lines.splice(target_line_index, 1)[0] : null;
                if (target_line) dbg.push(target_line);
                dbg.push('');

                set_text_window_messages('debug', [...dbg, ...targets_lines]);
            } catch {
                // ignore
            }
        })());

        await Promise.all(tasks);
    }

    function start_window_feed_polling(interval_ms: number): void {
        void poll_window_feeds();
        setInterval(() => {
            void poll_window_feeds();
        }, interval_ms);
    }

    async function send_to_interpreter(message: string): Promise<void> {
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
                const actor_ref = `actor.${APP_CONFIG.input_actor_id}`;
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
            const intent_subtype = (
                verb_effective === 'COMMUNICATE' ||
                (!verb_effective && !!target_ref)
            ) ? ui_state.controls.volume : undefined;

            // arm pending speech SFX once we have an input id from backend

            const res = await fetch(APP_CONFIG.interpreter_endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: outgoing,
                    sender: APP_CONFIG.input_actor_id,
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
            debug_warn('[mono_ui] failed to send to interpreter', err);
            append_text_window_message('transcript', '[system] failed to reach interpreter');
        }
    }

    async function fetch_log_messages(slot: number): Promise<(string | TextWindowMessage)[]> {
    console.log(`[fetch_log_messages] Fetching from API...`);
    const res = await fetch(`${APP_CONFIG.interpreter_log_endpoint}?slot=${slot}`);
    if (!res.ok) {
        console.error(`[fetch_log_messages] HTTP error: ${res.status}`);
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
        if (sender === 'j' || sender === APP_CONFIG.input_actor_id.toLowerCase()) return true;
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

     // Debug logging for message filtering
      const npcMessages = filtered_final.filter(m => (m.sender ?? '').toLowerCase().startsWith('npc.'));
      console.log(`[fetch_log_messages] API returned ${data.messages.length} messages, after filtering: ${filtered_final.length} total, ${npcMessages.length} NPC`);
    
    // Log NPC message details for debugging
    npcMessages.forEach(m => {
        console.log(`[fetch_log_messages] NPC message: ${m.sender} - "${m.content?.substring(0, 40)}..."`);
    });
    
    // Debug: Show which senders were filtered out
     const filteredOut = sorted.filter(m => {
        const sender = (m.sender ?? '').toLowerCase();
        const content = (m.content ?? '').trim();
        if (!content) return true;
        if (sender.startsWith('npc.')) return false;
        if (sender === 'j') return false;
        if (sender === 'renderer_ai') return false;
        if (sender === 'hint') return false;
        if (m.type === 'user_input') return false;
        if (sender === 'state_applier') return !UI_DEBUG.enabled;
        return true;
    });
    if (filteredOut.length > 0) {
        console.log(`[fetch_log_messages] Filtered out ${filteredOut.length} messages from:`, [...new Set(filteredOut.map(m => m.sender))]);
    }

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
             return s === 'j' || s === APP_CONFIG.input_actor_id.toLowerCase();
         });
         const narr = msgs.filter(m => (m.sender ?? '').toLowerCase() === 'renderer_ai');
          const npcs = msgs.filter(m => (m.sender ?? '').toLowerCase().startsWith('npc.'));
          const inspections = msgs.filter(m => (m.sender ?? '').toLowerCase() === 'inspection' || m.stage === 'inspection_result');

          const push_msg = (sender: string, content: string, kind: string, id?: string) => {
              const mid = typeof id === 'string' ? id : undefined;
              if (kind === 'user') out.push({ content, sender: 'user', id: mid });
              else if (kind === 'assistant') out.push({ content, sender: 'assistant', id: mid });
              else if (kind === 'npc') {
                  const npcName = sender.toLowerCase().replace('npc.', '').toUpperCase();
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
        const res = await fetch(`${APP_CONFIG.interpreter_status_endpoint}?slot=${slot}`);
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

    // 1-line status window (plus border): 3 tiles tall.
    const Y_SYS0 = APP_CONFIG.grid_height - 4;
    const Y_SYS1 = APP_CONFIG.grid_height - 2;

    const BTN_X0 = R_X0;
    const BTN_X1 = R_X1 - 26;
    const ROLL_X0 = R_X1 - 24;
    const ROLL_X1 = R_X1;
    const BTN_Y0 = Y_INPUT0;
    const BTN_Y1 = Y_TRANSCRIPT1;
    
    // Debug buttons - positioned at TOP RIGHT of screen, horizontally
    // Y coordinates: 0 is bottom, 50 is top (grid_height - 1)
    // Place buttons at very top right, away from status bar
    const DEBUG_Y_TOP = 48;      // Near top (just below screen edge)
    const DEBUG_Y_BOTTOM = 49;   // Single row height
    const DEBUG_X0 = 98;         // Start from right side (after status text area)
    const DEBUG_X1 = 108;        // Button width

    // Second debug row for movement unification tests.
    const DEBUG_Y_TEST = DEBUG_Y_TOP - 2;

    // Do not seed the log window with placeholder text.

    let input_submit: (() => void) | null = null;

    // Create module registry for dynamic module management (Phase 7.5)
    const module_registry = create_module_registry();
    ui_state.modules.registry = module_registry;

    // Apply persisted visibility defaults before modules are used.
    // (ModuleRegistry defaults visibility to true on register.)
    {
        const v_char = ui_state.modules.visibility.get('character_module');
        if (typeof v_char === 'boolean') ui_state.character.is_visible = v_char;
    }

    function get_focus_world_z_for_current_place(): number {
        const place = get_current_place();
        if (!place) return ui_state.place.world_z_center;
        const base_z = Math.floor(Number((place as any)?.coordinates?.elevation ?? 0)) || 0;
        const center = ui_state.place.world_z_center;
        const planes = [center - 1, center, center + 1] as const;
        const slot = ui_state.place.focus_z;
        const wz = Math.floor(Number(planes[slot]));
        return Number.isFinite(wz) ? wz : base_z;
    }

    function is_tile_or_structure_container_at(place: Place, tile_x: number, tile_y: number, world_z: number): boolean {
        try {
            const base_z = Math.floor(Number((place as any)?.coordinates?.elevation ?? 0)) || 0;
            if (Math.floor(world_z) !== base_z) return false;

            const t: any = (place as any)?.tiles?.cells?.[tile_y]?.[tile_x] ?? null;
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
                if (oz !== base_z) continue;

                const phys = Array.isArray((s as any)?.body_model?.physical)
                    ? (s as any).body_model.physical
                    : [{ dx: 0, dy: 0, dz: 0 }];
                let occupies = false;
                for (const v of phys) {
                    const vx = Math.floor(ox) + Math.floor(Number((v as any)?.dx ?? 0));
                    const vy = Math.floor(oy) + Math.floor(Number((v as any)?.dy ?? 0));
                    const vz = oz + Math.floor(Number((v as any)?.dz ?? 0));
                    if (vx === tile_x && vy === tile_y && vz === base_z) { occupies = true; break; }
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
        grid_x?: number;
        grid_y?: number;
    }): Promise<boolean> {
        if (!drag_state.is_dragging) return false;
        const place = args.place;
        const dest_container_id = `place.tile.${place.id}.${args.tile_x}_${args.tile_y}`;
        const src = String(drag_state.source_container_id ?? '');

        // One endpoint for everything: route through /api/transfer.
        const tx = await api_transfer_inline({
            actor_id: APP_CONFIG.input_actor_id,
            item_instance_id: String(drag_state.item_instance_id ?? ''),
            from_container: src,
            to_container: dest_container_id,
            target_grid_x: typeof args.grid_x === 'number' ? args.grid_x : undefined,
            target_grid_y: typeof args.grid_y === 'number' ? args.grid_y : undefined,
        });

        if (tx.ok) {
            flash_status(['Moved'], 900);
            drag_state.end_drag();
            await update_current_place(place.id);
            void refresh_container_data();
            void refresh_character_data();
            return true;
        }

        flash_status([`Move failed: ${tx.error || 'unknown'}`], 1500);
        drag_state.reject_drag();
        return false;
    }

    const modules: Module[] = [
        make_fill_module({
            id: 'bg',
            rect: { x0: 0, y0: 0, x1: APP_CONFIG.grid_width - 1, y1: APP_CONFIG.grid_height - 1 },
            char: '.',
            rgb: DEEP_RED,
            style: 'regular',
        }),

        make_place_module({
            id: 'place',
            rect: { x0: L_X0, y0: Y_PLACE0, x1: L_X1, y1: Y_PLACE1 },
            get_place: get_current_place,
            grid_height: APP_CONFIG.grid_height,
            font_family: APP_CONFIG.font_family,
            base_font_size_px: APP_CONFIG.base_font_size_px,
            get_focus_z: () => ui_state.place.focus_z,
            set_focus_z: (z) => { ui_state.place.focus_z = z; save_place_focus_z(); },
            get_world_z_center: () => ui_state.place.world_z_center,
            get_mouse_parallax: () => ui_state.place.mouse_parallax,
            get_move_mode: () => ui_state.controls.move_mode,
            set_move_mode: (mode) => { ui_state.controls.move_mode = mode; },
            on_select_target: (target_ref: string): boolean => {
                // Check if this target exists in the available targets list
                const target = ui_state.controls.targets.find(t => 
                    t.ref.toLowerCase() === target_ref.toLowerCase()
                );
                
                if (target) {
                    ui_state.controls.selected_target = target.ref;
                    flash_status([`Target: ${target.label || target_ref}`], 1200);
                    
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

                let target_ref = String(target.ref ?? '').trim();
                if (target.type === 'tile') {
                    // Use terrain id; backend expects target_ref format: tile.<tile_id>
                    const terrain = String(place.environment?.terrain ?? '').trim();
                    const tile_id = terrain.startsWith('tile.') ? terrain.slice('tile.'.length) : terrain;
                    if (tile_id) target_ref = `tile.${tile_id}`;
                }

                if (!target_ref) {
                    flash_status(['Cannot inspect - no target'], 1200);
                    return;
                }

                const target_desc = target.type === 'tile'
                    ? (target_ref.split('.').pop() ?? 'tile')
                    : (target_ref.split('.').pop() ?? 'target');
                flash_status([`Inspecting ${target_desc}...`], 1200);

                try {
                    const res = await fetch(APP_CONFIG.interpreter_endpoint, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            text: 'inspect',
                            sender: APP_CONFIG.input_actor_id,
                            intent_verb: 'INSPECT',
                            target_ref,
                            ui_target_tile: target.tile_position ? { x: target.tile_position.x, y: target.tile_position.y } : undefined,
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
            on_open_tile_container: (tile_x: number, tile_y: number): void => {
                const place = get_current_place();
                if (!place) return;
                const cid = `place.tile.${place.id}.${tile_x}_${tile_y}`;
                void open_container_module(cid);
            },
            on_place_transition: async (target_place_id: string, direction: string): Promise<boolean> => {
                // Handle place transition when user clicks on a door
                const place = get_current_place();
                if (!place) {
                    flash_status(['No place loaded'], 1200);
                    return false;
                }
                
                // Check if timed event is active
                const slot = APP_CONFIG.selected_data_slot;
                const base_url = APP_CONFIG.place_endpoint.replace('/api/place', '');
                
                try {
                    // First check timed event status
                    const place_response = await fetch(
                        `${base_url}/api/place?slot=${slot}&place_id=${encodeURIComponent(place.id)}`
                    );
                    
                    if (!place_response.ok) {
                        flash_status(['Failed to check place status'], 1200);
                        return false;
                    }
                    
                    const place_data = await place_response.json();
                    if (place_data.timed_event_active) {
                        flash_status(['Cannot travel during a timed event'], 2000);
                        return false;
                    }
                    
                    // Attempt the travel
                    flash_status([`Traveling ${direction}...`], 1500);
                    
                    const travel_response = await fetch(
                        `${base_url}/api/place/travel?slot=${slot}`,
                        {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                entity_ref: `actor.${APP_CONFIG.input_actor_id}`,
                                target_place_id: target_place_id
                            })
                        }
                    );
                    
                    if (!travel_response.ok) {
                        const error_data = await travel_response.json();
                        if (error_data.error === 'travel_disabled_during_event') {
                            flash_status(['Cannot travel during a timed event'], 2000);
                        } else {
                            flash_status([`Travel failed: ${error_data.error || 'unknown error'}`], 2000);
                        }
                        return false;
                    }
                    
                    const travel_data = await travel_response.json();
                    if (travel_data.ok) {
                        flash_status([`Arrived at ${target_place_id.split('_').pop()}`], 2000);
                        // Update current place to trigger reload
                        await update_current_place(target_place_id);
                        return true;
                    } else {
                        flash_status([`Travel failed: ${travel_data.error || 'unknown error'}`], 2000);
                        return false;
                    }
                } catch (err) {
                    debug_warn('[app_state]', 'Place transition failed:', err);
                    flash_status(['Travel failed - check console'], 2000);
                    return false;
                }
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
                const player = place.contents.actors_present[0];
                return player ? { x: player.tile_position.x, y: player.tile_position.y } : null;
            },
            on_double_click_npc: (npc_ref: string) => {
                debug_log(`[PlaceModule] Double-click on NPC: ${npc_ref}`);
                // Look up NPC to get name
                const place = get_current_place();
                if (!place) return;
                const npc = place.contents.npcs_present.find((n: any) => n.npc_ref === npc_ref);
                if (!npc) return;
                const npc_name = npc_ref.replace('npc.', '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                // Open NPC character module
                void open_npc_character_module(npc_ref.replace('npc.', ''), npc_name);
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
                     void open_container_module(pile_id);
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
                         void open_container_module(cid);
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
                            actor_id: APP_CONFIG.input_actor_id,
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
                        await update_current_place(place.id);
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

                drag_state.start_drag('ground', item_id, `place.ground.${place.id}.${voxel_key}`, def);
                void (async () => {
                    const compatible = await get_compatible_slots_for_instance(item_id, `place.ground.${place.id}.${voxel_key}`, def);
                    ui_state.character.highlighted_slots = compatible;
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
                    const compatible = await get_compatible_slots_for_instance(item_id, source, def);
                    ui_state.character.highlighted_slots = compatible;
                })();
            },

            // Single source of truth for ground items in the PlaceModule.
            // Rendering + interaction should use the same cache (ui_state.place.ground_items_by_*).
            get_ground_item_position_keys: (): string[] => {
                return Array.from(ui_state.place.ground_items_by_voxel.keys());
            },

            get_ground_item_ids_at: (tile_x: number, tile_y: number): string[] => {
                return ui_state.place.ground_items_by_position.get(`${tile_x}_${tile_y}`) ?? [];
            },
            get_ground_item_meta: (item_instance_id: string): any | null => {
                return ui_state.place.ground_items_by_id.get(item_instance_id) ?? null;
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
                            return await perform_drag_drop_into_tile_container({ place: place0, tile_x, tile_y });
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
                    if (!place_id || !position_key) {
                        drag_state.reject_drag();
                        return false;
                    }
                    const dest_key = `${tile_x}_${tile_y}_${get_focus_world_z_for_current_place()}`;
                    if (position_key === dest_key) {
                        drag_state.end_drag();
                        return true;
                    }
                    try {
                        const to_key = `${tile_x}_${tile_y}_${get_focus_world_z_for_current_place()}`;
                        const mv = await api_transfer_inline({
                            actor_id: APP_CONFIG.input_actor_id,
                            item_instance_id: String(drag_state.item_instance_id ?? ''),
                            from_container: src_container_id,
                            to_container: `place.ground.${place_id}.${to_key}`,
                        });
                        if (mv.ok) {
                            flash_status(['Dragged'], 900);
                            drag_state.end_drag();
                            await update_current_place(place_id);
                            void refresh_container_data();
                            return true;
                        }
                        flash_status([`Cannot drag: ${mv.error}`], 2000);
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
                    // place.ground.<place_id>.<x_y> OR place.pile.<place_id>.<x_y>
                    const place_id = parts.length >= 4 ? parts[2] : null;
                    const position_key = parts.length >= 4 ? parts[3] : null;
                    if (!place_id || !position_key) {
                        drag_state.reject_drag();
                        return false;
                    }

                    const dest_key = `${tile_x}_${tile_y}_${get_focus_world_z_for_current_place()}`;
                    if (position_key === dest_key) {
                        drag_state.end_drag();
                        return true;
                    }

                    // Dragging a pile/item within the place: use /api/transfer.
                    try {
                        const to_key = `${tile_x}_${tile_y}_${get_focus_world_z_for_current_place()}`;
                        const mv = await api_transfer_inline({
                            actor_id: APP_CONFIG.input_actor_id,
                            item_instance_id: String(drag_state.item_instance_id ?? ''),
                            from_container: src,
                            to_container: `place.ground.${place_id}.${to_key}`,
                        });
                        if (mv.ok) {
                            flash_status(['Dragged'], 900);
                            drag_state.end_drag();
                            await update_current_place(place_id);
                            void refresh_container_data();
                            return true;
                        }
                        flash_status([`Cannot drag: ${mv.error}`], 2000);
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
                                actor_id: APP_CONFIG.input_actor_id,
                                item_instance_id: String(drag_state.item_instance_id ?? ''),
                                from_container: src,
                                to_container: dest,
                            });

                            if (tx.ok) {
                                flash_status([`Moved into ${meta?.name ?? 'container'}`], 1500);
                                drag_state.end_drag();
                                await update_current_place(place.id);
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
                        const to_z = get_focus_world_z_for_current_place();
                        const to_container = `place.ground.${place.id}.${tile_x}_${tile_y}_${to_z}`;
                        const sp = await api_transfer_inline({
                            actor_id: APP_CONFIG.input_actor_id,
                            item_instance_id: String(drag_state.item_instance_id ?? ''),
                            from_container: spill_src,
                            to_container,
                        });
                        if (sp.ok) {
                            flash_status(['Dropped'], 1200);
                            drag_state.end_drag();
                            await update_current_place(place.id);
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
                            actor_id: APP_CONFIG.input_actor_id,
                            item_instance_id: String(drag_state.item_instance_id ?? ''),
                            from_container: spill_src,
                            to_container,
                        });

                        if (sp.ok) {
                            flash_status(['Dropped'], 1200);
                            drag_state.end_drag();
                            await update_current_place(place.id);
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
                const actor = place.contents.actors_present[0];
                if (!actor) {
                    debug_log(`[PlaceModule] on_drop: No actor present - rejecting`);
                    return false;
                }

                // Distance validation is now handled by backend (cardinal adjacency check)
                // Frontend accepts drops anywhere and lets backend validate

                try {
                    const actor_id = APP_CONFIG.input_actor_id;
                    const to_z = get_focus_world_z_for_current_place();
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
                        await update_current_place(place.id);
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
                        drag_state.reject_drag();
                        flash_status([`Cannot drop: ${drop_res.error}`], 2000);
                        return false;
                    }
                } catch (err) {
                    debug_log(`[PlaceModule] on_drop: Exception: ${err}`);
                    drag_state.reject_drag();
                    flash_status([`Drop failed: ${err}`], 2000);
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
                const actor = place.contents.actors_present[0];
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

                const actor_id = APP_CONFIG.input_actor_id;
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
                        await update_current_place(place.id);
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
            base_weight_index: 3,
        }),

        make_text_window_module({
            id: 'transcript',
            rect: get_persisted_rect('transcript', { x0: L_X0, y0: Y_TRANSCRIPT0, x1: L_X1, y1: Y_TRANSCRIPT1 }),
            get_source: () => ui_state.text_windows.get('transcript') ?? { messages: [], rev: 0 },
            border_rgb: get_color_by_name('light_gray').rgb,
            text_rgb: get_color_by_name('off_white').rgb,
            bg: { char: ' ', rgb: get_color_by_name('off_black').rgb },
            base_weight_index: 3,
            hint_rgb: get_color_by_name('pale_yellow').rgb,
            npc_rgb: get_color_by_name('pumpkin').rgb,
            state_rgb: get_color_by_name('dark_gray').rgb,
        }),

        make_input_module({
            id: 'input',
            rect: { x0: L_X0, y0: Y_INPUT0, x1: L_X1, y1: Y_INPUT1 },
            target_id: 'transcript',
            on_submit: (target_id, message) => {
                void send_to_interpreter(message);
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
            bind_submit: (submit) => { input_submit = submit; },
            border_rgb: get_color_by_name('light_gray').rgb,
            text_rgb: get_color_by_name('off_white').rgb,
            cursor_rgb: get_color_by_name('off_white').rgb,
            bg: { char: ' ', rgb: get_color_by_name('off_black').rgb },
            base_weight_index: 3,
            placeholder: 'Type… (Enter=send, Shift+Enter=new line, Backspace=delete)',
        }),

        make_button_module({
            id: 'btn_send',
            rect: { x0: BTN_X0, y0: BTN_Y0, x1: BTN_X0 + 12, y1: BTN_Y0 + 2 },
            label: 'send',
            rgb: get_color_by_name('pale_orange').rgb,
            bg: { char: '-', rgb: get_color_by_name('dark_gray').rgb },
            base_weight_index: 3,
            OnPress() {
                input_submit?.();
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
            base_weight_index: 3,
            hint_rgb: get_color_by_name('pale_yellow').rgb,
            npc_rgb: get_color_by_name('pumpkin').rgb,
            state_rgb: get_color_by_name('dark_gray').rgb,
            title: 'DEBUG',
            gizmos: {
                enabled: ['close', 'move', 'resize'],
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

        // Action cost buttons
        make_button_module({
            id: 'cost_free',
            rect: { x0: BTN_X0, y0: BTN_Y0 + 12, x1: BTN_X0 + 6, y1: BTN_Y0 + 14 },
            label: 'FREE',
            rgb: get_color_by_name('pale_orange').rgb,
            bg: { char: '.', rgb: get_color_by_name('dark_gray').rgb },
            base_weight_index: 3,
            OnPress() { ui_state.controls.override_cost = 'FREE'; flash_status(['action cost: FREE'], 800); },
        }),
        make_button_module({
            id: 'cost_part',
            rect: { x0: BTN_X0 + 7, y0: BTN_Y0 + 12, x1: BTN_X0 + 13, y1: BTN_Y0 + 14 },
            label: 'PART',
            rgb: get_color_by_name('pale_orange').rgb,
            bg: { char: '.', rgb: get_color_by_name('dark_gray').rgb },
            base_weight_index: 3,
            OnPress() { ui_state.controls.override_cost = 'PARTIAL'; flash_status(['action cost: PARTIAL'], 800); },
        }),
        make_button_module({
            id: 'cost_full',
            rect: { x0: BTN_X0 + 14, y0: BTN_Y0 + 12, x1: BTN_X0 + 20, y1: BTN_Y0 + 14 },
            label: 'FULL',
            rgb: get_color_by_name('pale_orange').rgb,
            bg: { char: '.', rgb: get_color_by_name('dark_gray').rgb },
            base_weight_index: 3,
            OnPress() { ui_state.controls.override_cost = 'FULL'; flash_status(['action cost: FULL'], 800); },
        }),
        make_button_module({
            id: 'cost_ext',
            rect: { x0: BTN_X0 + 21, y0: BTN_Y0 + 12, x1: BTN_X0 + 27, y1: BTN_Y0 + 14 },
            label: 'EXT',
            rgb: get_color_by_name('pale_orange').rgb,
            bg: { char: '.', rgb: get_color_by_name('dark_gray').rgb },
            base_weight_index: 3,
            OnPress() { ui_state.controls.override_cost = 'EXTENDED'; flash_status(['action cost: EXTENDED'], 800); },
        }),

        // Action intent buttons - Updated for Action Pipeline
        // Only showing actions currently implemented in the Action Pipeline:
        // - USE (handles all tool-based actions including attacks)
        // - COMMUNICATE (talking to NPCs)
        // - MOVE (movement)
        // - INSPECT (looking at things)
        make_button_module({ id: 'verb_use', rect: { x0: BTN_X0, y0: BTN_Y0 + 9, x1: BTN_X0 + 7, y1: BTN_Y0 + 11 }, label: 'USE', rgb: WHITE, get_rgb: () => (ui_state.controls.override_intent === 'USE' ? get_color_by_name('pale_yellow').rgb : (ui_state.controls.suggested_intent === 'USE' ? get_color_by_name('pale_gray').rgb : get_color_by_name('dark_gray').rgb)), bg: { char: '-', rgb: get_color_by_name('off_black').rgb }, base_weight_index: 3, OnPress() { ui_state.controls.override_intent = 'USE'; flash_status(['intent: USE'], 800); } }),
        make_button_module({ id: 'verb_com', rect: { x0: BTN_X0 + 8, y0: BTN_Y0 + 9, x1: BTN_X0 + 15, y1: BTN_Y0 + 11 }, label: 'TALK', rgb: WHITE, get_rgb: () => (ui_state.controls.override_intent === 'COMMUNICATE' ? get_color_by_name('pale_yellow').rgb : (ui_state.controls.suggested_intent === 'COMMUNICATE' ? get_color_by_name('pale_gray').rgb : get_color_by_name('dark_gray').rgb)), bg: { char: '-', rgb: get_color_by_name('off_black').rgb }, base_weight_index: 3, OnPress() { ui_state.controls.override_intent = 'COMMUNICATE'; flash_status(['intent: COMMUNICATE'], 800); } }),
        make_button_module({ id: 'verb_mov', rect: { x0: BTN_X0 + 16, y0: BTN_Y0 + 9, x1: BTN_X0 + 23, y1: BTN_Y0 + 11 }, label: 'MOVE', rgb: WHITE, get_rgb: () => (ui_state.controls.override_intent === 'MOVE' ? get_color_by_name('pale_yellow').rgb : (ui_state.controls.suggested_intent === 'MOVE' ? get_color_by_name('pale_gray').rgb : get_color_by_name('dark_gray').rgb)), bg: { char: '-', rgb: get_color_by_name('off_black').rgb }, base_weight_index: 3, OnPress() { ui_state.controls.override_intent = 'MOVE'; flash_status(['intent: MOVE'], 800); } }),
        make_button_module({ id: 'verb_ins', rect: { x0: BTN_X0 + 24, y0: BTN_Y0 + 9, x1: BTN_X1, y1: BTN_Y0 + 11 }, label: 'LOOK', rgb: WHITE, get_rgb: () => (ui_state.controls.override_intent === 'INSPECT' ? get_color_by_name('pale_yellow').rgb : (ui_state.controls.suggested_intent === 'INSPECT' ? get_color_by_name('pale_gray').rgb : get_color_by_name('dark_gray').rgb)), bg: { char: '-', rgb: get_color_by_name('off_black').rgb }, base_weight_index: 3, OnPress() { ui_state.controls.override_intent = 'INSPECT'; flash_status(['intent: INSPECT'], 800); } }),
        make_button_module({ id: 'verb_clear', rect: { x0: BTN_X0 + 28, y0: BTN_Y0 + 12, x1: BTN_X1, y1: BTN_Y0 + 14 }, label: 'CLR', rgb: get_color_by_name('pale_yellow').rgb, bg: { char: '.', rgb: get_color_by_name('dark_gray').rgb }, base_weight_index: 3, OnPress() { ui_state.controls.override_intent = null; ui_state.controls.override_cost = null; flash_status(['overrides cleared'], 800); } }),

        // COMMUNICATE volume buttons (non-debug)
        make_button_module({
            id: 'vol_whisper',
            rect: { x0: BTN_X0, y0: BTN_Y0 + 6, x1: BTN_X0 + 10, y1: BTN_Y0 + 8 },
            label: 'WSP',
            rgb: WHITE,
            get_rgb: () => (ui_state.controls.volume === 'WHISPER' ? get_color_by_name('pale_yellow').rgb : get_color_by_name('dark_gray').rgb),
            bg: { char: '-', rgb: get_color_by_name('off_black').rgb },
            base_weight_index: 3,
            OnPress() { ui_state.controls.volume = 'WHISPER'; flash_status(['volume: WHISPER'], 800); },
        }),
        make_button_module({
            id: 'vol_normal',
            rect: { x0: BTN_X0 + 11, y0: BTN_Y0 + 6, x1: BTN_X0 + 21, y1: BTN_Y0 + 8 },
            label: 'NRM',
            rgb: WHITE,
            get_rgb: () => (ui_state.controls.volume === 'NORMAL' ? get_color_by_name('pale_yellow').rgb : get_color_by_name('dark_gray').rgb),
            bg: { char: '-', rgb: get_color_by_name('off_black').rgb },
            base_weight_index: 3,
            OnPress() { ui_state.controls.volume = 'NORMAL'; flash_status(['volume: NORMAL'], 800); },
        }),
        make_button_module({
            id: 'vol_shout',
            rect: { x0: BTN_X0 + 22, y0: BTN_Y0 + 6, x1: BTN_X1, y1: BTN_Y0 + 8 },
            label: 'SHT',
            rgb: WHITE,
            get_rgb: () => (ui_state.controls.volume === 'SHOUT' ? get_color_by_name('pale_yellow').rgb : get_color_by_name('dark_gray').rgb),
            bg: { char: '-', rgb: get_color_by_name('off_black').rgb },
            base_weight_index: 3,
            OnPress() { ui_state.controls.volume = 'SHOUT'; flash_status(['volume: SHOUT'], 800); },
        }),

        // Movement mode buttons (non-debug)
        make_button_module({
            id: 'mv_walk',
            rect: { x0: BTN_X0, y0: BTN_Y0 + 3, x1: BTN_X0 + 10, y1: BTN_Y0 + 5 },
            label: 'WLK',
            rgb: WHITE,
            get_rgb: () => (ui_state.controls.move_mode === 'WALK' ? get_color_by_name('pale_yellow').rgb : get_color_by_name('dark_gray').rgb),
            bg: { char: '-', rgb: get_color_by_name('off_black').rgb },
            base_weight_index: 3,
            OnPress() { ui_state.controls.move_mode = 'WALK'; flash_status(['move: WALK'], 800); },
        }),
        make_button_module({
            id: 'mv_sneak',
            rect: { x0: BTN_X0 + 11, y0: BTN_Y0 + 3, x1: BTN_X0 + 21, y1: BTN_Y0 + 5 },
            label: 'SNK',
            rgb: WHITE,
            get_rgb: () => (ui_state.controls.move_mode === 'SNEAK' ? get_color_by_name('pale_yellow').rgb : get_color_by_name('dark_gray').rgb),
            bg: { char: '-', rgb: get_color_by_name('off_black').rgb },
            base_weight_index: 3,
            OnPress() { ui_state.controls.move_mode = 'SNEAK'; flash_status(['move: SNEAK'], 800); },
        }),
        make_button_module({
            id: 'mv_sprint',
            rect: { x0: BTN_X0 + 22, y0: BTN_Y0 + 3, x1: BTN_X1, y1: BTN_Y0 + 5 },
            label: 'SPR',
            rgb: WHITE,
            get_rgb: () => (ui_state.controls.move_mode === 'SPRINT' ? get_color_by_name('pale_yellow').rgb : get_color_by_name('dark_gray').rgb),
            bg: { char: '-', rgb: get_color_by_name('off_black').rgb },
            base_weight_index: 3,
            OnPress() { ui_state.controls.move_mode = 'SPRINT'; flash_status(['move: SPRINT'], 800); },
        }),

        // Debug button: Add FIRE! tag to actor
        make_button_module({
            id: 'debug_add_fire',
            rect: { x0: DEBUG_X0, y0: DEBUG_Y_TOP, x1: DEBUG_X1, y1: DEBUG_Y_TOP + 1 },
            label: 'FIRE',
            rgb: get_color_by_name('vivid_red').rgb,
            bg: { char: '*', rgb: get_color_by_name('dark_gray').rgb },
            base_weight_index: 3,
            async OnPress() {
                console.log('[DEBUG BUTTON] FIRE button pressed');
                try {
                    console.log('[DEBUG BUTTON] Calling /api/tag/add...');
                    const response = await fetch('http://localhost:8787/api/tag/add', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            entity_ref: 'actor.henry_actor',
                            tag_name: 'FIRE!',
                            mag: 5,
                            meta: ['DISPERSING']
                        })
                    });
                    console.log('[DEBUG BUTTON] Response status:', response.status);
                    if (response.ok) {
                        console.log('[DEBUG BUTTON] FIRE! tag added successfully');
                        flash_status(['FIRE! tag added to actor'], 1500);
                    } else {
                        console.log('[DEBUG BUTTON] Failed to add FIRE! tag');
                        flash_status(['Failed to add FIRE! tag'], 1500);
                    }
                } catch (err) {
                    console.error('[DEBUG BUTTON] Error:', err);
                    flash_status(['Error: Could not connect to API'], 1500);
                }
            },
        }),

        // Debug button: Show Inventory (using new inline item API)
        make_button_module({
            id: 'debug_show_inventory',
            rect: { x0: DEBUG_X0 + 12, y0: DEBUG_Y_TOP, x1: DEBUG_X1 + 12, y1: DEBUG_Y_TOP + 1 },
            label: 'INV',
            rgb: get_color_by_name('pale_green').rgb,
            bg: { char: '*', rgb: get_color_by_name('dark_gray').rgb },
            base_weight_index: 3,
            async OnPress() {
                console.log('[DEBUG BUTTON] INV button pressed');
                try {
                    const actor_id = APP_CONFIG.input_actor_id;
                    console.log('[DEBUG BUTTON] Fetching inline items for actor:', actor_id);
                    
                    // Get inline items from new API
                    const items_res = await fetch(`http://localhost:8787/api/actor/items?actor_id=${actor_id}`);
                    console.log('[DEBUG BUTTON] Items response status:', items_res.status);
                    const items_data = await items_res.json();
                    console.log('[DEBUG BUTTON] Items data:', items_data);
                    
                    if (!items_data.ok) {
                        console.log('[DEBUG BUTTON] Failed to load items:', items_data.error);
                        flash_status(['Failed to load inventory'], 1500);
                        return;
                    }
                    
                    if (items_data.items && items_data.items.length > 0) {
                        const items = items_data.items.map((entry: any) => {
                            const item = entry.item;
                            return `${item.qty}x ${item.name} (${item.weight}kg) @ ${entry.slot_name}.${entry.slot_type}`;
                        }
                        );
                        console.log('[DEBUG BUTTON] Inventory items:', items);
                        flash_status(['Inventory:', ...items.slice(0, 6)], 3000);
                    } else {
                        console.log('[DEBUG BUTTON] Inventory empty');
                        flash_status(['Inventory: (empty)'], 1500);
                    }
                } catch (err) {
                    console.error('[DEBUG BUTTON] Error:', err);
                    flash_status(['Error: Could not load inventory'], 1500);
                }
            },
        }),

        // Quick UI toggles (temporary; will move to a real bottom bar later)
        make_button_module({
            id: 'ui_toggle_character',
            rect: { x0: DEBUG_X0 + 24, y0: DEBUG_Y_TOP, x1: DEBUG_X1 + 24, y1: DEBUG_Y_TOP + 1 },
            label: 'CHAR',
            rgb: get_color_by_name('pale_yellow').rgb,
            bg: { char: '*', rgb: get_color_by_name('dark_gray').rgb },
            base_weight_index: 3,
            OnPress() {
                const cur = module_registry.is_visible('character_module');
                const next = !cur;
                set_module_visible('character_module', next);
                flash_status([next ? 'Character shown' : 'Character hidden'], 900);
            },
        }),
        make_button_module({
            id: 'ui_toggle_debug',
            rect: { x0: DEBUG_X0 + 36, y0: DEBUG_Y_TOP, x1: DEBUG_X1 + 36, y1: DEBUG_Y_TOP + 1 },
            label: 'DEBUG',
            rgb: get_color_by_name('pale_yellow').rgb,
            bg: { char: '*', rgb: get_color_by_name('dark_gray').rgb },
            base_weight_index: 3,
            OnPress() {
                const cur = module_registry.is_visible('debug');
                const next = !cur;
                set_module_visible('debug', next);
                flash_status([next ? 'Debug shown' : 'Debug hidden'], 900);
            },
        }),

        // Debug overlays toggle (vision/hearing/broadcast + facing). Replaces hotkeys.
        make_button_module({
            id: 'debug_toggle_overlays',
            rect: { x0: APP_CONFIG.grid_width - 7, y0: DEBUG_Y_TOP, x1: APP_CONFIG.grid_width - 1, y1: DEBUG_Y_TOP + 1 },
            label: 'OVR',
            rgb: get_color_by_name('pale_yellow').rgb,
            bg: { char: '*', rgb: get_color_by_name('dark_gray').rgb },
            base_weight_index: 3,
            OnPress() {
                const next = !DEBUG_VISION.enabled;
                set_ui_debug_enabled(next);
                set_debug_bundle_enabled(next);
                flash_status([next ? 'Debug overlays ON' : 'Debug overlays off'], 900);
            },
        }),

        // Debug button: Center place view on actor (recovery if view offset gets bad)
        make_button_module({
            id: 'debug_center_place',
            rect: { x0: DEBUG_X0 + 84, y0: DEBUG_Y_TOP, x1: DEBUG_X1 + 84, y1: DEBUG_Y_TOP + 1 },
            label: 'CEN',
            rgb: get_color_by_name('vivid_cyan').rgb,
            bg: { char: '*', rgb: get_color_by_name('dark_gray').rgb },
            base_weight_index: 3,
            OnPress() {
                try {
                    const place_mod: any = module_registry.get('place');
                    if (place_mod && typeof place_mod.debug_center_on_actor === 'function') {
                        place_mod.debug_center_on_actor();
                        flash_status(['Centered on actor'], 900);
                        return;
                    }
                } catch {
                    // ignore
                }
                flash_status(['Center failed'], 900);
            },
        }),

        // Drag-and-drop equipping is now implemented:
        // - Drag item from inventory container to character body slot
        // - This replaces the EQUIP/UNEQUIP debug buttons

        // Phase 2: Double-click replaces these debug buttons:
        // - CNTRS (list containers) -> Press 'I' to open inventory
        // - GRND (ground items) -> Double-click ground to open scattered container
        // - NPCINV (NPC inventory) -> Double-click NPC to open character module

        // Debug button: Open nearest NPC (for quick access during development)
        make_button_module({
            id: 'debug_open_nearest_npc',
            rect: { x0: DEBUG_X0 + 48, y0: DEBUG_Y_TOP, x1: DEBUG_X1 + 48, y1: DEBUG_Y_TOP + 1 },
            label: 'NPCINV',
            rgb: get_color_by_name('vivid_cyan').rgb,
            bg: { char: '*', rgb: get_color_by_name('dark_gray').rgb },
            base_weight_index: 3,
            async OnPress() {
                console.log('[DEBUG BUTTON] NPCINV button pressed - Opening nearest NPC inventory');
                debug_log('[DEBUG BUTTON] NPCINV button pressed');
                
                const place = get_current_place();
                if (!place) {
                    debug_log('[DEBUG BUTTON] No place loaded');
                    flash_status(['No place loaded'], 1500);
                    return;
                }
                
                debug_log(`[DEBUG BUTTON] Current place: ${place.id}`);
                debug_log(`[DEBUG BUTTON] Actors present: ${place.contents.actors_present?.length || 0}`);
                debug_log(`[DEBUG BUTTON] NPCs present: ${place.contents.npcs_present?.length || 0}`);
                
                // Get actor position
                const actor_ref = `actor.${APP_CONFIG.input_actor_id}`;
                const actor = place.contents.actors_present.find((a: any) => a.actor_ref === actor_ref);
                if (!actor) {
                    debug_log(`[DEBUG BUTTON] Actor ${actor_ref} not found in place`);
                    flash_status(['Actor not found in place'], 1500);
                    return;
                }
                
                const actor_pos = actor.tile_position;
                debug_log(`[DEBUG BUTTON] Actor ${actor_ref} at position (${actor_pos.x},${actor_pos.y})`);
                
                // Get all NPCs in place
                const npcs = place.contents.npcs_present;
                if (!npcs || npcs.length === 0) {
                    debug_log('[DEBUG BUTTON] No NPCs in place');
                    flash_status(['No NPCs in this place'], 1500);
                    return;
                }
                
                // Find nearest NPC
                let nearest_npc = null;
                let min_distance = Infinity;
                
                for (const npc of npcs) {
                    const dx = npc.tile_position.x - actor_pos.x;
                    const dy = npc.tile_position.y - actor_pos.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    debug_log(`[DEBUG BUTTON] NPC ${npc.npc_ref} at (${npc.tile_position.x},${npc.tile_position.y}), distance: ${distance.toFixed(1)}`);
                    
                    if (distance < min_distance) {
                        min_distance = distance;
                        nearest_npc = npc;
                    }
                }
                
                if (!nearest_npc) {
                    debug_log('[DEBUG BUTTON] Could not determine nearest NPC');
                    flash_status(['Could not find nearest NPC'], 1500);
                    return;
                }
                
                // Extract NPC name from npc_ref (e.g., "npc.grenda" -> "Grenda")
                const npc_id = nearest_npc.npc_ref.replace('npc.', '');
                const npc_name = npc_id.split('_').map((word: string) => 
                    word.charAt(0).toUpperCase() + word.slice(1)
                ).join(' ');
                
                debug_log(`[DEBUG BUTTON] Selected nearest NPC: ${npc_name} (${nearest_npc.npc_ref}) at distance ${min_distance.toFixed(1)}`);
                flash_status([`Opening ${npc_name}'s inventory (${min_distance.toFixed(0)} tiles)`], 1500);
                
                // Open NPC inventory
                try {
                    await open_npc_character_module(npc_id, npc_name);
                } catch (err) {
                    debug_log(`[DEBUG BUTTON] Error opening NPC module:`, err);
                    flash_status([`Error opening ${npc_name}'s inventory`], 1500);
                }
            },
        }),

        // Debug button: Dump body_slots state
        make_button_module({
            id: 'debug_dump_body_slots',
            rect: { x0: DEBUG_X0 + 60, y0: DEBUG_Y_TOP, x1: DEBUG_X1 + 60, y1: DEBUG_Y_TOP + 1 },
            label: 'SLOTS',
            rgb: get_color_by_name('vivid_yellow').rgb,
            bg: { char: '*', rgb: get_color_by_name('dark_gray').rgb },
            base_weight_index: 3,
            async OnPress() {
                console.log('[DEBUG BUTTON] SLOTS button pressed');
                debug_log('[DEBUG BUTTON] === DUMPING BODY SLOTS STATE ===');
                
                try {
                    const actor_id = APP_CONFIG.input_actor_id;
                    debug_log(`[DEBUG BUTTON] Actor ID: ${actor_id}`);
                    
                    // Fetch actor data directly
                    const actor_res = await fetch(`http://localhost:8787/api/actor?id=${actor_id}`);
                    if (!actor_res.ok) {
                        debug_log('[DEBUG BUTTON] ERROR: Failed to fetch actor');
                        flash_status(['Failed to fetch actor'], 1500);
                        return;
                    }
                    
                    const actor_data = await actor_res.json();
                    if (!actor_data.ok) {
                        debug_log('[DEBUG BUTTON] ERROR: Actor data not ok');
                        flash_status(['Actor data error'], 1500);
                        return;
                    }
                    
                    const body_slots = actor_data.body_slots || {};
                    debug_log('[DEBUG BUTTON] Raw body_slots from API:');
                    
                    // Log each slot
                    for (const [slot_name, slot_data] of Object.entries(body_slots)) {
                        const slot = slot_data as any;
                        debug_log(`[DEBUG BUTTON] ${slot_name}:`);
                        debug_log(`[DEBUG BUTTON]   tool: ${slot.tool || 'null'}`);
                        debug_log(`[DEBUG BUTTON]   armor: ${slot.armor || 'null'}`);
                        debug_log(`[DEBUG BUTTON]   garb: [${slot.garb?.join(', ') || 'empty'}]`);
                    }
                    
                    // Also log what's in ui_state
                    debug_log('[DEBUG BUTTON] ui_state.character.equipped_items:');
                    ui_state.character.equipped_items.forEach((item, slot) => {
                        debug_log(`[DEBUG BUTTON]   ${slot}: ${item.definition.name} (${item.instance.id})`);
                    });
                    
                    flash_status(['Body slots dumped to console'], 2000);
                } catch (err) {
                    console.error('[DEBUG BUTTON] Error:', err);
                    flash_status(['Error dumping body slots'], 1500);
                }
            },
        }),

        // Debug button: Drop random item
        make_button_module({
            id: 'debug_drop_item',
            rect: { x0: DEBUG_X0 + 72, y0: DEBUG_Y_TOP, x1: DEBUG_X1 + 72, y1: DEBUG_Y_TOP + 1 },
            label: 'DROP',
            rgb: get_color_by_name('vivid_green').rgb,
            bg: { char: '*', rgb: get_color_by_name('dark_gray').rgb },
            base_weight_index: 3,
            async OnPress() {
                console.log('[DEBUG BUTTON] DROP button pressed');
                
                // 80% chance: Simple items | 20% chance: Container with items
                const is_container_spawn = Math.random() < 0.2;
                
                let spawn_data: any;
                let item_name: string = '';
                
                if (is_container_spawn) {
                    // Spawn a sack with coins inside
                    spawn_data = {
                        item_def_id: 'small_sack',
                        qty: 1,
                        contents: [
                            { def_id: 'coin', qty: Math.floor(Math.random() * 50) + 10 }  // 10-60 coins
                        ]
                    };
                    item_name = 'Small Sack (with coins)';
                } else {
                    // Spawn a random simple item
                    const simple_items = [
                        'coin',
                        'test_iron_sword',
                        'test_torch',
                        'test_iron_dagger',
                        'test_iron_helmet',
                        'test_iron_greaves',
                        'test_iron_gauntlet_left',
                        'test_cloth_tunic',
                        'test_cloth_pants',
                        'test_silver_ring',
                        'test_gold_ring',
                        'test_leather_bracelet',
                    ];
                    const random_item = simple_items[Math.floor(Math.random() * simple_items.length)]!;
                    const qty = random_item === 'coin' ? Math.floor(Math.random() * 20) + 5 : 1;
                    spawn_data = {
                        item_def_id: random_item,
                        qty: qty
                    };
                    item_name = random_item;
                }
                
                console.log(`[DEBUG BUTTON] Selected: ${item_name}`);
                
                // Get current place and actor position
                const current_place = ui_state.place.current_place;
                if (!current_place) {
                    console.log('[DEBUG BUTTON] No place loaded');
                    flash_status(['No place loaded'], 2000);
                    return;
                }
                
                // Find actor in place to get position
                const actor_ref = `actor.${APP_CONFIG.input_actor_id}`;
                const actor_in_place = current_place.contents?.actors_present?.find(
                    (a: any) => a.actor_ref === actor_ref
                );
                
                if (!actor_in_place || !actor_in_place.tile_position) {
                    console.log('[DEBUG BUTTON] Actor position not found');
                    flash_status(['Actor position unknown'], 2000);
                    return;
                }
                
                const actor_pos = actor_in_place.tile_position;
                console.log(`[DEBUG BUTTON] Spawning at (${actor_pos.x}, ${actor_pos.y}) in ${current_place.id}`);
                
                try {
                    // Use new ground spawn API
                    const response = await fetch('http://localhost:8787/api/place/spawn', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            ...spawn_data,
                            place_id: current_place.id,
                            x: actor_pos.x,
                            y: actor_pos.y
                        })
                    });
                    
                    console.log('[DEBUG BUTTON] Response status:', response.status);
                    const data = await response.json();
                    
                    if (data.ok) {
                        console.log(`[DEBUG BUTTON] Spawned ${data.name} on ground at (${data.position.x}, ${data.position.y})`);
                        flash_status([`Dropped ${data.name}`], 2000);
                        
                        // Refresh place using canonical updater (registers movement engine too)
                        await update_current_place(current_place.id);
                        console.log('[DEBUG BUTTON] Place data refreshed via update_current_place');
                    } else {
                        console.log('[DEBUG BUTTON] Failed to spawn item:', data.error);
                        flash_status([`Failed: ${data.error}`], 2000);
                    }
                } catch (err) {
                    console.error('[DEBUG BUTTON] Error:', err);
                    flash_status(['Error: Could not connect'], 2000);
                }
            },
        }),

        // ================================
        // MOVE_UNIFY_TEST helpers (Phase 5)
        // ================================
        // Note: legacy debug movement buttons that used /api/actor/move were removed.
        // Movement is now server-authoritative via /api/movement/* only.

        // Toggle GRAVITY tag on the actor (needed for falling tests).
        make_button_module({
            id: 'debug_gravity',
            rect: { x0: DEBUG_X0 + 24, y0: DEBUG_Y_TEST, x1: DEBUG_X1 + 24, y1: DEBUG_Y_TEST + 1 },
            label: 'GRAV',
            rgb: get_color_by_name('vivid_cyan').rgb,
            bg: { char: '*', rgb: get_color_by_name('dark_gray').rgb },
            base_weight_index: 3,
            async OnPress() {
                const actor_id = APP_CONFIG.input_actor_id;
                const slot = APP_CONFIG.selected_data_slot;
                const actor_ref = `actor.${actor_id}`;

                const actor_res = await fetch(`http://localhost:8787/api/actor?id=${encodeURIComponent(actor_id)}&slot=${slot}`);
                if (!actor_res.ok) return;
                const actor_data = await actor_res.json();
                const tags = Array.isArray(actor_data?.actor?.tags) ? actor_data.actor.tags : [];
                const has_grav = tags.some((t: any) => String(t?.name ?? '').toUpperCase() === 'GRAVITY');

                if (has_grav) {
                    await fetch(`http://localhost:8787/api/tag/remove?slot=${slot}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ slot, entity_ref: actor_ref, tag_name: 'GRAVITY' }),
                    });
                    flash_status(['GRAVITY removed'], 1200);
                } else {
                    await fetch(`http://localhost:8787/api/tag/add?slot=${slot}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ slot, entity_ref: actor_ref, tag_name: 'GRAVITY', mag: 1, meta: [] }),
                    });
                    flash_status(['GRAVITY added'], 1200);
                }

                const place = get_current_place();
                if (place) await update_current_place(place.id);
            },
        }),

        // Note: levitate/teleport debug movement was removed with /api/actor/move.

        // Toggle test body model for self-exclusion test.
        make_button_module({
            id: 'debug_body',
            rect: { x0: DEBUG_X0 + 48, y0: DEBUG_Y_TEST, x1: DEBUG_X1 + 48, y1: DEBUG_Y_TEST + 1 },
            label: 'BOD',
            rgb: get_color_by_name('vivid_yellow').rgb,
            bg: { char: '*', rgb: get_color_by_name('dark_gray').rgb },
            base_weight_index: 3,
            async OnPress() {
                const place = get_current_place();
                if (!place) return;
                const actor_id = APP_CONFIG.input_actor_id;
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
                await update_current_place(place.id);
            },
        }),

        // Note: support-from-occupant test is now handled by LIFT onto existing structures.

        make_roller_module({
            id: 'roller',
            rect: { x0: ROLL_X0, y0: BTN_Y0, x1: ROLL_X1, y1: BTN_Y1 },
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
            base_weight_index: 3,
        }),

        // Character Module (body slots) - TOP
        // Shows equipped items and weight
        make_character_module({
            id: 'character_module',
            rect: get_persisted_rect('character_module', { x0: 160, y0: 2, x1: 198, y1: 17 }),
            get_actor_name: () => APP_CONFIG.input_actor_id.split('_')[0] || 'Actor',
            get_actor_id: () => APP_CONFIG.input_actor_id,
            get_body_slots: () => ui_state.character.body_slots,
            get_equipped_items: () => ui_state.character.equipped_items,
            get_weight_data: () => ui_state.character.weight,
            get_is_visible: () => ui_state.character.is_visible,
            on_slot_click: (slot_name: string, slot_type: SlotType, garb_index: number | null) => {
                console.log(`[Character] Clicked body slot: ${slot_name}.${slot_type}${garb_index !== null ? `.${garb_index}` : ''}`);
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
                const compatible = await get_compatible_slots_for_instance(item.id, container_id, definition);
                ui_state.character.highlighted_slots = compatible;
                console.log(`[Character] Drag started from ${slot_name}.${slot_type}${garb_index !== null ? `.${garb_index}` : ''} - highlighting slots:`, compatible);
            },
            on_drop: async (slot_name: string, slot_type: SlotType, garb_index: number | null): Promise<boolean> => {
                // Check if there's an active drag
                if (!drag_state.is_dragging) return false;

                const actor_id = APP_CONFIG.input_actor_id;
                
                // Build inline target path (Phase 5)
                let target_container_id = `body_slots.${slot_name}.${slot_type}`;
                if (slot_type === 'garb' && garb_index !== null) {
                    target_container_id += `.${garb_index}`;
                }

                // Shortcut: if dropping onto an occupied container-item in a body slot, deposit into it.
                try {
                    const body_slots_any: any = ui_state.character.body_slots as any;
                    const slot = body_slots_any?.[slot_name];
                    let existing: any = null;
                    if (slot) {
                        if (slot_type === 'armor') existing = slot.armor;
                        else if (slot_type === 'tool') existing = slot.tool;
                        else if (slot_type === 'garb' && garb_index !== null) existing = slot.garb?.[garb_index] ?? null;
                    }

                    const is_container = has_tag(existing?.tags, 'CONTAINER');
                    if (is_container && existing?.id) {
                        if (drag_state.item_instance_id === existing.id) {
                            flash_status(['Cannot deposit a container into itself'], 1500);
                            drag_state.reject_drag();
                            return false;
                        }

                        const nested_dest = `actor.item.${actor_id}.${existing.id}`;

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
                                if (place) await update_current_place(place.id);
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
                            if (place) await update_current_place(place.id);
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
                            if (place) await update_current_place(place.id);
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
                    // Get target container (the sack)
                    const container = ui_state.container.current_container;
                    if (!container) {
                        drag_state.end_drag();
                        return false;
                    }

                    // Calculate target grid position if container is open
                    let target_grid_x: number | undefined;
                    let target_grid_y: number | undefined;
                    
                    if (ui_state.container.is_visible) {
                        // Container is open - calculate which slot was dropped on
                        const { cols, rows } = get_container_grid(container);
                        const slot_spacing_x = 2;
                        const slot_spacing_y = 1;
                        
                        // Standard container window position when open
                        // These should match the container module's rendering
                        const container_x0 = 160;
                        const container_y0 = 18;
                        const start_x = container_x0 + 2;
                        const start_y = container_y0 + 35; // Approximate, row 0 at bottom
                        
                        // Calculate column
                        const col = Math.floor((x - start_x) / slot_spacing_x);
                        
                        // Calculate row (inverted Y)
                        const row_offset = start_y - y;
                        const row = Math.floor(row_offset / slot_spacing_y);
                        
                        // Validate bounds
                        if (col >= 0 && col < cols && row >= 0 && row < rows) {
                            target_grid_x = col;
                            target_grid_y = row;
                            debug_log(`[Character] Drop calculated: grid(${target_grid_x}, ${target_grid_y}) from screen(${x}, ${y})`);
                        } else {
                            debug_log(`[Character] Drop out of bounds: col=${col}, row=${row}, bounds=${cols}x${rows}`);
                        }
                    }

                    try {
                        const transfer_data = await api_transfer_inline({
                            actor_id: APP_CONFIG.input_actor_id,
                            item_instance_id: String(drag_state.item_instance_id ?? ''),
                            from_container: String(drag_state.source_container_id ?? ''),
                            to_container: container.id,
                            target_grid_x,
                            target_grid_y,
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
                enabled: ['close', 'move', 'resize'],
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
            get_equipped_containers: () => {
                debug_log(`[get_equipped_containers] === SCANNING FOR INLINE CONTAINERS ===`);
                
                const containers: Array<{
                    slot_name: string;
                    item_instance: ItemInstance;
                    item_definition: ItemDefinition;
                    container_id: string;
                }> = [];
                
                // Walk body_slots directly to find containers (inline system)
                const body_slots = ui_state.character.body_slots as any;
                if (!body_slots) {
                    debug_log(`[get_equipped_containers] WARNING: No body_slots found`);
                    return containers;
                }
                
                debug_log(`[get_equipped_containers] Body slots: ${Object.keys(body_slots).join(', ')}`);
                
                for (const [slot_name, slot_data] of Object.entries(body_slots)) {
                    const slot = slot_data as any;
                    if (!slot) {
                        debug_log(`[get_equipped_containers] Slot ${slot_name} is empty`);
                        continue;
                    }
                    
                    debug_log(`[get_equipped_containers] Checking slot: ${slot_name}`);
                    
                    // Check armor slot
                    if (slot.armor) {
                        const is_container = has_tag(slot.armor.tags, 'CONTAINER');
                        debug_log(`[get_equipped_containers]   ${slot_name}.armor: ${slot.armor.name}, is_container=${is_container}`);
                        if (is_container) {
                            containers.push({
                                slot_name: `${slot_name}.armor`,
                                item_instance: slot.armor as ItemInstance,
                                item_definition: { name: slot.armor.name, tags: slot.armor.tags } as ItemDefinition,
                                container_id: `body_slots.${slot_name}.armor`,
                            });
                            debug_log(`[get_equipped_containers]   ✓ ADDED: body_slots.${slot_name}.armor`);
                        }
                    }
                    
                    // Check tool slot  
                    if (slot.tool) {
                        const is_container = has_tag(slot.tool.tags, 'CONTAINER');
                        debug_log(`[get_equipped_containers]   ${slot_name}.tool: ${slot.tool.name}, is_container=${is_container}`);
                        if (is_container) {
                            containers.push({
                                slot_name: `${slot_name}.tool`,
                                item_instance: slot.tool as ItemInstance,
                                item_definition: { name: slot.tool.name, tags: slot.tool.tags } as ItemDefinition,
                                container_id: `body_slots.${slot_name}.tool`,
                            });
                            debug_log(`[get_equipped_containers]   ✓ ADDED: body_slots.${slot_name}.tool`);
                        }
                    }
                    
                    // Check garb slots
                    if (slot.garb && Array.isArray(slot.garb)) {
                        debug_log(`[get_equipped_containers]   ${slot_name}.garb: ${slot.garb.length} items`);
                        slot.garb.forEach((item: any, index: number) => {
                            const is_container = has_tag(item.tags, 'CONTAINER');
                            debug_log(`[get_equipped_containers]     ${slot_name}.garb.${index}: ${item.name}, is_container=${is_container}`);
                            if (is_container) {
                                containers.push({
                                    slot_name: `${slot_name}.garb.${index}`,
                                    item_instance: item as ItemInstance,
                                    item_definition: { name: item.name, tags: item.tags } as ItemDefinition,
                                    container_id: `body_slots.${slot_name}.garb.${index}`,
                                });
                                debug_log(`[get_equipped_containers]     ✓ ADDED: body_slots.${slot_name}.garb.${index}`);
                            }
                        });
                    }
                }
                
                debug_log(`[get_equipped_containers] === FOUND ${containers.length} INLINE CONTAINERS ===`);
                containers.forEach((c, i) => {
                    debug_log(`[get_equipped_containers]   ${i + 1}. ${c.container_id} (${c.item_definition.name})`);
                });
                
                return containers;
            },
            get_default_container_id: () => ui_state.character.default_container_id,
            on_set_default_container: (container_id: string) => {
                ui_state.character.default_container_id = container_id;
                flash_status([`Default container set`], 1200);
            },
            on_container_click: (container_id: string) => {
                debug_log(`[Character] Container clicked: ${container_id}`);
                // Phase 7: Open container in new ContainerModule
                void open_container_module(container_id, 'your container');
            },
            // Phase 7: Right-click container opening
            on_open_container: async (container_id: string, slot_name: string) => {
                debug_log(`[Character] Opening container via right-click: ${container_id}`);
                await open_container_module(container_id, slot_name);
            },
            get_open_containers: () => ui_state.container.open_containers,
        }),

        // Inventory Container Module - BOTTOM
        // Shows sack contents
        make_container_module({
            id: 'inventory_container',
            rect: { x0: 160, y0: 18, x1: 198, y1: 35 },
            get_container: () => ui_state.container.current_container,
            get_slot_items: () => {
                const container = ui_state.container.current_container;
                const contents = ui_state.container.slot_items || [];
                const max_slots = container?.capacity?.max_slots || contents.length || 10;
                
                // Map items to SlotItem format with proper slot_index
                const slots = [];
                for (let i = 0; i < max_slots; i++) {
                    slots.push({ slot_index: i, instance: null, definition: null });
                }
                
                contents.forEach((item: any, idx: number) => {
                    let slot_index = idx;
                    
                    // If item has grid coordinates, use them
                    if (item.grid_x !== undefined && item.grid_y !== undefined && container) {
                        const { cols } = get_container_grid(container);
                        slot_index = item.grid_y * cols + item.grid_x;
                    }
                    
                    if (slot_index >= 0 && slot_index < max_slots) {
                        slots[slot_index] = {
                            slot_index,
                            instance: item.instance,
                            definition: item.definition
                        };
                    }
                });
                
                return slots;
            },

            get_is_visible: () => ui_state.container.is_visible,
            set_is_visible: async (visible: boolean) => { 
                debug_log(`[Inventory] set_is_visible called with: ${visible}`);
                ui_state.container.is_visible = visible;
                if (visible) {
                    // Phase 1: Load main inventory (equipped sack) when opening
                    debug_log('[Inventory] Opening inventory - fetching main inventory container...');
                    const main_inventory = await get_main_inventory_container();
                    debug_log(`[Inventory] get_main_inventory_container returned: ${main_inventory ? 'SUCCESS' : 'NULL'}`);
                    
                    if (main_inventory) {
                        ui_state.container.current_container = main_inventory.container_data;
                        ui_state.container.slot_items = main_inventory.container_data.contents || [];
                        debug_log(`[Inventory] Loaded main inventory: ${main_inventory.container_id} with ${main_inventory.container_data.contents?.length || 0} items`);
                    } else {
                        debug_log('[Inventory] No main inventory found - will show empty');
                    }
                    
                    // Refresh container data when opening
                    void refresh_container_data();
                    flash_status(['Inventory opened (press i to close)'], 1000);
                    
                    // Auto-refresh every 2 seconds while inventory is open
                    const refresh_interval = window.setInterval(() => {
                        if (ui_state.container.is_visible) {
                            void refresh_container_data();
                        } else {
                            window.clearInterval(refresh_interval);
                        }
                    }, 2000);
                } else {
                    flash_status(['Inventory closed'], 800);
                }
            },
            on_slot_click: (slot_index: number) => {
                console.log(`[Inventory] Clicked slot ${slot_index}`);
            },
            on_drag_start: (slot_index: number, item: ItemInstance, definition: ItemDefinition, container_id: string) => {
                console.log(`[Inventory] Drag started on slot ${slot_index}: ${definition.name}`);
                
                // Validate drag using centralized drag_state.can_drag()
                const validation = drag_state.can_drag(item.id, definition);
                if (!validation.can) {
                    flash_status([validation.reason!], 1500);
                    console.log(`[Inventory] Drag rejected: ${validation.reason}`);
                    return;
                }
                
                // Store in shared drag state
                drag_state.start_drag('container', item.id, container_id, definition, slot_index);
            },
            get_open_containers: () => ui_state.container.open_containers,
            get_open_container_id_for_item: (item_instance_id: string): string | null => {
                const actor_id = String(APP_CONFIG.input_actor_id ?? '');
                if (!actor_id) return null;
                return `actor.item.${actor_id}.${item_instance_id}`;
            },
            on_open_container_item: (item: ItemInstance, definition: ItemDefinition, parent_container_id: string) => {
                // Route container-item drags to opening.
                const place = get_current_place();
                if (place && parent_container_id.startsWith('place.pile.')) {
                    void open_container_module(`place.item.${place.id}.${item.id}`, definition.name);
                } else {
                    void open_container_module(`actor.item.${APP_CONFIG.input_actor_id}.${item.id}`, definition.name);
                }
            },
            on_slot_hover: async (slot_index: number, item: ItemInstance, definition: ItemDefinition | null) => {
                if (definition) {
                    // Find compatible slots and highlight them (call API for tag-based compatibility)
                    const source_container_id = ui_state.container.current_container?.id ?? null;
                    const compatible = await get_compatible_slots_for_instance(item.id, source_container_id, definition);
                    ui_state.character.highlighted_slots = compatible;
                    ui_state.character.hovered_item = { name: definition.name, source: 'inventory' };
                    console.log(`[Inventory] Hovering ${definition.name} - compatible slots:`, compatible);
                } else {
                    // Clear highlights and hover
                    ui_state.character.highlighted_slots = [];
                    ui_state.character.hovered_item = null;
                }
            },
            // Bidirectional highlighting: return items highlighted when hovering body slots
            get_highlighted_items: () => ui_state.character.highlighted_items,
            on_drag_rejected: () => drag_state.reject_drag(),
            on_drop: async (slot_index: number): Promise<boolean> => {
                console.log(`[Inventory] on_drop callback called for slot: ${slot_index}`);
                console.log(`[Inventory] Drag state: is_dragging=${drag_state.is_dragging}, source_module=${drag_state.source_module}`);
                console.log(`[Inventory] Dragged item: ${drag_state.item_definition?.name} (${drag_state.item_instance_id})`);
                console.log(`[Inventory] Source container: ${drag_state.source_container_id}`);

                // Check if there's an active drag
                if (!drag_state.is_dragging) {
                    console.log(`[Inventory] No active drag - rejecting`);
                    return false;
                }

                // Get target container (the sack)
                const container = ui_state.container.current_container;
                if (!container) {
                    console.log(`[Inventory] No container loaded - rejecting`);
                    drag_state.end_drag();
                    return false;
                }

                let target_container_id = container.id;
                let target_name = 'inventory';

                // Shortcut: dropping onto a container-item inside this container deposits into it.
                const container_data = ui_state.container.container_data_map.get(container.id);
                const contents = container_data?.contents || [];
                // Map drop slot_index to actual item using grid coords when available.
                const { cols } = get_container_grid(container);
                let target_item: any = null;
                for (let idx = 0; idx < contents.length; idx++) {
                    const entry = contents[idx];
                    if (!entry?.instance) continue;
                    let si = idx;
                    if (entry.grid_x !== undefined && entry.grid_y !== undefined) {
                        si = (entry.grid_y * cols) + entry.grid_x;
                    }
                    if (si === slot_index) {
                        target_item = entry;
                        break;
                    }
                }

                const target_is_container = has_tag(target_item?.definition?.tags, 'CONTAINER');
                if (target_item?.instance?.id && target_is_container) {
                    if (drag_state.item_instance_id === target_item.instance.id) {
                        flash_status(['Cannot deposit a container into itself'], 1500);
                        drag_state.reject_drag();
                        return false;
                    }
                    target_container_id = `actor.item.${APP_CONFIG.input_actor_id}.${target_item.instance.id}`;
                    target_name = target_item.definition?.name || 'container';
                }

                const src = String(drag_state.source_container_id ?? '');

                // Pile drags are sweep-only (place->place).
                if (drag_state.source_module === 'ground' && src.startsWith('place.pile.')) {
                    flash_status(['Open the pile and drag a specific item out'], 2000);
                    drag_state.reject_drag();
                    return false;
                }

                // Ground container-item -> actor container: withdraw nested item.
                if (src.startsWith('place.item.')) {
                    try {
                        const wd = await api_transfer_inline({
                            actor_id: APP_CONFIG.input_actor_id,
                            item_instance_id: String(drag_state.item_instance_id ?? ''),
                            from_container: src,
                            to_container: target_container_id,
                        });
                        if (wd.ok) {
                            flash_status([`${drag_state.item_definition?.name} moved to ${target_name}`], 1500);
                            drag_state.end_drag();
                            const place = get_current_place();
                            if (place) await update_current_place(place.id);
                            void refresh_container_data();
                            void refresh_character_data();
                            return true;
                        }
                        const detail = wd.detail ? ` (${JSON.stringify(wd.detail)})` : '';
                        flash_status([`Failed to pick up: ${wd.error}${detail}`], 1500);
                        drag_state.reject_drag();
                        return false;
                    } catch {
                        flash_status(['Error picking up item'], 1500);
                        drag_state.reject_drag();
                        return false;
                    }
                }

                if (src.startsWith('place.pile.') && String(drag_state.item_instance_id ?? '').startsWith('pile:')) {
                    flash_status(['Open the pile and drag a specific item out'], 2000);
                    drag_state.reject_drag();
                    return false;
                }

                // If source is a place item (ground single OR pile contents), use pickup_to.
                if (src.startsWith('place.ground.') || src.startsWith('place.pile.')) {
                    try {
                        if (src.startsWith('place.pile.') && String(drag_state.item_instance_id ?? '').startsWith('pile:')) {
                            flash_status(['Open the pile and drag a specific item out'], 2000);
                            drag_state.reject_drag();
                            return false;
                        }

                        const tx = await api_transfer_inline({
                            actor_id: APP_CONFIG.input_actor_id,
                            item_instance_id: String(drag_state.item_instance_id ?? ''),
                            from_container: src,
                            to_container: target_container_id,
                        });

                        if (tx.ok) {
                            const place = get_current_place();
                            flash_status([`${drag_state.item_definition?.name} moved to ${target_name}`], 1500);
                            drag_state.end_drag();
                            if (place) await update_current_place(place.id);
                            void refresh_container_data();
                            void refresh_character_data();
                            return true;
                        }
                        flash_status([`Failed to move: ${tx.error || 'unknown error'}`], 1500);
                        drag_state.reject_drag();
                        return false;
                    } catch (err) {
                        console.error('[Inventory] transfer error:', err);
                        flash_status(['Error moving item'], 1500);
                        drag_state.reject_drag();
                        return false;
                    }
                }

                console.log(`[Inventory] Transferring ${drag_state.item_definition?.name} to ${target_container_id}`);

                try {
                    const transfer_data = await api_transfer_inline({
                        actor_id: APP_CONFIG.input_actor_id,
                        item_instance_id: String(drag_state.item_instance_id ?? ''),
                        from_container: String(drag_state.source_container_id ?? ''),
                        to_container: target_container_id,
                    });

                    if (transfer_data.ok) {
                        console.log(`[Inventory] Transfer successful: ${drag_state.item_definition?.name} -> ${target_container_id}`);
                        flash_status([`${drag_state.item_definition?.name} moved to ${target_name}`], 1500);

                        // Refresh data
                        void refresh_container_data();
                        void refresh_character_data();

                        drag_state.end_drag();
                        return true;
                    } else {
                        console.log(`[Inventory] Transfer failed:`, transfer_data.error);
                        flash_status([`Failed to move: ${transfer_data.error || 'unknown error'}`], 1500);
                        drag_state.reject_drag();
                        return false;
                    }
                } catch (err) {
                    console.error(`[Inventory] Error during transfer:`, err);
                    flash_status([`Error moving item`], 1500);
                    drag_state.reject_drag();
                    return false;
                }
            },
            on_cross_module_drop: async (x: number, y: number): Promise<boolean> => {
                console.log(`[Inventory] Cross-module drop callback called at (${x}, ${y})`);
                console.log(`[Inventory] Drag state: is_dragging=${drag_state.is_dragging}, source_module=${drag_state.source_module}`);
                console.log(`[Inventory] Dragged item: ${drag_state.item_definition?.name}, container=${drag_state.source_container_id}`);

                // Check if we have an active drag
                if (!drag_state.is_dragging) {
                    console.log(`[Inventory] No active drag - rejecting drop`);
                    return false;
                }

                // Character module rect: { x0: 160, y0: 2, x1: 198, y1: 17 }
                console.log(`[Inventory] Checking if drop is on character module: x=${x} (160-198), y=${y} (2-17)`);
                if (x >= 160 && x <= 198 && y >= 2 && y <= 17) {
                    console.log(`[Inventory] Drop is on character module`);
                    // Drop is on character module - determine which slot
                    // Calculate slot from y position
                    // CharacterModule draws slots at: start_y = rect.y1 - 4 = 13
                    // Row 0 (head): y = 13, Row 1 (hands): y = 11, Row 2 (torso): y = 9, Row 3 (legs): y = 7
                    // Formula: row_from_top = floor((start_y - y) / 2) where start_y = 13
                    const start_y = 13; // rect.y1 - 4, must match CharacterModule
                    const row_from_top = Math.floor((start_y - y) / 2);
                    console.log(`[Inventory] Calculated row_from_top: ${row_from_top} (y=${y}, start_y=${start_y})`);

                    let target_slot_name: string | null = null;
                    if (row_from_top === 0) {
                        target_slot_name = 'head';
                    } else if (row_from_top === 1) {
                        // Hands - check x position
                        if (x < 179) {
                            target_slot_name = 'hand_left';
                        } else {
                            target_slot_name = 'hand_right';
                        }
                    } else if (row_from_top === 2) {
                        target_slot_name = 'torso';
                    } else if (row_from_top === 3) {
                        // Legs - check x position
                        if (x < 179) {
                            target_slot_name = 'leg_left';
                        } else {
                            target_slot_name = 'leg_right';
                        }
                    }

                    console.log(`[Inventory] Target slot determined: ${target_slot_name}`);

                    if (!target_slot_name) {
                        console.log(`[Inventory] Could not determine target slot - rejecting`);
                        return false;
                    }

                    console.log(`[Inventory] Target slot: ${target_slot_name}`);

                    // Determine slot type based on item tags
                    const item_def = drag_state.item_definition;
                    if (!item_def) {
                        console.log(`[Inventory] No item definition - rejecting`);
                        drag_state.end_drag();
                        return false;
                    }
                    const has_tool = has_tag(item_def.tags, 'TOOL');
                    const has_armor = has_tag(item_def.tags, 'ARMOR');
                    const has_garb = has_tag(item_def.tags, 'GARB');
                    
                    // Check if this slot is compatible with the item (call API for tag-based compatibility)
                    const compatible_slots = await get_compatible_slots_for_instance(drag_state.item_instance_id!, drag_state.source_container_id, item_def);
                    
                    // Find the best matching slot type for this target slot
                    let target_slot_type: string | null = null;
                    let target_garb_index: number | null = null;
                    
                    // Check if target slot is in compatible slots
                    const compatible_for_slot = compatible_slots.filter((slot: { slot_name: string; slot_type: string; garb_index?: number }) => 
                        slot.slot_name === target_slot_name
                    );
                    
                    if (compatible_for_slot.length === 0) {
                        console.log(`[Inventory] ${target_slot_name} is not compatible with ${item_def.name}`);
                        flash_status([`${item_def.name} cannot be equipped to ${target_slot_name}`], 1500);
                        drag_state.end_drag();
                        return false;
                    }
                    
                    // Determine which slot type to use based on item tags
                    if (has_armor && compatible_for_slot.some((s: any) => s.slot_type === 'armor')) {
                        target_slot_type = 'armor';
                    } else if (has_garb && compatible_for_slot.some((s: any) => s.slot_type === 'garb')) {
                        target_slot_type = 'garb';
                        // Find first available garb slot
                        const existing_garb_indices = compatible_for_slot
                            .filter((s: any) => s.slot_type === 'garb' && s.garb_index !== undefined)
                            .map((s: any) => s.garb_index);
                        target_garb_index = existing_garb_indices.length > 0 ? Math.min(...existing_garb_indices) : 0;
                    } else if (has_tool && compatible_for_slot.some((s: any) => s.slot_type === 'tool')) {
                        target_slot_type = 'tool';
                    } else if (compatible_for_slot.length > 0) {
                        // Default to first compatible type
                        const first_slot = compatible_for_slot[0];
                        target_slot_type = first_slot?.slot_type ?? 'tool';
                        if (target_slot_type === 'garb' && first_slot) {
                            target_garb_index = first_slot.garb_index ?? 0;
                        }
                    } else {
                        console.log(`[Inventory] No compatible slot type found for ${target_slot_name}`);
                        flash_status([`Cannot determine slot type for ${target_slot_name}`], 1500);
                        drag_state.end_drag();
                        return false;
                    }
                    
                    console.log(`[Inventory] Determined slot type: ${target_slot_type}${target_garb_index !== null ? '.' + target_garb_index : ''}`);

                    // Determine target container based on slot
                    const actor_id = APP_CONFIG.input_actor_id;
                    
                    // Build inline target path (Phase 5)
                    let target_container_id = `body_slots.${target_slot_name}.${target_slot_type}`;
                    if (target_slot_type === 'garb' && target_garb_index !== null) {
                        target_container_id += `.${target_garb_index}`;
                    }
                    
                    console.log(`[Inventory] Built target container ID: ${target_container_id}`);

                    console.log(`[Inventory] Transferring ${drag_state.item_definition?.name} to ${target_container_id}`);

                    try {
                        const transfer_data = await api_transfer_inline({
                            actor_id: APP_CONFIG.input_actor_id,
                            item_instance_id: String(drag_state.item_instance_id ?? ''),
                            from_container: String(drag_state.source_container_id ?? ''),
                            to_container: target_container_id,
                        });

                        if (transfer_data.ok) {
                            console.log(`[Inventory] Equip successful: ${drag_state.item_definition?.name} -> ${target_slot_name}`);
                            flash_status([`${drag_state.item_definition?.name} equipped to ${target_slot_name}`], 1500);

                            // Refresh data
                            void refresh_container_data();
                            void refresh_character_data();

                            drag_state.end_drag();
                            return true;
                        } else {
                            console.log(`[Inventory] Equip failed:`, transfer_data.error);
                            flash_status([`Failed to equip: ${transfer_data.error || 'unknown error'}`], 1500);
                            drag_state.reject_drag();
                            return false;
                        }
                    } catch (err) {
                        console.error(`[Inventory] Error during equip:`, err);
                        flash_status([`Error equipping item`], 1500);
                        drag_state.reject_drag();
                        return false;
                    }
                }

                drag_state.reject_drag();
                return false;
            },
            border_rgb: get_color_by_name('light_gray').rgb,
            bg_rgb: get_color_by_name('off_black').rgb,
            text_rgb: get_color_by_name('off_white').rgb,
            // Phase 8: Enable gizmos (close X, move #)
            gizmos: {
                enabled: ['close', 'move', 'resize'],
                can_close: true,
                can_move: true,
                can_save_position: false,
                on_close: () => {
                    debug_log('[ContainerModule] Close gizmo clicked - hiding container');
                    ui_state.container.is_visible = false;
                    flash_status(['Inventory closed (X clicked)'], 800);
                },
                on_move_start: () => {
                    debug_log('[ContainerModule] Move mode started');
                },
                on_move: (new_rect) => {
                    // Update position tracking
                    ui_state.modules.positions.set('inventory_container', new_rect);
                    debug_log(`[ContainerModule] Moving to (${new_rect.x0},${new_rect.y0})`);
                },
                on_move_end: (final_rect) => {
                    ui_state.modules.positions.set('inventory_container', final_rect);
                    flash_status([`Container moved to (${final_rect.x0},${final_rect.y0})`], 1000);
                },
            },
        }),
        
        // Phase 1.5: Global 'I' key handler - opens main inventory via open_container_module
        // This ensures the inventory works the same as clicking a sack
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
                    
                    // Find and open main inventory
                    void (async () => {
                        // Prefer user-selected default container if set; otherwise fallback.
                        const preferred = ui_state.character.default_container_id;
                        const target_id = preferred || (await get_main_inventory_container())?.container_id || null;

                        if (!target_id) {
                            flash_status(['No inventory equipped'], 1500);
                            return;
                        }

                        if (ui_state.container.open_containers.has(target_id)) {
                            close_container_module(target_id);
                            flash_status(['Inventory closed'], 800);
                        } else {
                            await open_container_module(target_id, 'inventory');
                        }
                    })();
                    
                    return true; // Stop propagation to other handlers
                }
                return false;
            },
        },
    ];

    // Register all static modules to the registry (Phase 7.5)
    for (const module of modules) {
        module_registry.register(module);
    }

    // Apply persisted visibility for registered modules.
    for (const [id, visible] of ui_state.modules.visibility.entries()) {
        module_registry.set_visibility(id, visible);
    }
    // Ensure visibility defaults are persisted for key closable modules.
    if (!ui_state.modules.visibility.has('character_module')) {
        ui_state.modules.visibility.set('character_module', ui_state.character.is_visible);
    }
    if (!ui_state.modules.visibility.has('debug')) {
        ui_state.modules.visibility.set('debug', module_registry.is_visible('debug'));
    }
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
    set_text_window_messages('debug', ['[debug] off | overlays:off', '[volume] NORMAL', '[move] WALK', '', '[region] (loading...)', 'Targets will appear here.']);

    // Server-authoritative movement: disable legacy NPC movement loops.
    // NPC wandering and movement are now driven by the interface server breath+brain ticks.
    ui_state.place.npc_movement_active = false;

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

    /**
     * Get NPC body slots for a given NPC ID
     * Uses place data instead of API call (workaround for missing /api/npc endpoint)
     */
    function get_npc_body_slots(npc_id: string): BodySlots {
        const place = get_current_place();
        if (!place) {
            debug_log(`[NPC Module] Error: No place loaded when getting body slots for ${npc_id}`);
            return {};
        }
        
        const npc_ref = `npc.${npc_id}`;
        const place_npc = place.contents.npcs_present.find((npc: any) => npc.npc_ref === npc_ref);
        
        if (!place_npc) {
            debug_log(`[NPC Module] Error: NPC ${npc_ref} not found in place ${place.id}`);
            return {};
        }
        
        if (!place_npc.body_slots || Object.keys(place_npc.body_slots).length === 0) {
            debug_log(`[NPC Module] Warning: NPC ${npc_ref} has no body_slots in place data`);
            return {};
        }
        
        debug_log(`[NPC Module] Found body_slots for ${npc_ref}: ${Object.keys(place_npc.body_slots).length} slots`);
        return place_npc.body_slots;
    }

    /**
     * Get NPC equipped items with definitions
     */
    async function get_npc_equipped_items(npc_id: string): Promise<Map<string, { instance: ItemInstance; definition: ItemDefinition }>> {
        const equipped = new Map<string, { instance: ItemInstance; definition: ItemDefinition }>();

        try {
            const body_slots = get_npc_body_slots(npc_id) as any;
            for (const [slot_name, slot_data] of Object.entries(body_slots ?? {})) {
                const s = slot_data as any;
                for (const [slot_type, value] of Object.entries({ armor: s.armor, tool: s.tool })) {
                    if (value && typeof (value as any).id === 'string') {
                        const item = value as any;
                        equipped.set(slot_name, {
                            instance: { id: item.id, def_id: item.def_id, qty: item.qty || 1, tags: item.tags || [] } as any,
                            definition: {
                                id: item.def_id,
                                name: item.name,
                                weight: item.weight || 0,
                                tags: item.tags || [],
                                display_char: (typeof item.display_char === 'string' && item.display_char.length > 0) ? String(item.display_char).charAt(0) : '·',
                            } as any,
                        });
                    }
                }
                if (Array.isArray(s.garb)) {
                    for (let i = 0; i < s.garb.length; i++) {
                        const item = s.garb[i];
                        if (item && typeof item.id === 'string') {
                            equipped.set(`${slot_name}.garb.${i}`, {
                                instance: { id: item.id, def_id: item.def_id, qty: item.qty || 1, tags: item.tags || [] } as any,
                                definition: {
                                    id: item.def_id,
                                    name: item.name,
                                    weight: item.weight || 0,
                                    tags: item.tags || [],
                                    display_char: (typeof (item as any).display_char === 'string' && String((item as any).display_char).length > 0) ? String((item as any).display_char).charAt(0) : '·',
                                } as any,
                            });
                        }
                    }
                }
            }
        } catch (err) {
            debug_log(`[NPC Module] Error loading equipped items for ${npc_id}:`, err);
        }

        return equipped;
    }

    /**
     * Get NPC weight data
     */
    async function get_npc_weight_data(npc_id: string): Promise<{ current: number; max: number }> {
        try {
            const body_slots = get_npc_body_slots(npc_id) as any;
            let total_weight = 0;

            function add_weight(item: any): number {
                if (!item) return 0;
                const qty = typeof item.qty === 'number' ? item.qty : 1;
                const w = typeof item.weight === 'number' ? item.weight : 0;
                let sum = w * qty;
                if (Array.isArray(item.contents)) {
                    for (const child of item.contents) sum += add_weight(child);
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

            return { current: total_weight, max: 100 };
        } catch (err) {
            debug_log(`[NPC Module] Error calculating weight for ${npc_id}:`, err);
            return { current: 0, max: 100 };
        }
    }

     /**
      * Phase 7: Open a container in a new ContainerModule instance.
      *
      * Supports inline container paths (`body_slots.*`, `actor.item.*`, `place.item.*`)
      * and special UI containers like piles.
      */
    async function open_container_module(container_id: string, source_name?: string): Promise<void> {
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

                // Use canonical server payload so piles behave like all other containers.
                const base_url = APP_CONFIG.place_endpoint.replace('/api/place', '');
                const api_res = await fetch(`${base_url}/api/place/pile_container?place_id=${encodeURIComponent(place_id)}&position_key=${encodeURIComponent(position_key)}`);
                if (!api_res.ok) {
                    flash_status([`Failed to load pile: ${api_res.status}`], 1500);
                    return;
                }
                const api_data = await api_res.json();
                if (!api_data.ok || !api_data.container) {
                    // Auto-revert: no pile / not found.
                    return;
                }
                const contents = api_data.container.contents || [];
                container = {
                    id: container_id,
                    kind: 'inline_pile',
                    name: api_data.container.name,
                    def_id: api_data.container.def_id,
                    capacity: api_data.container.capacity,
                    contents,
                };
                container_data = { container, contents };
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

                const api_res = await fetch(`http://localhost:8787/api/place/container_item?place_id=${encodeURIComponent(place_id)}&item_id=${encodeURIComponent(item_id)}`);
                if (!api_res.ok) {
                    flash_status(['Container not found'], 1500);
                    return;
                }

                const api_data = await api_res.json();
                if (!api_data.ok || !api_data.container) {
                    flash_status([`Container not found: ${api_data.error || 'unknown'}`], 1500);
                    return;
                }

                const contents = api_data.container.contents || [];
                container = {
                    id: container_id,
                    kind: 'inline_ground_container_item',
                    name: api_data.container.name,
                    def_id: api_data.container.def_id,
                    capacity: api_data.container.capacity,
                    contents,
                };
                container_data = { container, contents };
            }

            // Open a tile container (inline tile contents)
            else if (container_id.startsWith('place.tile.')) {
                // place.tile.<place_id>.<x>_<y>
                const parts = container_id.split('.');
                const place_id = parts[2];
                const pos_key = parts[3];
                if (!place_id || !pos_key) {
                    flash_status(['Invalid tile container id'], 1500);
                    return;
                }
                const [xs, ys] = pos_key.split('_');
                const x = xs !== undefined ? Number(xs) : NaN;
                const y = ys !== undefined ? Number(ys) : NaN;
                if (!Number.isFinite(x) || !Number.isFinite(y)) {
                    flash_status(['Invalid tile coords'], 1500);
                    return;
                }

                const api_res = await fetch(`http://localhost:8787/api/place/tile_container?place_id=${encodeURIComponent(place_id)}&x=${encodeURIComponent(String(x))}&y=${encodeURIComponent(String(y))}`);
                if (!api_res.ok) {
                    flash_status(['Tile container not found'], 1500);
                    return;
                }

                const api_data = await api_res.json();
                if (!api_data.ok || !api_data.container) {
                    flash_status([`Tile container not found: ${api_data.error || 'unknown'}`], 1500);
                    return;
                }

                // Canonicalize: structure multi-tiles return a canonical anchor tile id.
                const canonical_id = (typeof api_data.container.id === 'string' && api_data.container.id.length > 0)
                    ? String(api_data.container.id)
                    : container_id;
                const redirect = api_data.container.redirect ?? null;
                const alias_ids: string[] = Array.isArray(redirect?.alias_ids)
                    ? redirect.alias_ids.map((s: any) => String(s)).filter((s: string) => s.length > 0)
                    : [];

                // If canonical already open, just mark aliases open and stop.
                if (canonical_id !== container_id && ui_state.container.open_containers.has(canonical_id)) {
                    const all_aliases = Array.from(new Set([container_id, canonical_id, ...alias_ids]));
                    ui_state.container.aliases_by_canonical.set(canonical_id, all_aliases);
                    for (const a of all_aliases) ui_state.container.canonical_by_alias.set(a, canonical_id);
                    for (const a of all_aliases) ui_state.container.open_containers.add(a);
                    flash_status([`Container already open`], 800);
                    return;
                }

                // Switch to canonical id for module identity.
                {
                    const all_aliases = Array.from(new Set([container_id, canonical_id, ...alias_ids]));
                    if (redirect && all_aliases.length > 0) {
                        ui_state.container.aliases_by_canonical.set(canonical_id, all_aliases);
                        for (const a of all_aliases) ui_state.container.canonical_by_alias.set(a, canonical_id);
                    }
                    if (canonical_id !== container_id) {
                        container_id = canonical_id;
                    }
                }

                const contents = api_data.container.contents || [];
                container = {
                    id: container_id,
                    kind: 'inline_tile_container',
                    name: api_data.container.name,
                    def_id: api_data.container.def_id,
                    capacity: api_data.container.capacity,
                    contents,
                };
                container_data = { container, contents };
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

                const api_res = await fetch(`http://localhost:8787/api/actor/container_item?actor_id=${encodeURIComponent(actor_id)}&item_id=${encodeURIComponent(item_id)}`);
                if (!api_res.ok) {
                    flash_status(['Container not found'], 1500);
                    return;
                }

                const api_data = await api_res.json();
                if (!api_data.ok || !api_data.container) {
                    flash_status([`Container not found: ${api_data.error || 'unknown'}`], 1500);
                    return;
                }

                const contents = api_data.container.contents || [];
                container = {
                    id: container_id,
                    kind: 'inline_actor_container_item',
                    name: api_data.container.name,
                    def_id: api_data.container.def_id,
                    capacity: api_data.container.capacity,
                    contents,
                };
                container_data = { container, contents };
            }
            
            // NEW INLINE SYSTEM: Handle body_slots paths
            else if (container_id.startsWith('body_slots.')) {
                debug_log(`[ContainerOpener] NEW INLINE SYSTEM: Opening body_slots container: ${container_id}`);
                
                const actor_id = APP_CONFIG.input_actor_id;
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
                debug_log(`[ContainerOpener] Calling API: /api/body_slot/container?actor_id=${actor_id}&path=${container_path}`);
                
                // Call the new inline API
                const api_res = await fetch(`http://localhost:8787/api/body_slot/container?actor_id=${actor_id}&path=${encodeURIComponent(container_path)}`);
                debug_log(`[ContainerOpener] API response status: ${api_res.status}`);
                
                if (!api_res.ok) {
                    const error_text = await api_res.text();
                    debug_log(`[ContainerOpener] ERROR: API returned ${api_res.status}: ${error_text}`);
                    flash_status([`Failed to load container: ${api_res.status}`], 1500);
                    return;
                }
                
                const api_data = await api_res.json();
                debug_log(`[ContainerOpener] API response: ok=${api_data.ok}, has container=${!!api_data.container}`);
                
                if (!api_data.ok || !api_data.container) {
                    debug_log(`[ContainerOpener] ERROR: API returned not ok or no container: ${api_data.error || 'unknown'}`);
                    flash_status([`Container not found: ${api_data.error || 'unknown'}`], 1500);
                    return;
                }
                
                // Format the response for the container module
                const contents = api_data.container.contents || [];
                debug_log(`[ContainerOpener] Container has ${contents.length} items`);
                
                container = {
                    id: container_id,
                    kind: 'inline_body_slot',
                    name: api_data.container.name,
                    def_id: api_data.container.def_id,
                    path: api_data.container.path,
                    capacity: api_data.container.capacity,
                    contents: contents
                };
                container_data = { container, contents };
                
                debug_log(`[ContainerOpener] Successfully loaded inline body_slots container: ${container.name} (${contents.length} items)`);
            }
            // NEW INLINE SYSTEM: Handle ground containers
            else if (container_id.startsWith('place.ground.')) {
                debug_log(`[ContainerOpener] NEW INLINE SYSTEM: Opening ground container: ${container_id}`);
                
                // Parse: place.ground.{place_id}.{position_key}.{index}
                const path_parts = container_id.split('.');
                if (path_parts.length < 5) {
                    debug_log(`[ContainerOpener] ERROR: Invalid place.ground path format: ${container_id}`);
                    flash_status([`Invalid container path`], 1500);
                    return;
                }
                
                const place_id = path_parts[2]!;
                const position_key = path_parts[3]!; // e.g., "4_5"
                const item_index = path_parts[4]!;
                
                debug_log(`[ContainerOpener] Parsed: place_id=${place_id}, position_key=${position_key}, index=${item_index}`);
                debug_log(`[ContainerOpener] Calling API: /api/place/ground_container?place_id=${place_id}&position_key=${position_key}&index=${item_index}`);
                
                // Call the new inline API
                const api_res = await fetch(`http://localhost:8787/api/place/ground_container?place_id=${encodeURIComponent(place_id)}&position_key=${encodeURIComponent(position_key)}&index=${encodeURIComponent(item_index)}`);
                debug_log(`[ContainerOpener] API response status: ${api_res.status}`);
                
                if (!api_res.ok) {
                    const error_text = await api_res.text();
                    debug_log(`[ContainerOpener] ERROR: API returned ${api_res.status}: ${error_text}`);
                    flash_status([`Failed to load container: ${api_res.status}`], 1500);
                    return;
                }
                
                const api_data = await api_res.json();
                debug_log(`[ContainerOpener] API response: ok=${api_data.ok}, has container=${!!api_data.container}`);
                
                if (!api_data.ok || !api_data.container) {
                    debug_log(`[ContainerOpener] ERROR: API returned not ok or no container: ${api_data.error || 'unknown'}`);
                    flash_status([`Container not found: ${api_data.error || 'unknown'}`], 1500);
                    return;
                }
                
                // Format the response for the container module
                const contents = api_data.container.contents || [];
                debug_log(`[ContainerOpener] Container has ${contents.length} items`);
                
                container = {
                    id: container_id,
                    kind: 'inline_ground',
                    name: api_data.container.name,
                    def_id: api_data.container.def_id,
                    position_key: api_data.container.position_key,
                    index: api_data.container.index,
                    capacity: api_data.container.capacity,
                    contents: contents
                };
                container_data = { container, contents };
                
                debug_log(`[ContainerOpener] Successfully loaded inline ground container: ${container.name} (${contents.length} items)`);
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
            
            // Create container module with callbacks that read from shared state
            const container_module = make_container_module({
                id: instance_id,
                rect: container_rect,
                get_container: () => {
                    // Read from shared state so updates are visible to all modules
                    const data = ui_state.container.container_data_map.get(container_id);
                    return data?.container || null;
                },
                get_slot_items: () => {
                    // Read from shared state so updates are visible to all modules
                    const data = ui_state.container.container_data_map.get(container_id);
                    const contents = data?.contents || [];
                    const container = data?.container;
                    const max_slots = container?.capacity?.max_slots || contents.length;
                    
                    debug_log(`[DEBUG-GRID] === get_slot_items called for ${container_id} ===`);
                    debug_log(`[DEBUG-GRID] Container data found: ${!!data}`);
                    debug_log(`[DEBUG-GRID] Contents count: ${contents.length}`);
                    debug_log(`[DEBUG-GRID] Max slots: ${max_slots}`);
                    
                    // Count items with and without grid coordinates
                    const with_coords = contents.filter((item: any) => item.grid_x !== undefined && item.grid_y !== undefined).length;
                    const without_coords = contents.length - with_coords;
                    debug_log(`[DEBUG-GRID] Items WITH grid coords: ${with_coords}, WITHOUT: ${without_coords}`);
                    
                    // Map items to their grid positions for sparse inventory support
                    // Items with grid_x/grid_y are placed at their grid position
                    // Items without grid coordinates use packed behavior (array index)
                    const slots = [];
                    for (let i = 0; i < max_slots; i++) {
                        slots.push({ slot_index: i, instance: null, definition: null });
                    }
                    
                    // Place items at their grid positions or packed positions
                    contents.forEach((item: any, idx: number) => {
                        let slot_index = idx;
                        
                        // If item has grid coordinates, calculate slot_index from them
                        if (item.grid_x !== undefined && item.grid_y !== undefined && container) {
                            const { cols } = get_container_grid(container);
                            slot_index = item.grid_y * cols + item.grid_x;
                            debug_log(`[DEBUG-GRID] ✅ Grid mapping: ${item.instance?.def_id} -> grid(${item.grid_x},${item.grid_y}) -> slot ${slot_index}`);
                        } else {
                            debug_log(`[DEBUG-GRID] ⚠️ Packed mapping: ${item.instance?.def_id} -> slot ${slot_index} (NO GRID COORDS - grid_x: ${item.grid_x}, grid_y: ${item.grid_y})`);
                        }
                        
                        if (slot_index >= 0 && slot_index < max_slots) {
                            slots[slot_index] = {
                                slot_index,
                                instance: item.instance,
                                definition: item.definition
                            };
                        } else {
                            debug_log(`[DEBUG-GRID] ❌ ERROR: Slot index ${slot_index} out of bounds (0-${max_slots-1}) for ${item.instance?.def_id}`);
                        }
                    });
                    
                    const filled_slots = slots.filter((s: any) => s.instance !== null).length;
                    debug_log(`[DEBUG-GRID] === get_slot_items complete: ${filled_slots} filled slots ===`);
                    
                    return slots;
                },
                get_is_visible: () => true,
                set_is_visible: (visible: boolean) => {
                    if (!visible) {
                        // Close this container module
                        close_container_module(container_id);
                    }
                },
                on_slot_click: (slot_index: number) => {
                    debug_log(`[Container ${instance_id}] Clicked slot ${slot_index}`);
                },
                // Tile containers behave like container-items; allow moving items in/out.
                allow_drag: true,
                on_drag_start: (slot_index: number, item: ItemInstance, definition: ItemDefinition, cont_id: string) => {
                    // Validate drag using centralized drag_state.can_drag()
                    const validation = drag_state.can_drag(item.id, definition);
                    if (!validation.can) {
                        flash_status([validation.reason!], 1500);
                        debug_log(`[Container ${instance_id}] Drag rejected: ${validation.reason}`);
                        return;
                    }
                    
                    drag_state.start_drag('container', item.id, cont_id, definition, slot_index);
                },
                on_open_container_item: (item: ItemInstance, definition: ItemDefinition, parent_container_id: string) => {
                    const place = get_current_place();
                    if (place && parent_container_id.startsWith('place.pile.')) {
                        void open_container_module(`place.item.${place.id}.${item.id}`, definition.name);
                    } else if (place && parent_container_id.startsWith('place.tile.')) {
                        // Nested container-items inside a tile container are not yet addressable.
                        flash_status(['Nested tile containers not supported yet'], 1500);
                    } else if (place && parent_container_id.startsWith('place.item.')) {
                        // Nested container-items inside a ground container-item are not yet addressable.
                        flash_status(['Nested ground containers not supported yet'], 1500);
                    } else {
                        void open_container_module(`actor.item.${APP_CONFIG.input_actor_id}.${item.id}`, definition.name);
                    }
                },
                on_slot_hover: async (slot_index: number, item: ItemInstance, definition: ItemDefinition | null) => {
                    if (definition) {
                        // Highlight compatible body slots when hovering items (call API for tag-based compatibility)
                        const compatible = await get_compatible_slots_for_instance(item.id, container_id, definition);
                        ui_state.character.highlighted_slots = compatible;
                        ui_state.character.hovered_item = { name: definition.name, source: container_id };
                    } else {
                        ui_state.character.highlighted_slots = [];
                        ui_state.character.hovered_item = null;
                    }
                },
                // Bidirectional highlighting: return items highlighted when hovering body slots
                get_highlighted_items: () => ui_state.character.highlighted_items,
                on_drag_rejected: () => drag_state.reject_drag(),
                on_drop: async (slot_index: number, grid_x?: number, grid_y?: number): Promise<boolean> => {
                    // Handle dropping items into this container
                    debug_log(`[DEBUG-GRID] on_drop called: slot_index=${slot_index}, grid_x=${grid_x}, grid_y=${grid_y}`);
                    debug_log(`[DEBUG-GRID] drag_state: is_dragging=${drag_state.is_dragging}, source_container_id=${drag_state.source_container_id}`);
                    
                    if (!drag_state.is_dragging) {
                        debug_log(`[DEBUG-GRID] Early return: not dragging`);
                        return false;
                    }

                    const src = String(drag_state.source_container_id ?? '');

                    // Tile containers behave like ground container-items.
                    if (container_id.startsWith('place.tile.')) {
                        const place = get_current_place();
                        if (!place) {
                            drag_state.reject_drag();
                            return false;
                        }

                        const parts = container_id.split('.');
                        const place_id = parts[2];
                        const pos_key = parts[3];
                        if (!place_id || !pos_key || place.id !== place_id) {
                            drag_state.reject_drag();
                            return false;
                        }
                        const [xs, ys] = pos_key.split('_');
                        const x = Number(xs);
                        const y = Number(ys);
                        if (!Number.isFinite(x) || !Number.isFinite(y)) {
                            drag_state.reject_drag();
                            return false;
                        }

                        return await perform_drag_drop_into_tile_container({
                            place,
                            tile_x: Math.floor(x),
                            tile_y: Math.floor(y),
                            grid_x,
                            grid_y,
                        });
                    }

                    // Target is a ground pile UI: treat drops into it as dropping to ground at that tile.
                    if (container_id.startsWith('place.pile.')) {
                        const parts = container_id.split('.');
                        const place_id = parts[2];
                        const position_key = parts[3];
                        if (!place_id || !position_key) {
                            drag_state.reject_drag();
                            return false;
                        }
                        const [xs, ys, zs] = (position_key || '').split('_');
                        const x = parseInt(xs || '0', 10);
                        const y = parseInt(ys || '0', 10);
                        const pile_z = parseInt(zs || '', 10);
                        const to_elevation = Number.isFinite(pile_z) ? Math.floor(pile_z) : get_focus_world_z_for_current_place();

                        // Reorder within the same pile (acts like container reordering).
                        if (src === container_id && !String(drag_state.item_instance_id ?? '').startsWith('pile:')) {
                            try {
                                // Prefer explicit grid coords from the module; fallback to slot_index mapping.
                                let gx = grid_x;
                                let gy = grid_y;
                                if (gx === undefined || gy === undefined) {
                                    const data = ui_state.container.container_data_map.get(container_id);
                                    const cont = data?.container;
                                    if (cont) {
                                        const { cols } = get_container_grid(cont as any);
                                        gx = slot_index % cols;
                                        gy = Math.floor(slot_index / cols);
                                    }
                                }

                                const mv = await api_transfer_inline({
                                    actor_id: APP_CONFIG.input_actor_id,
                                    item_instance_id: String(drag_state.item_instance_id ?? ''),
                                    from_container: container_id,
                                    to_container: container_id,
                                    target_grid_x: typeof gx === 'number' ? gx : undefined,
                                    target_grid_y: typeof gy === 'number' ? gy : undefined,
                                });

                                if (mv.ok) {
                                    flash_status(['Moved'], 800);
                                    drag_state.end_drag();
                                    await update_current_place(place_id);
                                    void refresh_container_data();
                                    return true;
                                }
                                flash_status([`Move failed: ${mv.error}`], 1500);
                                drag_state.reject_drag();
                                return false;
                            } catch {
                                flash_status(['Move failed'], 1500);
                                drag_state.reject_drag();
                                return false;
                            }
                        }

                        // Move a place-sourced single item into this pile tile.
                        if ((src.startsWith('place.pile.') || src.startsWith('place.ground.')) && !String(drag_state.item_instance_id ?? '').startsWith('pile:')) {
                            const src_parts = src.split('.');
                            const src_place_id = src_parts[2];
                            const src_position_key = src_parts[3];
                            if (!src_place_id || !src_position_key || src_place_id !== place_id) {
                                drag_state.reject_drag();
                                return false;
                            }
                            const [fxs, fys, fzs] = (src_position_key || '').split('_');
                            const from_x = parseInt(fxs || '0', 10);
                            const from_y = parseInt(fys || '0', 10);
                            const from_z = parseInt(fzs || '', 10);
                            try {
                                const mv = await api_transfer_inline({
                                    actor_id: APP_CONFIG.input_actor_id,
                                    item_instance_id: String(drag_state.item_instance_id ?? ''),
                                    from_container: src,
                                    to_container: container_id,
                                });
                                if (mv.ok) {
                                    flash_status(['Moved'], 900);
                                    drag_state.end_drag();
                                    await update_current_place(place_id);
                                    void refresh_container_data();
                                    return true;
                                }
                                flash_status([`Move failed: ${mv.error}`], 1500);
                                drag_state.reject_drag();
                                return false;
                            } catch {
                                flash_status(['Move failed'], 1500);
                                drag_state.reject_drag();
                                return false;
                            }
                        }

                        // If dropping onto a container-item within the pile, deposit into it.
                        try {
                            const data = ui_state.container.container_data_map.get(container_id);
                            const cont = data?.container;
                            const contents = data?.contents || [];
                            if (cont) {
                                const { cols } = get_container_grid(cont as any);
                                let target_entry: any = null;
                                for (let idx = 0; idx < contents.length; idx++) {
                                    const entry = contents[idx];
                                    if (!entry?.instance) continue;
                                    let si = idx;
                                    if (entry.grid_x !== undefined && entry.grid_y !== undefined) {
                                        si = (entry.grid_y * cols) + entry.grid_x;
                                    }
                                    if (si === slot_index) {
                                        target_entry = entry;
                                        break;
                                    }
                                }

                                const target_item_id = target_entry?.instance?.id;
                                const meta = target_item_id ? ui_state.place.ground_items_by_id.get(String(target_item_id)) : null;
                                const is_container = has_tag(meta?.tags, 'CONTAINER');
                                if (target_item_id && is_container) {
                                    if (drag_state.item_instance_id === target_item_id) {
                                    flash_status(['Cannot deposit a container into itself'], 1500);
                                    drag_state.reject_drag();
                                    return false;
                                }

                                    if (src.startsWith('place.pile.') && String(drag_state.item_instance_id ?? '').startsWith('pile:')) {
                                        flash_status(['Open the pile and drag a specific item out'], 2000);
                                        drag_state.reject_drag();
                                        return false;
                                    }

                                    const dest = `place.item.${place_id}.${String(target_item_id)}`;
                                    const tx = await api_transfer_inline({
                                        actor_id: APP_CONFIG.input_actor_id,
                                        item_instance_id: String(drag_state.item_instance_id ?? ''),
                                        from_container: src,
                                        to_container: dest,
                                    });

                                    if (tx.ok) {
                                        flash_status([`Moved into ${meta?.name ?? 'container'}`], 1500);
                                        drag_state.end_drag();
                                        await update_current_place(place_id);
                                        void refresh_container_data();
                                        void refresh_character_data();
                                        return true;
                                    }

                                    flash_status([`Deposit failed: ${tx.error || 'unknown error'}`], 1500);
                                    drag_state.reject_drag();
                                    return false;
                                }
                            }
                        } catch {
                            // fall through to drop
                        }

                        // If source is ground too, only allow cancel back onto same pile tile.
                        if (drag_state.source_module === 'ground' || src.startsWith('place.ground.') || src.startsWith('place.pile.')) {
                            if (src.includes(position_key || '')) {
                                drag_state.end_drag();
                                return true;
                            }
                            drag_state.reject_drag();
                            return false;
                        }

                        // Ground container-item -> ground tile (pile tile): spill to ground.
                        if (src.startsWith('place.item.')) {
                            try {
                                const to_container = `place.ground.${place_id}.${x}_${y}_${to_elevation}`;
                                const sp = await api_transfer_inline({
                                    actor_id: APP_CONFIG.input_actor_id,
                                    item_instance_id: String(drag_state.item_instance_id ?? ''),
                                    from_container: src,
                                    to_container,
                                });
                                if (sp.ok) {
                                    flash_status(['Dropped to pile'], 1200);
                                    drag_state.end_drag();
                                    await update_current_place(place_id);
                                    void refresh_container_data();
                                    void refresh_character_data();
                                    return true;
                                }
                                flash_status([`Drop failed: ${sp.error}`], 1500);
                                drag_state.reject_drag();
                                return false;
                            } catch {
                                flash_status(['Drop failed'], 1500);
                                drag_state.reject_drag();
                                return false;
                            }
                        }

                        // Tile container -> ground tile (pile tile): spill to ground.
                        if (src.startsWith('place.tile.')) {
                            try {
                                const to_container = `place.ground.${place_id}.${x}_${y}_${to_elevation}`;
                                const sp = await api_transfer_inline({
                                    actor_id: APP_CONFIG.input_actor_id,
                                    item_instance_id: String(drag_state.item_instance_id ?? ''),
                                    from_container: src,
                                    to_container,
                                });
                                if (sp.ok) {
                                    flash_status(['Dropped to pile'], 1200);
                                    drag_state.end_drag();
                                    await update_current_place(place_id);
                                    void refresh_container_data();
                                    void refresh_character_data();
                                    return true;
                                }
                                flash_status([`Drop failed: ${sp.error}`], 1500);
                                drag_state.reject_drag();
                                return false;
                            } catch {
                                flash_status(['Drop failed'], 1500);
                                drag_state.reject_drag();
                                return false;
                            }
                        }

                        try {
                            const to_container = `place.ground.${place_id}.${x}_${y}_${to_elevation}`;
                            const drop_data = await api_transfer_inline({
                                actor_id: APP_CONFIG.input_actor_id,
                                item_instance_id: String(drag_state.item_instance_id ?? ''),
                                from_container: src,
                                to_container,
                            });
                            if (drop_data.ok) {
                                flash_status(['Dropped to pile'], 1200);
                                drag_state.end_drag();
                                await update_current_place(place_id);
                                void refresh_container_data();
                                void refresh_character_data();
                                return true;
                            }
                            flash_status([`Drop failed: ${drop_data.error || 'unknown error'}`], 1500);
                            drag_state.reject_drag();
                            return false;
                        } catch (err) {
                            flash_status(['Drop failed'], 1500);
                            drag_state.reject_drag();
                            return false;
                        }
                    }

                    // Target is a ground container-item UI: deposits into that container-item.
                    if (container_id.startsWith('place.item.')) {
                        const parts = container_id.split('.');
                        const place_id = parts[2];
                        const container_item_id = parts[3];
                        if (!place_id || !container_item_id) {
                            drag_state.reject_drag();
                            return false;
                        }

                        if (drag_state.item_instance_id === container_item_id) {
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

                            const tx = await api_transfer_inline({
                                actor_id: APP_CONFIG.input_actor_id,
                                item_instance_id: String(drag_state.item_instance_id ?? ''),
                                from_container: src,
                                to_container: container_id,
                                target_grid_x: typeof grid_x === 'number' ? grid_x : undefined,
                                target_grid_y: typeof grid_y === 'number' ? grid_y : undefined,
                            });

                            if (tx.ok) {
                                flash_status(['Deposited'], 1200);
                                drag_state.end_drag();
                                await update_current_place(place_id);
                                void refresh_container_data();
                                void refresh_character_data();
                                return true;
                            }

                            flash_status([`Deposit failed: ${tx.error || 'unknown error'}`], 1500);
                            drag_state.reject_drag();
                            return false;
                        } catch {
                            flash_status(['Deposit failed'], 1500);
                            drag_state.reject_drag();
                            return false;
                        }
                    }

                    // Source is ground single item / ground container-item: pickup/withdraw into body_slots/actor.item target.
                    const src0 = String(drag_state.source_container_id ?? '');
                    if (drag_state.source_module === 'ground' && src0.startsWith('place.pile.')) {
                        flash_status(['Open the pile and drag a specific item out'], 2000);
                        drag_state.reject_drag();
                        return false;
                    }

                    if (drag_state.source_module === 'ground' || src0.startsWith('place.ground.') || src0.startsWith('place.item.')) {
                        if (!container_id.startsWith('body_slots.') && !container_id.startsWith('actor.item.')) {
                            flash_status(['Cannot place ground items into that container yet'], 1500);
                            drag_state.reject_drag();
                            return false;
                        }

                        try {
                            const src = src0;

                            const tx = await api_transfer_inline({
                                actor_id: APP_CONFIG.input_actor_id,
                                item_instance_id: String(drag_state.item_instance_id ?? ''),
                                from_container: src,
                                to_container: container_id,
                                target_grid_x: typeof grid_x === 'number' ? grid_x : undefined,
                                target_grid_y: typeof grid_y === 'number' ? grid_y : undefined,
                            });

                            if (tx.ok) {
                                const place = get_current_place();
                                flash_status(['Picked up'], 1200);
                                drag_state.end_drag();
                                if (place) await update_current_place(place.id);
                                void refresh_container_data();
                                void refresh_character_data();
                                return true;
                            }

                            flash_status([`Pickup failed: ${tx.error || 'unknown error'}`], 1500);
                            drag_state.reject_drag();
                            return false;
                        } catch {
                            flash_status(['Pickup failed'], 1500);
                            drag_state.reject_drag();
                            return false;
                        }
                    }
                    
                    try {
                        // Read from shared state for consistency
                        const data = ui_state.container.container_data_map.get(container_id);
                        const contents = data?.contents || [];
                        debug_log(`[DEBUG-GRID] Container data loaded: ${contents.length} items`);
                        
                        // Determine target container
                        let target_container_id = container_id;
                        let target_name = container_id.split('.').pop() || 'container';

                        // Shortcut: dropping onto a container-item inside this container deposits into it.
                        const cont = data?.container;
                        if (cont && Array.isArray(contents) && (container_id.startsWith('body_slots.') || container_id.startsWith('actor.item.'))) {
                            const { cols } = get_container_grid(cont as any);
                            let target_entry: any = null;
                            for (let idx = 0; idx < contents.length; idx++) {
                                const entry = contents[idx];
                                if (!entry?.instance) continue;
                                let si = idx;
                                if (entry.grid_x !== undefined && entry.grid_y !== undefined) {
                                    si = (entry.grid_y * cols) + entry.grid_x;
                                }
                                if (si === slot_index) {
                                    target_entry = entry;
                                    break;
                                }
                            }

                            const target_is_container = has_tag(target_entry?.definition?.tags, 'CONTAINER');
                            if (target_entry?.instance?.id && target_is_container) {
                                if (drag_state.item_instance_id === target_entry.instance.id) {
                                    flash_status(['Cannot deposit a container into itself'], 1500);
                                    drag_state.reject_drag();
                                    return false;
                                }
                                target_container_id = `actor.item.${APP_CONFIG.input_actor_id}.${target_entry.instance.id}`;
                                target_name = target_entry.definition?.name || 'container';
                            }
                        }

                        const src = String(drag_state.source_container_id ?? '');
                        
                        // Build transfer request body
                        const transfer_body: any = {
                            actor_id: APP_CONFIG.input_actor_id,
                            item_instance_id: drag_state.item_instance_id,
                            from_container: drag_state.source_container_id,
                            to_container: target_container_id,
                            from_slot_index: drag_state.source_slot_index,
                            to_slot_index: slot_index,
                        };
                        
                        // Add grid coordinates when dropping into the container itself.
                        // When depositing into a nested container-item, do not forward parent grid coords.
                        debug_log(`[DEBUG-GRID] Checking grid condition: source=${drag_state.source_container_id}, target=${target_container_id}, grid_x=${grid_x}, grid_y=${grid_y}`);
                        if (target_container_id === container_id && grid_x !== undefined && grid_y !== undefined) {
                            transfer_body.target_grid_x = grid_x;
                            transfer_body.target_grid_y = grid_y;
                            debug_log(`[DEBUG-GRID] Grid coordinates INCLUDED: (${grid_x}, ${grid_y})`);
                        } else {
                            debug_log(`[DEBUG-GRID] Grid coordinates SKIPPED`);
                        }
                        
                        debug_log(`[DEBUG-GRID] Request body:`, JSON.stringify(transfer_body, null, 2));
                        
                        const transfer_data = await api_transfer_inline({
                            actor_id: String(transfer_body.actor_id ?? APP_CONFIG.input_actor_id),
                            item_instance_id: String(transfer_body.item_instance_id ?? ''),
                            from_container: String(transfer_body.from_container ?? ''),
                            to_container: String(transfer_body.to_container ?? ''),
                            target_grid_x: transfer_body.target_grid_x,
                            target_grid_y: transfer_body.target_grid_y,
                        });
                        
                        if (transfer_data.ok) {
                            flash_status([`${drag_state.item_definition?.name} moved to ${target_name}`], 1500);
                            drag_state.end_drag();
                            // Refresh both container and character data
                            void refresh_container_data();
                            void refresh_character_data();

                            // If either side is place-owned, refresh the place snapshot.
                            try {
                                const fromc = String(drag_state.source_container_id ?? '');
                                const toc = String(target_container_id ?? '');
                                if (fromc.startsWith('place.') || toc.startsWith('place.')) {
                                    const place = get_current_place();
                                    if (place) void update_current_place(place.id);
                                }
                            } catch {
                                // ignore
                            }
                            return true;
                        } else {
                            flash_status([`Transfer failed: ${transfer_data.error}`], 1500);
                            drag_state.reject_drag();
                            return false;
                        }
                    } catch (err) {
                        flash_status([`Error transferring item`], 1500);
                        drag_state.reject_drag();
                        return false;
                    }
                },
                gizmos: {
                    enabled: ['close', 'move', 'resize'],
                    can_close: true,
                    can_move: true,
                    can_save_position: false,
                    on_close: () => {
                        close_container_module(container_id);
                    },
                    on_move: (new_rect) => {
                        ui_state.modules.positions.set(instance_id, new_rect);
                        persist_module_layout_debounced();
                    },
                    on_move_end: (final_rect) => {
                        ui_state.modules.positions.set(instance_id, final_rect);
                        persist_module_layout_debounced();
                    },
                    on_resize: (new_rect) => {
                        ui_state.modules.positions.set(instance_id, new_rect);
                        persist_module_layout_debounced();
                    },
                    on_resize_end: (final_rect) => {
                        ui_state.modules.positions.set(instance_id, final_rect);
                        persist_module_layout_debounced();
                    },
                },
            });
            
            // Register module
            module_registry.register(container_module);

            const aliases = ui_state.container.aliases_by_canonical.get(container_id) ?? [container_id];
            for (const a of aliases) {
                ui_state.container.open_containers.add(a);
                ui_state.container.container_module_map.set(a, instance_id);
            }
            
            // Store container data in shared state for refreshing
            // FIX: Use container_data.contents (from API) which has migrated grid coordinates
            // instead of container.contents which might be stale
            const contents_to_store = container_data.contents || container.contents || [];
            debug_log(`[ContainerOpener] Storing container data for ${container_id}`);
            debug_log(`[ContainerOpener] - container_data.contents length: ${container_data.contents?.length || 0}`);
            debug_log(`[ContainerOpener] - container.contents length: ${container.contents?.length || 0}`);
            debug_log(`[ContainerOpener] - Using: ${container_data.contents ? 'container_data.contents (API)' : 'container.contents (fallback)'}`);
            
            // Log first few items to verify grid coordinates
            contents_to_store.slice(0, 3).forEach((item: any, idx: number) => {
                debug_log(`[ContainerOpener] - Item ${idx}: ${item.instance?.def_id}, grid_x: ${item.grid_x}, grid_y: ${item.grid_y}`);
            });
            
            ui_state.container.container_data_map.set(container_id, { 
                container, 
                contents: contents_to_store
            });
            
            const display_name = source_name || (container?.name ?? null) || container_id.split('.').pop() || 'container';
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
    function close_container_module(container_id: string): void {
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
        }
        ui_state.container.aliases_by_canonical.delete(container_id);
        ui_state.container.container_data_map.delete(container_id);
        if (typeof slot === 'number' && slot >= 1 && slot <= ui_state.container.container_slots.length) {
            ui_state.container.container_slots[slot - 1] = null;
        }
        ui_state.container.container_slot_by_container_id.delete(container_id);

        
        flash_status([`Container closed`], 800);
    }

    /**
     * Open an NPC character module
     */
    async function open_npc_character_module(npc_id: string, npc_name: string): Promise<void> {
        debug_log(`[NPC Module] Starting to open ${npc_name} (${npc_id})`);
        
        if (!module_registry) {
            debug_log('[NPC Module] Error: Module registry not initialized');
            flash_status(['Error: Module system not ready'], 1500);
            return;
        }
        
        const module_id = `npc_character_${npc_id}`;
        
        // Check if already open
        if (ui_state.modules.open_npc_modules.has(npc_id)) {
            debug_log(`[NPC Module] ${npc_name} already open, flashing existing module`);
            flash_module_border(module_id, 'yellow', 500);
            flash_status([`${npc_name}'s inventory already open`], 1500);
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
        
        debug_log(`[NPC Module] Calculated position for ${npc_name}: x0=${npc_rect.x0}, y0=${npc_rect.y0} (player at x0=${player_rect.x0})`);
        
        // Load NPC data
        debug_log(`[NPC Module] Loading data for ${npc_name}...`);
        let body_slots, equipped_items, weight_data;
        try {
            // Get body_slots synchronously from place data
            body_slots = get_npc_body_slots(npc_id);
            
            // Get equipped items and weight via API
            [equipped_items, weight_data] = await Promise.all([
                get_npc_equipped_items(npc_id),
                get_npc_weight_data(npc_id)
            ]);
            debug_log(`[NPC Module] Loaded data for ${npc_name}: ${Object.keys(body_slots).length} body slots, ${equipped_items.size} equipped items`);
        } catch (err) {
            debug_log(`[NPC Module] Error loading data for ${npc_name}:`, err);
            flash_status([`Error loading ${npc_name}'s data`], 1500);
            return;
        }
        
        // Create NPC character module
        const npc_module = make_character_module({
            id: module_id,
            rect: npc_rect,
            get_actor_name: () => npc_name,
            get_actor_id: () => npc_id,
            get_body_slots: () => body_slots,
            get_equipped_items: () => equipped_items,
            get_weight_data: () => weight_data,
            get_is_visible: () => true,
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
                        actor_id: APP_CONFIG.input_actor_id,
                        item_instance_id: String(drag_state.item_instance_id ?? ''),
                        from_container: String(drag_state.source_container_id ?? ''),
                        to_container: target_container_id,
                    });
                    
                    if (transfer_data.ok) {
                        flash_status([`${drag_state.item_definition?.name} given to ${npc_name}`], 1500);
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
                    
                    const container = ui_state.container.current_container;
                    if (!container) {
                        drag_state.end_drag();
                        return false;
                    }
                    
                    try {
                        const transfer_data = await api_transfer_inline({
                            actor_id: APP_CONFIG.input_actor_id,
                            item_instance_id: String(drag_state.item_instance_id ?? ''),
                            from_container: String(drag_state.source_container_id ?? ''),
                            to_container: container.id,
                        });
                        
                        if (transfer_data.ok) {
                            flash_status([`${drag_state.item_definition?.name} taken from ${npc_name}`], 1500);
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
                enabled: ['close', 'move'],
                can_close: true,
                can_move: true,
                can_save_position: false,
                on_close: () => {
                    debug_log(`[NPC Module] Close gizmo clicked - closing ${npc_name}`);
                    close_npc_module(npc_id);
                    flash_status([`${npc_name}'s inventory closed`], 1000);
                },
                on_move_start: () => {
                    debug_log(`[NPC Module] Move mode started for ${npc_name}`);
                },
                on_move: (new_rect) => {
                    ui_state.modules.positions.set(module_id, new_rect);
                    debug_log(`[NPC Module] Moving ${npc_name} to (${new_rect.x0},${new_rect.y0})`);
                    persist_module_layout_debounced();
                },
                on_move_end: (final_rect) => {
                    ui_state.modules.positions.set(module_id, final_rect);
                    flash_status([`${npc_name}'s panel moved`], 1000);
                    persist_module_layout_debounced();
                },
            },
            // Container sidebar: Show equipped containers only (NEW INLINE SYSTEM)
            get_equipped_containers: () => {
                const containers: Array<{
                    slot_name: string;
                    item_instance: ItemInstance;
                    item_definition: ItemDefinition;
                    container_id: string;
                }> = [];
                
                debug_log(`[NPC get_equipped_containers] === SCANNING FOR INLINE CONTAINERS ===`);
                debug_log(`[NPC get_equipped_containers] NPC: ${npc_id}, Body slots: ${Object.keys(body_slots).length}`);
                
                // NEW INLINE SYSTEM: Walk body_slots directly to find containers
                for (const [slot_name, slot_data] of Object.entries(body_slots)) {
                    const slot = slot_data as any;
                    if (!slot) continue;
                    
                    debug_log(`[NPC get_equipped_containers] Checking slot: ${slot_name}`);
                    
                    // Check armor slot for CONTAINER tag
                    if (slot.armor) {
                        const is_container = has_tag(slot.armor.tags, 'CONTAINER');
                        debug_log(`[NPC get_equipped_containers]   ${slot_name}.armor: ${slot.armor.name}, is_container=${is_container}`);
                        if (is_container) {
                            containers.push({
                                slot_name: `${slot_name}.armor`,
                                item_instance: slot.armor as ItemInstance,
                                item_definition: { name: slot.armor.name, tags: slot.armor.tags } as ItemDefinition,
                                container_id: `body_slots.${slot_name}.armor`,
                            });
                            debug_log(`[NPC get_equipped_containers]   ✓ ADDED: body_slots.${slot_name}.armor`);
                        }
                    }
                    
                    // Check tool slot for CONTAINER tag
                    if (slot.tool) {
                        const is_container = has_tag(slot.tool.tags, 'CONTAINER');
                        debug_log(`[NPC get_equipped_containers]   ${slot_name}.tool: ${slot.tool.name}, is_container=${is_container}`);
                        if (is_container) {
                            containers.push({
                                slot_name: `${slot_name}.tool`,
                                item_instance: slot.tool as ItemInstance,
                                item_definition: { name: slot.tool.name, tags: slot.tool.tags } as ItemDefinition,
                                container_id: `body_slots.${slot_name}.tool`,
                            });
                            debug_log(`[NPC get_equipped_containers]   ✓ ADDED: body_slots.${slot_name}.tool`);
                        }
                    }
                    
                    // Check garb slots for CONTAINER tag
                    if (slot.garb && Array.isArray(slot.garb)) {
                        for (let i = 0; i < slot.garb.length; i++) {
                            const garb_item = slot.garb[i];
                            const is_container = has_tag(garb_item.tags, 'CONTAINER');
                            debug_log(`[NPC get_equipped_containers]   ${slot_name}.garb.${i}: ${garb_item.name}, is_container=${is_container}`);
                            if (is_container) {
                                containers.push({
                                    slot_name: `${slot_name}.garb.${i}`,
                                    item_instance: garb_item as ItemInstance,
                                    item_definition: { name: garb_item.name, tags: garb_item.tags } as ItemDefinition,
                                    container_id: `body_slots.${slot_name}.garb.${i}`,
                                });
                                debug_log(`[NPC get_equipped_containers]   ✓ ADDED: body_slots.${slot_name}.garb.${i}`);
                            }
                        }
                    }
                }
                
                debug_log(`[NPC get_equipped_containers] === FOUND ${containers.length} INLINE CONTAINERS ===`);
                
                return containers;
            },
            on_container_click: (container_id: string) => {
                debug_log(`[NPC Module] Container clicked: ${container_id}`);
                // Phase 7: Open container in new ContainerModule
                void open_container_module(container_id, `${npc_name}'s container`);
            },
            // Phase 7: Right-click container opening
            on_open_container: async (container_id: string, slot_name: string) => {
                debug_log(`[NPC Module] Opening container via right-click: ${container_id}`);
                await open_container_module(container_id, `${npc_name}'s ${slot_name}`);
            },
            get_open_containers: () => ui_state.container.open_containers,
        });
        
        // Register the module
        module_registry.register(npc_module);
        ui_state.modules.positions.set(module_id, npc_rect);
        ui_state.modules.open_npc_modules.add(npc_id);
        
        const total_modules = module_registry.get_all().length;
        debug_log(`[NPC Module] Successfully opened ${npc_name} (${module_id}) at position (${npc_rect.x0},${npc_rect.y0})`);
        debug_log(`[NPC Module] Total modules in registry: ${total_modules}`);
        flash_status([`Opened ${npc_name}'s inventory`], 1500);
    }

    /**
     * Close an NPC character module
     */
    function close_npc_module(npc_id: string): void {
        if (!module_registry) return;
        
        const module_id = `npc_character_${npc_id}`;
        
        module_registry.unregister(module_id);
        ui_state.modules.open_npc_modules.delete(npc_id);
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

    return {
        modules: module_registry.get_all(),
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
        // Overlay hook (after compose) used by CanvasRuntime.
        on_after_compose: (canvas: any) => {
            drag_state.render_drag_ghost(canvas);

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
