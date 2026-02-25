// Script to fix the sack data by removing self-references
import fs from 'fs';
import path from 'path';

const actorPath = 'local_data/data_slot_1/actors/henry_actor.jsonc';
const legLeftPath = 'local_data/data_slot_1/containers/container.henry_actor.leg_left.jsonc';

// Read actor file
let actorData;
try {
    const content = fs.readFileSync(actorPath, 'utf8');
    // Remove comments (lines starting with //)
    const cleanContent = content.replace(/\/\/.*$/gm, '');
    actorData = JSON.parse(cleanContent);
} catch (e) {
    console.error('Error reading actor file:', e.message);
    process.exit(1);
}

// Read leg_left container file
let legLeftData;
try {
    const content = fs.readFileSync(legLeftPath, 'utf8');
    const cleanContent = content.replace(/\/\/.*$/gm, '');
    legLeftData = JSON.parse(cleanContent);
} catch (e) {
    console.error('Error reading leg_left container file:', e.message);
    process.exit(1);
}

// Function to remove self-references from container contents
function removeSelfReferences(contents, containerId) {
    if (!Array.isArray(contents)) return contents;
    
    return contents.filter(entry => {
        // Check if this entry is a self-reference (same ID as container)
        if (entry.instance && entry.instance.id === containerId) {
            console.log(`Removing self-reference: ${containerId}`);
            return false;
        }
        // Recursively clean nested container_data
        if (entry.instance && entry.instance.container_data && entry.instance.container_data.contents) {
            entry.instance.container_data.contents = removeSelfReferences(
                entry.instance.container_data.contents, 
                containerId
            );
        }
        return true;
    });
}

// Fix leg_left container
const sackEntry = legLeftData.contents.find(e => e.instance && e.instance.id === 'inst_henry_sack_001');
if (sackEntry && sackEntry.instance.container_data) {
    console.log('Fixing leg_left container...');
    sackEntry.instance.container_data.contents = removeSelfReferences(
        sackEntry.instance.container_data.contents,
        'inst_henry_sack_001'
    );
    
    // Ensure all items have correct container_id
    sackEntry.instance.container_data.contents.forEach(entry => {
        if (entry.instance) {
            entry.instance.container_id = 'item.inst_henry_sack_001';
        }
    });
}

// Save leg_left container
fs.writeFileSync(legLeftPath, JSON.stringify(legLeftData, null, 2));
console.log('Fixed leg_left container file');

// Also fix actor file containers if needed
if (actorData.containers && actorData.containers.leg_left) {
    console.log('Checking actor containers.leg_left...');
    const actorSackEntry = actorData.containers.leg_left.contents.find(
        e => e.instance && e.instance.id === 'inst_henry_sack_001'
    );
    
    if (actorSackEntry && actorSackEntry.instance.container_data) {
        console.log('Fixing actor containers.leg_left...');
        actorSackEntry.instance.container_data.contents = removeSelfReferences(
            actorSackEntry.instance.container_data.contents,
            'inst_henry_sack_001'
        );
        
        // Ensure all items have correct container_id
        actorSackEntry.instance.container_data.contents.forEach(entry => {
            if (entry.instance) {
                entry.instance.container_id = 'item.inst_henry_sack_001';
            }
        });
    }
}

// Check for leg_right too (in case sack is there)
if (actorData.containers && actorData.containers.leg_right) {
    console.log('Checking actor containers.leg_right...');
    const actorSackEntry = actorData.containers.leg_right.contents.find(
        e => e.instance && e.instance.id === 'inst_henry_sack_001'
    );
    
    if (actorSackEntry && actorSackEntry.instance.container_data) {
        console.log('Fixing actor containers.leg_right...');
        actorSackEntry.instance.container_data.contents = removeSelfReferences(
            actorSackEntry.instance.container_data.contents,
            'inst_henry_sack_001'
        );
        
        // Ensure all items have correct container_id
        actorSackEntry.instance.container_data.contents.forEach(entry => {
            if (entry.instance) {
                entry.instance.container_id = 'item.inst_henry_sack_001';
            }
        });
    }
}

// Save actor file
fs.writeFileSync(actorPath, JSON.stringify(actorData, null, 2));
console.log('Fixed actor file');

console.log('Done! Self-references removed.');
