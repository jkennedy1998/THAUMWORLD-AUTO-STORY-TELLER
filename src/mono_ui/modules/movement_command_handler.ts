import type { Place, TilePosition } from "../../types/place.js";
import { debug_event } from "../../shared/debug_event.js";

let current_place: Place | null = null;

const npc_actual_positions = new Map<string, TilePosition>();
const npc_visual_status_by_ref = new Map<string, string>();
const RENDERER_MOVEMENT_TRACE_ENABLED = false;

export function get_npc_visual_status(npc_ref: string): string | undefined {
  return npc_visual_status_by_ref.get(npc_ref);
}

export function set_command_handler_place(place: Place | null): void {
  current_place = place;

  if (!place) return;

  for (const npc of place.contents.npcs_present) {
    const status = typeof npc.status === "string" && npc.status.length > 0 ? npc.status : "present";
    const known = npc_visual_status_by_ref.get(npc.npc_ref);
    if (known) {
      (npc as any).status = known;
    } else {
      npc_visual_status_by_ref.set(npc.npc_ref, status);
      (npc as any).status = status;
    }

    if (!npc_actual_positions.has(npc.npc_ref)) {
      npc_actual_positions.set(npc.npc_ref, { ...npc.tile_position });
    }
  }

  for (const actor of place.contents.actors_present) {
    if (!npc_actual_positions.has(actor.actor_ref)) {
      npc_actual_positions.set(actor.actor_ref, { ...actor.tile_position });
    }
  }
}

export function set_npc_tracked_position(entity_ref: string, position: TilePosition): void {
  npc_actual_positions.set(entity_ref, { ...position });
  if (RENDERER_MOVEMENT_TRACE_ENABLED) {
    debug_event("RENDERER.MOVEMENT", "entity.position.tracked", {
      entity_ref,
      x: position.x,
      y: position.y,
    });
  }

  if (!current_place || !entity_ref.startsWith("actor.")) return;

  const actor = current_place.contents.actors_present.find((a: any) => a.actor_ref === entity_ref);
  if (actor) actor.tile_position = { ...position };
}
