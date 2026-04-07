import * as fs from "node:fs";
import * as path from "node:path";

import { fileURLToPath } from "node:url";

import { checkPerception } from "../action_system/perception.js";
import { createIntent } from "../action_system/intent.js";
import type { PerceptionEvent } from "../action_system/perception.js";
import { debugLogger, logSeparator, printTestScenario, printTestSummary } from "../action_system/debug_logger.js";
import { save_actor, load_actor } from "../actor_storage/store.js";
import { get_actor_path, get_npc_path } from "../engine/paths.js";
import { clear_all_movement_states, get_movement_state } from "../npc_ai/movement_state.js";
import { process_witness_event } from "../npc_ai/witness_handler.js";
import { save_npc } from "../npc_storage/store.js";
import { get_awareness_entry } from "../shared/awareness.js";
import { reconcile_awareness_for_pair, update_awareness_from_perception } from "../shared/awareness_runtime.js";
import { evaluate_sense_detection } from "../shared/sense_mag.js";
import { get_configured_data_slot } from "../shared/boot_env.js";

const slot = get_configured_data_slot();

type CleanupTarget = { actor_id?: string; npc_id?: string };

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function cleanup_target(target: CleanupTarget): void {
  try {
    if (target.actor_id) {
      const actor_path = get_actor_path(slot, target.actor_id);
      if (fs.existsSync(actor_path)) fs.unlinkSync(actor_path);
    }
  } catch {}
  try {
    if (target.npc_id) {
      const npc_path = get_npc_path(slot, target.npc_id);
      if (fs.existsSync(npc_path)) fs.unlinkSync(npc_path);
    }
  } catch {}
}

function make_actor(actor_id: string, location: { x: number; y: number; z?: number }, sense_mags: { light?: number; pressure?: number } = {}): Record<string, unknown> {
  return {
    id: actor_id,
    ref: `actor.${actor_id}`,
    name: actor_id,
    body_slots: {},
    tags: [
      { name: "LIGHT", mag: sense_mags.light ?? 2, meta: [] },
      { name: "PRESSURE", mag: sense_mags.pressure ?? 2, meta: [] },
    ],
    location: {
      place_id: "test_place",
      world_tile: { x: 0, y: 0 },
      region_tile: { x: 0, y: 0 },
      tile: { x: location.x, y: location.y, z: location.z ?? 0 },
    },
  };
}

function make_npc(npc_id: string, location: { x: number; y: number; z?: number }): Record<string, unknown> {
  return {
    id: npc_id,
    ref: `npc.${npc_id}`,
    name: npc_id,
    body_slots: {},
    tags: [],
    location: {
      place_id: "test_place",
      world_tile: { x: 0, y: 0 },
      region_tile: { x: 0, y: 0 },
      tile: { x: location.x, y: location.y, z: location.z ?? 0 },
    },
  };
}

async function testPressureOnlyPerception(): Promise<boolean> {
  printTestScenario(debugLogger, "Pressure Only Awareness", [
    "Observer has default light/pressure senses",
    "Target communicates normally from 2 tiles away",
    "Pressure should reveal location but not identity",
  ]);

  const cleanup = { actor_id: "awareness_obs_pressure", npc_id: "awareness_target_pressure" };
  cleanup_target(cleanup);

  try {
    save_actor(slot, cleanup.actor_id!, make_actor(cleanup.actor_id!, { x: 0, y: 0 }, { pressure: 4 }));
    save_npc(slot, cleanup.npc_id!, make_npc(cleanup.npc_id!, { x: 2, y: 0 }));

    const pressure = evaluate_sense_detection("pressure", 2, 0, 2);
    assert(pressure.clarity !== "none", "expected pressure-only detection to succeed");
    assert(pressure.location_known === true, "expected location to be known from pressure");
    assert(pressure.identity_known === false, "expected identity to remain unknown from pressure-only perception");
    return true;
  } finally {
    cleanup_target(cleanup);
  }
}

