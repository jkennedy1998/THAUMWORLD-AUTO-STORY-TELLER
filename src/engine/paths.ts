// moved from src/interface_program/main.ts during engine split

import * as path from "node:path";

export function get_data_slot_dir(slot: number): string {
    // the path to the data slot folder
    return path.join(process.cwd(), "local_data", `data_slot_${slot}`);
}

export function get_log_path(slot: number): string {
    // the path to the log
    return path.join(get_data_slot_dir(slot), "log.jsonc");
}

export function get_inbox_path(slot: number): string {
    // the path to the inbox
    return path.join(get_data_slot_dir(slot), "inbox.jsonc");
}

export function get_outbox_path(slot: number): string {
    // the path to the outbox
    return path.join(get_data_slot_dir(slot), "outbox.jsonc");
}

export function get_status_path(slot: number): string {
    // the path to the status file
    return path.join(get_data_slot_dir(slot), "status.jsonc");
}

export function get_npc_dir(slot: number): string {
    // the path to npc storage for a data slot
    return path.join(get_data_slot_dir(slot), "npcs");
}

export function get_npc_path(slot: number, npc_id: string): string {
    // the path to a specific npc jsonc file
    return path.join(get_npc_dir(slot), `${npc_id}.jsonc`);
}

export function get_default_npc_path(): string {
    // the path to the default npc template
    return path.join(process.cwd(), "local_data", "data_slot_default", "default_npc.jsonc");
}

export function get_default_item_path(): string {
    // the path to the default item template
    return path.join(process.cwd(), "local_data", "data_slot_default", "default_item.jsonc");
}

export function get_actor_dir(slot: number): string {
    // the path to actor storage for a data slot
    return path.join(get_data_slot_dir(slot), "actors");
}

export function get_actor_path(slot: number, actor_id: string): string {
    // the path to a specific actor jsonc file
    return path.join(get_actor_dir(slot), `${actor_id}.jsonc`);
}

export function get_default_actor_path(): string {
    // the path to the default actor template
    return path.join(process.cwd(), "local_data", "data_slot_default", "default_actor.jsonc");
}

export function get_world_path(slot: number): string {
    // the path to world storage for a data slot
    return path.join(get_data_slot_dir(slot), "world.jsonc");
}

export function get_default_world_path(): string {
    // the path to the default world template
    return path.join(process.cwd(), "local_data", "data_slot_default", "default_world.jsonc");
}
