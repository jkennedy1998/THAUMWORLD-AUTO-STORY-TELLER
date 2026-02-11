import * as readline from "node:readline";
import * as http from "node:http";
import * as fs from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { debug_log, debug_warn, debug_error } from "../shared/debug.js";
import { ollama_chat } from "../shared/ollama_client.js";
import { isCurrentSession, getSessionMeta, SESSION_ID } from "../shared/session.js";
import { SERVICE_CONFIG } from "../shared/constants.js";

import { get_data_slot_dir, get_inbox_path, get_item_dir, get_log_path, get_outbox_path, get_status_path, get_world_dir, get_roller_status_path } from "../engine/paths.js";
import { read_inbox, clear_inbox, ensure_inbox_exists, append_inbox_message, write_inbox } from "../engine/inbox_store.js";
import { ensure_outbox_exists } from "../engine/outbox_store.js";
import { ensure_dir_exists, ensure_log_exists, read_log, append_log_envelope, append_log_message } from "../engine/log_store.js";
import { append_outbox_message } from "../engine/outbox_store.js";
import { create_correlation_id, create_message } from "../engine/message.js";
import { route_message } from "../engine/router.js";
import type { MessageEnvelope } from "../engine/types.js";
import type { LogFile } from "../engine/types.js";
import { ensure_status_exists, read_status, write_status_line } from "../engine/status_store.js";
import { ensure_roller_status_exists, read_roller_status, write_roller_status } from "../engine/roller_status_store.js";
import { ensure_actor_exists, find_actors, load_actor, save_actor, create_actor_from_kind } from "../actor_storage/store.js";
import { create_npc_from_kind, find_npcs, save_npc } from "../npc_storage/store.js";
import { get_timed_event_state, get_region_by_coords, is_timed_event_active } from "../world_storage/store.js";
import { travel_between_places } from "../travel/movement.js";
import { load_npc } from "../npc_storage/store.js";
import { load_place, list_places_in_region, save_place, create_basic_place } from "../place_storage/store.js";
import type { PlaceConnection } from "../types/place.js";
import { get_npc_location } from "../npc_storage/location.js";
import { get_entities_in_place } from "../place_storage/entity_index.js";
import { get_creation_state_path } from "../engine/paths.js";
import { load_kind_definitions } from "../kind_storage/store.js";
import { PROF_NAMES, STAT_VALUE_BLOCK } from "../character_rules/creation.js";
import { 
  initializeActionPipeline, 
  processPlayerAction,
  formatActionResult 
} from "./action_integration.js";
import { createIntent } from "../action_system/intent.js";
import { 
  setActorTarget, 
  clearActorTarget, 
  getActorTarget,
  hasValidTarget 
} from "./target_state.js";
import { 
  setVolume, 
  getVolume, 
  handleCommunicationSubmit 
} from "./communication_input.js";
import type { VolumeLevel } from "./communication_input.js";

const data_slot_number = SERVICE_CONFIG.DEFAULT_DATA_SLOT || 1;
const visual_log_limit = 12;
const HTTP_PORT = 8787;
// const ENABLE_CLI_LOG = false;
const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const INTERPRETER_MODEL = process.env.INTERPRETER_MODEL ?? "llama3.2:latest";
const RENDERER_MODEL = process.env.RENDERER_MODEL ?? "llama3.2:latest";
// gpt-oss:20b is installed; swap back if you want higher quality.
const OLLAMA_BOOT_TIMEOUT_MS = 12_000;
const OLLAMA_WARMUP_TIMEOUT_MS = 600_000;
const OLLAMA_WARMUP_KEEP_ALIVE = "30m";

let current_state: "awaiting_user" | "processing" | "error" = "awaiting_user";
let message_buffer = ""; // message construction buffer
let incoming_message = ""; // received text from other programs (routing)
let ollama_process: ChildProcess | null = null;
let ollama_spawned = false;

// Track active conversations for dynamic facing updates
const active_conversations = new Map<string, {
  npc_ref: string;
  actor_ref: string;
  started_at: number;
  last_facing_update: number;
}>();

const FACING_UPDATE_INTERVAL_MS = 100; // Update facing every 100ms during conversation (more responsive)

/**
 * Start tracking a conversation for dynamic facing
 */
function start_conversation_tracking(npc_ref: string, actor_ref: string): void {
  active_conversations.set(npc_ref, {
    npc_ref,
    actor_ref,
    started_at: Date.now(),
    last_facing_update: 0
  });
}

/**
 * Stop tracking a conversation
 */
function stop_conversation_tracking(npc_ref: string): void {
  active_conversations.delete(npc_ref);
}

/**
 * Update facing for all active conversations
 * Call this periodically (e.g., every tick)
 */
async function update_conversation_facing(): Promise<void> {
  const now = Date.now();
  
  for (const [npc_ref, conv] of active_conversations) {
    // Only update if enough time has passed
    if (now - conv.last_facing_update < FACING_UPDATE_INTERVAL_MS) {
      continue;
    }
    
    // Update last facing time
    conv.last_facing_update = now;
    
    // Send face command to keep NPC facing the actor
    const { send_face_command } = await import("../npc_ai/movement_command_sender.js");
    send_face_command(npc_ref, conv.actor_ref, "Maintain facing during conversation");
  }
}

// other programs/applications can send this program text (a string)
function receive_text_from_other_program(text: string): void {
    incoming_message += text;
}

// flush incoming_message into message_buffer (shell)
function flush_incoming_messages(): void {
    if (!incoming_message) return;
    message_buffer += incoming_message;
    incoming_message = "";
}

// print last N lines of the log in a minimal "visual log" window
function render_visual_log(_log: LogFile, _last_n: number): void {}

function ensure_minimum_game_data(slot: number): void {
    const actors = find_actors(slot, {});
    if (actors.length === 0) {
        const created = ensure_actor_exists(slot, "henry_actor");
        if (created.ok) {
            debug_log("Boot: created default actor", { id: "henry_actor" });
        } else {
            debug_warn("Boot: failed to create default actor", { error: created.error, todo: created.todo });
        }
    }

    const npcs = find_npcs(slot, {}).filter((n) => n.id !== "default_npc");
    if (npcs.length === 0) {
        const actor_id = actors[0]?.id ?? "henry_actor";
        const actor = load_actor(slot, actor_id);
        const actor_location = actor.ok
            ? (actor.actor.location as Record<string, unknown>)
            : { world_tile: { x: 0, y: 0 }, region_tile: { x: 0, y: 0 }, tile: { x: 0, y: 0 } };
        const created = create_npc_from_kind(slot, { name: "stranger" });
        if (created.ok) {
            const npc = { ...created.npc, location: actor_location } as Record<string, unknown>;
            const npc_id = String(npc.id ?? "");
            if (npc_id) save_npc(slot, npc_id, npc);
            debug_log("Boot: created npc", { id: npc_id || "(unknown)" });
        } else {
            debug_warn("Boot: failed to create npc", { error: created.error, todo: created.todo });
        }
    }

    // TODO: add local generation rules for NPCs when actors travel in populated places.
    
    // Ensure Eden Crossroads places exist with proper connections
    ensure_eden_crossroads_places(slot);
}

/**
 * Ensure Eden Crossroads region has places with proper connections
 * This creates a connected hub area for testing
 */
