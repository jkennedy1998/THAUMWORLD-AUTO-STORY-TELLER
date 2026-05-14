import assert from 'node:assert/strict';
import { createSelectionBitmap, isSelected, selectPolygon } from './selection.js';

function test_select_polygon_uses_shared_fill(): void {
  const bitmap = createSelectionBitmap(6, 6);
  selectPolygon(bitmap, [
    { x: 1, y: 1 },
    { x: 3, y: 1 },
    { x: 2, y: 3 },
  ]);
  assert.equal(isSelected(bitmap, 2, 2), true);
  assert.equal(isSelected(bitmap, 2, 3), true);
  assert.equal(isSelected(bitmap, 0, 0), false);
}

function main(): void {
  test_select_polygon_uses_shared_fill();
  console.log('selection tests passed');
}

main();
