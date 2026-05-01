import type { Module, Canvas, Rect, PointerEvent, DragEvent } from '../types.js';
import { get_color_by_name } from '../colors.js';
import { MODULE_CHROME_RENDER_INDEX, PANEL_BORDER_PRESETS, draw_panel_horizontal_divider } from '../module_borders.js';
import type { ModuleGizmosConfig } from '../module_gizmos.js';
import { make_floating_panel_module } from './floating_panel_module.js';

export type GroupListItem = {
  id: string;
  label: string;
  selected: boolean;
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
  content_state_breaths?: number[];
  raster_segments?: Array<{ id: string; start: number; end: number; length_breaths: number }>;
  location_key_breaths?: number[];
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
  on_toggle_group_visibility?: (id: string) => void;
  on_toggle_group_lock?: (id: string) => void;
  on_rename_group: (id: string, next_label: string) => void;
  on_add_group: () => void;
  on_delete_group?: (id: string) => void;
  on_reorder_groups: (ids_in_display_order: string[]) => void;
  on_offset_group_in_time?: (groupId: string, deltaBreaths: number) => void;
  on_set_group_timing?: (groupId: string, start: number, cropped_start: number, cropped_end: number) => void;
  on_set_group_breath_span?: (groupId: string, breathStart: number, breathEnd: number) => void;
  on_set_group_raster_segment_length?: (groupId: string, contentStateId: string, lengthBreaths: number) => void;
  on_split_group_raster_segment?: (groupId: string, contentStateId: string, splitBreath: number) => void;
  on_swap_group_raster_segments?: (groupId: string, sourceContentStateId: string, targetContentStateId: string) => void;
  on_move?: (new_rect: Rect) => void;
  on_resize?: (new_rect: Rect) => void;
  on_close?: () => void;
};

const MIN_WIDTH = 32;
const MAX_WIDTH = 90;
const MIN_HEIGHT = 14;
const MAX_HEIGHT = 80;
const HEADER_HEIGHT = 5;
const SECTION_HEIGHT = 9;
const SECTION_SPACING = 1;

