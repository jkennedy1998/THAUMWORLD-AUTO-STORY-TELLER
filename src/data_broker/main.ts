import { get_data_slot_dir, get_inbox_path, get_log_path, get_outbox_path, get_status_path } from "../engine/paths.js";
import { ensure_dir_exists, ensure_log_exists } from "../engine/log_store.js";
import { ensure_inbox_exists, append_inbox_message, read_inbox } from "../engine/inbox_store.js";
import { ensure_outbox_exists, read_outbox, write_outbox, prune_outbox_messages, append_outbox_message, update_outbox_message } from "../engine/outbox_store.js";
import { create_message, try_set_message_status } from "../engine/message.js";
import type { MessageInput } from "../engine/message.js";
import { append_log_envelope } from "../engine/log_store.js";
import type { MessageEnvelope } from "../engine/types.js";
import { debug_log, debug_broker_content, DEBUG_LEVEL } from "../shared/debug.js";
import { parse_machine_text } from "../system_syntax/index.js";
import type { CommandNode } from "../system_syntax/index.js";
import { resolve_references } from "../reference_resolver/resolver.js";
import { ensure_status_exists, write_status_line } from "../engine/status_store.js";
import { ensure_actor_exists } from "../actor_storage/store.js";
import { load_actor } from "../actor_storage/store.js";
import { find_npcs, load_npc } from "../npc_storage/store.js";
import { ensure_region_tile, ensure_world_tile, load_region, get_region_by_coords, list_regions } from "../world_storage/store.js";
import { load_place, create_basic_place } from "../place_storage/store.js";
import { isCurrentSession, getSessionMeta } from "../shared/session.js";
import { debug_log as broker_debug, debug_warn } from "../shared/debug.js";
import { SERVICE_CONFIG } from "../shared/constants.js";

const data_slot_number = SERVICE_CONFIG.DEFAULT_DATA_SLOT || 1;
const POLL_MS = SERVICE_CONFIG.POLL_MS.DATA_BROKER;
const ITERATION_LIMIT = SERVICE_CONFIG.MAX_BROKER_ITERATIONS;

// Track processed interpreted message IDs to prevent duplicate processing
// This prevents race conditions where the same message gets processed multiple times
const processedInterpretedIds = new Set<string>();

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Machine text normalization functions to handle syntax variations
// These fix common errors in LLM-generated machine text

function normalize_machine_text(text: string): string {
    if (!text || text.trim().length === 0) return text;
    
    let normalized = text;
    
    // Fix 1: Replace JSON-style colons with equals in object literals
    // Match {key: value} and convert to {key=value}
    // But be careful not to break valid syntax like http:// or time stamps
    normalized = normalized.replace(/\{([^{}]*)\}/g, (match, content) => {
        // Replace colons that are between identifiers and values
        const fixed = content.replace(/([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*/g, '$1=');
        return '{' + fixed + '}';
    });
    
    // Fix 2: Handle targets=[{ref: npc.x}] pattern specifically
    // Convert to targets=[npc.x] - simpler and valid
    normalized = normalized.replace(
        /targets=\[\{ref[:=]\s*([^}]+)\}\]/g,
        'targets=[$1]'
    );

    // Fix 2b: Strip accidental property access in npc refs (npc.foo.id -> npc.foo)
    normalized = normalized.replace(/npc\.([a-zA-Z0-9_]+)\.id\b/g, 'npc.$1');
    
    // Fix 3: Remove trailing commas in lists and objects
    normalized = normalized.replace(/,(\s*[}\]])/g, '$1');
    
    // Fix 4: Fix double equals (sometimes LLM generates key==value)
    normalized = normalized.replace(/==/g, '=');
    
    // Fix 5: Ensure spaces around equals for readability (optional but helpful)
    // normalized = normalized.replace(/([^=])=([^=])/g, '$1=$2');
    
    return normalized;
}

