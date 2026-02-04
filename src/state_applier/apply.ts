import { parse } from "jsonc-parser";
import * as fs from "node:fs";
import { make_log_id } from "../engine/log_store.js";
import type { CommandNode, ValueNode } from "../system_syntax/index.js";
import type { ApplyResult, AppliedDiff } from "./types.js";

const applied_effect_ids = new Set<string>();

function read_jsonc(path: string): any {
    const raw = fs.readFileSync(path, "utf-8");
    return parse(raw) as any;
}

function write_jsonc(path: string, data: any): void {
    fs.writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
}

function get_identifier(value: ValueNode | undefined): string | null {
    if (!value || value.type !== "identifier") return null;
    return value.value;
}

function get_number(value: ValueNode | undefined): number | null {
    if (!value || value.type !== "number") return null;
    return value.value;
}

function extract_effect_id(args: Record<string, ValueNode>): string {
    const explicit = get_identifier(args.effect_id as ValueNode | undefined);
    if (explicit) return explicit;
    return make_log_id(1);
}

function parse_item_id(ref: string): string | null {
    const parts = ref.split(".");
    const item_part = parts.find((p) => p.startsWith("item_"));
    return item_part ?? null;
}

function clamp(n: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, n));
}

function apply_damage(effect_id: string, target_path: string, mag: number, diffs: AppliedDiff[]): void {
    const data = read_jsonc(target_path);
    const current = data?.resources?.health?.current ?? 0;
    const max = data?.resources?.health?.max ?? current;
    const next = clamp(current - mag, 0, max);
    data.resources = data.resources ?? {};
    data.resources.health = data.resources.health ?? { current, max };
    data.resources.health.current = next;
    write_jsonc(target_path, data);
    diffs.push({ effect_id, target: data.id ?? target_path, field: "resources.health.current", delta: -mag, reason: "SYSTEM.APPLY_DAMAGE" });
}

function apply_heal(effect_id: string, target_path: string, mag: number, diffs: AppliedDiff[]): void {
    const data = read_jsonc(target_path);
    const current = data?.resources?.health?.current ?? 0;
    const max = data?.resources?.health?.max ?? current;
    const next = clamp(current + mag, 0, max);
    data.resources = data.resources ?? {};
    data.resources.health = data.resources.health ?? { current, max };
    data.resources.health.current = next;
    write_jsonc(target_path, data);
    diffs.push({ effect_id, target: data.id ?? target_path, field: "resources.health.current", delta: mag, reason: "SYSTEM.APPLY_HEAL" });
}

function adjust_inventory(effect_id: string, target_path: string, item_ref: string, mag: number, diffs: AppliedDiff[]): void {
    const data = read_jsonc(target_path);
    const inventory = Array.isArray(data.inventory) ? data.inventory : [];
    const item_id = parse_item_id(item_ref) ?? item_ref;

    let entry = inventory.find((i: any) => i?.id === item_id);
    if (!entry && mag > 0) {
        entry = { id: item_id, count: 0, tags: [] };
        inventory.push(entry);
    }

    if (entry) {
        const prev = Number(entry.count ?? 1);
        const next = prev + mag;
        entry.count = next;
        if (entry.count <= 0) {
            const idx = inventory.indexOf(entry);
            if (idx >= 0) inventory.splice(idx, 1);
        }
    }

    data.inventory = inventory;
    write_jsonc(target_path, data);
    diffs.push({ effect_id, target: data.id ?? target_path, field: `inventory.${item_id}`, delta: mag, reason: "SYSTEM.ADJUST_INVENTORY" });
}

function apply_awareness(effect_id: string, target_path: string, target_ref: string, clarity: string | null, diffs: AppliedDiff[]): void {
    const data = read_jsonc(target_path);
    const tags = Array.isArray(data.tags) ? data.tags : [];
    const info: string[] = [target_ref];
    if (clarity === "obscured") info.push("obscured");
    tags.push({ name: "AWARENESS", mag: 1, info });
    data.tags = tags;
    write_jsonc(target_path, data);
    diffs.push({ effect_id, target: data.id ?? target_path, field: "tags", delta: 1, reason: "SYSTEM.SET_AWARENESS" });
}