function ensure_eden_crossroads_places(slot: number): void {
    const region_id = "eden_crossroads";
    
    // Define the places in Eden Crossroads
    const places_config = [
        {
            id: "eden_crossroads_square",
            name: "Eden Crossroads Square",
            is_default: true,
            width: 15,
            height: 15,
            description: "A bustling town square at the crossroads of several paths. Merchants hawk their wares while townsfolk gather around the central fountain."
        },
        {
            id: "eden_crossroads_grendas_shop",
            name: "Grenda's General Goods",
            is_default: false,
            width: 10,
            height: 10,
            description: "A cozy shop filled with adventuring supplies, dried meats, and odd trinkets. The smell of leather and herbs fills the air."
        },
        {
            id: "eden_crossroads_tavern",
            name: "The Rusty Anchor Tavern",
            is_default: false,
            width: 12,
            height: 12,
            description: "A lively tavern with weathered wooden beams and the aroma of hearty stew. Sailors and locals share stories over frothy mugs."
        },
        {
            id: "eden_crossroads_temple",
            name: "Temple of the Dawn",
            is_default: false,
            width: 10,
            height: 14,
            description: "A serene temple with stained glass windows casting colorful light. The air is thick with incense and quiet contemplation."
        }
    ];
    
    // Define connections between places
    const connections: Record<string, PlaceConnection[]> = {
        "eden_crossroads_square": [
            {
                target_place_id: "eden_crossroads_grendas_shop",
                direction: "north",
                description: "A wooden door leads to Grenda's shop",
                travel_time_seconds: 3
            },
            {
                target_place_id: "eden_crossroads_tavern",
                direction: "east",
                description: "A swinging door leads to the tavern",
                travel_time_seconds: 3
            },
            {
                target_place_id: "eden_crossroads_temple",
                direction: "west",
                description: "An arched doorway leads to the temple",
                travel_time_seconds: 4
            }
        ],
        "eden_crossroads_grendas_shop": [
            {
                target_place_id: "eden_crossroads_square",
                direction: "south",
                description: "The shop door leads back to the square",
                travel_time_seconds: 3
            }
        ],
        "eden_crossroads_tavern": [
            {
                target_place_id: "eden_crossroads_square",
                direction: "west",
                description: "The tavern door leads back to the square",
                travel_time_seconds: 3
            }
        ],
        "eden_crossroads_temple": [
            {
                target_place_id: "eden_crossroads_square",
                direction: "east",
                description: "The temple exit leads back to the square",
                travel_time_seconds: 4
            }
        ]
    };
    
    // Create places if they don't exist
    for (const config of places_config) {
        const existing = load_place(slot, config.id);
        if (!existing.ok) {
            // Place doesn't exist, create it
            const result = create_basic_place(slot, region_id, config.id, config.name, {
                is_default: config.is_default,
                width: config.width,
                height: config.height
            });
            
            if (result.ok) {
                // Add description
                result.place.description.short = config.name;
                result.place.description.full = config.description;
                
                // Add connections
                const place_connections = connections[config.id];
                if (place_connections) {
                    result.place.connections = place_connections;
                }
                
                save_place(slot, result.place);
                debug_log("Boot: created place", { id: config.id, name: config.name });
            } else {
                debug_warn("Boot: failed to create place", { id: config.id, error: "creation failed" });
            }
        } else {
            // Place exists, check/update connections
            const place = existing.place;
            let needs_save = false;
            
            // Check if connections need to be added or updated
            const config_connections = connections[config.id];
            if (config_connections) {
                // Check if we're missing any expected connections
                const existing_targets = new Set(place.connections.map(c => c.target_place_id));
                const expected_targets = new Set(config_connections.map(c => c.target_place_id));
                
                // Find missing connections
                const missing = config_connections.filter(c => !existing_targets.has(c.target_place_id));
                
                if (missing.length > 0) {
                    // Add missing connections
                    place.connections.push(...missing);
                    needs_save = true;
                    debug_log("Boot: added missing connections to place", { 
                        id: config.id, 
                        added: missing.length,
                        total: place.connections.length 
                    });
                }
            }
            
            if (needs_save) {
                save_place(slot, place);
            }
        }
    }
    
    debug_log("Boot: Eden Crossroads places initialized");
    
    // Ensure NPCs are placed in their locations
    ensure_npcs_in_places(slot);
}

/**
 * Ensure all NPCs are placed in valid locations
 */
function ensure_npcs_in_places(slot: number): void {
    const npcs = find_npcs(slot, {});
    
    for (const npc_data of npcs) {
        const npc_id = npc_data.id;
        const npc_res = load_npc(slot, npc_id);
        
        if (!npc_res.ok) continue;
        
        const npc = npc_res.npc as Record<string, unknown>;
        const location = npc.location as Record<string, unknown>;
        
        // Check if NPC has a valid place_id
        const place_id = location?.place_id as string;
        
        if (!place_id) {
            // NPC has no location, place them in the default place (square)
            const default_place_id = "eden_crossroads_square";
            const place_res = load_place(slot, default_place_id);
            
            if (place_res.ok) {
                // Update NPC location
                npc.location = {
                    world_tile: { x: 0, y: 0 },
                    region_tile: { x: 0, y: 0 },
                    place_id: default_place_id,
                    tile: { 
                        x: Math.floor(Math.random() * place_res.place.tile_grid.width),
                        y: Math.floor(Math.random() * place_res.place.tile_grid.height)
                    },
                    elevation: 0
                };
                
                save_npc(slot, npc_id, npc);
                debug_log("Boot: placed NPC in default location", { 
                    npc_id, 
                    place_id: default_place_id 
                });
            }
        }
    }
}

async function fetch_json(url: string, timeout_ms: number): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeout_ms);
    try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`http_${res.status}`);
        return res.json();
    } finally {
        clearTimeout(timeout);
    }
}

async function check_ollama_server(host: string): Promise<{ ok: boolean; models: string[] }> {
    try {
        const data = (await fetch_json(`${host}/api/tags`, 2000)) as { models?: Array<{ name?: string }> };
        const models = Array.isArray(data?.models)
            ? data.models.map((m) => String(m?.name ?? "")).filter((m) => m.length > 0)
            : [];
        return { ok: true, models };
    } catch {
        return { ok: false, models: [] };
    }
}

