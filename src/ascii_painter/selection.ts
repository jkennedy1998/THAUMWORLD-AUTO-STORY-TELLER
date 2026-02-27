/**
 * ASCII Painter Selection System
 * 
 * Manages bitmap-based selections with support for arbitrary shapes.
 * Supports operations: replace, additive, subtract, intersect (inclusive)
 */

export type SelectionBitmap = {
  width: number;
  height: number;
  cells: boolean[][]; // true = selected
};

export type SelectionMode = 'replace' | 'additive' | 'subtract' | 'intersect';

export function createSelectionBitmap(width: number, height: number): SelectionBitmap {
  return {
    width,
    height,
    cells: Array.from({ length: height }, () => Array(width).fill(false))
  };
}

export function cloneSelectionBitmap(bitmap: SelectionBitmap): SelectionBitmap {
  return {
    width: bitmap.width,
    height: bitmap.height,
    cells: bitmap.cells.map(row => [...row])
  };
}

export function isSelected(bitmap: SelectionBitmap, x: number, y: number): boolean {
  if (x < 0 || x >= bitmap.width || y < 0 || y >= bitmap.height) return false;
  return bitmap.cells[y]?.[x] ?? false;
}

export function setSelected(bitmap: SelectionBitmap, x: number, y: number, selected: boolean): void {
  if (x < 0 || x >= bitmap.width || y < 0 || y >= bitmap.height) return;
  const row = bitmap.cells[y];
  if (row) row[x] = selected;
}

export function clearSelection(bitmap: SelectionBitmap): void {
  for (let y = 0; y < bitmap.height; y++) {
    const row = bitmap.cells[y];
    if (row) row.fill(false);
  }
}

export function selectAll(bitmap: SelectionBitmap): void {
  for (let y = 0; y < bitmap.height; y++) {
    const row = bitmap.cells[y];
    if (row) row.fill(true);
  }
}

export function invertSelection(bitmap: SelectionBitmap): void {
  for (let y = 0; y < bitmap.height; y++) {
    const row = bitmap.cells[y];
    if (row) {
      for (let x = 0; x < bitmap.width; x++) {
        row[x] = !row[x];
      }
    }
  }
}

export function selectRect(bitmap: SelectionBitmap, x0: number, y0: number, x1: number, y1: number): void {
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      setSelected(bitmap, x, y, true);
    }
  }
}

export function deselectRect(bitmap: SelectionBitmap, x0: number, y0: number, x1: number, y1: number): void {
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      setSelected(bitmap, x, y, false);
    }
  }
}

export function hasSelection(bitmap: SelectionBitmap): boolean {
  for (let y = 0; y < bitmap.height; y++) {
    const row = bitmap.cells[y];
    if (row?.some(cell => cell)) return true;
  }
  return false;
}

export function getSelectionBounds(bitmap: SelectionBitmap): { x: number; y: number; width: number; height: number } | null {
  let minX = bitmap.width;
  let minY = bitmap.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < bitmap.height; y++) {
    const row = bitmap.cells[y];
    if (!row) continue;
    for (let x = 0; x < bitmap.width; x++) {
      if (row[x]) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX < 0) return null;

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };
}

// Check if a cell is on the border of the selection (has at least one unselected neighbor)
export function isSelectionBorder(bitmap: SelectionBitmap, x: number, y: number): boolean {
  if (!isSelected(bitmap, x, y)) return false;
  
  // Check all 4 cardinal neighbors
  const neighbors = [
    { x: x - 1, y },
    { x: x + 1, y },
    { x, y: y - 1 },
    { x, y: y + 1 }
  ];
  
  // If any neighbor is not selected, this is a border cell
  for (const n of neighbors) {
    if (!isSelected(bitmap, n.x, n.y)) return true;
  }
  return false;
}

// Apply selection mode operation
export function applySelectionMode(
  current: SelectionBitmap,
  newSelection: SelectionBitmap,
  mode: SelectionMode
): void {
  for (let y = 0; y < current.height; y++) {
    for (let x = 0; x < current.width; x++) {
      const newVal = isSelected(newSelection, x, y);
      const currentVal = isSelected(current, x, y);
      
      switch (mode) {
        case 'replace':
          setSelected(current, x, y, newVal);
          break;
        case 'additive':
          setSelected(current, x, y, currentVal || newVal);
          break;
        case 'subtract':
          setSelected(current, x, y, currentVal && !newVal);
          break;
        case 'intersect':
          setSelected(current, x, y, currentVal && newVal);
          break;
      }
    }
  }
}
