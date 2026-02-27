import { make_fill_module } from '../mono_ui/modules/fill_module.js';
import { make_button_module } from '../mono_ui/modules/button_module.js';
import { make_text_window_module, type TextWindowMessage } from '../mono_ui/modules/window_module.js';
import { make_input_module } from '../mono_ui/modules/input_module.js';
import { make_roller_module } from '../mono_ui/modules/roller_module.js';
import { make_place_module } from '../mono_ui/modules/place_module.js';
import { make_container_module, type SlotItem } from '../mono_ui/modules/container_module.js';
import { make_character_module } from '../mono_ui/modules/character_module.js';
import type { Module, Rgb, Rect } from '../mono_ui/types.js';
import { create_module_registry, type ModuleRegistry } from '../mono_ui/module_registry.js';
import { handleEntityClick } from '../interface_program/frontend_api.js';
import type { Place } from '../types/place.js';
import { debug_warn, debug_log } from '../shared/debug.js';
import { init_npc_movement, stop_place_movement, is_npc_moving } from '../npc_ai/movement_loop.js';
import { start_movement_command_handler, set_command_handler_place } from '../mono_ui/modules/movement_command_handler.js';
import { get_color_by_name } from '../mono_ui/colors.js';
import { infer_action_verb_hint } from '../shared/intent_hint.js';
// NOTE: Do NOT import Node.js modules (load_actor, find_kind, etc.) here
// This code runs in browser context and must use HTTP APIs instead
import { load_container, type Container } from '../container_storage/store.js';
import { calculate_grid_dimensions, get_container_grid } from '../container_storage/grid_calculator.js';
import { type ItemInstance } from '../item_instances/store.js';
import { type ItemDefinition } from '../item_storage/store.js';
import { type BodySlots, get_slot_item_id } from '../types/body_slots.js';
import { DEBUG_VISION, spawn_sense_broadcast_particles } from '../mono_ui/vision_debugger.js';
import { get_senses_for_action } from '../action_system/sense_broadcast.js';
import { UI_DEBUG } from '../mono_ui/runtime/ui_debug.js';
import { play_sfx } from '../mono_ui/sfx/sfx_player.js';

