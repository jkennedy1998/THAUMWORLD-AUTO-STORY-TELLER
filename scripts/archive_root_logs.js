#!/usr/bin/env node
/**
 * Archive Root-Level Logs
 * 
 * Moves old log files from project root to proper archive locations
 * in local_data/data_slot_1/logs/YYYY-MM-DD/
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { formatDateLocal } from "../dist/launcher/log_utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = process.cwd();
const dataSlot = 1;
const logsBaseDir = path.join(rootDir, "local_data", `data_slot_${dataSlot}`, "logs");

// List of log files at root that should be moved
const logFiles = [
  "vite_run.log",
  "interface_run.log", 
  "tmp_dev_logs_out.log",
  "tmp_dev_logs_err.log",
  "tmp_interface_run.log",
  "tmp_interface_err.log",
  "state_applier_test.log",
  "npc_ai_test.log",
  "npc_ai_error.log",
  "state_applier_error.log",
  "roller_test.log",
  "roller_error.log",
  "renderer_ai_test.log",
  "renderer_ai_error.log",
  "rules_lawyer_test.log",
  "rules_lawyer_error.log",
  "data_broker_test.log",
  "data_broker_error.log",
  "interpreter_ai_test.log",
  "interpreter_ai_error.log",
  "interface_program_test.log",
  "interface_program_error.log"
];

console.log("📦 Archiving root-level log files...\n");

let moved = 0;
let skipped = 0;
let errors = 0;

for (const filename of logFiles) {
  const sourcePath = path.join(rootDir, filename);
  
  // Check if file exists
  if (!fs.existsSync(sourcePath)) {
    console.log(`  ⏭️  ${filename} - not found`);
    skipped++;
    continue;
  }
  
  try {
    // Get file stats to determine date
    const stats = fs.statSync(sourcePath);
    const mtime = stats.mtime;
    const dateStr = formatDateLocal(mtime);
    
    // Create target directory
    const targetDir = path.join(logsBaseDir, dateStr);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    
    // Generate archive filename
    const timestamp = mtime.getTime();
    const safeName = filename.replace(/\.log$/, "").replace(/[^a-zA-Z0-9_-]/g, "_");
    const targetFilename = `session_${timestamp}_old_${safeName}.log`;
    const targetPath = path.join(targetDir, targetFilename);
    
    // Move file
    fs.renameSync(sourcePath, targetPath);
    console.log(`  ✅ ${filename} → logs/${dateStr}/${targetFilename}`);
    moved++;
    
  } catch (err) {
    console.log(`  ❌ ${filename} - error: ${err.message}`);
    errors++;
  }
}

console.log(`\n📊 Summary:`);
console.log(`   Moved: ${moved}`);
console.log(`   Skipped: ${skipped}`);
console.log(`   Errors: ${errors}`);

if (moved > 0) {
  console.log(`\n✅ Root-level logs archived to local_data/data_slot_${dataSlot}/logs/`);
}
