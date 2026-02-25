/**
 * Migration script: Convert container/item storage from reference-based to inline
 * 
 * This script:
 * 1. Reads all existing container files
 * 2. Loads referenced item instances
 * 3. Converts container.contents from ContainerEntry[] to ItemInstance[]
 * 4. Saves updated containers
 * 5. Optionally removes old item_instance files after verification
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "jsonc-parser";

interface ContainerEntry {
    item_instance_id: string;
}

interface ItemInstance {
    id: string;
    def_id: string;
    qty: number;
    condition?: "pristine" | "good" | "worn" | "damaged" | "broken";
    tags: any[];
    container_id: string;
    owner_ref: string;
}

interface Container {
    id: string;
    kind: "actor" | "npc" | "place";
    subtype?: "scattered";
    position?: { x: number; y: number };
    place_id?: string;
    owner_ref: string;
    interaction_range: number;
    capacity?: {
        max_weight?: number;
        max_slots?: number;
    };
    contents: ContainerEntry[] | ItemInstance[];
    tags: any[];
    is_open: boolean;
    is_locked: boolean;
    grid_dimensions: {
        cols: number;
        rows: number;
    };
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

function is_old_format(contents: any[]): boolean {
    if (contents.length === 0) return false;
    // Old format has { item_instance_id: string }
    // New format has { id: string, def_id: string, ... }
    return contents[0] && typeof contents[0].item_instance_id === 'string';
}

function migrate_container(
    container_path: string,
    item_instances_dir: string
): { success: boolean; item_count: number; errors: string[] } {
    const errors: string[] = [];
    
    // Load container
    const container: Container = read_jsonc(container_path);
    if (!container) {
        return { success: false, item_count: 0, errors: [`Failed to load ${container_path}`] };
    }
    
    // Check if already migrated
    if (!is_old_format(container.contents as any[])) {
        console.log(`  Already migrated: ${container.id}`);
        return { success: true, item_count: container.contents.length, errors: [] };
    }
    
    console.log(`  Migrating: ${container.id} (${container.contents.length} items)`);
    
    // Convert contents
    const new_contents: ItemInstance[] = [];
    const old_contents = container.contents as ContainerEntry[];
    
    for (const entry of old_contents) {
        const item_path = path.join(item_instances_dir, `${entry.item_instance_id}.jsonc`);
        
        if (!fs.existsSync(item_path)) {
            errors.push(`Missing item instance: ${entry.item_instance_id}`);
            continue;
        }
        
        const item: ItemInstance = read_jsonc(item_path);
        if (!item) {
            errors.push(`Failed to load item: ${entry.item_instance_id}`);
            continue;
        }
        
        new_contents.push(item);
    }
    
    // Update container
    container.contents = new_contents;
    
    // Save updated container
    write_jsonc(container_path, container);
    
    console.log(`  ✓ Migrated ${new_contents.length}/${old_contents.length} items`);
    
    if (errors.length > 0) {
        console.log(`  ⚠ ${errors.length} errors`);
    }
    
    return { success: errors.length === 0, item_count: new_contents.length, errors };
}

export function migrate_slot(slot: number, dry_run: boolean = false): void {
    const base_dir = `local_data/data_slot_${slot}`;
    const containers_dir = path.join(base_dir, "containers");
    const item_instances_dir = path.join(base_dir, "item_instances");
    
    console.log(`\n=== Migrating Data Slot ${slot} ===\n`);
    
    if (!fs.existsSync(containers_dir)) {
        console.log("No containers directory found.");
        return;
    }
    
    // Get all container files
    const container_files = fs.readdirSync(containers_dir)
        .filter(f => f.endsWith(".jsonc"))
        .map(f => path.join(containers_dir, f));
    
    console.log(`Found ${container_files.length} containers to migrate\n`);
    
    let total_items = 0;
    let total_errors = 0;
    let migrated_count = 0;
    
    for (const container_path of container_files) {
        if (dry_run) {
            console.log(`[DRY RUN] Would migrate: ${path.basename(container_path)}`);
            continue;
        }
        
        const result = migrate_container(container_path, item_instances_dir);
        total_items += result.item_count;
        total_errors += result.errors.length;
        
        if (result.success || result.item_count > 0) {
            migrated_count++;
        }
    }
    
    console.log(`\n=== Migration Complete ===`);
    console.log(`Containers migrated: ${migrated_count}/${container_files.length}`);
    console.log(`Total items: ${total_items}`);
    console.log(`Errors: ${total_errors}`);
    
    if (!dry_run && total_errors === 0) {
        console.log(`\n✓ Migration successful!`);
        console.log(`\nNote: Old item_instance files still exist in:`);
        console.log(`  ${item_instances_dir}`);
        console.log(`\nYou can delete them after verifying the migration worked.`);
    }
}

// Run migration if called directly
const args = process.argv.slice(2);
const slot = parseInt(args[0] || "1", 10);
const dry_run = args.includes("--dry-run");

console.log("Container-Centric Migration Tool");
console.log("================================\n");

if (dry_run) {
    console.log("Running in DRY RUN mode (no changes will be made)\n");
}

migrate_slot(slot, dry_run);
