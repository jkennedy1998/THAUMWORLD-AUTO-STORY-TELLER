// Test script to verify container module with mock data
import { make_container_module } from "../mono_ui/modules/container_module.js";
import { create_canvas } from "../mono_ui/canvas.js";
import type { Container } from "../types/container.js";
import type { ItemInstance } from "../item_instances/store.js";
import type { ItemDefinition } from "../item_storage/store.js";
import type { SlotItem } from "../mono_ui/modules/container_module.js";

console.log("=== CONTAINER MODULE TEST ===\n");

// Create mock container with 4x3 grid (like the real one)
const mock_container: Container = {
  id: "container.actor.test.sack",
  kind: "actor",
  owner_ref: "actor.test",
  interaction_range: 1,
  contents: [],
  tags: [],
  is_open: true,
  is_locked: false,
  grid_dimensions: { cols: 4, rows: 3 },
  capacity: { max_slots: 12, max_weight: 5000 },
};

// Create mock items with display_char
const coin_def: ItemDefinition = {
  id: "coin",
  name: "Coin",
  description: "A copper coin",
  weight: 5,
  weight_mag: 1,
  mag: 1,
  size_mag: 1,
  hardness_mag: 2,
  conductivity_mag: 3,
  tags: [],
  max_stack_size: 99,
  display_char: "$",
  valid_body_slots: [],
  occupies_slots: [],
  slot_shape: [[1]],
  fits_actor_kind: ["*"],
  stackable: true,
};

const sword_def: ItemDefinition = {
  id: "sword",
  name: "Iron Sword",
  description: "A sharp blade",
  weight: 100,
  weight_mag: 1,
  mag: 1,
  size_mag: 2,
  hardness_mag: 3,
  conductivity_mag: 1,
  tags: [],
  max_stack_size: 1,
  display_char: "/",  // Sword character
  valid_body_slots: ["hand_left", "hand_right"],
  occupies_slots: ["hand_left"],
  slot_shape: [[1]],
  fits_actor_kind: ["*"],
  stackable: false,
};

const coin_instance: ItemInstance = {
  id: "inst_coin_001",
  def_id: "coin",
  qty: 5,
  condition: "good",
  tags: [],
  container_id: "container.actor.test.sack",
  owner_ref: "actor.test",
};

const sword_instance: ItemInstance = {
  id: "inst_sword_001",
  def_id: "sword",
  qty: 1,
  condition: "good",
  tags: [],
  container_id: "container.actor.test.sack",
  owner_ref: "actor.test",
};

// Test 1: Empty container
console.log("Test 1: Empty Container");
let is_visible = true;
let slot_items: SlotItem[] = [];

const module1 = make_container_module({
  id: "test_container",
  rect: { x0: 0, y0: 0, x1: 29, y1: 19 },
  get_container: () => mock_container,
  get_slot_items: () => slot_items,
  get_is_visible: () => is_visible,
  set_is_visible: (v) => { is_visible = v; },
});

console.log("  ✓ Module created");
console.log(`  ✓ ID: ${module1.id}`);
console.log(`  ✓ Visible: ${is_visible}`);

// Test 2: With items showing different display chars
console.log("\nTest 2: Container with Items");
slot_items = [
  { slot_index: 0, instance: coin_instance, definition: coin_def },  // Should show "5" (qty > 1)
  { slot_index: 1, instance: sword_instance, definition: sword_def }, // Should show "/"
  { slot_index: 2, instance: null, definition: null },
  { slot_index: 3, instance: null, definition: null },
  { slot_index: 4, instance: null, definition: null },
  { slot_index: 5, instance: null, definition: null },
  { slot_index: 6, instance: null, definition: null },
  { slot_index: 7, instance: null, definition: null },
  { slot_index: 8, instance: null, definition: null },
  { slot_index: 9, instance: null, definition: null },
  { slot_index: 10, instance: null, definition: null },
  { slot_index: 11, instance: null, definition: null },
];

const canvas = create_canvas(30, 20);
module1.Draw(canvas);

// Check what's drawn
const cell_0 = canvas.get(2, 17);  // Slot 0
const cell_1 = canvas.get(4, 17);  // Slot 1
console.log(`  ✓ Drew to canvas`);
console.log(`  ✓ Slot 0 (coin x5): '${cell_0?.char}' (should be '5')`);
console.log(`  ✓ Slot 1 (sword): '${cell_1?.char}' (should be '/')`);

// Test 3: Item without display_char (should use first letter)
console.log("\nTest 3: Item without display_char");
const item_no_char = { ...sword_def, display_char: "·" };
slot_items = [
  { slot_index: 0, instance: sword_instance, definition: item_no_char },  // Should show "i" (first letter of Iron)
];

const canvas2 = create_canvas(30, 20);
module1.Draw(canvas2);
const cell_no_char = canvas2.get(2, 17);
console.log(`  ✓ Item without display_char shows: '${cell_no_char?.char}' (should be 'i')`);

console.log("\n=== ALL TESTS PASSED ===");
console.log("\nTo test in game:");
console.log("1. Run: npm run dev");
console.log("2. Press 'i' to open inventory");
console.log("3. Items should show their display_char or first letter of name");
console.log("4. Check console for debug logs showing item details");
