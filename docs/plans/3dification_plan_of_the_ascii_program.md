# 3Dification Plan of the ASCII Program

**Date:** 2026-02-28  
**Status:** 🟡 VISION/PLANNING - Architectural blueprint for voxel evolution  
**Priority:** High - Long-term architectural direction  
**Related Work:** ASCII Painter Layers (Phase 4+), Place System Integration

---

## Executive Summary

This plan charts the evolution of the ASCII Painter into a true 3D voxel-based creation environment. **3D is the fundamental reality** - there is no "2D mode" in the data model, only different camera projections. The current "2D" appearance is simply straight orthographic projection looking down the Z-axis.

**Core Principle:** The data is always 3D. Camera modes are view transformations, not data modes. We maintain familiar 2D-like editing workflows while building true volumetric capabilities.

**Key Insight:** What appears as "2D" is just one camera orientation (XY plane, Z-depth). In the future, users will rotate the view to edit on YZ (walls) or XZ (floors) planes, but the underlying data remains a 3D voxel grid.

---

## Current Architecture (What Exists)

```
┌─────────────────────────────────────┐
│         PainterCanvasModule         │
│  ┌───────────────────────────────┐  │
│  │        Grid (2D Array)        │  │
│  │  GridCell { char, rgb,        │  │
│  │            weight_index,      │  │
│  │            render_index }     │  │  ← Already exists!
│  └───────────────────────────────┘  │
│              ↓                      │
│  ┌───────────────────────────────┐  │
│  │   CanvasRuntime + Compose     │  │  ← Already exists!
│  │   - Module-based rendering    │  │
│  │   - Input routing             │  │
│  │   - Font rendering            │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

**Current State (FOUNDATION EXISTS):**
- ✅ Canvas system with `render_index` (0-255) already in Cell type
- ✅ Compose system (`compose_modules`) with last-write-wins
- ✅ CanvasRuntime with full rendering pipeline
- ✅ Module system with input routing
- ✅ Place system with `elevation` field (maps to Z-layer)
- ✅ ASCII Painter with tools, selection, history
- ⚠️ Single 2D grid per canvas module (need: multiple layers)
- ⚠️ No camera abstraction (need: view transformations)

**See:** `docs/plans/3dification_existing_architecture_analysis.md` for detailed analysis of what exists vs. what needs building.

---

## Target Architecture: Voxel Space (Building on Existing)

```
Z (Depth)
  ↑
  │   Layer 2 (z=2) ════════
  │   Layer 1 (z=1) ════════
  │   Layer 0 (z=0) ════════  ← Selected View Layer (focus plane)
  │   Layer -1 (z=-1) ═══════
  │   Layer -2 (z=-2) ═══════
  │
  └────────────────────────→ XY Plane

VoxelFileModule (NEW - orchestrates existing systems)
├─ VoxelSpace (NEW - extends existing Grid concept)
│  ├─ Layer Z=-2 ──→ LayerRendererModule ──┐
│  ├─ Layer Z=-1 ──→ LayerRendererModule   │
│  ├─ Layer Z=0  ──→ LayerRendererModule (Selected View) ─┤
│  ├─ Layer Z=+1 ──→ LayerRendererModule   │  EXISTING
│  └─ Layer Z=+2 ──→ LayerRendererModule ──┘  CanvasRuntime
│           ↓                                   + Compose
│    Camera (NEW - view transformation)         (unchanged)
│           ↓                                        ↑
│    Compositor (EXTENDS compose.ts) ────────────────┘
│           ↓
│    TypeGrid → Screen
└────────────────────────────────────────┘
```

**Key Point:** We're ADDING layers on top of EXISTING infrastructure, not replacing it.

---

## Core Concepts

### 1. Voxel Space as Fundamental Reality

**The Data Model is Always 3D.**

There is no "2D data" - only 3D data viewed with different camera projections. A "layer" is simply a Z-slice of the volumetric grid at a specific depth coordinate.

**Key Architectural Decision:**
```
Data:     Always 3D voxel grid (X, Y, Z coordinates)
              ↓
Camera:   View transformation (projection matrix)
              ↓
Display:  2D image on screen
```

**Current "2D" Editing:**
- Camera: Straight orthographic projection along Z-axis
- Selected View Layer: The Z-coordinate being edited
- Visual result: Appears flat (2D) but is actually a slice of 3D space

**Future Multi-Plane Editing:**
- Rotate camera 90° → Edit on YZ plane (X becomes depth)
- Rotate camera 90° → Edit on XZ plane (Y becomes depth)
- Same voxel data, different viewing angle
- Tools adapt to current orientation

### 2. Layer as Z-Slice

**Definition:** Each layer represents a discrete Z-coordinate in the volumetric grid.

**Characteristics:**
- Z=0 is the default "focus plane"
- Positive Z = closer to viewer (foreground)
- Negative Z = further from viewer (background)
- Each layer is a full XY grid at fixed Z
- Layer offset distance determines:
  - Draw order (back to front compositing)
  - Parallax magnitude in parallax orthographic mode
  - Depth of field blur amount (if DOF enabled)

**Storage Evolution (Building on Existing):**

```typescript
// EXISTING (src/mono_ui/types.ts)
interface Cell {
  char: string;
  weight_index: number;
  render_index: number;  // ← ALREADY EXISTS (0-255)
  style: StyleName;
  rgb: Rgb;
}

