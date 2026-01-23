/**
 * TODO NEXT: get interface program working
 * TODO ART: get renderer to tell the interface what system text the user might want to interact with (click / copy paste)
 */

import * as readline from "node:readline";

import { get_data_slot_dir, get_inbox_path, get_log_path } from "../engine/paths.js";
import { read_inbox, clear_inbox, ensure_inbox_exists } from "../engine/inbox_store.js";
import { ensure_dir_exists, ensure_log_exists, read_log, append_log_message } from "../engine/log_store.js";
import type { LogFile } from "../engine/types.js";


const data_slot_number = 1; // hard set to 1 for now
const visual_log_limit = 12;

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
function render_visual_log(log: LogFile, last_n: number): void {
    // TEMP: disabled to avoid fighting readline + live redraw
    // console.clear();


    console.log(`INTERFACE_PROGRAM initialize()`);
    console.log({
        data_slot_number,
        data_slot_dir: get_data_slot_dir(data_slot_number),
        log_path: get_log_path(data_slot_number),
    });

    const show = log.messages.slice(0, last_n);

    console.log(`\n--- log (last ${show.length}) ---`);
    for (let i = show.length - 1; i >= 0; i--) {
        const m = show[i];
        if (!m) continue;

        const sender = (m.sender || "").toLowerCase();
        console.log(`${sender}: ${m.content}`);
    }

    console.log("-------------------------\n");
}

// repeatedly check tasks that take time using current_state (shell)
function Breath(log_path: string, inbox_path: string): void {
    try {
        flush_incoming_messages();

        // drain inbox.jsonc
        const inbox = read_inbox(inbox_path);
        if (inbox.messages.length > 0) {
            for (let i = inbox.messages.length - 1; i >= 0; i--) {
                const msg = inbox.messages[i];
                if (!msg) continue;

                append_log_message(log_path, msg.sender, msg.content);
            }

            clear_inbox(inbox_path);
        }

        const log = read_log(log_path);
        render_visual_log(log, visual_log_limit);
    } catch (err) {
        current_state = "error";
        console.error(err);
    }
}

// run on boot (shell)
function initialize(): { log_path: string; inbox_path: string } {
    const data_slot_dir = get_data_slot_dir(data_slot_number);
    const log_path = get_log_path(data_slot_number);
    const inbox_path = get_inbox_path(data_slot_number);

    ensure_dir_exists(data_slot_dir);
    ensure_log_exists(log_path);
    ensure_inbox_exists(inbox_path);

    append_log_message(log_path, "SYSTEM", "INTERFACE_PROGRAM booted");

    return { log_path, inbox_path };
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
console.log("BOOT: main.ts reached boot section");
const { log_path, inbox_path } = initialize();
console.log("BOOT: initialize() done", { log_path, inbox_path });

console.log("BOOT: starting Breath loop");


// Live engine/UI tick (needed for external program inbox + log updates)
setInterval(() => {
    Breath(log_path, inbox_path);
}, 2000);


run_cli(log_path);
