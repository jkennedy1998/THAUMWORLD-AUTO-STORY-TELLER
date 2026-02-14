// moved from src/interface_program/main.ts during engine split

import * as fs from "node:fs";
import { parse } from "jsonc-parser";
import type { LogFile, MessageEnvelope } from "./types.js";
import { BASE32_RFC_ALPHABET } from "./types.js";


export function ensure_dir_exists(dir_path: string): void {
    if (!fs.existsSync(dir_path)) fs.mkdirSync(dir_path, { recursive: true });
}

export function ensure_log_exists(log_path: string): void {
    if (fs.existsSync(log_path)) return;
    const initial: LogFile = { schema_version: 1, messages: [] };
    fs.writeFileSync(log_path, JSON.stringify(initial, null, 2), "utf-8");
}

export function read_log(log_path: string): LogFile {
    const raw = fs.readFileSync(log_path, "utf-8");
    const parsed = parse(raw) as any;

    if (parsed?.schema_version !== 1 || !Array.isArray(parsed?.messages)) {
        throw new Error("log.jsonc is not canonical (expected schema_version: 1 and messages: [])");
    }

    for (const m of parsed.messages) {
        if (!m || typeof m.id !== "string" || typeof m.sender !== "string" || typeof m.content !== "string") {
            throw new Error("log.jsonc contains a non-canonical message entry");
        }
    }

    return parsed as LogFile;
}

export function write_log(log_path: string, log: LogFile): void {
    fs.writeFileSync(log_path, JSON.stringify(log, null, 2), "utf-8");
}

export function rand_base32_rfc(length: number): string {
    let out = "";
    for (let i = 0; i < length; i++) {
        const idx = Math.floor(Math.random() * BASE32_RFC_ALPHABET.length);
        out += BASE32_RFC_ALPHABET[idx];
    }
    return out;
}

export function parse_index_from_id(id: string): number | null {
    const parts = id.split(" : ").map((s) => s.trim());
    if (parts.length < 3) return null;
    const idx_str = parts[1];
    const idx = Number(idx_str);
    if (!Number.isFinite(idx)) return null;
    return idx;
}

export function next_message_index(log: LogFile): number {
    // log is newest-first (unshift), so latest index is messages[0]
    const head = log.messages[0];
    if (!head) return 1;

    const parsed = parse_index_from_id(head.id);
    if (parsed === null) return log.messages.length + 1;

    return parsed + 1;
}

export function make_log_id(message_index: number): string {
    const iso = new Date().toISOString();
    const idx = String(message_index).padStart(6, "0");
    const rand = rand_base32_rfc(6);
    return `${iso} : ${idx} : ${rand}`;
}

export function append_log_message(log_path: string, sender: string, content: string): MessageEnvelope {
    const log = read_log(log_path);
    const idx = next_message_index(log);

    const msg: MessageEnvelope = {
        id: make_log_id(idx),
        sender,
        content,
    };

    // newest-first
    log.messages.unshift(msg);

    // Rotate log if it gets too large (keep last 100 messages for cleaner UI)
    const MAX_LOG_MESSAGES = 100;
    if (log.messages.length > MAX_LOG_MESSAGES) {
        log.messages = log.messages.slice(0, MAX_LOG_MESSAGES);
    }

    write_log(log_path, log);
    return msg;
}

export function append_log_envelope(log_path: string, message: MessageEnvelope): MessageEnvelope {
    const log = read_log(log_path);

    // Dedup by id: keep the newest copy of a message envelope.
    // Many services append updated status versions of the same message id.
    log.messages = log.messages.filter((m) => m?.id !== message.id);
    log.messages.unshift(message);
    
    // Rotate log if it gets too large (keep last 100 messages for cleaner UI)
    const MAX_LOG_MESSAGES = 100;
    if (log.messages.length > MAX_LOG_MESSAGES) {
        log.messages = log.messages.slice(0, MAX_LOG_MESSAGES);
    }
    
    write_log(log_path, log);
    return message;
}

export function prune_log_noise(log_path: string, opts?: { max_messages?: number }): void {
    const max_messages = opts?.max_messages ?? 4000;
    const log = read_log(log_path);

    // Remove pure-noise messages that are not useful for narrative/UI and can spam the log.
    // These are coordination messages between renderer and npc_ai.
    log.messages = log.messages.filter((m: any) => {
        if (m?.type === "npc_position_update") return false;
        return true;
    });

    if (log.messages.length > max_messages) {
        log.messages = log.messages.slice(0, max_messages);
    }

    write_log(log_path, log);
}
