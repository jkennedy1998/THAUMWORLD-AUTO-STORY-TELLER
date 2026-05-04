/**
 * ASCII Painter Module - Public API
 * 
 * Main exports for the ASCII painter system.
 */

// Types
export type {
  Grid,
  GridCell,
  GridPoint,
  GridExport,
  Brush,
  ToolType,
  ToolState,
  HistorySnapshot,
  CharacterRamp
} from './types.js';

// Core functions
export {
  createGrid,
  cloneGrid,
  getCell,
  setCell,
  exportGrid,
  importGrid,
  clearGrid,
  CHARACTER_RAMPS
} from './types.js';

// Tools
export {
  drawCell,
  eraseCell,
  sampleCell,
  drawLine,
  drawRectStroke,
  drawRectFill,
  floodFill,
  applyTool,
  previewLine,
  previewRectStroke,
  previewRectFill
} from './tools.js';

// History
export type { HistoryManager } from './history.js';
export {
  createHistoryManager,
  logGroupCellAction,
  canUndoGroup,
  canRedoGroup,
  getGroupHistoryState,
  popUndoGroupAction,
  popRedoGroupAction,
  undoLegacyHistory,
  redoLegacyHistory,
  canUndo,
  canRedo,
  getHistoryState,
  clearHistory
} from './history.js';

// Export/Import
export {
  exportToJSON,
  importFromJSON,
  exportToText,
  importFromText,
  downloadFile,
  readFileAsText
} from './export.js';

// Image Import (PNG to ASCII)
export {
  imageToAscii,
  dataUrlToAscii,
  clipboardHasImage,
  pasteImageFromClipboard
} from './image_import.js';

// Gradiator System
export type { 
  GradiatorState, 
  GradiatorSlot 
} from './gradiator.js';
export {
  createGradiatorState,
  getActiveGradiator,
  setActiveGradiatorSlot,
  selectGradiatorChar,
  addGradiatorChar,
  removeGradiatorChar,
  setGradiatorChar,
  scaleCopyData,
  scaleTextToCopyData,
  parseScalePercent,
  formatScalePercent
} from './gradiator.js';

// Gradiator Storage
export {
  saveGradiatorState,
  loadGradiatorState,
  clearGradiatorState
} from './gradiator_storage.js';

// 3D VoxelSpace System
export type {
  VoxelSpace,
  VoxelLayer,
  VoxelSpaceExport,
  CameraConfig,
  CameraMode,
  CameraOrientation,
  CalibrationOffset
} from './voxel_space.js';

export {
  createVoxelSpace,
  createDefaultCamera,
  DEFAULT_CAMERA_VALUES,
  getLayer,
  getOrCreateLayer,
  getVoxel,
  setVoxel,
  getVisibleLayers,
  getLayersForParallax,
  addLayer,
  removeLayer,
  duplicateLayer,
  mergeLayerDown,
  flattenLayers,
  exportVoxelSpace,
  importVoxelSpace,
  gridToVoxelSpace,
  voxelSpaceToGrid,
  debugVoxelSpace
} from './voxel_space.js';

// Group-based Painter Document Runtime
export type {
  PainterCoordKey,
  PainterOccupiedBounds,
  PainterDocumentMetadata,
  PainterDocumentBreath,
  PainterDocumentPlayback,
  PainterVoxelRecord,
  PainterGroupLocationOffset,
  PainterGroupRasterState,
  PainterPropertyKind,
  PainterPropertyValue,
  PainterPropertyBlock,
  PainterProperty,
  PainterGroup,
  PainterDocument,
} from './painter_document.js';

export {
  make_painter_coord_key,
  get_default_painter_document_breath,
  get_default_painter_document_playback,
  clone_painter_document_breath,
  clone_painter_document_playback,
  create_painter_voxel_record,
  clone_painter_voxel_record,
  create_painter_group,
  get_painter_group_raster_state_at_breath,
  get_painter_group_initial_raster_state,
  clone_painter_group,
  create_painter_document,
  normalize_painter_group_properties,
  clone_painter_document,
} from './painter_document.js';

export type {
  PainterDocumentBreathRange,
  PainterDocumentAuthoredBreathBounds,
  PainterBreathPlaybackStepResult,
  PainterGroupBreathRange,
  PainterGroupRasterSegmentRange,
} from './painter_breath.js';

export {
  normalize_painter_document_breath,
  normalize_painter_document_playback,
  get_painter_document_breath,
  get_painter_document_playback,
  get_painter_document_breath_range,
  is_breath_in_painter_document_range,
  clamp_breath_to_painter_document_range,
  wrap_breath_in_painter_document_range,
  derive_group_raster_segment_ranges,
  derive_group_breath_range,
  get_group_raster_segment_at_breath,
  derive_painter_document_authored_breath_bounds,
  derive_painter_document_suggested_breath_range,
  step_painter_breath_playback,
} from './painter_breath.js';

export type {
  ResolvedPainterVoxel,
  PainterDocumentRuntime,
  ResolveVoxelWinnerResult,
  PainterGroupWorldBounds,
} from './painter_document_runtime.js';

export {
  derive_painter_occupied_bounds,
  get_active_painter_property_block_at_breath,
  get_exact_painter_property_block,
  is_painter_group_active_at_breath,
  get_exact_painter_group_raster_state,
  get_painter_group_properties_by_kind,
  resolve_painter_group_location_at_breath,
  resolve_painter_group_property_blocks_at_breath,
  resolve_nearest_painter_group_move_block,
  resolve_nearest_painter_group_raster_state,
  project_painter_group_local_voxel_to_world,
  move_painter_group_property_block,
  set_painter_group_raster_state,
  set_painter_group_property_block,
  unproject_painter_group_world_voxel_to_local,
  set_painter_runtime_active_breath,
  resolve_painter_voxel_winner,
  normalize_painter_document_runtime,
  get_group_voxel,
  set_group_voxel,
  erase_group_voxel,
  reorder_painter_groups,
  set_painter_group_visibility,
  set_painter_group_locked,
  set_painter_document_timing,
  set_painter_group_breath_span,
  offset_painter_group_in_time,
  set_painter_group_timing,
  set_painter_group_property_block_length,
  split_painter_group_property_block,
  swap_painter_group_property_blocks,
  export_painter_document,
} from './painter_document_runtime.js';

// DOM Renderer
export type { ViewportState } from './voxel_dom_renderer.js';
export {
  VoxelDOMRenderer,
  createVoxelDOMRenderer
} from './voxel_dom_renderer.js';

// Save System & Tool Properties
export type { ToolProperties } from './save_system.js';
export {
  saveToolProperties,
  loadToolProperties
} from './save_system.js';
