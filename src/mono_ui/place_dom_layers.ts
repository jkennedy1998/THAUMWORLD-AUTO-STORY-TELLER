import type { Rgb, Rect } from "./types.js";
import type { GridCell } from "../ascii_painter/types.js";
import type { VoxelSpace, VoxelLayer } from "../ascii_painter/voxel_space.js";
import { createVoxelSpace } from "../ascii_painter/voxel_space.js";
import { createVoxelDOMRenderer, type ViewportState, type VoxelDomRendererDebugState, VoxelDOMRenderer } from "../ascii_painter/voxel_dom_renderer.js";

export type PlaceDomLayersOpts = {
  render_backend: 'font' | 'atlas';
  render_theme_id: string;
  font_family: string;
  base_font_size_px: number;
  weight_index_to_css: readonly number[];
};

const DEFAULT_PLACE_LAYER_COUNT = 17;

export type PlaceDomViewport = {
  // Absolute screen CSS pixels
  x: number;
  y: number;
  width: number;
  height: number;
  tileW: number;
  tileH: number;
  fontSizePx: number;
};

function make_empty_cells(width: number, height: number, fill: GridCell): GridCell[][] {
  const rows: GridCell[][] = [];
  for (let y = 0; y < height; y++) {
    const row: GridCell[] = [];
    for (let x = 0; x < width; x++) row.push({ ...fill });
    rows.push(row);
  }
  return rows;
}

export class PlaceDomLayers {
  private opts: PlaceDomLayersOpts;
  private root: HTMLElement | null = null;
  private renderer: VoxelDOMRenderer | null = null;
  private space: VoxelSpace | null = null;
  private width = 0;
  private height = 0;
  private layer_count = 0;
  private place_id: string | null = null;
  private focus_layer_opacity_enabled = true;

  constructor(opts: PlaceDomLayersOpts) {
    this.opts = opts;
  }

  get_is_mounted(): boolean {
    return !!this.renderer;
  }

  get_space(): VoxelSpace | null {
    return this.space;
  }

  get_debug_state(): VoxelDomRendererDebugState | null {
    return this.renderer ? this.renderer.getDebugState() : null;
  }

