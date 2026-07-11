/**
 * ASCII Painter Save/Export System
 *
 * PainterDocument is the canonical painter save/load format.
 * Legacy Grid (v1) and VoxelSpace (v2) parsing remain import-only helpers for
 * older files and stores while the runtime converges on a single source of truth.
 */

import type { Grid, GridExport } from './types.js';
import { exportGrid, importGrid } from './types.js';
import type { VoxelSpace, VoxelSpaceExport } from './voxel_space.js';
import { exportVoxelSpace, importVoxelSpace, gridToVoxelSpace, voxelSpaceToGrid } from './voxel_space.js';
import type { PainterDocument, PainterGroup, PainterProperty, PainterVoxelRecord } from './painter_document.js';
import { PAINTER_DOCUMENT_VERSION, clone_painter_document } from './painter_document.js';
import type { AppearanceSlotTargetMask, ToolEditTarget, ToolType } from './types.js';
import type { AppearanceSlotAssignments, AppearanceSlotValue, InlineMaterialAssignments, RenderGraphicRef, ViewDirection } from '../render_shaders/graphics_contract.js';
import { clamp_weight_index } from '../mono_ui/weight_system.js';
import { ALL_EDIT_CHANNELS, sanitize_edit_channels, type EditChannels } from './edit_mask.js';

const VALID_TOOL_TYPES: readonly ToolType[] = ['pencil', 'eraser', 'line', 'rect_stroke', 'rect_fill', 'shape', 'bucket', 'eyedropper', 'text', 'lassoselect', 'copy', 'paste', 'move'] as const;

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

const VALID_VIEW_DIRECTIONS: readonly ViewDirection[] = ['north', 'south', 'east', 'west', 'up', 'down'] as const;

function sanitize_view_direction(value: unknown, fallback: ViewDirection): ViewDirection {
  return typeof value === 'string' && VALID_VIEW_DIRECTIONS.includes(value as ViewDirection)
    ? value as ViewDirection
    : fallback;
}

function sanitize_render_graphic_ref(value: unknown): RenderGraphicRef | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const graphic = value as Record<string, unknown>;
  const graphic_id = typeof graphic.graphic_id === 'string' && graphic.graphic_id.length > 0 ? graphic.graphic_id : null;
  if (!graphic_id) return undefined;
  const view_direction = sanitize_view_direction(graphic.view_direction, 'south');
  const weight_index = clamp_weight_index(graphic.weight_index);
  const facing = graphic.facing === undefined ? undefined : sanitize_view_direction(graphic.facing, 'south');
  return {
    graphic_id,
    view_direction,
    facing,
    weight_index: weight_index as 0 | 1 | 2 | 3,
    variant: typeof graphic.variant === 'string' && graphic.variant.length > 0 ? graphic.variant : undefined,
    frame: typeof graphic.frame === 'string' && graphic.frame.length > 0 ? graphic.frame : undefined,
  };
}

function sanitize_inline_material_assignments(value: unknown): InlineMaterialAssignments | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const sanitized: InlineMaterialAssignments = {};
  for (const slot of [1, 2, 3] as const) {
    const material_id = record[String(slot)];
    if (typeof material_id === 'string' && material_id.length > 0) sanitized[slot] = material_id;
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function sanitize_appearance_slot_value(value: unknown): AppearanceSlotValue | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const entry = value as Record<string, unknown>;
  if (entry.kind === 'material' && typeof entry.material_id === 'string' && entry.material_id.length > 0) {
    return { kind: 'material', material_id: entry.material_id };
  }
  if (entry.kind === 'flat_rgb') {
    return { kind: 'flat_rgb', rgb: sanitize_rgb(entry.rgb, { r: 255, g: 255, b: 255 }) };
  }
  return undefined;
}

