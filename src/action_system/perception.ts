// Perception System
// Broadcasts actions to nearby characters and manages perception memory

import type { ActionVerb } from "../shared/constants.js";
import type { ActionIntent, ActionResult, Location } from "./intent.js";
import { ACTION_REGISTRY } from "./registry.js";
import { calculateDistance } from "./target_resolution.js";
import { debug_log } from "../shared/debug.js";

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
  
  // Action details
  verb: ActionVerb;
  verbClarity: PerceptionClarity;
  
  // Target details
  targetRef?: string;
  targetVisibility?: PerceptionClarity;
  targetIdentity?: string;
  
  // Context
  location: Location;
  distance: number;
  senses: SenseType[];
  
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

// Check if observer can perceive an action
export async function checkPerception(
  observerRef: string,
  observerLocation: Location,
  intent: ActionIntent,
  actorLocation: Location
): Promise<PerceptionCheck> {
  const actionDef = ACTION_REGISTRY[intent.verb];
  if (!actionDef) {
    return { canPerceive: false, clarity: "obscured", senses: [], distance: 0, details: {} };
  }
  
  const distance = calculateDistance(observerLocation, actorLocation);
  const perceptibility = actionDef.perceptibility;
  
  // Check if within perception range
  if (distance > perceptibility.radius) {
    return { canPerceive: false, clarity: "obscured", senses: [], distance, details: {} };
  }
  
  // Determine which senses can perceive (using 4 canonical senses)
  const senses: SenseType[] = [];
  
  if (perceptibility.visual) {
    // TODO: Check line of sight, lighting, stealth
    senses.push("light");  // light = sight/vision
  }
  
  if (perceptibility.auditory) {
    // TODO: Check hearing range, stealth, obstacles
    senses.push("pressure");  // pressure = sound vibrations (hearing)
  }
  
  if (senses.length === 0) {
    return { canPerceive: false, clarity: "obscured", senses: [], distance, details: {} };
  }
  
  // Determine clarity based on distance and senses
  let clarity: PerceptionClarity = "clear";
  const rangeRatio = distance / perceptibility.radius;
  
  if (rangeRatio > 0.8) {
    clarity = "vague";
  } else if (rangeRatio > 0.5) {
    clarity = perceptibility.visual ? "vague" : "sensed";
  }
  
  // If only auditory, clarity is limited
  if (!perceptibility.visual && perceptibility.auditory) {
    clarity = "sensed";
  }
  
  return {
    canPerceive: true,
    clarity,
    senses,
    distance,
    details: {},
    obscured: false
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
    
    if (intent.verb === "COMMUNICATE" && intent.parameters.text) {
      eventType = "communication";
      details = {
        messageText: intent.parameters.text as string,
        language: intent.parameters.language as string || "common",
        volume: "normal",
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
    actorIdentity: intent.actorRef,  // Would resolve to name
    verb: intent.verb,
    verbClarity: perception.clarity,
    targetRef: intent.targetRef,
    targetVisibility: intent.targetRef ? perception.clarity : undefined,
    location: intent.actorLocation,
    distance: perception.distance,
    senses: perception.senses,
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
  result?: ActionResult,
  options: {
    getCharactersInRange?: (location: Location, radius: number) => Promise<Array<{ ref: string; location: Location }>>;
  } = {}
): Promise<PerceptionEvent[]> {
  const actionDef = ACTION_REGISTRY[intent.verb];
  if (!actionDef) {
    debug_log("[Perception]", `No action def for ${intent.verb}`);
    return [];
  }
  
  // Only broadcast observable actions
  if (!actionDef.perceptibility.visual && !actionDef.perceptibility.auditory) {
    debug_log("[Perception]", `Action ${intent.verb} not observable`);
    return [];
  }
  
  const radius = actionDef.perceptibility.radius;
  const events: PerceptionEvent[] = [];
  
  console.log(`[Perception] Broadcasting ${intent.verb} from ${intent.actorRef} with radius ${radius}`);
  console.log(`[Perception] Actor location:`, intent.actorLocation);
  
  // Get nearby characters
  const nearbyCharacters: Array<{ ref: string; location: Location }> = [];
  
  if (options.getCharactersInRange) {
    console.log(`[Perception] Calling getCharactersInRange...`);
    const chars = await options.getCharactersInRange(intent.actorLocation, radius);
    console.log(`[Perception] getCharactersInRange returned ${chars.length} characters`);
    for (const char of chars) {
      console.log(`[Perception]   - ${char.ref} at (${char.location.x}, ${char.location.y})`);
    }
    nearbyCharacters.push(...chars);
    debug_log("[Perception]", `Found ${chars.length} characters in range`);
  } else {
    console.log(`[Perception] ERROR: No getCharactersInRange function provided!`);
    debug_log("[Perception]", "No getCharactersInRange function provided!");
  }
  
  for (const observer of nearbyCharacters) {
    // Skip self-observation
    if (observer.ref === intent.actorRef) continue;
    
    debug_log("[Perception]", `Checking perception for observer: ${observer.ref}`);
    
    // Check perception
    const perception = await checkPerception(
      observer.ref,
      observer.location,
      intent,
      intent.actorLocation
    );
    
    debug_log("[Perception]", `Perception result for ${observer.ref}:`, { canPerceive: perception.canPerceive, clarity: perception.clarity });
    
    if (perception.canPerceive) {
      const event = createPerceptionEvent(observer.ref, intent, timing, perception, result);
      
      // Store in memory
      perceptionMemory.addPerception(observer.ref, event);
      
      events.push(event);
      debug_log("[Perception]", `Created perception event for ${observer.ref}`);
    }
  }
  
  debug_log("[Perception]", `Broadcast complete: ${events.length} observers perceived the action`);
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
