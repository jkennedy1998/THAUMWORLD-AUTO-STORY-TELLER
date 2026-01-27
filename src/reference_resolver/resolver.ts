import type { CommandNode, ValueNode } from "../system_syntax/index.js";
import { load_actor, load_default_actor } from "../actor_storage/store.js";
import { load_npc } from "../npc_storage/store.js";
import { get_region_tile, get_world_tile } from "../world_storage/store.js";
import type { ResolvedRef, ResolverOptions, ResolverResult } from "./types.js";

function collect_identifiers(value: ValueNode, out: string[]): void {
    if (value.type === "identifier") {
        out.push(value.value);
        return;
    }
    if (value.type === "list") {
        for (const item of value.value) collect_identifiers(item, out);
        return;
    }
    if (value.type === "object") {
        for (const v of Object.values(value.value)) collect_identifiers(v, out);
    }
}

function parse_ref_parts(ref: string): string[] {
    return ref.split(".").filter((p) => p.length > 0);
}

function resolve_actor_ref(ref: string, options: ResolverOptions, result: ResolverResult): void {
    const parts = parse_ref_parts(ref);
    const actor_id = parts[1] ?? "";
    if (!actor_id) return;

    const resolved: ResolvedRef = { ref, id: actor_id, type: "actor" };
    const loaded = load_actor(options.slot, actor_id);
    if (!loaded.ok) {
        if (options.use_representative_data) {
            const template = load_default_actor();
            resolved.representative = true;
            if (template.ok) resolved.path = template.path;
            result.warnings.push({ ref, message: loaded.todo });
            result.resolved[ref] = resolved;
            return;
        }
        result.errors.push({ ref, reason: loaded.error, path: loaded.todo });
        return;
    }

    resolved.path = loaded.path;
    result.resolved[ref] = resolved;
}

function resolve_npc_ref(ref: string, options: ResolverOptions, result: ResolverResult): void {
    const parts = parse_ref_parts(ref);
    const npc_id = parts[1] ?? "";
    if (!npc_id) return;

    const resolved: ResolvedRef = { ref, id: npc_id, type: "npc" };
    const loaded = load_npc(options.slot, npc_id);
    if (!loaded.ok) {
        result.errors.push({ ref, reason: loaded.error, path: loaded.todo });
        return;
    }

    resolved.path = loaded.path;
    result.resolved[ref] = resolved;
}