function sanitize_appearance_slot_assignments(value: unknown): AppearanceSlotAssignments | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const sanitized: AppearanceSlotAssignments = {};
  for (const slot of [1, 2, 3] as const) {
    const parsed = sanitize_appearance_slot_value(record[String(slot)]);
    if (parsed) sanitized[slot] = parsed;
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function sanitize_tool_type(value: unknown, fallback: ToolType): ToolType {
  if (value === 'weighter' || value === 'colorer') return 'pencil';
  if (value === 'selectangle') return 'rect_stroke';
  if (typeof value === 'string') {
    return (VALID_TOOL_TYPES as readonly string[]).includes(value) ? value as ToolType : 'pencil';
  }
  return fallback;
}

function sanitize_tool_target(value: unknown, fallback: ToolEditTarget): ToolEditTarget {
  return value === 'selection' || value === 'content' ? value : fallback;
}

function sanitize_paste_angle_mode(value: unknown, fallback: 'relative' | 'absolute'): 'relative' | 'absolute' {
  return value === 'absolute' || value === 'relative' ? value : fallback;
}

function sanitize_shape_primitive(value: unknown, fallback: 'box' | 'sphere' | 'cylinder' | 'cone'): 'box' | 'sphere' | 'cylinder' | 'cone' {
  return value === 'sphere' || value === 'cylinder' || value === 'cone' || value === 'box' ? value : fallback;
}

function sanitize_shape_render_mode(value: unknown, fallback: 'filled' | 'surfaces' | 'wireframe'): 'filled' | 'surfaces' | 'wireframe' {
  if (value === 'fill') return 'filled';
  if (value === 'outline') return 'surfaces';
  return value === 'filled' || value === 'surfaces' || value === 'wireframe' ? value : fallback;
}

function sanitize_shape_segment_count(value: unknown, fallback: number, min: number = 3, max: number = 24): number {
  return clamp_integer(value, fallback, min, max);
}

function sanitize_boolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function sanitize_appearance_slot_target_mask(value: unknown, fallback: AppearanceSlotTargetMask): AppearanceSlotTargetMask {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    slot_1: sanitize_boolean(record.slot_1, fallback.slot_1),
    slot_2: sanitize_boolean(record.slot_2, fallback.slot_2),
    slot_3: sanitize_boolean(record.slot_3, fallback.slot_3),
  };
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
// Legacy import/export helpers (non-canonical painter formats)
// ============================================================================

/**
 * Export VoxelSpace to JSON string.
 * Legacy/debug helper only; PainterDocument is the normal persisted format.
 */
export function exportVoxelSpaceToJSON(space: VoxelSpace): string {
  const data = exportVoxelSpace(space);
  return JSON.stringify(data, null, 2);
}

/**
 * Export VoxelSpace artwork only (no camera/UI state).
 * Legacy/debug helper only; PainterDocument is the normal persisted format.
 */
export function exportVoxelSpaceArtworkToJSON(space: VoxelSpace): string {
  const data = exportVoxelSpace(space) as any;
  // Camera is persisted separately; don't bake it into art exports.
  delete data.camera;
  return JSON.stringify(data, null, 2);
}

export function exportPainterDocumentToJSON(document: PainterDocument): string {
  return JSON.stringify(clone_painter_document(document), null, 2);
}

type PainterAssetExportMode = 'glyph' | 'sprite' | 'game_object';

type PainterAssetCell = {
  x: number;
  y: number;
  z: number;
  char: string;
  rgb: { r: number; g: number; b: number };
  weight_index: number;
  graphic?: RenderGraphicRef;
  appearance_slots?: AppearanceSlotAssignments;
  materials?: InlineMaterialAssignments;
};

type PainterAssetGroupBounds = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
} | null;

type PainterAssetGlyphGroup = {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  start: number;
  cropped_start: number;
  cropped_end: number;
  breath_start: number;
  breath_end: number;
  bounds: PainterAssetGroupBounds;
  cells: PainterAssetCell[];
};

type PainterAssetSpriteGroup = PainterAssetGlyphGroup;

type PainterAssetGameObjectGroup = {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  start: number;
  cropped_start: number;
  cropped_end: number;
  breath_start: number;
  breath_end: number;
  bounds: PainterAssetGroupBounds;
  metadata?: PainterGroup['metadata'];
  property_ids: string[];
  properties: Record<string, PainterProperty>;
};

