// Test script to verify body slot enhancements
import { initialize_body_slots, equip_item, unequip_item, get_equipped_item_id, is_slot_empty } from "../types/body_slots.js";

console.log("Testing Body Slot Enhancements...\n");

// Test 1: Initialize body slots
console.log("Test 1: Initialize Body Slots");
const parts = [
    { slot: "hand_left", critical: false },
    { slot: "hand_right", critical: false },
    { slot: "chest", critical: true },
    { slot: "head", critical: true },
];

const body_slots = initialize_body_slots(parts);
console.log("  ✓ Body slots initialized");
console.log(`    - HAND_LEFT: critical=${body_slots.HAND_LEFT?.critical}, empty=${is_slot_empty(body_slots, "HAND_LEFT")}`);
console.log(`    - CHEST: critical=${body_slots.CHEST?.critical}, empty=${is_slot_empty(body_slots, "CHEST")}`);
console.log(`    - All slots start with item_instance_id: ${body_slots.HAND_LEFT?.item_instance_id}`);

console.log("");

// Test 2: Equip item
console.log("Test 2: Equip Item");
const equip_result = equip_item(body_slots, "HAND_LEFT", "inst_sword_001");
if (equip_result.success) {
    console.log("  ✓ Item equipped successfully");
    console.log(`    - Slot now contains: ${get_equipped_item_id(body_slots, "HAND_LEFT")}`);
    console.log(`    - Previous item: ${equip_result.previous_item_id} (should be null)`);
} else {
    console.log("  ✗ Failed to equip:", equip_result.error);
}

console.log("");

// Test 3: Replace equipped item
console.log("Test 3: Replace Equipped Item");
const replace_result = equip_item(body_slots, "HAND_LEFT", "inst_axe_002");
if (replace_result.success) {
    console.log("  ✓ Item replaced successfully");
    console.log(`    - Slot now contains: ${get_equipped_item_id(body_slots, "HAND_LEFT")}`);
    console.log(`    - Previous item: ${replace_result.previous_item_id} (should be inst_sword_001)`);
} else {
    console.log("  ✗ Failed to replace:", replace_result.error);
}

console.log("");

// Test 4: Unequip item
console.log("Test 4: Unequip Item");
const unequip_result = unequip_item(body_slots, "HAND_LEFT");
if (unequip_result.success) {
    console.log("  ✓ Item unequipped successfully");
    console.log(`    - Slot now empty: ${is_slot_empty(body_slots, "HAND_LEFT")}`);
    console.log(`    - Returned item: ${unequip_result.item_instance_id}`);
} else {
    console.log("  ✗ Failed to unequip:", unequip_result.error);
}

console.log("");

// Test 5: Invalid slot
console.log("Test 5: Invalid Slot Handling");
const invalid_result = equip_item(body_slots, "INVALID_SLOT", "inst_test");
if (!invalid_result.success) {
    console.log("  ✓ Invalid slot rejected correctly");
    console.log(`    - Error: ${invalid_result.error}`);
} else {
    console.log("  ✗ Should have failed for invalid slot");
}

console.log("\nAll tests completed!");
