/**
 * ASCII Painter Dev Launcher
 *
 * Usage: tsx scripts/dev_ascii.ts [--slot=1]
 */

import { spawn, type ChildProcess } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import * as fs from "fs";
import {
  initLogSession,
  parseLatestLog,
  updateLatestPointer,
  updateLatestSessionState,
} from "../src/launcher/log_utils.js";
import { acquireHostLaunchLock, detectLocalHost, readHostLaunchLock, recoverHostLaunchLock, releaseHostLaunchLock, waitForLocalHost } from "./launcher_common.mjs";
import { resolveToolAssistedInputsEntry } from "./tool_assisted_inputs_registry.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
const slot_arg = args.find((arg) => arg.startsWith("--slot="));
const data_slot = slot_arg ? parseInt(slot_arg.split("=")[1] ?? "1", 10) : 1;
const tai_id_arg = args.find((arg) => arg.startsWith("--tai-id="));
const tai_id = tai_id_arg ? String(tai_id_arg.split("=")[1] ?? "").trim() : "";
const diag_profile_arg = args.find((arg) => arg.startsWith("--diag-profile="));
const diag_profile = (diag_profile_arg ? String(diag_profile_arg.split("=")[1] ?? "quiet") : (tai_id ? 'logs' : 'quiet')).trim().toLowerCase() === 'logs'
  ? 'logs'
  : 'quiet';
const baseDir = path.join(__dirname, "..");
const tai_entry = tai_id ? resolveToolAssistedInputsEntry(baseDir, tai_id) : null;

console.log("Starting THAUMWORLD ASCII Painter...");
console.log(`Data slot: ${data_slot}`);
console.log(`Diagnostics profile: ${diag_profile}`);
if (tai_entry) {
  console.log(`Tool Assisted Inputs: tai${tai_entry.id}`);
  console.log(`TAS test: ${tai_entry.testName}`);
  console.log(`TAS open ms: ${tai_entry.openMs}`);
}
console.log("");

const session = initLogSession(data_slot, "painter", {
  launcher: 'dev_ascii',
  pid: process.pid,
  status: 'running',
  taiId: tai_entry?.id ?? null,
  testName: tai_entry?.testName ?? null,
});
const { sessionId, logDir, mainLog } = session;
const bootTime = new Date();

function verifyLatestPointer(): void {
  const latestPath = path.join(logDir, "latest.log");
  const latest = parseLatestLog(latestPath);
  if (latest?.currentLog === mainLog && fs.existsSync(mainLog)) return;
  updateLatestPointer(logDir, mainLog);
  const repaired = parseLatestLog(latestPath);
  if (repaired?.currentLog === mainLog) {
    updateLatestSessionState(logDir, {
      sessionId,
      currentLog: mainLog,
      mode: 'painter',
      dataSlot: data_slot,
      launcher: 'dev_ascii',
      pid: process.pid,
      status: 'running',
      taiId: tai_entry?.id ?? null,
      testName: tai_entry?.testName ?? null,
    });
    console.warn(`[launcher] repaired latest.log -> ${path.basename(mainLog)}`);
    return;
  }
  console.warn(`[launcher] latest.log verification failed for ${path.basename(mainLog)}`);
}

verifyLatestPointer();

const sessionFilePath = path.join(process.cwd(), ".session_id");
fs.writeFileSync(
  sessionFilePath,
  JSON.stringify(
    {
      session_id: sessionId,
      boot_time: bootTime.toISOString(),
      boot_timestamp: bootTime.getTime(),
      mode: "ascii_painter",
      version: 1,
    },
    null,
    2
  )
);

console.log(`Logging to: ${logDir}`);
console.log(`Main log: ${mainLog}`);
console.log(`Session ID: ${sessionId}`);
console.log("");

const childProcesses: ChildProcess[] = [];

async function detectPainterVite(): Promise<boolean> {
  try {
    const res = await fetch('http://localhost:5174');
    return res.ok;
  } catch {
    return false;
  }
}

function formatLogEntry(process: string, level: string, message: string): string {
  const ts = new Date().toISOString();
  return `[${ts}] [${process}] [${level}] ${message}`;
}

function appendToLog(entry: string): void {
  try {
    fs.appendFileSync(mainLog, entry + "\n");
  } catch (err) {
    console.error("Failed to write to log:", err);
  }
}

appendToLog(formatLogEntry("LAUNCHER", "INFO", `dev_ascii session ${JSON.stringify({
  session_id: sessionId,
  data_slot,
  tai_id: tai_entry?.id ?? null,
  tai_test_name: tai_entry?.testName ?? null,
  tai_open_ms: tai_entry?.openMs ?? null,
  tai_script_path: tai_entry?.scriptPath ?? null,
})}`));
updateLatestSessionState(logDir, {
  sessionId,
  currentLog: mainLog,
  mode: 'painter',
  dataSlot: data_slot,
  launcher: 'dev_ascii',
  pid: process.pid,
  status: 'running',
  taiId: tai_entry?.id ?? null,
  testName: tai_entry?.testName ?? null,
});