export type PainterAssetExport = {
  schema_version: typeof PAINTER_DOCUMENT_VERSION;
  kind: 'thaum_asset_export';
  asset_id: string;
  asset_name: string;
  source: {
    document_version: typeof PAINTER_DOCUMENT_VERSION;
    source_file_name: string;
    source_file_path?: string | null;
  };
  export: {
    profile: 'thaumworld_compact';
    preserves_strata: true;
    created_at: string;
  };
  interpretation: {
    default_mode: PainterAssetExportMode;
    allowed_modes: PainterAssetExportMode[];
  };
  strata: {
    glyph: { groups: PainterAssetGlyphGroup[] };
    sprite: { groups: PainterAssetSpriteGroup[] };
    game_object: { groups: PainterAssetGameObjectGroup[] };
  };
};

function get_asset_stem(sourceFilenameOrPath: string | null | undefined, fallback: string): string {
  const raw = String(sourceFilenameOrPath ?? '').trim();
  if (!raw) return fallback;
  const fileName = raw.slice(Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\')) + 1);
  const stem = fileName.replace(/\.json$/i, '').replace(/_asset$/i, '').trim();
  return stem || fallback;
}

function collect_group_raster_voxels(group: PainterGroup): PainterVoxelRecord[] {
  const voxels: PainterVoxelRecord[] = [];
  for (const propertyId of Array.isArray(group.property_ids) ? group.property_ids : []) {
    const property = group.properties?.[propertyId];
    if (!property) continue;
    for (const block of property.blocks) {
      if (block.type !== 'content' || block.value.kind !== 'raster') continue;
      voxels.push(...block.value.voxels.map((voxel) => ({ ...voxel, rgb: { ...voxel.rgb }, graphic: voxel.graphic ? { ...voxel.graphic } : undefined, appearance_slots: voxel.appearance_slots ? { ...voxel.appearance_slots } : undefined, materials: voxel.materials ? { ...voxel.materials } : undefined })));
    }
  }
  return voxels.sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
}

function derive_group_bounds(voxels: PainterVoxelRecord[]): PainterAssetGroupBounds {
  if (voxels.length === 0) return null;
  let minX = voxels[0]!.x;
  let minY = voxels[0]!.y;
  let minZ = voxels[0]!.z;
  let maxX = voxels[0]!.x;
  let maxY = voxels[0]!.y;
  let maxZ = voxels[0]!.z;
  for (const voxel of voxels) {
    minX = Math.min(minX, voxel.x);
    minY = Math.min(minY, voxel.y);
    minZ = Math.min(minZ, voxel.z);
    maxX = Math.max(maxX, voxel.x);
    maxY = Math.max(maxY, voxel.y);
    maxZ = Math.max(maxZ, voxel.z);
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

function pack_glyph_group(group: PainterGroup): PainterAssetGlyphGroup {
  const voxels = collect_group_raster_voxels(group);
  return {
    id: group.id,
    name: group.name,
    visible: group.visible,
    locked: group.locked,
    opacity: group.opacity,
    start: Math.floor(group.start ?? 0),
    cropped_start: Math.floor(group.cropped_start ?? group.start ?? 0),
    cropped_end: Math.floor(group.cropped_end ?? group.breath_end ?? group.start ?? 0),
    breath_start: Math.floor(group.breath_start ?? group.start ?? 0),
    breath_end: Math.floor(group.breath_end ?? group.cropped_end ?? group.start ?? 0),
    bounds: derive_group_bounds(voxels),
    cells: voxels.map((voxel) => ({
      x: voxel.x,
      y: voxel.y,
      z: voxel.z,
      char: voxel.char,
      rgb: { ...voxel.rgb },
      weight_index: voxel.weight_index,
    })),
  };
}

function pack_sprite_group(group: PainterGroup): PainterAssetSpriteGroup {
  const voxels = collect_group_raster_voxels(group);
  return {
    id: group.id,
    name: group.name,
    visible: group.visible,
    locked: group.locked,
    opacity: group.opacity,
    start: Math.floor(group.start ?? 0),
    cropped_start: Math.floor(group.cropped_start ?? group.start ?? 0),
    cropped_end: Math.floor(group.cropped_end ?? group.breath_end ?? group.start ?? 0),
    breath_start: Math.floor(group.breath_start ?? group.start ?? 0),
    breath_end: Math.floor(group.breath_end ?? group.cropped_end ?? group.start ?? 0),
    bounds: derive_group_bounds(voxels),
    cells: voxels.map((voxel) => ({
      x: voxel.x,
      y: voxel.y,
      z: voxel.z,
      char: voxel.char,
      rgb: { ...voxel.rgb },
      weight_index: voxel.weight_index,
      graphic: voxel.graphic ? { ...voxel.graphic } : undefined,
      appearance_slots: voxel.appearance_slots ? { ...voxel.appearance_slots } : undefined,
      materials: voxel.materials ? { ...voxel.materials } : undefined,
    })),
  };
}

function pack_game_object_group(group: PainterGroup): PainterAssetGameObjectGroup {
  const voxels = collect_group_raster_voxels(group);
  return {
    id: group.id,
    name: group.name,
    visible: group.visible,
    locked: group.locked,
    opacity: group.opacity,
    start: Math.floor(group.start ?? 0),
    cropped_start: Math.floor(group.cropped_start ?? group.start ?? 0),
    cropped_end: Math.floor(group.cropped_end ?? group.breath_end ?? group.start ?? 0),
    breath_start: Math.floor(group.breath_start ?? group.start ?? 0),
    breath_end: Math.floor(group.breath_end ?? group.cropped_end ?? group.start ?? 0),
    bounds: derive_group_bounds(voxels),
    metadata: group.metadata ? structuredClone(group.metadata) : undefined,
    property_ids: Array.isArray(group.property_ids) ? [...group.property_ids] : [],
    properties: Object.fromEntries(
      (Array.isArray(group.property_ids) ? group.property_ids : [])
        .map((propertyId) => [propertyId, group.properties?.[propertyId]] as const)
        .filter((entry): entry is readonly [string, PainterProperty] => !!entry[1])
        .map(([propertyId, property]) => [propertyId, structuredClone(property)])
    ),
  };
}

function build_painter_asset_export(document: PainterDocument, sourceFilenameOrPath?: string | null): PainterAssetExport {
  const normalized = clone_painter_document(document);
  const asset_name = get_asset_stem(sourceFilenameOrPath, String(normalized.metadata?.title ?? 'untitled').trim() || 'untitled');
  const asset_id = asset_name;
  const groups = normalized.group_order
    .map((groupId) => normalized.groups[groupId]!)
    .filter((group): group is PainterGroup => !!group);
  return {
    schema_version: PAINTER_DOCUMENT_VERSION,
    kind: 'thaum_asset_export',
    asset_id,
    asset_name,
    source: {
      document_version: PAINTER_DOCUMENT_VERSION,
      source_file_name: get_asset_stem(sourceFilenameOrPath, `${asset_name}.json`) + '.json',
      source_file_path: sourceFilenameOrPath ?? null,
    },
    export: {
      profile: 'thaumworld_compact',
      preserves_strata: true,
      created_at: new Date().toISOString(),
    },
    interpretation: {
      default_mode: 'glyph',
      allowed_modes: ['glyph', 'sprite', 'game_object'],
    },
    strata: {
      glyph: { groups: groups.map((group) => pack_glyph_group(group)) },
      sprite: { groups: groups.map((group) => pack_sprite_group(group)) },
      game_object: { groups: groups.map((group) => pack_game_object_group(group)) },
    },
  };
}

export function exportPainterAssetToJSON(document: PainterDocument, sourceFilenameOrPath?: string | null): string {
  return JSON.stringify(build_painter_asset_export(document, sourceFilenameOrPath), null, 2);
}

export function getPainterAssetExportFilename(sourceFilenameOrPath: string): string {
  const raw = String(sourceFilenameOrPath ?? '').trim();
  const fileName = raw.slice(Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\')) + 1);
  const withoutExtension = fileName.replace(/\.json$/i, '');
  const withoutAssetSuffix = withoutExtension.replace(/_asset$/i, '');
  const base = withoutAssetSuffix.trim() || 'untitled';
  return `${base}_asset.json`;
}

export function getPainterAssetExportPath(sourceFilePath: string | null | undefined): string | null {
  const raw = String(sourceFilePath ?? '').trim();
  if (!raw) return null;
  const slashIndex = raw.lastIndexOf('/');
  const backslashIndex = raw.lastIndexOf('\\');
  const separatorIndex = Math.max(slashIndex, backslashIndex);
  const fileName = raw.slice(separatorIndex + 1);
  const exportName = getPainterAssetExportFilename(fileName);
  if (separatorIndex < 0) return exportName;
  const separator = backslashIndex > slashIndex ? '\\' : '/';
  return `${raw.slice(0, separatorIndex)}${separator}${exportName}`;
}

function is_supported_painter_document_version(version: unknown): boolean {
  return version === 3 || version === 4 || version === 5 || version === PAINTER_DOCUMENT_VERSION;
}

function is_painter_document_like(parsed: any): boolean {
  return !!parsed
    && is_supported_painter_document_version(parsed.version)
    && !!parsed.bounds
    && !!parsed.groups
    && Array.isArray(parsed.group_order);
}

export function importPainterDocumentFromJSON(json: string): PainterDocument {
  const parsed = JSON.parse(json);
  if (!is_painter_document_like(parsed)) {
    throw new Error('Unsupported painter document format');
  }
  return clone_painter_document(parsed as PainterDocument);
}

/**
 * Import legacy painter content from JSON string (supports v1/v2 only).
 * Import-only helper; not the canonical painter document path.
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
 * Export VoxelSpace to plain text (flattens all layers).
 * Legacy/debug helper only.
 */
export function exportVoxelSpaceToText(space: VoxelSpace): string {
  // Flatten to a single grid and export as text
  const { flattenLayers } = require('./voxel_space.js');
  const flattened = flattenLayers(space);
  const grid = voxelSpaceToGrid(flattened, 0);
  return exportToText(grid);
}

/**
 * Detect painter file/storage format.
 */
export function detectFileFormat(json: string): 'painter_document' | 'voxel_space' | 'grid' | 'unknown' {
  try {
    const parsed = JSON.parse(json);
    if (is_painter_document_like(parsed)) {
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
 * Auto-save VoxelSpace to localStorage.
 * Legacy fallback only; PainterDocument auto-save is canonical.
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
 * Load auto-saved VoxelSpace from localStorage.
 * Legacy fallback only; returns null unless the stored data is legacy v1/v2.
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
  left_brush_graphic?: RenderGraphicRef;
  right_brush_graphic?: RenderGraphicRef;
  left_brush_appearance_slots?: AppearanceSlotAssignments;
  right_brush_appearance_slots?: AppearanceSlotAssignments;
  left_brush_materials?: InlineMaterialAssignments;
  right_brush_materials?: InlineMaterialAssignments;
  left_selected_appearance?: AppearanceSlotValue;
  right_selected_appearance?: AppearanceSlotValue;
  left_brush_weight_index: number;
  right_brush_weight_index: number;
  left_brush_edit_channels: EditChannels;
  right_brush_edit_channels: EditChannels;
  left_brush_slot_targets: AppearanceSlotTargetMask;
  right_brush_slot_targets: AppearanceSlotTargetMask;
  left_picker_edit_channels: EditChannels;
  right_picker_edit_channels: EditChannels;
  left_bucket_select_channels: EditChannels;
  right_bucket_select_channels: EditChannels;
  bucket_continuous: boolean;
  bucket_same_depth_only: boolean;
  bucket_allow_diagonal: boolean;
  rect_select_all_depths: boolean;
  lasso_select_all_depths: boolean;
  user_selection_color_rgb: { r: number; g: number; b: number };
  left_target: ToolEditTarget;
  right_target: ToolEditTarget;
  left_pencil_target: ToolEditTarget;
  right_pencil_target: ToolEditTarget;
  left_eraser_target: ToolEditTarget;
  right_eraser_target: ToolEditTarget;
  left_bucket_target: ToolEditTarget;
  right_bucket_target: ToolEditTarget;
  left_line_target: ToolEditTarget;
  right_line_target: ToolEditTarget;
  left_rect_target: ToolEditTarget;
  right_rect_target: ToolEditTarget;
  shape_primitive: 'box' | 'sphere' | 'cylinder' | 'cone';
  shape_render_mode: 'filled' | 'surfaces' | 'wireframe';
  shape_cylinder_sides: number;
  shape_cone_sides: number;
  shape_sphere_u_segments: number;
  shape_sphere_v_segments: number;
  
  // Text tool settings
  text_spacing: number;
  text_charlead: number;
  text_enterlead: number;
  text_enterspace: number;
  
  // Paste settings
  paste_space_replace: boolean;
  paste_scale: number;
  paste_angle_mode: 'relative' | 'absolute';
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
  left_brush_graphic: undefined,
  right_brush_graphic: undefined,
  left_brush_appearance_slots: undefined,
  right_brush_appearance_slots: undefined,
  left_brush_materials: undefined,
  right_brush_materials: undefined,
  left_selected_appearance: undefined,
  right_selected_appearance: undefined,
  left_brush_weight_index: 1,
  right_brush_weight_index: 1,
  left_brush_edit_channels: { ...ALL_EDIT_CHANNELS },
  right_brush_edit_channels: { ...ALL_EDIT_CHANNELS },
  left_brush_slot_targets: { slot_1: true, slot_2: false, slot_3: false },
  right_brush_slot_targets: { slot_1: true, slot_2: false, slot_3: false },
  left_picker_edit_channels: { ...ALL_EDIT_CHANNELS },
  right_picker_edit_channels: { ...ALL_EDIT_CHANNELS },
  left_bucket_select_channels: { ...ALL_EDIT_CHANNELS },
  right_bucket_select_channels: { ...ALL_EDIT_CHANNELS },
  bucket_continuous: true,
  bucket_same_depth_only: true,
  bucket_allow_diagonal: false,
  rect_select_all_depths: false,
  lasso_select_all_depths: false,
  user_selection_color_rgb: { r: 0, g: 220, b: 255 },
  left_target: 'content',
  right_target: 'content',
  left_pencil_target: 'content',
  right_pencil_target: 'content',
  left_eraser_target: 'content',
  right_eraser_target: 'content',
  left_bucket_target: 'content',
  right_bucket_target: 'content',
  left_line_target: 'content',
  right_line_target: 'content',
  left_rect_target: 'content',
  right_rect_target: 'content',
  shape_primitive: 'box',
  shape_render_mode: 'surfaces',
  shape_cylinder_sides: 5,
  shape_cone_sides: 5,
  shape_sphere_u_segments: 5,
  shape_sphere_v_segments: 5,
  text_spacing: 1,
  text_charlead: 0,
  text_enterlead: 1,
  text_enterspace: 0,
  paste_space_replace: true,
  paste_scale: 1.0,
  paste_angle_mode: 'relative',
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
    const legacy_left_selectangle = parsed.left_click_tool === 'selectangle';
    const legacy_right_selectangle = parsed.right_click_tool === 'selectangle';
    const sanitized: ToolProperties = {
      brush_size: clamp_integer(parsed.brush_size, DEFAULT_TOOL_PROPERTIES.brush_size, 1, 5),
      left_brush_size: clamp_integer(parsed.left_brush_size ?? parsed.brush_size, DEFAULT_TOOL_PROPERTIES.left_brush_size, 1, 5),
      right_brush_size: clamp_integer(parsed.right_brush_size ?? parsed.brush_size, DEFAULT_TOOL_PROPERTIES.right_brush_size, 1, 5),
      left_brush_char: sanitize_char(parsed.left_brush_char, DEFAULT_TOOL_PROPERTIES.left_brush_char),
      right_brush_char: sanitize_char(parsed.right_brush_char, DEFAULT_TOOL_PROPERTIES.right_brush_char),
      left_brush_rgb: sanitize_rgb(parsed.left_brush_rgb, DEFAULT_TOOL_PROPERTIES.left_brush_rgb),
      right_brush_rgb: sanitize_rgb(parsed.right_brush_rgb, DEFAULT_TOOL_PROPERTIES.right_brush_rgb),
      left_brush_graphic: sanitize_render_graphic_ref(parsed.left_brush_graphic),
      right_brush_graphic: sanitize_render_graphic_ref(parsed.right_brush_graphic),
      left_brush_appearance_slots: sanitize_appearance_slot_assignments(parsed.left_brush_appearance_slots),
      right_brush_appearance_slots: sanitize_appearance_slot_assignments(parsed.right_brush_appearance_slots),
      left_brush_materials: sanitize_inline_material_assignments(parsed.left_brush_materials),
      right_brush_materials: sanitize_inline_material_assignments(parsed.right_brush_materials),
      left_selected_appearance: sanitize_appearance_slot_value(parsed.left_selected_appearance),
      right_selected_appearance: sanitize_appearance_slot_value(parsed.right_selected_appearance),
      left_brush_weight_index: clamp_weight_index(parsed.left_brush_weight_index),
      right_brush_weight_index: clamp_weight_index(parsed.right_brush_weight_index),
      left_brush_edit_channels: sanitize_edit_channels(parsed.left_brush_edit_channels, DEFAULT_TOOL_PROPERTIES.left_brush_edit_channels),
      right_brush_edit_channels: sanitize_edit_channels(parsed.right_brush_edit_channels, DEFAULT_TOOL_PROPERTIES.right_brush_edit_channels),
      left_brush_slot_targets: sanitize_appearance_slot_target_mask(parsed.left_brush_slot_targets, DEFAULT_TOOL_PROPERTIES.left_brush_slot_targets),
      right_brush_slot_targets: sanitize_appearance_slot_target_mask(parsed.right_brush_slot_targets, DEFAULT_TOOL_PROPERTIES.right_brush_slot_targets),
      left_picker_edit_channels: sanitize_edit_channels(parsed.left_picker_edit_channels, DEFAULT_TOOL_PROPERTIES.left_picker_edit_channels),
      right_picker_edit_channels: sanitize_edit_channels(parsed.right_picker_edit_channels, DEFAULT_TOOL_PROPERTIES.right_picker_edit_channels),
      left_bucket_select_channels: sanitize_edit_channels(parsed.left_bucket_select_channels, DEFAULT_TOOL_PROPERTIES.left_bucket_select_channels),
      right_bucket_select_channels: sanitize_edit_channels(parsed.right_bucket_select_channels, DEFAULT_TOOL_PROPERTIES.right_bucket_select_channels),
      bucket_continuous: sanitize_boolean(parsed.bucket_continuous, DEFAULT_TOOL_PROPERTIES.bucket_continuous),
      bucket_same_depth_only: sanitize_boolean(parsed.bucket_same_depth_only, DEFAULT_TOOL_PROPERTIES.bucket_same_depth_only),
      bucket_allow_diagonal: sanitize_boolean(parsed.bucket_allow_diagonal, DEFAULT_TOOL_PROPERTIES.bucket_allow_diagonal),
      rect_select_all_depths: sanitize_boolean(parsed.rect_select_all_depths, DEFAULT_TOOL_PROPERTIES.rect_select_all_depths),
      lasso_select_all_depths: sanitize_boolean(parsed.lasso_select_all_depths, DEFAULT_TOOL_PROPERTIES.lasso_select_all_depths),
      user_selection_color_rgb: sanitize_rgb(parsed.user_selection_color_rgb, DEFAULT_TOOL_PROPERTIES.user_selection_color_rgb),
      left_target: legacy_left_selectangle
        ? 'selection'
        : sanitize_tool_target(parsed.left_target ?? parsed.left_pencil_target ?? parsed.left_eraser_target ?? parsed.left_bucket_target ?? parsed.left_line_target ?? parsed.left_rect_target, DEFAULT_TOOL_PROPERTIES.left_target),
      right_target: legacy_right_selectangle
        ? 'selection'
        : sanitize_tool_target(parsed.right_target ?? parsed.right_pencil_target ?? parsed.right_eraser_target ?? parsed.right_bucket_target ?? parsed.right_line_target ?? parsed.right_rect_target, DEFAULT_TOOL_PROPERTIES.right_target),
      left_pencil_target: sanitize_tool_target(parsed.left_pencil_target, DEFAULT_TOOL_PROPERTIES.left_pencil_target),
      right_pencil_target: sanitize_tool_target(parsed.right_pencil_target, DEFAULT_TOOL_PROPERTIES.right_pencil_target),
      left_eraser_target: sanitize_tool_target(parsed.left_eraser_target, DEFAULT_TOOL_PROPERTIES.left_eraser_target),
      right_eraser_target: sanitize_tool_target(parsed.right_eraser_target, DEFAULT_TOOL_PROPERTIES.right_eraser_target),
      left_bucket_target: sanitize_tool_target(parsed.left_bucket_target, DEFAULT_TOOL_PROPERTIES.left_bucket_target),
      right_bucket_target: sanitize_tool_target(parsed.right_bucket_target, DEFAULT_TOOL_PROPERTIES.right_bucket_target),
      left_line_target: sanitize_tool_target(parsed.left_line_target, DEFAULT_TOOL_PROPERTIES.left_line_target),
      right_line_target: sanitize_tool_target(parsed.right_line_target, DEFAULT_TOOL_PROPERTIES.right_line_target),
      left_rect_target: legacy_left_selectangle ? 'selection' : sanitize_tool_target(parsed.left_rect_target, DEFAULT_TOOL_PROPERTIES.left_rect_target),
      right_rect_target: legacy_right_selectangle ? 'selection' : sanitize_tool_target(parsed.right_rect_target, DEFAULT_TOOL_PROPERTIES.right_rect_target),
      shape_primitive: sanitize_shape_primitive(parsed.shape_primitive, DEFAULT_TOOL_PROPERTIES.shape_primitive),
      shape_render_mode: sanitize_shape_render_mode(parsed.shape_render_mode, DEFAULT_TOOL_PROPERTIES.shape_render_mode),
      shape_cylinder_sides: sanitize_shape_segment_count(parsed.shape_cylinder_sides, DEFAULT_TOOL_PROPERTIES.shape_cylinder_sides),
      shape_cone_sides: sanitize_shape_segment_count(parsed.shape_cone_sides, DEFAULT_TOOL_PROPERTIES.shape_cone_sides),
      shape_sphere_u_segments: sanitize_shape_segment_count(parsed.shape_sphere_u_segments, DEFAULT_TOOL_PROPERTIES.shape_sphere_u_segments),
      shape_sphere_v_segments: sanitize_shape_segment_count(parsed.shape_sphere_v_segments, DEFAULT_TOOL_PROPERTIES.shape_sphere_v_segments),
      text_spacing: clamp_integer(parsed.text_spacing, DEFAULT_TOOL_PROPERTIES.text_spacing, -16, 16),
      text_charlead: clamp_integer(parsed.text_charlead, DEFAULT_TOOL_PROPERTIES.text_charlead, -16, 16),
      text_enterlead: clamp_integer(parsed.text_enterlead, DEFAULT_TOOL_PROPERTIES.text_enterlead, -16, 16),
      text_enterspace: clamp_integer(parsed.text_enterspace, DEFAULT_TOOL_PROPERTIES.text_enterspace, -16, 16),
      paste_space_replace: sanitize_boolean(parsed.paste_space_replace, DEFAULT_TOOL_PROPERTIES.paste_space_replace),
      paste_scale: clamp_number(parsed.paste_scale, DEFAULT_TOOL_PROPERTIES.paste_scale, 0.1, 3.0),
      paste_angle_mode: sanitize_paste_angle_mode(parsed.paste_angle_mode, DEFAULT_TOOL_PROPERTIES.paste_angle_mode),
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
