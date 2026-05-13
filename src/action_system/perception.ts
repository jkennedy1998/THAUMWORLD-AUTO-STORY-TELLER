// Perception System
// Broadcasts actions to nearby characters and manages perception memory

import type { ActionVerb } from "../shared/constants.js";
import type { ActionIntent, ActionResult, Location } from "./intent.js";
import { ACTION_REGISTRY } from "./registry.js";
import { get_broadcast_mag, get_senses_for_action } from "./sense_broadcast.js";
import { calculateDistance } from "./target_resolution.js";
import { DEBUG_LEVEL } from "../shared/debug.js";
import { debug_event } from "../shared/debug_event.js";
import { evaluate_sense_detection, get_observer_sense_mag, is_supported_runtime_sense } from "../shared/sense_mag.js";
import { get_region_place_index_record } from "../place_storage/region_place_index.js";

// Perception event types
export type PerceptionEventType = 
  | "action_started"
  | "action_completed"
  | "combat_started"
  | "communication"
  | "movement"
  | "damage_dealt"
  | "damage_received";

// Perception clarity levels
export type PerceptionClarity = 
  | "clear"      // Full details known
  | "vague"      // Basic idea but not specifics
  | "obscured"   // Something happened but unclear what
  | "sensed";    // Only sensed via non-visual means

export type RuntimeDetectionClarity = "clear" | "obscured" | "none";

export interface PerceptionDetection {
  sense: SenseType;
  clarity: RuntimeDetectionClarity;
  identityKnown: boolean;
  locationKnown: boolean;
  observerSenseMag: number;
  broadcastMag: number;
  detailedRangeTiles: number;
  obscuredRangeTiles: number;
}

// Perception event
export interface PerceptionEvent {
  id: string;
  timestamp: number;
  observerRef: string;
  
  // What was observed
  type: PerceptionEventType;
  actionId: string;
  
  // Actor details
  actorRef: string;
  actorType: "player" | "npc";
  actorVisibility: PerceptionClarity;
  actorIdentity?: string;  // Known name or "unknown figure"
  identityKnown?: boolean;
  locationKnown?: boolean;
  
  // Action details
  verb: ActionVerb;
  /** Optional action subtype (e.g. COMMUNICATE.NORMAL, USE.PROJECTILE_SINGLE). */
  subtype?: string;
  verbClarity: PerceptionClarity;
  
  // Target details
  targetRef?: string;
  targetVisibility?: PerceptionClarity;
  targetIdentity?: string;
  
  // Context
  location: Location;
  distance: number;
  senses: SenseType[];
  detectable?: boolean;
  bestSense?: SenseType;
  detections?: PerceptionDetection[];
  observerPositionWorld?: Location;
  actorPositionWorld?: Location;

  // Details
  details: PerceptionDetails;
  
  // For NPC AI decision-making
  threatLevel: number;      // 0-100
  interestLevel: number;    // 0-100
  urgency: number;          // 0-100
}

// Types of senses (4 canonical senses from inspection/clarity_system.ts)
// light = sight/vision, pressure = sound + touch, aroma = smell, thaumic = magic
export type SenseType = "light" | "pressure" | "aroma" | "thaumic";

// Perception details vary by event type
export type PerceptionDetails =
  | ActionStartedDetails
  | ActionCompletedDetails
  | CommunicationDetails
  | CombatDetails;

interface ActionStartedDetails {
  preparation?: string;
  toolObserved?: string;
}

interface ActionCompletedDetails {
  success: boolean;
  outcome?: string;
  effects?: string[];
}

interface CommunicationDetails {
  messageText?: string;
  language?: string;
  volume?: "whisper" | "normal" | "shout";
  understood: boolean;
}

interface CombatDetails {
  damageAmount?: number;
  damageType?: string;
  critical?: boolean;
}

