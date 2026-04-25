import { commit_grid_to_painter_world, painter_projection_grid_point_to_world, painter_projection_world_to_grid_point, project_painter_display_space, project_painter_runtime_display_space, project_world_to_painter_display_cell, get_painter_focus_slot_for_anchor, sync_grid_to_painter_projection } from './painter_view_projection_adapter.js';
import { addLayer, createVoxelSpace, getLayer } from './voxel_space.js';
import { createGrid } from './types.js';
import { create_painter_document, create_painter_group, create_painter_voxel_record } from './painter_document.js';
import { normalize_painter_document_runtime, set_group_voxel } from './painter_document_runtime.js';
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
assert(topProjection.scene.slots.get(0)?.cells[1]?.[1]?.char === 'A', 'top view slot 0 should recenter content around target');
assert(topProjection.scene.slots.get(1)?.cells[2]?.[3]?.char === 'B', 'top view slot 1 should recenter higher plane content');
assert(getLayer(space, 0)?.cells[0]?.[0]?.char === 'A', 'source voxel space should retain original world-space cell position');

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
  grid,
  projection: topProjection,
});
assert(getLayer(space, 0)?.cells[0]?.[0]?.char === 'A', 'projection commit should not mutate legacy voxel-space world data');

const mappedWorld = painter_projection_grid_point_to_world({ projection: topProjection, x: 2, y: 2 });
assert(JSON.stringify(mappedWorld) === JSON.stringify({ x: 1, y: 1, z: 0 }), 'grid center should map back to target world');
const mappedGrid = painter_projection_world_to_grid_point({ projection: topProjection, world: { x: 1, y: 1, z: 0 } });
assert(JSON.stringify(mappedGrid) === JSON.stringify({ x: 2, y: 2 }), 'target world should map to centered grid point');

const runtimeDocument = create_painter_document(6, 6, { min_z: 0, max_z: 2, default_group_name: 'Base' });
const runtimeBaseGroupId = runtimeDocument.group_order[0]!;
const runtimeTopGroup = create_painter_group('Top');
runtimeDocument.groups[runtimeTopGroup.id] = runtimeTopGroup;
runtimeDocument.group_order.push(runtimeTopGroup.id);
const runtime = normalize_painter_document_runtime(runtimeDocument);

set_group_voxel(runtime, runtimeBaseGroupId, create_painter_voxel_record({
  x: 2,
  y: 2,
  z: 1,
  char: 'A',
  rgb: { r: 255, g: 255, b: 255 },
  weight_index: 1,
}));
set_group_voxel(runtime, runtimeTopGroup.id, create_painter_voxel_record({
  x: 2,
  y: 2,
  z: 1,
  char: 'B',
  rgb: { r: 255, g: 0, b: 0 },
  weight_index: 2,
}));
set_group_voxel(runtime, runtimeTopGroup.id, create_painter_voxel_record({
  x: 2,
  y: 1,
  z: 0,
  char: 'L',
  rgb: { r: 0, g: 255, b: 0 },
  weight_index: 1,
}));
set_group_voxel(runtime, runtimeTopGroup.id, create_painter_voxel_record({
  x: 2,
  y: 1,
  z: 2,
  char: 'H',
  rgb: { r: 0, g: 0, b: 255 },
  weight_index: 1,
}));

const runtimeTopProjection = project_painter_runtime_display_space({
  runtime,
  view_state: make_place_view_state('top', 0),
  focus_slot: 2,
  target_world: { x: 2, y: 2, z: 1 },
  projection_anchor_world: { x: 2, y: 2, z: 1 },
  viewport_width: 5,
  viewport_height: 5,
  center_target_in_view: true,
});

const overlapGridPoint = painter_projection_world_to_grid_point({
  projection: runtimeTopProjection,
  world: { x: 2, y: 2, z: 1 },
});
assert(!!overlapGridPoint, 'runtime top projection should map overlap world coordinate into focused slot');
assert(runtimeTopProjection.scene.slots.get(runtimeTopProjection.focus_slot)?.cells[overlapGridPoint!.y]?.[overlapGridPoint!.x]?.char === 'B', 'runtime top projection should render top group winner at exact overlap');

