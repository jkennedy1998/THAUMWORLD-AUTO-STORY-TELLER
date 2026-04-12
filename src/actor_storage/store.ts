import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "jsonc-parser";
import { ensure_dir_exists } from "../engine/log_store.js";
import { get_actor_dir, get_actor_path, get_default_actor_path, get_legacy_default_actor_path } from "../engine/paths.js";
import { find_kind } from "../kind_storage/store.js";
import { find_language } from "../language_storage/store.js";
import { apply_level1_derived } from "../character_rules/derived.js";
import { apply_prof_picks, make_empty_profs } from "../character_rules/creation.js";
import { initialize_equipment_slots, normalize_body_slots } from "../types/body_slots.js";
import { sanitize_actor_for_save } from "../shared/defs_deltas_sanitize.js";
import { resolve_character_body_model_id } from "../shared/body_model.js";
import { DEFAULT_CHARACTER_BODY_SLOT_REPRESENTATION } from "../shared/body_slot_representation.js";
import { make_opaque_entity_id } from "../shared/entity_ids.js";
import { hydrate_character_tags } from "../shared/character_tags.js";
import { load_place } from "../place_storage/store.js";
import { can_place_volume } from "../place_storage/movement_legality.js";

export type ActorLookupResult =
    | { ok: true; actor: Record<string, unknown>; path: string }
    | { ok: false; error: string; todo: string };

export type ActorSearchHit = {
    id: string;
    name: string;
    path: string;
};

export type ActorSearchQuery = {
    name?: string;
    kind?: string;
    tag_name?: string;
};

export type CreateActorFromKindInput = {
    actor_id?: string;
    name: string;
    title?: string;
    sex?: string;
    kind_id: string;
    gift_kind_choices: string[];
    gift_greater_choice: string | null;
    stats?: Record<string, number>;
    prof_picks?: string[];
    background?: string;
    age?: number;
};

function clone_numeric_stats(stats: Record<string, unknown> | undefined): Record<string, number> {
    return {
        con: Number(stats?.con ?? 0) || 0,
        str: Number(stats?.str ?? 0) || 0,
        dex: Number(stats?.dex ?? 0) || 0,
        wis: Number(stats?.wis ?? 0) || 0,
        int: Number(stats?.int ?? 0) || 0,
        cha: Number(stats?.cha ?? 0) || 0,
    };
}

function build_spawn_search_offsets(max_radius: number): Array<{ dx: number; dy: number }> {
    const offsets: Array<{ dx: number; dy: number }> = [{ dx: 0, dy: 0 }];
    for (let radius = 1; radius <= max_radius; radius += 1) {
        for (let dy = -radius; dy <= radius; dy += 1) {
            for (let dx = -radius; dx <= radius; dx += 1) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
                offsets.push({ dx, dy });
            }
        }
    }
    return offsets;
}

function assign_spawn_near_loaded_actor(slot: number, actor_id: string, actor: Record<string, unknown>): boolean {
    const search_hits = find_actors(slot, {});
    for (const hit of search_hits) {
        const anchor_id = String(hit.id ?? '').trim();
        if (!anchor_id || anchor_id === actor_id || RESERVED_ACTOR_IDS.has(anchor_id)) continue;
        const anchor_result = load_actor(slot, anchor_id);
        if (!anchor_result.ok) continue;
        const anchor_actor = anchor_result.actor as any;
        const place_id = String(anchor_actor?.location?.place_id ?? '').trim();
        if (!place_id) continue;
        const place_result = load_place(slot, place_id);
        if (!place_result.ok) continue;
        const place = place_result.place as any;
        const anchor_presence = Array.isArray(place?.contents?.actors_present)
            ? place.contents.actors_present.find((entry: any) => String(entry?.actor_ref ?? '') === `actor.${anchor_id}`) ?? null
            : null;
        const anchor_tile = anchor_presence?.tile_position ?? anchor_actor?.location?.tile ?? null;
        const anchor_x = Math.floor(Number(anchor_tile?.x ?? 0));
        const anchor_y = Math.floor(Number(anchor_tile?.y ?? 0));
        if (!Number.isFinite(anchor_x) || !Number.isFinite(anchor_y)) continue;
        const anchor_z = Number.isFinite(Number(anchor_presence?.elevation))
            ? Math.floor(Number(anchor_presence.elevation))
            : Number.isFinite(Number(anchor_tile?.z))
                ? Math.floor(Number(anchor_tile.z))
                : Math.floor(Number(place?.coordinates?.elevation ?? 0)) || 0;
        for (const offset of build_spawn_search_offsets(6)) {
            const target = { x: anchor_x + offset.dx, y: anchor_y + offset.dy, z: anchor_z };
            const legality = can_place_volume(place, { kind: 'actor', id: actor_id }, target, 'WALK');
            if (!legality.ok) continue;
            (actor as any).location = {
                ...((actor as any).location ?? {}),
                place_id,
                tile: { x: target.x, y: target.y, z: target.z },
                world_tile: anchor_actor?.location?.world_tile ? { ...anchor_actor.location.world_tile } : ((actor as any).location?.world_tile ?? undefined),
                region_tile: anchor_actor?.location?.region_tile ? { ...anchor_actor.location.region_tile } : ((actor as any).location?.region_tile ?? undefined),
            };
            return true;
        }
    }
    return false;
}

