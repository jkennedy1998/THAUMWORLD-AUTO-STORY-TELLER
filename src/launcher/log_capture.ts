/**
 * Log Capture System
 *
 * Captures all stdout/stderr from child processes
 * and writes to timestamped log files.
 */

import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { get_data_slot_dir } from "../engine/paths.js";

export interface LogSession {
  session_id: string;
  log_dir: string;
  main_log: string;
  process_logs: Map<string, string>;
  start_time: Date;
  child_processes: ChildProcess[];
}

/**
 * Generate unique session ID
 */
function generate_session_id(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `session_${timestamp}_${random}`;
}

/**
 * Format date as YYYY-MM-DD
 */
function format_date(date: Date): string {
  const parts = date.toISOString().split("T");
  return parts[0] ?? date.toISOString().substring(0, 10);
}

/**
 * Format time as HHMMSS
 */
function format_time(date: Date): string {
  const parts = date.toTimeString().split(" ");
  const time = parts[0] ?? "000000";
  return time.replace(/:/g, "");
}

/**
 * Initialize a new log capture session
 */
export function init_log_capture(data_slot: number): LogSession {
  const session_id = generate_session_id();
  const now = new Date();
  const log_dir = path.join(
    get_data_slot_dir(data_slot),
    "logs",
    format_date(now)
  );

  // Ensure log directory exists
  fs.mkdirSync(log_dir, { recursive: true });

  const session: LogSession = {
    session_id,
    log_dir,
    main_log: path.join(log_dir, `${session_id}_${format_time(now)}.log`),
    process_logs: new Map(),
    start_time: now,
    child_processes: []
  };

  // Write session header
  write_log_header(session);

  // Create/update latest.log symlink (or copy on Windows)
  update_latest_pointer(log_dir, session.main_log);

  return session;
}

/**
 * Write session header to log file
 */
function write_log_header(session: LogSession): void {
  const header = `
================================================================================
THAUMWORLD Log Session
Session ID: ${session.session_id}
Start Time: ${session.start_time.toISOString()}
Log Directory: ${session.log_dir}
================================================================================

`;
  fs.writeFileSync(session.main_log, header);
}

/**
 * Update latest.log pointer (symlink on Unix, file copy on Windows)
 */
function update_latest_pointer(log_dir: string, target_log: string): void {
  const latest_path = path.join(log_dir, "latest.log");

  try {
    // Try to create symlink first
    try {
      fs.unlinkSync(latest_path);
    } catch {
      // File might not exist
    }
    fs.symlinkSync(target_log, latest_path);
  } catch {
    // Windows might not support symlinks, so write a reference file instead
    const reference = `CURRENT_LOG=${target_log}\nSESSION_ID=${path.basename(target_log, ".log")}\n`;
    fs.writeFileSync(latest_path, reference);
  }
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
    stdio: ["pipe", "pipe", "pipe"]
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
    const entry = format_log_entry(name, "EXIT", `Process exited with code ${code}`);
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
    const entry = format_log_entry(name, "ERROR", `Process error: ${err.message}`);
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
  const entry = format_log_entry("LAUNCHER", "INFO", "Initiating graceful shutdown...");
  append_to_log(session.main_log, entry);

  // Kill all child processes
  for (const child of session.child_processes) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }

  // Write final log entry
  const final_entry = format_log_entry("LAUNCHER", "INFO", "All processes terminated");
  append_to_log(session.main_log, final_entry);
}

/**
 * Get the path to the latest log file
 */
export function get_latest_log_path(data_slot: number): string | null {
  const today = new Date();
  const log_dir = path.join(
    get_data_slot_dir(data_slot),
    "logs",
    format_date(today)
  );

  const latest_path = path.join(log_dir, "latest.log");

  try {
    // Check if it's a symlink
    const stats = fs.lstatSync(latest_path);
    if (stats.isSymbolicLink()) {
      return fs.readlinkSync(latest_path);
    }

    // It's a reference file, read the path from it
    const content = fs.readFileSync(latest_path, "utf-8");
    const match = content.match(/CURRENT_LOG=(.+)/);
    if (match && match[1]) {
      return match[1].trim();
    }
  } catch {
    // File doesn't exist
  }

  return null;
}

/**
 * List all log files for a data slot
 */
export function list_logs(data_slot: number): { date: string; files: string[] }[] {
  const logs_base = path.join(get_data_slot_dir(data_slot), "logs");

  if (!fs.existsSync(logs_base)) {
    return [];
  }

  const result: { date: string; files: string[] }[] = [];

  const dates = fs.readdirSync(logs_base);
  for (const date of dates) {
    const date_dir = path.join(logs_base, date);
    const stats = fs.statSync(date_dir);

    if (stats.isDirectory()) {
      const files = fs.readdirSync(date_dir)
        .filter(f => f.endsWith(".log"))
        .sort();

      result.push({ date, files });
    }
  }

  // Sort by date (newest first)
  return result.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Clean old log files (keep last N days)
 */
export function clean_old_logs(data_slot: number, keep_days: number = 30): number {
  const logs_base = path.join(get_data_slot_dir(data_slot), "logs");

  if (!fs.existsSync(logs_base)) {
    return 0;
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - keep_days);
  const cutoff_str = format_date(cutoff);

  let removed = 0;

  const dates = fs.readdirSync(logs_base);
  for (const date of dates) {
    if (date < cutoff_str) {
      const date_dir = path.join(logs_base, date);
      fs.rmSync(date_dir, { recursive: true, force: true });
      removed++;
    }
  }

  return removed;
}
