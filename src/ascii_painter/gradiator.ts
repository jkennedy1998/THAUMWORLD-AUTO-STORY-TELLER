/**
 * Gradiator System for ASCII Art Conversion
 * 
 * Gradiators are user-defined character gradients used to convert
 * images and scale ASCII art. Each gradiator is 1 tile tall and
 * 2-16 tiles wide, mapping from darkest (left) to lightest (right).
 */

import type { CopyData } from './copy_paste.js';

// Default gradiators
export const DEFAULT_GRADIATOR_1 = '#@%+=-:. ';
export const DEFAULT_GRADIATOR_2 = '@%#*+=-:.';
export const DEFAULT_GRADIATOR_3 = '█▓▒░ ';

export const MIN_GRADIATOR_WIDTH = 2;
export const MAX_GRADIATOR_WIDTH = 16;
export const NUM_GRADIATOR_SLOTS = 3;

export type GradiatorSlot = 0 | 1 | 2;

export type GradiatorState = {
  slots: string[];  // 3 slots, each a string of characters
  activeSlot: GradiatorSlot;
  isEditing: boolean;
  editSlot: GradiatorSlot | null;
  editCursorX: number;  // Position within the gradiator being edited
};

/**
 * Create initial gradiator state with defaults
 */
export function createGradiatorState(): GradiatorState {
  return {
    slots: [
      DEFAULT_GRADIATOR_1,
      DEFAULT_GRADIATOR_2,
      DEFAULT_GRADIATOR_3
    ],
    activeSlot: 0,
    isEditing: false,
    editSlot: null,
    editCursorX: 0
  };
}

/**
 * Get the active gradiator string
 */
export function getActiveGradiator(state: GradiatorState): string {
  return state.slots[state.activeSlot]!;
}

/**
 * Set the active gradiator slot
 */
export function setActiveGradiatorSlot(state: GradiatorState, slot: GradiatorSlot): void {
  state.activeSlot = slot;
  // Exit edit mode when switching slots
  state.isEditing = false;
  state.editSlot = null;
  state.editCursorX = 0;
}

/**
 * Start editing a gradiator slot
 */
export function startEditingGradiator(state: GradiatorState, slot: GradiatorSlot): void {
  state.isEditing = true;
  state.editSlot = slot;
  state.editCursorX = 0;
}

/**
 * Stop editing gradiator
 */
export function stopEditingGradiator(state: GradiatorState): void {
  state.isEditing = false;
  state.editSlot = null;
  state.editCursorX = 0;
}

/**
 * Select a specific character position in a gradiator
 */
export function selectGradiatorChar(state: GradiatorState, slot: GradiatorSlot, x: number): void {
  state.isEditing = true;
  state.editSlot = slot;
  const gradiator = state.slots[slot]!;
  state.editCursorX = Math.max(0, Math.min(gradiator.length - 1, x));
}

/**
 * Add a character to the end of a gradiator
 */
export function addGradiatorChar(state: GradiatorState, slot: GradiatorSlot): void {
  const current = state.slots[slot]!;
  if (current.length >= MAX_GRADIATOR_WIDTH) return;
  
  // Add a space character to the end
  state.slots[slot] = current + ' ';
  // Select the new character
  state.isEditing = true;
  state.editSlot = slot;
  state.editCursorX = state.slots[slot]!.length - 1;
}

/**
 * Remove the last character from a gradiator
 */
export function removeGradiatorChar(state: GradiatorState, slot: GradiatorSlot): void {
  const current = state.slots[slot]!;
  if (current.length <= MIN_GRADIATOR_WIDTH) return;
  
  // Remove last character
  state.slots[slot] = current.slice(0, -1);
  // Update cursor if needed
  if (state.editSlot === slot && state.editCursorX >= state.slots[slot]!.length) {
    state.editCursorX = state.slots[slot]!.length - 1;
  }
}

/**
 * Set a character in a gradiator at the specified position
 */
export function setGradiatorChar(state: GradiatorState, slot: GradiatorSlot, x: number, char: string): void {
  if (x < 0 || x >= MAX_GRADIATOR_WIDTH) return;
  
  const current = state.slots[slot]!;
  if (x >= current.length) {
    // Extend the string if needed
    state.slots[slot] = current.padEnd(x + 1, ' ');
  }
  
  // Replace character at position
  const chars = state.slots[slot]!.split('');
  chars[x] = char;
  state.slots[slot] = chars.join('').trimEnd();  // Trim trailing spaces
  
  // Ensure minimum width
  if (state.slots[slot]!.length < MIN_GRADIATOR_WIDTH) {
    state.slots[slot] = state.slots[slot]!.padEnd(MIN_GRADIATOR_WIDTH, ' ');
  }
}

/**
 * Insert a character into a gradiator at the specified position
 */
export function insertGradiatorChar(state: GradiatorState, slot: GradiatorSlot, x: number, char: string): void {
  const current = state.slots[slot]!;
  if (current.length >= MAX_GRADIATOR_WIDTH) return;
  
  const chars = current.split('');
  chars.splice(x, 0, char);
  state.slots[slot] = chars.join('');
}

/**
 * Delete a character from a gradiator at the specified position
 */
export function deleteGradiatorChar(state: GradiatorState, slot: GradiatorSlot, x: number): void {
  const current = state.slots[slot]!;
  if (current.length <= MIN_GRADIATOR_WIDTH) return;
  if (x < 0 || x >= current.length) return;
  
  const chars = current.split('');
  chars.splice(x, 1);
  state.slots[slot] = chars.join('');
}

