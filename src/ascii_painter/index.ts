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
  pushSnapshot,
  undo,
  redo,
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

// DOM Renderer
export type { ViewportState } from './voxel_dom_renderer.js';
export {
  VoxelDOMRenderer,
  createVoxelDOMRenderer
} from './voxel_dom_renderer.js';

// Camera Control
export type { CameraControlOptions } from './camera_control_module.js';
export { makeCameraControlModule } from './camera_control_module.js';

// Save System & Tool Properties
export type { ToolProperties, CameraConfigSaveData } from './save_system.js';
export {
  saveToolProperties,
  loadToolProperties,
  saveCameraConfig,
  loadCameraConfig,
  clearCameraConfig
} from './save_system.js';
