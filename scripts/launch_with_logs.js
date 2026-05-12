/**
 * Game Launcher with Log Capture
 *
 * Launches all game processes and captures their output to log files.
 * Usage: node scripts/launch_with_logs.js [--slot=1]
 */

import path from "path";
import { spawn } from "child_process";
import { fileURLToPath, pathToFileURL } from "url";
import { acquireHostLaunchLock, detectLocalHost, detectVite, readHostLaunchLock, recoverHostLaunchLock, releaseHostLaunchLock, waitForLocalHost, writeHostSessionFile } from "./launcher_common.mjs";
import { syncAtlasAssets } from "./atlas_sync.mjs";

// Get __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse arguments
const args = process.argv.slice(2);
const slot_arg = args.find(arg => arg.startsWith("--slot="));
const data_slot = slot_arg ? parseInt(slot_arg.split("=")[1]) : 1;
const mode_arg = args.find(arg => arg.startsWith("--mode="));
const launch_mode = (mode_arg ? String(mode_arg.split("=")[1] ?? "smart") : "smart").trim().toLowerCase();

console.log("🎮 Starting THAUMWORLD with log capture...");
console.log(`💾 Data slot: ${data_slot}`);
console.log(`🧭 Launch mode: ${launch_mode}`);
console.log("");

const atlasSync = syncAtlasAssets();
if (atlasSync.missingSource) {
  console.warn(`⚠️ atlas sync source missing: ${atlasSync.sourceDir}`);
} else if (atlasSync.copied.length > 0) {
  console.log(`🖼️ atlas sync copied: ${atlasSync.copied.join(', ')}`);
} else {
  console.log(`🖼️ atlas sync: no atlas copies needed`);
}

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
const host_processes = [
  { name: "event_bridge", cmd: "node", args: ["dist/event_bridge/main.js"], delay: 0 },
  { name: "data_broker", cmd: "node", args: ["dist/data_broker/main.js"], delay: 0 },
  { name: "renderer", cmd: "node", args: ["dist/renderer_ai/main.js"], delay: 500 },
  { name: "rules_lawyer", cmd: "node", args: ["dist/rules_lawyer/main.js"], delay: 500 },
  { name: "npc_ai", cmd: "node", args: ["dist/npc_ai/main.js"], delay: 500 },
  { name: "roller", cmd: "node", args: ["dist/roller/main.js"], delay: 500 },
  { name: "state_applier", cmd: "node", args: ["dist/state_applier/main.js"], delay: 500 },
  { name: "turn_manager", cmd: "node", args: ["dist/turn_manager/main.js"], delay: 500 },
  { name: "interface", cmd: "node", args: ["dist/interface_program/main.js"], delay: 2000 }
];

const client_processes = [
  { name: "vite", cmd: "npx", args: ["vite"], delay: 0 },
  { name: "electron", cmd: "npx", args: ["electron", "."], delay: 3000 }
];

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function launch_process_list(processes, role) {
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
            NODE_ENV: "development",
            THAUM_BOOT_ROLE: role
          },
          cwd: path.join(__dirname, "..")
        }
      );

      spawned_processes.push(child);
    } catch (err) {
      console.error(`❌ Failed to start ${proc.name}:`, err.message);
    }
  }

}

async function launch_all() {
  const baseDir = path.join(__dirname, '..');
  let hostExists = await detectLocalHost(data_slot);
  const viteExists = await detectVite();
  const existingLock = readHostLaunchLock(baseDir, data_slot);
  if (existingLock) {
    console.log(`🔒 Host launch lock detected pid=${existingLock.pid || 'unknown'} created_at=${existingLock.created_at || 'unknown'}`);
  }

  if (launch_mode === 'host') {
    writeHostSessionFile(baseDir, data_slot, session.sessionId ?? `session_${Date.now()}`, new Date());
    await launch_process_list(host_processes, 'host');
  } else if (launch_mode === 'client') {
    const clientList = viteExists ? client_processes.filter(proc => proc.name !== 'vite') : client_processes;
    await launch_process_list(clientList, 'client');
  } else if (!hostExists) {
    if (existingLock) {
      const recovered = await recoverHostLaunchLock(baseDir, data_slot, { timeoutMs: 5000, probeFirst: true });
      console.log(`🔧 Host lock recovery: ${recovered.reason}${recovered.cleared ? ' (cleared stale lock)' : ''}`);
      hostExists = await detectLocalHost(data_slot);
    }
    const lock = acquireHostLaunchLock(baseDir, data_slot);
    if (lock.ok) {
      writeHostSessionFile(baseDir, data_slot, session.sessionId ?? `session_${Date.now()}`, new Date());
      console.log(`🔐 Host lock acquired ${lock.lockPath}`);
      await launch_process_list(host_processes, 'host');
      setTimeout(() => releaseHostLaunchLock(lock.lockPath), 20000);
      hostExists = await waitForLocalHost(data_slot, 25000);
      console.log(`🩺 Host wait result after start: ${hostExists ? 'ready' : 'not_reachable'}`);
    } else {
      console.log('Another launcher is starting the local host; attaching client once ready...');
      hostExists = await waitForLocalHost(data_slot, 25000);
      console.log(`🩺 Host wait result while attaching: ${hostExists ? 'ready' : 'not_reachable'}`);
    }
    const clientList = viteExists ? client_processes.filter(proc => proc.name !== 'vite') : client_processes;
    await launch_process_list(clientList, 'client');
  } else {
    console.log('🩺 Local host health probe succeeded before launch');
    const clientList = viteExists ? client_processes.filter(proc => proc.name !== 'vite') : client_processes;
    await launch_process_list(clientList, 'client');
  }

  console.log("");
  console.log("✅ Launch complete!");
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
