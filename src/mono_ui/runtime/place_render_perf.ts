type PlaceRenderPerfPhaseName =
  | 'place_draw_wrapper_ms'
  | 'camera_frame_ms'
  | 'check_entity_movement_ms'
  | 'check_entity_movement_scan_ms'
  | 'check_entity_movement_particle_ms'
  | 'check_entity_movement_sfx_ms'
  | 'check_entity_movement_broadcast_ms'
  | 'tile_pass_ms'
  | 'tile_pass_projection_ms'
  | 'tile_pass_border_probe_ms'
  | 'tile_pass_border_enqueue_ms'
  | 'tile_pass_tile_lookup_ms'
  | 'tile_pass_tile_derive_ms'
  | 'tile_pass_tile_enqueue_ms'
  | 'tile_pass_container_overlay_ms'
  | 'structure_pass_ms'
  | 'debug_visuals_ms'
  | 'particle_pass_ms'
  | 'character_pass_ms'
  | 'ground_item_pass_ms'
  | 'ui_pass_ms'
  | 'ui_draw_ms'
  | 'dom_prepare_ms'
  | 'dom_draw_layers_ms'
  | 'dom_sync_layers_ms'
  | 'dom_push_layers_ms'
  | 'dom_render_ms';

type PlaceRenderPerfFrameMeta = {
  place_id: string;
  width: number;
  height: number;
  scene_places: number;
  plane_count: number;
  breath_index: number;
  transition_active: boolean;
  transition_kind: string | null;
  view_signature: string;
};

type PlaceRenderPerfLayer = {
  slot: number;
  rq_count: number;
  draw_render_queue_ms: number;
  sync_grid_cells_ms: number;
  changed: boolean;
  changed_cell_count: number;
  content_version: number | null;
};

type PlaceRenderPerfFrame = {
  started_at_ms: number;
  meta: PlaceRenderPerfFrameMeta;
  phases: Partial<Record<PlaceRenderPerfPhaseName, number>>;
  layers: PlaceRenderPerfLayer[];
  counters: Record<string, number | boolean | string | null>;
};

type PlaceRenderPerfSummary = {
  frames: number;
  slow_frames: number;
  very_slow_frames: number;
  max_frame_ms: number;
  summed_frame_ms: number;
  phase_sums: Partial<Record<PlaceRenderPerfPhaseName, number>>;
  phase_max: Partial<Record<PlaceRenderPerfPhaseName, number>>;
  summed_rq_total_count: number;
  summed_changed_layer_count: number;
  summed_changed_cell_count: number;
  summed_pushed_layer_count: number;
};

const PLACE_RENDER_PERF_PREFIX = '[PLACE_RENDER_PERF]';
const DEFAULT_SAMPLE_EVERY = 30;
const DEFAULT_SUMMARY_EVERY = 120;
const DEFAULT_SLOW_FRAME_MS = 16.7;
const DEFAULT_VERY_SLOW_FRAME_MS = 33.3;
const DEFAULT_ENABLED = true;

let frame_sequence = 0;
let summary: PlaceRenderPerfSummary = create_empty_summary();

function create_empty_summary(): PlaceRenderPerfSummary {
  return {
    frames: 0,
    slow_frames: 0,
    very_slow_frames: 0,
    max_frame_ms: 0,
    summed_frame_ms: 0,
    phase_sums: {},
    phase_max: {},
    summed_rq_total_count: 0,
    summed_changed_layer_count: 0,
    summed_changed_cell_count: 0,
    summed_pushed_layer_count: 0,
  };
}

function read_bool_setting(key: string, fallback: boolean): boolean {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true;
    if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
  } catch {
    // ignore storage access failures
  }
  return fallback;
}

function read_number_setting(key: string, fallback: number): number {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  } catch {
    // ignore storage access failures
  }
  return fallback;
}

function is_enabled(): boolean {
  return read_bool_setting('place_render_perf_enabled', DEFAULT_ENABLED);
}