export function ensure_actor_has_spawn_location(slot: number, actor_id: string): ActorLookupResult {
    const existing = load_actor(slot, actor_id);
    if (!existing.ok) return existing;
    const actor = existing.actor as Record<string, unknown>;
    const place_id = String((actor as any)?.location?.place_id ?? '').trim();
    if (place_id) return existing;
    const spawned = assign_spawn_near_loaded_actor(slot, actor_id, actor);
    if (!spawned) {
        return { ok: false, error: 'spawn_location_unavailable', todo: `Unable to assign spawn location for actor ${actor_id}` };
    }
    const actor_path = save_actor(slot, actor_id, actor);
    return { ok: true, actor, path: actor_path };
}

const RESERVED_ACTOR_IDS = new Set([
    "default_actor",
    "player",
    "self",
    "npc",
    "hands",
    "voice",
]);

export function make_actor_id(_name?: string): string {
    return make_opaque_entity_id("actor");
}

function read_jsonc(pathname: string): Record<string, unknown> {
    const raw = fs.readFileSync(pathname, "utf-8");
    return (parse(raw) as Record<string, unknown>) ?? {};
}

function derive_default_actor_weight(actor: Record<string, unknown>): number {
    const kind_id = String((actor as any)?.kind ?? (actor as any)?.kind_id ?? "").trim();
    const kind = kind_id ? find_kind(kind_id) : null;
    const kind_weight = Number((kind as any)?.weight);
    if (Number.isFinite(kind_weight)) return kind_weight;
    const size_mag = Number((actor as any)?.size_mag ?? (kind as any)?.size_mag ?? 0);
    if (Number.isFinite(size_mag)) return Math.max(1, Math.floor(size_mag));
    return 1;
}

export function ensure_actor_dir(slot: number): string {
    const dir = get_actor_dir(slot);
    ensure_dir_exists(dir);
    return dir;
}

