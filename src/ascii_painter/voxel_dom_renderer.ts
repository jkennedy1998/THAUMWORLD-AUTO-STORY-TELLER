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
import { create_canvas_cell_renderer, type CanvasCellRenderer } from '../mono_ui/runtime/cell_renderer.js';

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

export type VoxelDomRendererDebugState = {
  viewport: {
    x: number;
    y: number;
    width: number;
    height: number;
    tileW: number;
    tileH: number;
  };
  viewport_ready: boolean;
  selected_layer: {
    z: number | null;
    grid_w: number;
    grid_h: number;
    grid_px_w: number;
    grid_px_h: number;
    layer_left_px: number;
    layer_top_px: number;
    pan_x: number;
    pan_y: number;
    pan_offset_x_px: number;
    pan_offset_y_px: number;
    delta_left_px: number;
    delta_top_px: number;
    delta_pan_x: number;
    delta_pan_y: number;
  };
  layer_events: Array<{
    kind: 'create_canvas' | 'resize_canvas';
    z: number;
    width: number;
    height: number;
    selected: boolean;
  }>;
};

export class VoxelDOMRenderer {
  private container: HTMLElement;
  private clipContainer: HTMLElement;
  private layerCanvases: Map<number, HTMLCanvasElement> = new Map();
  private layerContexts: Map<number, CanvasRenderingContext2D> = new Map();
  private space: VoxelSpace | null = null;

  // Layer content invalidation: callers can bump a version per Z to avoid
  // re-rasterizing glyphs when only transforms (parallax/pan) change.
  private layerContentVersion: Map<number, number> = new Map();
  private layerRenderedVersion: Map<number, number> = new Map();

  // Configuration
  private fontFamily: string;
  private baseFontSize: number;
  private letterSpacing: number;
  private lineHeight: number;
  private weightIndexToCss: readonly number[];
  private renderBackend: 'font' | 'atlas';
  private renderThemeId: string;
  private cellRenderer: CanvasCellRenderer;

  // Viewport tracking
  private viewport: ViewportState = { x: 0, y: 0, width: 0, height: 0 };
  private mouseParallax = { x: 0, y: 0 };
  private smoothedViewAngles = { pitchDeg: 0, yawDeg: 0 };
  private lastRenderTimestampMs = 0;
  private debugState: VoxelDomRendererDebugState = {
    viewport: { x: 0, y: 0, width: 0, height: 0, tileW: 0, tileH: 0 },
    viewport_ready: false,
    selected_layer: {
      z: null,
      grid_w: 0,
      grid_h: 0,
      grid_px_w: 0,
      grid_px_h: 0,
      layer_left_px: 0,
      layer_top_px: 0,
      pan_x: 0,
      pan_y: 0,
      pan_offset_x_px: 0,
      pan_offset_y_px: 0,
      delta_left_px: 0,
      delta_top_px: 0,
      delta_pan_x: 0,
      delta_pan_y: 0,
    },
    layer_events: [],
  };