// Fuzzy matching helpers (for resolving misspelled NPC ids)
function levenshteinDistance(a: string, b: string): number {
    const aa = a.toLowerCase();
    const bb = b.toLowerCase();
    const dp: number[][] = [];
    for (let i = 0; i <= bb.length; i++) {
        dp[i] = [];
        for (let j = 0; j <= aa.length; j++) dp[i]![j] = 0;
    }
    for (let i = 0; i <= bb.length; i++) dp[i]![0] = i;
    for (let j = 0; j <= aa.length; j++) dp[0]![j] = j;
    for (let i = 1; i <= bb.length; i++) {
        for (let j = 1; j <= aa.length; j++) {
            if (bb.charAt(i - 1) === aa.charAt(j - 1)) {
                dp[i]![j] = dp[i - 1]![j - 1]!;
            } else {
                dp[i]![j] = Math.min(
                    dp[i - 1]![j - 1]! + 1,
                    dp[i]![j - 1]! + 1,
                    dp[i - 1]![j]! + 1,
                );
            }
        }
    }
    return dp[bb.length]![aa.length]!;
}

function normalize_npc_token(ref: string): string {
    let token = ref.trim();
    if (token.startsWith('npc.')) token = token.slice('npc.'.length);
    if (token.endsWith('.id')) token = token.slice(0, -'.id'.length);
    return token;
}

function get_party_region_npc_ids(commands: CommandNode[]): string[] {
    // Best-effort: derive region from the first actor subject.
    const actor_subject = commands.find(c => c.subject.startsWith('actor.'))?.subject;
    if (!actor_subject) return [];
    const actor_id = actor_subject.split('.').slice(1).join('.');
    const loaded = load_actor(data_slot_number, actor_id);
    if (!loaded.ok) return [];
    const location = (loaded.actor.location as any) ?? {};
    const wx = Number(location?.world_tile?.x ?? 0);
    const wy = Number(location?.world_tile?.y ?? 0);
    const rx = Number(location?.region_tile?.x ?? 0);
    const ry = Number(location?.region_tile?.y ?? 0);
    const region = get_region_by_coords(data_slot_number, wx, wy, rx, ry);
    if (!region.ok) return [];
    const npcs_present = (region.region as any)?.contents?.npcs_present;
    if (!Array.isArray(npcs_present)) return [];
    const ids: string[] = [];
    for (const entry of npcs_present) {
        const npc_id = typeof entry?.npc_id === 'string' ? entry.npc_id : '';
        if (!npc_id) continue;
        ids.push(normalize_npc_token(npc_id));
    }
    return ids;
}

function find_best_npc_match(raw: string, preferred_ids: string[]): { id: string; score: number } | null {
    const needle = normalize_npc_token(raw);
    if (!needle) return null;

    const all = find_npcs(data_slot_number, {}).filter(n => n.id !== 'default_npc');
    if (all.length === 0) return null;

    const maxDistance = needle.length <= 5 ? 1 : 2;

    function score_candidates(candidates: { id: string; name: string; path: string }[]): { best: { id: string; score: number } | null; second: number } {
        let best: { id: string; score: number } | null = null;
        let secondBestScore = Number.POSITIVE_INFINITY;
        for (const npc of candidates) {
            const npc_id = npc.id;
            const npc_name = npc.name;
            let score = levenshteinDistance(needle, npc_id);
            if (npc_name) score = Math.min(score, levenshteinDistance(needle, npc_name));
            if (!best || score < best.score) {
                secondBestScore = best ? best.score : secondBestScore;
                best = { id: npc_id, score };
            } else if (score < secondBestScore) {
                secondBestScore = score;
            }
        }
        return { best, second: secondBestScore };
    }

    // Prefer NPCs in the current region first; fall back to all NPCs if no strong match.
    const preferred = preferred_ids.length > 0 ? all.filter(n => preferred_ids.includes(n.id)) : [];
    const preferred_scored = preferred.length > 0 ? score_candidates(preferred) : { best: null, second: Number.POSITIVE_INFINITY };
    const preferred_ok = preferred_scored.best && preferred_scored.best.score <= maxDistance;

    const scored = preferred_ok ? preferred_scored : score_candidates(all);
    if (!scored.best || scored.best.score > maxDistance) return null;
    if (scored.second !== Number.POSITIVE_INFINITY && (scored.second - scored.best.score) < 1) {
        return null;
    }
    return scored.best;
}

