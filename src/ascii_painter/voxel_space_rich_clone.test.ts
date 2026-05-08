import { addLayer, createVoxelSpace, getVoxel, setVoxel } from './voxel_space.js';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const space = createVoxelSpace(2, 2, { minZ: 0, maxZ: 1, defaultZ: 0 });
addLayer(space, 1, 'Layer 1');

const sourceCell = {
  char: ' ',
  graphic: { graphic_id: 'atlas:test_tree', view_direction: 'south' as const, weight_index: 2 as const },
  appearance_slots: { 1: { kind: 'flat_rgb' as const, rgb: { r: 10, g: 20, b: 30 } } },
  materials: { 1: 'STONE_PALE' },
  rgb: { r: 10, g: 20, b: 30 },
  weight_index: 2 as const,
};

assert(setVoxel(space, 0, 0, 0, sourceCell), 'setVoxel should succeed');
sourceCell.graphic.graphic_id = 'atlas:mutated_after_set';
sourceCell.appearance_slots[1]!.rgb.r = 99;
sourceCell.materials[1] = 'WOOD_DARK';

const storedCell = getVoxel(space, 0, 0, 0);
assert(!!storedCell, 'stored cell should be readable');
assert(storedCell!.graphic?.graphic_id === 'atlas:test_tree', 'setVoxel should deep-clone graphic payload');
assert(storedCell!.appearance_slots?.[1]?.kind === 'flat_rgb' && storedCell!.appearance_slots[1].rgb.r === 10, 'setVoxel should deep-clone appearance slots');
assert(storedCell!.materials?.[1] === 'STONE_PALE', 'setVoxel should deep-clone materials');

storedCell!.graphic!.graphic_id = 'atlas:mutated_after_get';
storedCell!.appearance_slots![1]!.rgb.g = 88;
storedCell!.materials![1] = 'WOOD_DARK';

const rereadCell = getVoxel(space, 0, 0, 0);
assert(rereadCell!.graphic?.graphic_id === 'atlas:test_tree', 'getVoxel should return a deep clone of graphic payload');
assert(rereadCell!.appearance_slots?.[1]?.kind === 'flat_rgb' && rereadCell!.appearance_slots[1].rgb.g === 20, 'getVoxel should return a deep clone of appearance slots');
assert(rereadCell!.materials?.[1] === 'STONE_PALE', 'getVoxel should return a deep clone of materials');

console.log('voxel_space_rich_clone tests passed');
