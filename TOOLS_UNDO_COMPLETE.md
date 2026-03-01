# Tool Undo Support - COMPLETE ✅

**Date:** 2026-03-01  
**Status:** FIXED - All tools now have proper undo support

---

## ⚠️ Known Issues

### Paste Tool Bugs
**Status:** 🔴 Active Issues  
**Details:** See main plan document `docs/plans/3dification_plan_of_the_ascii_program.md`

1. **Multi-Layer Paste Bug** - When pasting on a second layer, previous paste on first layer disappears from view
2. **Ignore Space Logic Error** - The ignore space paste option doesn't work due to logic bug in paste code

These bugs exist in the implementation but are documented for future fixing.

---

## Tools Fixed

### ❌ Before (Broken)
- Line tool
- Rectangle Stroke tool  
- Rectangle Fill tool
- Bucket Fill tool
- Paste tool

### ✅ After (Working)
All tools now track changes and support undo/redo

---

## Implementation Approach

**Used: Capture Before/After State (Option B)**

For tools that modify the grid in complex ways (line, rect, bucket, paste), we:
1. Capture the affected region before applying the tool
2. Apply the tool (modifies grid)
3. Compare before/after states
4. Track all changed cells
5. Log to history

---

## Changes Made

### 1. Added Helper Functions

**File:** `src/mono_ui/modules/painter_canvas_module.ts`

```typescript
// Capture a region of the grid for before/after comparison
function captureRegion(minX, minY, maxX, maxY): Map<string, GridCell>

// Compare before/after regions and track changes  
function diffRegion(before, minX, minY, maxX, maxY): void
```

### 2. Line Tool (OnPointerUp & OnDragEnd)

```typescript
// Capture region before
const beforeRegion = captureRegion(minX, minY, maxX, maxY);

// Apply line
applyTool(opts.grid, tool_for_up, end_x, end_y, opts.brush, drag_start);

// Track changes
diffRegion(beforeRegion, minX, minY, maxX, maxY);

// Log action
logCellAction(opts.history, 'draw_cells', 'Draw Line', selected_z, pending_changes);
```

### 3. Rectangle Tools (OnPointerUp & OnDragEnd)

Same pattern as line tool:
- Capture region before
- Apply rect stroke or fill
- Diff and track changes
- Log as "Draw Rectangle (stroke)" or "Draw Rectangle (fill)"

### 4. Bucket Fill Tool

```typescript
// Capture full grid (bucket can affect large areas)
const beforeRegion = captureRegion(0, 0, opts.grid.width - 1, opts.grid.height - 1);

// Apply bucket fill
applyTool(opts.grid, 'bucket', grid_x, grid_y, opts.brush);

// Diff entire grid
diffRegion(beforeRegion, 0, 0, opts.grid.width - 1, opts.grid.height - 1);

// Log as "Fill"
logCellAction(opts.history, 'draw_cells', `Fill`, selected_z, pending_changes);
```

### 5. Paste Tool

```typescript
// For each pasted cell:
const oldCell = getGridCell(targetX, targetY);
opts.grid.cells[targetY]![targetX] = { ...cell };
const newCell = getGridCell(targetX, targetY);
if (oldCell && newCell) {
  trackChange(targetX, targetY, oldCell, newCell);
}

// After all cells pasted:
logCellAction(opts.history, 'draw_cells', `Paste`, selected_z, pending_changes);
```

### 6. Removed Old Snapshot Calls

Removed `opts.on_push_snapshot()` calls from:
- Pencil tool
- Eraser tool
- Weighter tool
- Colorer tool
- Line/Rect tools
- Bucket tool
- Paste tool

**Reason:** We're now handling undo via action logging in `OnPointerUp`

---

## How It Works

### Line Tool Example:

1. **User drags** to draw line from (0,0) to (10,5)
2. **Capture phase**: Store all cells in bounding box (0,0) to (10,5)
3. **Apply**: Draw line using Bresenham's algorithm
4. **Diff phase**: Compare each cell, find changed ones
5. **Track**: Add changes to `pending_changes` array
6. **Log**: "Draw Line (15 cells)" action created
7. **Undo**: Restores all 15 cells at once

### Bucket Fill Example:

