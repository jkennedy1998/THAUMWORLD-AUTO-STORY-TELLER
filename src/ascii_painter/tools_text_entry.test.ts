import { buildTextEntryCell } from './tools.js';
import type { Brush, GridCell } from './types.js';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const materialBrush: Brush = {
  char: 'A',
  rgb: { r: 10, g: 20, b: 30 },
  weight_index: 2,
  graphic: undefined,
  appearance_slots: {
    1: { kind: 'material', material_id: 'BRONZE' },
    2: { kind: 'flat_rgb', rgb: { r: 44, g: 55, b: 66 } },
  },
  materials: { 1: 'BRONZE' },
};

const emptyCell: GridCell = {
  char: ' ',
  rgb: { r: 0, g: 0, b: 0 },
  weight_index: 0,
};

const typedIntoEmpty = buildTextEntryCell(emptyCell, materialBrush, 'B');
assert(typedIntoEmpty.char === 'B', 'typing into an empty cell should set the typed glyph');
assert(!typedIntoEmpty.graphic, 'typing into an empty cell should clear graphic source');
assert(typedIntoEmpty.appearance_slots?.[1]?.kind === 'material', 'typing into an empty cell should seed brush material appearance');
assert(typedIntoEmpty.materials?.[1] === 'BRONZE', 'typing into an empty cell should seed compatibility material assignments');
assert(typedIntoEmpty.rgb.r === 10 && typedIntoEmpty.rgb.g === 20 && typedIntoEmpty.rgb.b === 30, 'typing into an empty cell should use brush rgb');
assert(typedIntoEmpty.weight_index === 2, 'typing into an empty cell should use brush weight');

const existingGraphicCell: GridCell = {
  char: ' ',
  graphic: { graphic_id: 'atlas:props.chest_closed', view_direction: 'south', weight_index: 3 },
  appearance_slots: {
    1: { kind: 'material', material_id: 'WOOD_LIVE' },
    2: { kind: 'material', material_id: 'BRONZE' },
  },
  materials: { 1: 'WOOD_LIVE', 2: 'BRONZE' },
  rgb: { r: 77, g: 88, b: 99 },
  weight_index: 3,
  render_index: 5,
};

const typedOverGraphic = buildTextEntryCell(existingGraphicCell, materialBrush, 'C', { char: true, color: false, weight: false });
assert(typedOverGraphic.char === 'C', 'typing over an occupied cell should replace the glyph');
assert(!typedOverGraphic.graphic, 'typing over a graphic cell should switch source to text');
assert(typedOverGraphic.appearance_slots?.[1]?.kind === 'material' && typedOverGraphic.appearance_slots[1].material_id === 'WOOD_LIVE', 'typing with color channel off should preserve existing appearance slots');
assert(typedOverGraphic.materials?.[2] === 'BRONZE', 'typing with color channel off should preserve compatibility material assignments');
assert(typedOverGraphic.rgb.r === 77 && typedOverGraphic.rgb.g === 88 && typedOverGraphic.rgb.b === 99, 'typing with color channel off should preserve existing rgb');
assert(typedOverGraphic.weight_index === 3, 'typing with weight channel off should preserve existing weight');
assert(typedOverGraphic.render_index === 5, 'typing over an occupied cell should preserve render index metadata');

const typedOverGraphicWithColor = buildTextEntryCell(existingGraphicCell, materialBrush, 'D');
assert(typedOverGraphicWithColor.appearance_slots?.[1]?.kind === 'material' && typedOverGraphicWithColor.appearance_slots[1].material_id === 'BRONZE', 'typing with color channel on should overwrite the default targeted appearance slot from the brush');
assert(typedOverGraphicWithColor.appearance_slots?.[2]?.kind === 'material' && typedOverGraphicWithColor.appearance_slots[2].material_id === 'BRONZE', 'typing with default slot targets should preserve untargeted existing slots');
assert(typedOverGraphicWithColor.materials?.[1] === 'BRONZE', 'typing with color channel on should sync targeted compatibility materials from the brush');
assert(typedOverGraphicWithColor.rgb.r === 10 && typedOverGraphicWithColor.rgb.g === 20 && typedOverGraphicWithColor.rgb.b === 30, 'typing with color channel on should overwrite rgb from the brush');
assert(typedOverGraphicWithColor.weight_index === 2, 'typing with weight channel on should overwrite weight from the brush');

const typedOverGraphicWithAllSlots = buildTextEntryCell(existingGraphicCell, materialBrush, 'E', { char: true, color: true, weight: true }, { slot_1: true, slot_2: true, slot_3: false });
assert(typedOverGraphicWithAllSlots.appearance_slots?.[2]?.kind === 'flat_rgb' && typedOverGraphicWithAllSlots.appearance_slots[2].rgb.r === 44, 'typing with explicit slot targets should overwrite the targeted secondary slot payload from the brush');

assert(existingGraphicCell.graphic?.graphic_id === 'atlas:props.chest_closed', 'helper should not mutate the source cell');
assert(materialBrush.appearance_slots?.[1]?.kind === 'material' && materialBrush.appearance_slots[1].material_id === 'BRONZE', 'helper should not mutate the source brush');

console.log('tools_text_entry tests passed');
