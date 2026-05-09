import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "jsonc-parser";
import { ensure_dir_exists } from "../engine/log_store.js";
import { get_default_world_path, get_legacy_default_world_path, get_legacy_world_path, get_world_dir, get_world_path, get_data_slot_dir } from "../engine/paths.js";
import { list_places_in_region, load_place } from "../place_storage/store.js";
import { load_actor } from "../actor_storage/store.js";
import { load_npc } from "../npc_storage/store.js";
import type { ActionCost } from "../shared/constants.js";
import { debug_log } from "../shared/debug.js";

export type WorldLookupResult =
    | { ok: true; world: Record<string, unknown>; path: string }
    | { ok: false; error: string; todo: string };

export type RegionLookupResult =
    | { ok: true; region: Record<string, unknown>; path: string }
    | { ok: false; error: string; todo: string };

// Timed Event Types
type InitiativeEntry = {
    actor_ref: string;        // "actor.henry_actor" or "npc.goblin"
    initiative_roll: number;  // 1d20 + DEX bonus
    dex_score: number;        // For tie-breaking
    has_acted_this_turn: boolean;
    actions_remaining: number;
    partial_actions_remaining: number;
    movement_remaining: number;
    movement_budgets?: {
        walk: number;
        climb: number;
        swim: number;
        fly: number;
    };
    status: "active" | "passed" | "left_region" | "done";
};

export type TimedEventPhase = "initiative_turn" | "world_sim_interstitial";

export const DEFAULT_TIMED_EVENT_MOVEMENT_PER_TURN = 6;
export const WORLD_SIM_INTERSTITIAL_BREATHS = 6;

export function timed_event_stat_to_bps(speed: number): number {
    return timed_event_stat_to_bps_mag(speed);
}

function create_default_timed_event_movement_budgets() {
    return {
        walk: DEFAULT_TIMED_EVENT_MOVEMENT_PER_TURN,
        climb: DEFAULT_TIMED_EVENT_MOVEMENT_PER_TURN,
        swim: DEFAULT_TIMED_EVENT_MOVEMENT_PER_TURN,
        fly: DEFAULT_TIMED_EVENT_MOVEMENT_PER_TURN,
    };
}

function sanitize_timed_event_movement_budget(value: unknown, fallback: number): number {
    const num = Math.floor(Number(value));
    if (!Number.isFinite(num)) return Math.max(0, Math.floor(Number(fallback) || 0));
    return Math.max(0, num);
}

function resolve_timed_event_movement_budgets(slot: number, actor_ref: string): { walk: number; climb: number; swim: number; fly: number } {
    const fallback = create_default_timed_event_movement_budgets();
    const ref = String(actor_ref ?? "").trim();
    if (!ref) return fallback;

    let entity: Record<string, unknown> | null = null;
    if (ref.startsWith("actor.")) {
        const result = load_actor(slot, ref.slice("actor.".length));
        entity = result.ok ? result.actor : null;
    } else if (ref.startsWith("npc.")) {
        const result = load_npc(slot, ref.slice("npc.".length));
        entity = result.ok ? result.npc : null;
    }

    const movement = (entity && typeof (entity as any).movement === "object") ? (entity as any).movement : null;
    const resolved = {
        walk: sanitize_timed_event_movement_budget(movement?.walk, fallback.walk),
        climb: sanitize_timed_event_movement_budget(movement?.climb, fallback.climb),
        swim: sanitize_timed_event_movement_budget(movement?.swim, fallback.swim),
        fly: sanitize_timed_event_movement_budget(movement?.fly, fallback.fly),
    };

    debug_log("TIMED_EVENT_MOVE", "resolved timed-event movement budgets", {
        slot,
        actor_ref,
        source: movement ? "entity_record" : "default_fallback",
        movement_source: movement ?? null,
        resolved_budgets: resolved,
    });

    return resolved;
}

function normalize_initiative_entry_movement(entry: InitiativeEntry): InitiativeEntry {
    const budgets = entry.movement_budgets ?? create_default_timed_event_movement_budgets();
    entry.movement_budgets = {
        walk: Math.max(0, Math.floor(Number(budgets.walk) || 0)),
        climb: Math.max(0, Math.floor(Number(budgets.climb) || 0)),
        swim: Math.max(0, Math.floor(Number(budgets.swim) || 0)),
        fly: Math.max(0, Math.floor(Number(budgets.fly) || 0)),
    };
    entry.movement_remaining = entry.movement_budgets.walk;
    return entry;
}

type TimedEventEffect = {
    id: string;
    trigger_turn: number;
    target_ref: string;
    effect_type: string;
    effect_args: Record<string, unknown>;
};

type TimedEventTriggerContext = {
    kind: string;
    source_ref?: string;
    target_refs?: string[];
    summary?: string;
};

export type PendingCommunicationOpportunity = {
    opportunity_id: string;
    event_id?: string;
    queue_entry_id?: string;
    queue_stable_order?: number;
    source_message_id: string;
    npc_ref: string;
    trigger_context?: string;
    created_turn_position_in_round?: number;
    created_round?: number;
    volume?: string;
    conversation_id?: string;
    correlation_id?: string;
    status: "pending" | "in_flight" | "consumed" | "expired" | "cancelled";
};

export type WorldStore = {
    schema_version: number;
    world_tiles: Record<string, WorldTile>;
    timed_event_active?: boolean;
    
    // Timed Event State
    event_id?: string;  // Alias for timed_event_id
    timed_event_id?: string;
    timed_event_type?: "combat" | "conversation" | "exploration";
    timed_event_start_time?: string;  // ISO timestamp
    timed_event_trigger?: TimedEventTriggerContext;
    
    // Turn Management
    current_round?: number;
    initiative_order?: InitiativeEntry[];
    active_actor_index?: number;
    timed_event_phase?: TimedEventPhase;
    timed_event_world_breath_index?: number;
    world_sim_interstitial_breaths_remaining?: number;
    
    // Region tracking for proximity
    event_region?: {
        world_x: number;
        world_y: number;
        region_x: number;
        region_y: number;
    };
    
    // Pending effects
    timed_effects_queue?: TimedEventEffect[];
    pending_communication_opportunities?: PendingCommunicationOpportunity[];
};

// New Region Types - Regions stored in separate files

export type RegionRef = {
    region_id: string;
    region_x: number;
    region_y: number;
};

export type WorldTile = {
    id: string;
    name: string;
    coords: { x: number; y: number };
    temperature: { mag: number };
    description?: string;
    atmosphere?: string;
    regions: RegionRef[]; // References to separate region files
    lore?: {
        history?: string;
        creation_myth?: string;
        current_events?: string[];
    };
};

