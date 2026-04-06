import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { getLatestLogPath } from "../../src/launcher/log_utils.js";

type SessionInfo = {
  session_token: string;
  reconnect_token?: string;
};

type ClaimedActor = {
  actor_ref: string;
  actor_id: string;
};

type ActorState = {
  actor_ref: string;
  actor_id: string;
  place_id: string;
  x: number;
  y: number;
  z: number;
};

type PlaceState = {
  id: string;
  tile_grid?: { width?: number; height?: number };
  contents?: {
    actors_present?: any[];
    npcs_present?: any[];
  };
};

const DEFAULT_SLOT = Number(process.env.DATA_SLOT ?? 1);
const BASE_URL = process.env.THAUM_TEST_BASE_URL ?? "http://localhost:8787";
const WAIT_TIMEOUT_MS = 12_000;
const POLL_INTERVAL_MS = 150;

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`invalid_json_response:${res.status}:${text}`);
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const data = await readJson<T>(res);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${(data as any)?.error ?? "unknown_error"}`);
  return data;
}

async function postJson<T>(url: string, body: any): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await readJson<T>(res);
  if (!res.ok) throw new Error(`POST ${url} failed: ${res.status} ${(data as any)?.error ?? "unknown_error"}`);
  return data;
}

async function waitFor<T>(label: string, check: () => Promise<T | null>, timeoutMs: number = WAIT_TIMEOUT_MS): Promise<T> {
  const started = Date.now();
  while ((Date.now() - started) < timeoutMs) {
    const result = await check();
    if (result !== null) return result;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`timeout_waiting_for:${label}`);
}

function getLogCursor(logPath: string): number {
  try {
    return fs.statSync(logPath).size;
  } catch {
    return 0;
  }
}

function readLogTail(logPath: string, cursor: number): string {
  const buf = fs.readFileSync(logPath, "utf8");
  return buf.slice(cursor);
}

async function waitForLogPattern(logPath: string, cursor: number, pattern: string | RegExp, timeoutMs: number = WAIT_TIMEOUT_MS): Promise<string> {
  return waitFor<string>(`log_pattern:${String(pattern)}`, async () => {
    const tail = readLogTail(logPath, cursor);
    if (typeof pattern === "string") {
      return tail.includes(pattern) ? tail : null;
    }
    return pattern.test(tail) ? tail : null;
  }, timeoutMs);
}

async function ensureServerHealthy(slot: number): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/host/status?slot=${slot}`);
  if (!res.ok) {
    throw new Error("movement eval requires a running server; start `npm run dev:logs` first");
  }
}

async function connect(slot: number): Promise<SessionInfo> {
  return postJson<SessionInfo>(`${BASE_URL}/api/connect`, { slot });
}

async function claimActor(slot: number, sessionToken: string): Promise<ClaimedActor> {
  const claimable = await getJson<any>(`${BASE_URL}/api/actors/claimable?slot=${slot}&session_token=${encodeURIComponent(sessionToken)}`);
  const actorRef = String(claimable?.current_actor_ref ?? claimable?.actors?.find((entry: any) => entry?.can_claim)?.actor_ref ?? claimable?.actors?.[0]?.actor_ref ?? "").trim();
  assert(actorRef, "no_claimable_actor_found");
  const claim = await postJson<any>(`${BASE_URL}/api/actors/claim`, {
    slot,
    session_token: sessionToken,
    actor_ref: actorRef,
  });
  const claimedRef = String(claim?.controlled_actor_ref ?? actorRef).trim();
  return {
    actor_ref: claimedRef,
    actor_id: claimedRef.replace(/^actor\./, ""),
  };
}

async function loadActor(slot: number, actorId: string): Promise<any> {
  const data = await getJson<any>(`${BASE_URL}/api/actor?id=${encodeURIComponent(actorId)}&slot=${slot}`);
  assert(data?.ok && data?.actor, `failed_to_load_actor:${actorId}`);
  return data.actor;
}

