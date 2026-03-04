/**
 * ASCII Painter Save/Export System
 *
 * Handles saving, loading, and exporting ASCII art creations.
 * Supports both legacy Grid format (v1) and new VoxelSpace format (v2).
 */

import type { Grid, GridExport } from './types.js';
import { exportGrid, importGrid } from './types.js';
import type { VoxelSpace, VoxelSpaceExport } from './voxel_space.js';
import { exportVoxelSpace, importVoxelSpace, gridToVoxelSpace, voxelSpaceToGrid } from './voxel_space.js';

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

// ============================================================================
// VoxelSpace Support (v2 format)
// ============================================================================

/**
 * Export VoxelSpace to JSON string (v2 format)
 */
export function exportVoxelSpaceToJSON(space: VoxelSpace): string {
  const data = exportVoxelSpace(space);
  return JSON.stringify(data, null, 2);
}

/**
 * Import VoxelSpace from JSON string (supports v1 and v2)
 */
export function importVoxelSpaceFromJSON(json: string): VoxelSpace {
  const parsed = JSON.parse(json);
  
  // Detect version
  if (parsed.version === 2 && parsed.type === 'voxel_space') {
    // v2 format - VoxelSpace
    return importVoxelSpace(parsed as VoxelSpaceExport);
  } else if (parsed.version === 1) {
    // v1 format - Legacy Grid, convert to VoxelSpace
    const grid = importGrid(parsed as GridExport);
    return gridToVoxelSpace(grid, 0);
  } else {
    throw new Error(`Unsupported file format version: ${parsed.version}`);
  }
}

/**
 * Export VoxelSpace to plain text (flattens all layers)
 */
export function exportVoxelSpaceToText(space: VoxelSpace): string {
  // Flatten to a single grid and export as text
  const { flattenLayers } = require('./voxel_space.js');
  const flattened = flattenLayers(space);
  const grid = voxelSpaceToGrid(flattened, 0);
  return exportToText(grid);
}

/**
 * Detect if JSON is VoxelSpace (v2) or legacy Grid (v1)
 */
export function detectFileFormat(json: string): 'voxel_space' | 'grid' | 'unknown' {
  try {
    const parsed = JSON.parse(json);
    if (parsed.version === 2 && parsed.type === 'voxel_space') {
      return 'voxel_space';
    } else if (parsed.version === 1) {
      return 'grid';
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Auto-save VoxelSpace to localStorage
 */
export function autoSaveVoxelSpace(space: VoxelSpace, filename: string = 'untitled'): void {
  try {
    const data = exportVoxelSpaceToJSON(space);
    localStorage.setItem(AUTOSAVE_KEY, data);
  } catch (e) {
    console.warn('VoxelSpace auto-save failed:', e);
  }
}

/**
 * Load auto-saved VoxelSpace from localStorage
 * Returns null if no auto-save exists or if it's legacy format
 */
export function loadAutoSaveVoxelSpace(): VoxelSpace | null {
  try {
    const data = localStorage.getItem(AUTOSAVE_KEY);
    if (!data) return null;
    
    const format = detectFileFormat(data);
    if (format === 'voxel_space' || format === 'grid') {
      return importVoxelSpaceFromJSON(data);
    }
    return null;
  } catch (e) {
    console.warn('Load VoxelSpace auto-save failed:', e);
    return null;
  }
}

// Tool properties persistence key
const TOOL_PROPERTIES_KEY = 'thaumworld_ascii_painter_tool_properties';

/**
 * Tool properties that should persist between sessions
 */
export interface ToolProperties {
  // Brush settings
  brush_size: number;
  
  // Text tool settings
  text_spacing: number;
  text_charlead: number;
  text_enterlead: number;
  text_enterspace: number;
  
  // Paste settings
  paste_space_replace: boolean;
  paste_scale: number;
  paste_ignore_space: boolean;
  paste_ignore_color: boolean;
  paste_ignore_color_rgb: { r: number; g: number; b: number };
  paste_ignore_black: boolean;
  paste_ignore_white: boolean;
  
  // Tool assignments
  left_click_tool: string;
  right_click_tool: string;
}

/**
 * Default tool properties
 */
const DEFAULT_TOOL_PROPERTIES: ToolProperties = {
  brush_size: 1,
  text_spacing: 1,
  text_charlead: 0,
  text_enterlead: 1,
  text_enterspace: 0,
  paste_space_replace: true,
  paste_scale: 1.0,
  paste_ignore_space: false,
  paste_ignore_color: false,
  paste_ignore_color_rgb: { r: 255, g: 255, b: 255 },
  paste_ignore_black: false,
  paste_ignore_white: false,
  left_click_tool: 'pencil',
  right_click_tool: 'eraser',
};

/**
 * Save tool properties to localStorage
 */
export function saveToolProperties(props: Partial<ToolProperties>): void {
  try {
    const existing = loadToolProperties();
    const merged = { ...existing, ...props };
    localStorage.setItem(TOOL_PROPERTIES_KEY, JSON.stringify(merged));
  } catch (e) {
    console.warn('Save tool properties failed:', e);
  }
}

/**
 * Load tool properties from localStorage
 */
export function loadToolProperties(): ToolProperties {
  try {
    const data = localStorage.getItem(TOOL_PROPERTIES_KEY);
    if (!data) return DEFAULT_TOOL_PROPERTIES;
    
    const parsed = JSON.parse(data);
    return { ...DEFAULT_TOOL_PROPERTIES, ...parsed };
  } catch (e) {
    console.warn('Load tool properties failed:', e);
    return DEFAULT_TOOL_PROPERTIES;
  }
}

// Camera config persistence key
const CAMERA_CONFIG_KEY = 'thaumworld_ascii_painter_camera_config';

/**
 * Camera configuration properties that should persist between sessions
 */
export interface CameraConfigSaveData {
  calibration?: { x: number; y: number };
  scale_per_layer?: number;
  movement_per_layer?: number;
  base_layer_scale?: number;
  char_spacing_x?: number;
  char_spacing_y?: number;
  parallax_intensity?: number;
  parallax_move_enabled?: boolean;
  parallax_size_enabled?: boolean;
  euler_rotation?: { x: number; y: number; z: number };
  show_all_layers?: boolean;
  mode?: 'straight_ortho' | 'parallax_ortho' | 'rotated_ortho';
  orientation?: 'xy' | 'yz' | 'xz';
  pan_x?: number;
  pan_y?: number;
}

/**
 * Save camera configuration to localStorage
 */
export function saveCameraConfig(config: CameraConfigSaveData): void {
  try {
    const existing = loadCameraConfig();
    const merged = { ...existing, ...config };
    localStorage.setItem(CAMERA_CONFIG_KEY, JSON.stringify(merged));
  } catch (e) {
    console.warn('Save camera config failed:', e);
  }
}

/**
 * Load camera configuration from localStorage
 */
export function loadCameraConfig(): CameraConfigSaveData {
  try {
    const data = localStorage.getItem(CAMERA_CONFIG_KEY);
    if (!data) return {};
    return JSON.parse(data);
  } catch (e) {
    console.warn('Load camera config failed:', e);
    return {};
  }
}

/**
 * Clear camera configuration from localStorage
 * Use this to reset to defaults
 */
export function clearCameraConfig(): void {
  try {
    localStorage.removeItem(CAMERA_CONFIG_KEY);
    console.log('[Camera] Cleared saved config from localStorage');
  } catch (e) {
    console.warn('Clear camera config failed:', e);
  }
}
