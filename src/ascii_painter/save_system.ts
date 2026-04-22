/**
 * ASCII Painter Save/Export System
 *
 * Handles saving, loading, and exporting ASCII art creations.
 * Supports legacy Grid format (v1), VoxelSpace format (v2), and painter documents (v3).
 */

import type { Grid, GridExport } from './types.js';
import { exportGrid, importGrid } from './types.js';
import type { VoxelSpace, VoxelSpaceExport } from './voxel_space.js';
import { exportVoxelSpace, importVoxelSpace, gridToVoxelSpace, voxelSpaceToGrid } from './voxel_space.js';
import type { PainterDocument } from './painter_document.js';
import { clone_painter_document } from './painter_document.js';
import type { ToolType } from './types.js';
import { clamp_weight_index } from '../mono_ui/weight_system.js';
import { ALL_EDIT_CHANNELS, sanitize_edit_channels, type EditChannels } from './edit_mask.js';

const VALID_TOOL_TYPES: readonly ToolType[] = ['pencil', 'eraser', 'line', 'rect_stroke', 'rect_fill', 'bucket', 'eyedropper', 'text', 'selectangle', 'lassoselect', 'copy', 'paste'] as const;

function clamp_integer(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? Math.trunc(value) : fallback;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function clamp_number(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : fallback;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function sanitize_char(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value[0]! : fallback;
}

function sanitize_rgb(value: unknown, fallback: { r: number; g: number; b: number }): { r: number; g: number; b: number } {
  const rgb = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    r: clamp_integer(rgb.r, fallback.r, 0, 255),
    g: clamp_integer(rgb.g, fallback.g, 0, 255),
    b: clamp_integer(rgb.b, fallback.b, 0, 255),
  };
}

function sanitize_tool_type(value: unknown, fallback: ToolType): ToolType {
  if (value === 'weighter' || value === 'colorer') return 'pencil';
  return typeof value === 'string' && (VALID_TOOL_TYPES as readonly string[]).includes(value) ? value as ToolType : fallback;
}

function sanitize_boolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

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
        weight_index: 1
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
 * Export VoxelSpace artwork only (no camera/UI state)
 */
export function exportVoxelSpaceArtworkToJSON(space: VoxelSpace): string {
  const data = exportVoxelSpace(space) as any;
  // Camera is persisted separately via saveCameraConfig(); don't bake it into art exports.
  delete data.camera;
  return JSON.stringify(data, null, 2);
}

export function exportPainterDocumentToJSON(document: PainterDocument): string {
  return JSON.stringify(clone_painter_document(document), null, 2);
}

export function importPainterDocumentFromJSON(json: string): PainterDocument {
  const parsed = JSON.parse(json);
  if (!parsed || parsed.version !== 3 || !parsed.bounds || !parsed.groups || !Array.isArray(parsed.group_order)) {
    throw new Error('Unsupported painter document format');
  }
  return clone_painter_document(parsed as PainterDocument);
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
export function detectFileFormat(json: string): 'painter_document' | 'voxel_space' | 'grid' | 'unknown' {
  try {
    const parsed = JSON.parse(json);
    if (parsed.version === 3 && parsed.bounds && parsed.groups && Array.isArray(parsed.group_order)) {
      return 'painter_document';
    } else if (parsed.version === 2 && parsed.type === 'voxel_space') {
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
    const data = exportVoxelSpaceArtworkToJSON(space);
    localStorage.setItem(AUTOSAVE_KEY, data);
  } catch (e) {
    console.warn('VoxelSpace auto-save failed:', e);
  }
}

export function autoSavePainterDocument(document: PainterDocument, filename: string = 'untitled'): void {
  void filename;
  try {
    const data = exportPainterDocumentToJSON(document);
    localStorage.setItem(AUTOSAVE_KEY, data);
  } catch (e) {
    console.warn('PainterDocument auto-save failed:', e);
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

export function loadAutoSavePainterDocument(): PainterDocument | null {
  try {
    const data = localStorage.getItem(AUTOSAVE_KEY);
    if (!data) return null;
    if (detectFileFormat(data) !== 'painter_document') return null;
    return importPainterDocumentFromJSON(data);
  } catch (e) {
    console.warn('Load PainterDocument auto-save failed:', e);
    return null;
  }
}

export function clearAutoSaveVoxelSpace(): void {
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch (e) {
    console.warn('Clear VoxelSpace auto-save failed:', e);
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
  left_brush_size: number;
  right_brush_size: number;
  left_brush_char: string;
  right_brush_char: string;
  left_brush_rgb: { r: number; g: number; b: number };
  right_brush_rgb: { r: number; g: number; b: number };
  left_brush_weight_index: number;
  right_brush_weight_index: number;
  left_brush_edit_channels: EditChannels;
  right_brush_edit_channels: EditChannels;
  left_picker_edit_channels: EditChannels;
  right_picker_edit_channels: EditChannels;
  
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
  picker_pick_for_opposite_hand: boolean;
  active_property_side: 'left' | 'right';
}

/**
 * Default tool properties
 */
const DEFAULT_TOOL_PROPERTIES: ToolProperties = {
  brush_size: 1,
  left_brush_size: 1,
  right_brush_size: 1,
  left_brush_char: '█',
  right_brush_char: '█',
  left_brush_rgb: { r: 255, g: 255, b: 255 },
  right_brush_rgb: { r: 255, g: 255, b: 255 },
  left_brush_weight_index: 1,
  right_brush_weight_index: 1,
  left_brush_edit_channels: { ...ALL_EDIT_CHANNELS },
  right_brush_edit_channels: { ...ALL_EDIT_CHANNELS },
  left_picker_edit_channels: { ...ALL_EDIT_CHANNELS },
  right_picker_edit_channels: { ...ALL_EDIT_CHANNELS },
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
  picker_pick_for_opposite_hand: false,
  active_property_side: 'left',
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
    
    const parsed = JSON.parse(data) as Record<string, unknown>;
    const sanitized: ToolProperties = {
      brush_size: clamp_integer(parsed.brush_size, DEFAULT_TOOL_PROPERTIES.brush_size, 1, 5),
      left_brush_size: clamp_integer(parsed.left_brush_size ?? parsed.brush_size, DEFAULT_TOOL_PROPERTIES.left_brush_size, 1, 5),
      right_brush_size: clamp_integer(parsed.right_brush_size ?? parsed.brush_size, DEFAULT_TOOL_PROPERTIES.right_brush_size, 1, 5),
      left_brush_char: sanitize_char(parsed.left_brush_char, DEFAULT_TOOL_PROPERTIES.left_brush_char),
      right_brush_char: sanitize_char(parsed.right_brush_char, DEFAULT_TOOL_PROPERTIES.right_brush_char),
      left_brush_rgb: sanitize_rgb(parsed.left_brush_rgb, DEFAULT_TOOL_PROPERTIES.left_brush_rgb),
      right_brush_rgb: sanitize_rgb(parsed.right_brush_rgb, DEFAULT_TOOL_PROPERTIES.right_brush_rgb),
      left_brush_weight_index: clamp_weight_index(parsed.left_brush_weight_index),
      right_brush_weight_index: clamp_weight_index(parsed.right_brush_weight_index),
      left_brush_edit_channels: sanitize_edit_channels(parsed.left_brush_edit_channels, DEFAULT_TOOL_PROPERTIES.left_brush_edit_channels),
      right_brush_edit_channels: sanitize_edit_channels(parsed.right_brush_edit_channels, DEFAULT_TOOL_PROPERTIES.right_brush_edit_channels),
      left_picker_edit_channels: sanitize_edit_channels(parsed.left_picker_edit_channels, DEFAULT_TOOL_PROPERTIES.left_picker_edit_channels),
      right_picker_edit_channels: sanitize_edit_channels(parsed.right_picker_edit_channels, DEFAULT_TOOL_PROPERTIES.right_picker_edit_channels),
      text_spacing: clamp_integer(parsed.text_spacing, DEFAULT_TOOL_PROPERTIES.text_spacing, -16, 16),
      text_charlead: clamp_integer(parsed.text_charlead, DEFAULT_TOOL_PROPERTIES.text_charlead, -16, 16),
      text_enterlead: clamp_integer(parsed.text_enterlead, DEFAULT_TOOL_PROPERTIES.text_enterlead, -16, 16),
      text_enterspace: clamp_integer(parsed.text_enterspace, DEFAULT_TOOL_PROPERTIES.text_enterspace, -16, 16),
      paste_space_replace: sanitize_boolean(parsed.paste_space_replace, DEFAULT_TOOL_PROPERTIES.paste_space_replace),
      paste_scale: clamp_number(parsed.paste_scale, DEFAULT_TOOL_PROPERTIES.paste_scale, 0.1, 3.0),
      paste_ignore_space: sanitize_boolean(parsed.paste_ignore_space, DEFAULT_TOOL_PROPERTIES.paste_ignore_space),
      paste_ignore_color: sanitize_boolean(parsed.paste_ignore_color, DEFAULT_TOOL_PROPERTIES.paste_ignore_color),
      paste_ignore_color_rgb: sanitize_rgb(parsed.paste_ignore_color_rgb, DEFAULT_TOOL_PROPERTIES.paste_ignore_color_rgb),
      paste_ignore_black: sanitize_boolean(parsed.paste_ignore_black, DEFAULT_TOOL_PROPERTIES.paste_ignore_black),
      paste_ignore_white: sanitize_boolean(parsed.paste_ignore_white, DEFAULT_TOOL_PROPERTIES.paste_ignore_white),
      left_click_tool: sanitize_tool_type(parsed.left_click_tool, DEFAULT_TOOL_PROPERTIES.left_click_tool as ToolType),
      right_click_tool: sanitize_tool_type(parsed.right_click_tool, DEFAULT_TOOL_PROPERTIES.right_click_tool as ToolType),
      picker_pick_for_opposite_hand: sanitize_boolean(parsed.picker_pick_for_opposite_hand, DEFAULT_TOOL_PROPERTIES.picker_pick_for_opposite_hand),
      active_property_side: parsed.active_property_side === 'right' ? 'right' : 'left',
    };
    if (JSON.stringify(parsed) !== JSON.stringify(sanitized)) {
      localStorage.setItem(TOOL_PROPERTIES_KEY, JSON.stringify(sanitized));
    }
    return sanitized;
  } catch (e) {
    console.warn('Load tool properties failed:', e);
    return DEFAULT_TOOL_PROPERTIES;
  }
}

export function clearToolProperties(): void {
  try {
    localStorage.removeItem(TOOL_PROPERTIES_KEY);
  } catch (e) {
    console.warn('Clear tool properties failed:', e);
  }
}

// Camera config persistence key
const CAMERA_CONFIG_KEY = 'thaumworld_ascii_painter_camera_config';

/**
 * Camera configuration properties that should persist between sessions
 */
export interface CameraConfigSaveData {
  focus_plane?: number;
  principal_view?: 'top' | 'bottom' | 'north' | 'east' | 'south' | 'west';
  roll_quarter_turn?: 0 | 1 | 2 | 3;
  calibration?: { x: number; y: number };
  painter_calibration?: { x: number; y: number };
  place_calibration?: { x: number; y: number };
  scale_per_layer?: number;
  movement_per_layer?: number;
  mouse_angle_yaw_deg?: number;
  mouse_angle_pitch_deg?: number;
  mouse_angle_spring?: number;
  render_distance_planes?: number;
  base_layer_scale?: number;
  char_spacing_x?: number;
  char_spacing_y?: number;
  parallax_intensity?: number;
  parallax_move_enabled?: boolean;
  parallax_size_enabled?: boolean;
  euler_rotation?: { x: number; y: number; z: number };
  show_all_layers?: boolean;
  use_focus_layer_opacity?: boolean;
  center_target_in_view?: boolean;
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

export function loadPainterCameraConfig(): CameraConfigSaveData {
  const config = loadCameraConfig();
  return {
    ...config,
    calibration: config.painter_calibration ?? config.calibration,
  };
}

export function loadPlaceCameraConfig(): CameraConfigSaveData {
  const config = loadCameraConfig();
  return {
    ...config,
    calibration: config.place_calibration ?? config.calibration,
  };
}

export function savePainterCameraCalibration(calibration: { x: number; y: number }): void {
  saveCameraConfig({ painter_calibration: calibration });
}

export function savePlaceCameraCalibration(calibration: { x: number; y: number }): void {
  saveCameraConfig({ place_calibration: calibration });
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
