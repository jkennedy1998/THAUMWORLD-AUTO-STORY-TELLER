import type { CommandNode, ParseError, ParseResult, ParseWarning, Token, ValueNode } from "./types.js";
import { tokenize_line } from "./tokenizer.js";

type Cursor = {
    tokens: Token[];
    index: number;
};

function peek(cursor: Cursor): Token | undefined {
    return cursor.tokens[cursor.index];
}

function consume(cursor: Cursor): Token | undefined {
    const tok = cursor.tokens[cursor.index];
    cursor.index += 1;
    return tok;
}

function expect(cursor: Cursor, type: Token["type"], errors: ParseError[], message: string): Token | undefined {
    const tok = peek(cursor);
    if (!tok || tok.type !== type) {
        const line = tok?.line ?? 0;
        const column = tok?.column ?? 0;
        errors.push({ code: "E_EXPECTED", message, line, column });
        return undefined;
    }
    return consume(cursor);
}

function parse_value(cursor: Cursor, errors: ParseError[]): ValueNode | undefined {
    const tok = peek(cursor);
    if (!tok) return undefined;

    if (tok.type === "string") {
        consume(cursor);
        return { type: "string", value: tok.value ?? "" };
    }

    if (tok.type === "number") {
        consume(cursor);
        const num = Number(tok.value ?? "0");
        return { type: "number", value: Number.isFinite(num) ? num : 0 };
    }

    if (tok.type === "boolean") {
        consume(cursor);
        return { type: "boolean", value: tok.value === "true" };
    }

    if (tok.type === "identifier") {
        consume(cursor);
        let value = tok.value ?? "";
        while (peek(cursor)?.type === "dot") {
            const dot = consume(cursor);
            const next = peek(cursor);
            if (!next || (next.type !== "identifier" && next.type !== "number")) {
                errors.push({
                    code: "E_EXPECTED",
                    message: "expected identifier after '.' in ref",
                    line: dot?.line ?? 0,
                    column: dot?.column ?? 0,
                });
                break;
            }
            consume(cursor);
            value += `.${next.value ?? ""}`;
        }
        return { type: "identifier", value };
    }

    if (tok.type === "lbracket") {
        consume(cursor);
        const items: ValueNode[] = [];
        if (peek(cursor)?.type === "rbracket") {
            consume(cursor);
            return { type: "list", value: items };
        }
        while (peek(cursor)) {
            const value = parse_value(cursor, errors);
            if (!value) break;
            items.push(value);
            const next = peek(cursor);
            if (next?.type === "comma") {
                consume(cursor);
                continue;
            }
            if (next?.type === "rbracket") {
                consume(cursor);
                break;
            }
            errors.push({
                code: "E_EXPECTED",
                message: "expected ',' or ']' in list",
                line: next?.line ?? 0,
                column: next?.column ?? 0,
            });
            break;
        }
        return { type: "list", value: items };
    }

    if (tok.type === "lbrace") {
        consume(cursor);
        const obj: Record<string, ValueNode> = {};
        if (peek(cursor)?.type === "rbrace") {
            consume(cursor);
            return { type: "object", value: obj };
        }
        while (peek(cursor)) {
            const key_tok = peek(cursor);
            if (!key_tok || key_tok.type !== "identifier") {
                errors.push({
                    code: "E_EXPECTED",
                    message: "expected object key identifier",
                    line: key_tok?.line ?? 0,
                    column: key_tok?.column ?? 0,
                });
                break;
            }
            consume(cursor);
            const key = key_tok.value ?? "";
            expect(cursor, "equals", errors, "expected '=' after object key");
            const value = parse_value(cursor, errors);
            if (value) obj[key] = value;
            const next = peek(cursor);
            if (next?.type === "comma") {
                consume(cursor);
                continue;
            }
            if (next?.type === "rbrace") {
                consume(cursor);
                break;
            }
            errors.push({
                code: "E_EXPECTED",
                message: "expected ',' or '}' in object",
                line: next?.line ?? 0,
                column: next?.column ?? 0,
            });
            break;
        }
        return { type: "object", value: obj };
    }

    errors.push({
        code: "E_UNEXPECTED_TOKEN",
        message: `unexpected token '${tok.type}'`,
        line: tok.line,
        column: tok.column,
    });
    return undefined;
}

