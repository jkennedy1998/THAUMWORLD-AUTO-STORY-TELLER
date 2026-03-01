/**
 * Layer Palette Module
 * 
 * UI panel for managing VoxelSpace layers.
 * Shows all layers, allows selection, visibility toggle, reordering via drag-drop, renaming, etc.
 * 
 * Layout (per row):
 *   Col 1: Drag handle (☰) - drag to reorder
 *   Col 3: Visibility (●/○) - click to toggle
 *   Col 5: Lock (🔒) - click to toggle  
 *   Col 7-8: Order # (##) - can also drag to reorder
 *   Col 10+: Name - click to select & rename
 *   Col -2: Delete (✕)
 *   Col -1: Selection (▶)
 * 
 * Coordinate system: Bottom-left origin (y0 is bottom, y1 is top)
 */

import type { Module, Canvas, Rect, PointerEvent, DragEvent } from '../mono_ui/types.js';
import type { VoxelSpace, VoxelLayer } from './voxel_space.js';
import { get_color_by_name } from '../mono_ui/colors.js';
import { addLayer, removeLayer, duplicateLayer, getVisibleLayers } from './voxel_space.js';
import type { ModuleGizmosConfig, GizmoState } from '../mono_ui/module_gizmos.js';
import { draw_module_gizmos, handle_gizmo_click, create_gizmo_state, is_in_gizmo_area, get_resize_edge, handle_resize_drag } from '../mono_ui/module_gizmos.js';

export type LayerPaletteOptions = {
  id: string;
  rect: Rect;
  space: VoxelSpace;
  onLayerSelect: (z: number) => void;
  onLayerVisibilityToggle: (z: number) => void;
  onLayerLockToggle: (z: number) => void;
  onLayerRename: (z: number, newName: string) => void;
  onAddLayer: () => void;
  onDeleteLayer: (z: number) => void;
  onDuplicateLayer: (z: number) => void;
  onMergeDown: (z: number) => void;
  onReorderLayers: (newZOrder: number[]) => void;
  onMove?: (new_rect: Rect) => void;
  onResize?: (new_rect: Rect) => void;
  onClose?: () => void;
};

// Layout constants - column positions within each row (relative to rect.x0)
const COL_DRAG = 1;        // Drag handle (☰)
const COL_VIS = 3;         // Visibility toggle (●/○)
const COL_LOCK = 5;        // Lock indicator (🔒)
const COL_ORDER_START = 7; // Order number starts here (2 chars)
const COL_NAME_START = 10; // Layer name starts here
const HEADER_COL_DRAG = 1; // Header column for drag
const HEADER_COL_VIS = 3;  // Header column for visibility
const HEADER_COL_LOCK = 5; // Header column for lock

// Size constraints
const MIN_WIDTH = 20;
const MAX_WIDTH = 50;
const MIN_HEIGHT = 8;
const MAX_HEIGHT = 40;

