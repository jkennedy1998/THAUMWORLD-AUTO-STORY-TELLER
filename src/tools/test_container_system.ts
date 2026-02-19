#!/usr/bin/env node
/**
 * Container System Test Script
 * 
 * Tests the container/item system with debug output
 * Usage: node dist/tools/test_container_system.js [slot_number]
 */

import { load_container, list_containers_for_owner, get_container_contents, transfer_item_between_containers } from "../container_storage/store.js";
import { load_item_instance, type ItemInstance } from "../item_instances/store.js";
import { load_item_def } from "../item_storage/store.js";

const DEFAULT_SLOT = 0;

function debug_log(section: string, message: string, data?: unknown) {
    const timestamp = new Date().toISOString().split("T")[1]?.split(".")[0] ?? "00:00:00";
    console.log(`[${timestamp}] [${section}] ${message}`);
    if (data) {
        console.log(JSON.stringify(data, null, 2));
    }
}

async function test_load_container(slot: number, container_id: string) {
    debug_log("TEST", `Loading container: ${container_id}`);
    
    const result = load_container(slot, container_id);
    if (!result.ok) {
        debug_log("ERROR", `Failed to load container: ${result.error}`);
        return false;
    }
    
    debug_log("CONTAINER", `Loaded successfully`, {
        id: result.container.id,
        kind: result.container.kind,
        owner: result.container.owner_ref,
        capacity: result.container.capacity,
        contents_count: result.container.contents.length
    });
    
    return result.container;
}

async function test_load_item_instance(slot: number, instance_id: string) {
    debug_log("TEST", `Loading item instance: ${instance_id}`);
    
    const result = load_item_instance(slot, instance_id);
    if (!result.ok) {
        debug_log("ERROR", `Failed to load item instance: ${result.error}`);
        return false;
    }
    
    // Also load the definition to get full info
    const def_result = load_item_def(slot, result.instance.def_id);
    
    debug_log("ITEM", `Loaded successfully`, {
        instance_id: result.instance.id,
        def_id: result.instance.def_id,
        name: def_result.ok ? def_result.item.name : "unknown",
        qty: result.instance.qty,
        condition: result.instance.condition,
        container: result.instance.container_id,
        owner: result.instance.owner_ref,
        tags: result.instance.tags
    });
    
    return result.instance;
}

async function test_list_containers_for_owner(slot: number, owner_ref: string) {
    debug_log("TEST", `Listing containers for owner: ${owner_ref}`);
    
    const containers = list_containers_for_owner(slot, owner_ref);
    
    debug_log("CONTAINERS", `Found ${containers.length} containers`, 
        containers.map(c => ({
            id: c.id,
            kind: c.kind,
            contents_count: c.contents.length,
            capacity: c.capacity
        }))
    );
    
    return containers;
}

async function test_get_container_contents(slot: number, container_id: string) {
    debug_log("TEST", `Getting contents of container: ${container_id}`);
    
    const contents = get_container_contents(slot, container_id);
    
    debug_log("CONTENTS", `Found ${contents.length} items`,
        contents.map(({ instance, error }) => error ? { error } : {
            instance_id: instance.id,
            def_id: instance.def_id,
            qty: instance.qty,
            condition: instance.condition
        })
    );
    
    return contents;
}

async function test_transfer_item(slot: number, item_instance_id: string, from_container: string, to_container: string) {
    debug_log("TEST", `Transferring item ${item_instance_id}`, {
        from: from_container,
        to: to_container
    });
    
    // Show state before
    const from_before = await test_get_container_contents(slot, from_container);
    const to_before = await test_get_container_contents(slot, to_container);
    
    // Perform transfer
    const result = transfer_item_between_containers(slot, item_instance_id, from_container, to_container);
    
    if (!result.ok) {
        debug_log("ERROR", `Transfer failed: ${result.error}`);
        return false;
    }
    
    debug_log("TRANSFER", `Transfer successful`);
    
    // Show state after
    const from_after = await test_get_container_contents(slot, from_container);
    const to_after = await test_get_container_contents(slot, to_container);
    
    debug_log("TRANSFER", `State change`, {
        from_before: from_before.length,
        from_after: from_after.length,
        to_before: to_before.length,
        to_after: to_after.length
    });
    
    // Verify item moved
    const item_result = load_item_instance(slot, item_instance_id);
    if (item_result.ok) {
        debug_log("VERIFY", `Item now in container: ${item_result.instance.container_id}`);
    }
    
    return true;
}

async function run_tests(slot: number) {
    console.log("\n=== Container System Tests ===\n");
    
    // Test 1: Load actor's sack
    const sack = await test_load_container(slot, "container.default_actor.sack_default");
    if (!sack) return;
    
    // Test 2: List all containers for actor
    const actor_containers = await test_list_containers_for_owner(slot, "actor.default_actor");
    
    // Test 3: Get sack contents
    const sack_contents = await test_get_container_contents(slot, "container.default_actor.sack_default");
    
    // Test 4: Load first item in detail
    const first_item = sack_contents[0];
    if (first_item && first_item.instance) {
        await test_load_item_instance(slot, first_item.instance.id);
    }
    
    // Test 5: Transfer an item from sack to hand
    if (first_item && first_item.instance) {
        const item: ItemInstance = first_item.instance;
        await test_transfer_item(
            slot,
            item.id,
            "container.default_actor.sack_default",
            "container.default_actor.hand_right"
        );
        
        // Transfer it back
        await test_transfer_item(
            slot,
            item.id,
            "container.default_actor.hand_right",
            "container.default_actor.sack_default"
        );
    }
    
    // Test 6: List NPC containers
    await test_list_containers_for_owner(slot, "npc.default_npc");
    
    console.log("\n=== All Tests Complete ===\n");
}

// Main
const slot_arg = process.argv[2];
const slot = slot_arg ? parseInt(slot_arg) || DEFAULT_SLOT : DEFAULT_SLOT;
run_tests(slot).catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
