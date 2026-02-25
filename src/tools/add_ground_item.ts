#!/usr/bin/env node
/**
 * Add Ground Item Tool
 * 
 * Adds an item to the ground in a specific place using scattered containers
 * Usage: node dist/tools/add_ground_item.js <place_id> <item_def_id> [qty] [x] [y] [slot]
 */

import { 
    get_or_create_scattered_container, 
    add_item_to_container
} from "../container_storage/store.js";
import { load_place, save_place } from "../place_storage/store.js";
import { load_item_def } from "../item_storage/store.js";
import { rand_base32_rfc } from "../engine/log_store.js";
import type { ItemInstance } from "../item_instances/store.js";
import { find_empty_grid_position } from "../shared/migration.js";
import { calculate_grid_dimensions } from "../types/container.js";

const DEFAULT_SLOT = 1;

/**
 * Create an inline item instance (not saved to separate file)
 * Items are created directly in container.contents arrays
 */
function make_instance_id(): string {
    return `inst_${rand_base32_rfc(8)}`;
}

function create_inline_item(
    def_id: string,
    qty: number = 1,
    owner_ref: string = "system",
    container_id: string = "",
    condition: ItemInstance["condition"] = "good"
): ItemInstance {
    return {
        id: make_instance_id(),
        def_id,
        qty: Math.max(1, qty),
        condition,
        tags: [],
        container_id,
        owner_ref
    };
}

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

    // Create the item instance (inline)
    const item = create_inline_item(
        item_def_id,
        qty,
        "system",  // Ground items are unowned
        scattered_result.container.id
    );

    console.log(`✓ Created item instance: ${item.id}`);

    // Load item definition for wrapped format
    const def_result = load_item_def(slot, item_def_id);
    if (!def_result.ok) {
        console.error(`❌ Failed to load item definition: ${def_result.error}`);
        return false;
    }

    // Find empty grid position in container
    const max_slots = scattered_result.container.capacity?.max_slots || scattered_result.container.contents.length + 1;
    const { cols } = calculate_grid_dimensions(max_slots);
    const empty_pos = find_empty_grid_position(
        scattered_result.container.contents,
        cols,
        max_slots
    );
    
    if (!empty_pos) {
        console.error(`❌ Container is full`);
        return false;
    }

    // Add item to scattered container (wrapped format with grid coordinates)
    const add_result = add_item_to_container(slot, scattered_result.container.id, {
        instance: item,
        definition: def_result.item,
        grid_x: empty_pos.x,
        grid_y: empty_pos.y
    });
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
