/**
 * Game Launcher with Log Capture
 *
 * Launches all game processes and captures their output to log files.
 * Usage: node scripts/launch_with_logs.js [--slot=1]
 */

import path from "path";
import { spawn } from "child_process";
import { fileURLToPath, pathToFileURL } from "url";

// Get __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse arguments
const args = process.argv.slice(2);
const slot_arg = args.find(arg => arg.startsWith("--slot="));
const data_slot = slot_arg ? parseInt(slot_arg.split("=")[1]) : 1;

console.log("🎮 Starting THAUMWORLD with log capture...");
console.log(`💾 Data slot: ${data_slot}`);
console.log("");

// Import the compiled log capture module
const log_capture_path = path.join(__dirname, "..", "dist", "launcher", "log_capture.js");
const log_capture_url = pathToFileURL(log_capture_path).href;

let init_log_capture, spawn_with_logging, terminate_all_processes;

try {
  const log_capture = await import(log_capture_url);
  init_log_capture = log_capture.init_log_capture;
  spawn_with_logging = log_capture.spawn_with_logging;
  terminate_all_processes = log_capture.terminate_all_processes;
} catch (err) {
  console.error("❌ Error: Could not load log_capture module.");
  console.error("   Make sure to run 'npm run build' first.");
  console.error(`   Path: ${log_capture_path}`);
  console.error(`   Error: ${err.message}`);
  process.exit(1);
}

// Initialize log capture
let session;
try {
  session = init_log_capture(data_slot);
} catch (err) {
  console.error("❌ Failed to initialize log capture:", err.message);
  process.exit(1);
}

console.log(`📝 Logging to: ${session.log_dir}`);
console.log(`📄 Main log: ${session.main_log}`);
console.log("");

// Track all spawned processes
const spawned_processes = [];

// Launch all processes
const processes = [
  { name: "data_broker", cmd: "node", args: ["dist/data_broker/main.js"], delay: 0 },
  // { name: "interpreter", cmd: "node", args: ["dist/interpreter_ai/main.js"], delay: 500 },  // ARCHIVED - communication system now in interface_program
  { name: "renderer", cmd: "node", args: ["dist/renderer_ai/main.js"], delay: 500 },
  { name: "rules_lawyer", cmd: "node", args: ["dist/rules_lawyer/main.js"], delay: 500 },
  { name: "npc_ai", cmd: "node", args: ["dist/npc_ai/main.js"], delay: 500 },
  { name: "roller", cmd: "node", args: ["dist/roller/main.js"], delay: 500 },
  { name: "state_applier", cmd: "node", args: ["dist/state_applier/main.js"], delay: 500 },
  { name: "turn_manager", cmd: "node", args: ["dist/turn_manager/main.js"], delay: 500 },
  { name: "interface", cmd: "node", args: ["dist/interface_program/main.js"], delay: 2000 },
  { name: "electron", cmd: "npx", args: ["electron", "."], delay: 3000 }
];

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function launch_all() {
  for (const proc of processes) {
    await sleep(proc.delay);
    console.log(`🚀 Starting ${proc.name}...`);

    try {
      const child = spawn_with_logging(
        session,
        proc.name,
        proc.cmd,
        proc.args,
        {
          env: {
            ...process.env,
            DATA_SLOT: data_slot.toString(),
            NODE_ENV: "development"
          },
          cwd: path.join(__dirname, "..")
        }
      );

      spawned_processes.push(child);
    } catch (err) {
      console.error(`❌ Failed to start ${proc.name}:`, err.message);
    }
  }

  console.log("");
  console.log("✅ All processes started!");
  console.log("🌐 Game window should appear shortly...");
  console.log("");
  console.log("Press Ctrl+C to stop all services");
  console.log("");
}

// Handle graceful shutdown
async function shutdown() {
  console.log("\n🛑 Shutting down THAUMWORLD...");

  if (session && terminate_all_processes) {
    terminate_all_processes(session);
  }

  // Give processes time to terminate
  await sleep(1000);

  // Force kill any remaining processes
  for (const child of spawned_processes) {
    if (child && !child.killed) {
      child.kill("SIGTERM");
    }
  }

  await sleep(500);

  // Force kill remaining
  for (const child of spawned_processes) {
    if (child && !child.killed) {
      child.kill("SIGKILL");
    }
  }

  console.log("👋 Goodbye!");
  process.exit(0);
}

// Handle signals
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", () => {
  // Final cleanup
});

// Handle uncaught errors
process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught exception:", err);
  shutdown();
});

process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled rejection:", reason);
  shutdown();
});

// Start launching
launch_all().catch(err => {
  console.error("❌ Launch failed:", err);
  shutdown();
});
