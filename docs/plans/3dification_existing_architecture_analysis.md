# 3Dification Plan - Existing Architecture Analysis

**Date:** 2026-02-28  
**Purpose:** Identify what already exists vs. what needs to be built

---

## What ALREADY EXISTS

### 1. Core Rendering Infrastructure ✅

**Canvas System (`src/mono_ui/canvas.ts`)**
- Already has `render_index` in Cell type (0-255, default 0)
- Last-write-wins composition (simple but works)
- Clamping and normalization for weight_index and render_index
- 2D grid coordinate system (x, y)

**Compose System (`src/mono_ui/compose.ts`)**
- Simple module-based composition
- Z-order = array order (later modules overwrite earlier)
- Clears canvas each frame
- **This is our compositor foundation**

**CanvasRuntime (`src/mono_ui/runtime/canvas_runtime.ts`)**
- Full rendering pipeline: compose → draw_canvas → screen
- Font rendering with weight_index mapping to CSS weights
- Input event routing (mouse, keyboard, wheel)
- Global pan/zoom system already implemented
- Module registry and lifecycle management

### 2. ASCII Painter Foundation ✅

**Grid/Cell Types (`src/ascii_painter/types.ts`)**
```typescript
interface GridCell {
  char: string;
  rgb: Rgb;
  weight_index: number;
  render_index?: number;  // Already exists!
}

interface Grid {
  width: number;
  height: number;
  cells: GridCell[][];
}
```

**Save System (`src/ascii_painter/save_system.ts`)**
- JSON export/import working
- GridExport format exists (version 1)
- Auto-save to localStorage

**Painter Canvas Module (`src/mono_ui/modules/painter_canvas_module.ts`)**
- Full drawing tool implementation
- Selection system (rect, lasso)
- Copy/paste with special format
- History/undo system
- Brush, eraser, line, rect, bucket, text tools
- Layer gizmos (move, resize, close)

**Painter App State (`src/canvas_app/painter_app_state.ts`)**
- Complete module graph setup
- Tool state management
- File operations
- Module positioning system

### 3. Place System ✅

**Place Types (`src/types/place.ts`)**
- Place, PlaceCoordinates, TileGrid types exist
- Elevation field exists: `elevation: number` (0=surface, +1=above, -1=below)
- EntityLocation has elevation
- **This maps directly to our Z-layer concept!**

**Place Module (`src/mono_ui/modules/place_module.ts`)**
- Already uses render_index for particles (layer 3) vs entities (layer 4)
- Shows understanding of layered rendering

---

## What NEEDS TO BE BUILT

### 1. VoxelSpace Data Model (NEW)

**Current:** Single Grid (2D array)
**Need:** VoxelSpace (array of Layers)

```typescript
// NEW - Doesn't exist yet
interface VoxelSpace {
  bounds: { width, height, depth };
  layers: Layer[];  // Multiple grids at different Z
  camera_config: CameraConfig;
}

interface Layer {
  z: number;  // Z-coordinate
  cells: GridCell[][];
  visible: boolean;
  opacity: number;
  name?: string;
}
```

**Why new:** Current system has ONE Grid per module. We need MULTIPLE layers per file.

### 2. Camera/View System (NEW)

**Current:** Fixed orthographic, modules draw directly to canvas
**Need:** Camera abstraction with view transformations

```typescript
// NEW
interface Camera {
  mode: 'straight_ortho' | 'parallax_ortho' | 'rotated_ortho';
  orientation: 'xy' | 'yz' | 'xz';  // Which plane we're viewing
  focus_plane: number;  // Selected View Layer coordinate
  parallax_intensity: number;
}
```

**Why new:** Current compose_modules has no camera concept. Everything is straight ortho.

### 3. Layer Rendering Pipeline (EXTENDS existing)

**Current:** `PainterCanvasModule` draws ONE grid
**Need:** Multiple LayerRendererModules, one per layer

**Leverages existing:**
- Module system ✅
- Canvas composition ✅  
- render_index system ✅

**New parts:**
- LayerRendererModule (renders one z-slice)
- Parallax offset calculation
- Depth-sorting before composition

