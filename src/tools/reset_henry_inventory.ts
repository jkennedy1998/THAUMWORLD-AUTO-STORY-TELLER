/**
 * Tool to reset Henry's inventory with fresh, unique items
 * Clears all duplicate items and generates new starter kit
 */

import { load_actor, save_actor } from "../actor_storage/store.js";
import { load_item_def } from "../item_storage/store.js";
import { create_inline_item } from "../item_instances/store.js";
import { calculate_grid_dimensions } from "../types/container.js";
import { rand_base32_rfc } from "../engine/log_store.js";
import { debug_log } from "../shared/debug.js";

const DATA_SLOT = 1;
const ACTOR_ID = "henry_actor";

/**
 * Generate a unique item instance ID
 */
function generate_unique_id(def_id: string): string {
    const random_suffix = rand_base32_rfc(8);
    return `inst_${def_id}_${random_suffix}`;
}

/**
 * Clear all items from an actor's containers and body slots
 */
function clear_actor_inventory(actor: any): void {
    debug_log("[InventoryReset] Clearing body slots...");
    
    // Clear body slots
    for (const slot_name in actor.body_slots) {
        const slot = actor.body_slots[slot_name];
        if (slot.item_instance_id) {
            debug_log(`[InventoryReset] Clearing ${slot_name}: ${slot.item_instance_id}`);
            slot.item_instance_id = null;
        }
    }
    
    // Clear all container contents
    debug_log("[InventoryReset] Clearing container contents...");
    if (actor.containers) {
        for (const container_name in actor.containers) {
            const container = actor.containers[container_name];
            if (container.contents && container.contents.length > 0) {
                debug_log(`[InventoryReset] Clearing ${container_name}: ${container.contents.length} items`);
                container.contents = [];
            }
        }
    }
    
    // Clear equipment
    if (actor.equipment) {
        actor.equipment.body_slots = {};
        actor.equipment.hand_slots = {};
    }
    
    actor.inventory = [];
    actor.equipment_weight = 0;
    actor.inventory_weight = 0;
}

/**
 * Create a container content entry with grid coordinates
 */
function create_container_entry(item_instance: any, item_def: any, grid_x: number, grid_y: number) {
    return {
        instance: item_instance,
        definition: item_def,
        grid_x,
        grid_y
    };
}

/**
 * Give Henry a fresh starter kit with unique, differentiated items
 */
