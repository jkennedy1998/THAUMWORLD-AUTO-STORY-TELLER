import * as readline from "node:readline";
import * as http from "node:http";
import { debug_log } from "../shared/debug.js";

import { get_data_slot_dir, get_inbox_path, get_log_path, get_outbox_path, get_status_path } from "../engine/paths.js";
import { read_inbox, clear_inbox, ensure_inbox_exists, append_inbox_message } from "../engine/inbox_store.js";
import { ensure_outbox_exists } from "../engine/outbox_store.js";
import { ensure_dir_exists, ensure_log_exists, read_log, append_log_message } from "../engine/log_store.js";
import { append_outbox_message } from "../engine/outbox_store.js";
import { append_log_envelope } from "../engine/log_store.js";
import { create_correlation_id, create_message } from "../engine/message.js";
import { route_message } from "../engine/router.js";
import type { MessageEnvelope } from "../engine/types.js";
import type { LogFile } from "../engine/types.js";
import { ensure_status_exists, read_status, write_status_line } from "../engine/status_store.js";

const data_slot_number = 1; // hard set to 1 for now
const visual_log_limit = 12;
const HTTP_PORT = 8787;
// const ENABLE_CLI_LOG = false;

let current_state: "awaiting_user" | "processing" | "error" = "awaiting_user";
let message_buffer = ""; // message construction buffer
let incoming_message = ""; // received text from other programs (routing)

// other programs/applications can send this program text (a string)
function receive_text_from_other_program(text: string): void {
    incoming_message += text;
}

// flush incoming_message into message_buffer (shell)
function flush_incoming_messages(): void {
    if (!incoming_message) return;
    message_buffer += incoming_message;
    incoming_message = "";
}

// print last N lines of the log in a minimal "visual log" window
function render_visual_log(_log: LogFile, _last_n: number): void {}

type InputRequest = {
    text: string;
    sender?: string;
};

function start_http_server(log_path: string): void {
    const server = http.createServer((req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");

        if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
        }

        const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
        if (url.pathname === "/api/input") {
            if (req.method !== "POST") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            const MAX_BYTES = 64 * 1024;
            let body = "";

            req.on("data", (chunk) => {
                body += chunk;
                if (body.length > MAX_BYTES) {
                    res.writeHead(413, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "payload_too_large" }));
                    req.destroy();
                }
            });

            req.on("end", () => {
                let parsed: InputRequest | null = null;
                try {
                    parsed = JSON.parse(body) as InputRequest;
                } catch {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "invalid_json" }));
                    return;
                }

                const text = typeof parsed?.text === "string" ? parsed.text : "";
                if (!text.trim()) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "empty_text" }));
                    return;
                }

                const sender = typeof parsed?.sender === "string" && parsed.sender.trim().length > 0
                    ? parsed.sender.trim()
                    : "J";

                current_state = "processing";

                const inbound = create_message({
                    sender,
                    content: text,
                    type: "user_input",
                    status: "queued",
                    correlation_id: create_correlation_id(),
                });

                append_inbox_message(inbox_path, inbound);
                current_state = "awaiting_user";

                write_status_line(get_status_path(data_slot_number), "received actor input");

                debug_log("HTTP input received", { sender, length: text.length, id: inbound.id });

                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, id: inbound.id }));
            });
            return;
        }

        if (url.pathname === "/api/log") {
            if (req.method !== "GET") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            const slot_raw = url.searchParams.get("slot");
            const slot = slot_raw ? Number(slot_raw) : data_slot_number;
            if (!Number.isFinite(slot) || slot <= 0) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "invalid_slot" }));
                return;
            }

            try {
                const log = read_log(get_log_path(slot));
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, messages: log.messages }));
            } catch (err: any) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: err?.message ?? "read_failed" }));
            }
            return;
        }

        if (url.pathname === "/api/status") {
            if (req.method !== "GET") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            const slot_raw = url.searchParams.get("slot");
            const slot = slot_raw ? Number(slot_raw) : data_slot_number;
            if (!Number.isFinite(slot) || slot <= 0) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "invalid_slot" }));
                return;
            }

            try {
                const status = read_status(get_status_path(slot));
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, status }));
            } catch (err: any) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: err?.message ?? "read_failed" }));
            }
            return;
        }

        if (url.pathname !== "/api/input") {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "not_found" }));
            return;
        }
    });

    server.listen(HTTP_PORT, () => {
        debug_log(`HTTP bridge listening on http://localhost:${HTTP_PORT}/api/input`);
    });
}

