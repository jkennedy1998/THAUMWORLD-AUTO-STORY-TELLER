import { resolve_groups_raster_drag_mode, resolve_groups_raster_hit_mode_for_span, resolve_groups_raster_swap_target, resolve_groups_raster_visual_style } from './groups_module.js';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

assert(
  resolve_groups_raster_drag_mode({ hit_mode: 'body_single', button: 0, is_blank: false }) === 'body_move',
  'single content left drag should move the block body',
);

assert(
  resolve_groups_raster_drag_mode({ hit_mode: 'body_single', button: 2, is_blank: false }) === 'body_dynamic_resize',
  'single content right drag should dynamically resize the block',
);

assert(
  resolve_groups_raster_drag_mode({ hit_mode: 'blank_single', button: 0, is_blank: true }) === null,
  'single blank left drag should not arm a merge drag',
);

assert(
  resolve_groups_raster_drag_mode({ hit_mode: 'blank_single', button: 2, is_blank: true }) === null,
  'single blank right drag should be a no-op',
);

assert(
  resolve_groups_raster_drag_mode({ hit_mode: 'blank_center', button: 2, is_blank: true }) === 'body_swap',
  'blank center right drag should swap with dragged-on content',
);

assert(
  resolve_groups_raster_drag_mode({ hit_mode: 'blank_start', button: 2, is_blank: true }) === null,
  'blank left cap right drag should be a no-op',
);

assert(
  resolve_groups_raster_drag_mode({ hit_mode: 'blank_end', button: 2, is_blank: true }) === null,
  'blank right cap right drag should be a no-op',
);

assert(
  resolve_groups_raster_drag_mode({ hit_mode: 'edge_start', button: 2, is_blank: false }) === 'edge_start_dynamic',
  'content left edge right drag should dynamically resize from the start edge',
);

assert(
  resolve_groups_raster_drag_mode({ hit_mode: 'edge_end', button: 2, is_blank: false }) === 'edge_end_dynamic',
  'content right edge right drag should dynamically resize from the end edge',
);

assert(
  resolve_groups_raster_drag_mode({ hit_mode: 'body_move', button: 2, is_blank: false }) === 'body_swap',
  'content center right drag should swap with another content block',
);

assert(
  resolve_groups_raster_swap_target({
    sourceGroupId: 'group_a',
    sourcePropertyId: 'raster_a',
    sourceSegmentId: 'content_a',
    hitGroupId: 'group_a',
    hitPropertyId: 'raster_a',
    hitSegmentId: 'content_b',
    hitIsBlank: false,
  }) === 'content_b',
  'swap target should accept a different content block in the same raster row',
);

assert(
  resolve_groups_raster_swap_target({
    sourceGroupId: 'group_a',
    sourcePropertyId: 'raster_a',
    sourceSegmentId: 'content_a',
    hitGroupId: 'group_a',
    hitPropertyId: 'raster_a',
    hitSegmentId: 'blank_b',
    hitIsBlank: true,
  }) === 'blank_b',
  'swap target should accept blank blocks in the same raster row',
);

assert(
  resolve_groups_raster_hit_mode_for_span({ start: 3, end: 5, breath: 4, is_blank: false }) === 'body_move',
  '3-cell content middle should classify as body_move',
);

assert(
  resolve_groups_raster_hit_mode_for_span({ start: 3, end: 5, breath: 4, is_blank: true }) === 'blank_center',
  '3-cell blank middle should classify as blank_center',
);

assert(
  resolve_groups_raster_swap_target({
    sourceGroupId: 'group_a',
    sourcePropertyId: 'raster_a',
    sourceSegmentId: 'content_a',
    hitGroupId: 'group_a',
    hitPropertyId: 'raster_b',
    hitSegmentId: 'content_b',
    hitIsBlank: false,
  }) === null,
  'swap target should reject content blocks from another raster row',
);

const muted = { r: 1, g: 2, b: 3 };
const selected = { r: 4, g: 5, b: 6 };
const hover = { rgb: { r: 7, g: 8, b: 9 }, weight: 3 };

const hoveredSelectedContent = resolve_groups_raster_visual_style({
  is_blank: false,
  visible: true,
  selected_property: true,
  interaction: hover,
  muted_rgb: muted,
  selected_rgb: selected,
});
assert(
  hoveredSelectedContent.rgb.r === hover.rgb.r && hoveredSelectedContent.weight === hover.weight,
  'hover style should win over selected-property styling for visible content',
);

const idleSelectedBlank = resolve_groups_raster_visual_style({
  is_blank: true,
  visible: true,
  selected_property: true,
  interaction: { rgb: { r: 9, g: 9, b: 9 }, weight: 1 },
  muted_rgb: muted,
  selected_rgb: selected,
});
assert(
  idleSelectedBlank.rgb.r === selected.r && idleSelectedBlank.weight === 3,
  'selected blank blocks should still show selected-property styling when idle',
);

console.log('groups_module drag mode tests passed');
