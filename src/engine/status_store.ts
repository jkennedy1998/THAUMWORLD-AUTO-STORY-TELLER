import * as fs from "node:fs";
import { parse } from "jsonc-parser";

export type StatusFile = {
    schema_version: 1;
    line: string;
    updated_at: string;
};

export function read_status(status_path: string): StatusFile {
    const raw = fs.readFileSync(status_path, "utf-8");
    const parsed = parse(raw) as any;

    if (parsed?.schema_version !== 1 || typeof parsed?.line !== "string" || typeof parsed?.updated_at !== "string") {
        throw new Error("status.jsonc is not canonical (expected schema_version: 1, line, updated_at)");
    }

    return parsed as StatusFile;
}

export function write_status_line(status_path: string, line: string): StatusFile {
    const next: StatusFile = {
        schema_version: 1,
        line,
        updated_at: new Date().toISOString(),
    };

    fs.writeFileSync(status_path, JSON.stringify(next, null, 2), "utf-8");
    return next;
}

export function ensure_status_exists(status_path: string): void {
    if (fs.existsSync(status_path)) return;
    const initial: StatusFile = {
        schema_version: 1,
        line: "awaiting actor input",
        updated_at: new Date().toISOString(),
    };
    fs.writeFileSync(status_path, JSON.stringify(initial, null, 2), "utf-8");
}