async function testLightClearVsObscured(): Promise<boolean> {
  printTestScenario(debugLogger, "Light Clear vs Obscured", [
    "MAG light detection is evaluated against broadcast MAG",
    "Close range yields clear identity for light",
    "Farther range yields obscured/no identity for light",
  ]);

  const close = evaluate_sense_detection("light", 2, 1, 3);
  const far = evaluate_sense_detection("light", 2, -1, 4);

  assert(close.clarity === "clear", `expected close light detection to be clear, got ${close.clarity}`);
  assert(close.identity_known === true, "expected close light detection to know identity");
  assert(far.clarity === "obscured", `expected far light detection to be obscured, got ${far.clarity}`);
  assert(far.identity_known === false, "expected obscured light detection to hide identity");
  return true;
}

async function testAwarenessDecayAndLastKnownPosition(): Promise<boolean> {
  printTestScenario(debugLogger, "Awareness Decay And Last Known Position", [
    "Perceived action creates awareness entry immediately",
    "Entry stores last known position while awareness exists",
    "Awareness is removed when target is out of range and not detected in the next cycle",
  ]);

  const cleanup = { actor_id: "awareness_obs_decay", npc_id: "awareness_target_decay" };
  cleanup_target(cleanup);

  const original_now = Date.now;

  try {
    save_actor(slot, cleanup.actor_id!, make_actor(cleanup.actor_id!, { x: 0, y: 0 }, { pressure: 4 }));
    save_npc(slot, cleanup.npc_id!, make_npc(cleanup.npc_id!, { x: 2, y: 0 }));

    const event: PerceptionEvent = {
      id: "perc_awareness_decay",
      timestamp: original_now(),
      observerRef: `actor.${cleanup.actor_id}`,
      type: "communication",
      actionId: "action_awareness_decay",
      actorRef: `npc.${cleanup.npc_id}`,
      actorType: "npc",
      actorVisibility: "sensed",
      identityKnown: false,
      locationKnown: true,
      verb: "COMMUNICATE",
      verbClarity: "sensed",
      location: { world_x: 0, world_y: 0, region_x: 0, region_y: 0, x: 2, y: 0, place_id: "test_place" },
      distance: 2,
      senses: ["pressure"],
      details: { understood: true, volume: "normal" },
      threatLevel: 0,
      interestLevel: 10,
      urgency: 5,
    };

    update_awareness_from_perception(slot, event);
    const initial = load_actor(slot, cleanup.actor_id!);
    if (!initial.ok) throw new Error("expected observer actor to load after awareness update");
    const entry = get_awareness_entry(initial.actor as Record<string, unknown>, `npc.${cleanup.npc_id}`);
    assert(entry, "expected awareness entry to be created");
    assert(entry?.location_known === true, "expected location_known to be true after perception");
    assert(entry?.last_known_position?.x === 2 && entry?.last_known_position?.y === 0, "expected last known position to be recorded");

    save_npc(slot, cleanup.npc_id!, make_npc(cleanup.npc_id!, { x: 50, y: 50 }));
    Date.now = () => original_now() + 7000;
    reconcile_awareness_for_pair(slot, `actor.${cleanup.actor_id}`, `npc.${cleanup.npc_id}`);

    const after = load_actor(slot, cleanup.actor_id!);
    if (!after.ok) throw new Error("expected observer actor to reload after reconciliation");
    const removed = get_awareness_entry(after.actor as Record<string, unknown>, `npc.${cleanup.npc_id}`);
    assert(!removed, "expected awareness entry to be removed after decay");
    return true;
  } finally {
    Date.now = original_now;
    cleanup_target(cleanup);
  }
}

