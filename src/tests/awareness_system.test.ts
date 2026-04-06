import * as fs from "node:fs";
import * as path from "node:path";

import { fileURLToPath } from "node:url";

import type { PerceptionEvent } from "../action_system/perception.js";
import { debugLogger, logSeparator, printTestScenario, printTestSummary } from "../action_system/debug_logger.js";
import { save_actor, load_actor } from "../actor_storage/store.js";
import { get_actor_path, get_npc_path } from "../engine/paths.js";
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
    save_actor(slot, cleanup.actor_id!, make_actor(cleanup.actor_id!, { x: 0, y: 0 }));
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
    save_actor(slot, cleanup.actor_id!, make_actor(cleanup.actor_id!, { x: 0, y: 0 }));
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

async function runAllTests(): Promise<void> {
  logSeparator(debugLogger, "AWARENESS SYSTEM TESTS");
  debugLogger.info("Starting awareness suite...\n");

  const tests: Array<{ step: string; run: () => Promise<boolean> }> = [
    { step: "Pressure Only Awareness", run: testPressureOnlyPerception },
    { step: "Light Clear vs Obscured", run: testLightClearVsObscured },
    { step: "Awareness Decay And Last Known Position", run: testAwarenessDecayAndLastKnownPosition },
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