// Full Region type - loaded from separate files
export type Region = {
    schema_version: number;
    id: string;
    name: string;
    region_type: "outdoor" | "building" | "dungeon" | "wilderness" | "settlement";
    region_bounds?: {
        origin: { x: number; y: number; z: number };
        size: { x: number; y: number; z: number };
    };
    world_coords: {
        world_x: number;
        world_y: number;
        region_x: number;
        region_y: number;
    };
    description: {
        short: string;
        full: string;
        atmosphere: string;
        sensory: {
            sight: string[];
            sound: string[];
            smell: string[];
            touch: string[];
        };
    };
    environment: {
        terrain: string;
        temperature_mag: number;
        lighting: string;
        weather?: string;
        cover_available: string[];
    };
    features: Array<{
        id: string;
        name: string;
        description: string;
        type: "building" | "landmark" | "terrain" | "furniture" | "container" | "obstacle";
        interactable: boolean;
        contains_regions?: string[];
        locked?: boolean;
        contents?: string[];
    }>;
    contents: {
        npcs_present: Array<{
            npc_id: string;
            status: "present" | "active" | "sleeping" | "away";
            activity?: string;
        }>;
        items_on_ground: Array<{
            item_id: string;
            quantity: number;
            condition: "pristine" | "good" | "worn" | "damaged" | "broken";
            hidden?: boolean;
            hidden_dc?: number;
        }>;
        active_effects: Array<{
            effect_type: string;
            mag: number;
            duration?: string;
            source?: string;
        }>;
    };
    exits: Array<{
        direction: string;
        target_region: string;
        description: string;
        blocked: boolean;
        blocked_reason?: string;
        key_required?: string;
        hidden?: boolean;
        hidden_dc?: number;
    }>;
    state: {
        discovered: boolean;
        visited: boolean;
        visit_count: number;
        last_visited?: string;
        notes: string[];
        current_events: string[];
        danger_level: "safe" | "caution" | "dangerous" | "deadly";
        rest_spot: boolean;
    };
    lore: {
        history: string;
        rumors: string[];
        secrets: Array<{
            secret: string;
            discovery_dc: number;
            discovered: boolean;
        }>;
        story_beats_available?: string[];
    };
    resources?: Array<{
        resource_type: string;
        abundance: "none" | "scarce" | "common" | "abundant";
        last_harvested?: string;
        regen_rate?: string;
    }>;
};

// Legacy type for backwards compatibility
export type RegionTile = {
    id: string;
    coords: { world_x: number; world_y: number; region_x: number; region_y: number };
    temperature: { mag: number };
    contents: unknown[];
    notes: string;
};

function read_jsonc(pathname: string): Record<string, unknown> {
    const raw = fs.readFileSync(pathname, "utf-8");
    return (parse(raw) as Record<string, unknown>) ?? {};
}

export type RegionBounds = NonNullable<Region["region_bounds"]>;

function sanitize_region_bounds(bounds: Region["region_bounds"] | null | undefined): RegionBounds | null {
    if (!bounds) return null;
    const ox = Math.floor(Number(bounds.origin?.x ?? 0));
    const oy = Math.floor(Number(bounds.origin?.y ?? 0));
    const oz = Math.floor(Number(bounds.origin?.z ?? 0));
    const sx = Math.max(1, Math.floor(Number(bounds.size?.x ?? 1)) || 1);
    const sy = Math.max(1, Math.floor(Number(bounds.size?.y ?? 1)) || 1);
    const sz = Math.max(1, Math.floor(Number(bounds.size?.z ?? 1)) || 1);
    return { origin: { x: ox, y: oy, z: oz }, size: { x: sx, y: sy, z: sz } };
}

function default_region_bounds(): RegionBounds {
    return { origin: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 } };
}

export function compute_minimum_region_bounds(slot: number, region_id: string): RegionBounds | null {
    const places_res = list_places_in_region(slot, region_id);
    if (!places_res.ok || places_res.places.length < 1) return null;
    let min_x = Number.POSITIVE_INFINITY;
    let min_y = Number.POSITIVE_INFINITY;
    let min_z = Number.POSITIVE_INFINITY;
    let max_x = Number.NEGATIVE_INFINITY;
    let max_y = Number.NEGATIVE_INFINITY;
    let max_z = Number.NEGATIVE_INFINITY;
    let found = false;

    for (const place_id of places_res.places) {
        const place_res = load_place(slot, place_id);
        if (!place_res.ok) continue;
        const bounds = place_res.place.region_bounds;
        if (!bounds) continue;
        const origin_x = Math.floor(Number(bounds.origin.x ?? 0));
        const origin_y = Math.floor(Number(bounds.origin.y ?? 0));
        const origin_z = Math.floor(Number(bounds.origin.z ?? 0));
        const size_x = Math.max(1, Math.floor(Number(bounds.size.x ?? 1)) || 1);
        const size_y = Math.max(1, Math.floor(Number(bounds.size.y ?? 1)) || 1);
        const size_z = Math.max(1, Math.floor(Number(bounds.size.z ?? 1)) || 1);
        min_x = Math.min(min_x, origin_x - 1);
        min_y = Math.min(min_y, origin_y - 1);
        min_z = Math.min(min_z, origin_z - 1);
        max_x = Math.max(max_x, origin_x + size_x);
        max_y = Math.max(max_y, origin_y + size_y);
        max_z = Math.max(max_z, origin_z + size_z);
        found = true;
    }

    if (!found) return null;
    return {
        origin: { x: min_x, y: min_y, z: min_z },
        size: { x: Math.max(1, max_x - min_x + 1), y: Math.max(1, max_y - min_y + 1), z: Math.max(1, max_z - min_z + 1) },
    };
}

function normalize_region_bounds(slot: number, region: Region): { region: Region; changed: boolean } {
    const existing = sanitize_region_bounds(region.region_bounds);
    const minimum = compute_minimum_region_bounds(slot, region.id);
    if (!existing && !minimum) {
        region.region_bounds = default_region_bounds();
        return { region, changed: true };
    }
    if (!existing && minimum) {
        region.region_bounds = minimum;
        return { region, changed: true };
    }
    if (!existing) return { region, changed: false };
    if (!minimum) {
        if (JSON.stringify(region.region_bounds) !== JSON.stringify(existing)) {
            region.region_bounds = existing;
            return { region, changed: true };
        }
        return { region, changed: false };
    }

    const min_end_x = minimum.origin.x + minimum.size.x - 1;
    const min_end_y = minimum.origin.y + minimum.size.y - 1;
    const min_end_z = minimum.origin.z + minimum.size.z - 1;
    const cur_end_x = existing.origin.x + existing.size.x - 1;
    const cur_end_y = existing.origin.y + existing.size.y - 1;
    const cur_end_z = existing.origin.z + existing.size.z - 1;
    const merged: RegionBounds = {
        origin: {
            x: Math.min(existing.origin.x, minimum.origin.x),
            y: Math.min(existing.origin.y, minimum.origin.y),
            z: Math.min(existing.origin.z, minimum.origin.z),
        },
        size: {
            x: Math.max(cur_end_x, min_end_x) - Math.min(existing.origin.x, minimum.origin.x) + 1,
            y: Math.max(cur_end_y, min_end_y) - Math.min(existing.origin.y, minimum.origin.y) + 1,
            z: Math.max(cur_end_z, min_end_z) - Math.min(existing.origin.z, minimum.origin.z) + 1,
        },
    };
    if (JSON.stringify(existing) !== JSON.stringify(merged)) {
        region.region_bounds = merged;
        return { region, changed: true };
    }
    if (JSON.stringify(region.region_bounds) !== JSON.stringify(existing)) {
        region.region_bounds = existing;
        return { region, changed: true };
    }
    return { region, changed: false };
}

// Region file loading

export function get_region_path(slot: number, region_id: string): string {
    const data_slot_dir = get_data_slot_dir(slot);
    return path.join(data_slot_dir, "regions", `${region_id}.jsonc`);
}