async function testMovementDetectionsPreserveAwareness(): Promise<boolean> {
  printTestScenario(debugLogger, "Movement Detections Preserve Awareness", [
    "Movement perception event carries rich detections and canonical positions",
    "Awareness still derives identity and location from the event",
    "Last known position uses the canonical event location",
  ]);

  const cleanup = { actor_id: "awareness_obs_move", npc_id: "awareness_target_move" };
  cleanup_target(cleanup);

  try {
    save_actor(slot, cleanup.actor_id!, make_actor(cleanup.actor_id!, { x: 0, y: 0 }, { pressure: 4 }));
    save_npc(slot, cleanup.npc_id!, make_npc(cleanup.npc_id!, { x: 2, y: 1 }));

    const event: PerceptionEvent = {
      id: "perc_awareness_move_detections",
      timestamp: Date.now(),
      observerRef: `actor.${cleanup.actor_id}`,
      type: "action_completed",
      actionId: "action_move_detections",
      actorRef: `npc.${cleanup.npc_id}`,
      actorType: "npc",
      actorVisibility: "clear",
      actorIdentity: `npc.${cleanup.npc_id}`,
      identityKnown: true,
      locationKnown: true,
      verb: "MOVE",
      subtype: "WALK",
      verbClarity: "clear",
      location: { world_x: 12, world_y: 8, region_x: 12, region_y: 8, x: 2, y: 1, z: 0, place_id: "test_place" },
      distance: Math.sqrt(5),
      senses: ["light", "pressure"],
      detectable: true,
      bestSense: "light",
      detections: [
        {
          sense: "light",
          clarity: "clear",
          identityKnown: true,
          locationKnown: true,
          observerSenseMag: 2,
          broadcastMag: 0,
          detailedRangeTiles: 3,
          obscuredRangeTiles: 4,
        },
        {
          sense: "pressure",
          clarity: "obscured",
          identityKnown: false,
          locationKnown: true,
          observerSenseMag: 2,
          broadcastMag: 0,
          detailedRangeTiles: 0,
          obscuredRangeTiles: 3,
        },
      ],
      observerPositionWorld: { world_x: 10, world_y: 7, region_x: 10, region_y: 7, x: 10, y: 7, z: 0, place_id: "test_place" },
      actorPositionWorld: { world_x: 12, world_y: 8, region_x: 12, region_y: 8, x: 12, y: 8, z: 0, place_id: "test_place" },
      details: {
        success: true,
        outcome: "Moved across the room",
      },
      threatLevel: 0,
      interestLevel: 20,
      urgency: 10,
    };

    update_awareness_from_perception(slot, event);
    const observer = load_actor(slot, cleanup.actor_id!);
    if (!observer.ok || !observer.actor) throw new Error("expected observer actor after movement awareness update");
    const entry = get_awareness_entry(observer.actor as Record<string, unknown>, `npc.${cleanup.npc_id}`);
    assert(entry, "expected movement perception to create awareness entry");
    assert(entry?.identity_known === true, "expected clear light detection to preserve identity awareness");
    assert(entry?.location_known === true, "expected movement event to preserve location awareness");
    assert(entry?.last_known_position?.x === 2 && entry?.last_known_position?.y === 1, "expected last known position to use movement event location");
    return true;
  } finally {
    cleanup_target(cleanup);
  }
}

async function testWitnessSkipsNonNpcObservers(): Promise<boolean> {
  printTestScenario(debugLogger, "Witness Skips Non-NPC Observers", [
    "Actor observers may still receive awareness updates",
    "Witness handling should ignore non-NPC observers",
    "Ignoring actor observers should not initialize NPC movement state",
  ]);

  clear_all_movement_states();
  const observer_ref = "actor.awareness_witness_actor";
  const event: PerceptionEvent = {
    id: "perc_witness_skip_actor",
    timestamp: Date.now(),
    observerRef: observer_ref,
    type: "action_completed",
    actionId: "action_witness_skip_actor",
    actorRef: "actor.other_actor",
    actorType: "player",
    actorVisibility: "clear",
    actorIdentity: "actor.other_actor",
    identityKnown: true,
    locationKnown: true,
    verb: "MOVE",
    subtype: "WALK",
    verbClarity: "clear",
    location: { world_x: 1, world_y: 0, region_x: 1, region_y: 0, x: 1, y: 0, z: 0, place_id: "test_place" },
    distance: 1,
    senses: ["light"],
    detectable: true,
    bestSense: "light",
    detections: [
      {
        sense: "light",
        clarity: "clear",
        identityKnown: true,
        locationKnown: true,
        observerSenseMag: 2,
        broadcastMag: 0,
        detailedRangeTiles: 3,
        obscuredRangeTiles: 4,
      },
    ],
    observerPositionWorld: { world_x: 0, world_y: 0, region_x: 0, region_y: 0, x: 0, y: 0, z: 0, place_id: "test_place" },
    actorPositionWorld: { world_x: 1, world_y: 0, region_x: 1, region_y: 0, x: 1, y: 0, z: 0, place_id: "test_place" },
    details: { success: true },
    threatLevel: 0,
    interestLevel: 0,
    urgency: 0,
  };

  process_witness_event(observer_ref, event);
  assert(!get_movement_state(observer_ref), "expected actor observer to skip witness movement state initialization");
  clear_all_movement_states();
  return true;
}