/**
 * Move cursor within gradiator
 */
export function moveGradiatorCursor(state: GradiatorState, deltaX: number): void {
  if (!state.isEditing || state.editSlot === null) return;
  
  const slotWidth = state.slots[state.editSlot]!.length;
  state.editCursorX = Math.max(0, Math.min(slotWidth - 1, state.editCursorX + deltaX));
}

/**
 * Get character for a given luminance value (0-255) using the active gradiator
 * Maps 0 (darkest) to leftmost character, 255 (lightest) to rightmost
 */
export function getCharFromLuminance(state: GradiatorState, luminance: number): string {
  const gradiator = getActiveGradiator(state);
  if (gradiator.length === 0) return ' ';
  
  const index = Math.floor((luminance / 255) * (gradiator.length - 1));
  return gradiator[Math.min(gradiator.length - 1, Math.max(0, index))]!;
}

/**
 * Scale CopyData using nearest neighbor algorithm
 * @param data - Source CopyData
 * @param scale - Scale factor (0.1 to 3.0, where 1.0 = 100%)
 * @param maxCells - Maximum number of cells to process (for culling)
 * @returns Scaled CopyData
 */
export function scaleCopyData(
  data: CopyData, 
  scale: number, 
  maxCells: number = 10000
): CopyData {
  // Clamp scale to valid range
  scale = Math.max(0.1, Math.min(3.0, scale));
  
  // If scale is 1.0 (100%), return original
  if (scale >= 0.99 && scale <= 1.01) {
    return data;
  }
  
  // Calculate new dimensions
  const newWidth = Math.max(1, Math.round(data.width * scale));
  const newHeight = Math.max(1, Math.round(data.height * scale));
  
  // Check if we need to cull
  const totalCells = newWidth * newHeight;
  if (totalCells > maxCells) {
    console.warn(`Paste preview culled: ${totalCells} cells exceeds limit of ${maxCells}`);
    // Calculate maximum scale that fits within limit
    const maxScale = Math.sqrt(maxCells / (data.width * data.height));
    const clampedScale = Math.min(scale, maxScale);
    return scaleCopyData(data, clampedScale, maxCells);
  }
  
  const cells: (typeof data.cells)[0][number][][] = [];
  
  for (let y = 0; y < newHeight; y++) {
    const row: (typeof data.cells)[0][number][] = [];
    for (let x = 0; x < newWidth; x++) {
      // Map new coordinates back to source using nearest neighbor
      const srcX = Math.min(data.width - 1, Math.floor(x / scale));
      const srcY = Math.min(data.height - 1, Math.floor(y / scale));
      
      const cell = data.cells[srcY]?.[srcX] ?? null;
      row.push(cell);
    }
    cells.push(row);
  }
  
  return {
    width: newWidth,
    height: newHeight,
    cells
  };
}

/**
 * Scale text (raw string) to CopyData using nearest neighbor
 * This converts raw text characters to grid cells with scaling
 */
export function scaleTextToCopyData(
  text: string,
  scale: number,
  maxCells: number = 10000
): CopyData {
  // Clamp scale
  scale = Math.max(0.1, Math.min(3.0, scale));
  
  // Parse text into lines
  const lines = text.split('\n');
  const srcWidth = Math.max(...lines.map(l => l.length));
  const srcHeight = lines.length;
  
  // If scale is 1.0, create CopyData directly without scaling
  if (scale >= 0.99 && scale <= 1.01) {
    const cells: CopyData['cells'] = [];
    for (let y = 0; y < srcHeight; y++) {
      const row: (CopyData['cells'][0][number])[] = [];
      const line = lines[y] ?? '';
      for (let x = 0; x < srcWidth; x++) {
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
    return { width: srcWidth, height: srcHeight, cells };
  }
  
  // Calculate scaled dimensions
  const newWidth = Math.max(1, Math.round(srcWidth * scale));
  const newHeight = Math.max(1, Math.round(srcHeight * scale));
  
  // Check for culling
  const totalCells = newWidth * newHeight;
  if (totalCells > maxCells) {
    console.warn(`Text paste culled: ${totalCells} cells exceeds limit of ${maxCells}`);
    const maxScale = Math.sqrt(maxCells / (srcWidth * srcHeight));
    return scaleTextToCopyData(text, maxScale, maxCells);
  }
  
  const cells: CopyData['cells'] = [];
  
  for (let y = 0; y < newHeight; y++) {
    const row: (CopyData['cells'][0][number])[] = [];
    // Map back to source line
    const srcY = Math.min(srcHeight - 1, Math.floor(y / scale));
    const line = lines[srcY] ?? '';
    
    for (let x = 0; x < newWidth; x++) {
      // Map back to source character
      const srcX = Math.min(line.length - 1, Math.floor(x / scale));
      const char = line[srcX] ?? ' ';
      
      if (char !== ' ' && char !== '\n') {
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
  
  return { width: newWidth, height: newHeight, cells };
}

/**
 * Parse scale percentage to decimal (10-300% -> 0.1-3.0)
 */
export function parseScalePercent(percent: number): number {
  return Math.max(0.1, Math.min(3.0, percent / 100));
}

/**
 * Format scale decimal to percentage string
 */
export function formatScalePercent(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}