// EXISTING (src/ascii_painter/types.ts)  
interface Grid {
  width: number;
  height: number;
  cells: GridCell[][];  // [y][x]
}

// NEW - VoxelSpace wraps multiple Grids
interface VoxelSpace {
  bounds: {
    width: number;      // X dimension
    height: number;     // Y dimension  
    depth: number;      // Z dimension (number of layers)
  };
  layers: Layer[];      // Array of z-slices (each is a Grid)
  camera_config: CameraConfig;  // NEW
}

interface Layer {
  z: number;            // Z-coordinate
  cells: GridCell[][];  // [y][x] - REUSES existing Grid structure
  name?: string;
  visible: boolean;
  opacity: number;
}
```

**Key Point:** `render_index` already exists in Cell type! We'll use it for Z-ordering within the compositor.
```

### 3. Camera Modes (View Transformations)

**Critical Distinction:** Camera modes change how you VIEW the 3D data, not the data itself.

**Camera Mode 1: Straight Orthographic ("2D-like")**
- Projection: Perpendicular to XY plane, looking down Z-axis
- Display: All voxels collapse to their XY coordinates
- Result: Appears flat, traditional 2D ASCII look
- Use: Precise pixel-level editing, familiar workflow
- **The data is still 3D - you're just viewing it head-on**

**Camera Mode 2: Parallax Orthographic ("3D-ish")**
- Projection: Same orthographic camera, but render layers with horizontal offset
- Display: Each Z-layer offset by `parallax_factor × Z_distance`
- Result: Visual depth cues through parallax
- Use: Seeing spatial relationships between layers
- **Still viewing same 3D data, just with depth visualization**

**Camera Mode 3: Rotated Orthographic (Future)**
- Projection: Camera rotated to look down X-axis or Y-axis
- Display: Edit on YZ plane (walls) or XZ plane (floors)
- Result: True multi-axis editing
- Use: Drawing vertical surfaces, floor patterns
- **Same voxel grid, different orthographic face**

**Visual Representation:**
```
Straight Orthographic (XY plane view):
┌─────────────────────┐
│                     │
│   Z-layers stack    │  ← All Z-layers collapse to XY
│   into single view  │     (front-most visible)
│                     │
└─────────────────────┘

Parallax Orthographic (XY with depth cues):
┌─────────────────────┐
│ ░░░░░░░░░░░░░░░░░░ │  ← Z=-2 (shifted left by parallax)
│  ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ │  ← Z=-1 (shifted left less)
│   ████████████████ │  ← Z=0 (Selected View Layer, center)
│    ▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │  ← Z=+1 (shifted right)
│     ░░░░░░░░░░░░░░ │  ← Z=+2 (shifted right more)
└─────────────────────┘
        ↑
   Same 3D data, different camera projection

Rotated Orthographic (YZ plane view - Future):
┌─────────────────────┐
│ ░░░░░░░░░░░░░░░░░░ │  ← X=-2 (wall layers)
│  ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ │  ← X=-1
│   ████████████████ │  ← X=0 (Selected View on wall)
│    ▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │  ← X=+1
└─────────────────────┘
        ↑
   Camera looking down X-axis, editing on YZ plane
```

### 4. Selected View Layer (Focus Plane)

**Definition:** The Z-coordinate (or X/Y in rotated views) where editing operations occur.

**Behavior:**
- All editing tools operate on voxels at the Selected View Layer coordinate
- In straight orthographic: This is a Z-layer (XY plane at fixed Z)
- In rotated orthographic: This is an X-layer (YZ plane) or Y-layer (XZ plane)
- Changing Selected View Layer = "moving the edit plane through 3D space"
- Camera modes determine HOW you see the layers, Selected View Layer determines WHERE you edit

**Multi-Axis Editing (Future):**
```
Phase 1: Always XY plane editing (current plan)
  - Selected View Layer = Z-coordinate
  - Tools place voxels at (x, y, selected_z)

Phase 2+: Rotated editing (future)
  - Camera rotates 90°
  - Selected View Layer could be X-coordinate (for YZ plane)
  - Tools place voxels at (selected_x, y, z)
  - "Replace top glyph" works by querying voxel memory at screen position,
    determining which voxel is front-most at that XY regardless of Z
```

### 5. Layer-Per-Render-Plane Architecture

**Architecture (Building on Existing `compose_modules`):**

