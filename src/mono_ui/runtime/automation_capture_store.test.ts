import { create_tool_assisted_inputs_capture_store } from './automation_capture_store.js';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const store = create_tool_assisted_inputs_capture_store();
const input = {
  x: 4,
  y: 5,
  z: 6,
  char: ' ',
  graphic: { graphic_id: 'atlas:test_rock', view_direction: 'south' as const, weight_index: 3 as const },
  appearance_slots: { 1: { kind: 'flat_rgb' as const, rgb: { r: 1, g: 2, b: 3 } } },
  materials: { 1: 'STONE_PALE' },
  rgb: { r: 1, g: 2, b: 3 },
  weight_index: 3,
  render_index: 9,
};

store.set_painter_cell('sample', input);
input.graphic.graphic_id = 'atlas:mutated_after_set';
input.appearance_slots[1]!.rgb.r = 99;
input.materials[1] = 'WOOD_DARK';

const stored = store.get_painter_cell('sample');
assert(!!stored, 'stored painter cell should exist');
assert(stored!.graphic?.graphic_id === 'atlas:test_rock', 'capture store should deep-clone graphic payload on set');
assert(stored!.appearance_slots?.[1]?.kind === 'flat_rgb' && stored!.appearance_slots[1].rgb.r === 1, 'capture store should deep-clone appearance slots on set');
assert(stored!.materials?.[1] === 'STONE_PALE', 'capture store should deep-clone materials on set');

stored!.graphic!.graphic_id = 'atlas:mutated_after_get';
stored!.appearance_slots![1]!.rgb.g = 88;
stored!.materials![1] = 'WOOD_DARK';

const reread = store.get_painter_cell('sample');
assert(reread!.graphic?.graphic_id === 'atlas:test_rock', 'capture store should deep-clone graphic payload on get');
assert(reread!.appearance_slots?.[1]?.kind === 'flat_rgb' && reread!.appearance_slots[1].rgb.g === 2, 'capture store should deep-clone appearance slots on get');
assert(reread!.materials?.[1] === 'STONE_PALE', 'capture store should deep-clone materials on get');

console.log('automation_capture_store tests passed');
