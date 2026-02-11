/**
 * Dev Launcher with Log Capture
 *
 * Runs all THAUMWORLD processes (tsx + vite + electron) with automatic log capture.
 * This reflects code changes immediately without needing to rebuild.
 *
 * Usage: node scripts/dev_with_logs.js [--slot=1]
 */

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import * as fs from "fs";
import { get_data_slot_dir } from "../dist/engine/paths.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse arguments
const args = process.argv.slice(2);
const slot_arg = args.find(arg => arg.startsWith("--slot="));
const data_slot = slot_arg ? parseInt(slot_arg.split("=")[1]) : 1;

console.log("🎮 Starting THAUMWORLD DEV mode with log capture...");
console.log("💡 Code changes will be reflected immediately (no rebuild needed)");
console.log(`💾 Data slot: ${data_slot}`);
console.log("");

// Generate session ID
const timestamp = Date.now();
const randomSuffix = Math.random().toString(36).substring(2, 9);
const sessionId = `session_${timestamp}_${randomSuffix}`;
const bootTime = new Date().toISOString();

// Write session file
const sessionFilePath = path.join(process.cwd(), '.session_id');
fs.writeFileSync(sessionFilePath, JSON.stringify({
  session_id: sessionId,
  boot_time: bootTime,
  boot_timestamp: timestamp,
  version: 1
}, null, 2));

// Setup log directory
const today = new Date().toISOString().split("T")[0];
const logDir = path.join(get_data_slot_dir(data_slot), "logs", today);
fs.mkdirSync(logDir, { recursive: true });

const mainLog = path.join(logDir, `${sessionId}.log`);

// Write log header
const header = `
================================================================================
THAUMWORLD Log Session
Session ID: ${sessionId}
Start Time: ${bootTime}
Log Directory: ${logDir}
================================================================================

`;
fs.writeFileSync(mainLog, header);

// Update latest.log pointer
const latestPath = path.join(logDir, "latest.log");
try {
  fs.unlinkSync(latestPath);
} catch {}
fs.writeFileSync(latestPath, `CURRENT_LOG=${mainLog}\nSESSION_ID=${sessionId}\n`);

console.log(`📝 Logging to: ${logDir}`);
console.log(`📄 Main log: ${mainLog}`);
console.log(`📋 Session ID: ${sessionId}`);
console.log("");

// Track all child processes
const childProcesses = [];

/**
 * Format a log entry with timestamp
 */
function formatLogEntry(process, level, message) {
  const ts = new Date().toISOString();
  return `[${ts}] [${process}] [${level}] ${message}`;
}

/**
 * Append entry to log file
 */
function appendToLog(entry) {
  try {
    fs.appendFileSync(mainLog, entry + "\n");
  } catch (err) {
    console.error("Failed to write to log:", err);
  }
}

/**
 * Spawn a process with captured output
 */
function spawnWithLogging(name, command, args, options = {}) {
  const isWindows = process.platform === "win32";
  
  const child = spawn(command, args, {
    ...options,
    stdio: ["pipe", "pipe", "pipe"],
    shell: isWindows,
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      DATA_SLOT: data_slot.toString(),
      NODE_ENV: "development"
    }
  });

  childProcesses.push(child);

  // Capture stdout
  child.stdout.on("data", (data) => {
    const lines = data.toString().split("\n");
    for (const line of lines) {
      if (line.trim()) {
        const entry = formatLogEntry(name, "INFO", line);
        appendToLog(entry);
        console.log(entry);
      }
    }
  });

  // Capture stderr
  child.stderr.on("data", (data) => {
    const lines = data.toString().split("\n");
    for (const line of lines) {
      if (line.trim()) {
        const entry = formatLogEntry(name, "ERROR", line);
        appendToLog(entry);
        console.error(entry);
      }
    }
  });

  // Handle process exit
  child.on("close", (code) => {
    const entry = formatLogEntry(name, "EXIT", `Process exited with code ${code}`);
    appendToLog(entry);
    
    const index = childProcesses.indexOf(child);
    if (index > -1) {
      childProcesses.splice(index, 1);
    }
    
    // If all processes exit, shutdown
    if (childProcesses.length === 0) {
      console.log("\n👋 All processes exited");
      process.exit(code || 0);
    }
  });

  // Handle errors
  child.on("error", (err) => {
    const entry = formatLogEntry(name, "ERROR", `Process error: ${err.message}`);
    appendToLog(entry);
    console.error(entry);
  });

  return child;
}

/**
 * Start all dev processes
 */
function startDev() {
  console.log("🚀 Starting all processes...");

  // Core processes
  const processes = [
    { name: "interface", cmd: "tsx", args: ["src/interface_program/main.ts"] },
    // { name: "interpreter", cmd: "tsx", args: ["src/interpreter_ai/main.ts"] },  // ARCHIVED - communication system now in interface_program
    { name: "data_broker", cmd: "tsx", args: ["src/data_broker/main.ts"] },
    { name: "rules_lawyer", cmd: "tsx", args: ["src/rules_lawyer/main.ts"] },
    { name: "renderer", cmd: "tsx", args: ["src/renderer_ai/main.ts"] },
    { name: "roller", cmd: "tsx", args: ["src/roller/main.ts"] },
    { name: "state_applier", cmd: "tsx", args: ["src/state_applier/main.ts"] },
    { name: "npc_ai", cmd: "tsx", args: ["src/npc_ai/main.ts"] },
    { name: "turn_manager", cmd: "tsx", args: ["src/turn_manager/main.ts"] },
    { name: "vite", cmd: "npx", args: ["vite"] },
  ];

  // Spawn all processes
  for (const proc of processes) {
    spawnWithLogging(proc.name, proc.cmd, proc.args);
  }

  // Wait for Vite to be ready, then start Electron
  setTimeout(() => {
    spawnWithLogging("electron", "npx", ["wait-on", "http://localhost:5173", "&&", "npx", "electron", "."]);
  }, 3000);

  console.log("✅ All processes started!");
  console.log("🌐 Game will open in Electron window...");
  console.log("📝 All output is being logged to file");
  console.log("");
  console.log("Press Ctrl+C to stop");
}

/**
 * Graceful shutdown
 */
async function shutdown() {
  console.log("\n🛑 Shutting down dev server...");

  // Final log entry
  const entry = formatLogEntry("LAUNCHER", "INFO", "Shutdown initiated by user");
  appendToLog(entry);

  // Kill all child processes
  for (const child of childProcesses) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }

  // Give them a moment to clean up
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Force kill any remaining
  for (const child of childProcesses) {
    if (!child.killed) {
      child.kill("SIGKILL");
    }
  }

  appendToLog(formatLogEntry("LAUNCHER", "INFO", "All processes terminated"));
  console.log("👋 Goodbye!");
  process.exit(0);
}

// Handle signals
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Handle uncaught errors
process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught exception:", err);
  shutdown();
});

process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled rejection:", reason);
  shutdown();
});

// Start
try {
  startDev();
} catch (err) {
  console.error("❌ Failed to start dev process:", err);
  process.exit(1);
}