  constructor(
    container: HTMLElement,
    fontFamily: string = '"Martian Mono", "Noto Sans Mono", monospace',
    baseFontSize: number = 32,
    letterSpacing: number = -0.10,
    lineHeight: number = 29.8 / 32,
    weightIndexToCss: readonly number[] = [80, 160, 320, 640],
    renderBackend: 'font' | 'atlas' = 'font',
    renderThemeId: string = 'default'
  ) {
    this.container = container;
    this.fontFamily = fontFamily;
    this.baseFontSize = baseFontSize;
    this.letterSpacing = letterSpacing;
    this.lineHeight = lineHeight;
    this.weightIndexToCss = weightIndexToCss;
    this.renderBackend = renderBackend;
    this.renderThemeId = renderThemeId;
    this.cellRenderer = create_canvas_cell_renderer({
      backend: this.renderBackend,
      theme_id: this.renderThemeId,
    });

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
   * Hint that a layer's cell content changed.
   * Renderer will re-rasterize only when the version differs.
   */
  setLayerContentVersion(z: number, version: number): void {
    const v = Number.isFinite(version) ? Math.trunc(version) : 0;
    this.layerContentVersion.set(z, v);
  }

  /**
   * Update viewport state from canvas module
   */
  setViewport(viewport: ViewportState): void {
    this.viewport = viewport;
    this.debugState.viewport = {
      x: Number(viewport.x) || 0,
      y: Number(viewport.y) || 0,
      width: Number(viewport.width) || 0,
      height: Number(viewport.height) || 0,
      tileW: Number(viewport.tileW) || 0,
      tileH: Number(viewport.tileH) || 0,
    };
    this.debugState.viewport_ready = this.debugState.viewport.width > 0 && this.debugState.viewport.height > 0 && this.debugState.viewport.tileW > 0 && this.debugState.viewport.tileH > 0;
    this.updateClipContainer();
  }

  getDebugState(): VoxelDomRendererDebugState {
    return JSON.parse(JSON.stringify(this.debugState)) as VoxelDomRendererDebugState;
  }

  /**
   * Update mouse parallax offset (-1 to +1)
   */
  setMouseParallax(x: number, y: number): void {
    this.mouseParallax = { x, y };
  }

  private updateSpringCenteredViewAngles(nowMs: number): void {
    const camera = this.space?.camera;
    if (!camera) return;
    const last = this.lastRenderTimestampMs > 0 ? this.lastRenderTimestampMs : nowMs - 16;
    const dt = Math.max(0.001, Math.min(0.05, (nowMs - last) / 1000));
    this.lastRenderTimestampMs = nowMs;

    const intensity = Math.max(0, Math.min(1.5, Number(camera.parallax_intensity ?? DEFAULT_CAMERA_VALUES.parallax_intensity) || 0));
    const maxYawDeg = (camera.mouse_angle_yaw_deg ?? DEFAULT_CAMERA_VALUES.mouse_angle_yaw_deg) * intensity;
    const maxPitchDeg = (camera.mouse_angle_pitch_deg ?? DEFAULT_CAMERA_VALUES.mouse_angle_pitch_deg) * intensity;
    const targetYawDeg = (camera.parallax_move_enabled ? this.mouseParallax.x : 0) * maxYawDeg;
    const targetPitchDeg = (camera.parallax_move_enabled ? -this.mouseParallax.y : 0) * maxPitchDeg;
    const springStrength = Math.max(0.5, Math.min(60, Number(camera.mouse_angle_spring ?? DEFAULT_CAMERA_VALUES.mouse_angle_spring) || DEFAULT_CAMERA_VALUES.mouse_angle_spring));
    const alpha = 1 - Math.exp(-springStrength * dt);

    this.smoothedViewAngles.yawDeg += (targetYawDeg - this.smoothedViewAngles.yawDeg) * alpha;
    this.smoothedViewAngles.pitchDeg += (targetPitchDeg - this.smoothedViewAngles.pitchDeg) * alpha;
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
      console.error(`[VoxelDOMRenderer] duplicate canvases: ${duplicates.join(', ')} | DOM=${canvases.length}, tracked=${this.layerCanvases.size}`);
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
      this.debugState.layer_events.push({ kind: 'create_canvas', z, width: canvas.width, height: canvas.height, selected: false });
      this.debugState.layer_events = this.debugState.layer_events.slice(-12);
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
      
      const nextW = Math.ceil(gridW * cellW * paddingFactor);
      const nextH = Math.ceil(gridH * cellH * paddingFactor);

      // Only resize if needed; resizing clears the canvas.
      const prevW = canvas.width;
      const prevH = canvas.height;
      if (prevW !== nextW) canvas.width = nextW;
      if (prevH !== nextH) canvas.height = nextH;
      if (prevW !== nextW || prevH !== nextH) {
        this.debugState.layer_events.push({ kind: 'resize_canvas', z, width: nextW, height: nextH, selected: isSelected });
        this.debugState.layer_events = this.debugState.layer_events.slice(-12);
      }

      // If size changed, force raster refresh next render.
      if (prevW !== nextW || prevH !== nextH) {
        // If caller is using versioned invalidation, force a raster refresh.
        if (this.layerContentVersion.has(z)) {
          const expected = this.layerContentVersion.get(z) ?? 0;
          this.layerRenderedVersion.set(z, expected - 1);
        }
      }
    }

    return canvas;
  }

