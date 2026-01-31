// Dev server launcher with shared session ID
import { execSync } from 'child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Generate session ID with timestamp and human-readable info
const timestamp = Date.now();
const randomSuffix = Math.random().toString(36).substring(2, 9);
const sessionId = `session_${timestamp}_${randomSuffix}`;
const bootTime = new Date().toISOString();

// Create session file content with metadata for debugging
const sessionFileContent = {
  session_id: sessionId,
  boot_time: bootTime,
  boot_timestamp: timestamp,
  version: 1
};

// Write session file to project root
const sessionFilePath = path.join(process.cwd(), '.session_id');
fs.writeFileSync(sessionFilePath, JSON.stringify(sessionFileContent, null, 2));

console.log(`Starting dev server with session: ${sessionId}`);
console.log(`Session file written to: ${sessionFilePath}`);
console.log(`Boot time: ${bootTime}`);

const commands = [
  'tsx src/interface_program/main.ts',
  'tsx src/interpreter_ai/main.ts',
  'tsx src/data_broker/main.ts',
  'tsx src/rules_lawyer/main.ts',
  'tsx src/renderer_ai/main.ts',
  'tsx src/roller/main.ts',
  'tsx src/state_applier/main.ts',
  'tsx src/npc_ai/main.ts',
  'vite',
  'wait-on http://localhost:5173 && electron .'
];

const concurrentlyCmd = `concurrently ${commands.map(c => `"${c}"`).join(' ')}`;

try {
  execSync(concurrentlyCmd, { 
    stdio: 'inherit',
    env: process.env 
  });
} catch (e) {
  process.exit(1);
}
