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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
const slot_arg = args.find((arg) => arg.startsWith("--slot="));
const data_slot = slot_arg ? parseInt(slot_arg.split("=")[1] ?? "1", 10) : 1;

console.log("Starting THAUMWORLD DEV mode with log capture...");
console.log("Code changes will be reflected immediately (no rebuild needed)");
console.log(`Data slot: ${data_slot}`);
console.log("");

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

const sessionFilePath = path.join(process.cwd(), ".session_id");
fs.writeFileSync(
  sessionFilePath,
  JSON.stringify(
    {
      session_id: sessionId,
      boot_time: bootTime.toISOString(),
      boot_timestamp: bootTime.getTime(),
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
  const child = spawn(command, args, {
    ...options,
    stdio: ["pipe", "pipe", "pipe"],
    shell: isWindows,
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      DATA_SLOT: data_slot.toString(),
      NODE_ENV: "development",
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

function startDev(): void {
  console.log("Starting all processes...");
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
    { name: "vite", cmd: "npx", args: ["vite"] },
  ];
  for (const proc of processes) {
    spawnWithLogging(proc.name, proc.cmd, proc.args);
  }
  setTimeout(() => {
    spawnWithLogging("electron", "npx", ["electron", "."]);
  }, 8000);
  console.log("All processes started");
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
  startDev();
} catch (err) {
  console.error("Failed to start dev process:", err);
  process.exit(1);
}