type GroupSectionLayout = {
  item: GroupListItem;
  sectionTopY: number;
  sectionBottomY: number;
  titleRowY: number;
  rasterRowY: number;
  spacerRowY: number;
  moveRowY: number;
  turnRowY: number;
  transRowY: number;
  footerRowY: number;
};

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
  let spanDragState: {
    active: boolean;
    groupId: string | null;
    handle: 'start' | 'end' | null;
    originalStart: number;
    originalEnd: number;
    previewBreath: number;
  } = {
    active: false,
    groupId: null,
    handle: null,
    originalStart: 0,
    originalEnd: 0,
    previewBreath: 0,
  };
  let rasterDragState: {
    active: boolean;
    groupId: string | null;
    segmentId: string | null;
    mode: 'edge_start' | 'edge_end' | 'edge_start_dynamic' | 'edge_end_dynamic' | 'body_move' | 'body_dynamic_resize' | 'body_swap' | null;
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
  } = {
    active: false,
    groupId: null,
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
  };

  let rasterHoverState: {
    groupId: string | null;
    segmentId: string | null;
    breath: number | null;
    mode: 'edge_start' | 'edge_end' | 'body_move' | 'body_single' | null;
  } = {
    groupId: null,
    segmentId: null,
    breath: null,
    mode: null,
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

  function getRasterPreviewOffset(groupId: string): number {
    return rasterDragState.active && rasterDragState.groupId === groupId && rasterDragState.mode === 'body_move'
      ? rasterDragState.previewBreath - rasterDragState.anchorBreath
      : 0;
  }

  function isBreathVisible(breath: number): boolean {
    const start = getTimelineViewStart();
    const end = getTimelineViewEnd(rect);
    return breath >= start && breath <= end;
  }

  function getVisibleContentSpans(group: GroupListItem): Array<{ start: number; end: number }> {
    if (Array.isArray(group.raster_segments) && group.raster_segments.length > 0) {
      return group.raster_segments.map((segment) => ({ start: Math.floor(segment.start), end: Math.max(Math.floor(segment.start), Math.floor(segment.end)) }));
    }
    const groupBreathStart = Math.floor(group.breath_start ?? 0);
    const groupBreathEnd = Math.max(groupBreathStart, Math.floor(group.breath_end ?? groupBreathStart));
    const starts = Array.isArray(group.content_state_breaths)
      ? [...group.content_state_breaths].map((value) => Math.floor(value)).sort((a, b) => a - b)
      : [];
    if (starts.length < 1) {
      return [{ start: groupBreathStart, end: groupBreathEnd }];
    }
    const spans: Array<{ start: number; end: number }> = [];
    for (let i = 0; i < starts.length; i += 1) {
      const authoredStart = starts[i]!;
      const start = i === 0 ? groupBreathStart : Math.max(groupBreathStart, authoredStart);
      const nextStart = starts[i + 1];
      const end = Math.min(groupBreathEnd, (typeof nextStart === 'number' ? nextStart - 1 : groupBreathEnd));
      if (end < start) continue;
      spans.push({ start, end });
    }
    return spans;
  }

  function isBreathInsideGroupCrop(group: GroupListItem, breath: number): boolean {
    const croppedStart = Math.floor(group.cropped_start ?? group.breath_start ?? 0);
    const croppedEnd = Math.max(croppedStart, Math.floor(group.cropped_end ?? group.breath_end ?? croppedStart));
    return breath >= croppedStart && breath <= croppedEnd;
  }

  function getRasterCellChar(args: {
    visible: boolean;
    isSingle: boolean;
    isFirst: boolean;
    isLast: boolean;
  }): string {
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

  function getRasterSegments(group: GroupListItem): Array<{ id: string; start: number; end: number; length_breaths: number }> {
    return Array.isArray(group.raster_segments) ? group.raster_segments.map((segment) => ({
      id: segment.id,
      start: Math.floor(segment.start),
      end: Math.max(Math.floor(segment.start), Math.floor(segment.end)),
      length_breaths: Math.max(1, Math.floor(segment.length_breaths)),
    })) : [];
  }

  function getRasterHit(layout: GroupSectionLayout, currentRect: Rect, localX: number, localY: number): { segmentId: string; mode: 'edge_start' | 'edge_end' | 'body_move' | 'body_single'; breath: number } | null {
    if (localY !== layout.rasterRowY) return null;
    const segments = getRasterSegments(layout.item);
    for (const segment of segments) {
      const startX = breathToTimelineX(currentRect, segment.start) - currentRect.x0;
      const endX = breathToTimelineX(currentRect, segment.end) - currentRect.x0;
      if (localX < startX || localX > endX) continue;
      const breath = timelineXToBreath(currentRect, localX + currentRect.x0);
      if (startX === endX) return { segmentId: segment.id, mode: 'body_single', breath };
      if (Math.abs(localX - startX) <= 1) return { segmentId: segment.id, mode: 'edge_start', breath };
      if (Math.abs(localX - endX) <= 1) return { segmentId: segment.id, mode: 'edge_end', breath };
      return { segmentId: segment.id, mode: 'body_move', breath };
    }
    return null;
  }

  function updateRasterHoverState(currentRect: Rect, pointerX: number, pointerY: number): void {
    const layout = getLayoutAtPointer(currentRect, pointerX, pointerY);
    if (!layout) {
      rasterHoverState = { groupId: null, segmentId: null, breath: null, mode: null };
      return;
    }
    const localX = pointerX - currentRect.x0;
    const localY = pointerY - currentRect.y0;
    const hit = getRasterHit(layout, currentRect, localX, localY);
    if (!hit) {
      rasterHoverState = { groupId: null, segmentId: null, breath: null, mode: null };
      return;
    }
    rasterHoverState = {
      groupId: layout.item.id,
      segmentId: hit.segmentId,
      breath: hit.breath,
      mode: hit.mode,
    };
  }

  function getRasterInteractionStyle(groupId: string, segmentId: string, breath: number): { rgb: { r: number; g: number; b: number }; weight: number } {
    const hoverMatchesGroup = rasterHoverState.groupId === groupId && rasterHoverState.segmentId === segmentId;
    const hoverMatchesBreath = hoverMatchesGroup && rasterHoverState.breath === breath;
    const dragMatchesSource = rasterDragState.active && rasterDragState.groupId === groupId && rasterDragState.segmentId === segmentId;
    const dragMatchesTarget = rasterDragState.active && rasterDragState.groupId === groupId && rasterDragState.targetSegmentId === segmentId && rasterDragState.segmentId !== segmentId;
    const dragMatchesWholeGroupMove = rasterDragState.active && rasterDragState.groupId === groupId && rasterDragState.mode === 'body_move' && rasterDragState.button === 0;

    if (dragMatchesTarget) return { rgb: rasterSwapTargetColor, weight: 2 };
    if (dragMatchesWholeGroupMove) return { rgb: rasterLeftDragColor, weight: 3 };
    if (dragMatchesSource && rasterDragState.button === 2) return { rgb: rasterRightDragColor, weight: 3 };
    if (dragMatchesSource && rasterDragState.button === 0) return { rgb: rasterLeftDragColor, weight: 3 };
    if (hoverMatchesBreath) return { rgb: rasterHoverColor, weight: 3 };
    if (hoverMatchesGroup) return { rgb: rasterHoverColor, weight: 2 };
    return { rgb: rasterDefaultColor, weight: 1 };
  }

  function commitRasterDrag(): void {
    if (!rasterDragState.active || !rasterDragState.groupId || !rasterDragState.segmentId || !rasterDragState.mode) return;
    const delta = rasterDragState.previewBreath - rasterDragState.anchorBreath;
    if (rasterDragState.mode === 'body_move') {
      opts.on_offset_group_in_time?.(rasterDragState.groupId, delta);
    } else if (rasterDragState.mode === 'edge_start') {
      const nextSegmentStart = Math.max(0, Math.min(rasterDragState.previewBreath, rasterDragState.originalSegmentEnd));
      const nextLength = Math.max(1, rasterDragState.originalSegmentEnd - nextSegmentStart + 1);
      const cropDeltaStart = rasterDragState.originalCropStart - rasterDragState.originalGroupStart;
      const cropDeltaEnd = rasterDragState.originalCropEnd - rasterDragState.originalGroupStart;
      opts.on_set_group_timing?.(
        rasterDragState.groupId,
        nextSegmentStart,
        nextSegmentStart + cropDeltaStart,
        nextSegmentStart + cropDeltaEnd,
      );
      opts.on_set_group_raster_segment_length?.(rasterDragState.groupId, rasterDragState.segmentId, nextLength);
    } else if (rasterDragState.mode === 'edge_end') {
      const nextSegmentEnd = Math.max(rasterDragState.originalSegmentStart, rasterDragState.previewBreath);
      const nextLength = Math.max(1, nextSegmentEnd - rasterDragState.originalSegmentStart + 1);
      opts.on_set_group_raster_segment_length?.(rasterDragState.groupId, rasterDragState.segmentId, nextLength);
    } else if (rasterDragState.mode === 'edge_start_dynamic' || rasterDragState.mode === 'body_dynamic_resize') {
      if (delta < 0) {
        const nextStart = Math.max(0, rasterDragState.originalSegmentStart + delta);
        const nextLength = Math.max(1, rasterDragState.originalSegmentEnd - nextStart + 1);
        opts.on_set_group_timing?.(
          rasterDragState.groupId,
          nextStart,
          nextStart,
          Math.max(nextStart, rasterDragState.originalCropEnd),
        );
        opts.on_set_group_raster_segment_length?.(rasterDragState.groupId, rasterDragState.segmentId, nextLength);
      } else if (delta > 0) {
        const nextLength = Math.max(1, rasterDragState.originalLength + delta);
        opts.on_set_group_raster_segment_length?.(rasterDragState.groupId, rasterDragState.segmentId, nextLength);
      }
    } else if (rasterDragState.mode === 'edge_end_dynamic') {
      const nextLength = Math.max(1, rasterDragState.previewBreath - rasterDragState.originalSegmentStart + 1);
      opts.on_set_group_raster_segment_length?.(rasterDragState.groupId, rasterDragState.segmentId, nextLength);
    } else if (rasterDragState.mode === 'body_swap') {
      if (rasterDragState.targetSegmentId && rasterDragState.targetSegmentId !== rasterDragState.segmentId) {
        opts.on_swap_group_raster_segments?.(rasterDragState.groupId, rasterDragState.segmentId, rasterDragState.targetSegmentId);
      }
    }
    rasterDragState.active = false;
    rasterDragState.groupId = null;
    rasterDragState.segmentId = null;
    rasterDragState.mode = null;
    rasterDragState.targetSegmentId = null;
  }

  function getResolvedGroupSpan(group: GroupListItem): { start: number; end: number } {
    const baseStart = Math.floor(group.breath_start ?? 0);
    const baseEnd = Math.max(baseStart, Math.floor(group.breath_end ?? baseStart));
    if (!spanDragState.active || spanDragState.groupId !== group.id || !spanDragState.handle) {
      return { start: baseStart, end: baseEnd };
    }
    if (spanDragState.handle === 'start') {
      return {
        start: Math.max(0, Math.min(spanDragState.previewBreath, spanDragState.originalEnd)),
        end: Math.max(0, spanDragState.originalEnd),
      };
    }
    return {
      start: Math.max(0, spanDragState.originalStart),
      end: Math.max(Math.max(0, spanDragState.originalStart), spanDragState.previewBreath),
    };
  }

  function getSpanHandleHit(layout: GroupSectionLayout, currentRect: Rect, localX: number, localY: number): 'start' | 'end' | null {
    if (localY !== layout.moveRowY) return null;
    const span = getResolvedGroupSpan(layout.item);
    const startX = breathToTimelineX(currentRect, span.start) - currentRect.x0;
    const endX = breathToTimelineX(currentRect, span.end) - currentRect.x0;
    if (Math.abs(localX - startX) <= 1) return 'start';
    if (Math.abs(localX - endX) <= 1) return 'end';
    return null;
  }

  function commitSpanDrag(): void {
    if (!spanDragState.active || !spanDragState.groupId || !spanDragState.handle) return;
    const start = spanDragState.handle === 'start'
      ? Math.max(0, Math.min(spanDragState.previewBreath, spanDragState.originalEnd))
      : Math.max(0, spanDragState.originalStart);
    const end = spanDragState.handle === 'end'
      ? Math.max(Math.max(0, spanDragState.originalStart), spanDragState.previewBreath)
      : Math.max(0, spanDragState.originalEnd);
    opts.on_set_group_breath_span?.(spanDragState.groupId, start, end);
    spanDragState.active = false;
    spanDragState.groupId = null;
    spanDragState.handle = null;
  }

  function getSectionSpan(): number {
    return SECTION_HEIGHT + SECTION_SPACING;
  }

  function getMaxScrollSectionOffset(currentRect: Rect, groups: GroupListItem[]): number {
    const metrics = getContentMetrics(currentRect);
    const totalHeight = groups.length * getSectionSpan();
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
    const sectionSpan = getSectionSpan();
    for (let i = 0; i < groups.length; i += 1) {
      const sectionTopY = contentTopY - (i * sectionSpan) + scrollOffset;
      const sectionBottomY = sectionTopY - (SECTION_HEIGHT - 1);
      if (sectionTopY < contentBottomY || sectionBottomY > contentTopY) continue;
      layouts.push({
        item: groups[i]!,
        sectionTopY,
        sectionBottomY,
        titleRowY: sectionTopY - 1,
        rasterRowY: sectionTopY - 2,
        spacerRowY: sectionTopY - 3,
        moveRowY: sectionTopY - 4,
        turnRowY: sectionTopY - 5,
        transRowY: sectionTopY - 6,
        footerRowY: sectionTopY - 7,
      });
    }
    return layouts;
  }

  function getDropIndexForPointer(currentRect: Rect, pointerY: number, groups: GroupListItem[]): number {
    const { contentTopY } = getContentMetrics(currentRect);
    const localY = pointerY - currentRect.y0;
    const sectionSpan = getSectionSpan();
    const projected = Math.floor((contentTopY - localY + scrollOffset + Math.floor(sectionSpan / 2)) / sectionSpan);
    return Math.max(0, Math.min(groups.length, projected));
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
    const locationKeyBreaths = Array.isArray(layout.item.location_key_breaths) ? layout.item.location_key_breaths : [];
    const hasExactLocationKey = locationKeyBreaths.includes(currentBreath);
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
      { y: layout.rasterRowY, label: 'parent', color: mutedColor, weight: 1 },
      { y: layout.spacerRowY, label: leftText, color: rowColor, weight: 2 },
      { y: layout.moveRowY, label: 'mask', color: mutedColor, weight: 1 },
      { y: layout.turnRowY, label: 'none', color: mutedColor, weight: 1 },
    ];
    for (const row of leftRows) {
      const label = row.label;
      for (let j = 0; j < label.length && rect.x0 + 2 + j < rect.x0 + 8; j += 1) {
        c.set(rect.x0 + 2 + j, rect.y0 + row.y, { char: label[j]!, rgb: row.color, weight_index: row.weight, render_index: 2 });
      }
    }

    const middleRows = [
      { y: layout.rasterRowY, text: `hide ${group.visible === false ? 'o' : 'a'}`, color: rowColor },
      { y: layout.spacerRowY, text: `ordr ${getVisualOrder(group.id)}`, color: mutedColor },
      { y: layout.moveRowY, text: 'dupe +', color: mutedColor },
      { y: layout.turnRowY, text: 'del  x', color: deleteColor },
    ];
    for (const row of middleRows) {
      const label = row.text;
      for (let j = 0; j < label.length && rect.x0 + 11 + j < rect.x0 + 17; j += 1) {
        c.set(rect.x0 + 11 + j, rect.y0 + row.y, { char: row.text[j]!, rgb: row.color, weight_index: 1, render_index: 2 });
      }
    }

    const propertyRows = [
      { y: layout.moveRowY, label: 'move', color: hasExactLocationKey ? selectedColor : rowColor, weight: 2 },
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
    const rasterY = rect.y0 + layout.rasterRowY;
    const timelineY = rect.y0 + layout.moveRowY;
    const groupPreviewOffset = getRasterPreviewOffset(group.id);
    const groupSpan = getResolvedGroupSpan(layout.item);
    const groupBreathStart = groupSpan.start + groupPreviewOffset;
    const groupBreathEnd = groupSpan.end + groupPreviewOffset;
    const timelineInnerStartX = timelineRegion.innerStartX;
    const timelineInnerEndX = timelineRegion.innerEndX;
    for (let x = timelineStartX; x <= timelineEndX; x += 1) {
      c.set(x, rasterY, { char: ' ', rgb: mutedColor, weight_index: 0, render_index: 1 });
      c.set(x, timelineY, { char: '─', rgb: mutedColor, weight_index: 1, render_index: 1 });
    }
    const rasterSpans = rasterSegments.length > 0
      ? rasterSegments.map((segment) => ({ id: segment.id, start: segment.start, end: segment.end }))
      : getVisibleContentSpans(layout.item).map((span, index) => ({ id: `fallback_${index}`, start: Math.floor(span.start), end: Math.max(Math.floor(span.start), Math.floor(span.end)) }));
    for (const span of rasterSpans) {
      const start = Math.floor(span.start) + groupPreviewOffset;
      const end = Math.max(start, Math.floor(span.end) + groupPreviewOffset);
      for (let breath = Math.max(start, getTimelineViewStart()); breath <= Math.min(end, getTimelineViewEnd(rect)); breath += 1) {
        const x = breathToTimelineX(rect, breath);
        const localIndex = breath - start;
        const visible = isBreathInsideGroupCrop(layout.item, breath);
        const isSingle = start === end;
        const isFirst = localIndex === 0;
        const isLast = breath === end;
        const char = getRasterCellChar({ visible, isSingle, isFirst, isLast });
        const interactionStyle = getRasterInteractionStyle(group.id, span.id, breath);
        const baseWeight = visible ? (isSingle || isFirst || isLast ? 2 : 1) : 1;
        c.set(x, rasterY, {
          char,
          rgb: visible ? interactionStyle.rgb : mutedColor,
          weight_index: visible ? Math.max(baseWeight, interactionStyle.weight) : 1,
          render_index: 2,
        });
      }
    }
    c.set(timelineStartX, timelineY, { char: '(', rgb: rowColor, weight_index: 1, render_index: 2 });
    c.set(timelineEndX, timelineY, { char: ')', rgb: rowColor, weight_index: 1, render_index: 2 });
    const spanStartX = breathToTimelineX(rect, groupBreathStart);
    const spanEndX = breathToTimelineX(rect, groupBreathEnd);
    for (let x = Math.max(timelineInnerStartX, Math.min(spanStartX, spanEndX)); x <= Math.min(timelineInnerEndX, Math.max(spanStartX, spanEndX)); x += 1) {
      c.set(x, timelineY, { char: '═', rgb: rowColor, weight_index: 1, render_index: 2 });
    }
    c.set(spanStartX, timelineY, { char: '[', rgb: selectedColor, weight_index: 2, render_index: 3 });
    c.set(spanEndX, timelineY, { char: ']', rgb: selectedColor, weight_index: 2, render_index: 3 });
    for (const breath of locationKeyBreaths) {
      if (!isBreathVisible(breath)) continue;
      const x = breathToTimelineX(rect, breath);
      c.set(x, timelineY - 1, { char: '•', rgb: rowColor, weight_index: 2, render_index: 2 });
    }
    const cursorX = breathToTimelineX(rect, currentBreath);
    for (let y = rect.y0 + layout.rasterRowY; y <= rect.y0 + layout.footerRowY; y += 1) {
      if (y === rasterY) continue;
      c.set(cursorX, y, {
        char: y === timelineY
            ? (hasExactLocationKey ? '█' : hasExactContentState ? '◆' : '│')
            : '│',
        rgb: hasExactLocationKey && y === timelineY ? selectedColor : mutedColor,
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
        const dropY = contentTopY - (dragState.currentDropIndex * getSectionSpan()) + scrollOffset + 1;
        if (dropY >= contentBottomY && dropY <= contentTopY) {
          for (let x = rect.x0 + 1; x < rect.x1; x += 1) {
            c.set(x, rect.y0 + dropY, { char: '━', rgb: dropIndicatorColor, weight_index: 2, render_index: 3 });
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
        const tempLayout: GroupSectionLayout = {
          item: dragState.draggedGroup,
          sectionTopY: pointerLocalY + 2,
          sectionBottomY: pointerLocalY - (SECTION_HEIGHT - 3),
          titleRowY: pointerLocalY + 1,
          rasterRowY: pointerLocalY,
          spacerRowY: pointerLocalY - 1,
          moveRowY: pointerLocalY - 2,
          turnRowY: pointerLocalY - 3,
          transRowY: pointerLocalY - 4,
          footerRowY: pointerLocalY - 5,
        };
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
      const rasterHit = getRasterHit(layout, currentRect, localX, localY);
      if (rasterHit) {
        if (e.click_count === 2 && e.button === 0) {
          opts.on_split_group_raster_segment?.(group.id, rasterHit.segmentId, timelineXToBreath(currentRect, localX + currentRect.x0));
          return;
        }
        selectGroup(group);
        const segment = getRasterSegments(group).find((entry) => entry.id === rasterHit.segmentId);
        if (!segment) return;
        rasterDragState.active = true;
        rasterDragState.groupId = group.id;
        rasterDragState.segmentId = segment.id;
        rasterDragState.mode = e.button === 2
          ? (rasterHit.mode === 'edge_start'
              ? 'edge_start_dynamic'
              : rasterHit.mode === 'edge_end'
                ? 'edge_end_dynamic'
                : rasterHit.mode === 'body_move'
                  ? 'body_swap'
                  : 'body_dynamic_resize')
          : (rasterHit.mode === 'body_single' ? 'body_move' : rasterHit.mode);
        rasterDragState.button = e.button;
        rasterDragState.originalGroupStart = Math.floor(group.group_start ?? segment.start);
        rasterDragState.originalCropStart = Math.floor(group.breath_start ?? segment.start);
        rasterDragState.originalCropEnd = Math.max(rasterDragState.originalCropStart, Math.floor(group.breath_end ?? segment.end));
        rasterDragState.originalSegmentStart = segment.start;
        rasterDragState.originalSegmentEnd = segment.end;
        rasterDragState.originalLength = segment.length_breaths;
        rasterDragState.anchorBreath = timelineXToBreath(currentRect, localX + currentRect.x0);
        rasterDragState.previewBreath = rasterDragState.anchorBreath;
        rasterDragState.targetSegmentId = null;
        return;
      }
      const spanHandleHit = getSpanHandleHit(layout, currentRect, localX, localY);
      if (spanHandleHit) {
        if (e.button !== 0) return;
        selectGroup(group);
        const resolved = getResolvedGroupSpan(group);
        spanDragState.active = true;
        spanDragState.groupId = group.id;
        spanDragState.handle = spanHandleHit;
        spanDragState.originalStart = resolved.start;
        spanDragState.originalEnd = resolved.end;
        spanDragState.previewBreath = spanHandleHit === 'start' ? resolved.start : resolved.end;
        return;
      }
      const sectionLocalTop = layout.sectionTopY;
      const sectionLocalBottom = layout.sectionBottomY;

      if (localY === layout.titleRowY && localX >= 2 && localX < 18) {
        selectGroup(group);
        return;
      }
      if (localX >= 11 && localX <= 16) {
        if (localY === layout.rasterRowY) {
          toggleGroupVisibility(group);
          return;
        }
        if (localY === layout.moveRowY) {
          dragState.isDragging = true;
          dragState.sourceGroupId = group.id;
          dragState.dragPointerY = e.y;
          dragState.draggedGroup = group;
          dragState.currentDropIndex = getDropIndexForPointer(currentRect, e.y, getGroups());
          return;
        }
        if (localY === layout.turnRowY) {
          if (group.can_delete !== false && getGroups().length > 1) deleteGroup(group);
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
      if (localX >= 2 && localX < 9 && localY <= layout.turnRowY && localY >= layout.rasterRowY) {
        selectGroup(group);
        return;
      }
      if (localX >= 11 && localX < 17 && localY === layout.spacerRowY) {
        toggleGroupLock(group);
        return;
      }
      if (localY >= layout.rasterRowY && localY <= layout.footerRowY && localX >= timelineRegion.startX - currentRect.x0 && localX <= timelineRegion.endX - currentRect.x0) {
        setCurrentBreath(timelineXToBreath(currentRect, localX + currentRect.x0));
        selectGroup(group);
        return;
      }
      selectGroup(group);
    },
    on_drag_move_content(e: DragEvent): void {
      lastPointerLocalPos = { x: e.x - rect.x0, y: e.y - rect.y0 };
      updateRasterHoverState(rect, e.x, e.y);
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
      if (rasterDragState.active) {
        rasterDragState.previewBreath = timelineXToBreath(rect, e.x);
        if (rasterDragState.mode === 'body_swap' && rasterDragState.groupId) {
          const layout = getLayoutAtPointer(rect, e.x, e.y);
          const localX = e.x - rect.x0;
          const localY = e.y - rect.y0;
          const hit = layout ? getRasterHit(layout, rect, localX, localY) : null;
          rasterDragState.targetSegmentId = layout?.item.id === rasterDragState.groupId ? (hit?.segmentId ?? null) : null;
        }
        return;
      }
      if (spanDragState.active) {
        spanDragState.previewBreath = timelineXToBreath(rect, e.x);
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
      if (rasterDragState.active) {
        commitRasterDrag();
        return;
      }
      if (spanDragState.active) {
        commitSpanDrag();
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
    },
  });

  return Object.assign(module, {
    beginRenameGroup,
  });
}