export function load_region(slot: number, region_id: string): { ok: true; region: Region; path: string } | { ok: false; error: string } {
    const region_path = get_region_path(slot, region_id);
    
    if (!fs.existsSync(region_path)) {
        return { ok: false, error: `region_not_found: ${region_id}` };
    }
    
    try {
        const raw = fs.readFileSync(region_path, "utf-8");
        const region = parse(raw) as Region;
        const normalized = normalize_region_bounds(slot, region);
        if (normalized.changed) {
            ensure_dir_exists(path.dirname(region_path));
            fs.writeFileSync(region_path, JSON.stringify(normalized.region, null, 2), "utf-8");
        }
        return { ok: true, region: normalized.region, path: region_path };
    } catch (e) {
        return { ok: false, error: `failed_to_parse_region: ${e instanceof Error ? e.message : String(e)}` };
    }
}

export function save_region(slot: number, region: Region): boolean {
    const region_path = get_region_path(slot, region.id);
    const region_dir = path.dirname(region_path);
    
    try {
        ensure_dir_exists(region_dir);
        const normalized = normalize_region_bounds(slot, region);
        fs.writeFileSync(region_path, JSON.stringify(normalized.region, null, 2), "utf-8");
        return true;
    } catch {
        return false;
    }
}

export function list_regions(slot: number): string[] {
    const regions_dir = path.join(get_data_slot_dir(slot), "regions");
    
    if (!fs.existsSync(regions_dir)) {
        return [];
    }
    
    try {
        const files = fs.readdirSync(regions_dir);
        return files
            .filter(f => f.endsWith(".jsonc"))
            .map(f => f.replace(".jsonc", ""));
    } catch {
        return [];
    }
}

// Legacy helper functions (for backwards compatibility)

function make_empty_region_grid(): (RegionTile | null)[][] {
    return Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => null));
}

function make_default_region_tile(world_x: number, world_y: number, region_x: number, region_y: number): RegionTile {
    return {
        id: `region_${world_x}_${world_y}_${region_x}_${region_y}`,
        coords: { world_x, world_y, region_x, region_y },
        temperature: { mag: 0 },
        contents: [],
        notes: "",
    };
}

function make_default_world_tile(x: number, y: number): WorldTile {
    return {
        id: `world_tile_${x}_${y}`,
        name: `World Tile ${x},${y}`,
        coords: { x, y },
        temperature: { mag: 0 },
        description: "",
        atmosphere: "",
        regions: [],
        lore: {
            history: "",
            current_events: []
        }
    };
}

export function ensure_world_exists(slot: number): WorldLookupResult {
    const world_path = get_world_path(slot);
    const world_dir = get_world_dir(slot);
    ensure_dir_exists(world_dir);

    if (fs.existsSync(world_path)) {
        const world = read_jsonc(world_path) as WorldStore;
        return { ok: true, world, path: world_path };
    }
    const legacy_world_path = get_legacy_world_path(slot);
    if (fs.existsSync(legacy_world_path)) {
        fs.copyFileSync(legacy_world_path, world_path);
        const world = read_jsonc(world_path) as WorldStore;
        return { ok: true, world, path: world_path };
    }

    const template_path = get_default_world_path();
    if (!fs.existsSync(template_path)) {
        const legacy_path = get_legacy_default_world_path();
        if (fs.existsSync(legacy_path)) {
            ensure_dir_exists(path.dirname(template_path));
            fs.copyFileSync(legacy_path, template_path);
        } else {
            const todo = `Default world template missing. Create ${template_path}`;
            return { ok: false, error: "default_world_missing", todo };
        }
    }

    const world = read_jsonc(template_path) as WorldStore;
    fs.writeFileSync(world_path, JSON.stringify(world, null, 2), "utf-8");
    return { ok: true, world, path: world_path };
}

export function is_timed_event_active(slot: number): boolean {
    const world = ensure_world_exists(slot);
    if (!world.ok) return false;
    const store = world.world as WorldStore;
    return Boolean(store.timed_event_active);
}

export function ensure_world_tile(slot: number, x: number, y: number): WorldLookupResult {
    const world = ensure_world_exists(slot);
    if (!world.ok) return world;

    const store = world.world as WorldStore;
    const key = `${x},${y}`;
    if (!store.world_tiles) store.world_tiles = {};
    if (!store.world_tiles[key]) {
        store.world_tiles[key] = make_default_world_tile(x, y);
        fs.writeFileSync(world.path, JSON.stringify(store, null, 2), "utf-8");
    }

    return { ok: true, world: store.world_tiles[key] as unknown as Record<string, unknown>, path: world.path };
}

// Get region by coordinates from world tile
export function get_region_by_coords(
    slot: number,
    world_x: number,
    world_y: number,
    region_x: number,
    region_y: number,
): { ok: true; region: Region; region_id: string } | { ok: false; error: string } {
    const world = ensure_world_exists(slot);
    if (!world.ok) return { ok: false, error: world.error };

    const store = world.world as WorldStore;
    const key = `${world_x},${world_y}`;
    const tile = store.world_tiles?.[key];

    if (!tile) {
        return { ok: false, error: `world_tile_not_found: ${key}` };
    }

    // Find region reference in the world tile
    const region_ref = tile.regions?.find(
        r => r.region_x === region_x && r.region_y === region_y
    );

    if (!region_ref) {
        return { ok: false, error: `region_not_found_at_coords: ${world_x},${world_y},${region_x},${region_y}` };
    }

    // Load the region from file
    const region_result = load_region(slot, region_ref.region_id);
    if (!region_result.ok) {
        return { ok: false, error: region_result.error };
    }

    return { ok: true, region: region_result.region, region_id: region_ref.region_id };
}

// Legacy function for backwards compatibility
export function ensure_region_tile(
    slot: number,
    world_x: number,
    world_y: number,
    region_x: number,
    region_y: number,
): RegionLookupResult {
    // Try to load from new system first
    const result = get_region_by_coords(slot, world_x, world_y, region_x, region_y);
    if (result.ok) {
        return { ok: true, region: result.region as unknown as Record<string, unknown>, path: get_region_path(slot, result.region_id) };
    }
    
    // Fall back to legacy behavior
    const world = ensure_world_exists(slot);
    if (!world.ok) return world;

    const store = world.world as WorldStore;
    const key = `${world_x},${world_y}`;
    if (!store.world_tiles) store.world_tiles = {};
    if (!store.world_tiles[key]) {
        store.world_tiles[key] = make_default_world_tile(world_x, world_y);
    }

    const tile = store.world_tiles[key];
    const regions = (tile.regions as unknown as (RegionTile | null)[][]) ?? make_empty_region_grid();
    (tile as unknown as { regions: (RegionTile | null)[][] }).regions = regions;
    if (region_x < 0 || region_x > 9 || region_y < 0 || region_y > 9) {
        return { ok: false, error: "region_out_of_bounds", todo: "Region coords must be 0-9 within a world tile" };
    }
    if (!regions[region_y]![region_x]) {
        regions[region_y]![region_x] = make_default_region_tile(world_x, world_y, region_x, region_y);
        fs.writeFileSync(world.path, JSON.stringify(store, null, 2), "utf-8");
    }

    return { ok: true, region: regions[region_y]![region_x] as unknown as Record<string, unknown>, path: world.path };
}

