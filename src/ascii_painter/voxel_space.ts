/**
 * Voxel Space Data Model
 * 
 * 3D voxel grid data structure for the ASCII painter.
 * This wraps multiple layers (Z-slices) to create true 3D ASCII art.
 * 
 * Key concept: Data is ALWAYS 3D. Camera modes are view transformations.
 */

import type { Grid, GridCell, GridExport } from './types.js';

/**
 * Camera modes for viewing the voxel space
 * These are VIEW transformations, not data modes
 */
export type CameraMode = 'straight_ortho' | 'parallax_ortho' | 'rotated_ortho';

/**
 * Camera orientation - which plane we're viewing
 * xy: Looking down Z-axis (traditional "2D" view)
 * yz: Looking down X-axis (side/wall view)
 * xz: Looking down Y-axis (top-down/floor view)
 */
export type CameraOrientation = 'xy' | 'yz' | 'xz';

/**
 * Euler rotation angles for camera view (in degrees)
 */
export interface EulerRotation {
  x: number;  // Pitch (-30 to +30)
  y: number;  // Yaw (-30 to +30)
  z: number;  // Roll (-30 to +30)
}

/**
 * Calibration offset for aligning layers with the ASCII grid
 */
export interface CalibrationOffset {
  x: number;  // Horizontal offset in pixels
  y: number;  // Vertical offset in pixels
}

/**
 * Camera configuration
 */
export interface CameraConfig {
  mode: CameraMode;
  orientation: CameraOrientation;
  focus_plane: number;           // The Z/X/Y coordinate being edited (depends on orientation)
  parallax_intensity: number;    // 0.0 to 1.0, how much layers shift
  show_all_layers: boolean;      // If false, only show focus plane (like current behavior)

  // New 3D camera features
  parallax_move_enabled: boolean;     // Enable mouse-driven parallax movement
  parallax_size_enabled: boolean;     // Enable size-based parallax (layers in front bigger)
  euler_rotation: EulerRotation;      // Euler rotation angles for view transform

  // Calibration for aligning rendered layers with the ASCII grid
  calibration: CalibrationOffset;     // Pixel offset to align layers with grid

  // Per-layer calibration for fine-tuning the 3D effect
  scale_per_layer: number;            // Scale multiplier per Z layer (default 0.12)
  movement_per_layer: number;         // Parallax movement per Z layer in pixels (default 50)

  // Base layer scale and character spacing for grid alignment
  base_layer_scale: number;           // Scale of the selected/reference layer (default 0.5, range 0.2-1.5)
  char_spacing_x: number;             // Horizontal character spacing multiplier (default 1.0, range 0.5-2.0)
  char_spacing_y: number;             // Vertical line height multiplier (default 1.0, range 0.5-2.0)

  // Virtual camera pan position - moves the view across the voxel space
  pan_x: number;                      // Horizontal pan offset in grid cells (default 0)
  pan_y: number;                      // Vertical pan offset in grid cells (default 0)
}

/**
 * Default camera values - single source of truth
 * These can be updated by the camera module UI
 */
export const DEFAULT_CAMERA_VALUES = {
  mode: 'straight_ortho' as const,
  orientation: 'xy' as const,
  focus_plane: 0,
  parallax_intensity: 0.7,
  show_all_layers: false,
  parallax_move_enabled: false,
  parallax_size_enabled: false,
  euler_rotation: { x: 0, y: 0, z: 0 },
  calibration: { x: 0, y: 0 },
  scale_per_layer: 0.12,
  movement_per_layer: 29,
  base_layer_scale: 1.0,
  char_spacing_x: 0.9,      // Match PAINTER_CONFIG: 1 + (-0.10) letter spacing
  char_spacing_y: 0.93125,  // Match PAINTER_CONFIG: 29.8/32 line height
  pan_x: 0,
  pan_y: 0,
};

/**
 * Default camera configuration
 */
export function createDefaultCamera(): CameraConfig {
  return { ...DEFAULT_CAMERA_VALUES };
}

/**
 * A single layer in the voxel space (a Z-slice)
 * This is essentially a Grid with Z-coordinate metadata
 */
export interface VoxelLayer {
  z: number;                    // Z-coordinate in voxel space
  name: string;                 // Human-readable name
  visible: boolean;             // Is this layer visible?
  opacity: number;              // 0.0 to 1.0
  locked: boolean;              // Prevent editing?
  cells: GridCell[][];          // [y][x] - same structure as Grid
}

/**
 * VoxelSpace - the 3D data structure
 * Contains multiple layers at different Z-coordinates
 */
