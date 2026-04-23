import type { Module, Canvas, Rect, PointerEvent, DragEvent } from '../types.js';
import { get_color_by_name } from '../colors.js';
import { MODULE_CHROME_RENDER_INDEX, PANEL_BORDER_PRESETS, draw_panel_horizontal_divider } from '../module_borders.js';
import type { ModuleGizmosConfig } from '../module_gizmos.js';
import { make_floating_panel_module } from './floating_panel_module.js';

export type GroupListItem = {
  id: string;
  label: string;
  selected: boolean;
  visible?: boolean;
  locked?: boolean;
  can_delete?: boolean;
  subtitle?: string;
};

export type GroupsModuleOptions = {
  id: string;
  rect: Rect;
  title?: string;
  get_groups: () => GroupListItem[];
  on_select_group: (id: string) => void;
  on_toggle_group_visibility?: (id: string) => void;
  on_toggle_group_lock?: (id: string) => void;
  on_rename_group: (id: string, next_label: string) => void;
  on_add_group: () => void;
  on_delete_group?: (id: string) => void;
  on_reorder_groups: (ids_in_display_order: string[]) => void;
  on_move?: (new_rect: Rect) => void;
  on_resize?: (new_rect: Rect) => void;
  on_close?: () => void;
};

const COL_DRAG = 1;
const COL_VIS = 3;
const COL_LOCK = 5;
const COL_ORDER_START = 7;
const COL_NAME_START = 10;
const HEADER_COL_DRAG = 1;
const HEADER_COL_VIS = 3;
const HEADER_COL_LOCK = 5;
const MIN_WIDTH = 20;
const MAX_WIDTH = 50;
const MIN_HEIGHT = 8;
const MAX_HEIGHT = 40;

