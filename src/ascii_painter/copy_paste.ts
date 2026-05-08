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

import { clone_appearance_slot_assignments, type Grid, type GridCell } from './types.js';
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

function cloneGridCell(cell: GridCell): GridCell {
  return {
    char: cell.char,
    graphic: cell.graphic ? { ...cell.graphic } : undefined,
    appearance_slots: clone_appearance_slot_assignments(cell.appearance_slots),
    materials: cell.materials ? { ...cell.materials } : undefined,
    rgb: { ...cell.rgb },
    weight_index: cell.weight_index,
    render_index: cell.render_index,
  };
}

// Encode copy data to special format
export function encodeToSpecialFormat(data: CopyData): string {
  const lines: string[] = [];
  
  // Header with dimensions
  lines.push(`THAUM:${data.width}x${data.height}`);
  
  // Encode characters
  const charLines: string[] = [];
  let nonSpaceCount = 0;
  for (let y = 0; y < data.height; y++) {
    let line = '';
    for (let x = 0; x < data.width; x++) {
      const cell = data.cells[y]?.[x];
      const char = cell?.char ?? ' ';
      if (char !== ' ') nonSpaceCount++;
      line += char;
    }
    charLines.push(line);
  }
  lines.push('TEXT:');
  lines.push(...charLines);
  
  console.log(`ENCODE: ${nonSpaceCount} non-space characters encoded. First row: "${charLines[0]?.substring(0, 20)}"`);
  
  // Encode weights as numbers
  const weightLines: string[] = [];
  for (let y = 0; y < data.height; y++) {
    let line = '';
    for (let x = 0; x < data.width; x++) {
      const cell = data.cells[y]?.[x];
      const weight = cell?.weight_index ?? 0;
      // Encode weight 0-3 as characters
      line += String.fromCharCode(48 + weight); // '0' to '3'
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

  const payloadRows = data.cells.map((row) => row.map((cell) => cell ? cloneGridCell(cell) : null));
  lines.push('PAYLOAD:');
  lines.push(JSON.stringify(payloadRows));
  
  return lines.join('\n');
}

// Decode special format back to copy data
export function decodeFromSpecialFormat(encoded: string): CopyData | null {
  try {
    const lines = encoded.split(/\r?\n/);
    let lineIndex = 0;
    
    // Parse header
    const headerMatch = lines[lineIndex]?.match(/THAUM:(\d+)x(\d+)/);
    if (!headerMatch) {
      console.log('DECODE: No header match, returning null');
      return null;
    }
    const width = parseInt(headerMatch[1]!);
    const height = parseInt(headerMatch[2]!);
    lineIndex++;
    
    console.log(`DECODE: Header parsed - ${width}x${height}, ${lines.length} lines total`);
    
    const cells: (GridCell | null)[][] = Array.from({ length: height }, () => 
      Array(width).fill(null)
    );
    
    let textCellsCreated = 0;
    let weightCellsUpdated = 0;
    let colorCellsUpdated = 0;
    let whiteCellsFound = 0;
    
    // Parse TEXT section
    if (lines[lineIndex]?.trim() === 'TEXT:') {
      lineIndex++;
      for (let y = 0; y < height && lineIndex < lines.length; y++) {
        const line = lines[lineIndex] ?? '';
        for (let x = 0; x < width && x < line.length; x++) {
          const char = line[x] ?? ' ';
          // Only create cells for non-space characters
          // Space characters represent empty/null cells in the original grid
          // and should remain null so paste doesn't clear the target
          if (char !== ' ') {
            if (!cells[y]![x]) {
              cells[y]![x] = { char, graphic: undefined, appearance_slots: undefined, materials: undefined, rgb: { r: 255, g: 255, b: 255 }, weight_index: 1 };
              textCellsCreated++;
            } else {
              cells[y]![x]!.char = char;
            }
          }
        }
        lineIndex++;
      }
    }
    console.log(`DECODE: TEXT section - ${textCellsCreated} cells created`);
    
    // Parse WEIGHT section
    if (lines[lineIndex]?.trim() === 'WEIGHT:') {
      lineIndex++;
      for (let y = 0; y < height && lineIndex < lines.length; y++) {
        const line = lines[lineIndex] ?? '';
        for (let x = 0; x < width && x < line.length; x++) {
          const weightChar = line[x];
          if (weightChar && weightChar >= '0' && weightChar <= '3') {
            // Only update existing cells - don't create new ones
            // If TEXT didn't create a cell here, it means it was empty in the original
            if (cells[y]![x]) {
              cells[y]![x]!.weight_index = parseInt(weightChar);
              weightCellsUpdated++;
            }
          }
        }
        lineIndex++;
      }
    }
    console.log(`DECODE: WEIGHT section - ${weightCellsUpdated} cells updated`);
    
    // Parse COLOR section
    if (lines[lineIndex]?.trim() === 'COLOR:') {
      lineIndex++;
      for (let y = 0; y < height && lineIndex < lines.length; y++) {
        const line = lines[lineIndex] ?? '';
        for (let x = 0; x < width && x * 3 + 2 < line.length; x++) {
          const rChar = line[x * 3] ?? ' ';
          const gChar = line[x * 3 + 1] ?? ' ';
          const bChar = line[x * 3 + 2] ?? ' ';
          
          // Only update existing cells - don't create new ones
          // If TEXT didn't create a cell here, it means it was empty in the original
          if (cells[y]![x] && (rChar !== ' ' || gChar !== ' ' || bChar !== ' ')) {
            const r = Math.min(255, decodeByte(rChar) * 4);
            const g = Math.min(255, decodeByte(gChar) * 4);
            const b = Math.min(255, decodeByte(bChar) * 4);
            cells[y]![x]!.rgb = { r, g, b };
            colorCellsUpdated++;
            
            // Track white cells
            if (r === 255 && g === 255 && b === 255) {
              whiteCellsFound++;
              if (whiteCellsFound <= 3) {
                console.log(`DECODE: White cell found at (${x},${y}), char='${cells[y]![x]!.char}'`);
              }
            }
          }
        }
        lineIndex++;
      }
    }
    console.log(`DECODE: COLOR section - ${colorCellsUpdated} cells updated, ${whiteCellsFound} white cells`);
    
    if (lines[lineIndex]?.trim() === 'PAYLOAD:') {
      lineIndex++;
      const payloadLine = lines[lineIndex] ?? '';
      try {
        const payloadRows = JSON.parse(payloadLine) as unknown;
        if (Array.isArray(payloadRows)) {
          for (let y = 0; y < height; y++) {
            const row = Array.isArray(payloadRows[y]) ? payloadRows[y] as unknown[] : [];
            for (let x = 0; x < width; x++) {
              const value = row[x];
              if (!value || typeof value !== 'object') continue;
              const maybe = value as Record<string, any>;
              cells[y]![x] = {
                char: typeof maybe.char === 'string' && maybe.char.length > 0 ? maybe.char[0] : ' ',
                graphic: maybe.graphic && typeof maybe.graphic === 'object' ? { ...maybe.graphic } : undefined,
                appearance_slots: clone_appearance_slot_assignments(maybe.appearance_slots),
                materials: maybe.materials && typeof maybe.materials === 'object' ? { ...maybe.materials } : undefined,
                rgb: maybe.rgb && typeof maybe.rgb === 'object'
                  ? { r: Number(maybe.rgb.r) || 0, g: Number(maybe.rgb.g) || 0, b: Number(maybe.rgb.b) || 0 }
                  : { r: 255, g: 255, b: 255 },
                weight_index: typeof maybe.weight_index === 'number' ? maybe.weight_index : 1,
                render_index: typeof maybe.render_index === 'number' ? maybe.render_index : undefined,
              };
            }
          }
        }
      } catch (e) {
        console.warn('DECODE: failed to parse PAYLOAD section, falling back to legacy sections', e);
      }
    }

    // Debug: Show first few cells
    for (let y = 0; y < Math.min(2, height); y++) {
      let row = '';
      for (let x = 0; x < Math.min(10, width); x++) {
        const cell = cells[y]![x];
        row += cell ? cell.char : '?';
      }
      console.log(`DECODE: Row ${y} preview: "${row}"`);
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
  let nonNullCount = 0;
  let whiteCellCount = 0;
  
  for (let y = bounds.y; y < bounds.y + bounds.height; y++) {
    const row: (GridCell | null)[] = [];
    for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
      if (isSelected(selection, x, y)) {
        const cell = grid.cells[y]?.[x];
        if (cell) {
          nonNullCount++;
          // Check for white cells (RGB 255,255,255)
          if (cell.rgb.r === 255 && cell.rgb.g === 255 && cell.rgb.b === 255) {
            whiteCellCount++;
            console.log(`COPY: Found white cell at (${x},${y}) char='${cell.char}', weight=${cell.weight_index}`);
          }
          row.push(cloneGridCell(cell));
        } else {
          row.push(null);
        }
      } else {
        row.push(null);
      }
    }
    cells.push(row);
  }
  
  console.log(`COPY: Extracted ${nonNullCount} cells total, ${whiteCellCount} are white-colored. Grid: ${bounds.width}x${bounds.height}`);
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
          graphic: undefined,
          appearance_slots: undefined,
          materials: undefined,
          rgb: { r: 255, g: 255, b: 255 },
          weight_index: 1
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
      const isSpace = !cell || (cell.char === ' ' && !cell.graphic);
      
      if (cell && !isSpace) {
        // Non-space cell: always place it
        grid.cells[targetY]![targetX] = cloneGridCell(cell);
        placed++;
      } else if (isSpace) {
        // Space cell: handle based on spaceReplace setting
        if (spaceReplace) {
          // Replace mode: clear the cell with a space
          grid.cells[targetY]![targetX] = {
            char: ' ',
            graphic: undefined,
            appearance_slots: undefined,
            materials: undefined,
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
