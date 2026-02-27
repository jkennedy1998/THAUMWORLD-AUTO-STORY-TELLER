/**
 * Log Viewer Utility
 *
 * View and manage game and painter logs.
 * Usage: node scripts/view_logs.js [--latest] [--list] [--clean] [--slot=1] [--mode=game|painter]
 */

import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import {
  getDataSlotDir,
  getLogDir,
  formatDateLocal,
  getLatestLogPath,
  listLogDates,
  listSessionFiles,
  formatFileSize,
  parseLatestLog,
  findMostRecentSession,
} from "../dist/launcher/log_utils.js";

// Get __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse arguments
const args = process.argv.slice(2);
const show_latest = args.includes("--latest");
const show_list = args.includes("--list") || args.length === 0;
const do_clean = args.includes("--clean");
const slot_arg = args.find((arg) => arg.startsWith("--slot="));
const mode_arg = args.find((arg) => arg.startsWith("--mode="));
const data_slot = slot_arg ? parseInt(slot_arg.split("=")[1]) : 1;
const mode = mode_arg ? mode_arg.split("=")[1] : "game";

if (mode !== "game" && mode !== "painter") {
  console.error(`❌ Invalid mode: ${mode}. Use 'game' or 'painter'.`);
  process.exit(1);
}

// Get paths
const data_slot_dir = path.join(__dirname, "..", "local_data", `data_slot_${data_slot}`);
const logs_base = path.join(
  data_slot_dir,
  mode === "game" ? "logs" : "logs_ascii_painter"
);

function formatDateForDisplay(date_str) {
  const date = new Date(date_str);
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getLogFiles() {
  const dates = listLogDates(data_slot, mode);
  const result = [];

  for (const date of dates) {
    const logDir = path.join(logs_base, date);
    const files = listSessionFiles(logDir);

    if (files.length > 0) {
      result.push({
        date,
        files: files.map((f) => ({
          name: f.name,
          path: f.path,
          date: date,
          size: f.size,
          modified: f.mtime,
        })),
      });
    }
  }

  return result;
}

function getLatestLog() {
  // Use shared utility with fallback logic
  return getLatestLogPath(data_slot, mode);
}

function cleanOldLogs(keep_days = 30) {
  if (!fs.existsSync(logs_base)) {
    console.log("No logs directory found.");
    return 0;
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - keep_days);
  const cutoff_str = formatDateLocal(cutoff);

  let removed = 0;
  let total_size = 0;

  const dates = fs.readdirSync(logs_base);
  for (const date of dates) {
    if (date < cutoff_str) {
      const date_dir = path.join(logs_base, date);
      const stats = fs.statSync(date_dir);

      if (stats.isDirectory()) {
        // Calculate size before deleting
        const files = fs.readdirSync(date_dir);
        for (const file of files) {
          const file_path = path.join(date_dir, file);
          const file_stats = fs.statSync(file_path);
          total_size += file_stats.size;
        }

        fs.rmSync(date_dir, { recursive: true, force: true });
        removed++;
        console.log(`  🗑️  Deleted: ${date} (${files.length} files)`);
      }
    }
  }

  if (removed > 0) {
    console.log(
      `\n✅ Cleaned ${removed} old log directories (${formatFileSize(total_size)})`
    );
  } else {
    console.log("✅ No old logs to clean.");
  }

  return removed;
}

function openLogFile(file_path) {
  const platform = process.platform;
  let command;

  if (platform === "win32") {
    command = "notepad";
  } else if (platform === "darwin") {
    command = "open";
  } else {
    command = "less";
  }

  console.log(`📄 Opening ${file_path}...`);
  spawn(command, [file_path], { detached: true, stdio: "ignore" });
}

function showUsage() {
  console.log("📊 THAUMWORLD Log Viewer");
  console.log("");
  console.log("Usage: node scripts/view_logs.js [options]");
  console.log("");
  console.log("Options:");
  console.log("  --latest          Open the most recent log file");
  console.log("  --list            List all log files (default)");
  console.log("  --clean           Remove logs older than 30 days");
  console.log("  --slot=N          Use data slot N (default: 1)");
  console.log("  --mode=game       View game logs (default)");
  console.log("  --mode=painter    View painter logs");
  console.log("");
  console.log("Examples:");
  console.log("  node scripts/view_logs.js --latest");
  console.log("  node scripts/view_logs.js --slot=2 --mode=painter");
  console.log("  node scripts/view_logs.js --clean");
}

// Check for help
if (args.includes("--help") || args.includes("-h")) {
  showUsage();
  process.exit(0);
}

// Main logic
console.log("📊 THAUMWORLD Log Viewer");
console.log(`💾 Data slot: ${data_slot}`);
console.log(`🎨 Mode: ${mode}`);
console.log("");

if (do_clean) {
  console.log("🧹 Cleaning old logs (keeping last 30 days)...\n");
  cleanOldLogs(30);
  process.exit(0);
}

if (show_latest) {
  const latest = getLatestLog();
  if (latest) {
    console.log(`Latest log: ${latest}`);
    openLogFile(latest);
  } else {
    console.log("❌ No latest log found. Is the game running?");
  }
  process.exit(0);
}

if (show_list) {
  const logs = getLogFiles();

  if (logs.length === 0) {
    console.log("📭 No logs found.");
    console.log(
      mode === "game"
        ? "   Run the game first with: npm run launch"
        : "   Run the painter first with: npm run dev:ascii"
    );
    process.exit(0);
  }

  // Show summary
  let total_files = 0;
  let total_size = 0;
  for (const day of logs) {
    total_files += day.files.length;
    for (const file of day.files) {
      total_size += file.size;
    }
  }

  console.log(
    `📁 Found ${total_files} log files (${formatFileSize(total_size)})\n`
  );

  // Show latest
  const latest = getLatestLog();
  if (latest) {
    console.log(`📝 Latest log: ${path.basename(latest)}`);
    console.log(`   Path: ${latest}\n`);
  }

  // Show recent logs (last 3 days)
  console.log("📅 Recent logs:");
  const recent = logs.slice(0, 3);
  for (const day of recent) {
    console.log(`\n  ${formatDateForDisplay(day.date)} (${day.files.length} files):`);

    // Show main session logs only
    // FIXED: Updated regex to accept alphanumeric suffixes
    const sessions = day.files.filter((f) =>
      f.name.match(/^session_\d+_[a-z0-9]+\.log$/)
    );
    for (const file of sessions.slice(0, 3)) {
      const time = file.name.match(/session_(\d{13})/);
      let time_str = "";
      if (time) {
        const timestamp = parseInt(time[1]);
        const date = new Date(timestamp);
        time_str = date.toTimeString().split(" ")[0];
      }
      console.log(`    📄 ${time_str} - ${formatFileSize(file.size)}`);
    }

    if (day.files.length > 3) {
      console.log(`    ... and ${day.files.length - 3} more files`);
    }
  }

  console.log("\n💡 Tips:");
  console.log("   npm run logs:view -- --latest       Open latest log");
  console.log("   npm run logs:view -- --mode=painter View painter logs");
  console.log("   npm run logs:clean                  Remove old logs");
}