async function loadActorState(slot: number, actorRef: string): Promise<ActorState> {
  const actorId = actorRef.replace(/^actor\./, "");
  const actor = await loadActor(slot, actorId);
  return {
    actor_ref: actorRef,
    actor_id: actorId,
    place_id: String(actor?.location?.place_id ?? "").trim(),
    x: Math.floor(Number(actor?.location?.tile?.x ?? 0)) || 0,
    y: Math.floor(Number(actor?.location?.tile?.y ?? 0)) || 0,
    z: Math.floor(Number(actor?.location?.elevation ?? actor?.location?.tile?.z ?? 0)) || 0,
  };
}

async function loadPlace(slot: number, placeId: string): Promise<PlaceState> {
  const data = await getJson<any>(`${BASE_URL}/api/place?slot=${slot}&place_id=${encodeURIComponent(placeId)}`);
  assert(data?.ok && data?.place, `failed_to_load_place:${placeId}`);
  return data.place as PlaceState;
}

async function setPlacePaused(slot: number, placeId: string, paused: boolean, source: string = "movement_runtime_eval"): Promise<void> {
  await postJson(`${BASE_URL}/api/place/pause`, {
    slot,
    place_id: placeId,
    paused,
    source,
  });
}

async function moveActorPainter(slot: number, actor: ActorState, target: { x: number; y: number; z: number }): Promise<void> {
  await postJson(`${BASE_URL}/api/place_painter/move`, {
    slot,
    place_id: actor.place_id,
    entity_ref: actor.actor_ref,
    entity_type: "actor",
    source: { x: actor.x, y: actor.y, z: actor.z },
    target,
  });
}

async function spawnDebugStructure(slot: number, placeId: string, id: string, at: { x: number; y: number; z: number }): Promise<void> {
  await postJson(`${BASE_URL}/api/place/debug/structure`, {
    slot,
    place_id: placeId,
    id,
    x: at.x,
    y: at.y,
    z: at.z,
  });
}

async function clearDebugStructures(slot: number, placeId: string): Promise<void> {
  await postJson(`${BASE_URL}/api/place/debug/structure/clear`, { slot, place_id: placeId });
}

async function queueMoveTo(slot: number, sessionToken: string, actorRef: string, placeId: string, x: number, y: number, z: number): Promise<void> {
  const result = await postJson<any>(`${BASE_URL}/api/movement/move_to`, {
    slot,
    session_token: sessionToken,
    entity_ref: actorRef,
    place_id: placeId,
    x,
    y,
    z,
    mode: "WALK",
  });
  assert(result?.ok === true, `move_to_not_ok:${JSON.stringify(result)}`);
  assert(result?.queued !== false, `move_to_not_queued:${JSON.stringify(result)}`);
}

async function travelToPlace(slot: number, sessionToken: string, actorRef: string, targetPlaceId: string): Promise<void> {
  const result = await postJson<any>(`${BASE_URL}/api/place/travel?slot=${slot}`, {
    slot,
    session_token: sessionToken,
    entity_ref: actorRef,
    target_place_id: targetPlaceId,
  });
  assert(result?.ok === true, `travel_failed:${JSON.stringify(result)}`);
}

async function preflightConnector(slot: number, sourcePlaceId: string, borderTile: { x: number; y: number; z: number }, direction: "x+" | "x-" | "y+" | "y-"): Promise<boolean> {
  const result = await postJson<any>(`${BASE_URL}/api/place/topology/preflight_connected`, {
    slot,
    source_place_id: sourcePlaceId,
    new_place_id: `movement_eval_preflight_${Date.now().toString(36)}`,
    new_place_name: "Movement Eval Preflight",
    direction,
    border_tile: borderTile,
    size: { x: 4, y: 4, z: 1 },
  });
  return !!result?.ok && !!result?.can_create;
}