export function makeLayerPaletteModule(opts: LayerPaletteOptions): Module {
  let rect = opts.rect;
  let scrollOffset = 0;
  const headerHeight = 3;
  
  // Colors
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
  
  // Drag state
  let dragState: {
    isDragging: boolean;
    sourceLayerZ: number | null;
    dragStartY: number;
    dragStartX: number;
    currentDropIndex: number | null;
    draggedLayer: VoxelLayer | null;
  } = {
    isDragging: false,
    sourceLayerZ: null,
    dragStartY: 0,
    dragStartX: 0,
    currentDropIndex: null,
    draggedLayer: null,
  };
  
  // Rename state
  let renameState: {
    isRenaming: boolean;
    layerZ: number | null;
    editText: string;
    cursorPosition: number;
  } = {
    isRenaming: false,
    layerZ: null,
    editText: '',
    cursorPosition: 0,
  };
  
  // Gizmo configuration
  const gizmo_config: ModuleGizmosConfig = {
    enabled: ['move', 'resize', 'close'],
    can_close: true,
    can_move: true,
    can_save_position: false,
    on_close: opts.onClose,
    on_move: opts.onMove,
  };
  
  const gizmo_state: GizmoState = create_gizmo_state();
  
  function getSortedLayers(): VoxelLayer[] {
    return Array.from(opts.space.layers.values())
      .sort((a, b) => b.z - a.z);
  }
  
  // Calculate Y position for a given row index
  // Row 0 is at the top of the content area (just below the separator)
  function getRowY(index: number): number {
    const separatorY = rect.y1 - headerHeight;  // separator is at y1 - 3
    const contentStartY = separatorY - 1;        // first row is below separator
    return contentStartY - index + scrollOffset;
  }
  
  function getVisualOrder(z: number): number {
    const layers = getSortedLayers();
    const index = layers.findIndex(l => l.z === z);
    return index + 1;
  }
  
  const module: Module = {
    id: opts.id,
    rect,
    Focusable: true, // IMPORTANT: Allows receiving keyboard events
    
    Draw(c: Canvas): void {
      c.fill_rect(rect, { char: ' ', rgb: bgColor, weight_index: 0, render_index: 0 });
      
      if (!gizmo_state.is_resize_mode) {
        for (let x = rect.x0; x <= rect.x1; x++) {
          c.set(x, rect.y1, { char: '─', rgb: borderColor, weight_index: 3, render_index: 1 });
          c.set(x, rect.y0, { char: '─', rgb: borderColor, weight_index: 3, render_index: 1 });
        }
        for (let y = rect.y0; y <= rect.y1; y++) {
          c.set(rect.x0, y, { char: '│', rgb: borderColor, weight_index: 3, render_index: 1 });
          c.set(rect.x1, y, { char: '│', rgb: borderColor, weight_index: 3, render_index: 1 });
        }
        c.set(rect.x0, rect.y1, { char: '┌', rgb: borderColor, weight_index: 3, render_index: 1 });
        c.set(rect.x1, rect.y1, { char: '┐', rgb: borderColor, weight_index: 3, render_index: 1 });
        c.set(rect.x0, rect.y0, { char: '└', rgb: borderColor, weight_index: 3, render_index: 1 });
        c.set(rect.x1, rect.y0, { char: '┘', rgb: borderColor, weight_index: 3, render_index: 1 });
      }
      
      // Header
      const titleY = rect.y1 - 1;
      const title = 'Layers';
      let titleX = rect.x0 + 6;
      for (let i = 0; i < title.length && titleX + i <= rect.x1; i++) {
        c.set(titleX + i, titleY, { 
          char: title[i]!, 
          rgb: textColor, 
          weight_index: 5,
          render_index: 1 
        });
      }
      
      // [+] button
      c.set(rect.x1 - 2, titleY, { char: '[', rgb: borderColor, weight_index: 3, render_index: 1 });
      c.set(rect.x1 - 1, titleY, { char: '+', rgb: visibleColor, weight_index: 5, render_index: 1 });
      c.set(rect.x1, titleY, { char: ']', rgb: borderColor, weight_index: 3, render_index: 1 });
      
      // Column headers
      const headerY = rect.y1 - 2;
      c.set(rect.x0 + HEADER_COL_DRAG, headerY, { char: '☰', rgb: dragHandleColor, weight_index: 3, render_index: 1 });
      c.set(rect.x0 + HEADER_COL_VIS, headerY, { char: 'V', rgb: borderColor, weight_index: 3, render_index: 1 });
      c.set(rect.x0 + HEADER_COL_LOCK, headerY, { char: 'L', rgb: borderColor, weight_index: 3, render_index: 1 });
      c.set(rect.x0 + COL_ORDER_START, headerY, { char: '#', rgb: borderColor, weight_index: 3, render_index: 1 });
      
      // Separator
      const separatorY = rect.y1 - 3;
      for (let x = rect.x0 + 1; x < rect.x1; x++) {
        c.set(x, separatorY, { char: '─', rgb: borderColor, weight_index: 2, render_index: 1 });
      }
      c.set(rect.x0, separatorY, { char: '├', rgb: borderColor, weight_index: 3, render_index: 1 });
      c.set(rect.x1, separatorY, { char: '┤', rgb: borderColor, weight_index: 3, render_index: 1 });
      
      const layers = getSortedLayers();
      const contentStartY = separatorY - 1;
      const contentEndY = rect.y0 + 1;
      const maxVisibleRows = contentStartY - contentEndY + 1;
      
      if (scrollOffset < 0) scrollOffset = 0;
      if (scrollOffset > Math.max(0, layers.length - maxVisibleRows)) {
        scrollOffset = Math.max(0, layers.length - maxVisibleRows);
      }
      
      // Drop indicator line
      if (dragState.isDragging && dragState.currentDropIndex !== null) {
        const dropY = getRowY(dragState.currentDropIndex);
        if (dropY >= contentEndY && dropY <= contentStartY) {
          for (let x = rect.x0 + 1; x < rect.x1; x++) {
            c.set(x, dropY, { 
              char: '━', 
              rgb: dropIndicatorColor, 
              weight_index: 5,
              render_index: 2 
            });
          }
        }
      }
      
      // Draw layers
      for (let i = 0; i < layers.length; i++) {
        const layer = layers[i]!;
        const rowY = contentStartY - i + scrollOffset;
        
        if (rowY < contentEndY || rowY > contentStartY) continue;
        
        if (dragState.isDragging && dragState.sourceLayerZ === layer.z) {
          continue;
        }
        
        const isSelected = layer.z === opts.space.camera.focus_plane;
        const isBeingRenamed = renameState.isRenaming && renameState.layerZ === layer.z;
        const rowColor = isSelected ? selectedColor : textColor;
        const visualOrder = getVisualOrder(layer.z);
        
        // Drag handle (☰)
        c.set(rect.x0 + COL_DRAG, rowY, { 
          char: '☰', 
          rgb: dragHandleColor,
          weight_index: 3,
          render_index: 1 
        });
        
        // Visibility indicator
        c.set(rect.x0 + COL_VIS, rowY, { 
          char: layer.visible ? '●' : '○', 
          rgb: layer.visible ? visibleColor : hiddenColor,
          weight_index: 4,
          render_index: 1 
        });
        
        // Lock indicator
        c.set(rect.x0 + COL_LOCK, rowY, { 
          char: layer.locked ? '🔒' : ' ',
          rgb: lockedColor,
          weight_index: 4,
          render_index: 1 
        });
        
        // Visual order number (2 digits)
        const orderStr = visualOrder.toString().padStart(2, ' ');
        for (let j = 0; j < orderStr.length && rect.x0 + COL_ORDER_START + j < rect.x1; j++) {
          c.set(rect.x0 + COL_ORDER_START + j, rowY, { 
            char: orderStr[j]!, 
            rgb: orderNumColor,
            weight_index: isSelected ? 5 : 3,
            render_index: 1 
          });
        }
        
        // Layer name or rename field
        const nameStart = rect.x0 + COL_NAME_START;
        const maxNameWidth = rect.x1 - nameStart - 3;
        
        if (isBeingRenamed) {
          // Draw rename field background
          for (let x = nameStart; x < rect.x1 - 2 && x < nameStart + maxNameWidth; x++) {
            c.set(x, rowY, { 
              char: ' ', 
              rgb: editBgColor, 
              weight_index: 0,
              render_index: 2 
            });
          }
          
          // Draw the text being edited
          const displayText = renameState.editText.slice(0, maxNameWidth);
          for (let j = 0; j < displayText.length && nameStart + j < rect.x1 - 2; j++) {
            const isCursor = j === renameState.cursorPosition;
            c.set(nameStart + j, rowY, { 
              char: displayText[j]!, 
              rgb: isCursor ? editCursorColor : textColor,
              weight_index: isCursor ? 5 : 4,
              render_index: 2 
            });
          }
          
          // Draw cursor if at end
          if (renameState.cursorPosition >= displayText.length && nameStart + displayText.length < rect.x1 - 2) {
            c.set(nameStart + displayText.length, rowY, { 
              char: '▏', 
              rgb: editCursorColor,
              weight_index: 5,
              render_index: 2 
            });
          }
        } else {
          // Normal display
          const displayName = layer.name.slice(0, maxNameWidth);
          
          for (let j = 0; j < displayName.length && nameStart + j <= rect.x1; j++) {
            c.set(nameStart + j, rowY, { 
              char: displayName[j]!, 
              rgb: rowColor,
              weight_index: isSelected ? 5 : 3,
              render_index: 1 
            });
          }
        }
        
        // Delete button
        if (layers.length > 1) {
          c.set(rect.x1 - 2, rowY, { 
            char: '✕', 
            rgb: deleteColor,
            weight_index: 4,
            render_index: 1 
          });
        }
        
        // Selection indicator
        if (isSelected && !isBeingRenamed) {
          c.set(rect.x1 - 1, rowY, { 
            char: '▶', 
            rgb: selectedColor,
            weight_index: 5,
            render_index: 1 
          });
        }
      }
      
      // Draw dragged layer at mouse position
      if (dragState.isDragging && dragState.draggedLayer) {
        const mouseY = dragState.dragStartY;
        const layer = dragState.draggedLayer;
        const isSelected = layer.z === opts.space.camera.focus_plane;
        const rowColor = isSelected ? selectedColor : textColor;
        const dragBgColor = get_color_by_name('deep_blue').rgb;
        
        for (let x = rect.x0 + 1; x < rect.x1; x++) {
          c.set(x, mouseY, { 
            char: ' ', 
            rgb: dragBgColor, 
            weight_index: 0,
            render_index: 2 
          });
        }
        
        c.set(rect.x0 + COL_DRAG, mouseY, { 
          char: '☰', 
          rgb: dragHandleColor,
          weight_index: 3,
          render_index: 2 
        });
        
        c.set(rect.x0 + COL_VIS, mouseY, { 
          char: layer.visible ? '●' : '○', 
          rgb: layer.visible ? visibleColor : hiddenColor,
          weight_index: 4,
          render_index: 2 
        });
        
        c.set(rect.x0 + COL_LOCK, mouseY, { 
          char: layer.locked ? '🔒' : ' ',
          rgb: lockedColor,
          weight_index: 4,
          render_index: 2 
        });
        
        const visualOrder = getVisualOrder(layer.z);
        const orderStr = visualOrder.toString().padStart(2, ' ');
        for (let j = 0; j < orderStr.length && rect.x0 + COL_ORDER_START + j < rect.x1; j++) {
          c.set(rect.x0 + COL_ORDER_START + j, mouseY, { 
            char: orderStr[j]!, 
            rgb: orderNumColor,
            weight_index: isSelected ? 5 : 3,
            render_index: 2 
          });
        }
        
        const nameStart = rect.x0 + COL_NAME_START;
        const maxNameWidth = rect.x1 - nameStart - 3;
        const displayName = layer.name.slice(0, maxNameWidth);
        
        for (let j = 0; j < displayName.length && nameStart + j <= rect.x1; j++) {
          c.set(nameStart + j, mouseY, { 
            char: displayName[j]!, 
            rgb: rowColor,
            weight_index: isSelected ? 5 : 3,
            render_index: 2 
          });
        }
      }
      
      // Scroll indicators
      if (scrollOffset > 0) {
        c.set(rect.x1 - 1, contentStartY + 1, { char: '▲', rgb: borderColor, weight_index: 3, render_index: 1 });
      }
      if (scrollOffset < layers.length - maxVisibleRows) {
        c.set(rect.x1 - 1, contentEndY, { char: '▼', rgb: borderColor, weight_index: 3, render_index: 1 });
      }

      draw_module_gizmos(c, rect, gizmo_config, gizmo_state, 'LAYERS');
    },
    
    OnPointerDown(e: PointerEvent): void {
      // If currently renaming, check if we clicked elsewhere
      if (renameState.isRenaming) {
        const localY = e.y - rect.y0;
        const separatorY = rect.y1 - rect.y0 - 3;
        const contentStartY = separatorY - 1;
        const rowFromTop = contentStartY - localY + scrollOffset;
        
        let clickedOnRenameField = false;
        if (rowFromTop >= 0) {
          const layers = getSortedLayers();
          if (rowFromTop < layers.length) {
            const layer = layers[rowFromTop]!;
            if (layer.z === renameState.layerZ) {
              const localX = e.x - rect.x0;
              if (localX >= COL_NAME_START) {
                clickedOnRenameField = true;
              }
            }
          }
        }
        
        if (!clickedOnRenameField) {
          // Clicked outside rename field, confirm rename
          if (renameState.layerZ !== null) {
            opts.onLayerRename(renameState.layerZ, renameState.editText);
          }
          renameState.isRenaming = false;
          renameState.layerZ = null;
        }
      }
      
      // Handle gizmo clicks
      if (is_in_gizmo_area(e.x, e.y, rect)) {
        const gizmo = handle_gizmo_click(e.x, e.y, rect, gizmo_config, gizmo_state);
        if (gizmo === 'move') {
          gizmo_state.move_start_x = e.x;
          gizmo_state.move_start_y = e.y;
          gizmo_state.original_rect = { ...rect };
        }
        return;
      }
      
      // Resize edge click
      if (gizmo_state.is_resize_mode) {
        const edge = get_resize_edge(e.x, e.y, rect);
        if (edge) {
          gizmo_state.resize_edge = edge;
          gizmo_state.is_dragging_resize = true;
          gizmo_state.move_start_x = e.x;
          gizmo_state.move_start_y = e.y;
          gizmo_state.original_rect = { ...rect };
          return;
        }
      }
      
      // Move mode
      if (gizmo_state.is_move_mode) {
        gizmo_state.move_start_x = e.x;
        gizmo_state.move_start_y = e.y;
        gizmo_state.original_rect = { ...rect };
        return;
      }
      
      const localY = e.y - rect.y0;
      const localX = e.x - rect.x0;
      
      // [+] button
      const titleY = rect.y1 - rect.y0 - 1;
      if (localY === titleY && localX >= rect.x1 - rect.x0 - 2) {
        opts.onAddLayer();
        return;
      }
      
      // Layer row click
      const separatorY = rect.y1 - rect.y0 - 3;
      const contentStartY = separatorY - 1;
      const rowFromTop = contentStartY - localY + scrollOffset;
      
      if (rowFromTop < 0) return;
      
      const layers = getSortedLayers();
      if (rowFromTop >= layers.length) return;
      
      const layer = layers[rowFromTop]!;
      
      // Check which column was clicked
      if (localX === COL_VIS) {
        // Visibility toggle
        opts.onLayerVisibilityToggle(layer.z);
      } else if (localX === COL_LOCK) {
        // Lock toggle
        opts.onLayerLockToggle(layer.z);
      } else if (localX === rect.x1 - rect.x0 - 2 && layers.length > 1) {
        // Delete button
        opts.onDeleteLayer(layer.z);
      } else if (localX === COL_DRAG || (localX >= COL_ORDER_START && localX < COL_NAME_START)) {
        // Drag handle OR order number clicked - start dragging immediately
        dragState.isDragging = true;
        dragState.sourceLayerZ = layer.z;
        dragState.dragStartY = e.y;
        dragState.dragStartX = e.x;
        dragState.draggedLayer = layer;
        dragState.currentDropIndex = rowFromTop;
      } else if (localX >= COL_NAME_START && localX < rect.x1 - rect.x0 - 2) {
        // Name clicked - select layer AND start rename
        // First select the layer
        opts.onLayerSelect(layer.z);
        
        // Then enter rename mode
        if (renameState.isRenaming && renameState.layerZ !== layer.z) {
          // Confirm any existing rename first
          if (renameState.layerZ !== null) {
            opts.onLayerRename(renameState.layerZ, renameState.editText);
          }
        }
        
        renameState.isRenaming = true;
        renameState.layerZ = layer.z;
        renameState.editText = layer.name;
        renameState.cursorPosition = layer.name.length;
      }
    },
    
    OnDragMove(e: DragEvent): void {
      // Move mode
      if (gizmo_state.is_move_mode && gizmo_state.original_rect) {
        const dx = e.x - gizmo_state.move_start_x;
        const dy = e.y - gizmo_state.move_start_y;
        
        const newRect: Rect = {
          x0: gizmo_state.original_rect.x0 + dx,
          y0: gizmo_state.original_rect.y0 + dy,
          y1: gizmo_state.original_rect.y1 + dy,
          x1: gizmo_state.original_rect.x1 + dx,
        };
        
        rect = newRect;
        
        if (opts.onMove) {
          opts.onMove(rect);
        }
        return;
      }
      
      // Resize
      if (gizmo_state.is_resize_mode && gizmo_state.is_dragging_resize && gizmo_state.original_rect) {
        const newRect = handle_resize_drag(
          e.x, e.y, gizmo_state, gizmo_state.original_rect,
          MIN_WIDTH, MIN_HEIGHT, MAX_WIDTH, MAX_HEIGHT,
          (newRect) => {
            rect = newRect;
            if (opts.onResize) {
              opts.onResize(rect);
            }
          }
        );
        
        if (newRect) {
          rect = newRect;
        }
        return;
      }
      
      // Layer dragging - update position
      if (dragState.isDragging) {
        dragState.dragStartY = e.y;
        
        // Use same calculation as getRowY but in reverse
        // getRowY(index) = contentStartY - index + scrollOffset
        // So: index = contentStartY - Y + scrollOffset
        const separatorY = rect.y1 - headerHeight;
        const contentStartY = separatorY - 1;
        
        // Calculate which row index the mouse is at
        // When mouse is at contentStartY, rowFromTop should be 0
        const rowFromTop = contentStartY - e.y + scrollOffset;
        
        const layers = getSortedLayers();
        // Round to nearest row and clamp to valid range
        // dropIndex can be 0 to layers.length (drop after last layer)
        const clampedIndex = Math.max(0, Math.min(layers.length, Math.round(rowFromTop)));
        dragState.currentDropIndex = clampedIndex;
      }
    },
    
    OnPointerUp(e: PointerEvent): void {
      // Move mode
      if (gizmo_state.is_move_mode) {
        gizmo_state.is_move_mode = false;
        gizmo_state.original_rect = null;
        if (opts.onMove) {
          opts.onMove(rect);
        }
      }
      
      // Resize
      if (gizmo_state.is_dragging_resize) {
        gizmo_state.is_dragging_resize = false;
        gizmo_state.resize_edge = null;
        if (opts.onResize) {
          opts.onResize(rect);
        }
      }
      
      // Layer drop
      if (dragState.isDragging && dragState.sourceLayerZ !== null) {
        if (dragState.currentDropIndex !== null) {
          const layers = getSortedLayers();
          const sourceIndex = layers.findIndex(l => l.z === dragState.sourceLayerZ);
          
          // Calculate effective drop index based on drag direction
          // When dragging DOWN, we need to adjust because we removed the source layer
          let effectiveDropIndex = dragState.currentDropIndex;
          if (dragState.currentDropIndex > sourceIndex) {
            // Dragging down: the drop index in the filtered array is one less
            // because we removed the source layer which was before the drop point
            effectiveDropIndex = dragState.currentDropIndex - 1;
          }
          
          // Only reorder if moved to a different position
          // For dragging UP: can't drop at same index or one before (would be same position)
          // For dragging DOWN: can't drop at same index or one after (would be same position)
          const isDifferentPosition = 
            (dragState.currentDropIndex < sourceIndex && dragState.currentDropIndex !== sourceIndex) ||
            (dragState.currentDropIndex > sourceIndex && effectiveDropIndex !== sourceIndex);
          
          if (isDifferentPosition) {
            // Build new order
            const remainingLayers = layers.filter(l => l.z !== dragState.sourceLayerZ);
            const newOrder: number[] = [];
            
            // Clamp effective drop index to valid range
            const clampedDropIndex = Math.max(0, Math.min(remainingLayers.length, effectiveDropIndex));
            
            // Insert layers before drop position
            for (let i = 0; i < clampedDropIndex && i < remainingLayers.length; i++) {
              newOrder.push(remainingLayers[i]!.z);
            }
            
            // Insert dragged layer
            newOrder.push(dragState.sourceLayerZ);
            
            // Insert remaining layers after
            for (let i = clampedDropIndex; i < remainingLayers.length; i++) {
              newOrder.push(remainingLayers[i]!.z);
            }
            
            opts.onReorderLayers(newOrder);
          }
        }
        
        // Reset drag state
        dragState.isDragging = false;
        dragState.sourceLayerZ = null;
        dragState.currentDropIndex = null;
        dragState.draggedLayer = null;
      }
    },
    
    OnKeyDown(e: KeyboardEvent): void {
      if (!renameState.isRenaming) return;
      
      if (e.key === 'Enter') {
        // Confirm rename
        if (renameState.layerZ !== null) {
          opts.onLayerRename(renameState.layerZ, renameState.editText);
        }
        renameState.isRenaming = false;
        renameState.layerZ = null;
        e.preventDefault();
      } else if (e.key === 'Escape') {
        // Cancel rename
        renameState.isRenaming = false;
        renameState.layerZ = null;
        e.preventDefault();
      } else if (e.key === 'Backspace') {
        // Delete character before cursor
        if (renameState.cursorPosition > 0) {
          renameState.editText = 
            renameState.editText.slice(0, renameState.cursorPosition - 1) +
            renameState.editText.slice(renameState.cursorPosition);
          renameState.cursorPosition--;
        }
        e.preventDefault();
      } else if (e.key === 'Delete') {
        // Delete character at cursor
        if (renameState.cursorPosition < renameState.editText.length) {
          renameState.editText = 
            renameState.editText.slice(0, renameState.cursorPosition) +
            renameState.editText.slice(renameState.cursorPosition + 1);
        }
        e.preventDefault();
      } else if (e.key === 'ArrowLeft') {
        // Move cursor left
        if (renameState.cursorPosition > 0) {
          renameState.cursorPosition--;
        }
        e.preventDefault();
      } else if (e.key === 'ArrowRight') {
        // Move cursor right
        if (renameState.cursorPosition < renameState.editText.length) {
          renameState.cursorPosition++;
        }
        e.preventDefault();
      } else if (e.key === 'Home') {
        // Move to start
        renameState.cursorPosition = 0;
        e.preventDefault();
      } else if (e.key === 'End') {
        // Move to end
        renameState.cursorPosition = renameState.editText.length;
        e.preventDefault();
      }
    },
    
    OnTextInput(text: string): void {
      if (!renameState.isRenaming) return;
      
      // Insert text at cursor position
      renameState.editText = 
        renameState.editText.slice(0, renameState.cursorPosition) +
        text +
        renameState.editText.slice(renameState.cursorPosition);
      renameState.cursorPosition += text.length;
    },
    
    OnPointerMove(e: PointerEvent): void {
      if (gizmo_state.is_resize_mode && !gizmo_state.is_dragging_resize) {
        gizmo_state.resize_edge = get_resize_edge(e.x, e.y, rect);
      }
    },
    
    OnWheel(e: { delta_x: number; delta_y: number; delta_mode: number }): void {
      const layers = getSortedLayers();
      const contentHeight = rect.y1 - rect.y0 - 4;
      
      if (e.delta_y > 0) {
        scrollOffset = Math.min(scrollOffset + 1, Math.max(0, layers.length - contentHeight));
      } else {
        scrollOffset = Math.max(scrollOffset - 1, 0);
      }
    },
  };
  
  return module;
}