  mount(container: HTMLElement, place_id: string): void {
    const root_connected = !!this.root && this.root.isConnected && this.root.parentElement === container;
    if (this.renderer && this.place_id === place_id && root_connected) return;
    this.destroy();

    // Phase 0.5: single-owner lifecycle for #voxel_layers_container.
    // If the ASCII painter is mounted, release it before mounting place layers.
    try {
      const other = container.querySelectorAll('[data-painter-world-layers]');
      for (const el of Array.from(other)) {
        try {
          el.remove();
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }

    this.place_id = place_id;
    this.root = document.createElement('div');
    this.root.style.position = 'absolute';
    this.root.style.left = '0px';
    this.root.style.top = '0px';
    this.root.style.width = '100%';
    this.root.style.height = '100%';
    this.root.style.pointerEvents = 'none';
    this.root.setAttribute('data-world-layers-owner', 'place');
    this.root.setAttribute('data-place-world-layers', place_id);
    container.appendChild(this.root);

    this.renderer = createVoxelDOMRenderer(
      this.root,
      this.opts.font_family,
      this.opts.base_font_size_px,
      this.opts.weight_index_to_css,
      this.opts.render_backend,
      this.opts.render_theme_id,
    );
  }

  ensure_space(width: number, height: number, layer_count: number = DEFAULT_PLACE_LAYER_COUNT): void {
    if (!this.renderer) return;
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    const lc = Math.max(1, Math.floor(layer_count));
    const focus_layer = Math.floor(lc / 2);
    if (this.space && this.width === w && this.height === h && this.layer_count === lc) return;

    const minZ = 0;
    const maxZ = lc - 1;
    const s = createVoxelSpace(w, h, { minZ, maxZ, defaultZ: focus_layer });

    // Ensure layers exist for 0 and 2.
    const empty: GridCell = { char: ' ', rgb: { r: 0, g: 0, b: 0 } as Rgb, weight_index: 1 };
    const mk = (z: number, name: string, opacity: number): VoxelLayer => ({
      z,
      name,
      visible: true,
      opacity,
      locked: true,
      cells: make_empty_cells(w, h, empty),
    });

    for (let z = minZ; z <= maxZ; z++) {
      const opacity = z === focus_layer ? 1.0 : (Math.abs(z - focus_layer) === 1 ? 0.85 : 0.72);
      s.layers.set(z, mk(z, `z${z}`, opacity));
    }
    s.bounds.depth = lc;
    s.bounds.minZ = minZ;
    s.bounds.maxZ = maxZ;

    // Place uses one grounded follow pan across all layers and starts with subtle readable defaults.
    (s.camera as any).pan_behavior = 'uniform';
    s.camera.show_all_layers = false;
    s.camera.parallax_move_enabled = true;
    s.camera.parallax_size_enabled = false;
    s.camera.parallax_intensity = 0.35;
    s.camera.mouse_angle_yaw_deg = 5;
    s.camera.mouse_angle_pitch_deg = 4;
    s.camera.mouse_angle_spring = 10;
    s.camera.movement_per_layer = 12;
    s.camera.scale_per_layer = 0.06;
    s.camera.base_layer_scale = 1.0;
    s.camera.char_spacing_x = 1.0;
    s.camera.char_spacing_y = 1.0;

    this.space = s;
    this.width = w;
    this.height = h;
    this.layer_count = lc;
    this.renderer.setSpace(s);
  }

  set_viewport(vp: PlaceDomViewport): void {
    if (!this.renderer) return;
    const v: ViewportState = {
      x: vp.x,
      y: vp.y,
      width: vp.width,
      height: vp.height,
      tileW: vp.tileW,
      tileH: vp.tileH,
      fontSizePx: vp.fontSizePx,
      offsetX: 0,
      offsetY: 0,
    };
    this.renderer.setViewport(v);
  }

  set_camera_pan(pan_x: number, pan_y: number): void {
    if (!this.space) return;
    this.space.camera.pan_x = Number.isFinite(pan_x) ? pan_x : 0;
    this.space.camera.pan_y = Number.isFinite(pan_y) ? pan_y : 0;
  }

  set_mouse_parallax(norm_x: number, norm_y: number): void {
    if (!this.renderer) return;
    const cx = Number.isFinite(norm_x) ? Math.max(-1, Math.min(1, norm_x)) : 0;
    const cy = Number.isFinite(norm_y) ? Math.max(-1, Math.min(1, norm_y)) : 0;
    this.renderer.setMouseParallax(cx, cy);
  }

  set_focus_z(z: number): void {
    if (!this.space) return;
    const max_index = Math.max(0, this.layer_count - 1);
    const focus = Math.max(0, Math.min(max_index, Math.floor(z)));
    this.space.camera.focus_plane = focus;

    for (const [lz, layer] of this.space.layers.entries()) {
      if (!layer) continue;
      if (!this.focus_layer_opacity_enabled) {
        layer.opacity = 1.0;
      } else if (lz === focus) {
        layer.opacity = 1.0;
      } else {
        const dist = Math.abs(lz - z);
        layer.opacity = dist === 1 ? 0.62 : 0.45;
      }
    }
  }

  set_focus_layer_opacity_enabled(enabled: boolean): void {
    this.focus_layer_opacity_enabled = !!enabled;
  }

  apply_shared_camera_tuning(tuning: {
    calibration?: { x: number; y: number };
    char_spacing_x?: number;
    char_spacing_y?: number;
    parallax_intensity?: number;
    parallax_move_enabled?: boolean;
    parallax_size_enabled?: boolean;
    scale_per_layer?: number;
    movement_per_layer?: number;
    mouse_angle_yaw_deg?: number;
    mouse_angle_pitch_deg?: number;
    mouse_angle_spring?: number;
    base_layer_scale?: number;
    euler_rotation?: { x: number; y: number; z: number };
    transition_euler?: { x: number; y: number; z: number };
    visual_pivot_px?: { x: number; y: number };
  }): void {
    if (!this.space) return;
    (this.space.camera as any).pan_behavior = 'uniform';

    if (tuning.calibration) this.space.camera.calibration = { ...tuning.calibration };
    if (typeof tuning.char_spacing_x === 'number') this.space.camera.char_spacing_x = tuning.char_spacing_x;
    if (typeof tuning.char_spacing_y === 'number') this.space.camera.char_spacing_y = tuning.char_spacing_y;
    if (typeof tuning.parallax_intensity === 'number') this.space.camera.parallax_intensity = tuning.parallax_intensity;
    if (typeof tuning.parallax_move_enabled === 'boolean') this.space.camera.parallax_move_enabled = tuning.parallax_move_enabled;
    if (typeof tuning.parallax_size_enabled === 'boolean') this.space.camera.parallax_size_enabled = tuning.parallax_size_enabled;
    if (typeof tuning.scale_per_layer === 'number') this.space.camera.scale_per_layer = tuning.scale_per_layer;
    if (typeof tuning.movement_per_layer === 'number') this.space.camera.movement_per_layer = tuning.movement_per_layer;
    if (typeof tuning.mouse_angle_yaw_deg === 'number') this.space.camera.mouse_angle_yaw_deg = tuning.mouse_angle_yaw_deg;
    if (typeof tuning.mouse_angle_pitch_deg === 'number') this.space.camera.mouse_angle_pitch_deg = tuning.mouse_angle_pitch_deg;
    if (typeof tuning.mouse_angle_spring === 'number') this.space.camera.mouse_angle_spring = tuning.mouse_angle_spring;
    if (typeof tuning.base_layer_scale === 'number') this.space.camera.base_layer_scale = tuning.base_layer_scale;
    if (tuning.euler_rotation) this.space.camera.euler_rotation = { ...tuning.euler_rotation };
    if (tuning.transition_euler) (this.space.camera as any).transition_euler = { ...tuning.transition_euler };
    if (tuning.visual_pivot_px) (this.space.camera as any).visual_pivot_px = { ...tuning.visual_pivot_px };
  }

  set_layer_cells(z: number, cells: GridCell[][], content_version?: number): void {
    if (!this.space) return;
    const layer_z = Math.max(0, Math.min(Math.max(0, this.layer_count - 1), Math.floor(z)));
    const layer = this.space.layers.get(layer_z);
    if (!layer) return;
    layer.cells = cells;
    if (this.renderer && typeof content_version === 'number' && Number.isFinite(content_version)) {
      this.renderer.setSlotContentVersion(layer_z, Math.trunc(content_version));
    }
  }

  render(): void {
    if (!this.renderer) return;
    this.renderer.render();
  }

  destroy(): void {
    try {
      this.renderer?.destroy();
    } catch {
      // ignore
    }
    this.renderer = null;
    this.space = null;
    this.width = 0;
    this.height = 0;
    this.place_id = null;
    if (this.root) {
      try {
        this.root.remove();
      } catch {
        // ignore
      }
    }
    this.root = null;
  }
}
