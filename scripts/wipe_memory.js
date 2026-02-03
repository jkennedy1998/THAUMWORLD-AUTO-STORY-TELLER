#!/usr/bin/env node
/**
 * Memory Wipe Script for Clean Testing
 * 
 * This script clears all working memory, conversations, and NPC memories
 * to ensure clean testing of continuity fixes.
 * 
 * Usage: node scripts/wipe_memory.js [--slot=1]
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
const slotArg = args.find(a => a.startsWith('--slot='));
const dataSlot = slotArg ? parseInt(slotArg.split('=')[1]) : 1;

const projectRoot = path.resolve(__dirname, '..');
const dataSlotDir = path.join(projectRoot, 'local_data', `data_slot_${dataSlot}`);

console.log(`🧹 Memory Wipe - Data Slot ${dataSlot}`);
console.log(`   Path: ${dataSlotDir}\n`);

if (!fs.existsSync(dataSlotDir)) {
    console.log(`✓ Data slot ${dataSlot} does not exist, nothing to wipe.`);
    process.exit(0);
}

const filesToClear = [
    // Working memory
    { path: path.join(dataSlotDir, 'working_memory.jsonc'), name: 'Working Memory' },
    
    // Conversation archives
    { path: path.join(dataSlotDir, 'conversations', 'conversation_archive.jsonc'), name: 'Conversation Archive' },
    
    // Outbox and inbox
    { path: path.join(dataSlotDir, 'outbox.jsonc'), name: 'Message Outbox' },
    { path: path.join(dataSlotDir, 'inbox.jsonc'), name: 'Message Inbox' },
    
    // Log
    { path: path.join(dataSlotDir, 'log.jsonc'), name: 'System Log' },
];

// Clear specific files
let clearedCount = 0;
for (const { path: filePath, name } of filesToClear) {
    if (fs.existsSync(filePath)) {
        try {
            // Keep the file but empty it with proper schema
            if (filePath.endsWith('working_memory.jsonc')) {
                fs.writeFileSync(filePath, JSON.stringify({
                    schema_version: 1,
                    memories: []
                }, null, 2));
            } else if (filePath.endsWith('outbox.jsonc') || filePath.endsWith('inbox.jsonc')) {
                fs.writeFileSync(filePath, JSON.stringify({
                    schema_version: 1,
                    messages: []
                }, null, 2));
            } else if (filePath.endsWith('log.jsonc')) {
                fs.writeFileSync(filePath, JSON.stringify({
                    schema_version: 1,
                    messages: []
                }, null, 2));
            } else {
                fs.unlinkSync(filePath);
            }
            console.log(`✓ Cleared: ${name}`);
            clearedCount++;
        } catch (err) {
            console.error(`✗ Failed to clear ${name}: ${err.message}`);
        }
    }
}

// Clear conversation files
const conversationsDir = path.join(dataSlotDir, 'conversations');
if (fs.existsSync(conversationsDir)) {
    try {
        const files = fs.readdirSync(conversationsDir).filter(f => f.endsWith('.jsonc') && f !== 'conversation_archive.jsonc');
        for (const file of files) {
            fs.unlinkSync(path.join(conversationsDir, file));
        }
        console.log(`✓ Cleared: ${files.length} conversation file(s)`);
        clearedCount += files.length;
    } catch (err) {
        console.error(`✗ Failed to clear conversations: ${err.message}`);
    }
}

// Clear conversation summaries
const summariesDir = path.join(dataSlotDir, 'conversation_summaries');
if (fs.existsSync(summariesDir)) {
    try {
        const files = fs.readdirSync(summariesDir).filter(f => f.endsWith('.jsonc'));
        for (const file of files) {
            fs.unlinkSync(path.join(summariesDir, file));
        }
        console.log(`✓ Cleared: ${files.length} conversation summary file(s)`);
        clearedCount += files.length;
    } catch (err) {
        console.error(`✗ Failed to clear summaries: ${err.message}`);
    }
}

// Clear NPC memories (but keep NPC sheets)
const npcMemoriesDir = path.join(dataSlotDir, 'npc_memories');
if (fs.existsSync(npcMemoriesDir)) {
    try {
        const files = fs.readdirSync(npcMemoriesDir).filter(f => f.endsWith('.jsonc'));
        for (const file of files) {
            fs.unlinkSync(path.join(npcMemoriesDir, file));
        }
        console.log(`✓ Cleared: ${files.length} NPC memory file(s)`);
        clearedCount += files.length;
    } catch (err) {
        console.error(`✗ Failed to clear NPC memories: ${err.message}`);
    }
}

// Reset NPC memory_sheet in NPC files (preserve NPC character but clear memory)
const npcsDir = path.join(dataSlotDir, 'npcs');
if (fs.existsSync(npcsDir)) {
    let npcCount = 0;
    const files = fs.readdirSync(npcsDir).filter(f => f.endsWith('.jsonc') && f !== 'default_npc.jsonc');
    
    for (const file of files) {
        try {
            const npcPath = path.join(npcsDir, file);
            const raw = fs.readFileSync(npcPath, 'utf-8');
            const npc = JSON.parse(raw);
            
            // Clear memory-related fields but preserve character
            if (npc.memory || npc.memory_sheet) {
                delete npc.memory;
                delete npc.memory_sheet;
                npcCount++;
                
                // Write back
                fs.writeFileSync(npcPath, JSON.stringify(npc, null, 2));
            }
        } catch (err) {
            console.error(`✗ Failed to reset NPC ${file}: ${err.message}`);
        }
    }
    
    if (npcCount > 0) {
        console.log(`✓ Reset memory in: ${npcCount} NPC file(s)`);
        clearedCount += npcCount;
    }
}

// Clear metrics for clean performance tracking
const metricsDir = path.join(dataSlotDir, 'metrics');
if (fs.existsSync(metricsDir)) {
    try {
        const files = fs.readdirSync(metricsDir).filter(f => f.endsWith('.jsonc'));
        for (const file of files) {
            const filePath = path.join(metricsDir, file);
            // Reset to proper MetricsFile structure with schema_version and entries array
            fs.writeFileSync(filePath, JSON.stringify({
                schema_version: 1,
                entries: []
            }, null, 2));
        }
        console.log(`✓ Cleared: ${files.length} metric file(s)`);
        clearedCount += files.length;
    } catch (err) {
        console.error(`✗ Failed to clear metrics: ${err.message}`);
    }
}

// Note: AI I/O file logging is disabled (DEBUG_LEVEL < 4), only terminal logging is active
// See src/shared/debug.ts log_ai_io_file() for details

// Clean up lock files
const lockFiles = ['outbox.jsonc.lock', 'inbox.jsonc.lock'];
for (const lockFile of lockFiles) {
    const lockPath = path.join(dataSlotDir, lockFile);
    if (fs.existsSync(lockPath)) {
        try {
            fs.unlinkSync(lockPath);
            console.log(`✓ Removed: ${lockFile}`);
        } catch (err) {
            console.error(`✗ Failed to remove ${lockFile}: ${err.message}`);
        }
    }
}

console.log(`\n✅ Memory wipe complete!`);
console.log(`   Total items cleared: ${clearedCount}`);
console.log(`\n🎮 Ready for clean continuity testing!`);
console.log(`   - Working memory is empty`);
console.log(`   - Conversations are reset`);
console.log(`   - NPC memories are cleared`);
console.log(`   - Message queues are empty`);
console.log(`\n💡 Tip: Run 'npm run dev' to start fresh testing.`);