```
┌─────────────────────────────────────────────────────────┐
│                  VoxelFileModule                        │
│         (Represents an open graphics file)              │
│  ┌─────────────────────────────────────────────────┐    │
│  │            VoxelSpace (3D Data)                 │    │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐           │    │
│  │  │ Layer 0 │ │ Layer 1 │ │ Layer-1 │  ...      │    │
│  │  │ (Grid)  │ │ (Grid)  │ │ (Grid)  │           │    │
│  │  └─────────┘ └─────────┘ └─────────┘           │    │
│  └─────────────────────────────────────────────────┘    │
│                         ↓                               │
│  ┌─────────────────────────────────────────────────┐    │
│  │         LayerRendererModules (N instances)      │    │
│  │  ┌───────────────────────────────────────────┐  │    │
│  │  │  LayerRendererModule (one per layer)      │  │    │
│  │  │  - Renders its assigned layer's grid      │  │    │
│  │  │  - Applies depth effects (parallax, DOF)  │  │    │
│  │  │  - Sets render_index based on Z           │  │    │
│  │  └───────────────────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────┘    │
│                         ↓                               │
│  ┌─────────────────────────────────────────────────┐    │
│  │  Compositor (EXTENDS src/mono_ui/compose.ts)    │    │
│  │  - Depth-sort by render_index (Z-order)         │    │
│  │  - Back-to-front rendering (existing)           │    │
│  │  - Alpha blending                               │    │
│  │  - Final output to TypeGrid                     │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

**Separation of Concerns:**
1. **VoxelFileModule** - File-level operations, layer management (NEW)
2. **LayerRendererModules** - Per-layer rendering with depth effects (NEW)
3. **Compositor** - Final assembly (EXTENDS existing `compose_modules` in `src/mono_ui/compose.ts`)

### 6. Future Tool Adaptations (Multi-Axis Editing)

**The "Replace Top Glyph" Problem:**

When viewing in parallax orthographic mode, multiple layers are visible. Clicking on screen position (x, y) could hit voxels from multiple Z-layers. Tools need to adapt:

```typescript
// Current (Straight Ortho XY view):
// Screen (x, y) → Voxel (x, y, selected_z)

// Future with "Replace Top Glyph" toggle:
// Screen (x, y) → Query voxel memory:
//   - Which voxel is front-most at this screen position?
//   - Consider all Z-layers that project to (x, y)
//   - Return the one with highest Z (closest to viewer)
//   - Tool replaces THAT voxel, regardless of Selected View Layer
```

**Example - Pencil Tool with "Replace Top Glyph":**
1. User clicks at screen position (100, 50)
2. System queries all voxels that project to (100, 50)
3. Finds voxels at: (100, 50, Z=-2), (100, 50, Z=0), (100, 50, Z=+1)
4. Front-most is Z=+1
5. Pencil replaces voxel at (100, 50, +1) with brush
6. Selected View Layer doesn't change - tool intelligently targets visible voxel

**Multi-Axis Editing (Future):**
When camera rotates to view YZ plane (looking down X-axis):
- Selected View Layer becomes X-coordinate
- Tools edit on YZ plane at fixed X
- "Replace top glyph" queries which X-layer is front-most
- Same voxel data, different editing plane

**Why This Matters:**
- Users can edit "through" the parallax view naturally
- No need to switch Selected View Layer for every edit
- Tools become aware of 3D structure
- Foundation for drawing on walls, floors, ceilings seamlessly

### 7. Place System Integration

**Connection to Place System:**
The voxel space naturally maps to the Place system:

```
Place (Region Subdivision)
  └── VoxelFile (ASCII Graphics Asset)
       ├── Layers = Z-slices in the place
       ├── Each cell = potential position for:
       │   ├── Static geometry (walls, floors)
       │   ├── Props (furniture, decorations)
       │   └── Actor/NPC spawn points
       └── Animation frames = time dimension (see below)
```

**Use Cases:**
- Create place layouts with depth (foreground props, background scenery)
- Design encounter zones with cover at different depths
- Build multi-level places (elevation via layer system)

**Note on Place Module Rendering (Out of Scope):**
The Place module in the game will eventually use this same voxel rendering architecture. Places will render their VoxelFiles using the same LayerRendererModules and Compositor system described here. This ensures the editor and game share both data format and rendering pipeline. Implementation of Place module rendering is outside this plan's scope but the architecture is designed to support it.

---

## Animation Design Considerations

### The Challenge
Animation complicates everything. We need to design the storage system now to support it later without breaking changes.

### Voxel-Based Storage Advantage
**Why voxels work well for animation:**
- Each cell is an independent unit
- Animation = changing cell properties over time
- Calculations (collision, visibility) are grid-based and straightforward
- No mesh deformation complexity

### Time Dimension (Future)
```typescript
// Extension for animation support
interface AnimatedVoxelSpace extends VoxelSpace {
  frames: Frame[];      // Array of keyframes
  frame_rate: number;   // Playback speed
  loop: boolean;        // Animation loops?
}