### 4. VoxelFileModule (NEW)

**Current:** Grid is passed directly to PainterCanvasModule
**Need:** File-level module that owns VoxelSpace

**Responsibilities:**
- Owns VoxelSpace (all layers)
- Manages LayerRendererModules
- File operations (New, Open, Save)
- Camera mode switching

**Why new:** Current architecture has no file-level abstraction in the module system.

### 5. Tool 3D Awareness (EXTENDS existing)

**Current:** Tools work on single grid at specific (x, y)
**Need:** Tools query voxel memory for "top glyph"

**Leverages existing:**
- Tool system ✅
- Input routing ✅
- GridCell structure ✅

**New parts:**
- VoxelQuery API
- "Replace top glyph" toggle
- Multi-layer hit testing

### 6. File Format v2 (EXTENDS existing)

**Current:** GridExport (version 1) - single grid
**Need:** VoxelSpaceExport (version 2) - multiple layers

**Migration path:**
```typescript
// Load v1 → Create VoxelSpace with single layer at Z=0
// Save v2 → Export all layers with camera config
```

---

## Architecture Comparison

### Current Flow
```
PainterCanvasModule
  └── Grid (single 2D)
       └── Draw to Canvas
            └── Compose
                 └── Screen
```

### Proposed Flow
```
VoxelFileModule (NEW)
  └── VoxelSpace (NEW - 3D data)
       ├── Layer Z=-2 ──→ LayerRendererModule
       ├── Layer Z=-1 ──→ LayerRendererModule  
       ├── Layer Z=0  ──→ LayerRendererModule (Selected View)
       ├── Layer Z=+1 ──→ LayerRendererModule
       └── Layer Z=+2 ──→ LayerRendererModule
                            ↓ (with parallax offsets)
                       Compositor (EXTENDS existing compose.ts)
                            ↓ (depth-sort, merge)
                       Canvas
                            ↓
                       Screen
```

---

## What Can Be REUSED

1. **Canvas system** - Barely needs changes, just receives final composed image
2. **Compose system** - Extend to handle depth-sorting, keep module-based approach
3. **Module system** - Works perfectly, just need new module types
4. **Painter tools** - Core logic stays same, just need "top glyph" query
5. **Cell types** - Already has render_index, just need to use it for Z-ordering
6. **Save system** - Extend format, keep JSON structure
7. **Input system** - CanvasRuntime handles everything, just route correctly
8. **Place system** - Elevation field already exists, will map to Z-layers

---

## Implementation Strategy

**Phase 1: Layer Data Model**
- Create `src/ascii_painter/voxel_space.ts` (NEW file)
- Refactor Grid → VoxelSpace internally
- Keep single-layer default
- **Reuse:** GridCell, Grid types (extend, don't replace)

**Phase 2: Multi-Layer UI**
- Add layer panel to painter
- **Reuse:** Existing module system, input handling
- **New:** Layer palette module

**Phase 3: Camera Modes**
- Create camera abstraction
- Implement parallax ortho view
- **Reuse:** CanvasRuntime, compose_modules
- **Extend:** compose.ts for depth-sorting

**Phase 4: VoxelFileModule**
- Refactor PainterCanvasModule usage
- Create file-level abstraction
- **Reuse:** All existing tool modules
- **New:** VoxelFileModule orchestration

**Phase 5: Tool 3D Awareness**
- Add voxel query API
- "Replace top glyph" toggle
- **Reuse:** Existing tool implementations
- **New:** VoxelQuery interface

**Phase 6+: Future work**
- Multi-axis editing (rotated ortho)
- Animation
- Place integration

---

## Key Insight

**We're NOT rebuilding the rendering system.** We're:
1. Adding a data layer (VoxelSpace) above existing Grid
2. Adding camera abstraction above existing compose system  
3. Extending tools to query 3D data
4. Keeping all the existing rendering, input, and module infrastructure

The heavy lifting (CanvasRuntime, font rendering, input routing, module system) is DONE. We're adding 3D data management and view transformations on top.