export function get_world_tile(slot: number, x: number, y: number): WorldLookupResult {
    const world = ensure_world_exists(slot);
    if (!world.ok) return world;

    const key = `${x},${y}`;
    const store = world.world as WorldStore;
    const tile = store.world_tiles?.[key];

    if (!tile) {
        const todo = `World tile not found at ${key}. Create world tile in ${world.path}`;
        return { ok: false, error: "world_tile_missing", todo };
    }

    return { ok: true, world: tile as unknown as Record<string, unknown>, path: world.path };
}

export function get_region_tile(slot: number, world_x: number, world_y: number, region_x: number, region_y: number): RegionLookupResult {
    // Try new system first
    const result = get_region_by_coords(slot, world_x, world_y, region_x, region_y);
    if (result.ok) {
        return { ok: true, region: result.region as unknown as Record<string, unknown>, path: get_region_path(slot, result.region_id) };
    }
    
    // Fall back to legacy system
    const world = ensure_world_exists(slot);
    if (!world.ok) return world;

    const key = `${world_x},${world_y}`;
    const store = world.world as WorldStore;
    const tile = store.world_tiles?.[key];

    if (!tile) {
        const todo = `World tile not found at ${key}. Create world tile in ${world.path}`;
        return { ok: false, error: "world_tile_missing", todo };
    }

    if (region_x < 0 || region_x > 9 || region_y < 0 || region_y > 9) {
        return { ok: false, error: "region_out_of_bounds", todo: "Region coords must be 0-9 within a world tile" };
    }

    const regions = (tile.regions as unknown as (RegionTile | null)[][]) ?? make_empty_region_grid();
    const region = regions[region_y]?.[region_x] ?? null;

    if (!region) {
        const todo = `Region tile not found at (${region_x},${region_y}) in world tile ${key}. Create region tile.`;
        return { ok: false, error: "region_tile_missing", todo };
    }

    return { ok: true, region: region as unknown as Record<string, unknown>, path: world.path };
}

// Timed Event Management Functions

export function get_timed_event_state(slot: number): WorldStore | null {
    const world = ensure_world_exists(slot);
    if (!world.ok) return null;
    const store = world.world as WorldStore;
    if (Array.isArray(store.initiative_order)) {
        for (const entry of store.initiative_order) normalize_initiative_entry_movement(entry);
    }
    return store;
}

export function save_world_store(slot: number, store: WorldStore): boolean {
    const world_path = get_world_path(slot);
    try {
        fs.writeFileSync(world_path, JSON.stringify(store, null, 2), "utf-8");
        return true;
    } catch {
        return false;
    }
}

