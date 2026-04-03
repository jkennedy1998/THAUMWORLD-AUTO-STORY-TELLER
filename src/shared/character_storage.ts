export type CharacterRole = "actor" | "npc";

export type CharacterRef = `${CharacterRole}.${string}`;

export type CharacterRuntimeContinuity = {
  breath_index?: number;
  breath_last_processed?: number;
  breath_last_processed_ms?: number;
  movement_schedule?: unknown;
  movement_physics?: unknown;
};

export type PlaceCharacterPresenceBase = CharacterRuntimeContinuity & {
  tile_position: { x: number; y: number; z?: number };
  name?: string;
  elevation?: number;
  facing?: string;
  kind_id?: string;
  movement?: { walk?: number; climb?: number; swim?: number; fly?: number };
  body_model_id?: string;
  body_slot_representation?: Record<string, any>;
  weight?: number;
  tags?: Array<{ name: string; mag: number; meta: string[] }>;
  resolved_tag_states?: unknown[];
  value_mag?: unknown;
  entity_render?: unknown;
};

export type PlaceCharacterPresence = PlaceCharacterPresenceBase & {
  ref: CharacterRef;
  role: CharacterRole;
};

export function is_character_role(value: unknown): value is CharacterRole {
  return value === "actor" || value === "npc";
}

export function is_character_ref(value: unknown): value is CharacterRef {
  if (typeof value !== "string") return false;
  return value.startsWith("actor.") || value.startsWith("npc.");
}

export function get_character_role_from_ref(ref: string): CharacterRole | null {
  if (ref.startsWith("actor.")) return "actor";
  if (ref.startsWith("npc.")) return "npc";
  return null;
}

export function get_character_id_from_ref(ref: string): string | null {
  const role = get_character_role_from_ref(ref);
  if (!role) return null;
  const prefix = `${role}.`;
  if (ref.length <= prefix.length) return null;
  return ref.slice(prefix.length);
}

export function make_character_ref(role: CharacterRole, id: string): CharacterRef {
  return `${role}.${id}`;
}
