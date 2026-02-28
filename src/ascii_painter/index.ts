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
