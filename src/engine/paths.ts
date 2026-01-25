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