export function load_actor(slot: number, actor_id: string): ActorLookupResult {
    const actor_path = get_actor_path(slot, actor_id);
    if (!fs.existsSync(actor_path)) {
        const todo = `Actor cannot be found: ${actor_id}. Create new Actor JSONC at ${actor_path}`;
        return { ok: false, error: "actor_not_found", todo };
    }

    const actor = read_jsonc(actor_path);

    // Breath timekeeping defaults (movement + inventory aging).
    // Persist once so downstream systems can rely on the fields existing.
    let dirty = false;
    try {
        if (typeof (actor as any).breath_index !== 'number' || !Number.isFinite((actor as any).breath_index)) {
            (actor as any).breath_index = 0;
            dirty = true;
        }
        if (typeof (actor as any).breath_last_processed !== 'number' || !Number.isFinite((actor as any).breath_last_processed)) {
            (actor as any).breath_last_processed = Number((actor as any).breath_index ?? 0) || 0;
            dirty = true;
        }
        if (typeof (actor as any).breath_last_processed_ms !== 'number' || !Number.isFinite((actor as any).breath_last_processed_ms)) {
            (actor as any).breath_last_processed_ms = Date.now();
            dirty = true;
        }
        if (!(actor as any).movement_schedule || typeof (actor as any).movement_schedule !== 'object') {
            (actor as any).movement_schedule = {
                walk: { breaths_per_step: 1, next_breath: 0 },
                climb: { breaths_per_step: 1, next_breath: 0 },
                swim: { breaths_per_step: 1, next_breath: 0 },
                fly: { breaths_per_step: 1, next_breath: 0 },
            };
            dirty = true;
        }
        if (!(actor as any).movement_physics || typeof (actor as any).movement_physics !== 'object') {
            (actor as any).movement_physics = {
                velocity: { vx: 0, vy: 0, vz: 0 },
                move_budget: { walk: 0, climb: 0, swim: 0, fly: 0 },
                move_debt: { walk: 0, climb: 0, swim: 0, fly: 0 },
                last_intent: { dx: 0, dy: 0, modality: 'walk', mode: 'WALK' },
                last_breath_processed: Number((actor as any).breath_last_processed ?? (actor as any).breath_index ?? 0) || 0,
            };
            dirty = true;
        } else {
            const mp = (actor as any).movement_physics;
            if (!mp.velocity || typeof mp.velocity !== 'object') {
                mp.velocity = { vx: 0, vy: 0, vz: 0 };
                dirty = true;
            }
            if (!mp.move_budget || typeof mp.move_budget !== 'object') {
                mp.move_budget = { walk: 0, climb: 0, swim: 0, fly: 0 };
                dirty = true;
            }
            if (!mp.move_debt || typeof mp.move_debt !== 'object') {
                mp.move_debt = { walk: 0, climb: 0, swim: 0, fly: 0 };
                dirty = true;
            }
            if (!mp.last_intent || typeof mp.last_intent !== 'object') {
                mp.last_intent = { dx: 0, dy: 0, modality: 'walk', mode: 'WALK' };
                dirty = true;
            }
            if (typeof mp.last_breath_processed !== 'number' || !Number.isFinite(mp.last_breath_processed)) {
                mp.last_breath_processed = Number((actor as any).breath_last_processed ?? (actor as any).breath_index ?? 0) || 0;
                dirty = true;
            }
        }
        const normalized_body_slots = normalize_body_slots((actor as any).body_slots);
        if (JSON.stringify(normalized_body_slots) !== JSON.stringify((actor as any).body_slots ?? {})) {
            (actor as any).body_slots = normalized_body_slots;
            dirty = true;
        }
        if (typeof (actor as any).weight !== 'number' || !Number.isFinite((actor as any).weight)) {
            (actor as any).weight = derive_default_actor_weight(actor);
            dirty = true;
        }
        const tag_hydration = hydrate_character_tags(actor);
        if (tag_hydration.changed) dirty = true;
    } catch {
        // ignore
    }
    if (dirty) {
        save_actor(slot, actor_id, actor);
    }

    return { ok: true, actor, path: actor_path };
}

export function load_default_actor(): ActorLookupResult {
    const template_path = get_default_actor_path();
    if (!fs.existsSync(template_path)) {
        const legacy_path = get_legacy_default_actor_path();
        if (fs.existsSync(legacy_path)) {
            ensure_dir_exists(path.dirname(template_path));
            fs.copyFileSync(legacy_path, template_path);
        } else {
            const todo = `Default Actor template missing. Create ${template_path}`;
            return { ok: false, error: "default_actor_missing", todo };
        }
    }

    const actor = read_jsonc(template_path);
    return { ok: true, actor, path: template_path };
}

export function ensure_actor_exists(slot: number, actor_id: string): ActorLookupResult {
    const existing = load_actor(slot, actor_id);
    if (existing.ok) return existing;
    const template = load_default_actor();
    if (!template.ok) return template;
    const actor = { ...template.actor, id: actor_id, name: "Player" };
    const actor_path = save_actor(slot, actor_id, actor);
    return { ok: true, actor, path: actor_path };
}

export function save_actor(slot: number, actor_id: string, actor: Record<string, unknown>): string {
    ensure_actor_dir(slot);
    const actor_path = get_actor_path(slot, actor_id);
    (actor as any).body_slots = normalize_body_slots((actor as any).body_slots);
    hydrate_character_tags(actor as any);

    // defs+deltas migration: strip derived/legacy inline item fields before persisting.
    sanitize_actor_for_save(actor as any);
    fs.writeFileSync(actor_path, JSON.stringify(actor, null, 2), "utf-8");
    return actor_path;
}

export function delete_actor(slot: number, actor_id: string): boolean {
    const actor_path = get_actor_path(slot, actor_id);
    if (!fs.existsSync(actor_path)) return false;
    fs.unlinkSync(actor_path);
    return true;
}

