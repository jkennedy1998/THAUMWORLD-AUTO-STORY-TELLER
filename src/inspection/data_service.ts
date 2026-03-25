// Inspection Data Service
// Main service for performing inspections on targets

import { calculate_clarity, calculate_distance, get_best_inspection_sense, type SenseType, type ClarityLevel, type Location } from "./clarity_system.js";
import { get_tile_definition } from "../tile_storage/store.js";
import type { TileFeature } from "../tile_storage/types.js";
import { debug_log } from "../shared/debug.js";
import { load_place } from "../place_storage/store.js";
import { get_place_tile_at_world_z, get_place_base_world_z, get_place_tile_kind_at_world_z } from "../shared/place_layers.js";
import { resolve_place_tile } from "../tile_storage/resolve.js";
import { load_actor } from "../actor_storage/store.js";
import { load_npc } from "../npc_storage/store.js";
import { load_item_def, extract_item_id } from "../item_storage/store.js";
import { resolve_inline_item } from "../item_storage/resolve.js";
import type { TagInstance } from "../tag_system/registry.js";
import type { Place, PlaceStructureInstance, PlaceTile, PlaceItem, PlaceActor, PlaceNPC } from "../types/place.js";
import type { InlineItem } from "../types/inline_item.js";
import type { InspectionFeature, InspectionResult, InspectionTarget, InspectorData } from "./types.js";
export type { InspectionFeature, InspectionResult, InspectionTarget, InspectorData } from "./types.js";

type InspectFact = {
  id: string;
  text: string;
  importance: number;
  mundane?: boolean;
  nearby?: boolean;
};

type InspectOptions = {
  requested_keywords?: string[];
  max_features?: number;
  target_location?: Location;
  target_size_mag?: number;
};

type TileItemSummary = {
  ref: string;
  name: string;
  description: string;
  quantity: number;
};

type TileTagInspectionData = {
  detail_lines: string[];
  features: InspectionFeature[];
  fact_lines: string[];
};

type ItemInspectData = {
  ref: string;
  name: string;
  description: string;
  quantity: number;
  effective_tags: TagInstance[];
  sensory_details: Record<string, string[]>;
};

type ItemTagInspectionData = {
  detail_lines: string[];
  features: InspectionFeature[];
};

function get_feature_name(feature: TileFeature): string {
  return String((feature as any).name ?? feature.id ?? 'feature');
}

function get_feature_description(feature: TileFeature): string {
  return String((feature as any).description ?? feature.text ?? get_feature_name(feature));
}

function get_feature_keywords(feature: TileFeature): string[] {
  return Array.isArray(feature.keywords) ? feature.keywords : [];
}

function get_feature_requires_sense(feature: TileFeature): SenseType | undefined {
  return (feature as any).requires_sense ?? (Array.isArray((feature as any).senses) ? (feature as any).senses[0] : undefined);
}

