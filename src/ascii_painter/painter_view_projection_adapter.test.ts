import { commit_grid_to_painter_world, painter_projection_grid_point_to_world, painter_projection_world_to_grid_point, project_painter_display_space, get_painter_focus_slot_for_anchor, sync_grid_to_painter_projection } from './painter_view_projection_adapter.js';
import { addLayer, createVoxelSpace, getLayer } from './voxel_space.js';
import { createGrid } from './types.js';
import { make_place_view_state } from '../mono_ui/runtime/place_view_projection.js';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const space = createVoxelSpace(3, 2, { minZ: 0, maxZ: 1, defaultZ: 0 });
addLayer(space, 1, 'Layer 1');
const layer0 = getLayer(space, 0)!;
const layer1 = getLayer(space, 1)!;
layer0.cells[0]![0] = { char: 'A', rgb: { r: 255, g: 255, b: 255 }, weight_index: 1 };
layer1.cells[1]![2] = { char: 'B', rgb: { r: 255, g: 255, b: 255 }, weight_index: 1 };

space.camera.center_target_in_view = true;
const projectionAnchor = { x: 1, y: 1, z: 0 };
const topProjection = project_painter_display_space({
  source: space,
  view_state: make_place_view_state('top', 0),
  focus_slot: 0,
  target_world: { x: 1, y: 1, z: 0 },
  projection_anchor_world: projectionAnchor,
  viewport_width: 5,
  viewport_height: 5,
});
assert(JSON.stringify(topProjection.visible_planes) === JSON.stringify([0, 1]), 'top view should preserve ascending z planes');
assert(topProjection.target_projected.u === 1 && topProjection.target_projected.v === 1, 'top view target projection should be tracked');
assert(topProjection.space.layers.get(0)?.cells[1]?.[1]?.char === 'A', 'top view slot 0 should recenter content around target');
assert(topProjection.space.layers.get(1)?.cells[2]?.[3]?.char === 'B', 'top view slot 1 should recenter higher plane content');

space.camera.center_target_in_view = false;
const topUncentered = project_painter_display_space({
  source: space,
  view_state: make_place_view_state('top', 0),
  focus_slot: 0,
  target_world: { x: 2, y: 1, z: 0 },
  projection_anchor_world: projectionAnchor,
  viewport_width: 5,
  viewport_height: 5,
  center_target_in_view: false,
});
assert(topUncentered.projected_bounds.min_u === -1 && topUncentered.projected_bounds.min_v === -1, 'non-centered mode should anchor around stable projection center');
space.camera.center_target_in_view = true;

const topExplicitCentered = project_painter_display_space({
  source: space,
  view_state: make_place_view_state('top', 0),
  focus_slot: 0,
  target_world: { x: 2, y: 1, z: 0 },
  projection_anchor_world: projectionAnchor,
  viewport_width: 5,
  viewport_height: 5,
  center_target_in_view: true,
});
assert(topExplicitCentered.projected_bounds.min_u === 0 && topExplicitCentered.projected_bounds.min_v === -1, 'explicit centered mode should force target to viewport center');

const southProjection = project_painter_display_space({
  source: space,
  view_state: make_place_view_state('south', 0),
  focus_slot: 0,
  target_world: { x: 1, y: 1, z: 0 },
  projection_anchor_world: projectionAnchor,
  viewport_width: 5,
  viewport_height: 5,
});
assert(JSON.stringify(southProjection.visible_planes) === JSON.stringify([1, 0]), 'south view should reverse authored y planes');
assert(southProjection.projected_bounds.width === 5, 'south view projected width should match viewport width');
assert(southProjection.projected_bounds.height === 5, 'south view projected height should match viewport height');

const eastProjection = project_painter_display_space({
  source: space,
  view_state: make_place_view_state('east', 0),
  focus_slot: 0,
  target_world: { x: 1, y: 1, z: 0 },
  projection_anchor_world: projectionAnchor,
  viewport_width: 5,
  viewport_height: 5,
});
assert(JSON.stringify(eastProjection.visible_planes) === JSON.stringify([0, 1, 2]), 'east view should expose x planes');

const focus = get_painter_focus_slot_for_anchor({
  anchor_world: { x: 2, y: 1, z: 1 },
  view_state: make_place_view_state('east', 0),
  visible_planes: eastProjection.visible_planes,
  fallback_world_plane: 0,
});
assert(focus.focus_slot === 2, 'east-view focus should map anchor x to slot');
assert(focus.focus_world_plane === 2, 'east-view focus should retain anchor world plane');

const grid = createGrid(1, 1);
sync_grid_to_painter_projection(grid, topProjection);
grid.cells[2]![2] = { char: 'Z', rgb: { r: 10, g: 20, b: 30 }, weight_index: 2 };
commit_grid_to_painter_world({
  source: space,
  grid,
  projection: topProjection,
});
assert(getLayer(space, 0)?.cells[1]?.[1]?.char === 'Z', 'top-view grid writeback should update world voxel plane');

const mappedWorld = painter_projection_grid_point_to_world({ projection: topProjection, x: 2, y: 2 });
assert(JSON.stringify(mappedWorld) === JSON.stringify({ x: 1, y: 1, z: 0 }), 'grid center should map back to target world');
const mappedGrid = painter_projection_world_to_grid_point({ projection: topProjection, world: { x: 1, y: 1, z: 0 } });
assert(JSON.stringify(mappedGrid) === JSON.stringify({ x: 2, y: 2 }), 'target world should map to centered grid point');

console.log('painter_view_projection_adapter tests passed');
