import * as fs from "node:fs";
import * as path from "node:path";
import { get_host_session_file_path } from "./boot_env.js";
import { generateSessionId } from "./session_ids.js";

export interface HostSessionFile {
  session_id: string;
  boot_time: string;
  boot_timestamp: number;
  version: number;
}

export function read_host_session_file(slot?: number): HostSessionFile | null {
  try {
    const filePath = get_host_session_file_path(slot);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as HostSessionFile;
  } catch {
    return null;
  }
}

export function write_host_session_file(
  slot?: number,
  options?: { session_id?: string; boot_time?: Date }
): string {
  const filePath = get_host_session_file_path(slot);
  const bootTime = options?.boot_time ?? new Date();
  const file: HostSessionFile = {
    session_id: options?.session_id ?? generateSessionId({ suffixLength: 7 }),
    boot_time: bootTime.toISOString(),
    boot_timestamp: bootTime.getTime(),
    version: 1,
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(file, null, 2), "utf-8");
  return filePath;
}