export function create_actor_from_template(slot: number, name: string): ActorLookupResult {
    const template = load_default_actor();
    if (!template.ok) return template;

    const actor_id = make_actor_id(name);
    const actor = { ...template.actor, id: actor_id, name };
    const actor_path = save_actor(slot, actor_id, actor);
    return { ok: true, actor, path: actor_path };
}

function apply_stat_changes(stats: Record<string, unknown>, changes: Record<string, number> | undefined): void {
    if (!changes) return;
    for (const [key, delta] of Object.entries(changes)) {
        const current = Number(stats[key] ?? 0);
        stats[key] = current + delta;
    }
}

function resolve_language_entry(entry: { name: string; understood_senses?: { sense: string; mag: number }[] }): {
    name: string;
    understood_senses: { sense: string; mag: number }[];
} {
    if (entry.understood_senses && entry.understood_senses.length > 0) {
        return { name: entry.name, understood_senses: entry.understood_senses };
    }
    const def = find_language(entry.name);
    if (def && Array.isArray(def.default_senses)) {
        return { name: entry.name, understood_senses: def.default_senses };
    }
    return { name: entry.name, understood_senses: [] };
}

function select_perks(perks: Record<string, unknown>[] | undefined, names: string[]): Record<string, unknown>[] {
    if (!perks || perks.length === 0 || names.length === 0) return [];
    const lowered = names.map((n) => n.toLowerCase());
    return perks.filter((p) => typeof p.name === "string" && lowered.includes(p.name.toLowerCase()));
}

export function create_actor_from_kind(slot: number, input: CreateActorFromKindInput): ActorLookupResult {
    const template = load_default_actor();
    if (!template.ok) return template;

    const kind = find_kind(input.kind_id);
    if (!kind) {
        return { ok: false, error: "kind_not_found", todo: `Kind not found: ${input.kind_id}` };
    }

    const actor_id = input.actor_id ?? make_actor_id(input.name);
    const actor = { ...template.actor, id: actor_id, name: input.name } as Record<string, unknown>;
    if (typeof input.title === "string") actor.title = input.title;
    if (typeof input.sex === "string") actor.sex = input.sex;

    // Breath timekeeping + scheduling (server authoritative).
    // Used for movement cadence and for aging inventory items without per-item trackers.
    (actor as any).breath_index = 0;
    (actor as any).breath_last_processed = 0;
    (actor as any).breath_last_processed_ms = Date.now();
    (actor as any).movement_schedule = {
        walk: { breaths_per_step: 1, next_breath: 0 },
        climb: { breaths_per_step: 1, next_breath: 0 },
        swim: { breaths_per_step: 1, next_breath: 0 },
        fly: { breaths_per_step: 1, next_breath: 0 },
    };
    (actor as any).movement_physics = {
        velocity: { vx: 0, vy: 0, vz: 0 },
        move_budget: { walk: 0, climb: 0, swim: 0, fly: 0 },
        move_debt: { walk: 0, climb: 0, swim: 0, fly: 0 },
        last_intent: { dx: 0, dy: 0, modality: 'walk', mode: 'WALK' },
        last_breath_processed: 0,
    };

    actor.kind = kind.id;
    // Multi-tile rendering: body model + body slot representation are kind-driven.
    // Fall back to current defaults when a kind does not specify them.
    (actor as any).body_model_id = typeof (kind as any)?.body_model_id === 'string'
        ? String((kind as any).body_model_id)
        : resolve_character_body_model_id(kind.id);
    (actor as any).body_slot_representation = ((kind as any)?.body_slot_representation && typeof (kind as any).body_slot_representation === 'object')
        ? (kind as any).body_slot_representation
        : DEFAULT_CHARACTER_BODY_SLOT_REPRESENTATION;
    if (typeof kind.size_mag === "number") actor.size_mag = kind.size_mag;
    if (typeof kind.weight === "number") actor.weight = kind.weight;
    if (typeof kind.sleep_type === "string") actor.sleep_type = kind.sleep_type;
    if (typeof kind.sleep_required_per_day === "number") actor.sleep_required_per_day = kind.sleep_required_per_day;
    if (kind.senses) actor.senses = { ...kind.senses };
    if (kind.movement) {
        actor.movement = {
            ...(actor.movement as Record<string, unknown>),
            walk: kind.movement.walk ?? 0,
            climb: kind.movement.climb ?? 0,
            swim: kind.movement.swim ?? 0,
            fly: kind.movement.fly ?? 0,
        };
    }
    if (kind.temperature_range) actor.temperature_range = { ...kind.temperature_range };

    const stats = input.stats ? { ...input.stats } : ((actor.stats as Record<string, unknown>) ?? {});
    const base_stats = clone_numeric_stats(stats as Record<string, unknown>);
    apply_stat_changes(stats, kind.stat_changes as Record<string, number> | undefined);
    actor.stats = stats;
    (actor as any).stat_source = {
        base_stats,
        kind_id: kind.id,
        kind_stat_changes: { ...((kind.stat_changes as Record<string, number> | undefined) ?? {}) },
    };

    if (input.age !== undefined) actor.age = input.age;
    apply_background(actor, input.background);

    if (kind.languages && kind.languages.length > 0) {
        const languages = kind.languages.map(resolve_language_entry);
        actor.languages = languages;
    }

    apply_body_slots(actor, kind.parts as Array<{ slot: string; critical?: boolean }> | undefined);

    if (actor.appearance && typeof actor.appearance === "object" && typeof kind.size_mag === "number") {
        (actor.appearance as Record<string, unknown>).size_mag = kind.size_mag;
    }

    const gift_perks = select_perks(kind.gift_of_kind as Record<string, unknown>[] | undefined, input.gift_kind_choices);
    const greater_perks = input.gift_greater_choice
        ? select_perks(kind.gift_of_greater_kind as Record<string, unknown>[] | undefined, [input.gift_greater_choice])
        : [];
    const flaw_perks = Array.isArray(kind.flaw_of_kind) ? kind.flaw_of_kind : [];
    actor.perks = [...gift_perks, ...greater_perks, ...flaw_perks];

    if (input.prof_picks && input.prof_picks.length > 0) {
        const profs = apply_prof_picks(make_empty_profs(), input.prof_picks);
        actor.profs = profs;
    }

    // TODO: incorporate personality and flavor choices during character creation.

    assign_spawn_near_loaded_actor(slot, actor_id, actor);

    apply_level1_derived(actor, { set_current_to_max: true });

    const actor_path = save_actor(slot, actor_id, actor);
    return { ok: true, actor, path: actor_path };
}

