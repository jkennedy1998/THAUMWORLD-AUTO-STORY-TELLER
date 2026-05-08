import type { GridCell } from '../../ascii_painter/types.js';
import { build_raster_move_change_descriptors, type RasterMoveSourceVoxel } from './painter_canvas_module.js';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function makeCell(char: string): GridCell {
  return { char, rgb: { r: 255, g: 255, b: 255 }, weight_index: 1 };
}

function makeGraphicCell(graphic_id: string): GridCell {
  return {
    char: ' ',
    graphic: { graphic_id, view_direction: 'south', weight_index: 2 },
    appearance_slots: { 1: { kind: 'flat_rgb', rgb: { r: 12, g: 34, b: 56 } } },
    materials: { 1: 'STONE_PALE' },
    rgb: { r: 12, g: 34, b: 56 },
    weight_index: 2,
  };
}

function isEmptyCell(cell: GridCell): boolean {
  return cell.char === ' ' && !cell.graphic;
}

function key(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

function applyMove(source: RasterMoveSourceVoxel[], delta: { x: number; y: number; z: number }, occupied: Array<{ x: number; y: number; z: number; cell: GridCell }>): Map<string, GridCell> {
  const snapshot = new Map<string, GridCell>(occupied.map((entry) => [key(entry.x, entry.y, entry.z), entry.cell]));
  const changes = build_raster_move_change_descriptors(source, delta, (world) => snapshot.get(key(world.x, world.y, world.z)) ?? { char: ' ', rgb: { r: 0, g: 0, b: 0 }, weight_index: 0 });
  for (const change of changes) {
    const worldKey = key(change.world.x, change.world.y, change.world.z);
    if (isEmptyCell(change.newCell)) snapshot.delete(worldKey);
    else snapshot.set(worldKey, change.newCell);
  }
  return snapshot;
}

const identicalPair: RasterMoveSourceVoxel[] = [
  { x: 0, y: 0, z: 0, cell: makeCell('A') },
  { x: 1, y: 0, z: 0, cell: makeCell('A') },
];
const identicalMoved = applyMove(identicalPair, { x: 1, y: 0, z: 0 }, identicalPair);
assert(identicalMoved.size === 2, 'identical overlap move should keep exactly two voxels');
assert(identicalMoved.has(key(1, 0, 0)) && identicalMoved.has(key(2, 0, 0)), 'identical overlap move should shift the pair forward by one cell');
assert(!identicalMoved.has(key(0, 0, 0)), 'identical overlap move should clear the vacated source cell');

const distinctPair: RasterMoveSourceVoxel[] = [
  { x: 0, y: 0, z: 0, cell: makeCell('A') },
  { x: 1, y: 0, z: 0, cell: makeCell('B') },
];
const distinctMoved = applyMove(distinctPair, { x: 1, y: 0, z: 0 }, distinctPair);
assert(distinctMoved.get(key(1, 0, 0))?.char === 'A', 'overlap move should rewrite the overlapping destination from the source snapshot');
assert(distinctMoved.get(key(2, 0, 0))?.char === 'B', 'overlap move should place the trailing destination voxel');
assert(!distinctMoved.has(key(0, 0, 0)), 'overlap move should clear the leading source voxel');

const selectedVoxel: RasterMoveSourceVoxel[] = [
  { x: 0, y: 0, z: 0, cell: makeCell('A') },
];
const groupSnapshot = [
  selectedVoxel[0]!,
  { x: 1, y: 0, z: 0, cell: makeCell('A') },
];
const subsetMoved = applyMove(selectedVoxel, { x: 1, y: 0, z: 0 }, groupSnapshot);
assert(subsetMoved.size === 1, 'moving a selected voxel onto an identical unselected voxel should not leave duplicates');
assert(subsetMoved.has(key(1, 0, 0)), 'moving a selected voxel onto an identical unselected voxel should preserve the destination occupancy');
assert(!subsetMoved.has(key(0, 0, 0)), 'moving a selected voxel should clear the original source position');

const graphicVoxel: RasterMoveSourceVoxel[] = [
  { x: 0, y: 1, z: 0, cell: makeGraphicCell('atlas:terrain.tree') },
];
const graphicMoved = applyMove(graphicVoxel, { x: 1, y: 0, z: 0 }, graphicVoxel);
const movedGraphicCell = graphicMoved.get(key(1, 1, 0)) ?? null;
assert(graphicMoved.size === 1, 'moving a graphic-only voxel should preserve exactly one voxel');
assert(!graphicMoved.has(key(0, 1, 0)), 'moving a graphic-only voxel should clear the original source position');
assert(movedGraphicCell?.graphic?.graphic_id === 'atlas:terrain.tree', 'moving a graphic-only voxel should preserve graphic payload');
assert(movedGraphicCell?.appearance_slots?.[1]?.kind === 'flat_rgb', 'moving a graphic-only voxel should preserve appearance slots');
assert(movedGraphicCell?.materials?.[1] === 'STONE_PALE', 'moving a graphic-only voxel should preserve materials');

console.log('painter_canvas_module_move tests passed');
