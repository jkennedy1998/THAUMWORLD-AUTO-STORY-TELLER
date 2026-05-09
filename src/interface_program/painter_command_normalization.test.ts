import { normalize_painter_command_apply_group_voxels, normalize_painter_command_property_value, normalize_painter_command_voxel_records } from './painter_command_normalization.js';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const richGraphicVoxel = {
  x: 4,
  y: 5,
  z: 1,
  char: ' ',
  graphic: { graphic_id: 'atlas:terrain.tree', view_direction: 'west', weight_index: 3 },
  appearance_slots: { 1: { kind: 'flat_rgb', rgb: { r: 12, g: 34, b: 56 } } },
  materials: { 1: 'STONE_PALE' },
  rgb: { r: 12, g: 34, b: 56 },
  weight_index: 2,
};

const applyGroup = normalize_painter_command_apply_group_voxels([richGraphicVoxel]);
assert(applyGroup.length === 1, 'apply_group_voxels normalization should keep one voxel');
assert(applyGroup[0]!.cell.graphic?.graphic_id === 'atlas:terrain.tree', 'apply_group_voxels normalization should preserve graphic payload');
assert(applyGroup[0]!.cell.appearance_slots?.[1]?.kind === 'flat_rgb', 'apply_group_voxels normalization should preserve appearance slots');
assert(applyGroup[0]!.cell.materials?.[1] === 'STONE_PALE', 'apply_group_voxels normalization should preserve materials');
assert(applyGroup[0]!.cell.char === ' ', 'apply_group_voxels normalization should preserve graphic-only space char');

const rasterState = normalize_painter_command_voxel_records([richGraphicVoxel]);
assert(rasterState.length === 1, 'set_group_raster_state normalization should keep one voxel');
assert(rasterState[0]!.graphic?.graphic_id === 'atlas:terrain.tree', 'set_group_raster_state normalization should preserve graphic payload');
assert(rasterState[0]!.appearance_slots?.[1]?.kind === 'flat_rgb', 'set_group_raster_state normalization should preserve appearance slots');
assert(rasterState[0]!.materials?.[1] === 'STONE_PALE', 'set_group_raster_state normalization should preserve materials');

const rasterProperty = normalize_painter_command_property_value({ kind: 'raster', voxels: [richGraphicVoxel] });
assert(rasterProperty.kind === 'raster', 'raster property normalization should preserve raster kind');
if (rasterProperty.kind !== 'raster') throw new Error('expected_raster_property');
assert(rasterProperty.voxels.length === 1, 'raster property normalization should preserve voxels');
assert(rasterProperty.voxels[0]!.graphic?.graphic_id === 'atlas:terrain.tree', 'raster property normalization should preserve graphic payload');
assert(rasterProperty.voxels[0]!.appearance_slots?.[1]?.kind === 'flat_rgb', 'raster property normalization should preserve appearance slots');
assert(rasterProperty.voxels[0]!.materials?.[1] === 'STONE_PALE', 'raster property normalization should preserve materials');

const scalarProperty = normalize_painter_command_property_value({ kind: 'scalar', value: '7' });
assert(scalarProperty.kind === 'scalar' && scalarProperty.value === 7, 'scalar property normalization should preserve scalar values');

const vecProperty = normalize_painter_command_property_value({ kind: 'vec3', x: '2', y: '-1', z: '5' });
assert(vecProperty.kind === 'vec3' && vecProperty.x === 2 && vecProperty.y === -1 && vecProperty.z === 5, 'vec3 property normalization should preserve vec3 values');

console.log('painter_command_normalization tests passed');
