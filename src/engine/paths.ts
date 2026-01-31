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

export function get_roller_status_path(slot: number): string {
    // the path to the roller status file
    return path.join(get_data_slot_dir(slot), "roller_status.jsonc");
}

export function get_metrics_dir(slot: number): string {
    // the path to metrics storage for a data slot
    return path.join(get_data_slot_dir(slot), "metrics");
}

export function get_metrics_path(slot: number, name: string): string {
    // the path to a specific metrics jsonc file
    return path.join(get_metrics_dir(slot), `${name}.jsonc`);
}

export function get_ai_io_log_dir(slot: number): string {
    // the path to AI I/O log storage for a data slot
    return path.join(get_data_slot_dir(slot), "ai_io_logs");
}

export function get_ai_io_log_path(slot: number, name: string): string {
    // the path to a specific AI I/O log jsonc file
    return path.join(get_ai_io_log_dir(slot), `${name}.jsonc`);
}

export function get_npc_dir(slot: number): string {
    // the path to npc storage for a data slot
    return path.join(get_data_slot_dir(slot), "npcs");
}

export function get_npc_path(slot: number, npc_id: string): string {
    // the path to a specific npc jsonc file
    return path.join(get_npc_dir(slot), `${npc_id}.jsonc`);
}


export function get_actor_dir(slot: number): string {
    // the path to actor storage for a data slot
    return path.join(get_data_slot_dir(slot), "actors");
}

export function get_actor_path(slot: number, actor_id: string): string {
    // the path to a specific actor jsonc file
    return path.join(get_actor_dir(slot), `${actor_id}.jsonc`);
}


export function get_world_path(slot: number): string {
    // the path to world storage for a data slot
    return path.join(get_world_dir(slot), "world.jsonc");
}

export function get_legacy_world_path(slot: number): string {
    return path.join(get_data_slot_dir(slot), "world.jsonc");
}

export function get_default_world_path(): string {
    // the path to the default world template
    return path.join(process.cwd(), "local_data", "data_slot_default", "world", "default_world.jsonc");
}

export function get_legacy_default_world_path(): string {
    return path.join(process.cwd(), "local_data", "data_slot_default", "default_world.jsonc");
}

export function get_world_dir(slot: number): string {
    return path.join(get_data_slot_dir(slot), "world");
}

export function get_item_dir(slot: number): string {
    return path.join(get_data_slot_dir(slot), "items");
}

export function get_item_path(slot: number, item_id: string): string {
    return path.join(get_item_dir(slot), `${item_id}.jsonc`);
}

export function get_default_item_path(): string {
    return path.join(process.cwd(), "local_data", "data_slot_default", "items", "default_item.jsonc");
}

export function get_legacy_default_item_path(): string {
    return path.join(process.cwd(), "local_data", "data_slot_default", "default_item.jsonc");
}

export function get_default_actor_path(): string {
    // the path to the default actor template
    return path.join(process.cwd(), "local_data", "data_slot_default", "actors", "default_actor.jsonc");
}

export function get_legacy_default_actor_path(): string {
    return path.join(process.cwd(), "local_data", "data_slot_default", "default_actor.jsonc");
}

export function get_default_npc_path(): string {
    // the path to the default npc template
    return path.join(process.cwd(), "local_data", "data_slot_default", "npcs", "default_npc.jsonc");
}

export function get_legacy_default_npc_path(): string {
    return path.join(process.cwd(), "local_data", "data_slot_default", "default_npc.jsonc");
}

export function get_kind_definitions_path(): string {
    return path.join(process.cwd(), "local_data", "data_slot_default", "kind_definitions.jsonc");
}

export function get_language_definitions_path(): string {
    return path.join(process.cwd(), "local_data", "data_slot_default", "language_definitions.jsonc");
}

export function get_perk_trees_path(): string {
    return path.join(process.cwd(), "local_data", "data_slot_default", "perk_trees.jsonc");
}

export function get_creation_state_path(slot: number): string {
    return path.join(process.cwd(), "local_data", `data_slot_${slot}`, "creation.jsonc");
}