async function createConnectedPlace(slot: number, sourcePlaceId: string, newPlaceId: string, borderTile: { x: number; y: number; z: number }, direction: "x+" | "x-" | "y+" | "y-"): Promise<void> {
  const result = await postJson<any>(`${BASE_URL}/api/place/topology/create_connected`, {
    slot,
    source_place_id: sourcePlaceId,
    new_place_id: newPlaceId,
    new_place_name: newPlaceId,
    direction,
    border_tile: borderTile,
    size: { x: 4, y: 4, z: 1 },
  });
  assert(result?.ok === true, `create_connected_failed:${JSON.stringify(result)}`);
}

async function deleteConnectedPlace(slot: number, sourcePlaceId: string, targetPlaceId: string): Promise<void> {
  await postJson(`${BASE_URL}/api/place/topology/delete_empty`, {
    slot,
    source_place_id: sourcePlaceId,
    target_place_id: targetPlaceId,
  });
}

async function waitForActorState(label: string, slot: number, actorRef: string, predicate: (state: ActorState) => boolean, timeoutMs: number = WAIT_TIMEOUT_MS): Promise<ActorState> {
  return waitFor<ActorState>(label, async () => {
    const state = await loadActorState(slot, actorRef);
    return predicate(state) ? state : null;
  }, timeoutMs);
}

async function testStepUp(slot: number, actor: ClaimedActor, logPath: string): Promise<void> {
  const initial = await loadActorState(slot, actor.actor_ref);
  await setPlacePaused(slot, initial.place_id, true);
  try {
    await clearDebugStructures(slot, initial.place_id);
    await moveActorPainter(slot, initial, { x: 2, y: 2, z: 0 });
    await spawnDebugStructure(slot, initial.place_id, "movement_eval_step_up", { x: 3, y: 2, z: 0 });
  } finally {
    await setPlacePaused(slot, initial.place_id, false);
  }

  const logCursor = getLogCursor(logPath);
  await queueMoveTo(slot, session.session_token, actor.actor_ref, initial.place_id, 3, 2, 0);
  const finalState = await waitForActorState("step_up", slot, actor.actor_ref, (state) => state.place_id === initial.place_id && state.x === 3 && state.y === 2 && state.z === 1);
  assert(finalState.z === 1, `expected step-up z=1, got ${finalState.z}`);
  await waitForLogPattern(logPath, logCursor, /incline allowed by derived walk step-up legality|PASS incline up selected and resolved/);
  await setPlacePaused(slot, initial.place_id, true);
  try {
    await clearDebugStructures(slot, initial.place_id);
  } finally {
    await setPlacePaused(slot, initial.place_id, false);
  }
}

async function testInclineDown(slot: number, actor: ClaimedActor, logPath: string): Promise<void> {
  const initial = await loadActorState(slot, actor.actor_ref);
  await setPlacePaused(slot, initial.place_id, true);
  try {
    await clearDebugStructures(slot, initial.place_id);
    await moveActorPainter(slot, initial, { x: 2, y: 2, z: 1 });
    await spawnDebugStructure(slot, initial.place_id, "movement_eval_down_support", { x: 2, y: 2, z: 0 });
  } finally {
    await setPlacePaused(slot, initial.place_id, false);
  }

  const logCursor = getLogCursor(logPath);
  await queueMoveTo(slot, session.session_token, actor.actor_ref, initial.place_id, 3, 2, 1);
  const finalState = await waitForActorState("incline_down", slot, actor.actor_ref, (state) => state.place_id === initial.place_id && state.x === 3 && state.y === 2 && state.z === 0);
  assert(finalState.z === 0, `expected incline-down z=0, got ${finalState.z}`);
  await waitForLogPattern(logPath, logCursor, /PASS incline down selected and resolved/);
  await setPlacePaused(slot, initial.place_id, true);
  try {
    await clearDebugStructures(slot, initial.place_id);
  } finally {
    await setPlacePaused(slot, initial.place_id, false);
  }
}