export interface VoxelSpace {
  bounds: {
    width: number;              // X dimension
    height: number;             // Y dimension
    depth: number;              // Z dimension (number of layers)
    minZ: number;               // Minimum Z coordinate
    maxZ: number;               // Maximum Z coordinate
  };
  layers: Map<number, VoxelLayer>;  // Map Z-coordinate to layer
  camera: CameraConfig;
  metadata?: {
    title?: string;
    description?: string;
    created_at: string;
    modified_at: string;
  };
}

/**
 * VoxelSpace export format (v2)
 * Extends GridExport to support multiple layers
 */
export interface VoxelSpaceExport {
  version: 2;
  type: 'voxel_space';
  bounds: {
    width: number;
    height: number;
    depth: number;
    minZ: number;
    maxZ: number;
  };
  layers: Array<{
    z: number;
    name: string;
    visible: boolean;
    opacity: number;
    locked: boolean;
    cells: GridCell[][];
  }>;
  // Camera config is UI/runtime state; artwork exports may omit it.
  camera?: CameraConfig;
  metadata?: {
    title?: string;
    description?: string;
    created_at: string;
    modified_at: string;
  };
}

/**
 * Create an empty VoxelSpace with default single layer at Z=0
 */
export function createVoxelSpace(
  width: number,
  height: number,
  options?: {
    minZ?: number;
    maxZ?: number;
    defaultZ?: number;
  }
): VoxelSpace {
  const minZ = options?.minZ ?? 0;
  const maxZ = options?.maxZ ?? 0;
  const defaultZ = options?.defaultZ ?? 0;
  
  const layers = new Map<number, VoxelLayer>();
  
  // Create default layer
  const defaultLayer: VoxelLayer = {
    z: defaultZ,
    name: 'Layer 0',
    visible: true,
    opacity: 1.0,
    locked: false,
    cells: createEmptyCells(width, height),
  };
  layers.set(defaultZ, defaultLayer);
  
  return {
    bounds: {
      width,
      height,
      depth: 1,
      minZ,
      maxZ,
    },
    layers,
    camera: createDefaultCamera(),
    metadata: {
      created_at: new Date().toISOString(),
      modified_at: new Date().toISOString(),
    },
  };
}

/**
 * Create empty 2D cell array
 */
function createEmptyCells(width: number, height: number): GridCell[][] {
  const cells: GridCell[][] = [];
  for (let y = 0; y < height; y++) {
    const row: GridCell[] = [];
    for (let x = 0; x < width; x++) {
      row.push({
        char: ' ',
        rgb: { r: 0, g: 0, b: 0 },
        weight_index: 0,
      });
    }
    cells.push(row);
  }
  return cells;
}

/**
 * Get layer at specific Z coordinate
 */
export function getLayer(space: VoxelSpace, z: number): VoxelLayer | undefined {
  return space.layers.get(z);
}

/**
 * Get or create layer at specific Z coordinate
 */
export function getOrCreateLayer(
  space: VoxelSpace,
  z: number,
  name?: string
): VoxelLayer {
  let layer = space.layers.get(z);
  if (!layer) {
    layer = {
      z,
      name: name ?? `Layer ${z}`,
      visible: true,
      opacity: 1.0,
      locked: false,
      cells: createEmptyCells(space.bounds.width, space.bounds.height),
    };
    space.layers.set(z, layer);
    
    // Update bounds
    space.bounds.minZ = Math.min(space.bounds.minZ, z);
    space.bounds.maxZ = Math.max(space.bounds.maxZ, z);
    space.bounds.depth = space.layers.size;
  }
  return layer;
}

/**
 * Get cell at specific voxel coordinates
 */
export function getVoxel(
  space: VoxelSpace,
  x: number,
  y: number,
  z: number
): GridCell | null {
  const layer = space.layers.get(z);
  if (!layer) return null;
  if (x < 0 || x >= space.bounds.width || y < 0 || y >= space.bounds.height) {
    return null;
  }
  return layer.cells[y]?.[x] ?? null;
}

/**
 * Set cell at specific voxel coordinates
 */
export function setVoxel(
  space: VoxelSpace,
  x: number,
  y: number,
  z: number,
  cell: GridCell
): boolean {
  const layer = space.layers.get(z);
  if (!layer) return false;
  if (layer.locked) return false;
  if (x < 0 || x >= space.bounds.width || y < 0 || y >= space.bounds.height) {
    return false;
  }
  
  const row = layer.cells[y];
  if (!row) return false;
  row[x] = { ...cell };
  
  // Update modified timestamp
  if (space.metadata) {
    space.metadata.modified_at = new Date().toISOString();
  }
  
  return true;
}

/**
 * Get all visible layers sorted by Z (back to front for rendering)
 */
export function getVisibleLayers(space: VoxelSpace): VoxelLayer[] {
  return Array.from(space.layers.values())
    .filter(layer => layer.visible)
    .sort((a, b) => a.z - b.z); // Back to front (negative Z first)
}

