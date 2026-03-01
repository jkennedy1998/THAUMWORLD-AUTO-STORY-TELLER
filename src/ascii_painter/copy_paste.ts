/**
 * ASCII Painter Copy/Paste System
 * 
 * Handles copying and pasting with preservation of:
 * - Characters
 * - Colors (using indexed color system)
 * - Font weights
 * 
 * Supports two formats:
 * 1. Raw text - simple characters, newlines for rows
 * 2. Special encoded format - preserves all attributes using character encoding
 */

import type { Grid, GridCell } from './types.js';
import type { SelectionBitmap } from './selection.js';

// ASCII art for encoding (using extended ASCII range for data storage)
const ENCODING_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=!@#$%^&*()_[]{}|;:,.<>?';

export type CopyData = {
  width: number;
  height: number;
  cells: (GridCell | null)[][];
};

export type EncodedData = {
  text: string;      // Character layer
  weights: string;   // Weight layer
  colors: string;    // Color layer (using indexed colors + extended encoding)
  width: number;
  height: number;
};

// Encode copy data to special format
export function encodeToSpecialFormat(data: CopyData): string {
  const lines: string[] = [];
  
  // Header with dimensions
  lines.push(`THAUM:${data.width}x${data.height}`);
  
  // Encode characters
  const charLines: string[] = [];
  for (let y = 0; y < data.height; y++) {
    let line = '';
    for (let x = 0; x < data.width; x++) {
      const cell = data.cells[y]?.[x];
      line += cell?.char ?? ' ';
    }
    charLines.push(line);
  }
  lines.push('TEXT:');
  lines.push(...charLines);
  
  // Encode weights as numbers
  const weightLines: string[] = [];
  for (let y = 0; y < data.height; y++) {
    let line = '';
    for (let x = 0; x < data.width; x++) {
      const cell = data.cells[y]?.[x];
      const weight = cell?.weight_index ?? 0;
      // Encode weight 0-7 as characters
      line += String.fromCharCode(48 + weight); // '0' to '7'
    }
    weightLines.push(line);
  }
  lines.push('WEIGHT:');
  lines.push(...weightLines);
  
  // Encode colors using indexed color system
  // We'll use a separate encoding table for the 100+ colors
  const colorLines: string[] = [];
  for (let y = 0; y < data.height; y++) {
    let line = '';
    for (let x = 0; x < data.width; x++) {
      const cell = data.cells[y]?.[x];
      if (cell && cell.rgb) {
        // Encode RGB to a compact format
        // Use 3 characters to encode RGB (base64-ish)
        const r = Math.floor(cell.rgb.r / 4); // 0-63
        const g = Math.floor(cell.rgb.g / 4); // 0-63
        const b = Math.floor(cell.rgb.b / 4); // 0-63
        line += encodeByte(r) + encodeByte(g) + encodeByte(b);
      } else {
        line += '   '; // 3 spaces for empty
      }
    }
    colorLines.push(line);
  }
  lines.push('COLOR:');
  lines.push(...colorLines);
  
  return lines.join('\n');
}

// Decode special format back to copy data
export function decodeFromSpecialFormat(encoded: string): CopyData | null {
  try {
    const lines = encoded.split('\n');
    let lineIndex = 0;
    
    // Parse header
    const headerMatch = lines[lineIndex]?.match(/THAUM:(\d+)x(\d+)/);
    if (!headerMatch) return null;
    const width = parseInt(headerMatch[1]!);
    const height = parseInt(headerMatch[2]!);
    lineIndex++;
    
    const cells: (GridCell | null)[][] = Array.from({ length: height }, () => 
      Array(width).fill(null)
    );
    
    // Parse TEXT section
    if (lines[lineIndex] === 'TEXT:') {
      lineIndex++;
      for (let y = 0; y < height && lineIndex < lines.length; y++) {
        const line = lines[lineIndex] ?? '';
        for (let x = 0; x < width && x < line.length; x++) {
          const char = line[x] ?? ' ';
          // Always create a cell for every position, even for spaces
          // This ensures WEIGHT and COLOR sections update existing cells
          // instead of creating placeholder cells with wrong char values
          if (!cells[y]![x]) {
            cells[y]![x] = { char, rgb: { r: 255, g: 255, b: 255 }, weight_index: 4 };
          } else {
            cells[y]![x]!.char = char;
          }
        }
        lineIndex++;
      }
    }
    
    // Parse WEIGHT section
    if (lines[lineIndex] === 'WEIGHT:') {
      lineIndex++;
      for (let y = 0; y < height && lineIndex < lines.length; y++) {
        const line = lines[lineIndex] ?? '';
        for (let x = 0; x < width && x < line.length; x++) {
          const weightChar = line[x];
          if (weightChar && weightChar >= '0' && weightChar <= '7') {
            // Only update existing cells - don't create placeholder cells
            // The TEXT section should have already created all cells
            if (cells[y]![x]) {
              cells[y]![x]!.weight_index = parseInt(weightChar);
            }
          }
        }
        lineIndex++;
      }
    }
    
    // Parse COLOR section
    if (lines[lineIndex] === 'COLOR:') {
      lineIndex++;
      for (let y = 0; y < height && lineIndex < lines.length; y++) {
        const line = lines[lineIndex] ?? '';
        for (let x = 0; x < width && x * 3 + 2 < line.length; x++) {
          const rChar = line[x * 3] ?? ' ';
          const gChar = line[x * 3 + 1] ?? ' ';
          const bChar = line[x * 3 + 2] ?? ' ';
          
          if (rChar !== ' ' || gChar !== ' ' || bChar !== ' ') {
            const r = Math.min(255, decodeByte(rChar) * 4);
            const g = Math.min(255, decodeByte(gChar) * 4);
            const b = Math.min(255, decodeByte(bChar) * 4);
            
            if (!cells[y]![x]) {
              cells[y]![x] = { char: ' ', rgb: { r, g, b }, weight_index: 4 };
            } else {
              cells[y]![x]!.rgb = { r, g, b };
            }
          }
        }
        lineIndex++;
      }
    }
    
    return { width, height, cells };
  } catch (e) {
    console.error('Failed to decode special format:', e);
    return null;
  }
}

