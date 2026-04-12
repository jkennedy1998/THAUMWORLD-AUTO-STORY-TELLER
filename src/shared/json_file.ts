import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "jsonc-parser";

export function read_jsonc_file_or_default<T>(filePath: string, createFallback: () => T): T {
  try {
    if (!fs.existsSync(filePath)) return createFallback();
    return parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return createFallback();
  }
}

export function write_json_file(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}
