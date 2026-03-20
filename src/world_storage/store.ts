import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "jsonc-parser";
import { ensure_dir_exists } from "../engine/log_store.js";
import { get_default_world_path, get_legacy_default_world_path, get_legacy_world_path, get_world_dir, get_world_path, get_data_slot_dir } from "../engine/paths.js";
import { list_places_in_region, load_place } from "../place_storage/store.js";

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
    status: "active" | "passed" | "left_region" | "done";
};

type TimedEventEffect = {
    id: string;
    trigger_turn: number;
    target_ref: string;
    effect_type: string;
    effect_args: Record<string, unknown>;
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
    
    // Turn Management
    current_turn?: number;
    current_round?: number;
    initiative_order?: InitiativeEntry[];
    active_actor_index?: number;
    
    // Region tracking for proximity
    event_region?: {
        world_x: number;
        world_y: number;
        region_x: number;
        region_y: number;
    };
    
    // Pending effects
    timed_effects_queue?: TimedEventEffect[];
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
    return world.world as WorldStore;
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
    region: { world_x: number; world_y: number; region_x: number; region_y: number }
): { ok: true; event_id: string } | { ok: false; error: string } {
    const world = ensure_world_exists(slot);
    if (!world.ok) return { ok: false, error: world.error };
    
    const store = world.world as WorldStore;
    const event_id = `timed_event_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    
    store.timed_event_active = true;
    store.timed_event_id = event_id;
    store.timed_event_type = event_type;
    store.timed_event_start_time = new Date().toISOString();
    store.current_turn = 1;
    store.current_round = 1;
    store.initiative_order = participants.map(ref => ({
        actor_ref: ref,
        initiative_roll: 0,  // Will be set by turn manager
        dex_score: 0,        // Will be set by turn manager
        has_acted_this_turn: false,
        actions_remaining: 1,
        partial_actions_remaining: 1,
        movement_remaining: 0,
        status: "active"
    }));
    store.active_actor_index = 0;
    store.event_region = region;
    store.timed_effects_queue = [];
    
    if (!save_world_store(slot, store)) {
        return { ok: false, error: "failed_to_save_world" };
    }
    
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
    store.current_turn = undefined;
    store.current_round = undefined;
    store.initiative_order = undefined;
    store.active_actor_index = undefined;
    store.event_region = undefined;
    store.timed_effects_queue = undefined;
    
    return save_world_store(slot, store);
}

export function get_active_actor_ref(slot: number): string | null {
    const store = get_timed_event_state(slot);
    if (!store?.timed_event_active || !store.initiative_order || store.active_actor_index === undefined) {
        return null;
    }
    
    const entry = store.initiative_order[store.active_actor_index];
    return entry?.actor_ref ?? null;
}

export function advance_turn(slot: number): { ok: true; new_turn: number; active_actor: string } | { ok: false; error: string } {
    const world = ensure_world_exists(slot);
    if (!world.ok) return { ok: false, error: world.error };
    
    const store = world.world as WorldStore;
    if (!store.timed_event_active || !store.initiative_order) {
        return { ok: false, error: "no_active_timed_event" };
    }
    
    // Mark current actor as done
    if (store.active_actor_index !== undefined) {
        const current = store.initiative_order[store.active_actor_index];
        if (current) {
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
        // All actors have acted, start new turn
        store.current_turn = (store.current_turn ?? 1) + 1;
        store.current_round = Math.floor((store.current_turn - 1) / store.initiative_order.length) + 1;
        
        // Reset all actors to active
        for (const entry of store.initiative_order) {
            if (entry.status !== "left_region") {
                entry.status = "active";
                entry.has_acted_this_turn = false;
                entry.actions_remaining = 1;
                entry.partial_actions_remaining = 1;
            }
        }
        
        next_index = 0;
    }
    
    store.active_actor_index = next_index;
    const active_actor = store.initiative_order[next_index]?.actor_ref ?? "unknown";
    
    if (!save_world_store(slot, store)) {
        return { ok: false, error: "failed_to_save" };
    }
    
    return { ok: true, new_turn: store.current_turn ?? 1, active_actor };
}

export function mark_actor_done(slot: number, actor_ref: string): boolean {
    const world = ensure_world_exists(slot);
    if (!world.ok) return false;
    
    const store = world.world as WorldStore;
    if (!store.initiative_order) return false;
    
    const entry = store.initiative_order.find(e => e.actor_ref === actor_ref);
    if (!entry) return false;
    
    entry.status = "done";
    return save_world_store(slot, store);
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
