import { DEFAULT_APPEARANCE_SLOT_TARGET_MASK, get_enabled_appearance_slots } from './types.js';
import { clearToolProperties, loadToolProperties, saveToolProperties } from './save_system.js';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem(key: string) {
    return store.has(key) ? store.get(key)! : null;
  },
  setItem(key: string, value: string) {
    store.set(key, String(value));
  },
  removeItem(key: string) {
    store.delete(key);
  },
};

clearToolProperties();
const defaults = loadToolProperties();
assert(defaults.left_brush_slot_targets.slot_1 === true, 'default left slot target should enable slot 1');
assert(defaults.left_brush_slot_targets.slot_2 === false && defaults.left_brush_slot_targets.slot_3 === false, 'default left slot target should disable slots 2 and 3');
assert(JSON.stringify(get_enabled_appearance_slots(DEFAULT_APPEARANCE_SLOT_TARGET_MASK)) === JSON.stringify([1]), 'default slot mask should resolve to slot 1');

saveToolProperties({
  left_brush_slot_targets: { slot_1: false, slot_2: true, slot_3: true },
  right_brush_slot_targets: { slot_1: true, slot_2: true, slot_3: false },
  left_selected_appearance: { kind: 'material', material_id: 'BRONZE' },
  right_selected_appearance: { kind: 'flat_rgb', rgb: { r: 12, g: 34, b: 56 } },
});

const reloaded = loadToolProperties();
assert(JSON.stringify(get_enabled_appearance_slots(reloaded.left_brush_slot_targets)) === JSON.stringify([2, 3]), 'saved left slot targets should persist');
assert(JSON.stringify(get_enabled_appearance_slots(reloaded.right_brush_slot_targets)) === JSON.stringify([1, 2]), 'saved right slot targets should persist');
assert(reloaded.left_selected_appearance?.kind === 'material' && reloaded.left_selected_appearance.material_id === 'BRONZE', 'saved left selected appearance should persist as material');
assert(reloaded.right_selected_appearance?.kind === 'flat_rgb' && reloaded.right_selected_appearance.rgb.r === 12 && reloaded.right_selected_appearance.rgb.g === 34 && reloaded.right_selected_appearance.rgb.b === 56, 'saved right selected appearance should persist as flat rgb');

saveToolProperties({
  left_brush_slot_targets: { slot_1: false, slot_2: false, slot_3: false },
});
const fallback = loadToolProperties();
assert(JSON.stringify(get_enabled_appearance_slots(fallback.left_brush_slot_targets)) === JSON.stringify([1]), 'empty slot selection should fall back to slot 1 at use time');

console.log('save_system_slot_targets tests passed');