const runtimeSouthProjection = project_painter_runtime_display_space({
  runtime,
  view_state: make_place_view_state('south', 0),
  focus_slot: 2,
  target_world: { x: 2, y: 1, z: 1 },
  projection_anchor_world: { x: 2, y: 1, z: 1 },
  viewport_width: 7,
  viewport_height: 7,
  center_target_in_view: true,
});

const lowPlaneGridPoint = painter_projection_world_to_grid_point({
  projection: runtimeSouthProjection,
  world: { x: 2, y: 1, z: 0 },
});
const highPlaneGridPoint = painter_projection_world_to_grid_point({
  projection: runtimeSouthProjection,
  world: { x: 2, y: 1, z: 2 },
});
assert(!!lowPlaneGridPoint && !!highPlaneGridPoint, 'runtime south projection should map multi-plane group voxels on the focused y plane');
assert(runtimeSouthProjection.scene.slots.get(runtimeSouthProjection.focus_slot)?.cells[lowPlaneGridPoint!.y]?.[lowPlaneGridPoint!.x]?.char === 'L', 'runtime south projection should render lower-z voxel from the same group');
assert(runtimeSouthProjection.scene.slots.get(runtimeSouthProjection.focus_slot)?.cells[highPlaneGridPoint!.y]?.[highPlaneGridPoint!.x]?.char === 'H', 'runtime south projection should render higher-z voxel from the same group');

const singlePlaneDocument = create_painter_document(4, 4, { min_z: 0, max_z: 0, default_group_name: 'Solo' });
const singlePlaneRuntime = normalize_painter_document_runtime(singlePlaneDocument);
const singlePlaneProjection = project_painter_runtime_display_space({
  runtime: singlePlaneRuntime,
  view_state: make_place_view_state('top', 0),
  focus_slot: 0,
  target_world: { x: 1, y: 1, z: 0 },
  projection_anchor_world: { x: 1, y: 1, z: 0 },
  viewport_width: 5,
  viewport_height: 5,
  center_target_in_view: true,
});
assert(JSON.stringify(singlePlaneProjection.visible_planes) === JSON.stringify([-2, -1, 0, 1, 2]), 'runtime top projection should expose nearby empty depth planes for one-layer drawings');

const farPlaneProjection = project_painter_runtime_display_space({
  runtime: singlePlaneRuntime,
  view_state: make_place_view_state('top', 0),
  focus_slot: 0,
  target_world: { x: 1, y: 1, z: 15 },
  projection_anchor_world: { x: 1, y: 1, z: 15 },
  viewport_width: 5,
  viewport_height: 5,
  center_target_in_view: true,
});
assert(JSON.stringify(farPlaneProjection.visible_planes) === JSON.stringify([13, 14, 15, 16, 17]), 'runtime top projection should stay camera-centered at far depth instead of collapsing to authored bounds');
assert(project_world_to_painter_display_cell({ projection: farPlaneProjection, world: { x: 1, y: 1, z: 0 } }) === null, 'off-window world planes should not collapse into visible slot 0');

const southCameraCenteredProjection = project_painter_runtime_display_space({
  runtime: singlePlaneRuntime,
  view_state: make_place_view_state('south', 0),
  focus_slot: 0,
  target_world: { x: 1, y: 12, z: 0 },
  projection_anchor_world: { x: 1, y: 12, z: 0 },
  viewport_width: 5,
  viewport_height: 5,
  center_target_in_view: true,
});
assert(JSON.stringify(southCameraCenteredProjection.visible_planes) === JSON.stringify([14, 13, 12, 11, 10]), 'runtime side projection should use the same camera-centered margin on the current depth axis');

console.log('painter_view_projection_adapter tests passed');
