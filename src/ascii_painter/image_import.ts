/**
 * Image to ASCII Conversion
 * 
 * Converts images from clipboard to ASCII art grids.
 * Uses luminance-based character mapping with optional color preservation.
 */

import type { GridCell } from './types.js';
import type { Rgb } from '../mono_ui/types.js';
import type { CopyData } from './copy_paste.js';
import type { GradiatorState } from './gradiator.js';
import { getActiveGradiator, scaleCopyData, scaleTextToCopyData } from './gradiator.js';
import { INDEXED_COLORS, type IndexedColor } from '../mono_ui/colors.js';

// Fallback character ramp from dark to light (used if no gradiator provided)
const CHAR_RAMP_SIMPLE = ' .:-=+*#%@';
const CHAR_RAMP_DETAILED = ' .\'`^",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$';

/**
 * Convert a data URL to an ImageData object
 */
function dataUrlToImageData(dataUrl: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      resolve(ctx.getImageData(0, 0, img.width, img.height));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}

/**
 * Get luminance from RGB values
 */
function getLuminance(r: number, g: number, b: number): number {
  // Standard luminance formula
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Calculate color distance (weighted Euclidean distance in RGB space)
 */
function colorDistance(rgb1: Rgb, rgb2: Rgb): number {
  // Weight factors (human eye is more sensitive to green)
  const rWeight = 0.3;
  const gWeight = 0.59;
  const bWeight = 0.11;
  
  const dr = rgb1.r - rgb2.r;
  const dg = rgb1.g - rgb2.g;
  const db = rgb1.b - rgb2.b;
  
  return Math.sqrt(rWeight * dr * dr + gWeight * dg * dg + bWeight * db * db);
}

/**
 * Find the closest indexed color to the given RGB value
 */
function findClosestIndexedColor(r: number, g: number, b: number): IndexedColor {
  let closest = INDEXED_COLORS[0]!;
  let minDistance = Infinity;
  
  for (const color of INDEXED_COLORS) {
    const distance = colorDistance(color.rgb, { r, g, b });
    if (distance < minDistance) {
      minDistance = distance;
      closest = color;
    }
  }
  
  return closest;
}

/**
 * Convert ImageData to ASCII CopyData
 * 
 * @param imageData - The image data to convert
 * @param targetWidth - Desired output width (height calculated to maintain aspect ratio)
 * @param useColor - Whether to preserve colors
 * @param gradiatorState - The gradiator state to use for character mapping (optional, uses default if not provided)
 * @param pixelPerfect - If true, maps 1 pixel to 1 character (no aspect ratio correction)
 * @returns CopyData containing the ASCII representation
 */
export async function imageToAscii(
  imageData: ImageData,
  targetWidth: number = 80,
  useColor: boolean = false,
  gradiatorState?: GradiatorState,
  pixelPerfect: boolean = false
): Promise<CopyData> {
  const { width: imgWidth, height: imgHeight, data } = imageData;
  
  // Calculate target height
  let targetHeight: number;
  if (pixelPerfect) {
    // 1:1 pixel to character mapping
    targetHeight = imgHeight;
  } else {
    // Maintain aspect ratio with character height correction (chars are ~2x tall)
    const aspectRatio = imgWidth / imgHeight;
    targetHeight = Math.round(targetWidth / aspectRatio / 2);
  }
  
  // Get the gradiator ramp (user-defined or fallback)
  const ramp = gradiatorState ? getActiveGradiator(gradiatorState) : CHAR_RAMP_SIMPLE;
  const rampLength = ramp.length;
  
  const cells: (GridCell | null)[][] = [];
  
  // Sample pixels and convert to ASCII
  for (let y = 0; y < targetHeight; y++) {
    const row: (GridCell | null)[] = [];
    for (let x = 0; x < targetWidth; x++) {
      // Map output coordinates to image coordinates
      const srcX = Math.floor((x / targetWidth) * imgWidth);
      // Flip Y coordinate because image data has Y=0 at top, but ASCII renders Y=0 at bottom
      const srcY = imgHeight - 1 - Math.floor((y / targetHeight) * imgHeight);
      
      // Get pixel data
      const idx = (srcY * imgWidth + srcX) * 4;
      const r = data[idx]!;
      const g = data[idx + 1]!;
      const b = data[idx + 2]!;
      const a = data[idx + 3]!;
      
      // Skip fully transparent pixels
      if (a < 128) {
        row.push(null);
        continue;
      }
      
      // Calculate luminance and map to character
      const luminance = getLuminance(r, g, b);
      const charIndex = Math.floor((luminance / 255) * (rampLength - 1));
      const char = ramp[Math.min(rampLength - 1, Math.max(0, charIndex))]!;
      
      // Check for pure white or pure black - keep original RGB for ignore filters
      let finalRgb: { r: number; g: number; b: number };
      if ((r === 255 && g === 255 && b === 255) || (r === 0 && g === 0 && b === 0)) {
        // Keep pure white/black as-is for ignore filter detection
        finalRgb = { r, g, b };
      } else {
        // Convert to indexed color for other colors
        const indexedColor = findClosestIndexedColor(r, g, b);
        finalRgb = indexedColor.rgb;
      }
      
      row.push({
        char,
        rgb: finalRgb,
        weight_index: 2
      });
    }
    cells.push(row);
  }
  
  return {
    width: targetWidth,
    height: targetHeight,
    cells
  };
}

/**
 * Convert a data URL (from clipboard) to ASCII CopyData
 * 
 * @param dataUrl - The data URL from clipboard
 * @param targetWidth - Desired output width
 * @param useColor - Whether to preserve colors
 * @param gradiatorState - The gradiator state to use for character mapping
 * @param pixelPerfect - If true, maps 1 pixel to 1 character (no aspect ratio correction)
 */
export async function dataUrlToAscii(
  dataUrl: string,
  targetWidth: number = 80,
  useColor: boolean = false,
  gradiatorState?: GradiatorState,
  pixelPerfect: boolean = false
): Promise<CopyData> {
  const imageData = await dataUrlToImageData(dataUrl);
  return imageToAscii(imageData, targetWidth, useColor, gradiatorState, pixelPerfect);
}

/**
 * Check if clipboard contains an image
 */
export async function clipboardHasImage(): Promise<boolean> {
  try {
    if (window.electronAPI?.clipboardHasImage) {
      const result = await window.electronAPI.clipboardHasImage();
      return result.success && result.hasImage === true;
    }
    return false;
  } catch (e) {
    console.warn('Failed to check clipboard for image:', e);
    return false;
  }
}

/**
 * Read image from clipboard and convert to ASCII
 * 
 * @param targetWidth - Desired output width (undefined = use original image width for 1:1)
 * @param gradiatorState - The gradiator state to use for character mapping
 * @param pixelPerfect - If true, maps 1 pixel to 1 character (no aspect ratio correction)
 */
export async function pasteImageFromClipboard(
  targetWidth?: number,
  gradiatorState?: GradiatorState,
  pixelPerfect: boolean = false
): Promise<CopyData | null> {
  try {
    if (!window.electronAPI?.clipboardReadImage) {
      console.warn('clipboardReadImage not available');
      return null;
    }
    
    const result = await window.electronAPI.clipboardReadImage();
    if (!result.success || !result.dataUrl) {
      console.log('No image in clipboard');
      return null;
    }
    
    // If no targetWidth specified, use original image width for 1:1 pixel-to-character
    const finalTargetWidth = targetWidth ?? result.width;
    
    console.log(`Converting image ${result.width}x${result.height} to ASCII at width ${finalTargetWidth} (pixelPerfect=${pixelPerfect})...`);
    const copyData = await dataUrlToAscii(result.dataUrl, finalTargetWidth, true, gradiatorState, pixelPerfect);
    console.log(`Converted to ${copyData.width}x${copyData.height} ASCII`);
    return copyData;
  } catch (e) {
    console.error('Failed to paste image from clipboard:', e);
    return null;
  }
}
