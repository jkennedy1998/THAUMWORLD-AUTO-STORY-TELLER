import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "jsonc-parser";
import { ensure_dir_exists, rand_base32_rfc } from "../engine/log_store.js";
import { get_actor_dir, get_actor_path, get_default_actor_path } from "../engine/paths.js";

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
        const todo = `Actor cannot be found: ${actor_id}. TODO: create new Actor JSONC at ${actor_path}`;
        return { ok: false, error: "actor_not_found", todo };
    }

    const actor = read_jsonc(actor_path);
    return { ok: true, actor, path: actor_path };
}

export function load_default_actor(): ActorLookupResult {
    const template_path = get_default_actor_path();
    if (!fs.existsSync(template_path)) {
        const todo = `Default Actor template missing. TODO: create ${template_path}`;
        return { ok: false, error: "default_actor_missing", todo };
    }

    const actor = read_jsonc(template_path);
    return { ok: true, actor, path: template_path };
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
