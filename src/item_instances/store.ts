import * as fs from "node:fs";
import { parse } from "jsonc-parser";
import { ensure_dir_exists } from "../engine/log_store.js";
import { get_item_instances_dir, get_item_instance_path } from "../engine/paths.js";
import { rand_base32_rfc } from "../engine/log_store.js";
import type { TagInstance } from "../tag_system/registry.js";

export type ItemInstanceLookupResult =
    | { ok: true; instance: ItemInstance; path: string }
    | { ok: false; error: string; todo: string };

export interface ItemInstance {
    id: string;
    def_id: string;
    qty: number;
    condition?: "pristine" | "good" | "worn" | "damaged" | "broken";
    tags: TagInstance[];
    container_id: string;
    owner_ref: string;
}

function read_jsonc(pathname: string): Record<string, unknown> {
    const raw = fs.readFileSync(pathname, "utf-8");
    return (parse(raw) as Record<string, unknown>) ?? {};
}

function make_instance_id(): string {
    return `inst_${rand_base32_rfc(8)}`;
}

export function ensure_item_instances_dir(slot: number): string {
    const dir = get_item_instances_dir(slot);
    ensure_dir_exists(dir);
    return dir;
}

export function create_item_instance(
    slot: number,
    def_id: string,
    qty: number = 1,
    owner_ref: string = "system",
    container_id: string = "",
    condition: ItemInstance["condition"] = "good"
): ItemInstance {
    const instance: ItemInstance = {
        id: make_instance_id(),
        def_id,
        qty: Math.max(1, qty),
        condition,
        tags: [],
        container_id,
        owner_ref
    };
    
    save_item_instance(slot, instance);
    return instance;
}

export function load_item_instance(slot: number, instance_id: string): ItemInstanceLookupResult {
    const instance_path = get_item_instance_path(slot, instance_id);
    if (!fs.existsSync(instance_path)) {
        const todo = `Item instance cannot be found: ${instance_id}`;
        return { ok: false, error: "instance_not_found", todo };
    }

    const instance = read_jsonc(instance_path) as unknown as ItemInstance;
    return { ok: true, instance, path: instance_path };
}

export function save_item_instance(slot: number, instance: ItemInstance): string {
    ensure_item_instances_dir(slot);
    const instance_path = get_item_instance_path(slot, instance.id);
    fs.writeFileSync(instance_path, JSON.stringify(instance, null, 2), "utf-8");
    return instance_path;
}

export function delete_item_instance(slot: number, instance_id: string): boolean {
    const instance_path = get_item_instance_path(slot, instance_id);
    if (fs.existsSync(instance_path)) {
        fs.unlinkSync(instance_path);
        return true;
    }
    return false;
}

export function list_item_instances_in_container(slot: number, container_id: string): ItemInstance[] {
    const dir = ensure_item_instances_dir(slot);
    if (!fs.existsSync(dir)) return [];
    
    const files = fs.readdirSync(dir).filter(f => f.endsWith(".jsonc"));
    const instances: ItemInstance[] = [];
    
    for (const file of files) {
        const instance_id = file.replace(".jsonc", "");
        const result = load_item_instance(slot, instance_id);
        if (result.ok && result.instance.container_id === container_id) {
            instances.push(result.instance);
        }
    }
    
    return instances;
}

export function list_item_instances_by_owner(slot: number, owner_ref: string): ItemInstance[] {
    const dir = ensure_item_instances_dir(slot);
    if (!fs.existsSync(dir)) return [];
    
    const files = fs.readdirSync(dir).filter(f => f.endsWith(".jsonc"));
    const instances: ItemInstance[] = [];
    
    for (const file of files) {
        const instance_id = file.replace(".jsonc", "");
        const result = load_item_instance(slot, instance_id);
        if (result.ok && result.instance.owner_ref === owner_ref) {
            instances.push(result.instance);
        }
    }
    
    return instances;
}

export function update_item_instance_tags(
    slot: number,
    instance_id: string,
    tags: TagInstance[]
): ItemInstanceLookupResult {
    const result = load_item_instance(slot, instance_id);
    if (!result.ok) return result;
    
    result.instance.tags = tags;
    save_item_instance(slot, result.instance);
    return { ok: true, instance: result.instance, path: result.path };
}

export function update_item_instance_container(
    slot: number,
    instance_id: string,
    new_container_id: string
): ItemInstanceLookupResult {
    const result = load_item_instance(slot, instance_id);
    if (!result.ok) return result;
    
    result.instance.container_id = new_container_id;
    save_item_instance(slot, result.instance);
    return { ok: true, instance: result.instance, path: result.path };
}

export function update_item_instance_owner(
    slot: number,
    instance_id: string,
    new_owner_ref: string
): ItemInstanceLookupResult {
    const result = load_item_instance(slot, instance_id);
    if (!result.ok) return result;
    
    result.instance.owner_ref = new_owner_ref;
    save_item_instance(slot, result.instance);
    return { ok: true, instance: result.instance, path: result.path };
}

export function adjust_item_quantity(
    slot: number,
    instance_id: string,
    delta: number
): ItemInstanceLookupResult {
    const result = load_item_instance(slot, instance_id);
    if (!result.ok) return result;
    
    const new_qty = result.instance.qty + delta;
    if (new_qty <= 0) {
        delete_item_instance(slot, instance_id);
        return { ok: false, error: "item_consumed", todo: `Item ${instance_id} quantity reached 0 and was deleted` };
    }
    
    result.instance.qty = new_qty;
    save_item_instance(slot, result.instance);
    return { ok: true, instance: result.instance, path: result.path };
}
