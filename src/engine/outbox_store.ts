import * as fs from "node:fs";
import * as path from "node:path";
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

export function prune_outbox_messages(outbox: OutboxFile, max_messages: number): OutboxFile {
    if (max_messages <= 0) return outbox;
    if (outbox.messages.length <= max_messages) return outbox;

    const next = { ...outbox, messages: [...outbox.messages] };
    let over = next.messages.length - max_messages;
    if (over <= 0) return next;

    // First try to remove "done" messages
    for (let i = next.messages.length - 1; i >= 0 && over > 0; i--) {
        const msg = next.messages[i];
        if (msg?.status === "done") {
            next.messages.splice(i, 1);
            over--;
        }
    }
    
    // If still over limit, remove oldest messages regardless of status
    // Keep newest messages (at start of array), remove oldest (at end)
    while (over > 0 && next.messages.length > 0) {
        next.messages.pop();
        over--;
    }

    return next;
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

// Status priority for deduplication (higher = keep this one)
const STATUS_PRIORITY: Record<string, number> = {
    "done": 4,
    "processing": 3,
    "sent": 2,
    "queued": 1
};

/**
 * Atomic file locking helper for outbox operations
 * Prevents race conditions when multiple services update the outbox
 */
function acquireLock(lockPath: string, maxRetries = 10, retryDelay = 50): boolean {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            fs.writeFileSync(lockPath, process.pid.toString(), { flag: 'wx' });
            return true;
        } catch (e) {
            if (attempt < maxRetries - 1) {
                // Simple delay - use sync to avoid async complications
                const start = Date.now();
                while (Date.now() - start < retryDelay) {
                    // Busy wait
                }
            }
        }
    }
    return false;
}

function releaseLock(lockPath: string): void {
    try {
        if (fs.existsSync(lockPath)) {
            fs.unlinkSync(lockPath);
        }
    } catch {
        // Ignore errors when releasing lock
    }
}

/**
 * Append a message to the outbox with deduplication
 * FIX: Now uses atomic file locking and deduplication by default
 */
export function append_outbox_message(outbox_path: string, message: MessageEnvelope): MessageEnvelope {
    const lockPath = outbox_path + '.lock';
    
    if (!acquireLock(lockPath)) {
        // Failed to acquire lock, but still try to append (best effort)
        console.warn(`[OutboxStore] Failed to acquire lock for append, proceeding anyway`);
    }
    
    try {
        const outbox = read_outbox(outbox_path);
        
        // Check for duplicates
        const existing_index = outbox.messages.findIndex(m => m.id === message.id);
        if (existing_index >= 0) {
            const existing = outbox.messages[existing_index]!;
            const existing_priority = STATUS_PRIORITY[existing.status || "queued"] || 0;
            const new_priority = STATUS_PRIORITY[message.status || "queued"] || 0;
            
            // Only update if new status has equal or higher priority
            if (new_priority >= existing_priority) {
                outbox.messages[existing_index] = { ...existing, ...message };
                write_outbox(outbox_path, outbox);
            }
            return message;
        }
        
        // No duplicate found, append as normal
        outbox.messages.unshift(message);
        const pruned = prune_outbox_messages(outbox, 10);
        write_outbox(outbox_path, pruned);
        return message;
    } finally {
        releaseLock(lockPath);
    }
}

/**
 * Update a message in the outbox atomically
 * FIX: Now uses file locking to prevent race conditions
 */
export function update_outbox_message(outbox_path: string, message: MessageEnvelope): MessageEnvelope {
    const lockPath = outbox_path + '.lock';
    
    if (!acquireLock(lockPath)) {
        console.warn(`[OutboxStore] Failed to acquire lock for update, proceeding anyway`);
    }
    
    try {
        const outbox = read_outbox(outbox_path);
        const index = outbox.messages.findIndex(m => m.id === message.id);
        if (index >= 0) {
            // Merge with existing to preserve fields not in the update
            outbox.messages[index] = { ...outbox.messages[index], ...message };
            write_outbox(outbox_path, outbox);
        }
        return message;
    } finally {
        releaseLock(lockPath);
    }
}

/**
 * Legacy deduped append - now just calls append_outbox_message
 * @deprecated Use append_outbox_message instead (now has dedup by default)
 */
export function append_outbox_message_deduped(
    outbox_path: string, 
    message: MessageEnvelope
): MessageEnvelope {
    return append_outbox_message(outbox_path, message);
}

export function remove_duplicate_messages(outbox_path: string): number {
    const lockPath = outbox_path + '.lock';
    
    if (!acquireLock(lockPath)) {
        console.warn(`[OutboxStore] Failed to acquire lock for dedup, proceeding anyway`);
    }
    
    try {
        const outbox = read_outbox(outbox_path);
        const seen = new Map<string, MessageEnvelope>();
        
        for (const msg of outbox.messages) {
            const existing = seen.get(msg.id);
            if (!existing) {
                seen.set(msg.id, msg);
            } else {
                // Keep message with higher priority status
                const existing_priority = STATUS_PRIORITY[existing.status || "queued"] || 0;
                const new_priority = STATUS_PRIORITY[msg.status || "queued"] || 0;
                if (new_priority > existing_priority) {
                    seen.set(msg.id, msg);
                }
            }
        }
        
        const unique_messages = Array.from(seen.values());
        const removed_count = outbox.messages.length - unique_messages.length;
        
        if (removed_count > 0) {
            outbox.messages = unique_messages;
            write_outbox(outbox_path, outbox);
        }
        
        return removed_count;
    } finally {
        releaseLock(lockPath);
    }
}
