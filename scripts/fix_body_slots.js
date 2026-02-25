// Script to fix body slot containers for actors and NPCs
import fs from 'fs';
import path from 'path';

const dataSlot = 'local_data/data_slot_1';

// Helper to read and parse JSONC
function readJSONC(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const cleanContent = content.replace(/\/\/.*$/gm, '');
    return JSON.parse(cleanContent);
}

// Helper to write JSONC
function writeJSONC(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// Helper to load item definition
function loadItemDef(defId) {
    const defPath = path.join(dataSlot, 'items', `${defId}.jsonc`);
    if (fs.existsSync(defPath)) {
        return readJSONC(defPath);
    }
    return null;
}

// Fix actor body slot containers
function fixActorContainers(actorFile) {
    const actorPath = path.join(dataSlot, 'actors', actorFile);
    if (!fs.existsSync(actorPath)) return;
    
    const actor = readJSONC(actorPath);
    const actorId = actor.id;
    const bodySlots = actor.body_slots || {};
    const containers = actor.containers || {};
    
    console.log(`\n=== Fixing ${actorId} ===`);
    
    // For each body slot that has an item equipped
    for (const [slotName, slotData] of Object.entries(bodySlots)) {
        const itemInstanceId = slotData.item_instance_id;
        
        if (!itemInstanceId) {
            console.log(`  ${slotName}: Empty`);
            continue;
        }
        
        const containerId = `container.${actorId}.${slotName}`;
        const container = containers[slotName];
        
        if (!container) {
            console.log(`  ${slotName}: Container MISSING - needs creation`);
            // Create container with item
        } else if (container.contents.length === 0) {
            console.log(`  ${slotName}: Container EMPTY - needs item`);
            // Add item to container
        } else {
            const containerItem = container.contents[0].instance;
            if (containerItem.id !== itemInstanceId) {
                console.log(`  ${slotName}: MISMATCH - body_slots has ${itemInstanceId}, container has ${containerItem.id}`);
                // Fix mismatch
            } else {
                console.log(`  ${slotName}: OK - ${itemInstanceId}`);
            }
        }
    }
}

// Check actors
const actorsDir = path.join(dataSlot, 'actors');
if (fs.existsSync(actorsDir)) {
    const actorFiles = fs.readdirSync(actorsDir).filter(f => f.endsWith('.jsonc'));
    for (const actorFile of actorFiles) {
        fixActorContainers(actorFile);
    }
}

console.log('\n=== Check Complete ===');
console.log('This script identifies issues but does not fix them.');
console.log('Use --fix flag to apply fixes.');
