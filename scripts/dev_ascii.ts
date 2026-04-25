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
import { acquireHostLaunchLock, detectHost, detectLocalHost, readHostLaunchLock, recoverHostLaunchLock, releaseHostLaunchLock, waitForHost, waitForLocalHost } from "./launcher_common.mjs";
import { write_host_session_file } from "../src/shared/host_session_store.js";
import { resolveToolAssistedInputsEntry } from "./tool_assisted_inputs_registry.mjs";
import { build_multiplayer_transport_config } from "../src/shared/multiplayer_transport.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
const slot_arg = args.find((arg) => arg.startsWith("--slot="));
const data_slot = slot_arg ? parseInt(slot_arg.split("=")[1] ?? "1", 10) : 1;
const mode_arg = args.find((arg) => arg.startsWith("--mode="));
const launch_mode = (mode_arg ? String(mode_arg.split("=")[1] ?? "smart") : "smart").trim().toLowerCase();
const tai_id_arg = args.find((arg) => arg.startsWith("--tai-id="));
const tai_id = tai_id_arg ? String(tai_id_arg.split("=")[1] ?? "").trim() : "";
const host_arg = args.find((arg) => arg.startsWith("--host="));
const preferred_host = host_arg ? String(host_arg.split("=")[1] ?? "").trim() : "";
const diag_profile_arg = args.find((arg) => arg.startsWith("--diag-profile="));
const diag_profile = (diag_profile_arg ? String(diag_profile_arg.split("=")[1] ?? "quiet") : (tai_id ? 'logs' : 'quiet')).trim().toLowerCase() === 'logs'
  ? 'logs'
  : 'quiet';
const baseDir = path.join(__dirname, "..");
const tai_entry = tai_id ? resolveToolAssistedInputsEntry(baseDir, tai_id) : null;
const remote_transport = preferred_host ? build_multiplayer_transport_config({ host: preferred_host }) : null;

console.log("Starting THAUMWORLD ASCII Painter...");
console.log(`Data slot: ${data_slot}`);
console.log(`Diagnostics profile: ${diag_profile}`);
console.log(`Launch mode: ${launch_mode}`);
if (preferred_host) console.log(`Preferred host: ${preferred_host}`);
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
  const extraEnv = (options.env && typeof options.env === 'object') ? options.env as Record<string, string> : {};
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
      ...(preferred_host ? {
        THAUM_TAI_JOIN_HOST: preferred_host,
        THAUM_TAI_JOIN_CONNECTION_KIND: 'saved_manual',
      } : {}),
      ...(tai_entry ? {
        THAUM_TAI_ENABLED: 'true',
        THAUM_TAI_RESET_STATE: 'true',
        THAUM_TAI_ID: tai_entry.id,
        THAUM_TAI_TEST_NAME: tai_entry.testName,
        THAUM_TAI_OPEN_MS: String(tai_entry.openMs),
        THAUM_TAI_END_DELAY_MS: String(tai_entry.endDelayMs),
        THAUM_TAI_SCRIPT_PATH: tai_entry.scriptPath,
      } : {}),
      ...extraEnv,
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

function writePainterHostSessionMetadata(): void {
  const hostSessionPath = write_host_session_file(data_slot, {
    session_id: sessionId,
    boot_time: bootTime,
  });
  appendToLog(formatLogEntry("LAUNCHER", "INFO", `Painter host session metadata written ${JSON.stringify({
    session_id: sessionId,
    host_session_path: hostSessionPath,
    data_slot,
  })}`));
}

function startPainterClientProcesses(viteExists: boolean, bootRole: 'host' | 'client'): void {
  appendToLog(formatLogEntry("LAUNCHER", "INFO", `Painter client processes starting ${JSON.stringify({
    data_slot,
    vite_exists: viteExists,
    boot_role: bootRole,
    launch_mode,
    preferred_host: preferred_host || null,
  })}`));
  if (!viteExists) {
    spawnWithLogging("vite", "npx", ["vite", "--config", "vite.painter.config.ts"], { env: { THAUM_BOOT_ROLE: bootRole } });
  }
  setTimeout(() => {
    spawnWithLogging("electron", "npx", ["electron", "."], { env: { THAUM_BOOT_ROLE: bootRole } });
  }, viteExists ? 1000 : 5000);
}