export function start_timed_event(
    slot: number,
    event_type: "combat" | "conversation" | "exploration",
    participants: string[],
    region: { world_x: number; world_y: number; region_x: number; region_y: number },
    options?: {
        trigger?: TimedEventTriggerContext;
    },
): { ok: true; event_id: string } | { ok: false; error: string } {
    const world = ensure_world_exists(slot);
    if (!world.ok) return { ok: false, error: world.error };
    
    const store = world.world as WorldStore;
    const event_id = `timed_event_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    
    store.timed_event_active = true;
    store.timed_event_id = event_id;
    store.timed_event_type = event_type;
    store.timed_event_start_time = new Date().toISOString();
    store.timed_event_trigger = options?.trigger ? {
        kind: String(options.trigger.kind ?? "unknown"),
        source_ref: typeof options.trigger.source_ref === "string" ? options.trigger.source_ref : undefined,
        target_refs: Array.isArray(options.trigger.target_refs)
            ? options.trigger.target_refs.filter((ref): ref is string => typeof ref === "string" && ref.length > 0)
            : undefined,
        summary: typeof options.trigger.summary === "string" ? options.trigger.summary : undefined,
    } : undefined;
    store.current_round = 1;
    store.timed_event_phase = "initiative_turn";
    store.timed_event_world_breath_index = 0;
    store.world_sim_interstitial_breaths_remaining = undefined;
    store.initiative_order = participants.map((ref): InitiativeEntry => ({
        actor_ref: ref,
        initiative_roll: 0,  // Will be set by turn manager
        dex_score: 0,        // Will be set by turn manager
        has_acted_this_turn: false,
        actions_remaining: 1,
        partial_actions_remaining: 1,
        movement_remaining: 0,
        movement_budgets: resolve_timed_event_movement_budgets(slot, ref),
        status: "active"
    })).map(normalize_initiative_entry_movement);
    store.active_actor_index = 0;
    store.event_region = region;
    store.timed_effects_queue = [];
    
    if (!save_world_store(slot, store)) {
        return { ok: false, error: "failed_to_save_world" };
    }
    debug_log("TIMED_EVENT_BREATH", "timed event started with frozen world breaths", {
        slot,
        event_id,
        event_type,
        participants: participants.length,
        timed_event_world_breath_index: store.timed_event_world_breath_index ?? 0,
        world_sim_interstitial_breaths_remaining: WORLD_SIM_INTERSTITIAL_BREATHS,
    });
    
    return { ok: true, event_id };
}

export function end_timed_event(slot: number): boolean {
    const world = ensure_world_exists(slot);
    if (!world.ok) return false;
    
    const store = world.world as WorldStore;
    store.timed_event_active = false;
    store.timed_event_id = undefined;
    store.timed_event_type = undefined;
    store.timed_event_start_time = undefined;
    store.timed_event_trigger = undefined;
    store.pending_communication_opportunities = undefined;
    store.current_round = undefined;
    store.initiative_order = undefined;
    store.active_actor_index = undefined;
    store.timed_event_phase = undefined;
    store.timed_event_world_breath_index = undefined;
    store.world_sim_interstitial_breaths_remaining = undefined;
    store.event_region = undefined;
    store.timed_effects_queue = undefined;
    debug_log("TIMED_EVENT_BREATH", "timed event ended and normal world breaths resumed", {
        slot,
    });
    
    return save_world_store(slot, store);
}

export function clear_stale_timed_event(slot: number, reason: string): { ok: true; cleared: boolean } | { ok: false; error: string } {
    const world = ensure_world_exists(slot);
    if (!world.ok) return { ok: false, error: world.error };

    const store = world.world as WorldStore;
    if (!store.timed_event_active) {
        debug_log("TIMED_EVENT_BOOT", "no stale timed event to clear", {
            slot,
            reason,
        });
        return { ok: true, cleared: false };
    }

    const snapshot = {
        event_id: store.timed_event_id ?? store.event_id ?? null,
        event_type: store.timed_event_type ?? null,
        current_round: store.current_round ?? null,
        timed_event_phase: store.timed_event_phase ?? null,
        active_actor_index: typeof store.active_actor_index === "number" ? store.active_actor_index : null,
        active_actor_ref: (typeof store.active_actor_index === "number" && Array.isArray(store.initiative_order))
            ? (store.initiative_order[store.active_actor_index]?.actor_ref ?? null)
            : null,
        timed_event_world_breath_index: store.timed_event_world_breath_index ?? null,
    };

    const cleared = end_timed_event(slot);
    if (!cleared) return { ok: false, error: "failed_to_clear_stale_timed_event" };

    debug_log("TIMED_EVENT_BOOT", "cleared stale timed event on boot", {
        slot,
        reason,
        ...snapshot,
    });
    return { ok: true, cleared: true };
}

export function get_active_actor_ref(slot: number): string | null {
    const store = get_timed_event_state(slot);
    if (!store?.timed_event_active || store.timed_event_phase === "world_sim_interstitial" || !store.initiative_order || store.active_actor_index === undefined) {
        return null;
    }
    
    const entry = store.initiative_order[store.active_actor_index];
    return entry?.actor_ref ?? null;
}

export function get_timed_event_phase(slot: number): TimedEventPhase | null {
    const store = get_timed_event_state(slot);
    if (!store?.timed_event_active) return null;
    return store.timed_event_phase === "world_sim_interstitial" ? "world_sim_interstitial" : "initiative_turn";
}

export function is_timed_event_world_sim_interstitial(slot: number): boolean {
    return get_timed_event_phase(slot) === "world_sim_interstitial";
}

export function get_world_sim_interstitial_total_breaths(slot: number): number {
    const store = get_timed_event_state(slot);
    if (!store?.timed_event_active) return WORLD_SIM_INTERSTITIAL_BREATHS;
    return WORLD_SIM_INTERSTITIAL_BREATHS;
}

export function get_timed_event_world_breath_index(slot: number): number | null {
    const store = get_timed_event_state(slot);
    if (!store?.timed_event_active) return null;
    const value = Math.floor(Number(store.timed_event_world_breath_index ?? 0));
    return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function advance_timed_event_world_breaths(slot: number, breaths: number): { ok: true; world_breath_index: number; remaining_interstitial_breaths: number | null } | { ok: false; error: string } {
    const world = ensure_world_exists(slot);
    if (!world.ok) return { ok: false, error: world.error };

    const store = world.world as WorldStore;
    if (!store.timed_event_active) return { ok: false, error: "no_active_timed_event" };

    const applied = Math.max(0, Math.floor(Number(breaths) || 0));
    const current = Math.max(0, Math.floor(Number(store.timed_event_world_breath_index ?? 0)) || 0);
    store.timed_event_world_breath_index = current + applied;

    if (store.timed_event_phase === "world_sim_interstitial") {
        const remaining = Math.max(0, Math.floor(Number(store.world_sim_interstitial_breaths_remaining ?? WORLD_SIM_INTERSTITIAL_BREATHS)) || WORLD_SIM_INTERSTITIAL_BREATHS);
        store.world_sim_interstitial_breaths_remaining = Math.max(0, remaining - applied);
    }

    if (!save_world_store(slot, store)) return { ok: false, error: "failed_to_save" };
    return {
        ok: true,
        world_breath_index: store.timed_event_world_breath_index ?? 0,
        remaining_interstitial_breaths: store.timed_event_phase === "world_sim_interstitial"
            ? Math.max(0, Math.floor(Number(store.world_sim_interstitial_breaths_remaining ?? 0)) || 0)
            : null,
    };
}

export function get_world_sim_interstitial_breaths_remaining(slot: number): number | null {
    const store = get_timed_event_state(slot);
    if (!store?.timed_event_active) return null;
    if (store.timed_event_phase !== "world_sim_interstitial") {
        return null;
    }
    const remaining = Math.floor(Number(store.world_sim_interstitial_breaths_remaining ?? WORLD_SIM_INTERSTITIAL_BREATHS)) || WORLD_SIM_INTERSTITIAL_BREATHS;
    return Math.max(0, remaining);
}

export function is_timed_event_participant(slot: number, actor_ref: string): boolean {
    const store = get_timed_event_state(slot);
    if (!store?.timed_event_active || !Array.isArray(store.initiative_order)) return false;
    return store.initiative_order.some((entry) => entry.actor_ref === actor_ref);
}

function reset_initiative_round_entries(slot: number, entries: InitiativeEntry[]): void {
    for (const entry of entries) {
        if (entry.status === "left_region") continue;
        entry.status = "active";
        entry.has_acted_this_turn = false;
        entry.actions_remaining = 1;
        entry.partial_actions_remaining = 1;
        entry.movement_budgets = resolve_timed_event_movement_budgets(slot, entry.actor_ref);
        normalize_initiative_entry_movement(entry);
    }
}

function begin_world_sim_interstitial(store: WorldStore): void {
    store.timed_event_phase = "world_sim_interstitial";
    store.active_actor_index = undefined;
    store.world_sim_interstitial_breaths_remaining = WORLD_SIM_INTERSTITIAL_BREATHS;
}

export function finalize_world_sim_interstitial(slot: number): { ok: true; current_round: number; active_actor: string | null; active_actor_index: number } | { ok: false; error: string } {
    const world = ensure_world_exists(slot);
    if (!world.ok) return { ok: false, error: world.error };

    const store = world.world as WorldStore;
    if (!store.timed_event_active || !store.initiative_order) return { ok: false, error: "no_active_timed_event" };

    store.current_round = (store.current_round ?? 1) + 1;
    reset_initiative_round_entries(slot, store.initiative_order);
    store.active_actor_index = 0;
    store.timed_event_phase = "initiative_turn";
    store.timed_event_world_breath_index = Math.max(0, Math.floor(Number(store.timed_event_world_breath_index ?? 0)) || 0);
    store.world_sim_interstitial_breaths_remaining = undefined;

    debug_log("TIMED_EVENT_TURN", "finalized world sim interstitial", {
        slot,
        current_round: store.current_round ?? 1,
        active_actor_index: 0,
        active_actor: store.initiative_order[0]?.actor_ref ?? null,
        timed_event_world_breath_index: store.timed_event_world_breath_index ?? 0,
    });

    if (!save_world_store(slot, store)) return { ok: false, error: "failed_to_save" };
    return { ok: true, current_round: store.current_round ?? 1, active_actor: store.initiative_order[0]?.actor_ref ?? null, active_actor_index: 0 };
}

function get_initiative_entry(slot: number, actor_ref: string): InitiativeEntry | null {
    const store = get_timed_event_state(slot);
    if (!store?.timed_event_active || !store.initiative_order) return null;
    const entry = store.initiative_order.find((entry) => entry.actor_ref === actor_ref) ?? null;
    return entry ? normalize_initiative_entry_movement(entry) : null;
}

export function should_auto_end_actor_turn(slot: number, actor_ref: string): boolean {
    const entry = get_initiative_entry(slot, actor_ref);
    if (!entry) return false;
    const actions_remaining = Math.max(0, Math.floor(Number(entry.actions_remaining ?? 0)) || 0);
    const partial_actions_remaining = Math.max(0, Math.floor(Number(entry.partial_actions_remaining ?? 0)) || 0);
    const budgets = normalize_initiative_entry_movement(entry).movement_budgets!;
    const total_movement_remaining = Math.max(0, Math.floor(Number(budgets.walk ?? 0)) || 0)
        + Math.max(0, Math.floor(Number(budgets.climb ?? 0)) || 0)
        + Math.max(0, Math.floor(Number(budgets.swim ?? 0)) || 0)
        + Math.max(0, Math.floor(Number(budgets.fly ?? 0)) || 0);
    return actions_remaining <= 0 && partial_actions_remaining <= 0 && total_movement_remaining <= 0;
}


export function can_actor_afford_action_cost(slot: number, actor_ref: string, cost: ActionCost): boolean {
    const store = get_timed_event_state(slot);
    if (!store?.timed_event_active) return true;
    const entry = get_initiative_entry(slot, actor_ref);
    if (!entry) return false;

    switch (cost) {
        case "FREE":
            return true;
        case "PARTIAL":
            return (entry.partial_actions_remaining ?? 0) > 0;
        case "FULL":
            return (entry.actions_remaining ?? 0) > 0;
        case "EXTENDED":
            return (entry.actions_remaining ?? 0) > 0 && (entry.partial_actions_remaining ?? 0) > 0;
        default:
            return false;
    }
}

export function can_actor_afford_movement_cost(slot: number, actor_ref: string, movement_cost: number): boolean {
    const store = get_timed_event_state(slot);
    if (!store?.timed_event_active) return true;
    if (store.timed_event_phase === "world_sim_interstitial") return false;
    const entry = get_initiative_entry(slot, actor_ref);
    if (!entry) return false;
    const cost = Math.max(0, Math.floor(Number(movement_cost) || 0));
    const budgets = normalize_initiative_entry_movement(entry).movement_budgets!;
    const available = Math.max(
        Math.floor(Number(budgets.walk ?? 0)) || 0,
        Math.floor(Number(budgets.climb ?? 0)) || 0,
        Math.floor(Number(budgets.swim ?? 0)) || 0,
        Math.floor(Number(budgets.fly ?? 0)) || 0,
    );
    return available >= cost;
}

export function consume_actor_action_cost(slot: number, actor_ref: string, cost: ActionCost): boolean {
    const world = ensure_world_exists(slot);
    if (!world.ok) return false;

    const store = world.world as WorldStore;
    if (!store.timed_event_active || !store.initiative_order) return true;
    const entry = store.initiative_order.find((it) => it.actor_ref === actor_ref);
    if (!entry) return false;
    if (!can_actor_afford_action_cost(slot, actor_ref, cost)) return false;

    switch (cost) {
        case "FREE":
            break;
        case "PARTIAL":
            entry.partial_actions_remaining = Math.max(0, (entry.partial_actions_remaining ?? 0) - 1);
            break;
        case "FULL":
            entry.actions_remaining = Math.max(0, (entry.actions_remaining ?? 0) - 1);
            break;
        case "EXTENDED":
            entry.actions_remaining = Math.max(0, (entry.actions_remaining ?? 0) - 1);
            entry.partial_actions_remaining = Math.max(0, (entry.partial_actions_remaining ?? 0) - 1);
            break;
    }

    entry.has_acted_this_turn = true;
    return save_world_store(slot, store);
}

export function consume_actor_movement_cost(slot: number, actor_ref: string, movement_cost: number): boolean {
    const world = ensure_world_exists(slot);
    if (!world.ok) return false;

    const store = world.world as WorldStore;
    if (!store.timed_event_active || !store.initiative_order) return true;
    const entry = store.initiative_order.find((it) => it.actor_ref === actor_ref);
    if (!entry) return false;
    const cost = Math.max(0, Math.floor(Number(movement_cost) || 0));
    const before = normalize_initiative_entry_movement(entry);
    if (!can_actor_afford_movement_cost(slot, actor_ref, cost)) {
        debug_log("TIMED_EVENT_MOVE", "movement cost denied", {
            slot,
            actor_ref,
            cost,
            movement_budgets: before.movement_budgets,
            movement_remaining: before.movement_remaining,
            timed_event_phase: store.timed_event_phase ?? null,
            current_round: store.current_round ?? null,
            active_actor_index: typeof store.active_actor_index === "number" ? store.active_actor_index : null,
        });
        return false;
    }
    const normalized = before;
    const before_budgets = { ...normalized.movement_budgets! };
    normalized.movement_budgets = {
        walk: Math.max(0, normalized.movement_budgets!.walk - cost),
        climb: Math.max(0, normalized.movement_budgets!.climb - cost),
        swim: Math.max(0, normalized.movement_budgets!.swim - cost),
        fly: Math.max(0, normalized.movement_budgets!.fly - cost),
    };
    normalize_initiative_entry_movement(normalized);
    entry.has_acted_this_turn = true;
    debug_log("TIMED_EVENT_MOVE", "movement cost consumed", {
        slot,
        actor_ref,
        cost,
        movement_budgets_before: before_budgets,
        movement_budgets_after: normalized.movement_budgets,
        movement_remaining_after: normalized.movement_remaining,
        timed_event_phase: store.timed_event_phase ?? null,
        current_round: store.current_round ?? null,
        active_actor_index: typeof store.active_actor_index === "number" ? store.active_actor_index : null,
    });
    return save_world_store(slot, store);
}

export function refill_actor_movement_budgets(slot: number, actor_ref: string): boolean {
    const world = ensure_world_exists(slot);
    if (!world.ok) return false;

    const store = world.world as WorldStore;
    if (!store.timed_event_active || !store.initiative_order) return true;
    const entry = store.initiative_order.find((it) => it.actor_ref === actor_ref);
    if (!entry) return false;

    const before = entry.movement_budgets ? { ...entry.movement_budgets } : null;
    entry.movement_budgets = resolve_timed_event_movement_budgets(slot, actor_ref);
    normalize_initiative_entry_movement(entry);
    entry.has_acted_this_turn = true;
    debug_log("TIMED_EVENT_MOVE", "refilled actor movement budgets from persisted movement", {
        slot,
        actor_ref,
        movement_budgets_before: before,
        movement_budgets_after: entry.movement_budgets ?? null,
        movement_remaining_after: entry.movement_remaining ?? null,
    });
    return save_world_store(slot, store);
}

export function perform_move_action_refresh(slot: number, actor_ref: string, cost: ActionCost): { ok: true } | { ok: false; error: string } {
    const active_actor_ref = get_active_actor_ref(slot);
    if (!active_actor_ref) return { ok: false, error: "no_active_timed_event" };
    if (active_actor_ref !== actor_ref) return { ok: false, error: "not_your_turn" };
    if (!can_actor_afford_action_cost(slot, actor_ref, cost)) return { ok: false, error: `cannot_afford_${String(cost).toLowerCase()}` };
    if (!consume_actor_action_cost(slot, actor_ref, cost)) return { ok: false, error: "failed_to_consume_action_cost" };
    if (!refill_actor_movement_budgets(slot, actor_ref)) return { ok: false, error: "failed_to_refill_movement" };
    return { ok: true };
}

export function queue_pending_communication_opportunity(slot: number, opp: Omit<PendingCommunicationOpportunity, "opportunity_id" | "status">): { ok: true; opportunity_id: string } | { ok: false; error: string } {
    const world = ensure_world_exists(slot);
    if (!world.ok) return { ok: false, error: world.error };

    const store = world.world as WorldStore;
    const opportunity_id = `comm_opp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const list = Array.isArray(store.pending_communication_opportunities) ? store.pending_communication_opportunities : [];

    const already_exists = list.some((existing) =>
        existing.status === "pending" &&
        (
            (typeof opp.queue_entry_id === "string" && opp.queue_entry_id.length > 0 && existing.queue_entry_id === opp.queue_entry_id) ||
            (existing.source_message_id === opp.source_message_id && existing.npc_ref === opp.npc_ref)
        ),
    );
    if (already_exists) {
        const existing_opp = list.find((e) =>
            (typeof opp.queue_entry_id === "string" && opp.queue_entry_id.length > 0 && e.queue_entry_id === opp.queue_entry_id) ||
            (e.source_message_id === opp.source_message_id && e.npc_ref === opp.npc_ref)
        ) ?? null;
        debug_log("TIMED_EVENT_COMM", "queue skipped duplicate pending opportunity", {
            slot,
            npc_ref: opp.npc_ref,
            source_message_id: opp.source_message_id,
            queue_entry_id: opp.queue_entry_id ?? null,
            queue_stable_order: opp.queue_stable_order ?? null,
            correlation_id: opp.correlation_id ?? null,
            conversation_id: opp.conversation_id ?? null,
            opportunity_id: existing_opp?.opportunity_id ?? opportunity_id,
            existing_status: existing_opp?.status ?? null,
        });
        return { ok: true, opportunity_id: existing_opp?.opportunity_id ?? opportunity_id };
    }

    list.push({
        ...opp,
        opportunity_id,
        status: "pending",
    });
    store.pending_communication_opportunities = list;
    const saved = save_world_store(slot, store);
    debug_log("TIMED_EVENT_COMM", saved ? "queued pending communication opportunity" : "failed to queue pending communication opportunity", {
        slot,
        npc_ref: opp.npc_ref,
        source_message_id: opp.source_message_id,
        queue_entry_id: opp.queue_entry_id ?? null,
        queue_stable_order: opp.queue_stable_order ?? null,
        correlation_id: opp.correlation_id ?? null,
        conversation_id: opp.conversation_id ?? null,
        opportunity_id,
        created_turn_position_in_round: opp.created_turn_position_in_round ?? null,
        created_round: opp.created_round ?? null,
        trigger_context: opp.trigger_context ?? null,
    });
    return saved ? { ok: true, opportunity_id } : { ok: false, error: "save_failed" };
}

