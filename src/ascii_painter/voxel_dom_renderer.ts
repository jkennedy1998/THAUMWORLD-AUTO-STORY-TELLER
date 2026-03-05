/**
 * Voxel DOM Renderer
 *
 * Renders all voxel layers to HTML5 Canvas elements with CSS transforms.
 * Selected layer aligns exactly with type grid, other layers transform relative to it.
 *
 * Architecture:
 * - One canvas per Z-layer
 * - Selected layer (Z = focus_plane) is reference point (scale 1.0, no parallax)
 * - Other layers scale and parallax relative to selected layer
 * - CSS 3D transforms for position, scale, rotation
 * - Hardware-accelerated with translate3d()
 * - Clipped to canvas bounds
 */

import type { VoxelSpace, VoxelLayer, CalibrationOffset } from './voxel_space.js';
import { DEFAULT_CAMERA_VALUES } from './voxel_space.js';

export interface ViewportState {
  // Canvas module position and size in screen pixels
  x: number;
  y: number;
  width: number;
  height: number;
  // Runtime tile metrics (in CSS pixels). When present these MUST match mono_ui runtime.
  tileW?: number;
  tileH?: number;
  fontSizePx?: number;
  // Legacy global pan offsets (prefer folding pan into x/y instead)
  offsetX?: number;
  offsetY?: number;
  // Note: Camera pan offset is stored in CameraConfig
  // The camera owns the view position in world space
}

export class VoxelDOMRenderer {
  private container: HTMLElement;
  private clipContainer: HTMLElement;
  private layerCanvases: Map<number, HTMLCanvasElement> = new Map();
  private layerContexts: Map<number, CanvasRenderingContext2D> = new Map();
  private space: VoxelSpace | null = null;

  // Configuration
  private fontFamily: string;
  private baseFontSize: number;
  private letterSpacing: number;
  private lineHeight: number;

  // Viewport tracking
  private viewport: ViewportState = { x: 0, y: 0, width: 0, height: 0 };
  private mouseParallax = { x: 0, y: 0 };

  constructor(
    container: HTMLElement,
    fontFamily: string = '"Martian Mono", "Noto Sans Mono", monospace',
    baseFontSize: number = 32,
    letterSpacing: number = -0.10,
    lineHeight: number = 29.8 / 32
  ) {
    this.container = container;
    this.fontFamily = fontFamily;
    this.baseFontSize = baseFontSize;
    this.letterSpacing = letterSpacing;
    this.lineHeight = lineHeight;

    // Create clip container to mask layers outside canvas bounds
    this.clipContainer = document.createElement('div');
    this.clipContainer.style.position = 'absolute';
    this.clipContainer.style.overflow = 'hidden';
    this.clipContainer.style.pointerEvents = 'none';
    this.container.appendChild(this.clipContainer);

    console.log('[VoxelDOMRenderer] Initialized');
  }

  /**
   * Set the voxel space to render
   */
  setSpace(space: VoxelSpace): void {
    this.space = space;
    this.createOrUpdateLayers();
  }

  /**
   * Update viewport state from canvas module
   */
  setViewport(viewport: ViewportState): void {
    this.viewport = viewport;
    this.updateClipContainer();
  }

  /**
   * Update mouse parallax offset (-1 to +1)
   */
  setMouseParallax(x: number, y: number): void {
    this.mouseParallax = { x, y };
  }

  /**
   * Update calibration offset - delegates to camera config
   */
  setCalibration(x: number, y: number): void {
    if (this.space) {
      this.space.camera.calibration = { x, y };
    }
    console.log('[VoxelDOMRenderer] Calibration:', { x, y });
  }

  /**
   * Get current calibration from camera config
   */
  getCalibration(): CalibrationOffset {
    return this.space?.camera.calibration ?? { x: 0, y: 0 };
  }

