import { ollama_chat, type OllamaMessage } from "../shared/ollama_client.js";
import { debug_error, debug_log } from "../shared/debug.js";
import { load_npc, save_npc } from "../npc_storage/store.js";
import { get_working_memory } from "../context_manager/index.js";
import { get_region_by_coords } from "../world_storage/store.js";

export const NPC_MEMORY_JOURNAL_CONSOLIDATE_THRESHOLD = (() => {
    const n = Number(process.env.NPC_MEMORY_JOURNAL_CONSOLIDATE_THRESHOLD ?? 25);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 25;
})();

// Helpers for memory condensation
function splitSentences(text: string): string[] {
  if (!text) return [];
  // Simple split on period, exclamation, or question marks followed by a space or end
  const parts = text.match(/[^.!?]+[.!?]+[\s|$]?/g) ?? [text];
  // Normalize whitespace
  return parts.map(p => p.trim()).filter(p => p.length > 0);
}

function condenseToTwoSentences(text: string): string {
  const sents = splitSentences(text);
  if (sents.length <= 2) return text.trim();
  // Take first two sentences and join
  return sents.slice(0, 2).join(" ");
}

const NPC_MEMORY_JOURNAL_CONSOLIDATE_TARGET = (() => {
    const n = Number(process.env.NPC_MEMORY_JOURNAL_CONSOLIDATE_TARGET ?? 12);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 12;
})();

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const NPC_AI_MODEL = process.env.NPC_AI_MODEL ?? "llama3.2:latest";
const NPC_AI_TIMEOUT_MS_RAW = Number(process.env.NPC_AI_TIMEOUT_MS ?? 120_000);
const NPC_AI_TIMEOUT_MS = Number.isFinite(NPC_AI_TIMEOUT_MS_RAW) ? NPC_AI_TIMEOUT_MS_RAW : 120_000;
const NPC_AI_KEEP_ALIVE = "30m";

function safe_string(v: unknown): string {
    return typeof v === "string" ? v : "";
}

function format_recent_events_for_prompt(slot: number, event_id: string, npc_ref: string): string {
    const mem = get_working_memory(slot, event_id);
    if (!mem) return "(no working memory found)";
    const events = Array.isArray((mem as any).recent_events) ? ((mem as any).recent_events as any[]) : [];
    if (events.length === 0) return "(no recent events)";

    const lines: string[] = [];
    for (const e of events.slice(-40)) {
        const turn = e?.turn;
        const actor = safe_string(e?.actor);
        const action = safe_string(e?.action);
        const target = safe_string(e?.target);
        const outcome = safe_string(e?.outcome);
        const tone = safe_string(e?.emotional_tone);
        const involved = actor === npc_ref || target === npc_ref;
        const marker = involved ? "*" : "-";
        lines.push(`${marker} turn ${turn ?? "?"}: ${actor}.${action}(${target ? `target=${target}` : ""}) -> ${outcome || ""}${tone ? ` [${tone}]` : ""}`.trim());
    }
    return lines.join("\n");
}

function get_region_label(slot: number, region: { world_x: number; world_y: number; region_x: number; region_y: number } | null): string {
    if (!region) return "(unknown region)";
    const res = get_region_by_coords(slot, region.world_x, region.world_y, region.region_x, region.region_y);
    if (!res.ok) return `region_tile.${region.world_x}.${region.world_y}.${region.region_x}.${region.region_y}`;
    return safe_string((res.region as any)?.name) || res.region_id;
}

function get_memory_entries(npc_obj: Record<string, unknown>): string[] {
    const mem = (npc_obj.memory as unknown);
    if (Array.isArray(mem)) {
        return mem.filter((x) => typeof x === "string").map((s) => (s as string).trim()).filter(Boolean);
    }
    if (typeof mem === "string") {
        return mem
            .split(/\n\n+/)
            .map((s) => s.trim())
            .filter(Boolean);
    }
    return [];
}

function set_memory_entries(npc_obj: Record<string, unknown>, entries: string[]): void {
    npc_obj.memory = entries;
    const meta = (npc_obj.memory_meta as Record<string, unknown>) ?? {};
    meta.last_memory_updated_at = new Date().toISOString();
    meta.entry_count = entries.length;
    npc_obj.memory_meta = meta;
}

function already_summarized_event(npc_obj: Record<string, unknown>, event_id: string): boolean {
    const meta = (npc_obj.memory_meta as Record<string, unknown>) ?? {};
    const last = safe_string(meta.last_event_id_summarized);
    return last === event_id;
}

