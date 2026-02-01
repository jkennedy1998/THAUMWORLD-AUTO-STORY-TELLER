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

// Clean outbox - archive old messages and keep only current + recent sessions
const dataSlotDir = path.join(process.cwd(), 'local_data', 'data_slot_1');
const outboxPath = path.join(dataSlotDir, 'outbox.jsonc');
const logPath = path.join(dataSlotDir, 'log.jsonc');

console.log(`[Cleanup] Checking outbox at: ${outboxPath}`);

if (fs.existsSync(outboxPath)) {
  try {
    const outboxContent = fs.readFileSync(outboxPath, 'utf-8');
    console.log(`[Cleanup] Read ${outboxContent.length} bytes from outbox`);
    
    // Strip JSONC comments before parsing (remove // comments and /* */ blocks)
    const strippedContent = outboxContent
      .replace(/\/\*[\s\S]*?\*\//g, '') // Remove /* */ blocks
      .replace(/\/\/.*$/gm, ''); // Remove // comments
    
    let outbox;
    try {
      outbox = JSON.parse(strippedContent);
      console.log(`[Cleanup] Successfully parsed outbox JSON`);
    } catch (parseError) {
      console.error(`[Cleanup] JSON parse error: ${parseError.message}`);
      console.log(`[Cleanup] Attempting to reset outbox...`);
      outbox = { schema_version: 1, messages: [] };
      fs.writeFileSync(outboxPath, JSON.stringify(outbox, null, 2));
      console.log(`[Cleanup] Outbox reset to empty`);
    }
    
    if (outbox.messages && Array.isArray(outbox.messages) && outbox.messages.length > 0) {
      console.log(`[Cleanup] Found ${outbox.messages.length} messages in outbox`);
      
      // Group messages by session_id
      const messagesBySession = new Map();
      const messagesWithoutSession = [];
      
      for (const msg of outbox.messages) {
        const msgSessionId = msg.meta?.session_id;
        if (msgSessionId) {
          if (!messagesBySession.has(msgSessionId)) {
            messagesBySession.set(msgSessionId, []);
          }
          messagesBySession.get(msgSessionId).push(msg);
        } else {
          messagesWithoutSession.push(msg);
        }
      }
      
      console.log(`[Cleanup] Grouped into ${messagesBySession.size} sessions + ${messagesWithoutSession.length} without session_id`);
      
      // Get unique session IDs sorted by timestamp (newest first)
      const sessionIds = Array.from(messagesBySession.keys()).sort((a, b) => {
        // Extract timestamp from session ID (format: session_<timestamp>_<random>)
        const timestampA = parseInt(a.split('_')[1] || '0');
        const timestampB = parseInt(b.split('_')[1] || '0');
        return timestampB - timestampA; // Descending order (newest first)
      });
      
      console.log(`[Cleanup] Sessions found: ${sessionIds.join(', ')}`);
      
      // Keep only last 10 sessions + current session
      const sessionsToKeep = new Set(sessionIds.slice(0, 10));
      sessionsToKeep.add(sessionId); // Always keep current session
      
      console.log(`[Cleanup] Will keep ${sessionsToKeep.size} sessions (including current)`);
      
      // Archive old messages to log.jsonc
      const messagesToArchive = [];
      const messagesToKeep = [];
      
      for (const [msgSessionId, sessionMessages] of messagesBySession) {
        if (sessionsToKeep.has(msgSessionId)) {
          messagesToKeep.push(...sessionMessages);
          console.log(`[Cleanup] Keeping session ${msgSessionId}: ${sessionMessages.length} messages`);
        } else {
          messagesToArchive.push(...sessionMessages);
          console.log(`[Cleanup] Archiving session ${msgSessionId}: ${sessionMessages.length} messages`);
        }
      }
      
      // Also keep messages without session_id (legacy) for now
      if (messagesWithoutSession.length > 0) {
        messagesToKeep.push(...messagesWithoutSession);
        console.log(`[Cleanup] Keeping ${messagesWithoutSession.length} messages without session_id`);
      }
      
      // Archive old messages if any
      if (messagesToArchive.length > 0) {
        let logContent = { schema_version: 1, messages: [] };
        if (fs.existsSync(logPath)) {
          try {
            const logFileContent = fs.readFileSync(logPath, 'utf-8');
            // Strip comments from log too
            const strippedLog = logFileContent
              .replace(/\/\*[\s\S]*?\*\//g, '')
              .replace(/\/\/.*$/gm, '');
            logContent = JSON.parse(strippedLog);
            console.log(`[Cleanup] Read existing log with ${logContent.messages?.length || 0} messages`);
          } catch (e) {
            console.log(`[Cleanup] Warning: Could not read existing log (${e.message}), creating new one`);
          }
        }
        
        // Add archived messages to log
        logContent.messages = [...messagesToArchive, ...(logContent.messages || [])];
        fs.writeFileSync(logPath, JSON.stringify(logContent, null, 2));
        console.log(`[Cleanup] Archived ${messagesToArchive.length} messages to log.jsonc`);
      }
      
      // Write cleaned outbox
      outbox.messages = messagesToKeep;
      fs.writeFileSync(outboxPath, JSON.stringify(outbox, null, 2));
      
      const archivedCount = messagesToArchive.length;
      const keptCount = messagesToKeep.length;
      const totalCount = archivedCount + keptCount;
      
      console.log(`[Cleanup] ✓ Outbox cleaned: ${archivedCount} archived, ${keptCount} kept (from ${sessionsToKeep.size} sessions), ${totalCount} total`);
    } else {
      console.log(`[Cleanup] ✓ Outbox is empty (${outbox.messages?.length || 0} messages), no cleanup needed`);
    }
  } catch (e) {
    console.error(`[Cleanup] ✗ Error cleaning outbox:`, e.message);
    console.error(`[Cleanup] Stack trace:`, e.stack);
    // Continue anyway - don't block startup
  }
} else {
  console.log(`[Cleanup] No outbox found at ${outboxPath}, skipping cleanup`);
}

const commands = [
  'tsx src/interface_program/main.ts',
  'tsx src/interpreter_ai/main.ts',
  'tsx src/data_broker/main.ts',
  'tsx src/rules_lawyer/main.ts',
  'tsx src/renderer_ai/main.ts',
  'tsx src/roller/main.ts',
  'tsx src/state_applier/main.ts',
  'tsx src/npc_ai/main.ts',
  'tsx src/turn_manager/main.ts',
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
