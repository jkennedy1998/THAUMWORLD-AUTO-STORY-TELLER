/**
 * Entity-Centric Migration Script
 *
 * Migrates container data from separate files into NPC/Place entity files.
 * This completes the full entity-centric storage architecture.
 *
 * Usage:
 *   npx tsx src/tools/migrate_to_entity_centric.ts <slot_number> [--dry-run]
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "jsonc-parser";
import type { Container } from "../types/container.js";
import type { Place } from "../types/place.js";

interface MigrationResult {
  container_id: string;
  entity_type: "npc" | "actor" | "place";
  entity_id: string;
  success: boolean;
  error?: string;
}

function read_jsonc(filepath: string): any {
  try {
    const raw = fs.readFileSync(filepath, "utf-8");
    return parse(raw) ?? {};
  } catch (err) {
    console.error(`Failed to read ${filepath}:`, err);
    return null;
  }
}

function write_jsonc(filepath: string, data: any): void {
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), "utf-8");
}

function parse_container_owner(
  container_id: string,
  slot: number
): { type: "npc" | "actor" | "place"; id: string } | null {
  // Parse container IDs like:
  // - container.gunther.leg_left (NPC)
  // - container.henry_actor.hand_left (Actor)
  // - container.place.eden_crossroads_square.ground (Place)

  const parts = container_id.split(".");
  if (parts.length < 3) return null;

  if (parts[1] === "place" && parts[2]) {
    // container.place.<place_id>.<container_name>
    return { type: "place", id: parts[2] };
  }

  // For NPCs and Actors, the format is: container.<entity_id>.<container_name>
  // We need to check if the entity exists in npcs/ or actors/ directory
  const base_dir = `local_data/data_slot_${slot}`;
  const entity_id = parts[1];

  if (!entity_id) return null;

  // Try NPC first
  const npc_path = path.join(base_dir, "npcs", `${entity_id}.jsonc`);
  if (fs.existsSync(npc_path)) {
    return { type: "npc", id: entity_id };
  }

  // Try Actor
  const actor_path = path.join(base_dir, "actors", `${entity_id}.jsonc`);
  if (fs.existsSync(actor_path)) {
    return { type: "actor", id: entity_id };
  }

  return null;
}

function get_container_name(container_id: string): string {
  // Get the last part of the container ID as the name
  const parts = container_id.split(".");
  const name = parts[parts.length - 1];
  return name || "unknown";
}

function migrate_container_to_entity(
  slot: number,
  container_path: string,
  dry_run: boolean
): MigrationResult {
  // Load container
  const container: Container = read_jsonc(container_path);
  if (!container || !container.id) {
    return {
      container_id: path.basename(container_path),
      entity_type: "npc",
      entity_id: "unknown",
      success: false,
      error: "Failed to load container or missing ID"
    };
  }

  // Parse owner from container ID
  const owner = parse_container_owner(container.id, slot);
  if (!owner) {
    return {
      container_id: container.id,
      entity_type: "npc",
      entity_id: "unknown",
      success: false,
      error: `Could not parse owner from container ID: ${container.id}`
    };
  }

  const container_name = get_container_name(container.id);

  // Load the entity file
  const base_dir = `local_data/data_slot_${slot}`;
  let entity_path: string;
  let entity: any;

  if (owner.type === "npc") {
    entity_path = path.join(base_dir, "npcs", `${owner.id}.jsonc`);
  } else if (owner.type === "actor") {
    entity_path = path.join(base_dir, "actors", `${owner.id}.jsonc`);
  } else {
    entity_path = path.join(base_dir, "places", `${owner.id}.jsonc`);
  }

  if (!fs.existsSync(entity_path)) {
    return {
      container_id: container.id,
      entity_type: owner.type,
      entity_id: owner.id,
      success: false,
      error: `Entity file not found: ${entity_path}`
    };
  }

  entity = read_jsonc(entity_path);
  if (!entity) {
    return {
      container_id: container.id,
      entity_type: owner.type,
      entity_id: owner.id,
      success: false,
      error: `Failed to load entity: ${entity_path}`
    };
  }

  // Initialize containers field if not exists
  if (!entity.containers) {
    entity.containers = {};
  }

  // Add container to entity
  entity.containers[container_name] = container;

  if (dry_run) {
    console.log(`  [DRY RUN] Would migrate ${container.id} → ${owner.type}.${owner.id}.containers.${container_name}`);
    return {
      container_id: container.id,
      entity_type: owner.type,
      entity_id: owner.id,
      success: true
    };
  }

  // Save updated entity
  write_jsonc(entity_path, entity);

  console.log(`  ✓ Migrated ${container.id} → ${owner.type}.${owner.id}.containers.${container_name}`);

  return {
    container_id: container.id,
    entity_type: owner.type,
    entity_id: owner.id,
    success: true
  };
}

export function migrate_to_entity_centric(slot: number, dry_run: boolean = false): void {
  const base_dir = `local_data/data_slot_${slot}`;
  const containers_dir = path.join(base_dir, "containers");

  console.log(`\n=== Entity-Centric Migration (Slot ${slot}) ===\n`);

  if (!fs.existsSync(containers_dir)) {
    console.log("No containers directory found. Nothing to migrate.");
    return;
  }

  // Get all container files
  const container_files = fs.readdirSync(containers_dir)
    .filter(f => f.endsWith(".jsonc"))
    .map(f => path.join(containers_dir, f));

  console.log(`Found ${container_files.length} containers to migrate\n`);

  const results: MigrationResult[] = [];
  let success_count = 0;
  let fail_count = 0;

  for (const container_path of container_files) {
    const result = migrate_container_to_entity(slot, container_path, dry_run);
    results.push(result);

    if (result.success) {
      success_count++;
    } else {
      fail_count++;
      console.log(`  ✗ Failed: ${result.error}`);
    }
  }

  console.log(`\n=== Migration Summary ===`);
  console.log(`Total containers: ${container_files.length}`);
  console.log(`Successful: ${success_count}`);
  console.log(`Failed: ${fail_count}`);

  if (!dry_run && fail_count === 0) {
    console.log(`\n✓ All containers migrated successfully!`);
    console.log(`\nNext steps:`);
    console.log(`  1. Test the game to ensure everything works`);
    console.log(`  2. Update API endpoints to read from entity.containers`);
    console.log(`  3. Delete the containers/ directory after verification`);
  }

  if (dry_run) {
    console.log(`\n[DRY RUN] No changes were made.`);
  }
}

// Run migration
const args = process.argv.slice(2);
const slot = parseInt(args[0] || "1", 10);
const dry_run = args.includes("--dry-run");

console.log("Entity-Centric Container Migration");
console.log("===================================\n");

if (dry_run) {
  console.log("Running in DRY RUN mode (no changes will be made)\n");
}

migrate_to_entity_centric(slot, dry_run);
