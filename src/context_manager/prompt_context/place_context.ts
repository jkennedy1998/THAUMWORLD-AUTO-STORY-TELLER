import type { DialoguePromptContextParams } from "./types.js";
import { safe_text } from "./utils.js";

function get_place_occupant_name(place: any, ref: string): string {
    if (ref.startsWith("npc.")) {
        const match = Array.isArray(place?.contents?.npcs_present)
            ? place.contents.npcs_present.find((entry: any) => String(entry?.npc_ref ?? "") === ref)
            : null;
        return safe_text(match?.name) || safe_text(match?.npc_ref).replace(/^npc\./, "") || "Unknown NPC";
    }
    if (ref.startsWith("actor.")) {
        const match = Array.isArray(place?.contents?.actors_present)
            ? place.contents.actors_present.find((entry: any) => String(entry?.actor_ref ?? "") === ref)
            : null;
        return safe_text(match?.name) || "Unknown Actor";
    }
    return ref;
}

export function build_place_candidates(params: DialoguePromptContextParams): string[] {
    const { npc_ref, player_ref, place } = params;
    const candidates: string[] = [];
    if (!place) return candidates;

    const place_name = safe_text(place?.name);
    const npcs = Array.isArray(place?.contents?.npcs_present) ? place.contents.npcs_present : [];
    const actors = Array.isArray(place?.contents?.actors_present) ? place.contents.actors_present : [];
    const structures = Array.isArray(place?.structures) ? place.structures.filter((entry: any) => !entry?.__debug) : [];
    const items_on_ground = Array.isArray(place?.contents?.items_on_ground) ? place.contents.items_on_ground : [];
    const containers = place?.containers && typeof place.containers === "object" ? Object.values(place.containers as Record<string, any>) : [];

    const npc_here = npcs.find((entry: any) => String(entry?.npc_ref ?? "") === npc_ref);
    const origin = npc_here?.tile_position ?? actors.find((entry: any) => String(entry?.actor_ref ?? "") === player_ref)?.tile_position ?? null;
    const radius = 4;
    const is_near = (pos: any): boolean => {
        if (!origin || !pos) return true;
        const dx = Math.abs(Number(pos.x ?? 0) - Number(origin.x ?? 0));
        const dy = Math.abs(Number(pos.y ?? 0) - Number(origin.y ?? 0));
        return dx <= radius && dy <= radius;
    };

    const nearby_actors = actors.filter((entry: any) => String(entry?.actor_ref ?? "") !== player_ref && is_near(entry?.tile_position));
    const nearby_npcs = npcs.filter((entry: any) => String(entry?.npc_ref ?? "") !== npc_ref && is_near(entry?.tile_position));
    if (place_name) {
        const total_people = npcs.length + actors.length;
        candidates.push(`Place snapshot: you are in ${place_name}, with ${total_people} visible person${total_people === 1 ? "" : "s"} in the room.`);
    }
    if (is_near(actors.find((entry: any) => String(entry?.actor_ref ?? "") === player_ref)?.tile_position)) {
        candidates.push(`The speaker is physically near you in the same room.`);
    }
    for (const actor of nearby_actors.slice(0, 2)) {
        candidates.push(`Nearby character: ${get_place_occupant_name(place, String(actor.actor_ref ?? ""))} is close enough to notice.`);
    }
    for (const other of nearby_npcs.slice(0, 2)) {
        candidates.push(`Nearby local: ${get_place_occupant_name(place, String(other.npc_ref ?? ""))} is in the room nearby.`);
    }

    const nearbyGroundItems = items_on_ground.filter((entry: any) => is_near(entry?.tile_position));
    for (const item of nearbyGroundItems.slice(0, 2)) {
        const name = safe_text(item?.definition?.name) || safe_text(item?.instance?.def_id);
        if (name) candidates.push(`Visible nearby item: ${name}.`);
    }

    for (const container of containers.slice(0, 4)) {
        if (!is_near(container?.position)) continue;
        const contents = Array.isArray(container?.contents) ? container.contents : [];
        const notable = contents
            .map((entry: any) => safe_text(entry?.definition?.name) || safe_text(entry?.instance?.def_id))
            .filter((name: string) => name.length > 0)
            .slice(0, 2);
        if (notable.length > 0) {
            candidates.push(`Nearby belongings include ${notable.join(" and ")}.`);
        }
    }

    for (const structure of structures.slice(0, 2)) {
        const name = safe_text(structure?.id);
        if (name) candidates.push(`A nearby feature stands out: ${name.replace(/_/g, " ")}.`);
    }

    const shortDescription = safe_text(place?.description?.short);
    if (shortDescription) candidates.push(`Place detail: ${shortDescription}.`);
    return candidates;
}

export function get_nearby_surroundings(params: DialoguePromptContextParams): string[] {
    return build_place_candidates(params);
}

export function build_place_summary_candidates(params: DialoguePromptContextParams): string[] {
    const { place, region } = params;
    const candidates: string[] = [];
    if (!place) return candidates;

    const placeName = safe_text(place?.name);
    const placeShort = safe_text(place?.description?.short);
    const placeFull = safe_text(place?.description?.full);
    const npcs = Array.isArray(place?.contents?.npcs_present) ? place.contents.npcs_present : [];
    const actors = Array.isArray(place?.contents?.actors_present) ? place.contents.actors_present : [];
    const containers = place?.containers && typeof place.containers === "object" ? Object.values(place.containers as Record<string, any>) : [];
    const structures = Array.isArray(place?.structures) ? place.structures.filter((entry: any) => !entry?.__debug) : [];

    if (placeName) candidates.push(`Place: ${placeName}`);
    if (placeShort) candidates.push(`Place summary: ${placeShort}`);
    if (placeFull) candidates.push(`Place detail: ${placeFull}`);
    if (npcs.length > 0) candidates.push(`People here: ${npcs.length} local inhabitant${npcs.length === 1 ? "" : "s"} present.`);
    if (actors.length > 0) candidates.push(`Visitors here: ${actors.length} actor${actors.length === 1 ? "" : "s"} currently in the place.`);
    if (containers.length > 0) candidates.push(`The place contains ${containers.length} notable stash or storage point${containers.length === 1 ? "" : "s"}.`);
    if (structures.length > 0) candidates.push(`Notable fixtures: ${structures.slice(0, 3).map((entry: any) => safe_text(entry?.id).replace(/_/g, " ")).filter(Boolean).join(", ")}.`);

    const regionName = safe_text(region?.name);
    const regionAtmosphere = safe_text(region?.description?.atmosphere);
    if (regionName) candidates.push(`Region: ${regionName}`);
    if (regionAtmosphere) candidates.push(`Regional atmosphere: ${regionAtmosphere}`);

    return candidates;
}

export function get_place_summary(params: DialoguePromptContextParams): string[] {
    return build_place_summary_candidates(params);
}