// Perception check result
interface PerceptionCheck {
  canPerceive: boolean;
  clarity: PerceptionClarity;
  senses: SenseType[];
  distance: number;
  detectable?: boolean;
  bestSense?: SenseType;
  detections?: PerceptionDetection[];
  observerPositionWorld?: Location;
  actorPositionWorld?: Location;
  details: Partial<PerceptionDetails>;
  obscured?: boolean;
}

// Perception memory for NPCs
class PerceptionMemory {
  private memory: Map<string, PerceptionEvent[]> = new Map();
  private maxAgeMs: number = 5 * 60 * 1000;  // 5 minutes
  private maxEvents: number = 50;
  
  addPerception(observerRef: string, event: PerceptionEvent): void {
    const observerMemory = this.memory.get(observerRef) || [];
    observerMemory.push(event);
    
    // Expire old events
    const cutoff = Date.now() - this.maxAgeMs;
    const recent = observerMemory.filter(e => e.timestamp > cutoff);
    
    // Keep only last N events
    this.memory.set(observerRef, recent.slice(-this.maxEvents));
  }
  
  getRecent(observerRef: string, filter?: {
    types?: PerceptionEventType[];
    verbs?: ActionVerb[];
    since?: number;
  }): PerceptionEvent[] {
    const events = this.memory.get(observerRef) || [];
    
    return events.filter(e => {
      if (filter?.types && !filter.types.includes(e.type)) return false;
      if (filter?.verbs && !filter.verbs.includes(e.verb)) return false;
      if (filter?.since && e.timestamp < filter.since) return false;
      return true;
    });
  }
  
  hasObserved(
    observerRef: string, 
    condition: (event: PerceptionEvent) => boolean
  ): boolean {
    const events = this.memory.get(observerRef) || [];
    return events.some(condition);
  }
  
  getLastPerception(observerRef: string): PerceptionEvent | undefined {
    const events = this.memory.get(observerRef) || [];
    return events[events.length - 1];
  }
  
  // Check if observer saw a specific type of action recently
  sawActionRecently(
    observerRef: string,
    verb: ActionVerb,
    withinMs: number = 30000
  ): boolean {
    const cutoff = Date.now() - withinMs;
    return this.hasObserved(observerRef, e => 
      e.verb === verb && e.timestamp > cutoff
    );
  }
  
  // Get combat events observer witnessed
  getObservedCombat(observerRef: string): PerceptionEvent[] {
    return this.getRecent(observerRef, {
      types: ["combat_started", "damage_dealt", "damage_received"]
    });
  }
  
  // Clear old memories
  prune(): void {
    const cutoff = Date.now() - this.maxAgeMs;
    for (const [observerRef, events] of this.memory.entries()) {
      const recent = events.filter(e => e.timestamp > cutoff);
      if (recent.length === 0) {
        this.memory.delete(observerRef);
      } else {
        this.memory.set(observerRef, recent);
      }
    }
  }
}

// Global perception memory instance
export const perceptionMemory = new PerceptionMemory();

function toDetectionClarity(clarity: PerceptionClarity): RuntimeDetectionClarity {
  return clarity === "clear" ? "clear" : clarity === "obscured" ? "obscured" : "none";
}

function summarize_clarity(bestSense: SenseType | undefined, anyIdentity: boolean, anyClear: boolean): PerceptionClarity {
  if (bestSense === "pressure") return "sensed";
  if (anyClear && anyIdentity) return "clear";
  if (anyClear) return "vague";
  return "obscured";
}

function make_fallback_detection(sense: SenseType, clarity: PerceptionClarity): PerceptionDetection {
  const detection_clarity = toDetectionClarity(clarity);
  return {
    sense,
    clarity: detection_clarity,
    identityKnown: sense === "light" && clarity === "clear",
    locationKnown: detection_clarity !== "none",
    observerSenseMag: 0,
    broadcastMag: 0,
    detailedRangeTiles: 0,
    obscuredRangeTiles: 0,
  };
}

