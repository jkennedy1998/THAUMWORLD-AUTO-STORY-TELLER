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
        } else {
            warnings.push(`unhandled_effect:${cmd.verb}`);
        }
    }

    return { diffs, warnings };
}
