import { resolve_surface_target_id } from "./target_ids.js";
import { parse_actor_item_container_id, parse_body_slots_path, type ActorItemTarget, type BodySlotTarget } from "../transfer/legality.js";

export type PlaceTileTarget = { kind: "place_tile"; place_id: string; x: number; y: number; z: number };
export type PlaceGroundTarget = { kind: "place_ground"; place_id: string; x: number; y: number; z: number };
export type PlaceItemTarget = { kind: "place_item"; place_id: string; item_id: string };
export type PlaceGrowTarget = { kind: "place_grow"; place_id: string; x: number; y: number; z: number; grow_index: number };
export type PlaceTarget = PlaceTileTarget | PlaceGroundTarget | PlaceItemTarget | PlaceGrowTarget;
export type InventoryPathTarget = BodySlotTarget | ActorItemTarget | PlaceTarget;

export function parse_place_tile_target(p: string): PlaceTileTarget | null {
  const parts = String(p ?? "").split(".");
  if (parts[0] !== "place" || parts[1] !== "tile") return null;
  if (!parts[2] || !parts[3]) return null;
  const [xs, ys, zs] = String(parts[3]).split("_");
  const x = Number(xs);
  const y = Number(ys);
  const z = Number(zs);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { kind: "place_tile", place_id: parts[2], x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) };
}

export function parse_place_ground_target(p: string): PlaceGroundTarget | null {
  const parts = String(p ?? "").split(".");
  if (parts[0] !== "place") return null;
  if (parts[1] !== "ground" && parts[1] !== "pile") return null;
  if (!parts[2] || !parts[3]) return null;
  const [xs, ys, zs] = String(parts[3]).split("_");
  const x = Number(xs);
  const y = Number(ys);
  const z = Number(zs);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { kind: "place_ground", place_id: parts[2], x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) };
}

export function parse_place_item_target(p: string): PlaceItemTarget | null {
  const parts = String(p ?? "").split(".");
  if (parts[0] !== "place" || parts[1] !== "item") return null;
  if (!parts[2] || !parts[3]) return null;
  return { kind: "place_item", place_id: parts[2], item_id: parts[3] };
}

export function parse_place_grow_target(p: string): PlaceGrowTarget | null {
  const parts = String(p ?? "").split(".");
  if (parts[0] !== "place" || parts[1] !== "grow") return null;
  if (!parts[2] || !parts[3] || parts[4] === undefined) return null;
  const [xs, ys, zs] = String(parts[3]).split("_");
  const x = Number(xs);
  const y = Number(ys);
  const z = Number(zs);
  const grow_index = Number(parts[4]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(grow_index)) return null;
  return { kind: "place_grow", place_id: parts[2], x: Math.floor(x), y: Math.floor(y), z: Math.floor(z), grow_index: Math.floor(grow_index) };
}

export function parse_place_target(p: string): PlaceTarget | null {
  return parse_place_tile_target(p) || parse_place_ground_target(p) || parse_place_item_target(p) || parse_place_grow_target(p);
}

export function resolve_inventory_target_id(input: string | null | undefined): { container_id: string; target: InventoryPathTarget | null } | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  const surface = resolve_surface_target_id(raw);
  const container_id = surface?.container_id ?? raw;
  const target = parse_body_slots_path(container_id)
    || parse_actor_item_container_id(container_id)
    || parse_place_target(container_id);
  return { container_id, target };
}
