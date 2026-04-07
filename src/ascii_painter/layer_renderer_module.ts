/**
 * Layer Renderer Module
 * 
 * Renders a single Z-layer of a VoxelSpace.
 * Part of the 3D voxel rendering pipeline.
 */

import type { Module, Canvas, Rect as RectType, Rgb, PointerEvent, DragEvent, WheelEvent } from '../mono_ui/types.js';
import type { VoxelSpace, VoxelLayer } from './voxel_space.js';
import { get_color_by_name } from '../mono_ui/colors.js';

type Rect = RectType;

export type LayerRendererOptions = {
  id: string;
  space: VoxelSpace;
  layerZ: number;
  getViewportRect: () => Rect;  // Where to render on screen
  isEditable: () => boolean;    // Is this the selected view layer?
  onVoxelClick?: (x: number, y: number, z: number) => void;
  onVoxelDrag?: (x: number, y: number, z: number) => void;
};

/**
 * Create a module that renders one layer of the voxel space
 */
export function makeLayerRendererModule(opts: LayerRendererOptions): Module {
  let rect = opts.getViewportRect();
  
  // Track if we need to recalculate rect
  let lastRectHash = '';
  
  function updateRect(): void {
    const newRect = opts.getViewportRect();
    const newHash = `${newRect.x0},${newRect.y0},${newRect.x1},${newRect.y1}`;
    if (newHash !== lastRectHash) {
      rect = newRect;
      lastRectHash = newHash;
    }
  }
  
  const module: Module = {
    id: opts.id,
    get rect() {
      updateRect();
      return rect;
    },
    set rect(value: Rect) {
      rect = value;
    },
    
    Draw(c: Canvas): void {
      updateRect();
      
      const layer = opts.space.layers.get(opts.layerZ);
      if (!layer || !layer.visible) return;
      
      const bounds = opts.space.bounds;
      const viewportWidth = rect.x1 - rect.x0 + 1;
      const viewportHeight = rect.y1 - rect.y0 + 1;
      
      // Calculate parallax offset based on camera mode
      let parallaxX = 0;
      let parallaxY = 0;
      
      if (opts.space.camera.mode === 'parallax_ortho') {
        const zDistance = opts.layerZ - opts.space.camera.focus_plane;
        parallaxX = Math.round(zDistance * opts.space.camera.parallax_intensity * 2);
        parallaxY = 0; // Parallax only in X for side-view depth
      }
      
      // Calculate which cells are visible in the viewport
      const startX = Math.max(0, -parallaxX);
      const endX = Math.min(bounds.width, viewportWidth - parallaxX);
      const startY = Math.max(0, 0);
      const endY = Math.min(bounds.height, viewportHeight);
      
      // Render cells
      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const cell = layer.cells[y]?.[x];
          if (!cell || cell.char === ' ') continue;
          
          const screenX = rect.x0 + x + parallaxX;
          const screenY = rect.y0 + y;
          
          // Skip if outside viewport
          if (screenX < rect.x0 || screenX > rect.x1 || 
              screenY < rect.y0 || screenY > rect.y1) {
            continue;
          }
          
          // Calculate render_index based on Z and layer properties
          // Higher Z = higher render_index = drawn on top
          const baseRenderIndex = opts.layerZ + 10; // Offset to avoid negative indices
          const opacity = layer.opacity;
          
          // If layer is semi-transparent, we might need alpha blending
          // For now, we just set the cell with the calculated render_index
          c.set(screenX, screenY, {
            char: cell.char,
            rgb: cell.rgb,
            weight_index: cell.weight_index,
            render_index: baseRenderIndex,
          });
        }
      }
      
      // Debug: Draw layer border if this is the selected layer
      if (opts.isEditable()) {
        const borderColor = get_color_by_name('vivid_yellow').rgb;
        for (let x = rect.x0; x <= rect.x1; x++) {
          if (c.get(x, rect.y0)?.char === ' ') {
            c.set(x, rect.y0, { char: '·', rgb: borderColor, weight_index: 1, render_index: 100 });
          }
          if (c.get(x, rect.y1)?.char === ' ') {
            c.set(x, rect.y1, { char: '·', rgb: borderColor, weight_index: 1, render_index: 100 });
          }
        }
        for (let y = rect.y0; y <= rect.y1; y++) {
          if (c.get(rect.x0, y)?.char === ' ') {
            c.set(rect.x0, y, { char: '·', rgb: borderColor, weight_index: 1, render_index: 100 });
          }
          if (c.get(rect.x1, y)?.char === ' ') {
            c.set(rect.x1, y, { char: '·', rgb: borderColor, weight_index: 1, render_index: 100 });
          }
        }
      }
    },
    
    OnPointerDown(e: PointerEvent): void {
      if (!opts.isEditable()) return;
      if (!rect_contains(rect, e.x, e.y)) return;
      
      const localX = e.x - rect.x0;
      const localY = e.y - rect.y0;
      
      // Account for parallax when calculating voxel position
      let parallaxX = 0;
      if (opts.space.camera.mode === 'parallax_ortho') {
        const zDistance = opts.layerZ - opts.space.camera.focus_plane;
        parallaxX = Math.round(zDistance * opts.space.camera.parallax_intensity * 2);
      }
      
      const voxelX = localX - parallaxX;
      const voxelY = localY;
      
      // Check bounds
      if (voxelX >= 0 && voxelX < opts.space.bounds.width &&
          voxelY >= 0 && voxelY < opts.space.bounds.height) {
        opts.onVoxelClick?.(voxelX, voxelY, opts.layerZ);
      }
    },
    
    OnDragMove(e: DragEvent): void {
      if (!opts.isEditable()) return;
      
      // Similar logic to OnPointerDown but for dragging
      const localX = e.x - rect.x0;
      const localY = e.y - rect.y0;
      
      let parallaxX = 0;
      if (opts.space.camera.mode === 'parallax_ortho') {
        const zDistance = opts.layerZ - opts.space.camera.focus_plane;
        parallaxX = Math.round(zDistance * opts.space.camera.parallax_intensity * 2);
      }
      
      const voxelX = localX - parallaxX;
      const voxelY = localY;
      
      if (voxelX >= 0 && voxelX < opts.space.bounds.width &&
          voxelY >= 0 && voxelY < opts.space.bounds.height) {
        opts.onVoxelDrag?.(voxelX, voxelY, opts.layerZ);
      }
    },
  };
  
  return module;
}

// Helper function to check if point is inside rect
function rect_contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1;
}
