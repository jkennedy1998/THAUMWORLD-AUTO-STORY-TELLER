#!/usr/bin/env node
/**
 * Place System Debug Tool
 *
 * Shows current place status for debugging
 * Usage: npx tsx scripts/debug_place.ts [--slot=1]
 */
import { load_actor } from "../src/actor_storage/store.js";
import { load_npc } from "../src/npc_storage/store.js";
import { load_place, list_all_places } from "../src/place_storage/store.js";
import { load_time } from "../src/time_system/tracker.js";
import { format_game_time } from "../src/time_system/tracker.js";
const args = process.argv.slice(2);
const slotArg = args.find(a => a.startsWith('--slot='));
const dataSlot = slotArg ? parseInt(slotArg.split('=')[1] ?? "1") : 1;
console.log(`🔍 Place System Debug - Data Slot ${dataSlot}\n`);
// Load player
const playerResult = load_actor(dataSlot, "henry_actor");
if (!playerResult.ok) {
    console.error("❌ Player not found");
    process.exit(1);
}
const player = playerResult.actor;
const playerLocation = player.location;
console.log("👤 PLAYER LOCATION:");
console.log(`   World: (${playerLocation.world_tile?.x}, ${playerLocation.world_tile?.y})`);
console.log(`   Region: (${playerLocation.region_tile?.x}, ${playerLocation.region_tile?.y})`);
console.log(`   🏛️  Place: ${playerLocation.place_id || "❌ NOT SET"}`);
console.log(`   Tile: (${playerLocation.tile?.x}, ${playerLocation.tile?.y})`);
console.log(`   Elevation: ${playerLocation.elevation ?? 0}`);
console.log();
// Load current place
if (playerLocation.place_id) {
    const placeResult = load_place(dataSlot, playerLocation.place_id);
    if (placeResult.ok) {
        const place = placeResult.place;
        console.log("📍 CURRENT PLACE:");
        console.log(`   Name: ${place.name}`);
        console.log(`   ID: ${place.id}`);
        console.log(`   Description: ${place.description?.short}`);
        console.log(`   Size: ${place.tile_grid?.width}x${place.tile_grid?.height} tiles`);
        console.log(`   Lighting: ${place.environment?.lighting}`);
        console.log(`   Terrain: ${place.environment?.terrain}`);
        console.log();
        // Show connections
        if (place.connections && place.connections.length > 0) {
            console.log("🚪 CONNECTIONS:");
            for (const conn of place.connections) {
                console.log(`   ${conn.direction} → ${conn.target_place_id} (${conn.travel_time_seconds}s)`);
            }
            console.log();
        }
        // Show NPCs present
        if (place.contents?.npcs_present && place.contents.npcs_present.length > 0) {
            console.log("👥 NPCs PRESENT:");
            for (const npc of place.contents.npcs_present) {
                console.log(`   ${npc.npc_ref} at (${npc.tile_position?.x}, ${npc.tile_position?.y}) - ${npc.activity}`);
            }
            console.log();
        }
        else {
            console.log("👥 NPCs PRESENT: None\n");
        }
    }
    else {
        console.log(`❌ Place ${playerLocation.place_id} not found!\n`);
    }
}
else {
    console.log("❌ Player has no place_id set!\n");
}
// Load game time
const gameTime = load_time(dataSlot);
if (gameTime) {
    console.log("⏰ GAME TIME:");
    console.log(`   ${format_game_time(gameTime)}`);
    console.log();
}
// List all places
const placesResult = list_all_places(dataSlot);
if (placesResult.ok) {
    console.log(`🗺️  TOTAL PLACES: ${placesResult.places.length}`);
    console.log("   " + placesResult.places.join(", "));
    console.log();
}
// Check NPC awareness
console.log("🔎 NPC AWARENESS TEST:");
const allNpcs = ["gunther", "grenda", "sister_bramble", "thorn", "whisper"];
for (const npcId of allNpcs) {
    const npcResult = load_npc(dataSlot, npcId);
    if (npcResult.ok) {
        const npcLoc = npcResult.npc.location ?? {};
        const npcPlace = npcLoc.place_id;
        const playerPlace = playerLocation.place_id;
        const canSee = npcPlace === playerPlace;
        console.log(`   ${npcId}: ${npcPlace} ${canSee ? "✅ CAN SEE" : "❌ CANNOT SEE"}`);
    }
}
console.log();
console.log("✅ Debug complete!");
//# sourceMappingURL=debug_place.js.map