// Encode a byte (0-63) to a character
function encodeByte(n: number): string {
  if (n < 0) n = 0;
  if (n > 63) n = 63;
  return ENCODING_CHARS[n] ?? ' ';
}

// Decode a character back to a byte (0-63)
function decodeByte(c: string): number {
  const index = ENCODING_CHARS.indexOf(c);
  return index >= 0 ? index : 0;
}

// Extract grid cells based on selection
export function copyFromGrid(grid: Grid, selection: SelectionBitmap): CopyData | null {
  const bounds = getSelectionBounds(selection);
  if (!bounds) return null;
  
  const cells: (GridCell | null)[][] = [];
  
  for (let y = bounds.y; y < bounds.y + bounds.height; y++) {
    const row: (GridCell | null)[] = [];
    for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
      if (isSelected(selection, x, y)) {
        const cell = grid.cells[y]?.[x];
        row.push(cell ? { ...cell } : null);
      } else {
        row.push(null);
      }
    }
    cells.push(row);
  }
  
  return { width: bounds.width, height: bounds.height, cells };
}

// Convert raw text to copy data (no colors/weights preserved)
export function textToCopyData(text: string): CopyData {
  const lines = text.split('\n');
  const height = lines.length;
  const width = Math.max(...lines.map(l => l.length));
  
  const cells: (GridCell | null)[][] = [];
  
  for (let y = 0; y < height; y++) {
    const row: (GridCell | null)[] = [];
    const line = lines[y] ?? '';
    for (let x = 0; x < width; x++) {
      const char = line[x] ?? ' ';
      if (char !== ' ') {
        row.push({
          char,
          rgb: { r: 255, g: 255, b: 255 },
          weight_index: 4
        });
      } else {
        row.push(null);
      }
    }
    cells.push(row);
  }
  
  return { width, height, cells };
}

// Convert copy data to raw text (for plain text export)
export function copyDataToText(data: CopyData): string {
  return data.cells.map(row => 
    row.map(cell => cell?.char ?? ' ').join('')
  ).join('\n');
}

// Import functions from selection module
import { isSelected, getSelectionBounds } from './selection.js';

// Paste data into grid at specified position
export function pasteToGrid(
  grid: Grid,
  data: CopyData,
  startX: number,
  startY: number,
  spaceReplace: boolean
): void {
  console.log('pasteToGrid called with spaceReplace:', spaceReplace);
  let placed = 0;
  let preserved = 0;
  let cleared = 0;
  let skipped = 0;
  
  for (let y = 0; y < data.height; y++) {
    for (let x = 0; x < data.width; x++) {
      const cell = data.cells[y]?.[x];
      const targetX = startX + x;
      const targetY = startY + y;
      
      // Check bounds
      if (targetX < 0 || targetX >= grid.width || targetY < 0 || targetY >= grid.height) {
        continue;
      }
      
      // Check if this is a space/empty cell
      const isSpace = !cell || cell.char === ' ';
      
      if (cell && !isSpace) {
        // Non-space cell: always place it
        grid.cells[targetY]![targetX] = { ...cell };
        placed++;
      } else if (isSpace) {
        // Space cell: handle based on spaceReplace setting
        if (spaceReplace) {
          // Replace mode: clear the cell with a space
          grid.cells[targetY]![targetX] = {
            char: ' ',
            rgb: { r: 0, g: 0, b: 0 },
            weight_index: 0
          };
          cleared++;
        } else {
          // Preserve mode: skip this cell entirely, leave existing content
          skipped++;
        }
      }
    }
  }
  
  console.log(`Paste complete: ${placed} placed, ${skipped} skipped (preserved), ${cleared} cleared`);
}
