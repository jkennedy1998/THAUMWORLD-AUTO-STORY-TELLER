#!/usr/bin/env node
/**
 * Verify Container Data Format
 * 
 * Checks all actor and NPC files to ensure container contents use wrapped format
 * Wrapped format: { instance: {...}, definition: {...} }
 * Not wrapped format: { id: "...", def_id: "..." } (missing instance wrapper)
 * 
 * Usage: node dist/tools/verify_container_format.js [slot_number]
 */

import * as fs from "node:fs";
import * as path from "node:path";

const DEFAULT_SLOT = 1;

interface VerificationResult {
    file: string;
    entity_id: string;
    entity_type: string;
    issues: string[];
}

function verifyContainerFormat(slot: number): VerificationResult[] {
    const base_dir = `local_data/data_slot_${slot}`;
    const results: VerificationResult[] = [];
    
    // Check actors
    const actors_dir = path.join(base_dir, "actors");
    if (fs.existsSync(actors_dir)) {
        const actor_files = fs.readdirSync(actors_dir).filter(f => f.endsWith(".jsonc"));
        for (const file of actor_files) {
            const actor_id = file.replace(".jsonc", "");
            const file_path = path.join(actors_dir, file);
            const content = fs.readFileSync(file_path, "utf-8");
            
            try {
                const actor = JSON.parse(content);
                if (actor.containers) {
                    const issues: string[] = [];
                    
                    for (const [container_name, container] of Object.entries(actor.containers as Record<string, any>)) {
                        if (container.contents && Array.isArray(container.contents)) {
                            for (let i = 0; i < container.contents.length; i++) {
                                const entry = container.contents[i];
                                
                                // Check if it's in raw format (has 'id' directly instead of 'instance.id')
                                if (entry.id && !entry.instance) {
                                    issues.push(`Container '${container_name}' item ${i}: Raw format (has 'id' without 'instance' wrapper)`);
                                }
                                
                                // Check if it's missing 'definition'
                                if (entry.instance && !entry.definition) {
                                    issues.push(`Container '${container_name}' item ${i}: Missing 'definition' field`);
                                }
                            }
                        }
                    }
                    
                    if (issues.length > 0) {
                        results.push({
                            file: file_path,
                            entity_id: actor_id,
                            entity_type: "actor",
                            issues
                        });
                    }
                }
            } catch (err) {
                console.error(`Error parsing ${file}:`, err);
            }
        }
    }
    
    // Check NPCs
    const npcs_dir = path.join(base_dir, "npcs");
    if (fs.existsSync(npcs_dir)) {
        const npc_files = fs.readdirSync(npcs_dir).filter(f => f.endsWith(".jsonc"));
        for (const file of npc_files) {
            const npc_id = file.replace(".jsonc", "");
            const file_path = path.join(npcs_dir, file);
            const content = fs.readFileSync(file_path, "utf-8");
            
            try {
                const npc = JSON.parse(content);
                if (npc.containers) {
                    const issues: string[] = [];
                    
                    for (const [container_name, container] of Object.entries(npc.containers as Record<string, any>)) {
                        if (container.contents && Array.isArray(container.contents)) {
                            for (let i = 0; i < container.contents.length; i++) {
                                const entry = container.contents[i];
                                
                                // Check if it's in raw format (has 'id' directly instead of 'instance.id')
                                if (entry.id && !entry.instance) {
                                    issues.push(`Container '${container_name}' item ${i}: Raw format (has 'id' without 'instance' wrapper)`);
                                }
                                
                                // Check if it's missing 'definition'
                                if (entry.instance && !entry.definition) {
                                    issues.push(`Container '${container_name}' item ${i}: Missing 'definition' field`);
                                }
                            }
                        }
                    }
                    
                    if (issues.length > 0) {
                        results.push({
                            file: file_path,
                            entity_id: npc_id,
                            entity_type: "npc",
                            issues
                        });
                    }
                }
            } catch (err) {
                console.error(`Error parsing ${file}:`, err);
            }
        }
    }
    
    return results;
}

function main() {
    const slot = parseInt(process.argv[2] || `${DEFAULT_SLOT}`, 10);
    
    console.log(`\n=== Verifying Container Data Format (Slot ${slot}) ===\n`);
    
    const results = verifyContainerFormat(slot);
    
    if (results.length === 0) {
        console.log("✅ All container data uses correct wrapped format!");
        console.log("\nNo issues found. All container contents have {instance, definition} structure.\n");
        process.exit(0);
    } else {
        console.log(`❌ Found ${results.length} files with format issues:\n`);
        
        for (const result of results) {
            console.log(`File: ${result.file}`);
            console.log(`Entity: ${result.entity_type}.${result.entity_id}`);
            console.log("Issues:");
            for (const issue of result.issues) {
                console.log(`  - ${issue}`);
            }
            console.log();
        }
        
        console.log("\n⚠️  These files need to be converted to wrapped format:");
        console.log("  Old format: { id: '...', def_id: '...', qty: 1, ... }");
        console.log("  New format: { instance: { id: '...', def_id: '...', qty: 1, ... }, definition: { ... } }\n");
        
        process.exit(1);
    }
}

main();
