/**
 * ASCII Painter Save/Export System
 *
 * Handles saving, loading, and exporting ASCII art creations.
 */

import type { Grid, GridExport } from './types.js';
import { exportGrid, importGrid } from './types.js';

/**
 * Export grid to JSON string
 */
export function exportToJSON(grid: Grid, metadata?: GridExport['metadata']): string {
  const data = exportGrid(grid, metadata);
  return JSON.stringify(data, null, 2);
}

/**
 * Import grid from JSON string
 */
export function importFromJSON(json: string): Grid {
  const data = JSON.parse(json) as GridExport;
  return importGrid(data);
}

/**
 * Export grid to plain text format
 */
export function exportToText(grid: Grid): string {
  const lines: string[] = [];

  for (let y = 0; y < grid.height; y++) {
    const row = grid.cells[y];
    if (!row) continue;

    let line = '';
    for (let x = 0; x < grid.width; x++) {
      const cell = row[x];
      line += cell?.char || ' ';
    }
    lines.push(line);
  }

  return lines.join('\n');
}

/**
 * Import grid from text format
 */
export function importFromText(text: string): Grid {
  const lines = text.split('\n');
  const height = lines.length;
  const width = Math.max(...lines.map(line => line.length));

  // Import createGrid synchronously
  const { createGrid } = require('./types.js');
  const grid = createGrid(width, height);

  for (let y = 0; y < height; y++) {
    const line = lines[y] || '';
    const row = grid.cells[y];
    if (!row) continue;

    for (let x = 0; x < width; x++) {
      const char = line[x] || ' ';
      row[x] = {
        char,
        rgb: { r: 255, g: 255, b: 255 },
        weight_index: 4
      };
    }
  }

  return grid;
}

/**
 * Download data as a file
 */
export function downloadFile(content: string, filename: string, mimeType: string = 'text/plain'): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Read file as text
 */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

/**
 * Auto-save key for localStorage
 */
const AUTOSAVE_KEY = 'thaum_ascii_painter_autosave';

/**
 * Save grid to localStorage (auto-save)
 */
export function autoSave(grid: Grid, filename: string = 'untitled'): void {
  try {
    const data = exportToJSON(grid, { title: filename, description: 'Auto-saved', tags: ['autosave'] });
    localStorage.setItem(AUTOSAVE_KEY, data);
  } catch (e) {
    console.warn('Auto-save failed:', e);
  }
}

/**
 * Load auto-saved grid from localStorage
 */
export function loadAutoSave(): Grid | null {
  try {
    const data = localStorage.getItem(AUTOSAVE_KEY);
    if (!data) return null;
    return importFromJSON(data);
  } catch (e) {
    console.warn('Load auto-save failed:', e);
    return null;
  }
}

/**
 * Clear auto-save
 */
export function clearAutoSave(): void {
  localStorage.removeItem(AUTOSAVE_KEY);
}

/**
 * Generate filename with timestamp
 */
export function generateFilename(prefix: string = 'ascii_art', extension: string = 'json'): string {
  const date = new Date();
  const timestamp = date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${prefix}_${timestamp}.${extension}`;
}
