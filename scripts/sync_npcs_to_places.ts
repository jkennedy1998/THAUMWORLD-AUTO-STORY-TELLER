#!/usr/bin/env node
/**
 * Sync NPCs to Place Contents
 * 
 * Ensures all NPCs are properly registered in place contents
 * Usage: npx tsx scripts/sync_npcs_to_places.ts [--slot=1]
 */

import { load_npc, find_npcs } from "../src/npc_storage/store.js";
import { load_place, save_place } from "../src/place_storage/store.js";
import { get_npc_location } from "../src/npc_storage/location.js";

const args = process.argv.slice(2);
const slotArg = args.find(a => a.startsWith('--slot='));
const dataSlot = slotArg ? parseInt(slotArg.split('=')[1] ?? "1") : 1;

console.log(`🔄 Syncing NPCs to Place Contents - Data Slot ${dataSlot}\n`);

// Get all NPCs
const npcs = find_npcs(dataSlot, {}).filter(n => n.id !== "default_npc");
console.log(`Found ${npcs.length} NPCs\n`);

let synced = 0;
let errors = 0;

for (const npcHit of npcs) {
    const npcResult = load_npc(dataSlot, npcHit.id);
    if (!npcResult.ok) {
        console.log(`❌ Could not load ${npcHit.id}`);
        errors++;
        continue;
    }
    
    const npc = npcResult.npc;
    const location = get_npc_location(npc);
    
    if (!location?.place_id) {
        console.log(`⚠️  ${npcHit.id} has no place_id`);
        errors++;
        continue;
    }
    
    // Load place
    const placeResult = load_place(dataSlot, location.place_id);
    if (!placeResult.ok) {
        console.log(`❌ Place ${location.place_id} not found for ${npcHit.id}`);
        errors++;
        continue;
    }
    
    const place = placeResult.place;
    const npcRef = `npc.${npcHit.id}`;
    
    // Check if NPC already in place contents
    const existingIndex = place.contents.npcs_present.findIndex(
        n => n.npc_ref === npcRef
    );
    
    if (existingIndex >= 0) {
        // Update position
        place.contents.npcs_present[existingIndex] = {
            npc_ref: npcRef,
            tile_position: location.tile,
            status: "present",
            activity: "standing here"
        };
        console.log(`🔄 Updated ${npcHit.id} in ${location.place_id}`);
    } else {
        // Add to place
        place.contents.npcs_present.push({
            npc_ref: npcRef,
            tile_position: location.tile,
            status: "present",
            activity: "standing here"
        });
        console.log(`✅ Added ${npcHit.id} to ${location.place_id}`);
    }
    
    // Save place
    save_place(dataSlot, place);
    synced++;
}

console.log(`\n📊 Summary:`);
console.log(`   Synced: ${synced}`);
console.log(`   Errors: ${errors}`);
console.log(`\n✅ Sync complete!`);
