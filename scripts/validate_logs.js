#!/usr/bin/env node
/**
 * Log Validator Utility
 *
 * Validates and repairs latest.log references.
 * Can be run manually or integrated into the launcher.
 *
 * Usage: node scripts/validate_logs.js [--slot=1] [--fix] [--mode=game|painter|all]
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  getLogDir,
  formatDateLocal,
  validateAndRepairLatest,
  listLogDates,
} from "../src/launcher/log_utils.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse arguments
const args = process.argv.slice(2);
const slot_arg = args.find((arg) => arg.startsWith("--slot="));
const mode_arg = args.find((arg) => arg.startsWith("--mode="));
const data_slot = slot_arg ? parseInt(slot_arg.split("=")[1]) : 1;
const mode = mode_arg ? mode_arg.split("=")[1] : "game";
const should_fix = args.includes("--fix");
const verbose = args.includes("--verbose");

if (mode !== "game" && mode !== "painter" && mode !== "all") {
  console.error(`❌ Invalid mode: ${mode}. Use 'game', 'painter', or 'all'.`);
  process.exit(1);
}

function validateLogDir(log_dir, mode_name) {
  console.log(`\n📁 Checking ${mode_name}: ${log_dir}`);

  if (!fs.existsSync(log_dir)) {
    console.log("  ⚠️  Directory does not exist (no logs yet)");
    return { exists: false, valid: false };
  }

  const result = validateAndRepairLatest(log_dir, should_fix);

  if (!result.valid) {
    console.log("  ❌ No valid log files found");
    return { exists: true, valid: false };
  }

  if (result.repaired) {
    console.log(`  🔧 Repaired latest.log → ${path.basename(result.logPath)}`);
  } else if (result.logPath) {
    console.log(`  ✅ Valid: ${path.basename(result.logPath)}`);
  }

  return { exists: true, valid: true, logPath: result.logPath };
}

// Main
console.log("🔍 THAUMWORLD Log Validator");
console.log(`💾 Data slot: ${data_slot}`);
if (mode !== "all") {
  console.log(`🎨 Mode: ${mode}`);
}
console.log(should_fix ? "🔧 Fix mode: ENABLED" : "🔧 Fix mode: disabled (use --fix to repair)");

const modes_to_check = mode === "all" ? ["game", "painter"] : [mode];
const results = {};

for (const check_mode of modes_to_check) {
  const log_dir = getLogDir(data_slot, check_mode);
  results[check_mode] = validateLogDir(log_dir, check_mode);
}

// Summary
console.log("\n📊 Summary:");
for (const [check_mode, result] of Object.entries(results)) {
  if (!result.exists) {
    console.log(`  ⚠️  ${check_mode}: No logs directory`);
  } else if (result.valid) {
    console.log(`  ✅ ${check_mode}: ${path.basename(result.logPath)}`);
  } else {
    console.log(`  ❌ ${check_mode}: Invalid or missing logs`);
  }
}

// Show recent dates if verbose
if (verbose) {
  for (const check_mode of modes_to_check) {
    const dates = listLogDates(data_slot, check_mode);
    if (dates.length > 0) {
      console.log(`\n📅 ${check_mode} log dates:`);
      dates.slice(0, 5).forEach((date) => {
        console.log(`   ${date}`);
      });
    }
  }
}

// Exit code
const any_invalid = Object.values(results).some((r) => r.exists && !r.valid);
process.exit(any_invalid ? 1 : 0);
