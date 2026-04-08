/**
 * Dev Launcher with Log Capture
 *
 * Runs all THAUMWORLD processes (tsx + vite + electron) with automatic log capture.
 * This reflects code changes immediately without needing to rebuild.
 *
 * Usage: tsx scripts/dev_with_logs.ts [--slot=1]
 */

import { spawn, type ChildProcess } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import * as fs from "fs";
import {
  initLogSession,
  parseLatestLog,
  updateLatestPointer,
} from "../src/launcher/log_utils.js";
import { acquireHostLaunchLock, detectLocalHost, detectVite, readHostLaunchLock, recoverHostLaunchLock, releaseHostLaunchLock, waitForLocalHost, writeHostSessionFile as writeHostSessionManifest } from "./launcher_common.mjs";
import { syncAtlasAssets } from "./atlas_sync.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
const slot_arg = args.find((arg) => arg.startsWith("--slot="));
const data_slot = slot_arg ? parseInt(slot_arg.split("=")[1] ?? "1", 10) : 1;
const mode_arg = args.find((arg) => arg.startsWith("--mode="));
const launch_mode = (mode_arg ? String(mode_arg.split("=")[1] ?? "smart") : "smart").trim().toLowerCase();

console.log("Starting THAUMWORLD DEV mode with log capture...");
console.log("Code changes will be reflected immediately (no rebuild needed)");
console.log(`Data slot: ${data_slot}`);
console.log(`Launch mode: ${launch_mode}`);
console.log("");

const atlasSync = syncAtlasAssets();
if (atlasSync.missingSource) {
  console.warn(`[atlas sync] source directory missing: ${atlasSync.sourceDir}`);
} else {
  const copiedSummary = atlasSync.copied.length > 0 ? `copied ${atlasSync.copied.join(', ')}` : 'no atlas copies needed';
  console.log(`[atlas sync] ${copiedSummary}`);
}

const session = initLogSession(data_slot, "game");
const { sessionId, logDir, mainLog } = session;
const bootTime = new Date();

function verifyLatestPointer(): void {
  const latestPath = path.join(logDir, "latest.log");
  const latest = parseLatestLog(latestPath);
  if (latest?.currentLog === mainLog && fs.existsSync(mainLog)) return;
  updateLatestPointer(logDir, mainLog);
  const repaired = parseLatestLog(latestPath);
  if (repaired?.currentLog === mainLog) {
    console.warn(`[launcher] repaired latest.log -> ${path.basename(mainLog)}`);
    return;
  }
  console.warn(`[launcher] latest.log verification failed for ${path.basename(mainLog)}`);
}

verifyLatestPointer();

function writeHostSessionMetadata(): void {
  writeHostSessionManifest(path.join(__dirname, ".."), data_slot, sessionId, bootTime);
}

console.log(`Logging to: ${logDir}`);
console.log(`Main log: ${mainLog}`);
console.log(`Session ID: ${sessionId}`);
console.log("");

const childProcesses: ChildProcess[] = [];

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

