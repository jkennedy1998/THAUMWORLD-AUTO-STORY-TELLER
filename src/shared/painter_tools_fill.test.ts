import { cells_match_edit_channels, get_flood_fill_voxels } from './painter_tools.js';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

type Cell = {
  char: string;
  rgb: { r: number; g: number; b: number };
  weight: number;
  graphic?: { graphic_id: string; view_direction?: string; weight_index?: number };
  appearance_slots?: Record<number, { kind: string; material_id?: string; rgb?: { r: number; g: number; b: number } }>;
  materials?: Record<number, string>;
};

function key(x: number, y: number, z: number): string {
  return `${x}:${y}:${z}`;
}

const white = { r: 255, g: 255, b: 255 };
const red = { r: 255, g: 0, b: 0 };

const group = new Map<string, Cell>([
  [key(0, 0, 0), { char: 'A', rgb: white, weight: 1 }],
  [key(1, 0, 0), { char: 'A', rgb: white, weight: 1 }],
  [key(2, 0, 0), { char: 'B', rgb: white, weight: 1 }],
  [key(3, 0, 0), { char: 'A', rgb: white, weight: 1 }],
  [key(4, 1, 0), { char: 'A', rgb: red, weight: 1 }],
  [key(1, 1, 0), { char: 'A', rgb: white, weight: 2 }],
  [key(2, 2, 1), { char: 'A', rgb: white, weight: 1 }],
  [key(3, 3, 2), { char: 'A', rgb: white, weight: 1 }],
  [key(5, 0, 0), { char: ' ', rgb: { r: 10, g: 20, b: 30 }, weight: 2, graphic: { graphic_id: 'atlas:tree', view_direction: 'south', weight_index: 2 }, appearance_slots: { 1: { kind: 'flat_rgb', rgb: { r: 10, g: 20, b: 30 } } } }],
  [key(6, 0, 0), { char: ' ', rgb: { r: 10, g: 20, b: 30 }, weight: 2, graphic: { graphic_id: 'atlas:tree', view_direction: 'south', weight_index: 2 }, appearance_slots: { 1: { kind: 'flat_rgb', rgb: { r: 10, g: 20, b: 30 } } } }],
  [key(7, 0, 0), { char: ' ', rgb: { r: 10, g: 20, b: 30 }, weight: 2, graphic: { graphic_id: 'atlas:rock', view_direction: 'south', weight_index: 2 }, appearance_slots: { 1: { kind: 'flat_rgb', rgb: { r: 10, g: 20, b: 30 } } } }],
  [key(5, 1, 0), { char: ' ', rgb: { r: 222, g: 10, b: 20 }, weight: 2, graphic: { graphic_id: 'atlas:tree', view_direction: 'south', weight_index: 2 }, appearance_slots: { 1: { kind: 'flat_rgb', rgb: { r: 10, g: 20, b: 30 } } } }],
  [key(6, 1, 0), { char: ' ', rgb: { r: 10, g: 20, b: 30 }, weight: 2, graphic: { graphic_id: 'atlas:tree', view_direction: 'south', weight_index: 2 }, appearance_slots: { 1: { kind: 'flat_rgb', rgb: { r: 99, g: 88, b: 77 } } } }],
]);

const enumerate = () => Array.from(group.keys()).map((entry) => {
  const [x, y, z] = entry.split(':').map(Number);
  return { x: x!, y: y!, z: z! };
});
const sample = (world: { x: number; y: number; z: number }): Cell | null => group.get(key(world.x, world.y, world.z)) ?? null;

const connectedPlane = get_flood_fill_voxels({
  start: { x: 0, y: 0, z: 0 },
  sample,
  matches: (candidate, target) => cells_match_edit_channels(candidate, target, { char: true, color: true, weight: true }),
  enumerate_domain: enumerate,
  same_depth_only: true,
  allow_diagonal: false,
  continuous: true,
  plane_axis: 'z',
});
assert(JSON.stringify(connectedPlane) === JSON.stringify([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }]), 'connected same-plane fill should only include cardinal neighbors on the plane');

const nonContiguousPlane = get_flood_fill_voxels({
  start: { x: 0, y: 0, z: 0 },
  sample,
  matches: (candidate, target) => cells_match_edit_channels(candidate, target, { char: true, color: true, weight: true }),
  enumerate_domain: enumerate,
  same_depth_only: true,
  allow_diagonal: false,
  continuous: false,
  plane_axis: 'z',
});
assert(nonContiguousPlane.some((point) => point.x === 3 && point.y === 0 && point.z === 0), 'non-contiguous plane fill should include disconnected matching voxels on the same plane');