function to_world_location(dataSlot: number, location: Location): Location {
  const local_x = Number(location.x);
  const local_y = Number(location.y);
  const local_z = Number(location.z);
  const place_id = typeof location.place_id === "string" ? location.place_id : undefined;
  const bounds = place_id ? get_region_place_index_record(dataSlot, place_id)?.bounds ?? null : null;

  if (bounds && Number.isFinite(local_x) && Number.isFinite(local_y)) {
    const world_x = bounds.origin.x + Math.floor(local_x);
    const world_y = bounds.origin.y + Math.floor(local_y);
    const world_z = bounds.origin.z + (Number.isFinite(local_z) ? Math.floor(local_z) : 0);
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

  const fallback_world_x = Number.isFinite(Number(location.world_x)) ? Number(location.world_x) : (Number.isFinite(local_x) ? Number(local_x) : 0);
  const fallback_world_y = Number.isFinite(Number(location.world_y)) ? Number(location.world_y) : (Number.isFinite(local_y) ? Number(local_y) : 0);
  return {
    world_x: fallback_world_x,
    world_y: fallback_world_y,
    region_x: Number.isFinite(Number(location.region_x)) ? Number(location.region_x) : fallback_world_x,
    region_y: Number.isFinite(Number(location.region_y)) ? Number(location.region_y) : fallback_world_y,
    x: Number.isFinite(local_x) ? Number(local_x) : fallback_world_x,
    y: Number.isFinite(local_y) ? Number(local_y) : fallback_world_y,
    z: Number.isFinite(local_z) ? Number(local_z) : undefined,
    place_id,
  };
}

// Check if observer can perceive an action
export async function checkPerception(
  dataSlot: number,
  observerRef: string,
  observerLocation: Location,
  intent: ActionIntent,
  actorLocation: Location
): Promise<PerceptionCheck> {
  const actionDef = ACTION_REGISTRY[intent.verb];
  if (!actionDef) {
    return { canPerceive: false, clarity: "obscured", senses: [], distance: 0, details: {} };
  }
  
  const observer_world_location = to_world_location(dataSlot, observerLocation);
  const actor_world_location = to_world_location(dataSlot, actorLocation);
  const distance = calculateDistance(observer_world_location, actor_world_location);
  const perceptibility = actionDef.perceptibility;
  const subtype_raw = typeof intent.parameters?.subtype === "string"
    ? intent.parameters.subtype
    : typeof intent.parameters?.volume === "string"
      ? intent.parameters.volume
      : undefined;
  const subtype = typeof subtype_raw === "string" ? subtype_raw.toUpperCase() : undefined;
  const broadcasts = get_senses_for_action(intent.verb, subtype);
  
  // Check if within perception range
  if (distance > perceptibility.radius) {
    return { canPerceive: false, clarity: "obscured", senses: [], distance, details: {} };
  }

  const runtime_detections = broadcasts
    .filter((broadcast): broadcast is typeof broadcast & { sense: "light" | "pressure" } => is_supported_runtime_sense(broadcast.sense))
    .map((broadcast) => evaluate_sense_detection(
      broadcast.sense,
      get_observer_sense_mag(dataSlot, observerRef, broadcast.sense),
      get_broadcast_mag(broadcast),
      distance,
    ))
    .filter((result) => result.clarity !== "none")
    .map((result): PerceptionDetection => ({
      sense: result.sense,
      clarity: result.clarity,
      identityKnown: result.identity_known,
      locationKnown: result.location_known,
      observerSenseMag: result.observer_sense_mag,
      broadcastMag: result.broadcast_mag,
      detailedRangeTiles: result.detailed_range_tiles,
      obscuredRangeTiles: result.obscured_range_tiles,
    }));

  if (runtime_detections.length > 0) {
    const anyIdentity = runtime_detections.some((entry) => entry.identityKnown);
    const anyClear = runtime_detections.some((entry) => entry.clarity === "clear");
    const best = runtime_detections.reduce((current, candidate) => {
      const current_score = (current.identityKnown ? 4 : 0) + (current.locationKnown ? 2 : 0) + (current.clarity === "clear" ? 1 : 0);
      const candidate_score = (candidate.identityKnown ? 4 : 0) + (candidate.locationKnown ? 2 : 0) + (candidate.clarity === "clear" ? 1 : 0);
      return candidate_score > current_score ? candidate : current;
    });
    const clarity = summarize_clarity(best.sense, anyIdentity, anyClear);
    return {
      canPerceive: true,
      clarity,
      senses: runtime_detections.map((entry) => entry.sense),
      distance,
      detectable: true,
      bestSense: best.sense,
      detections: runtime_detections,
      observerPositionWorld: observer_world_location,
      actorPositionWorld: actor_world_location,
      details: {},
      obscured: !anyIdentity,
    };
  }

  const senses: SenseType[] = [];
  if (perceptibility.visual) senses.push("light");
  if (perceptibility.auditory) senses.push("pressure");
  if (senses.length === 0) {
    return { canPerceive: false, clarity: "obscured", senses: [], distance, details: {} };
  }

  let clarity: PerceptionClarity = "clear";
  const rangeRatio = distance / perceptibility.radius;
  if (rangeRatio > 0.8) {
    clarity = "vague";
  } else if (rangeRatio > 0.5) {
    clarity = perceptibility.visual ? "vague" : "sensed";
  }
  if (!perceptibility.visual && perceptibility.auditory) {
    clarity = "sensed";
  }

  const fallback_detections = senses.map((sense) => make_fallback_detection(sense, clarity));
  const identityKnown = fallback_detections.some((entry) => entry.identityKnown);
  
  return {
    canPerceive: true,
    clarity,
    senses,
    distance,
    detectable: true,
    bestSense: fallback_detections[0]?.sense,
    detections: fallback_detections,
    observerPositionWorld: observer_world_location,
    actorPositionWorld: actor_world_location,
    details: {},
    obscured: !identityKnown
  };
}

// Calculate threat/interest/urgency levels for NPC AI
function calculatePerceptionMetrics(
  event: PerceptionEvent,
  observerPersonality?: Record<string, number>
): { threat: number; interest: number; urgency: number } {
  let threat = 0;
  let interest = 0;
  let urgency = 0;
  
  switch (event.verb) {
    case "ATTACK":
      threat = 90;
      urgency = 95;
      interest = 80;
      break;
    case "GRAPPLE":
      threat = 85;
      urgency = 90;
      interest = 75;
      break;
    case "COMMUNICATE":
      interest = 60;
      threat = 10;
      urgency = 20;
      break;
    case "MOVE":
      interest = 30;
      urgency = 10;
      break;
    case "HELP":
      interest = 50;
      threat = 0;
      break;
    case "DEFEND":
    case "DODGE":
      threat = 50;
      urgency = 60;
      interest = 40;
      break;
    default:
      interest = 20;
  }
  
  // Adjust based on distance (closer = more urgent)
  if (event.distance < 5) urgency += 20;
  if (event.distance > 15) {
    urgency -= 20;
    threat -= 20;
  }
  
  // Adjust based on clarity
  if (event.actorVisibility === "obscured") {
    interest += 10;  // Mystery increases interest
    threat += 10;    // Unknown = potentially dangerous
  }
  
  return {
    threat: Math.min(100, threat),
    interest: Math.min(100, interest),
    urgency: Math.min(100, urgency)
  };
}

// Create perception event
function createPerceptionEvent(
  observerRef: string,
  intent: ActionIntent,
  timing: "before" | "after",
  perception: PerceptionCheck,
  result?: ActionResult
): PerceptionEvent {
  const eventId = `perc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  let details: PerceptionDetails = {};
  let eventType: PerceptionEventType = timing === "before" ? "action_started" : "action_completed";
  
  if (timing === "before") {
    details = {
      preparation: "observed"
    };
  } else if (result) {
    details = {
      success: result.success,
      outcome: result.summary
    };
    
    if (intent.verb === "COMMUNICATE" && (intent.parameters.message || intent.parameters.text)) {
      eventType = "communication";
      const vol = intent.parameters.volume as string || "normal";
      details = {
        messageText: (intent.parameters.message || intent.parameters.text) as string,
        language: intent.parameters.language as string || "common",
        volume: (vol === "whisper" || vol === "shout" ? vol : "normal") as "whisper" | "normal" | "shout",
        understood: true
      };
    }
  }
  
  const event: PerceptionEvent = {
    id: eventId,
    timestamp: Date.now(),
    observerRef,
    type: eventType,
    actionId: intent.id,
    actorRef: intent.actorRef,
    actorType: intent.actorType,
    actorVisibility: perception.clarity,
    actorIdentity: perception.clarity === "obscured" || perception.clarity === "sensed" ? undefined : intent.actorRef,
    identityKnown: !(perception.clarity === "obscured" || perception.clarity === "sensed"),
    verb: intent.verb,
    subtype: typeof intent.parameters?.subtype === "string"
      ? intent.parameters.subtype.toUpperCase()
      : typeof intent.parameters?.volume === "string"
        ? intent.parameters.volume.toUpperCase()
        : undefined,
    verbClarity: perception.clarity,
    targetRef: intent.targetRef,
    targetVisibility: intent.targetRef ? perception.clarity : undefined,
    location: intent.actorLocation,
    distance: perception.distance,
    senses: perception.senses,
    detectable: perception.detectable,
    bestSense: perception.bestSense,
    detections: perception.detections,
    observerPositionWorld: perception.observerPositionWorld,
    actorPositionWorld: perception.actorPositionWorld,
    details,
    threatLevel: 0,
    interestLevel: 0,
    urgency: 0
  };
  
  // Calculate metrics
  const metrics = calculatePerceptionMetrics(event);
  event.threatLevel = metrics.threat;
  event.interestLevel = metrics.interest;
  event.urgency = metrics.urgency;
  
  return event;
}

// Broadcast perception to nearby characters
export async function broadcastPerception(
  intent: ActionIntent,
  timing: "before" | "after",
  result: ActionResult | undefined,
  options: {
    dataSlot: number;
    getCharactersInRange?: (location: Location, radius: number) => Promise<Array<{ ref: string; location: Location }>>;
    getPerceptionObservers?: (intent: ActionIntent) => Promise<Array<{ ref: string; location: Location }>>;
    onPerceived?: (event: PerceptionEvent) => Promise<void>;
  }
): Promise<PerceptionEvent[]> {
  const actionDef = ACTION_REGISTRY[intent.verb];
  if (!actionDef) {
    debug_event("PERCEPTION", "broadcast.skipped", {
      timing,
      verb: intent.verb,
      actor_ref: intent.actorRef,
      reason: "no_action_def",
    });
    return [];
  }
  
  // Only broadcast observable actions
  if (!actionDef.perceptibility.visual && !actionDef.perceptibility.auditory) {
    debug_event("PERCEPTION", "broadcast.skipped", {
      timing,
      verb: intent.verb,
      actor_ref: intent.actorRef,
      reason: "not_observable",
    });
    return [];
  }
  
  const radius = actionDef.perceptibility.radius;
  const events: PerceptionEvent[] = [];

  debug_event("PERCEPTION", "broadcast.start", {
    timing,
    verb: intent.verb,
    actor_ref: intent.actorRef,
    target_ref: intent.targetRef,
    radius,
  });
  if (DEBUG_LEVEL >= 4) {
    debug_event("PERCEPTION", "broadcast.actor_location", {
      actor_ref: intent.actorRef,
      world_x: intent.actorLocation.world_x,
      world_y: intent.actorLocation.world_y,
      region_x: intent.actorLocation.region_x,
      region_y: intent.actorLocation.region_y,
      x: intent.actorLocation.x,
      y: intent.actorLocation.y,
      place_id: intent.actorLocation.place_id,
      z: intent.actorLocation.z,
    });
  }
  
  // Get nearby characters
  const nearbyCharacters: Array<{ ref: string; location: Location }> = [];
  
  if (options.getPerceptionObservers) {
    const chars = await options.getPerceptionObservers(intent);
    if (DEBUG_LEVEL >= 4) {
      debug_event("PERCEPTION", "broadcast.nearby_characters", {
        source: "getPerceptionObservers",
        count: chars.length,
      });
    }
    nearbyCharacters.push(...chars);
  } else if (options.getCharactersInRange) {
    const chars = await options.getCharactersInRange(intent.actorLocation, radius);
    if (DEBUG_LEVEL >= 4) {
      debug_event("PERCEPTION", "broadcast.nearby_characters", {
        source: "getCharactersInRange",
        count: chars.length,
      });
    }
    nearbyCharacters.push(...chars);
  } else {
    debug_event("PERCEPTION", "broadcast.misconfigured", {
      timing,
      verb: intent.verb,
      actor_ref: intent.actorRef,
      reason: "no_observer_source",
    });
  }
  
  for (const observer of nearbyCharacters) {
    // Skip self-observation
    if (observer.ref === intent.actorRef) continue;
    
    // Check perception
      const perception = await checkPerception(
      options.dataSlot,
      observer.ref,
      observer.location,
      intent,
      intent.actorLocation
    );
    
    if (perception.canPerceive) {
      const event = createPerceptionEvent(observer.ref, intent, timing, perception, result);
      
      // Store in memory
      perceptionMemory.addPerception(observer.ref, event);
      if (options.onPerceived) {
        console.info("[Perception] onPerceived.invoke", {
          timing,
          verb: intent.verb,
          observer_ref: observer.ref,
          actor_ref: intent.actorRef,
          visibility: event.actorVisibility,
          identityKnown: event.identityKnown,
          locationKnown: event.locationKnown,
        });
        await options.onPerceived(event);
        console.info("[Perception] onPerceived.complete", {
          timing,
          verb: intent.verb,
          observer_ref: observer.ref,
          actor_ref: intent.actorRef,
        });
      }
      
      events.push(event);
    }
  }
  
  debug_event("PERCEPTION", "broadcast.complete", {
    timing,
    verb: intent.verb,
    actor_ref: intent.actorRef,
    perceived_by: events.length,
  });
  return events;
}

// Get recent perceptions for an observer
export function getRecentPerceptions(
  observerRef: string,
  options: {
    since?: number;
    types?: PerceptionEventType[];
    minThreat?: number;
    minInterest?: number;
  } = {}
): PerceptionEvent[] {
  return perceptionMemory.getRecent(observerRef, {
    types: options.types,
    since: options.since
  }).filter(e => {
    if (options.minThreat && e.threatLevel < options.minThreat) return false;
    if (options.minInterest && e.interestLevel < options.minInterest) return false;
    return true;
  });
}

// Check if observer should react to an event
export function shouldReactToEvent(
  observerRef: string,
  event: PerceptionEvent,
  personality: {
    aggression: number;
    curiosity: number;
    caution: number;
  }
): boolean {
  // High threat events always trigger reaction if caution is moderate
  if (event.threatLevel > 70 && personality.caution > 30) {
    return true;
  }
  
  // Combat events trigger if aggression is high
  if (event.type === "combat_started" && personality.aggression > 50) {
    return true;
  }
  
  // Communication triggers if curiosity is high
  if (event.type === "communication" && personality.curiosity > 60) {
    return true;
  }
  
  // Urgent events always trigger
  if (event.urgency > 80) {
    return true;
  }
  
  return false;
}
