#!/usr/bin/env node
/**
 * Remove grid_dimensions from all JSONC files
 */

import * as fs from "node:fs";
import * as path from "node:path";

const DATA_DIR = "local_data/data_slot_1";

function removeGridDimensions(filePath: string): void {
    let content = fs.readFileSync(filePath, "utf-8");
    
    // Pattern to match grid_dimensions with its object
    // Handles both with and without trailing comma
    const pattern = /,?\s*"grid_dimensions":\s*\{[^}]+\}/g;
    
    const originalContent = content;
    content = content.replace(pattern, "");
    
    if (content !== originalContent) {
        fs.writeFileSync(filePath, content);
        console.log(`✓ Removed grid_dimensions from: ${filePath}`);
    }
}

function processDirectory(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
            processDirectory(fullPath);
        } else if (entry.name.endsWith(".jsonc")) {
            removeGridDimensions(fullPath);
        }
    }
}

console.log("Removing grid_dimensions from all JSONC files...\n");
processDirectory(DATA_DIR);
console.log("\n✅ Done!");
