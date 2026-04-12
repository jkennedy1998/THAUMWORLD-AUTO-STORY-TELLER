/**
 * Shared Logging Utilities
 *
 * Centralized logging functions used by all launchers (game and painter).
 * Provides consistent session naming, date handling, and log discovery.
 */

import * as fs from "fs";
import * as path from "path";
import { generateSessionId } from "../shared/session_ids.js";

export { generateSessionId };

/**
 * Format date as YYYY-MM-DD using local timezone
 * (Not UTC - this fixes the midnight boundary issue)
 */
export function formatDateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Get the data slot directory path
 */
export function getDataSlotDir(slot: number): string {
  return path.join(process.cwd(), "local_data", `data_slot_${slot}`);
}

/**
 * Get the log directory for a specific mode and date
 * Mode: 'game' or 'painter'
 */
export function getLogDir(
  slot: number,
  mode: "game" | "painter",
  date?: Date
): string {
  const targetDate = date || new Date();
  const dateStr = formatDateLocal(targetDate);
  const modeDir = mode === "game" ? "logs" : "logs_ascii_painter";
  return path.join(getDataSlotDir(slot), modeDir, dateStr);
}

/**
 * Parse a latest.log reference file
 * Returns null if file doesn't exist or is malformed
 */
export function parseLatestLog(latestPath: string): {
  currentLog: string;
  sessionId: string;
  createdAt: Date;
} | null {
  try {
    if (!fs.existsSync(latestPath)) {
      return null;
    }

    const content = fs.readFileSync(latestPath, "utf-8");

    const logMatch = content.match(/CURRENT_LOG=(.+)/);
    const sessionMatch = content.match(/SESSION_ID=(.+)/);
    const createdMatch = content.match(/CREATED_AT=(.+)/);

    if (!logMatch?.[1]) {
      return null;
    }

    return {
      currentLog: logMatch[1].trim(),
      sessionId: sessionMatch?.[1]?.trim() ?? "unknown",
      createdAt: createdMatch?.[1]
        ? new Date(createdMatch[1].trim())
        : new Date(0),
    };
  } catch {
    return null;
  }
}

/**
 * Find the most recent session log file in a directory
 * Returns null if no session files found
 */