async function wait_for_ollama(host: string, timeout_ms: number): Promise<{ ok: boolean; models: string[] }> {
    const start = Date.now();
    while (Date.now() - start < timeout_ms) {
        const status = await check_ollama_server(host);
        if (status.ok) return status;
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return { ok: false, models: [] };
}

async function ensure_ollama_running(): Promise<void> {
    debug_log("Ollama: checking server", { host: OLLAMA_HOST });
    const initial = await check_ollama_server(OLLAMA_HOST);
    if (initial.ok) {
        debug_log("Ollama: server already running", { models: initial.models.length });
        return;
    }

    debug_log("Ollama: starting local server");
    try {
        ollama_process = spawn("ollama", ["serve"], { stdio: "ignore", windowsHide: true });
        ollama_spawned = true;
    } catch (err) {
        debug_warn("Ollama: failed to spawn", { error: err instanceof Error ? err.message : String(err) });
        return;
    }

    const ready = await wait_for_ollama(OLLAMA_HOST, OLLAMA_BOOT_TIMEOUT_MS);
    if (!ready.ok) {
        debug_warn("Ollama: server did not respond in time", { host: OLLAMA_HOST });
        return;
    }

    debug_log("Ollama: server ready", { models: ready.models.length });
}

async function warmup_interpreter_model(): Promise<void> {
    if (!INTERPRETER_MODEL) return;
    debug_log("Ollama: warming interpreter model", { model: INTERPRETER_MODEL });
    try {
        const response = await ollama_chat({
            host: OLLAMA_HOST,
            model: INTERPRETER_MODEL,
            messages: [{ role: "user", content: "Warm up only. Reply OK." }],
            keep_alive: OLLAMA_WARMUP_KEEP_ALIVE,
            timeout_ms: OLLAMA_WARMUP_TIMEOUT_MS,
            options: { temperature: 0 },
        });
        debug_log("Ollama: warmup ok", { model: response.model, chars: response.content.length });
    } catch (err) {
        debug_warn("Ollama: warmup failed", {
            model: INTERPRETER_MODEL,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

async function warmup_renderer_model(): Promise<void> {
    if (!RENDERER_MODEL) return;
    debug_log("Ollama: warming renderer model", { model: RENDERER_MODEL });
    try {
        const response = await ollama_chat({
            host: OLLAMA_HOST,
            model: RENDERER_MODEL,
            messages: [{ role: "user", content: "Warm up only. Reply OK." }],
            keep_alive: OLLAMA_WARMUP_KEEP_ALIVE,
            timeout_ms: OLLAMA_WARMUP_TIMEOUT_MS,
            options: { temperature: 0 },
        });
        debug_log("Ollama: warmup ok", { model: response.model, chars: response.content.length });
    } catch (err) {
        debug_warn("Ollama: warmup failed", {
            model: RENDERER_MODEL,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

async function boot_ai_services(): Promise<void> {
    await ensure_ollama_running();
    await warmup_interpreter_model();
    await warmup_renderer_model();
}

function shutdown_ollama_if_spawned(): void {
    if (!ollama_spawned || !ollama_process) return;
    debug_log("Ollama: stopping spawned server");
    try {
        ollama_process.kill();
    } catch (err) {
        debug_warn("Ollama: failed to stop", { error: err instanceof Error ? err.message : String(err) });
    }
}

function log_ai_config(): void {
    debug_log("AI config", {
        host: OLLAMA_HOST,
        interpreter_model: INTERPRETER_MODEL,
        renderer_model: RENDERER_MODEL,
    });
}

type InputRequest = {
    text: string;
    sender?: string;
    intent_verb?: string;
    action_cost?: string;
    target_ref?: string;
};

type CreationState = {
    schema_version: 1;
    active: boolean;
    actor_id?: string;
    step?: string;
    data?: {
        kind_id?: string;
        name?: string;
        stats?: Record<string, number>;
        background?: string;
        prof_picks?: string[];
        gift_kind_choices?: string[];
        gift_greater_choice?: string | null;
    };
};

function read_creation_state(pathname: string): CreationState {
    if (!fs.existsSync(pathname)) return { schema_version: 1, active: false };
    const raw = fs.readFileSync(pathname, "utf-8");
    try {
        const parsed = JSON.parse(raw) as CreationState;
        if (parsed?.schema_version === 1) return parsed;
    } catch {
        return { schema_version: 1, active: false };
    }
    return { schema_version: 1, active: false };
}

function write_creation_state(pathname: string, state: CreationState): void {
    fs.writeFileSync(pathname, JSON.stringify(state, null, 2), "utf-8");
}

function list_kind_options(): string[] {
    const defs = load_kind_definitions();
    return defs.kinds
        .filter((k) => String(k.id ?? "") !== "DEFAULT_KIND")
        .map((k) => `${k.id} - ${k.name}`);
}

function parse_stat_assignment(input: string): Record<string, number> | null {
    const pairs = input.split(/[ ,]+/).filter((p) => p.includes("="));
    if (pairs.length < 6) return null;
    const out: Record<string, number> = {};
    for (const pair of pairs) {
        const [raw_key, raw_val] = pair.split("=");
        const key = String(raw_key ?? "").trim().toLowerCase();
        const val = Number(raw_val);
        if (!["con", "str", "dex", "wis", "int", "cha"].includes(key)) return null;
        if (!Number.isFinite(val)) return null;
        out[key] = val;
    }
    if (Object.keys(out).length !== 6) return null;
    const used = Object.values(out).sort((a, b) => a - b);
    const expected = [...STAT_VALUE_BLOCK].sort((a, b) => a - b);
    for (let i = 0; i < expected.length; i++) {
        if (used[i] !== expected[i]) return null;
    }
    return out;
}

type ProfValidationResult = {
    valid: boolean;
    invalid_profs: string[];
    wrong_count: boolean;
    entered_count: number;
    too_many_duplicates: boolean;
    duplicate_profs: string[];
    picks?: string[];
};

function validate_prof_picks(input: string, required_count: number): ProfValidationResult {
    const raw = input.split(/[\s,]+/).map((p) => p.trim()).filter((p) => p.length > 0);
    const result: ProfValidationResult = {
        valid: false,
        invalid_profs: [],
        wrong_count: raw.length !== required_count,
        entered_count: raw.length,
        too_many_duplicates: false,
        duplicate_profs: [],
    };

    // Check each prof is valid
    for (const entry of raw) {
        const key = entry.toLowerCase();
        if (!PROF_NAMES.includes(key)) {
            result.invalid_profs.push(entry);
        }
    }

    // Check for too many duplicates
    const counts: Record<string, number> = {};
    for (const entry of raw) {
        const key = entry.toLowerCase();
        counts[key] = (counts[key] ?? 0) + 1;
        if (counts[key] > 2) {
            result.too_many_duplicates = true;
            if (!result.duplicate_profs.includes(key)) {
                result.duplicate_profs.push(key);
            }
        }
    }

    result.valid = result.invalid_profs.length === 0 &&
                   !result.wrong_count &&
                   !result.too_many_duplicates;

    if (result.valid) {
        result.picks = raw.map((p) => p.toLowerCase());
    }

    return result;
}

function parse_prof_picks(input: string, pick_count: number): string[] | null {
    const validation = validate_prof_picks(input, pick_count);
    return validation.valid ? validation.picks ?? null : null;
}

type GiftValidationResult = {
    valid: boolean;
    invalid_gifts: string[];
    wrong_count: boolean;
    entered_count: number;
    duplicates: string[];
    choices?: string[];
};

function validate_gift_choices(input: string, required_count: number, available: string[]): GiftValidationResult {
    const raw = input.split(/[,\n]+/).map((p) => p.trim()).filter((p) => p.length > 0);
    const result: GiftValidationResult = {
        valid: false,
        invalid_gifts: [],
        wrong_count: raw.length !== required_count,
        entered_count: raw.length,
        duplicates: [],
    };

    const chosen: string[] = [];
    const seen = new Set<string>();

    for (const entry of raw) {
        const match = available.find((g) => g.toLowerCase() === entry.toLowerCase());
        if (!match) {
            result.invalid_gifts.push(entry);
        } else {
            if (seen.has(match.toLowerCase())) {
                result.duplicates.push(match);
            } else {
                seen.add(match.toLowerCase());
                chosen.push(match);
            }
        }
    }

    result.valid = result.invalid_gifts.length === 0 &&
                   !result.wrong_count &&
                   result.duplicates.length === 0;

    if (result.valid) {
        result.choices = chosen;
    }

    return result;
}

function parse_gift_choices(input: string, count: number, available: string[]): string[] | null {
    const validation = validate_gift_choices(input, count, available);
    return validation.valid ? validation.choices ?? null : null;
}

function format_gift_display(gift: Record<string, unknown>): string {
    const name = String(gift.name ?? "Unknown Gift");
    const abilities = Array.isArray(gift.granted_abilities) ? gift.granted_abilities : [];
    const description = abilities.join(" | ") || "No description available";
    return `${name} :\n${description}`;
}

function start_creation_flow(log_path: string, creation_path: string, actor_id: string): { user_message_id: string } {
    const user_msg = append_log_message(log_path, actor_id, "/create");
    const kinds = list_kind_options();
    const state: CreationState = { schema_version: 1, active: true, actor_id, step: "kind", data: {} };
    write_creation_state(creation_path, state);
    append_log_message(log_path, "system", `Character creation started. Choose a kind id:\n${kinds.map((k) => `- ${k}`).join("\n")}`);
    append_log_message(log_path, "hint", `Example: ${kinds[0] ?? "human"}`);
    write_status_line(get_status_path(data_slot_number), "character creation: choose kind");
    return { user_message_id: user_msg.id };
}

function handle_creation_input(
    log_path: string,
    creation_path: string,
    actor_id: string,
    text: string,
    state: CreationState,
): { user_message_id: string } {
    const user_msg = append_log_message(log_path, actor_id, text);
    const data = state.data ?? {};
    const step = state.step ?? "kind";

    if (text.trim().toLowerCase() === "/cancel") {
        write_creation_state(creation_path, { schema_version: 1, active: false });
        append_log_message(log_path, "system", "Character creation cancelled.");
        write_status_line(get_status_path(data_slot_number), "character creation cancelled");
        return { user_message_id: user_msg.id };
    }

    if (step === "kind") {
        const defs = load_kind_definitions();
        const match = defs.kinds.find((k) => String(k.id ?? "").toLowerCase() === text.trim().toLowerCase());
        if (!match) {
            append_log_message(log_path, "system", "Invalid kind id. Try again.");
            return { user_message_id: user_msg.id };
        }
        data.kind_id = String(match.id);
        state.step = "name";
        state.data = data;
        write_creation_state(creation_path, state);
        append_log_message(log_path, "system", "Enter your character name:");
        append_log_message(log_path, "hint", "Example: Aldric Thorne");
        write_status_line(get_status_path(data_slot_number), "character creation: choose name");
        return { user_message_id: user_msg.id };
    }

    if (step === "name") {
        if (!text.trim()) {
            append_log_message(log_path, "system", "Name cannot be empty. Enter your character name:");
            return { user_message_id: user_msg.id };
        }
        data.name = text.trim();
        state.step = "stats";
        state.data = data;
        write_creation_state(creation_path, state);
        append_log_message(
            log_path,
            "system",
            `Assign stats using: con=56 str=54 dex=52 wis=48 int=46 cha=44 (use each value once).\nValues: ${STAT_VALUE_BLOCK.join(", ")}`,
        );
        append_log_message(log_path, "hint", "Example: con=56 str=54 dex=52 wis=48 int=46 cha=44");
        write_status_line(get_status_path(data_slot_number), "character creation: assign stats");
        return { user_message_id: user_msg.id };
    }

    if (step === "stats") {
        if (text.trim().toLowerCase() === "redo") {
            append_log_message(log_path, "system", "Re-enter stat assignments:");
            return { user_message_id: user_msg.id };
        }
        const stats = parse_stat_assignment(text);
        if (!stats) {
            append_log_message(log_path, "system", "Invalid stat assignment. Try again or type 'redo'.");
            return { user_message_id: user_msg.id };
        }
        data.stats = stats;
        state.step = "background";
        state.data = data;
        write_creation_state(creation_path, state);
        append_log_message(log_path, "system", "Enter a background (one line):");
        append_log_message(log_path, "hint", "Example: I grew up in a small village on the edge of the forest...");
        write_status_line(get_status_path(data_slot_number), "character creation: background");
        return { user_message_id: user_msg.id };
    }

    if (step === "background") {
        if (!text.trim()) {
            append_log_message(log_path, "system", "Background cannot be empty. Enter a background:");
            return { user_message_id: user_msg.id };
        }
        data.background = text.trim();
        state.step = "profs";
        state.data = data;
        write_creation_state(creation_path, state);
        append_log_message(
            log_path,
            "system",
            `Pick 4 prof picks (comma-separated). Each prof can be chosen up to 2 times.\nProfs: ${PROF_NAMES.join(", ")}`,
        );
        append_log_message(log_path, "hint", "Example: quiet, perception, athletics, arcana");
        write_status_line(get_status_path(data_slot_number), "character creation: profs");
        return { user_message_id: user_msg.id };
    }

    if (step === "profs") {
        if (text.trim().toLowerCase() === "redo") {
            append_log_message(log_path, "system", "Re-enter 4 prof picks (comma-separated):");
            append_log_message(log_path, "system", `Available profs: ${PROF_NAMES.join(", ")}`);
            append_log_message(log_path, "hint", "Example: quiet, perception, athletics, arcana");
            return { user_message_id: user_msg.id };
        }
        const validation = validate_prof_picks(text, 4);
        if (!validation.valid) {
            // Show specific error message
            if (validation.invalid_profs.length > 0) {
                append_log_message(log_path, "system", `Invalid prof(s): ${validation.invalid_profs.join(", ")}. Check spelling.`);
            } else if (validation.wrong_count) {
                append_log_message(log_path, "system", `You entered ${validation.entered_count} profs, but need exactly 4.`);
            } else if (validation.too_many_duplicates) {
                append_log_message(log_path, "system", `You can only pick the same prof twice maximum. Duplicates: ${validation.duplicate_profs.join(", ")}`);
            }
            // Show available profs once (user can scroll)
            append_log_message(log_path, "system", `Available profs: ${PROF_NAMES.join(", ")}`);
            append_log_message(log_path, "hint", "Example: quiet, perception, athletics, arcana");
            return { user_message_id: user_msg.id };
        }
        const picks = validation.picks!;
        data.prof_picks = picks;
        state.step = "gifts";
        state.data = data;
        write_creation_state(creation_path, state);

        const kind = data.kind_id ? load_kind_definitions().kinds.find((k) => String(k.id) === data.kind_id) : null;
        const gifts = Array.isArray(kind?.gift_of_kind) ? kind!.gift_of_kind : [];
        const gift_names = gifts.map((g: any) => String(g.name));
        if (gifts.length === 0) {
            state.step = "confirm";
            write_creation_state(creation_path, state);
            append_log_message(log_path, "system", "No kind gifts available. Type 'confirm' to create your character or 'redo' to restart.");
            append_log_message(log_path, "hint", "Example: confirm");
            write_status_line(get_status_path(data_slot_number), "character creation: confirm");
            return { user_message_id: user_msg.id };
        }
        append_log_message(log_path, "system", "Pick 2 gifts of kind (comma-separated):");
        append_log_message(log_path, "system", "Available gifts:");
        for (const gift of gifts) {
            append_log_message(log_path, "system", format_gift_display(gift as Record<string, unknown>));
        }
        append_log_message(log_path, "hint", `Example: ${gift_names.slice(0, 2).join(", ")}`);
        write_status_line(get_status_path(data_slot_number), "character creation: gifts");
        return { user_message_id: user_msg.id };
    }

    if (step === "gifts") {
        const kind = data.kind_id ? load_kind_definitions().kinds.find((k) => String(k.id) === data.kind_id) : null;
        const gifts = Array.isArray(kind?.gift_of_kind) ? kind!.gift_of_kind : [];
        const gift_names = gifts.map((g: any) => String(g.name));
        const required_count = Math.min(2, gift_names.length);

        if (text.trim().toLowerCase() === "redo") {
            append_log_message(log_path, "system", "Re-enter 2 gifts of kind (comma-separated):");
            append_log_message(log_path, "system", "Available gifts:");
            for (const gift of gifts) {
                append_log_message(log_path, "system", format_gift_display(gift as Record<string, unknown>));
            }
            append_log_message(log_path, "hint", `Example: ${gift_names.slice(0, 2).join(", ")}`);
            return { user_message_id: user_msg.id };
        }

        const validation = validate_gift_choices(text, required_count, gift_names);
        if (!validation.valid) {
            // Show specific error message
            if (validation.invalid_gifts.length > 0) {
                append_log_message(log_path, "system", `Invalid gift(s): ${validation.invalid_gifts.join(", ")}. Check spelling.`);
            } else if (validation.wrong_count) {
                append_log_message(log_path, "system", `You entered ${validation.entered_count} gifts, but need exactly ${required_count}.`);
            } else if (validation.duplicates.length > 0) {
                append_log_message(log_path, "system", `You cannot pick the same gift twice. Duplicates: ${validation.duplicates.join(", ")}`);
            }
            // Show available gifts formatted (user can scroll)
            append_log_message(log_path, "system", "Available gifts:");
            for (const gift of gifts) {
                append_log_message(log_path, "system", format_gift_display(gift as Record<string, unknown>));
            }
            append_log_message(log_path, "hint", `Example: ${gift_names.slice(0, 2).join(", ")}`);
            return { user_message_id: user_msg.id };
        }
        const choices = validation.choices!;
        data.gift_kind_choices = choices;
        const greater = Array.isArray(kind?.gift_of_greater_kind) ? kind!.gift_of_greater_kind.map((g: any) => String(g.name)) : [];
        if (greater.length === 0) {
            state.step = "confirm";
            state.data = data;
            write_creation_state(creation_path, state);
            append_log_message(log_path, "system", "No greater gifts available. Type 'confirm' to create your character or 'redo' to restart.");
            append_log_message(log_path, "hint", "Example: confirm");
            write_status_line(get_status_path(data_slot_number), "character creation: confirm");
            return { user_message_id: user_msg.id };
        }
        const greater_gifts = Array.isArray(kind?.gift_of_greater_kind) ? kind!.gift_of_greater_kind : [];
        const greater_names = greater_gifts.map((g: any) => String(g.name));
        state.step = "greater_gift";
        state.data = data;
        write_creation_state(creation_path, state);
        append_log_message(log_path, "system", "Pick 1 gift of greater kind:");
        append_log_message(log_path, "system", "Available greater gifts:");
        for (const gift of greater_gifts) {
            append_log_message(log_path, "system", format_gift_display(gift as Record<string, unknown>));
        }
        append_log_message(log_path, "hint", `Example: ${greater_names[0] ?? "fey ancestry"}`);
        write_status_line(get_status_path(data_slot_number), "character creation: greater gift");
        return { user_message_id: user_msg.id };
    }

    if (step === "greater_gift") {
        const kind = data.kind_id ? load_kind_definitions().kinds.find((k) => String(k.id) === data.kind_id) : null;
        const greater_gifts = Array.isArray(kind?.gift_of_greater_kind) ? kind!.gift_of_greater_kind : [];
        const greater_names = greater_gifts.map((g: any) => String(g.name));
        
        if (text.trim().toLowerCase() === "redo") {
            append_log_message(log_path, "system", "Re-enter 1 gift of greater kind:");
            append_log_message(log_path, "system", "Available greater gifts:");
            for (const gift of greater_gifts) {
                append_log_message(log_path, "system", format_gift_display(gift as Record<string, unknown>));
            }
            append_log_message(log_path, "hint", `Example: ${greater_names[0] ?? "fey ancestry"}`);
            return { user_message_id: user_msg.id };
        }
        
        const match = greater_names.find((g) => g.toLowerCase() === text.trim().toLowerCase());
        if (!match) {
            append_log_message(log_path, "system", `Invalid greater gift: "${text.trim()}". Check spelling.`);
            append_log_message(log_path, "system", "Available greater gifts:");
            for (const gift of greater_gifts) {
                append_log_message(log_path, "system", format_gift_display(gift as Record<string, unknown>));
            }
            append_log_message(log_path, "hint", `Example: ${greater_names[0] ?? "fey ancestry"}`);
            return { user_message_id: user_msg.id };
        }
        data.gift_greater_choice = match;
        state.step = "confirm";
        state.data = data;
        write_creation_state(creation_path, state);
        append_log_message(log_path, "system", "Type 'confirm' to create your character or 'redo' to restart.");
        append_log_message(log_path, "hint", "Example: confirm");
        write_status_line(get_status_path(data_slot_number), "character creation: confirm");
        return { user_message_id: user_msg.id };
    }

    if (step === "confirm") {
        if (text.trim().toLowerCase() === "redo") {
            state.step = "kind";
            state.data = {};
            write_creation_state(creation_path, state);
            append_log_message(log_path, "system", "Restarting creation. Choose a kind id:");
            const kinds = list_kind_options();
            append_log_message(log_path, "hint", `Example: ${kinds[0] ?? "human"}`);
            write_status_line(get_status_path(data_slot_number), "character creation: choose kind");
            return { user_message_id: user_msg.id };
        }
        if (text.trim().toLowerCase() !== "confirm") {
            append_log_message(log_path, "system", "Type 'confirm' to finish or 'redo' to restart.");
            append_log_message(log_path, "hint", "Example: confirm");
            return { user_message_id: user_msg.id };
        }
        const input = {
            actor_id,
            name: data.name ?? actor_id,
            kind_id: data.kind_id ?? "DEFAULT_KIND",
            gift_kind_choices: data.gift_kind_choices ?? [],
            gift_greater_choice: data.gift_greater_choice ?? null,
            stats: data.stats,
            prof_picks: data.prof_picks ?? [],
            background: data.background,
        };
        const created = create_actor_from_kind(data_slot_number, input);
        if (!created.ok) {
            append_log_message(log_path, "system", `Character creation failed: ${created.todo}`);
            return { user_message_id: user_msg.id };
        }
        write_creation_state(creation_path, { schema_version: 1, active: false });
        append_log_message(log_path, "system", `Character created: ${created.actor.name ?? actor_id}`);
        write_status_line(get_status_path(data_slot_number), "character creation complete");
        return { user_message_id: user_msg.id };
    }

    append_log_message(log_path, "system", "Creation step not recognized. Type /create to restart.");
    return { user_message_id: user_msg.id };
}

function start_http_server(log_path: string): void {
    const server = http.createServer((req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");

        if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
        }

        const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
        if (url.pathname === "/api/input") {
            if (req.method !== "POST") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            const MAX_BYTES = 64 * 1024;
            let body = "";

            req.on("data", (chunk) => {
                body += chunk;
                if (body.length > MAX_BYTES) {
                    res.writeHead(413, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "payload_too_large" }));
                    req.destroy();
                }
            });

            req.on("end", () => {
                let parsed: InputRequest | null = null;
                try {
                    parsed = JSON.parse(body) as InputRequest;
                } catch {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "invalid_json" }));
                    return;
                }

                const text = typeof parsed?.text === "string" ? parsed.text : "";
                if (!text.trim()) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "empty_text" }));
                    return;
                }

                const sender = typeof parsed?.sender === "string" && parsed.sender.trim().length > 0
                    ? parsed.sender.trim()
                    : "J";

                const intent_verb = typeof parsed?.intent_verb === "string" ? parsed.intent_verb.trim() : "";
                const action_cost = typeof parsed?.action_cost === "string" ? parsed.action_cost.trim() : "";
                const target_ref = typeof parsed?.target_ref === "string" ? parsed.target_ref.trim() : "";

                const creation_path = get_creation_state_path(data_slot_number);
                const creation_state = read_creation_state(creation_path);
                if (creation_state.active && creation_state.actor_id === sender) {
                    const handled = handle_creation_input(log_path, creation_path, sender, text, creation_state);
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true, id: handled.user_message_id }));
                    return;
                }

                if (text.trim().toLowerCase() === "/create") {
                    const handled = start_creation_flow(log_path, creation_path, sender);
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true, id: handled.user_message_id }));
                    return;
                }

                current_state = "processing";

                // Check if timed event is active and use event_id as correlation_id
                const timed_event = get_timed_event_state(data_slot_number);
                const correlation_id = timed_event?.timed_event_active && timed_event?.event_id
                    ? timed_event.event_id
                    : create_correlation_id();

                // Default to COMMUNICATE if no intent specified but we have a target and text
                // This handles "hello grenda" style messages without explicit intent buttons
                const effective_intent = intent_verb || (target_ref ? "COMMUNICATE" : undefined);
                
                const inbound = create_message({
                    sender,
                    content: text,
                    type: "user_input",
                    status: "queued",
                    correlation_id,
                    meta: {
                        ...getSessionMeta(),
                        timed_event_active: timed_event?.timed_event_active || false,
                        event_id: timed_event?.event_id || null,
                        // Optional UI overrides
                        intent_verb: effective_intent,
                        action_cost: action_cost || undefined,
                        target_ref: target_ref || undefined,
                    },
                });

                append_inbox_message(inbox_path, inbound);
                current_state = "awaiting_user";

                write_status_line(get_status_path(data_slot_number), "received actor input");

                debug_log("HTTP input received", { sender, length: text.length, id: inbound.id });

                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, id: inbound.id }));
            });
            return;
        }

        if (url.pathname === "/api/roller_status") {
            if (req.method !== "GET") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            try {
                const status = read_roller_status(get_roller_status_path(data_slot_number));
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, status }));
            } catch (err) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "failed_to_read" }));
            }
            return;
        }

        if (url.pathname === "/api/roll") {
            if (req.method !== "POST") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            const MAX_BYTES = 16 * 1024;
            let body = "";

            req.on("data", (chunk) => {
                body += chunk;
                if (body.length > MAX_BYTES) {
                    res.writeHead(413, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "payload_too_large" }));
                    req.destroy();
                }
            });

            req.on("end", () => {
                let parsed: { roll_id?: string } | null = null;
                try {
                    parsed = JSON.parse(body) as { roll_id?: string };
                } catch {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "invalid_json" }));
                    return;
                }

                const roll_id = typeof parsed?.roll_id === "string" ? parsed.roll_id : "";
                if (!roll_id) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "missing_roll_id" }));
                    return;
                }

                const roll_input = create_message({
                    sender: "roller_ui",
                    content: "roll",
                    status: "sent",
                    stage: "roll_input_1",
                    meta: { roll_id },
                });

                append_outbox_message(outbox_path, roll_input);
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, id: roll_input.id }));
            });
            return;
        }

        if (url.pathname === "/api/log") {
            if (req.method !== "GET") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            const slot_raw = url.searchParams.get("slot");
            const slot = slot_raw ? Number(slot_raw) : data_slot_number;
            if (!Number.isFinite(slot) || slot <= 0) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "invalid_slot" }));
                return;
            }

            try {
                const log = read_log(get_log_path(slot));
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, messages: log.messages }));
            } catch (err: any) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: err?.message ?? "read_failed" }));
            }
            return;
        }

        if (url.pathname === "/api/status") {
            if (req.method !== "GET") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            const slot_raw = url.searchParams.get("slot");
            const slot = slot_raw ? Number(slot_raw) : data_slot_number;
            if (!Number.isFinite(slot) || slot <= 0) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "invalid_slot" }));
                return;
            }

            try {
                const status = read_status(get_status_path(slot));
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, status }));
            } catch (err: any) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: err?.message ?? "read_failed" }));
            }
            return;
        }

        if (url.pathname === "/api/health") {
            if (req.method !== "GET") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            // Check if services are responsive by checking recent log activity
            try {
                const log = read_log(log_path);
                const recentMessages = log.messages.slice(-10);
                const serviceActivity: Record<string, number> = {};
                
                for (const msg of recentMessages) {
                    const sender = msg.sender?.toLowerCase() ?? 'unknown';
                    serviceActivity[sender] = (serviceActivity[sender] ?? 0) + 1;
                }

                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ 
                    ok: true, 
                    status: "healthy",
                    session_id: SESSION_ID,
                    services: {
                        interface_program: true,
                        recent_activity: serviceActivity,
                        total_recent_messages: recentMessages.length
                    }
                }));
            } catch (err: any) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: err?.message ?? "health_check_failed" }));
            }
            return;
        }

        if (url.pathname === "/api/place") {
            if (req.method !== "GET") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            const slot_raw = url.searchParams.get("slot");
            const slot = slot_raw ? Number(slot_raw) : data_slot_number;
            if (!Number.isFinite(slot) || slot <= 0) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "invalid_slot" }));
                return;
            }

            const place_id = url.searchParams.get("place_id");
            if (!place_id) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "missing_place_id" }));
                return;
            }

            try {
                // Load base place data
                const place_res = load_place(slot, place_id);
                if (!place_res.ok) {
                    res.writeHead(404, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "place_not_found", details: place_res.error }));
                    return;
                }

                const place = place_res.place;

                // Debug: log place connections
                debug_log("API", `/api/place: ${place_id} has ${place.connections?.length || 0} connections`, {
                    connections: place.connections?.map((c: { target_place_id: string; direction: string }) => ({ 
                        target: c.target_place_id, 
                        direction: c.direction 
                    }))
                });

                // Get entities in this place from the spatial index
                const entity_refs = get_entities_in_place(slot, place_id);
                debug_log("API", `/api/place: Found entities in ${place_id}`, {
                    slot,
                    npc_count: entity_refs.npcs.length,
                    actor_count: entity_refs.actors.length
                });

                // Clear existing contents and populate from index
                place.contents.npcs_present = [];
                place.contents.actors_present = [];

                // Load NPC data
                for (const npc_ref of entity_refs.npcs) {
                    const npc_id = npc_ref.replace("npc.", "");
                    const npc_res = load_npc(slot, npc_id);
                    if (!npc_res.ok) {
                        debug_warn("API", `Failed to load NPC ${npc_id} for place ${place_id}`, { error: npc_res.error });
                        continue;
                    }

                    const location = get_npc_location(npc_res.npc);
                    if (!location?.tile) {
                        debug_warn("API", `NPC ${npc_id} has no tile position`, { npc_ref });
                        continue;
                    }

                    // Clamp NPC position to valid place bounds
                    const clamped_location = {
                        x: Math.max(0, Math.min(location.tile.x, place.tile_grid.width - 1)),
                        y: Math.max(0, Math.min(location.tile.y, place.tile_grid.height - 1))
                    };
                    
                    if (clamped_location.x !== location.tile.x || clamped_location.y !== location.tile.y) {
                        debug_warn("API", `NPC ${npc_id} position clamped from (${location.tile.x},${location.tile.y}) to (${clamped_location.x},${clamped_location.y})`, {
                            npc_ref,
                            place_bounds: { w: place.tile_grid.width, h: place.tile_grid.height }
                        });
                    }

                    place.contents.npcs_present.push({
                        npc_ref,
                        tile_position: clamped_location,
                        status: "present",
                        activity: "standing here"
                    });
                }

                // Load Actor data
                for (const actor_ref of entity_refs.actors) {
                    const actor_id = actor_ref.replace("actor.", "");
                    const actor_res = load_actor(slot, actor_id);
                    if (!actor_res.ok) {
                        debug_warn("API", `Failed to load actor ${actor_id} for place ${place_id}`, { error: actor_res.error });
                        continue;
                    }

                    const actor = actor_res.actor;
                    const location = (actor.location as { tile?: { x: number; y: number } })?.tile;
                    if (!location) {
                        debug_warn("API", `Actor ${actor_id} has no tile position`, { actor_ref });
                        continue;
                    }

                    // Clamp actor position to valid place bounds
                    const clamped_location = {
                        x: Math.max(0, Math.min(location.x, place.tile_grid.width - 1)),
                        y: Math.max(0, Math.min(location.y, place.tile_grid.height - 1))
                    };
                    
                    if (clamped_location.x !== location.x || clamped_location.y !== location.y) {
                        debug_warn("API", `Actor ${actor_id} position clamped from (${location.x},${location.y}) to (${clamped_location.x},${clamped_location.y})`, {
                            actor_ref,
                            place_bounds: { w: place.tile_grid.width, h: place.tile_grid.height }
                        });
                    }

                    place.contents.actors_present.push({
                        actor_ref,
                        tile_position: clamped_location,
                        status: "present"
                    });
                }

                debug_log("API", `/api/place: Populated ${place_id}`, {
                    slot,
                    populated_npcs: place.contents.npcs_present.length,
                    populated_actors: place.contents.actors_present.length
                });

                // Add timed event status to response
                const timed_event = get_timed_event_state(slot);
                
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ 
                    ok: true, 
                    place,
                    timed_event_active: timed_event?.timed_event_active || false,
                    timed_event_id: timed_event?.event_id || null
                }));
            } catch (err: any) {
                debug_error("API", `/api/place failed for ${place_id}`, err);
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: err?.message ?? "load_place_failed" }));
            }
            return;
        }

        if (url.pathname === "/api/place/travel") {
            if (req.method !== "POST") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            const slot_raw = url.searchParams.get("slot");
            const slot = slot_raw ? Number(slot_raw) : data_slot_number;
            if (!Number.isFinite(slot) || slot <= 0) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "invalid_slot" }));
                return;
            }

            // Check if timed event is active - disable travel during events
            if (is_timed_event_active(slot)) {
                res.writeHead(403, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ 
                    ok: false, 
                    error: "travel_disabled_during_event",
                    message: "Cannot travel between places during a timed event"
                }));
                return;
            }

            let body = "";
            req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
            req.on("end", async () => {
                try {
                    const data = JSON.parse(body);
                    const entity_ref = data.entity_ref;
                    const target_place_id = data.target_place_id;

                    if (!entity_ref || !target_place_id) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "missing_parameters" }));
                        return;
                    }

                    debug_log("API", `/api/place/travel: ${entity_ref} -> ${target_place_id}`);
                    
                    const result = await travel_between_places(slot, entity_ref, target_place_id);
                    
                    if (result.ok) {
                        debug_log("API", `Travel successful: ${result.from_place_id} -> ${result.to_place_id}`);
                        res.writeHead(200, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ 
                            ok: true, 
                            from_place_id: result.from_place_id,
                            to_place_id: result.to_place_id,
                            travel_time_seconds: result.travel_time_seconds,
                            travel_description: result.travel_description
                        }));
                    } else {
                        debug_warn("API", `Travel failed: ${result.error}`, { entity_ref, target_place_id });
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ 
                            ok: false, 
                            error: result.error,
                            from_place_id: result.from_place_id,
                            to_place_id: result.to_place_id
                        }));
                    }
                } catch (err: any) {
                    debug_error("API", `/api/place/travel request error`, err);
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: err?.message ?? "travel_failed" }));
                }
            });
            return;
        }

        if (url.pathname === "/api/targets") {
            if (req.method !== "GET") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            const slot_raw = url.searchParams.get("slot");
            const slot = slot_raw ? Number(slot_raw) : data_slot_number;
            if (!Number.isFinite(slot) || slot <= 0) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "invalid_slot" }));
                return;
            }

            const actor_id = url.searchParams.get("actor_id") || "henry_actor";
            try {
                const actor_res = load_actor(slot, actor_id);
                if (!actor_res.ok) {
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true, targets: [] }));
                    return;
                }

                const loc = (actor_res.actor.location as any) ?? {};
                const wx = Number(loc?.world_tile?.x ?? 0);
                const wy = Number(loc?.world_tile?.y ?? 0);
                const rx = Number(loc?.region_tile?.x ?? 0);
                const ry = Number(loc?.region_tile?.y ?? 0);
                const region_res = get_region_by_coords(slot, wx, wy, rx, ry);

                const targets: Array<{ ref: string; label: string; type: string }> = [];
                const actor_label = typeof (actor_res.actor as any)?.name === "string" ? ((actor_res.actor as any).name as string) : actor_id;
                targets.push({ ref: `actor.${actor_id}`, label: actor_label, type: "actor" });

                // Awareness set: only include NPCs the actor is aware of.
                const awareness = new Set<string>();
                const tags = (actor_res.actor as any)?.tags;
                if (Array.isArray(tags)) {
                    for (const tag of tags) {
                        if (tag?.name !== "AWARENESS") continue;
                        const info = tag?.info;
                        if (!Array.isArray(info)) continue;
                        for (const entry of info) {
                            if (typeof entry !== "string") continue;
                            const norm = entry.toLowerCase();
                            // Normalize npc.Gunther -> npc.gunther
                            const fixed = norm.startsWith("npc.") ? `npc.${norm.slice(4).replace(/[^a-z0-9_]/g, "_")}` : norm;
                            awareness.add(fixed);
                        }
                    }
                }

                if (region_res.ok) {
                    targets.push({ ref: `region_tile.${wx}.${wy}.${rx}.${ry}`, label: region_res.region.name ?? region_res.region_id, type: "region" });

                    const npcs_present = (region_res.region as any)?.contents?.npcs_present;
                    if (Array.isArray(npcs_present)) {
                        for (const entry of npcs_present) {
                            const npc_ref_raw = typeof entry?.npc_id === "string" ? entry.npc_id : "";
                            const npc_id = npc_ref_raw.replace(/^npc\./, "");
                            if (!npc_id) continue;
                            const ref = `npc.${npc_id}`.toLowerCase();
                            // Only show if actor is aware, unless awareness set is empty (fresh start)
                            if (awareness.size > 0 && !awareness.has(ref)) continue;
                            const npc_res = load_npc(slot, npc_id);
                            const label = npc_res.ok ? (npc_res.npc.name ?? npc_id) : npc_id;
                            targets.push({ ref: `npc.${npc_id}`, label, type: "npc" });
                        }
                    }

                    // Also include NPCs whose saved location matches the actor's PLACE (Place System)
                    // This filters NPCs to only show those in the same place as the player
                    try {
                        const actor_place_id = (actor_res.actor as any)?.location?.place_id;
                        const all_npcs = find_npcs(slot, {}).filter((n) => n.id !== "default_npc");
                        for (const n of all_npcs) {
                            const npc_id = n.id;
                            if (!npc_id) continue;
                            const ref = `npc.${npc_id}`.toLowerCase();
                            if (awareness.size > 0 && !awareness.has(ref)) continue;
                            const npc_res = load_npc(slot, npc_id);
                            if (!npc_res.ok) continue;
                            const nloc = (npc_res.npc as any)?.location;
                            
                            // Place System: Check if NPC is in same place
                            const npc_place_id = nloc?.place_id;
                            if (actor_place_id && npc_place_id) {
                                // Both have place_id - must match
                                if (npc_place_id !== actor_place_id) continue;
                            } else {
                                // Fallback: Check region match (legacy)
                                const nwx = Number(nloc?.world_tile?.x ?? NaN);
                                const nwy = Number(nloc?.world_tile?.y ?? NaN);
                                const nrx = Number(nloc?.region_tile?.x ?? NaN);
                                const nry = Number(nloc?.region_tile?.y ?? NaN);
                                if (!(nwx === wx && nwy === wy && nrx === rx && nry === ry)) continue;
                            }
                            
                            // Dedup
                            if (targets.some(t => t.type === "npc" && t.ref.toLowerCase() === `npc.${npc_id}`.toLowerCase())) continue;
                            const label = typeof (npc_res.npc as any)?.name === "string" ? ((npc_res.npc as any).name as string) : npc_id;
                            targets.push({ ref: `npc.${npc_id}`, label, type: "npc" });
                        }
                    } catch {
                        // ignore
                    }
                }

                // Get place information for response
                const actor_place_id = (actor_res.actor as any)?.location?.place_id;
                let place_name = null;
                if (actor_place_id) {
                    const place_res = load_place(slot, actor_place_id);
                    if (place_res.ok) {
                        place_name = place_res.place.name ?? actor_place_id;
                    }
                }
                
                // Get world tile coordinates
                const world_x = (actor_res.actor as any)?.location?.world_tile?.x ?? 0;
                const world_y = (actor_res.actor as any)?.location?.world_tile?.y ?? 0;
                const region_x = (actor_res.actor as any)?.location?.region_tile?.x ?? 0;
                const region_y = (actor_res.actor as any)?.location?.region_tile?.y ?? 0;
                
                // Get places in current region
                const places_in_region: Array<{ ref: string; label: string; id: string }> = [];
                if (region_res.ok && region_res.region_id) {
                    const places_result = list_places_in_region(slot, region_res.region_id);
                    if (places_result.ok) {
                        for (const place_id of places_result.places) {
                            const place_res = load_place(slot, place_id);
                            if (place_res.ok) {
                                // Build place reference: place.<region>.<place_suffix>
                                const parts = place_id.split("_");
                                if (parts.length >= 2) {
                                    const place_suffix = parts.pop();
                                    const region_id = parts.join("_");
                                    const ref = `place.${region_id}.${place_suffix}`;
                                    places_in_region.push({
                                        ref,
                                        label: place_res.place.name ?? place_id,
                                        id: place_id
                                    });
                                }
                            }
                        }
                    }
                }
                
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ 
                    ok: true, 
                    region: region_res.ok ? (region_res.region.name ?? region_res.region_id) : null,
                    place: place_name,
                    place_id: actor_place_id,
                    world_coords: { x: world_x, y: world_y },
                    region_coords: { x: region_x, y: region_y },
                    places: places_in_region,
                    targets 
                }));
            } catch (err: any) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: err?.message ?? "failed_to_read" }));
            }
            return;
        }

        // POST /api/target - Set communication target for actor
        if (url.pathname === "/api/target") {
            if (req.method !== "POST") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            let body = "";
            req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
            req.on("end", () => {
                try {
                    const data = JSON.parse(body);
                    const actor_ref = data.actor_ref || "actor.henry_actor";
                    const target_ref = data.target_ref;
                    const target_type = data.target_type || "npc";
                    const target_name = data.target_name;

                    if (!target_ref) {
                        // Clear target
                        clearActorTarget(actor_ref);
                        res.writeHead(200, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: true, action: "cleared" }));
                        return;
                    }

                    // Set target
                    setActorTarget(actor_ref, target_ref, target_type, target_name);
                    debug_log("[API]", `Target set for ${actor_ref}: ${target_ref} (${target_type})`);

                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ 
                        ok: true, 
                        action: "set",
                        actor_ref,
                        target_ref,
                        target_type 
                    }));
                } catch (err: any) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: err?.message ?? "invalid_request" }));
                }
            });
            return;
        }

        if (url.pathname === "/api/actor/move") {
            if (req.method !== "POST") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            const slot_raw = url.searchParams.get("slot");
            const slot = slot_raw ? Number(slot_raw) : data_slot_number;
            if (!Number.isFinite(slot) || slot <= 0) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "invalid_slot" }));
                return;
            }

            const actor_id = url.searchParams.get("actor_id");
            if (!actor_id) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "missing_actor_id" }));
                return;
            }

            // Collect request body
            let body = "";
            req.on("data", (chunk: Buffer) => {
                body += chunk.toString();
            });
            
            req.on("end", () => {
                try {
                    const data = JSON.parse(body) as { x?: number; y?: number };
                    
                    if (typeof data.x !== "number" || typeof data.y !== "number") {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "invalid_position" }));
                        return;
                    }

                    // Load and update actor
                    const actor_res = load_actor(slot, actor_id);
                    if (!actor_res.ok) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "actor_not_found" }));
                        return;
                    }

                    const actor = actor_res.actor as Record<string, unknown>;
                    if (!actor.location) {
                        actor.location = {};
                    }
                    (actor.location as Record<string, unknown>).tile = { x: data.x, y: data.y };
                    
                    save_actor(slot, actor_id, actor);
                    
                    debug_log("API", `Actor ${actor_id} position updated`, { slot, x: data.x, y: data.y });
                    
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true, actor_id, position: { x: data.x, y: data.y } }));
                } catch (err: any) {
                    debug_error("API", `/api/actor/move failed for ${actor_id}`, err);
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: err?.message ?? "move_failed" }));
                }
            });
            
            req.on("error", (err: any) => {
                debug_error("API", `/api/actor/move request error for ${actor_id}`, err);
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "request_error" }));
            });
            
            return;
        }

        if (url.pathname === "/api/health/session") {
            if (req.method !== "GET") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            // Dedicated session health endpoint
            try {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ 
                    ok: true, 
                    session_id: SESSION_ID,
                    status: "session_active"
                }));
            } catch (err: any) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: err?.message ?? "session_check_failed" }));
            }
            return;
        }

        if (url.pathname !== "/api/input") {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "not_found" }));
            return;
        }
    });

    server.listen(HTTP_PORT, () => {
        debug_log(`HTTP bridge listening on http://localhost:${HTTP_PORT}/api/input`);
    });
}

