#!/usr/bin/env node
/**
 * Cleanup script for THAUMWORLD data files
 * Removes accumulated logs and resets message stores
 */

const fs = require('fs');
const path = require('path');

const DATA_SLOT = process.argv[2] || '1';
const FULL_RESET = process.argv.includes('--full') || process.argv.includes('-f');
const DATA_DIR = path.join(__dirname, '..', 'local_data', `data_slot_${DATA_SLOT}`);

function log(msg) {
    console.log(`[CLEANUP] ${msg}`);
}

function cleanLogFile(filePath, preserveCount = 50) {
    if (!fs.existsSync(filePath)) {
        log(`File not found: ${filePath}`);
        return;
    }
    
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(content);
        
        if (!Array.isArray(data.messages)) {
            log(`No messages array in ${filePath}`);
            return;
        }
        
        const beforeCount = data.messages.length;
        if (beforeCount <= preserveCount) {
            log(`${filePath}: ${beforeCount} messages (no cleanup needed)`);
            return;
        }
        
        // Keep only the most recent messages
        data.messages = data.messages.slice(0, preserveCount);
        
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
        log(`${filePath}: cleaned ${beforeCount} → ${preserveCount} messages`);
    } catch (err) {
        log(`Error cleaning ${filePath}: ${err.message}`);
    }
}

function emptyJsonFile(filePath) {
    if (!fs.existsSync(filePath)) {
        log(`File not found: ${filePath}`);
        return;
    }
    
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(content);
        
        if (Array.isArray(data.messages)) {
            const count = data.messages.length;
            data.messages = [];
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
            log(`${filePath}: emptied ${count} messages`);
        }
    } catch (err) {
        log(`Error emptying ${filePath}: ${err.message}`);
    }
}

function cleanOldLogs(logsDir, keepDays = 2) {
    if (!fs.existsSync(logsDir)) {
        log(`Logs directory not found: ${logsDir}`);
        return;
    }
    
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - keepDays);
    
    const entries = fs.readdirSync(logsDir);
    let cleaned = 0;
    
    for (const entry of entries) {
        const entryPath = path.join(logsDir, entry);
        const stat = fs.statSync(entryPath);
        
        if (stat.isDirectory() && entry.match(/^\d{4}-\d{2}-\d{2}$/)) {
            const entryDate = new Date(entry);
            if (entryDate < cutoff) {
                fs.rmSync(entryPath, { recursive: true });
                log(`Removed old log directory: ${entry}`);
                cleaned++;
            }
        }
    }
    
    if (cleaned === 0) {
        log(`No old log directories to clean (keeping last ${keepDays} days)`);
    }
}

function main() {
    log(`Starting cleanup for data_slot_${DATA_SLOT}`);
    if (FULL_RESET) {
        log('MODE: FULL RESET - All messages will be cleared');
    }
    log(`Data directory: ${DATA_DIR}`);
    
    if (!fs.existsSync(DATA_DIR)) {
        log(`ERROR: Data directory does not exist!`);
        process.exit(1);
    }
    
    // Clean main log file
    log('\n--- Cleaning Log Files ---');
    if (FULL_RESET) {
        emptyJsonFile(path.join(DATA_DIR, 'log.jsonc'));
    } else {
        cleanLogFile(path.join(DATA_DIR, 'log.jsonc'), 50);
    }
    
    // Empty inbox and outbox
    log('\n--- Emptying Message Queues ---');
    emptyJsonFile(path.join(DATA_DIR, 'inbox.jsonc'));
    emptyJsonFile(path.join(DATA_DIR, 'outbox.jsonc'));
    
    // Clean old session logs
    log('\n--- Cleaning Session Logs ---');
    cleanOldLogs(path.join(DATA_DIR, 'logs'), 2);
    
    log('\n--- Cleanup Complete ---');
    log('You should restart the game for changes to take effect.');
}

main();
