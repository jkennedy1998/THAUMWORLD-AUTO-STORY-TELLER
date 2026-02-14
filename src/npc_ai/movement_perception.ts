/**
 * Movement Perception (NPC AI)
 *
 * Renderer-safe helper functions used by the shared movement engine.
 *
 * IMPORTANT:
 * - Conversation start/end and dialogue reactions are owned by `src/npc_ai/witness_handler.ts`.
 * - The shared movement engine runs in the renderer; do not import storage or other Node-only
 *   modules here.
 */

import type { TilePosition } from "../types/place.js";
import { DEBUG_LEVEL, debug_log } from "../shared/debug.js";
import type { Place } from "../types/place.js";
import type { PerceptionEvent, PerceptionDetails } from "../action_system/perception.js";
import { get_senses_for_action } from "../action_system/sense_broadcast.js";

/**
 * Called by the shared movement engine when an entity moves.
 *
 * This is intentionally lightweight (and often a no-op): real reaction logic lives in the
 * backend witness system. Keep only renderer-safe diagnostics here.
 */
export function process_witness_movement(
  observer_ref: string,
  mover_ref: string,
  mover_position: TilePosition,
  step_number: number = 0,
  total_steps: number = 1
): void {
  // Trace-level only to avoid log spam.
  if (DEBUG_LEVEL < 4) return;

  debug_log("MovementPerception", "movement.detected", {
    observer_ref,
    mover_ref,
    x: mover_position.x,
    y: mover_position.y,
    step_number,
    total_steps,
  });
}

/**
 * Check if movement should be detectable based on step count.
 * Walking is quieter than running, fewer steps = less sound.
 */
export function calculate_movement_detectability(
  total_steps: number,
  speed: number = 300 // tiles per minute
): { intensity: number; range: number; description: string } {
  // Fewer steps = slower movement = quieter
  // Speed: 300 TPM is normal walk, 600 is run

  if (speed >= 500) {
    // Running - loud
    return { intensity: 6, range: 8, description: "running (loud)" };
  } else if (total_steps <= 2) {
    // Very short movement - subtle
    return { intensity: 2, range: 3, description: "subtle movement (quiet)" };
  } else if (total_steps <= 5) {
    // Short movement
    return { intensity: 3, range: 5, description: "walking (normal)" };
  } else {
    // Longer movement - more noticeable
    return { intensity: 4, range: 6, description: "extended movement" };
  }
}

type MovementSubtype = "WALK" | "SNEAK" | "SPRINT";

function infer_move_subtype(speed_tpm: number): MovementSubtype {
  if (speed_tpm >= 500) return "SPRINT";
  if (speed_tpm <= 200) return "SNEAK";
  return "WALK";
}

const last_emit_by_mover = new Map<string, number>();
const MIN_EMIT_INTERVAL_MS = 350;

/**
 * Emit MOVE perception events to the backend witness system.
 *
 * This unifies movement sensing for both actors and NPCs by sending a batch of
 * PerceptionEvents through the inbox (renderer -> interface_program).
 */
export async function emit_move_perception_batch(options: {
  place: Place;
  mover_ref: string;
  mover_position: TilePosition;
  step_number: number;
  total_steps: number;
  speed_tpm: number;
}): Promise<void> {
  const { place, mover_ref, mover_position, step_number, total_steps, speed_tpm } = options;

  const now = Date.now();
  const last = last_emit_by_mover.get(mover_ref) ?? 0;
  if (now - last < MIN_EMIT_INTERVAL_MS) return;
  last_emit_by_mover.set(mover_ref, now);

  // Only emit when Electron API is available (renderer context).
  const api = (globalThis as any)?.electronAPI ?? (globalThis as any)?.window?.electronAPI;
  if (!api) return;

  const move_subtype = infer_move_subtype(speed_tpm);
  const broadcasts = get_senses_for_action("MOVE", move_subtype);
  const senses = broadcasts.map(b => b.sense);

  // Observers: all NPCs in the place except the mover if mover is an NPC.
  const observers = place.contents.npcs_present.filter(n => n.npc_ref !== mover_ref);

  const action_id = `move_${now}_${Math.random().toString(36).substring(2, 9)}`;
  const created_at = new Date(now).toISOString();

  const details_base: PerceptionDetails = {
    movement: move_subtype,
    step_number,
    total_steps,
    actor_pos: { x: mover_position.x, y: mover_position.y },
  } as any;

  const events: PerceptionEvent[] = [];
  for (const obs of observers) {
    const op = obs.tile_position;
    const dx = mover_position.x - op.x;
    const dy = mover_position.y - op.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    const details: PerceptionDetails = {
      ...details_base,
      observer_pos: { x: op.x, y: op.y },
    } as any;

    events.push({
      id: `perc_${now}_${Math.random().toString(36).substring(2, 9)}`,
      timestamp: now,
      observerRef: obs.npc_ref,
      type: "action_completed",
      actionId: action_id,
      actorRef: mover_ref,
      actorType: mover_ref.startsWith("npc.") ? "npc" : "player",
      actorVisibility: "clear",
      actorIdentity: mover_ref,
      verb: "MOVE",
      subtype: move_subtype,
      verbClarity: "clear",
      targetRef: undefined,
      targetVisibility: undefined,
      location: {
        world_x: 0,
        world_y: 0,
        region_x: 0,
        region_y: 0,
        x: mover_position.x,
        y: mover_position.y,
        place_id: place.id,
      },
      distance,
      senses,
      details,
      threatLevel: 0,
      interestLevel: 20,
      urgency: 10,
    });
  }

  if (events.length === 0) return;

  try {
    const dataSlotDir = await api.getDataSlotDir(1);
    const inboxPath = `${dataSlotDir}/inbox.jsonc`;

    // Read inbox
    const result = await api.readFile(inboxPath);
    let inbox = { schema_version: 1, messages: [] as any[] };
    if (result?.success && result.content) {
      try {
        inbox = JSON.parse(result.content);
      } catch {
        inbox = { schema_version: 1, messages: [] as any[] };
      }
    }

    const batch_msg = {
      id: `perc_batch_${now}_${Math.random().toString(36).substring(2, 9)}`,
      type: "perception_event_batch",
      events,
      place_id: place.id,
      timestamp: created_at,
      sender: "renderer",
      recipient: "interface_program",
    };

    inbox.messages.unshift({
      id: batch_msg.id,
      sender: "renderer",
      content: JSON.stringify(batch_msg),
      created_at: created_at,
      type: "perception_event_batch",
      status: "sent",
    });

    await api.writeFile(inboxPath, JSON.stringify(inbox, null, 2));
  } catch (err) {
    if (DEBUG_LEVEL >= 4) {
      debug_log("MovementPerception", "emit_move_perception_batch.failed", {
        mover_ref,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