// repeatedly check tasks that take time using current_state (shell)
// Breath is the stage coordinator for routing and state transitions.
// Track which messages have been displayed to prevent duplicates
const displayedMessageIds = new Set<string>();

/**
 * Parse user input and create an ActionIntent for the ActionPipeline
 */
function Breath(log_path: string, inbox_path: string, outbox_path: string): void {
    try {
        flush_incoming_messages();

        // Read inbox without clearing
        const inbox = read_inbox(inbox_path);
        if (inbox.messages.length === 0) return;

        const messagesToKeep: typeof inbox.messages = [];
        const messagesToRemove: typeof inbox.messages = [];

        for (const msg of inbox.messages) {
            if (!msg) continue;

            // Skip if already displayed
            if (displayedMessageIds.has(msg.id)) {
                messagesToRemove.push(msg);
                continue;
            }

            // Check if this is a displayable message (NPC response, renderer output)
            const isDisplayable = 
                msg.stage === "npc_response" ||
                msg.stage === "rendered_1" ||
                msg.sender?.startsWith("npc.") ||
                msg.sender === "renderer_ai";

            // Check if this is user input that needs routing
            // Exclude system messages like position updates
            const isUserInput = 
                msg.type === "user_input" ||
                msg.sender?.toLowerCase() === "j" ||
                (msg.type !== "npc_position_update" &&
                 msg.stage !== "npc_response" && 
                 msg.stage !== "rendered_1" &&
                 !msg.sender?.startsWith("npc.") &&
                 msg.sender !== "renderer_ai");

            if (isDisplayable) {
                // Display to user
                displayMessageToUser(msg, log_path);
                displayedMessageIds.add(msg.id);
                messagesToRemove.push(msg);
                
                // Debug logging for NPC messages specifically
                if (msg.sender?.startsWith('npc.')) {
                    console.log(`[Breath] Displaying NPC message from ${msg.sender}: "${msg.content?.slice(0, 50)}..."`);
                }
                
                debug_log("Breath: displayed message to user", {
                    id: msg.id,
                    sender: msg.sender,
                    stage: msg.stage,
                    preview: msg.content?.slice(0, 50)
                });
            } else if (isUserInput) {
                // NEW COMMUNICATION SYSTEM: All text input goes through COMMUNICATE action
                const content = msg.content || "";
                
                console.log(`[Breath] Processing user input: "${content.slice(0, 50)}"`);
                
                // Write user message to log immediately so it appears in UI
                append_log_message(log_path, "j", content);
                
                // Use new communication input system
                handleCommunicationSubmit(content, (intent) => {
                    console.log(`[Breath] Created COMMUNICATE intent:`, {
                        target: intent.targetRef || "(broadcast)",
                        volume: intent.volume,
                        message: intent.message.slice(0, 30)
                    });
                    
                    // Process through ActionPipeline
                    processPlayerAction(data_slot_number, intent).then(result => {
                        console.log(`[Breath] ActionPipeline completed:`, {
                            success: result.success,
                            observedBy: result.observedBy?.length || 0
                        });
                        
                        if (result.success) {
                            append_log_message(log_path, "system", `[Action] ${formatActionResult(result)}`);
                            
                            // Write message to outbox so NPC_AI can generate LLM response
                            // The ActionPipeline handles execution, but NPC_AI needs to see the message
                            const outbox_msg: MessageEnvelope = {
                                ...msg,
                                status: "sent" as const,
                                stage: "interpreter_ai" as const,
                                meta: {
                                    ...(msg.meta || {}),
                                    intent_verb: "COMMUNICATE",
                                    target_ref: intent.targetRef,
                                    original_text: content,
                                    processed_by_action_pipeline: true,
                                },
                            };
                            append_outbox_message(outbox_path, outbox_msg);
                            console.log(`[Breath] Message written to outbox for NPC_AI processing: ${msg.id}`);
                        }
                    }).catch(err => {
                        console.error(`[Breath] ActionPipeline error:`, err);
                    });
                });
                
                // Mark as processed - don't continue with normal routing to avoid duplicates
                // The outbox message will be written inside the callback after intent is created
                displayedMessageIds.add(msg.id);
                messagesToRemove.push(msg);
                
                // Note: We need to move the outbox writing into the callback below
                // where 'intent' is available. See handleCommunicationSubmit callback.
            } else {
                // Continue with normal routing (for non-COMMUNICATE messages)
                const normalized: MessageEnvelope = {
                    ...msg,
                    created_at: msg.created_at ?? new Date().toISOString(),
                };

                const is_user = msg.sender?.toLowerCase() === "j";
                if (normalized.correlation_id === undefined && is_user) {
                    normalized.correlation_id = create_correlation_id();
                }

                const routed = route_message(normalized);
                append_log_envelope(log_path, routed.log);

                debug_log("Breath: inbox message routed", {
                    id: routed.log.id,
                    sender: routed.log.sender,
                    stage: routed.log.stage,
                    hasOutbox: !!routed.outbox,
                    outboxStage: routed.outbox?.stage,
                });

                write_status_line(
                    get_status_path(data_slot_number),
                    "routing message to the pipeline",
                );

                if (routed.outbox) {
                    append_outbox_message(outbox_path, routed.outbox);
                    debug_log("Breath: outbox queued", {
                        id: routed.outbox.id,
                        stage: routed.outbox.stage,
                        status: routed.outbox.status,
                    });

                    write_status_line(
                        get_status_path(data_slot_number),
                        "queued for interpretation",
                    );
                }

                messagesToRemove.push(msg);
            }
        }

        // Rewrite inbox with only messages to keep
        if (messagesToRemove.length > 0) {
            inbox.messages = messagesToKeep;
            write_inbox(inbox_path, inbox);
            
            debug_log("Breath: inbox cleaned", {
                removed: messagesToRemove.length,
                kept: messagesToKeep.length
            });
        }

        // Prune displayed message IDs if getting too large
        if (displayedMessageIds.size > 1000) {
            const idsArray = Array.from(displayedMessageIds);
            displayedMessageIds.clear();
            idsArray.slice(-500).forEach(id => displayedMessageIds.add(id));
        }
        
        // Update facing for active conversations (keeps NPCs facing players during convo)
        update_conversation_facing().catch(err => {
            console.error("[Breath] Error updating conversation facing:", err);
        });
    } catch (err) {
        current_state = "error";
        console.error(err);
    }
}