export function findMostRecentSession(logDir: string): string | null {
  try {
    if (!fs.existsSync(logDir)) {
      return null;
    }

    const files = fs
      .readdirSync(logDir)
      .filter((f) => f.match(/^session_\d+_[a-z0-9]+\.log$/))
      .map((f) => ({
        name: f,
        path: path.join(logDir, f),
        mtime: fs.statSync(path.join(logDir, f)).mtime,
      }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    return files[0]?.path ?? null;
  } catch {
    return null;
  }
}

/**
 * Get the path to the latest log file
 * Includes fallback to most recent session if latest.log is stale
 */
export function getLatestLogPath(
  slot: number,
  mode: "game" | "painter"
): string | null {
  const dates = listLogDates(slot, mode);
  const dirsToCheck = [getLogDir(slot, mode), ...dates.map((date) => getLogDir(slot, mode, new Date(`${date}T00:00:00`)))];
  const seen = new Set<string>();
  for (const logDir of dirsToCheck) {
    if (!logDir || seen.has(logDir)) continue;
    seen.add(logDir);
    const latestPath = path.join(logDir, "latest.log");
    const latest = parseLatestLog(latestPath);
    if (latest && fs.existsSync(latest.currentLog)) {
      return latest.currentLog;
    }
    const fallback = findMostRecentSession(logDir);
    if (fallback) {
      console.log(
        `[LogUtils] Stale latest.log detected, using fallback: ${path.basename(fallback)}`
      );
      return fallback;
    }
  }
  return null;
}

/**
 * Update the latest.log pointer file
 * Creates a reference file pointing to the target log
 */
export function updateLatestPointer(
  logDir: string,
  targetLog: string
): void {
  const latestPath = path.join(logDir, "latest.log");
  const timestamp = new Date().toISOString();
  const sessionId = path.basename(targetLog, ".log");

  try {
    // Remove old latest.log if it exists
    try {
      fs.unlinkSync(latestPath);
    } catch {
      // File might not exist, that's ok
    }

    // Try symlink first (Unix/Linux/Mac)
    try {
      fs.symlinkSync(targetLog, latestPath);
      return;
    } catch {
      // Windows might not support symlinks, fall through to reference file
    }

    // Write reference file with validation metadata
    const reference = `CURRENT_LOG=${targetLog}
SESSION_ID=${sessionId}
CREATED_AT=${timestamp}
VALID=true
`;
    fs.writeFileSync(latestPath, reference);
  } catch (err) {
    console.error(`[LogUtils] Warning: Could not update latest.log: ${err}`);
  }
}

/**
 * Validate and optionally repair a stale latest.log reference
 * Returns the valid log path (repaired or fallback)
 */
export function validateAndRepairLatest(
  logDir: string,
  repair: boolean = false
): { valid: boolean; logPath: string | null; repaired: boolean } {
  const latestPath = path.join(logDir, "latest.log");
  const latest = parseLatestLog(latestPath);

  // If latest.log exists and points to valid file, we're good
  if (latest && fs.existsSync(latest.currentLog)) {
    return { valid: true, logPath: latest.currentLog, repaired: false };
  }

  // Find fallback
  const fallback = findMostRecentSession(logDir);

  if (!fallback) {
    return { valid: false, logPath: null, repaired: false };
  }

  // Repair if requested
  if (repair && fallback) {
    updateLatestPointer(logDir, fallback);
    console.log(`[LogUtils] Repaired latest.log → ${path.basename(fallback)}`);
    return { valid: true, logPath: fallback, repaired: true };
  }

  return { valid: true, logPath: fallback, repaired: false };
}

/**
 * Ensure log directory exists, create if needed
 */
export function ensureLogDir(logDir: string): void {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

/**
 * Write session header to log file
 */
export function writeLogHeader(
  logPath: string,
  sessionId: string,
  startTime: Date
): void {
  const header = `
================================================================================
THAUMWORLD Log Session
Session ID: ${sessionId}
Start Time: ${startTime.toISOString()}
Local Date: ${formatDateLocal(startTime)}
Log Directory: ${path.dirname(logPath)}
================================================================================

`;
  fs.writeFileSync(logPath, header);
}

/**
 * Initialize a complete log session
 * Returns session info needed by launchers
 */
export function initLogSession(
  slot: number,
  mode: "game" | "painter"
): {
  sessionId: string;
  logDir: string;
  mainLog: string;
  startTime: Date;
} {
  const sessionId = generateSessionId();
  const startTime = new Date();
  const logDir = getLogDir(slot, mode, startTime);

  ensureLogDir(logDir);

  const mainLog = path.join(logDir, `${sessionId}.log`);

  writeLogHeader(mainLog, sessionId, startTime);
  updateLatestPointer(logDir, mainLog);

  return {
    sessionId,
    logDir,
    mainLog,
    startTime,
  };
}

/**
 * List all log directories for a data slot
 * Returns array of date strings (YYYY-MM-DD)
 */
export function listLogDates(
  slot: number,
  mode: "game" | "painter"
): string[] {
  const baseDir =
    mode === "game"
      ? path.join(getDataSlotDir(slot), "logs")
      : path.join(getDataSlotDir(slot), "logs_ascii_painter");

  try {
    if (!fs.existsSync(baseDir)) {
      return [];
    }

    return fs
      .readdirSync(baseDir)
      .filter((d) => {
        const fullPath = path.join(baseDir, d);
        return (
          fs.statSync(fullPath).isDirectory() && d.match(/^\d{4}-\d{2}-\d{2}$/)
        );
      })
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/**
 * Get all session files in a log directory
 * Returns array of file info sorted by modification time (newest first)
 */
export function listSessionFiles(logDir: string): Array<{
  name: string;
  path: string;
  mtime: Date;
  size: number;
}> {
  try {
    if (!fs.existsSync(logDir)) {
      return [];
    }

    return fs
      .readdirSync(logDir)
      .filter((f) => f.match(/^session_\d+_[a-z0-9]+\.log$/))
      .map((f) => {
        const fullPath = path.join(logDir, f);
        const stats = fs.statSync(fullPath);
        return {
          name: f,
          path: fullPath,
          mtime: stats.mtime,
          size: stats.size,
        };
      })
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  } catch {
    return [];
  }
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
