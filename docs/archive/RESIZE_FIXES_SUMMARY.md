# Resize Widget Fixes Applied

## Changes Made

### 1. Canvas Module (`src/mono_ui/modules/painter_canvas_module.ts`)

**Problem:** Gizmos were drawn BEFORE the border, so the resize borders were being overwritten.

**Fix:**
- Moved `draw_module_gizmos()` to the END of the Draw() method
- Modified border drawing to skip when in resize mode (resize mode draws its own colored borders)
- This allows the blue/green resize borders to appear on top

**Key change (lines 488-501):**
```typescript
// Draw canvas border (only if NOT in resize mode)
if (!gizmo_state.is_resize_mode) {
  // Draw normal gray border
}

// ... other content ...

// Draw gizmos LAST so they appear on top (including resize borders)
draw_module_gizmos(c, rect, gizmo_config, gizmo_state, 'CANVAS');
```

### 2. Layer Palette Module (`src/ascii_painter/layer_palette_module.ts`)

**Complete rewrite** to match Character Selector's resize behavior:

**Added:**
- ✅ Size constraints (MIN_WIDTH=15, MAX_WIDTH=30, MIN_HEIGHT=8, MAX_HEIGHT=40)
- ✅ Proper gizmo state management
- ✅ Border drawing only when NOT in resize mode
- ✅ Gizmo drawing at the END of Draw() method
- ✅ Proper OnPointerUp handler to reset move/resize states
- ✅ OnPointerMove handler for resize edge detection
- ✅ OnDragMove handler for resize dragging

**Drawing order fixed:**
1. Background
2. Border (skip if in resize mode)
3. Content (headers, layers, etc.)
4. **Gizmos LAST** (so resize borders appear on top)

**Resize UX:**
- Click ╋ gizmo → Enter resize mode (blue borders appear)
- Click/drag border → Resize module
- Release mouse → Resize complete
- Click ╋ gizmo again → Exit resize mode

## Testing Checklist

After running `npm run dev:ascii`:

- [ ] Canvas: Click resize gizmo (╋) → Blue borders appear
- [ ] Canvas: Click border and drag → Module resizes
- [ ] Canvas: Click resize gizmo again → Blue borders disappear, gray border returns
- [ ] Layer Palette: Same behavior as canvas
- [ ] Layer Palette: Can add layers with [+] button while resized
- [ ] Layer Palette: Can scroll through many layers
- [ ] Both modules maintain proper borders during all states

## Files Modified

1. `src/mono_ui/modules/painter_canvas_module.ts` - Fixed drawing order
2. `src/ascii_painter/layer_palette_module.ts` - Complete rewrite with proper resize support

## Key Principle

**Gizmos (including resize borders) must be drawn LAST to appear on top.**

When `is_resize_mode` is true, the module draws colored borders instead of the normal gray border, and the gizmo drawing system draws the resize indicator borders on top of everything.