// Display message to user - writes to log file so frontend can display it
function displayMessageToUser(msg: MessageEnvelope, log_path: string): void {
    // Use the actual sender (e.g., "npc.grenda", "renderer_ai") so frontend formats it correctly
    // Frontend expects:
    // - sender.startsWith('npc.') -> NPC response formatted as "NPCNAME: content"
    // - sender === 'renderer_ai' -> Assistant response formatted as "ASSISTANT: content"
    // - sender === 'j' or 'J' -> User message formatted as "J: content"
    const sender = msg.sender || "system";
    append_log_message(log_path, sender, msg.content);
    
    debug_log("Display", `Message displayed: ${sender}: ${msg.content?.slice(0, 50)}...`);
}

// run on boot (shell)
function initialize(): { log_path: string; inbox_path: string; outbox_path: string } {
    const data_slot_dir = get_data_slot_dir(data_slot_number);
    const log_path = get_log_path(data_slot_number);
    const inbox_path = get_inbox_path(data_slot_number);
    const outbox_path = get_outbox_path(data_slot_number);
    const status_path = get_status_path(data_slot_number);
    const world_dir = get_world_dir(data_slot_number);
    const item_dir = get_item_dir(data_slot_number);
    const roller_status_path = get_roller_status_path(data_slot_number);

    ensure_dir_exists(data_slot_dir);
    ensure_log_exists(log_path);
    ensure_inbox_exists(inbox_path);
    ensure_outbox_exists(outbox_path);
    ensure_status_exists(status_path);
    ensure_dir_exists(world_dir);
    ensure_dir_exists(item_dir);
    ensure_roller_status_exists(roller_status_path);
    ensure_minimum_game_data(data_slot_number);
    
    // Initialize ActionPipeline for witness reactions and action processing
    initializeActionPipeline(data_slot_number);
    debug_log("Interface Program", "ActionPipeline initialized");

    write_status_line(status_path, "awaiting actor input");

    append_log_message(log_path, "SYSTEM", "INTERFACE_PROGRAM booted");

    // Verify session ID on startup
    debug_log(`[Session] Interface Program session: ${SESSION_ID}`);
    
    return { log_path, inbox_path, outbox_path };
}

