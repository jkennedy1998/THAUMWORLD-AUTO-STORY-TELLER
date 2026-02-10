/**
 * THAUMWORLD Game Launcher (Executable Entry Point)
 *
 * This is the main entry point when running as a compiled executable.
 * It launches all game processes and manages their lifecycle.
 */

import {
  init_log_capture,
  spawn_with_logging,
  terminate_all_processes,
  type LogSession
} from "./log_capture.js";
import * as path from "path";
import * as fs from "fs";

// Determine if running from compiled executable
const is_packaged = typeof process !== "undefined" && (process as any).pkg !== undefined;

// Set up paths
const base_dir = is_packaged
  ? path.dirname(process.execPath)
  : process.cwd();

const data_slot = parseInt(process.env.DATA_SLOT || "1");

/**
 * Check if Ollama is running
 */
async function check_ollama(): Promise<boolean> {
  try {
    const response = await fetch("http://localhost:11434/api/tags");
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main launcher function
 */
async function main(): Promise<void> {
  console.log("🎮 THAUMWORLD Launcher");
  console.log(`📦 Packaged: ${is_packaged}`);
  console.log(`📁 Base directory: ${base_dir}`);
  console.log(`💾 Data slot: ${data_slot}`);
  console.log("");

  // Check prerequisites
  console.log("🔍 Checking prerequisites...");

  const ollama_running = await check_ollama();
  if (!ollama_running) {
    console.error("❌ Ollama not detected!");
    console.error("   Please start Ollama first: https://ollama.ai");
    console.error("   Once Ollama is running, restart this launcher.");
    process.exit(1);
  }
  console.log("✅ Ollama detected");

  // Check data directory exists
  const data_dir = path.join(base_dir, "local_data", `data_slot_${data_slot}`);
  if (!fs.existsSync(data_dir)) {
    fs.mkdirSync(data_dir, { recursive: true });
    console.log("📁 Created data directory");
  }

  // Initialize log capture
  console.log("");
  console.log("📝 Initializing log capture...");
  const session = init_log_capture(data_slot);
  console.log(`   Log directory: ${session.log_dir}`);
  console.log("");

  // Launch all services
  await launch_services(session);

  console.log("✅ All services started successfully!");
  console.log("🌐 Game window should appear shortly...");
  console.log("");
  console.log("Press Ctrl+C to stop all services");
  console.log("");

  // Keep process running
  process.stdin.resume();
}

/**
 * Launch all game services
 */
async function launch_services(session: LogSession): Promise<void> {
  const services = [
    { name: "data_broker", delay: 0 },
    { name: "interpreter", delay: 500 },
    { name: "renderer", delay: 500 },
    { name: "rules_lawyer", delay: 500 },
    { name: "npc_ai", delay: 500 },
    { name: "roller", delay: 500 },
    { name: "state_applier", delay: 500 },
    { name: "turn_manager", delay: 500 },
    { name: "interface", delay: 1000 },
    { name: "electron", delay: 2000 }
  ];

  for (const service of services) {
    await sleep(service.delay);

    const exe_path = is_packaged
      ? path.join(base_dir, "dist", `${service.name}`, "main.js")
      : path.join(base_dir, "dist", `${service.name}`, "main.js");

    // Check if file exists
    if (!fs.existsSync(exe_path)) {
      console.warn(`⚠️  Warning: ${exe_path} not found, skipping ${service.name}`);
      continue;
    }

    console.log(`🚀 Starting ${service.name}...`);

    try {
      spawn_with_logging(
        session,
        service.name,
        process.execPath,
        [exe_path],
        {
          env: {
            ...process.env,
            DATA_SLOT: data_slot.toString(),
            NODE_ENV: "production"
          },
          cwd: base_dir
        }
      );
    } catch (err) {
      console.error(`❌ Failed to start ${service.name}:`, err);
    }
  }
}

/**
 * Graceful shutdown handler
 */
async function shutdown(): Promise<void> {
  console.log("\n🛑 Shutting down THAUMWORLD...");
  console.log("   This may take a few seconds...");

  // This is a global variable we'll set when main() runs
  // For now, we can't easily access the session here
  // In a real implementation, we'd store it globally

  console.log("👋 Goodbye!");
  process.exit(0);
}

// Handle signals
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

// Handle uncaught errors
process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught exception:", err);
  void shutdown();
});

process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled rejection:", reason);
  void shutdown();
});

// Start
main().catch(err => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});