function parse_args(cursor: Cursor, errors: ParseError[]): Record<string, ValueNode> {
    const args: Record<string, ValueNode> = {};
    const next = peek(cursor);
    if (next?.type === "rparen") {
        consume(cursor);
        return args;
    }

    while (peek(cursor)) {
        const key_tok = peek(cursor);
        if (!key_tok || key_tok.type !== "identifier") {
            errors.push({
                code: "E_EXPECTED",
                message: "expected arg key identifier",
                line: key_tok?.line ?? 0,
                column: key_tok?.column ?? 0,
            });
            break;
        }
        consume(cursor);
        const key = key_tok.value ?? "";
        expect(cursor, "equals", errors, "expected '=' after arg key");
        const value = parse_value(cursor, errors);
        if (value) args[key] = value;
        const next_token = peek(cursor);
        if (next_token?.type === "comma") {
            consume(cursor);
            continue;
        }
        if (next_token?.type === "rparen") {
            consume(cursor);
            break;
        }
        errors.push({
            code: "E_EXPECTED",
            message: "expected ',' or ')' in args",
            line: next_token?.line ?? 0,
            column: next_token?.column ?? 0,
        });
        break;
    }

    return args;
}

function parse_command(tokens: Token[], errors: ParseError[]): CommandNode | undefined {
    const cursor: Cursor = { tokens, index: 0 };
    const parts: string[] = [];

    const first = peek(cursor);
    if (!first || first.type !== "identifier") {
        errors.push({
            code: "E_EXPECTED",
            message: "expected subject identifier",
            line: first?.line ?? 0,
            column: first?.column ?? 0,
        });
        return undefined;
    }

    while (peek(cursor)?.type === "identifier") {
        const tok = consume(cursor);
        parts.push(tok?.value ?? "");
        if (peek(cursor)?.type === "dot") {
            consume(cursor);
            continue;
        }
        break;
    }

    const next = peek(cursor);
    if (!next || next.type !== "lparen") {
        errors.push({
            code: "E_EXPECTED",
            message: "expected '(' after verb",
            line: next?.line ?? 0,
            column: next?.column ?? 0,
        });
        return undefined;
    }

    if (parts.length < 2) {
        errors.push({
            code: "E_MISSING_VERB",
            message: "missing verb separator '.'",
            line: next.line,
            column: next.column,
        });
        return undefined;
    }

    const verb = parts[parts.length - 1] ?? "";
    const subject = parts.slice(0, -1).join(".");

    consume(cursor); // lparen
    const args = parse_args(cursor, errors);

    const extra = peek(cursor);
    if (extra) {
        errors.push({
            code: "E_TRAILING_TOKENS",
            message: "unexpected tokens after ')'",
            line: extra.line,
            column: extra.column,
        });
    }

    return { subject, verb, args, line: tokens[0]?.line ?? 0 };
}

export function parse_machine_text(machine_text: string | undefined): ParseResult {
    const commands: CommandNode[] = [];
    const errors: ParseError[] = [];
    const warnings: ParseWarning[] = [];

    const tool_required_verbs = new Set([
        "USE",
        "ATTACK",
        "HELP",
        "DEFEND",
        "GRAPPLE",
        "INSPECT",
        "COMMUNICATE",
        "DODGE",
        "CRAFT",
        "SLEEP",
        "REPAIR",
        "MOVE",
        "WORK",
        "GUARD",
        "HOLD",
    ]);

    if (!machine_text || machine_text.trim().length === 0) {
        return { commands, errors: [{ code: "E_EMPTY", message: "missing machine_text", line: 0, column: 0 }], warnings };
    }

    const lines = machine_text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
        const raw = lines[i] ?? "";
        if (raw.trim().length === 0) continue;

        const { tokens, errors: token_errors } = tokenize_line(raw, i + 1);
        if (token_errors.length > 0) {
            errors.push(...token_errors);
            continue;
        }

        const command = parse_command(tokens, errors);
        if (command) {
            if (tool_required_verbs.has(command.verb) && !Object.prototype.hasOwnProperty.call(command.args, "tool")) {
                errors.push({
                    code: "E_MISSING_TOOL",
                    message: `missing required tool for verb ${command.verb}`,
                    line: command.line,
                    column: 1,
                });
            }
            commands.push(command);
        }
    }

    return { commands, errors, warnings };
}