interface Frame {
  index: number;        // Frame number
  duration: number;     // Display time (in ms or ticks)
  layer_changes: {      // Only store deltas for efficiency
    [z: number]: {
      [y: number]: {
        [x: number]: Partial<GridCell>  // Changed cells only
      }
    }
  };
}
```

### Animation Strategies
1. **Cell Property Animation** - Change char/rgb/weight per frame
2. **Layer Visibility Animation** - Toggle layer visibility for blinking/spawning
3. **Parallax Animation** - Shift layer offsets over time for pseudo-3D motion
4. **Z-Position Animation** - Move entities between layers (falling, jumping)

---

## Phase Implementation Plan

**Key Principle:** Each phase BUILDS ON existing infrastructure. We are NOT rebuilding:
- ✅ Canvas system (exists in `src/mono_ui/canvas.ts`)
- ✅ Rendering pipeline (exists in `src/mono_ui/runtime/canvas_runtime.ts`)
- ✅ Module system (exists in `src/mono_ui/types.ts`, `compose.ts`)
- ✅ Input routing (exists in CanvasRuntime)
- ✅ Font rendering (exists in CanvasRuntime)
- ✅ Cell types with render_index (exists in `src/mono_ui/types.ts`)
- ✅ Grid persistence (exists in `src/ascii_painter/save_system.ts`)

**What we ARE building:**
- 🆕 VoxelSpace data model (wraps multiple Grids)
- 🆕 Camera abstraction (view transformations)
- 🆕 LayerRendererModule (per-layer rendering)
- 🆕 VoxelFileModule (file-level orchestration)
- 🆕 Voxel query API (for "replace top glyph")

---

### Phase 0: Foundation (Current - Pre-Layers)
**Prerequisites:**
- ✅ ASCII Painter core (2D editing) - EXISTS
- ✅ Grid/Cell types - EXISTS  
- ✅ Tool system - EXISTS
- 🔄 Layer data structures (next immediate work)

**Goal:** Prepare codebase for 3D concepts without breaking 2D workflow.

---

### Phase 1: Layer Data Model
**Goal:** Implement true layer storage while maintaining 2D-only editing.

**Tasks:**
1. **Create VoxelSpace types** (`src/ascii_painter/voxel_space.ts`)
   - Define `VoxelSpace`, `Layer`, `LayerConfig` interfaces
   - Migration path from single Grid to Layer array
   - Default: Single layer at Z=0 (backward compatible)

2. **Update Storage Format**
   - Extend GridExport to support multiple layers
   - Version bump: `version: 2` for multi-layer support
   - Backward compatibility: Load v1 as single-layer v2

3. **Refactor PainterCanvasModule**
   - Internally use VoxelSpace (even if single layer)
   - All current tools work on Selected View Layer only
   - No UI changes yet - still looks like 2D

**Deliverables:**
- Data model supports layers
- Single-layer files still work
- Foundation for multi-layer features

---

### Phase 2: Multi-Layer Editing (Straight Orthographic)
**Goal:** Enable editing across multiple Z-layers using straight orthographic camera (appears "2D").

**Tasks:**
1. **Layer Management UI**
   - Layer palette/panel (list of Z-layers)
   - Add/Delete/Duplicate layer buttons
   - Layer reordering (changes Z-order)
   - Layer visibility toggle

2. **Selected View Layer Controls**
   - Visual highlight of active Z-layer
   - Keyboard shortcuts: Page Up/Down to change Z-layer
   - Layer name editing

3. **Straight Orthographic Rendering (Default)**
   - Camera perpendicular to XY plane, looking down Z-axis
   - All Z-layers collapse to XY (front-most visible at each position)
   - Selected View Layer is the Z-coordinate being edited
   - Optional: Ghost non-selected layers at low opacity

4. **Cross-Layer Operations**
   - Copy/paste between Z-layers
   - Merge layer down
   - Flatten all layers

**Deliverables:**
- Users can create/edit multiple Z-layers
- Straight orthographic editing feels like familiar 2D workflow
- Layer operations functional
- **Note:** Data is 3D, camera just makes it look 2D

---

### Phase 3: Camera Mode System
**Goal:** Implement camera mode switching (view transformations, not data modes).

**Tasks:**
1. **Camera Controller Architecture**
   - Abstract camera interface
   - Straight orthographic (default) - looks "2D"
   - Parallax orthographic - shows depth via layer offset
   - Camera is pure view transformation, data unchanged

2. **Parallax Orthographic Implementation**
   - Display all visible Z-layers
   - Calculate parallax offset: `offset = parallax_factor × Z_distance`
   - Depth-sort layers (back to front)
   - Configurable parallax intensity

3. **Camera Mode Toggle**
   - UI toggle: "Straight" ↔ "Parallax" (not "2D" ↔ "3D")
   - Hotkey: Toggle camera mode
   - Remember per-file preference
   - Clear visual indicator of current camera mode

4. **Depth of Field (Optional/Toggleable)**
   - Blur layers far from Selected View Layer
   - Configurable DOF range and intensity
   - Performance consideration: Shader-based blur?

5. **Camera/Viewport Controls**
   - Pan across the view
   - Zoom affects all layers uniformly
   - Rotation: Reserved for Phase 6+ (multi-axis editing)

**Visual Mockup:**
```
┌──────────────────────────────────────┐
│  ┌──────┐                            │
│  │Layer │ Name      │ Z │ Vis │ Opac │
│  ├──────┤────────────────────────────┤
│  │  ▓▓  │ Foreground │+2 │ [✓] │ 100%│
│  │  ██  │ Characters │+1 │ [✓] │ 100%│ ← Selected View Layer (Z=+1)
│  │  ▒▒  │ Midground  │ 0 │ [✓] │  80%│
│  │  ░░  │ Background │ -1│ [✓] │  60%│
│  │      │ Deep BG    │ -2│ [✓] │  40%│
│  └──────┘                            │
│                                      │
│  Camera: [Straight ▼]  Parallax: [--]│
│  When Parallax ON: [██████░░░] 70%   │
│  DOF: [Off ▼]                        │
│                                      │
│  NOTE: Data is always 3D. Camera     │
│  modes are view transformations.     │
└──────────────────────────────────────┘
```

**Deliverables:**
- Camera mode system implemented
- Straight orthographic (looks 2D) works
- Parallax orthographic (shows depth) works
- Clear distinction: Camera modes ≠ Data modes

---

### Phase 4: VoxelFileModule Architecture
**Goal:** Separate file representation from rendering.

**Tasks:**
1. **Create VoxelFileModule**
   - Encapsulates VoxelSpace data
   - File operations: New, Open, Save, Save As
   - Layer management API
   - Connected to "New File" button

2. **Refactor to LayerRendererModules**
   - Each layer gets its own render module
   - LayerRendererModule renders one z-slice
   - Applies depth effects (parallax offset)
   - Handles layer-specific input (when in 3D mode)

3. **Compositor System**
   - Merges all LayerRendererModule outputs
   - Depth-based alpha blending
   - Outputs final image to TypeGrid

4. **Canvas Bounds Management**
   - Define global canvas bounds (max X, Y, Z)
   - All layers constrained to bounds
   - Resize affects all layers

**Architecture:**
```
VoxelFileModule (high-level)
    ├── owns: VoxelSpace (data)
    ├── owns: LayerRendererModule[] (renderers)
    ├── owns: Compositor (output)
    └── API: save(), load(), addLayer(), etc.
