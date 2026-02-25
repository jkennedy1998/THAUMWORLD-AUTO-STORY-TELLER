# Bug Fixes and System Clarity for Items

**Date:** 2026-02-25  
**Status:** Planning Phase  
**Priority:** Critical  
**Estimated Duration:** 1-2 Days  
**Related Plans:** 2026_02_22_character_module_rework.md, 2026_02_19_inventory_movement_plan.md

---

## 1. Executive Summary

This plan addresses 13 distinct issues discovered in the grid-based sparse inventory system implemented in February 2026. While the system allows items to be placed at arbitrary grid positions (like Minecraft), several critical bugs prevent it from working correctly, particularly for nested containers and body slot equipment.

### Current State
- ✅ Grid coordinate fields exist in data structures
- ✅ API endpoints accept grid coordinates  
- ✅ Frontend calculates grid positions
- ✅ **Coordinate system is consistent and working** (Uses bottom-left origin, see Appendix)
- ❌ Backend logic prioritizes wrong transfer branch (Issue #1)
- ❌ Nested containers lack grid support entirely (Issue #3)
- ❌ Grid coordinates not initialized for packed items on container open (Issue #5)

### Goal
Fix all 13 issues to achieve a fully functional sparse inventory system where:
- Items can be dragged to any grid position within a container
- Positions persist correctly across saves/loads
- Nested containers (bags, pouches) work identically to regular containers
- Visual positions match stored positions exactly
- Coordinate system is properly documented for developers

---

## 2. Issue Inventory

### 🔴 CRITICAL (Break Core Functionality)

#### Issue #1: Backend Logic Order - Grid Coordinates Ignored for Body Slot Containers
**Location:** `src/container_storage/store.ts:732-768`
**Impact:** Items in body slot containers can never use grid-based positioning
**Severity:** 🔴 CRITICAL

**Problem:**
The conditional branches in `transfer_item_between_containers()` check body slot swapping BEFORE same-container grid placement:

```typescript
// Line 732 - Runs FIRST
} else if (dest_contents.length >= 1 && is_body_slot_container(from_container_id) && ...) {
    // Body slot swap logic
    
// Line 768 - Runs SECOND (never reached for body slot containers)
} else if (is_same_container && target_grid_x !== undefined && target_grid_y !== undefined) {
    // Grid placement logic - NEVER REACHED
```

**Fix:**
- [ ] Reorder conditionals: Check `is_same_container && grid_coords` BEFORE body slot check
- [ ] Ensure grid coordinates take priority for same-container transfers
- [ ] Add debug logging to verify correct branch is taken

**Testing:**
- [ ] Drag item within equipped sack (nested in body slot) to different position
- [ ] Verify `DEBUG-GRID` logs show "Entering grid-based sparse placement logic"
- [ ] Verify item appears at drop location, not swapped
- [ ] Reload and verify position persists

---

#### Issue #2: Coordinate System Documentation Gap
**Location:** N/A - System works correctly but lacks documentation
**Impact:** Developer confusion about coordinate system
**Severity:** 🟢 LOW

**Problem:**
The coordinate system is actually **consistent and working correctly** across all modules. However, this is not documented, leading to confusion about how coordinates work.

**Current System (CORRECT):**
- **Canvas Coordinates:** Bottom-left origin (0,0), Y increases UP
  - Used by: All UI modules (Container, Character, Place)
  - Conversion: Only in `canvas_runtime.ts` (screen → canvas) and `canvas.ts` (canvas → array)
- **Grid Coordinates:** Top-left conceptually, stored as grid_x/grid_y
  - Used for: Sparse inventory positioning (Minecraft-style)
  - Independent of canvas coordinates - these are FEATURE coordinates

**Why It Works:**
All modules use the **same Canvas coordinate system** (bottom-left origin):
- `container_module.ts` - Slots positioned with row 0 at bottom
- `character_module.ts` - Body slots with head at top (higher Y)
- `canvas_runtime.ts` - Converts mouse to canvas coordinates once
- No conversion needed between modules - they all use the same system!

**Fix:**
- [ ] Document the coordinate system in AGENTS.md (see Appendix)
- [ ] Add comments in key files explaining the system
- [ ] No code changes needed - system is already correct!

**Testing:**
- [ ] Verify all modules use same coordinate system (bottom-left origin)
- [ ] Confirm no coordinate conversion needed between modules
- [ ] Verify documentation is clear and accurate

---

### 🟠 HIGH (Cause Data Inconsistency)

#### Issue #3: Nested Containers Lack Grid Support
**Location:** `src/container_storage/store.ts:622-626, 663-667`
**Impact:** Items in bags/pouches always use packed behavior
**Severity:** 🟠 HIGH

**Problem:**
Nested containers (item.xxx) bypass grid coordinate handling:

```typescript
// Lines 622-626
if (from_item_entry && from_item_entry.instance.container_data) {
    source_contents = from_item_entry.instance.container_data.contents;
    // No grid_x/grid_y extraction!
}
```

**Fix:**
- [ ] Ensure `container_data.contents` includes grid_x/grid_y fields
- [ ] Add grid coordinate logic for nested container transfers
- [ ] Verify parent container saves nested container data correctly

**Testing:**
- [ ] Open nested container (sack on leg)
- [ ] Verify items initially load without grid coordinates
- [ ] Move item to new position
- [ ] Verify grid coordinates saved in parent container JSON
- [ ] Close and reopen container
- [ ] Verify item appears at saved grid position

---

#### Issue #4: Stacking Ignores Grid Coordinates
**Location:** `src/container_storage/store.ts:716-731`
**Impact:** Stacks don't move to drop position
**Severity:** 🟠 HIGH

**Problem:**
When stacking, quantities merge but position stays at target's original location:

```typescript
if (target_stack_index >= 0) {
    // Merge quantities
    target_entry.instance.qty = combined_qty;
    source_contents.splice(item_index, 1);
    // Grid coordinates ignored!
}
```

**Fix:**
- [ ] If target_grid_x/y provided, move stack to that position
- [ ] Update target_entry.grid_x and target_entry.grid_y
- [ ] Or reject stack if specific position requested

**Testing:**
- [ ] Place stackable item A at position (0,0)
- [ ] Place stackable item B at position (2,1)  
- [ ] Drag B onto A
- [ ] Verify combined stack appears at (2,1) [dropped position]
- [ ] OR verify position stays at (0,0) with clear UX feedback

---

#### Issue #5: Stale Data on Container Open
**Location:** `src/canvas_app/app_state.ts:2768-2806`
**Impact:** Items "jump" after first interaction
**Severity:** 🟠 HIGH

**Problem:**
Initial render uses data without grid coordinates. After first move, refresh loads correct data:

```typescript
// Initial open: items have no grid coordinates
[DEBUG-GRID] Mapping item pants to slot 0 (packed, no grid coords)

// After move: items have grid coordinates  
[DEBUG-GRID] Mapping item tunic to slot 6 from grid(1,1)
```

**Fix:**
- [ ] Initialize grid coordinates for ALL items on container open
- [ ] Set grid_x/grid_y based on current array index (packed → sparse conversion)
- [ ] Save container immediately after initialization

**Testing:**
- [ ] Open container with 6 items
- [ ] Verify all items have grid coordinates assigned immediately
- [ ] No "packed, no grid coords" messages in logs
- [ ] Move one item
- [ ] Verify other items don't change position

---

#### Issue #6: Unclear When to Use slot_index vs grid_x/grid_y
**Location:** Multiple files
**Impact:** Confusion about which coordinate type to use for different operations
**Severity:** 🟡 MEDIUM

**Problem:**
API uses both slot_index and grid_x/grid_y for different purposes, but this distinction is not documented:

```typescript
// Some transfers use slot_index:
transfer_body.to_slot_index = slot_index;

// Others use grid coordinates:
transfer_body.target_grid_x = grid_x;
transfer_body.target_grid_y = grid_y;
```

**When to Use Each:**

1. **slot_index** - For PACKED array operations
   - Use when: Moving items between containers (packed behavior)
   - Use when: Legacy transfers without sparse positioning
   - Represents: Linear position in packed array
   - Calculation: `slot_index = row * cols + col`

2. **grid_x/grid_y** - For SPARSE positioning
   - Use when: Same-container transfers with specific positioning
   - Use when: Minecraft-style inventory (items anywhere in grid)
   - Represents: Column and row in grid (0,0 = top-left)
   - Calculation: `grid_x = slot_index % cols`, `grid_y = Math.floor(slot_index / cols)`

**Fix:**
- [ ] Document when to use each coordinate type
- [ ] Add inline comments to API calls explaining the choice
- [ ] No code changes needed - clarify usage only

**Testing:**
- [ ] Review all API calls and verify correct coordinate type is used
- [ ] Document why each transfer type uses its specific coordinates
- [ ] Ensure documentation is clear for future developers

---

### 🟡 MEDIUM (Cause Confusion/Inconsistency)

#### Issue #7: Missing slot_index in API Calls
**Location:** `src/canvas_app/app_state.ts:1988-1991`
**Impact:** Backend validation may fail
**Severity:** 🟡 MEDIUM

**Problem:**
Some transfers don't include slot indices:

```typescript
body: JSON.stringify({
    item_instance_id: drag_state.item_instance_id,
    from_container: drag_state.source_container_id,
    to_container: target_container_id,
    // Missing from_slot_index and to_slot_index!
})
```

**Fix:**
- [ ] Add from_slot_index to all drag start contexts
- [ ] Add to_slot_index to all drop handlers
- [ ] Verify backend validation works correctly

**Testing:**
- [ ] Attempt to drag item onto itself (same slot)
- [ ] Verify backend rejects with "Cannot drop item on the same slot"
- [ ] Test with different transfer types

---

#### Issue #8: Race Condition in Container Opening
**Location:** `src/canvas_app/app_state.ts:2611-2618, 2952-2954`
**Impact:** Potential duplicate container modules
**Severity:** 🟡 MEDIUM

**Problem:**
Lock release timing allows race condition:

```typescript
// Module added to open_containers here
ui_state.container.open_containers.add(container_id);

// ... async operations ...

// Lock released in finally
ui_state.container.opening_containers.delete(container_id);
```

**Fix:**
- [ ] Move lock release before adding to open_containers
- [ ] OR use different lock mechanism

**Testing:**
- [ ] Rapidly double-click container multiple times
- [ ] Verify only one container module opens
- [ ] Check logs for "already being opened" message

---

#### Issue #9: Inconsistent Array References
**Location:** `src/container_storage/store.ts:657-662, 774-775`
**Impact:** Code clarity, potential bugs
**Severity:** 🟡 MEDIUM

**Problem:**
Same array referenced by different variable names:

```typescript
dest_contents = source_contents;  // Same array
// ...
const contents = source_contents;  // Same array, different name
```

**Fix:**
- [ ] Use consistent variable naming
- [ ] Document that same array is intentional for same-container transfers

**Testing:**
- [ ] Code review - verify no functional change
- [ ] Test same-container transfer
- [ ] Verify changes reflect immediately (same array reference working)

---

#### Issue #10: Overly Broad Body Slot Detection
**Location:** `src/container_storage/store.ts:408-416`
**Impact:** May match wrong containers
**Severity:** 🟡 MEDIUM

**Problem:**
Checks only last part of container ID:

```typescript
function is_body_slot_container(container_id: string): boolean {
    const slot_name = parts[parts.length - 1]!;
    return body_slots.includes(slot_name);
}
// Would match: container.place.town.hand_left (wrong!)
```

**Fix:**
- [ ] Check full pattern: `container.{actor_id}.{slot_name}`
- [ ] Verify parts[0] === 'container' and parts[1] contains actor ID
- [ ] Ensure slot_name is exactly one of the 6 body slots

**Testing:**
- [ ] Create test with container ID: `container.place.town.hand_left`
- [ ] Verify `is_body_slot_container()` returns false
- [ ] Verify `container.henry_actor.hand_left` returns true

---

### 🟢 LOW (Code Quality)

#### Issue #11: Debug Logging in Production
**Location:** Multiple files
**Impact:** Console clutter
**Severity:** 🟢 LOW

**Problem:**
Extensive [DEBUG-GRID] logging left in code:

```typescript
debug_log(`[DEBUG-GRID] Mapping item ${item.instance?.def_id} to slot ${slot_index}...`);
```

**Fix:**
- [ ] Remove or reduce DEBUG-GRID logging
- [ ] Keep only error logging
- [ ] OR make debug logging conditional on environment

**Testing:**
- [ ] Run application
- [ ] Verify console not flooded with DEBUG-GRID messages
- [ ] Check that errors still appear in logs

---

#### Issue #12: Inconsistent Capacity Checking
**Location:** `src/container_storage/store.ts:683-702`
**Impact:** Nested containers may bypass limits
**Severity:** 🟢 LOW

**Problem:**
If `container_data.capacity` is undefined, no capacity check occurs.

**Fix:**
- [ ] Add default capacity for nested containers (e.g., 10 slots)
- [ ] Ensure all containers have capacity defined

**Testing:**
- [ ] Create nested container without capacity
- [ ] Attempt to add items beyond reasonable limit
- [ ] Verify capacity enforcement works

---

#### Issue #13: Documentation Gap
**Location:** N/A
**Impact:** Developer confusion
**Severity:** 🟢 LOW

**Problem:**
No documentation explaining:
- Coordinate system (grid vs slot vs array index)
- Transfer flow through system
- When to use grid_x/y vs slot_index

**Fix:**
- [ ] Document coordinate systems in code comments
- [ ] Create architecture diagram
- [ ] Add inline comments explaining transfer branches

**Testing:**
- [ ] Review documentation for clarity
- [ ] Have another developer review for understanding

---

## 3. Coordinate System Clarification (Issues #2, #6)

### 3.1 Discovery: Coordinate System is Already Correct!

**IMPORTANT FINDING:** After comprehensive code review, the coordinate system is **already consistent and working correctly** across all modules. No code changes are needed for Issues #2 and #6 - only documentation.

### 3.2 Current Coordinate System (Correct)

**Canvas Coordinate System:**
- **Origin:** Bottom-left (0, 0)
- **+X:** Rightward
- **+Y:** Upward
- **Mental Model:** Cartesian coordinates (like math/graphs)

```
Canvas Coordinate System:
  Y+ ↑
     |
  10 |
   9 |
   8 |
   7 |
   6 |
   5 |
   4 |
   3 |
   2 |
   1 |
   0 +--------→ X+
     0 1 2 3 4
```

**Why This Works:**
1. ✅ Used consistently across ALL UI modules
2. ✅ Single conversion point: `canvas_runtime.ts` (screen → canvas)
3. ✅ All modules receive same coordinate system
4. ✅ No conversion needed between modules
5. ✅ Hit detection matches rendering perfectly

### 3.3 Coordinate Flow (Already Correct)

```
Screen Pixels (top-left origin)
    ↓ mouse_to_tile() in canvas_runtime.ts
Canvas Coordinates (bottom-left origin) ← ALL MODULES USE THIS
    ↓ to_index() in canvas.ts
Array Index (row-major storage)
```

**Key Insight:** All UI modules use the SAME coordinate system. No conversions needed between modules!

### 3.4 What We Thought Was Wrong

**Misconception:** "Grid coordinates and Canvas coordinates are fighting"

**Reality:** 
- Canvas coordinates = UI positioning (all modules use this)
- Grid coordinates (grid_x, grid_y) = FEATURE for sparse inventory (Minecraft-style)
- They're DIFFERENT PURPOSES, not different systems!

**Analogy:**
- Canvas coordinates = Where to draw on screen (like CSS pixels)
- Grid coordinates = Where item is stored logically (like database row/column)

### 3.5 When to Use Each Coordinate Type

**slot_index:**
- Linear position in packed array
- Use for: Legacy transfers, packed containers
- Calculation: `slot_index = row * cols + col` (where row 0 is at bottom in canvas Y)

**grid_x/grid_y:**
- Logical grid position for sparse inventory
- Use for: Same-container repositioning (Minecraft-style)
- Storage: Row 0 = top slot visually, Row N = bottom slot visually
- Independent of canvas coordinates - these are DATA, not SCREEN positions

**Canvas coordinates (x, y):**
- Screen positioning for rendering and hit detection
- Use for: Everything UI-related
- All modules already use this consistently

### 3.6 Files That DON'T Need Changes (Already Correct)

- ✅ `src/mono_ui/canvas.ts` - Coordinate system is correct
- ✅ `src/mono_ui/modules/container_module.ts` - Uses correct coordinates
- ✅ `src/mono_ui/modules/character_module.ts` - Uses correct coordinates
- ✅ `src/mono_ui/runtime/canvas_runtime.ts` - Coordinate conversion is correct

### 3.7 What We Actually Need to Do

**Only Documentation:**
- [ ] Document coordinate system in AGENTS.md (see Appendix)
- [ ] Add inline comments explaining the system
- [ ] Clarify difference between Canvas coords (UI) and Grid coords (data)
- [ ] No code changes needed!

**Why This Matters:**
Without understanding the coordinate system, developers might:
1. Think there's a bug when there isn't
2. Try to "fix" working code
3. Waste time debugging non-issues
4. Introduce actual bugs by "fixing" what isn't broken

---

## 4. Implementation Phases

### Phase 1: Critical Fixes (Day 1 Morning)
**Goal:** Make basic grid system functional

1. [ ] **Fix Issue #1:** Reorder backend conditionals
   - Move grid coordinate check before body slot check
   - Test with body slot container
   - Verify grid coordinates work

2. [ ] **Test Phase 1:**
   - [ ] Drag item within equipped sack to new position
   - [ ] Verify appears at correct position
   - [ ] Reload and verify position persists
   - [ ] Verify no coordinate system issues (system already correct)

---

### Phase 2: Nested Container Support (Day 1 Afternoon)
**Goal:** Make nested containers work like regular containers

1. [ ] **Fix Issue #3:** Add grid support for nested containers
   - Ensure container_data.contents preserves grid_x/y
   - Add grid logic to nested transfer path
   - Test nested container specifically

2. [ ] **Fix Issue #5:** Initialize grid coordinates on open
   - Convert packed items to sparse on container open
   - Save immediately after initialization
   - Test with fresh container

3. [ ] **Test Phase 2:**
   - [ ] Open sack on leg
   - [ ] Verify items have grid coordinates
   - [ ] Move items within sack
   - [ ] Close and reopen, verify positions

---

### Phase 3: Consistency & Edge Cases (Day 2 Morning)
**Goal:** Ensure system is robust and consistent

1. [ ] **Fix Issue #2 & #6:** Document coordinate system (no code changes needed!)
   - Add coordinate system documentation to AGENTS.md (see Appendix)
   - Add inline comments explaining when to use slot_index vs grid_x/y
   - Verify all modules already use consistent coordinate system (bottom-left origin)
   - **NOTE:** Coordinate system is already correct - just needs documentation

2. [ ] **Fix Issue #4:** Make stacking respect grid coordinates
   - Move stack to drop position
   - OR provide clear UX feedback
   - Test stacking behavior

3. [ ] **Fix Issues #7-10:** Fix remaining medium issues
   - Add missing slot_index to API calls
   - Fix race condition
   - Standardize array references
   - Fix body slot detection

4. [ ] **Test Phase 3:**
   - [ ] Test all transfer types
   - [ ] Test edge cases (double-click, same slot, etc.)
   - [ ] Verify no regressions

---

### Phase 4: Cleanup & Documentation (Day 2 Afternoon)
**Goal:** Production-ready code

1. [ ] **Fix Issues #11-13:** Cleanup and documentation
   - Remove excessive debug logging
   - Add capacity defaults
   - Write documentation

2. [ ] **Final Testing:**
   - [ ] Complete system test
   - [ ] Verify all 13 issues resolved
   - [ ] Performance check
   - [ ] Code review

3. [ ] **Documentation:**
   - [ ] Update relevant plan files
   - [ ] Mark items complete in this plan
   - [ ] Write user-facing documentation if needed

---

## 4. Files to Modify

### Primary Files (Expect Changes)
- [ ] `src/container_storage/store.ts` - Transfer logic (Issues #1, #3, #4, #9, #10, #12)
- [ ] `src/canvas_app/app_state.ts` - State management (Issues #5, #7, #8, #11)

### Secondary Files (Minor Changes)
- [ ] `src/types/container.ts` - Type definitions (Issue #13)
- [ ] `src/interface_program/main.ts` - API endpoint (Issue #6)
- [ ] `AGENTS.md` - Document coordinate system (Issue #2, #6)
- [ ] Code comments throughout (Issue #2, #6, #13)

### Files That DON'T Need Changes (Already Correct!)
- ✅ `src/mono_ui/canvas.ts` - Coordinate system is correct
- ✅ `src/mono_ui/modules/container_module.ts` - Uses correct coordinates
- ✅ `src/mono_ui/modules/character_module.ts` - Uses correct coordinates
- ✅ `src/mono_ui/runtime/canvas_runtime.ts` - Coordinate conversion is correct

### Test Files (Add Tests)
- [ ] `src/tools/test_container_module.ts` - Update tests
- [ ] Create new test: `src/tools/test_item_transfers.ts`

---

## 5. Testing Strategy

### Unit Tests (Per Fix)
Each fix should include:
1. [ ] Test case that reproduces the bug
2. [ ] Test case that verifies the fix
3. [ ] Edge case tests

### Integration Tests (Per Phase)
Each phase should include:
1. [ ] Manual test of complete workflow
2. [ ] Cross-browser testing (if applicable)
3. [ ] Save/load persistence test

### Regression Tests (Final)
Before completion:
1. [ ] Test all inventory operations:
   - [ ] Open/close containers
   - [ ] Drag within container
   - [ ] Drag between containers
   - [ ] Equip to body slot
   - [ ] Unequip from body slot
   - [ ] Stack items
   - [ ] Split stacks (if supported)
   - [ ] Nested containers

2. [ ] Verify no console errors
3. [ ] Verify logs are clean (no DEBUG spam)

---

## 6. Risk Assessment

### High Risk
- **Logic order change (Issue #1):** Could break body slot swaps if not done carefully
- **Coordinate inversion (Issue #2):** Could invert all existing item positions

**Mitigation:**
- Test with backup of data
- Consider data migration if needed
- Add feature flag to revert quickly

### Medium Risk
- **Nested container changes (Issue #3):** Could corrupt save data
- **API changes (Issue #6):** Could break external integrations

**Mitigation:**
- Version API changes
- Backup saves before testing
- Test on copy of production data

### Low Risk
- **Debug logging removal (Issue #11):** No functional impact
- **Documentation (Issue #13):** No code changes

---

## 7. Success Criteria

### Must Have (Critical Issues)
- [ ] Items can be dragged to any grid position in same container
- [ ] Visual position matches stored position exactly
- [ ] Positions persist across save/load
- [ ] Nested containers (bags) work identically to regular containers

### Should Have (High Priority)
- [ ] **Coordinate System Documentation:**
  - [ ] AGENTS.md documents the coordinate system (bottom-left origin, Y up)
  - [ ] Inline comments explain when to use slot_index vs grid_x/y
  - [ ] All developers understand the system (no confusion)
  - [ ] **Note:** No code changes needed - system already correct!
- [ ] Stacking respects grid coordinates
- [ ] No item "jumping" on container open
- [ ] All API calls include required parameters

### Nice to Have (Medium/Low)
- [ ] Clean logs (no DEBUG spam)
- [ ] Complete documentation
- [ ] No race conditions
- [ ] Proper capacity checks for all containers

---

## 8. Dependencies

### Blocked By
- None - can start immediately

### Blocks
- Future inventory features
- Item sorting/organizing features
- Multi-container operations

### Related Work
- Character module rework (Phase 7-8)
- Container UI improvements
- Save system optimization

---

## 9. Rollback Plan

If critical issues discovered:

1. [ ] Revert commits for that phase
2. [ ] Restore data from backup if needed
3. [ ] Document issue encountered
4. [ ] Replan with new information

**Data Safety:**
- Always test with copy of production data
- Backup saves before each phase
- Version control all changes

---

## 10. Post-Implementation

### Documentation Updates
- [ ] Update 2026_02_22_character_module_rework.md
- [ ] Update 2026_02_19_inventory_movement_plan.md
- [ ] Update CONTAINER_FORMAT_STATUS.md
- [ ] Mark this plan as COMPLETE

### Knowledge Sharing
- [ ] Present changes to team
- [ ] Document lessons learned
- [ ] Update coding standards if needed

### Monitoring
- [ ] Monitor logs for errors
- [ ] Watch for user bug reports
- [ ] Verify performance hasn't degraded

---

## 11. Appendix

### Coordinate System Reference

#### Canvas Coordinate System (ACTUAL STANDARD for UI)

**Definition:**
- **Origin:** Bottom-left corner (0, 0)
- **+X Direction:** Rightward (increasing)
- **+Y Direction:** Upward (increasing)
- **Row 0:** Bottom row
- **Mental Model:** Cartesian coordinates (like math/graphs)

```
Canvas Coordinate System (UI Standard):
  Y+ ↑
     |
  10 |
   9 |
   8 |
   7 |
   6 |
   5 |
   4 |
   3 |
   2 |
   1 |
   0 +--------→ X+
     0 1 2 3 4

Why: Used consistently across all UI modules
```

**When to Use:**
- ✅ ALL UI elements (containers, character slots, drag operations)
- ✅ Hit testing and slot detection
- ✅ Rendering to screen
- ✅ Internal module calculations
- ✅ Mouse/touch event handling
- ✅ Drag and drop operations

**Why This System:**
1. ✅ Used consistently across ALL modules
2. ✅ No conversions needed between modules
3. ✅ Hit detection matches rendering perfectly
4. ✅ Only ONE conversion: screen pixels → canvas (in canvas_runtime.ts)

---

#### Grid Coordinates (DATA - Not UI Positioning)

**Definition:**
- **Origin:** Top-left conceptually (0, 0)
- **+X:** Column (rightward)
- **+Y:** Row (downward)
- **Row 0:** Top row visually
- **Purpose:** Sparse inventory data storage (Minecraft-style)

```
Grid Coordinates (for storage):
    0   1   2   3   4   (X →)
  +---+---+---+---+---+
0 | 0 | 1 | 2 | 3 | 4 |  ← Row 0 (top visually)
  +---+---+---+---+---+
1 | 5 | 6 | 7 | 8 | 9 |  ← Row 1
  +---+---+---+---+---+
2 |10 |11 |12 |13 |14 |  ← Row 2
  +---+---+---+---+---+
  ↓
  (Y)

Why: Matches how items are stored conceptually
```

**When to Use:**
- ✅ Storing item positions in container data
- ✅ Same-container sparse positioning (Minecraft-style)
- ✅ API communication for grid-based transfers
- ❌ NOT for UI rendering or hit detection

**Key Insight:**
- Grid coordinates are **DATA** (where item is stored)
- Canvas coordinates are **UI** (where item is drawn)
- They're DIFFERENT PURPOSES, not competing systems!

---

#### Slot Index (Linear Position)

**Definition:**
- Linear position in packed array
- Formula: `slot_index = row * cols + col`
- Row 0 = bottom row visually

**When to Use:**
- ✅ Packed array operations
- ✅ Legacy transfers
- ✅ Converting between coordinate systems

**Conversion:**
```typescript
// Slot index to row/col
const col = slot_index % cols;
const row = Math.floor(slot_index / cols);  // Row 0 = bottom

// Row/col to slot index
const slot_index = row * cols + col;
```

---

#### Coordinate System Summary

| Coordinate Type | Purpose | Used By | Origin | Y Direction |
|-----------------|---------|---------|--------|-------------|
| **Canvas** | UI positioning | All UI modules | Bottom-left | ↑ Up |
| **Grid** | Data storage | Container data | Top-left conceptually | ↓ Down |
| **Slot Index** | Array access | Packed arrays | N/A (linear) | N/A |

**Coordinate Flow:**
```
Screen Pixels (top-left)
    ↓ canvas_runtime.ts converts once
Canvas Coordinates (bottom-left) ← ALL UI MODULES USE THIS
    ↓ Individual modules render
Screen Display
```

**No conversion needed between modules!**

---

#### Developer Guidelines

**Working on UI code?**
- Use Canvas coordinates (bottom-left origin)
- Don't convert between modules
- Trust that all modules use the same system

**Storing item positions?**
- Use Grid coordinates (grid_x, grid_y)
- These go in container data
- Independent of UI coordinates

**Confused about coordinates?**
- Canvas coords = Where to DRAW (UI)
- Grid coords = Where item IS (Data)
- They're DIFFERENT purposes!

**Golden Rule:**
UI code always uses Canvas coordinates (bottom-left, Y up).
Only convert at the screen boundary (canvas_runtime.ts).
function canvasToGrid(canvas: {x: number, y: number}, totalRows: number) {
  return {
    x: canvas.x,
    y: (totalRows - 1) - canvas.y
  };
}

// Convert Grid coordinates to Canvas coordinates
function gridToCanvas(grid: {x: number, y: number}, totalRows: number) {
  return {
    x: grid.x,
    y: (totalRows - 1) - grid.y
  };
}
```

---

#### System Usage Matrix

| Component | Coordinate System | Notes |
|-----------|------------------|-------|
| **Container slots** | Grid | Row 0 = top, Y increases down |
| **Character body slots** | Grid | Head = row 0, Legs = row 3 |
| **Drag operations** | Grid | Drag ghost converted at render |
| **Mouse input** | Canvas → Grid | Convert immediately on input |
| **API storage** | Grid | grid_x, grid_y in storage |
| **Place tiles** | Canvas | World coordinates, keep as-is |
| **Actor positions** | Canvas | World coordinates, keep as-is |
| **Particles** | Canvas | World space effects |

---

#### Quick Decision Guide

**Adding new code? Ask yourself:**

1. **Is this UI code?** (containers, buttons, menus)
   → Use **Grid Coordinates** (top-left origin, Y down)

2. **Is this world code?** (places, actors, movement)
   → Use **Canvas Coordinates** (bottom-left origin, Y up)

3. **Am I handling mouse/touch input?**
   → Canvas → Convert to Grid immediately → Use Grid internally

4. **Am I rendering to screen?**
   → Grid internally → Convert to Canvas at render time

5. **Am I storing item positions?**
   → Always use **Grid Coordinates**

**Golden Rule:** Internal logic ALWAYS uses Grid coordinates for UI!

---

#### Examples

**Example 1: Container Slot Positioning**
```typescript
// WRONG: Mixing coordinate systems
const slot_y = start_y - row * spacing;  // Canvas-style
grid_y = Math.floor(slot_index / cols);  // Grid-style

// CORRECT: Use Grid throughout
const grid = slotIndexToGrid(slot_index, cols);
// ... do logic with grid.x, grid.y ...
const canvasY = gridYToCanvasY(grid.y, totalRows);
renderAt(grid.x, canvasY);  // Only convert at render
```

**Example 2: Mouse Click Detection**
```typescript
// WRONG: Manual Y inversion scattered in code
const row = height - 1 - Math.floor(y / tileHeight);

// CORRECT: Convert at boundary, use Grid internally
const grid = canvasToGrid(mousePos, totalRows);
const slotIndex = gridToSlotIndex(grid, cols);
```

**Example 3: API Communication**
```typescript
// WRONG: Inconsistent coordinate types
transfer_body.to_slot_index = slot_index;  // Linear
transfer_body.target_grid_x = grid_x;      // 2D

// CORRECT: Always use Grid coordinates for positioning
transfer_body.target_grid_x = grid.x;
transfer_body.target_grid_y = grid.y;
```

---

#### Visual Comparison

```
Same Container - Different Coordinate Views:

Grid View (Internal Logic):          Canvas View (Rendering):
    0   1   2   3   4                    0   1   2   3   4
  +---+---+---+---+---+              +---+---+---+---+---+
0 | A | B | C |   |   |           2 |   |   |   |   |   |
  +---+---+---+---+---+              +---+---+---+---+---+
1 |   | D |   | E |   |           1 |   | D |   | E |   |
  +---+---+---+---+---+              +---+---+---+---+---+
2 |   |   |   |   | F |           0 | A | B | C |   |   |
  +---+---+---+---+---+              +---+---+---+---+---+
  
Item Positions (Grid):               Item Positions (Canvas):
- A: (0, 0) top-left                - A: (0, 2) bottom-left  
- B: (1, 0) top                     - B: (1, 2) bottom
- C: (2, 0) top-right               - C: (2, 2) bottom-right
- D: (1, 1) middle                  - D: (1, 1) middle
- E: (3, 1) middle-right            - E: (3, 1) middle-right
- F: (4, 2) bottom-right            - F: (4, 0) top-right

Both represent the SAME visual layout!
Just different coordinate origins.
```

### Container ID Patterns

**Body Slot Containers:**
- Format: `container.{actor_id}.{slot_name}`
- Example: `container.henry_actor.hand_left`
- Slots: head, torso, hand_left, hand_right, leg_left, leg_right

**Nested Containers:**
- Format: `item.{instance_id}`
- Example: `item.inst_henry_sack_001`
- Stored in parent container's item.container_data

**Regular Containers:**
- Format: `container.{type}.{id}`
- Example: `container.place.eden_crossroads_chest`

### Transfer Flow Diagram

```
User Drag Start
    ↓
ContainerModule.OnDragStart()
    ↓
drag_state.start_drag() [stores source_slot_index]
    ↓
User Drop
    ↓
ContainerModule.OnDragEnd()
    ↓
Calculate grid_x/grid_y from slot_index
    ↓
app_state.on_drop()
    ↓
Build transfer_body with grid_x/grid_y
    ↓
POST /api/transfer
    ↓
main.ts API handler
    ↓
transfer_item_between_containers()
    ↓
Check conditions in order:
    1. Same slot? → Reject
    2. Same container + grid coords? → Grid placement [FIXED ORDER]
    3. Body slot swap? → Swap items
    4. Normal transfer? → Move between containers
    5. Stack? → Merge quantities
    ↓
Save container to disk
    ↓
Return success
    ↓
app_state refreshes container data
    ↓
UI updates with new positions
```

---

**Status:** Planning Complete  
**Next Step:** Begin Phase 1 - Critical Fixes  
**Assigned To:** TBD  
**Review Date:** 2026-02-26

---

*This plan was created following comprehensive analysis of the item transfer system. All 13 identified issues are tracked with specific fixes, testing criteria, and success metrics.*