  /**
   * Get cell dimensions in pixels
   * Uses camera char_spacing multipliers if available
   */
  private getCellSize(): { w: number; h: number } {
    const vw = this.viewport?.tileW;
    const vh = this.viewport?.tileH;
    if (Number.isFinite(vw) && Number.isFinite(vh) && (vw as number) > 0 && (vh as number) > 0) {
      return { w: vw as number, h: vh as number };
    }

    const camera = this.space?.camera;
    const spacingX = camera?.char_spacing_x ?? DEFAULT_CAMERA_VALUES.char_spacing_x;
    const spacingY = camera?.char_spacing_y ?? DEFAULT_CAMERA_VALUES.char_spacing_y;
    const w = this.baseFontSize * (1 + this.letterSpacing) * spacingX;
    const h = this.baseFontSize * this.lineHeight * spacingY;
    return { w, h };
  }

  private getFontSizePx(): number {
    const fs = this.viewport?.fontSizePx;
    if (Number.isFinite(fs) && (fs as number) > 0) return fs as number;
    return this.baseFontSize;
  }

  /**
   * Update clip container position and size
   */
  private updateClipContainer(): void {
    this.clipContainer.style.left = `${this.viewport.x}px`;
    this.clipContainer.style.top = `${this.viewport.y}px`;
    this.clipContainer.style.width = `${this.viewport.width}px`;
    this.clipContainer.style.height = `${this.viewport.height}px`;
  }

  /**
   * Check for duplicate canvases in the DOM (debugging)
   */
  private checkForDuplicateCanvases(): void {
    const container = this.clipContainer;
    const canvases = container.querySelectorAll('canvas');
    const zCounts = new Map<number, number>();
    
    for (const canvas of canvases) {
      const zMatch = canvas.className.match(/layer-z-(\d+)/);
      if (zMatch && zMatch[1]) {
        const z = parseInt(zMatch[1]);
        zCounts.set(z, (zCounts.get(z) || 0) + 1);
      }
    }
    
    let hasDuplicates = false;
    const duplicates: string[] = [];
    for (const [z, count] of zCounts) {
      if (count > 1) {
        duplicates.push(`z=${z}(${count}x)`);
        hasDuplicates = true;
      }
    }
    
    if (hasDuplicates) {
      console.error(`[PAN-DEBUG] DUPLICATE CANVASES: ${duplicates.join(', ')} | DOM=${canvases.length}, tracked=${this.layerCanvases.size}`);
    }
  }

  /**
   * Create or update canvas elements for each layer
   */
  private createOrUpdateLayers(): void {
    if (!this.space) return;

    // Check for duplicates before making changes
    this.checkForDuplicateCanvases();

    const zValues = Array.from(this.space.layers.keys()).sort((a, b) => a - b);

    // Remove canvases for deleted layers
    for (const [z, canvas] of this.layerCanvases) {
      if (!zValues.includes(z)) {
        canvas.remove();
        this.layerCanvases.delete(z);
        this.layerContexts.delete(z);
      }
    }

    // Create/update canvases for all layers
    for (const z of zValues) {
      this.getOrCreateCanvas(z);
    }
  }

  /**
   * Get existing canvas or create new one
   * Selected layer canvas is sized to exactly match the grid
   * Other layers are larger to accommodate scaling
   */
  private getOrCreateCanvas(z: number): HTMLCanvasElement {
    let canvas = this.layerCanvases.get(z);

    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = `voxel-layer layer-z-${z}`;
      canvas.style.position = 'absolute';
      // Override CSS centering rules; renderer positions via transforms.
      canvas.style.left = '0px';
      canvas.style.top = '0px';
      canvas.style.transformOrigin = 'center center';
      canvas.style.willChange = 'transform';
      canvas.style.imageRendering = 'pixelated';
      canvas.style.pointerEvents = 'none';

      const ctx = canvas.getContext('2d', { alpha: true });
      if (!ctx) throw new Error('Failed to get 2D context');

      this.layerCanvases.set(z, canvas);
      this.layerContexts.set(z, ctx);
      this.clipContainer.appendChild(canvas);
    }