```

**Deliverables:**
- Clean separation of data and rendering
- File-level operations centralized
- Ready for advanced features

---

### Phase 5: Tool 3D Awareness
**Goal:** Tools query voxel memory to work intelligently with 3D data.

**Core Concept:** Tools don't need "3D mode" - they need to be aware of the 3D voxel memory. Even in straight orthographic view, clicking at (x, y) on screen could conceptually hit multiple Z-layers.

**Phase 5a: Basic 3D Awareness (In Scope)**
1. **"Replace Top Glyph" Toggle (Per-Tool)**
   - When enabled: Tool queries which voxel is front-most at screen position
   - Works by checking all Z-layers that project to clicked XY
   - Replaces the visible voxel, regardless of Selected View Layer
   - Uses voxel memory to determine render order
   - **Example:** In parallax view, click on a tree - pencil replaces the tree voxel even if Selected View Layer is background

2. **Voxel Query API**
   ```typescript
   interface VoxelQuery {
     // Get front-most voxel at screen position
     getTopVoxel(screenX: number, screenY: number): Voxel | null;
     
     // Get all voxels at screen position (for selection)
     getVoxelsAtScreen(screenX: number, screenY: number): Voxel[];
     
     // Get voxel by world coordinates
     getVoxel(x: number, y: number, z: number): Voxel | null;
   }
   ```

**Phase 5b: Advanced 3D Tools (Future)**
- **3D Line:** Draw lines that traverse Z (diagonal in 3D space)
- **3D Box:** Create box volumes spanning multiple Z-layers
- **3D Fill:** Flood fill in 3D (6-connected or 26-connected)
- **3D Selection:** Select cuboid regions

**Phase 5c: Multi-Axis Tools (Future)**
- Tools adapt to current camera orientation
- When viewing YZ plane (rotated), pencil draws on YZ at fixed X
- "Replace top glyph" works on any axis (finds front-most along view direction)

**Deliverables:**
- "Replace top glyph" toggle on pencil and eraser
- Voxel query API for tools
- Tools work intelligently with 3D data even in "2D-looking" views
- Foundation for future multi-axis editing

---

### Phase 6: Multi-Axis Editing (Future)
**Goal:** Enable editing on YZ and XZ planes via camera rotation.

**Core Concept:** Rotate the camera to edit walls, floors, and ceilings as easily as editing the XY plane.

**Tasks:**
1. **Rotated Orthographic Cameras**
   - Camera looking down X-axis: Edit on YZ plane (walls)
   - Camera looking down Y-axis: Edit on XZ plane (floors/ceilings)
   - Maintain orthographic projection (no perspective distortion)
   - 90° rotation snapping for clean axis alignment

2. **Adaptive Grid Display**
   - When viewing YZ plane: Grid shows Y (vertical) and Z (depth)
   - When viewing XZ plane: Grid shows X (horizontal) and Z (depth)
   - Selected View Layer becomes the fixed axis coordinate (X or Y)

3. **Tool Adaptation**
   - All tools work on current view plane
   - "Replace top glyph" finds front-most voxel along view direction
   - Pencil draws on YZ or XZ plane at Selected View Layer coordinate

4. **Workflow Example: Drawing a Wall**
   ```
   Step 1: Straight orthographic (XY view) - draw floor plan
   Step 2: Rotate 90° to view YZ (looking down X)  
   Step 3: Selected View Layer = X coordinate of wall
   Step 4: Draw wall pattern on YZ plane (height and depth)
   Step 5: Rotate back to XY view to see result
   ```

**Visual Representation:**
```
XY Plane View (default):
┌─────────────────────┐
│  X →                │
│  ↓                  │
│  Y                  │
│                     │
│  Selected Z: +1     │
└─────────────────────┘

