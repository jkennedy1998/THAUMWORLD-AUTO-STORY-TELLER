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
    z: mover_position.z,
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
  if (now - last < MIN_EMIT_INTERVAL_MS) {
    console.info("[MovementPerception] emit_move_perception_batch.skipped_throttle", {
      mover_ref,
      place_id: place.id,
      step_number,
      total_steps,
      speed_tpm,
      since_last_ms: now - last,
      min_interval_ms: MIN_EMIT_INTERVAL_MS,
    });
    return;
  }
  last_emit_by_mover.set(mover_ref, now);

  // Only emit when Electron API is available (renderer context).
  const api = (globalThis as any)?.electronAPI ?? (globalThis as any)?.window?.electronAPI;
  if (!api) {
    console.info("[MovementPerception] emit_move_perception_batch.skipped_no_api", {
      mover_ref,
      place_id: place.id,
      step_number,
      total_steps,
    });
    return;
  }

  const move_subtype = infer_move_subtype(speed_tpm);
  const created_at = new Date(now).toISOString();

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
      id: `move_perc_batch_${now}_${Math.random().toString(36).substring(2, 9)}`,
      type: "movement_perception_batch",
      mover_ref,
      mover_position,
      place_id: place.id,
      step_number,
      total_steps,
      speed_tpm,
      subtype: move_subtype,
      timestamp_ms: now,
      created_at: created_at,
      sender: "renderer",
      recipient: "interface_program",
    };

    console.info("[MovementPerception] emit_move_perception_batch.write_start", {
      message_id: batch_msg.id,
      mover_ref,
      place_id: place.id,
      subtype: move_subtype,
      step_number,
      total_steps,
      speed_tpm,
      inbox_path: inboxPath,
    });

    inbox.messages.unshift({
      id: batch_msg.id,
      sender: "renderer",
      content: JSON.stringify(batch_msg),
      created_at: created_at,
      type: "movement_perception_batch",
      status: "sent",
    });

    await api.writeFile(inboxPath, JSON.stringify(inbox, null, 2));
    console.info("[MovementPerception] emit_move_perception_batch.write_ok", {
      message_id: batch_msg.id,
      mover_ref,
      place_id: place.id,
      subtype: move_subtype,
    });
  } catch (err) {
    console.error("[MovementPerception] emit_move_perception_batch.failed", {
      mover_ref,
      place_id: place.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