/**
 * Get layers sorted for parallax rendering (centered on focus plane)
 */
export function getLayersForParallax(
  space: VoxelSpace,
  focusZ: number
): Array<{ layer: VoxelLayer; offset: number }> {
  const visible = getVisibleLayers(space);
  return visible.map(layer => ({
    layer,
    offset: (layer.z - focusZ) * space.camera.parallax_intensity,
  }));
}

/**
 * Add a new layer at specified Z coordinate
 */
export function addLayer(
  space: VoxelSpace,
  z: number,
  name?: string
): VoxelLayer {
  if (space.layers.has(z)) {
    throw new Error(`Layer at Z=${z} already exists`);
  }
  
  const layer: VoxelLayer = {
    z,
    name: name ?? `Layer ${z}`,
    visible: true,
    opacity: 1.0,
    locked: false,
    cells: createEmptyCells(space.bounds.width, space.bounds.height),
  };
  
  space.layers.set(z, layer);
  
  // Update bounds
  space.bounds.minZ = Math.min(space.bounds.minZ, z);
  space.bounds.maxZ = Math.max(space.bounds.maxZ, z);
  space.bounds.depth = space.layers.size;
  
  // Update metadata
  if (space.metadata) {
    space.metadata.modified_at = new Date().toISOString();
  }
  
  return layer;
}

/**
 * Remove a layer at specified Z coordinate
 */
export function removeLayer(space: VoxelSpace, z: number): boolean {
  if (space.layers.size <= 1) {
    throw new Error('Cannot remove the last layer');
  }
  
  const deleted = space.layers.delete(z);
  
  if (deleted) {
    // Recalculate bounds
    const zs = Array.from(space.layers.keys());
    space.bounds.minZ = Math.min(...zs);
    space.bounds.maxZ = Math.max(...zs);
    space.bounds.depth = space.layers.size;
    
    // Update metadata
    if (space.metadata) {
      space.metadata.modified_at = new Date().toISOString();
    }
  }
  
  return deleted;
}

/**
 * Duplicate a layer
 */
export function duplicateLayer(
  space: VoxelSpace,
  sourceZ: number,
  targetZ: number,
  newName?: string
): VoxelLayer {
  const source = space.layers.get(sourceZ);
  if (!source) {
    throw new Error(`Source layer at Z=${sourceZ} not found`);
  }
  
  if (space.layers.has(targetZ)) {
    throw new Error(`Target layer at Z=${targetZ} already exists`);
  }
  
  // Deep copy cells
  const copiedCells: GridCell[][] = source.cells.map(row =>
    row.map(cell => ({
      char: cell.char,
      rgb: { ...cell.rgb },
      weight_index: cell.weight_index,
    }))
  );
  
  const newLayer: VoxelLayer = {
    z: targetZ,
    name: newName ?? `${source.name} (copy)`,
    visible: true,
    opacity: source.opacity,
    locked: false,
    cells: copiedCells,
  };
  
  space.layers.set(targetZ, newLayer);
  
  // Update bounds
  space.bounds.minZ = Math.min(space.bounds.minZ, targetZ);
  space.bounds.maxZ = Math.max(space.bounds.maxZ, targetZ);
  space.bounds.depth = space.layers.size;
  
  // Update metadata
  if (space.metadata) {
    space.metadata.modified_at = new Date().toISOString();
  }
  
  return newLayer;
}

/**
 * Merge layer down (targetZ merges into sourceZ, then target is removed)
 */
export function mergeLayerDown(space: VoxelSpace, targetZ: number): boolean {
  const zs = Array.from(space.layers.keys()).sort((a, b) => a - b);
  const targetIndex = zs.indexOf(targetZ);
  
  if (targetIndex <= 0) {
    return false; // Can't merge down if it's the bottom layer
  }
  
  const sourceZ = zs[targetIndex - 1];
  if (sourceZ === undefined) return false;
  
  const source = space.layers.get(sourceZ);
  const target = space.layers.get(targetZ);
  
  if (!source || !target) return false;
  
  // Merge non-empty cells from target into source
  for (let y = 0; y < space.bounds.height; y++) {
    for (let x = 0; x < space.bounds.width; x++) {
      const targetCell = target.cells[y]?.[x];
      if (targetCell && targetCell.char !== ' ') {
        if (!source.cells[y]) {
          source.cells[y] = [];
        }
        source.cells[y]![x] = { ...targetCell };
      }
    }
  }
  
  // Remove target layer
  return removeLayer(space, targetZ);
}

/**
 * Flatten all layers into a single layer (at Z=0)
 */