async function startPainter(): Promise<void> {
  console.log("Starting painter...");
  const hostProbeOptions = remote_transport ? { apiBaseUrl: remote_transport.api_base_url } : undefined;
  let hostExists = remote_transport ? await detectHost(data_slot, hostProbeOptions) : await detectLocalHost(data_slot);
  const viteExists = await detectPainterVite();
  appendToLog(formatLogEntry("LAUNCHER", "INFO", `Painter launch host probe ${JSON.stringify({
    data_slot,
    host_exists: hostExists,
    vite_exists: viteExists,
  })}`));
  const existingLock = readHostLaunchLock(baseDir, data_slot);
  if (!remote_transport && !hostExists && existingLock) {
    const recovered = await recoverHostLaunchLock(baseDir, data_slot, { timeoutMs: 5000, probeFirst: true });
    console.log(`Host lock recovery: ${recovered.reason}${recovered.cleared ? ' (cleared stale lock)' : ''}`);
    hostExists = await detectLocalHost(data_slot);
  }
  let rendererBootRole: 'host' | 'client' = 'client';
  if (launch_mode === 'client') {
    rendererBootRole = 'client';
    if (remote_transport) {
      hostExists = await waitForHost(data_slot, 20000, hostProbeOptions);
      console.log(`Remote host wait result while attaching: ${hostExists ? 'ready' : 'not_reachable'}`);
    }
  } else if (launch_mode === 'host' || !hostExists) {
    const lock = acquireHostLaunchLock(baseDir, data_slot);
    if (lock.ok) {
      console.log(`Host lock acquired at ${lock.lockPath}`);
      appendToLog(formatLogEntry("LAUNCHER", "INFO", `Painter host owner elected ${JSON.stringify({
        data_slot,
        lock_path: lock.lockPath,
        session_id: sessionId,
      })}`));
      writePainterHostSessionMetadata();
      startPainterHostProcesses();
      setTimeout(() => releaseHostLaunchLock(lock.lockPath), 20000);
      hostExists = await waitForLocalHost(data_slot, 20000);
      rendererBootRole = 'host';
      console.log(`Host wait result after start: ${hostExists ? 'ready' : 'not_reachable'}`);
    } else {
      console.log('Another launcher is starting the local host; waiting to attach...');
      appendToLog(formatLogEntry("LAUNCHER", "INFO", `Painter attach waiting for existing host ${JSON.stringify({
        data_slot,
        lock_path: lock.lockPath,
      })}`));
      hostExists = await waitForLocalHost(data_slot, 20000);
      rendererBootRole = 'client';
      console.log(`Host wait result while attaching: ${hostExists ? 'ready' : 'not_reachable'}`);
    }
  } else {
    rendererBootRole = 'client';
    console.log(remote_transport ? 'Remote host detected; attaching painter client only' : 'Local host detected; attaching painter client only');
    appendToLog(formatLogEntry("LAUNCHER", "INFO", `Painter attach-only launch ${JSON.stringify({
      data_slot,
      session_id: sessionId,
      host_exists: true,
      preferred_host: preferred_host || null,
    })}`));
  }
  if (launch_mode === 'host') {
    console.log('Painter host services started');
    console.log("Press Ctrl+C to stop");
    return;
  }
  appendToLog(formatLogEntry("LAUNCHER", "INFO", `Painter renderer boot role resolved ${JSON.stringify({
    data_slot,
    launch_mode,
    renderer_boot_role: rendererBootRole,
    host_exists: hostExists,
    preferred_host: preferred_host || null,
  })}`));
  startPainterClientProcesses(viteExists, rendererBootRole);
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
