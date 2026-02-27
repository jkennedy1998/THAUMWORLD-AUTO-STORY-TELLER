/**
 * Migration Script: Move Scattered Containers to Inline Storage
 * 
 * This script migrates scattered container files from separate JSON files
 * to inline storage in place.containers.
 * 
 * Usage: npx tsx src/tools/migrate_scattered_to_inline.ts <slot_number> [--dry-run]
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "jsonc-parser";
import { load_place, save_place } from "../place_storage/store.js";
import { load_container } from "../container_storage/store.js";

const CONTAINERS_DIR = "containers";

function read_jsonc(file_path: string): Record<string, unknown> | null {
    try {
        const raw = fs.readFileSync(file_path, "utf-8");
        return (parse(raw) as Record<string, unknown>) ?? null;
    } catch {
        return null;
    }
}

interface MigrationResult {
    container_id: string;
    place_id: string;
    status: "migrated" | "already_inline" | "error";
    error?: string;
}

function migrate_scattered_container(
    slot: number,
    container_path: string,
    dry_run: boolean
): MigrationResult {
    const container_id = path.basename(container_path, ".jsonc");
    
    // Parse container ID to extract place_id
    const match = container_id.match(/^container\.place\.(.+)\.scattered_(\d+)_(\d+)$/);
    if (!match) {
        return {
            container_id,
            place_id: "",
            status: "error",
            error: "Invalid scattered container ID format"
        };
    }
    
    const place_id = match[1]!;
    
    // Load the container file
    const container_data = read_jsonc(container_path);
    if (!container_data) {
        return {
            container_id,
            place_id,
            status: "error",
            error: "Failed to read container file"
        };
    }
    
    // Load the place
    const place_result = load_place(slot, place_id);
    if (!place_result.ok) {
        return {
            container_id,
            place_id,
            status: "error",
            error: `Place not found: ${place_result.error}`
        };
    }
    
    const place = place_result.place;
    
    // Ensure place.containers exists
    if (!place.containers) {
        place.containers = {};
    }
    
    const container_name = `scattered_${match[2]}_${match[3]}`;
    
    // Check if already migrated (exists inline)
    if (place.containers[container_name]) {
        return {
            container_id,
            place_id,
            status: "already_inline"
        };
    }
    
    if (dry_run) {
        console.log(`[DRY RUN] Would migrate: ${container_id} -> place.containers["${container_name}"]`);
        return {
            container_id,
            place_id,
            status: "migrated"
        };
    }
    
    // Migrate to inline storage
    place.containers[container_name] = container_data as any;
    
    // Save the place
    try {
        save_place(slot, place);
    } catch (err) {
        return {
            container_id,
            place_id,
            status: "error",
            error: `Failed to save place: ${err}`
        };
    }
    
    // Delete the old container file
    try {
        fs.unlinkSync(container_path);
        console.log(`✅ Migrated and deleted: ${container_id}`);
    } catch (err) {
        console.warn(`⚠️ Migrated but failed to delete file: ${container_id} (${err})`);
    }
    
    return {
        container_id,
        place_id,
        status: "migrated"
    };
}

function migrate_slot(slot: number, dry_run: boolean = false): void {
    const base_dir = `local_data/data_slot_${slot}`;
    const containers_dir = path.join(base_dir, CONTAINERS_DIR);
    
    if (!fs.existsSync(containers_dir)) {
        console.log("No containers directory found. Nothing to migrate.");
        return;
    }
    
    // Find all scattered container files
    const files = fs.readdirSync(containers_dir).filter(f => 
        f.endsWith(".jsonc") && f.includes(".scattered_")
    );
    
    if (files.length === 0) {
        console.log("No scattered containers found to migrate.");
        return;
    }
    
    console.log(`Found ${files.length} scattered container(s) to migrate\n`);
    
    const results: MigrationResult[] = [];
    
    for (const file of files) {
        const container_path = path.join(containers_dir, file);
        const result = migrate_scattered_container(slot, container_path, dry_run);
        results.push(result);
        
        if (result.status === "error") {
            console.error(`❌ ${result.container_id}: ${result.error}`);
        }
    }
    
    // Summary
    const migrated = results.filter(r => r.status === "migrated");
    const already_inline = results.filter(r => r.status === "already_inline");
    const errors = results.filter(r => r.status === "error");
    
    console.log("\n" + "=".repeat(50));
    console.log("Migration Summary:");
    console.log("=".repeat(50));
    console.log(`Total containers: ${results.length}`);
    console.log(`Migrated: ${migrated.length}`);
    console.log(`Already inline: ${already_inline.length}`);
    console.log(`Errors: ${errors.length}`);
    
    if (errors.length > 0) {
        console.log("\nErrors:");
        for (const err of errors) {
            console.log(`  - ${err.container_id}: ${err.error}`);
        }
    }
    
    if (dry_run) {
        console.log("\n[DRY RUN] No changes were made.");
        console.log("Run without --dry-run to apply changes.");
    }
}

// Main execution
const args = process.argv.slice(2);
const slot = parseInt(args[0] || "1", 10);
const dry_run = args.includes("--dry-run");

if (isNaN(slot) || slot <= 0) {
    console.error("Usage: npx tsx src/tools/migrate_scattered_to_inline.ts <slot_number> [--dry-run]");
    process.exit(1);
}

console.log(`Migrating scattered containers for slot ${slot}${dry_run ? " (DRY RUN)" : ""}...\n`);
migrate_slot(slot, dry_run);