export function flattenLayers(space: VoxelSpace): VoxelSpace {
  const flattened = createVoxelSpace(space.bounds.width, space.bounds.height);
  
  // Get all layers sorted back-to-front
  const layers = Array.from(space.layers.values()).sort((a, b) => a.z - b.z);
  
  // Merge all layers into the base layer
  const baseLayer = flattened.layers.get(0);
  if (baseLayer) {
    for (const layer of layers) {
      for (let y = 0; y < space.bounds.height; y++) {
        for (let x = 0; x < space.bounds.width; x++) {
          const cell = layer.cells[y]?.[x];
          if (cell && cell.char !== ' ') {
            baseLayer.cells[y]![x] = { ...cell };
          }
        }
      }
    }
  }
  
  // Copy metadata
  if (space.metadata) {
    flattened.metadata = { ...space.metadata };
    flattened.metadata.modified_at = new Date().toISOString();
  }
  
  return flattened;
}

/**
 * Export VoxelSpace to serializable format
 */
export function exportVoxelSpace(space: VoxelSpace): VoxelSpaceExport {
  return {
    version: 2,
    type: 'voxel_space',
    bounds: { ...space.bounds },
    layers: Array.from(space.layers.values())
      .sort((a, b) => a.z - b.z)
      .map(layer => ({
        z: layer.z,
        name: layer.name,
        visible: layer.visible,
        opacity: layer.opacity,
        locked: layer.locked,
        cells: layer.cells.map(row =>
          row.map(cell => ({
            char: cell.char,
            rgb: { ...cell.rgb },
            weight_index: cell.weight_index,
          }))
        ),
      })),
    camera: { ...space.camera },
    metadata: space.metadata ? { ...space.metadata } : undefined,
  };
}

/**
 * Import VoxelSpace from export format
 */
export function importVoxelSpace(data: VoxelSpaceExport): VoxelSpace {
  if (data.version !== 2) {
    throw new Error(`Unsupported VoxelSpace version: ${data.version}`);
  }
  
  const layers = new Map<number, VoxelLayer>();
  
  for (const layerData of data.layers) {
    const layer: VoxelLayer = {
      z: layerData.z,
      name: layerData.name,
      visible: layerData.visible,
      opacity: layerData.opacity,
      locked: layerData.locked,
      cells: layerData.cells.map(row =>
        row.map(cell => ({
          char: cell.char,
          rgb: { ...cell.rgb },
          weight_index: cell.weight_index,
        }))
      ),
    };
    layers.set(layer.z, layer);
  }
  
  return {
    bounds: { ...data.bounds },
    layers,
    camera: { ...(data.camera ?? createDefaultCamera()) },
    metadata: data.metadata ? { ...data.metadata } : undefined,
  };
}

/**
 * Convert single Grid to VoxelSpace (for backward compatibility)
 */
export function gridToVoxelSpace(grid: Grid, z: number = 0): VoxelSpace {
  const space = createVoxelSpace(grid.width, grid.height);
  
  // Replace the default layer with grid's data
  const layer = space.layers.get(0)!;
  layer.z = z;
  layer.name = `Layer ${z}`;
  layer.cells = grid.cells.map(row =>
    row.map(cell => ({
      char: cell.char,
      rgb: { ...cell.rgb },
      weight_index: cell.weight_index,
    }))
  );
  
  space.bounds.minZ = z;
  space.bounds.maxZ = z;
  
  return space;
}

/**
 * Convert VoxelSpace to single Grid (for export/flattening)
 */
export function voxelSpaceToGrid(space: VoxelSpace, z?: number): Grid {
  const targetZ = z ?? space.camera.focus_plane;
  const layer = space.layers.get(targetZ);
  
  if (!layer) {
    throw new Error(`Layer at Z=${targetZ} not found`);
  }
  
  return {
    width: space.bounds.width,
    height: space.bounds.height,
    cells: layer.cells.map(row =>
      row.map(cell => ({
        char: cell.char,
        rgb: { ...cell.rgb },
        weight_index: cell.weight_index,
      }))
    ),
  };
}

/**
 * Debug: Print voxel space info
 */
export function debugVoxelSpace(space: VoxelSpace): string {
  const layers = Array.from(space.layers.values()).sort((a, b) => a.z - b.z);
  const lines = [
    '=== VoxelSpace Debug ===',
    `Bounds: ${space.bounds.width}x${space.bounds.height}x${space.bounds.depth}`,
    `Z range: ${space.bounds.minZ} to ${space.bounds.maxZ}`,
    `Camera: ${space.camera.mode} (${space.camera.orientation})`,
    `Focus plane: ${space.camera.focus_plane}`,
    `Parallax: ${space.camera.parallax_intensity}`,
    'Layers:',
    ...layers.map(l => 
      `  Z=${l.z}: "${l.name}" ${l.visible ? '👁' : '👁‍🗨'} ${l.locked ? '🔒' : ''} opacity=${l.opacity}`
    ),
    '========================',
  ];
  return lines.join('\n');
}
