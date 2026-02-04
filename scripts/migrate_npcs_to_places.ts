#!/usr/bin/env node
/**
 * NPC Location Migration Script
 * 
 * Migrates existing NPCs to use the new place-aware location format.
 * Adds place_id field to all NPC locations.
 * 
 * Usage: npx tsx scripts/migrate_npcs_to_places.ts [--slot=1]
 */

import { load_npc, save_npc, find_npcs } from "../src/npc_storage/store.js";
import { load_region } from "../src/world_storage/store.js";
import { load_place } from "../src/place_storage/store.js";
import { get_data_slot_dir } from "../src/engine/paths.js";

const args = process.argv.slice(2);
const slotArg = args.find(a => a.startsWith('--slot='));
const dataSlot = slotArg ? parseInt(slotArg.split('=')[1] ?? "1") : 1;

console.log(`🏗️ NPC Location Migration - Data Slot ${dataSlot}\n`);

// Migration configuration: Map region_id to default place_id
const region_default_places: Record<string, string> = {
  "eden_crossroads": "eden_crossroads_square",
  "eden_whispering_woods": "eden_whispering_woods_clearing",
  "eden_stone_circle": "eden_stone_circle_center",
  "eden_commons": "eden_commons_green",
  "eden_grendas_shop": "eden_crossroads_grendas_shop"
};

// NPC to place mappings for specific NPCs
const npc_place_assignments: Record<string, string> = {
  // Eden Crossroads NPCs
  "gunther": "eden_crossroads_square",  // Gunther at the waystone
  "grenda": "eden_crossroads_grendas_shop",  // Grenda in her shop
  
  // Whispering Woods NPCs
  "sister_bramble": "eden_whispering_woods_clearing",  // Herbalist in the forest
  
  // Commons NPCs  
  "thorn": "eden_commons_green",  // Guard at the village green
  
  // Stone Circle NPCs
  "whisper": "eden_stone_circle_center",  // Mysterious entity at the stones
};

interface MigrationResult {
  npc_id: string;
  npc_name: string;
  old_location: string;
  new_place_id: string;
  status: "migrated" | "already_migrated" | "error";
  error?: string;
}

async function migrate_npc(
  slot: number,
  npc_id: string
): Promise<MigrationResult> {
  const npc_result = load_npc(slot, npc_id);
  
  if (!npc_result.ok) {
    return {
      npc_id,
      npc_name: "unknown",
      old_location: "unknown",
      new_place_id: "",
      status: "error",
      error: npc_result.error
    };
  }
  
  const npc = npc_result.npc;
  const npc_name = (npc.name as string) || npc_id;
  
  // Check current location
  const location = npc.location as Record<string, unknown> | undefined;
  
  if (!location) {
    return {
      npc_id,
      npc_name,
      old_location: "no location",
      new_place_id: "",
      status: "error",
      error: "NPC has no location field"
    };
  }
  
  // Check if already migrated
  if (location.place_id) {
    return {
      npc_id,
      npc_name,
      old_location: format_old_location(location),
      new_place_id: location.place_id as string,
      status: "already_migrated"
    };
  }
  
  // Determine which place to assign
  let place_id = npc_place_assignments[npc_id];
  
  if (!place_id) {
    // Try to derive from region coordinates
    const world_tile = location.world_tile as { x: number; y: number } | undefined;
    const region_tile = location.region_tile as { x: number; y: number } | undefined;
    
    if (world_tile && region_tile) {
      // Load region to get its ID
      const region_result = load_region(slot, `region_${world_tile.x}_${world_tile.y}_${region_tile.x}_${region_tile.y}`);
      
      if (region_result.ok) {
        const region_id = (region_result.region.id as string) || "";
        place_id = region_default_places[region_id];
      }
    }
  }
  
  if (!place_id) {
    return {
      npc_id,
      npc_name,
      old_location: format_old_location(location),
      new_place_id: "",
      status: "error",
      error: "Could not determine place_id for NPC"
    };
  }
  
  // Verify the place exists
  const place_result = load_place(slot, place_id);
  if (!place_result.ok) {
    return {
      npc_id,
      npc_name,
      old_location: format_old_location(location),
      new_place_id: place_id,
      status: "error",
      error: `Place ${place_id} does not exist`
    };
  }
  
  // Perform migration
  location.place_id = place_id;
  
  // Ensure tile exists
  if (!location.tile) {
    // Use default entry point from place
    const default_entry = place_result.place.tile_grid.default_entry;
    location.tile = { ...default_entry };
  }
  
  // Add elevation if missing
  if (typeof location.elevation !== "number") {
    location.elevation = 0;
  }
  
  // Save updated NPC
  save_npc(slot, npc_id, npc);
  
  return {
    npc_id,
    npc_name,
    old_location: format_old_location(location),
    new_place_id: place_id,
    status: "migrated"
  };
}

function format_old_location(location: Record<string, unknown>): string {
  const world = location.world_tile as { x: number; y: number } | undefined;
  const region = location.region_tile as { x: number; y: number } | undefined;
  const tile = location.tile as { x: number; y: number } | undefined;
  
  if (world && region && tile) {
    return `(${world.x},${world.y}).(${region.x},${region.y}) tile(${tile.x},${tile.y})`;
  }
  
  return "incomplete";
}

async function main() {
  console.log("Loading NPCs...\n");
  
  // Get all NPCs
  const npcs = find_npcs(dataSlot, {});
  
  if (!npcs || npcs.length === 0) {
    console.log("No NPCs found to migrate.");
    process.exit(0);
  }
  
  const npc_ids = npcs.map(n => n.id);
  console.log(`Found ${npc_ids.length} NPC(s) to migrate\n`);
  
  const results: MigrationResult[] = [];
  
  for (const npc_id of npc_ids) {
    const result = await migrate_npc(dataSlot, npc_id);
    results.push(result);
  }
  
  // Print results
  console.log("\n📊 Migration Results:\n");
  
  const migrated = results.filter(r => r.status === "migrated");
  const already_migrated = results.filter(r => r.status === "already_migrated");
  const errors = results.filter(r => r.status === "error");
  
  // Migrated
  if (migrated.length > 0) {
    console.log(`✅ Migrated (${migrated.length}):`);
    for (const r of migrated) {
      console.log(`   ${r.npc_name} (${r.npc_id})`);
      console.log(`      Old: ${r.old_location}`);
      console.log(`      New: ${r.new_place_id}`);
    }
    console.log();
  }
  
  // Already migrated
  if (already_migrated.length > 0) {
    console.log(`⏭️  Already migrated (${already_migrated.length}):`);
    for (const r of already_migrated) {
      console.log(`   ${r.npc_name} (${r.npc_id}) - ${r.new_place_id}`);
    }
    console.log();
  }
  
  // Errors
  if (errors.length > 0) {
    console.log(`❌ Errors (${errors.length}):`);
    for (const r of errors) {
      console.log(`   ${r.npc_name} (${r.npc_id})`);
      console.log(`      Error: ${r.error}`);
    }
    console.log();
  }
  
  // Summary
  console.log("📈 Summary:");
  console.log(`   Total NPCs: ${npc_ids.length}`);
  console.log(`   Migrated: ${migrated.length}`);
  console.log(`   Already migrated: ${already_migrated.length}`);
  console.log(`   Errors: ${errors.length}`);
  console.log();
  
  if (errors.length === 0) {
    console.log("✅ Migration completed successfully!");
  } else {
    console.log("⚠️  Migration completed with errors.");
    console.log("   Please review the errors above and fix them manually.");
    process.exit(1);
  }
}

main().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