1. **User clicks** at (50, 25)
2. **Capture phase**: Store entire grid state
3. **Apply**: Flood fill from (50, 25)
4. **Diff phase**: Compare entire grid, find 1,247 changed cells
5. **Track**: Add all changes to `pending_changes`
6. **Log**: "Fill (1,247 cells)" action created
7. **Undo**: Restores all 1,247 cells at once

### Paste Example:

1. **User pastes** 20×15 selection
2. **For each cell**: Track old → new value
3. **Log**: "Paste (300 cells)" action created
4. **Undo**: Restores all 300 cells at once

---

## Tool Action Descriptions

| Tool | Description | Example |
|------|-------------|---------|
| Pencil | Draw (N cells) | "Draw (12 cells)" |
| Eraser | Erase (N cells) | "Erase (8 cells)" |
| Line | Draw Line (N cells) | "Draw Line (23 cells)" |
| Rect Stroke | Draw Rectangle (stroke) (N cells) | "Draw Rectangle (stroke) (45 cells)" |
| Rect Fill | Draw Rectangle (fill) (N cells) | "Draw Rectangle (fill) (156 cells)" |
| Bucket | Fill (N cells) | "Fill (1,247 cells)" |
| Weight | Apply Weight (N cells) | "Apply Weight (9 cells)" |
| Color | Apply Color (N cells) | "Apply Color (9 cells)" |
| Paste | Paste (N cells) | "Paste (300 cells)" |
| Text | Type Text (N cells) | "Type Text (15 cells)" |

---

## Memory Efficiency

**Bucket Fill Example:**
- Grid: 80×40 = 3,200 cells
- Changed cells: 1,247 cells
- Old approach: Store full grid = 3,200 cells
- New approach: Store only changes = 1,247 cells
- **Savings:** 61% reduction

**Line Tool Example:**
- Line: 23 cells changed
- Old approach: Store full grid = 3,200 cells
- New approach: Store only changes = 23 cells
- **Savings:** 99.3% reduction

---

## Testing

### Test Case 1: Line Tool
1. Select line tool
2. Draw line from top-left to bottom-right
3. Press Ctrl+Z
4. **Expected:** "Undo: Draw Line (N cells)" - entire line removed

### Test Case 2: Rectangle Fill
1. Select rect fill tool
2. Draw large filled rectangle
3. Press Ctrl+Z
4. **Expected:** "Undo: Draw Rectangle (fill) (N cells)" - rectangle removed

### Test Case 3: Bucket Fill
1. Draw a closed shape
2. Select bucket tool
3. Click inside shape to fill
4. Press Ctrl+Z
5. **Expected:** "Undo: Fill (N cells)" - fill removed

### Test Case 4: Paste
1. Copy some content
2. Paste it
3. Press Ctrl+Z
4. **Expected:** "Undo: Paste (N cells)" - pasted content removed

### Test Case 5: Multiple Operations
1. Draw line (Action 1)
2. Fill area (Action 2)
3. Paste content (Action 3)
4. Press Ctrl+Z 3 times
5. **Expected:** Each action undone in reverse order

---

## Files Modified

1. **`src/mono_ui/modules/painter_canvas_module.ts`**
   - Added `captureRegion()` helper
   - Added `diffRegion()` helper
   - Fixed Line tool (OnPointerUp)
   - Fixed Line tool (OnDragEnd)
   - Fixed Rectangle Stroke tool
   - Fixed Rectangle Fill tool
   - Fixed Bucket Fill tool
   - Fixed Paste tool
   - Removed old `on_push_snapshot()` calls

---

## Result

**Before:** Line, Rect, Bucket, Paste tools had no undo support
**After:** All tools have full undo support with proper cell tracking

### Complete Undo Support Matrix:

| Tool | Undo | Status |
|------|------|--------|
| Pencil | ✅ | Works |
| Eraser | ✅ | Works |
| Line | ✅ | Fixed |
| Rect Stroke | ✅ | Fixed |
| Rect Fill | ✅ | Fixed |
| Bucket | ✅ | Fixed |
| Weight | ✅ | Works |
| Color | ✅ | Works |
| Paste | ✅ | Fixed |
| Text | ✅ | Works |
| Selection | ✅ | Works |

---

**Status: COMPLETE ✅**

All tools now properly track changes and support undo/redo!
