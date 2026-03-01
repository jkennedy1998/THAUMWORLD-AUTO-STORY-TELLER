# Quick Testing Guide - ASCII Painter 3D

## Running the Painter

```bash
npm run dev:ascii
```

Or with logs:
```bash
npm run dev:logs
```

## What to Look For

### 1. Console Output (Browser DevTools)
On startup, you should see:
```
🎨 ASCII Painter 3D initialized
=== VoxelSpace Debug ===
Bounds: 80x40x1
Z range: 0 to 0
Camera: straight_ortho (xy)
Focus plane: 0
Parallax: 0.7
Layers:
  Z=0: "Layer 0" 👁  opacity=1
========================
💡 3D VoxelSpace Mode Active - Data is always 3D, camera modes are views
```

### 2. Layer Palette (Right Side)
- A panel showing "Layers" on the right side of the canvas
- Shows Layer 0 with Z=0
- Visibility toggle (●), Lock toggle, Z coordinate, Name
- [+] button to add layers

### 3. Basic Layer Operations

**Create a new layer:**
- Click [+] button in Layer Palette, OR
- Press `Ctrl+Shift+N`

**Switch layers:**
- Click on a layer in the Layer Palette, OR
- Press `Page Up` (next layer up)
- Press `Page Down` (next layer down)

**Toggle camera mode:**
- Press `Tab` to switch between:
  - `straight_ortho` - Normal 2D view (default)
  - `parallax_ortho` - 3D parallax view

### 4. Test Workflow

1. **Start painter** - see Layer 0
2. **Draw something** on Layer 0
3. **Press Ctrl+Shift+N** - create Layer 1
4. **Draw something else** on Layer 1 (different color/character)
5. **Press Page Down** - switch back to Layer 0
6. **Press Page Up** - switch to Layer 1
7. **Press Tab** - toggle camera mode
8. **Save file** - exports as VoxelSpace v2 format

### 5. Debug Commands

Open browser console (F12) and try:

```javascript
// View current VoxelSpace
appState.get_voxel_space()

// See all layers
appState.get_voxel_space().layers

// Add a layer programmatically
appState.add_layer()

// Switch to layer Z=2
appState.select_layer(2)

// Toggle layer visibility
appState.toggle_layer_visibility(0)

// Export to see the JSON structure
console.log(appState.export_voxel_space())
```

### 6. Expected Console Output During Use

When you use features, watch for:
- `➕ Added layer at Z=` - New layer created
- `✓ Selected layer Z=` - Layer switched
- `📷 Camera mode:` - Camera changed
- `💾 Auto-saved VoxelSpace to localStorage` - Auto-save

### 7. File Format

Saved files are now VoxelSpace v2 format (JSON). They contain:
- Multiple layers at different Z coordinates
- Camera configuration
- Metadata

Legacy v1 files (single grid) still load correctly!

---

## Troubleshooting

**Layer Palette not visible:**
- Check console for errors
- Look for `layer_palette` in registered modules list

**Keyboard shortcuts not working:**
- Make sure you're not focused on a text input
- Check console for key event logs

**Can't create layers:**
- Check console for error messages
- Verify VoxelSpace is initialized (check debug output)

---

## Next Features Coming

- [ ] Parallax rendering visual polish
- [ ] "Replace top glyph" tool mode
- [ ] Layer opacity controls in UI
- [ ] Multi-axis editing (rotate to draw on walls)

---

**Status:** Phase 1-2 Complete ✅  
**Ready for testing!** 🎨
