import type { Place } from "../../types/place.js";
import { loadCameraConfig } from "../../ascii_painter/save_system.js";

export type PlaceViewState = {
  offset_x: number;
  offset_y: number;
  scale: number;
};

export type PlaceViewBounds = {
  min_x: number;
  max_x: number;
  min_y: number;
  max_y: number;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export type SharedCameraTuning = {
  calibration?: { x: number; y: number };
  char_spacing_x?: number;
  char_spacing_y?: number;
  parallax_intensity?: number;
  parallax_move_enabled?: boolean;
  parallax_size_enabled?: boolean;
  scale_per_layer?: number;
  movement_per_layer?: number;
  base_layer_scale?: number;
};

export type PlaceCameraController = {
  view: PlaceViewState;

  ensure_loaded_for_place: (place: Place, inner_w: number, inner_h: number) => boolean;
  schedule_save: (place: Place) => void;

  get_bounds: (place: Place, inner_w: number, inner_h: number) => PlaceViewBounds;
  center_on_tile: (place: Place, inner_w: number, inner_h: number, tile_x: number, tile_y: number) => void;
  clamp_to_bounds: (place: Place, inner_w: number, inner_h: number) => void;

  get_shared_dom_tuning: () => SharedCameraTuning;
};

export function create_place_camera_controller(opts?: {
  initial_scale?: number;
  padding_tiles?: number;
  storage_key_prefix?: string;
  save_debounce_ms?: number;
}): PlaceCameraController {
  const view: PlaceViewState = {
    offset_x: 0,
    offset_y: 0,
    scale: Math.max(1, Math.floor(opts?.initial_scale ?? 1)),
  };

  const padding_tiles = Math.max(0, Math.floor(opts?.padding_tiles ?? 25));
  const key_prefix = String(opts?.storage_key_prefix ?? "thaumworld_place_view_state:");
  const save_debounce_ms = Math.max(0, Math.floor(opts?.save_debounce_ms ?? 180));

  let loaded_for_place_id: string | null = null;
  let loaded_for_current_place = false;
  let save_timer: number | null = null;

  function get_bounds(place: Place, inner_w: number, inner_h: number): PlaceViewBounds {
    const w = Math.max(1, Math.floor(inner_w));
    const h = Math.max(1, Math.floor(inner_h));
    const tiles_visible_x = w * view.scale;
    const tiles_visible_y = h * view.scale;
    return {
      min_x: -padding_tiles,
      max_x: Math.max(0, place.tile_grid.width + padding_tiles - tiles_visible_x),
      min_y: -padding_tiles,
      max_y: Math.max(0, place.tile_grid.height + padding_tiles - tiles_visible_y),
    };
  }

  function clamp_to_bounds(place: Place, inner_w: number, inner_h: number): void {
    const b = get_bounds(place, inner_w, inner_h);
    view.offset_x = clamp(view.offset_x, b.min_x, b.max_x);
    view.offset_y = clamp(view.offset_y, b.min_y, b.max_y);
  }

  function load_for_place(place: Place, inner_w: number, inner_h: number): boolean {
    try {
      const key = `${key_prefix}${place.id}`;
      const raw = window.localStorage.getItem(key);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      const ox = Number(parsed?.offset_x);
      const oy = Number(parsed?.offset_y);
      const sc = Number(parsed?.scale);
      if (!Number.isFinite(ox) || !Number.isFinite(oy)) return false;
      if (Number.isFinite(sc) && sc > 0) view.scale = Math.max(1, Math.floor(sc));
      view.offset_x = Math.floor(ox);
      view.offset_y = Math.floor(oy);
      clamp_to_bounds(place, inner_w, inner_h);
      return true;
    } catch {
      return false;
    }
  }

  function ensure_loaded_for_place(place: Place, inner_w: number, inner_h: number): boolean {
    if (loaded_for_place_id !== place.id) {
      loaded_for_place_id = place.id;
      loaded_for_current_place = load_for_place(place, inner_w, inner_h);
      if (!loaded_for_current_place) {
        view.offset_x = 0;
        view.offset_y = 0;
        clamp_to_bounds(place, inner_w, inner_h);
      }
    }
    return loaded_for_current_place;
  }

  function schedule_save(place: Place): void {
    try {
      if (save_timer !== null) window.clearTimeout(save_timer);
      const key = `${key_prefix}${place.id}`;
      const payload = {
        offset_x: Math.floor(view.offset_x),
        offset_y: Math.floor(view.offset_y),
        scale: view.scale,
      };
      save_timer = window.setTimeout(() => {
        try {
          window.localStorage.setItem(key, JSON.stringify(payload));
        } catch {
          // ignore
        }
      }, save_debounce_ms);
    } catch {
      // ignore
    }
  }

  function center_on_tile(place: Place, inner_w: number, inner_h: number, tile_x: number, tile_y: number): void {
    const w = Math.max(1, Math.floor(inner_w));
    const h = Math.max(1, Math.floor(inner_h));
    const tiles_visible_x = w * view.scale;
    const tiles_visible_y = h * view.scale;
    const b = get_bounds(place, inner_w, inner_h);

    const MARGIN = 2;
    const target_offset_x = Math.floor(tile_x - tiles_visible_x / 2 + MARGIN);
    const target_offset_y = Math.floor(tile_y - tiles_visible_y / 2 + MARGIN);
    view.offset_x = clamp(target_offset_x, b.min_x, b.max_x);
    view.offset_y = clamp(target_offset_y, b.min_y, b.max_y);
  }

  function get_shared_dom_tuning(): SharedCameraTuning {
    const cam = loadCameraConfig();
    return {
      calibration: cam.calibration,
      char_spacing_x: cam.char_spacing_x,
      char_spacing_y: cam.char_spacing_y,
      parallax_intensity: cam.parallax_intensity,
      parallax_move_enabled: cam.parallax_move_enabled,
      parallax_size_enabled: cam.parallax_size_enabled,
      scale_per_layer: cam.scale_per_layer,
      movement_per_layer: cam.movement_per_layer,
      base_layer_scale: cam.base_layer_scale,
    };
  }

  return {
    view,
    ensure_loaded_for_place,
    schedule_save,
    get_bounds,
    center_on_tile,
    clamp_to_bounds,
    get_shared_dom_tuning,
  };
}