function autocorrect_npc_refs(machine_text: string, commands: CommandNode[], errors: Array<{ ref: string; reason: string }>): { updated_text: string; notes: string[] } {
    const npc_errors = errors.filter(e => e.reason === 'npc_not_found' && e.ref.startsWith('npc.'));
    if (npc_errors.length === 0) return { updated_text: machine_text, notes: [] };

    const preferred_ids = get_party_region_npc_ids(commands);
    let updated = machine_text;
    const notes: string[] = [];

    for (const err of npc_errors) {
        const raw_id = normalize_npc_token(err.ref);
        const match = find_best_npc_match(raw_id, preferred_ids);
        if (!match) continue;
        const from = raw_id;
        const to = match.id;

        // Replace npc.<from> and npc.<from>.id occurrences
        const re_plain = new RegExp(`\\bnpc\\.${from}\\b`, 'g');
        const re_id = new RegExp(`\\bnpc\\.${from}\\.id\\b`, 'g');
        updated = updated.replace(re_id, `npc.${to}`).replace(re_plain, `npc.${to}`);
        notes.push(`npc_autocorrect:${from}->${to}`);
    }

    return { updated_text: updated, notes };
}

function aggressively_normalize_machine_text(text: string): string {
    let normalized = normalize_machine_text(text);
    
    // More aggressive fixes for stubborn cases
    
    // Fix: Replace any remaining colons in value positions with equals
    // This is more aggressive and might catch cases the first pass missed
    normalized = normalized.replace(/([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1=');
    
    // Fix: Handle nested objects that might have been missed
    // Multiple passes for nested structures
    for (let i = 0; i < 3; i++) {
        const prev = normalized;
        normalized = normalized.replace(/\{([^{}]*)\}/g, (match, content) => {
            const fixed = content.replace(/([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*/g, '$1=');
            return '{' + fixed + '}';
        });
        if (normalized === prev) break; // No more changes
    }
    
    return normalized;
}

function log_syntax_normalization(original: string, normalized: string): void {
    if (original !== normalized) {
        const changes: string[] = [];
        if (original.includes(':') && !normalized.includes(':')) {
            changes.push('colons_to_equals');
        }
        if (/targets=\[\{ref:/.test(original)) {
            changes.push('simplified_targets');
        }
        if (/,\s*[}\]]/.test(original)) {
            changes.push('removed_trailing_commas');
        }
        
        debug_warn("DataBroker: machine_text normalized", {
            changes,
            original_preview: original.substring(0, 100),
            normalized_preview: normalized.substring(0, 100)
        });
    }
}

function parse_stage_iteration(stage: string | undefined): number {
    if (!stage) return 1;
    if (!stage.startsWith("interpreted_")) return 1;
    const parts = stage.split("_");
    const last = parts[parts.length - 1] ?? "";
    const n = Number(last);
    if (!Number.isFinite(n) || n <= 0) return 1;
    return Math.min(Math.trunc(n), ITERATION_LIMIT);
}

function format_error_summary(
    errors: Array<
        | string
        | { code?: string; message?: string; line?: number; column?: number }
        | { ref?: string; reason?: string; path?: string }
    >,
): string {
    if (errors.length === 0) return "none";
    return errors
        .map((err) => {
            if (typeof err === "string") return err;
            if ("reason" in err || "ref" in err) {
                const ref = err.ref ? `${err.ref}:` : "";
                const reason = err.reason ?? "unknown";
                return `${ref}${reason}`;
            }
            if ("code" in err || "message" in err) {
                const code = err.code ? `${err.code}:` : "";
                const msg = err.message ?? "unknown error";
                const loc =
                    typeof err.line === "number" && typeof err.column === "number"
                        ? `@${err.line}:${err.column}`
                        : "";
                return `${code}${msg}${loc}`;
            }
            return "unknown";
        })
        .join("; ");
}

function resolve_entities(
    commands: CommandNode[],
    options: { use_representative_data: boolean },
): {
    resolved: Record<string, unknown>;
    errors: Array<{ ref: string; reason: string; path?: string }>;
    warnings: Array<{ ref: string; message: string }>;
} {
    const resolved = resolve_references(commands, {
        slot: data_slot_number,
        use_representative_data: options.use_representative_data,
    });
    return {
        resolved: resolved.resolved,
        errors: resolved.errors,
        warnings: resolved.warnings,
    };
}

function parse_ref_parts(ref: string): string[] {
    return ref.split(".").filter((p) => p.length > 0);
}

function create_missing_entities(
    errors: Array<{ ref: string; reason: string; path?: string }>,
): { created: number; notes: string[] } {
    let created = 0;
    const notes: string[] = [];

    for (const err of errors) {
        if (err.reason === "actor_not_found") {
            const parts = parse_ref_parts(err.ref);
            const actor_id = parts[1] ?? "";
            if (!actor_id) continue;
            const created_actor = ensure_actor_exists(data_slot_number, actor_id);
            if (created_actor.ok) {
                created += 1;
                notes.push(`created actor ${actor_id}`);
            }
        }

        if (err.reason === "npc_not_found") {
            // TODO: do not auto-create NPCs here; generation happens at boot or via local rules.
        }

        if (err.reason === "world_tile_missing") {
            const parts = parse_ref_parts(err.ref);
            const x = Number(parts[1]);
            const y = Number(parts[2]);
            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
            const created_tile = ensure_world_tile(data_slot_number, x, y);
            if (created_tile.ok) {
                created += 1;
                notes.push(`created world_tile ${x},${y}`);
            }
        }

        if (err.reason === "region_tile_missing" || err.reason === "region_not_found_at_coords") {
            const parts = parse_ref_parts(err.ref);
            const world_x = Number(parts[1]);
            const world_y = Number(parts[2]);
            const region_x = Number(parts[3]);
            const region_y = Number(parts[4]);
            if (![world_x, world_y, region_x, region_y].every((n) => Number.isFinite(n))) continue;
            
            // Try to load from new region file system first
            const loaded_region = get_region_by_coords(data_slot_number, world_x, world_y, region_x, region_y);
            if (loaded_region.ok) {
                created += 1;
                notes.push(`loaded region ${loaded_region.region_id} at ${world_x},${world_y}.${region_x},${region_y}`);
                broker_debug("DataBroker: loaded region from file", { 
                    region_id: loaded_region.region_id,
                    coords: { world_x, world_y, region_x, region_y }
                });
            } else {
                // Fall back to legacy creation
                const created_region = ensure_region_tile(data_slot_number, world_x, world_y, region_x, region_y);
                if (created_region.ok) {
                    created += 1;
                    notes.push(`created region_tile ${world_x},${world_y}.${region_x},${region_y}`);
                }
            }
        }
        
        if (err.reason === "region_not_found") {
            // Try to load the region by ID directly
            const region_id = err.ref.replace("region.", "");
            const loaded = load_region(data_slot_number, region_id);
            if (loaded.ok) {
                created += 1;
                notes.push(`loaded region ${region_id}`);
                broker_debug("DataBroker: loaded region by ID", { region_id });
            }
        }

        // Handle place references - try to load existing places
        if (err.reason === "place_not_found") {
            const place_id = err.ref.replace("place.", "");
            const loaded = load_place(data_slot_number, place_id);
            if (loaded.ok) {
                created += 1;
                notes.push(`loaded place ${place_id}`);
                broker_debug("DataBroker: loaded place by ID", { place_id });
            } else {
                // Place doesn't exist - we could create a default place here
                // but for now, just log that it needs to be created manually
                notes.push(`place ${place_id} not found - requires manual creation`);
            }
        }
    }

    return { created, notes };
}

// Note: update_outbox_message is now imported from outbox_store.ts for consistency

async function process_message(outbox_path: string, inbox_path: string, log_path: string, msg: MessageEnvelope): Promise<void> {
    // Check if this message was already processed (prevents duplicate brokered messages)
    if (processedInterpretedIds.has(msg.id)) {
        // Only log at trace level to avoid spam - this is expected behavior
        if (DEBUG_LEVEL >= 4) {
            debug_log("DataBroker: skipping already processed message", { id: msg.id });
        }
        return;
    }
    
    debug_log("DataBroker: received", { id: msg.id, status: msg.status, stage: msg.stage });
    const iteration = parse_stage_iteration(msg.stage);
    const original_text = typeof (msg.meta as any)?.original_text === "string" ? ((msg.meta as any)?.original_text as string) : "";
    const should_create_data = iteration >= 4;
    const should_create_from_scratch = iteration >= 5;
    const brokered_iteration = Math.min(iteration + 1, ITERATION_LIMIT);
    debug_log("DataBroker: pass", { id: msg.id, iteration, stage: msg.stage });
    write_status_line(get_status_path(data_slot_number), `data broker pass ${iteration}: received`);

    const processing = try_set_message_status(msg, "processing");
    if (!processing.ok) return;
    update_outbox_message(outbox_path, processing.message);
    append_log_envelope(log_path, processing.message);

    const machine_text = (msg.meta as any)?.machine_text as string | undefined;
    if (!machine_text || machine_text.trim().length === 0) {
        debug_log("DataBroker: empty machine_text", { id: msg.id, stage: msg.stage });
        write_status_line(get_status_path(data_slot_number), `data broker pass ${iteration}: no machine text`);
        if (iteration >= ITERATION_LIMIT) {
            const brokered_input: MessageInput = {
                sender: "data_broker",
                content: "brokered data ready",
                stage: `brokered_${brokered_iteration}`,
                status: "sent",
                reply_to: msg.id,
                meta: {
                    machine_text: machine_text ?? "",
                    commands: [],
                    resolved: {},
                    warnings: ["machine_text_empty (band_aid)"],
                    should_create_data,
                    should_create_from_scratch,
                    original_text,
                    iteration,
                    band_aid: true,
                    ...getSessionMeta(),
                },
            };
            if (msg.correlation_id !== undefined) brokered_input.correlation_id = msg.correlation_id;
            if (msg.conversation_id !== undefined) brokered_input.conversation_id = msg.conversation_id;
            if (msg.turn_number !== undefined) brokered_input.turn_number = msg.turn_number;
            if (msg.role !== undefined) brokered_input.role = msg.role;
            const brokered = create_message(brokered_input);
            append_outbox_message(outbox_path, brokered);
            debug_log("DataBroker: band_aid brokered sent", { id: brokered.id, stage: brokered.stage });
            debug_broker_content("Broker Out", machine_text ?? "");
            write_status_line(get_status_path(data_slot_number), `data broker pass ${iteration}: band aid brokered`);

            const done = try_set_message_status(processing.message, "done");
            if (done.ok) {
                update_outbox_message(outbox_path, done.message);
                append_log_envelope(log_path, done.message);
            }
            return;
        }
        const error_input: MessageInput = {
            sender: "data_broker",
            content: `unable to parse machine text | original: ${original_text}`,
            stage: `broker_error_${iteration}`,
            status: "error",
            reply_to: msg.id,
            meta: {
                error_iteration: iteration,
                error_reason: "machine_text_empty",
                errors: ["machine_text_empty"],
                warnings: [],
                original_text,
                machine_text: machine_text ?? "",
                should_create_data,
                should_create_from_scratch,
                ...getSessionMeta(),
            },
        };

        if (msg.correlation_id !== undefined) error_input.correlation_id = msg.correlation_id;
        if (msg.conversation_id !== undefined) error_input.conversation_id = msg.conversation_id;
        if (msg.turn_number !== undefined) error_input.turn_number = msg.turn_number;
        if (msg.role !== undefined) error_input.role = msg.role;

        const error_msg = create_message(error_input);
        append_inbox_message(inbox_path, error_msg);
        debug_log("DataBroker: empty machine_text error sent", { reply_to: error_msg.reply_to, id: error_msg.id });
        write_status_line(get_status_path(data_slot_number), `data broker pass ${iteration}: error sent`);

        const done = try_set_message_status(processing.message, "done");
        if (done.ok) {
            update_outbox_message(outbox_path, done.message);
            append_log_envelope(log_path, done.message);
        }
        return;
    }

    write_status_line(get_status_path(data_slot_number), `data broker pass ${iteration}: parsing`);
    
    // Normalize machine text to fix common syntax errors before parsing
    const normalized_text = normalize_machine_text(machine_text);
    log_syntax_normalization(machine_text, normalized_text);
    
    // This is the machine text we'll actually operate on (may be auto-corrected)
    let effective_text = normalized_text;
    let parsed = parse_machine_text(effective_text);
    
    // If parse fails, try aggressive normalization
    if (parsed.errors.length > 0) {
        debug_log("DataBroker: initial parse failed, trying aggressive normalization", { 
            id: msg.id, 
            errors: parsed.errors,
            text_preview: normalized_text.substring(0, 100)
        });
        
        const aggressively_normalized = aggressively_normalize_machine_text(effective_text);
        const reparsed = parse_machine_text(aggressively_normalized);
        
        if (reparsed.errors.length === 0) {
            debug_log("DataBroker: aggressive normalization succeeded", { id: msg.id });
            parsed = reparsed;
            effective_text = aggressively_normalized;
            parsed.warnings.push({
                code: "W_SYNTAX_NORMALIZED",
                message: "Machine text syntax was auto-corrected",
                line: 1,
                column: 1
            });
        } else {
            debug_log("DataBroker: aggressive normalization also failed", { 
                id: msg.id, 
                errors: reparsed.errors 
            });
        }
    }

    if (parsed.errors.length > 0) {
        debug_log("DataBroker: parse errors", { id: msg.id, errors: parsed.errors });
        write_status_line(get_status_path(data_slot_number), `data broker pass ${iteration}: parse error`);
        if (iteration >= ITERATION_LIMIT) {
            const resolved = resolve_entities(parsed.commands, { use_representative_data: true });
            const brokered_input: MessageInput = {
                sender: "data_broker",
                content: "brokered data ready",
                stage: `brokered_${brokered_iteration}`,
                status: "sent",
                reply_to: msg.id,
                meta: {
                    machine_text: normalized_text,
                    commands: parsed.commands,
                    resolved: resolved.resolved,
                    warnings: [
                        ...parsed.warnings.map((w) => `${w.code}:${w.message}@${w.line}:${w.column}`),
                        ...parsed.errors.map((e) => `${e.code}:${e.message}@${e.line}:${e.column}`),
                        ...resolved.warnings,
                    ],
                    should_create_data,
                    should_create_from_scratch,
                    original_text,
                    iteration,
                    band_aid: true,
                    ...getSessionMeta(),
                },
            };
            if (msg.correlation_id !== undefined) brokered_input.correlation_id = msg.correlation_id;
            if (msg.conversation_id !== undefined) brokered_input.conversation_id = msg.conversation_id;
            if (msg.turn_number !== undefined) brokered_input.turn_number = msg.turn_number;
            if (msg.role !== undefined) brokered_input.role = msg.role;
            const brokered = create_message(brokered_input);
            append_outbox_message(outbox_path, brokered);
            debug_log("DataBroker: band_aid brokered sent", { id: brokered.id, stage: brokered.stage });
            debug_broker_content("Broker Out", machine_text);
            write_status_line(get_status_path(data_slot_number), `data broker pass ${iteration}: band aid brokered`);

            const done = try_set_message_status(processing.message, "done");
            if (done.ok) {
                update_outbox_message(outbox_path, done.message);
                append_log_envelope(log_path, done.message);
            }
            return;
        }
        const error_input: MessageInput = {
            sender: "data_broker",
            content: `unable to parse machine text | errors: ${format_error_summary(parsed.errors)} | original: ${original_text}`,
            stage: `broker_error_${iteration}`,
            status: "error",
            reply_to: msg.id,
            meta: {
                error_iteration: iteration,
                error_reason: "parse_error",
                errors: parsed.errors,
                warnings: parsed.warnings,
                machine_text,
                original_text,
                should_create_data,
                should_create_from_scratch,
                ...getSessionMeta(),
            },
        };

        if (msg.correlation_id !== undefined) error_input.correlation_id = msg.correlation_id;
        if (msg.conversation_id !== undefined) error_input.conversation_id = msg.conversation_id;
        if (msg.turn_number !== undefined) error_input.turn_number = msg.turn_number;
        if (msg.role !== undefined) error_input.role = msg.role;

        const error_msg = create_message(error_input);

        append_inbox_message(inbox_path, error_msg);
        debug_log("DataBroker: parse error sent", { reply_to: error_msg.reply_to, id: error_msg.id, iteration });
        write_status_line(get_status_path(data_slot_number), `data broker pass ${iteration}: error sent`);

        const done = try_set_message_status(processing.message, "done");
        if (done.ok) {
            update_outbox_message(outbox_path, done.message);
            append_log_envelope(log_path, done.message);
        }
        return;
    }

    debug_log("DataBroker: resolve start", {
        id: msg.id,
        iteration,
        should_create_data,
        should_create_from_scratch,
    });
    write_status_line(get_status_path(data_slot_number), `data broker pass ${iteration}: resolving`);
    let resolved = resolve_entities(parsed.commands, { use_representative_data: should_create_from_scratch });
    if (resolved.errors.length > 0 && should_create_data && !should_create_from_scratch) {
        const created = create_missing_entities(resolved.errors);
        if (created.created > 0) {
            debug_log("DataBroker: created missing data", { id: msg.id, created: created.created, notes: created.notes });
            write_status_line(get_status_path(data_slot_number), `data broker pass ${iteration}: created ${created.created} missing`);
            resolved = resolve_entities(parsed.commands, { use_representative_data: false });
        }
    }
    // Attempt NPC auto-correction before raising a resolve error.
    // This fixes cases like npc.glenda -> npc.grenda when the NPC exists locally.
    if (resolved.errors.length > 0 && !should_create_from_scratch && iteration < ITERATION_LIMIT) {
        const corrected = autocorrect_npc_refs(effective_text, parsed.commands, resolved.errors);
        if (corrected.updated_text !== effective_text && corrected.notes.length > 0) {
            debug_warn("DataBroker: auto-corrected npc refs", {
                id: msg.id,
                notes: corrected.notes,
                preview_before: effective_text.substring(0, 120),
                preview_after: corrected.updated_text.substring(0, 120)
            });
            
            const prev_parse_warnings = parsed.warnings;
            const reparsed = parse_machine_text(corrected.updated_text);
            if (reparsed.errors.length === 0) {
                const reresolved = resolve_entities(reparsed.commands, { use_representative_data: should_create_from_scratch });
                if (reresolved.errors.length === 0) {
                    effective_text = corrected.updated_text;
                    // Preserve previous parse warnings and add autocorrect notes
                    reparsed.warnings = [
                        ...prev_parse_warnings,
                        ...corrected.notes.map((n) => ({
                            code: "W_NPC_AUTOCORRECT",
                            message: n,
                            line: 1,
                            column: 1,
                        })),
                    ];
                    parsed = reparsed;
                    resolved = reresolved;
                }
            }
        }
    }

    if (resolved.errors.length > 0 && !should_create_from_scratch) {
        debug_log("DataBroker: resolve errors", { id: msg.id, errors: resolved.errors, warnings: resolved.warnings });
        write_status_line(get_status_path(data_slot_number), `data broker pass ${iteration}: resolve error`);
        const error_input: MessageInput = {
            sender: "data_broker",
            content: `unable to resolve referenced data | errors: ${format_error_summary(resolved.errors)} | original: ${original_text}`,
            stage: `broker_error_${iteration}`,
            status: "error",
            reply_to: msg.id,
            meta: {
                error_iteration: iteration,
                error_reason: "resolve_error",
                errors: resolved.errors,
                warnings: resolved.warnings,
                machine_text: effective_text,
                original_text,
                should_create_data,
                should_create_from_scratch,
                ...getSessionMeta(),
            },
        };

    if (msg.correlation_id !== undefined) error_input.correlation_id = msg.correlation_id;
    if (msg.conversation_id !== undefined) error_input.conversation_id = msg.conversation_id;
    if (msg.turn_number !== undefined) error_input.turn_number = msg.turn_number;
    if (msg.role !== undefined) error_input.role = msg.role;

        const error_msg = create_message(error_input);

        append_inbox_message(inbox_path, error_msg);
        debug_log("DataBroker: resolve error sent", { reply_to: error_msg.reply_to, id: error_msg.id, iteration });
        write_status_line(get_status_path(data_slot_number), `data broker pass ${iteration}: error sent`);

        const done = try_set_message_status(processing.message, "done");
        if (done.ok) {
            update_outbox_message(outbox_path, done.message);
            append_log_envelope(log_path, done.message);
        }
        return;
    }

    debug_log("DataBroker: resolve ok", { id: msg.id, warnings: resolved.warnings });
    write_status_line(get_status_path(data_slot_number), `data broker pass ${iteration}: brokered`);

    const brokered_input: MessageInput = {
        sender: "data_broker",
        content: "brokered data ready",
        stage: `brokered_${brokered_iteration}`,
        status: "sent",
        reply_to: msg.id,
        meta: {
            machine_text: effective_text,
            commands: parsed.commands,
            resolved: resolved.resolved,
            warnings: [...parsed.warnings, ...resolved.warnings],
            should_create_data,
            should_create_from_scratch,
            original_text,
            iteration,
            ...getSessionMeta(),
        },
    };

    if (msg.correlation_id !== undefined) brokered_input.correlation_id = msg.correlation_id;
    if (msg.conversation_id !== undefined) brokered_input.conversation_id = msg.conversation_id;
    if (msg.turn_number !== undefined) brokered_input.turn_number = msg.turn_number;
    if (msg.role !== undefined) brokered_input.role = msg.role;

    const brokered = create_message(brokered_input);

    // Send brokered message to outbox for rules_lawyer to process
    append_outbox_message(outbox_path, brokered);
    debug_log("DataBroker: brokered sent", { id: brokered.id, stage: brokered.stage });
    debug_broker_content("Broker Out", machine_text);

    const done = try_set_message_status(processing.message, "done");
    if (done.ok) {
        update_outbox_message(outbox_path, done.message);
        append_log_envelope(log_path, done.message);
    }

    // Mark this interpreted message as processed to prevent duplicates
    processedInterpretedIds.add(msg.id);
    debug_log("DataBroker: added to processed set", { id: msg.id, totalProcessed: processedInterpretedIds.size });

    await sleep(0);
}

// Track tick count for heartbeat logging
let tickCount = 0;
const HEARTBEAT_INTERVAL = 10; // Log heartbeat every 10 ticks (approx 8 seconds)

async function tick(outbox_path: string, inbox_path: string, log_path: string): Promise<void> {
    try {
        tickCount++;
        
        // Check both outbox and inbox for interpreted messages
        let outbox;
        let inbox;
        
        try {
            outbox = read_outbox(outbox_path);
        } catch (err) {
            debug_log("DataBroker: ERROR reading outbox", { error: err instanceof Error ? err.message : String(err) });
            return;
        }
        
        try {
            inbox = read_inbox(inbox_path);
        } catch (err) {
            debug_log("DataBroker: ERROR reading inbox", { error: err instanceof Error ? err.message : String(err) });
            return;
        }
        
        // Log heartbeat periodically to show we're alive
        if (tickCount % HEARTBEAT_INTERVAL === 0) {
            debug_log("DataBroker: heartbeat", { 
                tickCount, 
                outboxMessages: outbox.messages.length,
                inboxMessages: inbox.messages.length,
                sessionId: (await import("../shared/session.js")).SESSION_ID
            });
        }
        
        const outbox_candidates = outbox.messages.filter(
            (m) => m.stage?.startsWith("interpreted_") && m.status === "sent" && isCurrentSession(m),
        );
        
        const inbox_candidates = inbox.messages.filter(
            (m) => m.stage?.startsWith("interpreted_") && m.status === "sent" && isCurrentSession(m),
        );
        
        const candidates = [...outbox_candidates, ...inbox_candidates];

        if (candidates.length > 0) {
            debug_log("DataBroker: candidates", { count: candidates.length, from_outbox: outbox_candidates.length, from_inbox: inbox_candidates.length });
        }

        for (const msg of candidates) {
            try {
                await process_message(outbox_path, inbox_path, log_path, msg);
            } catch (err) {
                debug_log("DataBroker: ERROR processing message", { 
                    id: msg.id, 
                    error: err instanceof Error ? err.message : String(err),
                    stack: err instanceof Error ? err.stack : undefined
                });
            }
        }
    } catch (err) {
        debug_log("DataBroker: CRITICAL ERROR in tick", { 
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined
        });
    }
}

function initialize(): { outbox_path: string; inbox_path: string; log_path: string } {
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

    return { outbox_path, inbox_path, log_path };
}

const { outbox_path, inbox_path, log_path } = initialize();
debug_log("DataBroker: booted", { outbox_path, inbox_path, pollMs: POLL_MS });
debug_log("DataBroker: starting polling loop", { interval: POLL_MS });

// Start the polling loop with error handling
const intervalId = setInterval(() => {
    void tick(outbox_path, inbox_path, log_path);
}, POLL_MS);

// Log that interval was set
debug_log("DataBroker: polling interval set", { intervalId: intervalId.toString() });

// Also run first tick immediately to process any pending messages
debug_log("DataBroker: running initial tick");
void tick(outbox_path, inbox_path, log_path);
