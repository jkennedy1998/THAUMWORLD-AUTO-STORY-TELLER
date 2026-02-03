import { make_fill_module } from '../mono_ui/modules/fill_module.js';
import { make_button_module } from '../mono_ui/modules/button_module.js';
import { make_text_window_module, type TextWindowMessage } from '../mono_ui/modules/window_module.js';
import { make_input_module } from '../mono_ui/modules/input_module.js';
import { make_roller_module } from '../mono_ui/modules/roller_module.js';
import type { Module, Rgb } from '../mono_ui/types.js';
import { debug_warn } from '../shared/debug.js';
import { get_color_by_name } from '../mono_ui/colors.js';
import { infer_action_verb_hint } from '../shared/intent_hint.js';

export const APP_CONFIG = {
    font_family: 'Martian Mono',
    base_font_size_px: 10,
    base_line_height_mult: 1.5,
    base_letter_spacing_mult: 0.08,
    weight_index_to_css: [100, 200, 300, 400, 500, 600, 700, 800] as const,

    grid_width: 120,
    grid_height: 44,

    interpreter_endpoint: 'http://localhost:8787/api/input',
    interpreter_log_endpoint: 'http://localhost:8787/api/log',
    interpreter_status_endpoint: 'http://localhost:8787/api/status',
    interpreter_targets_endpoint: 'http://localhost:8787/api/targets',
    roller_status_endpoint: 'http://localhost:8787/api/roller_status',
    roller_roll_endpoint: 'http://localhost:8787/api/roll',
    selected_data_slot: 1,
    input_actor_id: 'henry_actor',
} as const;

export type AppState = {
    modules: Module[];
    start_window_feed_polling: (interval_ms: number) => void;
};

type WindowFeed = {
    window_id: string;
    fetch_messages: () => Promise<(string | TextWindowMessage)[]>;
};