  /**
   * Calculate transform for a layer
   * Selected layer is reference point (scale 1.0, at viewport center)
   * Other layers scale and parallax relative to selected layer
   */
  private calculateTransform(layer: VoxelLayer, selectedZ: number): { transform: string; origin: string } {
    const camera = this.space?.camera;
    if (!camera) return { transform: '', origin: 'center center' };

    const zDistance = layer.z - selectedZ;
    const isSelected = zDistance === 0;

    // Place mode keeps follow-pan uniform across layers so the target tile remains grounded.
    // Perspective is supplied separately via rotation / mouse-angle contributions.
    const moveParallaxEnabled = !!camera.parallax_move_enabled;
    const sizeParallaxEnabled = !!camera.parallax_size_enabled;
    const panBehavior = String((camera as any).pan_behavior ?? 'depth_scaled');
    const uniformPan = panBehavior === 'uniform';

    // Get cell size
    const { w: cellW, h: cellH } = this.getCellSize();
    const gridW = layer.cells[0]?.length ?? 0;
    const gridH = layer.cells.length;
    const gridPxW = gridW * cellW;
    const gridPxH = gridH * cellH;
    const paddingFactor = isSelected ? 1.0 : 1.5;
    const canvasW = Math.ceil(gridPxW * paddingFactor);
    const canvasH = Math.ceil(gridPxH * paddingFactor);
    const padX = Math.max(0, (canvasW - gridPxW) / 2);
    const padY = Math.max(0, (canvasH - gridPxH) / 2);

    // Calculate pivot of viewport; Place can override this to pivot around camera focus.
    const visualPivot = (camera as any).visual_pivot_px ?? { x: this.viewport.width / 2, y: this.viewport.height / 2 };
    const viewportCenterX = Number.isFinite(Number(visualPivot.x)) ? Number(visualPivot.x) : this.viewport.width / 2;
    const viewportCenterY = Number.isFinite(Number(visualPivot.y)) ? Number(visualPivot.y) : this.viewport.height / 2;

    // Apply camera follow pan. In place mode this remains uniform across layers.
    const panX = camera.pan_x ?? DEFAULT_CAMERA_VALUES.pan_x;
    const panY = camera.pan_y ?? DEFAULT_CAMERA_VALUES.pan_y;

    // Painter mode can still depth-scale pan, but place mode should not.
    const basePanFactor = 1.0;
    const panFactorPerLayer = 0.1; // How much pan scales per Z layer
    const panFactor = uniformPan
      ? 1.0
      : moveParallaxEnabled
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

    const baseEuler = camera.euler_rotation ?? { x: 0, y: 0, z: 0 };
    const transitionEuler = (camera as any).transition_euler ?? { x: 0, y: 0, z: 0 };
    const totalPitchDeg = baseEuler.x + transitionEuler.x + this.smoothedViewAngles.pitchDeg;
    const totalYawDeg = baseEuler.y + transitionEuler.y + this.smoothedViewAngles.yawDeg;
    const totalRollDeg = baseEuler.z + transitionEuler.z;

    // Camera-angle offset derived from the spring-centered mouse pose.
    let parallaxX = 0;
    let parallaxY = 0;
    if (moveParallaxEnabled && !isSelected) {
      const movePerLayer = camera.movement_per_layer ?? DEFAULT_CAMERA_VALUES.movement_per_layer;
      const depthPx = zDistance * movePerLayer;
      const yawRad = totalYawDeg * (Math.PI / 180);
      const pitchRad = totalPitchDeg * (Math.PI / 180);
      parallaxX = Math.tan(yawRad) * depthPx;
      parallaxY = -Math.tan(pitchRad) * depthPx;
    }

    // Size scale
    // In place mode, the selected/reference layer must stay at true 1:1 scale so
    // the hard camera and DOM layer agree on tile pitch. Otherwise calibration only
    // aligns locally and drifts as the target moves away from the module center.
    const baseLayerScale = camera.base_layer_scale ?? DEFAULT_CAMERA_VALUES.base_layer_scale;
    let scale = uniformPan ? 1.0 : baseLayerScale;
    if (sizeParallaxEnabled && !isSelected) {
      const scalePerLayer = camera.scale_per_layer ?? 0.12;
      const relativeScale = 1 + (zDistance * scalePerLayer);
      const scaleBase = uniformPan ? 1.0 : baseLayerScale;
      scale = scaleBase * Math.max(0.75, Math.min(1.35, relativeScale));
    }

    // Get calibration from camera config
    const calibration = camera.calibration ?? { x: 0, y: 0 };

    // Build transform - position relative to viewport center
    // This ensures zoom scales from the center, keeping content aligned
    const layerX = viewportCenterX + panOffsetX + parallaxX + calibration.x;
    const layerY = viewportCenterY + panOffsetY + parallaxY + calibration.y;

    if (uniformPan) {
      const layerLeft = -padX + panOffsetX + parallaxX + calibration.x;
      // Place mode already flips Y when rasterizing cells into the layer canvas.
      // Keep DOM placement in the same top-left viewport basis as hard camera math.
      const layerTop = -padY + panOffsetY + parallaxY + calibration.y;
      const originX = Number.isFinite(viewportCenterX) ? viewportCenterX - layerLeft : canvasW / 2;
      const originY = Number.isFinite(viewportCenterY) ? viewportCenterY - layerTop : canvasH / 2;
      if (isSelected) {
        const prev = this.debugState.selected_layer;
        this.debugState.selected_layer = {
          z: layer.z,
          grid_w: gridW,
          grid_h: gridH,
          grid_px_w: gridPxW,
          grid_px_h: gridPxH,
          layer_left_px: layerLeft,
          layer_top_px: layerTop,
          pan_x: clampedPanX,
          pan_y: clampedPanY,
          pan_offset_x_px: panOffsetX,
          pan_offset_y_px: panOffsetY,
          delta_left_px: layerLeft - prev.layer_left_px,
          delta_top_px: layerTop - prev.layer_top_px,
          delta_pan_x: clampedPanX - prev.pan_x,
          delta_pan_y: clampedPanY - prev.pan_y,
        };
      }
      return {
        transform: `
          translate3d(${layerLeft}px, ${layerTop}px, 0)
          scale(${scale})
          rotateX(${totalPitchDeg}deg)
          rotateY(${totalYawDeg}deg)
          rotateZ(${totalRollDeg}deg)
        `,
        origin: `${originX}px ${originY}px`,
      };
    }

    return {
      transform: `
        translate3d(${layerX}px, ${layerY}px, 0)
        translate3d(-50%, -50%, 0)
        scale(${scale})
        rotateX(${totalPitchDeg}deg)
        rotateY(${totalYawDeg}deg)
        rotateZ(${totalRollDeg}deg)
      `,
      origin: 'center center',
    };
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
        const weightIndex = cell.weight_index ?? 1;
        this.cellRenderer.draw_cell({
          ctx,
          cell: { ...cell, weight_index: weightIndex },
          center_x_px: px,
          center_y_px: py,
          cell_w_px: cellW,
          cell_h_px: cellH,
          font_family: this.fontFamily,
          font_size_px: fontSizePx,
          weight_index_to_css: this.weightIndexToCss,
        });
      }
    }
  }

  /**
   * Main render method
   * Called every frame by the main loop to update all layer transforms
   */
  render(): void {
    if (!this.space) return;
    this.updateSpringCenteredViewAngles(performance.now());

    // Layers can be added/removed at runtime (e.g. via the layer palette).
    // Keep the backing canvas set in sync so newly-created layers render immediately.
    this.createOrUpdateLayers();

    const selectedZ = this.space.camera.focus_plane;
    const visibleLayers = Array.from(this.space.layers.values())
      .filter(layer => layer.visible)
      .sort((a, b) => a.z - b.z);

    // Check for duplicates at start of render
    this.checkForDuplicateCanvases();

    for (const layer of visibleLayers) {
      // Ensure canvas/context exist (layer may have been added since last frame)
      const canvas = this.getOrCreateCanvas(layer.z);
      const ctx = this.layerContexts.get(layer.z);
      if (!ctx) continue;

      // Render layer content.
      // Default behavior: rerender every frame (painter correctness).
      // Optimized behavior: if caller supplies per-layer content versions, rerender only when changed.
      if (!this.layerContentVersion.has(layer.z)) {
        this.renderLayer(layer, ctx);
      } else {
        const version = this.layerContentVersion.get(layer.z) ?? 0;
        const renderedVersion = this.layerRenderedVersion.get(layer.z);
        if (renderedVersion !== version) {
          this.renderLayer(layer, ctx);
          this.layerRenderedVersion.set(layer.z, version);
        }
      }

      // Apply transform
      const placement = this.calculateTransform(layer, selectedZ);
      canvas.style.transform = placement.transform;
      canvas.style.transformOrigin = placement.origin;
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
  baseFontSize?: number,
  weightIndexToCss?: readonly number[],
  renderBackend?: 'font' | 'atlas',
  renderThemeId?: string
): VoxelDOMRenderer {
  return new VoxelDOMRenderer(container, fontFamily, baseFontSize, undefined, undefined, weightIndexToCss, renderBackend, renderThemeId);
}