async function testPushable(slot: number, actor: ClaimedActor, logPath: string): Promise<void> {
  const fixture = await postJson<any>(`${BASE_URL}/api/place/debug/reset_push_fixture`, { slot });
  assert(fixture?.ok === true, `reset_push_fixture_failed:${JSON.stringify(fixture)}`);
  const placeId = String(fixture.place_id);
  const start = { x: Number(fixture.actor_at?.x), y: Number(fixture.actor_at?.y), z: Number(fixture.actor_at?.z) };

  const directions = [
    { dx: 1, dy: 0, name: "east" },
    { dx: -1, dy: 0, name: "west" },
    { dx: 0, dy: 1, name: "south" },
    { dx: 0, dy: -1, name: "north" },
  ];

  let succeeded = false;
  for (const dir of directions) {
    const actorState = await loadActorState(slot, actor.actor_ref);
    if (actorState.place_id !== placeId || actorState.x !== start.x || actorState.y !== start.y || actorState.z !== start.z) {
      await postJson(`${BASE_URL}/api/place/debug/reset_push_fixture`, { slot });
    }
    const logCursor = getLogCursor(logPath);
    await queueMoveTo(slot, session.session_token, actor.actor_ref, placeId, start.x + dir.dx, start.y + dir.dy, start.z);
    try {
      const finalState = await waitForActorState(`pushable_${dir.name}`, slot, actor.actor_ref, (state) => state.place_id === placeId && state.x === start.x + dir.dx && state.y === start.y + dir.dy, 4_000);
      await waitForLogPattern(logPath, logCursor, /pushable mover advanced after push/, 4_000);
      assert(finalState.x === start.x + dir.dx || finalState.y === start.y + dir.dy, "pushable move final state mismatch");
      succeeded = true;
      break;
    } catch {
      // Try the next adjacent direction without adding extra runtime logging.
    }
  }

  assert(succeeded, "failed to observe pushable blocker regression case");
}

async function testConnectorTraversal(slot: number, actor: ClaimedActor, logPath: string): Promise<void> {
  const start = await loadActorState(slot, actor.actor_ref);
  const place = await loadPlace(slot, start.place_id);
  const width = Math.max(5, Math.floor(Number(place?.tile_grid?.width ?? 5)) || 5);
  const height = Math.max(5, Math.floor(Number(place?.tile_grid?.height ?? 5)) || 5);
  const yCandidates = Array.from(new Set([2, Math.max(2, Math.floor(height / 2)), Math.max(2, height - 3)])).filter((y) => y >= 0 && y < height);
  let borderTile: { x: number; y: number; z: number } | null = null;
  for (const y of yCandidates) {
    const candidate = { x: width - 1, y, z: 0 };
    if (await preflightConnector(slot, start.place_id, candidate, "x+")) {
      borderTile = candidate;
      break;
    }
  }
  assert(borderTile, "no_valid_connector_border_tile_found");

  const newPlaceId = `movement_eval_connector_${Date.now().toString(36)}`;
  await createConnectedPlace(slot, start.place_id, newPlaceId, borderTile!, "x+");

  await setPlacePaused(slot, start.place_id, true);
  try {
    const current = await loadActorState(slot, actor.actor_ref);
    await moveActorPainter(slot, current, { x: Math.max(0, borderTile!.x - 1), y: borderTile!.y, z: 0 });
  } finally {
    await setPlacePaused(slot, start.place_id, false);
  }

  const logCursor = getLogCursor(logPath);
  await queueMoveTo(slot, session.session_token, actor.actor_ref, start.place_id, borderTile!.x, borderTile!.y, 0);
  const transitioned = await waitForActorState("connector_transition", slot, actor.actor_ref, (state) => state.place_id === newPlaceId, WAIT_TIMEOUT_MS);
  assert(transitioned.place_id === newPlaceId, `expected connector transition into ${newPlaceId}, got ${transitioned.place_id}`);
  await waitForLogPattern(logPath, logCursor, /connector transition applied from movement step|emitted actor place transition/);

  await travelToPlace(slot, session.session_token, actor.actor_ref, start.place_id);
  await waitForActorState("connector_return", slot, actor.actor_ref, (state) => state.place_id === start.place_id, WAIT_TIMEOUT_MS);
  await deleteConnectedPlace(slot, start.place_id, newPlaceId);
}

