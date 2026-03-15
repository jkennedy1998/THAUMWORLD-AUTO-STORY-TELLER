import type { Rgb, Rect } from "./types.js";
import type { GridCell } from "../ascii_painter/types.js";
import type { VoxelSpace, VoxelLayer } from "../ascii_painter/voxel_space.js";
import { createVoxelSpace } from "../ascii_painter/voxel_space.js";
import { createVoxelDOMRenderer, type ViewportState, VoxelDOMRenderer } from "../ascii_painter/voxel_dom_renderer.js";

export type PlaceDomLayersOpts = {
  font_family: string;
  base_font_size_px: number;
};

const PLACE_LAYER_COUNT = 5;
const PLACE_FOCUS_LAYER = Math.floor(PLACE_LAYER_COUNT / 2);

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
  private place_id: string | null = null;

  constructor(opts: PlaceDomLayersOpts) {
    this.opts = opts;
  }

  get_is_mounted(): boolean {
    return !!this.renderer;
  }

  mount(container: HTMLElement, place_id: string): void {
    if (this.renderer && this.place_id === place_id) return;
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

    this.renderer = createVoxelDOMRenderer(this.root, this.opts.font_family, this.opts.base_font_size_px);
  }

  ensure_space(width: number, height: number): void {
    if (!this.renderer) return;
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (this.space && this.width === w && this.height === h) return;

    const minZ = 0;
    const maxZ = PLACE_LAYER_COUNT - 1;
    const s = createVoxelSpace(w, h, { minZ, maxZ, defaultZ: PLACE_FOCUS_LAYER });

    // Ensure layers exist for 0 and 2.
    const empty: GridCell = { char: ' ', rgb: { r: 0, g: 0, b: 0 } as Rgb, weight_index: 3 };
    const mk = (z: number, name: string, opacity: number): VoxelLayer => ({
      z,
      name,
      visible: true,
      opacity,
      locked: true,
      cells: make_empty_cells(w, h, empty),
    });

    for (let z = minZ; z <= maxZ; z++) {
      const opacity = z === PLACE_FOCUS_LAYER ? 1.0 : (Math.abs(z - PLACE_FOCUS_LAYER) === 1 ? 0.85 : 0.72);
      s.layers.set(z, mk(z, `z${z}`, opacity));
    }
    s.bounds.depth = PLACE_LAYER_COUNT;
    s.bounds.minZ = minZ;
    s.bounds.maxZ = maxZ;

    // Force all layers visible; focus layer alignment is controlled by focus_plane.
    s.camera.show_all_layers = true;

    this.space = s;
    this.width = w;
    this.height = h;
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

  set_mouse_parallax(norm_x: number, norm_y: number): void {
    if (!this.renderer) return;
    const cx = Number.isFinite(norm_x) ? Math.max(-1, Math.min(1, norm_x)) : 0;
    const cy = Number.isFinite(norm_y) ? Math.max(-1, Math.min(1, norm_y)) : 0;
    this.renderer.setMouseParallax(cx, cy);
  }

  set_focus_z(z: number): void {
    if (!this.space) return;
    const focus = Math.max(0, Math.min(PLACE_LAYER_COUNT - 1, Math.floor(z)));
    this.space.camera.focus_plane = focus;

    // Visual affordance: de-emphasize non-focused layers.
    // (All layers remain visible; focus affects alignment + opacity.)
    for (const [lz, layer] of this.space.layers.entries()) {
      if (!layer) continue;
      if (lz === focus) {
        layer.opacity = 1.0;
      } else {
        // Keep a little more presence for adjacent layers.
        const dist = Math.abs(lz - z);
        layer.opacity = dist === 1 ? 0.62 : 0.45;
      }
    }
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
    base_layer_scale?: number;
  }): void {
    if (!this.space) return;

    // Always enable perspective-style transforms so focus is readable via parallax.
    this.space.camera.parallax_move_enabled = true;

    if (tuning.calibration) this.space.camera.calibration = { ...tuning.calibration };
    if (typeof tuning.char_spacing_x === 'number') this.space.camera.char_spacing_x = tuning.char_spacing_x;
    if (typeof tuning.char_spacing_y === 'number') this.space.camera.char_spacing_y = tuning.char_spacing_y;
    if (typeof tuning.parallax_intensity === 'number') this.space.camera.parallax_intensity = tuning.parallax_intensity;
    if (typeof tuning.parallax_size_enabled === 'boolean') this.space.camera.parallax_size_enabled = tuning.parallax_size_enabled;
    if (typeof tuning.scale_per_layer === 'number') this.space.camera.scale_per_layer = tuning.scale_per_layer;
    if (typeof tuning.movement_per_layer === 'number') this.space.camera.movement_per_layer = tuning.movement_per_layer;
    if (typeof tuning.base_layer_scale === 'number') this.space.camera.base_layer_scale = tuning.base_layer_scale;

    // Even if painter saved this as false, keep move-enabled true here.
    // (We still accept the saved intensity/movement values.)
    if (typeof tuning.parallax_move_enabled === 'boolean') {
      // ignore; Place forces true
    }
  }

  set_layer_cells(z: number, cells: GridCell[][], content_version?: number): void {
    if (!this.space) return;
    const layer_z = Math.max(0, Math.min(PLACE_LAYER_COUNT - 1, Math.floor(z)));
    const layer = this.space.layers.get(layer_z);
    if (!layer) return;
    layer.cells = cells;
    if (this.renderer && typeof content_version === 'number' && Number.isFinite(content_version)) {
      this.renderer.setLayerContentVersion(layer_z, Math.trunc(content_version));
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