function mark_event_summarized(npc_obj: Record<string, unknown>, event_id: string): void {
    const meta = (npc_obj.memory_meta as Record<string, unknown>) ?? {};
    meta.last_event_id_summarized = event_id;
    npc_obj.memory_meta = meta;
}

async function consolidate_entries_if_needed(npc: { id: string; name: string; personality: any }, entries: string[]): Promise<string[]> {
    if (entries.length <= NPC_MEMORY_JOURNAL_CONSOLIDATE_THRESHOLD) return entries;

    const system = `You are roleplaying as an NPC. Consolidate your memory journal while staying in-character.`;
    const user = [
        `NPC: ${npc.name} (id=${npc.id})`,
        "Personality:",
        JSON.stringify(npc.personality ?? {}, null, 2),
        "",
        `You have ${entries.length} journal entries. Consolidate them into at most ${NPC_MEMORY_JOURNAL_CONSOLIDATE_TARGET} entries.`,
        "Each entry should be 1-4 sentences and preserve the NPC's voice.",
        "Return ONLY valid JSON: an array of strings.",
        "",
        "Journal entries:",
        entries.map((e, i) => `Entry ${i + 1}: ${e}`).join("\n\n"),
    ].join("\n");

    const messages: OllamaMessage[] = [
        { role: "system", content: system },
        { role: "user", content: user },
    ];

    const res = await ollama_chat({
        host: OLLAMA_HOST,
        model: NPC_AI_MODEL,
        messages,
        keep_alive: NPC_AI_KEEP_ALIVE,
        timeout_ms: NPC_AI_TIMEOUT_MS,
        options: { temperature: 0.5 },
    });

    const raw = res.content.trim();
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
            const cleaned = (parsed as string[]).map((s) => s.trim()).filter(Boolean);
            if (cleaned.length > 0) return cleaned;
        }
    } catch {
        // fall through
    }

    // Fallback: keep the newest entries to cap growth.
    return entries.slice(-NPC_MEMORY_JOURNAL_CONSOLIDATE_THRESHOLD);
}

export async function consolidate_npc_memory_journal_if_needed(slot: number, npc_ref: string): Promise<void> {
    const npc_id = npc_ref.replace(/^npc\./, "");
    const loaded = load_npc(slot, npc_id);
    if (!loaded.ok) return;
    const npc_obj = loaded.npc as Record<string, unknown>;
    const entries = get_memory_entries(npc_obj);
    if (entries.length <= NPC_MEMORY_JOURNAL_CONSOLIDATE_THRESHOLD) return;
    const npc_name = safe_string(npc_obj.name) || npc_id;
    const npc_personality = (npc_obj.personality as any) ?? {};
    try {
        const consolidated = await consolidate_entries_if_needed({ id: npc_id, name: npc_name, personality: npc_personality }, entries);
        set_memory_entries(npc_obj, consolidated);
        save_npc(slot, npc_id, npc_obj);
        debug_log("NPCMemoryJournal", `Consolidated journal for ${npc_name}`, { npc_id, before: entries.length, after: consolidated.length });
    } catch (err) {
        debug_error("NPCMemoryJournal", `Failed to consolidate journal for ${npc_id}`, err);
    }
}

