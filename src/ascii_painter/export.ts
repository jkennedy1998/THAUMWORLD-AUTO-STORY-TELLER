/**
 * ASCII Painter Import/Export
 * 
 * Handles saving and loading ASCII art.
 */

import type { Grid, GridExport } from './types.js';
import { exportGrid, importGrid, createGrid } from './types.js';

/**
 * Export grid to JSON string
 */
export function exportToJSON(grid: Grid, filename?: string): string {
  const data = exportGrid(grid, {
    title: filename || 'Untitled',
    description: 'Created with ASCII Painter',
    tags: ['ascii', 'art']
  });
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
 * Export grid to text format (plain ASCII)
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
  
  const grid = createGrid(width, height);
  
  for (let y = 0; y < height; y++) {
    const line = lines[y] || '';
    const row = grid.cells[y];
    if (!row) continue;
    
    for (let x = 0; x < width; x++) {
      const char = line[x] || ' ';
      row[x] = {
        char,
        graphic: undefined,
        appearance_slots: undefined,
        materials: undefined,
        rgb: { r: 255, g: 255, b: 255 },
        weight_index: 2
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
