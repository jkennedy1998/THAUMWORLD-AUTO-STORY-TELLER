export type TokenType =
    | "identifier"
    | "string"
    | "number"
    | "boolean"
    | "dot"
    | "comma"
    | "equals"
    | "lparen"
    | "rparen"
    | "lbrace"
    | "rbrace"
    | "lbracket"
    | "rbracket";

export type Token = {
    type: TokenType;
    value?: string;
    line: number;
    column: number;
};

export type ParseError = {
    code: string;
    message: string;
    line: number;
    column: number;
};

export type ParseWarning = {
    code: string;
    message: string;
    line: number;
    column: number;
};

export type ValueNode =
    | { type: "string"; value: string }
    | { type: "number"; value: number }
    | { type: "boolean"; value: boolean }
    | { type: "identifier"; value: string }
    | { type: "list"; value: ValueNode[] }
    | { type: "object"; value: Record<string, ValueNode> };

export type CommandNode = {
    subject: string;
    verb: string;
    args: Record<string, ValueNode>;
    line: number;
};

export type ParseResult = {
    commands: CommandNode[];
    errors: ParseError[];
    warnings: ParseWarning[];
};
