#!/usr/bin/env node
/**
 * Add test items to ground in two piles
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

const SLOT = 1;
const PLACE_ID = "eden_crossroads_square";

function make_instance_id(): string {
    return `inst_${rand_base32_rfc(8)}`;
}

function create_item(def_id: string): ItemInstance {
    return {
        id: make_instance_id(),
        def_id,
        qty: 1,
        condition: "good",
        tags: [],
        container_id: "",
        owner_ref: "system"
    };
}

async function add_to_ground(item_def_id: string, x: number, y: number) {
    console.log(`Adding ${item_def_id} to ground at (${x}, ${y})...`);
    
    const place_result = load_place(SLOT, PLACE_ID);
    if (!place_result.ok) {
        console.error(`❌ Failed to load place: ${place_result.error}`);
        return false;
    }

    const scattered = get_or_create_scattered_container(SLOT, PLACE_ID, x, y);
    if (!scattered.ok) {
        console.error(`❌ Failed to create container: ${scattered.error}`);
        return false;
    }

    const item = create_item(item_def_id);
    item.container_id = scattered.container.id;

    const def_result = load_item_def(SLOT, item_def_id);
    if (!def_result.ok) {
        console.error(`❌ Failed to load item def: ${def_result.error}`);
        return false;
    }

    const max_slots = scattered.container.capacity?.max_slots || scattered.container.contents.length + 1;
    const { cols } = calculate_grid_dimensions(max_slots);
    const empty_pos = find_empty_grid_position(scattered.container.contents, cols, max_slots);
    
    if (!empty_pos) {
        console.error(`❌ Container full`);
        return false;
    }

    const add_result = add_item_to_container(SLOT, scattered.container.id, {
        instance: item,
        definition: def_result.item,
        grid_x: empty_pos.x,
        grid_y: empty_pos.y
    });

    if (!add_result.ok) {
        console.error(`❌ Failed to add item: ${add_result.error}`);
        return false;
    }

    // Update place
    const place = place_result.place;
    if (!place.contents) {
        place.contents = { npcs_present: [], actors_present: [], items_on_ground: [], features: [] };
    }
    
    place.contents.items_on_ground.push({
        item_ref: item.id,
        quantity: 1,
        tile_position: { x, y }
    });

    save_place(SLOT, place);
    console.log(`✓ Added ${item_def_id}`);
    return true;
}

async function main() {
    console.log("=== Adding Test Items to Ground ===\n");
    
    // Pile 1 at (12, 12) - Armor and Garb
    console.log("-- Pile 1 at (12, 12) --");
    await add_to_ground("test_iron_helmet", 12, 12);
    await add_to_ground("test_iron_gauntlet_left", 12, 12);
    await add_to_ground("test_cloth_tunic", 12, 12);
    await add_to_ground("test_gold_ring", 12, 12);
    
    // Pile 2 at (18, 18) - Tools and more Garb
    console.log("\n-- Pile 2 at (18, 18) --");
    await add_to_ground("test_iron_dagger", 18, 18);
    await add_to_ground("test_iron_sword", 18, 18);
    await add_to_ground("test_torch", 18, 18);
    await add_to_ground("test_silver_ring", 18, 18);
    await add_to_ground("test_leather_bracelet", 18, 18);
    await add_to_ground("test_cloth_pants", 18, 18);
    await add_to_ground("test_iron_greaves", 18, 18);
    
    console.log("\n=== Done ===");
}

main().catch(err => {
    console.error("Error:", err);
    process.exit(1);
});
