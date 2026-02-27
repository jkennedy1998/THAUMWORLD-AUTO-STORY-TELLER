/**
 * ASCII Painter Dev Launcher
 *
 * Runs the painter UI in standalone mode with isolated logging.
 * The painter now uses the same infrastructure as the game but with different modules.
 *
 * Usage: node scripts/dev_ascii.js [--slot=1]
 */

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import * as fs from "fs";
import {
  initLogSession,
  formatDateLocal,
} from "../dist/launcher/log_utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse arguments
const args = process.argv.slice(2);
const slot_arg = args.find((arg) => arg.startsWith("--slot="));
const data_slot = slot_arg ? parseInt(slot_arg.split("=")[1]) : 1;

console.log("🎨 Starting THAUMWORLD ASCII Painter...");
console.log("💡 Standalone painting mode (same renderer, different modules)");
console.log(`💾 Data slot: ${data_slot}`);
console.log("");

// Initialize logging session using shared utilities
const session = initLogSession(data_slot, "painter");
const { sessionId, logDir, mainLog } = session;
const bootTime = new Date();

// Write session file
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

console.log(`📝 Logging to: ${logDir}`);
console.log(`📄 Main log: ${mainLog}`);
console.log(`📋 Session ID: ${sessionId}`);
console.log("");

// Track child processes
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
      NODE_ENV: "development",
      THAUM_APP_MODE: "ascii_painter",
    },
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
    const entry = formatLogEntry(
      name,
      "EXIT",
      `Process exited with code ${code}`
    );
    appendToLog(entry);

    const index = childProcesses.indexOf(child);
    if (index > -1) {
      childProcesses.splice(index, 1);
    }

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
 * Start painter processes
 */
function startPainter() {
  console.log("🚀 Starting painter...");

  // Start Vite dev server with painter config (port 5174)
  spawnWithLogging("vite", "npx", ["vite", "--config", "vite.painter.config.ts"]);

  // Wait for Vite, then start Electron
  setTimeout(() => {
    spawnWithLogging("electron", "npx", ["electron", "."]);
  }, 5000);

  console.log("✅ Painter processes started!");
  console.log("🎨 ASCII Painter will open in Electron window...");
  console.log("📝 All output is being logged to file");
  console.log("");
  console.log("Press Ctrl+C to stop");
}

/**
 * Graceful shutdown
 */
async function shutdown() {
  console.log("\n🛑 Shutting down painter...");

  const entry = formatLogEntry("LAUNCHER", "INFO", "Shutdown initiated by user");
  appendToLog(entry);

  for (const child of childProcesses) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 1000));

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

// Handle errors
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
  startPainter();
} catch (err) {
  console.error("❌ Failed to start painter:", err);
  process.exit(1);
}
