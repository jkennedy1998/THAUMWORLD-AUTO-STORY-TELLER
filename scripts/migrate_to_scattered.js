#!/usr/bin/env node
/**
 * Ground Container to Scattered Container Migration Tool
 * 
 * Migrates items from old 'container.place.<id>.ground' containers
 * to new 'container.place.<id>.scattered_<x>_<y>' containers.
 * 
 * Usage: node scripts/migrate_to_scattered.js [--slot=1] [--place=<place_id>]
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse arguments
const args = process.argv.slice(2);
const slot_arg = args.find(arg => arg.startsWith("--slot="));
const data_slot = slot_arg ? parseInt(slot_arg.split("=")[1]) : 1;
const place_arg = args.find(arg => arg.startsWith("--place="));
const specific_place = place_arg ? place_arg.split("=")[1] : null;

function get_data_slot_dir(slot) {
  return path.join(process.cwd(), "local_data", `data_slot_${slot}`);
}

function load_jsonc(filepath) {
  try {
    const content = fs.readFileSync(filepath, 'utf-8');
    // Remove comments (simple version)
    const clean = content.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    return JSON.parse(clean);
  } catch (err) {
    return null;
  }
}

function save_jsonc(filepath, data) {
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

function migrate_place(slot, place_id) {
  console.log(`\n📍 Migrating place: ${place_id}`);
  
  const data_dir = get_data_slot_dir(slot);
  const containers_dir = path.join(data_dir, "containers");
  const item_instances_dir = path.join(data_dir, "item_instances");
  const places_dir = path.join(data_dir, "places");
  
  // Load place file
  const place_file = path.join(places_dir, `${place_id}.jsonc`);
  const place = load_jsonc(place_file);
  
  if (!place) {
    console.log(`  ❌ Could not load place file: ${place_file}`);
    return { migrated: 0, errors: 1 };
  }
  
  // Load old ground container
  const ground_container_id = `container.place.${place_id}.ground`;
  const ground_container_file = path.join(containers_dir, `${ground_container_id}.jsonc`);
  const ground_container = load_jsonc(ground_container_file);
  
  if (!ground_container) {
    console.log(`  ℹ️  No ground container found: ${ground_container_id}`);
    return { migrated: 0, errors: 0 };
  }
  
  if (!ground_container.contents || ground_container.contents.length === 0) {
    console.log(`  ℹ️  Ground container is empty`);
    // Optionally delete empty container
    // fs.unlinkSync(ground_container_file);
    return { migrated: 0, errors: 0 };
  }
  
  console.log(`  📦 Found ${ground_container.contents.length} items in ground container`);
  
  // Group items by position from place.items_on_ground
  const items_by_position = new Map(); // key: "x,y", value: [{item_id, qty, name}]
  
  for (const entry of ground_container.contents) {
    const item_id = entry.item_instance_id;
    
    // Find position in place.items_on_ground
    const place_item = place.contents?.items_on_ground?.find(i => i.item_ref === item_id);
    
    if (!place_item) {
      console.log(`  ⚠️  Item ${item_id} not found in place.items_on_ground, skipping`);
      continue;
    }
    
    const pos_key = `${place_item.tile_position.x},${place_item.tile_position.y}`;
    
    if (!items_by_position.has(pos_key)) {
      items_by_position.set(pos_key, []);
    }
    
    items_by_position.get(pos_key).push({
      item_id,
      qty: place_item.quantity,
      position: place_item.tile_position
    });
  }
  
  let migrated_count = 0;
  
  // Create scattered containers for each position
  for (const [pos_key, items] of items_by_position) {
    const [x, y] = pos_key.split(',').map(Number);
    const scattered_id = `container.place.${place_id}.scattered_${x}_${y}`;
    const scattered_file = path.join(containers_dir, `${scattered_id}.jsonc`);
    
    console.log(`  📝 Creating scattered container at (${x}, ${y}) with ${items.length} items`);
    
    // Check if scattered container already exists
    let scattered = load_jsonc(scattered_file);
    
    if (!scattered) {
      // Create new scattered container
      scattered = {
        id: scattered_id,
        kind: "place",
        subtype: "scattered",
        place_id: place_id,
        position: { x, y },
        owner_ref: "system",
        interaction_range: 1,
        capacity: { max_slots: 100, max_weight: 100000 },
        contents: [],
        tags: []
      };
    }
    
    // Add items to scattered container
    for (const item of items) {
      // Check if already in container
      const exists = scattered.contents.some(e => e.item_instance_id === item.item_id);
      if (!exists) {
        scattered.contents.push({ item_instance_id: item.item_id });
        migrated_count++;
        
        // Update item instance container_id
        const item_file = path.join(item_instances_dir, `${item.item_id}.jsonc`);
        const item_data = load_jsonc(item_file);
        if (item_data) {
          item_data.container_id = scattered_id;
          save_jsonc(item_file, item_data);
          console.log(`    ✅ Migrated ${item.item_id} → ${scattered_id}`);
        }
      } else {
        console.log(`    ℹ️  ${item.item_id} already in scattered container`);
      }
    }
    
    // Save scattered container
    save_jsonc(scattered_file, scattered);
  }
  
  // Clear old ground container
  if (migrated_count > 0) {
    ground_container.contents = [];
    save_jsonc(ground_container_file, ground_container);
    console.log(`  🧹 Cleared old ground container`);
    
    // Optionally delete the empty container file
    // fs.unlinkSync(ground_container_file);
    // console.log(`  🗑️  Deleted old ground container file`);
  }
  
  return { migrated: migrated_count, errors: 0 };
}

// Main
console.log("🚀 Ground Container to Scattered Container Migration");
console.log(`💾 Data slot: ${data_slot}`);
if (specific_place) {
  console.log(`📍 Specific place: ${specific_place}`);
} else {
  console.log(`📍 All places`);
}
console.log("");

const data_dir = get_data_slot_dir(data_slot);
const containers_dir = path.join(data_dir, "containers");

// Find all ground containers
const files = fs.readdirSync(containers_dir);
const ground_containers = files.filter(f => f.includes('.ground.jsonc'));

console.log(`Found ${ground_containers.length} ground containers`);

let total_migrated = 0;
let total_errors = 0;

for (const container_file of ground_containers) {
  // Extract place_id from filename: container.place.<id>.ground.jsonc
  const match = container_file.match(/container\.place\.(.+?)\.ground\.jsonc$/);
  if (!match) continue;
  
  const place_id = match[1];
  
  // Skip if specific place requested and this isn't it
  if (specific_place && place_id !== specific_place) {
    continue;
  }
  
  const result = migrate_place(data_slot, place_id);
  total_migrated += result.migrated;
  total_errors += result.errors;
}

console.log("\n📊 Migration Summary:");
console.log(`  ✅ Migrated: ${total_migrated} items`);
console.log(`  ❌ Errors: ${total_errors}`);

if (total_migrated > 0) {
  console.log("\n⚠️  Important:");
  console.log("  - Old ground containers have been emptied but not deleted");
  console.log("  - items_on_ground in place files still reference items by position");
  console.log("  - The rendering system should now use scattered containers");
  console.log("  - Test by running the game and checking if items appear/disappear correctly");
}

process.exit(total_errors > 0 ? 1 : 0);
