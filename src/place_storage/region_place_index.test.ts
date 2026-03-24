import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { get_data_slot_dir } from "../engine/paths.js";
import { create_basic_place, delete_place, list_places_in_region, list_region_place_records, load_place, save_place } from "./store.js";
import { invalidate_region_place_index_cache, rebuild_region_place_index } from "./region_place_index.js";

const SLOT = 997;

function cleanup(): void {
  invalidate_region_place_index_cache(SLOT);
  fs.rmSync(get_data_slot_dir(SLOT), { recursive: true, force: true });
}

function sorted(values: string[]): string[] {
  return [...values].sort();
}

function expect_place_ids(region_id: string): string[] {
  const res = list_places_in_region(SLOT, region_id);
  assert.equal(res.ok, true, `expected list_places_in_region(${region_id}) to succeed`);
  if (!res.ok) throw new Error(`failed to list places in ${region_id}`);
  return sorted(res.places);
}

console.log("Testing region place index...");

cleanup();

try {
  create_basic_place(SLOT, "region.alpha", "place_alpha", "Alpha", { width: 4, height: 4 });
  create_basic_place(SLOT, "region.alpha", "place_beta", "Beta", { width: 5, height: 5 });
  create_basic_place(SLOT, "region.bravo", "place_gamma", "Gamma", { width: 6, height: 6 });

  const indexPath = path.join(get_data_slot_dir(SLOT), "region_place_index.jsonc");
  assert.equal(fs.existsSync(indexPath), true, "save_place should create the derived region index");

  assert.deepEqual(expect_place_ids("region.alpha"), ["place_alpha", "place_beta"]);
  assert.deepEqual(expect_place_ids("region.bravo"), ["place_gamma"]);

  const alphaRes = load_place(SLOT, "place_alpha");
  assert.equal(alphaRes.ok, true, "place_alpha should load");
  if (!alphaRes.ok) throw new Error("place_alpha missing");
  assert.ok(alphaRes.place.region_bounds, "place_alpha should have region bounds");
  if (!alphaRes.place.region_bounds) throw new Error("region bounds missing");
  alphaRes.place.region_id = "region.bravo";
  alphaRes.place.region_bounds.origin.x = 11;
  alphaRes.place.region_bounds.origin.y = 7;
  save_place(SLOT, alphaRes.place);

  assert.deepEqual(expect_place_ids("region.alpha"), ["place_beta"]);
  assert.deepEqual(expect_place_ids("region.bravo"), ["place_alpha", "place_gamma"]);

  const bravoRecordsRes = list_region_place_records(SLOT, "region.bravo");
  assert.equal(bravoRecordsRes.ok, true, "region bravo records should load");
  if (!bravoRecordsRes.ok) throw new Error("region bravo records failed");
  const moved = bravoRecordsRes.places.find((rec) => rec.place_id === "place_alpha");
  assert.ok(moved, "moved place should appear in bravo records");
  assert.equal(moved?.bounds.origin.x, 11);
  assert.equal(moved?.bounds.origin.y, 7);

  invalidate_region_place_index_cache(SLOT);
  rebuild_region_place_index(SLOT);

  assert.deepEqual(expect_place_ids("region.alpha"), ["place_beta"]);
  assert.deepEqual(expect_place_ids("region.bravo"), ["place_alpha", "place_gamma"]);

  assert.equal(delete_place(SLOT, "place_beta"), true, "delete_place should succeed");
  assert.deepEqual(expect_place_ids("region.alpha"), []);

  console.log("All region place index tests passed.");
} finally {
  cleanup();
}
