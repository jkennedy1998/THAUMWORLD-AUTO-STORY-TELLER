#!/usr/bin/env node
/**
 * Container System Generator
 * 
 * Generates containers and starter items for all existing actors and NPCs.
 * Run this once to bootstrap the container system.
 * 
 * Usage: npx ts-node src/tools/generate_container_system.ts [slot_number]
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import storage modules
import { 
    load_item_def, 
    ensure_item_def,
    save_item_def,
    type ItemDefinition 
} from "../item_storage/store.js";
import { 
    create_item_instance, 
    save_item_instance,
    type ItemInstance 
} from "../item_instances/store.js";
import { 
    create_container,
    add_item_to_container,
    build_container_id,
    type Container 
} from "../container_storage/store.js";
import { load_actor, ensure_actor_dir } from "../actor_storage/store.js";
import { load_npc, ensure_npc_dir } from "../npc_storage/store.js";
import { ensure_dir_exists } from "../engine/log_store.js";

const DEFAULT_SLOT = 0;

interface GenerationResult {
    actors_processed: number;
    npcs_processed: number;
    containers_created: number;
    items_created: number;
    errors: string[];
}

async function ensure_default_items_exist(slot: number): Promise<void> {
    console.log("Checking default item definitions...");
    
    const default_items = ["small_sack", "coin", "tunic", "pants", "shoes"];
    
    for (const item_id of default_items) {
        const result = ensure_item_def(slot, item_id);
        if (result.ok) {
            console.log(`  ✓ ${item_id}`);
        } else {
            console.log(`  ✗ ${item_id}: ${result.error}`);
        }
    }
}

async function generate_for_actor(slot: number, actor_id: string): Promise<{ containers: number; items: number; errors: string[] }> {
    const result = { containers: 0, items: 0, errors: [] as string[] };
    
    const actor_result = load_actor(slot, actor_id);
    if (!actor_result.ok) {
        result.errors.push(`Failed to load actor ${actor_id}: ${actor_result.error}`);
        return result;
    }
    
    const actor = actor_result.actor;
    const owner_ref = `actor.${actor_id}`;
    
    // Create default sack container
    const sack_result = create_container(
        slot,
        owner_ref,
        "sack_default",
        "actor",
        { max_slots: 10, max_weight: 5000 }
    );
    
    if (!sack_result.ok) {
        result.errors.push(`Failed to create sack for ${actor_id}: ${sack_result.error}`);
        return result;
    }
    result.containers++;
    
    // Create starter items in the sack
    // Small amount of coin
    const coin_instance = create_item_instance(slot, "coin", 10, owner_ref, sack_result.container.id);
    add_item_to_container(slot, sack_result.container.id, coin_instance.id);
    result.items++;
    
    // Basic clothing
    const clothing_items = ["tunic", "pants", "shoes"];
    for (const clothing_id of clothing_items) {
        const clothing_instance = create_item_instance(
            slot, 
            clothing_id, 
            1, 
            owner_ref, 
            sack_result.container.id
        );
        add_item_to_container(slot, sack_result.container.id, clothing_instance.id);
        result.items++;
    }
    
    // Create equipment slot containers based on body_slots
    const body_slots = actor.body_slots as Record<string, { name: string; critical?: boolean }> | undefined;
    if (body_slots) {
        for (const [slot_name, slot_info] of Object.entries(body_slots)) {
            const slot_lower = slot_name.toLowerCase();
            const equip_container_result = create_container(
                slot,
                owner_ref,
                slot_lower,
                "actor",
                { max_slots: 1, max_weight: 10000 } // Equipment slots hold one item
            );
            
            if (equip_container_result.ok) {
                result.containers++;
            }
        }
    }
    
    // Also create hand slots
    for (const hand of ["hand_left", "hand_right"]) {
        const hand_result = create_container(
            slot,
            owner_ref,
            hand,
            "actor",
            { max_slots: 1, max_weight: 5000 }
        );
        if (hand_result.ok) {
            result.containers++;
        }
    }
    
    console.log(`  ✓ Actor ${actor_id}: ${result.containers} containers, ${result.items} items`);
    return result;
}

async function generate_for_npc(slot: number, npc_id: string): Promise<{ containers: number; items: number; errors: string[] }> {
    const result = { containers: 0, items: 0, errors: [] as string[] };
    
    const npc_result = load_npc(slot, npc_id);
    if (!npc_result.ok) {
        result.errors.push(`Failed to load NPC ${npc_id}: ${npc_result.error}`);
        return result;
    }
    
    const npc = npc_result.npc;
    const owner_ref = `npc.${npc_id}`;
    
    // Create wallet container for NPC
    const wallet_result = create_container(
        slot,
        owner_ref,
        "wallet",
        "npc",
        { max_slots: 5, max_weight: 1000 }
    );
    
    if (!wallet_result.ok) {
        result.errors.push(`Failed to create wallet for ${npc_id}: ${wallet_result.error}`);
        return result;
    }
    result.containers++;
    
    // Add some coin to wallet (random amount 5-50)
    const coin_amount = Math.floor(Math.random() * 45) + 5;
    const coin_instance = create_item_instance(slot, "coin", coin_amount, owner_ref, wallet_result.container.id);
    add_item_to_container(slot, wallet_result.container.id, coin_instance.id);
    result.items++;
    
    // If NPC is a shopkeeper, create shop inventory container
    const npc_type = (npc as any).type || "";
    if (npc_type === "shopkeeper" || npc_id.includes("shop") || npc_id.includes("merchant")) {
        const shop_result = create_container(
            slot,
            owner_ref,
            "shop_inventory",
            "npc",
            { max_slots: 50, max_weight: 50000 }
        );
        if (shop_result.ok) {
            result.containers++;
        }
    }
    
    console.log(`  ✓ NPC ${npc_id}: ${result.containers} containers, ${result.items} items`);
    return result;
}

async function generate_container_system(slot: number = DEFAULT_SLOT): Promise<GenerationResult> {
    console.log(`\n=== Container System Generator (Slot ${slot}) ===\n`);
    
    const result: GenerationResult = {
        actors_processed: 0,
        npcs_processed: 0,
        containers_created: 0,
        items_created: 0,
        errors: []
    };
    
    // Ensure directories exist
    ensure_dir_exists(path.join(process.cwd(), "local_data", `data_slot_${slot}`, "item_instances"));
    ensure_dir_exists(path.join(process.cwd(), "local_data", `data_slot_${slot}`, "containers"));
    
    // Ensure default item definitions exist
    await ensure_default_items_exist(slot);
    
    console.log("\nProcessing actors...");
    const actor_dir = ensure_actor_dir(slot);
    if (fs.existsSync(actor_dir)) {
        const actor_files = fs.readdirSync(actor_dir).filter(f => f.endsWith(".jsonc"));
        for (const file of actor_files) {
            const actor_id = file.replace(".jsonc", "");
            const actor_result = await generate_for_actor(slot, actor_id);
            result.actors_processed++;
            result.containers_created += actor_result.containers;
            result.items_created += actor_result.items;
            result.errors.push(...actor_result.errors);
        }
    }
    
    console.log("\nProcessing NPCs...");
    const npc_dir = ensure_npc_dir(slot);
    if (fs.existsSync(npc_dir)) {
        const npc_files = fs.readdirSync(npc_dir).filter(f => f.endsWith(".jsonc"));
        for (const file of npc_files) {
            const npc_id = file.replace(".jsonc", "");
            const npc_result = await generate_for_npc(slot, npc_id);
            result.npcs_processed++;
            result.containers_created += npc_result.containers;
            result.items_created += npc_result.items;
            result.errors.push(...npc_result.errors);
        }
    }
    
    return result;
}

// Main execution
async function main() {
    const slot_arg = process.argv[2];
    const slot = slot_arg ? parseInt(slot_arg) || DEFAULT_SLOT : DEFAULT_SLOT;
    
    console.log("Starting container system generation...");
    
    try {
        const result = await generate_container_system(slot);
        
        console.log("\n=== Generation Complete ===");
        console.log(`Actors processed: ${result.actors_processed}`);
        console.log(`NPCs processed: ${result.npcs_processed}`);
        console.log(`Containers created: ${result.containers_created}`);
        console.log(`Items created: ${result.items_created}`);
        
        if (result.errors.length > 0) {
            console.log(`\nErrors (${result.errors.length}):`);
            result.errors.forEach(err => console.log(`  - ${err}`));
        }
        
        console.log("\n✓ Container system generation complete!");
        process.exit(0);
    } catch (error) {
        console.error("\n✗ Generation failed:", error);
        process.exit(1);
    }
}

main();
