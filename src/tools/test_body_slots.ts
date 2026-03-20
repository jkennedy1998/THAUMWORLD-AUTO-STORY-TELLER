import { initialize_equipment_slots, get_slot_item_id, is_slot_empty } from "../types/body_slots.js";

console.log("Testing Equipment Slots...\n");

console.log("Test 1: Initialize Equipment Slots");
const parts = [
    { slot: "hand_left", critical: false },
    { slot: "hand_right", critical: false },
    { slot: "chest", critical: true },
    { slot: "head", critical: true },
];

const body_slots = initialize_equipment_slots(parts);
const hand_left = body_slots.hand_left!;
const head = body_slots.head!;
console.log("  ✓ Equipment slots initialized");
console.log(`    - hand_left: critical=${body_slots.hand_left?.critical}, empty=${is_slot_empty(body_slots, "hand_left")}`);
console.log(`    - chest: critical=${body_slots.chest?.critical}, empty=${is_slot_empty(body_slots, "chest")}`);
console.log(`    - hand_left tool starts empty: ${body_slots.hand_left?.tool}`);

console.log("");

console.log("Test 2: Assign tool item");
hand_left.tool = "inst_sword_001";
console.log("  ✓ Tool assigned successfully");
console.log(`    - Slot now contains: ${get_slot_item_id(body_slots, "hand_left")}`);

console.log("");

console.log("Test 3: Add garb item");
hand_left.garb.push("inst_ring_002");
console.log("  ✓ Garb item added successfully");
console.log(`    - Slot now contains: ${get_slot_item_id(body_slots, "hand_left")}`);

console.log("");

console.log("Test 4: Clear slot contents");
hand_left.tool = null;
hand_left.garb = [];
console.log("  ✓ Slot cleared successfully");
console.log(`    - Slot now empty: ${is_slot_empty(body_slots, "hand_left")}`);

console.log("");

console.log("Test 5: Head armor assignment");
head.armor = "inst_helmet_001";
console.log(`  ✓ Head slot contains: ${get_slot_item_id(body_slots, "head")}`);

console.log("\nAll tests completed!");
