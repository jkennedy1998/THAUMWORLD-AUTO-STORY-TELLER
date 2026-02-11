import { make_fill_module } from '../mono_ui/modules/fill_module.js';
import { make_button_module } from '../mono_ui/modules/button_module.js';
import { make_text_window_module, type TextWindowMessage } from '../mono_ui/modules/window_module.js';
import { make_input_module } from '../mono_ui/modules/input_module.js';
import { make_roller_module } from '../mono_ui/modules/roller_module.js';
import { make_place_module } from '../mono_ui/modules/place_module.js';
import type { Module, Rgb } from '../mono_ui/types.js';
import { handleEntityClick } from '../interface_program/frontend_api.js';
import type { Place } from '../types/place.js';
import { debug_warn, debug_log } from '../shared/debug.js';
import { init_npc_movement, stop_place_movement, is_npc_moving } from '../npc_ai/movement_loop.js';
import { start_movement_command_handler, set_command_handler_place } from '../mono_ui/modules/movement_command_handler.js';
import { get_color_by_name } from '../mono_ui/colors.js';
import { infer_action_verb_hint } from '../shared/intent_hint.js';
import { load_actor, save_actor } from '../actor_storage/store.js';
import { parse_inspect_command } from '../inspection/text_parser.js';
import { inspect_target, format_inspection_result, type InspectionTarget, type InspectorData } from '../inspection/data_service.js';