export async function append_non_timed_conversation_journal(
    slot: number,
    npc_ref: string,
    context: {
        region_label?: string;
        conversation_id?: string | null;
        transcript: string;
    }
): Promise<void> {
    const npc_id = npc_ref.replace(/^npc\./, "");
    const loaded = load_npc(slot, npc_id);
    if (!loaded.ok) return;
    const npc_obj = loaded.npc as Record<string, unknown>;
    const npc_name = safe_string(npc_obj.name) || npc_id;
    const npc_personality = (npc_obj.personality as any) ?? {};

    const system = `You are roleplaying as an NPC in a fantasy world. Stay in character. Write what YOU would remember.`;
    const user = [
        `NPC: ${npc_name} (id=${npc_id})`,
        `Location: ${context.region_label ?? "(unknown region)"}`,
        context.conversation_id ? `Conversation: ${context.conversation_id}` : "",
        "",
        "NPC personality:",
        JSON.stringify(npc_personality ?? {}, null, 2),
        "",
        "Transcript:",
        context.transcript,
        "",
        "In 2-5 sentences, what would you remember from this interaction?",
        "Do NOT use the word 'player'. Refer to other participants as 'actor.<id>' or 'npc.<id>' if they appear in the transcript.",
        "Use first-person 'I' only for yourself. Use third-person for everyone else.",
        "Return plain text only.",
    ].filter(Boolean).join("\n");

    try {
        const messages: OllamaMessage[] = [
            { role: "system", content: system },
            { role: "user", content: user },
        ];
        const res = await ollama_chat({
            host: OLLAMA_HOST,
            model: NPC_AI_MODEL,
            messages,
            keep_alive: NPC_AI_KEEP_ALIVE,
            timeout_ms: NPC_AI_TIMEOUT_MS,
            options: { temperature: 0.6 },
        });
        const summary = res.content.trim();
        if (!summary) return;

        const stamp = new Date().toISOString();
        const label = context.region_label ?? "(unknown region)";
        const entry = `[${stamp}] CONVERSATION @ ${label}\n${summary}`;

        let entries = get_memory_entries(npc_obj);
        entries.push(entry);
        entries = await consolidate_entries_if_needed({ id: npc_id, name: npc_name, personality: npc_personality }, entries);
        set_memory_entries(npc_obj, entries);
        save_npc(slot, npc_id, npc_obj);
        debug_log("NPCMemoryJournal", `Appended non-timed memory for ${npc_name}`, { npc_id });
    } catch (err) {
        debug_error("NPCMemoryJournal", `Failed to append non-timed memory for ${npc_id}`, err);
    }
}

export async function append_timed_event_memory_journal(
    slot: number,
    npc_ref: string,
    event: {
        event_id: string;
        event_type: "combat" | "conversation" | "exploration";
        participants: string[];
        region: { world_x: number; world_y: number; region_x: number; region_y: number } | null;
    }
): Promise<void> {
    const npc_id = npc_ref.replace(/^npc\./, "");
    const loaded = load_npc(slot, npc_id);
    if (!loaded.ok) return;

    const npc_obj = loaded.npc as Record<string, unknown>;
    if (already_summarized_event(npc_obj, event.event_id)) return;

    const npc_name = safe_string(npc_obj.name) || npc_id;
    const npc_personality = (npc_obj.personality as any) ?? {};
    const region_label = get_region_label(slot, event.region);
    const events_text = format_recent_events_for_prompt(slot, event.event_id, `npc.${npc_id}`);

    const system = `You are roleplaying as an NPC in a fantasy world. Stay in character. Write what YOU would remember.`;
    const user = [
        `NPC: ${npc_name} (id=${npc_id})`,
        `Event: ${event.event_type} (${event.event_id})`,
        `Location: ${region_label}`,
        `Participants: ${event.participants.join(", ")}`,
        "",
        "NPC personality:",
        JSON.stringify(npc_personality ?? {}, null, 2),
        "",
        "Observed events (" + "* = involves you" + "):",
        events_text,
        "",
        "In 2-5 sentences, what would you remember from this interaction?",
        "Focus on motives, threats, promises, impressions, and anything personally relevant to you.",
        "Do NOT use the word 'player'. Refer to other participants as 'actor.<id>' or 'npc.<id>' when possible.",
        "Use first-person 'I' only for yourself. Use third-person for everyone else.",
        "Return plain text only.",
    ].join("\n");

    try {
        const messages: OllamaMessage[] = [
            { role: "system", content: system },
            { role: "user", content: user },
        ];

        const res = await ollama_chat({
            host: OLLAMA_HOST,
            model: NPC_AI_MODEL,
            messages,
            keep_alive: NPC_AI_KEEP_ALIVE,
            timeout_ms: NPC_AI_TIMEOUT_MS,
            options: { temperature: 0.6 },
        });

        const summary = res.content.trim();
        if (!summary) return;

        const stamp = new Date().toISOString();
        const entry = `[${stamp}] ${event.event_type.toUpperCase()} @ ${region_label}\n${summary}`;

        let entries = get_memory_entries(npc_obj);
        entries.push(entry);
        entries = await consolidate_entries_if_needed({ id: npc_id, name: npc_name, personality: npc_personality }, entries);
        set_memory_entries(npc_obj, entries);
        mark_event_summarized(npc_obj, event.event_id);

        save_npc(slot, npc_id, npc_obj);
        debug_log("NPCMemoryJournal", `Appended timed-event memory for ${npc_name}`, { npc_id, event_id: event.event_id });
    } catch (err) {
        debug_error("NPCMemoryJournal", `Failed to append timed-event memory for ${npc_id}`, err);
    }
}