async function give_starter_kit(actor: any): Promise<void> {
    debug_log("[InventoryReset] Giving Henry starter kit...");
    
    // Define starter items with different types
    const starter_items = [
        // Clothing (body slots)
        { def_id: "tunic", slot: "torso", qty: 1 },
        { def_id: "pants", slot: "leg_left", qty: 1 },  // pants occupy both legs
        { def_id: "shoes", slot: "leg_right", qty: 1 },
        { def_id: "hat", slot: "head", qty: 1 },
        
        // Weapons/Tools (hand slots)
        { def_id: "sword", slot: "hand_left", qty: 1 },
        { def_id: "torch", slot: "hand_right", qty: 1 },
    ];
    
    // Items for the sack (different types)
    const sack_items = [
        { def_id: "coin", qty: 25, name: "Gold Coins" },
        { def_id: "dagger", qty: 1, name: "Iron Dagger" },
        { def_id: "apple", qty: 3, name: "Red Apples" },
        { def_id: "waterskin", qty: 1, name: "Waterskin" },
        { def_id: "bread", qty: 2, name: "Travel Bread" },
        { def_id: "rope", qty: 1, name: "Hemp Rope" },
    ];
    
    // Equip body slot items
    for (const item_config of starter_items) {
        const item_def_result = load_item_def(DATA_SLOT, item_config.def_id);
        if (!item_def_result.ok) {
            console.error(`❌ Failed to load item def: ${item_config.def_id}`);
            continue;
        }
        
        const item_def = item_def_result.item;
        const unique_id = generate_unique_id(item_config.def_id);
        
        const item_instance = create_inline_item(
            item_config.def_id,
            item_config.qty,
            `actor.${ACTOR_ID}`,
            `container.${ACTOR_ID}.${item_config.slot}`,
            "good"
        );
        
        // Override with unique ID
        item_instance.id = unique_id;
        
        // Equip to body slot
        actor.body_slots[item_config.slot].item_instance_id = unique_id;
        
        // Add to container
        if (actor.containers[item_config.slot]) {
            actor.containers[item_config.slot].contents.push(create_container_entry(
                item_instance,
                item_def,
                0,  // grid_x
                0   // grid_y
            ));
        }
        
        debug_log(`[InventoryReset] Equipped ${item_config.def_id} (${unique_id}) to ${item_config.slot}`);
    }
    
    // Find the sack in leg_left container and add items to it
    const leg_left_container = actor.containers.leg_left;
    if (leg_left_container && leg_left_container.contents.length > 0) {
        const sack_entry = leg_left_container.contents.find(
            (entry: any) => entry.instance.def_id === "small_sack"
        );
        
        if (sack_entry && sack_entry.instance.container_data) {
            debug_log("[InventoryReset] Filling sack with items...");
            
            const sack = sack_entry.instance.container_data;
            const max_slots = sack.capacity?.max_slots || 10;
            const { cols } = calculate_grid_dimensions(max_slots);
            
            let item_idx = 0;
            for (const item_config of sack_items) {
                const item_def_result = load_item_def(DATA_SLOT, item_config.def_id);
                
                if (!item_def_result.ok) {
                    console.error(`❌ Failed to load item def: ${item_config.def_id}`);
                    continue;
                }
                
                const item_def = item_def_result.item;
                const unique_id = generate_unique_id(item_config.def_id);
                
                const item_instance = create_inline_item(
                    item_config.def_id,
                    item_config.qty,
                    `actor.${ACTOR_ID}`,
                    `item.${sack_entry.instance.id}`,
                    "good"
                );
                
                // Override with unique ID
                item_instance.id = unique_id;
                
                // Calculate grid position
                const grid_x = item_idx % cols;
                const grid_y = Math.floor(item_idx / cols);
                
                sack.contents.push(create_container_entry(
                    item_instance,
                    item_def,
                    grid_x,
                    grid_y
                ));
                
                debug_log(`[InventoryReset] Added ${item_config.def_id} (${unique_id}) to sack at grid(${grid_x},${grid_y})`);
                item_idx++;
            }
        } else {
            console.error("❌ No sack found in leg_left container!");
        }
    } else {
        console.error("❌ Leg left container is empty or missing!");
    }
}

/**
 * Main function to reset Henry's inventory
 */
async function reset_henry_inventory(): Promise<void> {
    console.log("🔄 Resetting Henry's inventory...\n");
    
    // Load Henry
    const actor_result = load_actor(DATA_SLOT, ACTOR_ID);
    if (!actor_result.ok) {
        console.error("❌ Failed to load Henry!");
        process.exit(1);
    }
    
    const actor = actor_result.actor;
    console.log(`✓ Loaded actor: ${actor.name} (${actor.id})\n`);
    
    // Clear inventory
    clear_actor_inventory(actor);
    console.log("✓ Inventory cleared\n");
    
    // Give starter kit
    await give_starter_kit(actor);
    console.log("\n✓ Starter kit equipped\n");
    
    // Save actor
    console.log("💾 Saving actor...");
    const save_result = save_actor(DATA_SLOT, ACTOR_ID, actor);
    if (!save_result) {
        console.error("❌ Failed to save Henry!");
        process.exit(1);
    }
    console.log(`✓ Saved to: ${save_result}\n`);
    
    console.log("✅ Henry's inventory reset successfully!");
    console.log("\n📦 New inventory:");
    console.log("  - Tunic (torso)");
    console.log("  - Pants (legs)");
    console.log("  - Shoes (feet)");
    console.log("  - Hat (head)");
    console.log("  - Sword (left hand)");
    console.log("  - Torch (right hand)");
    console.log("\n🎒 Sack contains:");
    console.log("  - 25 Gold Coins");
    console.log("  - Iron Dagger");
    console.log("  - 3 Red Apples");
    console.log("  - Waterskin");
    console.log("  - 2 Travel Bread");
    console.log("  - Hemp Rope");
    console.log("\n🎮 Ready to test grid inventory system!");
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    reset_henry_inventory().catch(err => {
        console.error("❌ Error:", err);
        process.exit(1);
    });
}

export { reset_henry_inventory };