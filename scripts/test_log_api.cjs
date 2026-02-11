#!/usr/bin/env node
/**
 * Test script to verify log API and NPC message flow
 */

const http = require('http');

const API_PORT = 8787;
const DATA_SLOT = process.argv[2] || '1';

function fetchLog() {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: API_PORT,
            path: `/api/log?slot=${DATA_SLOT}`,
            method: 'GET'
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve(parsed);
                } catch (e) {
                    reject(e);
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(5000, () => {
            req.destroy();
            reject(new Error('Timeout'));
        });
        req.end();
    });
}

async function main() {
    console.log(`Testing log API on port ${API_PORT}, data slot ${DATA_SLOT}...\n`);
    
    try {
        const data = await fetchLog();
        
        if (!data.ok) {
            console.error('API returned error:', data.error);
            process.exit(1);
        }
        
        const messages = data.messages || [];
        console.log(`✓ API responded successfully`);
        console.log(`✓ Total messages: ${messages.length}`);
        
        // Count by sender type
        const npcMessages = messages.filter(m => m.sender?.startsWith('npc.'));
        const userMessages = messages.filter(m => m.sender?.toLowerCase() === 'j');
        const systemMessages = messages.filter(m => m.sender === 'system');
        
        console.log(`\nMessage breakdown:`);
        console.log(`  - NPC messages: ${npcMessages.length}`);
        console.log(`  - User (J) messages: ${userMessages.length}`);
        console.log(`  - System messages: ${systemMessages.length}`);
        console.log(`  - Other: ${messages.length - npcMessages.length - userMessages.length - systemMessages.length}`);
        
        if (npcMessages.length > 0) {
            console.log(`\nLast 3 NPC messages:`);
            npcMessages.slice(0, 3).forEach((m, i) => {
                console.log(`  ${i + 1}. ${m.sender}: "${m.content?.substring(0, 60)}..."`);
            });
        }
        
        if (messages.length > 0) {
            console.log(`\nLast 5 messages (most recent):`);
            messages.slice(0, 5).forEach((m, i) => {
                console.log(`  ${i + 1}. [${m.sender}] "${m.content?.substring(0, 50)}..."`);
            });
        }
        
        console.log('\n✓ Test complete');
        
    } catch (err) {
        console.error('✗ Failed to fetch log:', err.message);
        console.log('\nMake sure the game is running (npm run dev)');
        process.exit(1);
    }
}

main();