// repeatedly check tasks that take time using current_state (shell)
// Breath is the stage coordinator for routing and state transitions.
function Breath(log_path: string, inbox_path: string, outbox_path: string): void {
    try {
        flush_incoming_messages();

        // drain inbox.jsonc
        const inbox = read_inbox(inbox_path);
        if (inbox.messages.length > 0) {
            for (let i = inbox.messages.length - 1; i >= 0; i--) {
                const msg = inbox.messages[i];
                if (!msg) continue;

                const normalized: MessageEnvelope = {
                    ...msg,
                    created_at: msg.created_at ?? new Date().toISOString(),
                };

                const is_user = msg.sender?.toLowerCase() === "j";
                if (normalized.correlation_id === undefined && is_user) {
                    normalized.correlation_id = create_correlation_id();
                }

                const routed = route_message(normalized);
                append_log_envelope(log_path, routed.log);

                debug_log("Breath: inbox message routed", {
                    id: routed.log.id,
                    sender: routed.log.sender,
                    stage: routed.log.stage,
                    status: routed.log.status,
                });

                write_status_line(
                    get_status_path(data_slot_number),
                    "routing message to the pipeline",
                );

                if (routed.outbox) {
                    append_outbox_message(outbox_path, routed.outbox);
                    debug_log("Breath: outbox queued", {
                        id: routed.outbox.id,
                        stage: routed.outbox.stage,
                        status: routed.outbox.status,
                    });

                    write_status_line(
                        get_status_path(data_slot_number),
                        "queued for interpretation",
                    );
                }

                if (msg.sender?.toLowerCase() === "interpreter_ai") {
                }
            }

            clear_inbox(inbox_path);
        }

        // visual log disabled; use UI windows instead
    } catch (err) {
        current_state = "error";
        console.error(err);
    }
}

// run on boot (shell)
function initialize(): { log_path: string; inbox_path: string; outbox_path: string } {
    const data_slot_dir = get_data_slot_dir(data_slot_number);
    const log_path = get_log_path(data_slot_number);
    const inbox_path = get_inbox_path(data_slot_number);
    const outbox_path = get_outbox_path(data_slot_number);
    const status_path = get_status_path(data_slot_number);

    ensure_dir_exists(data_slot_dir);
    ensure_log_exists(log_path);
    ensure_inbox_exists(inbox_path);
    ensure_outbox_exists(outbox_path);
    ensure_status_exists(status_path);

    write_status_line(status_path, "awaiting actor input");

    append_log_message(log_path, "SYSTEM", "INTERFACE_PROGRAM booted");

    return { log_path, inbox_path, outbox_path };
}

// TEMP DEBUG CLI:
// This will be removed/replaced by monospace canvas UI.
// It is not responsible for screen rendering anymore and has been detatched. from powershell console use.
function run_cli(log_path: string): void {

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const loop = () => {
        rl.question("> ", (user_text: string) => {
            const trimmed = user_text.trim();
            if (!trimmed) return loop();

            if (trimmed === "/help") {
                console.log("\nCommands:\n  /help\n  /exit (or /quit)\n");
                return loop();
            }

            if (trimmed === "/exit" || trimmed === "/quit") {
                console.log("Exiting...");
                rl.close();
                process.exit(0);
            }

            // leave a comment to change current_state and send message to the INTERPRETER_AI when user sends a message
            current_state = "processing";
            append_log_message(log_path, "J", trimmed);

            // stub response for now
            append_log_message(log_path, "ASSISTANT", `STUB (no AI yet). You said: ${trimmed}`);

            current_state = "awaiting_user";
            loop();
        });
    };

    loop();
}

// ---- boot ----
const { log_path, inbox_path, outbox_path } = initialize();
start_http_server(log_path);


// Live engine/UI tick (needed for external program inbox + log updates)
setInterval(() => {
    Breath(log_path, inbox_path, outbox_path);
}, 2000);


run_cli(log_path);
