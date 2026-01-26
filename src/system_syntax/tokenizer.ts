import type { ParseError, Token } from "./types.js";

type TokenizeResult = {
    tokens: Token[];
    errors: ParseError[];
};

function is_whitespace(ch: string): boolean {
    return ch === " " || ch === "\t" || ch === "\r";
}

function is_digit(ch: string): boolean {
    return ch >= "0" && ch <= "9";
}

function is_identifier_char(ch: string): boolean {
    return (
        (ch >= "a" && ch <= "z") ||
        (ch >= "A" && ch <= "Z") ||
        (ch >= "0" && ch <= "9") ||
        ch === "_" ||
        ch === "-" ||
        ch === "!" ||
        ch === ":"
    );
}

export function tokenize_line(line_text: string, line_number: number): TokenizeResult {
    const tokens: Token[] = [];
    const errors: ParseError[] = [];

    let i = 0;
    const len = line_text.length;

    while (i < len) {
        const ch = line_text[i] ?? "";
        const col = i + 1;

        if (is_whitespace(ch)) {
            i += 1;
            continue;
        }

        if (ch === ".") {
            tokens.push({ type: "dot", line: line_number, column: col });
            i += 1;
            continue;
        }

        if (ch === ",") {
            tokens.push({ type: "comma", line: line_number, column: col });
            i += 1;
            continue;
        }

        if (ch === "=") {
            tokens.push({ type: "equals", line: line_number, column: col });
            i += 1;
            continue;
        }

        if (ch === "(") {
            tokens.push({ type: "lparen", line: line_number, column: col });
            i += 1;
            continue;
        }

        if (ch === ")") {
            tokens.push({ type: "rparen", line: line_number, column: col });
            i += 1;
            continue;
        }

        if (ch === "{") {
            tokens.push({ type: "lbrace", line: line_number, column: col });
            i += 1;
            continue;
        }

        if (ch === "}") {
            tokens.push({ type: "rbrace", line: line_number, column: col });
            i += 1;
            continue;
        }

        if (ch === "[") {
            tokens.push({ type: "lbracket", line: line_number, column: col });
            i += 1;
            continue;
        }

        if (ch === "]") {
            tokens.push({ type: "rbracket", line: line_number, column: col });
            i += 1;
            continue;
        }

        if (ch === '"') {
            let j = i + 1;
            let value = "";
            let closed = false;
            while (j < len) {
                const cj = line_text[j] ?? "";
                if (cj === "\\") {
                    const next = line_text[j + 1] ?? "";
                    if (next === '"' || next === "\\") {
                        value += next;
                        j += 2;
                        continue;
                    }
                }
                if (cj === '"') {
                    closed = true;
                    j += 1;
                    break;
                }
                value += cj;
                j += 1;
            }

            if (!closed) {
                errors.push({
                    code: "E_UNTERMINATED_STRING",
                    message: "unterminated string",
                    line: line_number,
                    column: col,
                });
                break;
            }

            tokens.push({ type: "string", value, line: line_number, column: col });
            i = j;
            continue;
        }

        if (ch === "-" && is_digit(line_text[i + 1] ?? "")) {
            let j = i + 1;
            while (j < len && is_digit(line_text[j] ?? "")) j += 1;
            if (line_text[j] === ".") {
                j += 1;
                while (j < len && is_digit(line_text[j] ?? "")) j += 1;
            }
            const raw = line_text.slice(i, j);
            tokens.push({ type: "number", value: raw, line: line_number, column: col });
            i = j;
            continue;
        }

        if (is_digit(ch)) {
            let j = i + 1;
            while (j < len && is_digit(line_text[j] ?? "")) j += 1;
            if (line_text[j] === ".") {
                j += 1;
                while (j < len && is_digit(line_text[j] ?? "")) j += 1;
            }
            const raw = line_text.slice(i, j);
            tokens.push({ type: "number", value: raw, line: line_number, column: col });
            i = j;
            continue;
        }

        if (is_identifier_char(ch)) {
            let j = i + 1;
            while (j < len && is_identifier_char(line_text[j] ?? "")) j += 1;
            const raw = line_text.slice(i, j);
            if (raw === "true" || raw === "false") {
                tokens.push({ type: "boolean", value: raw, line: line_number, column: col });
            } else {
                tokens.push({ type: "identifier", value: raw, line: line_number, column: col });
            }
            i = j;
            continue;
        }

        errors.push({
            code: "E_UNKNOWN_CHAR",
            message: `unexpected character '${ch}'`,
            line: line_number,
            column: col,
        });
        i += 1;
    }

    return { tokens, errors };
}
