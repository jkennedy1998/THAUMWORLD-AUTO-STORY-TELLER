export const DEBUG_ENABLED = true;

export function debug_log(...args: unknown[]): void {
    if (!DEBUG_ENABLED) return;
    console.log(...args);
}

export function debug_warn(...args: unknown[]): void {
    if (!DEBUG_ENABLED) return;
    console.warn(...args);
}
