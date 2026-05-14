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

function make_random_id(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function clamp_int(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? Math.floor(value) : fallback;
  return Number.isFinite(n) ? n : fallback;
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
  return {
    schema_version: 1,
    particle_effects: Array.isArray(opts?.particle_effects)
      ? opts!.particle_effects.map((effect) => normalize_painter_single_play_particle_effect(effect))
      : [],
  };
}

export function normalize_painter_time_asset_bundle(bundle: any): PainterTimeAssetBundle {
  return create_painter_time_asset_bundle({
    particle_effects: Array.isArray(bundle?.particle_effects) ? bundle.particle_effects : [],
  });
}

export function clone_painter_time_asset_bundle(bundle: PainterTimeAssetBundle): PainterTimeAssetBundle {
  return normalize_painter_time_asset_bundle(bundle);
}