// Parse tile reference and extract coordinates
// Supports: region_tile.<world_x>.<world_y>.<region_x>.<region_y>
//           place_tile.<region>.<place>.<x>.<y>
function parse_tile_ref(tile_ref: string): { world_x?: number; world_y?: number; region_x?: number; region_y?: number; tile_x?: number; tile_y?: number; place_id?: string } | null {
    const parts = tile_ref.split(".");
    
    // region_tile.world_x.world_y.region_x.region_y
    if (parts[0] === "region_tile" && parts.length >= 5) {
        const world_x = parts[1] ? parseInt(parts[1], 10) : NaN;
        const world_y = parts[2] ? parseInt(parts[2], 10) : NaN;
        const region_x = parts[3] ? parseInt(parts[3], 10) : NaN;
        const region_y = parts[4] ? parseInt(parts[4], 10) : NaN;
        if (!isNaN(world_x) && !isNaN(world_y) && !isNaN(region_x) && !isNaN(region_y)) {
            return { world_x, world_y, region_x, region_y };
        }
    }
    
    // place_tile.region.place.x.y
    if (parts[0] === "place_tile" && parts.length >= 5) {
        const place_id = parts.slice(1, parts.length - 2).join("_");
        const x_part = parts[parts.length - 2];
        const y_part = parts[parts.length - 1];
        const tile_x = x_part ? parseInt(x_part, 10) : NaN;
        const tile_y = y_part ? parseInt(y_part, 10) : NaN;
        if (!isNaN(tile_x) && !isNaN(tile_y)) {
            return { place_id, tile_x, tile_y };
        }
    }
    
    // place.region.place (just the place itself, use default entry)
    if (parts[0] === "place" && parts.length >= 3) {
        const place_id = parts.slice(1).join("_");
        return { place_id };
    }
    
    return null;
}

function apply_occupancy(effect_id: string, target_path: string, tiles: string[], diffs: AppliedDiff[]): void {
    if (tiles.length === 0) {
        return;
    }
    
    const data = read_jsonc(target_path);
    const tile_ref = tiles[0]; // Use first tile
    if (!tile_ref) {
        return;
    }
    const coords = parse_tile_ref(tile_ref);
    
    if (!coords) {
        return;
    }
    
    // Update location fields
    data.location = data.location ?? {};
    
    if (coords.world_x !== undefined) {
        data.location.world_tile = { x: coords.world_x, y: coords.world_y };
    }
    if (coords.region_x !== undefined) {
        data.location.region_tile = { x: coords.region_x, y: coords.region_y };
    }
    if (coords.tile_x !== undefined) {
        data.location.tile = { x: coords.tile_x, y: coords.tile_y };
    }
    if (coords.place_id) {
        data.location.place_id = coords.place_id;
    }
    
    write_jsonc(target_path, data);
    diffs.push({ effect_id, target: data.id ?? target_path, field: "location", delta: 1, reason: "SYSTEM.SET_OCCUPANCY" });
}

export function apply_effects(commands: CommandNode[], target_paths: Record<string, string>): ApplyResult {
    const diffs: AppliedDiff[] = [];
    const warnings: string[] = [];

    for (const cmd of commands) {
        if (cmd.subject !== "SYSTEM") {
            warnings.push(`unknown_effect_subject:${cmd.subject}`);
            continue;
        }

        const effect_id = extract_effect_id(cmd.args);
        if (applied_effect_ids.has(effect_id)) continue;
        applied_effect_ids.add(effect_id);

        const target_ref = get_identifier(cmd.args.target);
        const mag = get_number(cmd.args.mag) ?? 0;
        if (!target_ref) {
            warnings.push("missing_target_ref");
            continue;
        }

        const target_path = target_paths[target_ref] ?? target_paths[`actor.${target_ref}`];
        if (!target_path) {
            warnings.push(`missing_target_path:${target_ref}`);
            continue;
        }

        if (cmd.verb === "APPLY_DAMAGE") {
            apply_damage(effect_id, target_path, mag, diffs);
        } else if (cmd.verb === "APPLY_HEAL") {
            apply_heal(effect_id, target_path, mag, diffs);
        } else if (cmd.verb === "ADJUST_INVENTORY") {
            const item_ref = get_identifier(cmd.args.item) ?? "item";
            adjust_inventory(effect_id, target_path, item_ref, mag, diffs);
        } else if (cmd.verb === "SET_AWARENESS") {
            const observer_ref = get_identifier(cmd.args.observer) ?? target_ref;
            const observer_path = target_paths[observer_ref] ?? target_paths[`actor.${observer_ref}`];
            if (!observer_path) {
                warnings.push(`missing_observer_path:${observer_ref}`);
                continue;
            }
            const clarity = get_identifier(cmd.args.clarity) ?? null;
            apply_awareness(effect_id, observer_path, target_ref, clarity, diffs);
        } else if (cmd.verb === "SET_OCCUPANCY") {
            // Parse tiles list from command args
            const tiles_arg = cmd.args.tiles;
            const tiles: string[] = [];
            if (tiles_arg?.type === "list") {
                for (const item of tiles_arg.value) {
                    if (item.type === "identifier") {
                        tiles.push(item.value);
                    }
                }
            }
            if (tiles.length === 0) {
                warnings.push(`missing_tiles:${target_ref}`);
                continue;
            }
            apply_occupancy(effect_id, target_path, tiles, diffs);
        } else {
            warnings.push(`unhandled_effect:${cmd.verb}`);
        }
    }

    return { diffs, warnings };
}
