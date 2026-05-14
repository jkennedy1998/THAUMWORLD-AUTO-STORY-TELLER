import assert from 'node:assert/strict';
import { brush_rect_selection_to_world_cells, box_selection_to_world_cells, selection_bitmap_to_world_cells } from '../shared/geometry/selection_bridge.js';

function test_brush_rect_selection_to_world_cells(): void {
  const cells = brush_rect_selection_to_world_cells(5, 5, 3, 2, {
    map_point_to_world: (point, plane) => ({ x: point.x, y: point.y, z: plane }),
    point_filter: (point) => point.x >= 4 && point.x <= 6 && point.y >= 4 && point.y <= 6,
  });
  assert.equal(cells.length, 9);
  assert.deepEqual(cells[0], { x: 4, y: 4, z: 2 });
  assert.deepEqual(cells[cells.length - 1], { x: 6, y: 6, z: 2 });
}

function test_selection_bitmap_to_world_cells_with_depth_and_bounds(): void {
  const cells = selection_bitmap_to_world_cells({
    width: 3,
    height: 2,
    cells: [
      [false, true, false],
      [true, false, false],
    ],
  }, {
    depthMin: 3,
    depthMax: 4,
    map_point_to_world: (point, plane) => ({ x: point.x + 10, y: point.y + 20, z: plane }),
    bounds: { minX: 10, minY: 20, minZ: 4, maxX: 11, maxY: 21, maxZ: 4 },
  });
  assert.deepEqual(cells, [
    { x: 11, y: 20, z: 4 },
    { x: 10, y: 21, z: 4 },
  ]);
}

function test_box_selection_to_world_cells_all_depths(): void {
  const cells = box_selection_to_world_cells(
    { x: 2, y: 3, z: 4 },
    { x: 4, y: 5, z: 4 },
    {
      bounds: { minX: 0, minY: 0, minZ: 1, maxX: 9, maxY: 9, maxZ: 6 },
      axis: 'z',
      allDepths: true,
    },
  );
  assert.equal(cells.length, 3 * 3 * 6);
  assert.deepEqual(cells[0], { x: 2, y: 3, z: 1 });
  assert.deepEqual(cells[cells.length - 1], { x: 4, y: 5, z: 6 });
}

function main(): void {
  test_brush_rect_selection_to_world_cells();
  test_selection_bitmap_to_world_cells_with_depth_and_bounds();
  test_box_selection_to_world_cells_all_depths();
  console.log('geometry_selection_bridge tests passed');
}

main();
