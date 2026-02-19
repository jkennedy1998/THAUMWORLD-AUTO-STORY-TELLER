#!/usr/bin/env node
/**
 * Log Validator Utility
 *
 * Validates and repairs latest.log references.
 * Can be run manually or integrated into the launcher.
 *
 * Usage: node scripts/validate_logs.js [--slot=1] [--fix]
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse arguments
const args = process.argv.slice(2);
const slot_arg = args.find(arg => arg.startsWith("--slot="));
const data_slot = slot_arg ? parseInt(slot_arg.split("=")[1]) : 1;
const should_fix = args.includes("--fix");

function get_data_slot_dir(slot) {
  return path.join(process.cwd(), "local_data", `data_slot_${slot}`);
}

function format_date(date) {
  return date.toISOString().split("T")[0];
}

function find_most_recent_session(log_dir) {
  try {
    const files = fs.readdirSync(log_dir)
      .filter(f => f.startsWith("session_") && f.endsWith(".log"))
      .map(f => ({
        name: f,
        path: path.join(log_dir, f),
        mtime: fs.statSync(path.join(log_dir, f)).mtime
      }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    
    return files.length > 0 ? files[0] : null;
  } catch {
    return null;
  }
}

function validate_latest_log(log_dir) {
  const latest_path = path.join(log_dir, "latest.log");
  
  console.log(`\n📁 Checking: ${log_dir}`);
  
  // Check if latest.log exists
  if (!fs.existsSync(latest_path)) {
    console.log("  ❌ latest.log does not exist");
    return { valid: false, reason: "missing" };
  }
  
  // Read latest.log
  let content;
  try {
    content = fs.readFileSync(latest_path, "utf-8");
  } catch (err) {
    console.log(`  ❌ Cannot read latest.log: ${err.message}`);
    return { valid: false, reason: "unreadable" };
  }
  
  // Parse reference
  const match = content.match(/CURRENT_LOG=(.+)/);
  if (!match || !match[1]) {
    console.log("  ❌ latest.log is malformed (no CURRENT_LOG)");
    return { valid: false, reason: "malformed" };
  }
  
  const target_log = match[1].trim();
  const session_match = content.match(/SESSION_ID=(.+)/);
  const session_id = session_match ? session_match[1].trim() : "unknown";
  
  console.log(`  📄 Points to: ${session_id}`);
  
  // Check if target exists
  if (!fs.existsSync(target_log)) {
    console.log(`  ❌ Target file does not exist: ${target_log}`);
    return { valid: false, reason: "stale", target: target_log, session_id };
  }
  
  // Check if it's the most recent
  const most_recent = find_most_recent_session(log_dir);
  if (most_recent && most_recent.path !== target_log) {
    console.log(`  ⚠️  Not the most recent session`);
    console.log(`     latest.log: ${path.basename(target_log)}`);
    console.log(`     most recent: ${most_recent.name}`);
    return { 
      valid: true, 
      reason: "not-latest", 
      target: target_log,
      most_recent: most_recent.path,
      session_id 
    };
  }
  
  console.log("  ✅ Valid and up-to-date");
  return { valid: true, target: target_log, session_id };
}

function fix_latest_log(log_dir, target_log, session_id) {
  const latest_path = path.join(log_dir, "latest.log");
  const timestamp = new Date().toISOString();
  
  try {
    // Remove old latest.log if it exists
    try {
      fs.unlinkSync(latest_path);
    } catch {}
    
    // Write new reference
    const reference = `CURRENT_LOG=${target_log}
SESSION_ID=${session_id}
CREATED_AT=${timestamp}
VALID=true
`;
    fs.writeFileSync(latest_path, reference);
    
    console.log(`  ✅ Fixed: latest.log now points to ${session_id}`);
    return true;
  } catch (err) {
    console.log(`  ❌ Failed to fix: ${err.message}`);
    return false;
  }
}

// Main
console.log("🔍 THAUMWORLD Log Validator");
console.log(`💾 Data slot: ${data_slot}`);
console.log(should_fix ? "🔧 Fix mode: ENABLED" : "🔧 Fix mode: disabled (use --fix to repair)");

const today = format_date(new Date());
const log_dir = path.join(get_data_slot_dir(data_slot), "logs", today);

// Check if log directory exists
if (!fs.existsSync(log_dir)) {
  console.log(`\n❌ Log directory does not exist: ${log_dir}`);
  console.log("   No logs found for today.");
  process.exit(1);
}

// Validate latest.log
const result = validate_latest_log(log_dir);

// Fix if requested and needed
if (should_fix && (!result.valid || result.reason === "not-latest")) {
  console.log("\n🔧 Attempting to fix...");
  
  let target = result.target;
  let session_id = result.session_id;
  
  // If stale or not-latest, use the most recent session
  if (result.reason === "stale" || result.reason === "not-latest") {
    const most_recent = find_most_recent_session(log_dir);
    if (most_recent) {
      target = most_recent.path;
      session_id = most_recent.name.replace(".log", "");
      console.log(`  📄 Using most recent session: ${session_id}`);
    }
  }
  
  if (target && fs.existsSync(target)) {
    fix_latest_log(log_dir, target, session_id);
  } else {
    console.log("  ❌ Cannot fix: no valid session files found");
    process.exit(1);
  }
}

// Summary
console.log("\n📊 Summary:");
if (result.valid && result.reason !== "not-latest") {
  console.log("  ✅ latest.log is valid");
  console.log(`  📄 Session: ${result.session_id}`);
  process.exit(0);
} else if (result.valid && result.reason === "not-latest") {
  console.log("  ⚠️  latest.log is valid but not the most recent");
  if (!should_fix) {
    console.log("     Run with --fix to update to most recent");
  }
  process.exit(0);
} else {
  console.log(`  ❌ latest.log is invalid: ${result.reason}`);
  if (!should_fix) {
    console.log("     Run with --fix to repair");
  }
  process.exit(1);
}
