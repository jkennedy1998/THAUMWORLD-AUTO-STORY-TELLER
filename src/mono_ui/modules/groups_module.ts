import type { Module, Canvas, Rect, PointerEvent, DragEvent } from '../types.js';
import { get_color_by_name } from '../colors.js';
import { MODULE_CHROME_RENDER_INDEX, PANEL_BORDER_PRESETS, draw_panel_horizontal_divider } from '../module_borders.js';
import type { ModuleGizmosConfig } from '../module_gizmos.js';
import { make_floating_panel_module } from './floating_panel_module.js';
import { diag_log } from '../../shared/diagnostics.js';

export type GroupListItem = {
  id: string;
  label: string;
  selected: boolean;
  selected_property_id?: string;
  group_start?: number;
  cropped_start?: number;
  cropped_end?: number;
  derivative_end?: number;
  visible?: boolean;
  locked?: boolean;
  can_delete?: boolean;
  subtitle?: string;
  breath_start?: number;
  breath_end?: number;
  property_rows?: Array<{
    property_id: string;
    kind: 'raster' | 'move';
    label: string;
    blocks: Array<{ id: string; breath: number; start: number; end: number; is_blank?: boolean; dominant_rgb?: { r: number; g: number; b: number } }>;
  }>;
};

export type GroupsModuleOptions = {
  id: string;
  rect: Rect;
  title?: string;
  get_groups: () => GroupListItem[];
  get_current_breath?: () => number;
  on_set_current_breath?: (breath: number) => void;
  get_file_breath_range?: () => { start: number; end: number };
  get_loop_breath_range?: () => { start: number; end: number };
  get_timeline_view_start?: () => number;
  get_timeline_view_span?: () => number;
  on_set_timeline_view_start?: (breath: number) => void;
  on_set_document_loop_window?: (breathStart: number, breathEnd: number) => void;
  get_auto_key_enabled?: () => boolean;
  on_toggle_auto_key?: () => void;
  on_select_group: (id: string) => void;
  on_select_group_property?: (groupId: string, propertyId: string) => void;
  on_toggle_group_visibility?: (id: string) => void;
  on_toggle_group_lock?: (id: string) => void;
  on_rename_group: (id: string, next_label: string) => void;
  on_add_group: () => void;
  on_delete_group?: (id: string) => void;
  on_reorder_groups: (ids_in_display_order: string[]) => void;
  on_reorder_group_properties?: (groupId: string, next_property_order: string[]) => void;
  on_add_group_property?: (groupId: string, propertyKind: 'raster' | 'move', afterPropertyId?: string | null) => void;
  on_remove_group_property?: (groupId: string, propertyId: string) => void;
  on_offset_group_in_time?: (groupId: string, deltaBreaths: number) => void;
  on_set_group_timing?: (groupId: string, start: number, cropped_start: number, cropped_end: number) => void;
  on_set_group_property_block_length?: (groupId: string, propertyId: string, blockId: string, lengthBreaths: number) => void;
  on_split_group_property_block?: (groupId: string, propertyId: string, blockId: string, splitBreath: number) => void;
  on_swap_group_property_blocks?: (groupId: string, propertyId: string, sourceBlockId: string, targetBlockId: string) => void;
  on_blank_group_property_block?: (groupId: string, propertyId: string, blockId: string) => void;
  on_trim_group_property_block_edge?: (groupId: string, propertyId: string, blockId: string, edge: 'start' | 'end') => void;
  on_merge_group_blank_property_block?: (groupId: string, propertyId: string, blockId: string, direction: 'left' | 'right') => void;
  on_compact_group_blank_property_block_left?: (groupId: string, propertyId: string, blockId: string) => void;
  on_set_group_property_block_edge_destructive?: (groupId: string, propertyId: string, blockId: string, edge: 'start' | 'end', targetBreath: number) => void;
  on_move_group_property_block?: (groupId: string, propertyId: string, blockId: string, targetBreath: number) => void;
  on_move?: (new_rect: Rect) => void;
  on_resize?: (new_rect: Rect) => void;
  on_close?: () => void;
};

const MIN_WIDTH = 32;
const MAX_WIDTH = 90;
const MIN_HEIGHT = 14;
const MAX_HEIGHT = 80;
const HEADER_HEIGHT = 5;
const SECTION_SPACING = 1;
const BLOCK_DOUBLE_CLICK_MS = 350;
const BLOCK_DRAG_THRESHOLD_PX = 1;

type GroupSectionLayout = {
  item: GroupListItem;
  sectionTopY: number;
  sectionBottomY: number;
  titleRowY: number;
  spacerRowY: number;
  turnRowY: number;
  transRowY: number;
  footerRowY: number;
  propertyRows: Array<{ property_id: string; kind: PropertyRowKind; label: string; y: number }>;
};

type PropertyRowKind = 'raster' | 'move';

type PropertyRowSegment = {
  property_id: string;
  block_id: string;
  breath: number;
  start: number;
  end: number;
  is_blank: boolean;
  dominant_rgb?: { r: number; g: number; b: number };
};

type PropertyRowHit = {
  propertyId: string;
  blockId: string;
  breath: number;
  mode: 'edge_start' | 'edge_end' | 'body_move' | 'body_single' | 'blank_start' | 'blank_end' | 'blank_center' | 'blank_single';
  isBlank: boolean;
};

type RasterHitMode = PropertyRowHit['mode'];

type RasterDragMode = 'edge_start' | 'edge_end' | 'edge_start_dynamic' | 'edge_end_dynamic' | 'body_move' | 'body_dynamic_resize' | 'body_swap';

type InteractionStyle = { rgb: { r: number; g: number; b: number }; weight: number };

export function resolve_groups_raster_swap_target(args: {
  sourceGroupId: string | null;
  sourcePropertyId: string | null;
  sourceSegmentId: string | null;
  hitGroupId: string | null;
  hitPropertyId: string | null;
  hitSegmentId: string | null;
  hitIsBlank: boolean;
}): string | null {
  return resolve_groups_raster_swap_target_result(args).targetSegmentId;
}

export function resolve_groups_raster_swap_target_result(args: {
  sourceGroupId: string | null;
  sourcePropertyId: string | null;
  sourceSegmentId: string | null;
  hitGroupId: string | null;
  hitPropertyId: string | null;
  hitSegmentId: string | null;
  hitIsBlank: boolean;
}): { targetSegmentId: string | null; reason: string } {
  if (!args.sourceGroupId || !args.sourcePropertyId || !args.sourceSegmentId) return { targetSegmentId: null, reason: 'missing_source' };
  if (args.hitGroupId !== args.sourceGroupId) return { targetSegmentId: null, reason: 'different_group' };
  if (args.hitPropertyId !== args.sourcePropertyId) return { targetSegmentId: null, reason: 'different_property' };
  if (!args.hitSegmentId) return { targetSegmentId: null, reason: 'missing_target' };
  if (args.hitSegmentId === args.sourceSegmentId) return { targetSegmentId: null, reason: 'same_segment' };
  return { targetSegmentId: args.hitSegmentId, reason: args.hitIsBlank ? 'accepted_blank' : 'accepted_content' };
}

export function resolve_groups_raster_hit_mode_for_span(args: {
  start: number;
  end: number;
  breath: number;
  is_blank: boolean;
}): RasterHitMode {
  const start = Math.floor(args.start);
  const end = Math.max(start, Math.floor(args.end));
  const breath = Math.floor(args.breath);
  if (start === end) return args.is_blank ? 'blank_single' : 'body_single';
  if (breath === start) return args.is_blank ? 'blank_start' : 'edge_start';
  if (breath === end) return args.is_blank ? 'blank_end' : 'edge_end';
  return args.is_blank ? 'blank_center' : 'body_move';
}

export function resolve_groups_raster_drag_mode(args: {
  hit_mode: RasterHitMode;
  button: number;
  is_blank: boolean;
}): RasterDragMode | null {
  if (args.is_blank) return args.button === 2 && args.hit_mode === 'blank_center' ? 'body_swap' : null;

  const contentMode = args.hit_mode === 'edge_start' || args.hit_mode === 'edge_end' || args.hit_mode === 'body_move' || args.hit_mode === 'body_single'
    ? args.hit_mode
    : 'body_single';
  if (contentMode === 'body_single') return args.button === 2 ? 'body_dynamic_resize' : 'body_move';
  if (args.button !== 2) return contentMode;
  if (contentMode === 'edge_start') return 'edge_start_dynamic';
  if (contentMode === 'edge_end') return 'edge_end_dynamic';
  if (contentMode === 'body_move') return 'body_swap';
  return 'body_dynamic_resize';
}

export function resolve_groups_raster_visual_style(args: {
  is_blank: boolean;
  visible: boolean;
  selected_property: boolean;
  interaction: InteractionStyle;
  muted_rgb: { r: number; g: number; b: number };
  selected_rgb: { r: number; g: number; b: number };
  content_rgb?: { r: number; g: number; b: number };
  blank_rgb?: { r: number; g: number; b: number };
}): InteractionStyle {
  if (!args.visible) return { rgb: args.muted_rgb, weight: 1 };
  if (args.interaction.weight >= 2) return args.interaction;
  if (args.is_blank) return args.selected_property ? { rgb: args.selected_rgb, weight: 3 } : { rgb: args.blank_rgb ?? args.muted_rgb, weight: 1 };
  return { rgb: args.content_rgb ?? args.interaction.rgb, weight: Math.max(0, args.interaction.weight - 1) };
}

function resolve_groups_move_visual_style(args: {
  is_blank: boolean;
  visible: boolean;
  selected_property: boolean;
  interaction: InteractionStyle;
  muted_rgb: { r: number; g: number; b: number };
  selected_rgb: { r: number; g: number; b: number };
  content_rgb: { r: number; g: number; b: number };
  blank_rgb?: { r: number; g: number; b: number };
}): InteractionStyle {
  if (!args.visible) return { rgb: args.muted_rgb, weight: 1 };
  if (args.interaction.weight >= 2) return args.interaction;
  if (args.is_blank) return args.selected_property ? { rgb: args.selected_rgb, weight: 2 } : { rgb: args.blank_rgb ?? args.muted_rgb, weight: 1 };
  if (args.selected_property) return { rgb: args.content_rgb, weight: 2 };
  return { rgb: args.content_rgb, weight: 1 };
}

type PropertyRowDrawSegment = {
  id: string;
  breath: number;
  start: number;
  end: number;
  is_blank: boolean;
  dominant_rgb?: { r: number; g: number; b: number };
};

function getPropertyRowLocalYOffset(index: number): number {
  return 2 + index;
}

