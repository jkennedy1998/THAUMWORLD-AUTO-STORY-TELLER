import { make_simple_tile_payload } from './payload_builders.js';
import { resolve_cell, resolve_render } from './resolver.js';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const payload = make_simple_tile_payload({
  id: 'appearance-slot-test',
  char: '#',
  graphics: { base_graphic_id: 'tile_test_wall', default_weight: 2 },
  appearance_slots: {
    1: { kind: 'material', material_id: 'STONE_PALE' },
    2: { kind: 'flat_rgb', rgb: { r: 12, g: 34, b: 56 } },
  },
  materials: { 1: 'WOOD_LIVE' },
  base_fg: { r: 200, g: 200, b: 200 },
});

const ctx = { where: 'place_tile' as const, view_direction: 'south' as const, light_mag: 1 };
const out = resolve_render(payload, ctx);
const layer = out.layers[0]!;
assert(layer.appearance_slots?.[1]?.kind === 'material', 'resolve_render should preserve authoritative appearance slots');
assert(layer.appearance_slots?.[2]?.kind === 'flat_rgb', 'resolve_render should preserve flat rgb appearance slots');
assert(layer.materials?.[1] === 'STONE_PALE', 'material appearance slots should override legacy material assignments for compatibility');

const cell = resolve_cell(payload, ctx);
assert(cell.appearance_slots?.[1]?.kind === 'material', 'resolve_cell should preserve appearance slots');
assert(cell.appearance_slots?.[2]?.kind === 'flat_rgb', 'resolve_cell should preserve flat rgb appearance slots');
assert(cell.materials?.[1] === 'STONE_PALE', 'resolve_cell should preserve derived compatibility materials');

console.log('appearance_slots_runtime tests passed');
