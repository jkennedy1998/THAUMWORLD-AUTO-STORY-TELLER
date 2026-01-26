export const DEBUG_ENABLED = true;

const ANSI = {
    reset: "\x1b[0m",
    cyan: "\x1b[36m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    magenta: "\x1b[35m",
    gray: "\x1b[90m",
};

function normalize_debug_content(content: string, max_len = 400): string {
    const trimmed = content.trim();
    const single_line = trimmed.replace(/\r\n|\n|\r/g, "\\n");
    if (single_line.length <= max_len) return single_line;
    return `${single_line.slice(0, max_len)}...`;
}

export function debug_log(...args: unknown[]): void {
    if (!DEBUG_ENABLED) return;
    console.log(...args);
}

export function debug_warn(...args: unknown[]): void {
    if (!DEBUG_ENABLED) return;
    console.warn(...args);
}

export function debug_content(label: string, content: string): void {
    if (!DEBUG_ENABLED) return;
    const body = normalize_debug_content(content);
    console.log(`${ANSI.cyan}${label}${ANSI.reset} ${body}`);
}

export function debug_roll(label: string, dice: string, base: number, faces: number[], source: string): void {
    if (!DEBUG_ENABLED) return;
    const face_text = faces.join(",");
    const line = `${label} ${base} (${dice} rolled ${face_text}) [${source}]`;
    console.log(`${ANSI.green}${line}${ANSI.reset}`);
}

export function debug_waiting_roll(label: string, dice: string, field: string, command_index: number): void {
    if (!DEBUG_ENABLED) return;
    const line = `${label} ${dice} (field=${field}, cmd=${command_index})`;
    console.log(`${ANSI.yellow}${line}${ANSI.reset}`);
}

export function debug_broker_content(label: string, content: string): void {
    if (!DEBUG_ENABLED) return;
    const body = normalize_debug_content(content, 800);
    console.log(`${ANSI.magenta}${label}${ANSI.reset} ${body}`);
}
