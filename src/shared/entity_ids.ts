import { rand_base32_rfc } from "../engine/log_store.js";

export type EntityIdKind = "actor" | "npc";

export function make_opaque_entity_id(_kind: EntityIdKind): string {
  return `ent_${rand_base32_rfc(10)}`;
}