function spawnWithLogging(name: string, command: string, args: string[], options: Record<string, unknown> = {}): ChildProcess {
  const isWindows = process.platform === "win32";
  const child = spawn(command, args, {
    ...options,
    stdio: ["pipe", "pipe", "pipe"],
    shell: isWindows,
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      DATA_SLOT: data_slot.toString(),
      NODE_ENV: "development",
      THAUM_APP_MODE: "ascii_painter",
      THAUM_DIAG_PROFILE: diag_profile,
      DEBUG_LEVEL: diag_profile === 'logs' ? '3' : '2',
      THAUM_STARTUP_BOOT_MODE: tai_entry ? 'tas_runtime' : 'manual_shell',
      ...(tai_entry ? {
        THAUM_TAI_ENABLED: 'true',
        THAUM_TAI_RESET_STATE: 'true',
        THAUM_TAI_ID: tai_entry.id,
        THAUM_TAI_TEST_NAME: tai_entry.testName,
        THAUM_TAI_OPEN_MS: String(tai_entry.openMs),
        THAUM_TAI_END_DELAY_MS: String(tai_entry.endDelayMs),
        THAUM_TAI_SCRIPT_PATH: tai_entry.scriptPath,
      } : {}),
    },
  });
  childProcesses.push(child);
  child.stdout?.on("data", (data: Buffer | string) => {
    const lines = data.toString().split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      const entry = formatLogEntry(name, "INFO", line);
      appendToLog(entry);
      console.log(entry);
    }
  });
  child.stderr?.on("data", (data: Buffer | string) => {
    const lines = data.toString().split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      const entry = formatLogEntry(name, "ERROR", line);
      appendToLog(entry);
      console.error(entry);
    }
  });
  child.on("close", (code) => {
    appendToLog(formatLogEntry(name, "EXIT", `Process exited with code ${code}`));
    const index = childProcesses.indexOf(child);
    if (index > -1) childProcesses.splice(index, 1);
    if (childProcesses.length === 0) {
      console.log("\nAll processes exited");
      process.exit(code || 0);
    }
  });
  child.on("error", (err) => {
    const entry = formatLogEntry(name, "ERROR", `Process error: ${err.message}`);
    appendToLog(entry);
    console.error(entry);
  });
  return child;
}

function startPainterHostProcesses(): void {
  const processes = [
    { name: "event_bridge", cmd: "tsx", args: ["src/event_bridge/main.ts"] },
    { name: "interface", cmd: "tsx", args: ["src/interface_program/main.ts"] },
  ];
  for (const proc of processes) {
    spawnWithLogging(proc.name, proc.cmd, proc.args, { env: { THAUM_BOOT_ROLE: 'host' } });
  }
}

function startPainterClientProcesses(viteExists: boolean): void {
  if (!viteExists) {
    spawnWithLogging("vite", "npx", ["vite", "--config", "vite.painter.config.ts"], { env: { THAUM_BOOT_ROLE: 'client' } });
  }
  setTimeout(() => {
    spawnWithLogging("electron", "npx", ["electron", "."], { env: { THAUM_BOOT_ROLE: 'client' } });
  }, viteExists ? 1000 : 5000);
}

async function startPainter(): Promise<void> {
  console.log("Starting painter...");
  let hostExists = await detectLocalHost(data_slot);
  const viteExists = await detectPainterVite();
  const existingLock = readHostLaunchLock(baseDir, data_slot);
  if (!hostExists && existingLock) {
    const recovered = await recoverHostLaunchLock(baseDir, data_slot, { timeoutMs: 5000, probeFirst: true });
    console.log(`Host lock recovery: ${recovered.reason}${recovered.cleared ? ' (cleared stale lock)' : ''}`);
    hostExists = await detectLocalHost(data_slot);
  }
  if (!hostExists) {
    const lock = acquireHostLaunchLock(baseDir, data_slot);
    if (lock.ok) {
      console.log(`Host lock acquired at ${lock.lockPath}`);
      startPainterHostProcesses();
      setTimeout(() => releaseHostLaunchLock(lock.lockPath), 20000);
      hostExists = await waitForLocalHost(data_slot, 20000);
      console.log(`Host wait result after start: ${hostExists ? 'ready' : 'not_reachable'}`);
    } else {
      console.log('Another launcher is starting the local host; waiting to attach...');
      hostExists = await waitForLocalHost(data_slot, 20000);
      console.log(`Host wait result while attaching: ${hostExists ? 'ready' : 'not_reachable'}`);
    }
  } else {
    console.log('Local host detected; attaching painter client only');
  }
  startPainterClientProcesses(viteExists);
  console.log(hostExists ? 'Painter multiplayer compatibility boot ready' : 'Painter host unavailable; client will fall back locally');
  console.log("Press Ctrl+C to stop");
}

async function shutdown(): Promise<void> {
  console.log("\nShutting down painter...");
  appendToLog(formatLogEntry("LAUNCHER", "INFO", "Shutdown initiated by user"));
  for (const child of childProcesses) {
    if (!child.killed) child.kill("SIGTERM");
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
  for (const child of childProcesses) {
    if (!child.killed) child.kill("SIGKILL");
  }
  appendToLog(formatLogEntry("LAUNCHER", "INFO", "All processes terminated"));
  console.log("Goodbye!");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  void shutdown();
});
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
  void shutdown();
});

try {
  void startPainter();
} catch (err) {
  console.error("Failed to start painter:", err);
  process.exit(1);
}
