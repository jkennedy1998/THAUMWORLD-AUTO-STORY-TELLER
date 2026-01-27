import * as fs from "node:fs";
import { parse } from "jsonc-parser";
import { get_language_definitions_path } from "../engine/paths.js";

export type LanguageDefinition = {
    name: string;
    default_senses: { sense: string; mag: number }[];
    notes?: string;
};

export type LanguageDefinitionsFile = {
    languages: LanguageDefinition[];
};

function read_jsonc(pathname: string): Record<string, unknown> {
    const raw = fs.readFileSync(pathname, "utf-8");
    return (parse(raw) as Record<string, unknown>) ?? {};
}

export function load_language_definitions(): LanguageDefinitionsFile {
    const path = get_language_definitions_path();
    if (!fs.existsSync(path)) return { languages: [] };
    const raw = read_jsonc(path);
    const languages = Array.isArray(raw.languages) ? (raw.languages as LanguageDefinition[]) : [];
    return { languages };
}

export function find_language(name: string): LanguageDefinition | null {
    const defs = load_language_definitions();
    const match = defs.languages.find((l) => String(l.name).toLowerCase() === String(name).toLowerCase());
    return match ?? null;
}