async function testCommunicatePerceptionEmitsDetections(): Promise<boolean> {
  printTestScenario(debugLogger, "Communicate Perception Emits Detections", [
    "General action-system perception should emit canonical detections too",
    "A normal communication at 4 tiles should preserve all successful senses",
    "Perception result should include world positions and a detectable verdict",
  ]);

  const cleanup = { actor_id: "awareness_obs_comm", npc_id: "awareness_target_comm" };
  cleanup_target(cleanup);

  try {
    save_actor(slot, cleanup.actor_id!, make_actor(cleanup.actor_id!, { x: 0, y: 0 }, { pressure: 4 }));
    save_npc(slot, cleanup.npc_id!, make_npc(cleanup.npc_id!, { x: 4, y: 0 }));

    const intent = createIntent(`npc.${cleanup.npc_id}`, "COMMUNICATE", "system_trigger", {
      actorType: "npc",
      actorLocation: { world_x: 0, world_y: 0, region_x: 0, region_y: 0, x: 4, y: 0, z: 0, place_id: "test_place" },
      parameters: {
        message: "Can you hear me?",
        volume: "normal",
      },
    });

    const perception = await checkPerception(
      slot,
      `actor.${cleanup.actor_id}`,
      { world_x: 0, world_y: 0, region_x: 0, region_y: 0, x: 0, y: 0, z: 0, place_id: "test_place" },
      intent,
      intent.actorLocation,
    );

    assert(perception.canPerceive === true, "expected communication perception to succeed");
    assert(perception.detectable === true, "expected communication perception to mark detection verdict");
    assert(perception.bestSense === "light", `expected tie-broken best sense to remain light, got ${perception.bestSense}`);
    assert(Array.isArray(perception.detections) && perception.detections.length === 2, "expected all successful detections to be preserved");
    assert(perception.detections?.some((entry) => entry.sense === "light"), "expected light detection to be present");
    assert(perception.detections?.some((entry) => entry.sense === "pressure"), "expected pressure detection to be present");
    assert(perception.observerPositionWorld?.x === 0 && perception.actorPositionWorld?.x === 4, "expected canonical positions on communication perception result");
    return true;
  } finally {
    cleanup_target(cleanup);
  }
}

async function runAllTests(): Promise<void> {
  logSeparator(debugLogger, "AWARENESS SYSTEM TESTS");
  debugLogger.info("Starting awareness suite...\n");

  const tests: Array<{ step: string; run: () => Promise<boolean> }> = [
    { step: "Pressure Only Awareness", run: testPressureOnlyPerception },
    { step: "Light Clear vs Obscured", run: testLightClearVsObscured },
    { step: "Awareness Decay And Last Known Position", run: testAwarenessDecayAndLastKnownPosition },
    { step: "Movement Detections Preserve Awareness", run: testMovementDetectionsPreserveAwareness },
    { step: "Witness Skips Non-NPC Observers", run: testWitnessSkipsNonNpcObservers },
    { step: "Communicate Perception Emits Detections", run: testCommunicatePerceptionEmitsDetections },
  ];

  const results: Array<{ step: string; passed: boolean; error?: string }> = [];
  for (const test of tests) {
    try {
      results.push({ step: test.step, passed: await test.run() });
    } catch (error) {
      results.push({ step: test.step, passed: false, error: String(error) });
    }
    debugLogger.info("\n");
  }

  printTestSummary(debugLogger, results);
  console.log("\n\n" + "=".repeat(70));
  console.log("COMPLETE LOG OUTPUT:");
  console.log("=".repeat(70));
  console.log(debugLogger.export());

  if (results.some((result) => !result.passed)) {
    throw new Error("awareness test suite failed");
  }
}

const is_main = (() => {
  try {
    const self = fileURLToPath(import.meta.url);
    const argv1 = process.argv[1] ? path.resolve(process.argv[1]) : "";
    return argv1.length > 0 && path.resolve(self) === argv1;
  } catch {
    return false;
  }
})();

if (is_main) {
  runAllTests().catch((error) => {
    console.error("Awareness test suite failed:", error);
    process.exit(1);
  });
}

export { runAllTests, testPressureOnlyPerception, testLightClearVsObscured, testAwarenessDecayAndLastKnownPosition };
