import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "jsonc-parser";
import { ensure_dir_exists, rand_base32_rfc } from "../engine/log_store.js";
import { get_actor_dir, get_actor_path, get_default_actor_path, get_legacy_default_actor_path } from "../engine/paths.js";
import { find_kind } from "../kind_storage/store.js";
import { find_language } from "../language_storage/store.js";
import { apply_level1_derived } from "../character_rules/derived.js";
import { apply_prof_picks, make_empty_profs } from "../character_rules/creation.js";

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
    kind_id: string;
    gift_kind_choices: string[];
    gift_greater_choice: string | null;
    stats?: Record<string, number>;
    prof_picks?: string[];
    background?: string;
    age?: number;
};

function slugify_name(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

export function make_actor_id(name: string): string {
    const slug = slugify_name(name || "actor");
    const rand = rand_base32_rfc(6);
    return `${slug}_${rand}`;
}

function read_jsonc(pathname: string): Record<string, unknown> {
    const raw = fs.readFileSync(pathname, "utf-8");
    return (parse(raw) as Record<string, unknown>) ?? {};
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
    const actor = { ...template.actor, id: actor_id, name: actor_id };
    const actor_path = save_actor(slot, actor_id, actor);
    return { ok: true, actor, path: actor_path };
}

export function save_actor(slot: number, actor_id: string, actor: Record<string, unknown>): string {
    ensure_actor_dir(slot);
    const actor_path = get_actor_path(slot, actor_id);
    fs.writeFileSync(actor_path, JSON.stringify(actor, null, 2), "utf-8");
    return actor_path;
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

    actor.kind = kind.id;
    if (typeof kind.size_mag === "number") actor.size_mag = kind.size_mag;
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
    apply_stat_changes(stats, kind.stat_changes as Record<string, number> | undefined);
    actor.stats = stats;

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
        const tags = Array.isArray(actor.tags) ? actor.tags : [];

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

// TODO: implement character creation flow to populate actor sheets from rules
function apply_body_slots(actor: Record<string, unknown>, parts: Array<{ slot: string; critical?: boolean }> | undefined): void {
    if (!parts || parts.length === 0) return;
    const slots: Record<string, unknown> = {};
    for (const part of parts) {
        const name = String(part.slot ?? "").toUpperCase();
        if (!name) continue;
        slots[name] = { name, critical: Boolean(part.critical) };
    }
    actor.body_slots = slots;
}

function apply_background(actor: Record<string, unknown>, background: string | undefined): void {
    if (!background) return;
    const lore = (actor.lore as Record<string, unknown>) ?? {};
    lore.backstory = background;
    actor.lore = lore;
}