export function create_app_state(): AppState {
    const WHITE: Rgb = get_color_by_name('off_white').rgb;
    const DEEP_RED: Rgb = get_color_by_name('deep_red').rgb;

    const ui_state = {
        text_windows: new Map<string, { messages: (string | TextWindowMessage)[]; rev: number }>(),
        status_override: { until_ms: 0, lines: [] as string[] },
        controls: {
            override_intent: null as string | null,
            override_cost: null as string | null,
            selected_target: null as string | null,
            draft: "",
            suggested_intent: null as string | null,
            suggested_matched: null as string | null,
            last_infer_timer: null as number | null,
            targets: [] as Array<{ ref: string; label: string; type: string }>,
            region_label: null as string | null,
            targets_ready: false,
        },
        roller: {
            spinner: "|",
            last_roll: "",
            dice_label: "D20",
            disabled: true,
            roll_id: null as string | null,
        },
    };

    function set_text_window_messages(id: string, messages: (string | TextWindowMessage)[]) {
        const cur = ui_state.text_windows.get(id);
        if (!cur) {
            ui_state.text_windows.set(id, { messages: [...messages], rev: 1 });
        } else {
            cur.messages = [...messages];
            cur.rev++;
        }
    }

    function append_text_window_message(id: string, message: string | TextWindowMessage) {
        const cur = ui_state.text_windows.get(id);
        if (!cur) {
            ui_state.text_windows.set(id, { messages: [message], rev: 1 });
        } else {
            cur.messages.push(message);
            cur.rev++;
        }
    }

    const window_feeds: WindowFeed[] = [];
    const pending_user_messages = new Map<string, string>();

    function flash_status(lines: string[], ms: number): void {
        ui_state.status_override.until_ms = Date.now() + ms;
        ui_state.status_override.lines = [...lines];
        // bump rev so window refreshes immediately
        const cur = ui_state.text_windows.get('status');
        if (cur) cur.rev++;
    }

    function register_window_feed(feed: WindowFeed): void {
        window_feeds.push(feed);
    }

    async function poll_window_feeds(): Promise<void> {
        const tasks = window_feeds.map(async (feed) => {
            try {
                const messages = await feed.fetch_messages();
                set_text_window_messages(feed.window_id, messages);
            } catch (err) {
                debug_warn('[mono_ui] failed to refresh window feed', feed.window_id, err);
            }
        });

        tasks.push((async () => {
            try {
                const res = await fetch(APP_CONFIG.roller_status_endpoint);
                if (!res.ok) return;
                const data = (await res.json()) as { ok: boolean; status?: any };
                if (!data.ok || !data.status) return;
                ui_state.roller.spinner = String(data.status.spinner ?? "|");
                ui_state.roller.last_roll = String(data.status.last_player_roll ?? "");
                ui_state.roller.dice_label = String(data.status.dice_label ?? "D20");
                ui_state.roller.disabled = Boolean(data.status.disabled ?? true);
                ui_state.roller.roll_id = data.status.roll_id ?? null;
            } catch {
                // ignore
            }
        })());

        // Fetch target list (nearby NPCs / region)
        tasks.push((async () => {
            try {
                const url = `${APP_CONFIG.interpreter_targets_endpoint}?slot=${APP_CONFIG.selected_data_slot}&actor_id=${APP_CONFIG.input_actor_id}`;
                const res = await fetch(url);
                if (!res.ok) return;
                const data = (await res.json()) as {
                    ok: boolean;
                    region?: string | null;
                    targets?: Array<{ ref: string; label: string; type: string }>;
                };
                if (!data.ok) return;
                ui_state.controls.targets = Array.isArray(data.targets) ? data.targets : [];
                ui_state.controls.region_label = typeof data.region === 'string' ? data.region : null;
                ui_state.controls.targets_ready = true;

                // Validate persistent selected target
                if (ui_state.controls.selected_target) {
                    const valid = ui_state.controls.targets.some(t => t.ref.toLowerCase() === ui_state.controls.selected_target!.toLowerCase());
                    if (!valid) {
                        ui_state.controls.selected_target = null;
                        flash_status(['target no longer valid (choose again)'], 1200);
                    }
                }

                // Update targets window text
                const targets_lines: string[] = [];
                targets_lines.push(`[region] ${ui_state.controls.region_label ?? 'unknown'}`);
                const verb = ui_state.controls.override_intent ?? ui_state.controls.suggested_intent;
                if (verb) {
                    targets_lines.push(`[intent] ${verb}`);
                } else {
                    targets_lines.push(`[intent] (none)`);
                }
                const cost = ui_state.controls.override_cost;
                targets_lines.push(`[cost] ${cost ?? '(auto)'}`);

                if (ui_state.controls.selected_target) {
                    targets_lines.push(`[target] ${ui_state.controls.selected_target}`);
                } else {
                    targets_lines.push(`[target] (none)`);
                }
                targets_lines.push('');
                targets_lines.push('Targets (type @name or /target name):');
                for (const t of ui_state.controls.targets) {
                    if (t.type === 'npc') targets_lines.push(`- ${t.label} (${t.ref})`);
                }
                set_text_window_messages('targets', targets_lines);
            } catch {
                // ignore
            }
        })());

        await Promise.all(tasks);
    }

    function start_window_feed_polling(interval_ms: number): void {
        void poll_window_feeds();
        setInterval(() => {
            void poll_window_feeds();
        }, interval_ms);
    }

    async function send_to_interpreter(message: string): Promise<void> {
        try {
            // Ensure targets are loaded at least once before sending so targeting is reliable.
            if (!ui_state.controls.targets_ready) {
                flash_status(['loading targets...'], 800);
                await new Promise((r) => setTimeout(r, 250));
            }

            // Local targeting commands (do not send to backend)
            const trimmed = message.trim();
            if (trimmed.toLowerCase().startsWith('/target ')) {
                const name = trimmed.slice('/target '.length).trim().toLowerCase();
                const npc = ui_state.controls.targets.find(t => t.type === 'npc' && (t.label.toLowerCase() === name || t.ref.toLowerCase() === `npc.${name}`));
                ui_state.controls.selected_target = npc ? npc.ref : null;
                flash_status([`target set: ${npc ? npc.label : '(cleared)'}`], 1200);
                return;
            }
            if (trimmed.toLowerCase() === '/target') {
                ui_state.controls.selected_target = null;
                flash_status([`target cleared`], 1200);
                return;
            }

            // Mention-based targeting: detect @Name anywhere in the message.
            // If valid, strip the '@' marker from outgoing text to avoid parser errors and keep the text natural.
            let target_ref: string | null = ui_state.controls.selected_target;
            let outgoing = message;

            const words = trimmed.split(/\s+/).filter(w => w.length > 0);
            const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

            const targets_npc = ui_state.controls.targets.filter(t => t.type === 'npc');

            function findTargetByName(name: string): { ref: string; label: string } | null {
                const n = norm(name);
                if (!n) return null;
                const hit = targets_npc.find(t => {
                    const labelN = norm(t.label);
                    const refN = norm(t.ref.replace(/^npc\./i, ""));
                    return labelN === n || refN === n;
                });
                return hit ? { ref: hit.ref, label: hit.label } : null;
            }

            // Scan tokens for @ mentions; support multi-word like "@Old Moss".
            for (let i = 0; i < words.length; i++) {
                const w = words[i] ?? "";
                if (!w.startsWith('@') || w.length < 2) continue;

                const first = w.slice(1);
                const second = words[i + 1];
                const third = words[i + 2];

                const candidates: string[] = [];
                candidates.push(first);
                if (second) candidates.push(`${first} ${second}`);
                if (second && third) candidates.push(`${first} ${second} ${third}`);

                let matched: { ref: string; label: string } | null = null;
                for (const c of candidates) {
                    matched = findTargetByName(c);
                    if (matched) break;
                }

                if (matched) {
                    target_ref = matched.ref;
                    // Persist selection so the UI reflects targeting for subsequent actions.
                    ui_state.controls.selected_target = matched.ref;
                    // strip '@' from the first token only; keep the name readable
                    words[i] = first;
                    outgoing = words.join(' ');
                    flash_status([`target: ${matched.label}`], 800);
                } else {
                    flash_status([`unknown target: ${first} (pick from targets panel)`], 1200);
                }

                break; // one target per message for now
            }

            // Validate target immediately before sending
            if (target_ref) {
                const valid = ui_state.controls.targets.some(t => t.ref.toLowerCase() === target_ref!.toLowerCase());
                if (!valid) {
                    ui_state.controls.selected_target = null;
                    target_ref = null;
                    flash_status(['target no longer valid (choose again)'], 1200);
                }
            }

            // Warn once if there is no intent hint and no override.
            // Show warning briefly BEFORE sending, then return to normal status.
            const hint = infer_action_verb_hint(outgoing);
            if (!ui_state.controls.override_intent && !hint.verb) {
                flash_status(['your message does not contain an action type hint'], 900);
                await new Promise((r) => setTimeout(r, 900));
            }

            const res = await fetch(APP_CONFIG.interpreter_endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: outgoing,
                    sender: APP_CONFIG.input_actor_id,
                    intent_verb: ui_state.controls.override_intent ?? undefined,
                    action_cost: ui_state.controls.override_cost ?? undefined,
                    target_ref: target_ref ?? undefined,
                }),
            });

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }

            const data = (await res.json()) as { ok: boolean; id?: string };
            if (data.ok && data.id) {
                pending_user_messages.set(data.id, message);
                void poll_window_feeds();
            }

            // Return status line to neutral
            flash_status(['waiting for actor response'], 900);
        } catch (err) {
            debug_warn('[mono_ui] failed to send to interpreter', err);
            append_text_window_message('log', '[system] failed to reach interpreter');
        }
    }

    async function fetch_log_messages(slot: number): Promise<(string | TextWindowMessage)[]> {
    const res = await fetch(`${APP_CONFIG.interpreter_log_endpoint}?slot=${slot}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = (await res.json()) as {
        ok: boolean;
        messages?: {
            id: string;
            sender: string;
            content: string;
            type?: string;
            correlation_id?: string;
            status?: string;
            stage?: string;
            meta?: Record<string, unknown>;
        }[];
    };
    if (!data.ok || !Array.isArray(data.messages)) return [];

    const ordered = [...data.messages].reverse();
    const seen_ids = new Set<string>();
    const last_renderer_text_by_correlation = new Map<string, string>();

    const filtered = ordered.filter((m) => {
        if (!m?.id) return false;
        if (seen_ids.has(m.id)) return false;
        seen_ids.add(m.id);

        const sender = (m.sender ?? '').toLowerCase();
        if (sender === 'j') return true;
        if (sender === 'renderer_ai') {
            const correlation = m.correlation_id ?? 'none';
            const content = (m.content ?? '').trim();
            const last = last_renderer_text_by_correlation.get(correlation);
            last_renderer_text_by_correlation.set(correlation, content);
            if (!content) return false;
            if (last !== undefined && last === content) return false;
            return true;
        }
        if (sender === 'hint') return true;
        if (m.type === 'user_input') return true;
        if (sender.startsWith('npc.')) return true;  // Show NPC responses
        if (sender === 'state_applier') return true;  // Show state applier messages
        return false;
    });

    for (const m of filtered) {
        if (pending_user_messages.has(m.id)) pending_user_messages.delete(m.id);
    }

    const from_log = filtered.map((m): string | TextWindowMessage => {
        const sender = (m.sender ?? '').toLowerCase();
        if (sender === 'hint') {
            return { content: `💡 ${m.content}`, sender: 'hint' };
        }
        if (sender === 'renderer_ai') return { content: `ASSISTANT: ${m.content}`, sender: 'assistant' };
        if (sender === 'j') return { content: `J: ${m.content}`, sender: 'user' };
        if (sender.startsWith('npc.')) {
            const npcName = sender.replace('npc.', '').toUpperCase();
            return { content: `${npcName}: ${m.content}`, sender: 'npc' };
        }
        if (sender === 'state_applier') {
            return { content: `[STATE] ${m.content}`, sender: 'state' };
        }
        return { content: `${m.sender}: ${m.content}`, sender: 'system' };
    });
    const pending = Array.from(pending_user_messages.values()).map((content): TextWindowMessage => ({ content: `J: ${content}`, sender: 'user' }));
    return [...from_log, ...pending];
}

    async function fetch_status_line(slot: number): Promise<string[]> {
        // Client-side temporary status override
        if (ui_state.status_override.until_ms > Date.now() && ui_state.status_override.lines.length > 0) {
            return [...ui_state.status_override.lines];
        }
        const res = await fetch(`${APP_CONFIG.interpreter_status_endpoint}?slot=${slot}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = (await res.json()) as { ok: boolean; status?: { line?: string } };
        if (!data.ok || !data.status?.line) return [""];
        return [data.status.line];
    }

    (window as any).THAUM_UI = {
        set_text_window_messages,
        append_text_window_message,
    };

    set_text_window_messages('log', [
        'This is a text window. It wraps words onto new lines.',
        'If a word is tooooooooolongtobefitononeline it will hyphenate-and-continue.',
        'Scroll with the mouse wheel if there is more text.',
        'Scroll with the mouse wheel if there is more text.',
        'Scroll with the mouse wheel if there is more text.',
        'Scroll with the mouse wheel if there is more text.',
        'Scroll with the mouse wheel if there is more text.',
        'Scroll with the mouse wheel if there is more text.',
        'Scroll with the mouse wheel if there is more text.',
        'Scroll with the mouse wheel if there is more text.',
        'hey! :3',
    ]);

    let input_submit: (() => void) | null = null;

    const modules: Module[] = [
        make_fill_module({
            id: 'bg',
            rect: { x0: 0, y0: 0, x1: APP_CONFIG.grid_width - 1, y1: APP_CONFIG.grid_height - 1 },
            char: '.',
            rgb: DEEP_RED,
            style: 'regular',
        }),

        make_text_window_module({
            id: 'log',
            rect: { x0: 1, y0: 13, x1: 86, y1: 36 },
            get_source: () => ui_state.text_windows.get('log') ?? { messages: [], rev: 0 },
            border_rgb: get_color_by_name('light_gray').rgb,
            text_rgb: get_color_by_name('off_white').rgb,
            bg: { char: ' ', rgb: get_color_by_name('off_black').rgb },
            base_weight_index: 3,
            hint_rgb: get_color_by_name('pale_yellow').rgb,
            npc_rgb: get_color_by_name('pumpkin').rgb,
            state_rgb: get_color_by_name('dark_gray').rgb,
        }),

        make_text_window_module({
            id: 'status',
            rect: { x0: 1, y0: 38, x1: 86, y1: 42 },
            get_source: () => ui_state.text_windows.get('status') ?? { messages: [], rev: 0 },
            border_rgb: get_color_by_name('medium_gray').rgb,
            text_rgb: get_color_by_name('pale_gray').rgb,
            bg: { char: ' ', rgb: get_color_by_name('off_black').rgb },
            base_weight_index: 3,
        }),

        make_input_module({
            id: 'input',
            rect: { x0: 1, y0: 1, x1: 86, y1: 11 },
            target_id: 'log',
            on_submit: (target_id, message) => {
                void send_to_interpreter(message);
            },
            on_change: (message) => {
                ui_state.controls.draft = message;
                // Debounce inference (1s after user stops typing)
                if (ui_state.controls.last_infer_timer) {
                    clearTimeout(ui_state.controls.last_infer_timer);
                }
                ui_state.controls.last_infer_timer = window.setTimeout(() => {
                    const hint = infer_action_verb_hint(ui_state.controls.draft);
                    ui_state.controls.suggested_intent = hint.verb ? hint.verb : null;
                    ui_state.controls.suggested_matched = hint.matched_keyword ?? null;
                    const lines: string[] = [];
                    lines.push(`[suggested] ${ui_state.controls.suggested_intent ?? '(none)'}`);
                    if (ui_state.controls.suggested_matched) lines.push(`[matched] ${ui_state.controls.suggested_matched}`);
                    lines.push(`[override intent] ${ui_state.controls.override_intent ?? '(none)'}`);
                    lines.push(`[override cost] ${ui_state.controls.override_cost ?? '(none)'}`);
                    set_text_window_messages('controls', lines);
                }, 1000);
            },
            bind_submit: (submit) => { input_submit = submit; },
            border_rgb: get_color_by_name('light_gray').rgb,
            text_rgb: get_color_by_name('off_white').rgb,
            cursor_rgb: get_color_by_name('off_white').rgb,
            bg: { char: ' ', rgb: get_color_by_name('off_black').rgb },
            base_weight_index: 3,
            placeholder: 'Type… (Enter=send, Shift+Enter=new line, Backspace=delete)',
        }),

        make_button_module({
            id: 'btn_send',
            rect: { x0: 88, y0: 1, x1: 100, y1: 3 },
            label: 'send',
            rgb: get_color_by_name('pale_orange').rgb,
            bg: { char: '-', rgb: get_color_by_name('dark_gray').rgb },
            OnPress() {
                input_submit?.();
            },
        }),

        // Controls window
        make_text_window_module({
            id: 'controls',
            rect: { x0: 88, y0: 4, x1: 118, y1: 11 },
            get_source: () => ui_state.text_windows.get('controls') ?? { messages: [], rev: 0 },
            border_rgb: get_color_by_name('medium_gray').rgb,
            text_rgb: get_color_by_name('pale_gray').rgb,
            bg: { char: ' ', rgb: get_color_by_name('off_black').rgb },
            base_weight_index: 3,
        }),

        // Targets window
        make_text_window_module({
            id: 'targets',
            rect: { x0: 88, y0: 20, x1: 118, y1: 36 },
            get_source: () => ui_state.text_windows.get('targets') ?? { messages: [], rev: 0 },
            border_rgb: get_color_by_name('light_gray').rgb,
            text_rgb: get_color_by_name('off_white').rgb,
            bg: { char: ' ', rgb: get_color_by_name('off_black').rgb },
            base_weight_index: 3,
        }),

        // Action cost buttons
        make_button_module({
            id: 'cost_free',
            rect: { x0: 102, y0: 1, x1: 106, y1: 3 },
            label: 'FREE',
            rgb: get_color_by_name('pale_orange').rgb,
            bg: { char: '.', rgb: get_color_by_name('dark_gray').rgb },
            OnPress() { ui_state.controls.override_cost = 'FREE'; flash_status(['action cost: FREE'], 800); },
        }),
        make_button_module({
            id: 'cost_part',
            rect: { x0: 107, y0: 1, x1: 112, y1: 3 },
            label: 'PART',
            rgb: get_color_by_name('pale_orange').rgb,
            bg: { char: '.', rgb: get_color_by_name('dark_gray').rgb },
            OnPress() { ui_state.controls.override_cost = 'PARTIAL'; flash_status(['action cost: PARTIAL'], 800); },
        }),
        make_button_module({
            id: 'cost_full',
            rect: { x0: 113, y0: 1, x1: 118, y1: 3 },
            label: 'FULL',
            rgb: get_color_by_name('pale_orange').rgb,
            bg: { char: '.', rgb: get_color_by_name('dark_gray').rgb },
            OnPress() { ui_state.controls.override_cost = 'FULL'; flash_status(['action cost: FULL'], 800); },
        }),
        make_button_module({
            id: 'cost_ext',
            rect: { x0: 113, y0: 4, x1: 118, y1: 6 },
            label: 'EXT',
            rgb: get_color_by_name('pale_orange').rgb,
            bg: { char: '.', rgb: get_color_by_name('dark_gray').rgb },
            OnPress() { ui_state.controls.override_cost = 'EXTENDED'; flash_status(['action cost: EXTENDED'], 800); },
        }),

        // Action intent buttons (one per action type)
        make_button_module({ id: 'verb_use', rect: { x0: 88, y0: 7, x1: 93, y1: 9 }, label: 'USE', rgb: WHITE, get_rgb: () => (ui_state.controls.override_intent === 'USE' ? get_color_by_name('pale_yellow').rgb : (ui_state.controls.suggested_intent === 'USE' ? get_color_by_name('pale_gray').rgb : get_color_by_name('dark_gray').rgb)), bg: { char: '-', rgb: get_color_by_name('off_black').rgb }, OnPress() { ui_state.controls.override_intent = 'USE'; flash_status(['intent: USE'], 800); } }),
        make_button_module({ id: 'verb_atk', rect: { x0: 94, y0: 7, x1: 99, y1: 9 }, label: 'ATK', rgb: WHITE, get_rgb: () => (ui_state.controls.override_intent === 'ATTACK' ? get_color_by_name('pale_yellow').rgb : (ui_state.controls.suggested_intent === 'ATTACK' ? get_color_by_name('pale_gray').rgb : get_color_by_name('dark_gray').rgb)), bg: { char: '-', rgb: get_color_by_name('off_black').rgb }, OnPress() { ui_state.controls.override_intent = 'ATTACK'; flash_status(['intent: ATTACK'], 800); } }),
        make_button_module({ id: 'verb_hlp', rect: { x0: 100, y0: 7, x1: 105, y1: 9 }, label: 'HLP', rgb: WHITE, get_rgb: () => (ui_state.controls.override_intent === 'HELP' ? get_color_by_name('pale_yellow').rgb : (ui_state.controls.suggested_intent === 'HELP' ? get_color_by_name('pale_gray').rgb : get_color_by_name('dark_gray').rgb)), bg: { char: '-', rgb: get_color_by_name('off_black').rgb }, OnPress() { ui_state.controls.override_intent = 'HELP'; flash_status(['intent: HELP'], 800); } }),
        make_button_module({ id: 'verb_def', rect: { x0: 106, y0: 7, x1: 112, y1: 9 }, label: 'DEF', rgb: WHITE, get_rgb: () => (ui_state.controls.override_intent === 'DEFEND' ? get_color_by_name('pale_yellow').rgb : (ui_state.controls.suggested_intent === 'DEFEND' ? get_color_by_name('pale_gray').rgb : get_color_by_name('dark_gray').rgb)), bg: { char: '-', rgb: get_color_by_name('off_black').rgb }, OnPress() { ui_state.controls.override_intent = 'DEFEND'; flash_status(['intent: DEFEND'], 800); } }),
        make_button_module({ id: 'verb_grp', rect: { x0: 113, y0: 7, x1: 118, y1: 9 }, label: 'GRP', rgb: WHITE, get_rgb: () => (ui_state.controls.override_intent === 'GRAPPLE' ? get_color_by_name('pale_yellow').rgb : (ui_state.controls.suggested_intent === 'GRAPPLE' ? get_color_by_name('pale_gray').rgb : get_color_by_name('dark_gray').rgb)), bg: { char: '-', rgb: get_color_by_name('off_black').rgb }, OnPress() { ui_state.controls.override_intent = 'GRAPPLE'; flash_status(['intent: GRAPPLE'], 800); } }),
        make_button_module({ id: 'verb_ins', rect: { x0: 88, y0: 10, x1: 93, y1: 12 }, label: 'INS', rgb: WHITE, get_rgb: () => (ui_state.controls.override_intent === 'INSPECT' ? get_color_by_name('pale_yellow').rgb : (ui_state.controls.suggested_intent === 'INSPECT' ? get_color_by_name('pale_gray').rgb : get_color_by_name('dark_gray').rgb)), bg: { char: '-', rgb: get_color_by_name('off_black').rgb }, OnPress() { ui_state.controls.override_intent = 'INSPECT'; flash_status(['intent: INSPECT'], 800); } }),
        make_button_module({ id: 'verb_com', rect: { x0: 94, y0: 10, x1: 101, y1: 12 }, label: 'COM', rgb: WHITE, get_rgb: () => (ui_state.controls.override_intent === 'COMMUNICATE' ? get_color_by_name('pale_yellow').rgb : (ui_state.controls.suggested_intent === 'COMMUNICATE' ? get_color_by_name('pale_gray').rgb : get_color_by_name('dark_gray').rgb)), bg: { char: '-', rgb: get_color_by_name('off_black').rgb }, OnPress() { ui_state.controls.override_intent = 'COMMUNICATE'; flash_status(['intent: COMMUNICATE'], 800); } }),
        make_button_module({ id: 'verb_mov', rect: { x0: 102, y0: 10, x1: 107, y1: 12 }, label: 'MOV', rgb: WHITE, get_rgb: () => (ui_state.controls.override_intent === 'MOVE' ? get_color_by_name('pale_yellow').rgb : (ui_state.controls.suggested_intent === 'MOVE' ? get_color_by_name('pale_gray').rgb : get_color_by_name('dark_gray').rgb)), bg: { char: '-', rgb: get_color_by_name('off_black').rgb }, OnPress() { ui_state.controls.override_intent = 'MOVE'; flash_status(['intent: MOVE'], 800); } }),
        make_button_module({ id: 'verb_ddg', rect: { x0: 108, y0: 10, x1: 112, y1: 12 }, label: 'DDG', rgb: WHITE, get_rgb: () => (ui_state.controls.override_intent === 'DODGE' ? get_color_by_name('pale_yellow').rgb : (ui_state.controls.suggested_intent === 'DODGE' ? get_color_by_name('pale_gray').rgb : get_color_by_name('dark_gray').rgb)), bg: { char: '-', rgb: get_color_by_name('off_black').rgb }, OnPress() { ui_state.controls.override_intent = 'DODGE'; flash_status(['intent: DODGE'], 800); } }),
        make_button_module({ id: 'verb_crf', rect: { x0: 113, y0: 10, x1: 118, y1: 12 }, label: 'CRF', rgb: WHITE, get_rgb: () => (ui_state.controls.override_intent === 'CRAFT' ? get_color_by_name('pale_yellow').rgb : (ui_state.controls.suggested_intent === 'CRAFT' ? get_color_by_name('pale_gray').rgb : get_color_by_name('dark_gray').rgb)), bg: { char: '-', rgb: get_color_by_name('off_black').rgb }, OnPress() { ui_state.controls.override_intent = 'CRAFT'; flash_status(['intent: CRAFT'], 800); } }),
        make_button_module({ id: 'verb_slp', rect: { x0: 88, y0: 13, x1: 93, y1: 15 }, label: 'SLP', rgb: WHITE, get_rgb: () => (ui_state.controls.override_intent === 'SLEEP' ? get_color_by_name('pale_yellow').rgb : (ui_state.controls.suggested_intent === 'SLEEP' ? get_color_by_name('pale_gray').rgb : get_color_by_name('dark_gray').rgb)), bg: { char: '-', rgb: get_color_by_name('off_black').rgb }, OnPress() { ui_state.controls.override_intent = 'SLEEP'; flash_status(['intent: SLEEP'], 800); } }),
        make_button_module({ id: 'verb_rpr', rect: { x0: 94, y0: 13, x1: 99, y1: 15 }, label: 'RPR', rgb: WHITE, get_rgb: () => (ui_state.controls.override_intent === 'REPAIR' ? get_color_by_name('pale_yellow').rgb : (ui_state.controls.suggested_intent === 'REPAIR' ? get_color_by_name('pale_gray').rgb : get_color_by_name('dark_gray').rgb)), bg: { char: '-', rgb: get_color_by_name('off_black').rgb }, OnPress() { ui_state.controls.override_intent = 'REPAIR'; flash_status(['intent: REPAIR'], 800); } }),
        make_button_module({ id: 'verb_wrk', rect: { x0: 100, y0: 13, x1: 105, y1: 15 }, label: 'WRK', rgb: WHITE, get_rgb: () => (ui_state.controls.override_intent === 'WORK' ? get_color_by_name('pale_yellow').rgb : (ui_state.controls.suggested_intent === 'WORK' ? get_color_by_name('pale_gray').rgb : get_color_by_name('dark_gray').rgb)), bg: { char: '-', rgb: get_color_by_name('off_black').rgb }, OnPress() { ui_state.controls.override_intent = 'WORK'; flash_status(['intent: WORK'], 800); } }),
        make_button_module({ id: 'verb_grd', rect: { x0: 106, y0: 13, x1: 112, y1: 15 }, label: 'GRD', rgb: WHITE, get_rgb: () => (ui_state.controls.override_intent === 'GUARD' ? get_color_by_name('pale_yellow').rgb : (ui_state.controls.suggested_intent === 'GUARD' ? get_color_by_name('pale_gray').rgb : get_color_by_name('dark_gray').rgb)), bg: { char: '-', rgb: get_color_by_name('off_black').rgb }, OnPress() { ui_state.controls.override_intent = 'GUARD'; flash_status(['intent: GUARD'], 800); } }),
        make_button_module({ id: 'verb_hld', rect: { x0: 113, y0: 13, x1: 118, y1: 15 }, label: 'HLD', rgb: WHITE, get_rgb: () => (ui_state.controls.override_intent === 'HOLD' ? get_color_by_name('pale_yellow').rgb : (ui_state.controls.suggested_intent === 'HOLD' ? get_color_by_name('pale_gray').rgb : get_color_by_name('dark_gray').rgb)), bg: { char: '-', rgb: get_color_by_name('off_black').rgb }, OnPress() { ui_state.controls.override_intent = 'HOLD'; flash_status(['intent: HOLD'], 800); } }),
        make_button_module({ id: 'verb_clear', rect: { x0: 88, y0: 16, x1: 99, y1: 18 }, label: 'CLEAR', rgb: get_color_by_name('pale_yellow').rgb, bg: { char: '.', rgb: get_color_by_name('dark_gray').rgb }, OnPress() { ui_state.controls.override_intent = null; ui_state.controls.override_cost = null; flash_status(['overrides cleared'], 800); } }),

        make_roller_module({
            id: 'roller',
            rect: { x0: 88, y0: 38, x1: 118, y1: 42 },
            get_state: () => ui_state.roller,
            on_roll: async (roll_id) => {
                await fetch(APP_CONFIG.roller_roll_endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ roll_id }),
                });
            },
            text_rgb: get_color_by_name('pale_orange').rgb,
            dim_rgb: get_color_by_name('medium_gray').rgb,
            border_rgb: get_color_by_name('dark_gray').rgb,
            bg: { char: ' ', rgb: get_color_by_name('off_black').rgb },
            base_weight_index: 3,
        }),
    ];

    register_window_feed({
        window_id: 'log',
        fetch_messages: () => fetch_log_messages(APP_CONFIG.selected_data_slot),
    });

    register_window_feed({
        window_id: 'status',
        fetch_messages: () => fetch_status_line(APP_CONFIG.selected_data_slot),
    });

    // Seed controls + targets windows
    set_text_window_messages('controls', ['[suggested] (none)', '[override intent] (none)', '[override cost] (none)']);
    set_text_window_messages('targets', ['[region] (loading...)', 'Targets will appear here.']);

    return {
        modules,
        start_window_feed_polling,
    };
}
