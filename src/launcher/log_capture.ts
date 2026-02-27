/**
 * Log Capture System
 *
 * Captures all stdout/stderr from child processes
 * and writes to timestamped log files.
 */

import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import {
  initLogSession,
  getLogDir,
  formatDateLocal,
  updateLatestPointer,
  getLatestLogPath,
  listSessionFiles,
  listLogDates,
  parseLatestLog,
} from "./log_utils.js";

export interface LogSession {
  session_id: string;
  log_dir: string;
  main_log: string;
  process_logs: Map<string, string>;
  start_time: Date;
  child_processes: ChildProcess[];
}

/**
 * Initialize a new log capture session
 * Uses shared utilities for consistency
 */
export function init_log_capture(data_slot: number): LogSession {
  const start_time = new Date();
  
  // Use shared utility for session initialization
  const session_info = initLogSession(data_slot, "game");
  
  const session: LogSession = {
    session_id: session_info.sessionId,
    log_dir: session_info.logDir,
    main_log: session_info.mainLog,
    process_logs: new Map(),
    start_time,
    child_processes: [],
  };

  // Write additional launcher-specific info
  const launcher_info = `
Launcher Type: log_capture
Mode: game
Data Slot: ${data_slot}
`;
  fs.appendFileSync(session.main_log, launcher_info);

  return session;
}

/**
 * Format a log entry with timestamp
 */
function format_log_entry(process: string, level: string, message: string): string {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${process}] [${level}] ${message}`;
}

/**
 * Append entry to log file
 */
function append_to_log(file_path: string, entry: string): void {
  try {
    fs.appendFileSync(file_path, entry + "\n");
  } catch (err) {
    console.error(`Failed to write to log: ${file_path}`, err);
  }
}

/**
 * Spawn a process with captured output
 */
export function spawn_with_logging(
  session: LogSession,
  name: string,
  command: string,
  args: string[],
  options?: any
): ChildProcess {
  // FIXED: Use consistent naming without time suffix
  const process_log_file = path.join(
    session.log_dir,
    `${session.session_id}_${name}.log`
  );
  session.process_logs.set(name, process_log_file);

  // Write process header
  const header = `
================================================================================
Process: ${name}
Command: ${command} ${args.join(" ")}
Started: ${new Date().toISOString()}
================================================================================

`;
  fs.writeFileSync(process_log_file, header);

  const child = spawn(command, args, {
    ...options,
    stdio: ["pipe", "pipe", "pipe"],
  });

  session.child_processes.push(child);

  // Capture stdout
  child.stdout?.on("data", (data: Buffer) => {
    const lines = data.toString().split("\n");
    for (const line of lines) {
      if (line.trim()) {
        const entry = format_log_entry(name, "INFO", line);
        append_to_log(session.main_log, entry);
        append_to_log(process_log_file, entry);
        console.log(entry);
      }
    }
  });

  // Capture stderr
  child.stderr?.on("data", (data: Buffer) => {
    const lines = data.toString().split("\n");
    for (const line of lines) {
      if (line.trim()) {
        const entry = format_log_entry(name, "ERROR", line);
        append_to_log(session.main_log, entry);
        append_to_log(process_log_file, entry);
        console.error(entry);
      }
    }
  });

  // Handle process exit
  child.on("close", (code: number | null) => {
    const entry = format_log_entry(
      name,
      "EXIT",
      `Process exited with code ${code}`
    );
    append_to_log(session.main_log, entry);
    append_to_log(process_log_file, entry);

    // Remove from child processes list
    const index = session.child_processes.indexOf(child);
    if (index > -1) {
      session.child_processes.splice(index, 1);
    }
  });

  // Handle errors
  child.on("error", (err: Error) => {
    const entry = format_log_entry(
      name,
      "ERROR",
      `Process error: ${err.message}`
    );
    append_to_log(session.main_log, entry);
    append_to_log(process_log_file, entry);
    console.error(entry);
  });

  return child;
}

/**
 * Terminate all child processes gracefully
 */
export function terminate_all_processes(session: LogSession): void {
  console.log("\n🛑 Terminating all processes...");

  // Write termination notice to log
  const entry = format_log_entry(
    "LAUNCHER",
    "INFO",
    "Initiating graceful shutdown..."
  );
  append_to_log(session.main_log, entry);

  // Kill all child processes
  for (const child of session.child_processes) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }

  // Write final log entry
  const final_entry = format_log_entry(
    "LAUNCHER",
    "INFO",
    "All processes terminated"
  );
  append_to_log(session.main_log, final_entry);
}

/**
 * Get the path to the latest log file
 * Uses shared utility with fallback logic
 */
export function get_latest_log_path(
  data_slot: number,
  mode: "game" | "painter" = "game"
): string | null {
  return getLatestLogPath(data_slot, mode);
}

/**
 * List all log files for a data slot
 * Uses shared utility
 */
export function list_logs(
  data_slot: number,
  mode: "game" | "painter" = "game"
): { date: string; files: string[] }[] {
  const dates = listLogDates(data_slot, mode);
  const result = [];

  for (const date of dates) {
    const logDir = getLogDir(data_slot, mode, new Date(date));
    const files = listSessionFiles(logDir);

    if (files.length > 0) {
      result.push({
        date,
        files: files.map((f) => f.name),
      });
    }
  }

  return result;
}

/**
 * Re-export shared utilities for convenience
 */
export {
  initLogSession,
  getLogDir,
  formatDateLocal,
  updateLatestPointer,
  getLatestLogPath,
  listLogDates,
  listSessionFiles,
  parseLatestLog,
} from "./log_utils.js";