function hash_string(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seeded_shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let s = seed >>> 0;
  for (let i = out.length - 1; i > 0; i -= 1) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

function title_case_from_ref(ref: string, fallback: string): string {
  const raw = String(ref ?? '').replace(/^(actor|npc|item|tile)\./, '').trim();
  const base = raw.length > 0 ? raw : fallback;
  return base.replace(/[_\.]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

function structure_occupies_tile(structure: PlaceStructureInstance, tile_x: number, tile_y: number, world_z: number, place: Place): boolean {
  const origin_z = typeof structure.origin?.z === 'number' ? Math.floor(structure.origin.z) : get_place_base_world_z(place);
  const body = Array.isArray((structure as any)?.body_model?.physical) && (structure as any).body_model.physical.length > 0
    ? (structure as any).body_model.physical
    : [{ dx: 0, dy: 0, dz: 0 }];
  return body.some((voxel: any) => (
    (Math.floor(structure.origin.x) + Math.floor(Number(voxel?.dx ?? 0))) === tile_x &&
    (Math.floor(structure.origin.y) + Math.floor(Number(voxel?.dy ?? 0))) === tile_y &&
    (origin_z + Math.floor(Number(voxel?.dz ?? 0))) === world_z
  ));
}

function get_structures_at_tile(place: Place, tile_x: number, tile_y: number, world_z: number): PlaceStructureInstance[] {
  const structures = Array.isArray((place as any)?.structures) ? (place as any).structures as PlaceStructureInstance[] : [];
  return structures.filter((structure) => structure_occupies_tile(structure, tile_x, tile_y, world_z, place));
}

function get_items_at_tile(place: Place, tile_x: number, tile_y: number, world_z: number): PlaceItem[] {
  const items = Array.isArray(place?.contents?.items_on_ground) ? place.contents.items_on_ground : [];
  return items.filter((item) => (
    Math.floor(Number(item?.tile_position?.x)) === tile_x &&
    Math.floor(Number(item?.tile_position?.y)) === tile_y &&
    Math.floor(Number(item?.elevation ?? world_z)) === world_z
  ));
}

function get_inline_ground_items_at_tile(place: Place, tile_x: number, tile_y: number, world_z: number): InlineItem[] {
  const scattered = (place as any)?.ground?.scattered;
  if (!scattered || typeof scattered !== 'object') return [];

  const key = `${Math.floor(tile_x)}_${Math.floor(tile_y)}_${Math.floor(world_z)}`;
  if (Array.isArray(scattered[key])) {
    return scattered[key] as InlineItem[];
  }

  const legacy_key = `${Math.floor(tile_x)}_${Math.floor(tile_y)}`;
  const legacy_items = Array.isArray(scattered[legacy_key]) ? scattered[legacy_key] as InlineItem[] : [];
  return legacy_items.filter((item: any) => Math.floor(Number(item?.elevation ?? world_z)) === world_z);
}

function get_scattered_container_items_at_tile(place: Place, tile_x: number, tile_y: number): any[] {
  const containers = (place as any)?.containers;
  if (!containers || typeof containers !== 'object') return [];
  const key = `scattered_${Math.floor(tile_x)}_${Math.floor(tile_y)}`;
  const container = containers[key];
  if (!container || container.subtype !== 'scattered' || !Array.isArray(container.contents)) return [];
  return container.contents as any[];
}

function summarize_tile_items(place: Place, slot: number, tile_x: number, tile_y: number, world_z: number): TileItemSummary[] {
  const summaries: TileItemSummary[] = [];
  const seen = new Set<string>();

  const pushSummary = (summary: TileItemSummary | null): void => {
    if (!summary) return;
    const key = summary.ref || `${summary.name}:${summary.quantity}`;
    if (seen.has(key)) return;
    seen.add(key);
    summaries.push(summary);
  };

  for (const item of get_items_at_tile(place, tile_x, tile_y, world_z)) {
    const name = get_place_item_name(place, slot, item.item_ref);
    const def = load_item_def(slot, extract_item_id(item.item_ref));
    pushSummary({
      ref: String(item.item_ref ?? ''),
      name,
      description: def.ok ? String(def.item.description ?? '') : '',
      quantity: Math.max(1, Number(item.quantity ?? 1) || 1),
    });
  }

  for (const item of get_inline_ground_items_at_tile(place, tile_x, tile_y, world_z)) {
    const resolved = resolve_inline_item(String(item?.def_id ?? ''), item);
    pushSummary({
      ref: `item.${String(item?.id ?? '')}`,
      name: String(resolved?.name ?? item?.def_id ?? 'item'),
      description: String(resolved?.def?.description ?? ''),
      quantity: Math.max(1, Number(item?.qty ?? 1) || 1),
    });
  }

  for (const entry of get_scattered_container_items_at_tile(place, tile_x, tile_y)) {
    const instance = (entry as any)?.instance;
    const definition = (entry as any)?.definition;
    const ref = instance?.id ? `item.${String(instance.id)}` : String(definition?.id ?? '');
    pushSummary({
      ref,
      name: String(definition?.name ?? instance?.def_id ?? 'item'),
      description: String(definition?.description ?? ''),
      quantity: Math.max(1, Number(instance?.qty ?? 1) || 1),
    });
  }

  return summaries;
}

function format_tile_item_label(item: TileItemSummary): string {
  return item.quantity > 1 ? `${item.quantity}x ${item.name}` : item.name;
}

function build_tile_item_description_lines(items: TileItemSummary[], clarity: ClarityLevel): string[] {
  if (items.length === 0) return [];
  if (clarity === 'obscured') return ['Something lies on this tile, but its details refuse to settle.'];
  if (clarity === 'vague') {
    const labels = items.slice(0, 2).map(format_tile_item_label);
    if (items.length === 1) return [`Something like ${labels[0]!.toLowerCase()} lies on the tile.`];
    return [`A few items lie here, including ${labels.join(' and ')}.`];
  }

  return items.slice(0, 3)
    .map((item) => {
      const label = format_tile_item_label(item);
      const description = item.description.trim();
      return description.length > 0 ? `${label}: ${description}` : label;
    });
}

function build_item_sensory_details(description: string, sense_used: SenseType, clarity: ClarityLevel): Record<string, string[]> {
  if (clarity !== 'clear' || description.trim().length === 0) return {};
  return { [sense_used]: [description] };
}

function has_tag(tags: TagInstance[], name: string): boolean {
  const up = String(name ?? '').toUpperCase();
  return Array.isArray(tags) && tags.some((tag) => String(tag?.name ?? '').toUpperCase() === up);
}

function get_grow_product_names(slot: number, tags: TagInstance[]): string[] {
  const grow_tag = Array.isArray(tags)
    ? tags.find((tag) => String(tag?.name ?? '').toUpperCase() === 'GROW')
    : null;
  const seen = new Set<string>();
  const names: string[] = [];
  const info_entries = Array.isArray(grow_tag?.info) ? grow_tag!.info : [];

  for (const entry of info_entries) {
    const raw_ids = [
      ...(Array.isArray((entry as any)?.item_def_ids) ? (entry as any).item_def_ids : []),
      ...(Array.isArray((entry as any)?.def_ids) ? (entry as any).def_ids : []),
      ...(typeof (entry as any)?.item_def_id === 'string' ? [(entry as any).item_def_id] : []),
      ...(typeof (entry as any)?.def_id === 'string' ? [(entry as any).def_id] : []),
    ];
    for (const raw_id of raw_ids) {
      const def_id = String(raw_id ?? '').trim();
      if (!def_id) continue;
      const loaded = load_item_def(slot, def_id);
      const name = loaded.ok ? String(loaded.item.name ?? def_id) : title_case_from_ref(def_id, 'item');
      if (!seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
  }

  return names;
}

function create_tag_feature(id: string, name: string, description: string, clarity: ClarityLevel): InspectionFeature {
  return {
    id,
    name,
    description,
    discovered: true,
    hidden: false,
    clarity,
  };
}

function build_tile_tag_inspection_data(slot: number, tags: TagInstance[], clarity: ClarityLevel): TileTagInspectionData {
  if (!Array.isArray(tags) || tags.length === 0 || clarity === 'obscured') {
    return { detail_lines: [], features: [], fact_lines: [] };
  }

  const detail_lines: string[] = [];
  const features: InspectionFeature[] = [];
  const fact_lines: string[] = [];
  const product_names = get_grow_product_names(slot, tags);

  const add = (id: string, name: string, description: string, detail?: string): void => {
    features.push(create_tag_feature(id, name, description, clarity));
    fact_lines.push(description);
    if (clarity === 'clear') {
      detail_lines.push((detail ?? description).trim());
    }
  };

  if (has_tag(tags, 'FLORA')) {
    add(
      'tag:flora',
      'Living Growth',
      'Living growth has taken hold here.',
      'Living growth clings to this patch, giving it a rooted, growing character.',
    );
  }

  if (has_tag(tags, 'GROW')) {
    const product_text = product_names.length === 0
      ? 'It looks capable of producing new growth here.'
      : product_names.length === 1
        ? `It looks capable of producing ${product_names[0]!.toLowerCase()} here.`
        : `It looks capable of producing ${product_names.slice(0, 2).join(' and ')} here.`;
    const detail = product_names.length === 0
      ? 'Its growth pattern suggests that it can still put out new shoots or fruit.'
      : product_names.length === 1
        ? `Its growth pattern suggests it can bear ${product_names[0]!.toLowerCase()}.`
        : `Its growth pattern suggests it can bear ${product_names.slice(0, 2).join(' and ')}.`;
    add('tag:grow', 'Growing Yield', product_text, detail);
  }

  if (has_tag(tags, 'PUSHABLE')) {
    add(
      'tag:pushable',
      'Loose Enough To Shift',
      'It looks loose enough to shove out of place.',
      'Its balance looks imperfect, as if a solid push could shift it out of place.',
    );
  }

  if (has_tag(tags, 'GRAVITY')) {
    add(
      'tag:gravity',
      'Prone To Drop',
      'It seems likely to drop if its support gives way.',
      'It carries the look of something that would fall the moment its support fails.',
    );
  }

  if (has_tag(tags, 'CONTAINER')) {
    const description = has_tag(tags, 'FLORA')
      ? 'Its growth catches and holds small things among it.'
      : 'Its shape gathers and holds loose things in place.';
    const detail = has_tag(tags, 'FLORA')
      ? 'Branches, leaves, or stems naturally catch small things among the growth.'
      : 'The form of it creates a natural resting place for loose things instead of letting them slip away.';
    add('tag:holding_surface', 'Holding Surface', description, detail);
  }

  return { detail_lines, features, fact_lines };
}

function build_item_tag_inspection_data(slot: number, tags: TagInstance[], clarity: ClarityLevel): ItemTagInspectionData {
  if (!Array.isArray(tags) || tags.length === 0 || clarity === 'obscured') {
    return { detail_lines: [], features: [] };
  }

  const detail_lines: string[] = [];
  const features: InspectionFeature[] = [];
  const product_names = get_grow_product_names(slot, tags);
  const add = (id: string, name: string, description: string, detail?: string): void => {
    features.push(create_tag_feature(id, name, description, clarity));
    if (clarity === 'clear') detail_lines.push((detail ?? description).trim());
  };

  if (has_tag(tags, 'FOOD')) {
    add('tag:food', 'Edible Matter', 'It reads as something meant to be eaten.', 'Its form and scent suggest it was meant for eating.');
  }
  if (has_tag(tags, 'SPOILS')) {
    const product_text = product_names.length === 1
      ? `It looks prone to breaking down into ${product_names[0]!.toLowerCase()} over time.`
      : 'It looks prone to breaking down as it sits.';
    add('tag:spoils', 'Perishable', product_text, product_text);
  }
  if (has_tag(tags, 'CONTAINER')) {
    add('tag:container', 'Can Hold Things', 'It seems made to carry or hold other things.', 'Its shape and seams suggest it was made to hold other things.');
  }

  return { detail_lines, features };
}

function build_item_inspect_data_from_inline_item(item_ref: string, inline: InlineItem, sense_used: SenseType, clarity: ClarityLevel): ItemInspectData {
  const resolved = resolve_inline_item(String(inline?.def_id ?? ''), inline);
  const name = String(resolved?.name ?? inline?.def_id ?? title_case_from_ref(item_ref, 'item'));
  const description = String(resolved?.def?.description ?? '');
  return {
    ref: item_ref,
    name,
    description,
    quantity: Math.max(1, Number((inline as any)?.qty ?? 1) || 1),
    effective_tags: Array.isArray(resolved?.effective_tags) ? resolved!.effective_tags : [],
    sensory_details: build_item_sensory_details(description, sense_used, clarity),
  };
}

function build_item_inspect_data_from_container_entry(item_ref: string, entry: any, sense_used: SenseType, clarity: ClarityLevel): ItemInspectData {
  const instance = (entry as any)?.instance;
  const definition = (entry as any)?.definition;
  return {
    ref: item_ref,
    name: String(definition?.name ?? instance?.def_id ?? title_case_from_ref(item_ref, 'item')),
    description: String(definition?.description ?? ''),
    quantity: Math.max(1, Number(instance?.qty ?? 1) || 1),
    effective_tags: Array.isArray(definition?.tags) ? definition.tags as TagInstance[] : [],
    sensory_details: build_item_sensory_details(String(definition?.description ?? ''), sense_used, clarity),
  };
}

function get_scattered_container_entry_by_item_ref(place: Place, item_ref: string): any | null {
  const item_id = String(item_ref ?? '').replace(/^item\./, '').trim();
  if (!item_id) return null;
  const containers = (place as any)?.containers;
  if (!containers || typeof containers !== 'object') return null;
  for (const container of Object.values(containers as Record<string, any>)) {
    if (!container || !Array.isArray((container as any).contents)) continue;
    const found = (container as any).contents.find((entry: any) => String(entry?.instance?.id ?? '') === item_id);
    if (found) return found;
  }
  return null;
}

function resolve_item_inspect_data(place: Place | null | undefined, slot: number, item_ref: string, sense_used: SenseType, clarity: ClarityLevel, found_item?: any): ItemInspectData | null {
  if (found_item?.item) {
    return build_item_inspect_data_from_container_entry(item_ref, found_item.item, sense_used, clarity);
  }
  if (place) {
    const inline = find_ground_inline_item(place, item_ref);
    if (inline) return build_item_inspect_data_from_inline_item(item_ref, inline, sense_used, clarity);
    const scattered_entry = get_scattered_container_entry_by_item_ref(place, item_ref);
    if (scattered_entry) return build_item_inspect_data_from_container_entry(item_ref, scattered_entry, sense_used, clarity);
  }
  return null;
}

function build_tile_space_short_description(place: Place, slot: number, tile_x: number, tile_y: number, world_z: number, tile_name: string): string {
  const structures = get_structures_at_tile(place, tile_x, tile_y, world_z);
  if (structures.length > 0) {
    const structure_name = get_structure_name(structures[0]!);
    return `${structure_name} occupies this tile space on ${tile_name}.`;
  }

  const items = summarize_tile_items(place, slot, tile_x, tile_y, world_z);
  if (items.length > 0) {
    if (items.length === 1) {
      return `${format_tile_item_label(items[0]!)} lies on ${tile_name}.`;
    }
    return `${items.length} items lie on ${tile_name}.`;
  }

  const npcs = get_npcs_at_tile(place, tile_x, tile_y, world_z);
  if (npcs.length > 0) {
    const npc_id = String(npcs[0]!.npc_ref ?? '').replace(/^npc\./, '');
    const loaded = load_npc(slot, npc_id);
    const npc_name = loaded.ok ? String((loaded.npc as any)?.name ?? title_case_from_ref(npcs[0]!.npc_ref, 'Npc')) : title_case_from_ref(npcs[0]!.npc_ref, 'Npc');
    return `${npc_name} is at this tile on ${tile_name}.`;
  }

  const actors = get_actors_at_tile(place, tile_x, tile_y, world_z);
  if (actors.length > 0) {
    return `${title_case_from_ref(actors[0]!.actor_ref, 'Actor')} is at this tile on ${tile_name}.`;
  }

  return tile_name;
}

function find_ground_inline_item(place: Place, item_ref: string): InlineItem | null {
  const item_id = String(item_ref ?? '').replace(/^item\./, '').trim();
  if (!item_id) return null;
  const scattered = (place as any)?.ground?.scattered;
  if (scattered && typeof scattered === 'object') {
    for (const value of Object.values(scattered)) {
      if (!Array.isArray(value)) continue;
      const found = value.find((item: any) => String(item?.id ?? '') === item_id);
      if (found) return found as InlineItem;
    }
  }
  const main = Array.isArray((place as any)?.ground?.main) ? (place as any).ground.main : [];
  const found = main.find((item: any) => String(item?.id ?? '') === item_id);
  return found ? found as InlineItem : null;
}

function get_place_item_name(place: Place, slot: number, item_ref: string): string {
  const inline = find_ground_inline_item(place, item_ref);
  const def_id = String((inline as any)?.def_id ?? '').trim();
  if (def_id) {
    const def = load_item_def(slot, def_id);
    if (def.ok) return def.item.name;
  }
  const maybe_def = load_item_def(slot, extract_item_id(item_ref));
  if (maybe_def.ok) return maybe_def.item.name;
  return title_case_from_ref(item_ref, 'item');
}

function get_structure_name(structure: PlaceStructureInstance): string {
  const resolved = resolve_place_tile(String(structure.def_id ?? ''), { kind: structure.def_id, tag_add: structure.tag_add, tag_remove: structure.tag_remove } as any);
  return resolved?.def?.name ?? title_case_from_ref(structure.def_id, 'structure');
}

function get_structure_by_id(place: Place, structure_ref: string): PlaceStructureInstance | null {
  const normalized = String(structure_ref ?? '').replace(/^structure\./, '').trim();
  if (!normalized) return null;
  const structures = Array.isArray((place as any)?.structures) ? (place as any).structures as PlaceStructureInstance[] : [];
  return structures.find((structure) => String((structure as any)?.id ?? '').trim() === normalized) ?? null;
}

function get_structure_tile_fallback(structure: PlaceStructureInstance, place: Place): PlaceTile {
  return {
    kind: String(structure.def_id ?? ''),
    tag_add: Array.isArray((structure as any)?.tag_add) ? (structure as any).tag_add : undefined,
    tag_remove: Array.isArray((structure as any)?.tag_remove) ? (structure as any).tag_remove : undefined,
  } as PlaceTile;
}

function get_target_priority(target: InspectionTarget['type']): number {
  switch (target) {
    case 'character': return 110;
    case 'npc': return 108;
    case 'item_pile': return 104;
    case 'item': return 102;
    case 'tile': return 96;
    case 'adjacent_place': return 94;
    case 'place': return 92;
    default: return 90;
  }
}

function get_actors_at_tile(place: Place, tile_x: number, tile_y: number, world_z: number): PlaceActor[] {
  const actors = Array.isArray(place?.contents?.actors_present) ? place.contents.actors_present : [];
  return actors.filter((actor) => (
    Math.floor(Number(actor?.tile_position?.x)) === tile_x &&
    Math.floor(Number(actor?.tile_position?.y)) === tile_y &&
    Math.floor(Number(actor?.elevation ?? get_place_base_world_z(place))) === world_z
  ));
}

function get_npcs_at_tile(place: Place, tile_x: number, tile_y: number, world_z: number): PlaceNPC[] {
  const npcs = Array.isArray(place?.contents?.npcs_present) ? place.contents.npcs_present : [];
  return npcs.filter((npc) => (
    Math.floor(Number(npc?.tile_position?.x)) === tile_x &&
    Math.floor(Number(npc?.tile_position?.y)) === tile_y &&
    Math.floor(Number(npc?.elevation ?? get_place_base_world_z(place))) === world_z
  ));
}

function summarize_direction(place: Place, slot: number, tile_x: number, tile_y: number, world_z: number): string | null {
  const actors = get_actors_at_tile(place, tile_x, tile_y, world_z);
  const npcs = get_npcs_at_tile(place, tile_x, tile_y, world_z);
  const items = summarize_tile_items(place, slot, tile_x, tile_y, world_z);
  const structures = get_structures_at_tile(place, tile_x, tile_y, world_z);
  const tile = get_place_tile_at_world_z(place, tile_x, tile_y, world_z);
  const pieces: string[] = [];
  if (actors.length > 0) pieces.push(actors.map((a) => title_case_from_ref(a.actor_ref, 'Actor')).join(', '));
  if (npcs.length > 0) pieces.push(npcs.map((n) => {
    const npc_id = String(n.npc_ref ?? '').replace(/^npc\./, '');
    const loaded = load_npc(slot, npc_id);
    return loaded.ok ? String((loaded.npc as any)?.name ?? title_case_from_ref(n.npc_ref, 'Npc')) : title_case_from_ref(n.npc_ref, 'Npc');
  }).join(', '));
  if (items.length > 0) {
    if (items.length === 1) {
      pieces.push(format_tile_item_label(items[0]!));
    } else {
      pieces.push(`${items.length} items`);
    }
  }
  if (structures.length > 0) {
    pieces.push(get_structure_name(structures[0]!));
  }
  if (pieces.length === 0 && tile?.kind) {
    const resolved = resolve_place_tile(String(tile.kind), tile as any);
    if (resolved?.def?.name) pieces.push(resolved.def.name);
  }
  if (pieces.length === 0) return null;
  return pieces.join('; ');
}

function get_actor_display_name(slot: number, actor_ref: string): string {
  const actor_id = String(actor_ref ?? '').replace(/^actor\./, '');
  const loaded = load_actor(slot, actor_id);
  return loaded.ok ? String((loaded.actor as any)?.name ?? title_case_from_ref(actor_ref, 'Actor')) : title_case_from_ref(actor_ref, 'Actor');
}

function get_npc_display_name(slot: number, npc_ref: string): string {
  const npc_id = String(npc_ref ?? '').replace(/^npc\./, '');
  const loaded = load_npc(slot, npc_id);
  return loaded.ok ? String((loaded.npc as any)?.name ?? title_case_from_ref(npc_ref, 'Npc')) : title_case_from_ref(npc_ref, 'Npc');
}

function join_natural(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function summarize_all_place_items(place: Place, slot: number): TileItemSummary[] {
  const summaries: TileItemSummary[] = [];
  const seen = new Set<string>();
  const base_world_z = get_place_base_world_z(place);

  const pushSummary = (summary: TileItemSummary | null): void => {
    if (!summary) return;
    const key = summary.ref || `${summary.name}:${summary.quantity}`;
    if (seen.has(key)) return;
    seen.add(key);
    summaries.push(summary);
  };

  const ground_items = Array.isArray(place?.contents?.items_on_ground) ? place.contents.items_on_ground : [];
  for (const item of ground_items) {
    const name = get_place_item_name(place, slot, item.item_ref);
    const def = load_item_def(slot, extract_item_id(item.item_ref));
    pushSummary({
      ref: String(item.item_ref ?? ''),
      name,
      description: def.ok ? String(def.item.description ?? '') : '',
      quantity: Math.max(1, Number(item.quantity ?? 1) || 1),
    });
  }

  const scattered = (place as any)?.ground?.scattered;
  if (scattered && typeof scattered === 'object') {
    for (const entries of Object.values(scattered as Record<string, InlineItem[]>)) {
      if (!Array.isArray(entries)) continue;
      for (const item of entries) {
        const resolved = resolve_inline_item(String(item?.def_id ?? ''), item);
        pushSummary({
          ref: `item.${String(item?.id ?? '')}`,
          name: String(resolved?.name ?? item?.def_id ?? 'item'),
          description: String(resolved?.def?.description ?? ''),
          quantity: Math.max(1, Number(item?.qty ?? 1) || 1),
        });
      }
    }
  }

  const ground_main = Array.isArray((place as any)?.ground?.main) ? (place as any).ground.main as InlineItem[] : [];
  for (const item of ground_main) {
    const resolved = resolve_inline_item(String(item?.def_id ?? ''), item);
    pushSummary({
      ref: `item.${String(item?.id ?? '')}`,
      name: String(resolved?.name ?? item?.def_id ?? 'item'),
      description: String(resolved?.def?.description ?? ''),
      quantity: Math.max(1, Number(item?.qty ?? 1) || 1),
    });
  }

  const containers = (place as any)?.containers;
  if (containers && typeof containers === 'object') {
    for (const container of Object.values(containers as Record<string, any>)) {
      if (!container || !Array.isArray((container as any).contents)) continue;
      for (const entry of (container as any).contents as any[]) {
        const instance = (entry as any)?.instance;
        const definition = (entry as any)?.definition;
        pushSummary({
          ref: instance?.id ? `item.${String(instance.id)}` : String(definition?.id ?? ''),
          name: String(definition?.name ?? instance?.def_id ?? 'item'),
          description: String(definition?.description ?? ''),
          quantity: Math.max(1, Number(instance?.qty ?? 1) || 1),
        });
      }
    }
  }

  return summaries.filter((item) => item.ref.length > 0 || item.name.length > 0);
}

function summarize_place_tile_composition(place: Place): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  const layers = [place.tiles_z0, place.tiles];
  for (const layer of layers) {
    if (!layer || !Array.isArray(layer.cells)) continue;
    for (const row of layer.cells) {
      if (!Array.isArray(row)) continue;
      for (const cell of row) {
        if (!cell?.kind) continue;
        const resolved = resolve_place_tile(String(cell.kind), cell as any);
        const name = String(resolved?.def?.name ?? title_case_from_ref(String(cell.kind), 'tile'));
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function describe_temperature_offset(offset: number): string | null {
  if (!Number.isFinite(offset) || offset === 0) return null;
  if (offset >= 3) return 'The air carries notable heat.';
  if (offset >= 1) return 'The air runs a little warm.';
  if (offset <= -3) return 'A marked chill sits in the air.';
  if (offset <= -1) return 'The air runs a little cold.';
  return null;
}

function build_place_overview(place: Place, slot: number, inspector_ref: string, adjacent: boolean): {
  short_description: string;
  full_description: string;
  sensory_details: Record<string, string[]>;
  selected_facts: string[];
  features: InspectionFeature[];
  scene_focus: string;
  primary_subject: string;
} {
  const actors = (Array.isArray(place?.contents?.actors_present) ? place.contents.actors_present : [])
    .filter((actor) => String(actor.actor_ref ?? '') !== inspector_ref);
  const npcs = Array.isArray(place?.contents?.npcs_present) ? place.contents.npcs_present : [];
  const items = summarize_all_place_items(place, slot);
  const structures = Array.isArray((place as any)?.structures) ? (place as any).structures as PlaceStructureInstance[] : [];
  const tile_mix = summarize_place_tile_composition(place);
  const actorNames = actors.slice(0, 3).map((actor) => get_actor_display_name(slot, actor.actor_ref));
  const npcNames = npcs.slice(0, 3).map((npc) => get_npc_display_name(slot, npc.npc_ref));
  const peopleNames = [...npcNames, ...actorNames].slice(0, 4);
  const itemNames = items.slice(0, 4).map((item) => format_tile_item_label(item));
  const structureNames = structures.slice(0, 3).map((structure) => get_structure_name(structure));
  const tileNames = tile_mix.slice(0, 3).map((tile) => tile.name.toLowerCase());
  const selected_facts: string[] = [];
  const features: InspectionFeature[] = [];
  const sensory_details: Record<string, string[]> = {};

  if (peopleNames.length > 0) {
    selected_facts.push(
      peopleNames.length === 1
        ? `${peopleNames[0]} is here.`
        : `${join_natural(peopleNames)} are here.`
    );
  }

  if (items.length > 0) {
    selected_facts.push(
      items.length === 1
        ? `${itemNames[0]} lies out in the open.`
        : `Loose items are scattered through the place, including ${join_natural(itemNames.slice(0, Math.min(3, itemNames.length)))}.`
    );
  }

  if (tileNames.length > 0 || structureNames.length > 0) {
    const tilePart = tileNames.length > 0 ? `The place is laid out in ${join_natural(tileNames)}.` : '';
    const structurePart = structureNames.length > 0 ? `${structureNames.length === 1 ? `${structureNames[0]} stands out in the space.` : `${join_natural(structureNames)} stand out in the space.`}` : '';
    selected_facts.push([tilePart, structurePart].filter(Boolean).join(' '));
  }

  const envBits: string[] = [];
  if (place.environment?.lighting) envBits.push(`The light is ${String(place.environment.lighting).toLowerCase()}.`);
  const tempText = describe_temperature_offset(Number(place.environment?.temperature_offset ?? 0));
  if (tempText) envBits.push(tempText);
  if (Array.isArray(place.environment?.cover_available) && place.environment.cover_available.length > 0) {
    envBits.push(`Cover comes from ${join_natural(place.environment.cover_available.slice(0, 3).map((entry) => String(entry).toLowerCase()))}.`);
  }
  if (envBits.length > 0) selected_facts.push(envBits.join(' '));

  if (place.environment?.lighting) sensory_details.light = [`The space sits in ${String(place.environment.lighting).toLowerCase()} light.`];
  if (tempText) sensory_details.touch = [tempText];

  if (peopleNames.length > 0) features.push(create_tag_feature('place:population', 'Present Figures', selected_facts[0] ?? 'People are here.', 'clear'));
  if (items.length > 0) features.push(create_tag_feature('place:items', 'Grounded Items', selected_facts[Math.min(1, selected_facts.length - 1)] ?? 'Loose items are scattered here.', 'clear'));
  if (tileNames.length > 0 || structureNames.length > 0) features.push(create_tag_feature('place:layout', 'Place Composition', [tileNames.length > 0 ? `Tile mix: ${join_natural(tileNames)}.` : '', structureNames.length > 0 ? `Structures: ${join_natural(structureNames)}.` : ''].filter(Boolean).join(' '), 'clear'));

  const short_description = selected_facts[0]
    ?? (adjacent ? 'The connected place opens beyond the boundary.' : 'The place feels sparse and unfinished.');
  const full_description = selected_facts.join('\n\n');
  const scene_focus = peopleNames.length > 0
    ? (items.length > 0 ? 'place_people_items' : 'place_people')
    : items.length > 0
      ? 'place_items'
      : (tileNames.length > 0 || structureNames.length > 0)
        ? 'place_fabric'
        : 'place_environment';
  const primary_subject = selected_facts[0]?.replace(/\.$/, '') || 'the place';

  return { short_description, full_description, sensory_details, selected_facts, features, scene_focus, primary_subject };
}

function build_item_pile_result(target: InspectionTarget, clarity: ClarityLevel, sense_used: SenseType, distance: number, items: TileItemSummary[]): InspectionResult {
  const names = items.slice(0, 3).map((item) => format_tile_item_label(item));
  const short_description = items.length === 1
    ? `${names[0] ?? 'An item'} lies here.`
    : `A pile of ${items.length} items lies here${names.length > 0 ? `, including ${names.join(', ')}` : ''}.`;
  const full_description = clarity === 'clear'
    ? items.slice(0, 3).map((item) => {
        const label = format_tile_item_label(item);
        const description = String(item.description ?? '').trim();
        return description.length > 0 ? `${label}: ${description}` : label;
      }).join('\n\n')
    : '';
  return {
    target,
    success: true,
    clarity,
    sense_used,
    distance,
    requested_features: [],
    random_features: [],
    content: {
      short_description,
      full_description,
      features: [],
      sensory_details: {},
    },
  };
}

function build_place_result(target: InspectionTarget, clarity: ClarityLevel, sense_used: SenseType, distance: number, place: Place, slot: number, inspector_ref = '', adjacent = false): InspectionResult {
  const overview = build_place_overview(place, slot, inspector_ref, adjacent);
  return {
    target,
    success: true,
    clarity,
    sense_used,
    distance,
    requested_features: [],
    random_features: [],
    content: {
      short_description: clarity === 'obscured'
        ? 'The place is there, but it refuses to resolve clearly.'
        : clarity === 'vague'
          ? overview.short_description
          : overview.short_description,
      full_description: clarity === 'clear' ? overview.full_description : '',
      features: clarity === 'clear' ? overview.features : [],
      sensory_details: clarity === 'clear' ? overview.sensory_details : {},
    },
  };
}

async function build_place_narration_context(inspector: InspectorData, target: InspectionTarget, result: InspectionResult): Promise<InspectionResult['narration_context'] | undefined> {
  const slot = Math.max(0, Math.floor(Number(inspector.data_slot ?? 1)));
  const effective_place_id = target.type === 'adjacent_place' ? target.ref : target.place_id;
  if (!effective_place_id) return undefined;
  const place_res = load_place(slot, effective_place_id || '');
  if (!place_res.ok || !place_res.place) return undefined;
  const place = place_res.place as Place;

  if (target.type === 'place' || target.type === 'adjacent_place') {
    const overview = build_place_overview(place, slot, inspector.ref, target.type === 'adjacent_place');
    return {
      actor_pov: inspector.ref,
      primary_subject: overview.primary_subject,
      target_kind: target.type,
      scene_focus: overview.scene_focus,
      selected_facts: overview.selected_facts,
      nearby_facts: [],
      guidance: [
        'Lead with who and what defines the place right now.',
        'Keep the focus on characters first, then loose items, then the place fabric, then the environment.',
        'Do not rely on the place name as description.',
        'Narrate from the inspecting actor\'s point of view.',
      ],
      seed: hash_string(`${effective_place_id}:${(place as any)?.breath_index ?? 0}:place`),
    };
  }

  if (!target.tile_position) return undefined;
  const world_z = Math.floor(Number(target.tile_position.z ?? get_place_base_world_z(place)));
  const tile_x = Math.floor(Number(target.tile_position.x));
  const tile_y = Math.floor(Number(target.tile_position.y));

  const actors = get_actors_at_tile(place, tile_x, tile_y, world_z);
  const npcs = get_npcs_at_tile(place, tile_x, tile_y, world_z);
  const items = summarize_tile_items(place, slot, tile_x, tile_y, world_z);
  const structures = get_structures_at_tile(place, tile_x, tile_y, world_z);
  const tile = get_place_tile_at_world_z(place, tile_x, tile_y, world_z);
  const tile_resolved = tile ? resolve_place_tile(String(tile.kind ?? ''), tile as any) : null;
  const seed = hash_string(`${target.place_id}:${tile_x},${tile_y},${world_z}:${target.type}:${target.ref}:${(place as any)?.breath_index ?? 0}`);
  const facts: InspectFact[] = [];

  const pushFact = (fact: InspectFact): void => {
    if (!fact.text || fact.text.trim().length < 2) return;
    facts.push(fact);
  };

  const actorNames = actors.map((actor) => get_actor_display_name(slot, actor.actor_ref));

  const npcNames = npcs.map((npc) => get_npc_display_name(slot, npc.npc_ref));

  const itemNames = items.map((item) => format_tile_item_label(item));
  const structureNames = structures.map((structure) => get_structure_name(structure));
  const tileTagData = build_tile_tag_inspection_data(slot, Array.isArray(tile_resolved?.effective_tags) ? tile_resolved!.effective_tags : [], result.clarity);

  for (const actor of actors) {
    const name = actorNames[actors.indexOf(actor)] ?? title_case_from_ref(actor.actor_ref, 'Actor');
    pushFact({ id: `actor:${actor.actor_ref}`, text: `${name} stands here${actor.facing ? ` facing ${String(actor.facing).toLowerCase()}` : ''}.`, importance: target.ref === actor.actor_ref ? 100 : 88 });
  }

  for (const npc of npcs) {
    const name = npcNames[npcs.indexOf(npc)] ?? title_case_from_ref(npc.npc_ref, 'Npc');
    pushFact({ id: `npc:${npc.npc_ref}`, text: `${name} is here${npc.activity ? `, ${String(npc.activity).toLowerCase()}` : ''}.`, importance: target.ref === npc.npc_ref ? 98 : 86 });
  }

  if (items.length > 0) {
    if (items.length === 1) {
      const name = itemNames[0] ?? items[0]!.name;
      pushFact({ id: `item:${items[0]!.ref}`, text: `${name} lies here.`, importance: target.ref === items[0]!.ref ? 95 : 82 });
    } else {
      const top_names = itemNames.slice(0, 2);
      pushFact({ id: `itempile:${tile_x},${tile_y},${world_z}`, text: `A small pile of items is scattered here${top_names.length > 0 ? `, including ${top_names.join(' and ')}` : ''}.`, importance: 90 });
    }
  }

  if (structures.length > 0) {
    const structure = structures[0]!;
    const name = structureNames[0] ?? get_structure_name(structure);
    const spans = Array.isArray((structure as any)?.body_model?.physical) && (structure as any).body_model.physical.length > 1;
    pushFact({ id: `structure:${structure.id}`, text: `${name}${spans ? ' spreads across multiple tiles' : ''}.`, importance: target.type === 'tile' ? 92 : 84, mundane: false });
    const tags = Array.isArray((structure as any)?.tags) ? (structure as any).tags.map((t: any) => String(t?.name ?? '').toLowerCase()) : [];
    if (tags.includes('container')) pushFact({ id: `structure-container:${structure.id}`, text: `${name} looks like it can hold things.`, importance: 74 });
    if (tags.includes('block_move')) pushFact({ id: `structure-block:${structure.id}`, text: `${name} blocks passage through this spot.`, importance: 70 });
  }

  if (tile_resolved?.def) {
    pushFact({ id: `tile:${tile_resolved.def.id}`, text: `The ground here is ${tile_resolved.def.name.toLowerCase()}.`, importance: 44, mundane: true });
  }

  if (target.type === 'tile') {
    for (const [index, line] of tileTagData.fact_lines.entries()) {
      pushFact({ id: `tiletag:${index}`, text: line, importance: 78, nearby: false });
    }
  }

  if (items.length > 0 && structures.length > 0) {
    const itemLead = items.length > 1 ? `The pile of ${items.length} items` : `${itemNames[0] ?? 'The item'}`;
    pushFact({ id: `relation:items-structure:${tile_x},${tile_y},${world_z}`, text: `${itemLead} rests against ${structureNames[0] ?? 'the structure'}.`, importance: get_target_priority(target.type) - 4 });
  }

  if ((actors.length > 0 || npcs.length > 0) && items.length > 0) {
    const subject = actorNames[0] ?? npcNames[0] ?? 'Someone';
    const itemLead = items.length > 1 ? `a scatter of ${items.length} items` : `${itemNames[0] ?? 'an item'}`;
    pushFact({ id: `relation:person-item:${tile_x},${tile_y},${world_z}`, text: `${subject} stands over ${itemLead}.`, importance: get_target_priority(target.type) - 2 });
  }

  if ((actors.length > 0 || npcs.length > 0) && structures.length > 0) {
    const subject = actorNames[0] ?? npcNames[0] ?? 'Someone';
    pushFact({ id: `relation:person-structure:${tile_x},${tile_y},${world_z}`, text: `${subject} is framed by ${structureNames[0] ?? 'the structure'}.`, importance: get_target_priority(target.type) - 8, nearby: false });
  }

  const nearby: InspectFact[] = [];
  const directions = [
    { label: 'north', dx: 0, dy: 1 },
    { label: 'east', dx: 1, dy: 0 },
    { label: 'south', dx: 0, dy: -1 },
    { label: 'west', dx: -1, dy: 0 },
  ];
  for (const dir of directions) {
    const summary = summarize_direction(place, slot, tile_x + dir.dx, tile_y + dir.dy, world_z);
    if (!summary) continue;
    nearby.push({ id: `nearby:${dir.label}`, text: `${dir.label}: ${summary}.`, importance: 36, nearby: true });
  }

  const target_specific = facts.filter((fact) => !fact.mundane).sort((a, b) => b.importance - a.importance || a.id.localeCompare(b.id));
  const mustInclude = target_specific.slice(0, 2);
  const optional = seeded_shuffle(target_specific.slice(2), seed).slice(0, 2);
  const nearbySelected = seeded_shuffle(nearby, seed ^ 0x9e3779b9).slice(0, 2);
  const selected = [...mustInclude, ...optional];
  let sceneFocus: string = target.type;
  if ((actors.length > 0 || npcs.length > 0) && items.length > 0) sceneFocus = 'person_with_items';
  else if (items.length > 0 && structures.length > 0) sceneFocus = 'items_by_structure';
  else if (structures.length > 0 && items.length === 0 && actors.length === 0 && npcs.length === 0) sceneFocus = 'structure_surface';

  let primarySubject = result.target.ref || result.target.type;
  if (selected.length > 0) {
    primarySubject = selected[0]!.text.replace(/\.$/, '');
  }

  return {
    actor_pov: inspector.ref,
    primary_subject: primarySubject,
    target_kind: target.type,
    scene_focus: sceneFocus,
    selected_facts: selected.map((fact) => fact.text),
    nearby_facts: nearbySelected.map((fact) => fact.text),
    guidance: [
      'Describe the most interesting subject first.',
      'Treat nearby details as supporting context, not the main point.',
      'Not every fact must be mentioned.',
      'If things seem related, you may naturally connect them without inventing new facts.',
      'Narrate from the inspecting actor\'s point of view.',
    ],
    seed,
  };
}

// Default CR values from tabletop
const DEFAULT_CR = {
  TAKES_CONCENTRATION: 10,
  NOT_EASY: 15,
  VERY_HARD: 20,
};

/**
 * Perform an inspection on a target
 */
export async function inspect_target(
  inspector: InspectorData,
  target: InspectionTarget,
  options: InspectOptions = {}
): Promise<InspectionResult> {
  const max_features = options.max_features ?? 3;
  
  // Calculate distance if target location provided
  let distance = 0;
  if (options.target_location) {
    distance = calculate_distance(inspector.location, options.target_location);
  }

  // Get best sense and clarity
  const sense_result = get_best_inspection_sense(
    distance,
    inspector.senses,
    options.target_size_mag ?? 0
  );

  if (!sense_result || sense_result.clarity === "none") {
    return {
      target,
      success: false,
      clarity: "none",
      sense_used: "light",
      distance,
      requested_features: options.requested_keywords ?? [],
      random_features: [],
      content: {
        short_description: "You cannot perceive the target from here.",
        full_description: "",
        features: [],
        sensory_details: {}
      }
    };
  }

  debug_log("Inspection", `Proceeding with ${target.type} inspection using ${sense_result.sense} (${sense_result.clarity})`);

  let result: InspectionResult;
  switch (target.type) {
    case "structure":
      result = await inspect_structure(inspector, target, sense_result.sense, sense_result.clarity, distance, options);
      break;
    case "tile":
      result = await inspect_tile(inspector, target, sense_result.sense, sense_result.clarity, distance, options);
      break;
    case "character":
    case "npc":
      result = await inspect_character(inspector, target, sense_result.sense, sense_result.clarity, distance, options);
      break;
    case "item":
      result = await inspect_item(inspector, target, sense_result.sense, sense_result.clarity, distance, options);
      break;
    case "item_pile": {
      const slot = Math.max(0, Math.floor(Number(inspector.data_slot ?? 1)));
      const place_res = target.place_id ? load_place(slot, target.place_id) : { ok: false } as any;
      const place = place_res.ok ? place_res.place as Place : null;
      const world_z = Math.floor(Number(target.tile_position?.z ?? (place ? get_place_base_world_z(place) : 0)));
      const items = place && target.tile_position ? summarize_tile_items(place, slot, Math.floor(target.tile_position.x), Math.floor(target.tile_position.y), world_z) : [];
      result = build_item_pile_result(target, sense_result.clarity, sense_result.sense, distance, items);
      break;
    }
    case "place":
    case "adjacent_place": {
      const slot = Math.max(0, Math.floor(Number(inspector.data_slot ?? 1)));
      const place_id = target.type === 'adjacent_place' ? target.ref : (target.place_id ?? target.ref);
      const place_res = place_id ? load_place(slot, place_id) : { ok: false } as any;
      if (!place_res.ok || !place_res.place) {
        result = {
          target,
          success: false,
          clarity: sense_result.clarity,
          sense_used: sense_result.sense,
          distance,
          requested_features: [],
          random_features: [],
          content: { short_description: 'You cannot make out the place clearly.', full_description: '', features: [], sensory_details: {} },
        };
      } else {
        result = build_place_result(target, sense_result.clarity, sense_result.sense, distance, place_res.place as Place, slot, inspector.ref, target.type === 'adjacent_place');
      }
      break;
    }
    default:
      result = {
        target,
        success: false,
        clarity: "none",
        sense_used: sense_result.sense,
        distance,
        requested_features: [],
        random_features: [],
        content: {
          short_description: "Unknown target type.",
          full_description: "",
          features: [],
          sensory_details: {}
        }
      };
      break;
  }

  result.narration_context = await build_place_narration_context(inspector, target, result);
  return result;
}

/**
 * Inspect a tile
 */
async function inspect_tile(
  inspector: InspectorData,
  target: InspectionTarget,
  sense_used: SenseType,
  clarity: ClarityLevel,
  distance: number,
  options: {
    requested_keywords?: string[];
    max_features?: number;
  }
): Promise<InspectionResult> {
  const slot = Math.max(0, Math.floor(Number(inspector.data_slot ?? 1)));
  let tile_id = target.ref;
  let effective_tile_tags: TagInstance[] = [];
  debug_log("Inspection", "inspect_tile.start", {
    target_ref: target.ref,
    place_id: target.place_id ?? null,
    tile_position: target.tile_position ?? null,
    distance,
    sense_used,
    clarity,
  });
  if (target.place_id && target.tile_position) {
    const place_res = load_place(slot, target.place_id);
    if (place_res.ok && place_res.place) {
      const place = place_res.place as Place;
      const world_z = Math.floor(Number(target.tile_position.z ?? get_place_base_world_z(place)));
      const tile_x = Math.floor(Number(target.tile_position.x));
      const tile_y = Math.floor(Number(target.tile_position.y));
      const structures = get_structures_at_tile(place, tile_x, tile_y, world_z);
      if (structures.length > 0) {
        tile_id = String(structures[0]!.def_id ?? tile_id);
        target.ref = tile_id;
        debug_log("Inspection", "inspect_tile.resolved_structure_tile", {
          tile_x,
          tile_y,
          world_z,
          structure_def_id: tile_id,
        });
      } else {
        const tile = get_place_tile_at_world_z(place, tile_x, tile_y, world_z);
        const resolved_kind = get_place_tile_kind_at_world_z(place, tile_x, tile_y, world_z);
        if (resolved_kind) {
          tile_id = String(resolved_kind);
          target.ref = tile_id;
          const resolved_tile = tile ? resolve_place_tile(String(resolved_kind), tile as any) : null;
          effective_tile_tags = Array.isArray(resolved_tile?.effective_tags) ? resolved_tile!.effective_tags : [];
          debug_log("Inspection", "inspect_tile.resolved_place_tile", {
            tile_x,
            tile_y,
            world_z,
            tile_kind: tile_id,
            has_contents: Array.isArray((tile as any)?.contents) ? (tile as any).contents.length : undefined,
          });
        } else {
          debug_log("Inspection", "inspect_tile.no_place_tile_found", {
            tile_x,
            tile_y,
            world_z,
            place_id: target.place_id,
          });
        }
      }
    } else {
      debug_log("Inspection", "inspect_tile.place_load_failed", {
        place_id: target.place_id,
      });
    }
  }

  let tile_result = get_tile_definition(tile_id);

  // Back-compat: some places store terrain as a shorthand ("dirt" vs "dirt_terrain").
  if (!tile_result.ok) {
    const base = tile_id.startsWith("tile.") ? tile_id.slice("tile.".length) : tile_id;
    const candidates: string[] = [];
    if (base !== tile_id) candidates.push(base);
    if (!base.includes("_")) {
      candidates.push(`${base}_terrain`);
      candidates.push(`${base}_floor`);
    }
    // Try common suffixes even when base has underscores.
    candidates.push(`${base}_terrain`);
    candidates.push(`${base}_floor`);

    for (const c of candidates) {
      tile_result = get_tile_definition(c);
      if (tile_result.ok) {
        // mutate target.ref for downstream formatting
        (target as any).ref = c;
        break;
      }
    }
  }

  if (!tile_result.ok) {
    debug_log("Inspection", "inspect_tile.definition_lookup_failed", {
      tile_id,
      target_ref: target.ref,
    });
    if (target.place_id) {
      const place_res = load_place(slot, target.place_id);
      if (place_res.ok && place_res.place) {
        return build_place_result({ ...target, type: 'place', ref: target.place_id }, clarity, sense_used, distance, place_res.place as Place, slot, inspector.ref, false);
      }
    }
    return {
      target,
      success: false,
      clarity,
      sense_used,
      distance,
      requested_features: options.requested_keywords ?? [],
      random_features: [],
      content: {
        short_description: "Unknown terrain.",
        full_description: "",
        features: [],
        sensory_details: {}
      }
    };
  }

  const tile_def = tile_result.tile;
  if (effective_tile_tags.length === 0 && Array.isArray(tile_def.tags)) {
    effective_tile_tags = tile_def.tags as TagInstance[];
  }
  const inspection = tile_def.inspection ?? { short: tile_def.name, full: tile_def.description, features: [] };
  const inspection_features = Array.isArray(inspection.features) ? inspection.features : [];
  const tileTagData = build_tile_tag_inspection_data(slot, effective_tile_tags, clarity);

  debug_log("Inspection", `Found tile definition: ${tile_def.name} (${inspection_features.length} features)`);

  // Filter features based on clarity and sense
  const visible_features = inspection_features.filter((f: TileFeature) => {
    if (get_feature_requires_sense(f) !== sense_used) return false;
    if (clarity === "vague" && f.min_clarity === "clear") return false;
    if (clarity === "obscured" && f.min_clarity !== "obscured") return false;
    return true;
  });

  // Process features - check for hidden ones
  const processed_features: InspectionFeature[] = [];
  let cr_roll_result: { roll: number; total: number; cr: number; success: boolean } | undefined;

  for (const feature of visible_features) {
    let discovered = !feature.hidden;
    
    // Check if hidden feature is discovered
    if (feature.hidden && feature.discovery_cr && clarity !== "obscured") {
      const relevant_prof = feature.relevant_prof ?? "instinct";
      const relevant_stat = feature.relevant_stat ?? "wis";
      
      const prof_bonus = inspector.profs[relevant_prof] ?? 0;
      const stat_bonus = Math.floor(((inspector.stats[relevant_stat] ?? 50) - 50) / 10);
      const roll = Math.floor(Math.random() * 20) + 1;
      const total = roll + prof_bonus + stat_bonus;
      
      discovered = total >= feature.discovery_cr;
      
      if (!cr_roll_result) {
        cr_roll_result = {
          roll,
          total,
          cr: feature.discovery_cr,
          success: discovered
        };
      }
    }

    processed_features.push({
      id: feature.id,
      name: get_feature_name(feature),
      description: get_feature_description(feature),
      discovered,
      hidden: feature.hidden ?? false,
      clarity
    });
  }

  // Select features to show
  const requested: InspectionFeature[] = [];
  const random: InspectionFeature[] = [];

  if (options.requested_keywords && options.requested_keywords.length > 0) {
    // Prioritize requested features
    for (const feature of processed_features) {
      const matches_request = inspection_features.find(
        (f: TileFeature) => f.id === feature.id && get_feature_keywords(f).some((kw: string) => 
          options.requested_keywords?.some(rk => rk.includes(kw) || kw.includes(rk))
        )
      );
      
      if (matches_request && feature.discovered) {
        requested.push(feature);
      } else if (feature.discovered) {
        random.push(feature);
      }
    }
  } else {
    // No specific request - show all discovered
    random.push(...processed_features.filter(f => f.discovered));
  }

  // Limit features
  const limited_random = random.slice(0, Math.max(0, (options.max_features ?? 3) - requested.length));

  // Build sensory details based on clarity
  const sensory_details: Record<string, string[]> = {};
  const sensory = inspection.sensory ?? {};
  if (clarity === "clear") {
    sensory_details.light = sensory.light ?? [];
    sensory_details.pressure = sensory.pressure ?? [];
    sensory_details.aroma = sensory.aroma ?? [];
    sensory_details.touch = sensory.touch ?? [];
  } else if (clarity === "vague") {
    // Only primary sense details
    const sense_key = sense_used === "light" ? "light" : 
                     sense_used === "pressure" ? "pressure" :
                     sense_used === "aroma" ? "aroma" : undefined;
    if (sense_key && sensory[sense_key]) {
      sensory_details[sense_key] = sensory[sense_key] ?? [];
    }
  }

  let short_description = inspection.short ?? tile_def.name;
  let tile_item_descriptions: string[] = [];
  if (target.place_id && target.tile_position) {
    const place_res = load_place(slot, target.place_id);
    if (place_res.ok && place_res.place) {
      const place = place_res.place as Place;
      const world_z = Math.floor(Number(target.tile_position.z ?? get_place_base_world_z(place)));
      const tile_x = Math.floor(Number(target.tile_position.x));
      const tile_y = Math.floor(Number(target.tile_position.y));
      short_description = build_tile_space_short_description(place, slot, tile_x, tile_y, world_z, inspection.short ?? tile_def.name);
      tile_item_descriptions = build_tile_item_description_lines(
        summarize_tile_items(place, slot, tile_x, tile_y, world_z),
        clarity,
      );
    }
  }

  const full_parts = [clarity === "clear" ? (inspection.full ?? tile_def.description) : "", ...tileTagData.detail_lines, ...tile_item_descriptions]
    .map((part) => String(part ?? '').trim())
    .filter((part) => part.length > 0);

  return {
    target,
    success: true,
    clarity,
    sense_used,
    distance,
    requested_features: options.requested_keywords ?? [],
    random_features: [...limited_random, ...tileTagData.features].map(f => f.id),
    content: {
      short_description,
      full_description: full_parts.join("\n\n"),
      features: [...requested, ...limited_random, ...tileTagData.features],
      sensory_details
    },
    cr_roll: cr_roll_result
  };
}

async function inspect_structure(
  inspector: InspectorData,
  target: InspectionTarget,
  sense_used: SenseType,
  clarity: ClarityLevel,
  distance: number,
  options: InspectOptions
): Promise<InspectionResult> {
  const slot = Math.max(0, Math.floor(Number(inspector.data_slot ?? 1)));
  if (!target.place_id) {
    return {
      target,
      success: false,
      clarity,
      sense_used,
      distance,
      requested_features: options.requested_keywords ?? [],
      random_features: [],
      content: {
        short_description: "You cannot make out what structure this is.",
        full_description: "",
        features: [],
        sensory_details: {},
      },
    };
  }

  const place_res = load_place(slot, target.place_id);
  if (!place_res.ok || !place_res.place) {
    return {
      target,
      success: false,
      clarity,
      sense_used,
      distance,
      requested_features: options.requested_keywords ?? [],
      random_features: [],
      content: {
        short_description: "You cannot make out what structure this is.",
        full_description: "",
        features: [],
        sensory_details: {},
      },
    };
  }

  const place = place_res.place as Place;
  const structure = get_structure_by_id(place, target.ref);
  if (!structure) {
    const fallbackTarget: InspectionTarget = { ...target, type: "tile", ref: "__scene__" };
    return inspect_tile(inspector, fallbackTarget, sense_used, clarity, distance, options);
  }

  const structure_name = get_structure_name(structure);
  const resolved = resolve_place_tile(String(structure.def_id ?? ''), get_structure_tile_fallback(structure, place));
  const fallback_tile = get_tile_definition(String(structure.def_id ?? '').replace(/^tile\./, ''));
  const tile_def = resolved?.def ?? (fallback_tile.ok ? fallback_tile.tile : undefined);
  const inspection = tile_def?.inspection ?? {
    short: `${structure_name}.`,
    full: tile_def?.description ?? '',
    features: [],
  };

  const sensory = inspection.sensory ?? {};
  const sensory_details: Record<string, string[]> = {};
  if (clarity === 'clear') {
    sensory_details.light = sensory.light ?? [];
    sensory_details.pressure = sensory.pressure ?? [];
    sensory_details.aroma = sensory.aroma ?? [];
    sensory_details.touch = sensory.touch ?? [];
  }

  const spans = Array.isArray((structure as any)?.body_model?.physical) && (structure as any).body_model.physical.length > 1;
  const extra_lines: string[] = [];
  if (spans) extra_lines.push("It spans multiple tiles.");
  const tags = Array.isArray((structure as any)?.tags) ? (structure as any).tags.map((tag: any) => String(tag?.name ?? '').toLowerCase()) : [];
  if (tags.includes('container')) extra_lines.push("It looks capable of holding things.");
  if (tags.includes('block_move')) extra_lines.push("It blocks easy passage.");

  return {
    target,
    success: true,
    clarity,
    sense_used,
    distance,
    requested_features: options.requested_keywords ?? [],
    random_features: [],
    content: {
      short_description: inspection.short ?? `${structure_name}.`,
      full_description: clarity === 'clear'
        ? [inspection.full ?? tile_def?.description ?? '', ...extra_lines].filter((line) => line.trim().length > 0).join(' ')
        : '',
      features: [],
      sensory_details,
    },
  };
}

/**
 * Inspect a character/NPC
 */
async function inspect_character(
  inspector: InspectorData,
  target: InspectionTarget,
  sense_used: SenseType,
  clarity: ClarityLevel,
  distance: number,
  options: {
    requested_keywords?: string[];
    max_features?: number;
  }
): Promise<InspectionResult> {
  const slot = Math.max(0, Math.floor(Number(inspector.data_slot ?? 1)));
  const is_npc = target.type === 'npc' || target.ref.startsWith('npc.');
  const bare_id = String(target.ref ?? '').replace(/^(npc|actor)\./, '');
  const loaded = is_npc ? load_npc(slot, bare_id) : load_actor(slot, bare_id);
  const entity: any = loaded.ok ? (is_npc ? (loaded as any).npc : (loaded as any).actor) : null;
  const visible_name = String(entity?.name ?? title_case_from_ref(target.ref, is_npc ? 'Npc' : 'Actor'));
  const activity = String(entity?.activity ?? '').trim();
  const short_description = clarity === 'obscured'
    ? `A figure is there, but details are hard to make out.`
    : clarity === 'vague'
      ? `${visible_name} is there, though the details blur together at this distance.`
      : activity
        ? `${visible_name} is here, ${activity.toLowerCase()}.`
        : `${visible_name} is here.`;

  return {
    target,
    success: true,
    clarity,
    sense_used,
    distance,
    requested_features: options.requested_keywords ?? [],
    random_features: [],
    content: {
      short_description,
      full_description: clarity === "clear" ? String(entity?.description ?? '') : "",
      features: [],
      sensory_details: {}
    }
  };
}

/**
 * Inspect an item
 */
async function inspect_item(
  inspector: InspectorData,
  target: InspectionTarget,
  sense_used: SenseType,
  clarity: ClarityLevel,
  distance: number,
  options: {
    requested_keywords?: string[];
    max_features?: number;
  },
  data_slot: number = 1
): Promise<InspectionResult> {
  // Import storage functions
  const { load_item_def } = await import("../item_storage/store.js");
  const { find_item_in_entity_containers } = await import("../container_storage/store.js");

  // Extract item instance ID from target ref
  // Target ref format: "item.<instance_id>" or just "<instance_id>"
  const item_ref = target.ref;
  const instance_id = item_ref.startsWith("item.") ? item_ref.slice(5) : item_ref;

  // Find item in entity containers (entity-centric storage)
  const found_item = find_item_in_entity_containers(data_slot, instance_id);
  const place = target.place_id
    ? (() => {
        const place_res = load_place(data_slot, target.place_id!);
        return place_res.ok ? place_res.place as Place : null;
      })()
    : null;
  const item_data = resolve_item_inspect_data(place, data_slot, item_ref, sense_used, clarity, found_item);
  if (!found_item && !item_data) {
    return {
      target,
      success: false,
      clarity,
      sense_used,
      distance,
      requested_features: options.requested_keywords ?? [],
      random_features: [],
      content: {
        short_description: "You cannot make out what this item is.",
        full_description: "",
        features: [],
        sensory_details: {}
      }
    };
  }

  const item_entry = found_item?.item;
  const instance = item_entry?.instance;
  const definition = item_entry?.definition;
  const resolved_item = item_data ?? {
    ref: item_ref,
    name: String(definition?.name ?? instance?.def_id ?? title_case_from_ref(item_ref, 'item')),
    description: String(definition?.description ?? ''),
    quantity: Math.max(1, Number(instance?.qty ?? 1) || 1),
    effective_tags: Array.isArray(definition?.tags) ? definition.tags as TagInstance[] : [],
    sensory_details: build_item_sensory_details(String(definition?.description ?? ''), sense_used, clarity),
  };
  const itemTagData = build_item_tag_inspection_data(data_slot, resolved_item.effective_tags, clarity);
  
  // Build description based on clarity
  let short_description: string;
  let full_description: string;
  
  if (clarity === "obscured") {
    // Can barely see it
    short_description = "Something lies on the ground, but you cannot make out what it is.";
    full_description = "";
  } else if (clarity === "vague") {
    const item_name = resolved_item.name || "unknown item";
    const vague_shape = definition?.size_mag && definition.size_mag > 2 ? "large" : 
                       definition?.size_mag && definition.size_mag < 1 ? "small" : "medium-sized";
    short_description = `You can make out a ${vague_shape} ${item_name.toLowerCase()} here.`;
    full_description = "";
  } else {
    const item_name = resolved_item.name;
    const qty_text = resolved_item.quantity > 1 ? `${resolved_item.quantity}x ` : "";
    const condition_text = instance?.condition && instance.condition !== "good" ? ` (${instance.condition})` : "";
    
    short_description = `${qty_text}${item_name}${condition_text}`;
    
    let full_desc = resolved_item.description || "A mundane item.";
    if (definition?.weight) {
      const weight_kg = (definition.weight / 1000).toFixed(2);
      full_desc += `\n\nWeight: ${weight_kg}kg`;
    }
    if (itemTagData.detail_lines.length > 0) {
      full_desc += `\n\n${itemTagData.detail_lines.join('\n\n')}`;
    }
    if (resolved_item.quantity > 1) {
      full_desc += `\n\nQuantity: ${resolved_item.quantity}`;
    }
    full_description = full_desc;
  }
  
  return {
    target,
    success: true,
    clarity,
    sense_used,
    distance,
    requested_features: options.requested_keywords ?? [],
    random_features: [],
    content: {
      short_description,
      full_description,
      features: itemTagData.features,
      sensory_details: resolved_item.sensory_details
    }
  };
}

/**
 * Format inspection result for display
 */
export function format_inspection_result(result: InspectionResult): string {
  let output = `INSPECTION RESULT:\n`;
  output += `Target: ${result.target.ref}\n`;
  output += `Clarity: ${result.clarity} (${result.distance.toFixed(1)} tiles away)\n`;
  output += `Sense: ${result.sense_used}\n\n`;
  
  output += `${result.content.short_description}\n\n`;
  
  if (result.content.full_description) {
    output += `${result.content.full_description}\n\n`;
  }
  
  if (result.content.features.length > 0) {
    output += `NOTABLE FEATURES:\n`;
    for (const feature of result.content.features) {
      if (!feature.discovered) continue;
      
      const quality_prefix = feature.clarity === "vague" 
        ? "You vaguely make out: " 
        : "";
      output += `- ${quality_prefix}${feature.description}\n`;
    }
    output += `\n`;
  }
  
  if (Object.keys(result.content.sensory_details).length > 0) {
    output += `SENSORY DETAILS:\n`;
    for (const [sense, details] of Object.entries(result.content.sensory_details)) {
      if (details.length > 0) {
        output += `${sense}: ${details.join(", ")}\n`;
      }
    }
  }
  
  if (result.cr_roll) {
    output += `\n[Discovery Roll: ${result.cr_roll.roll} + bonuses = ${result.cr_roll.total} vs CR ${result.cr_roll.cr} - ${result.cr_roll.success ? "SUCCESS" : "FAILED"}]\n`;
  }
  
  return output;
}