const colorOnlyPlane = get_flood_fill_voxels({
  start: { x: 0, y: 0, z: 0 },
  sample,
  matches: (candidate, target) => cells_match_edit_channels(candidate, target, { char: false, color: true, weight: false }),
  enumerate_domain: enumerate,
  same_depth_only: true,
  allow_diagonal: false,
  continuous: false,
  plane_axis: 'z',
});
assert(colorOnlyPlane.some((point) => point.x === 2 && point.y === 0 && point.z === 0), 'select mask should allow ignoring character differences');
assert(!colorOnlyPlane.some((point) => point.x === 4 && point.y === 1 && point.z === 0), 'select mask should still reject mismatched colors');

const connectedDiagonal3d = get_flood_fill_voxels({
  start: { x: 1, y: 1, z: 0 },
  sample,
  matches: (candidate, target) => cells_match_edit_channels(candidate, target, { char: false, color: false, weight: false }),
  enumerate_domain: enumerate,
  same_depth_only: false,
  allow_diagonal: true,
  continuous: true,
  plane_axis: 'z',
});
assert(connectedDiagonal3d.some((point) => point.x === 2 && point.y === 2 && point.z === 1), '3D diagonal fill should reach diagonal voxels across z');
assert(connectedDiagonal3d.some((point) => point.x === 3 && point.y === 3 && point.z === 2), '3D diagonal fill should continue along multi-layer diagonals');

const axisLockedY = get_flood_fill_voxels({
  start: { x: 2, y: 2, z: 1 },
  sample,
  matches: (candidate, target) => cells_match_edit_channels(candidate, target, { char: true, color: true, weight: true }),
  enumerate_domain: enumerate,
  same_depth_only: true,
  allow_diagonal: true,
  continuous: false,
  plane_axis: 'y',
});
assert(axisLockedY.every((point) => point.y === 2), 'same-depth fill should lock to the active plane axis, not always z');

const emptyBounds = { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 };
const emptyStart = { x: 0, y: 1, z: 1 };
const emptySample = (world: { x: number; y: number; z: number }): Cell | null => {
  if (
    world.x < emptyBounds.minX || world.x > emptyBounds.maxX
    || world.y < emptyBounds.minY || world.y > emptyBounds.maxY
    || world.z < emptyBounds.minZ || world.z > emptyBounds.maxZ
  ) return null;
  return group.get(key(world.x, world.y, world.z)) ?? { char: ' ', rgb: { r: 0, g: 0, b: 0 }, weight: 0 };
};
const emptyDomain = () => {
  const out: Array<{ x: number; y: number; z: number }> = [];
  for (let z = emptyBounds.minZ; z <= emptyBounds.maxZ; z += 1) {
    for (let y = emptyBounds.minY; y <= emptyBounds.maxY; y += 1) {
      for (let x = emptyBounds.minX; x <= emptyBounds.maxX; x += 1) {
        out.push({ x, y, z });
      }
    }
  }
  return out;
};
const boundedEmptyFill = get_flood_fill_voxels({
  start: emptyStart,
  sample: emptySample,
  matches: (candidate, target) => cells_match_edit_channels(candidate, target, { char: true, color: true, weight: true }),
  enumerate_domain: emptyDomain,
  same_depth_only: false,
  allow_diagonal: false,
  continuous: false,
  plane_axis: 'z',
});
assert(boundedEmptyFill.some((point) => point.x === 1 && point.y === 1 && point.z === 1), 'empty-space fill should treat transparent cells as valid samples inside the bounded domain');
assert(!boundedEmptyFill.some((point) => point.x === 2 || point.y === 2 || point.z === 2), 'bounded all-depth fill should not escape the active-group bounds');

const graphicCharMatch = get_flood_fill_voxels({
  start: { x: 5, y: 0, z: 0 },
  sample,
  matches: (candidate, target) => cells_match_edit_channels(candidate, target, { char: true, color: false, weight: false }),
  enumerate_domain: enumerate,
  same_depth_only: true,
  allow_diagonal: false,
  continuous: false,
  plane_axis: 'z',
});
assert(graphicCharMatch.some((point) => point.x === 6 && point.y === 0 && point.z === 0), 'char matching should include graphic-only cells with the same graphic source');
assert(!graphicCharMatch.some((point) => point.x === 7 && point.y === 0 && point.z === 0), 'char matching should reject graphic-only cells with different graphic sources even when char is blank');

const graphicColorMatch = get_flood_fill_voxels({
  start: { x: 5, y: 0, z: 0 },
  sample,
  matches: (candidate, target) => cells_match_edit_channels(candidate, target, { char: false, color: true, weight: false }),
  enumerate_domain: enumerate,
  same_depth_only: true,
  allow_diagonal: false,
  continuous: false,
  plane_axis: 'z',
});
assert(graphicColorMatch.some((point) => point.x === 5 && point.y === 1 && point.z === 0), 'color matching should respect authoritative appearance slots rather than fallback rgb alone');
assert(!graphicColorMatch.some((point) => point.x === 6 && point.y === 1 && point.z === 0), 'color matching should reject cells with different appearance slot payloads even when rgb matches');

console.log('painter_tools_fill tests passed');
