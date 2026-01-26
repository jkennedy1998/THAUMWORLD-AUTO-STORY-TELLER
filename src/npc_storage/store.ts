import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "jsonc-parser";
import { ensure_dir_exists, rand_base32_rfc } from "../engine/log_store.js";
import { get_default_npc_path, get_legacy_default_npc_path, get_npc_dir, get_npc_path } from "../engine/paths.js";

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