// TEMP DEBUG CLI:
// This will be removed/replaced by monospace canvas UI.
// It is not responsible for screen rendering anymore and has been detatched. from powershell console use.
function run_cli(log_path: string): void {

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const loop = () => {
        rl.question("> ", (user_text: string) => {
            const trimmed = user_text.trim();
            if (!trimmed) return loop();

            if (trimmed === "/help") {
                console.log("\nCommands:\n  /help\n  /exit (or /quit)\n");
                return loop();
            }

            if (trimmed === "/exit" || trimmed === "/quit") {
                console.log("Exiting...");
                rl.close();
                process.exit(0);
            }

            // leave a comment to change current_state and send message to the INTERPRETER_AI when user sends a message
            current_state = "processing";
            append_log_message(log_path, "J", trimmed);

            // stub response for now
            append_log_message(log_path, "ASSISTANT", `STUB (no AI yet). You said: ${trimmed}`);

            current_state = "awaiting_user";
            loop();
        });
    };

    loop();
}

// ---- boot ----
const { log_path, inbox_path, outbox_path } = initialize();
log_ai_config();
void boot_ai_services();
start_http_server(log_path);


// Live engine/UI tick (needed for external program inbox + log updates)
setInterval(() => {
    Breath(log_path, inbox_path, outbox_path);
}, 2000);


