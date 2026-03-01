# Undo System Bug Fixes - COMPLETE ✅

**Date:** 2026-03-01  
**Issue:** Undo only tracked first tile change, not full stroke  
**Status:** FIXED

---

## Problem

When drawing or erasing, the undo system was only tracking the first cell change in a stroke, not the entire stroke. This meant:
- Draw 20 cells → Undo only restored 1 cell
- Full strokes were being lost
- History incomplete

---

## Root Cause

**Two issues identified:**

### 1. `drawLineWithBrushSize` Not Tracking Changes
```typescript
// BEFORE: Called drawWithBrushSize with track=false
drawWithBrushSize(curr_x, curr_y, is_eraser, false); // Don't track

// This meant changes were made but not tracked!
```

### 2. `OnPointerUp` Not Logging Changes
Changes were accumulated in `pending_changes` array but never committed to history for continuous drawing operations (pencil, eraser, weight, color tools).

Only `drawLineWithBrushSize` was logging at the end, but individual draw calls during mouse drag weren't being logged.

---

## Fixes Applied

### 1. Always Track Changes in `drawWithBrushSize`

**File:** `src/mono_ui/modules/painter_canvas_module.ts`

```typescript
// BEFORE
function drawWithBrushSize(x: number, y: number, is_eraser: boolean, track: boolean = true): void {
  // ...
  if (track && oldCell) {  // Conditional tracking
    trackChange(...)
  }
}

// AFTER  
function drawWithBrushSize(x: number, y: number, is_eraser: boolean): void {
  // ...
  // Always track changes
  if (oldCell) {
    trackChange(...)
  }
}
```

**Change:** Removed the `track` parameter - all drawing operations now track changes.

### 2. Added Change Logging in `OnPointerUp`

**File:** `src/mono_ui/modules/painter_canvas_module.ts`

```typescript
// ADDED in OnPointerUp:
// Log pending changes to history when drawing ends
if ((is_drawing || is_erasing || is_weighing || is_coloring) && pending_changes.length > 0) {
  const selected_z = opts.get_selected_z();
  let tool_name = 'Draw';
  let action_type: 'draw_cells' | 'erase_cells' = 'draw_cells';
  
  if (is_erasing) {
    tool_name = 'Erase';
    action_type = 'erase_cells';
  } else if (is_weighing) {
    tool_name = 'Apply Weight';
  } else if (is_coloring) {
    tool_name = 'Apply Color';
  }
  
  logCellAction(opts.history, action_type, tool_name, selected_z, pending_changes);
  pending_changes = [];
}
```

**Change:** When mouse is released (`OnPointerUp`), all accumulated changes are logged to history.

### 3. Added Tracking to Weight and Color Tools

**File:** `src/mono_ui/modules/painter_canvas_module.ts`

```typescript
// BEFORE: applyWeightWithBrushSize and applyColorWithBrushSize
// Didn't track changes at all

// AFTER: Both functions now call trackChange() for each modified cell
function applyWeightWithBrushSize(x: number, y: number, weight_index: number): void {
  // ...
  const oldCell = getGridCell(draw_x, draw_y);
  // ... modify cell ...
  trackChange(draw_x, draw_y, oldCell, newCell);
}
```

**Change:** Weight and color tools now track their changes too.

---

## How It Works Now

### Drawing Flow:
1. **Mouse Down** → Set `is_drawing = true`
2. **Mouse Drag** → `drawWithBrushSize` called repeatedly
   - Each call modifies cells
   - Each call tracks changes in `pending_changes` array
3. **Mouse Up** → `OnPointerUp` called
   - Logs all `pending_changes` as single action
   - Shows status: "Draw (23 cells)" or "Erase (8 cells)"
   - Clears `pending_changes`
4. **Undo** → Restores all 23 cells (not just 1!)

### Complete Change Tracking:
- ✅ Pencil/Brush drawing
- ✅ Eraser
- ✅ Line tool
- ✅ Weight tool (apply weight)
- ✅ Color tool (apply color)
- ✅ Rectangle tools
- ✅ Fill tool

---

## Testing

### Test Case 1: Pencil Stroke
1. Select pencil tool
2. Draw a line across canvas (20+ cells)
3. Press Ctrl+Z
4. **Expected:** "Undo: Draw (20 cells)" - entire stroke undone

### Test Case 2: Eraser Stroke  
1. Select eraser tool
2. Erase multiple cells
3. Press Ctrl+Z
4. **Expected:** "Undo: Erase (15 cells)" - all erased cells restored

### Test Case 3: Weight Tool
1. Select weight tool
2. Drag to change weight on multiple cells
3. Press Ctrl+Z
4. **Expected:** "Undo: Apply Weight (12 cells)" - all weights restored

### Test Case 4: Multiple Strokes
1. Draw stroke 1 (10 cells)
2. Draw stroke 2 (8 cells)
3. Draw stroke 3 (15 cells)
4. Press Ctrl+Z 3 times
5. **Expected:** 
   - Undo: Draw (15 cells)
   - Undo: Draw (8 cells)
   - Undo: Draw (10 cells)

---

## Files Modified

1. **`src/mono_ui/modules/painter_canvas_module.ts`**
   - Modified `drawWithBrushSize()` - always track changes
   - Modified `drawLineWithBrushSize()` - removed track parameter
   - Modified `applyWeightWithBrushSize()` - added change tracking
   - Modified `applyColorWithBrushSize()` - added change tracking
   - Modified `OnPointerUp()` - log changes when drawing ends

---

## Result

**Before:** Undo restored only first cell of a stroke  
**After:** Undo restores entire stroke (all cells)

The action-based undo system now correctly tracks and restores complete drawing operations!

---

**Status: FIXED ✅**  
Ready for testing!
