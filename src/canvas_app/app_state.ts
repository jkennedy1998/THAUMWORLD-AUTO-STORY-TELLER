import { make_fill_module } from '../mono_ui/modules/fill_module.js';
import { make_button_module } from '../mono_ui/modules/button_module.js';
import { make_text_window_module } from '../mono_ui/modules/window_module.js';
import { make_input_module } from '../mono_ui/modules/input_module.js';
import type { Module, Rgb } from '../mono_ui/types.js';
import { debug_warn } from '../shared/debug.js';

export const APP_CONFIG = {
    font_family: 'Martian Mono',
    base_font_size_px: 10,
    base_line_height_mult: 1.5,
    base_letter_spacing_mult: 0.08,
    weight_index_to_css: [100, 200, 300, 400, 500, 600, 700, 800] as const,

    grid_width: 80,
    grid_height: 30,

    interpreter_endpoint: 'http://localhost:8787/api/input',
    interpreter_log_endpoint: 'http://localhost:8787/api/log',
    interpreter_status_endpoint: 'http://localhost:8787/api/status',
    selected_data_slot: 1,
} as const;

export type AppState = {
    modules: Module[];
    start_window_feed_polling: (interval_ms: number) => void;
};

type WindowFeed = {
    window_id: string;
    fetch_messages: () => Promise<string[]>;
};

export function create_app_state(): AppState {
    const WHITE: Rgb = { r: 255, g: 255, b: 255 };

    const ui_state = {
        text_windows: new Map<string, { messages: string[]; rev: number }>(),
    };

    function set_text_window_messages(id: string, messages: string[]) {
        const cur = ui_state.text_windows.get(id);
        if (!cur) {
            ui_state.text_windows.set(id, { messages: [...messages], rev: 1 });
        } else {
            cur.messages = [...messages];
            cur.rev++;
        }
    }

    function append_text_window_message(id: string, message: string) {
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
            const res = await fetch(APP_CONFIG.interpreter_endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: message, sender: 'J' }),
            });

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }

            const data = (await res.json()) as { ok: boolean; id?: string };
            if (data.ok && data.id) {
                pending_user_messages.set(data.id, message);
                void poll_window_feeds();
            }
        } catch (err) {
            debug_warn('[mono_ui] failed to send to interpreter', err);
            append_text_window_message('log', '[system] failed to reach interpreter');
        }
    }

async function fetch_log_messages(slot: number): Promise<string[]> {
    const res = await fetch(`${APP_CONFIG.interpreter_log_endpoint}?slot=${slot}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = (await res.json()) as { ok: boolean; messages?: { id: string; sender: string; content: string; type?: string }[] };
    if (!data.ok || !Array.isArray(data.messages)) return [];

    const ordered = [...data.messages].reverse();
    const seen_ids = new Set<string>();

    const filtered = ordered.filter((m) => {
        if (!m?.id) return false;
        if (seen_ids.has(m.id)) return false;
        seen_ids.add(m.id);

        const sender = (m.sender ?? '').toLowerCase();
        if (sender === 'j' || sender === 'interpreter_ai') return true;
        if (m.type === 'user_input') return true;
        return false;
    });

    for (const m of filtered) {
        if (pending_user_messages.has(m.id)) pending_user_messages.delete(m.id);
    }

    const from_log = filtered.map((m) => `${m.sender}: ${m.content}`);
    const pending = Array.from(pending_user_messages.values()).map((content) => `J: ${content}`);
    return [...from_log, ...pending];
}

    async function fetch_status_line(slot: number): Promise<string[]> {
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
            rgb: WHITE,
            style: 'regular',
        }),

        make_text_window_module({
            id: 'log',
            rect: { x0: 2, y0: 14, x1: 60, y1: 24 },
            get_source: () => ui_state.text_windows.get('log') ?? { messages: [], rev: 0 },
            border_rgb: { r: 160, g: 160, b: 160 },
            text_rgb: { r: 255, g: 255, b: 255 },
            bg: { char: ' ', rgb: { r: 20, g: 20, b: 20 } },
            base_weight_index: 3,
        }),

        make_text_window_module({
            id: 'status',
            rect: { x0: 2, y0: 26, x1: 60, y1: 28 },
            get_source: () => ui_state.text_windows.get('status') ?? { messages: [], rev: 0 },
            border_rgb: { r: 120, g: 120, b: 120 },
            text_rgb: { r: 200, g: 200, b: 200 },
            bg: { char: ' ', rgb: { r: 14, g: 14, b: 14 } },
            base_weight_index: 3,
        }),

        make_input_module({
            id: 'input',
            rect: { x0: 2, y0: 2, x1: 60, y1: 12 },
            target_id: 'log',
            on_submit: (target_id, message) => {
                void send_to_interpreter(message);
            },
            bind_submit: (submit) => { input_submit = submit; },
            border_rgb: { r: 160, g: 160, b: 160 },
            text_rgb: { r: 255, g: 255, b: 255 },
            cursor_rgb: { r: 255, g: 255, b: 255 },
            bg: { char: ' ', rgb: { r: 20, g: 20, b: 20 } },
            base_weight_index: 3,
            placeholder: 'Type… (Enter=send, Shift+Enter=new line, Backspace=delete)',
        }),

        make_button_module({
            id: 'btn_send',
            rect: { x0: 62, y0: 2, x1: 72, y1: 12 },
            label: 'send',
            rgb: { r: 255, g: 220, b: 120 },
            bg: { char: '-', rgb: { r: 50, g: 50, b: 50 } },
            OnPress() {
                input_submit?.();
            },
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

    return {
        modules,
        start_window_feed_polling,
    };
}