export const APP_CONFIG = {
    font_family: 'Martian Mono',
    // Typography tuned to match the design reference:
    // - size: 32.23px
    // - line height: 29.8px (29.8 / 32.23 ≈ 0.925)
    // - letter spacing: -18% (of font size)
    base_font_size_px: 32.23,
    base_line_height_mult: 29.8 / 32.23,
    base_letter_spacing_mult: -0.18,
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
            // Track container data for all open containers (shared state for refreshing)
            container_data_map: new Map<string, { container: Container; contents: any[] }>(),
        },
        character: {
            is_visible: true,  // Always visible for now
            body_slots: {} as BodySlots,
            equipped_items: new Map() as Map<string, { instance: ItemInstance; definition: ItemDefinition }>,
            weight: { current: 0, max: 100 },
            highlighted_slots: [] as string[],  // Slots highlighted when hovering compatible items
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
                const nested_container_id = `item.${item_id}`;
                if (ui_state.container.open_containers.has(nested_container_id)) {
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
            // Priority: display_char > first letter of name > "?"
            if (this.item_definition.display_char && this.item_definition.display_char !== "·") {
                return this.item_definition.display_char;
            } else if (this.item_definition.name) {
                return this.item_definition.name.charAt(0).toLowerCase();
            }
            return "?";
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



    // Helper function to determine compatible body slots for an item
    // Now uses lowercase_snake_case consistently throughout the system
    function get_compatible_slots(item_def: ItemDefinition): string[] {
        if (!item_def.valid_body_slots || item_def.valid_body_slots.length === 0) {
            return [];
        }

        // Return slot names directly - they're already in lowercase_snake_case
        return item_def.valid_body_slots.filter(slot => 
            ['head', 'torso', 'hand_left', 'hand_right', 'leg_left', 'leg_right'].includes(slot)
        );
    }

    // Helper function to find items in open containers compatible with a body slot
    // Returns array of { container_id, slot_index } for items that can equip to slot_name
    function get_compatible_items_for_slot(slot_name: string): Array<{ container_id: string; slot_index: number }> {
        const compatible_items: Array<{ container_id: string; slot_index: number }> = [];
        
        // Search through all open containers
        for (const container_id of ui_state.container.open_containers) {
            const container_data = ui_state.container.container_data_map.get(container_id);
            if (!container_data) continue;
            
            const contents = container_data.contents;
            for (let i = 0; i < contents.length; i++) {
                const entry = contents[i];
                if (!entry?.definition) continue;
                
                // Check if this item can go in the specified slot
                const valid_slots = entry.definition.valid_body_slots || [];
                if (valid_slots.includes(slot_name)) {
                    compatible_items.push({ container_id, slot_index: i });
                }
            }
        }
        
        return compatible_items;
    }

    // Load character data (body slots, equipped items, weight)
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
            const body_slots = (actor.body_slots as BodySlots) || {};
            ui_state.character.body_slots = body_slots;
            
            // Fetch all containers for this actor (reused for weight calc and equipped items)
            const containers_res = await fetch(`http://localhost:8787/api/containers?owner_ref=actor.${actor_id}&slot=${slot}`);
            const full_containers: any[] = [];
            let total_weight = 0;
            
            if (containers_res.ok) {
                const containers_data = await containers_res.json();
                
                if (containers_data.ok && containers_data.containers) {
                    // Load full container data for all containers
                    for (const container of containers_data.containers) {
                        const container_res = await fetch(`http://localhost:8787/api/container?id=${container.id}&slot=${slot}`);
                        if (container_res.ok) {
                            const container_data = await container_res.json();
                            if (container_data.ok && container_data.container) {
                                full_containers.push(container_data.container);
                                
                                // Calculate weight from this container's contents
                                if (container_data.container.contents) {
                                    for (const content of container_data.container.contents) {
                                        if (content.instance && content.definition) {
                                            const item_weight = (content.definition.weight || 0);
                                            const qty = (content.instance.qty || 1);
                                            total_weight += item_weight * qty;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    
                    ui_state.character.weight.current = total_weight;
                    const strength = (actor.stats as Record<string, number>)?.str || 50;
                    ui_state.character.weight.max = strength * 2.5;
                }
            }
            
            // Load equipped items from body_slots (new armor/garb/tool format)
            // Clear existing Map instead of replacing it to maintain reference
            debug_log(`[LOAD_EQUIPPED] === START LOADING EQUIPPED ITEMS ===`);
            debug_log(`[LOAD_EQUIPPED] body_slots: ${JSON.stringify(body_slots, null, 2)}`);
            ui_state.character.equipped_items.clear();
            const body_slot_names = ['head', 'torso', 'hand_left', 'hand_right', 'leg_left', 'leg_right'];
            
            debug_log(`[LOAD_EQUIPPED] Have ${full_containers.length} containers to search`);
            full_containers.forEach((c, i) => {
                debug_log(`[LOAD_EQUIPPED] Container ${i}: ${c.id}, contents: ${c.contents?.length || 0}`);
                c.contents?.forEach((content: any, j: number) => {
                    debug_log(`[LOAD_EQUIPPED]   Content ${j}: ${content.instance?.id} (${content.definition?.name})`);
                    if (content.instance?.container_data?.contents) {
                        content.instance.container_data.contents.forEach((nested: any, k: number) => {
                            debug_log(`[LOAD_EQUIPPED]     Nested ${k}: ${nested.instance?.id} (${nested.definition?.name})`);
                        });
                    }
                });
            });
            
            // Helper to find item by ID across all containers (including nested)
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
            
            // Reuse containers data from weight calculation above
            // For each body slot, get the equipped item ID from body_slots and find it in containers
            for (const slot_name of body_slot_names) {
                const item_id = get_slot_item_id(body_slots, slot_name);
                debug_log(`[LOAD_EQUIPPED] Slot ${slot_name}: item_id=${item_id}`);
                if (item_id) {
                    const item_data = find_item_in_containers(full_containers, item_id);
                    if (item_data) {
                        ui_state.character.equipped_items.set(slot_name, item_data);
                        debug_log(`[Character] Found equipped item in ${slot_name}: ${item_data.definition.name} (${item_id})`);
                    } else {
                        debug_log(`[Character] WARNING: Could not find item ${item_id} for slot ${slot_name}`);
                    }
                }
            }
            
            debug_log(`[Character] Total equipped items loaded: ${ui_state.character.equipped_items.size}`);
            debug_log(`[LOAD_EQUIPPED] === END LOADING EQUIPPED ITEMS ===`);
            
        } catch (err) {
            console.error('[Character] Error refreshing character data:', err);
        }
    }

    // Phase 1: Get main inventory container (equipped sack)
    async function get_main_inventory_container(): Promise<{ container_id: string; container_data: any } | null> {
        const actor_id = APP_CONFIG.input_actor_id;
        const slot = APP_CONFIG.selected_data_slot;
        
        debug_log(`[MainInventory] Looking for main inventory. Actor: ${actor_id}, Slot: ${slot}`);
        
        if (!actor_id) {
            flash_status(['No actor selected'], 1500);
            debug_log('[MainInventory] ERROR: No actor_id in APP_CONFIG');
            return null;
        }
        
        try {
            // Load actor to check body slots
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
            const slot_priority = ['leg_left', 'leg_right', 'torso', 'head'];
            
            for (const slot_name of slot_priority) {
                const body_slot = body_slots[slot_name];
                debug_log(`[MainInventory] Checking ${slot_name}: has item: ${!!body_slot?.item_instance_id}`);
                
                if (body_slot?.item_instance_id) {
                    // Check if this is a container item
                    const containers_res = await fetch(`http://localhost:8787/api/containers?owner_ref=actor.${actor_id}&slot=${slot}`);
                    if (!containers_res.ok) {
                        debug_log(`[MainInventory] ERROR: Containers API returned ${containers_res.status}`);
                        continue;
                    }
                    
                    const containers_data = await containers_res.json();
                    if (!containers_data.ok || !containers_data.containers) {
                        debug_log(`[MainInventory] ERROR: Containers data invalid`);
                        continue;
                    }
                    
                    debug_log(`[MainInventory] Found ${containers_data.containers.length} containers`);
                    
                    // Find the container for this body slot
                    for (const container_info of containers_data.containers) {
                        const expected_id = `container.${actor_id}.${slot_name}`;
                        debug_log(`[MainInventory] Checking container ${container_info.id} against ${expected_id}`);
                        
                        if (container_info.id === expected_id) {
                            const container_res = await fetch(`http://localhost:8787/api/container?id=${container_info.id}&slot=${slot}`);
                            if (!container_res.ok) {
                                debug_log(`[MainInventory] ERROR: Container API returned ${container_res.status}`);
                                continue;
                            }
                            
                            const container_details = await container_res.json();
                            if (!container_details.ok) {
                                debug_log(`[MainInventory] ERROR: Container details invalid`);
                                continue;
                            }
                            
                            debug_log(`[MainInventory] Container ${slot_name} has ${container_details.contents?.length || 0} items`);
                            
                            // Check if the equipped item has container_data (is a sack/bag)
                            const equipped_item = container_details.contents?.find(
                                (item: any) => item.instance?.id === body_slot.item_instance_id
                            );
                            
                            debug_log(`[MainInventory] Equipped item ${body_slot.item_instance_id}: found=${!!equipped_item}, has container_data: ${!!equipped_item?.instance?.container_data}`);
                            
                            if (equipped_item?.instance?.container_data) {
                                // This is a container item - return its nested container
                                const nested_container_id = `item.${equipped_item.instance.id}`;
                                debug_log(`[MainInventory] SUCCESS: Found main inventory at ${nested_container_id}`);
                                return {
                                    container_id: nested_container_id,
                                    container_data: {
                                        id: nested_container_id,
                                        kind: 'item',
                                        owner_ref: `actor.${actor_id}`,
                                        ...equipped_item.instance.container_data,
                                        contents: equipped_item.instance.container_data.contents || []
                                    }
                                };
                            }
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

    // Refresh ALL open containers by iterating through the open_containers Set
    async function refresh_container_data(): Promise<void> {
        const open_containers = Array.from(ui_state.container.open_containers);
        if (open_containers.length === 0) return;
        
        debug_log(`[ContainerRefresh] Refreshing ${open_containers.length} open container(s)`);
        
        for (const container_id of open_containers) {
            try {
                const slot = APP_CONFIG.selected_data_slot;
                let container: Container | null = null;
                let contents: any[] = [];
                
                // Check if this is a nested container (item.inst_xxx format)
                if (container_id.startsWith('item.')) {
                    // For nested containers, we need to find the item and get its container_data
                    const item_instance_id = container_id.slice(5);
                    const actor_id = APP_CONFIG.input_actor_id;
                    
                    // Fetch all containers for the actor to find the item
                    const containers_res = await fetch(`http://localhost:8787/api/containers?owner_ref=actor.${actor_id}&slot=${slot}`);
                    if (containers_res.ok) {
                        const containers_data = await containers_res.json();
                        if (containers_data.ok && containers_data.containers) {
                            // Search through all containers for the item
                            for (const container_info of containers_data.containers) {
                                const container_res = await fetch(`http://localhost:8787/api/container?id=${container_info.id}&slot=${slot}`);
                                if (!container_res.ok) continue;
                                
                                const container_details = await container_res.json();
                                if (!container_details.ok || !container_details.contents) continue;
                                
                                // Find the item with matching instance ID
                                const found_item = container_details.contents.find(
                                    (item: any) => item.instance?.id === item_instance_id
                                );
                                
                                if (found_item?.instance?.container_data) {
                                    // Found it! Build nested contents with grid coordinates (same fix as open_container_module)
                                    const raw_contents = found_item.instance.container_data.contents || [];
                                    const nested_max_slots = found_item.instance.container_data.capacity?.max_slots || raw_contents.length || 10;
                                    const { cols: nested_cols } = calculate_grid_dimensions(nested_max_slots);
                                    
                                    const nested_contents = [];
                                    for (let i = 0; i < raw_contents.length; i++) {
                                        const entry = raw_contents[i];
                                        const grid_x = entry.grid_x !== undefined ? entry.grid_x : (i % nested_cols);
                                        const grid_y = entry.grid_y !== undefined ? entry.grid_y : Math.floor(i / nested_cols);
                                        
                                        nested_contents.push({
                                            instance: entry.instance,
                                            definition: entry.definition,
                                            grid_x,
                                            grid_y
                                        });
                                    }
                                    
                                    // IMPORTANT: container_data doesn't have an 'id' field, so we need to add it
                                    container = {
                                        ...found_item.instance.container_data,
                                        id: container_id, // Use the item.xxx format as the container ID
                                        contents: nested_contents
                                    };
                                    contents = nested_contents;
                                    
                                    const with_coords = nested_contents.filter((item: any) => item.grid_x !== undefined && item.grid_y !== undefined).length;
                                    debug_log(`[ContainerRefresh] Refreshed ${container_id} with ${nested_contents.length} items, ${with_coords} have grid coords`);
                                    break;
                                }
                            }
                        }
                    }
                } else {
                    // Regular container - fetch directly
                    const container_res = await fetch(`http://localhost:8787/api/container?id=${container_id}&slot=${slot}`);
                    if (container_res.ok) {
                        const container_data = await container_res.json();
                        if (container_data.ok) {
                            container = container_data.container;
                            contents = container_data.contents || [];
                        }
                    }
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
            return;
        }

        // Only update ID if it's different (triggers re-center)
        const is_new_place = place_id !== ui_state.place.current_place_id;
        if (is_new_place) {
            ui_state.place.current_place_id = place_id;
            // Reset view state for new place
            ui_state.place.current_place = null;
        }

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
                
                ui_state.place.current_place = data.place;
                
                // IMPORTANT: Re-register place with movement engine to ensure it uses updated data
                // This prevents stale cached place data from affecting rendering
                // (e.g., items that were picked up still appearing due to old cache)
                const { register_place } = await import("../shared/movement_engine.js");
                register_place(data.place.id, data.place);
                
                // Phase 8: Unified Movement Authority
                // Frontend NO LONGER initializes place movement
                // NPC_AI backend is the sole authority for movement decisions
                // The backend will send movement commands via outbox
                // Frontend just visualizes movement updates from the callback
                
                // Update movement command handler with new place
                set_command_handler_place(data.place);
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
        // bump rev so window refreshes immediately
        const cur = ui_state.text_windows.get('status');
        if (cur) cur.rev++;
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

                // Update current place view (skip if NPC movement is active to prevent snap-back)
                const place_id = data.place_id ?? null;
                if (!ui_state.place.npc_movement_active) {
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
                dbg.push(`[debug] ${UI_DEBUG.enabled ? 'ON' : 'off'} | H:${DEBUG_VISION.show_hearing_ranges ? 'on' : 'off'} B:${DEBUG_VISION.show_sense_broadcasts ? 'on' : 'off'} V:${DEBUG_VISION.show_blocked_vision ? 'on' : 'off'}`);
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
                            spawn_sense_broadcast_particles(pos, b.sense, b.range_tiles);
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

    // Do not seed the log window with placeholder text.

    let input_submit: (() => void) | null = null;

    // Create module registry for dynamic module management (Phase 7.5)
    const module_registry = create_module_registry();
    ui_state.modules.registry = module_registry;

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
            on_actor_move: async (actor_ref: string, new_position: { x: number; y: number }): Promise<void> => {
                // Persist actor position change via API
                // This prevents the actor from snapping back when place data refreshes
                const actor_id = actor_ref.replace('actor.', '');
                const slot = APP_CONFIG.selected_data_slot;
                
                try {
                    const base_url = APP_CONFIG.place_endpoint.replace('/api/place', '');
                    const response = await fetch(
                        `${base_url}/api/actor/move?slot=${slot}&actor_id=${encodeURIComponent(actor_id)}`,
                        {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(new_position)
                        }
                    );
                    
                    if (!response.ok) {
                        const error = await response.text();
                        debug_warn('[mono_ui]', `Failed to save actor ${actor_id} position`, error);
                    } else {
                        debug_warn('[mono_ui]', `Actor ${actor_id} position saved to`, new_position);
                    }
                } catch (err) {
                    debug_warn('[mono_ui]', `Error saving actor ${actor_id} position`, err);
                }
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
            floor_char: '.',
            floor_rgb: get_color_by_name('dark_gray').rgb,
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
                debug_log(`[PlaceModule] Double-click on ground at (${tile_x}, ${tile_y})`);
                // Open scattered container at this position
                const place = get_current_place();
                if (!place) return;
                const container_id = `container.place.${place.id}.scattered_${tile_x}_${tile_y}`;
                void open_container_module(container_id, 'ground items');
            },

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

                const place = get_current_place();
                if (!place) {
                    debug_log(`[PlaceModule] on_drop: No place loaded - rejecting`);
                    return false;
                }
                debug_log(`[PlaceModule] on_drop: Place is ${place.id}`);

                // Get actor position for distance check
                const actor = place.contents.actors_present[0];
                if (!actor) {
                    debug_log(`[PlaceModule] on_drop: No actor present - rejecting`);
                    return false;
                }

                const distance = Math.sqrt(
                    Math.pow(tile_x - actor.tile_position.x, 2) +
                    Math.pow(tile_y - actor.tile_position.y, 2)
                );
                debug_log(`[PlaceModule] on_drop: Distance from actor: ${distance.toFixed(2)} tiles`);

                if (distance > 1.5) {
                    debug_log(`[PlaceModule] on_drop: Too far (${distance.toFixed(2)} > 1.5) - rejecting`);
                    drag_state.reject_drag();
                    return false;
                }

                // Call the drop API
                const slot = APP_CONFIG.selected_data_slot;
                const base_url = APP_CONFIG.place_endpoint.replace('/api/place', '');
                const url = `${base_url}/api/place/drop?slot=${slot}`;
                
                // API expects: actor_id (not actor_ref), tile_position object (not tile_x/tile_y)
                const actor_id = APP_CONFIG.input_actor_id;
                const request_body = {
                    actor_id: actor_id,
                    item_instance_id: drag_state.item_instance_id,
                    tile_position: { x: tile_x, y: tile_y }
                };
                
                debug_log(`[PlaceModule] on_drop: Calling API ${url}`);
                debug_log(`[PlaceModule] on_drop: Request body: ${JSON.stringify(request_body)}`);

                try {
                    const response = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(request_body)
                    });

                    debug_log(`[PlaceModule] on_drop: Response status: ${response.status}`);

                    if (!response.ok) {
                        const error_text = await response.text();
                        debug_log(`[PlaceModule] on_drop: HTTP error: ${response.status} - ${error_text}`);
                        drag_state.reject_drag();
                        flash_status([`Cannot drop: ${error_text}`], 2000);
                        return false;
                    }

                    const data = await response.json();
                    debug_log(`[PlaceModule] on_drop: Response data: ${JSON.stringify(data)}`);

                    if (data.ok) {
                        debug_log(`[PlaceModule] on_drop: SUCCESS!`);
                        flash_status([`Dropped item at (${tile_x}, ${tile_y})`], 1500);
                        // Clear drag state
                        drag_state.is_dragging = false;
                        drag_state.item_instance_id = null;
                        drag_state.source_container_id = null;
                        drag_state.item_definition = null;
                        drag_state.source_module = null;
                        return true;
                    } else {
                        debug_log(`[PlaceModule] on_drop: API returned error: ${data.error}`);
                        drag_state.reject_drag();
                        flash_status([`Cannot drop: ${data.error}`], 2000);
                        return false;
                    }
                } catch (err) {
                    debug_log(`[PlaceModule] on_drop: Exception: ${err}`);
                    drag_state.reject_drag();
                    flash_status([`Drop failed: ${err}`], 2000);
                    return false;
                }
            },
        }),

        // System status bar (includes time prefix)
        make_text_window_module({
            id: 'status',
            rect: { x0: L_X0, y0: Y_SYS0, x1: L_X1, y1: Y_SYS1 },
            get_source: () => ui_state.text_windows.get('status') ?? { messages: [], rev: 0 },
            border_rgb: get_color_by_name('medium_gray').rgb,
            text_rgb: get_color_by_name('pale_gray').rgb,
            bg: { char: ' ', rgb: get_color_by_name('off_black').rgb },
            base_weight_index: 3,
        }),

        make_text_window_module({
            id: 'transcript',
            rect: { x0: L_X0, y0: Y_TRANSCRIPT0, x1: L_X1, y1: Y_TRANSCRIPT1 },
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
            rect: { x0: R_X0, y0: Y_PLACE0, x1: R_X1, y1: Y_PLACE1 },
            get_source: () => ui_state.text_windows.get('debug') ?? { messages: [], rev: 0 },
            border_rgb: get_color_by_name('light_gray').rgb,
            text_rgb: get_color_by_name('off_white').rgb,
            bg: { char: ' ', rgb: get_color_by_name('off_black').rgb },
            base_weight_index: 3,
            hint_rgb: get_color_by_name('pale_yellow').rgb,
            npc_rgb: get_color_by_name('pumpkin').rgb,
            state_rgb: get_color_by_name('dark_gray').rgb,
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

        // Debug button: Show Inventory
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
                    const actor_ref = `actor.${APP_CONFIG.input_actor_id}`;
                    console.log('[DEBUG BUTTON] Fetching containers for:', actor_ref);
                    
                    // Get containers
                    const containers_res = await fetch(`http://localhost:8787/api/containers?owner_ref=${actor_ref}`);
                    console.log('[DEBUG BUTTON] Containers response status:', containers_res.status);
                    const containers_data = await containers_res.json();
                    console.log('[DEBUG BUTTON] Containers data:', containers_data);
                    
                    if (!containers_data.ok) {
                        console.log('[DEBUG BUTTON] Failed to load containers:', containers_data.error);
                        flash_status(['Failed to load containers'], 1500);
                        return;
                    }
                    
                    // Get sack contents
                    const sack = containers_data.containers.find((c: any) => c.id.includes('sack'));
                    console.log('[DEBUG BUTTON] Found sack:', sack?.id);
                    if (sack) {
                        console.log('[DEBUG BUTTON] Fetching sack contents:', sack.id);
                        const container_res = await fetch(`http://localhost:8787/api/container?id=${sack.id}`);
                        console.log('[DEBUG BUTTON] Container response status:', container_res.status);
                        const container_data = await container_res.json();
                        console.log('[DEBUG BUTTON] Container data:', container_data);
                        
                        if (container_data.ok && container_data.contents) {
                            const items = container_data.contents.map((c: any) => 
                                `${c.instance.qty}x ${c.definition?.name || c.instance.def_id}`
                            );
                            console.log('[DEBUG BUTTON] Inventory items:', items);
                            flash_status(['Inventory:', ...items.slice(0, 5)], 3000);
                        } else {
                            console.log('[DEBUG BUTTON] Sack is empty or error');
                            flash_status(['Inventory: (empty)'], 1500);
                        }
                    } else {
                        console.log('[DEBUG BUTTON] No sack found in containers');
                        flash_status(['No sack found'], 1500);
                    }
                } catch (err) {
                    console.error('[DEBUG BUTTON] Error:', err);
                    flash_status(['Error: Could not load inventory'], 1500);
                }
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
            rect: { x0: 160, y0: 2, x1: 198, y1: 17 },
            get_actor_name: () => APP_CONFIG.input_actor_id.split('_')[0] || 'Actor',
            get_actor_id: () => APP_CONFIG.input_actor_id,
            get_body_slots: () => ui_state.character.body_slots,
            get_equipped_items: () => ui_state.character.equipped_items,
            get_weight_data: () => ui_state.character.weight,
            get_is_visible: () => ui_state.character.is_visible,
            on_slot_click: (slot_name: string) => {
                console.log(`[Character] Clicked body slot: ${slot_name}`);
            },
            on_slot_hover: (slot_name: string | null, equipped_item: { instance: ItemInstance; definition: ItemDefinition } | null) => {
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
                    debug_log(`[Character] Hovered slot ${slot_name} - highlighting ${compatible_items.length} compatible items`);
                } else {
                    ui_state.character.highlighted_items = [];
                }
            },
            on_drag_start: (slot_name: string, item: ItemInstance, definition: ItemDefinition, container_id: string) => {
                // Validate drag using centralized drag_state.can_drag()
                const validation = drag_state.can_drag(item.id, definition);
                if (!validation.can) {
                    flash_status([validation.reason!], 1500);
                    console.log(`[Character] Drag rejected: ${validation.reason}`);
                    return;
                }
                
                // Store in shared drag state
                drag_state.start_drag('character', item.id, container_id, definition);
                // Highlight compatible slots
                const compatible = get_compatible_slots(definition);
                ui_state.character.highlighted_slots = compatible;
                console.log(`[Character] Drag started - highlighting slots:`, compatible);
            },
            on_drag_move: (x: number, y: number) => {
                drag_state.update_position(x, y);
            },
            on_drop: async (slot_name: string): Promise<boolean> => {
                // Check if there's an active drag
                if (!drag_state.is_dragging) return false;
                
                // Determine target container based on slot name
                const actor_id = APP_CONFIG.input_actor_id;
                const slot_to_container: Record<string, string> = {
                    'hand_left': `container.${actor_id}.hand_left`,
                    'hand_right': `container.${actor_id}.hand_right`,
                    'head': `container.${actor_id}.head`,
                    'torso': `container.${actor_id}.torso`,
                    'leg_left': `container.${actor_id}.leg_left`,
                    'leg_right': `container.${actor_id}.leg_right`,
                };
                const target_container_id = slot_to_container[slot_name];
                
                if (!target_container_id) {
                    drag_state.end_drag();
                    return false;
                }
                
                // Handle drag from container (inventory) to character slot
                if (drag_state.source_module === 'container') {
                    // Validate body slot compatibility before attempting transfer
                    const item_def = drag_state.item_definition;
                    if (item_def?.valid_body_slots && !item_def.valid_body_slots.includes(slot_name)) {
                        flash_status([`${item_def.name} cannot be equipped to ${slot_name}`], 1500);
                        drag_state.reject_drag();
                        return false;
                    }
                    
                    try {
                        const transfer_res = await fetch('http://localhost:8787/api/transfer', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                item_instance_id: drag_state.item_instance_id,
                                from_container: drag_state.source_container_id,
                                to_container: target_container_id,
                            }),
                        });

                        const transfer_data = await transfer_res.json();

                        if (transfer_data.ok) {
                            flash_status([`${drag_state.item_definition?.name} equipped to ${slot_name}`], 1500);
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
                    try {
                        const transfer_res = await fetch('http://localhost:8787/api/transfer', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                item_instance_id: drag_state.item_instance_id,
                                from_container: drag_state.source_container_id,
                                to_container: target_container_id,
                            }),
                        });

                        const transfer_data = await transfer_res.json();

                        if (transfer_data.ok) {
                            flash_status([`${drag_state.item_definition?.name} moved to ${slot_name}`], 1500);
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
            get_highlighted_slots: () => ui_state.character.highlighted_slots,
            render_drag_ghost: (c: any) => drag_state.render_drag_ghost(c),
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
                        const transfer_res = await fetch('http://localhost:8787/api/transfer', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                item_instance_id: drag_state.item_instance_id,
                                from_container: drag_state.source_container_id,
                                to_container: container.id,
                                target_grid_x,
                                target_grid_y,
                            }),
                        });

                        const transfer_data = await transfer_res.json();

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
            // Player character module: can move but cannot close
            gizmos: {
                enabled: ['move'],
                can_close: false,
                can_move: true,
                can_save_position: false,
                on_move_start: () => {
                    debug_log('[CharacterModule] Move mode started');
                },
                on_move: (new_rect) => {
                    ui_state.modules.positions.set('character_module', new_rect);
                    debug_log(`[CharacterModule] Moving to (${new_rect.x0},${new_rect.y0})`);
                },
                on_move_end: (final_rect) => {
                    ui_state.modules.positions.set('character_module', final_rect);
                    flash_status([`Character panel moved`], 1000);
                },
            },
            // Container sidebar: Show equipped containers only
            get_equipped_containers: () => {
                const actor_id = APP_CONFIG.input_actor_id;
                const equipped = ui_state.character.equipped_items;
                const containers: Array<{
                    slot_name: string;
                    item_instance: ItemInstance;
                    item_definition: ItemDefinition;
                    container_id: string;
                }> = [];
                
                // Filter equipped items to only container types
                for (const [slot_name, item_data] of equipped.entries()) {
                    if (is_container_item(item_data.definition)) {
                        // Check if item has container_data (nested container)
                        const container_id = item_data.instance.container_data
                            ? `item.${item_data.instance.id}`  // Nested container
                            : `container.${actor_id}.${slot_name}`;  // Legacy body slot
                        
                        debug_log(`[get_equipped_containers] Slot: ${slot_name}, Item: ${item_data.definition.name}, Container ID: ${container_id}, Has container_data: ${!!item_data.instance.container_data}`);
                        
                        containers.push({
                            slot_name,
                            item_instance: item_data.instance,
                            item_definition: item_data.definition,
                            container_id,
                        });
                    }
                }
                
                return containers;
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
            on_drag_move: (x: number, y: number) => {
                drag_state.update_position(x, y);
            },
            on_slot_hover: (slot_index: number, item: ItemInstance, definition: ItemDefinition | null) => {
                if (definition) {
                    // Find compatible slots and highlight them
                    const compatible = get_compatible_slots(definition);
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
            render_drag_ghost: (c: any) => drag_state.render_drag_ghost(c),
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

                // Check if dropping onto a slot with a container item
                const container_data = ui_state.container.container_data_map.get(container.id);
                const contents = container_data?.contents || [];
                const target_item = contents[slot_index];
                
                let target_container_id = container.id;
                let target_name = 'inventory';
                
                if (target_item?.instance?.container_data) {
                    // Prevent depositing a container into itself
                    if (drag_state.item_instance_id === target_item.instance.id) {
                        flash_status(['Cannot deposit a container into itself'], 1500);
                        console.log(`[Inventory] Rejected: cannot deposit container into itself`);
                        drag_state.reject_drag();
                        return false;
                    }
                    
                    // Dropping onto a container item - deposit into it
                    target_container_id = `item.${target_item.instance.id}`;
                    target_name = target_item.definition?.name || 'container';
                    console.log(`[Inventory] Depositing into container: ${target_container_id}`);
                }

                console.log(`[Inventory] Transferring ${drag_state.item_definition?.name} to ${target_container_id}`);

                try {
                    const transfer_res = await fetch('http://localhost:8787/api/transfer', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            item_instance_id: drag_state.item_instance_id,
                            from_container: drag_state.source_container_id,
                            to_container: target_container_id,
                        }),
                    });

                    const transfer_data = await transfer_res.json();

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

                    // Check if this slot is compatible with the item
                    const compatible_slots = get_compatible_slots(drag_state.item_definition!);
                    if (!compatible_slots.includes(target_slot_name)) {
                        console.log(`[Inventory] ${target_slot_name} is not compatible with ${drag_state.item_definition?.name}`);
                        flash_status([`${drag_state.item_definition?.name} cannot be equipped to ${target_slot_name}`], 1500);
                        drag_state.end_drag();
                        return false;
                    }

                    // Determine target container based on slot
                    const actor_id = APP_CONFIG.input_actor_id;
                    
                    // Map slot names to container IDs (all lowercase_snake_case)
                    // Format: container.{actor_id}.{slot} (NOT container.actor.{actor_id}.{slot})
                    const slot_to_container: Record<string, string> = {
                        'hand_left': `container.${actor_id}.hand_left`,
                        'hand_right': `container.${actor_id}.hand_right`,
                        'head': `container.${actor_id}.head`,
                        'torso': `container.${actor_id}.torso`,
                        'leg_left': `container.${actor_id}.leg_left`,
                        'leg_right': `container.${actor_id}.leg_right`,
                    };

                    const target_container_id = slot_to_container[target_slot_name];
                    if (!target_container_id) {
                        console.log(`[Inventory] Slot ${target_slot_name} not recognized`);
                        drag_state.end_drag();
                        return false;
                    }

                    console.log(`[Inventory] Transferring ${drag_state.item_definition?.name} to ${target_container_id}`);

                    try {
                        const transfer_res = await fetch('http://localhost:8787/api/transfer', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                item_instance_id: drag_state.item_instance_id,
                                from_container: drag_state.source_container_id,
                                to_container: target_container_id,
                            }),
                        });

                        const transfer_data = await transfer_res.json();

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
                enabled: ['close', 'move'],
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
                debug_log(`[GlobalKeyHandler] Key pressed: ${e.key}`);
                if (e.key === 'i' || e.key === 'I') {
                    debug_log('[GlobalKeyHandler] I key detected, handling...');
                    e.preventDefault();
                    e.stopPropagation();
                    
                    // Find and open main inventory
                    void (async () => {
                        debug_log('[GlobalKeyHandler] Looking for main inventory...');
                        const main_inventory = await get_main_inventory_container();
                        debug_log(`[GlobalKeyHandler] Main inventory result: ${main_inventory ? 'FOUND' : 'NOT FOUND'}`);
                        
                        if (main_inventory) {
                            debug_log(`[GlobalKeyHandler] Container ID: ${main_inventory.container_id}`);
                            // Check if already open
                            if (ui_state.container.open_containers.has(main_inventory.container_id)) {
                                debug_log('[GlobalKeyHandler] Container already open, closing...');
                                // Close it
                                close_container_module(main_inventory.container_id);
                                flash_status(['Inventory closed'], 800);
                            } else {
                                debug_log('[GlobalKeyHandler] Opening container...');
                                // Open it
                                await open_container_module(main_inventory.container_id, 'inventory');
                                debug_log('[GlobalKeyHandler] Container opened successfully');
                            }
                        } else {
                            debug_log('[GlobalKeyHandler] No main inventory found!');
                            flash_status(['No inventory equipped'], 1500);
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
    
    // Set initial positions for static modules (needed for NPC module positioning)
    ui_state.modules.positions.set('character_module', { x0: 160, y0: 2, x1: 198, y1: 17 });
    ui_state.modules.positions.set('inventory_container', { x0: 160, y0: 18, x1: 198, y1: 35 });

    register_window_feed({
        window_id: 'transcript',
        fetch_messages: () => fetch_log_messages(APP_CONFIG.selected_data_slot),
    });

    register_window_feed({
        window_id: 'status',
        fetch_messages: () => fetch_status_line(APP_CONFIG.selected_data_slot),
    });

    // Seed debug window
    set_text_window_messages('debug', ['[debug] off | H:off B:on V:off', '[volume] NORMAL', '[move] WALK', '', '[region] (loading...)', 'Targets will appear here.']);

    // Initialize NPC movement system
    init_npc_movement((updated_place: Place) => {
        // Update the current place data so the renderer shows NPC movement
        if (ui_state.place.current_place && ui_state.place.current_place.id === updated_place.id) {
            ui_state.place.current_place = updated_place;
            // Keep movement active since we're updating from movement system
            ui_state.place.npc_movement_active = true;
        }
    });

    // Phase 8: Unified Movement Authority
    // Start listening for movement commands from NPC_AI backend
    const stop_command_handler = start_movement_command_handler(100);

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
            const slot = APP_CONFIG.selected_data_slot;
            const containers_res = await fetch(`http://localhost:8787/api/containers?owner_ref=npc.${npc_id}&slot=${slot}`);
            if (!containers_res.ok) return equipped;
            
            const containers_data = await containers_res.json();
            if (!containers_data.ok || !containers_data.containers) return equipped;
            
            // Load equipped items from body slot containers
            for (const container of containers_data.containers) {
                const slot_name = container.id.split('.').pop();
                if (!slot_name) continue;
                
                const container_res = await fetch(`http://localhost:8787/api/container?id=${container.id}`);
                if (!container_res.ok) continue;
                
                const container_data = await container_res.json();
                if (container_data.ok && container_data.contents && container_data.contents.length > 0) {
                    const item = container_data.contents[0];
                    if (item.instance && item.definition) {
                        equipped.set(slot_name, { instance: item.instance, definition: item.definition });
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
            const slot = APP_CONFIG.selected_data_slot;
            const containers_res = await fetch(`http://localhost:8787/api/containers?owner_ref=npc.${npc_id}&slot=${slot}`);
            if (!containers_res.ok) return { current: 0, max: 100 };
            
            const containers_data = await containers_res.json();
            if (!containers_data.ok || !containers_data.containers) return { current: 0, max: 100 };
            
            let total_weight = 0;
            for (const container of containers_data.containers) {
                const container_res = await fetch(`http://localhost:8787/api/container?id=${container.id}`);
                if (!container_res.ok) continue;
                
                const container_data = await container_res.json();
                if (container_data.ok && container_data.contents) {
                    for (const item of container_data.contents) {
                        if (item.instance && item.definition) {
                            total_weight += (item.definition.weight || 0) * (item.instance.qty || 1);
                        }
                    }
                }
            }
            
            return { current: total_weight, max: 100 };
        } catch (err) {
            debug_log(`[NPC Module] Error calculating weight for ${npc_id}:`, err);
            return { current: 0, max: 100 };
        }
    }

    /**
     * Phase 7: Open a container in a new ContainerModule instance
     * 
     * Supports both regular containers (container.actor.henry.sack) and 
     * nested containers (item.inst_xxx) for items with container_data.
     */
    async function open_container_module(container_id: string, source_name?: string): Promise<void> {
        debug_log(`[ContainerOpener] Opening container: ${container_id}`);
        
        // Check if already open
        if (ui_state.container.open_containers.has(container_id)) {
            flash_status([`Container already open`], 800);
            return;
        }
        
        // Check if currently being opened (prevents double-clicks)
        if (ui_state.container.opening_containers.has(container_id)) {
            debug_log(`[ContainerOpener] Container ${container_id} is already being opened, ignoring click`);
            return;
        }
        
        // Mark as opening (acquire lock)
        ui_state.container.opening_containers.add(container_id);
        
        try {
            let container: any;
            let container_data: any;
            
            // Check if this is a nested container (item.inst_xxx format)
            if (container_id.startsWith('item.')) {
                // Nested container - extract item instance ID
                const item_instance_id = container_id.slice(5); // Remove 'item.' prefix
                debug_log(`[ContainerOpener] Opening nested container for item: ${item_instance_id}`);
                
                // Find the item in the current actor's containers
                const actor_id = APP_CONFIG.input_actor_id;
                if (!actor_id) {
                    flash_status([`No actor selected`], 1500);
                    return;
                }
                
                // Fetch actor's containers to find the item
                const slot = APP_CONFIG.selected_data_slot;
                const containers_res = await fetch(`http://localhost:8787/api/containers?owner_ref=actor.${actor_id}&slot=${slot}`);
                if (!containers_res.ok) {
                    flash_status([`Failed to load actor containers`], 1500);
                    return;
                }
                
                const containers_data = await containers_res.json();
                if (!containers_data.ok || !containers_data.containers) {
                    flash_status([`No containers found for actor`], 1500);
                    return;
                }
                
                // Find the item with matching instance ID
                let found_item: any = null;
                // debug_log(`[ContainerOpener] Searching through ${containers_data.containers.length} containers for item ${item_instance_id}`);
                
                for (const container_info of containers_data.containers) {
                    // debug_log(`[ContainerOpener] Checking container: ${container_info.id}`);
                    const container_res = await fetch(`http://localhost:8787/api/container?id=${container_info.id}`);
                    if (!container_res.ok) continue;
                    
                    const container_details = await container_res.json();
                    if (!container_details.ok || !container_details.contents) continue;
                    
                    for (const item of container_details.contents) {
                        if (item.instance?.id === item_instance_id) {
                            found_item = item;
                            break;
                        }
                    }
                    if (found_item) break;
                }
                
                if (!found_item) {
                    debug_log(`[ContainerOpener] ERROR: Item ${item_instance_id} not found in any container!`);
                    flash_status([`Item not found`], 1500);
                    return;
                }
                
                if (!found_item.instance?.container_data) {
                    debug_log(`[ContainerOpener] ERROR: Item ${item_instance_id} has no container_data!`);
                    flash_status([`Item is not a container`], 1500);
                    return;
                }
                
                // Build nested contents while preserving grid coordinates
                const nested_contents = [];
                const raw_contents = found_item.instance.container_data.contents || [];
                const nested_max_slots = found_item.instance.container_data.capacity?.max_slots || raw_contents.length || 10;
                const { cols: nested_cols } = calculate_grid_dimensions(nested_max_slots);
                
                for (let i = 0; i < raw_contents.length; i++) {
                    const entry = raw_contents[i];
                    
                    // Preserve or assign grid coordinates
                    const grid_x = entry.grid_x !== undefined ? entry.grid_x : (i % nested_cols);
                    const grid_y = entry.grid_y !== undefined ? entry.grid_y : Math.floor(i / nested_cols);
                    
                    // Check if entry already has embedded definition (wrapped format)
                    if (entry.definition) {
                        nested_contents.push({
                            instance: entry.instance,
                            definition: entry.definition,
                            grid_x,
                            grid_y
                        });
                    } else {
                        // Fallback: fetch from API
                        try {
                            const def_res = await fetch(`http://localhost:8787/api/item_def?id=${entry.instance.def_id}`);
                            if (def_res.ok) {
                                const def_data = await def_res.json();
                                if (def_data.ok) {
                                    nested_contents.push({
                                        instance: entry.instance,
                                        definition: def_data.definition,
                                        grid_x,
                                        grid_y
                                    });
                                }
                            }
                        } catch (err) {
                            debug_log(`[ContainerOpener] Exception loading def for ${entry.instance.def_id}:`, err);
                        }
                    }
                }
                
                // Use the item's container_data as the container, with properly formatted contents
                container = {
                    id: container_id,
                    kind: 'item',
                    owner_ref: `actor.${actor_id}`,
                    ...found_item.instance.container_data,
                    contents: nested_contents
                };
                container_data = { container, contents: nested_contents };
                
                // Log the grid coordinates
                const with_coords = nested_contents.filter((item: any) => item.grid_x !== undefined && item.grid_y !== undefined).length;
                debug_log(`[ContainerOpener] Opened ${container_id} with ${nested_contents.length} items`);
                debug_log(`[ContainerOpener] Items with grid coords: ${with_coords}/${nested_contents.length}`);
                nested_contents.slice(0, 3).forEach((item: any, idx: number) => {
                    debug_log(`[ContainerOpener] - Item ${idx}: ${item.instance?.def_id}, grid(${item.grid_x},${item.grid_y})`);
                });
            } else {
                // Regular container - fetch from API
                const res = await fetch(`http://localhost:8787/api/container?id=${container_id}`);
                container_data = await res.json();
                
                if (!container_data.ok) {
                    flash_status([`Failed to load container`], 1500);
                    return;
                }
                
                container = container_data.container;
            }
            
            // Generate unique module ID
            const instance_id = `container_module_${Date.now()}`;
            
            // Calculate center-screen position with offset based on open count
            const open_count = ui_state.container.open_containers.size;
            const offset_x = open_count * 3;
            const offset_y = open_count * 2;
            
            const grid_w = APP_CONFIG.grid_width;
            const grid_h = APP_CONFIG.grid_height;
            const module_w = 39;
            const module_h = 18;
            
            const container_rect = {
                x0: Math.floor((grid_w - module_w) / 2) + offset_x,
                y0: Math.floor((grid_h - module_h) / 2) + offset_y,
                x1: Math.floor((grid_w + module_w) / 2) + offset_x,
                y1: Math.floor((grid_h + module_h) / 2) + offset_y
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
                on_drag_move: (x: number, y: number) => {
                    drag_state.update_position(x, y);
                },
                on_slot_hover: (slot_index: number, item: ItemInstance, definition: ItemDefinition | null) => {
                    if (definition) {
                        // Highlight compatible body slots when hovering items
                        const compatible = get_compatible_slots(definition);
                        ui_state.character.highlighted_slots = compatible;
                        ui_state.character.hovered_item = { name: definition.name, source: container_id };
                    } else {
                        ui_state.character.highlighted_slots = [];
                        ui_state.character.hovered_item = null;
                    }
                },
                // Bidirectional highlighting: return items highlighted when hovering body slots
                get_highlighted_items: () => ui_state.character.highlighted_items,
                render_drag_ghost: (c: any) => drag_state.render_drag_ghost(c),
                on_drag_rejected: () => drag_state.reject_drag(),
                on_drop: async (slot_index: number, grid_x?: number, grid_y?: number): Promise<boolean> => {
                    // Handle dropping items into this container
                    debug_log(`[DEBUG-GRID] on_drop called: slot_index=${slot_index}, grid_x=${grid_x}, grid_y=${grid_y}`);
                    debug_log(`[DEBUG-GRID] drag_state: is_dragging=${drag_state.is_dragging}, source_container_id=${drag_state.source_container_id}`);
                    
                    if (!drag_state.is_dragging) {
                        debug_log(`[DEBUG-GRID] Early return: not dragging`);
                        return false;
                    }
                    
                    try {
                        // Read from shared state for consistency
                        const data = ui_state.container.container_data_map.get(container_id);
                        const contents = data?.contents || [];
                        debug_log(`[DEBUG-GRID] Container data loaded: ${contents.length} items`);
                        
                        // Check if the slot being dropped on has an item with container_data
                        const slot_items = contents.map((item: any, idx: number) => ({
                            slot_index: idx,
                            instance: item.instance,
                            definition: item.definition
                        }));
                        const target_slot = slot_items.find((s: any) => s.slot_index === slot_index);
                        
                        // Determine target container
                        let target_container_id = container_id;
                        let target_name = container_id.split('.').pop() || 'container';
                        
                        // Check if dropping onto a container item
                        if (target_slot?.instance?.container_data) {
                            const nested_container_id = `item.${target_slot.instance.id}`;
                            
                            // Prevent depositing a container into itself
                            if (drag_state.item_instance_id === target_slot.instance.id) {
                                flash_status(['Cannot deposit a container into itself'], 1500);
                                debug_log(`[Container] Rejected: cannot deposit container into itself`);
                                drag_state.reject_drag();
                                return false;
                            }
                            
                            // Route into nested container (container item stays in place)
                            target_container_id = nested_container_id;
                            target_name = target_slot.definition?.name || 'nested container';
                            debug_log(`[Container] Dropping into nested container: ${target_container_id}`);
                        }
                        
                        // Build transfer request body
                        const transfer_body: any = {
                            item_instance_id: drag_state.item_instance_id,
                            from_container: drag_state.source_container_id,
                            to_container: target_container_id,
                            from_slot_index: drag_state.source_slot_index,
                            to_slot_index: slot_index,
                        };
                        
                        // Add grid coordinates for ALL transfers (sparse placement)
                        // This ensures items go to the exact slot where the user dropped them
                        debug_log(`[DEBUG-GRID] Checking grid condition: source=${drag_state.source_container_id}, target=${target_container_id}, grid_x=${grid_x}, grid_y=${grid_y}`);
                        if (grid_x !== undefined && grid_y !== undefined) {
                            transfer_body.target_grid_x = grid_x;
                            transfer_body.target_grid_y = grid_y;
                            debug_log(`[DEBUG-GRID] Grid coordinates INCLUDED: (${grid_x}, ${grid_y})`);
                        } else {
                            debug_log(`[DEBUG-GRID] Grid coordinates SKIPPED: grid_x_defined=${grid_x !== undefined}, grid_y_defined=${grid_y !== undefined}`);
                        }
                        
                        debug_log(`[DEBUG-GRID] Request body:`, JSON.stringify(transfer_body, null, 2));
                        
                        const transfer_res = await fetch('http://localhost:8787/api/transfer', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(transfer_body),
                        });
                        
                        const transfer_data = await transfer_res.json();
                        
                        if (transfer_data.ok) {
                            flash_status([`${drag_state.item_definition?.name} moved to ${target_name}`], 1500);
                            drag_state.end_drag();
                            // Refresh both container and character data
                            void refresh_container_data();
                            void refresh_character_data();
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
                    enabled: ['close', 'move'],
                    can_close: true,
                    can_move: true,
                    can_save_position: false,
                    on_close: () => {
                        close_container_module(container_id);
                    },
                    on_move: (new_rect) => {
                        // Position updated via gizmo system
                    }
                },
            });
            
            // Register module
            module_registry.register(container_module);
            ui_state.container.open_containers.add(container_id);
            ui_state.container.container_module_map.set(container_id, instance_id);
            
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
            
            const display_name = source_name || container_id.split('.').pop() || 'container';
            flash_status([`Opened ${display_name}`], 1000);
            debug_log(`[ContainerOpener] Opened ${container_id} as ${instance_id}`);
            
        } catch (err) {
            debug_log(`[ContainerOpener] Error opening container:`, err);
            flash_status([`Failed to open container`], 1500);
        } finally {
            // Release the opening lock
            ui_state.container.opening_containers.delete(container_id);
        }
    }
    
    /**
     * Phase 7: Close a container module
     */
    function close_container_module(container_id: string): void {
        debug_log(`[ContainerOpener] Closing container: ${container_id}`);
        
        // Get the module_id from our tracking map
        const module_id = ui_state.container.container_module_map.get(container_id);
        
        if (module_id) {
            // Unregister the module from the registry
            module_registry.unregister(module_id);
            debug_log(`[ContainerOpener] Unregistered module: ${module_id}`);
        } else {
            debug_log(`[ContainerOpener] Warning: No module found for ${container_id}`);
        }
        
        // Clean up tracking
        ui_state.container.open_containers.delete(container_id);
        ui_state.container.container_module_map.delete(container_id);
        ui_state.container.container_data_map.delete(container_id);
        
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
        const npc_rect = {
            x0: player_rect.x0 - 28 - (open_count * 3),
            y0: player_rect.y0 + (open_count * 2),
            x1: player_rect.x0 - 3 - (open_count * 3),
            y1: player_rect.y1 + (open_count * 2)
        };
        
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
            on_slot_click: (slot_name: string) => {
                debug_log(`[NPC Module] Clicked body slot: ${slot_name}`);
            },
            on_drag_start: (slot_name: string, item: ItemInstance, definition: ItemDefinition, container_id: string) => {
                // Validate drag using centralized drag_state.can_drag()
                const validation = drag_state.can_drag(item.id, definition);
                if (!validation.can) {
                    flash_status([validation.reason!], 1500);
                    debug_log(`[NPC] Drag rejected: ${validation.reason}`);
                    return;
                }
                
                drag_state.start_drag('npc_character', item.id, container_id, definition);
            },
            on_drag_move: (x: number, y: number) => {
                drag_state.update_position(x, y);
            },
            render_drag_ghost: (c: any) => drag_state.render_drag_ghost(c),
            on_drag_rejected: () => drag_state.reject_drag(),
            on_drop: async (slot_name: string): Promise<boolean> => {
                // Handle equipping from player to NPC
                if (!drag_state.is_dragging || drag_state.source_module !== 'container') return false;
                
                const target_container_id = `container.${npc_id}.${slot_name}`;
                
                try {
                        const transfer_res = await fetch('http://localhost:8787/api/transfer', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                item_instance_id: drag_state.item_instance_id,
                                from_container: drag_state.source_container_id,
                                to_container: target_container_id,
                            }),
                        });
                    
                    const transfer_data = await transfer_res.json();
                    
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
                        const transfer_res = await fetch('http://localhost:8787/api/transfer', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                item_instance_id: drag_state.item_instance_id,
                                from_container: drag_state.source_container_id,
                                to_container: container.id,
                            }),
                        });
                        
                        const transfer_data = await transfer_res.json();
                        
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
                },
                on_move_end: (final_rect) => {
                    ui_state.modules.positions.set(module_id, final_rect);
                    flash_status([`${npc_name}'s panel moved`], 1000);
                },
            },
            // Container sidebar: Show equipped containers only
            get_equipped_containers: () => {
                const containers: Array<{
                    slot_name: string;
                    item_instance: ItemInstance;
                    item_definition: ItemDefinition;
                    container_id: string;
                }> = [];
                
                // Filter equipped items to only container types
                for (const [slot_name, item_data] of equipped_items.entries()) {
                    if (is_container_item(item_data.definition)) {
                        // Check if item has container_data (nested container)
                        const container_id = item_data.instance.container_data
                            ? `item.${item_data.instance.id}`  // Nested container
                            : `container.${npc_id}.${slot_name}`;  // Legacy body slot
                        
                        debug_log(`[NPC get_equipped_containers] Slot: ${slot_name}, Item: ${item_data.definition.name}, Container ID: ${container_id}, Has container_data: ${!!item_data.instance.container_data}`);
                        
                        containers.push({
                            slot_name,
                            item_instance: item_data.instance,
                            item_definition: item_data.definition,
                            container_id,
                        });
                    }
                }
                
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
        ui_state.modules.positions.delete(module_id);
        
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
    };
}