export function consume_pending_communication_opportunity(slot: number, npc_ref: string): PendingCommunicationOpportunity | null {
    const world = ensure_world_exists(slot);
    if (!world.ok) return null;

    const store = world.world as WorldStore;
    const list = Array.isArray(store.pending_communication_opportunities) ? store.pending_communication_opportunities : [];
    const candidates = list
        .map((opp, index) => ({ opp, index }))
        .filter(({ opp }) => opp.npc_ref === npc_ref && opp.status === "pending")
        .sort((a, b) => {
            const orderA = Math.floor(Number(a.opp.queue_stable_order ?? Number.MAX_SAFE_INTEGER));
            const orderB = Math.floor(Number(b.opp.queue_stable_order ?? Number.MAX_SAFE_INTEGER));
            if (orderA !== orderB) return orderA - orderB;
            const roundA = Math.floor(Number(a.opp.created_round ?? Number.MAX_SAFE_INTEGER));
            const roundB = Math.floor(Number(b.opp.created_round ?? Number.MAX_SAFE_INTEGER));
            if (roundA !== roundB) return roundA - roundB;
            const turnA = Math.floor(Number(a.opp.created_turn_position_in_round ?? Number.MAX_SAFE_INTEGER));
            const turnB = Math.floor(Number(b.opp.created_turn_position_in_round ?? Number.MAX_SAFE_INTEGER));
            if (turnA !== turnB) return turnA - turnB;
            return a.index - b.index;
        });
    const idx = candidates[0]?.index ?? -1;
    if (idx < 0) {
        debug_log("TIMED_EVENT_COMM", "no pending communication opportunity to consume", {
            slot,
            npc_ref,
            available: list.filter((opp) => opp.npc_ref === npc_ref).map((opp) => ({
                opportunity_id: opp.opportunity_id,
                status: opp.status,
                source_message_id: opp.source_message_id,
                queue_entry_id: opp.queue_entry_id ?? null,
                queue_stable_order: opp.queue_stable_order ?? null,
                correlation_id: opp.correlation_id ?? null,
            })),
        });
        return null;
    }

    const opp = list[idx]!;
    opp.status = "in_flight";
    store.pending_communication_opportunities = list;
    if (!save_world_store(slot, store)) {
        debug_log("TIMED_EVENT_COMM", "failed to mark communication opportunity in_flight", {
            slot,
            npc_ref,
            opportunity_id: opp.opportunity_id,
            source_message_id: opp.source_message_id,
        });
        return null;
    }
    debug_log("TIMED_EVENT_COMM", "consumed pending communication opportunity", {
        slot,
        npc_ref,
        opportunity_id: opp.opportunity_id,
        source_message_id: opp.source_message_id,
        queue_entry_id: opp.queue_entry_id ?? null,
        queue_stable_order: opp.queue_stable_order ?? null,
        correlation_id: opp.correlation_id ?? null,
        conversation_id: opp.conversation_id ?? null,
    });
    return { ...opp };
}