YZ Plane View (rotated):
┌─────────────────────┐
│  Y →                │
│  ↓                  │
│  Z                  │
│                     │
│  Selected X: 42     │
└─────────────────────┘
```

**Deliverables:**
- Camera rotation to view YZ and XZ planes
- Tools work on any orthographic plane
- Seamless workflow for multi-axis editing
- Foundation for true 3D asset creation

---

### Phase 7: Place System Integration
**Goal:** Connect voxel graphics to game places.

**Tasks:**
1. **Place-VoxelFile Association**
   - Place can reference a VoxelFile for its layout
   - VoxelFile stores place_id metadata
   - Bidirectional linking

2. **Place Rendering Pipeline**
   - Place system loads VoxelFile
   - Renders current state (with any dynamic changes)
   - Updates VoxelFile when place changes

3. **Dynamic Layer Manipulation**
   - Game events can toggle layer visibility
   - NPCs can exist on specific Z-layers
   - Movement between layers (stairs, ramps)

4. **Encounter Design Tools**
   - Mark spawn points per layer
   - Define cover/obstacles in 3D
   - Visualize line-of-sight across layers

**Hierarchy Relationship:**
```
Game Architecture (out of scope but noted):
PlaceModule (in-game)
  └── references: VoxelFile
       └── rendered via: LayerRendererModules + Compositor
            └── shared system with editor
```

**Deliverables:**
- Places can have 3D ASCII layouts
- Game and editor share format and rendering pipeline
- Dynamic layer control from game

---

### Phase 8: Animation Foundation (Future)
**Goal:** Prepare for frame-based animation.

**Tasks:**
1. **Frame Data Structure**
   - Design frame storage (deltas vs full grids)
   - Timeline UI concept
   - Frame management (add/duplicate/delete)

2. **Animation Preview**
   - Playback controls (play/pause/stop)
   - Frame navigation
   - Onion skinning (see prev/next frames)

3. **Export/Import**
   - Animated GIF export
   - Sprite sheet generation
   - Frame sequence export

**Note:** This phase is exploratory. The voxel storage format must support it, but full animation system is future work.

---

### Phase 9: Polish & Optimization
**Goal:** Production-ready 3D ASCII editor.

**Tasks:**
1. **Performance Optimization**
   - Lazy layer rendering (only render visible layers)
   - Dirty rect tracking
   - GPU acceleration for compositing (if needed)

2. **User Experience**
   - Tutorials for 3D concepts
   - Preset layer configurations
   - Templates for common patterns

3. **Integration Testing**
   - Place system integration tests
   - Large file performance (100+ layers)
   - Animation stress tests

**Deliverables:**
- Production-ready system
   - Documentation complete
   - Performance acceptable

---

## Data Flow Architecture

### Current Flow (2D) - EXISTS in `src/mono_ui/compose.ts`
```
User Input → Tool Logic → Grid Mutation → compose_modules() → draw_canvas() → Screen
                               ↑
                        CanvasRuntime.tick()
```

### Future Flow (3D with Orthographic) - EXTENDS existing flow
```
User Input → Tool Logic → VoxelSpace Mutation (Selected Z)
                                ↓
              ┌─────────────────┼─────────────────┐
              ↓                 ↓                 ↓
     LayerRenderer Z-2   LayerRenderer Z-1   LayerRenderer Z+1
              ↓                 ↓                 ↓
         (parallax)        (parallax)         (parallax)
              ↓                 ↓                 ↓
              └─────────────────┼─────────────────┘
                                ↓
    ┌─────────────────────────────────────────────────┐
    │  Compositor (extends src/mono_ui/compose.ts)    │
    │  - Depth-sort modules by render_index (Z-order) │
    │  - Back-to-front rendering (existing)           │
    │  - Merge layer outputs                          │
    └─────────────────────────────────────────────────┘
                                ↓
                     draw_canvas() (EXISTING)
                                ↓
                              Screen

Key: Existing systems in (EXISTING), New systems in normal text
```

---

## File Format Evolution (Building on Existing Save System)

### Version 1 (EXISTING - `src/ascii_painter/save_system.ts`)
```json
{
  "version": 1,
  "width": 80,
  "height": 40,
  "cells": [...]
}
```

### Version 2 (NEW - Extends existing format)
```json
{
  "version": 2,
  "type": "voxel_space",
  "bounds": {
    "width": 80,
    "height": 40,
    "depth": 5
  },
  "layers": [
    {
      "z": -2,
      "name": "Deep Background",
      "visible": true,
      "opacity": 0.5,
      "cells": [...]  // Same format as v1 cells
    },
    {
      "z": 0,
      "name": "Main",
      "visible": true,
      "opacity": 1.0,
      "cells": [...]  // Same format as v1 cells
    }
  ],
  "camera": {
    "mode": "straight_ortho",
    "selected_z": 0,
    "parallax_intensity": 0.7
  }
}
```

**Migration:** v1 files load as VoxelSpace with single layer at Z=0

### Version 3 (Animation - Future)
```json
{
  "version": 3,
  "type": "animated_voxel_space",
  "bounds": { ... },
  "layers": [ ... ],
  "camera": { ... },
  "animation": {
    "frame_rate": 12,
    "loop": true,
    "frames": [ ... ]
  }
}
```

---

## Implementation Dependencies

```
Phase 1 (Layer Data Model)
    ↓