async function restoreActor(slot: number, actor: ClaimedActor, original: ActorState): Promise<void> {
  const current = await loadActorState(slot, actor.actor_ref);
  if (current.place_id !== original.place_id) {
    try {
      await travelToPlace(slot, session.session_token, actor.actor_ref, original.place_id);
      await waitForActorState("restore_place", slot, actor.actor_ref, (state) => state.place_id === original.place_id, WAIT_TIMEOUT_MS);
    } catch {
      // ignore best-effort cleanup failure here; the final move may still work in-place
    }
  }
  const restored = await loadActorState(slot, actor.actor_ref);
  if (restored.place_id === original.place_id) {
    await setPlacePaused(slot, original.place_id, true);
    try {
      await moveActorPainter(slot, restored, { x: original.x, y: original.y, z: original.z });
      await clearDebugStructures(slot, original.place_id);
    } finally {
      await setPlacePaused(slot, original.place_id, false);
    }
  }
}

async function runAllTests(slot: number): Promise<void> {
  await ensureServerHealthy(slot);
  const logPath = getLatestLogPath(slot, "game");
  assert(logPath && fs.existsSync(logPath), "movement eval requires an active latest.log from `npm run dev:logs`");
  const resolvedLogPath = String(logPath);

  console.log("Movement runtime regression tests");
  console.log(`Server: ${BASE_URL}`);
  console.log(`Log: ${resolvedLogPath}`);

  session = await connect(slot);
  const actor = await claimActor(slot, session.session_token);
  const original = await loadActorState(slot, actor.actor_ref);

  const results: Array<{ name: string; passed: boolean; error?: string }> = [];
  try {
    const tests: Array<{ name: string; run: () => Promise<void> }> = [
      { name: "step_up", run: () => testStepUp(slot, actor, resolvedLogPath) },
      { name: "incline_down", run: () => testInclineDown(slot, actor, resolvedLogPath) },
      { name: "pushable", run: () => testPushable(slot, actor, resolvedLogPath) },
      { name: "connector_traversal", run: () => testConnectorTraversal(slot, actor, resolvedLogPath) },
    ];

    for (const test of tests) {
      try {
        await test.run();
        results.push({ name: test.name, passed: true });
        console.log(`PASS ${test.name}`);
      } catch (error) {
        results.push({ name: test.name, passed: false, error: String(error) });
        console.log(`FAIL ${test.name}: ${String(error)}`);
      }
    }
  } finally {
    await restoreActor(slot, actor, original).catch(() => undefined);
  }

  const failed = results.filter((result) => !result.passed);
  console.log(`Results: ${results.length - failed.length} passed, ${failed.length} failed, ${results.length} total`);
  if (failed.length > 0) {
    for (const failure of failed) {
      console.log(`  - ${failure.name}: ${failure.error ?? "unknown_error"}`);
    }
    throw new Error("movement runtime regression suite failed");
  }
}

let session: SessionInfo;

const isMain = (() => {
  try {
    const self = fileURLToPath(import.meta.url);
    const argv1 = process.argv[1] ? path.resolve(process.argv[1]) : "";
    return argv1.length > 0 && path.resolve(self) === argv1;
  } catch {
    return false;
  }
})();

if (isMain) {
  runAllTests(DEFAULT_SLOT).catch((error) => {
    console.error("Movement runtime regression suite failed:", error);
    process.exit(1);
  });
}

export { runAllTests };