export function complete_pending_communication_opportunity(slot: number, opportunity_id: string): boolean {
    const world = ensure_world_exists(slot);
    if (!world.ok) return false;
    const store = world.world as WorldStore;
    const list = Array.isArray(store.pending_communication_opportunities) ? store.pending_communication_opportunities : [];
    const idx = list.findIndex((opp) => opp.opportunity_id === opportunity_id);
    if (idx < 0) {
        debug_log("TIMED_EVENT_COMM", "attempted to complete missing communication opportunity", { slot, opportunity_id });
        return false;
    }
    const opp = list[idx]!;
    opp.status = "consumed";
    store.pending_communication_opportunities = list.filter((item) => item.status === "pending" || item.status === "in_flight");
    const saved = save_world_store(slot, store);
    debug_log("TIMED_EVENT_COMM", saved ? "completed communication opportunity" : "failed to complete communication opportunity", {
        slot,
        opportunity_id,
        npc_ref: opp.npc_ref,
        source_message_id: opp.source_message_id,
        queue_entry_id: opp.queue_entry_id ?? null,
        queue_stable_order: opp.queue_stable_order ?? null,
        correlation_id: opp.correlation_id ?? null,
    });
    return saved;
}

export function release_pending_communication_opportunity(slot: number, opportunity_id: string): boolean {
    const world = ensure_world_exists(slot);
    if (!world.ok) return false;
    const store = world.world as WorldStore;
    const list = Array.isArray(store.pending_communication_opportunities) ? store.pending_communication_opportunities : [];
    const idx = list.findIndex((opp) => opp.opportunity_id === opportunity_id);
    if (idx < 0) {
        debug_log("TIMED_EVENT_COMM", "attempted to release missing communication opportunity", { slot, opportunity_id });
        return false;
    }
    const opp = list[idx]!;
    opp.status = "pending";
    store.pending_communication_opportunities = list;
    const saved = save_world_store(slot, store);
    debug_log("TIMED_EVENT_COMM", saved ? "released communication opportunity back to pending" : "failed to release communication opportunity", {
        slot,
        opportunity_id,
        npc_ref: opp.npc_ref,
        source_message_id: opp.source_message_id,
        queue_entry_id: opp.queue_entry_id ?? null,
        queue_stable_order: opp.queue_stable_order ?? null,
        correlation_id: opp.correlation_id ?? null,
    });
    return saved;
}

export function cancel_pending_communication_opportunity(slot: number, opportunity_id: string, reason?: string): boolean {
    const world = ensure_world_exists(slot);
    if (!world.ok) return false;
    const store = world.world as WorldStore;
    const list = Array.isArray(store.pending_communication_opportunities) ? store.pending_communication_opportunities : [];
    const idx = list.findIndex((opp) => opp.opportunity_id === opportunity_id);
    if (idx < 0) {
        debug_log("TIMED_EVENT_COMM", "attempted to cancel missing communication opportunity", { slot, opportunity_id, reason: reason ?? null });
        return false;
    }
    const opp = list[idx]!;
    opp.status = "cancelled";
    store.pending_communication_opportunities = list.filter((item) => item.status === "pending" || item.status === "in_flight");
    const saved = save_world_store(slot, store);
    debug_log("TIMED_EVENT_COMM", saved ? "cancelled communication opportunity" : "failed to cancel communication opportunity", {
        slot,
        opportunity_id,
        npc_ref: opp.npc_ref,
        source_message_id: opp.source_message_id,
        queue_entry_id: opp.queue_entry_id ?? null,
        queue_stable_order: opp.queue_stable_order ?? null,
        correlation_id: opp.correlation_id ?? null,
        reason: reason ?? null,
    });
    return saved;
}

