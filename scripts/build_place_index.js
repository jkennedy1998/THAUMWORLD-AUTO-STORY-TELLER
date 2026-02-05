#!/usr/bin/env node
/**
 * Build Place Entity Index
 *
 * Rebuilds the spatial index mapping places to their entities.
 * Scans all NPCs and actors, updates the index based on their locations.
 *
 * DEBUG: This is a temporary file that can be deleted/rebuilt.
 * Usage: npx tsx scripts/build_place_index.ts [--slot=1] [--force]
 */
import { rebuild_place_entity_index, purge_place_entity_index } from "../src/place_storage/entity_index.js";
const args = process.argv.slice(2);
const slotArg = args.find(a => a.startsWith('--slot='));
const dataSlot = slotArg ? parseInt(slotArg.split('=')[1] ?? "1") : 1;
const forceRebuild = args.includes('--force');
console.log(`🔧 Place Entity Index Builder - Data Slot ${dataSlot}\n`);
// Purge if force flag is set
if (forceRebuild) {
    console.log('🗑️  Force flag set - purging existing index...\n');
    const purged = purge_place_entity_index(dataSlot);
    if (!purged) {
        console.log('⚠️  Warning: Failed to purge existing index, continuing anyway...\n');
    }
}
// Rebuild the index
console.log('🔄 Scanning all NPCs and actors...\n');
const result = rebuild_place_entity_index(dataSlot);
if (result.ok && result.stats) {
    console.log('\n✅ Index build complete!\n');
    console.log('📊 Statistics:');
    console.log(`   Places indexed: ${result.stats.places}`);
    console.log(`   NPCs indexed: ${result.stats.npcs}`);
    console.log(`   Actors indexed: ${result.stats.actors}`);
    console.log(`   Total entities: ${result.stats.npcs + result.stats.actors}`);
    console.log('\n📁 Output: local_data/data_slot_${dataSlot}/place_entity_index.jsonc');
    console.log('\n💡 This index is used by the place module for fast entity lookups.');
    console.log('   The index updates automatically when entities move.');
    process.exit(0);
}
else {
    console.error('\n❌ Index build failed!');
    console.error(`   Error: ${result.error}`);
    process.exit(1);
}
//# sourceMappingURL=build_place_index.js.map