export function find_actors(slot: number, query: ActorSearchQuery): ActorSearchHit[] {
    const dir = ensure_actor_dir(slot);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonc"));
    const hits: ActorSearchHit[] = [];

    for (const file of files) {
        const full_path = path.join(dir, file);
        const actor = read_jsonc(full_path);
        const id = String(actor.id ?? file.replace(/\.jsonc$/i, ""));
        const name = String(actor.name ?? "");
        const kind = String(actor.kind ?? "");
        const hydrated = hydrate_character_tags(actor as any);
        const tags = hydrated.effective_tags;

        if (query.name && !name.toLowerCase().includes(query.name.toLowerCase())) continue;
        if (query.kind && kind.toLowerCase() !== query.kind.toLowerCase()) continue;
        if (query.tag_name) {
            const has_tag = tags.some((t: any) => String(t?.name ?? "").toLowerCase() === query.tag_name!.toLowerCase());
            if (!has_tag) continue;
        }

        hits.push({ id, name, path: full_path });
    }

    return hits;
}

export function resolve_runtime_player_actor_id(slot: number, preferred_id?: string | null): string {
    const preferred = String(preferred_id ?? "").trim();
    if (preferred) {
        const hit = load_actor(slot, preferred);
        if (hit.ok) return preferred;
    }

    const actors = find_actors(slot, {});
    const non_reserved = actors.find((actor) => !RESERVED_ACTOR_IDS.has(String(actor.id ?? "").trim().toLowerCase()));
    if (non_reserved?.id) return non_reserved.id;

    const player_like = actors.find((actor) => String(actor.id ?? "").trim().toLowerCase() === "player");
    if (player_like?.id) return player_like.id;

    const first = actors.find((actor) => String(actor.id ?? "").trim().length > 0);
    return first?.id ?? "player";
}

// Apply body slots from kind.parts to actor
// Initializes with empty slots (item_instance_id: null)
function apply_body_slots(actor: Record<string, unknown>, parts: Array<{ slot: string; critical?: boolean }> | undefined): void {
    actor.body_slots = initialize_equipment_slots(parts) as Record<string, unknown>;
}

function apply_background(actor: Record<string, unknown>, background: string | undefined): void {
    if (!background) return;
    const lore = (actor.lore as Record<string, unknown>) ?? {};
    lore.backstory = background;
    actor.lore = lore;
}