export function get_pending_communication_opportunities(slot: number, conversation_id?: string): PendingCommunicationOpportunity[] {
    const store = get_timed_event_state(slot);
    if (!store?.timed_event_active) return [];
    const list = Array.isArray(store.pending_communication_opportunities) ? store.pending_communication_opportunities : [];
    const filtered = typeof conversation_id === "string" && conversation_id.length > 0
        ? list.filter((opp) => opp.conversation_id === conversation_id)
        : list;
    return filtered
        .map((opp) => ({ ...opp }))
        .sort((a, b) => {
            const orderA = Math.floor(Number(a.queue_stable_order ?? Number.MAX_SAFE_INTEGER));
            const orderB = Math.floor(Number(b.queue_stable_order ?? Number.MAX_SAFE_INTEGER));
            if (orderA !== orderB) return orderA - orderB;
            return String(a.opportunity_id).localeCompare(String(b.opportunity_id));
        });
}

export function sync_pending_communication_opportunities_with_queue(slot: number, params: {
    conversation_id: string;
    valid_queue_entry_ids: string[];
}): { ok: boolean; removed_opportunity_ids: string[] } {
    const world = ensure_world_exists(slot);
    if (!world.ok) return { ok: false, removed_opportunity_ids: [] };
    const store = world.world as WorldStore;
    const list = Array.isArray(store.pending_communication_opportunities) ? store.pending_communication_opportunities : [];
    const valid = new Set((params.valid_queue_entry_ids ?? []).filter((id) => typeof id === "string" && id.length > 0));
    const removed: string[] = [];
    const next = list.filter((opp) => {
        if (opp.conversation_id !== params.conversation_id) return true;
        if (!opp.queue_entry_id) return true;
        if (valid.has(opp.queue_entry_id)) return true;
        removed.push(opp.opportunity_id);
        return false;
    });
    if (removed.length === 0) return { ok: true, removed_opportunity_ids: [] };
    store.pending_communication_opportunities = next;
    const saved = save_world_store(slot, store);
    debug_log("TIMED_EVENT_COMM", saved ? "synced pending communication opportunities with session queue" : "failed syncing pending communication opportunities with session queue", {
        slot,
        conversation_id: params.conversation_id,
        valid_queue_entry_ids: Array.from(valid),
        removed_opportunity_ids: removed,
    });
    return { ok: saved, removed_opportunity_ids: removed };
}

export function has_pending_communication_opportunity(slot: number, npc_ref: string): boolean {
    const store = get_timed_event_state(slot);
    if (!store?.timed_event_active) return false;
    const list = Array.isArray(store.pending_communication_opportunities) ? store.pending_communication_opportunities : [];
    return list.some((opp) => opp.npc_ref === npc_ref && opp.status === "pending");
}

export function advance_turn(slot: number): { ok: true; current_round: number; active_actor: string; active_actor_index: number } | { ok: false; error: string } {
    const world = ensure_world_exists(slot);
    if (!world.ok) return { ok: false, error: world.error };
    
    const store = world.world as WorldStore;
    if (!store.timed_event_active || !store.initiative_order) {
        return { ok: false, error: "no_active_timed_event" };
    }
    if (store.timed_event_phase === "world_sim_interstitial") {
        return { ok: false, error: "world_sim_interstitial_active" };
    }
    
    // Complete current actor before advancing, unless a more specific terminal state was already recorded.
    if (store.active_actor_index !== undefined) {
        const current = store.initiative_order[store.active_actor_index];
        if (current && current.status === "active") {
            current.status = "done";
        }
    }
    
    // Find next active actor
    let next_index = (store.active_actor_index ?? -1) + 1;
    let found = false;
    
    while (next_index < store.initiative_order.length) {
        const entry = store.initiative_order[next_index];
        if (entry && entry.status === "active") {
            found = true;
            break;
        }
        next_index++;
    }
    
    if (!found) {
        begin_world_sim_interstitial(store);
        debug_log("TIMED_EVENT_TURN", "initiative cycle complete; entering world sim interstitial", {
            slot,
            current_round: store.current_round ?? null,
            timed_event_world_breath_index: store.timed_event_world_breath_index ?? 0,
            world_sim_interstitial_breaths_remaining: store.world_sim_interstitial_breaths_remaining ?? null,
        });
        if (!save_world_store(slot, store)) {
            return { ok: false, error: "failed_to_save" };
        }
        return { ok: false, error: "world_sim_interstitial_started" };
    }
    
    store.active_actor_index = next_index;
    store.timed_event_phase = "initiative_turn";
    store.timed_event_world_breath_index = Math.max(0, Math.floor(Number(store.timed_event_world_breath_index ?? 0)) || 0);
    store.world_sim_interstitial_breaths_remaining = undefined;
    const active_actor = store.initiative_order[next_index]?.actor_ref ?? "unknown";

    debug_log("TIMED_EVENT_TURN", "advanced to next initiative actor", {
        slot,
        current_round: store.current_round ?? null,
        active_actor_index: next_index,
        active_actor,
        movement_budgets: store.initiative_order[next_index]?.movement_budgets ?? null,
        actions_remaining: store.initiative_order[next_index]?.actions_remaining ?? null,
        partial_actions_remaining: store.initiative_order[next_index]?.partial_actions_remaining ?? null,
        timed_event_world_breath_index: store.timed_event_world_breath_index ?? 0,
    });
    
    if (!save_world_store(slot, store)) {
        return { ok: false, error: "failed_to_save" };
    }
    
    return { ok: true, current_round: store.current_round ?? 1, active_actor, active_actor_index: next_index };
}

export function check_all_done(slot: number): boolean {
    const store = get_timed_event_state(slot);
    if (!store?.initiative_order) return true;
    
    return store.initiative_order.every(e => 
        e.status === "done" || e.status === "left_region"
    );
}

export function is_actor_in_region(slot: number, actor_ref: string, region: { world_x: number; world_y: number; region_x: number; region_y: number }): boolean {
    const store = get_timed_event_state(slot);
    if (!store?.event_region) return false;
    
    const event_region = store.event_region;
    return (
        event_region.world_x === region.world_x &&
        event_region.world_y === region.world_y &&
        event_region.region_x === region.region_x &&
        event_region.region_y === region.region_y
    );
}

export function mark_actor_left_region(slot: number, actor_ref: string): boolean {
    const world = ensure_world_exists(slot);
    if (!world.ok) return false;
    
    const store = world.world as WorldStore;
    if (!store.initiative_order) return false;
    
    const entry = store.initiative_order.find(e => e.actor_ref === actor_ref);
    if (!entry) return false;
    
    entry.status = "left_region";
    return save_world_store(slot, store);
}
import { timed_event_stat_to_bps as timed_event_stat_to_bps_mag } from "../mag/timed_event.js";