function shouldPrintToConsole(_processName: string, level: string, line: string): boolean {
  if (level !== "INFO") return true;
  const msg = String(line ?? "");
  if (/\b(ERROR|WARN|WARNING)\b/i.test(msg)) return true;
  if (/\b(MULTITILE_TEST|LEGALITY|RANGE)\b/.test(msg)) return true;
  if (/\blistening\b/i.test(msg)) return true;
  if (/\bstarted\b/i.test(msg) && /(Event Bridge|HTTP bridge|booted|initialized)/i.test(msg)) return true;
  if (/\bVITE\b/i.test(msg) || /\bready in\b/i.test(msg) || /\bLocal:\b/i.test(msg) || /\bNetwork\b/i.test(msg)) return true;
  if (/\bConnected\b/i.test(msg) || /\bconnecting\b/i.test(msg)) return true;
  const drop = [
    /\bheartbeat\b/i,
    /Tick started - checking \d+ messages/i,
    /polling interval set/i,
    /running initial tick/i,
    /\bPOLL\b.*messages/i,
    /process_dispersing\./i,
    /\[ModuleRegistry\] Registered module:/i,
    /\[fetch_log_messages\]/i,
    /\[get_equipped_containers\]/i,
    /\[CharacterModule\] Drawing character/i,
    /Electron Security Warning/i,
  ];
  for (const rx of drop) {
    if (rx.test(msg)) return false;
  }
  return false;
}

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
      if (shouldPrintToConsole(name, "INFO", line)) console.log(entry);
    }
  });
  child.stderr?.on("data", (data: Buffer | string) => {
    const lines = data.toString().split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      const entry = formatLogEntry(name, "ERROR", line);
      appendToLog(entry);
      if (shouldPrintToConsole(name, "ERROR", line)) console.error(entry);
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

function startHostProcesses(): void {
  const processes = [
    { name: "event_bridge", cmd: "tsx", args: ["src/event_bridge/main.ts"] },
    { name: "interface", cmd: "tsx", args: ["src/interface_program/main.ts"] },
    { name: "data_broker", cmd: "tsx", args: ["src/data_broker/main.ts"] },
    { name: "rules_lawyer", cmd: "tsx", args: ["src/rules_lawyer/main.ts"] },
    { name: "renderer", cmd: "tsx", args: ["src/renderer_ai/main.ts"] },
    { name: "roller", cmd: "tsx", args: ["src/roller/main.ts"] },
    { name: "state_applier", cmd: "tsx", args: ["src/state_applier/main.ts"] },
    { name: "npc_ai", cmd: "tsx", args: ["src/npc_ai/main.ts"] },
    { name: "turn_manager", cmd: "tsx", args: ["src/turn_manager/main.ts"] },
  ];
  for (const proc of processes) {
    spawnWithLogging(proc.name, proc.cmd, proc.args, { env: { THAUM_BOOT_ROLE: 'host' } });
  }
}

function startViteIfNeeded(start: boolean): void {
  if (start) spawnWithLogging("vite", "npx", ["vite"], { env: { THAUM_BOOT_ROLE: 'client' } });
}

function startElectronDelayed(delayMs: number): void {
  setTimeout(() => {
    spawnWithLogging("electron", "npx", ["electron", "."], { env: { THAUM_BOOT_ROLE: 'client' } });
  }, delayMs);
}

async function startDev(): Promise<void> {
  console.log("Starting processes...");
  let hostExists = await detectLocalHost(data_slot);
  const viteExists = await detectVite();
  const baseDir = path.join(__dirname, '..');
  const existingLock = readHostLaunchLock(baseDir, data_slot);
  if (existingLock) {
    console.log(`Host launch lock detected: pid=${existingLock.pid || 'unknown'} created_at=${existingLock.created_at || 'unknown'}`);
  }

  if (launch_mode === 'host') {
    writeHostSessionMetadata();
    startHostProcesses();
    console.log('Host services started');
    return;
  }

  if (launch_mode === 'client') {
    startViteIfNeeded(!viteExists);
    startElectronDelayed(viteExists ? 1000 : 4000);
    console.log('Client started');
    return;
  }

  if (!hostExists) {
    if (existingLock) {
      const recovered = await recoverHostLaunchLock(baseDir, data_slot, { timeoutMs: 5000, probeFirst: true });
      console.log(`Host lock recovery: ${recovered.reason}${recovered.cleared ? ' (cleared stale lock)' : ''}`);
      hostExists = await detectLocalHost(data_slot);
    }
    const lock = acquireHostLaunchLock(baseDir, data_slot);
    if (lock.ok) {
      writeHostSessionMetadata();
      console.log(`Host lock acquired at ${lock.lockPath}`);
      startHostProcesses();
      setTimeout(() => releaseHostLaunchLock(lock.lockPath), 20000);
      hostExists = await waitForLocalHost(data_slot, 25000);
      console.log(`Host wait result after start: ${hostExists ? 'ready' : 'not_reachable'}`);
    } else {
      console.log('Another launcher is starting the local host; waiting to attach...');
      hostExists = await waitForLocalHost(data_slot, 25000);
      console.log(`Host wait result while attaching: ${hostExists ? 'ready' : 'not_reachable'}`);
    }
    startViteIfNeeded(!viteExists);
    startElectronDelayed(viteExists ? 6000 : 9000);
    console.log(lock.ok ? 'No local host detected; started local host + client' : 'Waiting for local host, then attaching client');
  } else {
    console.log('Local host health probe succeeded before launch');
    startViteIfNeeded(!viteExists);
    startElectronDelayed(viteExists ? 1000 : 4000);
    console.log('Local host detected; attached client only');
  }
  console.log("Press Ctrl+C to stop");
}

async function shutdown(): Promise<void> {
  console.log("\nShutting down dev server...");
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
  void startDev();
} catch (err) {
  console.error("Failed to start dev process:", err);
  process.exit(1);
}
