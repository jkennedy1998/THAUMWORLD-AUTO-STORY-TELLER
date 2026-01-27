import * as fs from "node:fs";
import { parse } from "jsonc-parser";
import { get_kind_definitions_path } from "../engine/paths.js";

export type KindDefinition = {
    id: string;
    name: string;
    greater_kind?: string;
    parts?: { slot: string; critical?: boolean }[];
    sleep_type?: "SLEEP" | "REPAIR";
    sleep_required_per_day?: number;
    age?: { adulthood?: number; decline?: number; death?: number };
    languages?: { name: string; understood_senses?: { sense: string; mag: number }[] }[];
    size_mag?: number;
    senses?: Record<string, number>;
    movement?: { walk?: number; climb?: number; swim?: number; fly?: number };
    stat_changes?: Record<string, number>;
    diet?: string;
    temperature_range?: { low: number; high: number };
    appearance?: string;
    lore?: string;
    gift_of_kind?: Record<string, unknown>[];
    gift_of_greater_kind?: Record<string, unknown>[];
    flaw_of_kind?: Record<string, unknown>[];
};

export type KindDefinitionsFile = {
    kinds: KindDefinition[];
};

function read_jsonc(pathname: string): Record<string, unknown> {
    const raw = fs.readFileSync(pathname, "utf-8");
    return (parse(raw) as Record<string, unknown>) ?? {};
}

export function load_kind_definitions(): KindDefinitionsFile {
    const path = get_kind_definitions_path();
    if (!fs.existsSync(path)) return { kinds: [] };
    const raw = read_jsonc(path);
    const kinds = Array.isArray(raw.kinds) ? (raw.kinds as KindDefinition[]) : [];
    return { kinds };
}

export function find_kind(kind_id: string): KindDefinition | null {
    const defs = load_kind_definitions();
    const match = defs.kinds.find((k) => String(k.id).toLowerCase() === String(kind_id).toLowerCase());
    return match ?? null;
}