Phase 2 (Multi-Layer Editing) - depends on data model
    ↓
Phase 3 (Camera Mode System) - depends on multi-layer
    ↓
Phase 4 (VoxelFileModule) - consolidates 1-3
    ↓
Phase 5 (Tool 3D Awareness) - optional, can work in straight ortho
    ↓
Phase 6 (Multi-Axis Editing) - future, requires Phase 5
    ↓
Phase 7 (Place Integration) - connects to game
    ↓
Phase 8 (Animation) - future, depends on solid foundation
    ↓
Phase 9 (Polish) - final production
```

**Key Architectural Decisions:**
- **Data is always 3D** - No "2D mode" in data model
- **Camera modes are views** - Not data transformations
- **Phases 1-4 establish foundation** - Everything else builds on this
- **Phase 6 (Multi-Axis) is the true 3D editing milestone** - Everything before is preparation

**Parallel Work:**
- Place System (independent, but needs integration point in Phase 7)
- Renderer optimizations (benefits all camera modes)
- Place Module rendering (out of scope, but shares architecture)

---

## Technical Considerations

### Memory Usage
- Each layer = width × height cells
- Default: 80×40 = 3,200 cells per layer
- With 10 layers: 32,000 cells
- With 100 layers: 320,000 cells
- **Mitigation:** Lazy loading, layer streaming, compression

### Performance
- Orthographic mode renders N layers instead of 1
- **Optimization strategies:**
  1. Only render visible layers
  2. Skip empty/transparent layers
  3. Cache composed frames when idle
  4. Use spatial hashing for large spaces

### Backward Compatibility
- V1 files load as single-layer V2
- Editor can save in V1 format (flattened)
- Warning when saving multi-layer as V1

### Coordinate System
- **X:** Horizontal (left to right)
- **Y:** Vertical (top to bottom) - Note: Screen coords
- **Z:** Depth (negative = background, positive = foreground)
- **Origin:** Top-left of layer at Z=0

---

## UI/UX Design Notes

### Layer Panel Layout
```
┌─────────────────────────────────────┐
│ Layers                    [+][▼][×] │
├─────────────────────────────────────┤
│ ▓▓ Foreground    +2 [👁][🔒] 100%  │
│ ██ Characters    +1 [👁][🔓] 100% ▶│ ← Selected
│ ▒▒ Midground      0 [👁][🔓]  80%  │
│ ░░ Background    -1 [👁][🔓]  60%  │
│    Deep BG       -2 [  ][🔓]  40%  │
├─────────────────────────────────────┤
│ Mode: [2D ▼]  Parallax: [███░░]    │
│ DOF: [Off ▼]  Focus: [On Selected]  │
└─────────────────────────────────────┘

