import type { PerceptionEvent, PerceptionClarity } from "../action_system/perception.js";
import { get_senses_for_action } from "../action_system/sense_broadcast.js";
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
    const best = detections.sort((a, b) => {
      const score = (value: typeof a) => (value.identity_known ? 4 : 0) + (value.location_known ? 2 : 0) + (value.clarity === "clear" ? 1 : 0);
      return score(b) - score(a);
    })[0];
    const clarity = to_clarity(best?.sense, anyIdentity, anyClear);

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
      location: {
        world_x: 0,
        world_y: 0,
        region_x: 0,
        region_y: 0,
        x: Math.floor(Number(payload.mover_position.x) || 0),
        y: Math.floor(Number(payload.mover_position.y) || 0),
        z: Number.isFinite(Number(payload.mover_position.z)) ? Math.floor(Number(payload.mover_position.z)) : undefined,
        place_id: payload.place_id,
      },
      distance: candidate.distance_tiles,
      senses: detections.map((result) => result.sense),
      details: {
        movement: payload.subtype,
        step_number: payload.step_number,
        total_steps: payload.total_steps,
        actor_pos: payload.mover_position,
        observer_pos: candidate.location,
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