export function makeGroupsModule(opts: GroupsModuleOptions): Module {
  let rect = opts.rect;
  let scrollOffset = 0;
  const headerHeight = 3;

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

  let dragState: {
    isDragging: boolean;
    sourceGroupId: string | null;
    dragStartY: number;
    dragStartX: number;
    currentDropIndex: number | null;
    draggedGroup: GroupListItem | null;
  } = {
    isDragging: false,
    sourceGroupId: null,
    dragStartY: 0,
    dragStartX: 0,
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

  const module = make_floating_panel_module({
    id: opts.id,
    rect: opts.rect,
    title: opts.title ?? 'GROUPS',
    gizmos: gizmo_config,
    background: { rgb: bgColor },
    border: {
      style: PANEL_BORDER_PRESETS.default_double.style,
      border_rgb: borderColor,
      weight_index: PANEL_BORDER_PRESETS.default_double.weight_index,
      text_rgb: textColor,
      markers: () => {
        const groups = getGroups();
        const contentHeight = rect.y1 - rect.y0 - 4;
        return {
          top: scrollOffset > 0 ? '^' : undefined,
          bottom: scrollOffset < Math.max(0, groups.length - contentHeight) ? 'v' : undefined,
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
      const titleY = rect.y1 - 1;
      c.set(rect.x1 - 2, titleY, { char: '[', rgb: borderColor, weight_index: 1, render_index: MODULE_CHROME_RENDER_INDEX + 1 });
      c.set(rect.x1 - 1, titleY, { char: '+', rgb: visibleColor, weight_index: 2, render_index: MODULE_CHROME_RENDER_INDEX + 1 });
      const headerY = rect.y1 - 2;
      c.set(rect.x0 + HEADER_COL_DRAG, headerY, { char: '☰', rgb: dragHandleColor, weight_index: 1, render_index: MODULE_CHROME_RENDER_INDEX + 1 });
      c.set(rect.x0 + HEADER_COL_VIS, headerY, { char: 'V', rgb: borderColor, weight_index: 1, render_index: MODULE_CHROME_RENDER_INDEX + 1 });
      c.set(rect.x0 + HEADER_COL_LOCK, headerY, { char: 'L', rgb: borderColor, weight_index: 1, render_index: MODULE_CHROME_RENDER_INDEX + 1 });
      c.set(rect.x0 + COL_ORDER_START, headerY, { char: '#', rgb: borderColor, weight_index: 1, render_index: MODULE_CHROME_RENDER_INDEX + 1 });
      const separatorY = rect.y1 - 3;
      draw_panel_horizontal_divider(c, {
        y: separatorY,
        rect,
        style: PANEL_BORDER_PRESETS.default_double.style,
        rgb: borderColor,
        weight_index: 1,
      });

      const groups = getGroups();
      const contentStartY = separatorY - 1;
      const contentEndY = rect.y0 + 1;
      const maxVisibleRows = contentStartY - contentEndY + 1;
      if (scrollOffset < 0) scrollOffset = 0;
      if (scrollOffset > Math.max(0, groups.length - maxVisibleRows)) scrollOffset = Math.max(0, groups.length - maxVisibleRows);

      if (dragState.isDragging && dragState.currentDropIndex !== null) {
        const dropY = contentStartY - dragState.currentDropIndex + scrollOffset;
        if (dropY >= contentEndY && dropY <= contentStartY) {
          for (let x = rect.x0 + 1; x < rect.x1; x += 1) {
            c.set(x, dropY, { char: '━', rgb: dropIndicatorColor, weight_index: 2, render_index: 2 });
          }
        }
      }

      for (let i = 0; i < groups.length; i += 1) {
        const group = groups[i]!;
        const rowY = contentStartY - i + scrollOffset;
        if (rowY < contentEndY || rowY > contentStartY) continue;
        if (dragState.isDragging && dragState.sourceGroupId === group.id) continue;
        const isBeingRenamed = renameState.isRenaming && renameState.groupId === group.id;
        const rowColor = group.selected ? selectedColor : textColor;
        const visualOrder = getVisualOrder(group.id);
        c.set(rect.x0 + COL_DRAG, rowY, { char: '☰', rgb: dragHandleColor, weight_index: 1, render_index: 1 });
        c.set(rect.x0 + COL_VIS, rowY, { char: group.visible === false ? '○' : '●', rgb: group.visible === false ? hiddenColor : visibleColor, weight_index: 2, render_index: 1 });
        c.set(rect.x0 + COL_LOCK, rowY, { char: group.locked ? '🔒' : ' ', rgb: lockedColor, weight_index: 2, render_index: 1 });
        const orderStr = visualOrder.toString().padStart(2, ' ');
        for (let j = 0; j < orderStr.length && rect.x0 + COL_ORDER_START + j < rect.x1; j += 1) {
          c.set(rect.x0 + COL_ORDER_START + j, rowY, { char: orderStr[j]!, rgb: orderNumColor, weight_index: group.selected ? 2 : 1, render_index: 1 });
        }
        const nameStart = rect.x0 + COL_NAME_START;
        const maxNameWidth = rect.x1 - nameStart - 3;
        if (isBeingRenamed) {
          for (let x = nameStart; x < rect.x1 - 2 && x < nameStart + maxNameWidth; x += 1) {
            c.set(x, rowY, { char: ' ', rgb: editBgColor, weight_index: 0, render_index: 2 });
          }
          const displayText = renameState.editText.slice(0, maxNameWidth);
          for (let j = 0; j < displayText.length && nameStart + j < rect.x1 - 2; j += 1) {
            const isCursor = j === renameState.cursorPosition;
            c.set(nameStart + j, rowY, { char: displayText[j]!, rgb: isCursor ? editCursorColor : textColor, weight_index: 2, render_index: 2 });
          }
          if (renameState.cursorPosition >= displayText.length && nameStart + displayText.length < rect.x1 - 2) {
            c.set(nameStart + displayText.length, rowY, { char: '▏', rgb: editCursorColor, weight_index: 2, render_index: 2 });
          }
        } else {
          const displayLabel = group.label.slice(0, maxNameWidth);
          for (let j = 0; j < displayLabel.length && nameStart + j <= rect.x1; j += 1) {
            c.set(nameStart + j, rowY, { char: displayLabel[j]!, rgb: rowColor, weight_index: group.selected ? 2 : 1, render_index: 1 });
          }
        }
        if (group.can_delete !== false && groups.length > 1) {
          c.set(rect.x1 - 2, rowY, { char: '✕', rgb: deleteColor, weight_index: 2, render_index: 1 });
        }
        if (group.selected && !isBeingRenamed) {
          c.set(rect.x1 - 1, rowY, { char: '▶', rgb: selectedColor, weight_index: 2, render_index: 1 });
        }
      }

      if (dragState.isDragging && dragState.draggedGroup) {
        const mouseY = dragState.dragStartY;
        const group = dragState.draggedGroup;
        const rowColor = group.selected ? selectedColor : textColor;
        const dragBgColor = get_color_by_name('deep_blue').rgb;
        for (let x = rect.x0 + 1; x < rect.x1; x += 1) {
          c.set(x, mouseY, { char: ' ', rgb: dragBgColor, weight_index: 0, render_index: 2 });
        }
        c.set(rect.x0 + COL_DRAG, mouseY, { char: '☰', rgb: dragHandleColor, weight_index: 1, render_index: 2 });
        c.set(rect.x0 + COL_VIS, mouseY, { char: group.visible === false ? '○' : '●', rgb: group.visible === false ? hiddenColor : visibleColor, weight_index: 2, render_index: 2 });
        c.set(rect.x0 + COL_LOCK, mouseY, { char: group.locked ? '🔒' : ' ', rgb: lockedColor, weight_index: 2, render_index: 2 });
        const orderStr = getVisualOrder(group.id).toString().padStart(2, ' ');
        for (let j = 0; j < orderStr.length && rect.x0 + COL_ORDER_START + j < rect.x1; j += 1) {
          c.set(rect.x0 + COL_ORDER_START + j, mouseY, { char: orderStr[j]!, rgb: orderNumColor, weight_index: group.selected ? 2 : 1, render_index: 2 });
        }
        const nameStart = rect.x0 + COL_NAME_START;
        const maxNameWidth = rect.x1 - nameStart - 3;
        const displayName = group.label.slice(0, maxNameWidth);
        for (let j = 0; j < displayName.length && nameStart + j <= rect.x1; j += 1) {
          c.set(nameStart + j, mouseY, { char: displayName[j]!, rgb: rowColor, weight_index: group.selected ? 2 : 1, render_index: 2 });
        }
      }
    },
    on_pointer_down_content(e: PointerEvent, currentRect: Rect): void {
      if (e.button !== 0) return;
      if (renameState.isRenaming) {
        const localY = e.y - currentRect.y0;
        const separatorY = currentRect.y1 - currentRect.y0 - 3;
        const contentStartY = separatorY - 1;
        const rowFromTop = contentStartY - localY + scrollOffset;
        let clickedOnRenameField = false;
        if (rowFromTop >= 0) {
          const groups = getGroups();
          if (rowFromTop < groups.length) {
            const group = groups[rowFromTop]!;
            if (group.id === renameState.groupId) {
              const localX = e.x - currentRect.x0;
              if (localX >= COL_NAME_START) clickedOnRenameField = true;
            }
          }
        }
        if (!clickedOnRenameField) {
          if (renameState.groupId !== null) renameGroup(renameState.groupId, renameState.editText);
          renameState.isRenaming = false;
          renameState.groupId = null;
        }
      }
      const localY = e.y - currentRect.y0;
      const localX = e.x - currentRect.x0;
      const titleY = currentRect.y1 - currentRect.y0 - 1;
      if (localY === titleY && localX >= currentRect.x1 - currentRect.x0 - 2) {
        opts.on_add_group();
        return;
      }
      const separatorY = currentRect.y1 - currentRect.y0 - 3;
      const contentStartY = separatorY - 1;
      const rowFromTop = contentStartY - localY + scrollOffset;
      if (rowFromTop < 0) return;
      const groups = getGroups();
      if (rowFromTop >= groups.length) return;
      const group = groups[rowFromTop]!;
      if (localX === COL_VIS) {
        toggleGroupVisibility(group);
      } else if (localX === COL_LOCK) {
        toggleGroupLock(group);
      } else if (localX === currentRect.x1 - currentRect.x0 - 2 && group.can_delete !== false && groups.length > 1) {
        deleteGroup(group);
      } else if (localX === COL_DRAG || (localX >= COL_ORDER_START && localX < COL_NAME_START)) {
        dragState.isDragging = true;
        dragState.sourceGroupId = group.id;
        dragState.dragStartY = e.y;
        dragState.dragStartX = e.x;
        dragState.draggedGroup = group;
        dragState.currentDropIndex = rowFromTop;
      } else if (localX >= COL_NAME_START && localX < currentRect.x1 - currentRect.x0 - 2) {
        selectGroup(group);
        if (renameState.isRenaming && renameState.groupId !== group.id && renameState.groupId !== null) {
          renameGroup(renameState.groupId, renameState.editText);
        }
        beginRenameGroup(group.id);
      }
    },
    on_drag_move_content(e: DragEvent): void {
      if (dragState.isDragging) {
        dragState.dragStartY = e.y;
        const separatorY = rect.y1 - headerHeight;
        const contentStartY = separatorY - 1;
        const rowFromTop = contentStartY - e.y + scrollOffset;
        const groups = getGroups();
        dragState.currentDropIndex = Math.max(0, Math.min(groups.length, Math.round(rowFromTop)));
      }
    },
    on_pointer_up_content(): void {
      if (dragState.isDragging && dragState.sourceGroupId !== null) {
        if (dragState.currentDropIndex !== null) {
          reorderGroups(getGroups(), dragState.sourceGroupId, dragState.currentDropIndex);
        }
        dragState.isDragging = false;
        dragState.sourceGroupId = null;
        dragState.currentDropIndex = null;
        dragState.draggedGroup = null;
      }
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
      const groups = getGroups();
      const contentHeight = rect.y1 - rect.y0 - 4;
      if (e.delta_y > 0) {
        scrollOffset = Math.min(scrollOffset + 1, Math.max(0, groups.length - contentHeight));
      } else {
        scrollOffset = Math.max(scrollOffset - 1, 0);
      }
    },
  });

  return Object.assign(module, {
    beginRenameGroup,
  });
}
