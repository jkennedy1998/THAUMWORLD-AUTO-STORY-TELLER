/**
 * TODO NEXT: get interface program working
 * TODO ART: get renderer to tell the interface what system text the user might want to interact with (click / copy paste)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { parse } from "jsonc-parser";

const data_slot_number = 1; // hard set to 1 for now
const visual_log_limit = 12;


let current_state: "awaiting_user" | "processing" | "error" = "awaiting_user";
let message_buffer = "";
let incoming_message = "";

type LogMessage = {
  id: string; // "ISO : 000001 : randBase32RFC(6)"
  sender: string;
  content: string;
};

type LogFile = {
  schema_version: 1;
  messages: LogMessage[];
};
type InboxFile = {
    schema_version: 1;
    messages: LogMessage[]; // same shape as log.jsonc
};

const BASE32_RFC_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function get_data_slot_dir(slot: number): string { //the path to the data slot folder
  return path.join(process.cwd(), "local_data", `data_slot_${slot}`);
}

function get_log_path(slot: number): string { //the path to the log
  return path.join(get_data_slot_dir(slot), "log.jsonc");
}

function get_inbox_path(slot: number): string { //the path to the inbox
    return path.join(get_data_slot_dir(slot), "inbox.jsonc");
}
function read_inbox(inbox_path: string): InboxFile {
    const raw = fs.readFileSync(inbox_path, "utf-8");
    const parsed = parse(raw) as any;

    if (parsed?.schema_version !== 1 || !Array.isArray(parsed?.messages)) {
        throw new Error("inbox.jsonc is not canonical (expected schema_version: 1 and messages: [])");
    }

    for (const m of parsed.messages) {
        if (!m || typeof m.id !== "string" || typeof m.sender !== "string" || typeof m.content !== "string") {
            throw new Error("inbox.jsonc contains a non-canonical message entry");
        }
    }

    return parsed as InboxFile;
}
function clear_inbox(inbox_path: string): void {
    const empty: InboxFile = { schema_version: 1, messages: [] };
    fs.writeFileSync(inbox_path, JSON.stringify(empty, null, 2), "utf-8");
}

function ensure_inbox_exists(inbox_path: string): void {
    if (fs.existsSync(inbox_path)) return;
    const initial: InboxFile = { schema_version: 1, messages: [] };
    fs.writeFileSync(inbox_path, JSON.stringify(initial, null, 2), "utf-8");
}

function ensure_dir_exists(dir_path: string): void {
  if (!fs.existsSync(dir_path)) fs.mkdirSync(dir_path, { recursive: true });
}

function ensure_log_exists(log_path: string): void {
  if (fs.existsSync(log_path)) return;
  const initial: LogFile = { schema_version: 1, messages: [] };
  fs.writeFileSync(log_path, JSON.stringify(initial, null, 2), "utf-8");
}

function read_log(log_path: string): LogFile {
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

function write_log(log_path: string, log: LogFile): void {
  fs.writeFileSync(log_path, JSON.stringify(log, null, 2), "utf-8");
}

function rand_base32_rfc(count: number): string {
  let out = "";
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(Math.random() * BASE32_RFC_ALPHABET.length);
    out += BASE32_RFC_ALPHABET[idx];
  }
  return out;
}

function parse_index_from_id(id: string): number | null {
  // "ISO : 000001 : ABCDEF"
  const parts = id.split(" : ");
  if (parts.length < 3) return null;
  const n = Number(parts[1]);
  return Number.isFinite(n) ? n : null;
}

function next_message_index(messages: LogMessage[]): number {
    if (messages.length === 0) return 1;

    const first = messages[0]!;
    const first_idx = parse_index_from_id(first.id);
    if (first_idx !== null) return first_idx + 1;


    let max_idx = 0;
    for (const m of messages) {
        const idx = parse_index_from_id(m.id);
        if (idx !== null && idx > max_idx) max_idx = idx;
    }
    return max_idx + 1;
}

function make_log_id(messages: LogMessage[]): string {
    const iso = new Date().toISOString();
    const index = next_message_index(messages);
    const index_str = String(index).padStart(6, "0");
    const rand = rand_base32_rfc(6);
    return `${iso} : ${index_str} : ${rand}`;
}

function append_log_message(log_path: string, sender: string, content: string): LogMessage {
    const log = read_log(log_path);

    const msg: LogMessage = {
        id: make_log_id(log.messages),
        sender,
        content,
    };

    log.messages.unshift(msg);
    write_log(log_path, log);
    return msg;
}

// Other programs can send text here; we accumulate it until the next Breath/loop flush.
function receive_text_from_other_program(text: string): void {
  incoming_message += (incoming_message ? "\n" : "") + text;
}

function flush_incoming_messages(log_path: string): void {
    if (!incoming_message.trim()) return;
    append_log_message(log_path, "ROUTER", incoming_message.trim());
    incoming_message = "";
}

function render_visual_log(log: LogFile): void {
    // simple "window" UI: clear screen + print last N messages
    console.clear();

    const recent = log.messages.slice(-visual_log_limit);

    console.log("=== THAUMWORLD AUTO STORY TELLER ===");
    console.log(`data_slot: ${data_slot_number} | state: ${current_state}`);
    console.log("------------------------------------");

    for (const m of recent) {
        console.log(`${m.sender}: ${m.content}`);
    }

    console.log("------------------------------------");
    console.log('Type /help for commands');
}


// Breath checks for time-based tasks (routing, async waits, etc.)
function Breath(log_path: string, inbox_path: string): void {
    // shell: later we'll check current_state here for longer-running tasks
    flush_incoming_messages(log_path);
    const inbox = read_inbox(inbox_path);

    if (inbox.messages.length > 0) {
        // inbox messages already have ids; preserve sender/content and ignore their id for the log's id scheme
        // We append to the log with a fresh id (log is authoritative timeline).
        for (const m of inbox.messages) {
            append_log_message(log_path, m.sender, m.content);
        }
        clear_inbox(inbox_path);
    }
}

function initialize(): { log_path: string; inbox_path: string } {
    // NOTE: create save data if it is not present in the current data slot
    const data_slot_dir = get_data_slot_dir(data_slot_number);
    const log_path = get_log_path(data_slot_number);
    const inbox_path = get_inbox_path(data_slot_number);

    ensure_dir_exists(data_slot_dir);
    ensure_log_exists(log_path);
    ensure_inbox_exists(inbox_path);

    console.log("INTERFACE_PROGRAM initialize()");
    console.log({ data_slot_number, data_slot_dir, log_path });

    append_log_message(log_path, "SYSTEM", "INTERFACE_PROGRAM booted");

    return { log_path, inbox_path };
}

function run_cli(log_path: string, inbox_path: string): void {

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    // Breath tick
    setInterval(() => Breath(log_path, inbox_path), 150);

    const loop = (): void => {
        //re render the log display so its refreshed
        flush_incoming_messages(log_path);
        const log = read_log(log_path);
        render_visual_log(log);

        current_state = "awaiting_user";
        rl.question("> ", (user_text: string) => {
            const trimmed = user_text.trim();
            if (!trimmed) return loop(); //if the user didnt send anything at all dont process

            //itterate through the availible commands here to help the user

            if (trimmed === "/help") {
                console.log("\nCommands:\n  /help\n  /exit");
                return loop();
            }

            if (trimmed === "/exit" || trimmed === "/quit") {
                console.log("Exiting...");
                rl.close();
                process.exit(0);
            }

            current_state = "processing";
            message_buffer = user_text;

            append_log_message(log_path, "actor_1", message_buffer);

            // TODO: send message_buffer to INTERPRETER_AI (Ollama) here.
            const stub_reply = `STUB (no AI yet). You said: ${message_buffer}`;
            append_log_message(log_path, "ASSISTANT", stub_reply);

            message_buffer = "";
            current_state = "awaiting_user";
            loop();
        });
    };

    loop();
}

const { log_path, inbox_path } = initialize();
run_cli(log_path, inbox_path);

