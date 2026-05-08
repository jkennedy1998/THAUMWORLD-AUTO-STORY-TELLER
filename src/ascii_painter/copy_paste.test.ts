import { copyFromGrid, decodeFromSpecialFormat, encodeToSpecialFormat, pasteToGrid } from './copy_paste.js';
import { createSelectionBitmap, setSelected } from './selection.js';
import type { Grid } from './types.js';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const grid: Grid = {
  width: 3,
  height: 3,
  cells: Array.from({ length: 3 }, () =>
    Array.from({ length: 3 }, () => ({
      char: ' ',
      graphic: undefined,
      appearance_slots: undefined,
      materials: undefined,
      rgb: { r: 0, g: 0, b: 0 },
      weight_index: 0,
    }))
  ),
};

grid.cells[1]![1] = {
  char: '@',
  graphic: { graphic_id: 'tile_test', view_direction: 'south', weight_index: 2 },
  appearance_slots: { 1: { kind: 'flat_rgb', rgb: { r: 11, g: 22, b: 33 } } },
  materials: { 1: 'STONE_PALE' },
  rgb: { r: 11, g: 22, b: 33 },
  weight_index: 2,
  render_index: 5,
};

const selection = createSelectionBitmap(3, 3);
setSelected(selection, 1, 1, true);

const copied = copyFromGrid(grid, selection);
assert(copied?.cells[0]?.[0]?.graphic?.graphic_id === 'tile_test', 'copyFromGrid should preserve graphic payload');
assert(copied?.cells[0]?.[0]?.appearance_slots?.[1]?.kind === 'flat_rgb', 'copyFromGrid should preserve appearance slots');
assert(copied?.cells[0]?.[0]?.materials?.[1] === 'STONE_PALE', 'copyFromGrid should preserve materials');

const encoded = encodeToSpecialFormat(copied!);
const decoded = decodeFromSpecialFormat(encoded);
assert(decoded?.cells[0]?.[0]?.graphic?.graphic_id === 'tile_test', 'special format decode should preserve graphic payload');
assert(decoded?.cells[0]?.[0]?.appearance_slots?.[1]?.kind === 'flat_rgb', 'special format decode should preserve appearance slots');
assert(decoded?.cells[0]?.[0]?.materials?.[1] === 'STONE_PALE', 'special format decode should preserve materials');
assert(decoded?.cells[0]?.[0]?.render_index === 5, 'special format decode should preserve render_index');

const target: Grid = {
  width: 2,
  height: 2,
  cells: Array.from({ length: 2 }, () =>
    Array.from({ length: 2 }, () => ({
      char: ' ',
      graphic: undefined,
      appearance_slots: undefined,
      materials: undefined,
      rgb: { r: 0, g: 0, b: 0 },
      weight_index: 0,
    }))
  ),
};

pasteToGrid(target, decoded!, 0, 0, false);
assert(target.cells[0]![0]?.graphic?.graphic_id === 'tile_test', 'pasteToGrid should preserve graphic payload');
assert(target.cells[0]![0]?.appearance_slots?.[1]?.kind === 'flat_rgb', 'pasteToGrid should preserve appearance slots');
assert(target.cells[0]![0]?.materials?.[1] === 'STONE_PALE', 'pasteToGrid should preserve materials');

console.log('copy_paste tests passed');
