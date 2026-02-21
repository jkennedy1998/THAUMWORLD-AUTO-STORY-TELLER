import { make_fill_module } from '../mono_ui/modules/fill_module.js';
import { make_button_module } from '../mono_ui/modules/button_module.js';
import { make_text_window_module, type TextWindowMessage } from '../mono_ui/modules/window_module.js';
import { make_input_module } from '../mono_ui/modules/input_module.js';
import { make_roller_module } from '../mono_ui/modules/roller_module.js';
import { make_place_module } from '../mono_ui/modules/place_module.js';
import { make_container_module, type SlotItem } from '../mono_ui/modules/container_module.js';
import { make_character_module } from '../mono_ui/modules/character_module.js';
import type { Module, Rgb } from '../mono_ui/types.js';
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
import { list_item_instances_in_container, type ItemInstance } from '../item_instances/store.js';
import { type ItemDefinition } from '../item_storage/store.js';
import { type BodySlots } from '../types/body_slots.js';
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
    modules: Module[];
    start_window_feed_polling: (interval_ms: number) => void;
};

type WindowFeed = {
    window_id: string;
    fetch_messages: () => Promise<(string | TextWindowMessage)[]>;
};

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
        },
        character: {
            is_visible: true,  // Always visible for now
            body_slots: {} as BodySlots,
            equipped_items: new Map() as Map<string, { instance: ItemInstance; definition: ItemDefinition }>,
            weight: { current: 0, max: 100 },
            highlighted_slots: [] as string[],  // Slots highlighted when hovering compatible items
            hovered_item: null as { name: string; source: string } | null,  // Currently hovered item for debug display
        },
    };

    // Shared drag state for cross-module drag-and-drop
    const drag_state = {
        is_dragging: false,
        source_module: null as string | null,
        item_instance_id: null as string | null,
        source_container_id: null as string | null,
        item_definition: null as ItemDefinition | null,

        start_drag(source: string, item_id: string, container_id: string, def: ItemDefinition) {
            this.is_dragging = true;
            this.source_module = source;
            this.item_instance_id = item_id;
            this.source_container_id = container_id;
            this.item_definition = def;
            debug_log(`[DragState] Started drag: ${def.name} from ${source}`);
        },

        end_drag() {
            this.is_dragging = false;
            this.source_module = null;
            this.item_instance_id = null;
            this.source_container_id = null;
            this.item_definition = null;
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

    // Load character data (body slots, equipped items, weight)
    async function refresh_character_data(): Promise<void> {
        try {
            const actor_id = APP_CONFIG.input_actor_id;
            const slot = APP_CONFIG.selected_data_slot;
            
            console.log(`[Character] Refreshing data for actor: ${actor_id}`);
            
            // Load actor via API (NOT via load_actor which requires Node.js fs)
            const actor_res = await fetch(`http://localhost:8787/api/actor?id=${actor_id}&slot=${slot}`);
            if (!actor_res.ok) {
                console.log('[Character] Failed to load actor:', actor_id, 'status:', actor_res.status);
                return;
            }
            
            const actor_data = await actor_res.json();
            if (!actor_data.ok || !actor_data.actor) {
                console.log('[Character] API returned error:', actor_data.error);
                return;
            }
            
            const actor = actor_data.actor;
            console.log(`[Character] Loaded actor: ${actor.id}, kind: ${actor.kind}`);
            
            // Get body slots from actor
            const body_slots = (actor.body_slots as BodySlots) || {};
            console.log(`[Character] Actor has ${Object.keys(body_slots).length} body slots:`, Object.keys(body_slots));
            
            if (Object.keys(body_slots).length === 0) {
                console.log(`[Character] WARNING: Actor has no body slots!`);
            }
            
            ui_state.character.body_slots = body_slots;
            
            // Calculate weight from all actor's items
            console.log(`[Character] Calculating weight from containers...`);
            const containers_res = await fetch(`http://localhost:8787/api/containers?owner_ref=actor.${actor_id}&slot=${slot}`);
            if (containers_res.ok) {
                const containers_data = await containers_res.json();
                console.log(`[Character] Found ${containers_data.containers?.length || 0} containers`);
                
                if (containers_data.ok && containers_data.containers) {
                    let total_weight = 0;
                    let item_count = 0;
                    
                    for (const container of containers_data.containers) {
                        console.log(`[Character] Checking container: ${container.id}`);
                        const container_res = await fetch(`http://localhost:8787/api/container?id=${container.id}&slot=${slot}`);
                        if (container_res.ok) {
                            const container_data = await container_res.json();
                            if (container_data.ok && container_data.contents) {
                                console.log(`[Character] Container has ${container_data.contents.length} items`);
                                for (const content of container_data.contents) {
                                    if (content.instance && content.definition) {
                                        const item_weight = (content.definition.weight || 0);
                                        const qty = (content.instance.qty || 1);
                                        const item_total = item_weight * qty;
                                        console.log(`[Character] Item: ${content.definition.name}, weight: ${item_weight}, qty: ${qty}, total: ${item_total}`);
                                        total_weight += item_total;
                                        item_count++;
                                    } else {
                                        console.log(`[Character] Skipping item - missing instance or definition`);
                                    }
                                }
                            }
                        }
                    }
                    
                    ui_state.character.weight.current = total_weight;
                    // Calculate max weight from actor stats (or default)
                    const strength = (actor.stats as Record<string, number>)?.str || 50;
                    ui_state.character.weight.max = strength * 2.5;
                    
                    console.log(`[Character] Weight calculation complete: ${item_count} items, total: ${total_weight}g`);
                }
            } else {
                console.log(`[Character] Failed to fetch containers:`, containers_res.status);
            }
            
            // Load equipped items from body slot containers
            console.log(`[Character] Loading equipped items from body slot containers...`);
            const equipped_items = new Map<string, { instance: ItemInstance; definition: ItemDefinition }>();
            
            // Define body slot container IDs
            const body_slot_containers = [
                'head', 'torso', 'hand_left', 'hand_right', 'leg_left', 'leg_right'
            ];
            
            for (const slot_name of body_slot_containers) {
                const container_id = `container.${actor_id}.${slot_name}`;
                console.log(`[Character] Checking body slot container: ${container_id}`);
                
                const container_res = await fetch(`http://localhost:8787/api/container?id=${container_id}&slot=${slot}`);
                if (container_res.ok) {
                    const container_data = await container_res.json();
                    if (container_data.ok && container_data.contents && container_data.contents.length > 0) {
                        // Body slot containers only hold 1 item
                        const content = container_data.contents[0];
                        if (content.instance && content.definition) {
                            equipped_items.set(slot_name, {
                                instance: content.instance,
                                definition: content.definition
                            });
                            console.log(`[Character] Equipped in ${slot_name}: ${content.definition.name}`);
                        }
                    } else {
                        console.log(`[Character] Body slot ${slot_name} is empty`);
                    }
                } else {
                    console.log(`[Character] Failed to load body slot container: ${container_id}`);
                }
            }
            
            ui_state.character.equipped_items = equipped_items;
            console.log(`[Character] Loaded ${equipped_items.size} equipped items`);
            
            console.log(`[Character] Final state: ${Object.keys(body_slots).length} slots, weight: ${ui_state.character.weight.current}/${ui_state.character.weight.max}`);
            
        } catch (err) {
            console.error('[Character] Error refreshing character data:', err);
        }
    }

    // Load container data for the player's sack
    async function refresh_container_data(): Promise<void> {
        try {
            const actor_id = APP_CONFIG.input_actor_id;
            const slot = APP_CONFIG.selected_data_slot;
            
            // Fetch containers for this actor
            const containers_res = await fetch(`http://localhost:8787/api/containers?owner_ref=actor.${actor_id}&slot=${slot}`);
            if (!containers_res.ok) {
                console.log('[Container] Failed to fetch containers');
                return;
            }
            
            const containers_data = await containers_res.json();
            if (!containers_data.ok) {
                console.log('[Container] API returned error:', containers_data.error);
                return;
            }
            
            // Find the sack container
            const sack = containers_data.containers?.find((c: any) => c.id.includes('sack'));
            if (!sack) {
                console.log('[Container] No sack container found');
                return;
            }
            
            // Fetch full container details with items
            const container_res = await fetch(`http://localhost:8787/api/container?id=${sack.id}&slot=${slot}`);
            if (!container_res.ok) {
                console.log('[Container] Failed to fetch container details');
                return;
            }
            
            const container_data = await container_res.json();
            if (!container_data.ok) {
                console.log('[Container] API returned error for container:', container_data.error);
                return;
            }
            
            // Update container state
            // Ensure grid_dimensions exists (for legacy containers without the new field)
            if (!container_data.container.grid_dimensions) {
                const slot_count = container_data.container.capacity?.max_slots || 10;
                const cols = Math.ceil(Math.sqrt(slot_count));
                const rows = Math.ceil(slot_count / cols);
                container_data.container.grid_dimensions = { cols, rows };
                console.log(`[Container] Calculated grid: ${cols}x${rows} for ${slot_count} slots`);
            }
            ui_state.container.current_container = container_data.container;
            
            // Build slot items array
            const slot_items: SlotItem[] = [];
            const contents = container_data.contents || [];
            const total_slots = (container_data.container.grid_dimensions?.cols || 3) * (container_data.container.grid_dimensions?.rows || 2);
            
            console.log(`[Container] Container has ${total_slots} total slots`);
            console.log(`[Container] API returned ${contents.length} items`);
            
            // Map contents to slots (items fill slots in order)
            for (let i = 0; i < total_slots; i++) {
                const content = contents[i];
                if (content && content.instance) {
                    // API returns item definition in 'definition' field (not 'item')
                    let item_def = content.definition;
                    
                    // Log what we received
                    if (item_def) {
                        console.log(`[Container] Slot ${i}: Received def for ${item_def.name}, display_char: ${item_def.display_char || 'MISSING'}`);
                    } else {
                        console.log(`[Container] Slot ${i}: No definition received for ${content.instance.def_id}`);
                    }
                    
                    slot_items.push({
                        slot_index: i,
                        instance: content.instance,
                        definition: item_def || null,
                    });
                    console.log(`[Container] Slot ${i}: ${item_def?.name || 'unnamed'} (${content.instance.qty}x) char: ${item_def?.display_char || '?'}`);
                } else {
                    slot_items.push({
                        slot_index: i,
                        instance: null,
                        definition: null,
                    });
                }
            }
            
            ui_state.container.slot_items = slot_items;
            console.log(`[Container] Updated UI with ${slot_items.filter(s => s.instance).length} items`);
            
        } catch (err) {
            console.error('[Container] Error refreshing container data:', err);
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

        // Debug button: List Containers
        make_button_module({
            id: 'debug_list_containers',
            rect: { x0: DEBUG_X0 + 48, y0: DEBUG_Y_TOP, x1: DEBUG_X1 + 48, y1: DEBUG_Y_TOP + 1 },
            label: 'CNTRS',
            rgb: get_color_by_name('vivid_cyan').rgb,
            bg: { char: '*', rgb: get_color_by_name('dark_gray').rgb },
            base_weight_index: 3,
            async OnPress() {
                console.log('[DEBUG BUTTON] CNTRS button pressed');
                try {
                    console.log('[DEBUG BUTTON] Fetching containers...');
                    const res = await fetch(`http://localhost:8787/api/containers?owner_ref=actor.${APP_CONFIG.input_actor_id}`);
                    console.log('[DEBUG BUTTON] Response status:', res.status);
                    const data = await res.json();
                    console.log('[DEBUG BUTTON] Containers data:', data);
                    
                    if (data.ok && data.containers) {
                        const container_names = data.containers.map((c: any) => {
                            const name = c.id.split('.').pop();
                            return `${name}(${c.contents.length})`;
                        });
                        console.log('[DEBUG BUTTON] Container list:', container_names);
                        flash_status(['Containers:', ...container_names], 3000);
                    } else {
                        console.log('[DEBUG BUTTON] No containers found or error');
                        flash_status(['No containers found'], 1500);
                    }
                } catch (err) {
                    console.error('[DEBUG BUTTON] Error:', err);
                    flash_status(['Error: Could not list containers'], 1500);
                }
            },
        }),

        // Debug button: Show Ground Items
        make_button_module({
            id: 'debug_ground_items',
            rect: { x0: DEBUG_X0 + 60, y0: DEBUG_Y_TOP, x1: DEBUG_X1 + 60, y1: DEBUG_Y_TOP + 1 },
            label: 'GRND',
            rgb: get_color_by_name('pale_purple').rgb,
            bg: { char: '*', rgb: get_color_by_name('dark_gray').rgb },
            base_weight_index: 3,
            async OnPress() {
                console.log('[DEBUG BUTTON] GRND button pressed');
                try {
                    // Get current place from UI state
                    const current_place = ui_state.place.current_place;
                    console.log('[DEBUG BUTTON] Current place:', current_place?.id);
                    if (!current_place) {
                        console.log('[DEBUG BUTTON] Not in a place');
                        flash_status(['Not in a place'], 1500);
                        return;
                    }
                    
                    const place_id = current_place.id;
                    console.log('[DEBUG BUTTON] Fetching ground items for:', place_id);
                    const res = await fetch(`http://localhost:8787/api/place/ground_items?place_id=${place_id}`);
                    console.log('[DEBUG BUTTON] Response status:', res.status);
                    const data = await res.json();
                    console.log('[DEBUG BUTTON] Ground items data:', data);
                    
                    if (data.ok && data.items && data.items.length > 0) {
                        const item_names = data.items.map((item: any) => 
                            `${item.qty}x ${item.name}`
                        );
                        console.log('[DEBUG BUTTON] Ground items found:', item_names);
                        flash_status(['Ground items:', ...item_names], 3000);
                    } else {
                        console.log('[DEBUG BUTTON] No items on ground');
                        flash_status(['No items on ground'], 1500);
                    }
                } catch (err) {
                    console.error('[DEBUG BUTTON] Error:', err);
                    flash_status(['Error: Could not check ground'], 1500);
                }
            },
        }),

        // Debug button: Pick Up Ground Item
        make_button_module({
            id: 'debug_pickup_item',
            rect: { x0: DEBUG_X0 + 72, y0: DEBUG_Y_TOP, x1: DEBUG_X1 + 72, y1: DEBUG_Y_TOP + 1 },
            label: 'PICKUP',
            rgb: get_color_by_name('vivid_green').rgb,
            bg: { char: '*', rgb: get_color_by_name('dark_gray').rgb },
            base_weight_index: 3,
            async OnPress() {
                console.log('[DEBUG BUTTON] PICKUP button pressed');
                try {
                    // Get current place
                    const current_place = ui_state.place.current_place;
                    console.log('[DEBUG BUTTON] Current place:', current_place?.id);
                    if (!current_place) {
                        console.log('[DEBUG BUTTON] Not in a place');
                        flash_status(['Not in a place'], 1500);
                        return;
                    }
                    
                    const place_id = current_place.id;
                    
                    // Get ground items first
                    console.log('[DEBUG BUTTON] Fetching ground items...');
                    const ground_res = await fetch(`http://localhost:8787/api/place/ground_items?place_id=${place_id}`);
                    const ground_data = await ground_res.json();
                    console.log('[DEBUG BUTTON] Ground items:', ground_data);
                    
                    if (!ground_data.ok || !ground_data.items || ground_data.items.length === 0) {
                        console.log('[DEBUG BUTTON] Nothing to pick up');
                        flash_status(['Nothing to pick up'], 1500);
                        return;
                    }
                    
                    // Get actor's current position for distance calculation
                    const current_actor_pickup = current_place?.contents?.actors_present?.find(
                        (a: any) => a.actor_ref === `actor.${APP_CONFIG.input_actor_id}`
                    );
                    const actor_position_pickup = current_actor_pickup?.tile_position;
                    
                    // Sort items by distance to actor (closest first)
                    const items_with_distance = ground_data.items.map((item: any) => {
                        const dx = item.tile_position.x - (actor_position_pickup?.x ?? 0);
                        const dy = item.tile_position.y - (actor_position_pickup?.y ?? 0);
                        const distance = Math.sqrt(dx * dx + dy * dy);
                        return { item, distance };
                    });
                    items_with_distance.sort((a: any, b: any) => a.distance - b.distance);
                    
                    // Pick up closest item
                    const item = items_with_distance[0].item;
                    const distance = items_with_distance[0].distance;
                    console.log('[DEBUG BUTTON] Picking up closest item:', item.instance_id, item.name, `distance: ${distance.toFixed(1)} tiles`);
                    console.log('[DEBUG BUTTON] Actor position for pickup:', actor_position_pickup);
                    
                    console.log('[DEBUG BUTTON] Calling pickup API...');
                    const pickup_res = await fetch('http://localhost:8787/api/place/pickup', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            item_instance_id: item.instance_id,
                            place_id: place_id,
                            actor_id: APP_CONFIG.input_actor_id,
                            actor_position: actor_position_pickup
                        })
                    });
                    
                    const pickup_data = await pickup_res.json();
                    console.log('[DEBUG BUTTON] Pickup response:', pickup_data);
                    
                    if (pickup_data.ok) {
                        console.log('[DEBUG BUTTON] Pickup successful, refreshing place...');
                        flash_status([`✓ Picked up ${item.qty}x ${item.name}`], 1500);
                        
                        // Debug: Log items before refresh
                        const place_before = ui_state.place.current_place;
                        console.log('[DEBUG BUTTON] Items before refresh:', place_before?.contents?.items_on_ground?.length || 0);
                        
                        // Force refresh place data to remove picked up item immediately
                        await update_current_place(place_id);
                        
                        // Debug: Log items after refresh
                        const place_after = ui_state.place.current_place;
                        console.log('[DEBUG BUTTON] Items after refresh:', place_after?.contents?.items_on_ground?.length || 0);
                        console.log('[DEBUG BUTTON] Place refreshed');
                        
                        // Force render update by nudging the view slightly
                        // This triggers the place module to redraw with new data
                        setTimeout(() => {
                            const event = new KeyboardEvent('keydown', { key: 'ArrowRight' });
                            window.dispatchEvent(event);
                            setTimeout(() => {
                                const event2 = new KeyboardEvent('keydown', { key: 'ArrowLeft' });
                                window.dispatchEvent(event2);
                            }, 50);
                        }, 100);
                    } else if (pickup_data.error === 'too_far_away') {
                        const distance = pickup_data.distance ? pickup_data.distance.toFixed(1) : '?';
                        const actor_pos = pickup_data.actor_pos ? `(${pickup_data.actor_pos.x},${pickup_data.actor_pos.y})` : 'unknown';
                        const item_pos = item.tile_position ? `(${item.tile_position.x},${item.tile_position.y})` : 'unknown';
                        console.log(`[DEBUG BUTTON] Pickup failed: too far away - Actor at ${actor_pos}, Item at ${item_pos}, Distance: ${distance} tiles`);
                        flash_status([
                            `✗ Too far away (${distance} tiles)`,
                            `You: ${actor_pos} → Item: ${item_pos}`
                        ], 2500);
                    } else if (pickup_data.error === 'position_mismatch') {
                        console.log(`[DEBUG BUTTON] Pickup failed: position mismatch - Storage: ${pickup_data.storage_pos}, Place: ${pickup_data.place_pos}`);
                        flash_status([
                            '✗ Position sync error',
                            `Storage: ${pickup_data.storage_pos}`,
                            `Place: ${pickup_data.place_pos}`
                        ], 3000);
                    } else {
                        console.log('[DEBUG BUTTON] Pickup failed:', pickup_data.error);
                        flash_status(['✗ Failed: ' + (pickup_data.error || 'unknown')], 2000);
                    }
                } catch (err) {
                    console.error('[DEBUG BUTTON] Error:', err);
                    flash_status(['Error: Could not pick up item'], 1500);
                }
            },
        }),

        // Debug button: Drop Item (move first sack item to ground)
        make_button_module({
            id: 'debug_drop_item',
            rect: { x0: DEBUG_X0 + 84, y0: DEBUG_Y_TOP, x1: DEBUG_X1 + 84, y1: DEBUG_Y_TOP + 1 },
            label: 'DROP',
            rgb: get_color_by_name('light_red').rgb,
            bg: { char: '*', rgb: get_color_by_name('dark_gray').rgb },
            base_weight_index: 3,
            async OnPress() {
                console.log('[DEBUG BUTTON] DROP button pressed');
                try {
                    // Get current place
                    const current_place = ui_state.place.current_place;
                    console.log('[DEBUG BUTTON] Current place:', current_place?.id);
                    if (!current_place) {
                        console.log('[DEBUG BUTTON] Not in a place');
                        flash_status(['Not in a place'], 1500);
                        return;
                    }
                    
                    const place_id = current_place.id;
                    
                    // Get actor's containers
                    console.log('[DEBUG BUTTON] Fetching containers...');
                    const containers_res = await fetch(`http://localhost:8787/api/containers?owner_ref=actor.${APP_CONFIG.input_actor_id}`);
                    const containers_data = await containers_res.json();
                    console.log('[DEBUG BUTTON] Containers data:', containers_data);
                    
                    if (!containers_data.ok) {
                        console.log('[DEBUG BUTTON] Failed to load containers');
                        flash_status(['Failed to load containers'], 1500);
                        return;
                    }
                    
                    const sack = containers_data.containers.find((c: any) => c.id.includes('sack'));
                    console.log('[DEBUG BUTTON] Found sack:', sack?.id);
                    
                    if (!sack) {
                        console.log('[DEBUG BUTTON] No sack found');
                        flash_status(['No sack found'], 1500);
                        return;
                    }
                    
                    // Get sack contents
                    console.log('[DEBUG BUTTON] Fetching sack contents...');
                    const container_res = await fetch(`http://localhost:8787/api/container?id=${sack.id}`);
                    const container_data = await container_res.json();
                    console.log('[DEBUG BUTTON] Sack contents:', container_data);
                    
                    if (!container_data.ok || !container_data.contents || container_data.contents.length === 0) {
                        console.log('[DEBUG BUTTON] Sack is empty');
                        flash_status(['Sack is empty'], 1500);
                        return;
                    }
                    
                    // Drop first item
                    const first_item = container_data.contents[0].instance;
                    const item_name = container_data.contents[0].definition?.name || first_item.def_id;
                    console.log('[DEBUG BUTTON] Dropping item:', first_item.id, item_name);
                    
                    // Get actor's current position for the drop location
                    const current_actor = current_place?.contents?.actors_present?.find(
                        (a: any) => a.actor_ref === `actor.${APP_CONFIG.input_actor_id}`
                    );
                    const actor_position = current_actor?.tile_position ?? { x: 20, y: 20 };
                    console.log('[DEBUG BUTTON] Actor position for drop:', actor_position);
                    
                    console.log('[DEBUG BUTTON] Calling drop API...');
                    const drop_res = await fetch('http://localhost:8787/api/place/drop', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            item_instance_id: first_item.id,
                            place_id: place_id,
                            actor_id: APP_CONFIG.input_actor_id,
                            tile_position: actor_position
                        })
                    });
                    
                    const drop_data = await drop_res.json();
                    console.log('[DEBUG BUTTON] Drop response:', drop_data);
                    
                    if (drop_data.ok) {
                        console.log('[DEBUG BUTTON] Drop successful, refreshing place...');
                        flash_status([`Dropped ${first_item.qty}x ${item_name}`], 1500);
                        
                        // Debug: Log items before refresh
                        const place_before = ui_state.place.current_place;
                        console.log('[DEBUG BUTTON] Items before refresh:', place_before?.contents?.items_on_ground?.length || 0);
                        
                        // Force refresh place data to show dropped item immediately
                        await update_current_place(place_id);
                        
                        // Debug: Log items after refresh
                        const place_after = ui_state.place.current_place;
                        console.log('[DEBUG BUTTON] Items after refresh:', place_after?.contents?.items_on_ground?.length || 0);
                        console.log('[DEBUG BUTTON] Place refreshed');
                        
                        // Force render update by nudging the view slightly
                        setTimeout(() => {
                            const event = new KeyboardEvent('keydown', { key: 'ArrowRight' });
                            window.dispatchEvent(event);
                            setTimeout(() => {
                                const event2 = new KeyboardEvent('keydown', { key: 'ArrowLeft' });
                                window.dispatchEvent(event2);
                            }, 50);
                        }, 100);
                    } else {
                        console.log('[DEBUG BUTTON] Drop failed:', drop_data.error);
                        flash_status(['Failed to drop: ' + (drop_data.error || 'unknown')], 1500);
                    }
                } catch (err) {
                    console.error('[DEBUG BUTTON] Error:', err);
                    flash_status(['Error: Could not drop item'], 1500);
                }
            },
        }),

        // Debug button: TEST ALL - Automated system verification
        make_button_module({
            id: 'debug_test_all',
            rect: { x0: DEBUG_X0 + 96, y0: DEBUG_Y_TOP, x1: DEBUG_X1 + 96, y1: DEBUG_Y_TOP + 1 },
            label: 'TEST',
            rgb: get_color_by_name('off_white').rgb,
            bg: { char: '*', rgb: get_color_by_name('vivid_red').rgb },
            base_weight_index: 3,
            async OnPress() {
                console.log('[DEBUG BUTTON] TEST button pressed - Starting automated test suite');
                const results: string[] = ['=== ITEM SYSTEM TEST ==='];
                let passed = 0;
                let failed = 0;
                
                try {
                    // Test 1: List containers
                    results.push('[1/6] Containers...');
                    console.log('[DEBUG BUTTON TEST] Testing containers API...');
                    const containers_res = await fetch(`http://localhost:8787/api/containers?owner_ref=actor.${APP_CONFIG.input_actor_id}`);
                    console.log('[DEBUG BUTTON TEST] Containers response status:', containers_res.status);
                    const containers_data = await containers_res.json();
                    console.log('[DEBUG BUTTON TEST] Containers data:', containers_data);
                    if (containers_data.ok && containers_data.containers?.length > 0) {
                        results.push(`✓ ${containers_data.containers.length} containers found`);
                        passed++;
                    } else {
                        results.push('✗ No containers');
                        failed++;
                    }
                    
                    // Test 2: Check inventory
                    results.push('[2/6] Inventory...');
                    console.log('[DEBUG BUTTON TEST] Testing inventory...');
                    const sack = containers_data.containers?.find((c: any) => c.id.includes('sack'));
                    console.log('[DEBUG BUTTON TEST] Found sack:', sack?.id);
                    if (sack) {
                        const container_res = await fetch(`http://localhost:8787/api/container?id=${sack.id}`);
                        const container_data = await container_res.json();
                        console.log('[DEBUG BUTTON TEST] Sack contents:', container_data);
                        if (container_data.ok) {
                            results.push(`✓ Sack has ${container_data.contents?.length || 0} items`);
                            passed++;
                        } else {
                            results.push('✗ Cannot read sack');
                            failed++;
                        }
                    } else {
                        results.push('✗ No sack found');
                        failed++;
                    }
                    
                    // Test 3: Ground items
                    results.push('[3/6] Ground items...');
                    console.log('[DEBUG BUTTON TEST] Testing ground items...');
                    const current_place = ui_state.place.current_place;
                    console.log('[DEBUG BUTTON TEST] Current place:', current_place?.id);
                    if (current_place) {
                        const ground_res = await fetch(`http://localhost:8787/api/place/ground_items?place_id=${current_place.id}`);
                        const ground_data = await ground_res.json();
                        console.log('[DEBUG BUTTON TEST] Ground items:', ground_data);
                        if (ground_data.ok) {
                            results.push(`✓ ${ground_data.items?.length || 0} items on ground`);
                            passed++;
                        } else {
                            results.push('✗ Cannot read ground');
                            failed++;
                        }
                    } else {
                        results.push('⚠ Not in a place');
                    }
                    
                    // Test 4: Place rendering
                    results.push('[4/6] Place data...');
                    console.log('[DEBUG BUTTON TEST] Testing place data...');
                    if (current_place?.contents?.items_on_ground) {
                        const visible_items = current_place.contents.items_on_ground.length;
                        console.log('[DEBUG BUTTON TEST] Items in place data:', visible_items);
                        results.push(`✓ ${visible_items} items in place data`);
                        passed++;
                    } else {
                        console.log('[DEBUG BUTTON TEST] No items_on_ground in place');
                        results.push('✗ No items_on_ground in place');
                        failed++;
                    }
                    
                    // Test 5: API health
                    results.push('[5/6] API health...');
                    console.log('[DEBUG BUTTON TEST] Testing API health...');
                    const health_res = await fetch('http://localhost:8787/api/health');
                    console.log('[DEBUG BUTTON TEST] Health check status:', health_res.status);
                    if (health_res.ok) {
                        results.push('✓ API responding');
                        passed++;
                    } else {
                        results.push('✗ API error');
                        failed++;
                    }
                    
                    // Test 6: Transfer capability
                    results.push('[6/6] Transfer system...');
                    console.log('[DEBUG BUTTON TEST] Checking transfer capability...');
                    if (sack && containers_data.containers?.find((c: any) => c.id.includes('hand'))) {
                        console.log('[DEBUG BUTTON TEST] Transfer possible');
                        results.push('✓ Transfer possible');
                        passed++;
                    } else {
                        console.log('[DEBUG BUTTON TEST] Missing containers for transfer');
                        results.push('✗ Missing containers for transfer');
                        failed++;
                    }
                    
                    // Summary
                    results.push('');
                    results.push(`=== RESULTS: ${passed} passed, ${failed} failed ===`);
                    console.log('[DEBUG BUTTON TEST] Test complete:', passed, 'passed,', failed, 'failed');
                    if (failed === 0) {
                        results.push('✓ ALL TESTS PASSED');
                    } else {
                        results.push('✗ SOME TESTS FAILED');
                    }
                    
                } catch (err: any) {
                    console.error('[DEBUG BUTTON TEST] Error:', err);
                    results.push('');
                    results.push(`✗ ERROR: ${err.message || 'Unknown error'}`);
                    results.push('Is the interface_program running on :8787?');
                }
                
                flash_status(results, 8000);
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
            },
            on_drag_start: (slot_name: string, item: ItemInstance, definition: ItemDefinition, container_id: string) => {
                console.log(`[Character] Drag started on slot ${slot_name}: ${definition.name}`);
                // Store in shared drag state
                drag_state.start_drag('character', item.id, container_id, definition);
            },
            on_drop: async (slot_name: string): Promise<boolean> => {
                console.log(`[Character] on_drop callback called for slot: ${slot_name}`);
                console.log(`[Character] Drag state: is_dragging=${drag_state.is_dragging}, source_module=${drag_state.source_module}`);
                console.log(`[Character] Dragged item: ${drag_state.item_definition?.name} (${drag_state.item_instance_id})`);
                console.log(`[Character] Source container: ${drag_state.source_container_id}`);

                // Check if there's an active drag from container
                if (!drag_state.is_dragging) {
                    console.log(`[Character] No active drag - rejecting`);
                    return false;
                }
                if (drag_state.source_module !== 'container') {
                    console.log(`[Character] Drag source is not container (${drag_state.source_module}) - rejecting`);
                    return false;
                }

                // Determine target container based on slot name
                const actor_id = APP_CONFIG.input_actor_id;
                console.log(`[Character] Actor ID: ${actor_id}`);

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

                const target_container_id = slot_to_container[slot_name];
                console.log(`[Character] Slot ${slot_name} maps to container: ${target_container_id}`);
                
                if (!target_container_id) {
                    console.log(`[Character] Slot ${slot_name} not recognized - rejecting`);
                    drag_state.end_drag();
                    return false;
                }

                console.log(`[Character] Transferring ${drag_state.item_definition?.name} to ${target_container_id}`);

                try {
                    // Call /api/transfer to move the item
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
                        console.log(`[Character] Equip successful: ${drag_state.item_definition?.name} -> ${slot_name}`);
                        flash_status([`${drag_state.item_definition?.name} equipped to ${slot_name}`], 1500);

                        // Refresh container data to show item moved
                        void refresh_container_data();
                        void refresh_character_data();

                        drag_state.end_drag();
                        return true;
                    } else {
                        console.log(`[Character] Equip failed:`, transfer_data.error);
                        flash_status([`Failed to equip: ${transfer_data.error || 'unknown error'}`], 1500);
                        drag_state.end_drag();
                        return false;
                    }
                } catch (err) {
                    console.error(`[Character] Error during equip:`, err);
                    flash_status([`Error equipping item`], 1500);
                    drag_state.end_drag();
                    return false;
                }
            },
            get_highlighted_slots: () => ui_state.character.highlighted_slots,
            on_cross_module_drop: async (x: number, y: number): Promise<boolean> => {
                console.log(`[Character] Cross-module drop callback called at (${x}, ${y})`);
                console.log(`[Character] Drag state: is_dragging=${drag_state.is_dragging}, source_module=${drag_state.source_module}`);
                console.log(`[Character] Dragged item: ${drag_state.item_definition?.name} (${drag_state.item_instance_id})`);
                console.log(`[Character] Source container: ${drag_state.source_container_id}`);

                // Check if there's an active drag from this character module
                if (!drag_state.is_dragging) {
                    console.log(`[Character] No active drag - rejecting`);
                    return false;
                }
                if (drag_state.source_module !== 'character') {
                    console.log(`[Character] Drag source is not character (${drag_state.source_module}) - rejecting`);
                    return false;
                }

                // Check if drop is on container module (inventory)
                // Container module rect: { x0: 160, y0: 18, x1: 198, y1: 35 }
                if (x >= 160 && x <= 198 && y >= 18 && y <= 35) {
                    console.log(`[Character] Drop is on container module - unequipping`);
                    
                    // Get target container (the sack)
                    const container = ui_state.container.current_container;
                    if (!container) {
                        console.log(`[Character] No container loaded - rejecting`);
                        drag_state.end_drag();
                        return false;
                    }

                    console.log(`[Character] Transferring ${drag_state.item_definition?.name} from ${drag_state.source_container_id} to ${container.id}`);

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
                            console.log(`[Character] Unequip successful: ${drag_state.item_definition?.name} -> ${container.id}`);
                            flash_status([`${drag_state.item_definition?.name} unequipped`], 1500);

                            // Refresh data
                            void refresh_container_data();
                            void refresh_character_data();

                            drag_state.end_drag();
                            return true;
                        } else {
                            console.log(`[Character] Unequip failed:`, transfer_data.error);
                            flash_status([`Failed to unequip: ${transfer_data.error || 'unknown error'}`], 1500);
                            drag_state.end_drag();
                            return false;
                        }
                    } catch (err) {
                        console.error(`[Character] Error during unequip:`, err);
                        flash_status([`Error unequipping item`], 1500);
                        drag_state.end_drag();
                        return false;
                    }
                }

                console.log(`[Character] Drop not on container module - rejecting`);
                drag_state.end_drag();
                return false;
            },
            border_rgb: get_color_by_name('light_gray').rgb,
        }),

        // Inventory Container Module - BOTTOM
        // Shows sack contents
        make_container_module({
            id: 'inventory_container',
            rect: { x0: 160, y0: 18, x1: 198, y1: 35 },
            get_container: () => ui_state.container.current_container,
            get_slot_items: () => ui_state.container.slot_items,

            get_is_visible: () => ui_state.container.is_visible,
            set_is_visible: (visible: boolean) => { 
                ui_state.container.is_visible = visible;
                if (visible) {
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
                // Store in shared drag state
                drag_state.start_drag('container', item.id, container_id, definition);
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

                console.log(`[Inventory] Transferring ${drag_state.item_definition?.name} to ${container.id}`);

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
                        console.log(`[Inventory] Unequip successful: ${drag_state.item_definition?.name} -> ${container.id}`);
                        flash_status([`${drag_state.item_definition?.name} unequipped`], 1500);

                        // Refresh data
                        void refresh_container_data();
                        void refresh_character_data();

                        drag_state.end_drag();
                        return true;
                    } else {
                        console.log(`[Inventory] Unequip failed:`, transfer_data.error);
                        flash_status([`Failed to unequip: ${transfer_data.error || 'unknown error'}`], 1500);
                        drag_state.end_drag();
                        return false;
                    }
                } catch (err) {
                    console.error(`[Inventory] Error during unequip:`, err);
                    flash_status([`Error unequipping item`], 1500);
                    drag_state.end_drag();
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
                            drag_state.end_drag();
                            return false;
                        }
                    } catch (err) {
                        console.error(`[Inventory] Error during equip:`, err);
                        flash_status([`Error equipping item`], 1500);
                        drag_state.end_drag();
                        return false;
                    }
                }

                return false;
            },
            border_rgb: get_color_by_name('light_gray').rgb,
            bg_rgb: get_color_by_name('off_black').rgb,
            text_rgb: get_color_by_name('off_white').rgb,
        }),
    ];

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

    return {
        modules,
        start_window_feed_polling,
    };
}
