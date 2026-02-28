#!/usr/bin/env node
/**
 * Quick script to add test items to actor's leg sack and ground
 */

import { load_container, save_container, add_item_to_container } from "../container_storage/store.js";
import { load_item_def } from "../item_storage/store.js";
import { rand_base32_rfc } from "../engine/log_store.js";
import type { ItemInstance } from "../item_instances/store.js";

const SLOT = 1;
const ACTOR_ID = "henry_actor";

function make_instance_id(): string {
    return `inst_${rand_base32_rfc(8)}`;
}

function create_item_instance(def_id: string): ItemInstance {
    return {
        id: make_instance_id(),
        def_id,
        qty: 1,
        condition: "good",
        tags: [],
        container_id: "",
        owner_ref: `actor.${ACTOR_ID}`
    };
}

async function add_item_to_leg_sack(item_def_id: string) {
    // Try to find the sack container on the leg
    const container_id = `container.${ACTOR_ID}.leg_left.garb.0`; // Sack would be in garb slot 0
    
    console.log(`Adding ${item_def_id} to ${container_id}...`);
    
    // Load container
    const container_result = load_container(SLOT, container_id);
    if (!container_result.ok) {
        console.error(`❌ Failed to load container: ${container_result.error}`);
        return false;
    }
    
    // Load item definition
    const def_result = load_item_def(SLOT, item_def_id);
    if (!def_result.ok) {
        console.error(`❌ Failed to load item def: ${def_result.error}`);
        return false;
    }
    
    // Create item instance
    const item = create_item_instance(item_def_id);
    item.container_id = container_id;
    
    // Add to container at grid position (0,0) for simplicity
    const add_result = add_item_to_container(SLOT, container_id, {
        instance: item,
        definition: def_result.item,
        grid_x: 0,
        grid_y: 0
    });
    
    if (!add_result.ok) {
        console.error(`❌ Failed to add item: ${add_result.error}`);
        return false;
    }
    
    console.log(`✓ Added ${item_def_id} (instance: ${item.id})`);
    return true;
}

async function main() {
    console.log("=== Adding Test Items to Leg Sack ===\n");
    
    // Add 5 items to leg sack (mix of armor, garb, tool)
    const leg_items = [
        "test_iron_greaves",      // ARMOR
        "test_gold_ring",         // GARB
        "test_silver_ring",       // GARB
        "test_iron_dagger",       // TOOL
        "test_torch"              // TOOL
    ];
    
    for (const item_id of leg_items) {
        await add_item_to_leg_sack(item_id);
    }
    
    console.log("\n=== Done ===");
}

main().catch(err => {
    console.error("Error:", err);
    process.exit(1);
});
