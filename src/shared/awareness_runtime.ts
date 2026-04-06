import type { Location } from "../action_system/intent.js";
import { calculateDistance } from "../action_system/target_resolution.js";
import type { PerceptionEvent, SenseType } from "../action_system/perception.js";
import { evaluate_sense_detection, get_observer_sense_mag } from "./sense_mag.js";
import { load_actor, save_actor } from "../actor_storage/store.js";
import { get_vision_cone } from "../npc_ai/cone_of_vision.js";
import { load_npc, save_npc } from "../npc_storage/store.js";
import { get_npc_location } from "../npc_storage/location.js";
import { has_awareness_evidence, prune_awareness_evidence, record_awareness_evidence } from "./awareness_round_state.js";
import { get_awareness_entry, get_awareness_list, remove_awareness_entry, set_awareness_entry, type AwarenessPosition } from "./awareness.js";

const PASSIVE_PRESENCE_BROADCAST_MAG = {
  light: 0,
  pressure: -2,
} as const;

type EntityLoadResult = {
  entity: Record<string, unknown>;
  save: () => void;
} | null;

function load_entity(slot: number, ref: string): EntityLoadResult {
  if (ref.startsWith("actor.")) {
    const actor_id = ref.replace(/^actor\./, "");
    const result = load_actor(slot, actor_id);
    if (!result.ok || !result.actor) {
      console.warn("[AwarenessRuntime] load_entity.failed", {
        ref,
        kind: "actor",
        actor_id,
      });
      return null;
    }
    return {
      entity: result.actor as Record<string, unknown>,
      save: () => {
        save_actor(slot, actor_id, result.actor as Record<string, unknown>);
        console.info("[AwarenessRuntime] load_entity.save_ok", {
          ref,
          kind: "actor",
          actor_id,
        });
      },
    };
  }
  if (ref.startsWith("npc.")) {
    const npc_id = ref.replace(/^npc\./, "");
    const result = load_npc(slot, npc_id);
    if (!result.ok || !result.npc) {
      console.warn("[AwarenessRuntime] load_entity.failed", {
        ref,
        kind: "npc",
        npc_id,
      });
      return null;
    }
    return {
      entity: result.npc as Record<string, unknown>,
      save: () => {
        save_npc(slot, npc_id, result.npc as Record<string, unknown>);
        console.info("[AwarenessRuntime] load_entity.save_ok", {
          ref,
          kind: "npc",
          npc_id,
        });
      },
    };
  }
  console.warn("[AwarenessRuntime] load_entity.unsupported_ref", { ref });
  return null;
}

export function get_entity_location(slot: number, ref: string): Location | null {
  if (ref.startsWith("actor.")) {
    const actor_id = ref.replace(/^actor\./, "");
    const result = load_actor(slot, actor_id);
    if (!result.ok || !result.actor) return null;
    const loc = (result.actor as any).location;
    if (!loc) return null;
    return {
      world_x: Number((loc.world_tile as any)?.x ?? 0),
      world_y: Number((loc.world_tile as any)?.y ?? 0),
      region_x: Number((loc.region_tile as any)?.x ?? 0),
      region_y: Number((loc.region_tile as any)?.y ?? 0),
      x: Number((loc.tile as any)?.x ?? loc.x ?? 0),
      y: Number((loc.tile as any)?.y ?? loc.y ?? 0),
      z: Number.isFinite(Number((loc.tile as any)?.z)) ? Number((loc.tile as any)?.z) : (Number.isFinite(Number(loc.z)) ? Number(loc.z) : undefined),
      place_id: typeof loc.place_id === "string" ? loc.place_id : undefined,
    };
  }
  if (ref.startsWith("npc.")) {
    const npc_id = ref.replace(/^npc\./, "");
    const result = load_npc(slot, npc_id);
    if (!result.ok || !result.npc) return null;
    const loc = get_npc_location(result.npc as Record<string, unknown>);
    if (!loc) return null;
    return {
      world_x: Number(loc.world_tile?.x ?? 0),
      world_y: Number(loc.world_tile?.y ?? 0),
      region_x: Number(loc.region_tile?.x ?? 0),
      region_y: Number(loc.region_tile?.y ?? 0),
      x: Number(loc.tile?.x ?? 0),
      y: Number(loc.tile?.y ?? 0),
      z: Number.isFinite(Number((loc.tile as any)?.z)) ? Number((loc.tile as any)?.z) : (Number.isFinite(Number(loc.elevation)) ? Number(loc.elevation) : undefined),
      place_id: typeof loc.place_id === "string" ? loc.place_id : undefined,
    };
  }
  return null;
}

function to_awareness_position(location: Location | null | undefined): AwarenessPosition | undefined {
  if (!location || !Number.isFinite(Number(location.x)) || !Number.isFinite(Number(location.y))) return undefined;
  return {
    x: Math.floor(Number(location.x)),
    y: Math.floor(Number(location.y)),
    z: Number.isFinite(Number(location.z)) ? Math.floor(Number(location.z)) : undefined,
    place_id: typeof location.place_id === "string" ? location.place_id : undefined,
  };
}

function is_target_in_general_range(slot: number, observer_ref: string, target_ref: string): { in_range: boolean; location?: Location } {
  const observer_loc = get_entity_location(slot, observer_ref);
  const target_loc = get_entity_location(slot, target_ref);
  if (!observer_loc || !target_loc) return { in_range: false };
  if (observer_loc.place_id && target_loc.place_id && observer_loc.place_id !== target_loc.place_id) return { in_range: false };
  const distance = calculateDistance(observer_loc, target_loc);
  const light = evaluate_sense_detection("light", get_observer_sense_mag(slot, observer_ref, "light"), PASSIVE_PRESENCE_BROADCAST_MAG.light, distance);
  const pressure = evaluate_sense_detection("pressure", get_observer_sense_mag(slot, observer_ref, "pressure"), PASSIVE_PRESENCE_BROADCAST_MAG.pressure, distance);
  return {
    in_range: light.clarity !== "none" || pressure.clarity !== "none",
    location: target_loc,
  };
}

