#!/usr/bin/env node
/**
 * Add Ground Item Tool
 * 
 * Adds an item to the ground in a specific place using scattered containers
 * Usage: node dist/tools/add_ground_item.js <place_id> <item_def_id> [qty] [x] [y] [slot]
 */

import { create_item_instance } from "../item_instances/store.js";
import { 
    get_or_create_scattered_container, 
    add_item_to_container
} from "../container_storage/store.js";
import { load_place, save_place } from "../place_storage/store.js";

const DEFAULT_SLOT = 1;

async function add_ground_item(
    slot: number,
    place_id: string,
    item_def_id: string,
    qty: number = 1,
    x: number = 20,
    y: number = 20
) {
    console.log(`\n=== Adding Ground Item (Scattered Container) ===`);
    console.log(`Place: ${place_id}`);
    console.log(`Position: (${x}, ${y})`);
    console.log(`Item: ${item_def_id} x${qty}\n`);

    // Load the place to verify it exists
    const place_result = load_place(slot, place_id);
    if (!place_result.ok) {
        console.error(`❌ Failed to load place: ${place_result.error}`);
        return false;
    }

    // Get or create scattered container at position
    const scattered_result = get_or_create_scattered_container(slot, place_id, x, y);

    if (!scattered_result.ok) {
        console.error(`❌ Failed to create scattered container: ${scattered_result.error}`);
        return false;
    }

    console.log(`✓ Scattered container: ${scattered_result.container.id}`);

    // Create the item instance
    const item = create_item_instance(
        slot,
        item_def_id,
        qty,
        "system",  // Ground items are unowned
        scattered_result.container.id
    );

    console.log(`✓ Created item instance: ${item.id}`);

    // Add item to scattered container
    const add_result = add_item_to_container(slot, scattered_result.container.id, item.id);
    if (!add_result.ok) {
        console.error(`❌ Failed to add item to scattered container: ${add_result.error}`);
        return false;
    }

    console.log(`✓ Added item to scattered container`);

    // Update place file items_on_ground
    const place = place_result.place;
    if (!place.contents) {
        place.contents = { npcs_present: [], actors_present: [], items_on_ground: [], features: [] };
    }
    
    // Add to items_on_ground for rendering
    place.contents.items_on_ground.push({
        item_ref: item.id,
        quantity: qty,
        tile_position: { x, y }
    });

    save_place(slot, place);
    console.log(`✓ Updated place file with item reference`);

    console.log(`\n=== Success ===`);
    console.log(`Item ${item_def_id} x${qty} is now on the ground at ${place_id}`);
    console.log(`Position: (${x}, ${y})`);
    console.log(`Container: ${scattered_result.container.id}`);
    console.log(`Item ID: ${item.id}`);

    return true;
}

// Main
async function main() {
    const place_id_arg: string | undefined = process.argv[2];
    const item_def_id_arg: string | undefined = process.argv[3];
    const qty = parseInt(process.argv[4] ?? "50") || 50;
    const x = parseInt(process.argv[5] ?? "20") || 20;
    const y = parseInt(process.argv[6] ?? "20") || 20;
    const slot = parseInt(process.argv[7] ?? "1") || DEFAULT_SLOT;

    // Ensure we have string values (not undefined)
    const place_id: string = place_id_arg || "eden_crossroads_square";
    const item_def_id: string = item_def_id_arg || "coin";

    try {
        const success = await add_ground_item(slot, place_id, item_def_id, qty, x, y);
        process.exit(success ? 0 : 1);
    } catch (err) {
        console.error("❌ Error:", err);
        process.exit(1);
    }
}

main();