    // Update canvas size based on layer dimensions
    const layer = this.space?.layers.get(z);
    if (layer) {
      const { w: cellW, h: cellH } = this.getCellSize();
      const gridW = layer.cells[0]?.length ?? 0;
      const gridH = layer.cells.length;
      
      // Selected layer: exact size
      // Other layers: larger to accommodate scaling
      const isSelected = z === this.space?.camera.focus_plane;
      const paddingFactor = isSelected ? 1.0 : 1.5;
      
      canvas.width = Math.ceil(gridW * cellW * paddingFactor);
      canvas.height = Math.ceil(gridH * cellH * paddingFactor);
    }

    return canvas;
  }

  /**
   * Calculate transform for a layer
   * Selected layer is reference point (scale 1.0, at viewport center)
   * Other layers scale and parallax relative to selected layer
   */
  private calculateTransform(layer: VoxelLayer, selectedZ: number): string {
    const camera = this.space?.camera;
    if (!camera) return '';

    const zDistance = layer.z - selectedZ;
    const isSelected = zDistance === 0;

    // Orthographic mode: when parallax is disabled, ALL layers share the same transform
    // so they align perfectly with the type grid (no perspective effects by layer order).
    const perspectiveEnabled = !!camera.parallax_move_enabled;

    // Get cell size
    const { w: cellW, h: cellH } = this.getCellSize();

    // Calculate center of viewport
    const viewportCenterX = this.viewport.width / 2;
    const viewportCenterY = this.viewport.height / 2;

    // Apply pan offset from camera (moves layers with parallax based on Z distance)
    // The focused layer moves by full amount, other layers scale with distance
    const panX = camera.pan_x ?? DEFAULT_CAMERA_VALUES.pan_x;
    const panY = camera.pan_y ?? DEFAULT_CAMERA_VALUES.pan_y;

    // Pan factor based on Z distance (perspective mode only)
    const basePanFactor = 1.0;
    const panFactorPerLayer = 0.1; // How much pan scales per Z layer
    const panFactor = perspectiveEnabled
      ? (isSelected ? basePanFactor : basePanFactor + (zDistance * panFactorPerLayer))
      : 1.0;

    // Clamp pan values to prevent extreme transforms
    const MAX_PAN = 1000; // Maximum pan in grid cells
    const clampedPanX = Math.max(-MAX_PAN, Math.min(MAX_PAN, panX));
    const clampedPanY = Math.max(-MAX_PAN, Math.min(MAX_PAN, panY));

    // Convert grid cell pan to pixel offset
    // Use cellW/cellH to match viewport coordinate system
    const panOffsetX = -clampedPanX * cellW * panFactor;
    const panOffsetY = clampedPanY * cellH * panFactor;

    // Mouse parallax (non-selected layers only, perspective mode)
    let parallaxX = 0;
    let parallaxY = 0;
    if (perspectiveEnabled && !isSelected) {
      const movePerLayer = camera.movement_per_layer ?? DEFAULT_CAMERA_VALUES.movement_per_layer;
      const intensity = camera.parallax_intensity * movePerLayer;
      parallaxX = -this.mouseParallax.x * zDistance * intensity;
      parallaxY = this.mouseParallax.y * zDistance * intensity;
    }

    // Size scale
    const baseLayerScale = camera.base_layer_scale ?? DEFAULT_CAMERA_VALUES.base_layer_scale;
    let scale = baseLayerScale;
    if (perspectiveEnabled && camera.parallax_size_enabled && !isSelected) {
      const scalePerLayer = camera.scale_per_layer ?? 0.12;
      const relativeScale = 1 + (zDistance * scalePerLayer);
      scale = baseLayerScale * Math.max(0.75, Math.min(1.35, relativeScale));
    }

    // Euler rotation (pivot around viewport center)
    const euler = camera.euler_rotation ?? { x: 0, y: 0, z: 0 };

    // Get calibration from camera config
    const calibration = camera.calibration ?? { x: 0, y: 0 };

    // Build transform - position relative to viewport center
    // This ensures zoom scales from the center, keeping content aligned
    const layerX = viewportCenterX + panOffsetX + parallaxX + calibration.x;
    const layerY = viewportCenterY + panOffsetY + parallaxY + calibration.y;

    return `
      translate3d(${layerX}px, ${layerY}px, 0)
      translate3d(-50%, -50%, 0)
      scale(${scale})
      rotateX(${euler.x}deg)
      rotateY(${euler.y}deg)
      rotateZ(${euler.z}deg)
    `;
  }

  /**
   * Render layer content to canvas
   * Renders cells with Y-flip correction (grid Y=0 is bottom, canvas Y=0 is top)
   */
  private renderLayer(layer: VoxelLayer, ctx: CanvasRenderingContext2D): void {
    const { w: cellW, h: cellH } = this.getCellSize();
    const fontSizePx = this.getFontSizePx();

    const gridW = layer.cells[0]?.length ?? 0;
    const gridH = layer.cells.length;
    const gridPxW = gridW * cellW;
    const gridPxH = gridH * cellH;

    // Non-selected layers may use a larger canvas (padding) to avoid clipping during transforms.
    // Center the grid content inside the canvas so all layers share the same visual origin.
    const padX = Math.max(0, (ctx.canvas.width - gridPxW) / 2);
    const padY = Math.max(0, (ctx.canvas.height - gridPxH) / 2);

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const startX = padX;
    const startY = padY;

    // Weight index to CSS font weight mapping
    const weightMap = [100, 200, 300, 400, 500, 600, 700, 800];

    // Render cells with Y-flip (grid Y=0 at bottom, canvas Y=0 is top)
    for (let gridY = 0; gridY < layer.cells.length; gridY++) {
      const row = layer.cells[gridY];
      if (!row) continue;

      // Flip Y coordinate for canvas rendering
      // Grid Y=0 is bottom, Canvas Y-0 is top, so we invert
      const canvasY = layer.cells.length - 1 - gridY;

      for (let gridX = 0; gridX < row.length; gridX++) {
        const cell = row[gridX];
        if (!cell || cell.char === ' ') continue;

        const px = startX + gridX * cellW + cellW / 2;
        const py = startY + canvasY * cellH + cellH / 2;

        // Apply font weight from cell
        const weightIndex = cell.weight_index ?? 4;
        const cssWeight = weightMap[weightIndex] ?? 400;
        ctx.font = `${cssWeight} ${fontSizePx}px ${this.fontFamily}`;

        ctx.fillStyle = `rgb(${cell.rgb.r}, ${cell.rgb.g}, ${cell.rgb.b})`;
        ctx.fillText(cell.char, px, py);
      }
    }
  }

  /**
   * Main render method
   * Called every frame by the main loop to update all layer transforms
   */
  render(): void {
    if (!this.space) return;

    const selectedZ = this.space.camera.focus_plane;
    const visibleLayers = Array.from(this.space.layers.values())
      .filter(layer => layer.visible)
      .sort((a, b) => a.z - b.z);

    // Check for duplicates at start of render
    this.checkForDuplicateCanvases();

    for (const layer of visibleLayers) {
      const canvas = this.layerCanvases.get(layer.z);
      const ctx = this.layerContexts.get(layer.z);
      if (!canvas || !ctx) continue;

      // Update canvas size if needed
      this.getOrCreateCanvas(layer.z);

      // Render layer content
      this.renderLayer(layer, ctx);

      // Apply transform
      canvas.style.transform = this.calculateTransform(layer, selectedZ);
      canvas.style.opacity = (layer.opacity ?? 1).toString();
      canvas.style.display = 'block';
    }

    // Hide invisible layers
    for (const [z, canvas] of this.layerCanvases) {
      const layer = this.space.layers.get(z);
      if (!layer || !layer.visible) {
        canvas.style.display = 'none';
      }
    }
  }

  /**
   * Cleanup
   */
  destroy(): void {
    this.clipContainer.remove();
    this.layerCanvases.clear();
    this.layerContexts.clear();
  }
}

/**
 * Factory function
 */
export function createVoxelDOMRenderer(
  container: HTMLElement,
  fontFamily?: string,
  baseFontSize?: number
): VoxelDOMRenderer {
  return new VoxelDOMRenderer(container, fontFamily, baseFontSize);
}