function round_ms(value: number | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

export function begin_place_render_perf_frame(meta: PlaceRenderPerfFrameMeta): PlaceRenderPerfFrame | null {
  if (!is_enabled()) return null;
  return {
    started_at_ms: performance.now(),
    meta,
    phases: {},
    layers: [],
    counters: {},
  };
}

export function record_place_render_perf_phase(frame: PlaceRenderPerfFrame | null, phase: PlaceRenderPerfPhaseName, duration_ms: number): void {
  if (!frame) return;
  frame.phases[phase] = Math.max(0, duration_ms);
}

export function set_place_render_perf_counter(frame: PlaceRenderPerfFrame | null, key: string, value: number | boolean | string | null): void {
  if (!frame) return;
  frame.counters[key] = value;
}

export function record_place_render_perf_layer(frame: PlaceRenderPerfFrame | null, layer: PlaceRenderPerfLayer): void {
  if (!frame) return;
  frame.layers.push(layer);
}

export function finish_place_render_perf_frame(frame: PlaceRenderPerfFrame | null): void {
  if (!frame) return;

  const sample_every = Math.max(1, Math.floor(read_number_setting('place_render_perf_sample_every', DEFAULT_SAMPLE_EVERY)));
  const summary_every = Math.max(1, Math.floor(read_number_setting('place_render_perf_summary_every', DEFAULT_SUMMARY_EVERY)));
  const slow_frame_ms = read_number_setting('place_render_perf_slow_frame_ms', DEFAULT_SLOW_FRAME_MS);
  const very_slow_frame_ms = read_number_setting('place_render_perf_very_slow_frame_ms', DEFAULT_VERY_SLOW_FRAME_MS);

  const frame_total_ms = Math.max(0, performance.now() - frame.started_at_ms);
  const rq_total_count = Number(frame.counters.rq_total_count ?? 0) || 0;
  const changed_layer_count = Number(frame.counters.changed_layer_count ?? 0) || 0;
  const pushed_layer_count = Number(frame.counters.pushed_layer_count ?? 0) || 0;
  const changed_cell_count = frame.layers.reduce((sum, layer) => sum + (Number(layer.changed_cell_count) || 0), 0);

  frame_sequence += 1;
  summary.frames += 1;
  summary.summed_frame_ms += frame_total_ms;
  summary.max_frame_ms = Math.max(summary.max_frame_ms, frame_total_ms);
  summary.summed_rq_total_count += rq_total_count;
  summary.summed_changed_layer_count += changed_layer_count;
  summary.summed_changed_cell_count += changed_cell_count;
  summary.summed_pushed_layer_count += pushed_layer_count;
  if (frame_total_ms >= slow_frame_ms) summary.slow_frames += 1;
  if (frame_total_ms >= very_slow_frame_ms) summary.very_slow_frames += 1;

  for (const [phase, duration] of Object.entries(frame.phases)) {
    if (typeof duration !== 'number' || !Number.isFinite(duration)) continue;
    const phase_name = phase as PlaceRenderPerfPhaseName;
    summary.phase_sums[phase_name] = (summary.phase_sums[phase_name] ?? 0) + duration;
    summary.phase_max[phase_name] = Math.max(summary.phase_max[phase_name] ?? 0, duration);
  }

  const is_slow_frame = frame_total_ms >= slow_frame_ms;
  const should_sample = frame_sequence % sample_every === 0;
  if (is_slow_frame || should_sample) {
    const payload = {
      kind: 'frame',
      frame_index: frame_sequence,
      place_id: frame.meta.place_id,
      width: frame.meta.width,
      height: frame.meta.height,
      scene_places: frame.meta.scene_places,
      plane_count: frame.meta.plane_count,
      breath_index: frame.meta.breath_index,
      transition_active: frame.meta.transition_active,
      transition_kind: frame.meta.transition_kind,
      view_signature: frame.meta.view_signature,
      frame_total_ms: round_ms(frame_total_ms),
      slow_threshold_ms: round_ms(slow_frame_ms),
      very_slow_threshold_ms: round_ms(very_slow_frame_ms),
      phases: Object.fromEntries(Object.entries(frame.phases).map(([key, value]) => [key, round_ms(value)])),
      counters: frame.counters,
      layers: frame.layers.map((layer) => ({
        slot: layer.slot,
        rq_count: layer.rq_count,
        draw_render_queue_ms: round_ms(layer.draw_render_queue_ms),
        sync_grid_cells_ms: round_ms(layer.sync_grid_cells_ms),
        changed: layer.changed,
        changed_cell_count: layer.changed_cell_count,
        content_version: layer.content_version,
      })),
    };
    diag_log('performance_metrics', 'important', 'PLACE_RENDER_PERF', 'frame', payload);
  }

  if (frame_sequence % summary_every === 0) {
    const avg = summary.frames > 0 ? summary.summed_frame_ms / summary.frames : 0;
    const summary_payload = {
      kind: 'summary',
      frame_index: frame_sequence,
      frames: summary.frames,
      slow_frames: summary.slow_frames,
      very_slow_frames: summary.very_slow_frames,
      avg_frame_ms: round_ms(avg),
      max_frame_ms: round_ms(summary.max_frame_ms),
      avg_rq_total_count: round_ms(summary.frames > 0 ? summary.summed_rq_total_count / summary.frames : 0),
      avg_changed_layer_count: round_ms(summary.frames > 0 ? summary.summed_changed_layer_count / summary.frames : 0),
      avg_changed_cell_count: round_ms(summary.frames > 0 ? summary.summed_changed_cell_count / summary.frames : 0),
      avg_pushed_layer_count: round_ms(summary.frames > 0 ? summary.summed_pushed_layer_count / summary.frames : 0),
      phase_avg_ms: Object.fromEntries(Object.entries(summary.phase_sums).map(([key, value]) => [key, round_ms(summary.frames > 0 ? value / summary.frames : 0)])),
      phase_max_ms: Object.fromEntries(Object.entries(summary.phase_max).map(([key, value]) => [key, round_ms(value)])),
    };
    diag_log('performance_metrics', 'verbose', 'PLACE_RENDER_PERF', 'summary', summary_payload);
    summary = create_empty_summary();
  }
}
import { diag_log } from '../../shared/diagnostics.js';