[👁] = Visibility toggle
[🔒/🔓] = Lock toggle
▶ = Selected View Layer
```

### Visual Feedback
- Selected View Layer: Highlighted border
- Locked layers: Grayed out, non-editable
- Hidden layers: Not rendered (or ghosted)
- Parallax: Obvious horizontal shift in 3D mode
- Depth of field: Blur increases with distance

### Keyboard Shortcuts
- `Page Up/Down` - Change Selected View Layer
- `Ctrl+L` - Toggle layer panel visibility
- `Ctrl+Shift+N` - New layer
- `Ctrl+Shift+D` - Duplicate current layer
- `Ctrl+Shift+E` - Merge layer down
- `Tab` - Toggle orthographic view
- `1-9` - Quick select layer by index

---

## Success Criteria

### Phase Success Metrics

**Phase 1:**
- [ ] VoxelSpace data model implemented
- [ ] Backward compatibility maintained
- [ ] Single-layer files still work

**Phase 2:**
- [ ] Can create/edit multiple layers
- [ ] Layer management UI functional
- [ ] 2D editing experience preserved

**Phase 3:**
- [ ] Camera mode system works
- [ ] Straight orthographic (default) functional
- [ ] Parallax orthographic shows depth
- [ ] Camera modes clearly labeled as views, not data modes

**Phase 4:**
- [ ] VoxelFileModule separates concerns
- [ ] LayerRendererModules functional
- [ ] Compositor produces correct output

**Phase 5:**
- [ ] "Replace top glyph" toggle on pencil/eraser
- [ ] Voxel query API for tools
- [ ] Tools work intelligently with 3D data

**Phase 6:**
- [ ] Camera rotates to view YZ and XZ planes
- [ ] Tools work on any orthographic plane
- [ ] Multi-axis editing workflow functional
- [ ] **This is the true 3D editing milestone**

**Phase 7:**
- [ ] Place system can load VoxelFiles
- [ ] Dynamic layer control from game
- [ ] Encounter design tools functional
- [ ] Hierarchy with Place Module established

**Phase 8:**
- [ ] Frame data structure defined
- [ ] Animation preview working
- [ ] Export formats supported

**Phase 9:**
- [ ] Performance acceptable with large files
- [ ] No critical bugs
- [ ] Documentation complete

### Overall System Success
1. ✅ Data model is fundamentally 3D (not 2D with 3D bolted on)
2. ✅ Camera modes are view transformations, not data modes
3. ✅ Straight orthographic editing feels fast and intuitive
4. ✅ Parallax orthographic adds depth visualization value
5. ✅ File format supports future multi-axis editing and animation
6. ✅ Place system integration seamless
7. ✅ Performance acceptable for production use
8. ✅ Backward compatibility preserved (v1 files load into 3D model)

---

## Risk Assessment

### Risk: Complexity Overwhelm
**Mitigation:** 
- Default camera: Straight orthographic (looks familiar/2D-like)
- Advanced camera modes are toggleable, not default
- Clear visual indicators of camera orientation
- Progressive disclosure: simple features first, advanced later

### Risk: Performance Issues
**Mitigation:**
- Lazy rendering
- Profiling at each phase
- Optimization phase dedicated

### Risk: Breaking Existing Work
**Mitigation:**
- Comprehensive backward compatibility
- Import/export tools
- Clear migration path

### Risk: Place System Mismatch
**Mitigation:**
- Coordinate with Place system design
- Flexible integration points
- Both systems can exist independently

### Risk: Animation Never Implemented
**Mitigation:**
- Animation is phase 7 (late)
- Voxel storage is useful without animation
- Don't over-engineer for uncertain future

---

## Next Immediate Actions

1. **Review this plan** - Does the 3D-as-fundamental vision align with goals?
2. **Clarify camera terminology** - Ensure "straight orthographic" vs "parallax orthographic" language is clear
3. **Begin Phase 1** - Start with VoxelSpace types (always 3D data model)
4. **Design voxel query API** - Needed for Phase 5 "replace top glyph" feature
5. **Coordinate with Place System** - Ensure hierarchy relationship is understood
6. **Refine as we learn** - This plan will evolve during implementation

## Key Architectural Principles (Summary)

1. **Data is Always 3D** - The VoxelSpace is a 3D grid. Period.
2. **Camera Modes are Views** - Not data transformations, just different projections
3. **Straight Orthographic Looks "2D"** - But it's just one camera angle of 3D data
4. **Parallax Orthographic Shows Depth** - Same data, different visualization
5. **Multi-Axis Editing is the Goal** - Rotate camera to edit walls, floors, ceilings
6. **Tools Query Voxel Memory** - "Replace top glyph" finds visible voxels intelligently
7. **Place Module Will Share This** - Game rendering uses same architecture (out of scope)

---

## Open Questions

1. **Z-range limits?** How many layers is too many? (Memory vs utility tradeoff)
2. **Parallax math?** Linear offset or perspective-correct parallax?
3. **DOF implementation?** CPU blur or shader-based?
4. **Animation compression?** Store deltas or full frames per keyframe?
5. **Place system bidirectional sync?** Who owns the master data - editor or game?
6. **Multi-place VoxelFiles?** One file = one place, or can span places?
7. **Multi-axis editing priority?** When do we implement rotated orthographic views?
8. **Tool adaptation strategy?** Per-tool "3D awareness" toggles or global modes?
9. **Voxel addressing?** How to reference specific voxels across camera rotations?
10. **Hierarchy relationship?** How does VoxelFileModule relate to Place module in the game architecture?

---

## Appendix A: Glossary

- **Voxel:** Volume pixel - a point in 3D grid space with X, Y, Z coordinates
- **Layer:** A 2D grid at a specific Z-coordinate (XY plane slice)
- **Selected View Layer:** The coordinate plane (Z, X, or Y) currently being edited
- **Camera Mode:** View transformation applied to 3D data (not a data mode)
- **Straight Orthographic:** Camera perpendicular to XY plane, looking down Z-axis (appears "2D")
- **Parallax Orthographic:** Same as straight but with horizontal layer offset for depth visualization
- **Rotated Orthographic:** Camera looking down X or Y axis, editing on YZ or XZ planes
- **Parallax:** Visual effect where distant Z-layers have horizontal offset
- **Depth of Field (DOF):** Blur effect based on distance from focus plane
- **Compositor:** System that merges layer renders into final image
- **VoxelSpace:** The 3D data structure containing all voxels
- **VoxelFile:** Saved file format for VoxelSpace
- **Replace Top Glyph:** Tool mode that targets front-most visible voxel regardless of Selected View Layer

---

## Appendix B: Related Systems

### Place System (2026_02_02_place_system_plan.md)
- Provides spatial context for voxel graphics
- Places contain VoxelFiles for layout
- NPCs positioned in 3D space via layer system

### ASCII Painter Plan (2026_02_25_ascii_painter_and_logging_plan.md)
- Current 2D implementation foundation
- Tool system to be extended for 3D
- Renderer to support orthographic mode

### MonoUI/Canvas System
- `render_index` will map to Z-order
- Composition changes from 2D to 3D-aware
- TypeGrid remains final output target

---

*This document is a living plan. As implementation progresses, update with learnings, adjust phases, and refine the vision based on what works.*
