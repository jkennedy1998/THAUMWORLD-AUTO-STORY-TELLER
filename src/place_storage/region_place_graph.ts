import * as fs from "node:fs";
import * as path from "node:path";
import { get_data_slot_dir } from "../engine/paths.js";
import type { Place } from "../types/place.js";
import { get_places_face_adjacency } from "../shared/place_adjacency.js";
import { get_region_place_index_record, list_region_place_index_records, list_region_ids_in_region_place_index } from "./region_place_index.js";

const INDEX_FILE = "region_place_graph.jsonc";
const SCHEMA_VERSION = 1;

export type RegionPlaceGraphRegion = {
  graph_version: number;
  neighbors: Record<string, string[]>;
};

export type RegionPlaceGraph = {
  schema_version: number;
  generated_at: string;
  regions: Record<string, RegionPlaceGraphRegion>;
};

const graph_cache = new Map<number, RegionPlaceGraph>();

function get_index_path(slot: number): string {
  return path.join(get_data_slot_dir(slot), INDEX_FILE);
}

function ensure_slot_dir(slot: number): void {
  const dir = get_data_slot_dir(slot);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function empty_graph(): RegionPlaceGraph {
  return {
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    regions: {},
  };
}

function clone_graph_region(region: RegionPlaceGraphRegion): RegionPlaceGraphRegion {
  return {
    graph_version: region.graph_version,
    neighbors: Object.fromEntries(
      Object.entries(region.neighbors).map(([place_id, neighbors]) => [place_id, [...neighbors]])
    ),
  };
}

function save_graph(slot: number, graph: RegionPlaceGraph): void {
  ensure_slot_dir(slot);
  graph.generated_at = new Date().toISOString();
  fs.writeFileSync(get_index_path(slot), JSON.stringify(graph, null, 2), "utf-8");
  graph_cache.set(slot, graph);
}

function ensure_graph(slot: number): RegionPlaceGraph {
  const cached = graph_cache.get(slot);
  if (cached) return cached;

  const filePath = get_index_path(slot);
  if (!fs.existsSync(filePath)) {
    const rebuilt = rebuild_region_place_graph(slot);
    graph_cache.set(slot, rebuilt);
    return rebuilt;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as RegionPlaceGraph;
    if (parsed?.schema_version !== SCHEMA_VERSION || !parsed?.regions || typeof parsed.regions !== "object") {
      throw new Error("invalid_graph_structure");
    }
    graph_cache.set(slot, parsed);
    return parsed;
  } catch {
    const rebuilt = rebuild_region_place_graph(slot);
    graph_cache.set(slot, rebuilt);
    return rebuilt;
  }
}

function record_to_stub_place(record: ReturnType<typeof list_region_place_index_records>[number]): Place {
  return {
    schema_version: 2,
    id: record.place_id,
    name: record.place_id,
    region_id: record.region_id,
    breath_index: 0,
    breath_last_processed: 0,
    coordinates: {
      world_tile: { x: 0, y: 0 },
      region_tile: { x: 0, y: 0 },
      elevation: Math.floor(Number(record.bounds.origin.z ?? 0)) || 0,
    },
    tile_grid: {
      width: Math.max(1, Math.floor(Number(record.bounds.size.x ?? 1)) || 1),
      height: Math.max(1, Math.floor(Number(record.bounds.size.y ?? 1)) || 1),
      default_entry: { x: 0, y: 0 },
    },
    region_bounds: JSON.parse(JSON.stringify(record.bounds)),
    place_connectors: [],
    region_connectors: [],
    connections: [],
    environment: {
      lighting: "bright",
      terrain: "dirt",
      cover_available: [],
      temperature_offset: 0,
    },
    contents: {
      npcs_present: [],
      actors_present: [],
      items_on_ground: [],
      features: [],
    },
    structures: [],
    is_public: true,
    is_default: false,
    description: {
      short: record.place_id,
      full: record.place_id,
      sensory: { sight: [], sound: [], smell: [], touch: [] },
    },
  };
}

function build_graph_region(slot: number, region_id: string, prevVersion = 0): RegionPlaceGraphRegion {
  const records = list_region_place_index_records(slot, region_id);
  const stubs = records.map(record_to_stub_place);
  const neighbors: Record<string, string[]> = {};

  for (const rec of records) neighbors[rec.place_id] = [];

  for (let i = 0; i < stubs.length; i += 1) {
    for (let j = i + 1; j < stubs.length; j += 1) {
      const adjacency = get_places_face_adjacency(stubs[i]!, stubs[j]!);
      if (!adjacency) continue;
      neighbors[adjacency.place_a_id] ??= [];
      neighbors[adjacency.place_b_id] ??= [];
      neighbors[adjacency.place_a_id]!.push(adjacency.place_b_id);
      neighbors[adjacency.place_b_id]!.push(adjacency.place_a_id);
    }
  }

  for (const place_id of Object.keys(neighbors)) {
    neighbors[place_id] = [...new Set(neighbors[place_id] ?? [])].sort();
  }

  return {
    graph_version: prevVersion + 1,
    neighbors,
  };
}

export function invalidate_region_place_graph_cache(slot: number): void {
  graph_cache.delete(slot);
}

export function rebuild_region_place_graph(slot: number): RegionPlaceGraph {
  const graph = empty_graph();
  for (const region_id of list_region_ids_in_region_place_index(slot)) {
    graph.regions[region_id] = build_graph_region(slot, region_id, 0);
  }
  save_graph(slot, graph);
  return graph;
}

export function rebuild_region_place_graph_region(slot: number, region_id: string): void {
  const graph = ensure_graph(slot);
  const previous = graph.regions[region_id]?.graph_version ?? 0;
  const records = list_region_place_index_records(slot, region_id);
  if (records.length === 0) {
    delete graph.regions[region_id];
  } else {
    graph.regions[region_id] = build_graph_region(slot, region_id, previous);
  }
  save_graph(slot, graph);
}

export function sync_region_place_graph_for_place(slot: number, place_id: string, previous_region_id?: string | null): void {
  const nextRecord = get_region_place_index_record(slot, place_id);
  const region_ids = new Set<string>();
  if (previous_region_id) region_ids.add(String(previous_region_id));
  if (nextRecord?.region_id) region_ids.add(String(nextRecord.region_id));
  if (region_ids.size === 0) return;
  for (const region_id of region_ids) rebuild_region_place_graph_region(slot, region_id);
}

export function get_region_place_graph_region(slot: number, region_id: string): RegionPlaceGraphRegion | null {
  const graph = ensure_graph(slot);
  const region = graph.regions[region_id];
  return region ? clone_graph_region(region) : null;
}

export function list_adjacent_place_ids_from_graph(slot: number, region_id: string, place_id: string): string[] {
  const region = get_region_place_graph_region(slot, region_id);
  if (!region) return [];
  return [...(region.neighbors[place_id] ?? [])];
}

export function build_connected_region_place_ids_from_graph(slot: number, region_id: string, seed_place_ids: string[], hops_visible: number): { visible_ids: string[]; graph_version: number } {
  const region = get_region_place_graph_region(slot, region_id);
  const neighbors = region?.neighbors ?? {};
  const hops = Math.max(0, Math.floor(Number(hops_visible) || 0));
  const visible = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [];

  for (const id of seed_place_ids) {
    const sid = String(id ?? "").trim();
    if (!sid) continue;
    queue.push({ id: sid, depth: 0 });
  }

  while (queue.length > 0) {
    const next = queue.shift()!;
    if (visible.has(next.id)) continue;
    visible.add(next.id);
    if (next.depth >= hops) continue;
    for (const neighbor of neighbors[next.id] ?? []) {
      if (!visible.has(neighbor)) queue.push({ id: neighbor, depth: next.depth + 1 });
    }
  }

  return {
    visible_ids: Array.from(visible.values()),
    graph_version: region?.graph_version ?? 0,
  };
}
