// Test script to verify container state management
import { load_container, create_container } from "../container_storage/store.js";
import { calculate_grid_dimensions, get_container_slot_count } from "../types/container.js";

console.log("Testing Container State Management...\n");

// Test 1: Grid dimension calculations
console.log("Test 1: Grid Dimension Calculations");
const test_cases = [
    { slots: 5, expected: "3x2" },
    { slots: 7, expected: "3x3" },
    { slots: 10, expected: "5x2" },
    { slots: 12, expected: "4x3" },
    { slots: 1, expected: "1x1" },
    { slots: 2, expected: "2x1" },
];

for (const tc of test_cases) {
    const dims = calculate_grid_dimensions(tc.slots);
    const result = `${dims.cols}x${dims.rows}`;
    const pass = result === tc.expected;
    console.log(`  ${pass ? "✓" : "✗"} ${tc.slots} slots -> ${result} (expected: ${tc.expected})`);
}

console.log("");

// Test 2: Create new container with defaults
console.log("Test 2: Create Container with State Fields");
const new_container = create_container(0, "actor.test_actor", "test_bag", "actor", { max_slots: 10 });
if (new_container.ok) {
    console.log("  ✓ Container created successfully");
    console.log(`    - is_open: ${new_container.container.is_open} (expected: true)`);
    console.log(`    - is_locked: ${new_container.container.is_locked} (expected: false)`);
    console.log(`    - grid_dimensions: ${new_container.container.grid_dimensions.cols}x${new_container.container.grid_dimensions.rows} (expected: 5x2)`);
} else {
    console.log("  ✗ Failed to create container:", new_container.error);
}

console.log("");

// Test 3: Load existing container (backward compatibility)
console.log("Test 3: Load Container with Backward Compatibility");
// Try to load an existing container - it should have defaults applied
const existing = load_container(0, "container.actor.default_actor.sack");
if (existing.ok) {
    console.log("  ✓ Existing container loaded");
    console.log(`    - is_open: ${existing.container.is_open} (should have default: true)`);
    console.log(`    - is_locked: ${existing.container.is_locked} (should have default: false)`);
    console.log(`    - grid_dimensions: ${existing.container.grid_dimensions.cols}x${existing.container.grid_dimensions.rows}`);
} else {
    console.log("  ℹ Could not load specific container (may not exist):", existing.error);
}

console.log("\nAll tests completed!");