export function makeGroupsModule(opts: GroupsModuleOptions): Module {
  let rect = opts.rect;
  let scrollOffset = 0;

  const bgColor = get_color_by_name('off_black').rgb;
  const borderColor = get_color_by_name('medium_gray').rgb;
  const textColor = get_color_by_name('off_white').rgb;
  const selectedColor = get_color_by_name('vivid_yellow').rgb;
  const visibleColor = get_color_by_name('pale_green').rgb;
  const hiddenColor = get_color_by_name('pale_gray').rgb;
  const lockedColor = get_color_by_name('vivid_red').rgb;
  const deleteColor = get_color_by_name('vivid_red').rgb;
  const dragHandleColor = get_color_by_name('vivid_cyan').rgb;
  const orderNumColor = get_color_by_name('light_blue').rgb;
  const dropIndicatorColor = get_color_by_name('vivid_green').rgb;
  const editBgColor = get_color_by_name('deep_blue').rgb;
  const editCursorColor = get_color_by_name('vivid_yellow').rgb;
  const mutedColor = get_color_by_name('medium_gray').rgb;
  const rasterDefaultColor = get_color_by_name('off_white').rgb;
  const rasterHoverColor = get_color_by_name('vivid_yellow').rgb;
  const rasterLeftDragColor = get_color_by_name('vivid_cyan').rgb;
  const rasterRightDragColor = get_color_by_name('pumpkin').rgb;
  const rasterSwapTargetColor = get_color_by_name('vivid_green').rgb;

  function groupsRasterDiag(event: string, payload?: Record<string, unknown>): void {
    diag_log('painter', 'verbose', 'GROUPS_RASTER', event, payload);
  }

  function groupsHoverDiag(event: string, payload?: Record<string, unknown>): void {
    try {
      console.log('[GROUPS_HOVER]', JSON.stringify({ event, ...(payload ?? {}) }));
    } catch {
      console.log(`[GROUPS_HOVER] ${event}`);
    }
  }

  let dragState: {
    isDragging: boolean;
    sourceGroupId: string | null;
    dragPointerY: number;
    currentDropIndex: number | null;
    draggedGroup: GroupListItem | null;
  } = {
    isDragging: false,
    sourceGroupId: null,
    dragPointerY: 0,
    currentDropIndex: null,
    draggedGroup: null,
  };
  let propertyOrderDragState: {
    active: boolean;
    groupId: string | null;
    propertyId: string | null;
    dragPointerY: number;
    currentDropIndex: number | null;
  } = {
    active: false,
    groupId: null,
    propertyId: null,
    dragPointerY: 0,
    currentDropIndex: null,
  };

  let renameState: {
    isRenaming: boolean;
    groupId: string | null;
    editText: string;
    cursorPosition: number;
  } = {
    isRenaming: false,
    groupId: null,
    editText: '',
    cursorPosition: 0,
  };

  let timelinePanDrag: {
    active: boolean;
    anchorX: number;
    anchorStartBreath: number;
  } = {
    active: false,
    anchorX: 0,
    anchorStartBreath: 0,
  };
  let timelineScrubDrag = false;
  let loopWindowDrag: {
    active: boolean;
    mode: 'start' | 'end' | 'body' | null;
    originalStart: number;
    originalEnd: number;
    anchorBreath: number;
    previewStart: number;
    previewEnd: number;
  } = {
    active: false,
    mode: null,
    originalStart: 0,
    originalEnd: 0,
    anchorBreath: 0,
    previewStart: 0,
    previewEnd: 0,
  };

  let lastPointerLocalPos: { x: number; y: number } | null = null;
  let blankMergeDragState: {
    active: boolean;
    groupId: string | null;
    propertyId: string | null;
    segmentId: string | null;
    anchorBreath: number;
    previewDirection: 'left' | 'right' | null;
  } = {
    active: false,
    groupId: null,
    propertyId: null,
    segmentId: null,
    anchorBreath: 0,
    previewDirection: null,
  };
  let rasterDragState: {
    active: boolean;
    kind: PropertyRowKind | null;
    groupId: string | null;
    propertyId: string | null;
    segmentId: string | null;
    mode: RasterDragMode | null;
    button: number;
    originalGroupStart: number;
    originalCropStart: number;
    originalCropEnd: number;
    originalSegmentStart: number;
    originalSegmentEnd: number;
    originalLength: number;
    anchorBreath: number;
    previewBreath: number;
    targetSegmentId: string | null;
    targetPropertyId: string | null;
  } = {
    active: false,
    kind: null,
    groupId: null,
    propertyId: null,
    segmentId: null,
    mode: null,
    button: 0,
    originalGroupStart: 0,
    originalCropStart: 0,
    originalCropEnd: 0,
    originalSegmentStart: 0,
    originalSegmentEnd: 0,
    originalLength: 1,
    anchorBreath: 0,
    previewBreath: 0,
    targetSegmentId: null,
    targetPropertyId: null,
  };
  let lastSwapPreviewDiagKey = '';

  let rasterHoverState: {
    groupId: string | null;
    segmentId: string | null;
    breath: number | null;
    mode: 'edge_start' | 'edge_end' | 'body_move' | 'body_single' | 'blank_start' | 'blank_end' | 'blank_center' | 'blank_single' | null;
  } = {
    groupId: null,
    segmentId: null,
    breath: null,
    mode: null,
  };
  let moveHoverState: {
    groupId: string | null;
    propertyId: string | null;
    blockId: string | null;
    breath: number | null;
  } = {
    groupId: null,
    propertyId: null,
    blockId: null,
    breath: null,
  };
  let pendingBlockPress: {
    active: boolean;
    kind: 'raster' | 'move' | null;
    groupId: string | null;
    propertyId: string | null;
    blockId: string | null;
    mode: 'edge_start' | 'edge_end' | 'body_move' | 'body_single' | 'blank_start' | 'blank_end' | 'blank_center' | 'blank_single' | null;
    isBlank: boolean;
    button: number;
    localDownX: number;
    localDownY: number;
    breath: number;
  } = {
    active: false,
    kind: null,
    groupId: null,
    propertyId: null,
    blockId: null,
    mode: null,
    isBlank: false,
    button: 0,
    localDownX: 0,
    localDownY: 0,
    breath: 0,
  };
  let pendingBlockSingleClick: {
    timeoutId: number | null;
    kind: 'raster' | 'move' | null;
    groupId: string | null;
    propertyId: string | null;
    blockId: string | null;
    mode: 'edge_start' | 'edge_end' | 'body_move' | 'body_single' | 'blank_start' | 'blank_end' | 'blank_center' | 'blank_single' | null;
    isBlank: boolean;
    button: number;
    breath: number;
  } = {
    timeoutId: null,
    kind: null,
    groupId: null,
    propertyId: null,
    blockId: null,
    mode: null,
    isBlank: false,
    button: 0,
    breath: 0,
  };

  const gizmo_config: ModuleGizmosConfig = {
    enabled: ['move', 'resize', 'close', 'seamless'],
    can_close: true,
    can_move: true,
    can_save_position: false,
    on_close: opts.on_close,
    on_move: opts.on_move,
  };

  function getGroups(): GroupListItem[] {
    return [...opts.get_groups()];
  }

  function getGroupById(id: string): GroupListItem | null {
    return getGroups().find((group) => group.id === id) ?? null;
  }

  function getVisualOrder(id: string): number {
    const groups = getGroups();
    const index = groups.findIndex((group) => group.id === id);
    return index + 1;
  }

  function selectGroup(group: GroupListItem): void {
    opts.on_select_group(group.id);
  }

  function toggleGroupVisibility(group: GroupListItem): void {
    opts.on_toggle_group_visibility?.(group.id);
  }

  function toggleGroupLock(group: GroupListItem): void {
    opts.on_toggle_group_lock?.(group.id);
  }

  function renameGroup(groupId: string, editText: string): void {
    opts.on_rename_group(groupId, editText);
  }

  function deleteGroup(group: GroupListItem): void {
    opts.on_delete_group?.(group.id);
  }

  function reorderGroups(groups: GroupListItem[], sourceGroupId: string, currentDropIndex: number): void {
    const sourceIndex = groups.findIndex((group) => group.id === sourceGroupId);
    if (sourceIndex < 0) return;
    let effectiveDropIndex = currentDropIndex;
    if (currentDropIndex > sourceIndex) effectiveDropIndex = currentDropIndex - 1;
    const isDifferentPosition =
      (currentDropIndex < sourceIndex && currentDropIndex !== sourceIndex) ||
      (currentDropIndex > sourceIndex && effectiveDropIndex !== sourceIndex);
    if (!isDifferentPosition) return;
    const remainingGroups = groups.filter((group) => group.id !== sourceGroupId);
    const reorderedGroups: GroupListItem[] = [];
    const clampedDropIndex = Math.max(0, Math.min(remainingGroups.length, effectiveDropIndex));
    for (let i = 0; i < clampedDropIndex && i < remainingGroups.length; i += 1) reorderedGroups.push(remainingGroups[i]!);
    const draggedGroup = groups[sourceIndex];
    if (draggedGroup) reorderedGroups.push(draggedGroup);
    for (let i = clampedDropIndex; i < remainingGroups.length; i += 1) reorderedGroups.push(remainingGroups[i]!);
    opts.on_reorder_groups(reorderedGroups.map((group) => group.id));
  }

  function beginRenameGroup(groupId: string): boolean {
    const group = getGroupById(groupId);
    if (!group) return false;
    selectGroup(group);
    renameState.isRenaming = true;
    renameState.groupId = group.id;
    renameState.editText = group.label;
    renameState.cursorPosition = group.label.length;
    return true;
  }

  function getAutoKeyEnabled(): boolean {
    return opts.get_auto_key_enabled?.() ?? false;
  }

  function toggleAutoKey(): void {
    opts.on_toggle_auto_key?.();
  }

  function getCurrentBreath(): number {
    return Math.floor(opts.get_current_breath?.() ?? 0);
  }

  function setCurrentBreath(breath: number): void {
    opts.on_set_current_breath?.(Math.floor(breath));
  }

  function getFileBreathRange(): { start: number; end: number } {
    const range = opts.get_file_breath_range?.() ?? { start: 0, end: 0 };
    return {
      start: Math.max(0, Math.floor(range.start)),
      end: Math.max(Math.max(0, Math.floor(range.start)), Math.floor(range.end)),
    };
  }

  function getLoopBreathRange(): { start: number; end: number } {
    const range = opts.get_loop_breath_range?.() ?? getFileBreathRange();
    return {
      start: Math.max(0, Math.floor(range.start)),
      end: Math.max(Math.max(0, Math.floor(range.start)), Math.floor(range.end)),
    };
  }

  function setLoopBreathRange(start: number, end: number): void {
    opts.on_set_document_loop_window?.(Math.floor(start), Math.floor(end));
  }

  function getModuleLocalHeight(currentRect: Rect): number {
    return currentRect.y1 - currentRect.y0;
  }

  function getTimelineViewStart(): number {
    return Math.floor(opts.get_timeline_view_start?.() ?? 0);
  }

  function getTimelineViewSpan(): number {
    return Math.max(1, Math.floor(opts.get_timeline_view_span?.() ?? 24));
  }

  function setTimelineViewStart(breath: number): void {
    opts.on_set_timeline_view_start?.(Math.floor(breath));
  }

  function getContentMetrics(currentRect: Rect): {
    titleRowY: number;
    headerRow1Y: number;
    headerRow2Y: number;
    dividerY: number;
    contentTopY: number;
    contentBottomY: number;
    contentHeight: number;
  } {
    const height = getModuleLocalHeight(currentRect);
    const titleRowY = height - 1;
    const headerRow1Y = height - 2;
    const headerRow2Y = height - 3;
    const dividerY = height - 4;
    const contentTopY = dividerY - 1;
    const contentBottomY = 1;
    return {
      titleRowY,
      headerRow1Y,
      headerRow2Y,
      dividerY,
      contentTopY,
      contentBottomY,
      contentHeight: Math.max(0, contentTopY - contentBottomY + 1),
    };
  }

  function getTimelineRegion(currentRect: Rect): { startX: number; endX: number; innerStartX: number; innerEndX: number; innerWidth: number } {
    const startX = currentRect.x0 + 29;
    const endX = currentRect.x1 - 3;
    const innerStartX = startX + 1;
    const innerEndX = endX - 1;
    return {
      startX,
      endX,
      innerStartX,
      innerEndX,
      innerWidth: Math.max(1, innerEndX - innerStartX + 1),
    };
  }

  function getVisibleBreathColumns(currentRect: Rect): number {
    return getTimelineRegion(currentRect).innerWidth;
  }

  function getTimelineViewEnd(currentRect: Rect): number {
    return getTimelineViewStart() + getVisibleBreathColumns(currentRect) - 1;
  }

  function isPointerInTimelineHeader(currentRect: Rect, localX: number, localY: number): boolean {
    const metrics = getContentMetrics(currentRect);
    const timelineRegion = getTimelineRegion(currentRect);
    return (localY === metrics.headerRow1Y || localY === metrics.headerRow2Y)
      && localX >= timelineRegion.startX - currentRect.x0
      && localX <= timelineRegion.endX - currentRect.x0;
  }

  function breathToTimelineX(currentRect: Rect, breath: number): number {
    const region = getTimelineRegion(currentRect);
    const start = getTimelineViewStart();
    const offset = Math.floor(breath) - start;
    return Math.max(region.innerStartX, Math.min(region.innerEndX, region.innerStartX + offset));
  }

  function timelineXToBreath(currentRect: Rect, localX: number): number {
    const region = getTimelineRegion(currentRect);
    const start = getTimelineViewStart();
    const clampedX = Math.max(region.innerStartX, Math.min(region.innerEndX, localX));
    return start + (clampedX - region.innerStartX);
  }

  function getResolvedLoopBreathRange(): { start: number; end: number } {
    if (!loopWindowDrag.active || !loopWindowDrag.mode) return getLoopBreathRange();
    return {
      start: loopWindowDrag.previewStart,
      end: loopWindowDrag.previewEnd,
    };
  }

  function getLoopWindowHit(currentRect: Rect, localX: number, localY: number): 'start' | 'end' | 'body' | null {
    const metrics = getContentMetrics(currentRect);
    if (localY !== metrics.headerRow2Y) return null;
    const region = getTimelineRegion(currentRect);
    if (localX < region.innerStartX - currentRect.x0 || localX > region.innerEndX - currentRect.x0) return null;
    const loopRange = getResolvedLoopBreathRange();
    const startX = breathToTimelineX(currentRect, loopRange.start) - currentRect.x0;
    const endX = breathToTimelineX(currentRect, loopRange.end) - currentRect.x0;
    if (localX < startX || localX > endX) return null;
    if (startX === endX) return 'body';
    if (Math.abs(localX - startX) <= 1) return 'start';
    if (Math.abs(localX - endX) <= 1) return 'end';
    return 'body';
  }

  function hasPropertyRowExactKeyAtBreath(group: GroupListItem, propertyId: string, breath: number): boolean {
    const propertyRow = Array.isArray(group.property_rows)
      ? group.property_rows.find((row) => row.property_id === propertyId) ?? null
      : null;
    return (propertyRow?.blocks ?? []).some((block) => Math.floor(block.breath) === Math.floor(breath) && block.is_blank !== true);
  }

  function getOrderedVisiblePropertyRows(group: GroupListItem): Array<{ property_id: string; kind: PropertyRowKind; label: string; blocks: Array<{ id: string; breath: number; start: number; end: number; is_blank?: boolean }> }> {
    return Array.isArray(group.property_rows)
      ? group.property_rows.filter((row): row is NonNullable<GroupListItem['property_rows']>[number] => row.kind === 'raster' || row.kind === 'move')
      : [];
  }

  function getPropertyRowY(layout: GroupSectionLayout, kind: PropertyRowKind): number {
    const fallbackIndex = kind === 'raster' ? 0 : 1;
    return layout.propertyRows.find((row) => row.kind === kind)?.y ?? layout.sectionTopY - getPropertyRowLocalYOffset(fallbackIndex);
  }

  function getPropertyRowDescriptor(layout: GroupSectionLayout, kind: PropertyRowKind): GroupSectionLayout['propertyRows'][number] | null {
    return layout.propertyRows.find((row) => row.kind === kind) ?? null;
  }

  function getPropertyRowDescriptorAtLocalY(layout: GroupSectionLayout, localY: number): GroupSectionLayout['propertyRows'][number] | null {
    return layout.propertyRows.find((row) => row.y === localY) ?? null;
  }

  function getPropertyRowDropIndex(layout: GroupSectionLayout, localY: number): number {
    if (layout.propertyRows.length < 1) return 0;
    for (let index = 0; index < layout.propertyRows.length; index += 1) {
      const row = layout.propertyRows[index]!;
      const next = layout.propertyRows[index + 1] ?? null;
      const threshold = next ? (row.y + next.y) / 2 : row.y - 0.5;
      if (localY >= threshold) return index;
    }
    return layout.propertyRows.length;
  }

  function reorderIds(ids: string[], sourceId: string, targetIndex: number): string[] {
    const existingIndex = ids.indexOf(sourceId);
    if (existingIndex < 0) return [...ids];
    const next = [...ids];
    next.splice(existingIndex, 1);
    const boundedIndex = Math.max(0, Math.min(next.length, targetIndex));
    next.splice(boundedIndex, 0, sourceId);
    return next;
  }

  function commitPropertyOrderDrag(layout: GroupSectionLayout): void {
    if (!propertyOrderDragState.active || !propertyOrderDragState.groupId || !propertyOrderDragState.propertyId) return;
    const sourceId = propertyOrderDragState.propertyId;
    const targetIndex = propertyOrderDragState.currentDropIndex;
    propertyOrderDragState.active = false;
    propertyOrderDragState.groupId = null;
    propertyOrderDragState.propertyId = null;
    propertyOrderDragState.currentDropIndex = null;
    if (targetIndex === null) return;
    const currentOrder = layout.propertyRows.map((row) => row.property_id);
    const nextOrder = reorderIds(currentOrder, sourceId, targetIndex);
    if (nextOrder.every((id, index) => id === currentOrder[index])) return;
    opts.on_reorder_group_properties?.(layout.item.id, nextOrder);
  }

  function getPropertyRowKindAtLocalY(layout: GroupSectionLayout, localY: number): PropertyRowKind | null {
    return getPropertyRowDescriptorAtLocalY(layout, localY)?.kind ?? null;
  }

  function getPropertyRowSegments(group: GroupListItem, descriptor: GroupSectionLayout['propertyRows'][number]): PropertyRowSegment[] {
    const exactRow = Array.isArray(group.property_rows)
      ? group.property_rows.find((row) => row.property_id === descriptor.property_id) ?? null
      : null;
    return exactRow
      ? exactRow.blocks.map((block) => ({
          property_id: descriptor.property_id,
          block_id: block.id,
          breath: block.breath,
          start: block.start,
          end: block.end,
          is_blank: block.is_blank === true,
          dominant_rgb: block.dominant_rgb,
        }))
      : [];
  }

  function getResolvedPropertyBlockSpan(group: GroupListItem, propertyId: string, span: { id: string; start: number; end: number }): { start: number; end: number } {
    let start = Math.floor(span.start);
    let end = Math.max(start, Math.floor(span.end));
    if (rasterDragState.active && rasterDragState.groupId === group.id && rasterDragState.propertyId === propertyId && rasterDragState.segmentId === span.id) {
      if (rasterDragState.mode === 'edge_start') {
        start = Math.max(0, Math.min(rasterDragState.previewBreath, rasterDragState.originalSegmentEnd));
        end = Math.max(start, rasterDragState.originalSegmentEnd);
      } else if (rasterDragState.mode === 'edge_end') {
        start = rasterDragState.originalSegmentStart;
        end = Math.max(start, rasterDragState.previewBreath);
      } else if (rasterDragState.mode === 'body_move') {
        const delta = rasterDragState.previewBreath - rasterDragState.anchorBreath;
        start = Math.max(0, rasterDragState.originalSegmentStart + delta);
        end = Math.max(start, rasterDragState.originalSegmentEnd + delta);
      } else if (rasterDragState.mode === 'edge_start_dynamic' || rasterDragState.mode === 'body_dynamic_resize') {
        if (rasterDragState.previewBreath < rasterDragState.anchorBreath) {
          start = Math.max(0, rasterDragState.originalSegmentStart + (rasterDragState.previewBreath - rasterDragState.anchorBreath));
          end = Math.max(start, rasterDragState.originalSegmentEnd);
        } else {
          start = rasterDragState.originalSegmentStart;
          end = Math.max(start, rasterDragState.originalSegmentEnd + (rasterDragState.previewBreath - rasterDragState.anchorBreath));
        }
      } else if (rasterDragState.mode === 'edge_end_dynamic') {
        start = rasterDragState.originalSegmentStart;
        end = Math.max(start, rasterDragState.previewBreath);
      }
    }
    return { start, end };
  }

  function getPropertyRowHit(layout: GroupSectionLayout, currentRect: Rect, localX: number, localY: number, kind?: PropertyRowKind): PropertyRowHit | null {
    const descriptor = kind ? getPropertyRowDescriptor(layout, kind) : getPropertyRowDescriptorAtLocalY(layout, localY);
    if (!descriptor) return null;
    for (const segment of getPropertyRowSegments(layout.item, descriptor)) {
      const segmentStart = Math.floor(segment.start);
      const segmentEnd = Math.max(segmentStart, Math.floor(segment.end));
      const startX = breathToTimelineX(currentRect, segmentStart) - currentRect.x0;
      const endX = breathToTimelineX(currentRect, segmentEnd) - currentRect.x0;
      if (localX < startX || localX > endX) continue;
      const breath = Math.floor(timelineXToBreath(currentRect, localX + currentRect.x0));
      return {
        propertyId: segment.property_id,
        blockId: segment.block_id,
        breath,
        mode: resolve_groups_raster_hit_mode_for_span({ start: segmentStart, end: segmentEnd, breath, is_blank: segment.is_blank }),
        isBlank: segment.is_blank,
      };
    }
    return null;
  }

  function getPropertyBlockDragSegment(group: GroupListItem, propertyId: string | null, blockId: string): { id: string; start: number; end: number; length_breaths: number; is_blank: boolean } | null {
    if (!propertyId) return null;
    const row = Array.isArray(group.property_rows)
      ? group.property_rows.find((entry) => entry.property_id === propertyId) ?? null
      : null;
    const block = row?.blocks.find((entry) => entry.id === blockId) ?? null;
    if (!block) return null;
    const start = Math.floor(block.start);
    const end = Math.max(start, Math.floor(block.end));
    return {
      id: block.id,
      start,
      end,
      length_breaths: Math.max(1, end - start + 1),
      is_blank: block.is_blank === true,
    };
  }

  function beginPendingBlockPress(args: {
    kind: 'raster' | 'move';
    groupId: string;
    propertyId: string | null;
    blockId: string;
    mode: 'edge_start' | 'edge_end' | 'body_move' | 'body_single' | 'blank_start' | 'blank_end' | 'blank_center' | 'blank_single';
    isBlank: boolean;
    button: number;
    localDownX: number;
    localDownY: number;
    breath: number;
  }): void {
    pendingBlockPress.active = true;
    pendingBlockPress.kind = args.kind;
    pendingBlockPress.groupId = args.groupId;
    pendingBlockPress.propertyId = args.propertyId;
    pendingBlockPress.blockId = args.blockId;
    pendingBlockPress.mode = args.mode;
    pendingBlockPress.isBlank = args.isBlank;
    pendingBlockPress.button = args.button;
    pendingBlockPress.localDownX = args.localDownX;
    pendingBlockPress.localDownY = args.localDownY;
    pendingBlockPress.breath = args.breath;
  }

  function getMoveRegionHit(layout: GroupSectionLayout, currentRect: Rect, localX: number, localY: number): { propertyId: string; blockId: string; breath: number } | null {
    if (getPropertyRowKindAtLocalY(layout, localY) !== 'move') return null;
    const hit = getPropertyRowHit(layout, currentRect, localX, localY);
    return hit ? { propertyId: hit.propertyId, blockId: hit.blockId, breath: hit.breath } : null;
  }

  function armRasterSegmentDrag(args: {
    kind: PropertyRowKind;
    group: GroupListItem;
    propertyId: string | null;
    segment: { id: string; start: number; end: number; length_breaths: number; is_blank: boolean };
    pendingMode: RasterHitMode;
    button: number;
    anchorBreath: number;
    previewBreath: number;
    finalMode: RasterDragMode;
  }): void {
    rasterDragState.active = true;
    rasterDragState.kind = args.kind;
    rasterDragState.groupId = args.group.id;
    rasterDragState.propertyId = args.propertyId;
    rasterDragState.segmentId = args.segment.id;
    rasterDragState.mode = args.finalMode;
    rasterDragState.button = args.button;
    rasterDragState.originalGroupStart = Math.floor(args.group.group_start ?? args.segment.start);
    rasterDragState.originalCropStart = Math.floor(args.group.breath_start ?? args.segment.start);
    rasterDragState.originalCropEnd = Math.max(rasterDragState.originalCropStart, Math.floor(args.group.breath_end ?? args.segment.end));
    rasterDragState.originalSegmentStart = args.segment.start;
    rasterDragState.originalSegmentEnd = args.segment.end;
    rasterDragState.originalLength = args.segment.length_breaths;
    rasterDragState.anchorBreath = args.anchorBreath;
    rasterDragState.previewBreath = args.previewBreath;
    rasterDragState.targetSegmentId = null;
    rasterDragState.targetPropertyId = null;
    groupsRasterDiag('arm_drag', {
      groupId: args.group.id,
      kind: args.kind,
      propertyId: args.propertyId ?? 'raster',
      segmentId: args.segment.id,
      isBlank: args.segment.is_blank,
      pendingMode: args.pendingMode,
      finalMode: args.finalMode,
      button: args.button,
      anchorBreath: args.anchorBreath,
      previewBreath: args.previewBreath,
      originalStart: rasterDragState.originalSegmentStart,
      originalEnd: rasterDragState.originalSegmentEnd,
    });
  }

  function commitBlankMergeDrag(): void {
    if (!blankMergeDragState.active || !blankMergeDragState.groupId || !blankMergeDragState.propertyId || !blankMergeDragState.segmentId || !blankMergeDragState.previewDirection) return;
    opts.on_merge_group_blank_property_block?.(blankMergeDragState.groupId, blankMergeDragState.propertyId, blankMergeDragState.segmentId, blankMergeDragState.previewDirection);
    blankMergeDragState.active = false;
    blankMergeDragState.groupId = null;
    blankMergeDragState.propertyId = null;
    blankMergeDragState.segmentId = null;
    blankMergeDragState.previewDirection = null;
  }

  function isBreathVisible(breath: number): boolean {
    const start = getTimelineViewStart();
    const end = getTimelineViewEnd(rect);
    return breath >= start && breath <= end;
  }

  function getVisibleContentSpans(group: GroupListItem): Array<{ start: number; end: number }> {
    const rasterRows = Array.isArray(group.property_rows)
      ? group.property_rows.filter((row) => row.kind === 'raster')
      : [];
    if (rasterRows.length > 0) {
      return rasterRows.flatMap((rasterRow) => rasterRow.blocks.map((block) => ({ start: Math.floor(block.start), end: Math.max(Math.floor(block.start), Math.floor(block.end)) })));
    }
    const groupBreathStart = Math.floor(group.breath_start ?? 0);
    const groupBreathEnd = Math.max(groupBreathStart, Math.floor(group.breath_end ?? groupBreathStart));
    return [{ start: groupBreathStart, end: groupBreathEnd }];
  }

  function isBreathInsideGroupCrop(group: GroupListItem, breath: number): boolean {
    const croppedStart = Math.floor(group.cropped_start ?? group.breath_start ?? 0);
    const croppedEnd = Math.max(croppedStart, Math.floor(group.cropped_end ?? group.breath_end ?? croppedStart));
    return breath >= croppedStart && breath <= croppedEnd;
  }

  function getRasterCellChar(args: {
    isBlank?: boolean;
    visible: boolean;
    isSingle: boolean;
    isFirst: boolean;
    isLast: boolean;
  }): string {
    if (args.isBlank) {
      if (args.isSingle) return '▢';
      if (args.isFirst) return '<';
      if (args.isLast) return '>';
      return '▢';
    }
    if (args.visible) {
      if (args.isSingle) return '█';
      if (args.isFirst) return '█';
      if (args.isLast) return '▦';
      return '▥';
    }
    if (args.isSingle) return '▒';
    if (args.isFirst) return '╺';
    if (args.isLast) return '╸';
    return '╌';
  }

  function getRasterSegments(group: GroupListItem): Array<{ id: string; start: number; end: number; length_breaths: number; is_blank: boolean }> {
    const rasterRows = Array.isArray(group.property_rows)
      ? group.property_rows.filter((row) => row.kind === 'raster')
      : [];
    return rasterRows.flatMap((rasterRow) => rasterRow.blocks.map((block) => ({
      id: block.id,
      start: Math.floor(block.start),
      end: Math.max(Math.floor(block.start), Math.floor(block.end)),
      length_breaths: Math.max(1, Math.floor(block.end) - Math.floor(block.start) + 1),
      is_blank: block.is_blank === true,
    })));
  }

  function getPropertyRowDrawSegments(group: GroupListItem, propertyId: string): PropertyRowDrawSegment[] {
    const propertyRow = Array.isArray(group.property_rows)
      ? group.property_rows.find((row) => row.property_id === propertyId) ?? null
      : null;
    if (propertyRow && propertyRow.blocks.length > 0) {
      return propertyRow.blocks.map((block) => ({
        id: block.id,
        breath: block.breath,
        start: block.start,
        end: block.end,
        is_blank: block.is_blank === true,
        dominant_rgb: block.dominant_rgb,
      }));
    }
    const rasterSegments = getRasterSegments(group);
    if (rasterSegments.length > 0) {
      return rasterSegments.map((segment) => ({ id: segment.id, breath: segment.start, start: segment.start, end: segment.end, is_blank: segment.is_blank }));
    }
    return getVisibleContentSpans(group).map((span, index) => ({ id: `fallback_${index}`, breath: Math.floor(span.start), start: Math.floor(span.start), end: Math.max(Math.floor(span.start), Math.floor(span.end)), is_blank: false }));
  }

  function removeEdgeBlankDrawSegments(segments: PropertyRowDrawSegment[]): { segments: PropertyRowDrawSegment[]; removedIds: string[] } {
    const sorted = [...segments].sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));
    const removedIds: string[] = [];
    while (sorted[0]?.is_blank) {
      removedIds.push(sorted[0].id);
      sorted.shift();
    }
    while (sorted[sorted.length - 1]?.is_blank) {
      const removed = sorted.pop();
      if (removed) removedIds.push(removed.id);
    }
    const nextSegments = sorted;
    return { segments: nextSegments, removedIds };
  }

  function orderActiveRasterSourceLast(propertyId: string, segments: PropertyRowDrawSegment[]): PropertyRowDrawSegment[] {
    if (!rasterDragState.active || rasterDragState.propertyId !== propertyId || !rasterDragState.segmentId || rasterDragState.mode === 'body_swap') return segments;
    const source = segments.find((segment) => segment.id === rasterDragState.segmentId) ?? null;
    if (!source) return segments;
    return [...segments.filter((segment) => segment.id !== source.id), source];
  }

  function rewritePreviewPropertyRowSegmentsDestructive(segments: PropertyRowDrawSegment[], sourceId: string, nextStart: number, nextEnd: number): PropertyRowDrawSegment[] {
    const source = segments.find((segment) => segment.id === sourceId) ?? null;
    if (!source) return segments;
    const minBreath = Math.min(source.start, nextStart, ...segments.map((segment) => segment.start));
    const maxBreath = Math.max(source.end, nextEnd, ...segments.map((segment) => segment.end));
    const cells: Array<{ source_id: string; is_blank: boolean; dominant_rgb?: { r: number; g: number; b: number } } | null> = [];
    for (let breath = minBreath; breath <= maxBreath; breath += 1) cells.push(null);

    for (const segment of segments) {
      const cell = { source_id: segment.id, is_blank: segment.is_blank, dominant_rgb: segment.dominant_rgb };
      for (let breath = segment.start; breath <= segment.end; breath += 1) cells[breath - minBreath] = cell;
    }

    for (let breath = source.start; breath <= source.end; breath += 1) cells[breath - minBreath] = null;
    const fillCell = { source_id: source.id, is_blank: source.is_blank, dominant_rgb: source.dominant_rgb };
    for (let breath = nextStart; breath <= nextEnd; breath += 1) cells[breath - minBreath] = fillCell;

    let firstContent = -1;
    let lastContent = -1;
    for (let index = 0; index < cells.length; index += 1) {
      if (!cells[index] || cells[index]!.is_blank) continue;
      if (firstContent < 0) firstContent = index;
      lastContent = index;
    }
    if (firstContent < 0 || lastContent < 0) return [{ ...source, start: nextStart, end: nextEnd, breath: nextStart }];

    const nextSegments: PropertyRowDrawSegment[] = [];
    const idUsage = new Map<string, number>();
    let cursor = firstContent;
    while (cursor <= lastContent) {
      const cell = cells[cursor] ?? null;
      let runEnd = cursor;
      while (runEnd + 1 <= lastContent) {
        const next = cells[runEnd + 1] ?? null;
        const sameBlank = (!cell || cell.is_blank) && (!next || next.is_blank);
        const sameContent = !!cell && !!next && !cell.is_blank && !next.is_blank && cell.source_id === next.source_id;
        if (!sameBlank && !sameContent) break;
        runEnd += 1;
      }
      const start = minBreath + cursor;
      const end = minBreath + runEnd;
      if (!cell || cell.is_blank) {
        nextSegments.push({ id: `preview_blank_${start}_${end}`, breath: start, start, end, is_blank: true });
      } else {
        const seen = idUsage.get(cell.source_id) ?? 0;
        idUsage.set(cell.source_id, seen + 1);
        nextSegments.push({
          id: seen === 0 ? cell.source_id : `${cell.source_id}__preview_${seen}`,
          breath: start,
          start,
          end,
          is_blank: false,
          dominant_rgb: cell.dominant_rgb,
        });
      }
      cursor = runEnd + 1;
    }
    return nextSegments;
  }

  function getPreviewPropertyRowSegments(group: GroupListItem, propertyId: string): PropertyRowDrawSegment[] {
    const baseSegments = getPropertyRowDrawSegments(group, propertyId);
    if (!rasterDragState.active || rasterDragState.groupId !== group.id) {
      return baseSegments.map((segment) => ({ ...segment, ...getResolvedPropertyBlockSpan(group, propertyId, segment) }));
    }
    if (rasterDragState.kind === 'move' && rasterDragState.propertyId === propertyId && rasterDragState.segmentId && rasterDragState.mode !== 'body_swap') {
      const source = baseSegments.find((segment) => segment.id === rasterDragState.segmentId) ?? null;
      if (source) {
        const resolved = getResolvedPropertyBlockSpan(group, propertyId, source);
        return rewritePreviewPropertyRowSegmentsDestructive(baseSegments, source.id, resolved.start, resolved.end);
      }
    }
    if (rasterDragState.mode !== 'body_swap' || rasterDragState.propertyId !== propertyId || !rasterDragState.segmentId || !rasterDragState.targetSegmentId) {
      return orderActiveRasterSourceLast(propertyId, baseSegments.map((segment) => ({ ...segment, ...getResolvedPropertyBlockSpan(group, propertyId, segment) })));
    }
    const source = baseSegments.find((segment) => segment.id === rasterDragState.segmentId) ?? null;
    const target = baseSegments.find((segment) => segment.id === rasterDragState.targetSegmentId) ?? null;
    if (!source || !target) return orderActiveRasterSourceLast(propertyId, baseSegments.map((segment) => ({ ...segment, ...getResolvedPropertyBlockSpan(group, propertyId, segment) })));

    const swapped = baseSegments.map((segment) => {
      if (segment.id === source.id) return { ...segment, start: target.start, end: target.end };
      if (segment.id === target.id) return { ...segment, start: source.start, end: source.end };
      return { ...segment };
    });
    const cleaned = removeEdgeBlankDrawSegments(swapped);
    const diagKey = JSON.stringify({
      groupId: group.id,
      propertyId,
      sourceId: source.id,
      targetId: target.id,
      removedEdgeBlankIds: cleaned.removedIds,
      spans: cleaned.segments.map((segment) => ({ id: segment.id, start: segment.start, end: segment.end, isBlank: segment.is_blank })),
    });
    if (diagKey !== lastSwapPreviewDiagKey) {
      lastSwapPreviewDiagKey = diagKey;
      groupsRasterDiag('swap_preview_resolved', JSON.parse(diagKey) as Record<string, unknown>);
    }
    return cleaned.segments;
  }

  function getRasterHit(layout: GroupSectionLayout, currentRect: Rect, localX: number, localY: number): { propertyId: string; segmentId: string; mode: 'edge_start' | 'edge_end' | 'body_move' | 'body_single' | 'blank_start' | 'blank_end' | 'blank_center' | 'blank_single'; breath: number; isBlank: boolean } | null {
    if (getPropertyRowKindAtLocalY(layout, localY) !== 'raster') return null;
    const hit = getPropertyRowHit(layout, currentRect, localX, localY);
    return hit ? { propertyId: hit.propertyId, segmentId: hit.blockId, mode: hit.mode, breath: hit.breath, isBlank: hit.isBlank } : null;
  }

  function getBlankCompactDirection(segment: { start: number; end: number }, hit: { mode: string; breath: number }): 'left' | 'right' {
    if (hit.mode === 'blank_start') return 'left';
    if (hit.mode === 'blank_end') return 'right';
    if (hit.mode === 'blank_single') return 'left';
    const midpoint = Math.floor((segment.start + segment.end) / 2);
    return hit.breath <= midpoint ? 'left' : 'right';
  }

  function clearPendingBlockPress(): void {
    pendingBlockPress.active = false;
    pendingBlockPress.kind = null;
    pendingBlockPress.groupId = null;
    pendingBlockPress.propertyId = null;
    pendingBlockPress.blockId = null;
    pendingBlockPress.mode = null;
    pendingBlockPress.isBlank = false;
    pendingBlockPress.button = 0;
    pendingBlockPress.localDownX = 0;
    pendingBlockPress.localDownY = 0;
    pendingBlockPress.breath = 0;
  }

  function clearPendingBlockSingleClick(): void {
    if (pendingBlockSingleClick.timeoutId !== null) window.clearTimeout(pendingBlockSingleClick.timeoutId);
    pendingBlockSingleClick.timeoutId = null;
    pendingBlockSingleClick.kind = null;
    pendingBlockSingleClick.groupId = null;
    pendingBlockSingleClick.propertyId = null;
    pendingBlockSingleClick.blockId = null;
    pendingBlockSingleClick.mode = null;
    pendingBlockSingleClick.isBlank = false;
    pendingBlockSingleClick.button = 0;
    pendingBlockSingleClick.breath = 0;
  }

  function commitBlockSingleClick(): void {
    if (!pendingBlockSingleClick.kind || !pendingBlockSingleClick.groupId) return;
    const group = getGroupById(pendingBlockSingleClick.groupId);
    if (!group) {
      clearPendingBlockSingleClick();
      return;
    }
    selectGroup(group);
    if (pendingBlockSingleClick.propertyId) opts.on_select_group_property?.(group.id, pendingBlockSingleClick.propertyId);
    clearPendingBlockSingleClick();
  }

  function scheduleBlockSingleClick(args: {
    kind: 'raster' | 'move';
    groupId: string;
    propertyId: string | null;
    blockId: string;
    mode: 'edge_start' | 'edge_end' | 'body_move' | 'body_single' | 'blank_start' | 'blank_end' | 'blank_center' | 'blank_single';
    isBlank: boolean;
    button: number;
    breath: number;
  }): void {
    clearPendingBlockSingleClick();
    pendingBlockSingleClick.kind = args.kind;
    pendingBlockSingleClick.groupId = args.groupId;
    pendingBlockSingleClick.propertyId = args.propertyId;
    pendingBlockSingleClick.blockId = args.blockId;
    pendingBlockSingleClick.mode = args.mode;
    pendingBlockSingleClick.isBlank = args.isBlank;
    pendingBlockSingleClick.button = args.button;
    pendingBlockSingleClick.breath = args.breath;
    pendingBlockSingleClick.timeoutId = window.setTimeout(() => {
      commitBlockSingleClick();
    }, BLOCK_DOUBLE_CLICK_MS);
  }

  function matchesPendingBlockSingleClick(args: {
    kind: 'raster' | 'move';
    groupId: string;
    propertyId: string | null;
    blockId: string;
    mode: 'edge_start' | 'edge_end' | 'body_move' | 'body_single' | 'blank_start' | 'blank_end' | 'blank_center' | 'blank_single';
    button: number;
  }): boolean {
    return pendingBlockSingleClick.kind === args.kind
      && pendingBlockSingleClick.groupId === args.groupId
      && pendingBlockSingleClick.propertyId === args.propertyId
      && pendingBlockSingleClick.blockId === args.blockId
      && pendingBlockSingleClick.mode === args.mode
      && pendingBlockSingleClick.button === args.button;
  }

  function deletePropertyBlockAtHit(group: GroupListItem, propertyId: string | null, blockId: string): void {
    if (!propertyId) return;
    opts.on_blank_group_property_block?.(group.id, propertyId, blockId);
  }

  function handlePropertyBlockDoubleClick(group: GroupListItem, propertyId: string | null, button: number, hit: { segmentId: string; mode: 'edge_start' | 'edge_end' | 'body_move' | 'body_single' | 'blank_start' | 'blank_end' | 'blank_center' | 'blank_single'; breath: number; isBlank: boolean }, currentRect: Rect, localX: number): void {
    opts.on_select_group_property?.(group.id, propertyId ?? 'raster');
    if (hit.isBlank) {
      if (button !== 2) return;
      const blankSegment = getPropertyBlockDragSegment(group, propertyId, hit.segmentId);
      if (!blankSegment) return;
      const direction = getBlankCompactDirection(blankSegment, hit);
      if (!propertyId) return;
      if (direction === 'left') opts.on_compact_group_blank_property_block_left?.(group.id, propertyId, hit.segmentId);
      else opts.on_merge_group_blank_property_block?.(group.id, propertyId, hit.segmentId, 'right');
      return;
    }
    if (button === 0) {
      if (hit.mode === 'body_move') {
        if (propertyId) opts.on_split_group_property_block?.(group.id, propertyId, hit.segmentId, timelineXToBreath(currentRect, localX + currentRect.x0));
      }
      return;
    }
    if (button === 2) deletePropertyBlockAtHit(group, propertyId, hit.segmentId);
  }

  function updateRasterHoverState(currentRect: Rect, pointerX: number, pointerY: number): void {
    const layout = getLayoutAtPointer(currentRect, pointerX, pointerY);
    if (!layout) {
      if (rasterHoverState.groupId || rasterHoverState.segmentId || rasterHoverState.mode !== null) groupsHoverDiag('raster_change', { groupId: null, propertyId: null, blockId: null, breath: null, mode: null, isBlank: null });
      rasterHoverState = { groupId: null, segmentId: null, breath: null, mode: null };
      return;
    }
    const localX = pointerX - currentRect.x0;
    const localY = pointerY - currentRect.y0;
    const hit = getRasterHit(layout, currentRect, localX, localY);
    if (!hit) {
      if (rasterHoverState.groupId || rasterHoverState.segmentId || rasterHoverState.mode !== null) groupsHoverDiag('raster_change', { groupId: null, propertyId: null, blockId: null, breath: null, mode: null, isBlank: null });
      rasterHoverState = { groupId: null, segmentId: null, breath: null, mode: null };
      return;
    }
    const descriptor = getPropertyRowDescriptorAtLocalY(layout, localY);
    const changed = rasterHoverState.groupId !== layout.item.id
      || rasterHoverState.segmentId !== hit.segmentId
      || rasterHoverState.breath !== hit.breath
      || rasterHoverState.mode !== hit.mode;
    rasterHoverState = {
      groupId: layout.item.id,
      segmentId: hit.segmentId,
      breath: hit.breath,
      mode: hit.mode,
    };
    if (changed) groupsHoverDiag('raster_change', {
      groupId: layout.item.id,
      propertyId: descriptor?.property_id ?? 'raster',
      blockId: hit.segmentId,
      breath: hit.breath,
      mode: hit.mode,
      isBlank: hit.isBlank,
    });
  }

  function updateMoveHoverState(currentRect: Rect, pointerX: number, pointerY: number): void {
    const layout = getLayoutAtPointer(currentRect, pointerX, pointerY);
    if (!layout) {
      if (moveHoverState.groupId || moveHoverState.blockId) groupsHoverDiag('move_change', { groupId: null, propertyId: null, blockId: null, breath: null });
      moveHoverState = { groupId: null, propertyId: null, blockId: null, breath: null };
      return;
    }
    const localX = pointerX - currentRect.x0;
    const localY = pointerY - currentRect.y0;
    const hit = getMoveRegionHit(layout, currentRect, localX, localY);
    if (!hit) {
      if (moveHoverState.groupId || moveHoverState.blockId) groupsHoverDiag('move_change', { groupId: null, propertyId: null, blockId: null, breath: null });
      moveHoverState = { groupId: null, propertyId: null, blockId: null, breath: null };
      return;
    }
    const changed = moveHoverState.groupId !== layout.item.id
      || moveHoverState.propertyId !== hit.propertyId
      || moveHoverState.blockId !== hit.blockId
      || moveHoverState.breath !== hit.breath;
    moveHoverState = {
      groupId: layout.item.id,
      propertyId: hit.propertyId,
      blockId: hit.blockId,
      breath: hit.breath,
    };
    if (changed) groupsHoverDiag('move_change', moveHoverState);
  }

  function getRasterInteractionStyle(groupId: string, segmentId: string, breath: number): InteractionStyle {
    const hoverMatchesGroup = rasterHoverState.groupId === groupId && rasterHoverState.segmentId === segmentId;
    const hoverMatchesBreath = hoverMatchesGroup && rasterHoverState.breath === breath;
    const dragMatchesSource = rasterDragState.active && rasterDragState.groupId === groupId && rasterDragState.segmentId === segmentId;
    const dragMatchesTarget = rasterDragState.active && rasterDragState.groupId === groupId && rasterDragState.targetSegmentId === segmentId && rasterDragState.segmentId !== segmentId;
    const dragMatchesWholeGroupMove = rasterDragState.active && rasterDragState.groupId === groupId && rasterDragState.mode === 'body_move' && rasterDragState.button === 0;
    const pendingMatches = pendingBlockPress.active && pendingBlockPress.kind === 'raster' && pendingBlockPress.groupId === groupId && pendingBlockPress.blockId === segmentId;
    const blankMergeMatches = blankMergeDragState.active && blankMergeDragState.groupId === groupId && blankMergeDragState.segmentId === segmentId;

    if (dragMatchesTarget) return { rgb: rasterSwapTargetColor, weight: 2 };
    if (blankMergeMatches) {
      return { rgb: blankMergeDragState.previewDirection === 'right' ? rasterRightDragColor : rasterLeftDragColor, weight: 3 };
    }
    if (pendingMatches && pendingBlockPress.button === 2) return { rgb: rasterRightDragColor, weight: 3 };
    if (pendingMatches && pendingBlockPress.button === 0) return { rgb: rasterLeftDragColor, weight: 3 };
    if (dragMatchesWholeGroupMove) return { rgb: rasterLeftDragColor, weight: 3 };
    if (dragMatchesSource && rasterDragState.button === 2) return { rgb: rasterRightDragColor, weight: 3 };
    if (dragMatchesSource && rasterDragState.button === 0) return { rgb: rasterLeftDragColor, weight: 3 };
    if (hoverMatchesBreath) return { rgb: rasterHoverColor, weight: 3 };
    if (hoverMatchesGroup) return { rgb: rasterHoverColor, weight: 2 };
    return { rgb: rasterDefaultColor, weight: 1 };
  }

  function getMoveInteractionStyle(groupId: string, propertyId: string, blockId: string, breath: number): InteractionStyle {
    const hoverMatchesBlock = moveHoverState.groupId === groupId && moveHoverState.propertyId === propertyId && moveHoverState.blockId === blockId;
    const hoverMatchesBreath = hoverMatchesBlock && moveHoverState.breath === breath;
    const sharedDragMatchesSource = rasterDragState.active
      && rasterDragState.kind === 'move'
      && rasterDragState.groupId === groupId
      && rasterDragState.propertyId === propertyId
      && rasterDragState.segmentId === blockId;
    const sharedDragMatchesTarget = rasterDragState.active
      && rasterDragState.kind === 'move'
      && rasterDragState.groupId === groupId
      && rasterDragState.propertyId === propertyId
      && rasterDragState.targetSegmentId === blockId
      && rasterDragState.segmentId !== blockId;
    if (sharedDragMatchesTarget) return { rgb: rasterSwapTargetColor, weight: 2 };
    if (sharedDragMatchesSource && rasterDragState.button === 2) return { rgb: rasterRightDragColor, weight: 3 };
    if (sharedDragMatchesSource && rasterDragState.button === 0) return { rgb: rasterLeftDragColor, weight: 3 };
    if (hoverMatchesBreath) return { rgb: rasterHoverColor, weight: 3 };
    if (hoverMatchesBlock) return { rgb: rasterHoverColor, weight: 2 };
    return { rgb: rasterDefaultColor, weight: 1 };
  }

  function drawPropertyRowSegments(c: Canvas, args: {
    currentRect: Rect;
    rowY: number;
    segments: PropertyRowDrawSegment[];
    cellForBreath: (segment: PropertyRowDrawSegment, breath: number) => { char: string; rgb: { r: number; g: number; b: number }; weight: number; renderIndex?: number };
  }): void {
    for (const segment of args.segments) {
      for (let breath = Math.max(segment.start, getTimelineViewStart()); breath <= Math.min(segment.end, getTimelineViewEnd(rect)); breath += 1) {
        const x = breathToTimelineX(args.currentRect, breath);
        const cell = args.cellForBreath(segment, breath);
        c.set(x, args.rowY, {
          char: cell.char,
          rgb: cell.rgb,
          weight_index: cell.weight,
          render_index: cell.renderIndex ?? 2,
        });
      }
    }
  }

  function clearActivePropertyBlockDrag(): void {
    rasterDragState.active = false;
    rasterDragState.kind = null;
    rasterDragState.groupId = null;
    rasterDragState.propertyId = null;
    rasterDragState.segmentId = null;
    rasterDragState.mode = null;
    rasterDragState.button = 0;
    rasterDragState.originalGroupStart = 0;
    rasterDragState.originalCropStart = 0;
    rasterDragState.originalCropEnd = 0;
    rasterDragState.originalSegmentStart = 0;
    rasterDragState.originalSegmentEnd = 0;
    rasterDragState.originalLength = 1;
    rasterDragState.anchorBreath = 0;
    rasterDragState.previewBreath = 0;
    rasterDragState.targetSegmentId = null;
    rasterDragState.targetPropertyId = null;
  }

  function commitPropertyBlockDrag(): void {
    if (!rasterDragState.active || !rasterDragState.groupId || !rasterDragState.propertyId || !rasterDragState.segmentId || !rasterDragState.mode) return;
    const delta = rasterDragState.previewBreath - rasterDragState.anchorBreath;
    groupsRasterDiag('commit_drag', {
      groupId: rasterDragState.groupId,
      kind: rasterDragState.kind,
      propertyId: rasterDragState.propertyId,
      segmentId: rasterDragState.segmentId,
      mode: rasterDragState.mode,
      button: rasterDragState.button,
      anchorBreath: rasterDragState.anchorBreath,
      previewBreath: rasterDragState.previewBreath,
      delta,
      targetSegmentId: rasterDragState.targetSegmentId,
    });
    if (rasterDragState.mode === 'body_move') {
      opts.on_move_group_property_block?.(rasterDragState.groupId, rasterDragState.propertyId, rasterDragState.segmentId, Math.max(0, rasterDragState.originalSegmentStart + delta));
    } else if (rasterDragState.mode === 'edge_start') {
      opts.on_set_group_property_block_edge_destructive?.(
        rasterDragState.groupId,
        rasterDragState.propertyId,
        rasterDragState.segmentId,
        'start',
        Math.max(0, Math.min(rasterDragState.previewBreath, rasterDragState.originalSegmentEnd)),
      );
    } else if (rasterDragState.mode === 'edge_end') {
      opts.on_set_group_property_block_edge_destructive?.(
        rasterDragState.groupId,
        rasterDragState.propertyId,
        rasterDragState.segmentId,
        'end',
        Math.max(rasterDragState.originalSegmentStart, rasterDragState.previewBreath),
      );
    } else if (rasterDragState.mode === 'edge_start_dynamic') {
      opts.on_set_group_property_block_edge_destructive?.(
        rasterDragState.groupId,
        rasterDragState.propertyId,
        rasterDragState.segmentId,
        'start',
        Math.max(0, Math.min(rasterDragState.previewBreath, rasterDragState.originalSegmentEnd)),
      );
    } else if (rasterDragState.mode === 'body_dynamic_resize') {
      if (rasterDragState.previewBreath < rasterDragState.anchorBreath) {
        opts.on_set_group_property_block_edge_destructive?.(
          rasterDragState.groupId,
          rasterDragState.propertyId,
          rasterDragState.segmentId,
          'start',
          Math.max(0, rasterDragState.previewBreath),
        );
      } else if (rasterDragState.previewBreath > rasterDragState.anchorBreath) {
        opts.on_set_group_property_block_edge_destructive?.(
          rasterDragState.groupId,
          rasterDragState.propertyId,
          rasterDragState.segmentId,
          'end',
          Math.max(rasterDragState.originalSegmentStart, rasterDragState.previewBreath),
        );
      }
    } else if (rasterDragState.mode === 'edge_end_dynamic') {
      opts.on_set_group_property_block_edge_destructive?.(
        rasterDragState.groupId,
        rasterDragState.propertyId,
        rasterDragState.segmentId,
        'end',
        Math.max(rasterDragState.originalSegmentStart, rasterDragState.previewBreath),
      );
    } else if (rasterDragState.mode === 'body_swap') {
      const targetSegmentId = rasterDragState.targetSegmentId;
      const swapWillFire = !!targetSegmentId && targetSegmentId !== rasterDragState.segmentId;
      groupsRasterDiag('commit_swap', {
        groupId: rasterDragState.groupId,
        kind: rasterDragState.kind,
        propertyId: rasterDragState.propertyId,
        sourceSegmentId: rasterDragState.segmentId,
        targetSegmentId,
        targetPropertyId: rasterDragState.targetPropertyId,
        fired: swapWillFire,
      });
      if (swapWillFire) {
        opts.on_swap_group_property_blocks?.(rasterDragState.groupId, rasterDragState.propertyId, rasterDragState.segmentId, targetSegmentId);
      }
    }
    clearActivePropertyBlockDrag();
  }

  function getResolvedGroupSpan(group: GroupListItem): { start: number; end: number } {
    const baseStart = Math.floor(group.breath_start ?? 0);
    const baseEnd = Math.max(baseStart, Math.floor(group.breath_end ?? baseStart));
    return { start: baseStart, end: baseEnd };
  }

  function getSectionHeight(group: GroupListItem): number {
    return getOrderedVisiblePropertyRows(group).length + 7;
  }

  function buildSectionLayout(group: GroupListItem, sectionTopY: number): GroupSectionLayout {
    const propertyRows = getOrderedVisiblePropertyRows(group).map((row, index) => ({
      property_id: row.property_id,
      kind: row.kind,
      label: row.label,
      y: sectionTopY - getPropertyRowLocalYOffset(index),
    }));
    const propertyCount = propertyRows.length;
    return {
      item: group,
      sectionTopY,
      sectionBottomY: sectionTopY - (getSectionHeight(group) - 1),
      titleRowY: sectionTopY - 1,
      propertyRows,
      spacerRowY: sectionTopY - (propertyCount + 2),
      turnRowY: sectionTopY - (propertyCount + 3),
      transRowY: sectionTopY - (propertyCount + 4),
      footerRowY: sectionTopY - (propertyCount + 5),
    };
  }

  function getSectionSpan(group: GroupListItem): number {
    return getSectionHeight(group) + SECTION_SPACING;
  }

  function getMaxScrollSectionOffset(currentRect: Rect, groups: GroupListItem[]): number {
    const metrics = getContentMetrics(currentRect);
    const totalHeight = groups.reduce((sum, group) => sum + getSectionSpan(group), 0);
    return Math.max(0, totalHeight - metrics.contentHeight);
  }

  function clampScroll(currentRect: Rect, groups: GroupListItem[]): void {
    const max = getMaxScrollSectionOffset(currentRect, groups);
    if (scrollOffset < 0) scrollOffset = 0;
    if (scrollOffset > max) scrollOffset = max;
  }

  function getVisibleLayouts(currentRect: Rect, groups: GroupListItem[]): GroupSectionLayout[] {
    clampScroll(currentRect, groups);
    const { contentTopY, contentBottomY } = getContentMetrics(currentRect);
    const layouts: GroupSectionLayout[] = [];
    let nextSectionTopY = contentTopY + scrollOffset;
    for (let i = 0; i < groups.length; i += 1) {
      const group = groups[i]!;
      const layout = buildSectionLayout(group, nextSectionTopY);
      if (!(layout.sectionTopY < contentBottomY || layout.sectionBottomY > contentTopY)) layouts.push(layout);
      nextSectionTopY -= getSectionSpan(group);
    }
    return layouts;
  }

  function getDropIndexForPointer(currentRect: Rect, pointerY: number, groups: GroupListItem[]): number {
    const localY = pointerY - currentRect.y0;
    const { contentTopY } = getContentMetrics(currentRect);
    let cursorTopY = contentTopY + scrollOffset;
    for (let index = 0; index < groups.length; index += 1) {
      const span = getSectionSpan(groups[index]!);
      const midpoint = cursorTopY - Math.floor(span / 2);
      if (localY >= midpoint) return index;
      cursorTopY -= span;
    }
    return groups.length;
  }

  function getLayoutAtPointer(currentRect: Rect, x: number, y: number): GroupSectionLayout | null {
    const localX = x - currentRect.x0;
    const localY = y - currentRect.y0;
    void localX;
    const groups = getGroups();
    for (const layout of getVisibleLayouts(currentRect, groups)) {
      const sectionTopLocal = layout.sectionTopY;
      const sectionBottomLocal = layout.sectionBottomY;
      if (localY <= sectionTopLocal && localY >= sectionBottomLocal) return layout;
    }
    return null;
  }

  function drawHeader(c: Canvas): void {
    const metrics = getContentMetrics(rect);
    const headerY = rect.y0 + metrics.headerRow2Y;
    const titleY = rect.y0 + metrics.headerRow1Y;
    const timelineRegion = getTimelineRegion(rect);
    const timelineStart = getTimelineViewStart();
    const timelineEnd = getTimelineViewEnd(rect);
    const fileRange = getFileBreathRange();
    const loopRange = getResolvedLoopBreathRange();
    c.set(rect.x1 - 2, rect.y0 + metrics.titleRowY, { char: '[', rgb: borderColor, weight_index: 1, render_index: MODULE_CHROME_RENDER_INDEX + 1 });
    c.set(rect.x1 - 1, rect.y0 + metrics.titleRowY, { char: '+', rgb: visibleColor, weight_index: 2, render_index: MODULE_CHROME_RENDER_INDEX + 1 });
    c.set(rect.x0 + 1, titleY, { char: '☰', rgb: dragHandleColor, weight_index: 1, render_index: MODULE_CHROME_RENDER_INDEX + 1 });
    c.set(rect.x0 + 3, titleY, { char: '✕', rgb: deleteColor, weight_index: 2, render_index: MODULE_CHROME_RENDER_INDEX + 1 });
    c.set(rect.x0 + 5, titleY, { char: '+', rgb: visibleColor, weight_index: 2, render_index: MODULE_CHROME_RENDER_INDEX + 1 });
    c.set(rect.x0 + 7, titleY, { char: '$', rgb: visibleColor, weight_index: 2, render_index: MODULE_CHROME_RENDER_INDEX + 1 });
    const titleLabel = 'GROUPS';
    const titleStart = rect.x0 + 11;
    for (let i = 0; i < titleLabel.length && titleStart + i < rect.x1 - 14; i += 1) {
      c.set(titleStart + i, titleY, {
        char: titleLabel[i]!,
        rgb: textColor,
        weight_index: 1,
        render_index: MODULE_CHROME_RENDER_INDEX + 1,
      });
    }
    c.set(rect.x0 + 1, headerY, { char: '≋', rgb: mutedColor, weight_index: 1, render_index: MODULE_CHROME_RENDER_INDEX + 1 });
    c.set(rect.x0 + 3, headerY, { char: '✕', rgb: mutedColor, weight_index: 1, render_index: MODULE_CHROME_RENDER_INDEX + 1 });
    c.set(rect.x0 + 5, headerY, { char: '+', rgb: mutedColor, weight_index: 1, render_index: MODULE_CHROME_RENDER_INDEX + 1 });
    c.set(rect.x0 + 7, headerY, { char: '$', rgb: hiddenColor, weight_index: 1, render_index: MODULE_CHROME_RENDER_INDEX + 1 });
    const autoKeyLabel = 'AUTO KEY';
    const autoKeyStart = rect.x0 + 15;
    for (let i = 0; i < autoKeyLabel.length && autoKeyStart + i < rect.x1 - 14; i += 1) {
      c.set(autoKeyStart + i, headerY, {
        char: autoKeyLabel[i]!,
        rgb: mutedColor,
        weight_index: 1,
        render_index: MODULE_CHROME_RENDER_INDEX + 1,
      });
    }
    const autoKeyBoxStart = Math.min(rect.x1 - 10, autoKeyStart + autoKeyLabel.length + 2);
    const autoKeyEnabled = getAutoKeyEnabled();
    c.set(autoKeyBoxStart, headerY, { char: '[', rgb: mutedColor, weight_index: 1, render_index: MODULE_CHROME_RENDER_INDEX + 1 });
    c.set(autoKeyBoxStart + 1, headerY, { char: autoKeyEnabled ? 'x' : ' ', rgb: autoKeyEnabled ? selectedColor : mutedColor, weight_index: autoKeyEnabled ? 2 : 1, render_index: MODULE_CHROME_RENDER_INDEX + 1 });
    c.set(autoKeyBoxStart + 2, headerY, { char: ']', rgb: mutedColor, weight_index: 1, render_index: MODULE_CHROME_RENDER_INDEX + 1 });
    for (let x = timelineRegion.startX; x <= timelineRegion.endX; x += 1) {
      c.set(x, headerY, { char: ' ', rgb: mutedColor, weight_index: 0, render_index: MODULE_CHROME_RENDER_INDEX + 1 });
    }
    for (let breath = Math.max(fileRange.start, timelineStart); breath <= Math.min(fileRange.end, timelineEnd); breath += 1) {
      const x = breathToTimelineX(rect, breath);
      c.set(x, headerY, { char: '─', rgb: textColor, weight_index: 1, render_index: MODULE_CHROME_RENDER_INDEX + 1 });
    }
    if (fileRange.start >= timelineStart && fileRange.start <= timelineEnd) {
      c.set(breathToTimelineX(rect, fileRange.start), headerY, { char: '[', rgb: textColor, weight_index: 2, render_index: MODULE_CHROME_RENDER_INDEX + 1 });
    }
    if (fileRange.end >= timelineStart && fileRange.end <= timelineEnd) {
      c.set(breathToTimelineX(rect, fileRange.end), headerY, { char: ']', rgb: textColor, weight_index: 2, render_index: MODULE_CHROME_RENDER_INDEX + 1 });
    }
    for (let breath = Math.max(loopRange.start, timelineStart); breath <= Math.min(loopRange.end, timelineEnd); breath += 1) {
      const x = breathToTimelineX(rect, breath);
      const localIndex = breath - loopRange.start;
      const isSingle = loopRange.start === loopRange.end;
      const isFirst = localIndex === 0;
      const isLast = breath === loopRange.end;
      c.set(x, headerY, {
        char: getRasterCellChar({ visible: true, isSingle, isFirst, isLast }),
        rgb: selectedColor,
        weight_index: loopWindowDrag.active ? 3 : 2,
        render_index: MODULE_CHROME_RENDER_INDEX + 2,
      });
    }
    const startLabel = String(timelineStart);
    for (let i = 0; i < startLabel.length && timelineRegion.startX + 2 + i < timelineRegion.endX; i += 1) {
      c.set(timelineRegion.startX + 2 + i, titleY, { char: startLabel[i]!, rgb: mutedColor, weight_index: 1, render_index: MODULE_CHROME_RENDER_INDEX + 1 });
    }
    const endLabel = String(timelineEnd);
    for (let i = 0; i < endLabel.length && timelineRegion.endX - endLabel.length + 1 + i < rect.x1 - 1; i += 1) {
      c.set(timelineRegion.endX - endLabel.length + 1 + i, titleY, { char: endLabel[i]!, rgb: mutedColor, weight_index: 1, render_index: MODULE_CHROME_RENDER_INDEX + 1 });
    }
    const breathLabel = String(getCurrentBreath());
    const cursorX = breathToTimelineX(rect, getCurrentBreath());
    for (let i = 0; i < breathLabel.length && cursorX + i < timelineRegion.endX; i += 1) {
      c.set(cursorX + i, titleY, {
        char: breathLabel[i]!,
        rgb: selectedColor,
        weight_index: 2,
        render_index: MODULE_CHROME_RENDER_INDEX + 1,
      });
    }
    c.set(cursorX, headerY, { char: '║', rgb: selectedColor, weight_index: 2, render_index: MODULE_CHROME_RENDER_INDEX + 2 });
    const separatorY = rect.y0 + metrics.dividerY;
    draw_panel_horizontal_divider(c, {
      y: separatorY,
      rect,
      style: PANEL_BORDER_PRESETS.default_double.style,
      rgb: borderColor,
      weight_index: 1,
    });
  }

  function drawSectionFrame(c: Canvas, layout: GroupSectionLayout): void {
    const left = rect.x0 + 1;
    const right = rect.x1 - 1;
    for (let x = left; x < right; x += 1) {
      c.set(x, rect.y0 + layout.sectionTopY, { char: '─', rgb: borderColor, weight_index: 1, render_index: 1 });
      c.set(x, rect.y0 + layout.sectionBottomY, { char: '─', rgb: borderColor, weight_index: 1, render_index: 1 });
    }
    c.set(left, rect.y0 + layout.sectionTopY, { char: '┌', rgb: borderColor, weight_index: 1, render_index: 1 });
    c.set(right, rect.y0 + layout.sectionTopY, { char: '┐', rgb: borderColor, weight_index: 1, render_index: 1 });
    c.set(left, rect.y0 + layout.sectionBottomY, { char: '└', rgb: borderColor, weight_index: 1, render_index: 1 });
    c.set(right, rect.y0 + layout.sectionBottomY, { char: '┘', rgb: borderColor, weight_index: 1, render_index: 1 });
    for (let y = layout.sectionBottomY + 1; y < layout.sectionTopY; y += 1) {
      c.set(left, rect.y0 + y, { char: '│', rgb: borderColor, weight_index: 1, render_index: 1 });
      c.set(right, rect.y0 + y, { char: '│', rgb: borderColor, weight_index: 1, render_index: 1 });
    }

    const dividerA = rect.x0 + Math.min(rect.x1 - rect.x0 - 2, 9);
    const dividerB = rect.x0 + Math.min(rect.x1 - rect.x0 - 2, 17);
    const dividerC = rect.x0 + Math.min(rect.x1 - rect.x0 - 2, 26);
    for (let y = layout.sectionBottomY + 1; y < layout.sectionTopY; y += 1) {
      if (dividerA < right) c.set(dividerA, rect.y0 + y, { char: '│', rgb: borderColor, weight_index: 1, render_index: 1 });
      if (dividerB < right) c.set(dividerB, rect.y0 + y, { char: '│', rgb: borderColor, weight_index: 1, render_index: 1 });
      if (dividerC < right) c.set(dividerC, rect.y0 + y, { char: '│', rgb: borderColor, weight_index: 1, render_index: 1 });
    }
  }

  function drawSectionContent(c: Canvas, layout: GroupSectionLayout): void {
    const group = layout.item;
    const isBeingRenamed = renameState.isRenaming && renameState.groupId === group.id;
    const currentBreath = getCurrentBreath();
    const rasterSegments = getRasterSegments(layout.item);
    const hasExactContentState = rasterSegments.some((segment) => currentBreath >= segment.start && currentBreath <= segment.end);
    const propertyRowStates = layout.propertyRows.map((descriptor) => {
      const row = Array.isArray(group.property_rows)
        ? group.property_rows.find((entry) => entry.property_id === descriptor.property_id) ?? null
        : null;
      const isSelectedProperty = group.selected_property_id === descriptor.property_id;
      return {
        descriptor,
        label: (row?.label || descriptor.label || descriptor.kind).slice(0, 5),
        selected: isSelectedProperty,
        active: (row?.blocks ?? []).some((block) => currentBreath >= block.start && currentBreath <= block.end),
      };
    });
    const firstPropertyRowY = layout.propertyRows[0]?.y ?? layout.sectionTopY - 2;
    const secondPropertyRowY = layout.propertyRows[1]?.y ?? layout.sectionTopY - 4;
    const rowColor = group.selected ? selectedColor : textColor;
    const titleWorldY = rect.y0 + layout.titleRowY;
    const nameStart = rect.x0 + 2;
    const titlePrefix = `Group ${getVisualOrder(group.id)}`;
    for (let i = 0; i < titlePrefix.length && nameStart + i < rect.x1 - 2; i += 1) {
      c.set(nameStart + i, titleWorldY, {
        char: titlePrefix[i]!,
        rgb: rowColor,
        weight_index: group.selected ? 2 : 1,
        render_index: 2,
      });
    }

    const leftText = (group.subtitle?.trim() || 'none').slice(0, 5);
    const leftRows = [
      { y: firstPropertyRowY, label: 'lane1', color: mutedColor, weight: 1 },
      { y: layout.spacerRowY, label: leftText, color: rowColor, weight: 2 },
      { y: secondPropertyRowY, label: 'lane2', color: mutedColor, weight: 1 },
      { y: layout.turnRowY, label: 'none', color: mutedColor, weight: 1 },
    ];
    for (const row of leftRows) {
      const label = row.label;
      for (let j = 0; j < label.length && rect.x0 + 2 + j < rect.x0 + 8; j += 1) {
        c.set(rect.x0 + 2 + j, rect.y0 + row.y, { char: label[j]!, rgb: row.color, weight_index: row.weight, render_index: 2 });
      }
    }

    const middleRows = [
      { y: layout.titleRowY, text: 'drag :', color: mutedColor },
      { y: firstPropertyRowY, text: `hide ${group.visible === false ? 'o' : 'a'}`, color: rowColor },
      ...layout.propertyRows.slice(1).map((row) => ({ y: row.y, text: 'row  :', color: mutedColor })),
      { y: layout.spacerRowY, text: `ordr ${getVisualOrder(group.id)}`, color: mutedColor },
      { y: layout.turnRowY, text: 'del  x', color: deleteColor },
      { y: layout.transRowY, text: '+mv/+r', color: visibleColor },
    ];
    for (const row of middleRows) {
      const label = row.text;
      for (let j = 0; j < label.length && rect.x0 + 11 + j < rect.x0 + 17; j += 1) {
        c.set(rect.x0 + 11 + j, rect.y0 + row.y, { char: row.text[j]!, rgb: row.color, weight_index: 1, render_index: 2 });
      }
    }

    const propertyRows = [
      ...propertyRowStates.map((row) => ({ y: row.descriptor.y, label: row.label, color: row.selected ? visibleColor : row.active ? selectedColor : rowColor, weight: row.selected ? 3 : 2 })),
      { y: layout.turnRowY, label: 'turn', color: mutedColor, weight: 1 },
      { y: layout.transRowY, label: 'trans', color: mutedColor, weight: 1 },
    ];
    for (const row of propertyRows) {
      const label = row.label;
      for (let j = 0; j < label.length && rect.x0 + 20 + j < rect.x0 + 26; j += 1) {
        c.set(rect.x0 + 20 + j, rect.y0 + row.y, {
          char: label[j]!,
          rgb: row.color,
          weight_index: row.weight,
          render_index: 2,
        });
      }
    }

    const timelineRegion = getTimelineRegion(rect);
    const timelineStartX = timelineRegion.startX;
    const timelineEndX = timelineRegion.endX;
    for (const descriptor of layout.propertyRows) {
      const rowY = rect.y0 + descriptor.y;
      for (let x = timelineStartX; x <= timelineEndX; x += 1) {
        c.set(x, rowY, { char: ' ', rgb: mutedColor, weight_index: 0, render_index: 1 });
      }
      if (descriptor.kind === 'raster') {
        drawPropertyRowSegments(c, {
          currentRect: rect,
          rowY,
          segments: getPreviewPropertyRowSegments(group, descriptor.property_id),
          cellForBreath: (segment, breath) => {
            const localIndex = breath - segment.start;
            const visible = isBreathInsideGroupCrop(layout.item, breath);
            const isSingle = segment.start === segment.end;
            const isFirst = localIndex === 0;
            const isLast = breath === segment.end;
            const interactionStyle = getRasterInteractionStyle(group.id, segment.id, breath);
            const visualStyle = resolve_groups_raster_visual_style({
              is_blank: segment.is_blank,
              visible,
              selected_property: group.selected_property_id === descriptor.property_id,
              interaction: interactionStyle,
              muted_rgb: mutedColor,
              selected_rgb: visibleColor,
              content_rgb: segment.dominant_rgb,
              blank_rgb: rasterDefaultColor,
            });
            const baseWeight = segment.is_blank ? (visible ? (isSingle || isFirst || isLast ? 2 : 1) : 1) : 0;
            return {
              char: getRasterCellChar({ visible, isSingle, isFirst, isLast, isBlank: segment.is_blank }),
              rgb: visualStyle.rgb,
              weight: Math.max(baseWeight, visualStyle.weight),
              renderIndex: 2,
            };
          },
        });
        continue;
      }
      drawPropertyRowSegments(c, {
        currentRect: rect,
        rowY,
        segments: getPreviewPropertyRowSegments(group, descriptor.property_id),
        cellForBreath: (segment, breath) => {
          const localIndex = breath - segment.start;
          const visible = isBreathInsideGroupCrop(layout.item, breath);
          const isSingle = segment.start === segment.end;
          const isFirst = localIndex === 0;
          const isLast = breath === segment.end;
          const interactionStyle = getMoveInteractionStyle(group.id, descriptor.property_id, segment.id, breath);
          const visualStyle = resolve_groups_move_visual_style({
            is_blank: segment.is_blank,
            visible,
            selected_property: group.selected_property_id === descriptor.property_id,
            interaction: interactionStyle,
            muted_rgb: mutedColor,
            selected_rgb: selectedColor,
            content_rgb: visibleColor,
            blank_rgb: rasterDefaultColor,
          });
          const baseWeight = segment.is_blank ? (visible ? (isSingle || isFirst || isLast ? 2 : 1) : 1) : 0;
          return {
            char: getRasterCellChar({ visible, isSingle, isFirst, isLast, isBlank: segment.is_blank }),
            rgb: visualStyle.rgb,
            weight: Math.max(baseWeight, visualStyle.weight),
            renderIndex: interactionStyle.weight >= 3 ? 3 : 2,
          };
        },
      });
    }
    const cursorX = breathToTimelineX(rect, currentBreath);
    for (let y = rect.y0 + firstPropertyRowY; y <= rect.y0 + layout.footerRowY; y += 1) {
      const rowDescriptor = layout.propertyRows.find((row) => rect.y0 + row.y === y) ?? null;
      const hasExactLocationKey = rowDescriptor?.kind === 'move' && rowDescriptor.property_id
        ? hasPropertyRowExactKeyAtBreath(group, rowDescriptor.property_id, currentBreath)
        : false;
      c.set(cursorX, y, {
        char: rowDescriptor?.kind === 'move'
            ? (hasExactLocationKey ? '█' : hasExactContentState ? '◆' : '│')
            : '│',
        rgb: rowDescriptor?.kind === 'move' && hasExactLocationKey ? selectedColor : mutedColor,
        weight_index: 2,
        render_index: 3,
      });
    }

    const nameRowY = rect.y0 + layout.footerRowY;
    const editableStart = rect.x0 + 2;
    const maxNameWidth = Math.max(1, Math.min(18, rect.x1 - editableStart - 4));
    const footerPrefix = hasExactContentState ? `State ${currentBreath}` : group.label;
    if (isBeingRenamed) {
      for (let x = editableStart; x < editableStart + maxNameWidth; x += 1) {
        c.set(x, nameRowY, { char: ' ', rgb: editBgColor, weight_index: 0, render_index: 2 });
      }
      const displayText = renameState.editText.slice(0, maxNameWidth);
      for (let j = 0; j < displayText.length; j += 1) {
        const isCursor = j === renameState.cursorPosition;
        c.set(editableStart + j, nameRowY, {
          char: displayText[j]!,
          rgb: isCursor ? editCursorColor : textColor,
          weight_index: 2,
          render_index: 2,
        });
      }
      if (renameState.cursorPosition >= displayText.length && editableStart + displayText.length < editableStart + maxNameWidth) {
        c.set(editableStart + displayText.length, nameRowY, { char: '▏', rgb: editCursorColor, weight_index: 2, render_index: 2 });
      }
    } else {
      const displayLabel = footerPrefix.slice(0, maxNameWidth);
      for (let j = 0; j < displayLabel.length; j += 1) {
        c.set(editableStart + j, nameRowY, {
          char: displayLabel[j]!,
          rgb: hasExactContentState ? textColor : rowColor,
          weight_index: hasExactContentState || group.selected ? 2 : 1,
          render_index: 2,
        });
      }
    }
    if (group.selected && !isBeingRenamed) {
      c.set(rect.x1 - 2, nameRowY, { char: '▶', rgb: selectedColor, weight_index: 2, render_index: 2 });
    }
  }

  const module = make_floating_panel_module({
    id: opts.id,
    rect: opts.rect,
    title: undefined,
    gizmos: gizmo_config,
    background: { rgb: bgColor },
    border: {
      style: PANEL_BORDER_PRESETS.default_double.style,
      border_rgb: borderColor,
      weight_index: PANEL_BORDER_PRESETS.default_double.weight_index,
      text_rgb: textColor,
      markers: () => {
        const groups = getGroups();
        const max = getMaxScrollSectionOffset(rect, groups);
        return {
          top: scrollOffset > 0 ? '^' : undefined,
          bottom: scrollOffset < max ? 'v' : undefined,
        };
      },
    },
    resize: {
      min_width: MIN_WIDTH,
      min_height: MIN_HEIGHT,
      max_width: MAX_WIDTH,
      max_height: MAX_HEIGHT,
    },
    draw_content(c: Canvas, next_rect: Rect): void {
      rect = next_rect;
      drawHeader(c);
      const groups = getGroups();
      const layouts = getVisibleLayouts(rect, groups);

      if (dragState.isDragging && dragState.currentDropIndex !== null) {
        const { contentTopY, contentBottomY } = getContentMetrics(rect);
        const beforeGroupsHeight = getGroups()
          .slice(0, dragState.currentDropIndex)
          .reduce((sum, group) => sum + getSectionSpan(group), 0);
        const dropY = contentTopY - beforeGroupsHeight + scrollOffset + 1;
        if (dropY >= contentBottomY && dropY <= contentTopY) {
          for (let x = rect.x0 + 1; x < rect.x1; x += 1) {
            c.set(x, rect.y0 + dropY, { char: '━', rgb: dropIndicatorColor, weight_index: 2, render_index: 3 });
          }
        }
      }

      if (propertyOrderDragState.active && propertyOrderDragState.groupId && propertyOrderDragState.currentDropIndex !== null) {
        const propertyLayout = layouts.find((entry) => entry.item.id === propertyOrderDragState.groupId) ?? null;
        if (propertyLayout) {
          const dropRow = propertyLayout.propertyRows[propertyOrderDragState.currentDropIndex] ?? null;
          const dropY = rect.y0 + (dropRow ? dropRow.y : propertyLayout.footerRowY + 1);
          if (dropY >= rect.y0 + propertyLayout.sectionBottomY && dropY <= rect.y0 + propertyLayout.sectionTopY) {
            for (let x = rect.x0 + 18; x < rect.x1 - 1; x += 1) {
              c.set(x, dropY, { char: '━', rgb: dropIndicatorColor, weight_index: 2, render_index: 3 });
            }
          }
        }
      }

      for (const layout of layouts) {
        if (dragState.isDragging && dragState.sourceGroupId === layout.item.id) continue;
        drawSectionFrame(c, layout);
        drawSectionContent(c, layout);
      }

      if (dragState.isDragging && dragState.draggedGroup) {
        const pointerLocalY = dragState.dragPointerY - rect.y0;
        const tempLayout = buildSectionLayout(dragState.draggedGroup, pointerLocalY + 2);
        drawSectionFrame(c, tempLayout);
        drawSectionContent(c, tempLayout);
      }
    },
    on_pointer_down_content(e: PointerEvent, currentRect: Rect): void {
      if (e.button !== 0 && e.button !== 2) return;
      const localX = e.x - currentRect.x0;
      const localY = e.y - currentRect.y0;
      lastPointerLocalPos = { x: localX, y: localY };

      if (renameState.isRenaming) {
        const clickedLayout = getLayoutAtPointer(currentRect, e.x, e.y);
        const clickedOnRenameField = !!clickedLayout
          && clickedLayout.item.id === renameState.groupId
          && localY === clickedLayout.footerRowY
          && localX >= 2
          && localX < 20;
        if (!clickedOnRenameField) {
          if (renameState.groupId !== null) renameGroup(renameState.groupId, renameState.editText);
          renameState.isRenaming = false;
          renameState.groupId = null;
        }
      }

      const metrics = getContentMetrics(currentRect);
      const addButtonX = currentRect.x1 - currentRect.x0 - 2;
      if (localY === metrics.titleRowY && localX >= addButtonX) {
        opts.on_add_group();
        return;
      }
      const autoKeyStart = 11;
      const autoKeyBoxStart = Math.min(currentRect.x1 - currentRect.x0 - 10, autoKeyStart + 'AUTO KEY'.length + 2);
      if (localY === metrics.headerRow2Y && localX >= autoKeyStart && localX <= autoKeyBoxStart + 2) {
        toggleAutoKey();
        return;
      }
      const timelineRegion = getTimelineRegion(currentRect);
      const loopHit = getLoopWindowHit(currentRect, localX, localY);
      if (localY === metrics.headerRow1Y && localX >= timelineRegion.startX - currentRect.x0 && localX <= timelineRegion.endX - currentRect.x0) {
        setCurrentBreath(timelineXToBreath(currentRect, localX + currentRect.x0));
        timelineScrubDrag = true;
        return;
      }
      if (localY === metrics.headerRow2Y && localX >= timelineRegion.startX - currentRect.x0 && localX <= timelineRegion.endX - currentRect.x0) {
        if (loopHit) {
          const loopRange = getLoopBreathRange();
          loopWindowDrag.active = true;
          loopWindowDrag.mode = loopHit;
          loopWindowDrag.originalStart = loopRange.start;
          loopWindowDrag.originalEnd = loopRange.end;
          loopWindowDrag.anchorBreath = timelineXToBreath(currentRect, localX + currentRect.x0);
          loopWindowDrag.previewStart = loopRange.start;
          loopWindowDrag.previewEnd = loopRange.end;
          return;
        }
        timelinePanDrag.active = true;
        timelinePanDrag.anchorX = localX;
        timelinePanDrag.anchorStartBreath = getTimelineViewStart();
        return;
      }

      const layout = getLayoutAtPointer(currentRect, e.x, e.y);
      if (!layout) return;
      const group = layout.item;
      const firstPropertyRowY = layout.propertyRows[0]?.y ?? layout.sectionTopY - 2;
      const secondPropertyRowY = layout.propertyRows[1]?.y ?? layout.sectionTopY - 4;
      const propertyDescriptorAtHit = getPropertyRowDescriptorAtLocalY(layout, localY);
      const propertyHit = propertyDescriptorAtHit && (propertyDescriptorAtHit.kind === 'raster' || propertyDescriptorAtHit.kind === 'move')
        ? getPropertyRowHit(layout, currentRect, localX, localY)
        : null;
      if (propertyDescriptorAtHit && propertyHit && (e.button === 0 || e.button === 2)) {
        const hitSegment = getPropertyBlockDragSegment(group, propertyHit.propertyId, propertyHit.blockId);
        groupsRasterDiag('pointer_down_hit', {
          groupId: group.id,
          kind: propertyDescriptorAtHit.kind,
          propertyId: propertyHit.propertyId,
          segmentId: propertyHit.blockId,
          segmentStart: hitSegment?.start ?? null,
          segmentEnd: hitSegment?.end ?? null,
          mode: propertyHit.mode,
          button: e.button,
          breath: propertyHit.breath,
          isBlank: propertyHit.isBlank,
          localX,
          localY,
        });
        beginPendingBlockPress({
          kind: propertyDescriptorAtHit.kind,
          groupId: group.id,
          propertyId: propertyHit.propertyId,
          blockId: propertyHit.blockId,
          mode: propertyHit.mode,
          isBlank: propertyHit.isBlank,
          button: e.button,
          localDownX: localX,
          localDownY: localY,
          breath: propertyHit.breath,
        });
        return;
      }
      const sectionLocalTop = layout.sectionTopY;
      const sectionLocalBottom = layout.sectionBottomY;

      if (localY === layout.titleRowY && localX >= 2 && localX < 18) {
        selectGroup(group);
        return;
      }
      const propertyDescriptorAtPointer = propertyDescriptorAtHit ?? getPropertyRowDescriptorAtLocalY(layout, localY);
      if (propertyDescriptorAtPointer && localX >= 20 && localX < 28) {
        selectGroup(group);
        opts.on_select_group_property?.(group.id, propertyDescriptorAtPointer.property_id);
        return;
      }
      if (localX >= 11 && localX <= 16) {
        if (localY === layout.titleRowY) {
          if (e.button !== 0) return;
          dragState.isDragging = true;
          dragState.sourceGroupId = group.id;
          dragState.dragPointerY = e.y;
          dragState.draggedGroup = group;
          dragState.currentDropIndex = getDropIndexForPointer(currentRect, e.y, getGroups());
          return;
        }
        const propertyRowDescriptor = getPropertyRowDescriptorAtLocalY(layout, localY);
        if (propertyRowDescriptor) {
          opts.on_select_group_property?.(group.id, propertyRowDescriptor.property_id);
          if (e.button === 2) {
            opts.on_remove_group_property?.(group.id, propertyRowDescriptor.property_id);
            return;
          }
          if (localY === firstPropertyRowY) {
            toggleGroupVisibility(group);
            return;
          }
          if (e.button !== 0) return;
          propertyOrderDragState.active = true;
          propertyOrderDragState.groupId = group.id;
          propertyOrderDragState.propertyId = propertyRowDescriptor.property_id;
          propertyOrderDragState.dragPointerY = e.y;
          propertyOrderDragState.currentDropIndex = getPropertyRowDropIndex(layout, localY);
          return;
        }
        if (localY === firstPropertyRowY) {
          toggleGroupVisibility(group);
          return;
        }
        if (localY === layout.turnRowY) {
          if (group.can_delete !== false && getGroups().length > 1) deleteGroup(group);
          return;
        }
        if (localY === layout.transRowY) {
          const selectedPropertyId = group.selected_property_id ?? layout.propertyRows[layout.propertyRows.length - 1]?.property_id ?? null;
          opts.on_add_group_property?.(group.id, e.button === 2 ? 'raster' : 'move', selectedPropertyId);
          return;
        }
      }
      if (localY === layout.footerRowY && localX >= 2 && localX < 20) {
        selectGroup(group);
        if (renameState.isRenaming && renameState.groupId !== group.id && renameState.groupId !== null) {
          renameGroup(renameState.groupId, renameState.editText);
        }
        beginRenameGroup(group.id);
        return;
      }
      if (localX >= 2 && localX < 9 && localY <= layout.turnRowY && localY >= firstPropertyRowY) {
        selectGroup(group);
        if (propertyDescriptorAtPointer) opts.on_select_group_property?.(group.id, propertyDescriptorAtPointer.property_id);
        return;
      }
      if (localX >= 11 && localX < 17 && localY === layout.spacerRowY) {
        toggleGroupLock(group);
        return;
      }
      if (localY >= firstPropertyRowY && localY <= layout.footerRowY && localX >= timelineRegion.startX - currentRect.x0 && localX <= timelineRegion.endX - currentRect.x0) {
        setCurrentBreath(timelineXToBreath(currentRect, localX + currentRect.x0));
        selectGroup(group);
        if (propertyDescriptorAtPointer) opts.on_select_group_property?.(group.id, propertyDescriptorAtPointer.property_id);
        return;
      }
      selectGroup(group);
    },
    on_drag_move_content(e: DragEvent): void {
      lastPointerLocalPos = { x: e.x - rect.x0, y: e.y - rect.y0 };
      updateRasterHoverState(rect, e.x, e.y);
      updateMoveHoverState(rect, e.x, e.y);
      if (timelineScrubDrag) {
        setCurrentBreath(timelineXToBreath(rect, e.x));
        return;
      }
      if (loopWindowDrag.active && loopWindowDrag.mode) {
        const previewBreath = timelineXToBreath(rect, e.x);
        const fileRange = getFileBreathRange();
        if (loopWindowDrag.mode === 'start') {
          loopWindowDrag.previewStart = Math.max(fileRange.start, Math.min(previewBreath, loopWindowDrag.originalEnd));
          loopWindowDrag.previewEnd = loopWindowDrag.originalEnd;
        } else if (loopWindowDrag.mode === 'end') {
          loopWindowDrag.previewStart = loopWindowDrag.originalStart;
          loopWindowDrag.previewEnd = Math.max(loopWindowDrag.originalStart, Math.min(fileRange.end, previewBreath));
        } else {
          const delta = previewBreath - loopWindowDrag.anchorBreath;
          const length = loopWindowDrag.originalEnd - loopWindowDrag.originalStart;
          const nextStart = Math.max(fileRange.start, Math.min(fileRange.end - length, loopWindowDrag.originalStart + delta));
          loopWindowDrag.previewStart = nextStart;
          loopWindowDrag.previewEnd = nextStart + length;
        }
        return;
      }
      if (pendingBlockPress.active) {
        const deltaX = Math.abs((e.x - rect.x0) - pendingBlockPress.localDownX);
        const deltaY = Math.abs((e.y - rect.y0) - pendingBlockPress.localDownY);
        if (Math.max(deltaX, deltaY) <= BLOCK_DRAG_THRESHOLD_PX) return;
        const group = pendingBlockPress.groupId ? getGroupById(pendingBlockPress.groupId) : null;
        if (!group || !pendingBlockPress.kind || !pendingBlockPress.blockId || !pendingBlockPress.mode) {
          clearPendingBlockPress();
          return;
        }
        selectGroup(group);
        if (pendingBlockPress.propertyId) opts.on_select_group_property?.(group.id, pendingBlockPress.propertyId);
        if (pendingBlockPress.isBlank && pendingBlockPress.button === 0 && (pendingBlockPress.mode === 'blank_center' || pendingBlockPress.mode === 'blank_single')) {
          setCurrentBreath(timelineXToBreath(rect, e.x));
          timelineScrubDrag = true;
          clearPendingBlockPress();
          return;
        }
        const segment = getPropertyBlockDragSegment(group, pendingBlockPress.propertyId, pendingBlockPress.blockId);
        if (!segment) {
          clearPendingBlockPress();
          return;
        }
        const previewBreath = timelineXToBreath(rect, e.x);
        const finalMode = resolve_groups_raster_drag_mode({
          hit_mode: pendingBlockPress.mode,
          button: pendingBlockPress.button,
          is_blank: pendingBlockPress.isBlank,
        });
        groupsRasterDiag('drag_mode_resolved', {
          groupId: group.id,
          propertyId: pendingBlockPress.propertyId ?? 'raster',
          segmentId: pendingBlockPress.blockId,
          hitMode: pendingBlockPress.mode,
          button: pendingBlockPress.button,
          isBlank: pendingBlockPress.isBlank,
          finalMode,
          anchorBreath: pendingBlockPress.breath,
          previewBreath,
        });
        if (!finalMode) {
          clearPendingBlockPress();
          return;
        }
        armRasterSegmentDrag({
          kind: pendingBlockPress.kind,
          group,
          propertyId: pendingBlockPress.propertyId,
          segment,
          pendingMode: pendingBlockPress.mode,
          button: pendingBlockPress.button,
          anchorBreath: pendingBlockPress.breath,
          previewBreath,
          finalMode,
        });
        clearPendingBlockPress();
        return;
      }
      if (blankMergeDragState.active) {
        const previewBreath = timelineXToBreath(rect, e.x);
        if (previewBreath > blankMergeDragState.anchorBreath) blankMergeDragState.previewDirection = 'right';
        else if (previewBreath < blankMergeDragState.anchorBreath) blankMergeDragState.previewDirection = 'left';
        else blankMergeDragState.previewDirection = null;
        return;
      }
      if (propertyOrderDragState.active && propertyOrderDragState.groupId) {
        const layout = getLayoutAtPointer(rect, e.x, e.y);
        propertyOrderDragState.dragPointerY = e.y;
        if (layout?.item.id === propertyOrderDragState.groupId) {
          propertyOrderDragState.currentDropIndex = getPropertyRowDropIndex(layout, e.y - rect.y0);
        }
        return;
      }
      if (rasterDragState.active) {
        rasterDragState.previewBreath = timelineXToBreath(rect, e.x);
        if (rasterDragState.mode === 'body_swap' && rasterDragState.groupId) {
          const layout = getLayoutAtPointer(rect, e.x, e.y);
          const localX = e.x - rect.x0;
          const localY = e.y - rect.y0;
          const hit = layout ? getPropertyRowHit(layout, rect, localX, localY) : null;
          const swapTarget = resolve_groups_raster_swap_target_result({
            sourceGroupId: rasterDragState.groupId,
            sourcePropertyId: rasterDragState.propertyId,
            sourceSegmentId: rasterDragState.segmentId,
            hitGroupId: layout?.item.id ?? null,
            hitPropertyId: hit?.propertyId ?? null,
            hitSegmentId: hit?.blockId ?? null,
            hitIsBlank: hit?.isBlank ?? true,
          });
          rasterDragState.targetSegmentId = swapTarget.targetSegmentId;
          rasterDragState.targetPropertyId = rasterDragState.targetSegmentId ? hit?.propertyId ?? null : null;
          groupsRasterDiag('swap_target_resolved', {
            sourceGroupId: rasterDragState.groupId,
            sourcePropertyId: rasterDragState.propertyId,
            sourceSegmentId: rasterDragState.segmentId,
            hitGroupId: layout?.item.id ?? null,
            hitPropertyId: hit?.propertyId ?? null,
            hitSegmentId: hit?.blockId ?? null,
            hitMode: hit?.mode ?? null,
            hitIsBlank: hit?.isBlank ?? null,
            targetSegmentId: rasterDragState.targetSegmentId,
            reason: swapTarget.reason,
            localX,
            localY,
          });
        }
        return;
      }
      if (timelinePanDrag.active) {
        const deltaX = (e.x - rect.x0) - timelinePanDrag.anchorX;
        setTimelineViewStart(timelinePanDrag.anchorStartBreath - deltaX);
        return;
      }
      if (!dragState.isDragging) return;
      dragState.dragPointerY = e.y;
      dragState.currentDropIndex = getDropIndexForPointer(rect, e.y, getGroups());
    },
    on_pointer_up_content(): void {
      if (timelineScrubDrag) {
        timelineScrubDrag = false;
        return;
      }
      if (loopWindowDrag.active && loopWindowDrag.mode) {
        setLoopBreathRange(loopWindowDrag.previewStart, loopWindowDrag.previewEnd);
        loopWindowDrag.active = false;
        loopWindowDrag.mode = null;
        return;
      }
      if (blankMergeDragState.active) {
        commitBlankMergeDrag();
        return;
      }
      if (pendingBlockPress.active && pendingBlockPress.kind && pendingBlockPress.groupId && pendingBlockPress.blockId && pendingBlockPress.mode) {
        const candidate = {
          kind: pendingBlockPress.kind,
          groupId: pendingBlockPress.groupId,
          propertyId: pendingBlockPress.propertyId,
          blockId: pendingBlockPress.blockId,
          mode: pendingBlockPress.mode,
          isBlank: pendingBlockPress.isBlank,
          button: pendingBlockPress.button,
          breath: pendingBlockPress.breath,
        } as const;
        clearPendingBlockPress();
        if (matchesPendingBlockSingleClick(candidate)) {
          const group = getGroupById(candidate.groupId);
          clearPendingBlockSingleClick();
          if (!group) return;
          handlePropertyBlockDoubleClick(group, candidate.propertyId, candidate.button, {
            segmentId: candidate.blockId,
            mode: candidate.mode,
            breath: candidate.breath,
            isBlank: candidate.isBlank,
          }, rect, lastPointerLocalPos?.x ?? 0);
          return;
        }
        if (candidate.button === 0) {
          scheduleBlockSingleClick(candidate);
        } else {
          clearPendingBlockSingleClick();
          pendingBlockSingleClick.kind = candidate.kind;
          pendingBlockSingleClick.groupId = candidate.groupId;
          pendingBlockSingleClick.propertyId = candidate.propertyId;
          pendingBlockSingleClick.blockId = candidate.blockId;
          pendingBlockSingleClick.mode = candidate.mode;
          pendingBlockSingleClick.isBlank = candidate.isBlank;
          pendingBlockSingleClick.button = candidate.button;
          pendingBlockSingleClick.breath = candidate.breath;
          pendingBlockSingleClick.timeoutId = window.setTimeout(() => {
            clearPendingBlockSingleClick();
          }, BLOCK_DOUBLE_CLICK_MS);
        }
        return;
      }
      if (propertyOrderDragState.active && propertyOrderDragState.groupId) {
        const layout = getVisibleLayouts(rect, getGroups()).find((entry) => entry.item.id === propertyOrderDragState.groupId) ?? null;
        if (layout) commitPropertyOrderDrag(layout);
        else {
          propertyOrderDragState.active = false;
          propertyOrderDragState.groupId = null;
          propertyOrderDragState.propertyId = null;
          propertyOrderDragState.currentDropIndex = null;
        }
        return;
      }
      if (rasterDragState.active) {
        commitPropertyBlockDrag();
        return;
      }
      if (timelinePanDrag.active) {
        timelinePanDrag.active = false;
        return;
      }
      if (!dragState.isDragging || !dragState.sourceGroupId) return;
      if (dragState.currentDropIndex !== null) {
        reorderGroups(getGroups(), dragState.sourceGroupId, dragState.currentDropIndex);
      }
      dragState.isDragging = false;
      dragState.sourceGroupId = null;
      dragState.currentDropIndex = null;
      dragState.draggedGroup = null;
    },
    on_key_down(e: KeyboardEvent): void {
      if (!renameState.isRenaming) return;
      if (e.key === 'Enter') {
        if (renameState.groupId !== null) renameGroup(renameState.groupId, renameState.editText);
        renameState.isRenaming = false;
        renameState.groupId = null;
        e.preventDefault();
      } else if (e.key === 'Escape') {
        renameState.isRenaming = false;
        renameState.groupId = null;
        e.preventDefault();
      } else if (e.key === 'Backspace') {
        if (renameState.cursorPosition > 0) {
          renameState.editText = renameState.editText.slice(0, renameState.cursorPosition - 1) + renameState.editText.slice(renameState.cursorPosition);
          renameState.cursorPosition -= 1;
        }
        e.preventDefault();
      } else if (e.key === 'Delete') {
        if (renameState.cursorPosition < renameState.editText.length) {
          renameState.editText = renameState.editText.slice(0, renameState.cursorPosition) + renameState.editText.slice(renameState.cursorPosition + 1);
        }
        e.preventDefault();
      } else if (e.key === 'ArrowLeft') {
        if (renameState.cursorPosition > 0) renameState.cursorPosition -= 1;
        e.preventDefault();
      } else if (e.key === 'ArrowRight') {
        if (renameState.cursorPosition < renameState.editText.length) renameState.cursorPosition += 1;
        e.preventDefault();
      } else if (e.key === 'Home') {
        renameState.cursorPosition = 0;
        e.preventDefault();
      } else if (e.key === 'End') {
        renameState.cursorPosition = renameState.editText.length;
        e.preventDefault();
      }
    },
    on_text_input(text: string): void {
      if (!renameState.isRenaming) return;
      renameState.editText = renameState.editText.slice(0, renameState.cursorPosition) + text + renameState.editText.slice(renameState.cursorPosition);
      renameState.cursorPosition += text.length;
    },
    wants_text_capture: () => renameState.isRenaming,
    on_wheel_content(e: { delta_x: number; delta_y: number; delta_mode: number }): void {
      if (timelinePanDrag.active) return;
      const lastMouseLocalX = lastPointerLocalPos?.x ?? -1;
      const lastMouseLocalY = lastPointerLocalPos?.y ?? -1;
      const wheelOnTimelineHeader = isPointerInTimelineHeader(rect, lastMouseLocalX, lastMouseLocalY);
      if (wheelOnTimelineHeader && Math.abs(e.delta_x) > 0) {
        setTimelineViewStart(getTimelineViewStart() + Math.round(e.delta_x / 3));
        return;
      }
      if (wheelOnTimelineHeader && Math.abs(e.delta_y) > 0) {
        setTimelineViewStart(getTimelineViewStart() + Math.round(e.delta_y / 3));
        return;
      }
      const groups = getGroups();
      const max = getMaxScrollSectionOffset(rect, groups);
      if (e.delta_y > 0) scrollOffset = Math.min(scrollOffset + 2, max);
      else scrollOffset = Math.max(scrollOffset - 2, 0);
    },
    on_pointer_move_content(e: PointerEvent): void {
      lastPointerLocalPos = { x: e.x - rect.x0, y: e.y - rect.y0 };
      updateRasterHoverState(rect, e.x, e.y);
      updateMoveHoverState(rect, e.x, e.y);
    },
  });

  return Object.assign(module, {
    beginRenameGroup,
  });
}
