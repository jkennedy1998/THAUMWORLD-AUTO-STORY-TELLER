// Test script to verify item database extensions work
import { load_item_def } from "../item_storage/store.js";

console.log("Testing Item Database Extensions...\n");

// Test 1: Load coin (with new fields)
const coin = load_item_def(0, "coin");
if (coin.ok) {
    console.log("✓ Coin loaded successfully");
    console.log(`  - max_stack_size: ${coin.item.max_stack_size} (expected: 99)`);
    console.log(`  - display_char: ${coin.item.display_char} (expected: $)`);
    console.log(`  - fits_actor_kind: [${coin.item.fits_actor_kind.join(", ")}] (expected: [*])`);
} else {
    console.log("✗ Failed to load coin:", coin.error);
}

console.log("");

// Test 2: Load tunic (with new fields)
const tunic = load_item_def(0, "tunic");
if (tunic.ok) {
    console.log("✓ Tunic loaded successfully");
    console.log(`  - max_stack_size: ${tunic.item.max_stack_size} (expected: 1)`);
    console.log(`  - display_char: ${tunic.item.display_char} (expected: t)`);
    console.log(`  - occupies_slots: [${tunic.item.occupies_slots.join(", ")}] (expected: [chest])`);
    console.log(`  - fits_actor_kind: [${tunic.item.fits_actor_kind.join(", ")}] (expected: [naked_ape])`);
} else {
    console.log("✗ Failed to load tunic:", tunic.error);
}

console.log("");

// Test 3: Load legacy item (testing defaults)
const sack = load_item_def(0, "small_sack");
if (sack.ok) {
    console.log("✓ Small sack loaded successfully");
    console.log(`  - max_stack_size: ${sack.item.max_stack_size} (expected: 1)`);
    console.log(`  - display_char: ${sack.item.display_char} (expected: s)`);
    console.log(`  - fits_actor_kind: [${sack.item.fits_actor_kind.join(", ")}] (expected: [*])`);
} else {
    console.log("✗ Failed to load sack:", sack.error);
}

console.log("\nAll tests completed!");
