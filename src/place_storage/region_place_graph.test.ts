import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { get_data_slot_dir } from "../engine/paths.js";
import { create_basic_place, delete_place, load_place, save_place } from "./store.js";
import { build_connected_region_place_ids_from_graph, get_region_place_graph_region, invalidate_region_place_graph_cache, list_adjacent_place_ids_from_graph, rebuild_region_place_graph } from "./region_place_graph.js";
import { invalidate_region_place_index_cache } from "./region_place_index.js";

const SLOT = 998;
const REGION = "region.graph";

function cleanup(): void {
  invalidate_region_place_graph_cache(SLOT);
  invalidate_region_place_index_cache(SLOT);
  fs.rmSync(get_data_slot_dir(SLOT), { recursive: true, force: true });
}

function setBounds(place_id: string, origin: { x: number; y: number; z: number }, size = { x: 4, y: 4, z: 1 }): void {
  const res = load_place(SLOT, place_id);
  assert.equal(res.ok, true, `expected ${place_id} to load`);
  if (!res.ok) throw new Error(`missing ${place_id}`);
  assert.ok(res.place.region_bounds, `${place_id} should have region bounds`);
  if (!res.place.region_bounds) throw new Error(`missing bounds for ${place_id}`);
  res.place.region_bounds.origin = { ...origin };
  res.place.region_bounds.size = { ...size };
  res.place.coordinates.elevation = origin.z;
  save_place(SLOT, res.place);
}

console.log("Testing region place graph...");

cleanup();

try {
  create_basic_place(SLOT, REGION, "place_a", "A", { width: 4, height: 4 });
  create_basic_place(SLOT, REGION, "place_b", "B", { width: 4, height: 4 });
  create_basic_place(SLOT, REGION, "place_c", "C", { width: 4, height: 4 });
  create_basic_place(SLOT, REGION, "place_corner", "Corner", { width: 4, height: 4 });

  setBounds("place_a", { x: 0, y: 0, z: 0 });
  setBounds("place_b", { x: 4, y: 0, z: 0 });
  setBounds("place_c", { x: 8, y: 0, z: 0 });
  setBounds("place_corner", { x: 12, y: 4, z: 0 });

  const graphPath = path.join(get_data_slot_dir(SLOT), "region_place_graph.jsonc");
  assert.equal(fs.existsSync(graphPath), true, "saving places should materialize the region graph");

  assert.deepEqual(list_adjacent_place_ids_from_graph(SLOT, REGION, "place_a"), ["place_b"]);
  assert.deepEqual(list_adjacent_place_ids_from_graph(SLOT, REGION, "place_b"), ["place_a", "place_c"]);
  assert.deepEqual(list_adjacent_place_ids_from_graph(SLOT, REGION, "place_c"), ["place_b"]);
  assert.deepEqual(list_adjacent_place_ids_from_graph(SLOT, REGION, "place_corner"), []);
  assert.deepEqual(build_connected_region_place_ids_from_graph(SLOT, REGION, ["place_a"], 0).visible_ids, ["place_a"]);
  assert.deepEqual(build_connected_region_place_ids_from_graph(SLOT, REGION, ["place_a"], 1).visible_ids, ["place_a", "place_b"]);
  assert.deepEqual(build_connected_region_place_ids_from_graph(SLOT, REGION, ["place_a"], 2).visible_ids, ["place_a", "place_b", "place_c"]);

  const initialRegion = get_region_place_graph_region(SLOT, REGION);
  assert.ok(initialRegion, "graph region should exist");
  const initialVersion = initialRegion?.graph_version ?? 0;
  assert.ok(initialVersion > 0, "graph version should be positive");

  const noopSave = load_place(SLOT, "place_a");
  assert.equal(noopSave.ok, true, "place_a should load for noop save");
  if (!noopSave.ok) throw new Error("missing place_a for noop save");
  noopSave.place.name = "A renamed";
  save_place(SLOT, noopSave.place);
  const afterNoopRegion = get_region_place_graph_region(SLOT, REGION);
  assert.equal(afterNoopRegion?.graph_version ?? 0, initialVersion, "graph version should not bump on non-topology save");

  setBounds("place_corner", { x: 4, y: 6, z: 0 });
  assert.deepEqual(list_adjacent_place_ids_from_graph(SLOT, REGION, "place_corner"), []);

  setBounds("place_corner", { x: 0, y: 4, z: 0 });
  assert.deepEqual(list_adjacent_place_ids_from_graph(SLOT, REGION, "place_corner"), ["place_a"]);

  const afterMoveRegion = get_region_place_graph_region(SLOT, REGION);
  assert.ok((afterMoveRegion?.graph_version ?? 0) > initialVersion, "graph version should bump on topology change");

  assert.equal(delete_place(SLOT, "place_b"), true, "delete should succeed");
  assert.deepEqual(list_adjacent_place_ids_from_graph(SLOT, REGION, "place_a"), ["place_corner"]);
  assert.deepEqual(list_adjacent_place_ids_from_graph(SLOT, REGION, "place_c"), []);

  invalidate_region_place_graph_cache(SLOT);
  rebuild_region_place_graph(SLOT);
  assert.deepEqual(list_adjacent_place_ids_from_graph(SLOT, REGION, "place_a"), ["place_corner"]);
  assert.deepEqual(list_adjacent_place_ids_from_graph(SLOT, REGION, "place_c"), []);

  console.log("All region place graph tests passed.");
} finally {
  cleanup();
}
