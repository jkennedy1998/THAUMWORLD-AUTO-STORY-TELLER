import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "jsonc-parser";
import { ensure_dir_exists, rand_base32_rfc } from "../engine/log_store.js";
import { get_default_npc_path, get_legacy_default_npc_path, get_npc_dir, get_npc_path } from "../engine/paths.js";
import { find_kind, load_kind_definitions } from "../kind_storage/store.js";
import { find_language } from "../language_storage/store.js";
import { apply_level1_derived } from "../character_rules/derived.js";
import { apply_prof_picks, make_empty_profs, random_prof_picks, random_stat_assignment, shuffle } from "../character_rules/creation.js";

export type NpcLookupResult =
    | { ok: true; npc: Record<string, unknown>; path: string }
    | { ok: false; error: string; todo: string };

export type NpcSearchHit = {
    id: string;
    name: string;
    path: string;
};

export type NpcSearchQuery = {
    name?: string;
    kind?: string;
    tag_name?: string;
};

function slugify_name(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

export function make_npc_id(name: string): string {
    const slug = slugify_name(name || "npc");
    const rand = rand_base32_rfc(6);
    return `${slug}_${rand}`;
}

function read_jsonc(pathname: string): Record<string, unknown> {
    const raw = fs.readFileSync(pathname, "utf-8");
    return (parse(raw) as Record<string, unknown>) ?? {};
}

export function ensure_npc_dir(slot: number): string {
    const dir = get_npc_dir(slot);
    ensure_dir_exists(dir);
    return dir;
}

export function load_npc(slot: number, npc_id: string): NpcLookupResult {
    const npc_path = get_npc_path(slot, npc_id);
    if (!fs.existsSync(npc_path)) {
        const todo = `NPC cannot be found: ${npc_id}. Create new NPC JSONC at ${npc_path}`;
        return { ok: false, error: "npc_not_found", todo };
    }

    const npc = read_jsonc(npc_path);
    return { ok: true, npc, path: npc_path };
}

export function load_default_npc(): NpcLookupResult {
    const template_path = get_default_npc_path();
    if (!fs.existsSync(template_path)) {
        const legacy_path = get_legacy_default_npc_path();
        if (fs.existsSync(legacy_path)) {
            ensure_dir_exists(path.dirname(template_path));
            fs.copyFileSync(legacy_path, template_path);
        } else {
            const todo = `Default NPC template missing. Create ${template_path}`;
            return { ok: false, error: "default_npc_missing", todo };
        }
    }

    const npc = read_jsonc(template_path);
    return { ok: true, npc, path: template_path };
}

export function ensure_npc_exists(slot: number, npc_id: string): NpcLookupResult {
    const existing = load_npc(slot, npc_id);
    if (existing.ok) return existing;
    const template = load_default_npc();
    if (!template.ok) return template;
    const npc = { ...template.npc, id: npc_id, name: npc_id };
    const npc_path = save_npc(slot, npc_id, npc);
    return { ok: true, npc, path: npc_path };
}

export function save_npc(slot: number, npc_id: string, npc: Record<string, unknown>): string {
    ensure_npc_dir(slot);
    const npc_path = get_npc_path(slot, npc_id);
    fs.writeFileSync(npc_path, JSON.stringify(npc, null, 2), "utf-8");
    return npc_path;
}

export function create_npc_from_template(slot: number, name: string): NpcLookupResult {
    const template = load_default_npc();
    if (!template.ok) return template;

    const npc_id = make_npc_id(name);
    const npc = { ...template.npc, id: npc_id, name };
    const npc_path = save_npc(slot, npc_id, npc);
    return { ok: true, npc, path: npc_path };
}

export type CreateNpcFromKindInput = {
    name: string;
    kind_id?: string;
    age?: number;
    background?: string;
};

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

function pick_kind_id(): string | null {
    const defs = load_kind_definitions();
    const kinds = defs.kinds.filter((k) => String(k.id ?? "") !== "DEFAULT_KIND");
    if (kinds.length === 0) return null;
    const pick = kinds[Math.floor(Math.random() * kinds.length)];
    return String(pick?.id ?? "");
}

function apply_body_slots(npc: Record<string, unknown>, parts: Array<{ slot: string; critical?: boolean }> | undefined): void {
    if (!parts || parts.length === 0) return;
    const slots: Record<string, unknown> = {};
    for (const part of parts) {
        const name = String(part.slot ?? "").toUpperCase();
        if (!name) continue;
        slots[name] = { name, critical: Boolean(part.critical) };
    }
    npc.body_slots = slots;
}

function apply_background(npc: Record<string, unknown>, background: string | undefined): void {
    if (!background) return;
    const lore = (npc.lore as Record<string, unknown>) ?? {};
    lore.backstory = background;
    npc.lore = lore;
}

function pick_age(kind: Record<string, unknown>, provided?: number): { age: number; adulthood: number } {
    if (typeof provided === "number") {
        const adulthood = Number((kind.age as any)?.adulthood ?? 20);
        return { age: provided, adulthood };
    }
    const age = (kind.age as any) ?? {};
    const adulthood = Number(age.adulthood ?? 20);
    const decline = Number(age.decline ?? adulthood + 20);
    const death = Number(age.death ?? decline + 20);
    const brackets = [
        { min: 0, max: Math.max(1, adulthood - 1) },
        { min: adulthood, max: Math.max(adulthood, decline - 1) },
        { min: decline, max: Math.max(decline, death) },
    ];
    const pick = brackets[Math.floor(Math.random() * brackets.length)] ?? brackets[1];
    const picked_age = pick.min + Math.floor(Math.random() * (pick.max - pick.min + 1));
    return { age: picked_age, adulthood };
}

function pick_perks(kind: Record<string, unknown>): Record<string, unknown>[] {
    const gifts = Array.isArray(kind.gift_of_kind) ? (kind.gift_of_kind as Record<string, unknown>[]) : [];
    const greater = Array.isArray(kind.gift_of_greater_kind) ? (kind.gift_of_greater_kind as Record<string, unknown>[]) : [];
    const flaws = Array.isArray(kind.flaw_of_kind) ? (kind.flaw_of_kind as Record<string, unknown>[]) : [];
    const picked_gifts = shuffle(gifts).slice(0, Math.min(2, gifts.length));
    const picked_greater = greater.length > 0 ? shuffle(greater).slice(0, 1) : [];
    return [...picked_gifts, ...picked_greater, ...flaws];
}

export function create_npc_from_kind(slot: number, input: CreateNpcFromKindInput): NpcLookupResult {
    const template = load_default_npc();
    if (!template.ok) return template;

    const kind_id = input.kind_id ?? pick_kind_id();
    if (!kind_id) {
        return { ok: false, error: "kind_not_found", todo: "No kind id available for NPC creation" };
    }

    const kind = find_kind(kind_id);
    if (!kind) {
        return { ok: false, error: "kind_not_found", todo: `Kind not found: ${kind_id}` };
    }

    const npc_id = make_npc_id(input.name);
    const npc = { ...template.npc, id: npc_id, name: input.name } as Record<string, unknown>;

    npc.kind = kind.id;
    if (typeof kind.size_mag === "number") npc.size_mag = kind.size_mag;
    if (typeof kind.sleep_type === "string") npc.sleep_type = kind.sleep_type;
    if (typeof kind.sleep_required_per_day === "number") npc.sleep_required_per_day = kind.sleep_required_per_day;
    if (kind.senses) npc.senses = { ...kind.senses };
    if (kind.movement) {
        npc.movement = {
            ...(npc.movement as Record<string, unknown>),
            walk: kind.movement.walk ?? 0,
            climb: kind.movement.climb ?? 0,
            swim: kind.movement.swim ?? 0,
            fly: kind.movement.fly ?? 0,
        };
    }
    if (kind.temperature_range) npc.temperature_range = { ...kind.temperature_range };

    const stats = random_stat_assignment();
    if (kind.stat_changes) {
        for (const [key, delta] of Object.entries(kind.stat_changes as Record<string, number>)) {
            stats[key] = Number(stats[key] ?? 50) + delta;
        }
    }
    npc.stats = stats;

    const { age, adulthood } = pick_age(kind as Record<string, unknown>, input.age);
    npc.age = age;
    apply_background(npc, input.background);

    if (kind.languages && kind.languages.length > 0) {
        const languages = kind.languages.map(resolve_language_entry);
        npc.languages = languages;
    }

    apply_body_slots(npc, kind.parts as Array<{ slot: string; critical?: boolean }> | undefined);

    const picks = age < adulthood ? 2 : 4;
    const profs = apply_prof_picks(make_empty_profs(), random_prof_picks(picks));
    npc.profs = profs;

    npc.perks = pick_perks(kind as Record<string, unknown>);

    apply_level1_derived(npc, { set_current_to_max: true });

    const npc_path = save_npc(slot, npc_id, npc);
    return { ok: true, npc, path: npc_path };
}

export function find_npcs(slot: number, query: NpcSearchQuery): NpcSearchHit[] {
    const dir = ensure_npc_dir(slot);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonc"));
    const hits: NpcSearchHit[] = [];

    for (const file of files) {
        const full_path = path.join(dir, file);
        const npc = read_jsonc(full_path);
        const id = String(npc.id ?? file.replace(/\.jsonc$/i, ""));
        const name = String(npc.name ?? "");
        const kind = String(npc.kind ?? "");
        const tags = Array.isArray(npc.tags) ? npc.tags : [];

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
