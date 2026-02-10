/**
 * Log Viewer Utility
 *
 * View and manage game logs.
 * Usage: node scripts/view_logs.js [--latest] [--list] [--clean] [--slot=1]
 */

import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

// Get __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse arguments
const args = process.argv.slice(2);
const show_latest = args.includes("--latest");
const show_list = args.includes("--list") || args.length === 0;
const do_clean = args.includes("--clean");
const slot_arg = args.find(arg => arg.startsWith("--slot="));
const data_slot = slot_arg ? parseInt(slot_arg.split("=")[1]) : 1;

// Get paths
const data_slot_dir = path.join(__dirname, "..", "local_data", `data_slot_${data_slot}`);
const logs_base = path.join(data_slot_dir, "logs");

function format_date(date_str) {
  const date = new Date(date_str);
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function format_file_size(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function get_log_files() {
  if (!fs.existsSync(logs_base)) {
    return [];
  }

  const result = [];
  const dates = fs.readdirSync(logs_base);

  for (const date of dates) {
    const date_dir = path.join(logs_base, date);
    const stats = fs.statSync(date_dir);

    if (stats.isDirectory()) {
      const files = fs.readdirSync(date_dir)
        .filter(f => f.endsWith(".log") && !f.startsWith("latest"))
        .map(f => {
          const file_path = path.join(date_dir, f);
          const file_stats = fs.statSync(file_path);
          return {
            name: f,
            path: file_path,
            date: date,
            size: file_stats.size,
            modified: file_stats.mtime
          };
        })
        .sort((a, b) => b.modified - a.modified);

      if (files.length > 0) {
        result.push({ date, files });
      }
    }
  }

  return result.sort((a, b) => b.date.localeCompare(a.date));
}

function get_latest_log() {
  const today = new Date().toISOString().split("T")[0];
  const today_dir = path.join(logs_base, today);

  if (!fs.existsSync(today_dir)) {
    return null;
  }

  const latest_path = path.join(today_dir, "latest.log");

  if (!fs.existsSync(latest_path)) {
    return null;
  }

  try {
    // Check if it's a symlink
    const stats = fs.lstatSync(latest_path);
    if (stats.isSymbolicLink()) {
      return fs.readlinkSync(latest_path);
    }

    // It's a reference file
    const content = fs.readFileSync(latest_path, "utf-8");
    const match = content.match(/CURRENT_LOG=(.+)/);
    if (match && match[1]) {
      return match[1].trim();
    }
  } catch (err) {
    console.error("Error reading latest log:", err.message);
  }

  return null;
}

function clean_old_logs(keep_days = 30) {
  if (!fs.existsSync(logs_base)) {
    console.log("No logs directory found.");
    return 0;
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - keep_days);
  const cutoff_str = cutoff.toISOString().split("T")[0];

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
    console.log(`\n✅ Cleaned ${removed} old log directories (${format_file_size(total_size)})`);
  } else {
    console.log("✅ No old logs to clean.");
  }

  return removed;
}

function open_log_file(file_path) {
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

// Main logic
console.log("📊 THAUMWORLD Log Viewer");
console.log(`💾 Data slot: ${data_slot}`);
console.log("");

if (do_clean) {
  console.log("🧹 Cleaning old logs (keeping last 30 days)...\n");
  clean_old_logs(30);
  process.exit(0);
}

if (show_latest) {
  const latest = get_latest_log();
  if (latest) {
    console.log(`Latest log: ${latest}`);
    open_log_file(latest);
  } else {
    console.log("❌ No latest log found. Is the game running?");
  }
  process.exit(0);
}

if (show_list) {
  const logs = get_log_files();

  if (logs.length === 0) {
    console.log("📭 No logs found.");
    console.log("   Run the game first with: npm run launch");
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

  console.log(`📁 Found ${total_files} log files (${format_file_size(total_size)})\n`);

  // Show latest
  const latest = get_latest_log();
  if (latest) {
    console.log(`📝 Latest log: ${path.basename(latest)}`);
    console.log(`   Path: ${latest}\n`);
  }

  // Show recent logs (last 3 days)
  console.log("📅 Recent logs:");
  const recent = logs.slice(0, 3);
  for (const day of recent) {
    console.log(`\n  ${format_date(day.date)} (${day.files.length} files):`);

    // Show main session logs only
    const sessions = day.files.filter(f => f.name.match(/session_\d+_\d+\.log$/));
    for (const file of sessions.slice(0, 3)) {
      const time = file.name.match(/_(\d{6})\.log$/);
      const time_str = time ? `${time[1].substring(0, 2)}:${time[1].substring(2, 4)}:${time[1].substring(4, 6)}` : "";
      console.log(`    📄 ${time_str} - ${format_file_size(file.size)}`);
    }

    if (day.files.length > 3) {
      console.log(`    ... and ${day.files.length - 3} more files`);
    }
  }

  console.log("\n💡 Tips:");
  console.log("   npm run logs:view -- --latest    Open latest log");
  console.log("   npm run logs:clean               Remove old logs");
}
