// moved from src/interface_program/main.ts during engine split

import * as fs from "node:fs";
import { parse } from "jsonc-parser";
import type { InboxFile } from "./types.js";


export function read_inbox(inbox_path: string): InboxFile {
    const raw = fs.readFileSync(inbox_path, "utf-8");
    const parsed = parse(raw) as any;

    if (parsed?.schema_version !== 1 || !Array.isArray(parsed?.messages)) {
        throw new Error(
            "inbox.jsonc is not canonical (expected schema_version: 1 and messages: [])",
        );
    }

    for (const m of parsed.messages) {
        if (!m || typeof m.id !== "string" || typeof m.sender !== "string" || typeof m.content !== "string") {
            throw new Error("inbox.jsonc contains a non-canonical message entry");
        }
    }

    return parsed as InboxFile;
}

export function clear_inbox(inbox_path: string): void {
    const empty: InboxFile = { schema_version: 1, messages: [] };
    fs.writeFileSync(inbox_path, JSON.stringify(empty, null, 2), "utf-8");
}

export function write_inbox(inbox_path: string, inbox: InboxFile): void {
    fs.writeFileSync(inbox_path, JSON.stringify(inbox, null, 2), "utf-8");
}

export function ensure_inbox_exists(inbox_path: string): void {
    if (fs.existsSync(inbox_path)) return;
    const initial: InboxFile = { schema_version: 1, messages: [] };
    fs.writeFileSync(inbox_path, JSON.stringify(initial, null, 2), "utf-8");
}

export function append_inbox_message(inbox_path: string, message: InboxFile["messages"][number]): InboxFile["messages"][number] {
    const inbox = read_inbox(inbox_path);
    inbox.messages.unshift(message);
    write_inbox(inbox_path, inbox);
    return message;
}
