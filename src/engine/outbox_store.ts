import * as fs from "node:fs";
import { parse } from "jsonc-parser";
import type { MessageEnvelope, OutboxFile } from "./types.js";

export function read_outbox(outbox_path: string): OutboxFile {
    const raw = fs.readFileSync(outbox_path, "utf-8");
    const parsed = parse(raw) as any;

    if (parsed?.schema_version !== 1 || !Array.isArray(parsed?.messages)) {
        throw new Error(
            "outbox.jsonc is not canonical (expected schema_version: 1 and messages: [])",
        );
    }

    for (const m of parsed.messages) {
        if (!m || typeof m.id !== "string" || typeof m.sender !== "string" || typeof m.content !== "string") {
            throw new Error("outbox.jsonc contains a non-canonical message entry");
        }
    }

    return parsed as OutboxFile;
}

export function write_outbox(outbox_path: string, outbox: OutboxFile): void {
    fs.writeFileSync(outbox_path, JSON.stringify(outbox, null, 2), "utf-8");
}

export function clear_outbox(outbox_path: string): void {
    const empty: OutboxFile = { schema_version: 1, messages: [] };
    fs.writeFileSync(outbox_path, JSON.stringify(empty, null, 2), "utf-8");
}

export function ensure_outbox_exists(outbox_path: string): void {
    if (fs.existsSync(outbox_path)) return;
    const initial: OutboxFile = { schema_version: 1, messages: [] };
    fs.writeFileSync(outbox_path, JSON.stringify(initial, null, 2), "utf-8");
}

export function append_outbox_message(outbox_path: string, message: MessageEnvelope): MessageEnvelope {
    const outbox = read_outbox(outbox_path);
    outbox.messages.unshift(message);
    write_outbox(outbox_path, outbox);
    return message;
}
