import { clone_painter_document, create_painter_document } from './painter_document.js';
import {
  clone_painter_time_asset_bundle,
  create_painter_single_play_particle_effect,
  create_painter_time_asset_bundle,
  normalize_painter_single_play_particle_effect,
  normalize_painter_time_asset_bundle,
} from './painter_time_assets.js';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const effect = create_painter_single_play_particle_effect({
  name: 'Spark',
  spawn_breath: 12,
  window_start: 12,
  window_end: 18,
  processed_breaths: 3,
  visual: { char: '*', display_color: '#ffcc00' },
});
assert(effect.schema_version === 1, 'particle effects should be versioned');
assert(effect.kind === 'single_play_particle_effect', 'particle effect should have the expected kind');
assert(effect.spawn_breath === 12 && effect.window_start === 12 && effect.window_end === 18, 'particle effect should preserve authored timing');
assert(effect.processed_breaths === 3, 'particle effect should preserve runtime processed breath count');
assert(effect.is_complete === false && effect.is_deleted === false, 'particle effect should default to active state');
assert(effect.visual.char === '*' && effect.visual.display_color === '#ffcc00', 'particle effect should preserve visual payload');

const normalized = normalize_painter_single_play_particle_effect({
  id: '  ',
  name: '  ',
  spawn_breath: -8,
  window_start: -3,
  window_end: -1,
  processed_breaths: -7,
  is_complete: true,
  is_deleted: true,
  visual: { char: '', display_color: '  ', render_index: -4, weight_index: -9 },
});
assert(normalized.id.length > 0, 'normalized particle effect should synthesize an id when missing');
assert(normalized.name === 'Particle Effect', 'normalized particle effect should synthesize a default name');
assert(normalized.spawn_breath === 0 && normalized.window_start === 0 && normalized.window_end === 0, 'normalized particle effect should clamp its window');
assert(normalized.processed_breaths === 0, 'normalized particle effect should clamp processed breaths');
assert(normalized.is_complete === true && normalized.is_deleted === true, 'normalized particle effect should preserve completion flags');
assert(normalized.visual.char === '•' && normalized.visual.display_color === '#ffffff', 'normalized particle effect should synthesize a readable default visual');

const bundle = create_painter_time_asset_bundle({ particle_effects: [effect, normalized] });
assert(bundle.schema_version === 1, 'time asset bundle should be versioned');
assert(bundle.particle_effects.length === 2, 'time asset bundle should contain authored effects');

const clonedBundle = clone_painter_time_asset_bundle(bundle);
clonedBundle.particle_effects[0]!.visual.char = '!';
assert(bundle.particle_effects[0]!.visual.char === '*', 'cloned bundle should not alias nested visual state');

const normalizedBundle = normalize_painter_time_asset_bundle({ particle_effects: [{ spawn_breath: 2, window_end: 5 }] });
assert(normalizedBundle.particle_effects[0]!.window_start === 2 && normalizedBundle.particle_effects[0]!.window_end === 5, 'normalized bundle should infer a window start from spawn breath');

const document = create_painter_document(4, 4, { default_group_name: 'Base' });
document.metadata!.time_assets = bundle;
const clonedDocument = clone_painter_document(document);
clonedDocument.metadata!.time_assets!.particle_effects[0]!.name = 'Changed';
assert(document.metadata!.time_assets!.particle_effects[0]!.name === 'Spark', 'cloned painter documents should deep-clone time assets in metadata');

console.log('painter_time_assets tests passed');
