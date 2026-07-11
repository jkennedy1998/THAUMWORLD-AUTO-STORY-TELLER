import assert from 'node:assert/strict';
import { DEBUG_VISION, enqueue_sense_broadcast_highlight, get_active_sense_broadcast_highlights, get_entity_debug_sense_highlights, set_debug_bundle_enabled, set_debug_enabled } from '../mono_ui/vision_debugger.js';

function test_debug_bundle_button_hook_state(): void {
  set_debug_bundle_enabled(true);
  assert.equal(DEBUG_VISION.enabled, true);
  assert.equal(DEBUG_VISION.show_facing, true);
  assert.equal(DEBUG_VISION.show_sense_broadcasts, true);
  assert.equal(DEBUG_VISION.show_hearing_ranges, true);
  assert.equal(DEBUG_VISION.show_visible_vision, true);
  assert.equal(DEBUG_VISION.show_vision_cones, false);
  assert.equal(DEBUG_VISION.show_conversation_state, false);

  set_debug_bundle_enabled(false);
  assert.equal(DEBUG_VISION.enabled, false);
  assert.equal(DEBUG_VISION.show_sense_broadcasts, false);

  set_debug_enabled(false);
}

function test_debug_sense_highlights(): void {
  set_debug_bundle_enabled(true);
  const overlays = get_entity_debug_sense_highlights(
    'npc.test',
    { x: 0, y: 0, z: 0 },
    'east',
    [0],
    () => false,
    [{ name: 'LIGHT', mag: 2 }, { name: 'PRESSURE', mag: 2 }],
  );
  assert.ok(overlays.some((overlay) => overlay.kind === 'vision'));
  assert.ok(overlays.some((overlay) => overlay.kind === 'hearing'));
  set_debug_enabled(false);
}

function test_broadcast_highlights(): void {
  set_debug_bundle_enabled(true);
  enqueue_sense_broadcast_highlight({
    origin: { x: 0, y: 0, z: 0 },
    sense: 'pressure',
    range: 3,
    source_ref: 'npc.test',
    lifespan_ms: 900,
  });
  const overlays = get_active_sense_broadcast_highlights([0], 0);
  assert.ok(overlays.some((overlay) => overlay.kind === 'broadcast' && overlay.sense === 'pressure'));
  set_debug_enabled(false);
}

function main(): void {
  test_debug_bundle_button_hook_state();
  test_debug_sense_highlights();
  test_broadcast_highlights();
  console.log('vision_debugger tests passed');
}

main();