run_cli(log_path);

// ============================================================================
// CLICK HANDLERS (Called from frontend)
// ============================================================================

/**
 * Handle left click on entity (select target)
 * Called by frontend when user left-clicks an NPC, actor, or item
 */
export function handleEntityClick(entity_ref: string, entity_type: "npc" | "actor" | "item"): void {
    const actor_ref = "actor.henry_actor"; // TODO: Get from session
    
    debug_log("[CLICK]", `Left click on ${entity_type}: ${entity_ref}`);
    
    // Set as target for communication
    setActorTarget(actor_ref, entity_ref, entity_type);
    
    // TODO: Send command to frontend to update UI
    // "Talking to: Grenda"
}

/**
 * Handle right click (move/interact)
 * Called by frontend when user right-clicks
 */
export function handleRightClick(x: number, y: number, entity_ref?: string): void {
    if (entity_ref) {
        // Right-clicked on specific entity - use it
        debug_log("[CLICK]", `Right click on entity: ${entity_ref} at (${x}, ${y})`);
        // TODO: Implement USE action for doors, items, etc.
    } else {
        // Right-clicked on ground - move there
        debug_log("[CLICK]", `Right click on ground at (${x}, ${y})`);
        // TODO: Implement MOVE action
    }
}

/**
 * Handle volume button click
 * Called by frontend when user clicks volume buttons
 */
export function handleVolumeClick(volume: VolumeLevel): void {
    debug_log("[CLICK]", `Volume button clicked: ${volume}`);
    setVolume(volume);
    
    // TODO: Send command to frontend to update UI
    // Highlight selected volume button
}

/**
 * Handle submit communication
 * Called by frontend when user clicks Send or presses Enter
 */
export function handleSubmitCommunication(text: string): void {
    // This is handled in the Breath function via handleCommunicationSubmit
    // But we could add a direct route here for UI-triggered submissions
    debug_log("[CLICK]", `Submit communication: "${text.slice(0, 30)}"`);
}

// ============================================================================
// PROCESS LIFECYCLE
// ============================================================================

process.on("SIGINT", () => {
    shutdown_ollama_if_spawned();
    process.exit(0);
});

process.on("SIGTERM", () => {
    shutdown_ollama_if_spawned();
    process.exit(0);
});

process.on("exit", () => {
    shutdown_ollama_if_spawned();
});
