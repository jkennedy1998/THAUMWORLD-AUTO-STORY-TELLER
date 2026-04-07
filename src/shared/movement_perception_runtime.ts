import type { Location } from "../action_system/intent.js";
import type { PerceptionDetection, PerceptionEvent, PerceptionClarity } from "../action_system/perception.js";
import { get_senses_for_action } from "../action_system/sense_broadcast.js";
import { get_region_place_index_record } from "../place_storage/region_place_index.js";
import { get_broadcast_observer_candidates } from "./broadcast_observers.js";
import { evaluate_sense_detection, get_observer_sense_mag, is_supported_runtime_sense, type SupportedSenseType } from "./sense_mag.js";

type MovementBatchPayload = {
  mover_ref: string;
  mover_position: { x: number; y: number; z?: number };
  place_id: string;
  step_number: number;
  total_steps: number;
  speed_tpm: number;
  subtype: "WALK" | "SNEAK" | "SPRINT";
  timestamp?: number;
};

function to_clarity(bestSense: string | undefined, anyIdentity: boolean, anyClear: boolean): PerceptionClarity {
  if (bestSense === "pressure") return "sensed";
  if (anyClear && anyIdentity) return "clear";
  if (anyClear) return "vague";
  return "obscured";
}

function to_world_location(slot: number, place_id: string, position: { x: number; y: number; z?: number }, fallback?: { x: number; y: number; z: number; place_id: string }): Location {
  const local_x = Math.floor(Number(position.x) || 0);
  const local_y = Math.floor(Number(position.y) || 0);
  const local_z = Number.isFinite(Number(position.z)) ? Math.floor(Number(position.z)) : 0;
  const bounds = get_region_place_index_record(slot, place_id)?.bounds ?? null;
  const world_x = bounds ? bounds.origin.x + local_x : (fallback?.x ?? local_x);
  const world_y = bounds ? bounds.origin.y + local_y : (fallback?.y ?? local_y);
  const world_z = bounds ? bounds.origin.z + local_z : (fallback?.z ?? local_z);
  return {
    world_x,
    world_y,
    region_x: world_x,
    region_y: world_y,
    x: world_x,
    y: world_y,
    z: world_z,
    place_id,
  };
}

function to_perception_detection(result: ReturnType<typeof evaluate_sense_detection>): PerceptionDetection {
  return {
    sense: result.sense,
    clarity: result.clarity,
    identityKnown: result.identity_known,
    locationKnown: result.location_known,
    observerSenseMag: result.observer_sense_mag,
    broadcastMag: result.broadcast_mag,
    detailedRangeTiles: result.detailed_range_tiles,
    obscuredRangeTiles: result.obscured_range_tiles,
  };
}

export function build_move_perception_events(slot: number, payload: MovementBatchPayload): PerceptionEvent[] {
  const broadcasts = get_senses_for_action("MOVE", payload.subtype);
  const candidates = get_broadcast_observer_candidates({
    slot,
    source_place_id: payload.place_id,
    source_position: payload.mover_position,
    broadcasts,
    exclude_refs: [payload.mover_ref],
  });
  const now = Number.isFinite(Number(payload.timestamp)) ? Math.floor(Number(payload.timestamp)) : Date.now();
  const action_id = `move_${now}_${Math.random().toString(36).slice(2, 9)}`;
  const actor_position_world = to_world_location(slot, payload.place_id, payload.mover_position);
  const actor_location: Location = {
    world_x: actor_position_world.world_x,
    world_y: actor_position_world.world_y,
    region_x: actor_position_world.region_x,
    region_y: actor_position_world.region_y,
    x: Math.floor(Number(payload.mover_position.x) || 0),
    y: Math.floor(Number(payload.mover_position.y) || 0),
    z: Number.isFinite(Number(payload.mover_position.z)) ? Math.floor(Number(payload.mover_position.z)) : undefined,
    place_id: payload.place_id,
  };

  console.info("[MovementPerceptionRuntime] build_move_perception_events.candidates", {
    mover_ref: payload.mover_ref,
    place_id: payload.place_id,
    subtype: payload.subtype,
    broadcast_count: broadcasts.length,
    candidate_count: candidates.length,
    candidates: candidates.slice(0, 8).map((candidate) => ({
      ref: candidate.ref,
      place_id: candidate.place_id,
      distance_tiles: candidate.distance_tiles,
    })),
  });

  const events: PerceptionEvent[] = [];
  for (const candidate of candidates) {
    const detections = broadcasts
      .filter((broadcast): broadcast is typeof broadcast & { sense: SupportedSenseType } => is_supported_runtime_sense(broadcast.sense))
      .map((broadcast) => evaluate_sense_detection(
        broadcast.sense,
        get_observer_sense_mag(slot, candidate.ref, broadcast.sense),
        Number(broadcast.broadcast_mag ?? 0),
        candidate.distance_tiles,
      ))
      .filter((result) => result.clarity !== "none");
    if (detections.length === 0) continue;

    const anyIdentity = detections.some((result) => result.identity_known);
    const anyLocation = detections.some((result) => result.location_known);
    const anyClear = detections.some((result) => result.clarity === "clear");
    let best = detections[0];
    let best_score = -1;
    for (const detection of detections) {
      const score = (detection.identity_known ? 4 : 0) + (detection.location_known ? 2 : 0) + (detection.clarity === "clear" ? 1 : 0);
      if (score > best_score) {
        best = detection;
        best_score = score;
      }
    }
    const clarity = to_clarity(best?.sense, anyIdentity, anyClear);
    const observer_position_world: Location = {
      world_x: candidate.location.x,
      world_y: candidate.location.y,
      region_x: candidate.location.x,
      region_y: candidate.location.y,
      x: candidate.location.x,
      y: candidate.location.y,
      z: candidate.location.z,
      place_id: candidate.location.place_id,
    };
    events.push({
      id: `perc_${now}_${Math.random().toString(36).slice(2, 9)}`,
      timestamp: now,
      observerRef: candidate.ref,
      type: "action_completed",
      actionId: action_id,
      actorRef: payload.mover_ref,
      actorType: payload.mover_ref.startsWith("npc.") ? "npc" : "player",
      actorVisibility: clarity,
      actorIdentity: anyIdentity ? payload.mover_ref : undefined,
      identityKnown: anyIdentity,
      locationKnown: anyLocation,
      verb: "MOVE",
      subtype: payload.subtype,
      verbClarity: clarity,
      location: actor_location,
      distance: candidate.distance_tiles,
      senses: detections.map((result) => result.sense),
      detectable: true,
      bestSense: best?.sense,
      detections: detections.map(to_perception_detection),
      observerPositionWorld: observer_position_world,
      actorPositionWorld: actor_position_world,
      details: {
        movement: payload.subtype,
        step_number: payload.step_number,
        total_steps: payload.total_steps,
        actor_pos: actor_position_world,
        observer_pos: observer_position_world,
      } as any,
      threatLevel: 0,
      interestLevel: 20,
      urgency: 10,
    });
  }
  console.info("[MovementPerceptionRuntime] build_move_perception_events.complete", {
    mover_ref: payload.mover_ref,
    place_id: payload.place_id,
    subtype: payload.subtype,
    emitted_event_count: events.length,
    observers: events.slice(0, 8).map((event) => ({
      observer_ref: event.observerRef,
      visibility: event.actorVisibility,
      identityKnown: event.identityKnown,
      locationKnown: event.locationKnown,
      distance: event.distance,
    })),
  });
  return events;
}
