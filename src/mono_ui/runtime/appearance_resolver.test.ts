import assert from 'node:assert/strict';

import { nearest_indexed_rgb } from '../colors.js';
import {
  blend_resolved_rgb,
  resolve_appearance_slot_rgb,
  resolve_primary_cell_rgb,
} from './appearance_resolver.js';

function run(): void {
  const directRgb = { r: 12, g: 34, b: 56 };
  assert.deepEqual(resolve_primary_cell_rgb({
    rgb: { r: 200, g: 200, b: 200 },
    appearance_slots: { 1: { kind: 'flat_rgb', rgb: directRgb } },
  }), directRgb);

  assert.deepEqual(resolve_primary_cell_rgb({
    rgb: { r: 200, g: 200, b: 200 },
    appearance_slots: { 1: { kind: 'flat_rgb', rgb: directRgb } },
    rgb_policy: 'quantize_to_active_palette',
  }), nearest_indexed_rgb(directRgb));

  assert.deepEqual(resolve_appearance_slot_rgb({
    slot: 2,
    semantic_value: '2nd_lightest',
    appearance_slots: { 2: { kind: 'material', material_id: 'BRONZE' } },
    rgb_policy: 'preserve',
  }), { r: 234, g: 152, b: 39 });

  assert.deepEqual(resolve_primary_cell_rgb({
    rgb: { r: 1, g: 2, b: 3 },
    materials: { 1: 'STONE_PALE' },
    semantic_value: 'lightest',
  }), { r: 224, g: 232, b: 208 });

  assert.deepEqual(resolve_primary_cell_rgb({
    rgb: { r: 88, g: 77, b: 66 },
    appearance_slots: { 1: { kind: 'flat_rgb', rgb: { r: 9, g: 19, b: 29 } } },
    materials: { 1: 'STONE_PALE' },
  }), { r: 9, g: 19, b: 29 });

  assert.deepEqual(blend_resolved_rgb(
    { r: 10, g: 20, b: 30 },
    { r: 30, g: 40, b: 50 },
    0.5,
    'preserve',
  ), { r: 20, g: 30, b: 40 });

  console.log('appearance_resolver ok');
}

run();
