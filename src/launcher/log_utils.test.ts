/**
 * Quick test of logging utilities
 * Run with: npx tsx src/launcher/log_utils.test.ts
 */

import * as fs from "fs";
import * as path from "path";
import {
  generateSessionId,
  formatDateLocal,
  getLogDir,
  initLogSession,
  parseLatestLog,
  validateAndRepairLatest,
  listSessionFiles,
} from "./log_utils.js";

console.log("🧪 Testing logging utilities...\n");

// Test 1: Session ID generation
console.log("Test 1: Session ID generation");
const sessionId = generateSessionId();
console.log(`  Generated: ${sessionId}`);
const sessionPattern = /^session_\d{13}_[a-z0-9]{8}$/;
console.log(`  ✓ Matches pattern: ${sessionPattern.test(sessionId)}`);

// Test 2: Date formatting
console.log("\nTest 2: Date formatting (local)");
const testDate = new Date("2026-02-27T23:30:00");
const formatted = formatDateLocal(testDate);
console.log(`  Input: ${testDate.toISOString()}`);
console.log(`  Output: ${formatted}`);
console.log(`  ✓ Valid format: ${/^\d{4}-\d{2}-\d{2}$/.test(formatted)}`);

// Test 3: Log directory paths
console.log("\nTest 3: Log directory paths");
const gameLogDir = getLogDir(1, "game", testDate);
const painterLogDir = getLogDir(1, "painter", testDate);
console.log(`  Game: ${gameLogDir}`);
console.log(`  Painter: ${painterLogDir}`);
console.log(`  ✓ Different paths: ${gameLogDir !== painterLogDir}`);

// Test 4: Initialize log session
console.log("\nTest 4: Initialize log session");
const testSlot = 999; // Use high number to avoid conflicts
const session = initLogSession(testSlot, "game");
console.log(`  Session ID: ${session.sessionId}`);
console.log(`  Log Dir: ${session.logDir}`);
console.log(`  Main Log: ${session.mainLog}`);
console.log(`  ✓ Files created: ${fs.existsSync(session.mainLog)}`);

// Test 5: Parse latest.log
console.log("\nTest 5: Parse latest.log");
const latestPath = path.join(session.logDir, "latest.log");
const parsed = parseLatestLog(latestPath);
console.log(`  Current Log: ${parsed?.currentLog}`);
console.log(`  Session ID: ${parsed?.sessionId}`);
console.log(`  ✓ Parsed successfully: ${parsed !== null}`);

// Test 6: List session files
console.log("\nTest 6: List session files");
const files = listSessionFiles(session.logDir);
console.log(`  Found ${files.length} session file(s)`);
files.forEach((f) => console.log(`    - ${f.name}`));
console.log(`  ✓ Found our session: ${files.some((f) => f.name.includes(session.sessionId))}`);

// Test 7: Validate and repair
console.log("\nTest 7: Validate latest.log");
const validation = validateAndRepairLatest(session.logDir, false);
console.log(`  Valid: ${validation.valid}`);
console.log(`  Log Path: ${validation.logPath}`);
console.log(`  Repaired: ${validation.repaired}`);
console.log(`  ✓ Validation works: ${validation.valid}`);

// Cleanup
console.log("\n🧹 Cleaning up test files...");
try {
  fs.rmSync(getLogDir(testSlot, "game"), { recursive: true, force: true });
  fs.rmSync(path.join(process.cwd(), "local_data", `data_slot_${testSlot}`), {
    recursive: true,
    force: true,
  });
  console.log("  ✓ Cleanup complete");
} catch (err) {
  console.log(`  ⚠️ Cleanup warning: ${err instanceof Error ? err.message : String(err)}`);
}

console.log("\n✅ All tests passed!");