export const APP_CONFIG = {
    font_family: 'Martian Mono',
    base_font_size_px: 10,
    base_line_height_mult: 1.5,
    base_letter_spacing_mult: 0.08,
    weight_index_to_css: [100, 200, 300, 400, 500, 600, 700, 800] as const,

    grid_width: 160,
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
    };

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
                    // Sync NPC positions from current place to new place data
                    for (const npc of data.place.contents.npcs_present) {
                        const current_npc = current_place.contents.npcs_present.find(n => n.npc_ref === npc.npc_ref);
                        if (current_npc && is_npc_moving(npc.npc_ref)) {
                            // NPC is moving, preserve current position
                            npc.tile_position = { ...current_npc.tile_position };
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

                // Update targets window text
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
                set_text_window_messages('targets', targets_lines);
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

            // Check if this is an inspection command
            const inspect_parse = parse_inspect_command(outgoing);
            
            if (inspect_parse.is_inspect) {
                // Handle inspection locally
                const place = get_current_place();
                if (!place) {
                    flash_status(['Cannot inspect - no place loaded'], 1200);
                    return;
                }
                
                // Get target ref from parsed command or selected target
                let inspect_target_ref = target_ref;
                let inspect_target_type: 'npc' | 'actor' | 'item' | 'tile' = 'tile';
                
                if (inspect_parse.target_name && !inspect_target_ref) {
                    // Check if it's a tile-related word
                    const tile_words = ['floor', 'ground', 'wall', 'terrain', 'tile', 'surface'];
                    const is_tile_inspection = tile_words.some(word => 
                        inspect_parse.target_name?.toLowerCase().includes(word)
                    );
                    
                    if (is_tile_inspection) {
                        // For tile inspections, use the place's terrain type as the tile reference
                        const terrain = place.environment?.terrain;
                        if (terrain) {
                            inspect_target_ref = terrain;
                            inspect_target_type = 'tile';
                        }
                    } else {
                        // Try to resolve target name from available targets (NPCs/Actors)
                        const target = ui_state.controls.targets.find(t => 
                            t.label.toLowerCase().includes(inspect_parse.target_name!.toLowerCase()) ||
                            t.ref.toLowerCase().includes(inspect_parse.target_name!.toLowerCase())
                        );
                        if (target) {
                            inspect_target_ref = target.ref;
                            inspect_target_type = target.type === 'npc' ? 'npc' : 'actor';
                        }
                    }
                }
                
                // Validate we have a target to inspect
                if (!inspect_target_ref) {
                    flash_status(['Cannot inspect - no matching target found'], 1200);
                    return;
                }
                
                // Load actor data for inspector info
                const actor_result = load_actor(APP_CONFIG.selected_data_slot, APP_CONFIG.input_actor_id);
                if (!actor_result.ok || !actor_result.actor) {
                    flash_status(['Cannot inspect - actor data not found'], 1200);
                    return;
                }
                
                const actor = actor_result.actor as Record<string, any>;
                const actor_location = actor.location as Record<string, any>;
                
                // Build inspector data
                const inspector: InspectorData = {
                    ref: `actor.${APP_CONFIG.input_actor_id}`,
                    location: {
                        world_x: actor_location?.world_tile?.x ?? 0,
                        world_y: actor_location?.world_tile?.y ?? 0,
                        region_x: actor_location?.region_tile?.x ?? 0,
                        region_y: actor_location?.region_tile?.y ?? 0,
                        x: actor_location?.x ?? 0,
                        y: actor_location?.y ?? 0
                    },
                    senses: {
                        light: (actor.senses?.light as number) ?? 0,
                        pressure: (actor.senses?.pressure as number) ?? 0,
                        aroma: (actor.senses?.aroma as number) ?? 0,
                        thaumic: (actor.senses?.thaumic as number) ?? 0
                    },
                    stats: (actor.stats as Record<string, number>) ?? {},
                    profs: (actor.profs as Record<string, number>) ?? {}
                };
                
                // Build inspection target
                let target_type: InspectionTarget['type'];
                if (inspect_target_type === 'npc') {
                    target_type = 'npc';
                } else if (inspect_target_type === 'actor') {
                    target_type = 'character';
                } else if (inspect_target_type === ('item' as string)) {
                    target_type = 'item';
                } else {
                    target_type = 'tile';
                }
                
                const inspection_target: InspectionTarget = {
                    type: target_type,
                    ref: inspect_target_ref || '',
                    place_id: place.id,
                    tile_position: { x: inspector.location.x ?? 0, y: inspector.location.y ?? 0 }
                };
                
                // Get target location
                let target_location = inspector.location;
                
                // Show status that we're inspecting
                const target_desc = inspect_target_ref ? inspect_target_ref.split('.').pop() :
                                   inspect_target_type === 'tile' ? 'tile' : 'area';
                flash_status([`Inspecting ${target_desc}...`], 1200);
                
                try {
                    // Perform inspection
                    const inspection_result = await inspect_target(
                        inspector,
                        inspection_target,
                        {
                            requested_keywords: inspect_parse.feature_keywords,
                            max_features: 5,
                            target_location,
                            target_size_mag: 0
                        }
                    );
                    
                    // Format and display result
                    const formatted_result = format_inspection_result(inspection_result);
                    
                    // Add to text window - split by lines and add each as separate message
                    const result_lines = formatted_result.split('\n').filter(line => line.trim().length > 0);
                    const current_messages = ui_state.text_windows.get('log')?.messages ?? [];
                    
                    // Add header
                    const new_messages: (string | TextWindowMessage)[] = [
                        ...current_messages,
                        `[Inspection Result - ${target_desc}]`
                    ];
                    
                    // Add each line of the result
                    for (const line of result_lines) {
                        new_messages.push(line);
                    }
                    
                    // Add separator
                    new_messages.push('---');
                    
                    set_text_window_messages('log', new_messages);
                    
                    // Update status
                    flash_status([`Inspected ${target_desc}: ${inspection_result.clarity} clarity`], 2000);
                } catch (err) {
                    debug_warn('[app_state]', 'Inspection failed:', err);
                    flash_status(['Inspection failed - check console'], 2000);
                }
                
                return;
            }

            // Warn once if there is no intent hint and no override.
            // Show warning briefly BEFORE sending, then return to normal status.
            const hint = infer_action_verb_hint(outgoing);
            if (!ui_state.controls.override_intent && !hint.verb) {
                flash_status(['your message does not contain an action type hint'], 900);
                await new Promise((r) => setTimeout(r, 900));
            }

            const res = await fetch(APP_CONFIG.interpreter_endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: outgoing,
                    sender: APP_CONFIG.input_actor_id,
                    intent_verb: ui_state.controls.override_intent ?? undefined,
                    action_cost: ui_state.controls.override_cost ?? undefined,
                    target_ref: target_ref ?? undefined,
                }),
            });

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }

            const data = (await res.json()) as { ok: boolean; id?: string };
            if (data.ok) {
                void poll_window_feeds();
            }

            // Return status line to neutral
            flash_status(['waiting for actor response'], 900);
        } catch (err) {
            debug_warn('[mono_ui] failed to send to interpreter', err);
            append_text_window_message('log', '[system] failed to reach interpreter');
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

    // Limit message count to prevent old session data from cluttering the UI
    // Take only the most recent 50 messages (approximately 1-2 conversations)
    const MAX_MESSAGES = 50;
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

    // Filter out messages older than 30 minutes to prevent old session data from showing
    const CUTOFF_TIME = Date.now() - (30 * 60 * 1000); // 30 minutes ago
    
    const filtered = sorted.filter((m: { id: string; sender: string; content: string; type?: string; correlation_id?: string; status?: string; stage?: string; meta?: Record<string, unknown> }) => {
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
        
        // Allow NPC messages through (removed aggressive content-based dedup)
        // ID-based dedup above is sufficient to prevent true duplicates
        if (sender.startsWith('npc.')) return true;
        
        if (sender === 'j') return true;
        if (sender === 'renderer_ai') {
            const correlation = m.correlation_id ?? 'none';
            const last = last_renderer_text_by_correlation.get(correlation);
            last_renderer_text_by_correlation.set(correlation, content);
            if (last !== undefined && last === content) return false;
            return true;
        }
        if (sender === 'hint') return true;
        if (m.type === 'user_input') return true;
        if (sender === 'state_applier') return true;
        return false;
    });

    // Debug logging for message filtering
    const npcMessages = filtered.filter(m => (m.sender ?? '').toLowerCase().startsWith('npc.'));
    console.log(`[fetch_log_messages] API returned ${data.messages.length} messages, after filtering: ${filtered.length} total, ${npcMessages.length} NPC`);
    
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
        if (sender === 'state_applier') return false;
        return true;
    });
    if (filteredOut.length > 0) {
        console.log(`[fetch_log_messages] Filtered out ${filteredOut.length} messages from:`, [...new Set(filteredOut.map(m => m.sender))]);
    }

    const from_log = filtered.map((m: { sender: string; content: string }): string | TextWindowMessage => {
        const sender = (m.sender ?? '').toLowerCase();
        if (sender === 'hint') {
            return { content: `💡 ${m.content}`, sender: 'hint' };
        }
        if (sender === 'renderer_ai') return { content: `ASSISTANT: ${m.content}`, sender: 'assistant' };
        if (sender === 'j') return { content: `J: ${m.content}`, sender: 'user' };
        if (sender.startsWith('npc.')) {
            const npcName = sender.replace('npc.', '').toUpperCase();
            return { content: `${npcName}: ${m.content}`, sender: 'npc' };
        }
        if (sender === 'state_applier') {
            return { content: `[STATE] ${m.content}`, sender: 'state' };
        }
        return { content: `${m.sender}: ${m.content}`, sender: 'system' };
    });
    
    return from_log;
}

    async function fetch_status_line(slot: number): Promise<string[]> {
        // Client-side temporary status override
        if (ui_state.status_override.until_ms > Date.now() && ui_state.status_override.lines.length > 0) {
            return [...ui_state.status_override.lines];
        }
        const res = await fetch(`${APP_CONFIG.interpreter_status_endpoint}?slot=${slot}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = (await res.json()) as { ok: boolean; status?: { line?: string } };
        if (!data.ok || !data.status?.line) return [""];
        return [data.status.line];
    }

    (window as any).THAUM_UI = {
        set_text_window_messages,
        append_text_window_message,
    };

    set_text_window_messages('log', [
        'This is a text window. It wraps words onto new lines.',
        'If a word is tooooooooolongtobefitononeline it will hyphenate-and-continue.',
        'Scroll with the mouse wheel if there is more text.',
        'Scroll with the mouse wheel if there is more text.',
        'Scroll with the mouse wheel if there is more text.',
        'Scroll with the mouse wheel if there is more text.',
        'Scroll with the mouse wheel if there is more text.',
        'Scroll with the mouse wheel if there is more text.',
        'Scroll with the mouse wheel if there is more text.',
        'Scroll with the mouse wheel if there is more text.',
        'hey! :3',
    ]);

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
            rect: { x0: 120, y0: 1, x1: 158, y1: 48 },
            get_place: get_current_place,
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
                // Handle inspection from place module (right-click)
                const place = get_current_place();
                
                if (!place) {
                    flash_status(['No place loaded'], 1200);
                    return;
                }
                
                // Load actor data for inspector info
                const actor_result = load_actor(APP_CONFIG.selected_data_slot, APP_CONFIG.input_actor_id);
                if (!actor_result.ok || !actor_result.actor) {
                    flash_status(['Cannot inspect - actor data not found'], 1200);
                    return;
                }
                
                const actor = actor_result.actor as Record<string, any>;
                const actor_location = actor.location as Record<string, any>;
                
                // Build inspector data
                const inspector: InspectorData = {
                    ref: `actor.${APP_CONFIG.input_actor_id}`,
                    location: {
                        world_x: actor_location?.world_tile?.x ?? 0,
                        world_y: actor_location?.world_tile?.y ?? 0,
                        region_x: actor_location?.region_tile?.x ?? 0,
                        region_y: actor_location?.region_tile?.y ?? 0,
                        x: actor_location?.x ?? 0,
                        y: actor_location?.y ?? 0
                    },
                    senses: {
                        light: (actor.senses?.light as number) ?? 0,
                        pressure: (actor.senses?.pressure as number) ?? 0,
                        aroma: (actor.senses?.aroma as number) ?? 0,
                        thaumic: (actor.senses?.thaumic as number) ?? 0
                    },
                    stats: (actor.stats as Record<string, number>) ?? {},
                    profs: (actor.profs as Record<string, number>) ?? {}
                };
                
                // For tile inspections from right-click, get the terrain type from place
                let target_ref = target.ref;
                if (target.type === 'tile' && !target_ref) {
                    target_ref = place.environment?.terrain || '';
                }
                
                // Validate we have a target ref
                if (!target_ref) {
                    flash_status(['Cannot inspect - unknown target type'], 1200);
                    return;
                }
                
                // Convert to InspectionTarget format
                const inspection_target: InspectionTarget = {
                    type: target.type === 'npc' ? 'npc' : 
                          target.type === 'actor' ? 'character' : 
                          target.type === 'item' ? 'item' : 'tile',
                    ref: target_ref,
                    place_id: place.id,
                    tile_position: target.tile_position
                };
                
                // Build target location (for tile inspection, use the tile position)
                let target_location = inspector.location;
                if (inspection_target.type === 'tile') {
                    target_location = {
                        ...inspector.location,
                        x: target.tile_position.x,
                        y: target.tile_position.y
                    };
                }
                
                // Show status that we're inspecting
                const target_desc = target.ref ? target.ref.split('.').pop() : 'tile';
                flash_status([`Inspecting ${target_desc}...`], 1200);
                
                try {
                    // Perform inspection
                    const inspection_result = await inspect_target(
                        inspector,
                        inspection_target,
                        {
                            max_features: 5,
                            target_location,
                            target_size_mag: 0
                        }
                    );
                    
                    // Format and display result
                    const formatted_result = format_inspection_result(inspection_result);
                    
                    // Add to text window - split by lines and add each as separate message
                    const result_lines = formatted_result.split('\n').filter(line => line.trim().length > 0);
                    const current_messages = ui_state.text_windows.get('log')?.messages ?? [];
                    
                    // Add header
                    const new_messages: (string | TextWindowMessage)[] = [
                        ...current_messages,
                        `[Inspection Result - ${target_desc}]`
                    ];
                    
                    // Add each line of the result
                    for (const line of result_lines) {
                        new_messages.push(line);
                    }
                    
                    // Add separator
                    new_messages.push('---');
                    
                    set_text_window_messages('log', new_messages);
                    
                    // Show status
                    flash_status([`Inspected ${target_desc}: ${inspection_result.clarity} clarity`], 2000);
                } catch (err) {
                    debug_warn('[app_state]', 'Inspection failed:', err);
                    flash_status(['Inspection failed - check console'], 2000);
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

        make_text_window_module({
            id: 'log',
            rect: { x0: 1, y0: 13, x1: 86, y1: 36 },
            get_source: () => ui_state.text_windows.get('log') ?? { messages: [], rev: 0 },
            border_rgb: get_color_by_name('light_gray').rgb,
            text_rgb: get_color_by_name('off_white').rgb,
            bg: { char: ' ', rgb: get_color_by_name('off_black').rgb },
            base_weight_index: 3,
            hint_rgb: get_color_by_name('pale_yellow').rgb,
            npc_rgb: get_color_by_name('pumpkin').rgb,
            state_rgb: get_color_by_name('dark_gray').rgb,
        }),

        make_text_window_module({
            id: 'status',
            rect: { x0: 1, y0: 38, x1: 86, y1: 42 },
            get_source: () => ui_state.text_windows.get('status') ?? { messages: [], rev: 0 },
            border_rgb: get_color_by_name('medium_gray').rgb,
            text_rgb: get_color_by_name('pale_gray').rgb,
            bg: { char: ' ', rgb: get_color_by_name('off_black').rgb },
            base_weight_index: 3,
        }),

        make_input_module({
            id: 'input',
            rect: { x0: 1, y0: 1, x1: 86, y1: 11 },
            target_id: 'log',
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
                    const lines: string[] = [];
                    lines.push(`[suggested] ${ui_state.controls.suggested_intent ?? '(none)'}`);
                    if (ui_state.controls.suggested_matched) lines.push(`[matched] ${ui_state.controls.suggested_matched}`);
                    lines.push(`[override intent] ${ui_state.controls.override_intent ?? '(none)'}`);
                    lines.push(`[override cost] ${ui_state.controls.override_cost ?? '(none)'}`);
                    set_text_window_messages('controls', lines);
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
            rect: { x0: 88, y0: 1, x1: 100, y1: 3 },
            label: 'send',
            rgb: get_color_by_name('pale_orange').rgb,
            bg: { char: '-', rgb: get_color_by_name('dark_gray').rgb },
            OnPress() {
                input_submit?.();
            },
        }),

        // Controls window
        make_text_window_module({
            id: 'controls',
            rect: { x0: 88, y0: 4, x1: 118, y1: 11 },
            get_source: () => ui_state.text_windows.get('controls') ?? { messages: [], rev: 0 },
            border_rgb: get_color_by_name('medium_gray').rgb,
            text_rgb: get_color_by_name('pale_gray').rgb,
            bg: { char: ' ', rgb: get_color_by_name('off_black').rgb },
            base_weight_index: 3,
        }),

        // Targets window
        make_text_window_module({
            id: 'targets',
            rect: { x0: 88, y0: 20, x1: 118, y1: 36 },
            get_source: () => ui_state.text_windows.get('targets') ?? { messages: [], rev: 0 },
            border_rgb: get_color_by_name('light_gray').rgb,
            text_rgb: get_color_by_name('off_white').rgb,
            bg: { char: ' ', rgb: get_color_by_name('off_black').rgb },
            base_weight_index: 3,
        }),

        // Action cost buttons
        make_button_module({
            id: 'cost_free',
            rect: { x0: 102, y0: 1, x1: 106, y1: 3 },
            label: 'FREE',
            rgb: get_color_by_name('pale_orange').rgb,
            bg: { char: '.', rgb: get_color_by_name('dark_gray').rgb },
            OnPress() { ui_state.controls.override_cost = 'FREE'; flash_status(['action cost: FREE'], 800); },
        }),
        make_button_module({
            id: 'cost_part',
            rect: { x0: 107, y0: 1, x1: 112, y1: 3 },
            label: 'PART',
            rgb: get_color_by_name('pale_orange').rgb,
            bg: { char: '.', rgb: get_color_by_name('dark_gray').rgb },
            OnPress() { ui_state.controls.override_cost = 'PARTIAL'; flash_status(['action cost: PARTIAL'], 800); },
        }),
        make_button_module({
            id: 'cost_full',
            rect: { x0: 113, y0: 1, x1: 118, y1: 3 },
            label: 'FULL',
            rgb: get_color_by_name('pale_orange').rgb,
            bg: { char: '.', rgb: get_color_by_name('dark_gray').rgb },
            OnPress() { ui_state.controls.override_cost = 'FULL'; flash_status(['action cost: FULL'], 800); },
        }),
        make_button_module({
            id: 'cost_ext',
            rect: { x0: 113, y0: 4, x1: 118, y1: 6 },
            label: 'EXT',
            rgb: get_color_by_name('pale_orange').rgb,
            bg: { char: '.', rgb: get_color_by_name('dark_gray').rgb },
            OnPress() { ui_state.controls.override_cost = 'EXTENDED'; flash_status(['action cost: EXTENDED'], 800); },
        }),

        // Action intent buttons - Updated for Action Pipeline
        // Only showing actions currently implemented in the Action Pipeline:
        // - USE (handles all tool-based actions including attacks)
        // - COMMUNICATE (talking to NPCs)
        // - MOVE (movement)
        // - INSPECT (looking at things)
        make_button_module({ id: 'verb_use', rect: { x0: 88, y0: 7, x1: 96, y1: 9 }, label: 'USE', rgb: WHITE, get_rgb: () => (ui_state.controls.override_intent === 'USE' ? get_color_by_name('pale_yellow').rgb : (ui_state.controls.suggested_intent === 'USE' ? get_color_by_name('pale_gray').rgb : get_color_by_name('dark_gray').rgb)), bg: { char: '-', rgb: get_color_by_name('off_black').rgb }, OnPress() { ui_state.controls.override_intent = 'USE'; flash_status(['intent: USE (attack/talk/move with tool)'], 800); } }),
        make_button_module({ id: 'verb_com', rect: { x0: 97, y0: 7, x1: 105, y1: 9 }, label: 'TALK', rgb: WHITE, get_rgb: () => (ui_state.controls.override_intent === 'COMMUNICATE' ? get_color_by_name('pale_yellow').rgb : (ui_state.controls.suggested_intent === 'COMMUNICATE' ? get_color_by_name('pale_gray').rgb : get_color_by_name('dark_gray').rgb)), bg: { char: '-', rgb: get_color_by_name('off_black').rgb }, OnPress() { ui_state.controls.override_intent = 'COMMUNICATE'; flash_status(['intent: COMMUNICATE'], 800); } }),
        make_button_module({ id: 'verb_mov', rect: { x0: 106, y0: 7, x1: 113, y1: 9 }, label: 'MOVE', rgb: WHITE, get_rgb: () => (ui_state.controls.override_intent === 'MOVE' ? get_color_by_name('pale_yellow').rgb : (ui_state.controls.suggested_intent === 'MOVE' ? get_color_by_name('pale_gray').rgb : get_color_by_name('dark_gray').rgb)), bg: { char: '-', rgb: get_color_by_name('off_black').rgb }, OnPress() { ui_state.controls.override_intent = 'MOVE'; flash_status(['intent: MOVE'], 800); } }),
        make_button_module({ id: 'verb_ins', rect: { x0: 114, y0: 7, x1: 118, y1: 9 }, label: 'LOOK', rgb: WHITE, get_rgb: () => (ui_state.controls.override_intent === 'INSPECT' ? get_color_by_name('pale_yellow').rgb : (ui_state.controls.suggested_intent === 'INSPECT' ? get_color_by_name('pale_gray').rgb : get_color_by_name('dark_gray').rgb)), bg: { char: '-', rgb: get_color_by_name('off_black').rgb }, OnPress() { ui_state.controls.override_intent = 'INSPECT'; flash_status(['intent: INSPECT'], 800); } }),
        make_button_module({ id: 'verb_clear', rect: { x0: 88, y0: 10, x1: 99, y1: 12 }, label: 'CLEAR', rgb: get_color_by_name('pale_yellow').rgb, bg: { char: '.', rgb: get_color_by_name('dark_gray').rgb }, OnPress() { ui_state.controls.override_intent = null; ui_state.controls.override_cost = null; flash_status(['overrides cleared'], 800); } }),

        make_roller_module({
            id: 'roller',
            rect: { x0: 88, y0: 38, x1: 118, y1: 42 },
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
    ];

    register_window_feed({
        window_id: 'log',
        fetch_messages: () => fetch_log_messages(APP_CONFIG.selected_data_slot),
    });

    register_window_feed({
        window_id: 'status',
        fetch_messages: () => fetch_status_line(APP_CONFIG.selected_data_slot),
    });

    // Seed controls + targets windows
    set_text_window_messages('controls', ['[suggested] (none)', '[override intent] (none)', '[override cost] (none)']);
    set_text_window_messages('targets', ['[region] (loading...)', 'Targets will appear here.']);

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

    return {
        modules,
        start_window_feed_polling,
    };
}