function resolve_world_tile_ref(ref: string, options: ResolverOptions, result: ResolverResult): void {
    const parts = parse_ref_parts(ref);
    const x = Number(parts[1]);
    const y = Number(parts[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    const resolved: ResolvedRef = { ref, id: `world_tile_${x}_${y}`, type: "world_tile" };
    const loaded = get_world_tile(options.slot, x, y);
    if (!loaded.ok) {
        if (options.use_representative_data) {
            resolved.representative = true;
            result.warnings.push({ ref, message: loaded.todo });
            result.resolved[ref] = resolved;
            return;
        }
        result.errors.push({ ref, reason: loaded.error, path: loaded.todo });
        return;
    }

    resolved.path = loaded.path;
    result.resolved[ref] = resolved;
}

function resolve_region_tile_ref(ref: string, options: ResolverOptions, result: ResolverResult): void {
    const parts = parse_ref_parts(ref);
    const world_x = Number(parts[1]);
    const world_y = Number(parts[2]);
    const region_x = Number(parts[3]);
    const region_y = Number(parts[4]);
    if (![world_x, world_y, region_x, region_y].every((n) => Number.isFinite(n))) return;

    const resolved: ResolvedRef = { ref, id: `region_tile_${world_x}_${world_y}_${region_x}_${region_y}`, type: "region_tile" };
    const loaded = get_region_tile(options.slot, world_x, world_y, region_x, region_y);
    if (!loaded.ok) {
        if (options.use_representative_data) {
            resolved.representative = true;
            result.warnings.push({ ref, message: loaded.todo });
            result.resolved[ref] = resolved;
            return;
        }
        result.errors.push({ ref, reason: loaded.error, path: loaded.todo });
        return;
    }

    resolved.path = loaded.path;
    result.resolved[ref] = resolved;
}

function resolve_tile_ref(ref: string, options: ResolverOptions, result: ResolverResult): void {
    const parts = parse_ref_parts(ref);
    const world_x = Number(parts[1]);
    const world_y = Number(parts[2]);
    const region_x = Number(parts[3]);
    const region_y = Number(parts[4]);
    const tile_x = Number(parts[5]);
    const tile_y = Number(parts[6]);
    if (![world_x, world_y, region_x, region_y, tile_x, tile_y].every((n) => Number.isFinite(n))) return;

    const resolved: ResolvedRef = { ref, id: `tile_${world_x}_${world_y}_${region_x}_${region_y}_${tile_x}_${tile_y}`, type: "tile" };
    const loaded = get_region_tile(options.slot, world_x, world_y, region_x, region_y);
    if (!loaded.ok) {
        if (options.use_representative_data) {
            resolved.representative = true;
            result.warnings.push({ ref, message: loaded.todo });
            result.resolved[ref] = resolved;
            return;
        }
        result.errors.push({ ref, reason: loaded.error, path: loaded.todo });
        return;
    }

    resolved.path = loaded.path;
    result.resolved[ref] = resolved;
}

function resolve_item_ref(ref: string, options: ResolverOptions, result: ResolverResult): void {
    const parts = parse_ref_parts(ref);
    const item_part = parts.find((p) => p.startsWith("item_"));
    if (!item_part) return;

    const owner_ref = parts.slice(0, parts.indexOf(item_part)).join(".");
    const owner_type = owner_ref.includes("body_slots") || owner_ref.includes("hand_slots")
        ? "character.body_slot"
        : owner_ref.includes("inventory")
          ? "character.inventory"
          : owner_ref.includes("region_tile")
            ? "region_tile"
            : owner_ref.includes("world_tile")
              ? "world_tile"
              : owner_ref.includes("tile")
                ? "tile"
                : "unknown";

    const resolved: ResolvedRef = {
        ref,
        id: item_part,
        type: "item",
        owner_ref,
        owner_type,
    };

    if (!owner_ref || owner_type === "unknown") {
        if (!options.use_representative_data) {
            result.errors.push({ ref, reason: "item_owner_missing" });
            return;
        }
        result.warnings.push({ ref, message: "item_owner_missing (representative)" });
    }

    if (options.use_representative_data) {
        resolved.representative = true;
        result.warnings.push({ ref, message: "item resolved as representative" });
    }

    result.resolved[ref] = resolved;
}

function resolve_ref(ref: string, options: ResolverOptions, result: ResolverResult): void {
    if (!ref.includes(".")) {
        if (ref.endsWith("_actor")) {
            resolve_actor_ref(`actor.${ref}`, options, result);
        }
        return;
    }
    if (ref.startsWith("actor.")) {
        resolve_actor_ref(ref, options, result);
        return;
    }
    if (ref.startsWith("npc.")) {
        resolve_npc_ref(ref, options, result);
        return;
    }
    if (ref.startsWith("world_tile.")) {
        resolve_world_tile_ref(ref, options, result);
        return;
    }
    if (ref.startsWith("region_tile.")) {
        resolve_region_tile_ref(ref, options, result);
        return;
    }
    if (ref.startsWith("tile.")) {
        resolve_tile_ref(ref, options, result);
        return;
    }
    if (ref.includes("item_")) {
        resolve_item_ref(ref, options, result);
    }
}

export function resolve_references(commands: CommandNode[], options: ResolverOptions): ResolverResult {
    const result: ResolverResult = { resolved: {}, errors: [], warnings: [] };

    for (const command of commands) {
        const refs: string[] = [];
        for (const value of Object.values(command.args)) collect_identifiers(value, refs);
        refs.push(command.subject);
        for (const ref of refs) resolve_ref(ref, options, result);
    }

    return result;
}
