export type PainterSinglePlayParticleEffectVisual = {
  char: string;
  display_color: string;
  render_index: number;
  weight_index: number;
};

export type PainterSinglePlayParticleEffect = {
  schema_version: 1;
  kind: 'single_play_particle_effect';
  id: string;
  name: string;
  spawn_breath: number;
  window_start: number;
  window_end: number;
  processed_breaths: number;
  is_complete: boolean;
  is_deleted: boolean;
  visual: PainterSinglePlayParticleEffectVisual;
};

export type PainterTimeAssetBundle = {
  schema_version: 1;
  particle_effects: PainterSinglePlayParticleEffect[];
};

export type PainterSinglePlayParticleEffectPlaybackState = 'pending' | 'active' | 'complete' | 'deleted';

export type PainterSinglePlayParticleEffectSample = {
  id: string;
  name: string;
  breath: number;
  state: PainterSinglePlayParticleEffectPlaybackState;
  spawn_breath: number;
  window_start: number;
  window_end: number;
  processed_breaths: number;
  remaining_breaths: number;
  visual: PainterSinglePlayParticleEffectVisual;
};

export type PainterTimeAssetBundlePreview = {
  schema_version: 1;
  breath: number;
  particle_effects: PainterSinglePlayParticleEffectSample[];
  active_particle_effect_ids: string[];
  complete_particle_effect_ids: string[];
  deleted_particle_effect_ids: string[];
};

function make_random_id(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function clamp_int(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? Math.floor(value) : fallback;
  return Number.isFinite(n) ? n : fallback;
}

function sort_single_play_particle_effects(effects: PainterSinglePlayParticleEffect[]): PainterSinglePlayParticleEffect[] {
  return [...effects].sort((a, b) => a.spawn_breath - b.spawn_breath || a.id.localeCompare(b.id));
}

function normalize_visual(visual: any): PainterSinglePlayParticleEffectVisual {
  const char = String(visual?.char ?? '•').charAt(0) || '•';
  const display_color = String(visual?.display_color ?? '#ffffff').trim() || '#ffffff';
  return {
    char,
    display_color,
    render_index: Math.max(0, clamp_int(visual?.render_index, 3)),
    weight_index: Math.max(0, clamp_int(visual?.weight_index, 3)),
  };
}

export function create_painter_single_play_particle_effect(opts?: Partial<Omit<PainterSinglePlayParticleEffect, 'schema_version' | 'kind' | 'id' | 'visual'>> & {
  id?: string;
  visual?: Partial<PainterSinglePlayParticleEffectVisual>;
}): PainterSinglePlayParticleEffect {
  const spawn_breath = Math.max(0, clamp_int(opts?.spawn_breath, 0));
  const window_start = Math.max(0, clamp_int(opts?.window_start, spawn_breath));
  const window_end = Math.max(window_start, clamp_int(opts?.window_end, window_start));
  return {
    schema_version: 1,
    kind: 'single_play_particle_effect',
    id: String(opts?.id ?? '').trim() || make_random_id('particle_effect'),
    name: String(opts?.name ?? '').trim() || 'Particle Effect',
    spawn_breath,
    window_start,
    window_end,
    processed_breaths: Math.max(0, clamp_int(opts?.processed_breaths, 0)),
    is_complete: opts?.is_complete === true,
    is_deleted: opts?.is_deleted === true,
    visual: normalize_visual(opts?.visual),
  };
}

export function normalize_painter_single_play_particle_effect(effect: any): PainterSinglePlayParticleEffect {
  return create_painter_single_play_particle_effect({
    id: effect?.id,
    name: effect?.name,
    spawn_breath: effect?.spawn_breath,
    window_start: effect?.window_start ?? effect?.spawn_breath,
    window_end: effect?.window_end ?? effect?.window_start ?? effect?.spawn_breath,
    processed_breaths: effect?.processed_breaths,
    is_complete: effect?.is_complete,
    is_deleted: effect?.is_deleted,
    visual: effect?.visual,
  });
}

export function clone_painter_single_play_particle_effect(effect: PainterSinglePlayParticleEffect): PainterSinglePlayParticleEffect {
  return normalize_painter_single_play_particle_effect(effect);
}

export function create_painter_time_asset_bundle(opts?: { particle_effects?: any[] }): PainterTimeAssetBundle {
  return normalize_painter_time_asset_bundle({
    particle_effects: Array.isArray(opts?.particle_effects) ? opts.particle_effects : [],
  });
}

export function normalize_painter_time_asset_bundle(bundle: any): PainterTimeAssetBundle {
  const particle_effects = Array.isArray(bundle?.particle_effects)
    ? bundle.particle_effects.map((effect: any) => normalize_painter_single_play_particle_effect(effect))
    : [];
  return {
    schema_version: 1,
    particle_effects: sort_single_play_particle_effects(particle_effects),
  };
}

export function clone_painter_time_asset_bundle(bundle: PainterTimeAssetBundle): PainterTimeAssetBundle {
  return normalize_painter_time_asset_bundle(bundle);
}

export function export_painter_time_asset_bundle(bundle: PainterTimeAssetBundle | null | undefined): PainterTimeAssetBundle {
  return normalize_painter_time_asset_bundle(bundle ?? null);
}

export function get_painter_single_play_particle_effect_playback_state(effect: PainterSinglePlayParticleEffect, breath: number): PainterSinglePlayParticleEffectPlaybackState {
  const targetBreath = Math.max(0, clamp_int(breath, 0));
  if (effect.is_deleted) return 'deleted';
  if (effect.is_complete) return 'complete';
  if (targetBreath < effect.spawn_breath) return 'pending';
  if (targetBreath < effect.window_start) return 'pending';
  if (targetBreath <= effect.window_end) return 'active';
  return 'complete';
}

export function resolve_painter_single_play_particle_effect_sample(effect: PainterSinglePlayParticleEffect, breath: number): PainterSinglePlayParticleEffectSample {
  const targetBreath = Math.max(0, clamp_int(breath, 0));
  const state = get_painter_single_play_particle_effect_playback_state(effect, targetBreath);
  const processed_breaths = targetBreath < effect.spawn_breath
    ? 0
    : Math.max(0, targetBreath - effect.spawn_breath + 1);
  const remaining_breaths = state === 'deleted' || state === 'complete'
    ? 0
    : Math.max(0, effect.window_end - targetBreath);
  return {
    id: effect.id,
    name: effect.name,
    breath: targetBreath,
    state,
    spawn_breath: effect.spawn_breath,
    window_start: effect.window_start,
    window_end: effect.window_end,
    processed_breaths,
    remaining_breaths,
    visual: structuredClone(effect.visual),
  };
}

export function resolve_painter_time_asset_bundle_preview(bundle: PainterTimeAssetBundle | null | undefined, breath: number): PainterTimeAssetBundlePreview {
  const normalized = export_painter_time_asset_bundle(bundle ?? null);
  const particle_effects = normalized.particle_effects.map((effect) => resolve_painter_single_play_particle_effect_sample(effect, breath));
  return {
    schema_version: 1,
    breath: Math.max(0, clamp_int(breath, 0)),
    particle_effects,
    active_particle_effect_ids: particle_effects.filter((effect) => effect.state === 'active').map((effect) => effect.id),
    complete_particle_effect_ids: particle_effects.filter((effect) => effect.state === 'complete').map((effect) => effect.id),
    deleted_particle_effect_ids: particle_effects.filter((effect) => effect.state === 'deleted').map((effect) => effect.id),
  };
}
