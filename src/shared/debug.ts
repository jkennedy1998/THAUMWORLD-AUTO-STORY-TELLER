// Debug levels: 0 = off, 1 = errors only, 2 = warnings + errors, 3 = info + warnings + errors, 4 = verbose
// Check if we're in Node.js environment (process exists) or browser (process undefined)
const isNode = typeof process !== 'undefined' && process.env;
export const DEBUG_LEVEL = Number(isNode ? process.env.DEBUG_LEVEL ?? 3 : 3);
export const DEBUG_ENABLED = DEBUG_LEVEL > 0;

const ANSI = {
    reset: "\x1b[0m",
    cyan: "\x1b[36m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    magenta: "\x1b[35m",
    gray: "\x1b[90m",
    red: "\x1b[31m",
};

function normalize_debug_content(content: string, max_len = 400): string {
    const trimmed = content.trim();
    const single_line = trimmed.replace(/\r\n|\n|\r/g, "\\n");
    if (single_line.length <= max_len) return single_line;
    return `${single_line.slice(0, max_len)}...`;
}

export function debug_log(...args: unknown[]): void {
    if (DEBUG_LEVEL < 3) return;
    console.log(...args);
}

export function debug_warn(...args: unknown[]): void {
    if (DEBUG_LEVEL < 2) return;
    console.warn(...args);
}

export function debug_error(service: string, message: string, err?: unknown): void {
    if (DEBUG_LEVEL < 1) return;
    const errorMsg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : '';
    console.error(`${ANSI.red}[${service}] ERROR: ${message}${ANSI.reset}`);
    if (errorMsg) console.error(`${ANSI.red}[${service}] Details: ${errorMsg}${ANSI.reset}`);
    if (stack && DEBUG_LEVEL >= 4) console.error(`${ANSI.gray}[${service}] Stack: ${stack}${ANSI.reset}`);
}

export function debug_pipeline(service: string, action: string, details?: Record<string, unknown>): void {
    if (DEBUG_LEVEL < 3) return;
    const detailStr = details ? JSON.stringify(details) : '';
    console.log(`${ANSI.cyan}[${service}]${ANSI.reset} ${action} ${detailStr}`);
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

// AI I/O Logging - Terminal summary (DEBUG_LEVEL >= 3) and file logging (DEBUG_LEVEL >= 4)
export type AIIOLogEntry = {
    timestamp: string;
    service: 'interpreter' | 'renderer';
    session_id?: string;
    input_summary: string;
    output_summary: string;
    duration_ms: number;
    prompt_chars: number;
    response_chars: number;
    full_prompt?: string;
    full_response?: string;
    metadata?: Record<string, unknown>;
};

function normalize_for_terminal(text: string, maxLen: number): string {
    const cleaned = text.replace(/\r\n|\n|\r/g, ' ').trim();
    if (cleaned.length <= maxLen) return cleaned;
    return cleaned.slice(0, maxLen) + '...';
}

export function log_ai_io_terminal(
    service: 'interpreter' | 'renderer',
    input: string,
    output: string,
    duration_ms: number,
    session_id?: string,
    full_input?: string,
    full_output?: string
): void {
    if (DEBUG_LEVEL < 3) return;
    
    const serviceColor = service === 'interpreter' ? ANSI.cyan : ANSI.magenta;
    const serviceName = service === 'interpreter' ? 'InterpreterAI' : 'RendererAI';
    
    console.log(`${serviceColor}┌────────────────────────────────────────────────────────────┐${ANSI.reset}`);
    console.log(`${serviceColor}│ ${serviceName}${ANSI.reset}`);
    if (session_id) {
        console.log(`${serviceColor}│ Session: ${session_id.slice(0, 40)}...${ANSI.reset}`);
    }
    console.log(`${serviceColor}├────────────────────────────────────────────────────────────┤${ANSI.reset}`);
    console.log(`${serviceColor}│ Input:${ANSI.reset}  ${normalize_for_terminal(input, 50)}`);
    console.log(`${serviceColor}│ Output:${ANSI.reset} ${normalize_for_terminal(output, 50)}`);
    console.log(`${serviceColor}│ Time:${ANSI.reset}   ${duration_ms}ms`);
    console.log(`${serviceColor}└────────────────────────────────────────────────────────────┘${ANSI.reset}`);

    // When DEBUG_LEVEL is high, show the full I/O payloads to help diagnose
    if (DEBUG_LEVEL >= 4) {
        const input_full = typeof full_input === 'string' ? full_input : input;
        const output_full = typeof full_output === 'string' ? full_output : output;
        console.log(`${ANSI.gray}[AI_IO] Full input:${ANSI.reset}\n${input_full}`);
        console.log(`${ANSI.gray}[AI_IO] Full output:${ANSI.reset}\n${output_full}`);
    }
}

export function log_ai_io_file(
    slot: number,
    entry: AIIOLogEntry
): void {
    if (DEBUG_LEVEL < 4) return;
    // NOTE: File logging disabled for browser/Electron safety.
    // The dev stack runs Vite + Electron which may import this module in a browser context.
    // Terminal logging + full I/O printing (DEBUG_LEVEL>=4) is sufficient for diagnosis.
    void slot;
    void entry;
}

// Standardized Error Logging System
export type ErrorLogEntry = {
    timestamp: string;
    service: string;
    operation: string;
    severity: 'error' | 'warning' | 'critical';
    context: Record<string, unknown>;
    error: {
        message: string;
        stack?: string | undefined;
        type?: string | undefined;
    };
    correlation_id?: string;
    message_id?: string;
};

export function log_service_error(
    service: string,
    operation: string,
    context: Record<string, unknown>,
    err: unknown,
    severity: 'error' | 'warning' | 'critical' = 'error'
): void {
    // Always log errors (DEBUG_LEVEL >= 1)
    if (DEBUG_LEVEL < 1) return;
    
    const errorMsg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    const errorType = err instanceof Error ? err.constructor.name : 'Unknown';
    
    // Console output with color coding
    const color = severity === 'critical' ? ANSI.red : severity === 'error' ? ANSI.red : ANSI.yellow;
    const severityLabel = severity.toUpperCase();
    
    console.error(`${color}[${service}] ${severityLabel} in ${operation}${ANSI.reset}`);
    console.error(`${color}  Context: ${JSON.stringify(context)}${ANSI.reset}`);
    console.error(`${color}  Error: ${errorMsg}${ANSI.reset}`);
    
    if (stack && DEBUG_LEVEL >= 4) {
        console.error(`${ANSI.gray}  Stack: ${stack}${ANSI.reset}`);
    }
    
    // NOTE: File logging disabled for browser/Electron safety.
    // The dev stack runs Vite + Electron and may import this module in a browser context.
    // Console logging is the primary diagnostic channel.
}

// Convenience function for critical errors
export function log_critical_error(
    service: string,
    operation: string,
    context: Record<string, unknown>,
    err: unknown
): void {
    log_service_error(service, operation, context, err, 'critical');
}

// Convenience function for warnings
export function log_warning(
    service: string,
    operation: string,
    context: Record<string, unknown>,
    message: string
): void {
    if (DEBUG_LEVEL < 2) return;
    
    const color = ANSI.yellow;
    console.warn(`${color}[${service}] WARNING in ${operation}${ANSI.reset}`);
    console.warn(`${color}  Context: ${JSON.stringify(context)}${ANSI.reset}`);
    console.warn(`${color}  Message: ${message}${ANSI.reset}`);
}