function derive_knowledge_from_event(event: PerceptionEvent): {
  identity_known: boolean;
  location_known: boolean;
  best_sense?: SenseType;
} {
  const senses = Array.isArray(event.senses) ? event.senses : [];
  const best_sense = senses.includes("light")
    ? "light"
    : senses[0];
  const location_known = typeof event.locationKnown === "boolean" ? event.locationKnown : senses.length > 0;
  const identity_known = Boolean(event.identityKnown) || (best_sense === "light" && event.actorVisibility === "clear");
  return { identity_known, location_known, best_sense };
}

export function update_awareness_from_perception(slot: number, event: PerceptionEvent): boolean {
  console.info("[AwarenessRuntime] update_awareness_from_perception.enter", {
    observer_ref: event?.observerRef,
    target_ref: event?.actorRef,
    verb: event?.verb,
    visibility: event?.actorVisibility,
    identityKnown: event?.identityKnown,
    locationKnown: event?.locationKnown,
  });
  if (!event.observerRef || !event.actorRef || event.observerRef === event.actorRef) {
    console.warn("[AwarenessRuntime] update_awareness_from_perception.skipped_invalid", {
      observer_ref: event?.observerRef,
      target_ref: event?.actorRef,
    });
    return false;
  }
  const observer = load_entity(slot, event.observerRef);
  if (!observer) {
    console.warn("[AwarenessRuntime] update_awareness_from_perception.skipped_missing_observer", {
      observer_ref: event.observerRef,
      target_ref: event.actorRef,
    });
    return false;
  }

  prune_awareness_evidence(slot);
  const knowledge = derive_knowledge_from_event(event);
  const position = knowledge.location_known ? to_awareness_position(event.location) : undefined;
  const evidence = record_awareness_evidence(slot, {
    observer_ref: event.observerRef,
    target_ref: event.actorRef,
    identity_known: knowledge.identity_known,
    location_known: knowledge.location_known,
    position,
    best_sense: knowledge.best_sense,
  });

  const existing = get_awareness_entry(observer.entity, event.actorRef);
  console.info("[AwarenessRuntime] update_awareness_from_perception.before_set", {
    observer_ref: event.observerRef,
    target_ref: event.actorRef,
    existing_awareness_count: get_awareness_list(observer.entity).length,
    existing_entry: existing,
  });
  set_awareness_entry(observer.entity, event.actorRef, knowledge.identity_known && knowledge.location_known ? "clear" : "obscured", {
    identity_known: knowledge.identity_known || Boolean(existing?.identity_known),
    location_known: knowledge.location_known,
    last_known_position: knowledge.location_known ? position ?? existing?.last_known_position ?? null : existing?.last_known_position ?? undefined,
    last_detected_round: evidence.cycle_id,
  });
  observer.save();
  console.info("[AwarenessRuntime] update_awareness_from_perception.applied", {
    observer_ref: event.observerRef,
    target_ref: event.actorRef,
    verb: event.verb,
    identity_known: knowledge.identity_known,
    location_known: knowledge.location_known,
    last_known_position: position,
    cycle_id: evidence.cycle_id,
    awareness_count_after: get_awareness_list(observer.entity).length,
    saved_entry: get_awareness_entry(observer.entity, event.actorRef),
  });
  return true;
}

export function reconcile_awareness_for_pair(slot: number, observer_ref: string, target_ref: string): boolean {
  const observer = load_entity(slot, observer_ref);
  if (!observer) return false;
  const existing = get_awareness_entry(observer.entity, target_ref);
  if (!existing) return false;

  prune_awareness_evidence(slot);
  const target_range = is_target_in_general_range(slot, observer_ref, target_ref);
  const detected_this_cycle = has_awareness_evidence(slot, observer_ref, target_ref);

  if (!target_range.in_range && !detected_this_cycle) {
    const removed = remove_awareness_entry(observer.entity, target_ref);
    if (removed) {
      observer.save();
      console.info("[AwarenessRuntime] reconcile_awareness_for_pair.removed", {
        observer_ref,
        target_ref,
        reason: "out_of_range_and_not_detected_this_cycle",
      });
    }
    return removed;
  }

  const next_location_known = target_range.in_range || Boolean(existing.location_known && detected_this_cycle);
  const next_position = target_range.in_range
    ? to_awareness_position(target_range.location)
    : existing.last_known_position;
  set_awareness_entry(observer.entity, target_ref, existing.identity_known && next_location_known ? "clear" : "obscured", {
    identity_known: Boolean(existing.identity_known),
    location_known: next_location_known,
    last_known_position: next_location_known ? next_position ?? null : existing.last_known_position ?? undefined,
    last_detected_round: existing.last_detected_round,
  });
  observer.save();
  console.info("[AwarenessRuntime] reconcile_awareness_for_pair.retained", {
    observer_ref,
    target_ref,
    in_range: target_range.in_range,
    detected_this_cycle,
    location_known: next_location_known,
    last_known_position: next_position,
  });
  return true;
}

export function reconcile_all_awareness_for_observer(slot: number, observer_ref: string): number {
  const observer = load_entity(slot, observer_ref);
  if (!observer) return 0;
  let changed = 0;
  for (const entry of get_awareness_list(observer.entity)) {
    if (reconcile_awareness_for_pair(slot, observer_ref, entry.target_ref)) {
      changed += 1;
    }
  }
  return changed;
}
